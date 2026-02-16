from al_iyaal_worker.errors import map_process_failure


def test_should_map_process_failure_with_stderr() -> None:
    result = map_process_failure("ffmpeg", 1, "bad stream")
    assert result == "ffmpeg failed with exit code 1: bad stream"


def test_should_map_process_failure_without_stderr() -> None:
    result = map_process_failure("demucs", 2, "")
    assert result == "demucs failed with exit code 2."
