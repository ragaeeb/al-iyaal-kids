# al-Iyāl Kids Media Studio

[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/199cc087-82c9-444f-bc37-579e62ff5850.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/199cc087-82c9-444f-bc37-579e62ff5850)
[![codecov](https://codecov.io/gh/ragaeeb/al-iyaal-kids/graph/badge.svg?token=576PVJ0G9I)](https://codecov.io/gh/ragaeeb/al-iyaal-kids)
[![CI](https://img.shields.io/github/actions/workflow/status/ragaeeb/al-iyaal-kids/ci.yml?branch=main&label=ci)](https://github.com/ragaeeb/al-iyaal-kids/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/ragaeeb/al-iyaal-kids/release.yml?branch=main&label=release)](https://github.com/ragaeeb/al-iyaal-kids/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Privacy](https://img.shields.io/badge/privacy-local--first-success)](./PRIVACY.md)
[![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Bun](https://img.shields.io/badge/Bun-1.3.9-F9F1E1?logo=bun&logoColor=111111)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/Biome-2.4.1-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)

Tauri v2 desktop app (macOS-first) for Muslim families to process videos locally: remove music, generate subtitles, run profanity/content analysis, and export cleaned cuts.

## Current features

- `Remove Music` tab:
  - accepts folder input with `.mp4`/`.mov`
  - extracts vocals via Demucs (`--two-stems=vocals`)
  - remuxes vocals into video with ffmpeg
  - writes outputs to `audio_replaced/`
- `Transcribe` tab:
  - accepts one or more `.mp4`/`.mov` files, or a folder
  - generates subtitle sidecars (`.srt`) with local STT (`yap`)
- `Profanity Detection` tab:
  - accepts one or more `.srt` files, or a folder
  - runs local rules + profanity matching
  - writes sidecars (`.analysis.json`)
- `Cut Video` tab:
  - simple player-based cut flow (mark start/end, add ranges, export)
  - writes cleaned outputs to `video_cleaned/`
- Shared behavior:
  - sequential task processing
  - cancel policy: stop after current file
  - continue on per-file errors for batch jobs
  - originals preserved by default

## Tech stack

- Tauri v2 + Rust backend
- React + TypeScript (ESNext)
- Tailwind CSS v4 + shadcn-style components
- Bun for package management, scripts, and tests
- Biome for linting/formatting
- Python worker sidecar (Demucs + ffmpeg + yap + local moderation)

## Repository layout

- `src/` React UI, feature modules, transport, and tests
  - `src/features/batch/` remove-music domain logic
  - `src/features/media/` transcription/flag/cut task contracts + state
  - `src/features/editor/` subtitle/range/playback compatibility helpers
  - `src/features/moderation/` moderation validation/utilities
  - `src/components/` tab panels and shared UI components
- `src-tauri/` Rust Tauri app, commands, worker/runtime orchestration
- `python-worker/` Python daemon + media pipeline logic + pytest tests
- `scripts/` bootstrap/check/release/version-sync helper scripts
- `.github/workflows/` CI and semantic-release workflows
- `PRIVACY.md` privacy policy
- `AGENTS.md` AI contributor conventions

## Quickstart (local dev)

```bash
./scripts/bootstrap.sh
bun run tauri:dev
```

## Testing and quality checks

Run all project checks:

```bash
./scripts/check.sh
```

Run JS/TS checks only:

```bash
bun run typecheck
bun run lint
bun run test
```

Run a specific integration-style compatibility test (fixture + optional local file probe):

```bash
bun test src/features/editor/playback-compat.test.ts
```

Override sample file for local probe:

```bash
ALIYAAL_TEST_VIDEO_PATH="/absolute/path/to/video.mp4" bun test src/features/editor/playback-compat.test.ts
```

Run Rust tests only:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Run Python worker tests only:

```bash
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

## Logs and debugging

During `bun run tauri:dev`, logs come from multiple layers:

- Rust host logs: terminal where `tauri:dev` is running.
- Python worker stderr: forwarded by Rust into worker status events and visible in UI error/status messages.
- Worker event issues: emitted as status errors (`batch-event` channel) and surfaced in the queue panel.

If a batch appears stuck, keep the `tauri:dev` terminal open and watch for:

- runtime bootstrap failures
- worker process exit messages
- `worker stderr: ...` lines

For media preview issues:

- use `ffprobe` to inspect codecs/pixel format
- verify local path resolution and webview asset protocol access
- run `bun test src/features/editor/playback-compat.test.ts` for compatibility checks

## Runtime notes

- App bootstraps a local Python runtime under app data on first run.
- Runtime installs from `python-worker/requirements.lock.txt`.
- Optional env overrides:
- `AIYAAL_PYTHON_PATH` to force python executable
- `AIYAAL_BASE_PYTHON` for venv bootstrap base python
- `AIYAAL_FFMPEG_PATH` to force ffmpeg binary
- `AIYAAL_DEMUCS_PATH` to force demucs executable
- `AIYAAL_YAP_PATH` to force yap executable

## Release/versioning

- Semantic release runs from `.github/workflows/release.yml`.
- `package.json` is the source of truth for version.
- `bun run version:sync` updates:
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

## Links

- GitHub: https://github.com/ragaeeb/al-iyaal-kids
- Privacy policy: `PRIVACY.md`
