# AGENTS.md

Guidance for AI/code agents working in this repository.

## Project context

`al-Iyaal Kids` is a Tauri v2 desktop app (macOS-first) with these user-facing sections in a compact desktop sidebar shell:

- Dashboard
- Remove Music
- Edit Video
- Settings

The app is local-first and privacy-first. Do not introduce telemetry by default.
Do not describe the app as fully offline: subtitle moderation can use opt-in cloud providers or installed local CLI agents when the user selects them.

## Core standards

- TypeScript-first for frontend and tooling code.
- Target ESNext.
- Prefer `type` over `interface`.
- Prefer arrow functions over classical `function` declarations.
- Decompose logic into utility functions; avoid high cognitive complexity functions.
- Keep code explicit, testable, and deterministic.
- Desktop-first only for this phase. Do not spend time on mobile responsiveness unless explicitly requested.

## UI standards

- The app uses a page-based desktop shell with a fixed left sidebar, not top tabs.
- Use fab-ui via shadcn registries where practical for visible UI primitives.
- Base UI portal-based components require root isolation; preserve `.root { isolation: isolate; }` behavior.
- Keep branding aligned to the existing logo palette.
- Prefer composing workflow-specific UI in `src/components/` and shell/layout concerns in `src/components/layout/`.
- The current design direction is compact. Prefer drawers over permanently visible side panels when possible.

## Workflow behavior

- Remove Music
  - folder-based `.mp4` / `.mov` processing
  - Demucs MLX vocals extraction + ffmpeg remux
  - outputs to `audio_replaced/`
- Edit Video
  - current shell entry point for subtitle generation, subtitle review, content flagging, and cut export
  - works on one selected `.mp4` / `.mov` at a time
  - `Subtitles` drawer can generate sibling `.srt` sidecars via local STT with `yap`
  - `Flagged Sections` drawer can load existing sibling `.analysis.json` results or generate them from subtitle sidecars
  - the JSON import area accepts external analysis results and provides a `Copy Prompt` action without rendering the full prompt
  - subtitle analysis supports Settings-selected cloud engines or installed local CLI agents, with per-run engine and cloud-strategy overrides
  - cut export is range-based and writes to `video_cleaned/`
  - delete action trashes the selected video plus matching `.srt`, `.analysis.json`, and `.ranges.json` sidecars when present
  - API keys live in `Settings`
- Cancel semantics
  - `stop_after_current`
  - do not misrepresent this as a mid-request abort for an in-flight single-file LLM call

## Testing conventions

- JS/TS tests use `bun:test`.
- Test names should follow `it('should ...')`.
- DOM/component rendering tests are out of MVP scope unless explicitly requested.
- Prioritize tests for:
  - reducers/state transitions
  - request/response payload builders
  - protocol mapping/parsing
  - moderation result parsing
  - error handling and edge cases
  - playback compatibility helpers (for example ffprobe fixture-shell tests)

## Rust conventions

- Keep command handlers thin; place validation and logic into testable helpers.
- Add unit tests for protocol parsing, queue state transitions, and command validation behavior.
- Async coordinators that join subprocesses or buffered readers must include a future-size or small-stack regression test; parser-only fixtures do not cover Tokio worker stack usage.
- Avoid introducing platform-coupled behavior without guard rails/tests.
## Python worker conventions

- Keep command construction and filesystem behavior deterministic.
- Prefer pure helper functions for command/path logic.
- Keep worker output JSONL schema stable.
- Add pytest coverage for MLX separator/ffmpeg command construction, error mapping, and LLM request-config helpers.
- Flagging supports both:
  - video inputs (uses `<video>.srt` sidecar)
  - direct `.srt` inputs (writes sibling `.analysis.json`)
- For cloud analysis logging, log exact engine/strategy/model/endpoint without leaking keys.

## Tooling

- Package manager/runtime: Bun.
- Lint/format: Biome (`bun run lint`, `bun run format`).
- Full checks: `./scripts/check.sh`.

## Frequent commands

```bash
./scripts/bootstrap.sh
bun run dev
bun run web:dev
bun run check
bun run release:macos:preflight
bun run release:macos
./scripts/setup-notary.sh
cargo test --manifest-path src-tauri/Cargo.toml
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

## Logging and debugging

When debugging failures or stalls:

- keep `bun run dev` terminal open
- inspect Rust worker lifecycle logs and worker stdout/stderr forwarding
- verify UI worker status messages and drawer log panels
- confirm runtime paths:
  - Python venv under app data runtime dir
  - ffmpeg/MLX model/yap resolution via env overrides when needed
- for playback issues, check:
  - `ffprobe` output
  - the bounded localhost preview server in `src-tauri/src/media_preview.rs`
  - `src/features/editor/playback-compat.test.ts`
- for analysis-provider issues, check:
  - executable discovery and model listing in `src-tauri/src/analysis_agents.rs`
  - local CLI command construction and temporary subtitle workspaces in `python-worker/src/al_iyaal_worker/moderation/agents.py`
  - provider request construction in `python-worker/src/al_iyaal_worker/moderation/llm.py`
## Repository map

- `src/` React app, feature domain logic, tests.
- `src/features/app/`: sidebar navigation/page definitions for `Dashboard`, `Remove Music`, `Edit Video`, and `Settings`.
- `src/features/batch/`: remove-music state/transport/tests.
- `src/features/media/`: transcription/flag/cut task contracts + reducer + transport.
- `src/features/editor/`: subtitle parsing, range building, playback compatibility, fixtures.
- `src/features/moderation/`: moderation settings validation and result utilities.
- `src/components/layout/`: `app-shell`, `sidebar-nav`, and `page-header`.
- `src/components/`: workflow panels and shared UI. `simple-cut-editor-panel.tsx` is the mounted editor surface in `App.tsx`; the unreferenced standalone transcription, profanity, and moderation-settings panels are hard-cut and are not supported entry points.
- `src-tauri/`: Rust backend, Tauri commands, runtime bootstrap, worker orchestration, and local analysis-agent discovery.
- `python-worker/`: Python daemon, media-processing pipeline, moderation helpers, and local CLI agent invocation.
- `scripts/`: bootstrap/check/release/version sync helpers.
- `docs/analysis-providers.md`: analysis engines, local CLI agents, model/reasoning selection, privacy, and troubleshooting.
- `docs/macos-signing-notarization.md`: local signing/notarization workflow and Apple/Tauri references.
- `.github/workflows/`: CI and semantic-release pipelines.

## Release/versioning

- Semantic release is configured via `release.config.mjs`.
- `package.json` is the version source of truth.
- `bun run version:sync` must keep:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  in sync.

## Do not

- Do not add destructive git commands.
- Do not silently change user-facing behavior without tests.
- Do not bypass lint/typecheck/test gates.
- Do not reintroduce tab-based shell navigation unless explicitly requested.
- Do not invent notarization credentials; use the local interactive script and Apple tooling prompts.
