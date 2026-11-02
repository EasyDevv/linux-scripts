use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GpgError {
    InvalidFingerprint,
    GpgMissing,
    ImportFailed(String),
    BadSignature(String),
    FingerprintMismatch { expected: String, actual: String },
}

impl std::fmt::Display for GpgError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GpgError::InvalidFingerprint => write!(formatter, "invalid fingerprint"),
            GpgError::GpgMissing => write!(formatter, "gpg not found"),
            GpgError::ImportFailed(message) => write!(formatter, "gpg import failed: {message}"),
            GpgError::BadSignature(message) => write!(formatter, "bad signature: {message}"),
            GpgError::FingerprintMismatch { expected, actual } => {
                write!(
                    formatter,
                    "fingerprint mismatch: expected {expected}, got {actual}"
                )
            }
        }
    }
}

impl std::error::Error for GpgError {}

pub struct GpgVerify<'a> {
    pub file: &'a Path,
    pub sig: &'a Path,
    pub fingerprint: &'a str,
    pub key_source: KeySource<'a>,
}

pub enum KeySource<'a> {
    KeyFile(&'a Path),
    Keyserver(&'a str),
}

pub fn parse_validsig(status: &str, fingerprint: &str) -> Result<(), GpgError> {
    let expected = normalize_fingerprint(fingerprint)?;
    let mut bad = None;
    let mut saw_valid = false;
    let mut matched = false;
    let mut actual = String::new();

    for line in status.lines() {
        let Some(rest) = gnupg_payload(line) else {
            continue;
        };
        let mut parts = rest.split_whitespace();
        let Some(tag) = parts.next() else {
            continue;
        };
        match tag {
            "BADSIG" | "ERRSIG" | "EXPKEYSIG" | "REVKEYSIG" => {
                if bad.is_none() {
                    bad = Some(tag.to_string());
                }
            }
            "VALIDSIG" => {
                saw_valid = true;
                let fields: Vec<&str> = parts.collect();
                let fingerprints = [fields.first().copied(), fields.last().copied()];
                for field in fingerprints.into_iter().flatten() {
                    if !is_fingerprint(field) {
                        continue;
                    }
                    let field = field.to_ascii_lowercase();
                    if actual.is_empty() {
                        actual = prefer_actual(&fields);
                    }
                    if field == expected {
                        matched = true;
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(kind) = bad {
        return Err(GpgError::BadSignature(kind));
    }
    if matched {
        return Ok(());
    }
    if saw_valid {
        return Err(GpgError::FingerprintMismatch { expected, actual });
    }
    Err(GpgError::BadSignature("no VALIDSIG".into()))
}

pub fn gpg_verify(verify: &GpgVerify<'_>) -> Result<(), GpgError> {
    let fingerprint = normalize_fingerprint(verify.fingerprint)?;
    let home = GnupgHome::create()?;
    let result = verify_in(&home.path, verify, &fingerprint);
    drop(home);
    result
}

fn verify_in(home: &Path, verify: &GpgVerify<'_>, fingerprint: &str) -> Result<(), GpgError> {
    import_key(home, verify, fingerprint)?;
    let output = gpg(home, |command| {
        command.args(["--batch", "--status-fd=1", "--verify"]);
        command.arg(verify.sig);
        command.arg(verify.file);
    })?;
    parse_validsig(&String::from_utf8_lossy(&output.stdout), fingerprint)
}

fn import_key(home: &Path, verify: &GpgVerify<'_>, fingerprint: &str) -> Result<(), GpgError> {
    let output = match verify.key_source {
        KeySource::KeyFile(path) => gpg(home, |command| {
            command.args(["--batch", "--import"]);
            command.arg(path);
        })?,
        KeySource::Keyserver(url) => gpg(home, |command| {
            command.args(["--batch", "--keyserver"]);
            command.arg(url);
            command.args(["--recv-keys", fingerprint]);
        })?,
    };
    if output.status.success() {
        Ok(())
    } else {
        Err(GpgError::ImportFailed(command_note(&output)))
    }
}

fn gpg(home: &Path, fill: impl FnOnce(&mut Command)) -> Result<Output, GpgError> {
    let mut command = Command::new("gpg");
    command
        .env("GNUPGHOME", home)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    fill(&mut command);
    match command.output() {
        Ok(output) => Ok(output),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(GpgError::GpgMissing),
        Err(error) => Err(GpgError::ImportFailed(error.to_string())),
    }
}

fn normalize_fingerprint(raw: &str) -> Result<String, GpgError> {
    let compact: String = raw.chars().filter(|ch| !ch.is_whitespace()).collect();
    if is_fingerprint(&compact) {
        Ok(compact.to_ascii_lowercase())
    } else {
        Err(GpgError::InvalidFingerprint)
    }
}

fn is_fingerprint(text: &str) -> bool {
    text.len() == 40 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn gnupg_payload(line: &str) -> Option<&str> {
    line.trim().strip_prefix("[GNUPG:]").map(str::trim_start)
}

fn prefer_actual(fields: &[&str]) -> String {
    fields
        .last()
        .copied()
        .filter(|field| is_fingerprint(field))
        .or_else(|| {
            fields
                .first()
                .copied()
                .filter(|field| is_fingerprint(field))
        })
        .map(|field| field.to_ascii_lowercase())
        .unwrap_or_default()
}

fn command_note(output: &Output) -> String {
    let mut text = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    text.retain(|ch| ch != '\0');
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return format!("exit {}", output.status);
    }
    if text.len() > 500 {
        text[..500].to_string()
    } else {
        text
    }
}

struct GnupgHome {
    path: PathBuf,
}

impl GnupgHome {
    fn create() -> Result<Self, GpgError> {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "cli-gnupg-{}-{}-{}",
            std::process::id(),
            nanos,
            seq
        ));
        std::fs::create_dir(&path)
            .map_err(|error| GpgError::ImportFailed(format!("temp dir: {error}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|error| GpgError::ImportFailed(format!("temp dir mode: {error}")))?;
        }
        Ok(Self { path })
    }
}

impl Drop for GnupgHome {
    fn drop(&mut self) {
        let _ = Command::new("gpgconf")
            .env("GNUPGHOME", &self.path)
            .args(["--kill", "all"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "0123456789abcdef0123456789abcdef01234567";
    const OTHER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn validsig(signing: &str, primary: &str) -> String {
        format!("[GNUPG:] VALIDSIG {signing} 2026-10-30 1761843528 0 4 0 1 8 00 {primary}\n")
    }

    #[test]
    fn parse_validsig_cases() {
        assert!(parse_validsig(&validsig(FP, FP), FP).is_ok());
        assert!(parse_validsig(&validsig(&FP.to_ascii_uppercase(), FP), FP).is_ok());
        assert!(parse_validsig(&validsig(OTHER, FP), &format!("  {FP}  ")).is_ok());

        let mismatch = parse_validsig(&validsig(OTHER, OTHER), FP).unwrap_err();
        assert!(
            matches!(mismatch, GpgError::FingerprintMismatch { ref expected, ref actual } if expected == FP && actual == OTHER),
            "{mismatch}"
        );

        let bad = parse_validsig(
            "[GNUPG:] BADSIG 0123456789ABCDEF Test <t@example.com>\n",
            FP,
        )
        .unwrap_err();
        assert!(
            matches!(bad, GpgError::BadSignature(ref kind) if kind == "BADSIG"),
            "{bad}"
        );

        let empty = parse_validsig("", FP).unwrap_err();
        assert!(matches!(empty, GpgError::BadSignature(_)), "{empty}");
        assert!(matches!(
            parse_validsig("[GNUPG:] GOODSIG 0123456789ABCDEF Test\n", FP).unwrap_err(),
            GpgError::BadSignature(_)
        ));
        assert!(matches!(
            parse_validsig(&format!("[GNUPG:] EXPKEYSIG {FP} Test\n{}", validsig(FP, FP)), FP).unwrap_err(),
            GpgError::BadSignature(ref kind) if kind == "EXPKEYSIG"
        ));
        assert!(matches!(
            parse_validsig(&validsig(FP, FP), "short").unwrap_err(),
            GpgError::InvalidFingerprint
        ));
    }

    #[test]
    fn gpg_verify_roundtrip_when_gpg_present() {
        match Command::new("gpg").arg("--version").output() {
            Ok(output) if output.status.success() => {}
            _ => {
                println!("gpg not found, skipping");
                return;
            }
        }

        let home = std::env::temp_dir().join(format!(
            "cli-gpg-test-{}-{}",
            std::process::id(),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::write(home.join("gpg-agent.conf"), b"allow-loopback-pinentry\n").unwrap();
        let guard = home.clone();

        let gen = Command::new("gpg")
            .env("GNUPGHOME", &home)
            .args([
                "--batch",
                "--pinentry-mode",
                "loopback",
                "--passphrase",
                "",
                "--quick-generate-key",
                "test <t@example.com>",
                "ed25519",
                "sign",
                "never",
            ])
            .output()
            .expect("spawn gpg");
        assert!(
            gen.status.success(),
            "keygen failed: {}",
            String::from_utf8_lossy(&gen.stderr)
        );

        let listed = Command::new("gpg")
            .env("GNUPGHOME", &home)
            .args(["--batch", "--with-colons", "--list-keys"])
            .output()
            .unwrap();
        let listed_text = String::from_utf8_lossy(&listed.stdout);
        let fingerprint = listed_text
            .lines()
            .find_map(|line| {
                let mut parts = line.split(':');
                if parts.next() != Some("fpr") {
                    return None;
                }
                parts.nth(8).filter(|value| is_fingerprint(value))
            })
            .expect("fingerprint")
            .to_string();

        let key_file = home.join("pub.gpg");
        let exported = Command::new("gpg")
            .env("GNUPGHOME", &home)
            .args(["--batch", "--export", "--output"])
            .arg(&key_file)
            .output()
            .unwrap();
        assert!(
            exported.status.success(),
            "{}",
            String::from_utf8_lossy(&exported.stderr)
        );

        let file = home.join("payload");
        std::fs::write(&file, b"hello\n").unwrap();
        let sig = home.join("payload.sig");
        let signed = Command::new("gpg")
            .env("GNUPGHOME", &home)
            .args([
                "--batch",
                "--pinentry-mode",
                "loopback",
                "--passphrase",
                "",
                "--detach-sign",
                "--output",
            ])
            .arg(&sig)
            .arg(&file)
            .output()
            .unwrap();
        assert!(
            signed.status.success(),
            "{}",
            String::from_utf8_lossy(&signed.stderr)
        );

        gpg_verify(&GpgVerify {
            file: &file,
            sig: &sig,
            fingerprint: &fingerprint,
            key_source: KeySource::KeyFile(&key_file),
        })
        .unwrap();

        let mut tampered = std::fs::read(&file).unwrap();
        tampered[0] ^= 0x01;
        std::fs::write(&file, &tampered).unwrap();
        assert!(gpg_verify(&GpgVerify {
            file: &file,
            sig: &sig,
            fingerprint: &fingerprint,
            key_source: KeySource::KeyFile(&key_file),
        })
        .is_err());

        std::fs::write(&file, b"hello\n").unwrap();
        let wrong = if fingerprint.eq_ignore_ascii_case(FP) {
            OTHER
        } else {
            FP
        };
        let mismatch = gpg_verify(&GpgVerify {
            file: &file,
            sig: &sig,
            fingerprint: wrong,
            key_source: KeySource::KeyFile(&key_file),
        })
        .unwrap_err();
        assert!(
            matches!(mismatch, GpgError::FingerprintMismatch { .. }),
            "{mismatch}"
        );

        let _ = Command::new("gpgconf")
            .env("GNUPGHOME", &guard)
            .args(["--kill", "all"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = std::fs::remove_dir_all(&guard);
    }
}
