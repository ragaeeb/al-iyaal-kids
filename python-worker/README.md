# al-iyaal Worker

Persistent Python worker process used by the Tauri backend for:

- remove-music jobs via Demucs MLX through MLX and ffmpeg
- local subtitle generation
- subtitle moderation
- local CLI agent invocation for subtitle moderation

## Local development

```bash
uv sync --project python-worker --extra dev
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

If you are running the worker directly or touching runtime code, install the runtime extras too:

```bash
uv sync --project python-worker --extra dev --extra runtime
PYTHONPATH=python-worker/src uv run --project python-worker --extra runtime python python-worker/worker.py
```

Demucs MLX is the separation engine. The one-time model conversion helper is
available through `uv sync --project python-worker --extra demucs-bootstrap`;
normal inference does not install the original Demucs package.

Notes:

- The desktop app's managed runtime installs the core worker stack on first run.
- Local CLI agents are discovered and selected by the desktop Settings page; the worker receives the selected executable path and provider configuration.
- Local-agent analysis copies one subtitle input to a temporary workspace as `subtitles.srt`, references that file in the agent prompt, and removes the workspace after the job finishes.
