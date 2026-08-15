const MAX_JOB_SLUG_LENGTH: usize = 48;
const FNV1A_128_OFFSET_BASIS: u128 = 0x6c62272e07bb014262b821756295c58d;
const FNV1A_128_PRIME: u128 = 0x0000000001000000000000000000013b;

// Keep this format byte-for-byte aligned with the worker and frontend: a
// collapsed ASCII slug (capped at 48 characters) plus an FNV-1a 128-bit
// digest of the original UTF-8 path.
pub fn to_job_id(value: &str) -> String {
    let mut slug = String::with_capacity(value.len());

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }

    let slug = slug
        .trim_matches('-')
        .chars()
        .take(MAX_JOB_SLUG_LENGTH)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string();
    let readable_slug = if slug.is_empty() { "job" } else { &slug };

    format!("{}-{:032x}", readable_slug, digest_path(value))
}

fn digest_path(value: &str) -> u128 {
    value.bytes().fold(FNV1A_128_OFFSET_BASIS, |digest, byte| {
        (digest ^ u128::from(byte)).wrapping_mul(FNV1A_128_PRIME)
    })
}

pub fn to_file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[cfg(test)]
mod tests {
    use super::{to_file_name, to_job_id};

    #[test]
    fn should_create_a_stable_job_id() {
        assert_eq!(
            to_job_id("/tmp/My Clip 01.mov"),
            "tmp-my-clip-01-mov-67c00333ba0ddded529abdc463341963"
        );
    }

    #[test]
    fn should_keep_separator_variants_collision_resistant() {
        let hyphenated = to_job_id("/tmp/a-b.mp4");
        let underscored = to_job_id("/tmp/a_b.mp4");

        assert_eq!(hyphenated, "tmp-a-b-mp4-eaed9543b571fc817e9dcf8c9b8e1bc5");
        assert_eq!(underscored, "tmp-a-b-mp4-05bb79b9b571fc817d10c731641c878b");
        assert_ne!(hyphenated, underscored);
    }

    #[test]
    fn should_match_the_unicode_punctuation_fixture() {
        assert_eq!(
            to_job_id(
                "/Users/rhaq/Movies/al_iyaal/audio_replaced/Rothschild’s Giraffe - Leo The Wildlife Ranger Minisode #155.srt"
            ),
            "users-rhaq-movies-al-iyaal-audio-replaced-rothsc-f753e9abda221288d4cdc252c91813d9"
        );
    }

    #[test]
    fn should_extract_file_name_from_path() {
        assert_eq!(to_file_name("/tmp/input/video.mp4"), "video.mp4");
    }
}
