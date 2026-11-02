//! 설치 전 게이트. 플랜 §5: cooldown → 해시·서명·고정 sha256 → 검증 수준 결정.
//! 네트워크는 쓰지 않는다. 호출자가 내려받은 파일과 메타데이터를 넘긴다.

use std::path::Path;

use chrono::{DateTime, Utc};

use crate::checksum::{find_hash, parse_single_hash, sha256_file, verify_sha256, ChecksumMismatch};
use crate::cooldown::{check_cooldown, CooldownViolation};
use crate::http::HostBlocked;
use crate::manifest::{Method, Tool, EXIT_BLOCKED};
use crate::verify::{gpg_verify, GpgError, GpgVerify, KeySource};

/// 검증 수준. 높을수록 강하다(sig > checksum > pinned).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Pinned,
    Checksum,
    Sig,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Sig => "sig",
            Level::Checksum => "checksum",
            Level::Pinned => "pinned",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub level: Level,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allowed(Verified),
    /// vendor 도구에 체크섬·서명·고정 해시가 모두 없을 때. 사용자가 이 해시를 승인하면 tools.toml 에 기록한다.
    NeedsPin { sha256: String },
}

#[derive(Debug)]
pub enum Blocked {
    Cooldown(CooldownViolation),
    Prerelease { version: String },
    HashMismatch(ChecksumMismatch),
    ChecksumMissing { asset: String },
    Sig(GpgError),
    Host(HostBlocked),
    NoVerification,
    Config(String),
    Io(String),
}

impl Blocked {
    pub fn exit_code(&self) -> i32 {
        match self {
            Blocked::Io(_) | Blocked::Config(_) => crate::manifest::EXIT_ERROR,
            _ => EXIT_BLOCKED,
        }
    }
}

impl std::fmt::Display for Blocked {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Blocked::Cooldown(error) => write!(formatter, "{error}"),
            Blocked::Prerelease { version } => write!(
                formatter,
                "prerelease 버전은 설치하지 않습니다: {version} (정식 버전을 지정하세요)"
            ),
            Blocked::HashMismatch(error) => write!(formatter, "{error}"),
            Blocked::ChecksumMissing { asset } => {
                write!(formatter, "checksum file has no entry for {asset}")
            }
            Blocked::Sig(error) => write!(formatter, "{error}"),
            Blocked::Host(error) => write!(formatter, "{} ({})", error.url, error.reason),
            Blocked::NoVerification => write!(
                formatter,
                "no checksum, signature or pinned sha256 available"
            ),
            Blocked::Config(message) | Blocked::Io(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for Blocked {}

impl From<CooldownViolation> for Blocked {
    fn from(value: CooldownViolation) -> Self {
        Blocked::Cooldown(value)
    }
}

impl From<HostBlocked> for Blocked {
    fn from(value: HostBlocked) -> Self {
        Blocked::Host(value)
    }
}

/// 서명이 무엇을 덮는가. release 는 체크섬 파일, vendor(aws)는 아티팩트 자신.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SigCovers {
    Artifact,
    ChecksumFile,
}

pub struct SigInput<'a> {
    pub signed_file: &'a Path,
    pub sig_file: &'a Path,
    pub key_source: KeySource<'a>,
    pub covers: SigCovers,
}

pub struct GateInput<'a> {
    pub tool: &'a Tool,
    /// 내려받은 아티팩트 파일.
    pub artifact: &'a Path,
    /// 릴리스의 체크섬 파일 본문(있으면). 파일명은 `asset_name` 으로 찾는다.
    pub checksums_text: Option<&'a str>,
    pub asset_name: &'a str,
    pub sig: Option<SigInput<'a>>,
    pub published: DateTime<Utc>,
    pub now: DateTime<Utc>,
    pub cooldown_days: u32,
}

pub fn evaluate(input: &GateInput<'_>) -> Result<Decision, Blocked> {
    // 1. cooldown
    check_cooldown(input.published, input.now, input.cooldown_days)?;

    let actual = sha256_file(input.artifact).map_err(|error| Blocked::Io(format!("{error:#}")))?;

    // 2. 릴리스 체크섬 파일: 있으면 반드시 일치해야 한다.
    let mut checksum_ok = false;
    if let Some(text) = input.checksums_text {
        let expected = find_hash(text, input.asset_name)
            .or_else(|| parse_single_hash(text))
            .ok_or_else(|| Blocked::ChecksumMissing {
                asset: input.asset_name.to_string(),
            })?;
        verify_sha256(input.artifact, &expected).map_err(Blocked::HashMismatch)?;
        checksum_ok = true;
    }

    // 3. 서명: 설정돼 있으면 반드시 통과해야 한다.
    let mut sig_ok = false;
    if let Some(sig) = &input.sig {
        let fingerprint = input.tool.gpg_fingerprint.as_deref().ok_or_else(|| {
            Blocked::Config(format!("{}: sig given but gpg_fingerprint is empty", input.tool.name))
        })?;
        gpg_verify(&GpgVerify {
            file: sig.signed_file,
            sig: sig.sig_file,
            fingerprint,
            key_source: match sig.key_source {
                KeySource::KeyFile(path) => KeySource::KeyFile(path),
                KeySource::Keyserver(url) => KeySource::Keyserver(url),
            },
        })
        .map_err(Blocked::Sig)?;
        // 서명이 체크섬 파일을 덮으면 그 체크섬이 아티팩트와 일치해야 의미가 있다.
        sig_ok = match sig.covers {
            SigCovers::Artifact => true,
            SigCovers::ChecksumFile => checksum_ok,
        };
    }

    // 4. 고정 sha256: 있으면 반드시 일치해야 한다(다른 검증이 통과해도).
    let pinned = input.tool.sha256.as_deref().filter(|value| !value.trim().is_empty());
    if let Some(expected) = pinned {
        verify_sha256(input.artifact, expected.trim()).map_err(Blocked::HashMismatch)?;
    }

    let level = if sig_ok {
        Some(Level::Sig)
    } else if checksum_ok {
        Some(Level::Checksum)
    } else if pinned.is_some() {
        Some(Level::Pinned)
    } else {
        None
    };

    match level {
        Some(level) => Ok(Decision::Allowed(Verified { level, sha256: actual })),
        None if input.tool.method == Method::Vendor => Ok(Decision::NeedsPin { sha256: actual }),
        None => Err(Blocked::NoVerification),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::load_str;
    use chrono::Duration;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn tool(toml: &str) -> Tool {
        load_str(&format!("[defaults]\ncooldown_days = 7\n\n{toml}")).unwrap().tools.into_iter().next().unwrap()
    }

    const RELEASE: &str = "[[tool]]\nname=\"lite\"\nmethod=\"release\"\nrepo=\"o/r\"\nversion=\"1.0.0\"\nasset=\"a.tar.gz\"\nchecksum=\"sums.txt\"\nbin=\"lite\"\n";
    const VENDOR: &str = "[[tool]]\nname=\"v\"\nmethod=\"vendor\"\nurl=\"https://example.com/v.zip\"\nbin=\"v\"\nversion=\"1\"\n";

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cli-gate-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sha(path: &Path) -> String {
        sha256_file(path).unwrap()
    }

    fn input<'a>(tool: &'a Tool, artifact: &'a Path, sums: Option<&'a str>) -> GateInput<'a> {
        let now = Utc::now();
        GateInput {
            tool,
            artifact,
            checksums_text: sums,
            asset_name: "a.tar.gz",
            sig: None,
            published: now - Duration::days(10),
            now,
            cooldown_days: 7,
        }
    }

    #[test]
    fn checksum_match_passes_at_checksum_level() {
        let dir = tmp("ok");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums = format!("{}  a.tar.gz\n", sha(&file));
        let tool = tool(RELEASE);
        let decision = evaluate(&input(&tool, &file, Some(&sums))).unwrap();
        assert_eq!(
            decision,
            Decision::Allowed(Verified { level: Level::Checksum, sha256: sha(&file) })
        );
    }

    #[test]
    fn young_release_is_blocked_by_cooldown() {
        let dir = tmp("young");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums = format!("{}  a.tar.gz\n", sha(&file));
        let tool = tool(RELEASE);
        let mut gate = input(&tool, &file, Some(&sums));
        gate.published = gate.now - Duration::days(2);
        let error = evaluate(&gate).unwrap_err();
        assert!(matches!(error, Blocked::Cooldown(_)));
        assert_eq!(error.exit_code(), 2);
    }

    #[test]
    fn tampered_artifact_is_blocked() {
        let dir = tmp("tamper");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums = format!("{}  a.tar.gz\n", sha(&file));
        fs::write(&file, b"payloaD").unwrap();
        let tool = tool(RELEASE);
        let error = evaluate(&input(&tool, &file, Some(&sums))).unwrap_err();
        assert!(matches!(error, Blocked::HashMismatch(_)));
        assert_eq!(error.exit_code(), 2);
    }

    #[test]
    fn checksum_file_without_the_asset_is_blocked() {
        let dir = tmp("missing");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums = format!("{}  other.tar.gz\n{}  third.zip\n", "a".repeat(64), "b".repeat(64));
        let tool = tool(RELEASE);
        let error = evaluate(&input(&tool, &file, Some(&sums))).unwrap_err();
        assert!(matches!(error, Blocked::ChecksumMissing { .. }));
    }

    #[test]
    fn release_without_any_verification_is_blocked() {
        let dir = tmp("noverify");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let tool = tool(RELEASE);
        let error = evaluate(&input(&tool, &file, None)).unwrap_err();
        assert!(matches!(error, Blocked::NoVerification));
        assert_eq!(error.exit_code(), 2);
    }

    #[test]
    fn vendor_without_pin_asks_for_approval() {
        let dir = tmp("needspin");
        let file = dir.join("v.zip");
        fs::write(&file, b"zip").unwrap();
        let tool = tool(VENDOR);
        let decision = evaluate(&input(&tool, &file, None)).unwrap();
        assert_eq!(decision, Decision::NeedsPin { sha256: sha(&file) });
    }

    #[test]
    fn vendor_pinned_hash_passes_and_mismatch_blocks() {
        let dir = tmp("pinned");
        let file = dir.join("v.zip");
        fs::write(&file, b"zip").unwrap();
        let good = format!("{VENDOR}sha256=\"{}\"\n", sha(&file));
        let tool_ok = tool(&good);
        let decision = evaluate(&input(&tool_ok, &file, None)).unwrap();
        assert_eq!(
            decision,
            Decision::Allowed(Verified { level: Level::Pinned, sha256: sha(&file) })
        );
        let bad = format!("{VENDOR}sha256=\"{}\"\n", "0".repeat(64));
        let tool_bad = tool(&bad);
        assert!(matches!(
            evaluate(&input(&tool_bad, &file, None)).unwrap_err(),
            Blocked::HashMismatch(_)
        ));
    }

    #[test]
    fn pin_must_still_match_when_a_checksum_also_passes() {
        let dir = tmp("both");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums = format!("{}  a.tar.gz\n", sha(&file));
        let text = format!("{RELEASE}sha256=\"{}\"\n", "1".repeat(64));
        let tool = tool(&text);
        assert!(matches!(
            evaluate(&input(&tool, &file, Some(&sums))).unwrap_err(),
            Blocked::HashMismatch(_)
        ));
    }

    fn gpg_present() -> bool {
        Command::new("gpg").arg("--version").output().is_ok()
    }

    /// 임시 키를 만들어 file 에 분리 서명하고 (공개키 파일, 서명 파일, 지문)을 돌려준다.
    fn sign(dir: &Path, file: &Path) -> (PathBuf, PathBuf, String) {
        let home = dir.join("gnupg");
        fs::create_dir_all(&home).unwrap();
        let run = |args: &[&str]| {
            let out = Command::new("gpg")
                .env("GNUPGHOME", &home)
                .args(["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", ""])
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success(), "gpg {args:?}: {}", String::from_utf8_lossy(&out.stderr));
            out
        };
        run(&["--quick-generate-key", "gate <g@example.com>", "ed25519", "sign", "never"]);
        let listing = run(&["--with-colons", "--list-keys"]);
        let text = String::from_utf8_lossy(&listing.stdout).to_string();
        let fingerprint = text
            .lines()
            .skip_while(|line| !line.starts_with("pub"))
            .find(|line| line.starts_with("fpr"))
            .unwrap()
            .split(':')
            .nth(9)
            .unwrap()
            .to_string();
        let sig = dir.join("sig.asc");
        run(&["--detach-sign", "--output", sig.to_str().unwrap(), file.to_str().unwrap()]);
        let key = dir.join("pub.gpg");
        run(&["--export", "--output", key.to_str().unwrap(), &fingerprint]);
        (key, sig, fingerprint)
    }

    #[test]
    fn signed_checksum_file_gives_sig_level_and_bad_sig_blocks() {
        if !gpg_present() {
            println!("gpg missing; skipped");
            return;
        }
        let dir = tmp("sig");
        let file = dir.join("a.tar.gz");
        fs::write(&file, b"payload").unwrap();
        let sums_path = dir.join("sums.txt");
        let sums = format!("{}  a.tar.gz\n", sha(&file));
        fs::write(&sums_path, &sums).unwrap();
        let (key, sig, fingerprint) = sign(&dir, &sums_path);

        let text = format!("{RELEASE}gpg_fingerprint=\"{fingerprint}\"\nsig=\"sums.txt.sig\"\n");
        let tool = tool(&text);
        let mut gate = input(&tool, &file, Some(&sums));
        gate.sig = Some(SigInput {
            signed_file: &sums_path,
            sig_file: &sig,
            key_source: KeySource::KeyFile(&key),
            covers: SigCovers::ChecksumFile,
        });
        let decision = evaluate(&gate).unwrap();
        assert_eq!(
            decision,
            Decision::Allowed(Verified { level: Level::Sig, sha256: sha(&file) })
        );

        // 체크섬 파일이 바뀌면 서명 검증이 실패한다.
        fs::write(&sums_path, format!("{}  a.tar.gz\n", "f".repeat(64))).unwrap();
        let mut gate = input(&tool, &file, Some(&sums));
        gate.sig = Some(SigInput {
            signed_file: &sums_path,
            sig_file: &sig,
            key_source: KeySource::KeyFile(&key),
            covers: SigCovers::ChecksumFile,
        });
        assert!(matches!(evaluate(&gate).unwrap_err(), Blocked::Sig(_)));
    }
}
