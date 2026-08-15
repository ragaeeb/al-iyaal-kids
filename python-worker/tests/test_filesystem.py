from pathlib import Path

from al_iyaal_worker.filesystem import discover_input_paths, normalize_extension, to_job_id


def test_should_normalize_extensions_with_dot_prefix() -> None:
    assert normalize_extension("mov") == ".mov"
    assert normalize_extension(".MP4") == ".mp4"


def test_should_build_stable_job_ids() -> None:
    assert (
        to_job_id("/tmp/My Clip 01.mov")
        == "tmp-my-clip-01-mov-67c00333ba0ddded529abdc463341963"
    )


def test_should_keep_separator_variants_distinct() -> None:
    hyphenated = to_job_id("/tmp/a-b.mp4")
    underscored = to_job_id("/tmp/a_b.mp4")

    assert hyphenated == "tmp-a-b-mp4-eaed9543b571fc817e9dcf8c9b8e1bc5"
    assert underscored == "tmp-a-b-mp4-05bb79b9b571fc817d10c731641c878b"
    assert hyphenated != underscored


def test_should_match_the_unicode_punctuation_fixture() -> None:
    assert (
        to_job_id(
            "/Users/rhaq/Movies/al_iyaal/audio_replaced/Rothschild’s Giraffe - Leo The Wildlife Ranger Minisode #155.srt"
        )
        == "users-rhaq-movies-al-iyaal-audio-replaced-rothsc-f753e9abda221288d4cdc252c91813d9"
    )


def test_should_add_a_digest_when_the_path_has_no_readable_characters() -> None:
    assert to_job_id("///---___") == "job-d2baa8fb31043c92e01567e8ca80c0e4"


def test_should_discover_only_allowed_video_files(tmp_path: Path) -> None:
    (tmp_path / "a.mov").write_text("test")
    (tmp_path / "b.mp4").write_text("test")
    (tmp_path / "ignore.mkv").write_text("test")

    paths = discover_input_paths(tmp_path, [".mov", ".mp4"])

    assert [path.name for path in paths] == ["a.mov", "b.mp4"]
