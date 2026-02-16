use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn collect_media_files(input_dir: &Path, allowed_extensions: &[String]) -> Result<Vec<PathBuf>, String> {
    if !input_dir.is_dir() {
        return Err(format!("Input path is not a directory: {}", input_dir.display()));
    }

    let normalized_extensions: Vec<String> = allowed_extensions
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .map(|value| if value.starts_with('.') { value } else { format!(".{value}") })
        .collect();

    let mut files = fs::read_dir(input_dir)
        .map_err(|error| format!("Failed to read input directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|extension| format!(".{extension}").to_ascii_lowercase())
                .map(|extension| normalized_extensions.contains(&extension))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    files.sort();
    Ok(files)
}

pub fn build_output_dir(input_dir: &Path) -> PathBuf {
    input_dir.join("audio_replaced")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::build_output_dir;

    #[test]
    fn should_build_audio_replaced_output_dir() {
        let path = build_output_dir(Path::new("/tmp/example"));
        assert_eq!(path.to_string_lossy(), "/tmp/example/audio_replaced");
    }
}
