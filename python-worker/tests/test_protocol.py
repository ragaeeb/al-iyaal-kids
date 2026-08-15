import json

from al_iyaal_worker.models import StartFlagBatchCommand
from al_iyaal_worker.protocol import parse_worker_command
from al_iyaal_worker.tasks.events import emit_task_job_done
import pytest


def test_should_parse_runtime_agent_path_for_flag_jobs() -> None:
    command = parse_worker_command(
        json.dumps(
            {
                "agentExecutablePath": "/tools/codex",
                "inputPaths": ["/videos/episode.srt"],
                "settings": {
                    "agentModel": "gpt-test",
                    "agentReasoningLevel": "low",
                    "engine": "codex",
                },
                "taskId": "task-1",
                "type": "start_flag_batch",
            }
        )
    )

    assert isinstance(command, StartFlagBatchCommand)
    assert command.agent_executable_path == "/tools/codex"


def test_should_keep_agent_path_optional_for_cloud_flag_jobs() -> None:
    command = parse_worker_command(
        json.dumps(
            {
                "inputPaths": ["/videos/episode.srt"],
                "settings": {"engine": "gemini"},
                "taskId": "task-1",
                "type": "start_flag_batch",
            }
        )
    )

    assert isinstance(command, StartFlagBatchCommand)
    assert command.agent_executable_path is None


def test_should_emit_job_done_with_a_required_output_path() -> None:
    events: list[dict[str, object]] = []

    emit_task_job_done(
        events.append,
        "task-1",
        "transcription",
        "job-1",
        output_path="/videos/episode.srt",
    )

    assert events == [
        {
            "type": "job_done",
            "taskId": "task-1",
            "taskKind": "transcription",
            "jobId": "job-1",
            "outputPath": "/videos/episode.srt",
        }
    ]


def test_should_reject_job_done_without_a_non_empty_output_path() -> None:
    with pytest.raises(ValueError, match="non-empty output path"):
        emit_task_job_done(
            lambda _event: None,
            "task-1",
            "transcription",
            "job-1",
            output_path="   ",
        )
