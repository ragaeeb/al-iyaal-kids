from collections.abc import Callable
from collections import deque
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from ..commands import (
    build_ffmpeg_cut_command,
    build_video_cleaned_output_path,
    generate_cut_concat_file_content,
)
from ..filesystem import to_job_id
from ..models import CutRange, StartCutJobCommand
from ..staged_output import commit_staged_output, staged_output_path
from ..timecode import parse_time_to_seconds
from .events import (
    emit_job_log,
    emit_task_done,
    emit_task_job_done,
    emit_task_job_error,
    emit_task_job_progress,
)

EmitEvent = Callable[[dict[str, object]], None]
ShouldCancel = Callable[[], bool]


def _ffmpeg_progress_seconds(line: str) -> float | None:
    key, separator, raw_value = line.strip().partition("=")
    if separator != "=" or key != "out_time_us":
        return None
    try:
        return max(0.0, float(raw_value) / 1_000_000)
    except ValueError:
        return None


def _run_ffmpeg_with_progress(
    command: list[str],
    duration_seconds: float,
    on_progress: Callable[[float], None],
    should_cancel: ShouldCancel,
) -> tuple[subprocess.CompletedProcess[str], bool]:
    process = subprocess.Popen(  # noqa: S603
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    stdout_pipe = process.stdout
    if stdout_pipe is None:
        process.kill()
        process.wait()
        return subprocess.CompletedProcess(
            command,
            1,
            "",
            "ffmpeg progress stream unavailable",
        ), False

    recent_output: deque[str] = deque(maxlen=100)
    cancelled = False

    def terminate_process() -> None:
        try:
            process.terminate()
        except (OSError, ProcessLookupError):
            pass

    if should_cancel():
        cancelled = True
        terminate_process()

    for line in stdout_pipe:
        recent_output.append(line)
        if cancelled:
            continue
        if should_cancel():
            cancelled = True
            terminate_process()
            continue
        progress_seconds = _ffmpeg_progress_seconds(line)
        if progress_seconds is not None:
            on_progress(min(1.0, progress_seconds / duration_seconds))

    if not cancelled and should_cancel():
        cancelled = True
        terminate_process()

    return_code = process.wait()
    output = "".join(recent_output)
    return subprocess.CompletedProcess(command, return_code, "", output), cancelled


def _is_valid_range(cut_range: CutRange) -> bool:
    try:
        start = parse_time_to_seconds(cut_range.start)
        end = parse_time_to_seconds(cut_range.end)
    except Exception:
        return False
    return start >= 0 and end > start


def _to_seconds(cut_range: CutRange) -> tuple[float, float]:
    start = parse_time_to_seconds(cut_range.start)
    end = parse_time_to_seconds(cut_range.end)
    return start, end


def process_cut_job(
    command: StartCutJobCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
) -> None:
    ffmpeg_path = os.getenv("AIYAAL_FFMPEG_PATH", "ffmpeg")
    task_id = command.task_id
    job_id = to_job_id(command.video_path)

    if should_cancel():
        emit_task_done(emit, task_id, "cut", ok=0, failed=0, cancelled=1)
        return

    if not command.ranges:
        emit_task_job_error(emit, task_id, "cut", job_id, "No cut ranges provided.")
        emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
        return

    invalid = next((item for item in command.ranges if not _is_valid_range(item)), None)
    if invalid is not None:
        emit_task_job_error(
            emit,
            task_id,
            "cut",
            job_id,
            f"Invalid range: {invalid.start}-{invalid.end}",
        )
        emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
        return

    video_path = Path(command.video_path)
    if not video_path.is_file():
        emit_task_job_error(
            emit,
            task_id,
            "cut",
            job_id,
            f"Video file not found: {video_path}",
        )
        emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
        return

    output_path = build_video_cleaned_output_path(video_path)
    emit_task_job_progress(emit, task_id, "cut", job_id, 5)
    temp_dir: Path | None = None

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix="al-iyaal-cut-"))
        range_seconds = [_to_seconds(cut_range) for cut_range in command.ranges]
        total_duration = sum(end - start for start, end in range_seconds)
        concat_file = temp_dir / "ranges.ffconcat"
        concat_file.write_text(
            generate_cut_concat_file_content(video_path, range_seconds),
            encoding="utf-8",
        )
        max_progress = 5
        with staged_output_path(output_path) as staged_output_path_value:
            cut_command = build_ffmpeg_cut_command(
                ffmpeg_path=ffmpeg_path,
                concat_file_path=concat_file,
                output_path=staged_output_path_value,
                compression_preset=command.compression_preset,
            )

            def emit_cut_progress(ratio: float) -> None:
                nonlocal max_progress
                progress = 5 + int(ratio * 90)
                if progress > max_progress:
                    max_progress = progress
                    emit_task_job_progress(emit, task_id, "cut", job_id, progress)

            cut_result, cancelled = _run_ffmpeg_with_progress(
                cut_command,
                total_duration,
                emit_cut_progress,
                should_cancel,
            )
            if cancelled or should_cancel():
                emit_task_done(emit, task_id, "cut", ok=0, failed=0, cancelled=1)
                return
            if cut_result.returncode != 0:
                emit_task_job_error(
                    emit,
                    task_id,
                    "cut",
                    job_id,
                    f"ffmpeg cut failed: {cut_result.stderr.strip() or f'exit {cut_result.returncode}'}",
                )
                emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
                return

            if max_progress < 95:
                emit_task_job_progress(emit, task_id, "cut", job_id, 95)
            commit_staged_output(staged_output_path_value, output_path)

        emit_job_log(
            emit,
            task_id,
            "cut",
            job_id,
            f"Wrote cleaned video to {output_path}",
            stream="stdout",
        )
        emit_task_job_done(
            emit,
            task_id,
            "cut",
            job_id,
            output_path=str(output_path),
        )
        emit_task_done(emit, task_id, "cut", ok=1, failed=0, cancelled=0)
    except Exception as error:
        emit_task_job_error(
            emit,
            task_id,
            "cut",
            job_id,
            f"Cut export failed: {error}",
        )
        emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
    finally:
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)
