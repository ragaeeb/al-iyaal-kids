pub fn to_job_id(value: &str) -> String {
    let lowered = value.to_ascii_lowercase();
    let mut id = String::with_capacity(lowered.len());

    for character in lowered.chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character);
        } else {
            id.push('-');
        }
    }

    let trimmed = id.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "job".to_string()
    } else {
        trimmed
    }
}

pub fn to_file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[cfg(test)]
mod tests {
    use super::{to_file_name, to_job_id};

    #[test]
    fn should_create_a_stable_job_id() {
        assert_eq!(to_job_id("/tmp/My Clip 01.mov"), "tmp-my-clip-01-mov");
    }

    #[test]
    fn should_extract_file_name_from_path() {
        assert_eq!(to_file_name("/tmp/input/video.mp4"), "video.mp4");
    }
}
