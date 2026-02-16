import json
import sys
import threading
from typing import Any, TextIO

from .models import CancelBatchCommand, StartBatchCommand, WorkerCommand


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

    if command_type == "cancel_batch":
        return CancelBatchCommand(
            batch_id=str(payload["batchId"]),
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
