# Privacy Policy

Last updated: May 2, 2026

`al-Iyaal Kids` is a local-first desktop app.

## What we collect

- We do not collect personal information.
- We do not collect analytics or telemetry. The in-app analytics section is local-only and stays on your device.
- We do not operate a project backend that receives your media files.

## How data is processed

- Remove-music, transcription, cut export, and local frame-scan processing happen on your device.
- Moderation settings and provider API keys are stored locally in app data.
- Temporary/runtime files may be created locally to run Demucs, Python runtime assets, ffmpeg, and local vision dependencies.

## Optional cloud analysis

- If you choose `Gemini` or `Nova Pro` in `Edit Video > Flagged Sections`, subtitle text and moderation instructions are sent directly from your device to the selected provider using the API key you saved locally.
- Media files themselves are not uploaded by the app for that subtitle analysis flow.
- Local frame scan currently writes `.frames.analysis.json` sidecars on-device and does not use those cloud providers.

## Third-party services

- No third-party tracking or analytics SDKs are included in the MVP.
- Optional cloud subtitle moderation is user-initiated and uses the provider you selected.

## Contact

- GitHub: https://github.com/ragaeeb/al-iyaal-kids
