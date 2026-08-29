use std::{
    env, fs,
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
    .ok_or_else(|| "Failed to locate python worker entrypoint (worker.py).".to_string())?;

    let requirements_lock = resolve_existing_path(&[
        PathBuf::from("python-worker/requirements.lock.txt"),
        PathBuf::from("../python-worker/requirements.lock.txt"),
        resource_dir.join("_up_/python-worker/requirements.lock.txt"),
        resource_dir.join("python-worker/requirements.lock.txt"),
    ])
    .ok_or_else(|| "Failed to locate python worker requirements.lock.txt.".to_string())?;

    let venv_dir = runtime_dir.join("venv");
    let venv_python = venv_dir.join("bin/python3");

    if !venv_python.exists() {
        let base_python_candidates = resolve_python_candidates(app);
        let venv_dir_clone = venv_dir.clone();
        let requirements_clone = requirements_lock.clone();

        tauri::async_runtime::spawn_blocking(move || {
            bootstrap_virtualenv(
                &base_python_candidates,
                &venv_dir_clone,
                &requirements_clone,
            )
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
            // When launched from Finder, macOS strips PATH to /usr/bin:/bin:/usr/sbin:/sbin
            // so tools installed via Homebrew or MacPorts are not found by name alone.
            // Probe known install locations in priority order before falling back.
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

    let yap_executable = env::var("AIYAAL_YAP_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            // The packaged wrapper delegates through PATH, which excludes package-manager
            // locations when macOS launches the app from Finder.
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

            run_command(
                venv_python_bin,
                ["-m", "pip", "install", "--upgrade", "pip"],
                None,
            )?;
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

fn ensure_runtime_python_packages(
    python_executable: &Path,
    requirements_lock: &Path,
) -> Result<(), String> {
    if verify_runtime_python_packages(python_executable).is_ok() {
        return Ok(());
    }

    let python_binary = python_executable
        .to_str()
        .ok_or_else(|| format!("Invalid python path {}", python_executable.display()))?;
    let requirements_path = requirements_lock
        .to_str()
        .ok_or_else(|| format!("Invalid requirements path {}", requirements_lock.display()))?;
    run_command(
        python_binary,
        ["-m", "pip", "install", "-r", requirements_path],
        None,
    )?;

    verify_runtime_python_packages(python_executable).map_err(|error| {
        format!("Python runtime dependency verification failed after installation: {error}")
    })
}

fn runtime_import_check_script() -> &'static str {
    "import better_profanity, demucs_mlx, mlx, soundfile, torch"
}

fn verify_runtime_python_packages(python_executable: &Path) -> Result<(), String> {
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

    use super::{resolve_yap_executable, runtime_import_check_script};

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
}
