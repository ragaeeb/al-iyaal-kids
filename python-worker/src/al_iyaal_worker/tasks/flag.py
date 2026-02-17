from collections.abc import Callable
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from ..filesystem import to_job_id
from ..models import StartFlagBatchCommand
from ..moderation import analyze_subtitles
from ..subtitles import parse_srt, sidecar_analysis_path, sidecar_srt_path
from .events import (
    emit_task_done,
    emit_task_job_done,
    emit_task_job_error,
    emit_task_job_progress,
)

EmitEvent = Callable[[dict[str, object]], None]
ShouldCancel = Callable[[], bool]


def _build_analysis_payload(
    source_path: Path, flagged: list[dict[str, Any]], summary: str
) -> dict[str, Any]:
    return {
        "engine": "local_rules",
        "flagged": flagged,
        "summary": summary,
        "createdAt": datetime.now(tz=timezone.utc).isoformat(),
        "videoFileName": source_path.name,
    }


def _resolve_sidecars(path: Path) -> tuple[Path, Path]:
    if path.suffix.lower() == ".srt":
        return path, path.with_suffix(".analysis.json")
    return sidecar_srt_path(path), sidecar_analysis_path(path)


def process_flag_batch(
    command: StartFlagBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
) -> None:
    ok_count = 0
    failed_count = 0
    cancelled_count = 0

    for index, raw_input_path in enumerate(command.input_paths):
        if should_cancel():
            cancelled_count = len(command.input_paths) - index
            break

        source_path = Path(raw_input_path)
        job_id = to_job_id(raw_input_path)
        srt_path, analysis_path = _resolve_sidecars(source_path)

        emit_task_job_progress(emit, command.task_id, "flag", job_id, 5)

        if not srt_path.exists():
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "flag",
                job_id,
                f"Missing subtitle sidecar. Run transcription first: {srt_path}",
            )
            continue

        try:
            subtitles = parse_srt(srt_path.read_text(encoding="utf-8"))
        except Exception as error:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "flag",
                job_id,
                f"Failed reading subtitle file: {error}",
            )
            continue

        emit_task_job_progress(emit, command.task_id, "flag", job_id, 40)

        try:
            flagged, summary = analyze_subtitles(subtitles, command.settings)
        except Exception as error:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "flag",
                job_id,
                f"Failed during local moderation: {error}",
            )
            continue

        emit_task_job_progress(emit, command.task_id, "flag", job_id, 80)

        payload = _build_analysis_payload(source_path, flagged, summary)
        try:
            analysis_path.write_text(
                json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as error:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "flag",
                job_id,
                f"Failed writing analysis sidecar: {error}",
            )
            continue

        ok_count += 1
        emit_task_job_done(
            emit,
            command.task_id,
            "flag",
            job_id,
            output_path=str(analysis_path),
            artifacts={"flaggedCount": len(flagged), "summary": summary},
        )

    emit_task_done(
        emit,
        command.task_id,
        "flag",
        ok=ok_count,
        failed=failed_count,
        cancelled=cancelled_count,
    )
