use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const CACHE_VERSION: u32 = 1;
pub const DEFAULT_CACHE_PATH: &str = "/tmp/provider-usage/state.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderState {
    Available,
    Exhausted,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub name: String,
    pub used_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub checked_at: i64,
    pub state: ProviderState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<i64>,
    pub fresh_until: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_credits: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub windows: Vec<UsageWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renews_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CacheFile {
    pub version: u32,
    pub providers: BTreeMap<String, ProviderSnapshot>,
}

impl Default for CacheFile {
    fn default() -> Self {
        Self::empty()
    }
}

impl CacheFile {
    pub fn empty() -> Self {
        Self {
            version: CACHE_VERSION,
            providers: BTreeMap::new(),
        }
    }
}

pub trait Store {
    fn load(&self) -> Result<CacheFile>;
    fn save(&self, cache: &CacheFile) -> Result<()>;
}

#[derive(Clone, Debug)]
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn lock_path(&self) -> PathBuf {
        self.path.with_extension("json.lock")
    }

    fn with_lock<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        if let Some(parent) = self.path.parent() {
            fs::DirBuilder::new()
                .mode(0o700)
                .recursive(true)
                .create(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
        let lock = OpenOptions::new()
            .create(true)
            .write(true)
            .mode(0o600)
            .open(self.lock_path())
            .with_context(|| format!("opening lock {}", self.lock_path().display()))?;
        let fd = lock.as_raw_fd();
        let rc = unsafe { libc::flock(fd, libc::LOCK_EX) };
        if rc != 0 {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("locking {}", self.lock_path().display()));
        }
        let result = f();
        unsafe {
            libc::flock(fd, libc::LOCK_UN);
        }
        result
    }
}

impl Store for FileStore {
    fn load(&self) -> Result<CacheFile> {
        self.with_lock(|| read_unlocked(&self.path))
    }

    fn save(&self, cache: &CacheFile) -> Result<()> {
        self.with_lock(|| write_unlocked(&self.path, cache))
    }
}

fn read_unlocked(path: &Path) -> Result<CacheFile> {
    if !path.exists() {
        return Ok(CacheFile::empty());
    }
    let mut file = File::open(path).with_context(|| format!("reading {}", path.display()))?;
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    if buf.trim().is_empty() {
        return Ok(CacheFile::empty());
    }
    let parsed: CacheFile =
        serde_json::from_str(&buf).with_context(|| format!("parsing {}", path.display()))?;
    if parsed.version != CACHE_VERSION {
        return Ok(CacheFile::empty());
    }
    Ok(parsed)
}

fn write_unlocked(path: &Path, cache: &CacheFile) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(cache)?;
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .with_context(|| format!("writing {}", tmp.display()))?;
        file.write_all(&body)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("renaming {}", tmp.display()))?;
    Ok(())
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore {
    inner: std::sync::Mutex<CacheFile>,
}

#[cfg(test)]
impl Store for MemoryStore {
    fn load(&self) -> Result<CacheFile> {
        Ok(self.inner.lock().expect("cache mutex").clone())
    }

    fn save(&self, cache: &CacheFile) -> Result<()> {
        *self.inner.lock().expect("cache mutex") = cache.clone();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_json_without_secrets() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("state.json");
        let store = FileStore::new(&path);
        let mut cache = CacheFile::empty();
        cache.providers.insert(
            "commandcode:9f86d081884c".into(),
            ProviderSnapshot {
                checked_at: 10,
                state: ProviderState::Exhausted,
                reason: Some("credits".into()),
                reset_at: None,
                fresh_until: 20,
                remaining_credits: Some(0),
                windows: Vec::new(),
                renews_at: None,
            },
        );
        store.save(&cache).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded, cache);
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("sk-"));
        assert!(!text.contains("cookie"));
    }
}
