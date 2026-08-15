from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tempfile
import time
from typing import BinaryIO

AGENT_ENGINES = {"antigravity", "codex", "kiro_cli", "opencode"}
AGENT_TIMEOUT_SECONDS = 600
MAX_AGENT_OUTPUT_BYTES = 2_000_000
AGENT_CAPTURE_POLL_SECONDS = 0.02
PROCESS_TERMINATION_GRACE_SECONDS = 2.0
ANALYSIS_SUBTITLE_FILENAME = "subtitles.srt"
CODEX_AUTH_FILENAME = "auth.json"
ANSI_ESCAPE_PATTERN = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
OPENCODE_ANALYSIS_AGENT = "al-iyaal-analysis"
OPENCODE_ANALYSIS_CONFIG = json.dumps(
    {
        "agent": {
            OPENCODE_ANALYSIS_AGENT: {
                "description": "Read one subtitle file and return moderation JSON.",
                "mode": "primary",
                "permission": {
                    "*": "deny",
                    "read": {
                        "*": "deny",
                        f"*{ANALYSIS_SUBTITLE_FILENAME}": "allow",
                    },
                },
            }
        }
    },
    separators=(",", ":"),
)


@dataclass(slots=True)
class AgentCommand:
    arguments: list[str]
    output_path: Path | None = None
    environment: dict[str, str] = field(default_factory=dict)
    stdin: str | None = None


def _append_model_and_reasoning(
    arguments: list[str],
    model_flag: str,
    model: str,
    reasoning_flag: str,
    reasoning_level: str,
) -> None:
    if model:
        arguments.extend([model_flag, model])
    if reasoning_level:
        arguments.extend([reasoning_flag, reasoning_level])


def build_agent_command(
    engine: str,
    executable_path: str,
    model: str,
    reasoning_level: str,
    output_path: Path,
    prompt: str,
    codex_home: Path | None = None,
) -> AgentCommand:
    if engine == "codex":
        arguments = [
            executable_path,
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--ignore-user-config",
            "--ignore-rules",
        ]
        if model:
            arguments.extend(["--model", model])
        if reasoning_level:
            arguments.extend(
                ["--config", f'model_reasoning_effort="{reasoning_level}"']
            )
        arguments.extend(["--output-last-message", str(output_path), "-"])
        environment = {}
        if codex_home is not None:
            environment["CODEX_HOME"] = str(codex_home)
        return AgentCommand(
            arguments=arguments,
            environment=environment,
            output_path=output_path,
            stdin=prompt,
        )

    if engine == "kiro_cli":
        arguments = [
            executable_path,
            "chat",
            "--no-interactive",
            "--trust-tools=fs_read",
        ]
        _append_model_and_reasoning(
            arguments, "--model", model, "--effort", reasoning_level
        )
        return AgentCommand(arguments=arguments, stdin=prompt)

    if engine == "opencode":
        arguments = [
            executable_path,
            "run",
            "--pure",
            "--format",
            "json",
            "--agent",
            OPENCODE_ANALYSIS_AGENT,
            "--dir",
            str(output_path.parent),
        ]
        _append_model_and_reasoning(
            arguments, "--model", model, "--variant", reasoning_level
        )
        return AgentCommand(
            arguments=arguments,
            environment={
                "OPENCODE_CONFIG_CONTENT": OPENCODE_ANALYSIS_CONFIG,
                "OPENCODE_DB": ":memory:",
                "OPENCODE_DISABLE_AUTOUPDATE": "true",
                "OPENCODE_DISABLE_PRUNE": "true",
            },
            stdin=prompt,
        )

    if engine == "antigravity":
        arguments = [
            executable_path,
            "--sandbox",
            "--add-dir",
            str(output_path.parent),
        ]
        _append_model_and_reasoning(
            arguments, "--model", model, "--effort", reasoning_level
        )
        arguments.extend(["--print", prompt])
        return AgentCommand(arguments=arguments)

    raise ValueError(f"Unsupported analysis agent: {engine}")


def _strip_ansi(value: str) -> str:
    return ANSI_ESCAPE_PATTERN.sub("", value).strip()


def _as_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _merge_captured_output(
    previous: str | bytes | None, current: str | bytes | None
) -> str:
    previous_text = _as_text(previous)
    current_text = _as_text(current)
    if not previous_text:
        return current_text
    if not current_text:
        return previous_text
    if current_text.startswith(previous_text):
        return current_text
    if previous_text.endswith(current_text):
        return previous_text
    return previous_text + current_text


def _concise_process_output(*streams: str | bytes | None, limit: int = 600) -> str:
    compact = " ".join(
        " ".join(_strip_ansi(_as_text(stream)).split())
        for stream in streams
        if _as_text(stream).strip()
    )
    return compact[:limit]


def _extract_opencode_text(output: str) -> str:
    text_parts: list[str] = []
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or event.get("type") != "text":
            continue
        part = event.get("part")
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
    return "".join(text_parts).strip()


def _read_agent_output(
    engine: str, command: AgentCommand, completed: subprocess.CompletedProcess[str]
) -> str:
    if engine == "codex":
        if command.output_path is None or not command.output_path.exists():
            raise ValueError("Codex did not write its final response.")
        return command.output_path.read_text(encoding="utf-8").strip()
    if engine == "opencode":
        return _extract_opencode_text(completed.stdout)
    return _strip_ansi(completed.stdout)


def _process_creation_kwargs() -> dict[str, object]:
    if os.name == "posix":
        return {"start_new_session": True}
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return {"creationflags": creation_flags}
    return {}


def _signal_process_group(
    process: subprocess.Popen[str], signal_number: int, process_group_id: int | None = None
) -> None:
    if os.name == "posix":
        try:
            if process_group_id is None:
                process_group_id = os.getpgid(process.pid)
            os.killpg(process_group_id, signal_number)
        except (OSError, ProcessLookupError):
            return
        return

    if os.name == "nt":
        if signal_number == signal.SIGTERM and hasattr(signal, "CTRL_BREAK_EVENT"):
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
                return
            except (OSError, ProcessLookupError):
                pass
        try:
            process.kill()
        except (OSError, ProcessLookupError):
            pass
        return

    try:
        process.terminate() if signal_number == signal.SIGTERM else process.kill()
    except (OSError, ProcessLookupError):
        pass


def _terminate_and_reap(
    process: subprocess.Popen[str], process_group_id: int | None = None
) -> tuple[str, str]:
    _signal_process_group(process, signal.SIGTERM, process_group_id)
    stdout: str | bytes | None = None
    stderr: str | bytes | None = None
    try:
        stdout, stderr = process.communicate(
            timeout=PROCESS_TERMINATION_GRACE_SECONDS
        )
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout
        stderr = error.stderr

    # The group leader can exit before its descendants. Kill the captured group
    # after the grace period even when communicate() already returned.
    _signal_process_group(process, signal.SIGKILL, process_group_id)
    try:
        final_stdout, final_stderr = process.communicate()
    except subprocess.TimeoutExpired as error:
        final_stdout, final_stderr = error.stdout, error.stderr
    return (
        _merge_captured_output(stdout, final_stdout),
        _merge_captured_output(stderr, final_stderr),
    )


def _process_group_id(process: subprocess.Popen[str]) -> int | None:
    if os.name != "posix":
        return None
    # start_new_session=True makes the child its own process-group leader.
    return process.pid


def _capture_size(stream: BinaryIO) -> int:
    return os.fstat(stream.fileno()).st_size


def _read_capture(stream: BinaryIO, limit: int = MAX_AGENT_OUTPUT_BYTES) -> str:
    size = _capture_size(stream)
    start = max(0, size - limit)
    stream.seek(start)
    return _as_text(stream.read(min(size, limit)))


def _capture_over_limit(
    stdout: BinaryIO, stderr: BinaryIO, limit: int = MAX_AGENT_OUTPUT_BYTES
) -> str | None:
    if _capture_size(stdout) > limit:
        return "stdout"
    if _capture_size(stderr) > limit:
        return "stderr"
    return None


def _run_agent_process(
    engine: str,
    command: AgentCommand,
    working_directory: Path,
    environment: dict[str, str],
    timeout_seconds: int,
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryFile(mode="w+b") as stdout_capture, tempfile.TemporaryFile(
        mode="w+b"
    ) as stderr_capture:
        try:
            process = subprocess.Popen(
                command.arguments,
                stdin=subprocess.PIPE,
                stdout=stdout_capture,
                stderr=stderr_capture,
                text=True,
                cwd=working_directory,
                env=environment,
                **_process_creation_kwargs(),
            )
        except OSError as error:
            raise ValueError(f"Failed starting {engine}: {error}") from error

        process_group_id = _process_group_id(process)
        termination_requested = False
        try:
            stdin = process.stdin
            if stdin is not None:
                if command.stdin is not None:
                    stdin.write(command.stdin)
                stdin.close()
                process.stdin = None

            deadline = time.monotonic() + timeout_seconds
            while process.poll() is None:
                over_limit_stream = _capture_over_limit(stdout_capture, stderr_capture)
                if over_limit_stream is not None:
                    termination_requested = True
                    _terminate_and_reap(process, process_group_id)
                    details = _concise_process_output(
                        _read_capture(stderr_capture), _read_capture(stdout_capture)
                    )
                    suffix = f" Output: {details}" if details else ""
                    raise ValueError(
                        f"{engine} analysis {over_limit_stream} exceeded the "
                        f"{MAX_AGENT_OUTPUT_BYTES}-byte capture limit.{suffix}"
                    )
                if time.monotonic() >= deadline:
                    termination_requested = True
                    partial_stdout, partial_stderr = _terminate_and_reap(
                        process, process_group_id
                    )
                    stdout = _merge_captured_output(
                        _read_capture(stdout_capture), partial_stdout
                    )
                    stderr = _merge_captured_output(
                        _read_capture(stderr_capture), partial_stderr
                    )
                    details = _concise_process_output(stderr, stdout)
                    suffix = f" Output: {details}" if details else ""
                    raise ValueError(
                        f"{engine} analysis timed out after {timeout_seconds} seconds.{suffix}"
                    )
                time.sleep(AGENT_CAPTURE_POLL_SECONDS)

            returncode = process.wait()
            over_limit_stream = _capture_over_limit(stdout_capture, stderr_capture)
            if over_limit_stream is not None:
                details = _concise_process_output(
                    _read_capture(stderr_capture), _read_capture(stdout_capture)
                )
                suffix = f" Output: {details}" if details else ""
                raise ValueError(
                    f"{engine} analysis {over_limit_stream} exceeded the "
                    f"{MAX_AGENT_OUTPUT_BYTES}-byte capture limit.{suffix}"
                )

            return subprocess.CompletedProcess(
                command.arguments,
                returncode,
                _read_capture(stdout_capture),
                _read_capture(stderr_capture),
            )
        except BaseException:
            if not termination_requested and process.poll() is None:
                _terminate_and_reap(process, process_group_id)
            raise


def _codex_auth_source() -> Path:
    configured_home = os.environ.get("CODEX_HOME")
    if configured_home:
        return Path(configured_home) / CODEX_AUTH_FILENAME
    return Path.home() / ".codex" / CODEX_AUTH_FILENAME


def _prepare_isolated_codex_home(codex_home: Path) -> None:
    codex_home.mkdir(mode=0o700, parents=True, exist_ok=True)
    auth_source = _codex_auth_source()
    if not auth_source.is_file():
        return

    auth_target = codex_home / CODEX_AUTH_FILENAME
    try:
        auth_target.symlink_to(auth_source)
    except OSError as error:
        raise ValueError(
            "Could not isolate Codex authentication without copying credentials."
        ) from error


def run_analysis_agent(
    engine: str,
    executable_path: str,
    model: str,
    reasoning_level: str,
    prompt: str,
    subtitle_path: str | Path,
    timeout_seconds: int = AGENT_TIMEOUT_SECONDS,
) -> str:
    executable = Path(executable_path)
    if not executable.is_file():
        raise ValueError(f"{engine} executable is no longer available. Refresh Settings.")
    source_subtitle_path = Path(subtitle_path)
    if not source_subtitle_path.is_file():
        raise ValueError(f"Subtitle file is unavailable: {source_subtitle_path}")

    with ExitStack() as stack:
        working_directory = Path(
            stack.enter_context(tempfile.TemporaryDirectory(prefix="al-iyaal-analysis-"))
        )
        codex_home: Path | None = None
        if engine == "codex":
            codex_home = Path(
                stack.enter_context(tempfile.TemporaryDirectory(prefix="al-iyaal-codex-home-"))
            )
            _prepare_isolated_codex_home(codex_home)
        workspace_subtitle_path = working_directory / ANALYSIS_SUBTITLE_FILENAME
        try:
            shutil.copyfile(source_subtitle_path, workspace_subtitle_path)
        except OSError as error:
            raise ValueError(f"Could not prepare subtitle file: {error}") from error
        command = build_agent_command(
            engine,
            str(executable),
            model.strip(),
            reasoning_level.strip(),
            working_directory / "response.json",
            prompt,
            codex_home=codex_home,
        )
        process_environment = {
            **os.environ,
            "CLICOLOR": "0",
            "NO_COLOR": "1",
            "TERM": "dumb",
            **command.environment,
        }
        completed = _run_agent_process(
            engine,
            command,
            working_directory,
            process_environment,
            timeout_seconds,
        )

        if completed.returncode != 0:
            concise_error = _concise_process_output(completed.stderr, completed.stdout)
            raise ValueError(
                concise_error
                or f"{engine} exited with status {completed.returncode}."
            )

        output = _read_agent_output(engine, command, completed)
        if not output:
            raise ValueError(f"{engine} returned an empty response.")
        return output


__all__ = [
    "AGENT_ENGINES",
    "ANALYSIS_SUBTITLE_FILENAME",
    "AgentCommand",
    "build_agent_command",
    "run_analysis_agent",
]
