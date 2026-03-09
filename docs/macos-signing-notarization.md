# macOS signing and notarization

This project ships macOS DMG builds. The current recommended path is:

1. sign with a `Developer ID Application` certificate
2. submit the built DMG with `notarytool`
3. staple the notarization ticket to the DMG

This matches current Apple notarization guidance and current Tauri macOS signing guidance.

## Official references

- Tauri macOS signing and notarization docs:
  - [Tauri v2 macOS signing](https://v2.tauri.app/distribute/sign/macos/)
- Apple notarization docs:
  - [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
  - [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
  - [Resolving common notarization issues](https://developer.apple.com/documentation/xcode/resolving-common-notarization-issues)

## Local DX script

Use:

```bash
bun run sign:macos
```

This script is intentionally interactive and optimized for local developer use.

What it does:

- discovers available `Developer ID Application` identities from the current login keychain
- derives the Apple Team ID from the selected identity when possible
- prompts for a `notarytool` keychain profile name
- validates the keychain profile if it already exists
- if the profile is missing or invalid, runs `./scripts/setup-notary.sh`, which wraps Apple’s interactive `notarytool store-credentials` flow
- builds a signed DMG through Tauri
- verifies the built `.app` signature and DMG integrity
- submits the DMG to Apple notarization with live logs
- fetches the notarization log JSON
- staples the ticket to the DMG
- runs a Gatekeeper assessment against the stapled DMG

Logs are written under:

```bash
.logs/sign-notarize/<timestamp>/
```

To bootstrap or refresh notarization credentials only:

```bash
./scripts/setup-notary.sh
```

## What the script auto-discovers

From the current machine it can discover:

- available `Developer ID Application` signing identities
- the Team ID embedded in the selected identity
- whether `xcrun notarytool` is installed and usable
- built `.app` and `.dmg` artifacts after Tauri completes

## What you may still be prompted for

The script will prompt only for data it cannot safely discover.

Typically that means:

- which signing identity to use, if multiple are installed
- which `notarytool` keychain profile to use
- Apple notarization credentials, if no usable keychain profile exists yet

Apple supports two common `notarytool` credential paths:

- App Store Connect API key
- Apple ID + app-specific password

The script delegates that credential capture to Apple’s own interactive `xcrun notarytool store-credentials` prompt via `./scripts/setup-notary.sh`.

## Environment overrides

These optional environment variables are supported by the script:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_NOTARY_PROFILE`

Example:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)" \
APPLE_TEAM_ID="TEAMID1234" \
APPLE_NOTARY_PROFILE="al-iyaal-kids-notary" \
bun run sign:macos
```

## Outputs and verification

After a successful run you should have:

- a signed `.app` inside `src-tauri/target/release/bundle/macos/`
- a signed and stapled `.dmg` inside `src-tauri/target/release/bundle/dmg/`
- notarization JSON logs under `.logs/sign-notarize/<timestamp>/`

Note:
- when Tauri is asked to build only a DMG, it may clean the intermediate `.app` bundle afterwards
- the local script tolerates that and continues using the DMG as the notarization/stapling target

Useful verification commands:

```bash
codesign --verify --deep --strict --verbose=2 /absolute/path/to/app.app
spctl -a -vv /absolute/path/to/app.app
spctl -a -vv -t install /absolute/path/to/app.dmg
```

## Notes

- This script targets DMG distribution.
- It notarizes and staples the DMG artifact produced by Tauri.
- Cancelled or failed notarization runs should be inspected via the saved `notary-log.json` and Apple’s notarization issue docs.
