def map_process_failure(name: str, return_code: int, stderr: str) -> str:
    stderr = stderr.strip()
    if not stderr:
        return f"{name} failed with exit code {return_code}."
    return f"{name} failed with exit code {return_code}: {stderr}"
