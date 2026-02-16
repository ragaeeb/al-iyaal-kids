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

Tauri v2 desktop app (macOS-first) for Muslim families to remove music from videos locally using Demucs and ffmpeg.

## What it does (MVP)

- Accepts folders with `.mp4` and `.mov`.
- Runs sequential batch processing.
- Extracts vocals stem via Demucs (`--two-stems=vocals`).
- Replaces video audio with vocals-only output using ffmpeg.
- Writes outputs to `audio_replaced/` inside the selected folder.
- Continues on per-file errors.
- Cancel policy: stop after current file.
- Keeps originals by default.

## Tech stack

- Tauri v2 + Rust backend
- React + TypeScript (ESNext)
- Tailwind CSS v4 + shadcn-style components
- Bun for package management, scripts, and tests
- Biome for linting/formatting
- Python worker sidecar (Demucs + ffmpeg)

## Repository layout

- `src/` React UI, state, transport, and test files
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

## Runtime notes

- App bootstraps a local Python runtime under app data on first run.
- Runtime installs from `python-worker/requirements.lock.txt`.
- Optional env overrides:
- `AIYAAL_PYTHON_PATH` to force python executable
- `AIYAAL_BASE_PYTHON` for venv bootstrap base python
- `AIYAAL_FFMPEG_PATH` to force ffmpeg binary
- `AIYAAL_DEMUCS_PATH` to force demucs executable

## Release/versioning

- Semantic release runs from `.github/workflows/release.yml`.
- `package.json` is the source of truth for version.
- `bun run version:sync` updates:
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

## Links

- GitHub: https://github.com/ragaeeb/al-iyaal-kids
- Privacy policy: `PRIVACY.md`
