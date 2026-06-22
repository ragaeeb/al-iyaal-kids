# Local Frame Scan

## Status

Current implementation snapshot: 2026-05-02

This document reflects the code that is currently wired into the desktop app. It replaces the earlier WebGPU research direction.

## User-facing behavior

- Frame scan is available inside `Edit Video > Flagged Frames`.
- It accepts local `.mp4` and `.mov` files.
- It samples frames every `2s` by default, with the interval passed through the Tauri command request.
- It writes a sibling `*.frames.analysis.json` sidecar next to the selected video.
- Results load back into the editor drawer for review and timestamp jumps.
- Deleting the current video from the editor can also trash the matching `.frames.analysis.json` sidecar.
- The current POC requires Apple Silicon because it uses MLX-backed captioning.

## Current architecture

Frontend:

- `src/components/simple-cut-editor-panel.tsx`
  - starts scans
  - subscribes to progress events
  - loads existing `.frames.analysis.json` sidecars
  - displays flagged-frame results

Rust:

- `src-tauri/src/commands.rs`
  - exposes the `scan_video_frames` Tauri command
  - validates supported paths and intervals
- `src-tauri/src/vision.rs`
  - orchestrates the scan subprocess
  - emits progress events
  - ensures local vision dependencies like `mlx-vlm` and `torchvision` are installed when needed

Python:

- `python-worker/src/al_iyaal_worker/vision_scan.py`
  - extracts JPG frames with `ffmpeg`
  - captions frames locally with `mlx-vlm`
  - uses `mlx-community/Qwen2.5-VL-7B-Instruct-4bit`
  - merges visual rules into the existing moderation settings
  - runs local rules over the generated captions
  - writes the `.frames.analysis.json` sidecar

## What it is not

- It is not a browser WebGPU feature.
- It is not currently routed through Gemini or Nova.
- It is not a general-purpose vision moderation API.

The current frame-scan path is local captioning plus local rules-based moderation.

## Current output shape

The sidecar includes both captions and flagged segments. Important fields:

- `captionModel`
- `captions`
- `createdAt`
- `engine`
- `flagged`
- `sampleIntervalSeconds`
- `scanMode`
- `summary`
- `videoFileName`

Example:

```json
{
  "captionModel": "mlx-community/Qwen2.5-VL-7B-Instruct-4bit",
  "captions": [
    {
      "startTime": 0,
      "endTime": 2,
      "text": "Two animated characters dance on a stage."
    }
  ],
  "createdAt": "2026-05-02T00:00:00Z",
  "engine": "blacklist",
  "flagged": [
    {
      "startTime": 0,
      "endTime": 2,
      "text": "Two animated characters dance on a stage.",
      "reason": "Frame may depict music or dancing.",
      "priority": "medium",
      "category": "music",
      "ruleId": "vision_music"
    }
  ],
  "sampleIntervalSeconds": 2,
  "scanMode": "local_vision_poc",
  "summary": "One flagged frame segment detected.",
  "videoFileName": "episode-01.mp4"
}
```

## Runtime notes

- This path is macOS-first and Apple Silicon-friendly because it relies on MLX model execution.
- `ffmpeg` is used for frame extraction. `AIYAAL_FFMPEG_PATH` can override the binary.
- `mlx-vlm` and `torchvision` are installed into the managed runtime on demand if they are missing.
- Cold start can be noticeable because the local caption model must load before the scan begins.

## Related files

- `src/features/media/transport.ts`
- `src/features/media/types.ts`
- `src/features/moderation/results.ts`
- `python-worker/tests/test_vision_scan.py`

## Future work

If the project revisits browser-side WebGPU or cloud-assisted frame moderation later, document that as a separate design path rather than treating it as the current implementation.
