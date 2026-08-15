import math


def parse_time_to_seconds(value: str) -> float:
    parts = value.strip().replace(",", ".").split(":")
    if not 1 <= len(parts) <= 3 or any(not part for part in parts):
        raise ValueError("time value is empty")

    values = [float(part) for part in parts]
    if any(not math.isfinite(part) for part in values):
        raise ValueError("time value must be finite")
    if values[0] < 0 or any(part < 0 or part >= 60 for part in values[1:]):
        raise ValueError("time value contains an invalid component")

    total = 0.0
    multiplier = 1.0
    for part in reversed(values):
        total += part * multiplier
        multiplier *= 60.0
    return total
