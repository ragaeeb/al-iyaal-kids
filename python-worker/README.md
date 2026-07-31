# al-iyaal Worker

Persistent Python worker process used by the Tauri backend for:

- remove-music jobs via Demucs MLX through MLX and ffmpeg
- local subtitle generation
- subtitle moderation
- local frame scans that write `.frames.analysis.json` sidecars

## Local development

```bash
uv sync --project python-worker --extra dev
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

If you are running the worker directly or touching frame-scan/runtime code, install the runtime extras too:

```bash
uv sync --project python-worker --extra dev --extra runtime
PYTHONPATH=python-worker/src uv run --project python-worker --extra runtime python python-worker/worker.py
```

Demucs MLX is the separation engine. The one-time model conversion helper is
available through `uv sync --project python-worker --extra demucs-bootstrap`;
normal inference does not install the original Demucs package.

Notes:

- The desktop app's managed runtime installs the core worker stack on first run.
- The local frame-scan path can install missing vision packages such as `mlx-vlm` and `torchvision` on first use.
- The current local frame-scan POC requires Apple Silicon because it uses MLX-backed captioning.
