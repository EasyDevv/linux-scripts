//! `cli update` — 후보 조회(`--check`), 교체, 되돌리기(`--rollback`).
//! 교체와 되돌리기는 모두 설치 흐름(게이트 포함)을 그대로 거친다. 되돌리기는 lock 에 남긴 직전 버전을 다시 설치한다.

use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::cooldown::check_cooldown;
use crate::http::HostPolicy;
use crate::install::{install_tool_with, Env, Outcome};
use crate::lock::{LockEntry, LockFile};
use crate::manifest::{Method, Tool};
use crate::pin::write_version;
use crate::resolve::{latest_candidate, published_at, Fetch, HttpFetch};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Candidate {
    pub name: String,
    pub current: String,
    pub latest: Option<String>,
    /// latest(최신) | update(교체 가능) | cooldown(대기) | unknown(확인 불가)
    pub status: &'static str,
    pub detail: String,
}

fn plain(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

/// 도구 하나의 후보를 조회한다(읽기 전용).
pub fn check_tool(
    tool: &Tool,
    entry: &LockEntry,
    fetch: &dyn Fetch,
    now: DateTime<Utc>,
    cooldown_days: u32,
) -> Candidate {
    let mut candidate = Candidate {
        name: tool.name.clone(),
        current: entry.version.clone(),
        latest: None,
        status: "unknown",
        detail: String::new(),
    };
    let latest = match latest_candidate(tool, fetch) {
        Ok(version) => plain(&version).to_string(),
        Err(error) => {
            candidate.detail = format!("{error:#}");
            return candidate;
        }
    };
    candidate.latest = Some(latest.clone());
    if plain(&entry.version) == latest {
        candidate.status = "latest";
        return candidate;
    }
    let mut next = tool.clone();
    next.version = Some(latest.clone());
    match published_at(&next, &latest, fetch) {
        Ok(published) => match check_cooldown(published, now, cooldown_days) {
            Ok(()) => {
                candidate.status = "update";
                candidate.detail = format!("게시 {}", published.format("%Y-%m-%d"));
            }
            Err(violation) => {
                candidate.status = "cooldown";
                candidate.detail = format!(
                    "게시 {}일 전, {}일 필요",
                    violation.age_days, violation.required_days
                );
            }
        },
        Err(error) => candidate.detail = format!("게시 시각 확인 실패: {error:#}"),
    }
    candidate
}

pub fn check_all(
    tools: &[&Tool],
    lock: &LockFile,
    now: DateTime<Utc>,
    cooldown_days: u32,
) -> Vec<Candidate> {
    tools
        .iter()
        .filter_map(|tool| {
            let entry = lock.tools.get(&tool.name)?;
            let fetch = HttpFetch::new(HostPolicy::for_tool(tool)).ok()?;
            Some(check_tool(tool, entry, &fetch, now, cooldown_days))
        })
        .collect()
}

pub fn render(candidates: &[Candidate]) -> String {
    let mut out = String::new();
    let width = candidates.iter().map(|c| c.name.len()).max().unwrap_or(4).max(4);
    for c in candidates {
        let label = match c.status {
            "latest" => "최신",
            "update" => "교체 가능",
            "cooldown" => "대기",
            _ => "확인 불가",
        };
        let latest = c.latest.as_deref().unwrap_or("-");
        out.push_str(&format!(
            "{:<width$}  {} → {}  {}  {}\n",
            c.name, c.current, latest, label, c.detail
        ));
    }
    if candidates.is_empty() {
        out.push_str("cli 로 설치한 도구가 없습니다\n");
    }
    out
}

/// 새 버전으로 교체한다. vendor 도구의 옛 고정 sha256 은 새 버전에 맞지 않으므로 비워 게이트가 다시 판단한다.
pub fn update_tool(env: &Env<'_>, tool: &Tool, fetch: &dyn Fetch) -> Result<Outcome> {
    let lock = LockFile::load(&env.paths.lock_json())?;
    let entry = lock
        .tools
        .get(&tool.name)
        .ok_or_else(|| anyhow!("{}: cli 로 설치한 기록이 없습니다 (cli install)", tool.name))?;
    let latest = plain(&latest_candidate(tool, fetch)?).to_string();
    if plain(&entry.version) == latest {
        return Ok(Outcome::AlreadyInstalled {
            version: entry.version.clone(),
        });
    }
    replace_with(env, tool, &latest)
}

/// lock 이 기록한 직전 버전으로 되돌린다.
pub fn rollback_tool(env: &Env<'_>, tool: &Tool) -> Result<Outcome> {
    let lock = LockFile::load(&env.paths.lock_json())?;
    let entry = lock
        .tools
        .get(&tool.name)
        .ok_or_else(|| anyhow!("{}: cli 로 설치한 기록이 없습니다", tool.name))?;
    let Some(previous) = entry.previous.clone() else {
        bail!("{}: 되돌릴 이전 버전 기록이 없습니다", tool.name);
    };
    replace_with(env, tool, &previous)
}

fn replace_with(env: &Env<'_>, tool: &Tool, version: &str) -> Result<Outcome> {
    let mut next = tool.clone();
    next.version = Some(version.to_string());
    if next.method == Method::Vendor {
        next.sha256 = None;
    }
    let outcome = install_tool_with(env, &next, true)?;
    if matches!(outcome, Outcome::Installed { .. }) {
        write_version(env.manifest_path, &tool.name, version)?;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::load_str;

    struct Stub {
        latest: &'static str,
        time: String,
    }

    impl Fetch for Stub {
        fn get_text(&self, url: &str) -> Result<String> {
            if url.ends_with("/releases/latest") {
                Ok(format!("{{\"tag_name\":\"v{}\"}}", self.latest))
            } else if url.contains("/releases/tags/") {
                Ok(format!("{{\"tag_name\":\"v{}\",\"published_at\":\"{}\"}}", self.latest, self.time))
            } else {
                bail!("unexpected url {url}")
            }
        }
        fn head_last_modified(&self, _: &str) -> Result<Option<String>> {
            Ok(None)
        }
    }

    fn tool() -> Tool {
        load_str("[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"lite\"\nmethod = \"release\"\nrepo = \"o/lite\"\nversion = \"1.0.0\"\nasset = \"a_{version}.tgz\"\nchecksum = \"c_{version}.txt\"\nbin = \"lite\"\n")
            .unwrap()
            .tools
            .remove(0)
    }

    fn entry(version: &str) -> LockEntry {
        LockEntry {
            method: "release".into(),
            version: version.into(),
            source: String::new(),
            digest: String::new(),
            level: "checksum".into(),
            package: String::new(),
            bin: String::new(),
            installed_at: String::new(),
            previous: None,
        }
    }

    fn at(days_ago: i64) -> (DateTime<Utc>, String) {
        let now = Utc::now();
        (now, (now - chrono::Duration::days(days_ago)).to_rfc3339())
    }

    #[test]
    fn same_version_is_latest() {
        let (now, time) = at(30);
        let stub = Stub { latest: "1.0.0", time };
        let c = check_tool(&tool(), &entry("1.0.0"), &stub, now, 7);
        assert_eq!(c.status, "latest");
    }

    #[test]
    fn newer_old_enough_is_an_update_and_too_new_waits() {
        let (now, time) = at(30);
        let stub = Stub { latest: "1.1.0", time };
        let c = check_tool(&tool(), &entry("1.0.0"), &stub, now, 7);
        assert_eq!((c.status, c.latest.as_deref()), ("update", Some("1.1.0")));

        let (now, time) = at(2);
        let stub = Stub { latest: "1.1.0", time };
        let c = check_tool(&tool(), &entry("1.0.0"), &stub, now, 7);
        assert_eq!(c.status, "cooldown");
        assert!(c.detail.contains("7일 필요"), "{}", c.detail);
    }

    #[test]
    fn lookup_failures_are_unknown_not_errors() {
        struct Down;
        impl Fetch for Down {
            fn get_text(&self, _: &str) -> Result<String> {
                bail!("offline")
            }
            fn head_last_modified(&self, _: &str) -> Result<Option<String>> {
                bail!("offline")
            }
        }
        let c = check_tool(&tool(), &entry("1.0.0"), &Down, Utc::now(), 7);
        assert_eq!(c.status, "unknown");
        assert!(c.detail.contains("offline"));
    }

    #[test]
    fn rollback_without_a_previous_version_is_refused() {
        use crate::install::{Prompt, Env};
        use crate::paths::Paths;
        struct Yes;
        impl Prompt for Yes {
            fn interactive(&self) -> bool {
                true
            }
            fn confirm(&self, _: &str) -> bool {
                true
            }
        }
        let dir = std::env::temp_dir().join(format!("cli-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let paths = Paths::new(dir.join("home"), dir.join("state"), "proto");
        let mut lock = LockFile::default();
        lock.tools.insert("lite".into(), entry("1.0.0"));
        lock.save(&paths.lock_json()).unwrap();
        let env = Env {
            paths: &paths,
            manifest_path: std::path::Path::new("/nonexistent"),
            cooldown_days: 7,
            yes: true,
            dry_run: false,
            prompt: &Yes,
            now: Utc::now(),
        };
        let error = rollback_tool(&env, &tool()).unwrap_err();
        assert!(format!("{error:#}").contains("이전 버전"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
