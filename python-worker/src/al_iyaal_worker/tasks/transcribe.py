from collections.abc import Callable
import os
from pathlib import Path
import re
import subprocess

from ..commands import build_transcribe_command
from ..filesystem import to_job_id
from ..models import StartTranscriptionBatchCommand
from ..subtitles import sidecar_srt_path
from .events import (
    emit_job_log,
    emit_task_done,
    emit_task_job_done,
    emit_task_job_error,
    emit_task_job_progress,
)

EmitEvent = Callable[[dict[str, object]], None]
ShouldCancel = Callable[[], bool]

ANSI_RE = re.compile(r"\x1B\[[0-9;]*[a-zA-Z]")
YAP_PROGRESS_RE = re.compile(r"\[\s*(\d+)%\s*\]\s*(.+)")


def strip_ansi(value: str) -> str:
    return ANSI_RE.sub("", value)


def parse_yap_progress_line(line: str) -> tuple[int, str] | None:
    cleaned = strip_ansi(line).strip()
    if not cleaned:
        return None

    progress_match = YAP_PROGRESS_RE.search(cleaned)
    if progress_match is not None:
        return int(progress_match.group(1)), progress_match.group(2).strip()

    if "Success" in cleaned or "Transcription written to" in cleaned:
        return 100, "Transcription complete"

    return None


def process_transcription_batch(
    command: StartTranscriptionBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
) -> None:
    yap_path = os.getenv("AIYAAL_YAP_PATH", "yap")
    ok_count = 0
    failed_count = 0
    cancelled_count = 0

    for index, raw_video_path in enumerate(command.input_paths):
        if should_cancel():
            cancelled_count = len(command.input_paths) - index
            break

        video_path = Path(raw_video_path)
        job_id = to_job_id(raw_video_path)
        srt_path = sidecar_srt_path(video_path)
        emit_task_job_progress(emit, command.task_id, "transcription", job_id, 3)

        transcribe_command = build_transcribe_command(
            yap_path=yap_path,
            video_path=video_path,
            output_srt_path=srt_path,
        )

        try:
            process = subprocess.Popen(  # noqa: S603
                transcribe_command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env={**os.environ, "NSUnbufferedIO": "YES"},
            )
        except Exception as error:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "transcription",
                job_id,
                f"Failed to start transcription command: {error}",
            )
            continue

        max_progress = 3
        stdout_pipe = process.stdout
        if stdout_pipe is not None:
            for line in stdout_pipe:
                stripped_line = line.strip()
                if stripped_line:
                    emit_job_log(
                        emit,
                        command.task_id,
                        "transcription",
                        job_id,
                        stripped_line,
                    )
                progress = parse_yap_progress_line(line)
                if progress is None:
                    continue
                percent, _message = progress
                mapped_progress = 3 + int(percent * 0.9)
                if mapped_progress > max_progress:
                    max_progress = mapped_progress
                    emit_task_job_progress(
                        emit,
                        command.task_id,
                        "transcription",
                        job_id,
                        mapped_progress,
                    )

        return_code = process.wait()
        if return_code != 0:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "transcription",
                job_id,
                f"Transcription failed with exit code {return_code}.",
            )
            continue

        if not srt_path.exists():
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "transcription",
                job_id,
                f"Missing transcript output: {srt_path}",
            )
            continue

        ok_count += 1
        emit_task_job_done(
            emit,
            command.task_id,
            "transcription",
            job_id,
            output_path=str(srt_path),
        )

    emit_task_done(
        emit,
        command.task_id,
        "transcription",
        ok=ok_count,
        failed=failed_count,
        cancelled=cancelled_count,
    )
