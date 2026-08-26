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
[![Bun](https://img.shields.io/badge/Bun-1.3.12-F9F1E1?logo=bun&logoColor=111111)](https://bun.sh/)
[![Biome](https://img.shields.io/badge/Biome-2.5.6-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)
[![Base UI](https://img.shields.io/badge/Base_UI-portal--safe-111111)](https://base-ui.com/)

Local-first Tauri v2 desktop app (macOS-first) for Muslim families to remove music, generate subtitles, review flagged content, and export clean cuts. Subtitle moderation can also use opt-in cloud providers or installed local CLI agents through user-supplied configuration.

## Current sections

- `Dashboard`
  - compact landing page for the desktop shell
  - quick entry points into each workflow
- `Remove Music`
  - folder-based `.mp4` / `.mov` processing
  - Demucs MLX vocals extraction through Apple MLX + ffmpeg remux
  - outputs to `audio_replaced/`
- `Edit Video`
  - single-video review surface for subtitles, subtitle analysis, and cut export
  - `Subtitles` drawer can generate sibling `.srt` sidecars via local STT with `yap`
  - `Flagged Sections` drawer can load existing sibling `.analysis.json` files or generate new ones
  - the JSON import area accepts external analysis results and copies a provider-specific prompt without rendering the full prompt
  - per-run subtitle analysis engine and cloud strategy selection, using the saved local-agent model and reasoning defaults from Settings
  - exact range export writes to `video_cleaned/` and defaults to Apple VideoToolbox HEVC on supported Macs
  - deleting the current video can also trash matching `.srt`, `.analysis.json`, and `.ranges.json` sidecars
- `Settings`
  - stores Gemini and Nova API keys locally in app data
  - detects installed `codex`, `agy`/`agv`, `kiro-cli`, and `opencode` executables
  - discovers selectable models and reasoning levels for installed local agents
  - automatically persists engine, model, reasoning, keys, and moderation-rule changes

## Detection engines

- `Blacklist`
  - local rules + profanity matching
  - deterministic and offline
- `Gemini`
  - cloud LLM analysis using the saved Google API key
- `Nova Pro`
  - cloud LLM analysis using the saved Amazon Nova API key
- Installed local agents
  - `Codex`, `Antigravity`, `Kiro CLI`, and `OpenCode` are available only when their CLI is installed and model discovery succeeds
  - the selected agent receives a temporary workspace containing `subtitles.srt`; the initial prompt references that file rather than embedding the full subtitle text
  - the CLI may still read the file contents during its own analysis, and credentials/configuration remain owned by the CLI

Notes:
- API keys are configured in `Settings`.
- Engine, model, and reasoning depth are chosen in `Settings`. `Edit Video > Flagged Sections` can override the engine and cloud strategy for one run; local-agent model and reasoning remain Settings-owned.
- Cloud providers receive subtitle text directly in the request; local agents receive a temporary file reference as described in [analysis provider architecture](docs/analysis-providers.md).
- Cancel behavior is `stop_after_current`, so an in-flight single-file LLM request finishes its current work before stopping.

## UI shell

- desktop-first workspace shell
- fixed left sidebar navigation
- compact page-based layout, not top tabs
- `Edit Video` consolidates subtitle generation, subtitle flag review, and cut export into drawer-based workflows
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
- Python worker sidecar for MLX vocal separation, ffmpeg, STT, and moderation

## Repository layout

- `src/` React UI, feature modules, transport, and tests
  - `src/features/app/` desktop navigation and page definitions
  - `src/features/batch/` remove-music domain logic
  - `src/features/media/` transcription, detection, and cut task contracts/state
  - `src/features/editor/` subtitles, ranges, and playback compatibility helpers
  - `src/features/moderation/` result parsing and moderation validation
  - `src/components/layout/` shell, sidebar, and page-header primitives
  - `src/components/` workflow pages and shared UI, including the mounted `simple-cut-editor-panel.tsx`
- `src-tauri/` Rust commands, worker orchestration, runtime bootstrap, and local agent orchestration
- `python-worker/` Python daemon and media-processing pipeline, including subtitle moderation and local CLI agent helpers
- `scripts/` bootstrap, check, release, and version sync helpers
- `docs/analysis-providers.md` analysis engine, local agent, model, reasoning, and troubleshooting notes
- `docs/video-export.md` cut-export architecture, quality presets, and performance benchmark
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

Validate local Apple signing and notarization access without building or submitting anything:

```bash
bun run release:macos:preflight
```

Run the complete checked, signed, notarized, and stapled macOS release:

```bash
bun run release:macos
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
- verify the bounded localhost preview server and HTTP range handling
  - run `src/features/editor/playback-compat.test.ts`
- transcription/detection stalls
  - inspect worker lifecycle logs
  - inspect drawer task logs
  - confirm runtime sidecar paths and saved settings

## Runtime notes

- a local Python runtime is bootstrapped under app data on first run
- runtime installs are driven from `python-worker/requirements.lock.txt`
- music removal requires Apple Silicon and downloads the Demucs MLX model into the app-managed runtime on first use; it converts and caches MLX safetensors for subsequent runs
- optional env overrides:
  - `AIYAAL_PYTHON_PATH`
  - `AIYAAL_BASE_PYTHON`
  - `AIYAAL_FFMPEG_PATH`
  - `AIYAAL_MLX_MODEL_DIR`
  - `AIYAAL_YAP_PATH`

## macOS signing and notarization

- primary guide: `docs/macos-signing-notarization.md`
- read-only credential check: `bun run release:macos:preflight`
- complete local release: `bun run release:macos`
- lower-level signing/notarization script: `scripts/sign-notarize-macos.sh`
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
