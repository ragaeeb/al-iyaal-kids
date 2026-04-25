# Vision Moderation With LiquidAI WebGPU

## Status

Research date: 2026-04-24

Relevant sources:

- https://huggingface.co/spaces/LiquidAI/LFM2.5-VL-1.6B-WebGPU
- https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B
- https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-ONNX
- https://docs.liquid.ai/lfm/models/vision-models
- https://docs.liquid.ai/lfm/models/lfm25-vl-1.6b
- https://docs.liquid.ai/lfm/models/lfm25-vl-450m
- https://v2.tauri.app/reference/webview-versions/
- https://bugs.webkit.org/show_bug.cgi?format=multiple&id=281680

## What The Liquid Demo Actually Is

The Hugging Face Space is a browser-side WebGPU demo, not a hosted inference API. The public demo runs the `LiquidAI/LFM2.5-VL-1.6B-ONNX` checkpoint in the browser with `onnxruntime-web` and `@huggingface/transformers`.

Important details from the current model docs:

- `LFM2.5-VL-1.6B` is Liquid AI's current flagship 1.6B vision-language model.
- The ONNX model card recommends `FP16` image encoder plus `Q4` decoder for WebGPU.
- Reported browser footprint is roughly `~1.5 GB` for the recommended WebGPU variant.
- Liquid now also publishes `LFM2.5-VL-450M`, documented on 2026-04-24 as the smallest and fastest vision model in the family.

## Recommendation For This App

Do not try to run this inside the Python worker.

That worker is a good fit for deterministic filesystem work and cloud LLM calls, but this Liquid model is built for browser-side WebGPU execution. The clean architecture for this repo is:

1. Load the vision model in the frontend inside the Tauri webview.
2. Sample frames from local video files every `2s`.
3. Ask the model for a short scene description per sampled frame.
4. Batch those frame descriptions and send them through the existing moderation LLM path.
5. Persist a sibling `.analysis.json` sidecar so the current review and cut-video flows can reuse it.

This keeps the privacy model aligned with the app:

- frame understanding stays local on-device
- only the text summary/captions need to go to Gemini/Nova, if the user chooses a cloud engine
- the existing local `blacklist` engine can remain as-is for subtitle-only analysis

## Best Product Shape

Treat this as a second moderation mode, not as a replacement for subtitle moderation.

Suggested UX:

- Keep current subtitle detection exactly as it is.
- Add a new detection input mode: `Video Frames`.
- Let the user choose sample cadence, default `2s`.
- Let the user choose the vision runtime:
  - `LFM2.5-VL-450M` for faster, lighter scans
  - `LFM2.5-VL-1.6B` for higher-quality scans
- Reuse the existing moderation engine selector for the text moderation stage:
  - `Gemini`
  - `Nova Pro`
  - later: local rules if you want simple keyword matching over captions

## Repo Integration Points

Current code already gives us the right downstream contract:

- Frontend moderation UI: `src/components/profanity-panel.tsx`
- Moderation engine labels: `src/features/moderation/engines.ts`
- Shared task types: `src/features/media/types.ts`
- Sidecar parsing and overview: `src/features/moderation/results.ts`
- Existing flag task transport: `src/features/media/transport.ts`
- Existing cloud moderation prompt/parser: `python-worker/src/al_iyaal_worker/moderation/llm.py`
- Existing `.analysis.json` writer path: `python-worker/src/al_iyaal_worker/tasks/flag.py`

The current sidecar schema is already close enough for vision results:

- `startTime`
- `endTime`
- `text`
- `reason`
- `priority`
- `category`
- `ruleId`

For frame-based analysis:

- `text` should hold the generated caption or scene summary for the frame window
- `startTime` and `endTime` should cover the sampled interval
- `category` can be `vision`
- `ruleId` can be the moderation provider or a specific label like `vision_llm`

## Minimal Implementation Plan

### Phase 1: Local Captioning POC

Build a frontend-only proof of concept that:

- opens a local video file through the current asset protocol
- samples one frame every `2s`
- runs Liquid captioning locally in the frontend
- renders a timeline of captions with timestamps

Suggested new files:

- `src/features/vision/model.ts`
- `src/features/vision/frame-sampler.ts`
- `src/features/vision/captioner.ts`
- `src/features/vision/types.ts`

At this stage, do not touch the worker protocol.

### Phase 2: Reuse Existing Moderation Backend

Add a worker path that accepts timestamped caption text instead of subtitle text.

Recommended shape:

- add a new Python helper that analyzes generic timed text segments
- keep the existing JSON output contract identical to current `.analysis.json`
- share the prompt builder with `python-worker/src/al_iyaal_worker/moderation/llm.py`

This is better than forcing vision results through the current subtitle file parser.

### Phase 3: UI Integration

Extend `src/components/profanity-panel.tsx` with:

- source type: `Subtitles` or `Video Frames`
- sample interval
- vision model choice
- local model status and cache size

Display should stay compatible with existing result cards and cut editor jump links, since those already consume timestamped flagged segments.

## Technical Notes

### Why Frontend WebGPU Is The Right Runtime

The official Space ships browser code using:

- `onnxruntime-web`
- `@huggingface/transformers`

That strongly suggests we should mirror the same browser execution path inside Tauri rather than trying to port it into Rust or Python first.

### Why Tauri Can Work

Tauri v2 on macOS uses `WKWebView`, so browser capability depends on the installed system WebKit version rather than a bundled Chromium runtime:

- https://v2.tauri.app/reference/webview-versions/

That means WebGPU availability is machine-dependent. The app must runtime-check support before exposing the feature.

Required guard:

- if `navigator.gpu` is unavailable, disable vision scan and explain that the installed macOS WebKit does not expose WebGPU for this app

### WebKit Risk To Account For

WebKit had a webcam texture bug filed as `281680`, resolved in late 2024, with a workaround using `new VideoFrame(video)` when importing external textures:

- https://bugs.webkit.org/show_bug.cgi?format=multiple&id=281680

We are scanning local video files rather than live webcam input, but the same ecosystem instability is a reason to keep this feature behind explicit capability checks and test it on the exact macOS versions we support.

### Cold Start And Cache Reality

The 1.6B WebGPU model is large enough that first-run download and compile time will be noticeable.

Expect:

- a slow first run
- large local browser cache usage
- lower-end Macs to struggle

For that reason, the better default for production is likely `LFM2.5-VL-450M`, with `1.6B` offered as a slower higher-quality option.

## Suggested Output Contract

Keep the existing sidecar style and just add vision-derived segments:

```json
{
  "engine": "gemini",
  "flagged": [
    {
      "startTime": 24,
      "endTime": 26,
      "text": "Two animated characters kiss in close-up.",
      "reason": "Romantic physical behavior detected in frame captions.",
      "priority": "medium",
      "category": "vision",
      "ruleId": "vision_llm"
    }
  ],
  "summary": "Mostly outdoor adventure scenes with one brief romantic sequence.",
  "createdAt": "2026-04-24T00:00:00Z",
  "videoFileName": "episode-01.mp4"
}
```

That keeps compatibility with:

- moderation results view
- analytics counts
- cut-video timestamp jumps

## Recommended First Build

If implementing this now, the first slice should be:

1. Frontend-only frame sampler for local files.
2. Frontend-only Liquid captioning on sampled frames.
3. Debug panel showing `timestamp -> caption`.
4. No persistence yet.

Once that is stable in the Tauri webview, wire the captions into the existing moderation flow and only then add sidecar writing.

## Non-Goals For The First Iteration

- live webcam moderation
- background hidden scanning of whole folders
- Python-side WebGPU inference
- cross-platform guarantees beyond macOS-first support
