
def resolve_compute_device(compute_mode: str) -> str:
    if compute_mode == "cpu":
        return "cpu"

    if compute_mode == "mps":
        return "mps"

    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
    except Exception:
        return "cpu"

    return "cpu"
