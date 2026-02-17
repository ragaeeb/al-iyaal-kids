import json
import sys
import threading
from typing import Any, TextIO

from .models import (
    CancelBatchCommand,
    CancelTaskCommand,
    CutRange,
    StartBatchCommand,
    StartCutJobCommand,
    StartFlagBatchCommand,
    StartTranscriptionBatchCommand,
    WorkerCommand,
)


def parse_worker_command(raw_line: str) -> WorkerCommand:
    payload = json.loads(raw_line)
    command_type = payload.get("type")

    if command_type == "start_batch":
        return StartBatchCommand(
            batch_id=str(payload["batchId"]),
            input_paths=[str(path) for path in payload["inputPaths"]],
            output_dir=str(payload["outputDir"]),
            compute_mode=str(payload.get("computeMode", "auto")),
        )

    if command_type == "start_transcription_batch":
        return StartTranscriptionBatchCommand(
            task_id=str(payload["taskId"]),
            input_paths=[str(path) for path in payload["inputPaths"]],
            yap_mode=str(payload.get("yapMode", "auto")),
        )

    if command_type == "start_flag_batch":
        settings = payload.get("settings", {})
        if not isinstance(settings, dict):
            raise ValueError("settings must be an object")

        return StartFlagBatchCommand(
            task_id=str(payload["taskId"]),
            input_paths=[str(path) for path in payload["inputPaths"]],
            settings=settings,
        )

    if command_type == "start_cut_job":
        raw_ranges = payload.get("ranges", [])
        if not isinstance(raw_ranges, list):
            raise ValueError("ranges must be an array")

        ranges: list[CutRange] = []
        for item in raw_ranges:
            if not isinstance(item, dict):
                raise ValueError("range must be an object")
            ranges.append(
                CutRange(
                    start=str(item["start"]),
                    end=str(item["end"]),
                )
            )

        return StartCutJobCommand(
            task_id=str(payload["taskId"]),
            video_path=str(payload["videoPath"]),
            ranges=ranges,
            output_mode=str(payload.get("outputMode", "video_cleaned_default")),
        )

    if command_type == "cancel_batch":
        return CancelBatchCommand(
            batch_id=str(payload["batchId"]),
            mode=str(payload.get("mode", "stop_after_current")),
        )

    if command_type == "cancel_task":
        return CancelTaskCommand(
            task_id=str(payload["taskId"]),
            mode=str(payload.get("mode", "stop_after_current")),
        )

    raise ValueError(f"Unsupported command type: {command_type}")


def emit_event(payload: dict[str, Any], output_stream: TextIO, lock: threading.Lock) -> None:
    line = json.dumps(payload, separators=(",", ":"))
    with lock:
        output_stream.write(f"{line}\n")
        output_stream.flush()


def emit_worker_status(
    status: str,
    message: str,
    output_stream: TextIO = sys.stdout,
    lock: threading.Lock | None = None,
) -> None:
    effective_lock = lock or threading.Lock()
    emit_event(
        {
            "type": "worker_status",
            "status": status,
            "message": message,
        },
        output_stream,
        effective_lock,
    )
