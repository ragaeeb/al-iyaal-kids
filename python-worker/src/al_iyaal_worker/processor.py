import os
import re
import subprocess
from collections.abc import Callable
from pathlib import Path
import shutil

from .commands import build_demucs_command, build_ffmpeg_command, expected_vocals_path
from .errors import map_process_failure
from .filesystem import to_job_id
from .models import StartBatchCommand
from .runtime import resolve_compute_device

EmitEvent = Callable[[dict[str, object]], None]
RunCommand = Callable[[list[str]], subprocess.CompletedProcess[str]]
ShouldCancel = Callable[[], bool]
PROGRESS_PERCENT_RE = re.compile(r"(\d{1,3})%\|")


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def run_demucs_command_with_progress(
    command: list[str],
    emit: EmitEvent,
    batch_id: str,
    job_id: str,
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(  # noqa: S603
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

    stderr_pipe = process.stderr
    if stderr_pipe is None:
        return subprocess.CompletedProcess(command, 1, "", "demucs stderr stream unavailable")

    stderr_chunks: list[str] = []
    max_reported = 5
    emit(
        {
            "type": "job_progress",
            "batchId": batch_id,
            "jobId": job_id,
            "progressPct": max_reported,
        }
    )

    while True:
        chunk = stderr_pipe.read(512)
        if chunk == "":
            break

        stderr_chunks.append(chunk)
        for raw_line in chunk.replace("\r", "\n").split("\n"):
            line = raw_line.strip()
            if line:
                emit(
                    {
                        "type": "job_log",
                        "batchId": batch_id,
                        "jobId": job_id,
                        "message": line,
                        "stream": "stderr",
                    }
                )

        for match in PROGRESS_PERCENT_RE.findall(chunk):
            percent = max(0, min(100, int(match)))
            mapped_progress = 5 + int(percent * 0.6)
            if mapped_progress > max_reported:
                max_reported = mapped_progress
                emit(
                    {
                        "type": "job_progress",
                        "batchId": batch_id,
                        "jobId": job_id,
                        "progressPct": mapped_progress,
                    }
                )

    return_code = process.wait()
    stderr_text = "".join(stderr_chunks)
    return subprocess.CompletedProcess(command, return_code, "", stderr_text)


def process_batch(
    command: StartBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
    command_runner: RunCommand = run_command,
) -> None:
    output_dir = Path(command.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg_path = os.getenv("AIYAAL_FFMPEG_PATH", "ffmpeg")
    demucs_path = os.getenv("AIYAAL_DEMUCS_PATH", "demucs")
    device = resolve_compute_device(command.compute_mode)

    ok_count = 0
    failed_count = 0
    cancelled_count = 0

    for index, raw_input_path in enumerate(command.input_paths):
        if should_cancel():
            cancelled_count = len(command.input_paths) - index
            break

        input_path = Path(raw_input_path)
        job_id = to_job_id(raw_input_path)
        parent_dir = input_path.parent
        stem_dir = parent_dir / "htdemucs" / input_path.stem
        model_root_dir = parent_dir / "htdemucs"

        try:
            demucs_result = run_demucs_command_with_progress(
                command=build_demucs_command(
                    demucs_path,
                    input_path,
                    parent_dir,
                    device,
                ),
                emit=emit,
                batch_id=command.batch_id,
                job_id=job_id,
            )
        except Exception as error:
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": f"demucs execution failed: {error}",
                }
            )
            cleanup_demucs_artifacts(stem_dir, model_root_dir)
            continue
        if demucs_result.returncode != 0:
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": map_process_failure("demucs", demucs_result.returncode, demucs_result.stderr),
                }
            )
            cleanup_demucs_artifacts(stem_dir, model_root_dir)
            continue

        vocals_path = expected_vocals_path(input_path, parent_dir)
        if not vocals_path.exists():
            failed_count += 1
            emit(
                {
                    "type": "job_error",
                    "batchId": command.batch_id,
                    "jobId": job_id,
                    "error": f"Extracted vocals not found: {vocals_path}",
                }
            )
            cleanup_demucs_artifacts(stem_dir, model_root_dir)
            continue

        emit(
            {
                "type": "job_progress",
                "batchId": command.batch_id,
                "jobId": job_id,
                "progressPct": 65,
            }
        )

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
                    vocals_path=vocals_path,
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
            cleanup_demucs_artifacts(stem_dir, model_root_dir)
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
            cleanup_demucs_artifacts(stem_dir, model_root_dir)
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
        cleanup_demucs_artifacts(stem_dir, model_root_dir)

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


def cleanup_demucs_artifacts(stem_dir: Path, model_root_dir: Path) -> None:
    try:
        if stem_dir.exists():
            shutil.rmtree(stem_dir, ignore_errors=True)
        if model_root_dir.exists() and not any(model_root_dir.iterdir()):
            model_root_dir.rmdir()
    except Exception:
        return
