# AGENTS.md

Guidance for AI/code agents working in this repository.

## Project context

`al-Iyāl Kids Media Studio` is a Tauri v2 desktop app (macOS-first) with four user workflows:

- Remove Music (Demucs vocals remux)
- Speech-to-Text (SRT generation)
- Profanity/aqeedah analysis (analysis JSON from SRT)
- Simple Video Cut export

The app is local-first and privacy-first. Do not introduce telemetry by default.

## Core standards

- TypeScript-first for frontend/tooling code.
- Target ESNext.
- Prefer `type` over `interface`.
- Prefer arrow functions over classical `function` declarations.
- Decompose logic into utility functions; avoid high cognitive complexity functions.
- Keep code explicit and testable.

## Testing conventions

- JS/TS tests use `bun:test`.
- Test names should follow `it('should ...')`.
- DOM/component rendering tests are out of MVP scope unless explicitly requested.
- Prioritize tests for:
- reducers/state transitions
- request/response payload builders
- protocol mapping/parsing
- error handling and edge cases
- compatibility helpers (e.g. playback compatibility with ffprobe fixture shell)

## Rust conventions

- Keep command handlers thin; place validation/logic into testable helpers.
- Add unit tests for protocol parsing, queue state transitions, and command validation behavior.
- Avoid introducing platform-coupled behavior without guard rails/tests.

## Python worker conventions

- Keep command construction and filesystem behavior deterministic.
- Prefer pure helper functions for command/path logic.
- Keep worker output JSONL schema stable.
- Add pytest coverage for demucs/ffmpeg command construction and error mapping.
- Flagging supports both:
  - video inputs (uses `<video>.srt` sidecar)
  - direct `.srt` inputs (writes sibling `.analysis.json`)

## Tooling

- Package manager/runtime: Bun.
- Lint/format: Biome (`bun run lint`, `bun run format`).
- Full checks: `./scripts/check.sh`.

## Frequent commands

```bash
./scripts/bootstrap.sh
bun run tauri:dev
bun run check
cargo test --manifest-path src-tauri/Cargo.toml
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

## Logging and debugging

When debugging failures/stalls:

- Keep `bun run tauri:dev` terminal open.
- Inspect Rust worker lifecycle logs and worker stderr forwarding.
- Verify UI worker status messages and queue events.
- Confirm runtime paths:
- Python venv under app data runtime dir
- ffmpeg/demucs/yap resolution via env overrides when needed
- For playback issues, check:
  - `ffprobe` output
  - asset protocol path handling (`convertFileSrc` flow)
  - `src/features/editor/playback-compat.test.ts`

## Repository map

- `src/` React app, feature domain logic, tests.
- `src/features/batch/`: remove-music state/transport/tests.
- `src/features/media/`: transcription/flag/cut task contracts + reducer + transport.
- `src/features/editor/`: subtitle parsing, range building, playback compatibility, fixtures.
- `src/features/moderation/`: moderation settings validation/utilities.
- `src/components/`:
  - `remove-music-panel.tsx`
  - `transcribe-panel.tsx`
  - `profanity-panel.tsx`
  - `simple-cut-editor-panel.tsx`
- `src-tauri/` Rust backend, Tauri commands, runtime bootstrap, worker orchestration.
- `python-worker/` Python daemon and media-processing pipeline.
- `scripts/` bootstrap/check/release/version sync helpers.
- `.github/workflows/` CI and semantic-release pipelines.

## Release/versioning

- Semantic release is configured via `release.config.mjs`.
- `package.json` is version source of truth.
- `bun run version:sync` must keep:
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
in sync.

## Do not

- Do not add destructive git commands.
- Do not silently change user-facing behavior without tests.
- Do not bypass lint/typecheck/test gates.
