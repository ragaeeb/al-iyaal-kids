import sys
import threading
from dataclasses import dataclass
from typing import TextIO

from .models import CancelBatchCommand, StartBatchCommand
from .processor import process_batch
from .protocol import emit_event, emit_worker_status, parse_worker_command


@dataclass(slots=True)
class WorkerContext:
    output_stream: TextIO
    output_lock: threading.Lock


class WorkerDaemon:
    def __init__(self, input_stream: TextIO, output_stream: TextIO):
        self._input_stream = input_stream
        self._context = WorkerContext(output_stream=output_stream, output_lock=threading.Lock())
        self._active_batch_lock = threading.Lock()
        self._active_batch_id: str | None = None
        self._cancel_events: dict[str, threading.Event] = {}

    def _emit(self, payload: dict[str, object]) -> None:
        emit_event(payload, self._context.output_stream, self._context.output_lock)

    def _emit_status(self, status: str, message: str) -> None:
        emit_worker_status(
            status=status,
            message=message,
            output_stream=self._context.output_stream,
            lock=self._context.output_lock,
        )

    def _start_batch(self, command: StartBatchCommand) -> None:
        with self._active_batch_lock:
            if self._active_batch_id is not None:
                self._emit_status(
                    "error",
                    "A batch is already running. Wait for completion before starting another batch.",
                )
                self._emit(
                    {
                        "type": "batch_done",
                        "batchId": command.batch_id,
                        "summary": {"ok": 0, "failed": 0, "cancelled": len(command.input_paths)},
                    }
                )
                return

            self._active_batch_id = command.batch_id
            self._cancel_events[command.batch_id] = threading.Event()

        self._emit_status("starting", f"Running batch {command.batch_id}.")

        thread = threading.Thread(
            target=self._run_batch,
            args=(command,),
            daemon=True,
            name=f"batch-{command.batch_id}",
        )
        thread.start()

    def _run_batch(self, command: StartBatchCommand) -> None:
        cancel_event = self._cancel_events[command.batch_id]

        try:
            process_batch(
                command=command,
                emit=self._emit,
                should_cancel=cancel_event.is_set,
            )
        except Exception as error:
            self._emit(
                {
                    "type": "batch_done",
                    "batchId": command.batch_id,
                    "summary": {"ok": 0, "failed": 1, "cancelled": 0},
                }
            )
            self._emit_status("error", f"Unhandled worker failure: {error}")
        finally:
            with self._active_batch_lock:
                self._active_batch_id = None
                self._cancel_events.pop(command.batch_id, None)
            self._emit_status("ready", "Worker ready for next batch.")

    def _cancel_batch(self, command: CancelBatchCommand) -> None:
        with self._active_batch_lock:
            cancel_event = self._cancel_events.get(command.batch_id)

        if cancel_event is None:
            self._emit_status("error", f"No active batch found for cancel request: {command.batch_id}.")
            return

        cancel_event.set()
        self._emit_status("starting", f"Cancellation requested for batch {command.batch_id}.")

    def run(self) -> None:
        self._emit_status("ready", "Worker booted and ready.")
        for raw_line in self._input_stream:
            line = raw_line.strip()
            if not line:
                continue

            try:
                command = parse_worker_command(line)
            except Exception as error:
                self._emit_status("error", f"Invalid command: {error}")
                continue

            if isinstance(command, StartBatchCommand):
                self._start_batch(command)
                continue

            if isinstance(command, CancelBatchCommand):
                self._cancel_batch(command)


def run_worker(input_stream: TextIO = sys.stdin, output_stream: TextIO = sys.stdout) -> None:
    WorkerDaemon(input_stream=input_stream, output_stream=output_stream).run()
