use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::AppHandle;
use tauri::Manager;

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
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create runtime directory {}: {error}", runtime_dir.display()))?;

    let worker_script = resolve_existing_path(&[
        PathBuf::from("python-worker/worker.py"),
        PathBuf::from("../python-worker/worker.py"),
        app.path()
            .resource_dir()
            .map_err(|error| format!("Failed to resolve resources dir: {error}"))?
            .join("python-worker/worker.py"),
    ])
    .ok_or_else(|| "Failed to locate python worker entrypoint (worker.py).".to_string())?;

    let requirements_lock = resolve_existing_path(&[
        PathBuf::from("python-worker/requirements.lock.txt"),
        PathBuf::from("../python-worker/requirements.lock.txt"),
        app.path()
            .resource_dir()
            .map_err(|error| format!("Failed to resolve resources dir: {error}"))?
            .join("python-worker/requirements.lock.txt"),
    ])
    .ok_or_else(|| "Failed to locate python worker requirements.lock.txt.".to_string())?;

    let venv_dir = runtime_dir.join("venv");
    let venv_python = venv_dir.join("bin/python3");

    if !venv_python.exists() {
        let base_python_candidates = resolve_python_candidates(app);
        let venv_dir_clone = venv_dir.clone();
        let requirements_clone = requirements_lock.clone();

        tauri::async_runtime::spawn_blocking(move || {
            bootstrap_virtualenv(&base_python_candidates, &venv_dir_clone, &requirements_clone)
        })
        .await
        .map_err(|error| format!("Failed waiting for Python runtime bootstrap: {error}"))??;
    }

    let python_executable = env::var("AIYAAL_PYTHON_PATH")
        .map(PathBuf::from)
        .unwrap_or(venv_python);
    let requirements_clone = requirements_lock.clone();
    let python_clone = python_executable.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_runtime_python_packages(&python_clone, &requirements_clone)
    })
    .await
    .map_err(|error| format!("Failed waiting for Python dependency verification: {error}"))??;

    let ffmpeg_executable = env::var("AIYAAL_FFMPEG_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let bundled = runtime_dir.join("bin/ffmpeg");
            if bundled.exists() {
                bundled
            } else {
                PathBuf::from("ffmpeg")
            }
        });

    let yap_executable = env::var("AIYAAL_YAP_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            if let Some(resource_dir) = app.path().resource_dir().ok() {
                let resource_candidates = [
                    resource_dir.join("assets/bin/yap.sh"),
                    resource_dir.join("assets/bin/yap"),
                ];
                if let Some(found) = resource_candidates.into_iter().find(|path| path.exists()) {
                    return found;
                }
            }

            let local_candidates = [
                PathBuf::from("assets/bin/yap.sh"),
                PathBuf::from("assets/bin/yap"),
            ];
            if let Some(found) = local_candidates.into_iter().find(|path| path.exists()) {
                return found;
            }

            let bundled_candidates = [runtime_dir.join("bin/yap.sh"), runtime_dir.join("bin/yap")];
            if let Some(found) = bundled_candidates.into_iter().find(|path| path.exists()) {
                found
            } else {
                PathBuf::from("yap")
            }
        });

    Ok(RuntimePaths {
        python_executable,
        worker_script,
        ffmpeg_executable,
        yap_executable,
    })
}

fn resolve_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.exists()).cloned()
}

fn resolve_python_candidates(app: &AppHandle) -> Vec<String> {
    if let Ok(configured_python) = env::var("AIYAAL_BASE_PYTHON") {
        return vec![configured_python];
    }

    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_candidates = [
            resource_dir.join("python/bin/python3"),
            resource_dir.join("runtime/python/bin/python3"),
            resource_dir.join("python/python3"),
        ];
        for candidate in bundled_candidates {
            if candidate.exists() {
                candidates.push(candidate.to_string_lossy().to_string());
            }
        }
    }

    candidates.extend([
        "python3.14".to_string(),
        "python3.13".to_string(),
        "python3.12".to_string(),
        "python3".to_string(),
    ]);

    candidates
}

fn bootstrap_virtualenv(
    base_python_candidates: &[String],
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
        if venv_dir.exists() {
            fs::remove_dir_all(venv_dir).map_err(|error| {
                format!(
                    "Failed to clear runtime venv directory {}: {error}",
                    venv_dir.display()
                )
            })?;
        }

        let result = (|| -> Result<(), String> {
            run_command(base_python, ["-m", "venv", venv_path], None)?;

            let venv_python = venv_dir.join("bin/python3");
            let venv_python_bin = venv_python
                .to_str()
                .ok_or_else(|| format!("Invalid venv python path {}", venv_python.display()))?;

            run_command(venv_python_bin, ["-m", "pip", "install", "--upgrade", "pip"], None)?;
            run_command(
                venv_python_bin,
                ["-m", "pip", "install", "-r", requirements_path],
                None,
            )?;

            Ok(())
        })();

        if result.is_ok() {
            return Ok(());
        }

        if let Err(error) = result {
            errors.push(format!("{base_python}: {error}"));
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

fn ensure_runtime_python_packages(python_executable: &Path, requirements_lock: &Path) -> Result<(), String> {
    let import_check = Command::new(python_executable)
        .args([
            "-c",
            "import demucs, torch, torchaudio, torchcodec", // noqa: E702
        ])
        .output()
        .map_err(|error| format!("Failed to execute python import check: {error}"))?;

    if import_check.status.success() {
        return Ok(());
    }

    let python_binary = python_executable
        .to_str()
        .ok_or_else(|| format!("Invalid python path {}", python_executable.display()))?;
    let requirements_path = requirements_lock
        .to_str()
        .ok_or_else(|| format!("Invalid requirements path {}", requirements_lock.display()))?;
    run_command(python_binary, ["-m", "pip", "install", "-r", requirements_path], None)
}
