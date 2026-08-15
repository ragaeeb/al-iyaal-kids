import math
import os
import subprocess
from collections.abc import Callable
from pathlib import Path

from .audio_separation import (
    SeparatedAudio,
    SeparatorFactory,
    VocalSeparator,
    create_vocal_separator,
)
from .commands import build_ffmpeg_command
from .errors import map_process_failure
from .filesystem import to_job_id
from .models import StartBatchCommand
from .staged_output import commit_staged_output, staged_output_path

EmitEvent = Callable[[dict[str, object]], None]
RunCommand = Callable[[list[str]], subprocess.CompletedProcess[str]]
ShouldCancel = Callable[[], bool]


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def _emit_batch_done(
    emit: EmitEvent,
    batch_id: str,
    *,
    ok: int,
    failed: int,
    cancelled: int,
) -> None:
    emit(
        {
            "type": "batch_done",
            "batchId": batch_id,
            "summary": {
                "ok": ok,
                "failed": failed,
                "cancelled": cancelled,
            },
        }
    )


def _cleanup_separated_audio(
    separator: VocalSeparator,
    separated_audio: SeparatedAudio,
    emit: EmitEvent,
    batch_id: str,
    job_id: str,
) -> None:
    try:
        separator.cleanup(separated_audio)
    except Exception as error:
        emit(
            {
                "type": "job_log",
                "batchId": batch_id,
                "jobId": job_id,
                "message": f"Failed cleaning temporary separation files: {error}",
                "stream": "stderr",
            }
        )


def _release_separator(separator: VocalSeparator, emit: EmitEvent) -> None:
    try:
        separator.release()
    except Exception as error:
        emit(
            {
                "type": "worker_status",
                "status": "error",
                "message": f"Failed releasing audio separation resources: {error}",
            }
        )


def process_batch(
    command: StartBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
    command_runner: RunCommand = run_command,
    separator_factory: SeparatorFactory = create_vocal_separator,
) -> None:
    ffmpeg_path = os.getenv("AIYAAL_FFMPEG_PATH", "ffmpeg")
    model_dir = Path(os.getenv("AIYAAL_MLX_MODEL_DIR", "./.al-iyaal-models"))
    ok_count = 0
    failed_count = 0
    cancelled_count = 0

    try:
        separator = separator_factory(model_dir)
    except Exception as error:
        for raw_input_path in command.input_paths:
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": to_job_id(raw_input_path),
                    "error": f"Failed loading audio separation model: {error}",
                }
            )
        _emit_batch_done(
            emit,
            command.batch_id,
            ok=0,
            failed=len(command.input_paths),
            cancelled=0,
        )
        return

    for index, raw_input_path in enumerate(command.input_paths):
        if should_cancel():
            cancelled_count = len(command.input_paths) - index
            break

        input_path = Path(raw_input_path)
        job_id = to_job_id(raw_input_path)
        separated_audio: SeparatedAudio | None = None
        last_separation_progress = 5

        def emit_separation_progress(progress: float) -> None:
            nonlocal last_separation_progress
            if not math.isfinite(progress):
                return
            normalized = min(1.0, max(0.0, progress))
            progress_pct = min(64, round(5 + normalized * 60))
            if progress_pct <= last_separation_progress:
                return
            last_separation_progress = progress_pct
            emit(
                {
                    "type": "job_progress",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "progressPct": progress_pct,
                }
            )

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
                    "message": (
                        f"Running {getattr(separator, 'engine_name', 'audio')} separation "
                        f"for {input_path.name}"
                    ),
                    "stream": "stdout",
                }
            )
            separated_audio = separator.separate_vocals(input_path, emit_separation_progress)
        except Exception as error:
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": f"{getattr(separator, 'engine_name', 'Audio')} separation failed: {error}",
                }
            )
            continue

        try:
            emit(
                {
                    "type": "job_progress",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "progressPct": 65,
                }
            )

            output_path = input_path.parent / "audio_replaced" / input_path.name
            emit(
                {
                    "type": "job_log",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "message": f"Running ffmpeg remux for {input_path.name}",
                    "stream": "stdout",
                }
            )
            with staged_output_path(output_path) as staged_path:
                ffmpeg_result = command_runner(
                    build_ffmpeg_command(
                        ffmpeg_path=ffmpeg_path,
                        video_path=input_path,
                        vocals_path=separated_audio.vocals_path,
                        output_path=staged_path,
                    )
                )
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
                            "error": map_process_failure(
                                "ffmpeg",
                                ffmpeg_result.returncode,
                                ffmpeg_result.stderr,
                            ),
                        }
                    )
                    continue
                commit_staged_output(staged_path, output_path)

            ok_count += 1
            emit(
                {
                    "type": "job_done",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "outputPath": str(output_path),
                }
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
        finally:
            _cleanup_separated_audio(
                separator,
                separated_audio,
                emit,
                command.batch_id,
                job_id,
            )

    _release_separator(separator, emit)
    _emit_batch_done(
        emit,
        command.batch_id,
        ok=ok_count,
        failed=failed_count,
        cancelled=cancelled_count,
    )
