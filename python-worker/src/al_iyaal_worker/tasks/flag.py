from collections.abc import Callable
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from ..filesystem import to_job_id
from ..models import StartFlagBatchCommand
from ..moderation import analyze_subtitles, analyze_with_llm, describe_llm_request
from ..subtitles import parse_srt, sidecar_analysis_path, sidecar_srt_path
from .events import (
    emit_job_log,
    emit_task_done,
    emit_task_job_done,
    emit_task_job_error,
    emit_task_job_progress,
)

EmitEvent = Callable[[dict[str, object]], None]
ShouldCancel = Callable[[], bool]


def _build_analysis_payload(
    source_path: Path, engine: str, flagged: list[dict[str, Any]], summary: str
) -> dict[str, Any]:
    return {
        "engine": engine,
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
        engine = str(command.settings.get("engine", "blacklist")).strip().lower()

        emit_task_job_progress(emit, command.task_id, "flag", job_id, 5)
        emit_job_log(
            emit,
            command.task_id,
            "flag",
            job_id,
            f"Starting analysis for {source_path.name} with engine={engine}",
        )

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
            if engine == "blacklist":
                flagged, summary = analyze_subtitles(subtitles, command.settings)
                analysis_engine = "local_rules"
            else:
                request_config = describe_llm_request(command.settings)
                emit_job_log(
                    emit,
                    command.task_id,
                    "flag",
                    job_id,
                    f"Running LLM analysis with engine={request_config.engine} strategy={request_config.strategy}",
                )
                emit_job_log(
                    emit,
                    command.task_id,
                    "flag",
                    job_id,
                    f"LLM request config: endpoint={request_config.endpoint} model={request_config.model}",
                )
                llm_result = analyze_with_llm(subtitles, command.settings, source_path.name)
                flagged = llm_result.flagged
                summary = llm_result.summary
                analysis_engine = llm_result.engine
        except Exception as error:
            failed_count += 1
            emit_task_job_error(
                emit,
                command.task_id,
                "flag",
                job_id,
                f"Failed during moderation: {error}",
            )
            continue

        emit_task_job_progress(emit, command.task_id, "flag", job_id, 80)
        emit_job_log(
            emit,
            command.task_id,
            "flag",
            job_id,
            f"Flagged {len(flagged)} subtitle item(s).",
        )

        payload = _build_analysis_payload(source_path, analysis_engine, flagged, summary)
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
            artifacts={
                "flaggedCount": len(flagged),
                "summary": summary,
            },
        )

        if should_cancel():
            remaining_count = len(command.input_paths) - index - 1
            if remaining_count > 0:
                cancelled_count = remaining_count
                emit_job_log(
                    emit,
                    command.task_id,
                    "flag",
                    job_id,
                    f"Cancellation requested. Skipping the remaining {remaining_count} file(s).",
                )
                break
            emit_job_log(
                emit,
                command.task_id,
                "flag",
                job_id,
                "Cancellation requested while the current file was already running. The current file finished because cancel mode is stop-after-current.",
            )

    emit_task_done(
        emit,
        command.task_id,
        "flag",
        ok=ok_count,
        failed=failed_count,
        cancelled=cancelled_count,
    )
