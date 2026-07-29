import os
import subprocess
from collections.abc import Callable
from pathlib import Path

from .audio_separation import SeparatedAudio, SeparatorFactory, create_vocal_separator
from .commands import build_ffmpeg_command
from .errors import map_process_failure
from .filesystem import to_job_id
from .models import StartBatchCommand

EmitEvent = Callable[[dict[str, object]], None]
RunCommand = Callable[[list[str]], subprocess.CompletedProcess[str]]
ShouldCancel = Callable[[], bool]


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def process_batch(
    command: StartBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
    command_runner: RunCommand = run_command,
    separator_factory: SeparatorFactory = create_vocal_separator,
) -> None:
    ffmpeg_path = os.getenv("AIYAAL_FFMPEG_PATH", "ffmpeg")
    model_dir = Path(os.getenv("AIYAAL_MLX_MODEL_DIR", "./.al-iyaal-models"))
    separator = separator_factory(model_dir)

    ok_count = 0
    failed_count = 0
    cancelled_count = 0

    for index, raw_input_path in enumerate(command.input_paths):
        if should_cancel():
            cancelled_count = len(command.input_paths) - index
            break

        input_path = Path(raw_input_path)
        job_id = to_job_id(raw_input_path)
        separated_audio: SeparatedAudio | None = None

        try:
            emit(
                {
                    "type": "job_progress",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "progressPct": 5,
                }
            )
            emit(
                {
                    "type": "job_log",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "message": f"Running BS-RoFormer-SW MLX separation for {input_path.name}",
                    "stream": "stdout",
                }
            )
            separated_audio = separator.separate_vocals(input_path)
        except Exception as error:
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": f"BS-RoFormer-SW MLX separation failed: {error}",
                }
            )
            continue

        emit(
            {
                "type": "job_progress",
                "batchId": command.batch_id,
                "jobId": job_id,
                "progressPct": 65,
            }
        )

        output_dir = input_path.parent / "audio_replaced"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / input_path.name
        emit(
            {
                "type": "job_log",
                "batchId": command.batch_id,
                "jobId": job_id,
                "message": f"Running ffmpeg remux for {input_path.name}",
                "stream": "stdout",
            }
        )
        try:
            ffmpeg_result = command_runner(
                build_ffmpeg_command(
                    ffmpeg_path=ffmpeg_path,
                    video_path=input_path,
                    vocals_path=separated_audio.vocals_path,
                    output_path=output_path,
                )
            )
        except Exception as error:
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": f"ffmpeg execution failed: {error}",
                }
            )
            separator.cleanup(separated_audio)
            continue

        if ffmpeg_result.returncode != 0:
            failed_count += 1
            if ffmpeg_result.stderr:
                emit(
                    {
                        "type": "job_log",
                        "batchId": command.batch_id,
                        "jobId": job_id,
                        "message": ffmpeg_result.stderr.strip(),
                        "stream": "stderr",
                    }
                )
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": map_process_failure("ffmpeg", ffmpeg_result.returncode, ffmpeg_result.stderr),
                }
            )
            separator.cleanup(separated_audio)
            continue

        ok_count += 1
        emit(
            {
                "type": "job_done",
                "batchId": command.batch_id,
                "jobId": job_id,
                "outputPath": str(output_path),
            }
        )
        separator.cleanup(separated_audio)

    emit(
        {
            "type": "batch_done",
            "batchId": command.batch_id,
            "summary": {
                "ok": ok_count,
                "failed": failed_count,
                "cancelled": cancelled_count,
            },
        }
    )
