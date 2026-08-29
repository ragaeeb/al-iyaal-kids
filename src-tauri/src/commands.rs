use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::fs as tokio_fs;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::{
    analysis_agents,
    file_discovery::{
        build_output_dir, collect_media_files, collect_media_files_from_inputs, discover_srt_items,
        discover_video_items,
    },
    ids::{to_file_name, to_job_id},
    protocol::WorkerCommand,
    state::{AppState, BackendOperation},
    types::{
        AnalysisAgentCapability, AnalysisPromptPreviewRequest, BatchStartedResponse, BatchState,
        BatchStatus, CancelAck, CancelBatchRequest, CancelTaskRequest, CutJobStartedResponse,
        JobRecord, JobStatus, ListSrtFilesRequest, ListVideosRequest, ModerationRule,
        ModerationSettings, SaveAck, SaveAnalysisSidecarRequest, SaveCutRangesRequest, SrtListItem,
        StartBatchRequest, StartCutJobRequest, StartFlagBatchRequest,
        StartTranscriptionBatchRequest, TaskCancelAck, TaskJobRecord, TaskJobStatus, TaskKind,
        TaskState, TaskStatus, VideoListItem,
    },
    worker::ensure_worker_sender,
};

const MAX_READ_TEXT_FILE_BYTES: u64 = 5 * 1024 * 1024;
const CLOUD_ANALYSIS_PROMPT: &str =
    include_str!("../../python-worker/src/al_iyaal_worker/moderation/prompts/cloud.txt");
const AGENT_ANALYSIS_PROMPT: &str =
    include_str!("../../python-worker/src/al_iyaal_worker/moderation/prompts/agent.txt");
const SUPPORTED_VIDEO_EXTENSIONS: [&str; 2] = [".mp4", ".mov"];
const SUPPORTED_SUBTITLE_EXTENSIONS: [&str; 1] = [".srt"];

fn write_file_atomically(
    destination: &Path,
    content: &[u8],
    unix_mode: Option<u32>,
) -> Result<(), String> {
    let Some(parent) = destination.parent() else {
        return Err(format!(
            "Failed determining parent directory for {}",
            destination.display()
        ));
    };
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed creating parent directory {}: {error}",
            parent.display()
        )
    })?;

    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    let temporary_path = parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    let write_result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(mode) = unix_mode {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode);
        }
        #[cfg(not(unix))]
        let _ = unix_mode;

        let mut temporary_file = options.open(&temporary_path).map_err(|error| {
            format!(
                "Failed creating temporary file {}: {error}",
                temporary_path.display()
            )
        })?;
        temporary_file.write_all(content).map_err(|error| {
            format!(
                "Failed writing temporary file {}: {error}",
                temporary_path.display()
            )
        })?;
        temporary_file.sync_all().map_err(|error| {
            format!(
                "Failed syncing temporary file {}: {error}",
                temporary_path.display()
            )
        })?;
        drop(temporary_file);

        fs::rename(&temporary_path, destination).map_err(|error| {
            format!(
                "Failed replacing {} atomically: {error}",
                destination.display()
            )
        })?;

        let parent_directory = fs::File::open(parent).map_err(|error| {
            format!(
                "Failed opening parent directory {} for sync: {error}",
                parent.display()
            )
        })?;
        parent_directory.sync_all().map_err(|error| {
            format!(
                "Failed syncing parent directory {}: {error}",
                parent.display()
            )
        })
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn ensure_supported_output_mode(output_dir_mode: &str) -> Result<(), String> {
    if output_dir_mode != "audio_replaced_default" {
        return Err("Unsupported output mode. Use audio_replaced_default.".to_string());
    }

    Ok(())
}

fn validate_allowed_extensions(
    requested: &[String],
    supported: &[&str],
    contract_name: &str,
) -> Result<Vec<String>, String> {
    if requested.is_empty() {
        return Err(format!(
            "At least one {contract_name} extension is required."
        ));
    }

    let mut normalized = Vec::with_capacity(requested.len());
    for value in requested {
        let trimmed = value.trim().to_ascii_lowercase();
        let extension = if trimmed.starts_with('.') {
            trimmed
        } else {
            format!(".{trimmed}")
        };
        if !supported.contains(&extension.as_str()) {
            return Err(format!("Unsupported {contract_name} extension: {value}."));
        }
        if !normalized.contains(&extension) {
            normalized.push(extension);
        }
    }
    Ok(normalized)
}

fn ensure_supported_cut_output_mode(output_mode: &str) -> Result<(), String> {
    if output_mode != "video_cleaned_default" {
        return Err("Unsupported cut output mode. Use video_cleaned_default.".to_string());
    }

    Ok(())
}

fn ensure_supported_compression_preset(preset: &str) -> Result<(), String> {
    if preset != "apple_silicon" && preset != "max_compression" && preset != "balanced" {
        return Err(
            "Unsupported compression preset. Use apple_silicon, max_compression, or balanced."
                .to_string(),
        );
    }

    Ok(())
}

fn parse_time_to_seconds(value: &str) -> Result<f64, String> {
    let parts = value.trim().split(':').collect::<Vec<_>>();
    if !(1..=3).contains(&parts.len()) || parts.iter().any(|part| part.is_empty()) {
        return Err("time value must contain one to three components".to_string());
    }

    let values = parts
        .iter()
        .map(|part| {
            part.trim()
                .parse::<f64>()
                .map_err(|_| "time value contains a non-numeric component".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if values.iter().any(|value| !value.is_finite()) {
        return Err("time value must be finite".to_string());
    }
    if values[0] < 0.0
        || values[1..]
            .iter()
            .any(|value| *value < 0.0 || *value >= 60.0)
    {
        return Err("time value contains an invalid component".to_string());
    }

    let mut total = 0.0;
    let mut multiplier = 1.0;
    for value in values.iter().rev() {
        total += value * multiplier;
        multiplier *= 60.0;
    }
    Ok(total)
}

fn validate_cut_ranges(ranges: &[crate::types::CutRange]) -> Result<(), String> {
    for cut_range in ranges {
        let start = parse_time_to_seconds(&cut_range.start).map_err(|error| {
            format!(
                "Invalid range {}-{}: {error}",
                cut_range.start, cut_range.end
            )
        })?;
        let end = parse_time_to_seconds(&cut_range.end).map_err(|error| {
            format!(
                "Invalid range {}-{}: {error}",
                cut_range.start, cut_range.end
            )
        })?;
        if start < 0.0 || end <= start {
            return Err(format!(
                "Invalid range {}-{}: end must be greater than start",
                cut_range.start, cut_range.end
            ));
        }
    }
    Ok(())
}

fn ensure_supported_cancel_mode(mode: &str) -> Result<(), String> {
    if mode != "stop_after_current" {
        return Err("Unsupported cancellation mode. Use stop_after_current.".to_string());
    }

    Ok(())
}

fn ensure_supported_yap_mode(yap_mode: &str) -> Result<(), String> {
    if yap_mode != "auto" {
        return Err("Unsupported yap mode. Use auto.".to_string());
    }

    Ok(())
}

fn resolve_input_paths(
    input_dir: Option<&str>,
    input_paths: Option<&Vec<String>>,
    allowed_extensions: &[String],
    empty_error: &str,
) -> Result<Vec<String>, String> {
    if let Some(paths) = input_paths {
        if paths.is_empty() {
            return Err(empty_error.to_string());
        }
        let resolved_paths = collect_media_files_from_inputs(paths, allowed_extensions)?
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        if resolved_paths.is_empty() {
            return Err(empty_error.to_string());
        }
        return Ok(resolved_paths);
    }

    let directory = input_dir.ok_or_else(|| "Input directory is required.".to_string())?;
    let files = collect_media_files(Path::new(directory), allowed_extensions)?;
    let resolved_paths = files
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if resolved_paths.is_empty() {
        return Err(empty_error.to_string());
    }
    Ok(resolved_paths)
}

fn is_batch_cancellable(status: &BatchStatus) -> bool {
    matches!(status, BatchStatus::Queued | BatchStatus::Running)
}

fn is_task_cancellable(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Queued | TaskStatus::Running)
}

async fn try_send_batch_cancel(state: &AppState, batch_id: String, mode: String) -> bool {
    let Some(batch) = state.get_batch(&batch_id).await else {
        return false;
    };
    if !is_batch_cancellable(&batch.status) {
        return false;
    }
    let Some(worker_sender) = state.worker_sender().await else {
        return false;
    };

    worker_sender
        .send(WorkerCommand::CancelBatch { batch_id, mode })
        .is_ok()
}

async fn try_send_task_cancel(state: &AppState, task_id: String, mode: String) -> bool {
    let Some(task) = state.get_task(&task_id).await else {
        return false;
    };
    if !is_task_cancellable(&task.status) {
        return false;
    }
    let Some(worker_sender) = state.worker_sender().await else {
        return false;
    };

    worker_sender
        .send(WorkerCommand::CancelTask { task_id, mode })
        .is_ok()
}

fn is_allowed_trash_file_path(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    matches!(extension.as_deref(), Some("mp4" | "mov" | "srt"))
        || file_name.ends_with(".analysis.json")
        || file_name.ends_with(".ranges.json")
}

fn validate_trash_file_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("File path is required.".to_string());
    }

    let candidate = PathBuf::from(path);
    if !is_allowed_trash_file_path(&candidate) {
        return Err(
            "Only .mp4, .mov, .srt, .analysis.json, and .ranges.json files can be trashed."
                .to_string(),
        );
    }
    if candidate.exists() && !candidate.is_file() {
        return Err(format!("Path is not a file: {}", candidate.display()));
    }
    if !candidate.exists() {
        return Ok(candidate);
    }

    candidate
        .canonicalize()
        .map_err(|error| format!("Failed resolving file path {path}: {error}"))
}

fn is_allowed_text_sidecar_path(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    matches!(extension.as_deref(), Some("srt"))
        || file_name.ends_with(".analysis.json")
        || file_name.ends_with(".ranges.json")
}

fn cut_ranges_sidecar_path(video_path: &Path) -> PathBuf {
    video_path.with_extension("ranges.json")
}

fn is_allowed_preview_video_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("mp4" | "mov")
    )
}

fn validate_read_text_file_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("File path is required.".to_string());
    }

    let canonical = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Failed resolving file path {path}: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    if !is_allowed_text_sidecar_path(&canonical) {
        return Err(
            "Only .srt, .analysis.json, and .ranges.json sidecar files can be read.".to_string(),
        );
    }

    Ok(canonical)
}

fn validate_analysis_import_path(path: &str) -> Result<PathBuf, String> {
    let canonical = validate_existing_file_path(path)?;
    let is_json = canonical
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err("Only JSON files can be imported as analyses.".to_string());
    }
    Ok(canonical)
}

fn build_analysis_prompt_preview(request: &AnalysisPromptPreviewRequest) -> String {
    if request.engine == "blacklist" {
        return "Blacklist analysis is deterministic and does not send a prompt to a model."
            .to_string();
    }
    let is_agent = matches!(
        request.engine.as_str(),
        "codex" | "antigravity" | "kiro_cli" | "opencode"
    );
    let template = if is_agent {
        AGENT_ANALYSIS_PROMPT
    } else {
        CLOUD_ANALYSIS_PROMPT
    };
    template
        .replace("{{criteria}}", &request.content_criteria)
        .replace("{{guidelines}}", &request.priority_guidelines)
}

fn validate_analysis_bundle_content(content: &str) -> Result<(), String> {
    if content.len() > MAX_READ_TEXT_FILE_BYTES as usize {
        return Err("Analysis sidecar is too large to save safely.".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Analysis sidecar is not valid JSON: {error}"))?;
    if parsed
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(2)
        || parsed
            .get("sourceFile")
            .and_then(serde_json::Value::as_str)
            .is_none()
        || parsed
            .get("analyses")
            .and_then(serde_json::Value::as_array)
            .is_none()
    {
        return Err(
            "Analysis sidecar must use schemaVersion 2 with sourceFile and analyses.".to_string(),
        );
    }
    Ok(())
}

fn validate_preview_video_path(path: &str) -> Result<PathBuf, String> {
    let canonical = validate_existing_file_path(path)?;
    if !is_allowed_preview_video_path(&canonical) {
        return Err("Only .mp4 and .mov files can be previewed.".to_string());
    }

    Ok(canonical)
}

fn validate_existing_file_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("File path is required.".to_string());
    }

    let canonical = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Failed resolving file path {path}: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    Ok(canonical)
}

fn create_batch_jobs(input_paths: &[String]) -> Vec<JobRecord> {
    input_paths
        .iter()
        .map(|input_path| JobRecord {
            job_id: to_job_id(input_path),
            file_name: to_file_name(input_path),
            input_path: input_path.clone(),
            output_path: None,
            status: JobStatus::Queued,
            progress_pct: 0,
            error: None,
        })
        .collect::<Vec<_>>()
}

fn create_task_jobs(input_paths: &[String]) -> Vec<TaskJobRecord> {
    input_paths
        .iter()
        .map(|input_path| TaskJobRecord {
            artifacts: None,
            job_id: to_job_id(input_path),
            file_name: to_file_name(input_path),
            input_path: input_path.clone(),
            output_path: None,
            status: TaskJobStatus::Queued,
            progress_pct: 0,
            error: None,
            logs: Vec::new(),
        })
        .collect::<Vec<_>>()
}

fn default_moderation_settings() -> ModerationSettings {
    ModerationSettings {
        agent_model: String::new(),
        agent_reasoning_level: String::new(),
        amazon_nova_api_key: String::new(),
        analysis_strategy: "fast".to_string(),
        engine: "blacklist".to_string(),
        content_criteria: "1. Adult relationships (kissing, romantic/sexual content, dating)\n2. Bad morals or unethical behavior\n3. Content against Islamic values and aqeedah\n4. Magic, sorcery, divination, or supernatural practices\n5. Music references, musical performances, or instruments\n6. Alcohol, intoxicants, or drug use\n7. Violence or frightening content\n8. Inappropriate language or themes".to_string(),
        google_api_key: String::new(),
        priority_guidelines: "Priority Guidelines:\n- HIGH: Major aqeedah violations, explicit magic/sorcery, sexual content, alcohol, or intoxicants\n- MEDIUM: Music, instruments, offensive language, questionable behavior, or moderate violence\n- LOW: Mild concerns or ambiguous references".to_string(),
        profanity_words: Vec::new(),
        rules: vec![
            ModerationRule {
                rule_id: "aqeedah_christmas".to_string(),
                category: "aqeedah".to_string(),
                priority: "high".to_string(),
                reason: "Promotes non-Islamic religious celebration.".to_string(),
                patterns: vec![
                    "christmas".to_string(),
                    "xmas".to_string(),
                    "easter".to_string(),
                    "halloween".to_string(),
                    "santa".to_string(),
                    "santa claus".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "magic_sorcery".to_string(),
                category: "magic".to_string(),
                priority: "high".to_string(),
                reason: "References magic or sorcery.".to_string(),
                patterns: vec![
                    "magic".to_string(),
                    "magical".to_string(),
                    "magician".to_string(),
                    "magicians".to_string(),
                    "spell".to_string(),
                    "spells".to_string(),
                    "sorcery".to_string(),
                    "sorcerer".to_string(),
                    "sorceress".to_string(),
                    "witchcraft".to_string(),
                    "witch".to_string(),
                    "witches".to_string(),
                    "wizard".to_string(),
                    "wizards".to_string(),
                    "wizardry".to_string(),
                    "warlock".to_string(),
                    "enchantment".to_string(),
                    "enchanted".to_string(),
                    "curse".to_string(),
                    "cursed".to_string(),
                    "occult".to_string(),
                    "voodoo".to_string(),
                    "necromancy".to_string(),
                    "necromancer".to_string(),
                    "summoning".to_string(),
                    "summon demons".to_string(),
                    "demon".to_string(),
                    "demons".to_string(),
                    "satanic".to_string(),
                    "satanism".to_string(),
                    "séance".to_string(),
                    "seance".to_string(),
                    "fortune teller".to_string(),
                    "fortune-teller".to_string(),
                    "tarot".to_string(),
                    "astrology".to_string(),
                    "horoscope".to_string(),
                    "potion".to_string(),
                    "potions".to_string(),
                    "ritual".to_string(),
                    "rituals".to_string(),
                    "paranormal".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "sexual_content".to_string(),
                category: "sexual".to_string(),
                priority: "high".to_string(),
                reason: "References sexual or sexually explicit content.".to_string(),
                patterns: vec![
                    "sex".to_string(),
                    "sexual".to_string(),
                    "sexual activity".to_string(),
                    "sexual intercourse".to_string(),
                    "intercourse".to_string(),
                    "porn".to_string(),
                    "pornography".to_string(),
                    "pornographic".to_string(),
                    "xxx".to_string(),
                    "x-rated".to_string(),
                    "nude".to_string(),
                    "nudes".to_string(),
                    "nudity".to_string(),
                    "naked".to_string(),
                    "topless".to_string(),
                    "masturbate".to_string(),
                    "masturbation".to_string(),
                    "orgasm".to_string(),
                    "ejaculate".to_string(),
                    "ejaculation".to_string(),
                    "erection".to_string(),
                    "penis".to_string(),
                    "vagina".to_string(),
                    "vulva".to_string(),
                    "genital".to_string(),
                    "genitals".to_string(),
                    "breasts".to_string(),
                    "boobs".to_string(),
                    "nipple".to_string(),
                    "nipples".to_string(),
                    "anus".to_string(),
                    "anal sex".to_string(),
                    "oral sex".to_string(),
                    "blowjob".to_string(),
                    "handjob".to_string(),
                    "prostitute".to_string(),
                    "prostitution".to_string(),
                    "stripper".to_string(),
                    "strip club".to_string(),
                    "sext".to_string(),
                    "sexting".to_string(),
                    "rape".to_string(),
                    "sexual assault".to_string(),
                    "molest".to_string(),
                    "molestation".to_string(),
                    "incest".to_string(),
                    "pedophile".to_string(),
                    "pedophilia".to_string(),
                    "fetish".to_string(),
                    "bdsm".to_string(),
                    "bondage".to_string(),
                    "erotic".to_string(),
                    "erotica".to_string(),
                    "adultery".to_string(),
                    "fornication".to_string(),
                    "love affair".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "music_content".to_string(),
                category: "music".to_string(),
                priority: "medium".to_string(),
                reason: "References music or a musical performance.".to_string(),
                patterns: vec![
                    "music".to_string(),
                    "musical".to_string(),
                    "musician".to_string(),
                    "musicians".to_string(),
                    "song".to_string(),
                    "songs".to_string(),
                    "sing".to_string(),
                    "sings".to_string(),
                    "sang".to_string(),
                    "singing".to_string(),
                    "singer".to_string(),
                    "singers".to_string(),
                    "concert".to_string(),
                    "band".to_string(),
                    "orchestra".to_string(),
                    "choir".to_string(),
                    "karaoke".to_string(),
                    "soundtrack".to_string(),
                    "melody".to_string(),
                    "melodies".to_string(),
                    "rhythm".to_string(),
                    "rhythms".to_string(),
                    "beat".to_string(),
                    "beats".to_string(),
                    "rap".to_string(),
                    "rapper".to_string(),
                    "pop music".to_string(),
                    "rock music".to_string(),
                    "jazz".to_string(),
                    "classical music".to_string(),
                    "dance music".to_string(),
                    "music video".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "musical_instruments".to_string(),
                category: "instruments".to_string(),
                priority: "medium".to_string(),
                reason: "References a musical instrument or instrumental performance.".to_string(),
                patterns: vec![
                    "instrument".to_string(),
                    "instruments".to_string(),
                    "musical instrument".to_string(),
                    "musical instruments".to_string(),
                    "piano".to_string(),
                    "guitar".to_string(),
                    "electric guitar".to_string(),
                    "bass guitar".to_string(),
                    "drum".to_string(),
                    "drums".to_string(),
                    "drummer".to_string(),
                    "violin".to_string(),
                    "viola".to_string(),
                    "cello".to_string(),
                    "double bass".to_string(),
                    "flute".to_string(),
                    "recorder".to_string(),
                    "trumpet".to_string(),
                    "trombone".to_string(),
                    "saxophone".to_string(),
                    "clarinet".to_string(),
                    "oboe".to_string(),
                    "bassoon".to_string(),
                    "harp".to_string(),
                    "lute".to_string(),
                    "oud".to_string(),
                    "ukulele".to_string(),
                    "banjo".to_string(),
                    "accordion".to_string(),
                    "harmonica".to_string(),
                    "tambourine".to_string(),
                    "cymbal".to_string(),
                    "percussion".to_string(),
                    "xylophone".to_string(),
                    "marimba".to_string(),
                    "synthesizer".to_string(),
                    "bagpipes".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "alcohol_intoxicants".to_string(),
                category: "intoxicants".to_string(),
                priority: "high".to_string(),
                reason: "References alcohol, intoxicants, or drug use.".to_string(),
                patterns: vec![
                    "alcohol".to_string(),
                    "alcoholic".to_string(),
                    "alcoholism".to_string(),
                    "beer".to_string(),
                    "wine".to_string(),
                    "whiskey".to_string(),
                    "whisky".to_string(),
                    "vodka".to_string(),
                    "rum".to_string(),
                    "gin".to_string(),
                    "tequila".to_string(),
                    "brandy".to_string(),
                    "champagne".to_string(),
                    "prosecco".to_string(),
                    "cognac".to_string(),
                    "liqueur".to_string(),
                    "liquor".to_string(),
                    "booze".to_string(),
                    "cocktail".to_string(),
                    "cocktails".to_string(),
                    "martini".to_string(),
                    "margarita".to_string(),
                    "sake".to_string(),
                    "absinthe".to_string(),
                    "ale".to_string(),
                    "lager".to_string(),
                    "stout".to_string(),
                    "drunk".to_string(),
                    "drunken".to_string(),
                    "intoxicated".to_string(),
                    "intoxication".to_string(),
                    "tipsy".to_string(),
                    "hangover".to_string(),
                    "marijuana".to_string(),
                    "cannabis".to_string(),
                    "weed".to_string(),
                    "hashish".to_string(),
                    "opium".to_string(),
                    "heroin".to_string(),
                    "cocaine".to_string(),
                    "methamphetamine".to_string(),
                    "ecstasy".to_string(),
                    "mdma".to_string(),
                    "lsd".to_string(),
                    "fentanyl".to_string(),
                    "narcotic".to_string(),
                    "narcotics".to_string(),
                    "drug use".to_string(),
                    "drug abuse".to_string(),
                    "stoned".to_string(),
                ],
            },
            ModerationRule {
                rule_id: "offensive_language".to_string(),
                category: "language".to_string(),
                priority: "medium".to_string(),
                reason: "Contains offensive language.".to_string(),
                patterns: vec![
                    "stupid".to_string(),
                    "idiot".to_string(),
                    "idiots".to_string(),
                    "dumb".to_string(),
                    "dumbass".to_string(),
                    "moron".to_string(),
                    "morons".to_string(),
                    "imbecile".to_string(),
                    "jerk".to_string(),
                    "loser".to_string(),
                    "shut up".to_string(),
                    "crap".to_string(),
                    "damn".to_string(),
                    "bullshit".to_string(),
                    "asshole".to_string(),
                    "bastard".to_string(),
                    "bitch".to_string(),
                    "douchebag".to_string(),
                    "fool".to_string(),
                    "screw you".to_string(),
                    "son of a bitch".to_string(),
                ],
            },
        ],
    }
}

fn is_supported_moderation_engine(value: &str) -> bool {
    matches!(
        value,
        "blacklist" | "gemini" | "nova_pro" | "codex" | "antigravity" | "kiro_cli" | "opencode"
    )
}

fn is_supported_analysis_strategy(value: &str) -> bool {
    matches!(value, "fast" | "deep")
}

fn validate_agent_setting(value: &str, label: &str, max_length: usize) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required for installed-agent analysis."));
    }
    if trimmed.chars().count() > max_length || trimmed.contains(['\0', '\n', '\r']) {
        return Err(format!("{label} is invalid."));
    }
    Ok(())
}

fn validate_moderation_settings(settings: &ModerationSettings) -> Result<(), String> {
    if !is_supported_moderation_engine(&settings.engine) {
        return Err(format!(
            "Unsupported moderation engine: {}",
            settings.engine
        ));
    }
    if !is_supported_analysis_strategy(&settings.analysis_strategy) {
        return Err(format!(
            "Unsupported moderation analysis strategy: {}",
            settings.analysis_strategy
        ));
    }
    if analysis_agents::is_analysis_agent(&settings.engine) {
        validate_agent_setting(&settings.agent_model, "Agent model", 256)?;
        if !settings.agent_reasoning_level.trim().is_empty() {
            validate_agent_setting(&settings.agent_reasoning_level, "Agent reasoning level", 64)?;
        }
    }
    Ok(())
}

fn apply_flag_run_overrides(
    settings: &mut ModerationSettings,
    engine: Option<String>,
    analysis_strategy: Option<String>,
) -> Result<(), String> {
    if let Some(engine) = engine {
        if !is_supported_moderation_engine(&engine) {
            return Err(format!("Unsupported moderation engine: {engine}"));
        }
        settings.engine = engine;
    }
    if let Some(analysis_strategy) = analysis_strategy {
        if !is_supported_analysis_strategy(&analysis_strategy) {
            return Err(format!(
                "Unsupported moderation analysis strategy: {analysis_strategy}"
            ));
        }
        settings.analysis_strategy = analysis_strategy;
    }
    Ok(())
}

fn moderation_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    Ok(app_data_dir.join("settings/moderation.json"))
}

fn merge_default_moderation_rules(settings: &mut ModerationSettings) {
    if settings.rules.is_empty() {
        return;
    }

    for default_rule in default_moderation_settings().rules {
        let existing_index = settings
            .rules
            .iter()
            .position(|rule| rule.rule_id == default_rule.rule_id);

        let Some(existing_index) = existing_index else {
            settings.rules.push(default_rule);
            continue;
        };

        let existing_rule = &mut settings.rules[existing_index];
        for pattern in default_rule.patterns {
            if !existing_rule
                .patterns
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&pattern))
            {
                existing_rule.patterns.push(pattern);
            }
        }
    }
}

fn read_or_initialize_moderation_settings(app: &AppHandle) -> Result<ModerationSettings, String> {
    let settings_path = moderation_settings_path(app)?;
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|error| {
            format!(
                "Failed reading moderation settings {}: {error}",
                settings_path.display()
            )
        })?;
        let mut settings = serde_json::from_str(&content)
            .map_err(|error| format!("Invalid moderation settings JSON: {error}"))?;
        merge_default_moderation_rules(&mut settings);
        return Ok(settings);
    }

    let defaults = default_moderation_settings();
    write_moderation_settings(app, &defaults)?;
    Ok(defaults)
}

fn write_moderation_settings(app: &AppHandle, settings: &ModerationSettings) -> Result<(), String> {
    let settings_path = moderation_settings_path(app)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed serializing moderation settings: {error}"))?;
    write_file_atomically(&settings_path, content.as_bytes(), Some(0o600))
}

async fn get_batch_state_inner(state: &AppState, batch_id: &str) -> Option<BatchState> {
    state.get_batch(batch_id).await
}

async fn get_task_state_inner(state: &AppState, task_id: &str) -> Option<TaskState> {
    state.get_task(task_id).await
}

async fn enqueue_batch_command(
    state: &AppState,
    worker_sender: &crate::state::WorkerSender,
    batch: BatchState,
    command: WorkerCommand,
) -> Result<(), String> {
    let batch_id = batch.batch_id.clone();
    let operation = BackendOperation::Batch(batch_id.clone());
    if !state.try_admit_backend_operation(operation.clone()).await {
        return Err("Another media operation is already queued or running.".to_string());
    }
    state.insert_batch(batch).await;
    match worker_sender.send(command) {
        Ok(()) => Ok(()),
        Err(error) => {
            state.remove_batch(&batch_id).await;
            state.release_backend_operation(&operation).await;
            Err(format!("Failed to enqueue start batch command: {error}"))
        }
    }
}

async fn enqueue_task_command(
    state: &AppState,
    worker_sender: &crate::state::WorkerSender,
    task: TaskState,
    command: WorkerCommand,
    error_label: &str,
) -> Result<(), String> {
    let task_id = task.task_id.clone();
    let operation = BackendOperation::Task(task_id.clone());
    if !state.try_admit_backend_operation(operation.clone()).await {
        return Err("Another media operation is already queued or running.".to_string());
    }
    state.insert_task(task).await;
    match worker_sender.send(command) {
        Ok(()) => Ok(()),
        Err(error) => {
            state.remove_task(&task_id).await;
            state.release_backend_operation(&operation).await;
            Err(format!("Failed to enqueue {error_label}: {error}"))
        }
    }
}

#[tauri::command]
pub async fn start_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartBatchRequest,
) -> Result<BatchStartedResponse, String> {
    ensure_supported_output_mode(&request.output_dir_mode)?;
    let allowed_extensions = validate_allowed_extensions(
        &request.allowed_extensions,
        &SUPPORTED_VIDEO_EXTENSIONS,
        "video",
    )?;
    let input_paths = resolve_input_paths(
        request.input_dir.as_deref(),
        request.input_paths.as_ref(),
        &allowed_extensions,
        "No .mp4/.mov files were selected.",
    )?;
    let first_input_path = input_paths
        .first()
        .ok_or_else(|| "No .mp4/.mov files were selected.".to_string())?;
    let output_dir = build_output_dir(Path::new(first_input_path).parent().ok_or_else(|| {
        format!("Failed to resolve parent directory for input path: {first_input_path}")
    })?);
    let batch_id = Uuid::new_v4().to_string();

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;

    enqueue_batch_command(
        state.inner(),
        &worker_sender,
        BatchState {
            batch_id: batch_id.clone(),
            status: BatchStatus::Queued,
            jobs: create_batch_jobs(&input_paths),
            summary: None,
        },
        WorkerCommand::StartBatch {
            batch_id: batch_id.clone(),
            input_paths: input_paths.clone(),
            output_dir: output_dir.to_string_lossy().to_string(),
            compute_mode: "auto".to_string(),
        },
    )
    .await?;

    Ok(BatchStartedResponse {
        batch_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_transcription_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartTranscriptionBatchRequest,
) -> Result<BatchStartedResponse, String> {
    ensure_supported_yap_mode(&request.yap_mode)?;
    let allowed_extensions = request
        .allowed_extensions
        .map(|extensions| {
            validate_allowed_extensions(&extensions, &SUPPORTED_VIDEO_EXTENSIONS, "video")
        })
        .transpose()?
        .unwrap_or_else(|| {
            SUPPORTED_VIDEO_EXTENSIONS
                .iter()
                .map(|extension| (*extension).to_string())
                .collect()
        });
    let input_paths = resolve_input_paths(
        request.input_dir.as_deref(),
        request.input_paths.as_ref(),
        &allowed_extensions,
        "No .mp4/.mov files were selected.",
    )?;

    let task_id = Uuid::new_v4().to_string();

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    enqueue_task_command(
        state.inner(),
        &worker_sender,
        TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Transcription,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        },
        WorkerCommand::StartTranscriptionBatch {
            task_id: task_id.clone(),
            input_paths: input_paths.clone(),
            yap_mode: request.yap_mode,
        },
        "transcription task",
    )
    .await?;

    Ok(BatchStartedResponse {
        batch_id: task_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_flag_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartFlagBatchRequest,
) -> Result<BatchStartedResponse, String> {
    let allowed_extensions = request
        .allowed_extensions
        .map(|extensions| {
            validate_allowed_extensions(&extensions, &SUPPORTED_SUBTITLE_EXTENSIONS, "subtitle")
        })
        .transpose()?
        .unwrap_or_else(|| vec![".srt".to_string()]);
    let input_paths = resolve_input_paths(
        request.input_dir.as_deref(),
        request.input_paths.as_ref(),
        &allowed_extensions,
        "No .srt files were selected.",
    )?;

    let mut settings = read_or_initialize_moderation_settings(&app)?;
    apply_flag_run_overrides(&mut settings, request.engine, request.analysis_strategy)?;
    validate_moderation_settings(&settings)?;
    let agent_executable_path = if analysis_agents::is_analysis_agent(&settings.engine) {
        Some(
            analysis_agents::resolve_agent_executable(&settings.engine)?
                .to_string_lossy()
                .to_string(),
        )
    } else {
        None
    };
    let task_id = Uuid::new_v4().to_string();

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    enqueue_task_command(
        state.inner(),
        &worker_sender,
        TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Flag,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        },
        WorkerCommand::StartFlagBatch {
            agent_executable_path,
            task_id: task_id.clone(),
            input_paths: input_paths.clone(),
            settings,
        },
        "flag task",
    )
    .await?;

    Ok(BatchStartedResponse {
        batch_id: task_id,
        file_count: input_paths.len(),
        input_paths,
    })
}

#[tauri::command]
pub async fn start_cut_job(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartCutJobRequest,
) -> Result<CutJobStartedResponse, String> {
    ensure_supported_cut_output_mode(&request.output_mode)?;
    ensure_supported_compression_preset(&request.compression_preset)?;
    if request.ranges.is_empty() {
        return Err("Cut job requires at least one range.".to_string());
    }
    validate_cut_ranges(&request.ranges)?;
    let video_path = validate_preview_video_path(&request.video_path)?;
    let canonical_video_path = video_path.to_string_lossy().to_string();

    let task_id = Uuid::new_v4().to_string();
    let input_paths = vec![canonical_video_path.clone()];

    let worker_sender = ensure_worker_sender(app.clone(), state.inner().clone()).await?;
    enqueue_task_command(
        state.inner(),
        &worker_sender,
        TaskState {
            task_id: task_id.clone(),
            task_kind: TaskKind::Cut,
            status: TaskStatus::Queued,
            jobs: create_task_jobs(&input_paths),
            summary: None,
        },
        WorkerCommand::StartCutJob {
            task_id: task_id.clone(),
            video_path: canonical_video_path.clone(),
            ranges: request.ranges,
            output_mode: request.output_mode,
            compression_preset: request.compression_preset,
        },
        "cut task",
    )
    .await?;

    Ok(CutJobStartedResponse {
        task_id,
        video_path: canonical_video_path,
    })
}

#[tauri::command]
pub async fn cancel_batch(
    state: State<'_, AppState>,
    request: CancelBatchRequest,
) -> Result<CancelAck, String> {
    ensure_supported_cancel_mode(&request.mode)?;

    let accepted =
        try_send_batch_cancel(state.inner(), request.batch_id.clone(), request.mode).await;

    Ok(CancelAck {
        batch_id: request.batch_id,
        accepted,
    })
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, AppState>,
    request: CancelTaskRequest,
) -> Result<TaskCancelAck, String> {
    ensure_supported_cancel_mode(&request.mode)?;
    let accepted = try_send_task_cancel(state.inner(), request.task_id.clone(), request.mode).await;

    Ok(TaskCancelAck {
        task_id: request.task_id,
        accepted,
    })
}

#[tauri::command]
pub async fn get_batch_state(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Option<BatchState>, String> {
    Ok(get_batch_state_inner(state.inner(), &batch_id).await)
}

#[tauri::command]
pub async fn get_task_state(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<TaskState>, String> {
    Ok(get_task_state_inner(state.inner(), &task_id).await)
}

#[tauri::command]
pub async fn list_videos(request: ListVideosRequest) -> Result<Vec<VideoListItem>, String> {
    let allowed_extensions = validate_allowed_extensions(
        &request.allowed_extensions,
        &SUPPORTED_VIDEO_EXTENSIONS,
        "video",
    )?;
    let input_dir = Path::new(&request.input_dir);
    discover_video_items(input_dir, &allowed_extensions)
}

#[tauri::command]
pub async fn list_srt_files(request: ListSrtFilesRequest) -> Result<Vec<SrtListItem>, String> {
    let input_dir = Path::new(&request.input_dir);
    discover_srt_items(input_dir)
}

#[tauri::command]
pub async fn get_moderation_settings(app: AppHandle) -> Result<ModerationSettings, String> {
    read_or_initialize_moderation_settings(&app)
}

#[tauri::command]
pub async fn list_analysis_agents() -> Result<Vec<AnalysisAgentCapability>, String> {
    Ok(analysis_agents::list_analysis_agents().await)
}

#[tauri::command]
pub async fn save_moderation_settings(
    app: AppHandle,
    request: ModerationSettings,
) -> Result<SaveAck, String> {
    validate_moderation_settings(&request)?;
    write_moderation_settings(&app, &request)?;
    Ok(SaveAck { success: true })
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let validated_path = validate_read_text_file_path(&path)?;
    read_bounded_text_file(&validated_path).await
}

async fn read_bounded_text_file(validated_path: &Path) -> Result<String, String> {
    let metadata = tokio_fs::metadata(validated_path).await.map_err(|error| {
        format!(
            "Failed reading file metadata {}: {error}",
            validated_path.display()
        )
    })?;
    if metadata.len() > MAX_READ_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large to read safely (max {} bytes): {}",
            MAX_READ_TEXT_FILE_BYTES,
            validated_path.display()
        ));
    }
    tokio_fs::read_to_string(validated_path)
        .await
        .map_err(|error| format!("Failed reading file {}: {error}", validated_path.display()))
}

#[tauri::command]
pub async fn read_analysis_import_file(path: String) -> Result<String, String> {
    let validated_path = validate_analysis_import_path(&path)?;
    read_bounded_text_file(&validated_path).await
}

#[tauri::command]
pub async fn save_analysis_sidecar(request: SaveAnalysisSidecarRequest) -> Result<SaveAck, String> {
    let video_path = validate_preview_video_path(&request.video_path)?;
    validate_analysis_bundle_content(&request.content)?;
    let destination = video_path.with_extension("analysis.json");
    write_file_atomically(&destination, request.content.as_bytes(), None)?;
    Ok(SaveAck { success: true })
}

#[tauri::command]
pub fn get_analysis_prompt_preview(request: AnalysisPromptPreviewRequest) -> String {
    build_analysis_prompt_preview(&request)
}

#[tauri::command]
pub async fn save_cut_ranges(request: SaveCutRangesRequest) -> Result<SaveAck, String> {
    let video_path = validate_preview_video_path(&request.video_path)?;
    validate_cut_ranges(&request.ranges)?;
    let sidecar_path = cut_ranges_sidecar_path(&video_path);
    let content = serde_json::to_string_pretty(&serde_json::json!({ "ranges": request.ranges }))
        .map_err(|error| format!("Failed serializing cut ranges: {error}"))?;

    write_file_atomically(&sidecar_path, content.as_bytes(), None)?;

    Ok(SaveAck { success: true })
}

#[tauri::command]
pub async fn get_media_preview_url(path: String) -> Result<String, String> {
    let validated_path = validate_preview_video_path(&path)?;
    crate::media_preview::register_media_preview_path(validated_path)
}

#[tauri::command]
pub async fn trash_file(path: String) -> Result<SaveAck, String> {
    let validated_path = validate_trash_file_path(&path)?;
    if !validated_path.exists() {
        return Ok(SaveAck { success: true });
    }
    trash::delete(&validated_path).map_err(|error| {
        format!(
            "Failed moving file to trash {}: {error}",
            validated_path.display()
        )
    })?;
    Ok(SaveAck { success: true })
}

#[tauri::command]
pub async fn open_folder_picker(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |result| {
        let path = result.and_then(|file_path| {
            file_path
                .into_path()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        });
        let _ = tx.send(path);
    });

    rx.await
        .map_err(|error| format!("Folder picker channel failed: {error}"))
}

#[tauri::command]
pub async fn get_log_history(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.get_log_history().await)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_flag_run_overrides, build_analysis_prompt_preview, create_task_jobs,
        cut_ranges_sidecar_path, default_moderation_settings, enqueue_task_command,
        ensure_supported_cancel_mode, ensure_supported_compression_preset,
        ensure_supported_cut_output_mode, ensure_supported_output_mode, ensure_supported_yap_mode,
        get_batch_state_inner, get_task_state_inner, merge_default_moderation_rules,
        parse_time_to_seconds, resolve_input_paths, save_analysis_sidecar, save_cut_ranges,
        try_send_batch_cancel, try_send_task_cancel, validate_allowed_extensions,
        validate_analysis_import_path, validate_cut_ranges, validate_existing_file_path,
        validate_moderation_settings, validate_preview_video_path, validate_read_text_file_path,
        validate_trash_file_path, write_file_atomically, SUPPORTED_VIDEO_EXTENSIONS,
    };
    use crate::{
        protocol::WorkerCommand,
        state::AppState,
        types::{
            AnalysisPromptPreviewRequest, BatchState, BatchStatus, CutRange,
            SaveAnalysisSidecarRequest, SaveCutRangesRequest, TaskKind, TaskState, TaskStatus,
        },
    };
    use std::path::Path;
    use uuid::Uuid;

    #[test]
    fn should_reject_unsupported_output_mode() {
        let result = ensure_supported_output_mode("custom_mode");
        assert!(result.is_err());
    }

    #[test]
    fn should_preserve_saved_antigravity_settings_without_a_per_run_override() {
        let mut settings = default_moderation_settings();
        settings.engine = "antigravity".to_string();
        settings.agent_model = "gemini-3.6-flash".to_string();
        settings.agent_reasoning_level = "low".to_string();

        apply_flag_run_overrides(&mut settings, None, None).unwrap();

        assert_eq!(settings.engine, "antigravity");
        assert_eq!(settings.agent_model, "gemini-3.6-flash");
        assert_eq!(settings.agent_reasoning_level, "low");
    }

    #[test]
    fn should_validate_requested_extensions_against_the_fixed_video_contract() {
        assert_eq!(
            validate_allowed_extensions(
                &["MP4".to_string(), "mov".to_string(), ".mp4".to_string()],
                &SUPPORTED_VIDEO_EXTENSIONS,
                "video",
            )
            .unwrap(),
            vec![".mp4".to_string(), ".mov".to_string()]
        );
        assert!(validate_allowed_extensions(&[], &SUPPORTED_VIDEO_EXTENSIONS, "video").is_err());
        assert!(validate_allowed_extensions(
            &[".mkv".to_string()],
            &SUPPORTED_VIDEO_EXTENSIONS,
            "video"
        )
        .is_err());
    }

    #[test]
    fn should_parse_worker_compatible_time_components() {
        assert_eq!(parse_time_to_seconds("1"), Ok(1.0));
        assert_eq!(parse_time_to_seconds("1:02"), Ok(62.0));
        assert_eq!(parse_time_to_seconds("1:02:03.5"), Ok(3723.5));
    }

    #[test]
    fn should_reject_invalid_cut_ranges_before_enqueue() {
        for (start, end) in [
            ("NaN", "2"),
            ("inf", "2"),
            ("0", "NaN"),
            ("0", "inf"),
            ("0:60", "1:01"),
            ("0:01:60", "0:02:00"),
            ("0:1:2:3", "0:2"),
            ("0::1", "0:2"),
            ("2", "1"),
        ] {
            let result = validate_cut_ranges(&[CutRange {
                start: start.to_string(),
                end: end.to_string(),
            }]);
            assert!(result.is_err(), "expected {start}-{end} to be rejected");
        }
    }

    #[test]
    fn should_accept_nonnegative_forward_cut_ranges() {
        assert!(validate_cut_ranges(&[
            CutRange {
                start: "0".to_string(),
                end: "0:00:01".to_string(),
            },
            CutRange {
                start: "1:02.5".to_string(),
                end: "1:03".to_string(),
            },
        ])
        .is_ok());
    }

    #[test]
    fn should_replace_a_file_atomically_in_its_own_directory() {
        let base_dir = std::env::temp_dir().join(format!("al-iyaal-atomic-{}", Uuid::new_v4()));
        let path = base_dir.join("settings.json");
        std::fs::create_dir_all(&base_dir).unwrap();
        std::fs::write(&path, "old").unwrap();

        write_file_atomically(&path, b"new", Some(0o600)).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert!(!base_dir.read_dir().unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".tmp-")));
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn should_preserve_the_previous_file_when_staging_cannot_write() {
        use std::os::unix::fs::PermissionsExt;

        let base_dir = std::env::temp_dir().join(format!("al-iyaal-atomic-{}", Uuid::new_v4()));
        let path = base_dir.join("settings.json");
        std::fs::create_dir_all(&base_dir).unwrap();
        std::fs::write(&path, "valid settings").unwrap();
        let original_permissions = std::fs::metadata(&base_dir).unwrap().permissions();
        let mut read_only_permissions = original_permissions.clone();
        read_only_permissions.set_mode(original_permissions.mode() & !0o222);
        std::fs::set_permissions(&base_dir, read_only_permissions).unwrap();

        let result = write_file_atomically(&path, b"replacement", Some(0o600));

        std::fs::set_permissions(&base_dir, original_permissions).unwrap();
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "valid settings");
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn should_create_user_only_settings_files() {
        use std::os::unix::fs::PermissionsExt;

        let base_dir = std::env::temp_dir().join(format!("al-iyaal-atomic-{}", Uuid::new_v4()));
        let path = base_dir.join("settings.json");

        write_file_atomically(&path, b"secret", Some(0o600)).unwrap();

        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_reject_unsupported_cut_output_mode() {
        let result = ensure_supported_cut_output_mode("custom_mode");
        assert!(result.is_err());
    }

    #[test]
    fn should_accept_supported_compression_presets() {
        assert!(ensure_supported_compression_preset("apple_silicon").is_ok());
        assert!(ensure_supported_compression_preset("max_compression").is_ok());
        assert!(ensure_supported_compression_preset("balanced").is_ok());
    }

    #[test]
    fn should_reject_unsupported_compression_preset() {
        assert!(ensure_supported_compression_preset("ultra").is_err());
    }

    #[test]
    fn should_reject_unsupported_yap_mode() {
        let result = ensure_supported_yap_mode("manual");
        assert!(result.is_err());
    }

    #[test]
    fn should_allow_reading_srt_sidecars() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-read-sidecar-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("episode.srt");
        std::fs::write(&path, "1").unwrap();

        let validated = validate_read_text_file_path(path.to_string_lossy().as_ref()).unwrap();

        assert_eq!(validated, path.canonicalize().unwrap());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_reject_non_sidecar_files_for_read_text_file() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-read-sidecar-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("notes.txt");
        std::fs::write(&path, "secret").unwrap();

        let error = validate_read_text_file_path(path.to_string_lossy().as_ref()).unwrap_err();

        assert!(error.contains(".srt, .analysis.json, and .ranges.json"));

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_allow_json_files_as_analysis_imports() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-analysis-import-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("claude-output.json");
        std::fs::write(&path, "{}").unwrap();

        let validated = validate_analysis_import_path(path.to_string_lossy().as_ref()).unwrap();

        assert_eq!(validated, path.canonicalize().unwrap());
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[tokio::test]
    async fn should_save_only_a_versioned_analysis_bundle_atomically() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-save-analysis-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let video_path = base_dir.join("episode.mp4");
        std::fs::write(&video_path, "video").unwrap();
        let content = r#"{"schemaVersion":2,"sourceFile":"episode.srt","analyses":[]}"#;

        save_analysis_sidecar(SaveAnalysisSidecarRequest {
            content: content.to_string(),
            video_path: video_path.to_string_lossy().to_string(),
        })
        .await
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(base_dir.join("episode.analysis.json")).unwrap(),
            content
        );
        let invalid = save_analysis_sidecar(SaveAnalysisSidecarRequest {
            content: "[]".to_string(),
            video_path: video_path.to_string_lossy().to_string(),
        })
        .await;
        assert!(invalid.is_err());
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_render_the_exact_selected_analysis_prompt_template() {
        let prompt = build_analysis_prompt_preview(&AnalysisPromptPreviewRequest {
            content_criteria: "No profanity".to_string(),
            engine: "codex".to_string(),
            priority_guidelines: "High priority guidance".to_string(),
        });

        assert!(prompt.contains("Read `subtitles.srt`"));
        assert!(prompt.contains("No profanity"));
        assert!(prompt.contains("High priority guidance"));
        assert!(prompt.contains("{{videoFileName}}"));

        let blacklist_prompt = build_analysis_prompt_preview(&AnalysisPromptPreviewRequest {
            content_criteria: "ignored".to_string(),
            engine: "blacklist".to_string(),
            priority_guidelines: "ignored".to_string(),
        });
        assert!(blacklist_prompt.contains("does not send a prompt"));
    }

    #[test]
    fn should_build_a_ranges_sidecar_path_from_a_video_path() {
        assert_eq!(
            cut_ranges_sidecar_path(Path::new("/tmp/episode.clip.mp4")),
            Path::new("/tmp/episode.clip.ranges.json")
        );
    }

    #[test]
    fn should_allow_reading_ranges_sidecars() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-read-sidecar-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("episode.ranges.json");
        std::fs::write(&path, "{\"ranges\":[]}").unwrap();

        let validated = validate_read_text_file_path(path.to_string_lossy().as_ref()).unwrap();

        assert_eq!(validated, path.canonicalize().unwrap());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[tokio::test]
    async fn should_save_cut_ranges_as_a_video_sidecar() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-save-ranges-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let video_path = base_dir.join("episode.mp4");
        std::fs::write(&video_path, "video").unwrap();

        save_cut_ranges(SaveCutRangesRequest {
            video_path: video_path.to_string_lossy().to_string(),
            ranges: vec![crate::types::CutRange {
                end: "3.500".to_string(),
                start: "1.250".to_string(),
            }],
        })
        .await
        .unwrap();

        let content = std::fs::read_to_string(base_dir.join("episode.ranges.json")).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(saved["ranges"][0]["start"], "1.250");
        assert_eq!(saved["ranges"][0]["end"], "3.500");

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[tokio::test]
    async fn should_reject_invalid_saved_cut_ranges_before_writing() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-save-ranges-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let video_path = base_dir.join("episode.mp4");
        std::fs::write(&video_path, "video").unwrap();

        let result = save_cut_ranges(SaveCutRangesRequest {
            video_path: video_path.to_string_lossy().to_string(),
            ranges: vec![crate::types::CutRange {
                start: "2".to_string(),
                end: "1".to_string(),
            }],
        })
        .await;

        assert!(result.is_err());
        assert!(!base_dir.join("episode.ranges.json").exists());
        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[tokio::test]
    async fn should_allow_empty_saved_cut_ranges_to_clear_the_sidecar() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-clear-ranges-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let video_path = base_dir.join("episode.mp4");
        std::fs::write(&video_path, "video").unwrap();

        save_cut_ranges(SaveCutRangesRequest {
            video_path: video_path.to_string_lossy().to_string(),
            ranges: Vec::new(),
        })
        .await
        .unwrap();

        let content = std::fs::read_to_string(base_dir.join("episode.ranges.json")).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(saved["ranges"], serde_json::json!([]));

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_validate_preview_video_files() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-preview-video-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("episode.mp4");
        std::fs::write(&path, "1").unwrap();

        let validated = validate_preview_video_path(path.to_string_lossy().as_ref()).unwrap();

        assert_eq!(validated, path.canonicalize().unwrap());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_reject_unsupported_preview_video_files() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-preview-video-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("episode.mkv");
        std::fs::write(&path, "1").unwrap();

        let error = validate_preview_video_path(path.to_string_lossy().as_ref()).unwrap_err();

        assert!(error.contains(".mp4 and .mov"));

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_reject_invalid_cut_input_paths_before_enqueue() {
        let base_dir = std::env::temp_dir().join(format!("al-iyaal-cut-input-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let directory = base_dir.join("folder.mp4");
        let unsupported = base_dir.join("episode.mkv");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(&unsupported, "video").unwrap();

        assert!(validate_preview_video_path(directory.to_string_lossy().as_ref()).is_err());
        assert!(validate_preview_video_path(unsupported.to_string_lossy().as_ref()).is_err());
        assert!(validate_preview_video_path(
            base_dir.join("missing.mp4").to_string_lossy().as_ref()
        )
        .is_err());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_validate_existing_file_paths_for_trash() {
        let base_dir = std::env::temp_dir().join(format!("al-iyaal-trash-file-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let path = base_dir.join("episode.mp4");
        std::fs::write(&path, "1").unwrap();

        let validated = validate_existing_file_path(path.to_string_lossy().as_ref()).unwrap();

        assert_eq!(validated, path.canonicalize().unwrap());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_allow_missing_owned_trash_paths_but_reject_other_paths() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-trash-validation-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base_dir).unwrap();
        let missing_sidecar = base_dir.join("episode.analysis.json");
        let unsupported = base_dir.join("notes.txt");
        let directory = base_dir.join("folder.mp4");
        std::fs::create_dir_all(&directory).unwrap();

        assert_eq!(
            validate_trash_file_path(missing_sidecar.to_string_lossy().as_ref()).unwrap(),
            missing_sidecar
        );
        assert!(validate_trash_file_path(unsupported.to_string_lossy().as_ref()).is_err());
        assert!(validate_trash_file_path(directory.to_string_lossy().as_ref()).is_err());

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[tokio::test]
    async fn should_reject_cancel_for_missing_or_terminal_work() {
        let state = AppState::new();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        state.set_worker_sender(sender).await;

        assert!(
            !try_send_task_cancel(
                &state,
                "missing-task".to_string(),
                "stop_after_current".to_string()
            )
            .await
        );

        let mut terminal_task = TaskState {
            task_id: "terminal-task".to_string(),
            task_kind: TaskKind::Cut,
            status: TaskStatus::Completed,
            jobs: create_task_jobs(&["/tmp/episode.mp4".to_string()]),
            summary: None,
        };
        state.insert_task(terminal_task.clone()).await;
        assert!(
            !try_send_task_cancel(
                &state,
                terminal_task.task_id.clone(),
                "stop_after_current".to_string()
            )
            .await
        );

        terminal_task.task_id = "queued-task".to_string();
        terminal_task.status = TaskStatus::Queued;
        state.insert_task(terminal_task.clone()).await;
        assert!(
            try_send_task_cancel(
                &state,
                terminal_task.task_id,
                "stop_after_current".to_string()
            )
            .await
        );
        assert!(matches!(
            receiver.recv().await,
            Some(WorkerCommand::CancelTask { .. })
        ));
    }

    #[tokio::test]
    async fn should_reject_batch_cancel_for_missing_or_terminal_work() {
        let state = AppState::new();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        state.set_worker_sender(sender).await;

        assert!(
            !try_send_batch_cancel(
                &state,
                "missing-batch".to_string(),
                "stop_after_current".to_string()
            )
            .await
        );

        let terminal_batch = BatchState {
            batch_id: "terminal-batch".to_string(),
            status: BatchStatus::Completed,
            jobs: vec![],
            summary: None,
        };
        state.insert_batch(terminal_batch).await;
        assert!(
            !try_send_batch_cancel(
                &state,
                "terminal-batch".to_string(),
                "stop_after_current".to_string()
            )
            .await
        );

        state
            .insert_batch(BatchState {
                batch_id: "queued-batch".to_string(),
                status: BatchStatus::Queued,
                jobs: vec![],
                summary: None,
            })
            .await;
        assert!(
            try_send_batch_cancel(
                &state,
                "queued-batch".to_string(),
                "stop_after_current".to_string()
            )
            .await
        );
        assert!(matches!(
            receiver.recv().await,
            Some(WorkerCommand::CancelBatch { .. })
        ));
    }

    #[tokio::test]
    async fn should_return_none_for_missing_batch_state() {
        let state = AppState::new();
        let result = get_batch_state_inner(&state, "missing-batch-id").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn should_return_none_for_missing_task_state() {
        let state = AppState::new();
        let result = get_task_state_inner(&state, "missing-task-id").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn should_roll_back_task_state_when_worker_enqueue_fails() {
        let state = AppState::new();
        let (worker_sender, worker_receiver) = tokio::sync::mpsc::unbounded_channel();
        drop(worker_receiver);
        let task_id = "rollback-task".to_string();

        let result = enqueue_task_command(
            &state,
            &worker_sender,
            TaskState {
                task_id: task_id.clone(),
                task_kind: TaskKind::Cut,
                status: TaskStatus::Queued,
                jobs: create_task_jobs(&["/tmp/episode.mp4".to_string()]),
                summary: None,
            },
            WorkerCommand::StartTranscriptionBatch {
                task_id: task_id.clone(),
                input_paths: vec!["/tmp/episode.mp4".to_string()],
                yap_mode: "auto".to_string(),
            },
            "test task",
        )
        .await;

        assert!(result.is_err());
        assert!(state.get_task(&task_id).await.is_none());
    }

    #[tokio::test]
    async fn should_serialize_concurrent_task_admission_before_publication() {
        let state = AppState::new();
        let (worker_sender, mut worker_receiver) = tokio::sync::mpsc::unbounded_channel();

        let first = enqueue_task_command(
            &state,
            &worker_sender,
            TaskState {
                task_id: "concurrent-task-1".to_string(),
                task_kind: TaskKind::Transcription,
                status: TaskStatus::Queued,
                jobs: create_task_jobs(&["/tmp/episode-1.mp4".to_string()]),
                summary: None,
            },
            WorkerCommand::StartTranscriptionBatch {
                task_id: "concurrent-task-1".to_string(),
                input_paths: vec!["/tmp/episode-1.mp4".to_string()],
                yap_mode: "auto".to_string(),
            },
            "first task",
        );
        let second = enqueue_task_command(
            &state,
            &worker_sender,
            TaskState {
                task_id: "concurrent-task-2".to_string(),
                task_kind: TaskKind::Transcription,
                status: TaskStatus::Queued,
                jobs: create_task_jobs(&["/tmp/episode-2.mp4".to_string()]),
                summary: None,
            },
            WorkerCommand::StartTranscriptionBatch {
                task_id: "concurrent-task-2".to_string(),
                input_paths: vec!["/tmp/episode-2.mp4".to_string()],
                yap_mode: "auto".to_string(),
            },
            "second task",
        );

        let (first_result, second_result) = tokio::join!(first, second);
        assert_ne!(first_result.is_ok(), second_result.is_ok());
        assert!(worker_receiver.recv().await.is_some());
        assert_eq!(state.tasks.lock().await.len(), 1);
    }

    #[test]
    fn should_reject_unsupported_cancel_mode() {
        let result = ensure_supported_cancel_mode("immediate");
        assert!(result.is_err());
    }

    #[test]
    fn should_create_task_jobs_with_empty_logs() {
        let jobs = create_task_jobs(&["/tmp/a.mov".to_string()]);
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].logs.is_empty());
    }

    #[test]
    fn should_expand_remove_music_input_paths_from_files_and_folders() {
        let base_dir =
            std::env::temp_dir().join(format!("al-iyaal-start-batch-{}", Uuid::new_v4()));
        let folder = base_dir.join("folder");
        std::fs::create_dir_all(&folder).unwrap();
        let direct_file = base_dir.join("a.mov");
        let folder_file = folder.join("b.mp4");
        std::fs::write(&direct_file, "a").unwrap();
        std::fs::write(&folder_file, "b").unwrap();

        let result = resolve_input_paths(
            None,
            Some(&vec![
                direct_file.to_string_lossy().to_string(),
                folder.to_string_lossy().to_string(),
            ]),
            &[".mp4".to_string(), ".mov".to_string()],
            "No .mp4/.mov files were selected.",
        )
        .unwrap();

        assert_eq!(
            result,
            vec![
                direct_file.to_string_lossy().to_string(),
                folder_file.to_string_lossy().to_string(),
            ]
        );

        std::fs::remove_dir_all(base_dir).unwrap();
    }

    #[test]
    fn should_provide_default_moderation_rules() {
        let settings = default_moderation_settings();
        assert!(!settings.rules.is_empty());
        assert_eq!(settings.rules[0].priority, "high");
    }

    #[test]
    fn should_cover_requested_blacklist_categories_by_default() {
        let settings = default_moderation_settings();

        for (rule_id, pattern) in [
            ("sexual_content", "pornography"),
            ("magic_sorcery", "witchcraft"),
            ("music_content", "music"),
            ("musical_instruments", "piano"),
            ("alcohol_intoxicants", "wine"),
        ] {
            assert!(
                settings.rules.iter().any(|rule| rule.rule_id == rule_id
                    && rule.patterns.iter().any(|value| value == pattern)),
                "missing blacklist coverage for {rule_id}: {pattern}"
            );
        }
    }

    #[test]
    fn should_upgrade_saved_blacklist_rules_with_new_defaults() {
        let mut settings = default_moderation_settings();
        settings.rules.retain(|rule| {
            matches!(
                rule.rule_id.as_str(),
                "aqeedah_christmas" | "magic_sorcery" | "offensive_language"
            )
        });
        settings
            .rules
            .iter_mut()
            .find(|rule| rule.rule_id == "magic_sorcery")
            .unwrap()
            .patterns = vec!["spell".to_string()];

        merge_default_moderation_rules(&mut settings);

        assert!(settings.rules.iter().any(|rule| {
            rule.rule_id == "sexual_content"
                && rule.patterns.iter().any(|pattern| pattern == "pornography")
        }));
        assert!(settings.rules.iter().any(|rule| {
            rule.rule_id == "magic_sorcery"
                && rule.patterns.iter().any(|pattern| pattern == "witchcraft")
        }));

        let mut empty_settings = settings;
        empty_settings.rules.clear();
        merge_default_moderation_rules(&mut empty_settings);
        assert!(empty_settings.rules.is_empty());
    }

    #[test]
    fn should_require_a_model_for_agent_analysis() {
        let mut settings = default_moderation_settings();
        settings.engine = "codex".to_string();

        let error = validate_moderation_settings(&settings).unwrap_err();

        assert!(error.contains("Agent model"));
    }

    #[test]
    fn should_accept_agent_analysis_with_a_model_and_reasoning_level() {
        let mut settings = default_moderation_settings();
        settings.engine = "opencode".to_string();
        settings.agent_model = "opencode/test".to_string();
        settings.agent_reasoning_level = "low".to_string();

        assert!(validate_moderation_settings(&settings).is_ok());
    }
}
