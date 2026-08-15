from pathlib import Path
import io
import json
import signal
import subprocess

import pytest
import al_iyaal_worker.moderation.agents as agents_module
from al_iyaal_worker.moderation.agents import (
    build_agent_command,
    run_analysis_agent,
)


class StubProcess:
    def __init__(
        self,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
        communicate_results: list[object] | None = None,
    ) -> None:
        self.pid = 4242
        self.returncode = returncode
        self.stdin = io.StringIO()
        self.stdout = stdout
        self.stderr = stderr
        self.communicate_results = communicate_results or []
        self.communicate_calls: list[tuple[object, object]] = []

    def communicate(self, input=None, timeout=None):
        if self.stdin is not None and self.stdin.closed:
            raise ValueError("communicate attempted to flush closed stdin")
        self.communicate_calls.append((input, timeout))
        if self.communicate_results:
            result = self.communicate_results.pop(0)
            if isinstance(result, BaseException):
                raise result
            return result
        return self.stdout, self.stderr

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def send_signal(self, _signal: int) -> None:
        return None

    def kill(self) -> None:
        self.returncode = -signal.SIGKILL


def _write_capture(kwargs: dict[str, object], stream_name: str, value: str) -> None:
    stream = kwargs[stream_name]
    assert isinstance(stream, io.BufferedIOBase)
    stream.write(value.encode("utf-8"))
    stream.flush()


def test_should_build_a_read_only_ephemeral_codex_command(tmp_path: Path) -> None:
    command = build_agent_command(
        "codex",
        "/tools/codex",
        "gpt-test",
        "low",
        tmp_path / "response.json",
        "prompt",
    )

    assert command.arguments[0:2] == ["/tools/codex", "exec"]
    assert ["--sandbox", "read-only"] == command.arguments[4:6]
    assert "--ephemeral" in command.arguments
    assert "--ignore-user-config" in command.arguments
    assert "--ignore-rules" in command.arguments
    assert 'model_reasoning_effort="low"' in command.arguments
    assert command.arguments[-1] == "-"
    assert command.stdin == "prompt"


def test_should_build_a_noninteractive_kiro_command(tmp_path: Path) -> None:
    command = build_agent_command(
        "kiro_cli",
        "/tools/kiro-cli",
        "auto",
        "low",
        tmp_path / "unused",
        "prompt",
    )

    assert command.arguments == [
        "/tools/kiro-cli",
        "chat",
        "--no-interactive",
        "--trust-tools=fs_read",
        "--model",
        "auto",
        "--effort",
        "low",
    ]
    assert command.stdin == "prompt"


def test_should_build_an_opencode_variant_command(tmp_path: Path) -> None:
    command = build_agent_command(
        "opencode",
        "/tools/opencode",
        "opencode/test",
        "high",
        tmp_path / "unused",
        "prompt",
    )

    assert command.arguments[-4:] == [
        "--model",
        "opencode/test",
        "--variant",
        "high",
    ]
    assert "--pure" in command.arguments
    assert command.arguments[command.arguments.index("--agent") + 1] == (
        "al-iyaal-analysis"
    )
    assert command.arguments[command.arguments.index("--dir") + 1] == str(tmp_path)
    assert command.arguments[command.arguments.index("--format") + 1] == "json"
    assert command.environment["OPENCODE_DB"] == ":memory:"
    config = json.loads(command.environment["OPENCODE_CONFIG_CONTENT"])
    permissions = config["agent"]["al-iyaal-analysis"]["permission"]
    assert permissions["*"] == "deny"
    assert permissions["read"]["*subtitles.srt"] == "allow"
    assert command.stdin == "prompt"


def test_should_build_an_antigravity_print_command(tmp_path: Path) -> None:
    command = build_agent_command(
        "antigravity",
        "/tools/agy",
        "gemini-flash",
        "low",
        tmp_path / "unused",
        "prompt",
    )

    assert command.arguments[0:4] == [
        "/tools/agy",
        "--sandbox",
        "--add-dir",
        str(tmp_path),
    ]
    assert command.arguments[-2:] == ["--print", "prompt"]
    assert command.stdin is None


def test_should_extract_kiro_output_without_terminal_control_codes(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "kiro-cli"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")

    def fake_popen(*_args, **kwargs) -> StubProcess:
        workspace_subtitle = Path(kwargs["cwd"]) / "subtitles.srt"
        assert workspace_subtitle.read_text(encoding="utf-8") == "subtitle text"
        _write_capture(kwargs, "stdout", '\x1b[0m> {"flagged":[],"summary":"safe"}\x1b[0m')
        return StubProcess(
            stdout="unused",
        )

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    output = run_analysis_agent(
        "kiro_cli", str(executable), "auto", "low", "prompt", subtitle_path
    )

    assert output == '> {"flagged":[],"summary":"safe"}'


def test_should_extract_text_events_from_opencode(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "opencode"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")

    def fake_popen(*_args, **kwargs) -> StubProcess:
        assert kwargs["env"]["OPENCODE_DB"] == ":memory:"
        assert kwargs["env"]["OPENCODE_DISABLE_AUTOUPDATE"] == "true"
        _write_capture(
            kwargs,
            "stdout",
            "\n".join(
                [
                    json.dumps({"type": "step_start"}),
                    json.dumps(
                        {
                            "type": "text",
                            "part": {"text": '{"flagged":[],"summary":"safe"}'},
                        }
                    ),
                ]
            ),
        )
        return StubProcess(
            stdout="unused",
        )

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    output = run_analysis_agent(
        "opencode",
        str(executable),
        "opencode/test",
        "low",
        "prompt",
        subtitle_path,
    )

    assert output == '{"flagged":[],"summary":"safe"}'


def test_should_isolate_codex_home_without_copying_authentication(
    tmp_path: Path, monkeypatch
) -> None:
    source_codex_home = tmp_path / "source-codex-home"
    source_codex_home.mkdir()
    auth_source = source_codex_home / "auth.json"
    auth_source.write_text('{"token":"secret"}', encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(source_codex_home))
    executable = tmp_path / "codex"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")

    def fake_popen(*_args, **kwargs) -> StubProcess:
        isolated_home = Path(kwargs["env"]["CODEX_HOME"])
        isolated_auth = isolated_home / "auth.json"
        assert isolated_home != source_codex_home
        assert isolated_auth.is_symlink()
        assert isolated_auth.resolve() == auth_source
        response_path = Path(kwargs["cwd"]) / "response.json"
        response_path.write_text('{"flagged":[],"summary":"safe"}', encoding="utf-8")
        return StubProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    output = run_analysis_agent(
        "codex", str(executable), "gpt-test", "low", "prompt", subtitle_path
    )

    assert output == '{"flagged":[],"summary":"safe"}'


def test_should_fail_when_the_agent_process_cannot_start(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")

    def fake_popen(*_args, **_kwargs):
        raise OSError("permission denied")

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(ValueError, match="Failed starting kiro_cli: permission denied"):
        run_analysis_agent(
            "kiro_cli", str(executable), "auto", "low", "prompt", subtitle_path
        )


def test_should_fail_when_the_agent_exits_nonzero(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    def fake_popen(*_args, **kwargs) -> StubProcess:
        _write_capture(kwargs, "stderr", "agent failed with details")
        return StubProcess(returncode=7)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(ValueError, match="agent failed with details"):
        run_analysis_agent(
            "kiro_cli", str(executable), "auto", "low", "prompt", subtitle_path
        )


def test_should_fail_when_the_agent_returns_empty_output(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    monkeypatch.setattr(subprocess, "Popen", lambda *_args, **_kwargs: StubProcess())

    with pytest.raises(ValueError, match="returned an empty response"):
        run_analysis_agent(
            "kiro_cli", str(executable), "auto", "low", "prompt", subtitle_path
        )


def test_should_fail_when_the_executable_is_missing(tmp_path: Path) -> None:
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")

    with pytest.raises(ValueError, match="executable is no longer available"):
        run_analysis_agent(
            "kiro_cli", str(tmp_path / "missing-agent"), "auto", "low", "prompt", subtitle_path
        )


def test_should_fail_when_the_subtitle_is_missing(tmp_path: Path) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")

    with pytest.raises(ValueError, match="Subtitle file is unavailable"):
        run_analysis_agent(
            "kiro_cli", str(executable), "auto", "low", "prompt", tmp_path / "missing.srt"
        )


def test_should_reap_the_full_process_group_after_timeout(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    process = StubProcess(
        returncode=None,
        communicate_results=[
            subprocess.TimeoutExpired("agent", 2.0, output="partial", stderr="detail"),
            ("remaining output", "remaining error"),
        ]
    )
    captured_kwargs: dict[str, object] = {}
    kill_calls: list[tuple[int, int]] = []

    def fake_popen(*_args, **kwargs) -> StubProcess:
        captured_kwargs.update(kwargs)
        return process

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(agents_module.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(
        agents_module.os,
        "killpg",
        lambda pid, signal_number: kill_calls.append((pid, signal_number)),
    )

    with pytest.raises(ValueError, match="timed out.*partial.*remaining"):
        run_analysis_agent(
            "kiro_cli",
            str(executable),
            "auto",
            "low",
            "prompt",
            subtitle_path,
            timeout_seconds=0,
        )

    assert captured_kwargs["start_new_session"] is True
    assert kill_calls == [(4242, signal.SIGTERM), (4242, signal.SIGKILL)]
    assert len(process.communicate_calls) == 2


def test_should_kill_the_process_group_even_when_the_parent_exits_during_grace(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    process = StubProcess(
        returncode=None,
        communicate_results=[("parent output", ""), ("descendant output", "")],
    )
    kill_calls: list[tuple[int, int]] = []

    def fake_popen(*_args, **_kwargs) -> StubProcess:
        return process

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(agents_module.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(
        agents_module.os,
        "killpg",
        lambda pid, signal_number: kill_calls.append((pid, signal_number)),
    )

    with pytest.raises(ValueError, match="timed out"):
        run_analysis_agent(
            "kiro_cli",
            str(executable),
            "auto",
            "low",
            "prompt",
            subtitle_path,
            timeout_seconds=0,
        )

    assert kill_calls == [(4242, signal.SIGTERM), (4242, signal.SIGKILL)]


def test_should_terminate_a_noisy_agent_when_capture_limit_is_reached(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "agent"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    process = StubProcess(returncode=None, communicate_results=[("", "")])
    kill_calls: list[tuple[int, int]] = []

    def fake_popen(*_args, **kwargs) -> StubProcess:
        _write_capture(
            kwargs,
            "stdout",
            "x" * (agents_module.MAX_AGENT_OUTPUT_BYTES + 1),
        )
        return process

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(agents_module.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(
        agents_module.os,
        "killpg",
        lambda pid, signal_number: kill_calls.append((pid, signal_number)),
    )

    with pytest.raises(ValueError, match="stdout exceeded .* capture limit"):
        run_analysis_agent(
            "kiro_cli",
            str(executable),
            "auto",
            "low",
            "prompt",
            subtitle_path,
        )

    assert kill_calls == [(4242, signal.SIGTERM), (4242, signal.SIGKILL)]


def test_should_fail_when_codex_does_not_write_its_output_file(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "codex"
    executable.write_text("stub", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("subtitle text", encoding="utf-8")
    monkeypatch.setattr(subprocess, "Popen", lambda *_args, **_kwargs: StubProcess())

    with pytest.raises(ValueError, match="Codex did not write its final response"):
        run_analysis_agent(
            "codex", str(executable), "gpt-test", "low", "prompt", subtitle_path
        )
