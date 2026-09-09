use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JobSource {
    pub url: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub tried: bool,
}

pub fn size_ratio_blocked(original: Option<u64>, next: Option<u64>) -> bool {
    match (original, next) {
        (Some(original), Some(next)) if original > 0 && next > 0 => {
            let (high, low) = if original >= next {
                (original as f64, next as f64)
            } else {
                (next as f64, original as f64)
            };
            high / low >= 2.0
        }
        _ => false,
    }
}

pub fn original_size_for(src_url: &str, sources: &[JobSource]) -> Option<u64> {
    sources
        .iter()
        .find(|source| source.url == src_url)
        .and_then(|source| source.size_bytes)
}

pub fn mark_tried(sources: &mut [JobSource], url: &str) {
    for source in sources {
        if source.url == url {
            source.tried = true;
        }
    }
}

pub fn next_eligible_source<'a>(
    sources: &'a [JobSource],
    current: &str,
    original_size: Option<u64>,
) -> Option<&'a JobSource> {
    next_eligible_source_filtered(sources, current, original_size, false)
}

pub fn next_blocked_alternate<'a>(
    sources: &'a [JobSource],
    current: &str,
    original_size: Option<u64>,
) -> Option<&'a JobSource> {
    next_eligible_source_filtered(sources, current, original_size, true)
}

fn next_eligible_source_filtered<'a>(
    sources: &'a [JobSource],
    current: &str,
    original_size: Option<u64>,
    skip_packed: bool,
) -> Option<&'a JobSource> {
    sources.iter().find(|source| {
        !source.tried
            && source.url != current
            && !source.url.is_empty()
            && !size_ratio_blocked(original_size, source.size_bytes)
            && !(skip_packed && crate::store::is_signed_or_packed_source_url(&source.url))
    })
}

pub fn encode_sources(sources: &[JobSource]) -> String {
    serde_json::to_string(sources).unwrap_or_else(|_| "[]".into())
}

pub fn decode_sources(json: &str) -> Vec<JobSource> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn normalize_sources(raw: Vec<JobSource>, src_url: &str) -> Vec<JobSource> {
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for mut source in raw {
        source.url = source.url.trim().to_string();
        if source.url.is_empty() || !seen.insert(source.url.clone()) {
            continue;
        }
        if source.url == src_url {
            source.tried = true;
        }
        sources.push(source);
    }
    if !src_url.is_empty() && !seen.contains(src_url) {
        sources.insert(
            0,
            JobSource {
                url: src_url.to_string(),
                size_bytes: None,
                tried: true,
            },
        );
    } else {
        mark_tried(&mut sources, src_url);
    }
    sources
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(url: &str, size: Option<u64>, tried: bool) -> JobSource {
        JobSource {
            url: url.to_string(),
            size_bytes: size,
            tried,
        }
    }

    #[test]
    fn unknown_or_zero_sizes_are_eligible() {
        assert!(!size_ratio_blocked(Some(600), None));
        assert!(!size_ratio_blocked(None, Some(100)));
        assert!(!size_ratio_blocked(Some(0), Some(100)));
    }

    #[test]
    fn twice_the_original_size_is_blocked() {
        assert!(size_ratio_blocked(Some(300), Some(600)));
        assert!(size_ratio_blocked(Some(600), Some(300)));
        assert!(size_ratio_blocked(Some(100), Some(50)));
        assert!(!size_ratio_blocked(Some(627), Some(368)));
        assert!(!size_ratio_blocked(Some(500), Some(499)));
    }

    #[test]
    fn skips_tried_current_and_oversized_alternates() {
        let sources = vec![
            source("https://cdn.test/a/master.txt", Some(600), true),
            source("https://cdn.test/b/tiny.m3u8", Some(100), false),
            source("https://cdn.test/c/master.txt", Some(500), false),
        ];
        let next = next_eligible_source(
            &sources,
            "https://cdn.test/a/master.txt",
            Some(600),
        )
        .unwrap();
        assert_eq!(next.url, "https://cdn.test/c/master.txt");
    }

    #[test]
    fn blocked_fallback_skips_signed_or_packed_urls() {
        let sources = vec![
            source(
                "https://cdn.example/hls3/video.urlset/master.txt",
                Some(600),
                true,
            ),
            source(
                "https://cdn.example/hls2/video/master.m3u8?s=1&e=2&asn=60068",
                Some(500),
                false,
            ),
            source(
                "https://cdn.example/hls3/other.urlset/master.txt",
                Some(480),
                false,
            ),
        ];
        let next = next_blocked_alternate(
            &sources,
            "https://cdn.example/hls3/video.urlset/master.txt",
            Some(600),
        )
        .unwrap();
        assert_eq!(next.url, "https://cdn.example/hls3/other.urlset/master.txt");
    }

    #[test]
    fn blocked_fallback_fails_when_only_packed_remains() {
        let sources = vec![
            source(
                "https://cdn.example/hls3/video.urlset/master.txt",
                Some(600),
                true,
            ),
            source(
                "https://cdn.example/hls2/video/master.m3u8?s=1&e=2&asn=60068",
                Some(500),
                false,
            ),
        ];
        assert!(
            next_blocked_alternate(
                &sources,
                "https://cdn.example/hls3/video.urlset/master.txt",
                Some(600),
            )
            .is_none()
        );
    }

    #[test]
    fn no_eligible_source_when_remaining_are_twice_as_small() {
        let sources = vec![
            source("https://cdn.test/a/master.txt", Some(600), true),
            source("https://cdn.test/b/tiny.m3u8", Some(100), false),
        ];
        assert!(
            next_eligible_source(&sources, "https://cdn.test/a/master.txt", Some(600))
                .is_none()
        );
    }

    #[test]
    fn normalize_marks_selected_source_tried() {
        let sources = normalize_sources(
            vec![
                source("https://cdn.test/a/master.txt", Some(600), false),
                source("https://cdn.test/a/master.txt", Some(1), false),
                source("https://cdn.test/b/master.txt", Some(500), false),
            ],
            "https://cdn.test/a/master.txt",
        );
        assert_eq!(sources.len(), 2);
        assert!(sources[0].tried);
        assert!(!sources[1].tried);
        assert_eq!(
            original_size_for("https://cdn.test/a/master.txt", &sources),
            Some(600)
        );
    }
}
