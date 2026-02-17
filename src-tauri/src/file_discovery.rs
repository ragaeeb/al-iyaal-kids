use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::{SrtListItem, VideoListItem};

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

pub fn discover_video_items(input_dir: &Path, allowed_extensions: &[String]) -> Result<Vec<VideoListItem>, String> {
    let files = collect_media_files(input_dir, allowed_extensions)?;

    let mut videos = files
        .into_iter()
        .map(|path| {
            let srt_path = path.with_extension("srt");
            let analysis_path = path.with_extension("analysis.json");
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
                .unwrap_or_else(|| path.to_string_lossy().to_string());

            VideoListItem {
                file_name,
                path: path.to_string_lossy().to_string(),
                srt_path: srt_path
                    .exists()
                    .then(|| srt_path.to_string_lossy().to_string()),
                analysis_path: analysis_path
                    .exists()
                    .then(|| analysis_path.to_string_lossy().to_string()),
                has_srt: srt_path.exists(),
                has_analysis: analysis_path.exists(),
            }
        })
        .collect::<Vec<_>>();

    videos.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(videos)
}

pub fn discover_srt_items(input_dir: &Path) -> Result<Vec<SrtListItem>, String> {
    let allowed_extensions = vec![".srt".to_string()];
    let files = collect_media_files(input_dir, &allowed_extensions)?;

    let mut srt_files = files
        .into_iter()
        .map(|path| {
            let analysis_path = path.with_extension("analysis.json");
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
                .unwrap_or_else(|| path.to_string_lossy().to_string());

            SrtListItem {
                file_name,
                path: path.to_string_lossy().to_string(),
                analysis_path: analysis_path
                    .exists()
                    .then(|| analysis_path.to_string_lossy().to_string()),
                has_analysis: analysis_path.exists(),
            }
        })
        .collect::<Vec<_>>();

    srt_files.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(srt_files)
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
