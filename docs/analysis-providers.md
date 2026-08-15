# Analysis Providers

Subtitle analysis is selected from `Settings` and can use the built-in
`Blacklist` engine, the cloud providers `Gemini` and `Nova Pro`, or an
installed local CLI agent.

## Provider behavior

- `Blacklist` runs locally with the saved moderation rules and does not call a
  cloud provider.
- `Gemini` and `Nova Pro` receive the subtitle text and moderation instructions
  directly in the provider request. Their API keys are read from local app
  settings.
- `Codex`, `Antigravity`, `Kiro CLI`, and `OpenCode` receive a temporary
  workspace containing the source subtitle as `subtitles.srt`. The initial
  prompt references that file instead of embedding the complete subtitle text.
  The selected CLI can still read the file during its own analysis and uses its
  own account, configuration, provider, network access, and tool policy.

The temporary workspace is removed after the local-agent process exits. Local
agent cancellation follows the app's `stop_after_current` behavior: an active
single-file process is allowed to finish before the worker stops.

## Settings

The Settings page checks the executable search path and common macOS install
locations for `codex`, `agy` or `agv`, `kiro-cli`, and `opencode`. Installed
agents are queried for models and supported reasoning levels. The user can
choose the engine, model, and reasoning level; the selected values become the
default for later analysis runs. Settings are saved automatically after each
change; there is no separate save action.

The mounted `Edit Video` analysis drawer can override the saved engine and
cloud analysis strategy for one run. Local-agent model and reasoning choices
remain Settings-owned, and the model must come from that agent's discovered
model list.

Settings saved before local-agent support remain valid for built-in and cloud
engines. Local-agent-only model and reasoning fields default to empty until an
installed agent and model are selected.
The `Flagged Sections` drawer's JSON import area provides a `Copy Prompt` action
for the selected engine. It copies the exact prompt template without rendering
the full prompt in the UI. Cloud prompts contain a `{{subtitles}}` placeholder;
the worker replaces it with the subtitle text when a request runs.
Installed-agent prompts instead direct the selected CLI to `subtitles.srt`.

## External analysis imports

The `Flagged Sections` drawer accepts one or more JSON files from external
tools such as ChatGPT or Claude. Drop the files onto the import area or use
`Choose JSON Files`. Each file can contain one analysis object, an array of
analysis objects, or a version 2 bundle.

External analyses require a `summary` and a `flagged` array. New analyses should
identify each finding with the source SRT `cueIndex`, plus `priority` (`high`,
`medium`, or `low`) and a non-empty `reason`. The app resolves the cue index to
the source timestamp, end time, and subtitle text. Legacy imports may provide
`startTime` as numeric seconds, a seconds string, or a clock/SRT timestamp.
`endTime`, `text`, `category`, and `ruleId` remain optional. Use `provider` and
`model` to retain provenance when available.

Cue indexes must uniquely identify a source subtitle cue. Legacy timestamps are
matched exactly first; approximate model timestamps can recover a nearby cue
when distinctive words from the reason uniquely match its subtitle text.
Findings with no supplied text and no reliable cue match are skipped
individually and reported as import warnings; other valid findings and analysis
runs are still saved.

The app deduplicates exact runs and atomically persists a versioned bundle:

```json
{
  "schemaVersion": 2,
  "sourceFile": "episode.srt",
  "analyses": [
    {
      "provider": "chatgpt",
      "model": "gpt-5",
      "summary": "Storyline summary.",
      "flagged": [
        {
          "cueIndex": 588,
          "priority": "high",
          "reason": "Brief explanation."
        }
      ]
    }
  ]
}
```

Existing object and array sidecars remain readable for migration. The next
successful import or app-generated analysis rewrites them as a version 2
bundle. App-generated runs append to the bundle instead of replacing prior
external or app-generated analyses.

## Troubleshooting

- If an agent is shown as unavailable, verify the executable is on `PATH` or
  in the supported macOS install locations, then refresh the provider list.
- Codex model discovery reads its local model cache. Open Codex once and
  refresh Settings if no Codex models are listed.
- OpenCode discovery and invocation set `OPENCODE_DB=:memory:` and disable
  automatic update/prune work so discovery does not contend with the user's
  OpenCode database.
- A provider can be installed while still reporting no models when its CLI is
  not authenticated, has no configured models, or returns an unsupported
  response. The Settings error is the provider's discovery failure; it is not
  treated as a usable model list.

The command construction and temporary workspace implementation live in
`python-worker/src/al_iyaal_worker/moderation/agents.py`. Provider request
construction lives in `python-worker/src/al_iyaal_worker/moderation/llm.py`,
and executable/model discovery lives in `src-tauri/src/analysis_agents.rs`.
