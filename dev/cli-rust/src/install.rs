//! install / remove 흐름. 플랜 §3~§5, §7.
//! 다운로드 → 게이트 → (승인) → proto 플러그인 등록·설치 → `.protolock` 교차 대조 → lock.json 기록.

use std::fs;
use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};

use crate::cooldown::check_cooldown;
use crate::engine::Proto;
use crate::gate::{evaluate, Blocked, Decision, GateInput, Level, SigCovers, SigInput};
use crate::http::{self, HostPolicy};
use crate::lock::{Guard, LockEntry, LockFile};
use crate::manifest::{Method, Status, Tool};
use crate::paths::Paths;
use crate::pin::write_pin;
use crate::plugin;
use crate::resolve::{latest_candidate, published_at, release_info, HttpFetch};
use crate::verify::KeySource;

pub const DEFAULT_KEYSERVER: &str = "hkps://keyserver.ubuntu.com";

pub trait Prompt {
    fn interactive(&self) -> bool;
    fn confirm(&self, message: &str) -> bool;
}

pub struct TtyPrompt;

impl Prompt for TtyPrompt {
    fn interactive(&self) -> bool {
        std::io::stdin().is_terminal() && std::io::stderr().is_terminal()
    }

    fn confirm(&self, message: &str) -> bool {
        eprint!("{message} [y/N] ");
        let _ = std::io::stderr().flush();
        let mut line = String::new();
        if std::io::stdin().lock().read_line(&mut line).is_err() {
            return false;
        }
        matches!(line.trim(), "y" | "Y" | "yes" | "YES")
    }
}

pub struct Env<'a> {
    pub paths: &'a Paths,
    pub manifest_path: &'a Path,
    pub cooldown_days: u32,
    pub yes: bool,
    pub dry_run: bool,
    pub prompt: &'a dyn Prompt,
    pub now: DateTime<Utc>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Installed { version: String, level: String },
    AlreadyInstalled { version: String },
    DryRun { version: String, decision: String },
    Removed,
}

fn expand(template: &str, version: &str) -> String {
    template.replace("{version}", version)
}

/// 쓰기 전에 승인을 받는다. 비TTY 이고 `--yes` 가 없으면 오류.
pub(crate) fn approve(env: &Env<'_>, message: &str) -> Result<()> {
    if env.yes {
        return Ok(());
    }
    if !env.prompt.interactive() {
        bail!("승인이 필요합니다: 터미널에서 실행하거나 --yes 를 붙이세요");
    }
    if env.prompt.confirm(message) {
        Ok(())
    } else {
        bail!("취소")
    }
}

pub fn install_tool(env: &Env<'_>, tool: &Tool) -> Result<Outcome> {
    install_tool_with(env, tool, false)
}

/// `replace` 가 참이면 다른 버전이 이미 설치돼 있어도 새 버전으로 바꾼다(update·rollback).
pub fn install_tool_with(env: &Env<'_>, tool: &Tool, replace: bool) -> Result<Outcome> {
    let lock = LockFile::load(&env.paths.lock_json())?;
    if let Some(entry) = lock.tools.get(&tool.name) {
        let wanted = tool.version.as_deref().map(|v| v.trim_start_matches('v'));
        if wanted == Some(entry.version.trim_start_matches('v')) {
            return Ok(Outcome::AlreadyInstalled {
                version: entry.version.clone(),
            });
        }
        if !replace {
            bail!(
                "{} {} 가 이미 설치됨. 버전을 바꾸려면 cli update {}",
                tool.name,
                entry.version,
                tool.name
            );
        }
    }

    if let Some(version) = tool.version.as_deref().filter(|v| crate::resolve::is_prerelease(v)) {
        return Err(crate::gate::Blocked::Prerelease {
            version: version.to_string(),
        }
        .into());
    }

    if matches!(tool.method, Method::Bun | Method::Go | Method::Cargo) {
        return crate::pkg::install(env, tool, replace);
    }

    let policy = HostPolicy::for_tool(tool);
    let client = http::client(policy.clone())?;
    let fetch = HttpFetch::new(policy.clone())?;

    let pending = tool.status == Status::Pending;
    let version = match tool.version.as_deref().filter(|v| !v.is_empty()) {
        Some(version) => version.to_string(),
        None if pending && tool.method == Method::Vendor => latest_candidate(tool, &fetch)
            .with_context(|| format!("{}: version_from 이 없으면 tools.toml 에 version 을 직접 적어야 합니다", tool.name))?,
        None => bail!("{}: tools.toml 에 version 이 없습니다", tool.name),
    };

    // 출처 URL 과 게시 시각
    let (artifact_url, artifact_name, checksum_url, sig_url, tag, published) = match tool.method {
        Method::Release => {
            let repo = tool.repo.as_deref().context("missing repo")?;
            let (tag, published) = release_info(tool, &version, &fetch)?;
            let base = format!("https://github.com/{repo}/releases/download/{tag}");
            let asset = expand(tool.asset.as_deref().context("missing asset")?, &version);
            let checksum = expand(tool.checksum.as_deref().context("missing checksum")?, &version);
            let sig = tool.sig.as_deref().map(|name| format!("{base}/{}", expand(name, &version)));
            (
                format!("{base}/{asset}"),
                asset,
                Some(format!("{base}/{checksum}")),
                sig,
                Some(tag),
                published,
            )
        }
        _ => {
            let url = tool.url.clone().context("missing url")?;
            let name = url.rsplit('/').next().unwrap_or("artifact").to_string();
            let published = published_at(tool, &version, &fetch)?;
            (url, name, None, tool.sig_url.clone(), None, published)
        }
    };

    // 내려받기 전에 cooldown 부터 본다. 막힐 아티팩트를 받을 이유가 없다.
    if let Err(violation) = check_cooldown(published, env.now, env.cooldown_days) {
        return Err(crate::gate::Blocked::from(violation).into());
    }

    let tmp = env.paths.tmp_dir(&tool.name);
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let result = gate_and_install(
        env, tool, &version, &policy, &client, &artifact_url, &artifact_name,
        checksum_url.as_deref(), sig_url.as_deref(), tag.as_deref(), published, &tmp,
    );
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[allow(clippy::too_many_arguments)]
fn gate_and_install(
    env: &Env<'_>,
    tool: &Tool,
    version: &str,
    policy: &HostPolicy,
    client: &reqwest::blocking::Client,
    artifact_url: &str,
    artifact_name: &str,
    checksum_url: Option<&str>,
    sig_url: Option<&str>,
    tag: Option<&str>,
    published: DateTime<Utc>,
    tmp: &Path,
) -> Result<Outcome> {
    let artifact = tmp.join(artifact_name);
    eprintln!("내려받는 중: {artifact_url}");
    http::download(client, policy, artifact_url, &artifact)?;

    let checksums_text = match checksum_url {
        Some(url) => Some(http::get_text(client, policy, url)?),
        None => None,
    };
    let checksum_file = match (&checksums_text, checksum_url) {
        (Some(text), Some(url)) => {
            let path = tmp.join(url.rsplit('/').next().unwrap_or("checksums"));
            fs::write(&path, text)?;
            Some(path)
        }
        _ => None,
    };
    let sig_file = match sig_url {
        Some(url) => {
            let path = tmp.join(url.rsplit('/').next().unwrap_or("sig"));
            http::download(client, policy, url, &path)?;
            Some(path)
        }
        None => None,
    };

    // 공개키: 저장소에 둔 키 파일(tools.toml 기준 상대 경로)이 있으면 그것, 없으면 키서버.
    let key_path: Option<PathBuf> = tool.key_file.as_deref().map(|relative| {
        env.manifest_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(relative)
    });
    let key_source = || match &key_path {
        Some(path) => KeySource::KeyFile(path),
        None => KeySource::Keyserver(DEFAULT_KEYSERVER),
    };
    let sig = match (&sig_file, &checksum_file) {
        (Some(sig_file), Some(checksum_file)) => Some(SigInput {
            signed_file: checksum_file,
            sig_file,
            key_source: key_source(),
            covers: SigCovers::ChecksumFile,
        }),
        (Some(sig_file), None) => Some(SigInput {
            signed_file: &artifact,
            sig_file,
            key_source: key_source(),
            covers: SigCovers::Artifact,
        }),
        _ => None,
    };

    let decision = evaluate(&GateInput {
        tool,
        artifact: &artifact,
        checksums_text: checksums_text.as_deref(),
        asset_name: artifact_name,
        sig,
        published,
        now: env.now,
        cooldown_days: env.cooldown_days,
    })
    .map_err(anyhow::Error::from)?;

    let (level, sha256) = match decision {
        Decision::Allowed(verified) => (verified.level, verified.sha256),
        Decision::NeedsPin { sha256 } => {
            if env.dry_run {
                return Ok(Outcome::DryRun {
                    version: version.to_string(),
                    decision: format!("pin 승인 필요 (sha256 {sha256})"),
                });
            }
            if !env.prompt.interactive() {
                bail!("{}: sha256 고정 승인은 터미널에서만 할 수 있습니다 ({sha256})", tool.name);
            }
            let question = format!(
                "{} {} 의 sha256 {} 을 tools.toml 에 고정할까요?",
                tool.name, version, sha256
            );
            if !env.prompt.confirm(&question) {
                return Err(anyhow::Error::from(Blocked::NoVerification));
            }
            write_pin(env.manifest_path, &tool.name, &sha256, Some(version))?;
            (Level::Pinned, sha256)
        }
    };

    if env.dry_run {
        return Ok(Outcome::DryRun {
            version: version.to_string(),
            decision: format!("통과: {} (sha256 {})", level.as_str(), sha256),
        });
    }

    approve(
        env,
        &format!("{} {} ({}) 를 설치할까요?", tool.name, version, level.as_str()),
    )?;

    // 처음 설치되는 pending 도구는 검증한 버전과 해시를 목록에 고정한다.
    if tool.status == Status::Pending {
        write_pin(env.manifest_path, &tool.name, &sha256, Some(version))?;
    }

    let _guard = Guard::acquire(&env.paths.lock_json())?;
    env.paths.ensure_cli_home()?;
    let plugin_file = env.paths.plugin_file(&tool.name);
    fs::write(&plugin_file, plugin::render(tool, version, tag)?)?;
    let proto = Proto { paths: env.paths };
    proto.plugin_add(&tool.name, &plugin_file)?;
    proto.install(&tool.name, version)?;

    // 교차 대조: proto 가 받은 아티팩트의 해시가 cli 가 검증한 값과 같아야 한다.
    match fs::read_to_string(env.paths.protolock())
        .ok()
        .and_then(|text| plugin::protolock_sha256(&text, &tool.name, version))
    {
        Some(recorded) if recorded != sha256 => {
            let _ = proto.uninstall(&tool.name, version);
            return Err(anyhow::Error::from(Blocked::HashMismatch(
                crate::checksum::ChecksumMismatch {
                    expected: sha256,
                    actual: recorded,
                },
            )));
        }
        Some(_) => {}
        None => eprintln!("경고: .protolock 에 {} {} 기록이 없어 교차 대조를 건너뜀", tool.name, version),
    }

    let mut lock = LockFile::load(&env.paths.lock_json())?;
    lock.tools.insert(
        tool.name.clone(),
        LockEntry {
            method: format!("{:?}", tool.method).to_lowercase(),
            version: version.to_string(),
            source: artifact_url.to_string(),
            digest: sha256,
            level: level.as_str().to_string(),
            package: String::new(),
            bin: env.paths.shim(tool.exe_name()).display().to_string(),
            installed_at: env.now.to_rfc3339(),
            previous: previous_of(&lock, &tool.name, version),
        },
    );
    lock.save(&env.paths.lock_json())?;
    Ok(Outcome::Installed {
        version: version.to_string(),
        level: level.as_str().to_string(),
    })
}

/// 같은 이름의 기존 기록이 다른 버전이면 그 버전(롤백 대상).
pub(crate) fn previous_of(lock: &LockFile, name: &str, new_version: &str) -> Option<String> {
    lock.tools
        .get(name)
        .filter(|entry| entry.version != new_version)
        .map(|entry| entry.version.clone())
}

fn is_pkg(method: &str) -> bool {
    matches!(method, "bun" | "go" | "cargo")
}

pub fn remove_tool(env: &Env<'_>, name: &str) -> Result<Outcome> {
    let mut lock = LockFile::load(&env.paths.lock_json())?;
    let entry = lock
        .tools
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow!("{name}: cli 가 설치한 기록이 없습니다 (lock.json)"))?;
    if env.dry_run {
        let decision = if is_pkg(&entry.method) {
            crate::pkg::describe_removal(env.paths, &entry)
        } else {
            format!(
                "삭제 대상: proto {name} {}, 플러그인 {}",
                entry.version,
                env.paths.plugin_file(name).display()
            )
        };
        return Ok(Outcome::DryRun {
            version: entry.version,
            decision,
        });
    }
    let question = if is_pkg(&entry.method) {
        format!("{name} {} 를 삭제할까요? ({})", entry.version, crate::pkg::describe_removal(env.paths, &entry))
    } else {
        format!(
            "{name} {} 를 삭제할까요? (proto 설치본, 전역 핀, 플러그인 {}, lock 기록)",
            entry.version,
            env.paths.plugin_file(name).display()
        )
    };
    approve(env, &question)?;
    let _guard = Guard::acquire(&env.paths.lock_json())?;
    if is_pkg(&entry.method) {
        crate::pkg::uninstall(env.paths, &entry)?;
        lock.tools.remove(name);
        lock.save(&env.paths.lock_json())?;
        return Ok(Outcome::Removed);
    }
    let proto = Proto { paths: env.paths };
    proto.uninstall(name, &entry.version)?;
    let _ = proto.plugin_remove(name);
    let plugin_file: PathBuf = env.paths.plugin_file(name);
    let _ = fs::remove_file(plugin_file);
    lock.tools.remove(name);
    lock.save(&env.paths.lock_json())?;
    Ok(Outcome::Removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct Yes;
    impl Prompt for Yes {
        fn interactive(&self) -> bool {
            true
        }
        fn confirm(&self, _: &str) -> bool {
            true
        }
    }
    struct NoTty;
    impl Prompt for NoTty {
        fn interactive(&self) -> bool {
            false
        }
        fn confirm(&self, _: &str) -> bool {
            false
        }
    }

    fn setup(name: &str) -> (Paths, PathBuf) {
        let dir = std::env::temp_dir().join(format!("cli-install-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("calls.log");
        let fake = dir.join("proto");
        fs::write(&fake, format!("#!/bin/sh\necho \"$@\" >> {}\n", log.display())).unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let paths = Paths::new(dir.join("home"), dir.join("state"), fake.display().to_string());
        (paths, log)
    }

    fn env<'a>(paths: &'a Paths, prompt: &'a dyn Prompt, yes: bool, dry_run: bool) -> Env<'a> {
        Env {
            paths,
            manifest_path: Path::new("/nonexistent"),
            cooldown_days: 7,
            yes,
            dry_run,
            prompt,
            now: Utc::now(),
        }
    }

    fn seed(paths: &Paths) {
        paths.ensure_cli_home().unwrap();
        fs::write(paths.plugin_file("lite"), "name = \"lite\"\n").unwrap();
        let mut lock = LockFile::load(&paths.lock_json()).unwrap();
        lock.tools.insert(
            "lite".into(),
            LockEntry {
                method: "release".into(),
                version: "1.0.0".into(),
                source: "https://github.com/o/r/x".into(),
                digest: "a".repeat(64),
                level: "checksum".into(),
                package: String::new(),
                bin: "/x/shims/lite".into(),
                installed_at: "2026-11-02T00:00:00+00:00".into(),
                previous: None,
            },
        );
        lock.save(&paths.lock_json()).unwrap();
    }

    #[test]
    fn remove_uninstalls_unregisters_and_forgets() {
        let (paths, log) = setup("remove");
        seed(&paths);
        let outcome = remove_tool(&env(&paths, &Yes, true, false), "lite").unwrap();
        assert_eq!(outcome, Outcome::Removed);
        let calls = fs::read_to_string(&log).unwrap();
        assert!(calls.contains("uninstall lite 1.0.0"), "{calls}");
        assert!(calls.contains("plugin remove lite --from global"), "{calls}");
        assert!(!paths.plugin_file("lite").exists());
        assert!(LockFile::load(&paths.lock_json()).unwrap().tools.is_empty());
    }

    #[test]
    fn remove_dry_run_changes_nothing() {
        let (paths, log) = setup("dry");
        seed(&paths);
        let outcome = remove_tool(&env(&paths, &Yes, false, true), "lite").unwrap();
        assert!(matches!(outcome, Outcome::DryRun { .. }));
        assert!(!log.exists());
        assert!(paths.plugin_file("lite").exists());
        assert_eq!(LockFile::load(&paths.lock_json()).unwrap().tools.len(), 1);
    }

    #[test]
    fn remove_without_tty_or_yes_is_refused_and_changes_nothing() {
        let (paths, log) = setup("notty");
        seed(&paths);
        let error = remove_tool(&env(&paths, &NoTty, false, false), "lite").unwrap_err();
        assert!(format!("{error:#}").contains("승인이 필요"));
        assert!(!log.exists());
        assert_eq!(LockFile::load(&paths.lock_json()).unwrap().tools.len(), 1);
    }

    #[test]
    fn remove_of_an_unrecorded_tool_is_refused() {
        let (paths, log) = setup("unknown");
        paths.ensure_cli_home().unwrap();
        let error = remove_tool(&env(&paths, &Yes, true, false), "ghost").unwrap_err();
        assert!(format!("{error:#}").contains("기록이 없습니다"));
        assert!(!log.exists());
    }

    #[test]
    fn a_second_cli_holding_the_lock_blocks_remove_before_anything_changes() {
        let (paths, log) = setup("locked");
        seed(&paths);
        let _held = Guard::acquire(&paths.lock_json()).unwrap();
        assert!(remove_tool(&env(&paths, &Yes, true, false), "lite").is_err());
        assert!(!log.exists());
    }
}
