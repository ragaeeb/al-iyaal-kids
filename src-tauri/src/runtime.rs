use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::{AppHandle, Emitter, Manager};

use crate::types::{BatchEvent, TaskEvent, WorkerStatusKind};

const BATCH_EVENT_NAME: &str = "batch-event";
const TASK_EVENT_NAME: &str = "task-event";

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub python_executable: PathBuf,
    pub worker_script: PathBuf,
    pub ffmpeg_executable: PathBuf,
    pub yap_executable: PathBuf,
}

pub async fn ensure_runtime_ready(app: &AppHandle) -> Result<RuntimePaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let runtime_dir = app_data_dir.join("runtime");
    fs::create_dir_all(&runtime_dir).map_err(|error| {
        format!(
            "Failed to create runtime directory {}: {error}",
            runtime_dir.display()
        )
    })?;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resources dir: {error}"))?;

    let worker_script = resolve_existing_path(&[
        // Dev: relative to CWD (project root)
        PathBuf::from("python-worker/worker.py"),
        PathBuf::from("../python-worker/worker.py"),
        // Prod bundle: Tauri stores ../… resources under _up_/ inside Contents/Resources
        resource_dir.join("_up_/python-worker/worker.py"),
        // Fallback (no _up_ prefix, kept for forward-compat)
        resource_dir.join("python-worker/worker.py"),
    ])
    .ok_or_else(|| {
        "Failed to locate python worker entrypoint (worker.py). Please check your installation."
            .to_string()
    })?;

    let requirements_lock = resolve_existing_path(&[
        PathBuf::from("python-worker/requirements.lock.txt"),
        PathBuf::from("../python-worker/requirements.lock.txt"),
        resource_dir.join("_up_/python-worker/requirements.lock.txt"),
        resource_dir.join("python-worker/requirements.lock.txt"),
    ])
    .ok_or_else(|| {
        "Failed to locate python worker requirements.lock.txt. Please check your installation."
            .to_string()
    })?;

    let venv_dir = runtime_dir.join("venv");
    let venv_python = venv_dir.join("bin/python3");

    // Preflight & Auto-recovery: verify venv health and auto-recover if broken
    if !is_virtualenv_healthy(&venv_dir) {
        eprintln!(
            "[runtime] Python virtual environment at '{}' is missing, corrupted, or incomplete.",
            venv_dir.display()
        );

        let mut recovered = false;

        // Step 1: If venv exists with a supported Python version, try quick pip repair first
        if venv_python.exists() && is_supported_base_python(&venv_python) {
            eprintln!("[runtime] Attempting quick package repair via pip...");
            let _ = app.emit(
                TASK_EVENT_NAME,
                TaskEvent::worker_status(
                    WorkerStatusKind::Starting,
                    "Repairing Python worker dependencies...",
                ),
            );
            let _ = app.emit(
                BATCH_EVENT_NAME,
                BatchEvent::worker_status(
                    WorkerStatusKind::Starting,
                    "Repairing Python worker dependencies...",
                ),
            );

            let venv_python_clone = venv_python.clone();
            let req_clone = requirements_lock.clone();
            let quick_repair = tauri::async_runtime::spawn_blocking(move || {
                let venv_bin = venv_python_clone
                    .to_str()
                    .ok_or_else(|| "Invalid venv python path".to_string())?;
                let req_path = req_clone
                    .to_str()
                    .ok_or_else(|| "Invalid requirements path".to_string())?;
                run_command(venv_bin, ["-m", "pip", "install", "-r", req_path], None)?;
                verify_runtime_python_packages(&venv_python_clone)
            })
            .await;

            if let Ok(Ok(())) = quick_repair {
                eprintln!("[runtime] In-place package repair succeeded.");
                recovered = true;
            } else {
                eprintln!("[runtime] In-place package repair was unsuccessful. Initiating full virtual environment rebuild.");
            }
        }

        // Step 2: Full auto-recovery (wipe and rebuild from validated base Python)
        if !recovered {
            eprintln!("[runtime] Initiating auto-recovery: rebuilding virtual environment...");
            let _ = app.emit(
                TASK_EVENT_NAME,
                TaskEvent::worker_status(
                    WorkerStatusKind::Starting,
                    "Rebuilding Python worker environment...",
                ),
            );
            let _ = app.emit(
                BATCH_EVENT_NAME,
                BatchEvent::worker_status(
                    WorkerStatusKind::Starting,
                    "Rebuilding Python worker environment...",
                ),
            );

            if venv_dir.exists() {
                if let Err(error) = fs::remove_dir_all(&venv_dir) {
                    eprintln!(
                        "[runtime] Warning: failed removing corrupted venv {}: {error}",
                        venv_dir.display()
                    );
                }
            }

            let base_python_candidates = resolve_python_candidates(app);
            if base_python_candidates.is_empty() {
                let error_msg = "Python 3.13 or newer is required to run the local audio and video worker, but no compatible Python installation was found. Please install Python 3.13 using Homebrew (`brew install python@3.13`) or set the AIYAAL_BASE_PYTHON environment variable to your Python 3.13+ binary path.".to_string();
                eprintln!("[runtime] {error_msg}");
                return Err(error_msg);
            }

            let venv_dir_clone = venv_dir.clone();
            let requirements_clone = requirements_lock.clone();
            let candidates_clone = base_python_candidates.clone();

            tauri::async_runtime::spawn_blocking(move || {
                bootstrap_virtualenv(
                    &candidates_clone,
                    &venv_dir_clone,
                    &requirements_clone,
                )
            })
            .await
            .map_err(|error| format!("Failed waiting for Python runtime bootstrap: {error}"))??;

            if !is_virtualenv_healthy(&venv_dir) {
                let error_msg = "Python worker environment auto-recovery failed verification after rebuild. Please check your internet connection and verify that Python 3.13+ (`brew install python@3.13`) and pip are functional.".to_string();
                eprintln!("[runtime] {error_msg}");
                return Err(error_msg);
            }

            eprintln!("[runtime] Python worker environment successfully auto-recovered.");
        }
    }

    let python_executable = if let Ok(configured) = env::var("AIYAAL_PYTHON_PATH") {
        let path = PathBuf::from(configured);
        verify_runtime_python_packages(&path).map_err(|error| {
            format!(
                "AIYAAL_PYTHON_PATH was set to '{}', but dependency verification failed: {error}",
                path.display()
            )
        })?;
        path
    } else {
        venv_python
    };

    let ffmpeg_executable = env::var("AIYAAL_FFMPEG_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let bundled = runtime_dir.join("bin/ffmpeg");
            if bundled.exists() {
                return bundled;
            }
            let system_candidates = [
                PathBuf::from("/opt/homebrew/bin/ffmpeg"), // Homebrew on Apple Silicon
                PathBuf::from("/usr/local/bin/ffmpeg"),    // Homebrew on Intel / manual install
                PathBuf::from("/opt/local/bin/ffmpeg"),    // MacPorts
            ];
            if let Some(found) = system_candidates.into_iter().find(|p| p.exists()) {
                return found;
            }
            PathBuf::from("ffmpeg")
        });

    if !is_ffmpeg_available(&ffmpeg_executable) {
        let err_msg = format!(
            "ffmpeg is required for audio and video processing, but was not found or is not executable (checked '{}'). Please install ffmpeg using Homebrew (`brew install ffmpeg`) or set the AIYAAL_FFMPEG_PATH environment variable.",
            ffmpeg_executable.display()
        );
        eprintln!("[runtime] {err_msg}");
        return Err(err_msg);
    }

    let yap_executable = env::var("AIYAAL_YAP_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            resolve_yap_executable(
                &resource_dir,
                &runtime_dir,
                &[
                    PathBuf::from("/opt/homebrew/bin/yap"),
                    PathBuf::from("/usr/local/bin/yap"),
                    PathBuf::from("/opt/local/bin/yap"),
                ],
            )
        });

    Ok(RuntimePaths {
        python_executable,
        worker_script,
        ffmpeg_executable,
        yap_executable,
    })
}

pub fn is_ffmpeg_available(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

pub fn is_supported_base_python(candidate: &Path) -> bool {
    Command::new(candidate)
        .args([
            "-c",
            "import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)",
        ])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

pub fn is_virtualenv_healthy(venv_dir: &Path) -> bool {
    let venv_python = venv_dir.join("bin/python3");
    if !venv_python.exists() {
        return false;
    }
    if !is_supported_base_python(&venv_python) {
        return false;
    }
    verify_runtime_python_packages(&venv_python).is_ok()
}

fn resolve_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.exists()).cloned()
}

fn resolve_yap_executable(
    resource_dir: &Path,
    runtime_dir: &Path,
    system_candidates: &[PathBuf],
) -> PathBuf {
    if let Some(found) = resolve_existing_path(system_candidates) {
        return found;
    }

    let resource_candidates = [
        resource_dir.join("_up_/assets/bin/yap.sh"),
        resource_dir.join("_up_/assets/bin/yap"),
        resource_dir.join("assets/bin/yap.sh"),
        resource_dir.join("assets/bin/yap"),
    ];
    if let Some(found) = resolve_existing_path(&resource_candidates) {
        return found;
    }

    let local_candidates = [
        PathBuf::from("assets/bin/yap.sh"),
        PathBuf::from("assets/bin/yap"),
    ];
    if let Some(found) = resolve_existing_path(&local_candidates) {
        return found;
    }

    let bundled_candidates = [runtime_dir.join("bin/yap.sh"), runtime_dir.join("bin/yap")];
    resolve_existing_path(&bundled_candidates).unwrap_or_else(|| PathBuf::from("yap"))
}

pub fn resolve_python_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut raw_candidates: Vec<PathBuf> = Vec::new();

    if let Ok(configured_python) = env::var("AIYAAL_BASE_PYTHON") {
        if !configured_python.trim().is_empty() {
            raw_candidates.push(PathBuf::from(configured_python.trim()));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        raw_candidates.extend([
            resource_dir.join("python/bin/python3"),
            resource_dir.join("runtime/python/bin/python3"),
            resource_dir.join("python/python3"),
        ]);
    }

    raw_candidates.extend([
        PathBuf::from("/opt/homebrew/bin/python3.13"),
        PathBuf::from("/usr/local/bin/python3.13"),
        PathBuf::from("/opt/local/bin/python3.13"),
        PathBuf::from("python3.13"),
        PathBuf::from("/opt/homebrew/bin/python3.14"),
        PathBuf::from("/usr/local/bin/python3.14"),
        PathBuf::from("/opt/local/bin/python3.14"),
        PathBuf::from("python3.14"),
        PathBuf::from("/opt/homebrew/bin/python3"),
        PathBuf::from("/usr/local/bin/python3"),
        PathBuf::from("python3"),
    ]);

    let mut valid_candidates = Vec::new();
    for candidate in raw_candidates {
        if is_supported_base_python(&candidate) {
            let canonical = candidate.canonicalize().unwrap_or(candidate.clone());
            if !valid_candidates.iter().any(|existing: &PathBuf| {
                existing == &candidate || existing.canonicalize().unwrap_or_default() == canonical
            }) {
                valid_candidates.push(candidate);
            }
        }
    }

    valid_candidates
}

fn bootstrap_virtualenv(
    base_python_candidates: &[PathBuf],
    venv_dir: &Path,
    requirements_lock: &Path,
) -> Result<(), String> {
    if !requirements_lock.exists() {
        return Err(format!(
            "Missing requirements lock file at {}",
            requirements_lock.display()
        ));
    }

    let venv_path = venv_dir
        .to_str()
        .ok_or_else(|| format!("Invalid venv path {}", venv_dir.display()))?;

    let requirements_path = requirements_lock
        .to_str()
        .ok_or_else(|| format!("Invalid requirements path {}", requirements_lock.display()))?;

    let mut errors = Vec::new();
    for base_python in base_python_candidates {
        let base_python_str = base_python.to_string_lossy();
        eprintln!("[runtime] Bootstrapping virtualenv with candidate: {base_python_str}...");

        if venv_dir.exists() {
            let _ = fs::remove_dir_all(venv_dir);
        }

        let result = (|| -> Result<(), String> {
            run_command(&base_python_str, ["-m", "venv", venv_path], None)?;

            let venv_python = venv_dir.join("bin/python3");
            let venv_python_bin = venv_python
                .to_str()
                .ok_or_else(|| format!("Invalid venv python path {}", venv_python.display()))?;

            // Try upgrading pip, but don't fail bootstrap if network is restricted
            let _ = run_command(
                venv_python_bin,
                ["-m", "pip", "install", "--upgrade", "pip"],
                None,
            );

            run_command(
                venv_python_bin,
                ["-m", "pip", "install", "-r", requirements_path],
                None,
            )?;

            verify_runtime_python_packages(&venv_python)?;

            Ok(())
        })();

        if result.is_ok() {
            eprintln!("[runtime] Successfully bootstrapped virtualenv with {base_python_str}.");
            return Ok(());
        }

        if let Err(error) = result {
            eprintln!("[runtime] Candidate {base_python_str} failed: {error}");
            errors.push(format!("{base_python_str}: {error}"));
            if venv_dir.exists() {
                let _ = fs::remove_dir_all(venv_dir);
            }
        }
    }

    Err(format!(
        "Failed to bootstrap Python runtime with all candidates. {}",
        errors.join(" | ")
    ))
}

fn run_command<'a>(
    binary: &str,
    args: impl IntoIterator<Item = &'a str>,
    current_dir: Option<&Path>,
) -> Result<(), String> {
    let mut command = Command::new(binary);
    command.args(args);
    if let Some(path) = current_dir {
        command.current_dir(path);
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to execute command {binary}: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Command `{binary}` failed with status {}: {stderr}",
        output.status
    ))
}

pub fn runtime_import_check_script() -> &'static str {
    "import better_profanity, demucs_mlx, mlx, soundfile, torch"
}

pub fn verify_runtime_python_packages(python_executable: &Path) -> Result<(), String> {
    let import_check = Command::new(python_executable)
        .args(["-c", runtime_import_check_script()])
        .output()
        .map_err(|error| format!("Failed to execute python import check: {error}"))?;

    if import_check.status.success() {
        return Ok(());
    }

    Err(format!(
        "Python imports failed: {}",
        String::from_utf8_lossy(&import_check.stderr).trim()
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        is_ffmpeg_available, is_supported_base_python, is_virtualenv_healthy,
        resolve_yap_executable, runtime_import_check_script,
    };

    #[test]
    fn should_prefer_installed_yap_over_packaged_path_wrapper() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "al-iyaal-runtime-yap-{}-{unique}",
            std::process::id()
        ));
        let resource_dir = root.join("resources");
        let runtime_dir = root.join("runtime");
        let packaged_wrapper = resource_dir.join("_up_/assets/bin/yap.sh");
        let installed_yap = root.join("homebrew/bin/yap");
        fs::create_dir_all(
            packaged_wrapper
                .parent()
                .expect("packaged wrapper should have a parent"),
        )
        .expect("packaged wrapper directory should be created");
        fs::create_dir_all(
            installed_yap
                .parent()
                .expect("installed yap should have a parent"),
        )
        .expect("installed yap directory should be created");
        fs::write(&packaged_wrapper, "wrapper").expect("packaged wrapper should be created");
        fs::write(&installed_yap, "binary").expect("installed yap should be created");

        let resolved = resolve_yap_executable(
            &resource_dir,
            &runtime_dir,
            &[PathBuf::from(&installed_yap)],
        );

        assert_eq!(resolved, installed_yap);
        fs::remove_dir_all(root).expect("temporary runtime fixture should be removed");
    }

    #[test]
    fn should_check_for_the_active_demucs_mlx_runtime_dependencies() {
        assert_eq!(
            runtime_import_check_script(),
            "import better_profanity, demucs_mlx, mlx, soundfile, torch"
        );
    }

    #[test]
    fn should_reject_unsupported_python_versions() {
        // macOS Xcode Python 3.9 is unsupported
        let xcode_python = PathBuf::from("/usr/bin/python3");
        if xcode_python.exists() {
            // /usr/bin/python3 on macOS Monterey/Ventura/Sonoma/Sequoia is Python 3.9
            // is_supported_base_python requires Python >= 3.13
            assert!(!is_supported_base_python(&xcode_python));
        }
    }

    #[test]
    fn should_detect_missing_ffmpeg() {
        assert!(!is_ffmpeg_available(&PathBuf::from("/nonexistent/bin/ffmpeg")));
    }

    #[test]
    fn should_detect_unhealthy_virtualenv() {
        let temp_dir = std::env::temp_dir().join(format!(
            "al-iyaal-test-unhealthy-venv-{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&temp_dir);
        assert!(!is_virtualenv_healthy(&temp_dir));
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
