from dataclasses import dataclass


@dataclass(slots=True)
class StartBatchCommand:
    batch_id: str
    input_paths: list[str]
    output_dir: str
    compute_mode: str


@dataclass(slots=True)
class CancelBatchCommand:
    batch_id: str
    mode: str


WorkerCommand = StartBatchCommand | CancelBatchCommand
