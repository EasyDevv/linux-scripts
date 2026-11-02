//! `lock.json` — cli 가 설치한 도구의 기록. 한 번에 한 명령만 쓰도록 flock 으로 잠근다.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockFile {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub tools: BTreeMap<String, LockEntry>,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockEntry {
    pub method: String,
    pub version: String,
    pub source: String,
    /// release/vendor 는 아티팩트 sha256, bun 은 레지스트리 integrity(sha512-…), go/cargo 는 비어 있음.
    #[serde(alias = "sha256")]
    pub digest: String,
    /// sig | checksum | pinned | registry | sumdb | locked
    pub level: String,
    /// bun/cargo 패키지 이름, go 모듈 경로. 삭제할 때 쓴다. release/vendor 는 비어 있음.
    #[serde(default)]
    pub package: String,
    /// PATH 에서 실행되는 경로(proto 심).
    pub bin: String,
    pub installed_at: String,
    /// 업데이트 직전 버전. `cli update <이름> --rollback` 이 이 버전으로 되돌린다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
}

impl LockFile {
    pub fn load(path: &Path) -> Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text)
                .with_context(|| format!("invalid lock file {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                version: 1,
                tools: BTreeMap::new(),
            }),
            Err(error) => Err(error).with_context(|| format!("read {}", path.display())),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(self)? + "\n")?;
        fs::rename(&tmp, path)?;
        Ok(())
    }
}

/// 열려 있는 동안 배타 잠금을 쥔다. 이미 다른 cli 가 쥐고 있으면 즉시 오류.
pub struct Guard {
    _file: File,
    _path: PathBuf,
}

impl Guard {
    pub fn acquire(lock_json: &Path) -> Result<Self> {
        if let Some(parent) = lock_json.parent() {
            fs::create_dir_all(parent)?;
        }
        let path = lock_json.with_extension("json.flock");
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .with_context(|| format!("open {}", path.display()))?;
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc != 0 {
            bail!("another cli command is running (lock held: {})", path.display());
        }
        Ok(Self {
            _file: file,
            _path: path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cli-lock-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry() -> LockEntry {
        LockEntry {
            method: "release".into(),
            version: "0.5.17".into(),
            source: "https://github.com/o/r/releases/download/v0.5.17/a.tgz".into(),
            digest: "a".repeat(64),
            level: "checksum".into(),
            package: String::new(),
            bin: "/home/u/.proto/shims/lite".into(),
            installed_at: "2026-11-02T00:00:00+00:00".into(),
            previous: None,
        }
    }

    #[test]
    fn missing_file_loads_as_empty_and_roundtrips() {
        let dir = tmp("roundtrip");
        let path = dir.join("state/lock.json");
        let mut lock = LockFile::load(&path).unwrap();
        assert!(lock.tools.is_empty());
        lock.tools.insert("lite".into(), entry());
        lock.save(&path).unwrap();
        assert_eq!(LockFile::load(&path).unwrap(), lock);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn corrupt_file_is_an_error() {
        let dir = tmp("corrupt");
        let path = dir.join("lock.json");
        fs::write(&path, "{ nope").unwrap();
        assert!(LockFile::load(&path).is_err());
    }

    #[test]
    fn second_guard_is_refused_until_the_first_drops() {
        let dir = tmp("guard");
        let path = dir.join("lock.json");
        let first = Guard::acquire(&path).unwrap();
        assert!(Guard::acquire(&path).is_err());
        drop(first);
        assert!(Guard::acquire(&path).is_ok());
    }
}
