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

## One-command local release

First, run the read-only preflight:

```bash
bun run release:macos:preflight
```

It validates the local Developer ID identity, derives the Team ID, and validates the
`al-iyaal-kids-notary` Keychain profile. It does not build the app or submit anything to Apple.

Then run the complete release:

```bash
bun run release:macos
```

With valid Keychain credentials, this command is non-interactive.
Credential secrets remain in Keychain; the scripts use only the identity name, Team ID, and
notary profile name.

What it does:

- validates signing and notarization credentials before running expensive checks
- runs the full repository check suite
- discovers available `Developer ID Application` identities from the current login keychain
- derives the Apple Team ID from the selected identity when possible
- uses and validates the `al-iyaal-kids-notary` Keychain profile by default
- if the profile is missing or invalid, runs `./scripts/setup-notary.sh`, which wraps Apple’s interactive `notarytool store-credentials` flow
- builds a signed DMG for `AIYAAL_MACOS_TARGET` through Tauri (default: `aarch64-apple-darwin`)
- verifies the built `.app` signature and DMG integrity
- submits the DMG to Apple notarization with live logs
- fetches the notarization log JSON
- staples the ticket to the DMG
- runs a Gatekeeper assessment against the stapled DMG
- writes and verifies a `.sha256` sidecar beside the final DMG

Logs are written under:

```bash
.logs/sign-notarize/<timestamp>/
```

To bootstrap or refresh notarization credentials only:

```bash
./scripts/setup-notary.sh
```

To sign and notarize without first running the repository checks, use the lower-level command:

```bash
bun run sign:macos
```

## What the script auto-discovers

From the current machine it can discover:

- available `Developer ID Application` signing identities
- the Team ID embedded in the selected identity
- whether the default or selected `notarytool` Keychain profile is usable
- built `.app` and `.dmg` artifacts after Tauri completes

## What you may still be prompted for

The script will prompt only for data it cannot safely discover.

The full release prompts only when automatic discovery is ambiguous or credentials are missing:

- which signing identity to use, if multiple are installed
- Apple notarization credentials, if no usable keychain profile exists yet

Preflight never opens credential setup. It fails with the setup command instead.

Apple supports two common `notarytool` credential paths:

- App Store Connect API key
- Apple ID + app-specific password

The script delegates that credential capture to Apple’s own interactive `xcrun notarytool store-credentials` prompt via `./scripts/setup-notary.sh`.

## Environment overrides

These optional environment variables are supported by the script:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_NOTARY_PROFILE`
- `AIYAAL_MACOS_TARGET` (defaults to `aarch64-apple-darwin`)

Example:

```bash
APPLE_NOTARY_PROFILE="another-notary-profile" bun run release:macos:preflight
```

The profile can also be selected for one invocation without an environment variable:

```bash
bun run release:macos:preflight --profile another-notary-profile
```

## Outputs and verification

After a successful run you should have:

- a signed `.app` and DMG inside `src-tauri/target/<target>/release/bundle/`, where `<target>` defaults to `aarch64-apple-darwin`
- a verified `.dmg.sha256` sidecar beside the DMG
- notarization JSON logs under `.logs/sign-notarize/<timestamp>/`

Note:
- when Tauri is asked to build only a DMG, it may clean the intermediate `.app` bundle afterwards
- the local script tolerates that and continues using the DMG as the notarization/stapling target

# Run these commands only when the `.app` bundle was retained:

Useful verification commands:

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/aarch64-apple-darwin/release/bundle/macos/al-Iyaal\ Kids.app
spctl -a -vv src-tauri/target/aarch64-apple-darwin/release/bundle/macos/al-Iyaal\ Kids.app
spctl -a -vv -t install src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/al-Iyaal\ Kids_*.dmg
```

## Notes

- This script targets DMG distribution.
- The default release target is Apple Silicon (`aarch64-apple-darwin`).
- It notarizes and staples the DMG artifact produced by Tauri.
- Cancelled or failed notarization runs should be inspected via the saved `notary-log.json` and Apple’s notarization issue docs.
