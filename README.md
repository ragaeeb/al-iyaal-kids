# al-Iyaal Kids

[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/199cc087-82c9-444f-bc37-579e62ff5850.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/199cc087-82c9-444f-bc37-579e62ff5850)
[![codecov](https://codecov.io/gh/ragaeeb/al-iyaal-kids/graph/badge.svg?token=576PVJ0G9I)](https://codecov.io/gh/ragaeeb/al-iyaal-kids)
[![CI](https://img.shields.io/github/actions/workflow/status/ragaeeb/al-iyaal-kids/ci.yml?branch=main&label=ci)](https://github.com/ragaeeb/al-iyaal-kids/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/ragaeeb/al-iyaal-kids/release.yml?branch=main&label=release)](https://github.com/ragaeeb/al-iyaal-kids/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Privacy](https://img.shields.io/badge/privacy-local--first-success)](./PRIVACY.md)
[![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)](https://react.dev/)
[![Tailwind](https://img.shields.io/badge/Tailwind-v4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Bun](https://img.shields.io/badge/Bun-1.3.10-F9F1E1?logo=bun&logoColor=111111)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/Biome-2.4.6-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)
[![Base UI](https://img.shields.io/badge/Base_UI-portal--safe-111111)](https://base-ui.com/)

Local-first Tauri v2 desktop app (macOS-first) for Muslim families to process media privately: remove music, generate subtitles, analyze subtitle content, cut flagged segments, and track local workflow analytics.

## Current sections

- `Dashboard`
  - compact landing page for the desktop shell
  - quick entry points into each workflow
- `Remove Music`
  - folder-based `.mp4` / `.mov` processing
  - Demucs vocals extraction + ffmpeg remux
  - outputs to `audio_replaced/`
- `Transcribe`
  - one or more video files or a folder
  - local STT via `yap`
  - writes sibling `.srt` sidecars
- `Profanity Detection`
  - one or more `.srt` files or a folder
  - per-run engine selection: `Blacklist`, `Gemini`, `Nova Pro`
  - per-run reasoning depth: `Fast`, `Deep`
  - can load existing sibling `.analysis.json` files
  - writes sibling `.analysis.json` sidecars
- `Cut Video`
  - simple player workflow for exact range cuts
  - subtitle-at-cursor display from sibling `.srt`
  - flagged-sections drawer from sibling `.analysis.json`
  - outputs to `video_cleaned/`
- `Analytics`
  - local-only persisted workflow counters
  - tracks remove-music, transcription, detection, and cut runs
  - includes detection-specific totals such as flagged lines and files with flags
- `Settings`
  - stores Gemini and Nova API keys locally in app data

## Detection engines

- `Blacklist`
  - local rules + profanity matching
  - deterministic and offline
- `Gemini`
  - cloud LLM analysis using the saved Google API key
- `Nova Pro`
  - cloud LLM analysis using the saved Amazon Nova API key

Notes:
- API keys are configured in `Settings`.
- Engine and reasoning depth are chosen in `Profanity Detection` for each run.
- Cancel behavior is `stop_after_current`, so an in-flight single-file LLM request will finish its current file before stopping.

## UI shell

- desktop-first workspace shell
- fixed left sidebar navigation
- compact page-based layout, not top tabs
- drawer-based task/status surfaces across workflows
- fab-ui registry setup via shadcn config
- Base UI portal-safe root isolation via `.root { isolation: isolate; }`

## Tech stack

- Tauri v2 + Rust backend
- React + TypeScript (ESNext)
- Tailwind CSS v4
- fab-ui via shadcn registries, built on Base UI primitives
- Bun for package management, scripts, and tests
- Biome for linting and formatting
- Python worker sidecar for Demucs, ffmpeg, STT, and moderation

## Repository layout

- `src/` React UI, feature modules, transport, and tests
  - `src/features/app/` desktop navigation and page definitions
  - `src/features/analytics/` analytics snapshot types, transport, and dashboard utilities
  - `src/features/batch/` remove-music domain logic
  - `src/features/media/` transcription, detection, and cut task contracts/state
  - `src/features/editor/` subtitles, ranges, and playback compatibility helpers
  - `src/features/moderation/` result parsing and moderation validation
  - `src/components/layout/` shell, sidebar, and analytics card primitives
  - `src/components/` workflow pages and shared UI
- `src-tauri/` Rust commands, worker orchestration, analytics persistence, runtime bootstrap
- `python-worker/` Python daemon and media-processing pipeline
- `scripts/` bootstrap, check, release, and version sync helpers
- `.github/workflows/` CI and semantic-release pipelines
- `PRIVACY.md` local-first privacy policy
- `AGENTS.md` AI contributor conventions

## Quickstart

Install/bootstrap once:

```bash
./scripts/bootstrap.sh
```

Launch the desktop app in dev mode:

```bash
bun run dev
```

Frontend-only Vite server:

```bash
bun run web:dev
```

Sign and notarize a macOS DMG locally:

```bash
bun run sign:macos
```

Bootstrap or refresh the local `notarytool` keychain profile only:

```bash
./scripts/setup-notary.sh
```

## Testing and checks

Run the full mixed-toolchain path:

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

Run the playback compatibility tests:

```bash
bun test src/features/editor/playback-compat.test.ts
```

Override the optional local probe file:

```bash
ALIYAAL_TEST_VIDEO_PATH="/absolute/path/to/video.mp4" bun test src/features/editor/playback-compat.test.ts
```

## Logging and debugging

During `bun run dev`:

- keep the terminal open for Rust/worker logs
- worker stdout is forwarded and printed as `worker stdout: ...`
- worker stderr is surfaced in both terminal logs and UI worker status surfaces

Useful checks:

- playback issues
  - inspect with `ffprobe`
  - verify `convertFileSrc` path handling
  - run `src/features/editor/playback-compat.test.ts`
- transcription/detection stalls
  - inspect worker lifecycle logs
  - inspect drawer task logs
  - confirm runtime sidecar paths and saved settings
- analytics issues
  - inspect app data `analytics/history.json`
  - verify completed task records are being appended from Rust worker completion handling

## Runtime notes

- a local Python runtime is bootstrapped under app data on first run
- runtime installs are driven from `python-worker/requirements.lock.txt`
- analytics history persists locally under app data
- optional env overrides:
  - `AIYAAL_PYTHON_PATH`
  - `AIYAAL_BASE_PYTHON`
  - `AIYAAL_FFMPEG_PATH`
  - `AIYAAL_DEMUCS_PATH`
  - `AIYAAL_YAP_PATH`

## macOS signing and notarization

- primary guide: `docs/macos-signing-notarization.md`
- local DX script: `scripts/sign-notarize-macos.sh`
- official references:
  - [Tauri v2 macOS signing](https://v2.tauri.app/distribute/sign/macos/)
  - [Apple notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
  - [Apple customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

## Release/versioning

- semantic-release runs from `.github/workflows/release.yml`
- `package.json` is the version source of truth
- `bun run version:sync` updates:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`

## Links

- GitHub: https://github.com/ragaeeb/al-iyaal-kids
- Privacy policy: `PRIVACY.md`
