use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;
use tokio::{io::AsyncRead, process::Command, time::timeout};

use crate::types::{AnalysisAgentCapability, AnalysisAgentModel};

const MODEL_QUERY_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_MODEL_DISCOVERY_OUTPUT_BYTES: usize = 1_000_000;
const KIRO_REASONING_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const ANTIGRAVITY_REASONING_LEVELS: [&str; 3] = ["low", "medium", "high"];
const OPENCODE_MODEL_ENVIRONMENT: [(&str, &str); 3] = [
    ("OPENCODE_DB", ":memory:"),
    ("OPENCODE_DISABLE_AUTOUPDATE", "true"),
    ("OPENCODE_DISABLE_PRUNE", "true"),
];

#[derive(Clone, Copy)]
struct AgentDefinition {
    id: &'static str,
    label: &'static str,
    executable_names: &'static [&'static str],
}

const CODEX: AgentDefinition = AgentDefinition {
    id: "codex",
    label: "Codex",
    executable_names: &["codex"],
};
const ANTIGRAVITY: AgentDefinition = AgentDefinition {
    id: "antigravity",
    label: "Antigravity",
    executable_names: &["agy", "agv"],
};
const KIRO: AgentDefinition = AgentDefinition {
    id: "kiro_cli",
    label: "Kiro CLI",
    executable_names: &["kiro-cli"],
};
const OPENCODE: AgentDefinition = AgentDefinition {
    id: "opencode",
    label: "OpenCode",
    executable_names: &["opencode"],
};

pub fn is_analysis_agent(engine: &str) -> bool {
    matches!(engine, "codex" | "antigravity" | "kiro_cli" | "opencode")
}

fn definition_for(engine: &str) -> Option<AgentDefinition> {
    match engine {
        "codex" => Some(CODEX),
        "antigravity" => Some(ANTIGRAVITY),
        "kiro_cli" => Some(KIRO),
        "opencode" => Some(OPENCODE),
        _ => None,
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn executable_search_directories() -> Vec<PathBuf> {
    let mut directories = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();

    if let Some(home) = home_dir() {
        for directory in [
            home.join(".bun/bin"),
            home.join(".local/bin"),
            home.join(".cargo/bin"),
        ] {
            if !directories.contains(&directory) {
                directories.push(directory);
            }
        }
    }

    for directory in [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ] {
        if !directories.contains(&directory) {
            directories.push(directory);
        }
    }
    directories
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn find_executable(definition: AgentDefinition) -> Option<PathBuf> {
    for directory in executable_search_directories() {
        for executable_name in definition.executable_names {
            let candidate = directory.join(executable_name);
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn resolve_agent_executable(engine: &str) -> Result<PathBuf, String> {
    let definition =
        definition_for(engine).ok_or_else(|| format!("Unsupported analysis agent: {engine}"))?;
    find_executable(definition).ok_or_else(|| {
        format!(
            "{} is not installed or could not be found. Refresh Analysis Providers in Settings.",
            definition.label
        )
    })
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars();

    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            output.push(character);
            continue;
        }

        if characters.next() != Some('[') {
            continue;
        }
        for control_character in characters.by_ref() {
            if control_character.is_ascii_alphabetic() {
                break;
            }
        }
    }

    output
}

fn concise_error(value: &[u8]) -> String {
    let cleaned = strip_ansi(&String::from_utf8_lossy(value));
    let compact = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(300).collect()
}

async fn run_model_command(
    executable: &Path,
    arguments: &[&str],
    environment: &[(&str, &str)],
) -> Result<String, String> {
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .envs(environment.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed starting model discovery: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Model discovery did not expose stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Model discovery did not expose stderr.".to_string())?;

    let result = timeout(MODEL_QUERY_TIMEOUT, async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("Failed waiting for model discovery: {error}"))
            },
            read_model_discovery_output(stdout, "stdout"),
            read_model_discovery_output(stderr, "stderr"),
        )
    })
    .await;

    let (status, stdout, stderr) = match result {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("Model discovery timed out after 45 seconds.".to_string());
        }
    };

    if !status.success() {
        let message = concise_error(&stderr);
        return Err(if message.is_empty() {
            format!("Model discovery exited with status {status}.")
        } else {
            message
        });
    }

    String::from_utf8(stdout)
        .map_err(|error| format!("Model discovery returned invalid UTF-8: {error}"))
}

async fn read_model_discovery_output<R>(mut reader: R, stream_name: &str) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let bytes_read = tokio::io::AsyncReadExt::read(&mut reader, &mut buffer)
            .await
            .map_err(|error| format!("Failed reading model discovery {stream_name}: {error}"))?;
        if bytes_read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(bytes_read) > MAX_MODEL_DISCOVERY_OUTPUT_BYTES {
            return Err(format!(
                "Model discovery {stream_name} exceeded the {MAX_MODEL_DISCOVERY_OUTPUT_BYTES}-byte output limit."
            ));
        }
        output.extend_from_slice(&buffer[..bytes_read]);
    }
}

#[derive(Deserialize)]
struct CodexModelsCache {
    models: Vec<CodexCachedModel>,
}

#[derive(Deserialize)]
struct CodexCachedModel {
    slug: String,
    display_name: String,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevel>,
}

#[derive(Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

fn parse_codex_models(content: &str) -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    let cache: CodexModelsCache = serde_json::from_str(content)
        .map_err(|error| format!("Could not parse the Codex model cache: {error}"))?;
    let models = cache
        .models
        .into_iter()
        .filter(|model| {
            model.visibility.as_deref() != Some("hide")
                && is_model_identifier(model.slug.trim())
                && !model.display_name.trim().is_empty()
        })
        .map(|model| AnalysisAgentModel {
            id: model.slug.trim().to_string(),
            label: model.display_name.trim().to_string(),
            reasoning_levels: model
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect(),
            default_reasoning_level: model.default_reasoning_level,
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Err("Codex did not return any usable models.".to_string());
    }
    let default_model = models.first().map(|model| model.id.clone());
    Ok((models, default_model))
}

fn discover_codex_models() -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    let codex_home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
        .ok_or_else(|| "Could not resolve the Codex settings directory.".to_string())?;
    let cache_path = codex_home.join("models_cache.json");
    let content = fs::read_to_string(&cache_path).map_err(|error| {
        format!("Could not read the Codex model cache. Open Codex once, then refresh: {error}")
    })?;
    parse_codex_models(&content)
}

#[derive(Deserialize)]
struct KiroModelsResponse {
    models: Vec<KiroModel>,
    default_model: Option<String>,
}

#[derive(Deserialize)]
struct KiroModel {
    model_id: String,
    model_name: String,
}

fn parse_kiro_models(content: &str) -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    let response: KiroModelsResponse = serde_json::from_str(&strip_ansi(content))
        .map_err(|error| format!("Could not parse Kiro model output: {error}"))?;
    let models = response
        .models
        .into_iter()
        .filter(|model| {
            is_model_identifier(model.model_id.trim()) && !model.model_name.trim().is_empty()
        })
        .map(|model| AnalysisAgentModel {
            id: model.model_id.trim().to_string(),
            label: model.model_name.trim().to_string(),
            reasoning_levels: KIRO_REASONING_LEVELS
                .iter()
                .map(|level| (*level).to_string())
                .collect(),
            default_reasoning_level: Some("low".to_string()),
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Err("Kiro CLI did not return any usable models.".to_string());
    }
    let default_model = response
        .default_model
        .filter(|model_id| models.iter().any(|model| model.id == *model_id))
        .or_else(|| models.first().map(|model| model.id.clone()));
    Ok((models, default_model))
}

fn reasoning_rank(level: &str) -> usize {
    match level {
        "none" => 0,
        "minimal" => 1,
        "low" => 2,
        "medium" => 3,
        "high" => 4,
        "xhigh" => 5,
        "max" => 6,
        "ultra" => 7,
        _ => 8,
    }
}

fn parse_opencode_models(
    content: &str,
) -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    let cleaned = strip_ansi(content);
    let mut cursor = 0;
    let mut models = Vec::new();

    while cursor < cleaned.len() {
        let remaining = &cleaned[cursor..];
        let Some(line_end_offset) = remaining.find('\n') else {
            break;
        };
        let model_id = remaining[..line_end_offset].trim();
        cursor += line_end_offset + 1;
        if model_id.is_empty() || !model_id.contains('/') || !is_model_identifier(model_id) {
            continue;
        }

        let json_remaining = &cleaned[cursor..];
        let Some(json_start_offset) = json_remaining.find('{') else {
            break;
        };
        cursor += json_start_offset;
        let mut values =
            serde_json::Deserializer::from_str(&cleaned[cursor..]).into_iter::<Value>();
        let value = values
            .next()
            .ok_or_else(|| format!("Missing OpenCode metadata for model {model_id}."))?
            .map_err(|error| format!("Could not parse OpenCode model {model_id}: {error}"))?;
        cursor += values.byte_offset();

        if value.get("status").and_then(Value::as_str) == Some("deprecated") {
            continue;
        }
        let label = value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(model_id)
            .to_string();
        let mut reasoning_levels = value
            .get("variants")
            .and_then(Value::as_object)
            .map(|variants| variants.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        reasoning_levels.sort_by_key(|level| reasoning_rank(level));
        let default_reasoning_level = reasoning_levels
            .iter()
            .find(|level| level.as_str() == "low")
            .cloned()
            .or_else(|| reasoning_levels.first().cloned());

        models.push(AnalysisAgentModel {
            id: model_id.to_string(),
            label,
            reasoning_levels,
            default_reasoning_level,
        });
    }

    if models.is_empty() {
        return Err("OpenCode did not return any configured models.".to_string());
    }
    let default_model = models.first().map(|model| model.id.clone());
    Ok((models, default_model))
}

fn parse_antigravity_models(
    content: &str,
) -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    let models = strip_ansi(content)
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let id = columns.next()?.trim();
            let label = columns.next()?.trim();
            if columns.next().is_some()
                || id.is_empty()
                || label.is_empty()
                || !is_model_identifier(id)
                || is_antigravity_status_line(id)
            {
                return None;
            }

            Some(AnalysisAgentModel {
                id: id.to_string(),
                label: label.to_string(),
                reasoning_levels: ANTIGRAVITY_REASONING_LEVELS
                    .iter()
                    .map(|level| (*level).to_string())
                    .collect(),
                default_reasoning_level: Some("low".to_string()),
            })
        })
        .collect::<Vec<_>>();

    if models.is_empty() {
        return Err("Antigravity did not return any models.".to_string());
    }
    let default_model = models.first().map(|model| model.id.clone());
    Ok((models, default_model))
}

fn is_model_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.split('/').all(|part| !part.is_empty())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/' | ':')
        })
}

fn is_antigravity_status_line(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "error" | "warning" | "info" | "models" | "available" | "fetching"
    ) || normalized.starts_with("error:")
        || normalized.starts_with("warning:")
}

async fn discover_models(
    definition: AgentDefinition,
    executable: &Path,
) -> Result<(Vec<AnalysisAgentModel>, Option<String>), String> {
    match definition.id {
        "codex" => discover_codex_models(),
        "antigravity" => {
            let output = run_model_command(executable, &["models"], &[]).await?;
            parse_antigravity_models(&output)
        }
        "kiro_cli" => {
            let output = run_model_command(
                executable,
                &["chat", "--list-models", "--format", "json"],
                &[],
            )
            .await?;
            parse_kiro_models(&output)
        }
        "opencode" => {
            let output = run_model_command(
                executable,
                &["models", "--pure", "--verbose"],
                &OPENCODE_MODEL_ENVIRONMENT,
            )
            .await?;
            parse_opencode_models(&output)
        }
        _ => Err(format!("Unsupported analysis agent: {}", definition.id)),
    }
}

async fn capability_for(definition: AgentDefinition) -> AnalysisAgentCapability {
    let Some(executable) = find_executable(definition) else {
        return AnalysisAgentCapability {
            id: definition.id.to_string(),
            label: definition.label.to_string(),
            installed: false,
            executable_name: None,
            models: Vec::new(),
            default_model: None,
            error: None,
        };
    };

    let executable_name = executable
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string);
    match discover_models(definition, &executable).await {
        Ok((models, default_model)) => AnalysisAgentCapability {
            id: definition.id.to_string(),
            label: definition.label.to_string(),
            installed: true,
            executable_name,
            models,
            default_model,
            error: None,
        },
        Err(error) => AnalysisAgentCapability {
            id: definition.id.to_string(),
            label: definition.label.to_string(),
            installed: true,
            executable_name,
            models: Vec::new(),
            default_model: None,
            error: Some(error),
        },
    }
}

fn capability_join_error(
    definition: AgentDefinition,
    error: tokio::task::JoinError,
) -> AnalysisAgentCapability {
    let executable = find_executable(definition);
    AnalysisAgentCapability {
        id: definition.id.to_string(),
        label: definition.label.to_string(),
        installed: executable.is_some(),
        executable_name: executable
            .as_deref()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .map(str::to_string),
        models: Vec::new(),
        default_model: None,
        error: Some(format!("Model discovery task failed: {error}")),
    }
}

pub async fn list_analysis_agents() -> Vec<AnalysisAgentCapability> {
    let tasks = [CODEX, ANTIGRAVITY, KIRO, OPENCODE]
        .into_iter()
        .map(|definition| (definition, tokio::spawn(capability_for(definition))))
        .collect::<Vec<_>>();
    let mut capabilities = Vec::with_capacity(tasks.len());

    for (definition, task) in tasks {
        capabilities.push(match task.await {
            Ok(capability) => capability,
            Err(error) => capability_join_error(definition, error),
        });
    }

    capabilities
}

#[cfg(test)]
mod tests {
    use super::{
        is_analysis_agent, parse_antigravity_models, parse_codex_models, parse_kiro_models,
        parse_opencode_models, read_model_discovery_output, MAX_MODEL_DISCOVERY_OUTPUT_BYTES,
        OPENCODE_MODEL_ENVIRONMENT,
    };

    #[test]
    fn should_parse_codex_models_and_reasoning_levels() {
        let content = r#"{
          "models": [{
            "slug": "gpt-test",
            "display_name": "GPT Test",
            "visibility": "list",
            "default_reasoning_level": "low",
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "high"}]
          }]
        }"#;

        let (models, default_model) = parse_codex_models(content).unwrap();

        assert_eq!(default_model.as_deref(), Some("gpt-test"));
        assert_eq!(models[0].reasoning_levels, vec!["low", "high"]);
    }

    #[test]
    fn should_reject_codex_output_without_usable_models() {
        let error = parse_codex_models(
            r#"{"models":[{"slug":"","display_name":""},{"slug":"bad id","display_name":"Bad"}]}"#,
        )
        .unwrap_err();

        assert!(error.contains("usable models"));
    }

    #[test]
    fn should_parse_kiro_json_model_output() {
        let content =
            r#"{"models":[{"model_name":"Auto","model_id":"auto"}],"default_model":"auto"}"#;

        let (models, default_model) = parse_kiro_models(content).unwrap();

        assert_eq!(default_model.as_deref(), Some("auto"));
        assert_eq!(models[0].default_reasoning_level.as_deref(), Some("low"));
    }

    #[test]
    fn should_reject_kiro_output_without_usable_models() {
        let error = parse_kiro_models(
            r#"{"models":[{"model_name":"","model_id":""}],"default_model":null}"#,
        )
        .unwrap_err();

        assert!(error.contains("usable models"));
    }

    #[test]
    fn should_parse_opencode_model_variants() {
        let content = r#"opencode/test
{
  "name": "Test Model",
  "status": "active",
  "variants": {
    "high": {"reasoningEffort": "high"},
    "low": {"reasoningEffort": "low"}
  }
}
opencode/plain
{
  "name": "Plain Model",
  "status": "active",
  "variants": {}
}
"#;

        let (models, default_model) = parse_opencode_models(content).unwrap();

        assert_eq!(default_model.as_deref(), Some("opencode/test"));
        assert_eq!(models[0].reasoning_levels, vec!["low", "high"]);
        assert!(models[1].reasoning_levels.is_empty());
    }

    #[test]
    fn should_parse_antigravity_model_names() {
        let (models, default_model) = parse_antigravity_models(
            "Fetching available models...\ngemini-3.6-flash-low\tGemini 3.6 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n",
        )
        .unwrap();

        assert_eq!(default_model.as_deref(), Some("gemini-3.6-flash-low"));
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].label, "Gemini 3.6 Flash (Low)");
        assert_eq!(models[0].reasoning_levels, vec!["low", "medium", "high"]);
    }

    #[test]
    fn should_ignore_antigravity_status_and_malformed_lines() {
        let (models, default_model) = parse_antigravity_models(
            "Fetching available models...\nWARNING\tprovider unavailable\nERROR\trequest failed\nnot-a-row\nvalid-model\tValid model\n",
        )
        .unwrap();

        assert_eq!(default_model.as_deref(), Some("valid-model"));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "valid-model");
    }

    #[test]
    fn should_reject_antigravity_output_without_structured_model_rows() {
        let error = parse_antigravity_models(
            "Fetching available models...\nWARNING: provider unavailable\nERROR: request failed\n",
        )
        .unwrap_err();

        assert!(error.contains("did not return any models"));
    }

    #[test]
    fn should_ignore_antigravity_colon_status_rows() {
        let (models, _) = parse_antigravity_models(
            "ERROR:\tprovider unavailable\nWARNING:\tprovider unavailable\nvalid-model\tValid model\n",
        )
        .unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "valid-model");
    }

    #[test]
    fn should_reject_malformed_opencode_model_metadata() {
        let error = parse_opencode_models("opencode/test\n{not-json}\n").unwrap_err();

        assert!(error.contains("Could not parse OpenCode model"));
    }

    #[test]
    fn should_recognize_only_supported_agent_engines() {
        assert!(is_analysis_agent("codex"));
        assert!(is_analysis_agent("antigravity"));
        assert!(is_analysis_agent("kiro_cli"));
        assert!(is_analysis_agent("opencode"));
        assert!(!is_analysis_agent("gemini"));
    }

    #[test]
    fn should_isolate_opencode_model_discovery_from_the_shared_database() {
        assert!(OPENCODE_MODEL_ENVIRONMENT.contains(&("OPENCODE_DB", ":memory:")));
        assert!(OPENCODE_MODEL_ENVIRONMENT.contains(&("OPENCODE_DISABLE_AUTOUPDATE", "true")));
        assert!(OPENCODE_MODEL_ENVIRONMENT.contains(&("OPENCODE_DISABLE_PRUNE", "true")));
    }

    #[test]
    fn should_keep_agent_discovery_future_within_the_worker_stack_budget() {
        const MAX_DISCOVERY_FUTURE_BYTES: usize = 64 * 1024;
        let future = super::list_analysis_agents();

        assert!(
            std::mem::size_of_val(&future) <= MAX_DISCOVERY_FUTURE_BYTES,
            "agent discovery future is {} bytes; maximum is {MAX_DISCOVERY_FUTURE_BYTES}",
            std::mem::size_of_val(&future),
        );
    }

    #[tokio::test]
    async fn should_reject_model_discovery_output_over_the_capture_limit() {
        use tokio::io::{duplex, AsyncWriteExt};

        let (mut writer, reader) = duplex(16 * 1024);
        let writer_task = tokio::spawn(async move {
            let output = vec![b'x'; MAX_MODEL_DISCOVERY_OUTPUT_BYTES + 1];
            let _ = writer.write_all(&output).await;
        });

        let error = read_model_discovery_output(reader, "stdout")
            .await
            .unwrap_err();
        let _ = writer_task.await;

        assert!(error.contains("exceeded the"));
    }
}
