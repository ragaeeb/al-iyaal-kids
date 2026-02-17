from collections.abc import Callable
from typing import Any


def emit_task_job_progress(
    emit: Callable[[dict[str, Any]], None],
    task_id: str,
    task_kind: str,
    job_id: str,
    progress_pct: int,
) -> None:
    emit(
        {
            "type": "job_progress",
            "taskId": task_id,
            "taskKind": task_kind,
            "jobId": job_id,
            "progressPct": max(0, min(100, int(progress_pct))),
        }
    )


def emit_task_job_done(
    emit: Callable[[dict[str, Any]], None],
    task_id: str,
    task_kind: str,
    job_id: str,
    output_path: str | None = None,
    artifacts: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "job_done",
        "taskId": task_id,
        "taskKind": task_kind,
        "jobId": job_id,
    }
    if output_path is not None:
        payload["outputPath"] = output_path
    if artifacts is not None:
        payload["artifacts"] = artifacts
    emit(payload)


def emit_task_job_error(
    emit: Callable[[dict[str, Any]], None],
    task_id: str,
    task_kind: str,
    job_id: str,
    error: str,
) -> None:
    emit(
        {
            "type": "job_error",
            "taskId": task_id,
            "taskKind": task_kind,
            "jobId": job_id,
            "error": error,
        }
    )


def emit_task_done(
    emit: Callable[[dict[str, Any]], None],
    task_id: str,
    task_kind: str,
    ok: int,
    failed: int,
    cancelled: int,
) -> None:
    emit(
        {
            "type": "task_done",
            "taskId": task_id,
            "taskKind": task_kind,
            "summary": {
                "ok": ok,
                "failed": failed,
                "cancelled": cancelled,
            },
        }
    )


def emit_job_log(
    emit: Callable[[dict[str, Any]], None],
    task_id: str,
    task_kind: str,
    job_id: str,
    message: str,
    stream: str = "stdout",
) -> None:
    emit(
        {
            "type": "job_log",
            "taskId": task_id,
            "taskKind": task_kind,
            "jobId": job_id,
            "message": message,
            "stream": stream,
        }
    )
