# al-iyaal Worker

Persistent Python worker process used by the Tauri backend.

## Local development

```bash
uv sync --project python-worker --extra dev
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
uv run --project python-worker python worker.py
```
