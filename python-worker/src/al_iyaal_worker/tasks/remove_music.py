from collections.abc import Callable
import subprocess

from ..models import StartBatchCommand
from ..processor import process_batch, run_command

EmitEvent = Callable[[dict[str, object]], None]
ShouldCancel = Callable[[], bool]
RunCommand = Callable[[list[str]], subprocess.CompletedProcess[str]]


def process_remove_music_batch(
    command: StartBatchCommand,
    emit: EmitEvent,
    should_cancel: ShouldCancel,
    command_runner: RunCommand | None = None,
) -> None:
    process_batch(
        command=command,
        emit=emit,
        should_cancel=should_cancel,
        command_runner=command_runner or run_command,
    )
