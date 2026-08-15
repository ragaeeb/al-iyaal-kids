# Privacy Policy

Last updated: May 2, 2026

`al-Iyaal Kids` is a local-first desktop app.

## What we collect

- We do not collect personal information.
- We do not collect analytics or telemetry.
- We do not operate a project backend that receives your media files.

## How data is processed

- Remove-music, transcription, cut export, and blacklist moderation happen on your device.
- Moderation settings and provider API keys are stored locally in app data.
- Temporary/runtime files may be created locally to run the MLX separator, its model checkpoint, Python runtime assets, ffmpeg, and local agent analysis.

## Optional cloud analysis

- If you choose `Gemini` or `Nova Pro` in `Edit Video > Flagged Sections`, subtitle text and moderation instructions are sent directly from your device to the selected provider using the API key you saved locally.
- Media files themselves are not uploaded by the app for that subtitle analysis flow.
- If you choose an installed local CLI agent (`Codex`, `Antigravity`, `Kiro CLI`, or `OpenCode`), the app creates a temporary local workspace, copies the subtitle file there as `subtitles.srt`, and asks the selected CLI to read it. The CLI may use its own configured provider, account, network access, and local tools according to that CLI's behavior.

## Third-party services

- No third-party tracking or analytics SDKs are included.
- Optional cloud or local-agent subtitle moderation is user-initiated and uses the engine, model, and reasoning settings you selected.

## Contact

- GitHub: https://github.com/ragaeeb/al-iyaal-kids
