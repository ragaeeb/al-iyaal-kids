from collections.abc import Callable
from collections import deque
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from ..commands import (
    build_ffmpeg_concat_command,
    build_ffmpeg_slice_command,
    build_video_cleaned_output_path,
    generate_concat_file_content,
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


def _run_ffmpeg_slice_with_progress(
    command: list[str],
    duration_seconds: float,
    on_progress: Callable[[float], None],
) -> subprocess.CompletedProcess[str]:
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
        )

    recent_output: deque[str] = deque(maxlen=100)
    for line in stdout_pipe:
        recent_output.append(line)
        progress_seconds = _ffmpeg_progress_seconds(line)
        if progress_seconds is not None:
            on_progress(min(1.0, progress_seconds / duration_seconds))

    return_code = process.wait()
    output = "".join(recent_output)
    return subprocess.CompletedProcess(command, return_code, "", output)


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
        slice_paths: list[Path] = []
        total_ranges = len(command.ranges)
        max_progress = 5
        for index, cut_range in enumerate(command.ranges):
            if should_cancel():
                emit_task_done(emit, task_id, "cut", ok=0, failed=0, cancelled=1)
                return

            start, end = _to_seconds(cut_range)
            duration = end - start
            slice_path = temp_dir / f"slice-{index}.mp4"

            slice_command = build_ffmpeg_slice_command(
                ffmpeg_path=ffmpeg_path,
                video_path=video_path,
                output_path=slice_path,
                start_seconds=start,
                duration_seconds=duration,
                compression_preset=command.compression_preset,
            )

            def emit_slice_progress(ratio: float) -> None:
                nonlocal max_progress
                progress = 5 + int(((index + ratio) / total_ranges) * 75)
                if progress > max_progress:
                    max_progress = progress
                    emit_task_job_progress(emit, task_id, "cut", job_id, progress)

            slice_result = _run_ffmpeg_slice_with_progress(
                slice_command,
                duration,
                emit_slice_progress,
            )
            if slice_result.returncode != 0:
                emit_task_job_error(
                    emit,
                    task_id,
                    "cut",
                    job_id,
                    f"ffmpeg slice failed: {slice_result.stderr.strip() or f'exit {slice_result.returncode}'}",
                )
                emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
                return

            slice_paths.append(slice_path)
            progress = 5 + int(((index + 1) / total_ranges) * 75)
            if progress > max_progress:
                max_progress = progress
                emit_task_job_progress(emit, task_id, "cut", job_id, progress)

        with staged_output_path(output_path) as staged_output_path_value:
            if len(slice_paths) == 1:
                shutil.move(str(slice_paths[0]), str(staged_output_path_value))
            else:
                concat_file = temp_dir / "concat.txt"
                concat_file.write_text(
                    generate_concat_file_content(slice_paths),
                    encoding="utf-8",
                )

                concat_command = build_ffmpeg_concat_command(
                    ffmpeg_path=ffmpeg_path,
                    concat_file_path=concat_file,
                    output_path=staged_output_path_value,
                )
                concat_result = subprocess.run(  # noqa: S603
                    concat_command,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if concat_result.returncode != 0:
                    emit_task_job_error(
                        emit,
                        task_id,
                        "cut",
                        job_id,
                        f"ffmpeg concat failed: {concat_result.stderr.strip() or f'exit {concat_result.returncode}'}",
                    )
                    emit_task_done(emit, task_id, "cut", ok=0, failed=1, cancelled=0)
                    return

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
