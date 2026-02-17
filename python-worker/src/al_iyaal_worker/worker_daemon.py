import sys
import threading
from dataclasses import dataclass
from typing import TextIO

from .models import (
    CancelBatchCommand,
    CancelTaskCommand,
    StartBatchCommand,
    StartCutJobCommand,
    StartFlagBatchCommand,
    StartTranscriptionBatchCommand,
)
from .protocol import emit_event, emit_worker_status, parse_worker_command
from .tasks import (
    process_cut_job,
    process_flag_batch,
    process_remove_music_batch,
    process_transcription_batch,
)


@dataclass(slots=True)
class WorkerContext:
    output_stream: TextIO
    output_lock: threading.Lock


class WorkerDaemon:
    def __init__(self, input_stream: TextIO, output_stream: TextIO):
        self._input_stream = input_stream
        self._context = WorkerContext(output_stream=output_stream, output_lock=threading.Lock())
        self._active_operation_lock = threading.Lock()
        self._active_operation_id: str | None = None
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

    def _reserve_operation(self, operation_id: str, conflict_summary: dict[str, int]) -> bool:
        with self._active_operation_lock:
            if self._active_operation_id is not None:
                self._emit_status(
                    "error",
                    "An operation is already running. Wait for completion before starting another task.",
                )
                self._emit(conflict_summary)
                return False

            self._active_operation_id = operation_id
            self._cancel_events[operation_id] = threading.Event()
            return True

    def _release_operation(self, operation_id: str) -> None:
        with self._active_operation_lock:
            self._active_operation_id = None
            self._cancel_events.pop(operation_id, None)

    def _start_batch(self, command: StartBatchCommand) -> None:
        if not self._reserve_operation(
            operation_id=command.batch_id,
            conflict_summary={
                "type": "batch_done",
                "batchId": command.batch_id,
                "summary": {"ok": 0, "failed": 0, "cancelled": len(command.input_paths)},
            },
        ):
            return
        self._emit_status("starting", f"Running batch {command.batch_id}.")

        thread = threading.Thread(
            target=self._run_batch,
            args=(command,),
            daemon=True,
            name=f"batch-{command.batch_id}",
        )
        thread.start()

    def _start_transcription_batch(self, command: StartTranscriptionBatchCommand) -> None:
        if not self._reserve_operation(
            operation_id=command.task_id,
            conflict_summary={
                "type": "task_done",
                "taskId": command.task_id,
                "taskKind": "transcription",
                "summary": {"ok": 0, "failed": 0, "cancelled": len(command.input_paths)},
            },
        ):
            return

        self._emit_status("starting", f"Running transcription task {command.task_id}.")
        thread = threading.Thread(
            target=self._run_transcription_batch,
            args=(command,),
            daemon=True,
            name=f"transcription-{command.task_id}",
        )
        thread.start()

    def _start_flag_batch(self, command: StartFlagBatchCommand) -> None:
        if not self._reserve_operation(
            operation_id=command.task_id,
            conflict_summary={
                "type": "task_done",
                "taskId": command.task_id,
                "taskKind": "flag",
                "summary": {"ok": 0, "failed": 0, "cancelled": len(command.input_paths)},
            },
        ):
            return

        self._emit_status("starting", f"Running flag task {command.task_id}.")
        thread = threading.Thread(
            target=self._run_flag_batch,
            args=(command,),
            daemon=True,
            name=f"flag-{command.task_id}",
        )
        thread.start()

    def _start_cut_job(self, command: StartCutJobCommand) -> None:
        if not self._reserve_operation(
            operation_id=command.task_id,
            conflict_summary={
                "type": "task_done",
                "taskId": command.task_id,
                "taskKind": "cut",
                "summary": {"ok": 0, "failed": 0, "cancelled": 1},
            },
        ):
            return

        self._emit_status("starting", f"Running cut task {command.task_id}.")
        thread = threading.Thread(
            target=self._run_cut_job,
            args=(command,),
            daemon=True,
            name=f"cut-{command.task_id}",
        )
        thread.start()

    def _run_batch(self, command: StartBatchCommand) -> None:
        cancel_event = self._cancel_events[command.batch_id]

        try:
            process_remove_music_batch(
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
            self._release_operation(command.batch_id)
            self._emit_status("ready", "Worker ready for next batch.")

    def _run_transcription_batch(self, command: StartTranscriptionBatchCommand) -> None:
        cancel_event = self._cancel_events[command.task_id]
        try:
            process_transcription_batch(
                command=command,
                emit=self._emit,
                should_cancel=cancel_event.is_set,
            )
        except Exception as error:
            self._emit(
                {
                    "type": "task_done",
                    "taskId": command.task_id,
                    "taskKind": "transcription",
                    "summary": {"ok": 0, "failed": 1, "cancelled": 0},
                }
            )
            self._emit_status("error", f"Unhandled worker failure: {error}")
        finally:
            self._release_operation(command.task_id)
            self._emit_status("ready", "Worker ready for next batch.")

    def _run_flag_batch(self, command: StartFlagBatchCommand) -> None:
        cancel_event = self._cancel_events[command.task_id]
        try:
            process_flag_batch(
                command=command,
                emit=self._emit,
                should_cancel=cancel_event.is_set,
            )
        except Exception as error:
            self._emit(
                {
                    "type": "task_done",
                    "taskId": command.task_id,
                    "taskKind": "flag",
                    "summary": {"ok": 0, "failed": 1, "cancelled": 0},
                }
            )
            self._emit_status("error", f"Unhandled worker failure: {error}")
        finally:
            self._release_operation(command.task_id)
            self._emit_status("ready", "Worker ready for next batch.")

    def _run_cut_job(self, command: StartCutJobCommand) -> None:
        cancel_event = self._cancel_events[command.task_id]
        try:
            process_cut_job(
                command=command,
                emit=self._emit,
                should_cancel=cancel_event.is_set,
            )
        except Exception as error:
            self._emit(
                {
                    "type": "task_done",
                    "taskId": command.task_id,
                    "taskKind": "cut",
                    "summary": {"ok": 0, "failed": 1, "cancelled": 0},
                }
            )
            self._emit_status("error", f"Unhandled worker failure: {error}")
        finally:
            self._release_operation(command.task_id)
            self._emit_status("ready", "Worker ready for next batch.")

    def _cancel_batch(self, command: CancelBatchCommand) -> None:
        with self._active_operation_lock:
            cancel_event = self._cancel_events.get(command.batch_id)

        if cancel_event is None:
            self._emit_status("error", f"No active batch found for cancel request: {command.batch_id}.")
            return

        cancel_event.set()
        self._emit_status("starting", f"Cancellation requested for batch {command.batch_id}.")

    def _cancel_task(self, command: CancelTaskCommand) -> None:
        with self._active_operation_lock:
            cancel_event = self._cancel_events.get(command.task_id)

        if cancel_event is None:
            self._emit_status("error", f"No active task found for cancel request: {command.task_id}.")
            return

        cancel_event.set()
        self._emit_status("starting", f"Cancellation requested for task {command.task_id}.")

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

            if isinstance(command, StartTranscriptionBatchCommand):
                self._start_transcription_batch(command)
                continue

            if isinstance(command, StartFlagBatchCommand):
                self._start_flag_batch(command)
                continue

            if isinstance(command, StartCutJobCommand):
                self._start_cut_job(command)
                continue

            if isinstance(command, CancelBatchCommand):
                self._cancel_batch(command)
                continue

            if isinstance(command, CancelTaskCommand):
                self._cancel_task(command)


def run_worker(input_stream: TextIO = sys.stdin, output_stream: TextIO = sys.stdout) -> None:
    WorkerDaemon(input_stream=input_stream, output_stream=output_stream).run()
