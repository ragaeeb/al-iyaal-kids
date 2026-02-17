from al_iyaal_worker.tasks.transcribe import parse_yap_progress_line


def test_should_parse_yap_progress_line() -> None:
    progress = parse_yap_progress_line("⠹ [  3%] Touch struggles, finding a box of rainbow.")
    assert progress == (3, "Touch struggles, finding a box of rainbow.")


def test_should_map_success_line_to_100_percent() -> None:
    progress = parse_yap_progress_line("✔ Success")
    assert progress == (100, "Transcription complete")


def test_should_return_none_for_non_progress_line() -> None:
    progress = parse_yap_progress_line("random log line")
    assert progress is None
