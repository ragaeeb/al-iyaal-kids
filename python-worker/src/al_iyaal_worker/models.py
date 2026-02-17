from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class StartBatchCommand:
    batch_id: str
    input_paths: list[str]
    output_dir: str
    compute_mode: str


@dataclass(slots=True)
class StartTranscriptionBatchCommand:
    task_id: str
    input_paths: list[str]
    yap_mode: str


@dataclass(slots=True)
class StartFlagBatchCommand:
    task_id: str
    input_paths: list[str]
    settings: dict[str, Any]


@dataclass(slots=True)
class CutRange:
    start: str
    end: str


@dataclass(slots=True)
class StartCutJobCommand:
    task_id: str
    video_path: str
    ranges: list[CutRange]
    output_mode: str


@dataclass(slots=True)
class CancelBatchCommand:
    batch_id: str
    mode: str


@dataclass(slots=True)
class CancelTaskCommand:
    task_id: str
    mode: str


WorkerCommand = (
    StartBatchCommand
    | StartTranscriptionBatchCommand
    | StartFlagBatchCommand
    | StartCutJobCommand
    | CancelBatchCommand
    | CancelTaskCommand
)
