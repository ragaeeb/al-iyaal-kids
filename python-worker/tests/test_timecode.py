import pytest

from al_iyaal_worker.timecode import parse_time_to_seconds


def test_should_parse_seconds_and_clock_values() -> None:
    assert parse_time_to_seconds("1.25") == 1.25
    assert parse_time_to_seconds("02:03") == 123
    assert parse_time_to_seconds("01:02:03.5") == 3723.5
    assert parse_time_to_seconds("00:46:31,186") == 2791.186


@pytest.mark.parametrize("value", ["", "1:99", "1:2:3:4", "nan", "inf", "-1"])
def test_should_reject_invalid_or_non_finite_times(value: str) -> None:
    with pytest.raises(ValueError):
        parse_time_to_seconds(value)
