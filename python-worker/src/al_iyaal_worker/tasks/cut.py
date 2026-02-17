from collections.abc import Callable
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
    if not video_path.exists():
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
    output_path.parent.mkdir(parents=True, exist_ok=True)

    emit_task_job_progress(emit, task_id, "cut", job_id, 5)
    temp_dir = Path(tempfile.mkdtemp(prefix="al-iyaal-cut-"))

    try:
        slice_paths: list[Path] = []
        total_ranges = len(command.ranges)
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
            )
            slice_result = subprocess.run(  # noqa: S603
                slice_command,
                check=False,
                capture_output=True,
                text=True,
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
            emit_task_job_progress(emit, task_id, "cut", job_id, progress)

        if len(slice_paths) == 1:
            shutil.move(str(slice_paths[0]), str(output_path))
        else:
            concat_file = temp_dir / "concat.txt"
            concat_file.write_text(generate_concat_file_content(slice_paths), encoding="utf-8")

            concat_command = build_ffmpeg_concat_command(
                ffmpeg_path=ffmpeg_path,
                concat_file_path=concat_file,
                output_path=output_path,
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
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
