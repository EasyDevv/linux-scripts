use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::Context;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChecksumMismatch {
    pub expected: String,
    pub actual: String,
}

impl std::fmt::Display for ChecksumMismatch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "checksum mismatch: expected {}, got {}",
            self.expected, self.actual
        )
    }
}

impl std::error::Error for ChecksumMismatch {}

pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let mut file = File::open(path).with_context(|| format!("read {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .with_context(|| format!("read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(to_hex(&hasher.finalize()))
}

pub fn parse_checksums(text: &str) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    for line in text.lines() {
        if let Some(row) = parse_checksum_line(line) {
            rows.push(row);
        }
    }
    rows
}

pub fn parse_single_hash(text: &str) -> Option<String> {
    let mut found = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if !is_hex64(line) {
            return None;
        }
        if found.is_some() {
            return None;
        }
        found = Some(line.to_ascii_lowercase());
    }
    found
}

pub fn find_hash(text: &str, asset: &str) -> Option<String> {
    let want = strip_dot_slash(asset);
    let mut found = None;
    for (hash, name) in parse_checksums(text) {
        if strip_dot_slash(&name) != want {
            continue;
        }
        match &found {
            None => found = Some(hash),
            Some(previous) if previous == &hash => {}
            Some(_) => return None,
        }
    }
    found.or_else(|| parse_single_hash(text))
}

pub fn verify_sha256(path: &Path, expected: &str) -> Result<(), ChecksumMismatch> {
    let expected = expected.trim().to_ascii_lowercase();
    let actual = match sha256_file(path) {
        Ok(hash) => hash,
        Err(error) => {
            return Err(ChecksumMismatch {
                expected,
                actual: error.to_string(),
            });
        }
    };
    if actual == expected {
        Ok(())
    } else {
        Err(ChecksumMismatch { expected, actual })
    }
}

fn parse_checksum_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (hash, rest) = line.split_once(char::is_whitespace)?;
    if !is_hex64(hash) {
        return None;
    }
    let rest = rest.trim();
    let name = rest.strip_prefix('*').unwrap_or(rest).trim();
    if name.is_empty() {
        return None;
    }
    Some((hash.to_ascii_lowercase(), name.to_string()))
}

fn strip_dot_slash(name: &str) -> &str {
    name.strip_prefix("./").unwrap_or(name)
}

fn is_hex64(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn parses_sha256sum_lines() {
        let text = format!(
            "\n# comment\r\n{HASH_A}  litestream.tar.gz\r\n{HASH_B} *goat.tar.gz\n   \n{HASH_A}    ./xurl.tar.gz\nnot-a-hash  skipped.tar.gz\n{HASH_A}  \nabc  short\n"
        );
        let rows = parse_checksums(&text);
        assert_eq!(
            rows,
            vec![
                (HASH_A.to_string(), "litestream.tar.gz".to_string()),
                (HASH_B.to_string(), "goat.tar.gz".to_string()),
                (HASH_A.to_string(), "./xurl.tar.gz".to_string()),
            ]
        );
        assert_eq!(
            find_hash(&text, "litestream.tar.gz").as_deref(),
            Some(HASH_A)
        );
        assert_eq!(find_hash(&text, "goat.tar.gz").as_deref(), Some(HASH_B));
        assert_eq!(find_hash(&text, "xurl.tar.gz").as_deref(), Some(HASH_A));
        assert_eq!(
            find_hash(&text, "./litestream.tar.gz").as_deref(),
            Some(HASH_A)
        );
        assert_eq!(find_hash(&text, "litestream"), None);
        assert_eq!(find_hash(&text, "goat.tar"), None);
        assert_eq!(find_hash(&text, "skipped.tar.gz"), None);
    }

    #[test]
    fn single_hash_file_ignores_asset_name() {
        let text = format!("# pinned\r\n\r\n{HASH_A}\r\n");
        assert_eq!(parse_single_hash(&text).as_deref(), Some(HASH_A));
        assert_eq!(parse_checksums(&text), Vec::new());
        assert_eq!(find_hash(&text, "anything.bin").as_deref(), Some(HASH_A));
        assert_eq!(parse_single_hash(&format!("{HASH_A}\n{HASH_B}\n")), None);
        assert_eq!(
            find_hash(&format!("{HASH_A}  other.bin\n"), "missing.bin"),
            None
        );
    }

    #[test]
    fn verify_sha256_match_and_mismatch() {
        let dir = std::env::temp_dir().join(format!("cli-checksum-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("payload");
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), ABC_SHA256);
        assert!(verify_sha256(&path, &ABC_SHA256.to_ascii_uppercase()).is_ok());
        let error = verify_sha256(&path, HASH_A).unwrap_err();
        assert_eq!(error.expected, HASH_A);
        assert_eq!(error.actual, ABC_SHA256);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
