def parse_time_to_seconds(value: str) -> float:
    parts = value.strip().split(":")
    if not parts:
        raise ValueError("time value is empty")

    total = 0.0
    multiplier = 1.0
    for part in reversed(parts):
        total += float(part) * multiplier
        multiplier *= 60.0
    return total
