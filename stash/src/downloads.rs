use std::collections::HashMap;
use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime};

use futures_util::StreamExt;
use rusqlite::Connection;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};

use crate::config::{AppConfig, VpnConfig};
use crate::hls;
use crate::store::{self, JobPart, JobRow, unix_now};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FailureKind {
    Cancelled,
    DiskFull,
    IpBlocked,
    Transient,
    Permanent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DiskSpaceAction {
    Continue,
    Pause,
    StayPaused,
    Resume,
}

fn disk_space_action(
    paused: bool,
    available: u64,
    pause_below: u64,
    resume_above: u64,
) -> DiskSpaceAction {
    if paused {
        if available >= resume_above {
            DiskSpaceAction::Resume
        } else {
            DiskSpaceAction::StayPaused
        }
    } else if available < pause_below {
        DiskSpaceAction::Pause
    } else {
        DiskSpaceAction::Continue
    }
}

fn classify_failure(message: &str) -> FailureKind {
    let lower = message.to_ascii_lowercase();
    if lower == "cancelled" {
        FailureKind::Cancelled
    } else if lower.contains("no space left on device")
        || lower.contains("storage full")
        || lower.contains("os error 28")
    {
        FailureKind::DiskFull
    } else if lower.contains("http 403") || lower.contains("403 forbidden") {
        FailureKind::IpBlocked
    } else if ["http 400", "http 401", "http 404", "http 405", "http 410"]
        .iter()
        .any(|status| lower.contains(status))
        || lower.contains("encrypted hls")
        || lower.contains("playlist has no segments")
    {
        FailureKind::Permanent
    } else {
        FailureKind::Transient
    }
}

fn retry_delay(base_secs: u64, retry_count: u32, job_id: &str) -> u64 {
    let exponent = retry_count.min(6);
    let scaled = base_secs.saturating_mul(1_u64 << exponent);
    let jitter_window = scaled.div_ceil(4).max(1);
    let hash = job_id.bytes().fold(0_u64, |value, byte| {
        value.wrapping_mul(31).wrapping_add(byte as u64)
    });
    scaled.saturating_add(hash % jitter_window)
}

fn available_space(path: &Path) -> std::io::Result<u64> {
    fs2::available_space(path)
}

static VPN_ENSURE_LOCK: Mutex<()> = Mutex::const_new(());

const MUX_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MUX_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const MUX_STALL_TIMEOUT: Duration = Duration::from_secs(120);
const MUX_PIPE_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn finalize_staged_output(
    staged_path: &Path,
    final_path: &Path,
) -> Result<PathBuf, String> {
    let started = SystemTime::now();
    let staged_size = std::fs::metadata(staged_path).map(|m| m.len()).unwrap_or(0);
    if let Some(parent) = final_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create final dir: {e}"))?;
    }

    let method = match tokio::fs::rename(staged_path, final_path).await {
        Ok(()) => "rename",
        Err(rename_err) => {
            let cross_device = rename_err.kind() == std::io::ErrorKind::CrossesDevices
                || rename_err.raw_os_error() == Some(18);
            if !cross_device {
                return Err(format!("rename staged output: {rename_err}"));
            }
            tokio::fs::copy(staged_path, final_path)
                .await
                .map_err(|e| format!("copy staged output: {e}"))?;
            let _ = tokio::fs::remove_file(staged_path).await;
            "copy"
        }
    };

    let final_path = final_path
        .canonicalize()
        .map_err(|e| format!("final file missing after finalize: {e}"))?;
    let elapsed = started.elapsed().unwrap_or_default();
    info!(
        "finalize output: method={method}, staged_bytes={}, final_path={}, wall={elapsed:.2?}",
        staged_size,
        final_path.display(),
    );
    Ok(final_path)
}

pub async fn run_ffmpeg_mux(
    command: &mut Command,
    staged_path: &Path,
    job_id: &str,
    jobs: &JobManager,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    command.kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|error| format!("spawn ffmpeg: {error}"))?;
    monitor_ffmpeg_mux(child, staged_path, job_id, jobs, cancel).await
}

async fn monitor_ffmpeg_mux(
    mut child: Child,
    staged_path: &Path,
    job_id: &str,
    jobs: &JobManager,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    let mut last_size = std::fs::metadata(staged_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut last_growth = Instant::now();
    let mut last_heartbeat = Instant::now();

    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("cancelled".into());
        }

        match child
            .try_wait()
            .map_err(|error| format!("wait ffmpeg: {error}"))?
        {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("HLS remux failed: {status}")),
            None => {}
        }

        let size = std::fs::metadata(staged_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if size != last_size {
            last_size = size;
            last_growth = Instant::now();
        } else if last_growth.elapsed() >= MUX_STALL_TIMEOUT {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!(
                "HLS remux stalled: output did not grow for {} seconds",
                MUX_STALL_TIMEOUT.as_secs()
            ));
        }

        if last_heartbeat.elapsed() >= MUX_HEARTBEAT_INTERVAL {
            let still_finalizing = jobs.get_job(job_id).await.is_some_and(|job| {
                matches!(
                    job.status.as_str(),
                    "finalizing" | "assembling" | "remuxing"
                )
            });
            if !still_finalizing {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err("cancelled".into());
            }
            jobs.set_job_phase(job_id, "mux").await;
            last_heartbeat = Instant::now();
        }
        tokio::time::sleep(MUX_POLL_INTERVAL).await;
    }
}

fn create_named_pipe(path: &Path) -> Result<(), String> {
    let path_bytes = path.as_os_str().as_bytes();
    let path_c = CString::new(path_bytes)
        .map_err(|_| format!("named pipe path contains NUL: {}", path.display()))?;
    let result = unsafe { libc::mkfifo(path_c.as_ptr(), 0o600) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "create named pipe {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        ))
    }
}

async fn feed_segment_pipes(
    mut segments: tokio::sync::mpsc::UnboundedReceiver<PathBuf>,
    pipes: Vec<PathBuf>,
) -> Result<(), String> {
    let mut index = 0usize;
    while let Some(segment_path) = segments.recv().await {
        let pipe_path = pipes
            .get(index)
            .ok_or_else(|| "streaming HLS mux received too many segments".to_string())?;
        let mut segment = tokio::fs::File::open(&segment_path)
            .await
            .map_err(|e| format!("open {}: {e}", segment_path.display()))?;
        let mut pipe = tokio::time::timeout(
            MUX_PIPE_TIMEOUT,
            tokio::fs::OpenOptions::new().write(true).open(pipe_path),
        )
        .await
        .map_err(|_| format!("open named pipe timed out: {}", pipe_path.display()))?
        .map_err(|e| format!("open named pipe {}: {e}", pipe_path.display()))?;
        tokio::time::timeout(MUX_PIPE_TIMEOUT, tokio::io::copy(&mut segment, &mut pipe))
            .await
            .map_err(|_| format!("feed named pipe timed out: {}", pipe_path.display()))?
            .map_err(|e| format!("feed named pipe {}: {e}", pipe_path.display()))?;
        pipe.shutdown()
            .await
            .map_err(|e| format!("close named pipe {}: {e}", pipe_path.display()))?;
        index += 1;
    }
    if index != pipes.len() {
        return Err(format!(
            "streaming HLS mux received {index} of {} segments",
            pipes.len()
        ));
    }
    Ok(())
}

// ── Cancel state for in-memory active jobs ──────────────────

type CancelMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

// ── Job Manager ─────────────────────────────────────────────

pub struct JobManager {
    db: Arc<Mutex<Connection>>,
    active: CancelMap,
    resource_paused: Arc<AtomicBool>,
    available_space: Arc<AtomicU64>,
}

impl JobManager {
    pub fn new(db: Connection) -> Self {
        let resource_paused = store::has_resource_wait_jobs(&db).unwrap_or(false);
        Self {
            db: Arc::new(Mutex::new(db)),
            active: Arc::new(Mutex::new(HashMap::new())),
            resource_paused: Arc::new(AtomicBool::new(resource_paused)),
            available_space: Arc::new(AtomicU64::new(u64::MAX)),
        }
    }

    pub async fn create_job(
        &self,
        id: &str,
        url: &str,
        src_url: &str,
        filename: &str,
        headers_json: &str,
        temp_dir: &str,
        max_retries: u32,
        retry_interval_secs: u64,
    ) -> JobRow {
        let now = unix_now();
        let db = self.db.lock().await;
        store::create_job(
            &db,
            id,
            url,
            src_url,
            filename,
            headers_json,
            temp_dir,
            max_retries,
            retry_interval_secs,
            now,
        )
        .expect("create job")
    }

    pub async fn get_job(&self, id: &str) -> Option<JobRow> {
        let db = self.db.lock().await;
        store::get_job(&db, id).ok().flatten()
    }

    pub async fn list_jobs(&self, limit: usize) -> Vec<JobRow> {
        let db = self.db.lock().await;
        store::list_jobs(&db, limit).unwrap_or_default()
    }

    pub async fn list_failed_job_ids(&self) -> Vec<String> {
        let db = self.db.lock().await;
        store::list_failed_job_ids(&db).unwrap_or_default()
    }

    pub async fn list_jobs_for_url(&self, url: &str, limit: usize) -> Vec<JobRow> {
        let db = self.db.lock().await;
        store::list_jobs_for_url(&db, url, limit).unwrap_or_default()
    }

    pub async fn count_active_jobs(&self) -> usize {
        let db = self.db.lock().await;
        store::count_active_jobs(&db).unwrap_or(0)
    }

    pub async fn list_running_jobs(&self) -> Vec<store::JobRow> {
        let db = self.db.lock().await;
        store::list_running_jobs(&db).unwrap_or_default()
    }

    pub async fn requeue_excess_running_jobs(
        &self,
        max_concurrent_jobs: usize,
        mode: store::ConcurrencyMode,
    ) -> Vec<String> {
        let ids = {
            let db = self.db.lock().await;
            store::requeue_excess_running_jobs(&db, max_concurrent_jobs, unix_now(), mode)
                .unwrap_or_default()
        };
        let active = self.active.lock().await;
        for id in &ids {
            if let Some(flag) = active.get(id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        ids
    }

    pub async fn requeue_stalled_running_jobs(&self, stale_timeout_secs: u64) -> Vec<String> {
        let now = unix_now();
        let ids = {
            let db = self.db.lock().await;
            store::requeue_stalled_running_jobs(&db, now.saturating_sub(stale_timeout_secs), now)
                .unwrap_or_default()
        };
        let active = self.active.lock().await;
        for id in &ids {
            if let Some(flag) = active.get(id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        ids
    }

    pub async fn list_due_jobs(&self, now: u64, max_count: usize) -> Vec<JobRow> {
        let db = self.db.lock().await;
        store::list_due_jobs(&db, now, max_count).unwrap_or_default()
    }

    pub async fn save_vpn_location(&self, location: &str) {
        let db = self.db.lock().await;
        if let Err(error) = store::save_vpn_location(&db, location) {
            warn!("automatic VPN location persistence failed: {error}");
        }
    }

    pub async fn find_active_duplicate(&self, filename: &str, url: &str) -> Option<JobRow> {
        let db = self.db.lock().await;
        store::find_active_duplicate(&db, filename, url).unwrap_or(None)
    }

    pub async fn delete_failed_duplicates(&self, filename: &str, url: &str) -> usize {
        let db = self.db.lock().await;
        store::delete_failed_duplicates(&db, filename, url).unwrap_or(0)
    }

    pub async fn recover_pending(&self, now: u64) -> Vec<JobRow> {
        let db = self.db.lock().await;
        store::recover_pending_jobs(&db, now).unwrap_or_default()
    }

    pub async fn set_job_running(&self, id: &str) -> bool {
        let now = unix_now();
        let db = self.db.lock().await;
        store::set_job_running(&db, id, now).unwrap_or(false)
    }

    pub async fn refresh_browser_hls_source(
        &self,
        id: &str,
        src_url: &str,
        headers_json: &str,
    ) -> bool {
        let now = unix_now();
        let db = self.db.lock().await;
        store::refresh_browser_hls_source(&db, id, src_url, headers_json, now).unwrap_or(false)
    }

    pub async fn update_progress(&self, id: &str, downloaded: u64, total: u64) {
        let now = unix_now();
        let db = self.db.lock().await;
        let _ = store::update_job_progress(&db, id, downloaded, total, now);
    }

    pub async fn update_hls_progress(
        &self,
        id: &str,
        completed: u64,
        total: u64,
        downloaded_bytes: u64,
    ) {
        let now = unix_now();
        let db = self.db.lock().await;
        let _ = store::update_hls_progress(&db, id, completed, total, downloaded_bytes, now);
    }

    pub async fn record_browser_hls_segment(
        &self,
        id: &str,
        index: usize,
        bytes: u64,
        part_path: &str,
    ) -> (bool, u64, u32) {
        let now = unix_now();
        let db = self.db.lock().await;
        store::record_browser_hls_segment(&db, id, index, bytes, part_path, now)
            .unwrap_or((false, 0, 0))
    }

    pub async fn get_job_parts(&self, id: &str) -> Vec<JobPart> {
        let db = self.db.lock().await;
        store::get_job_parts(&db, id).unwrap_or_default()
    }

    pub async fn upsert_job_part(&self, part: &JobPart) {
        let db = self.db.lock().await;
        let _ = store::upsert_job_part(&db, part);
    }

    pub async fn clear_job_parts(&self, id: &str) {
        let db = self.db.lock().await;
        let _ = store::clear_job_parts(&db, id);
    }

    pub async fn save_probe_result(
        &self,
        id: &str,
        total: u64,
        ranges: bool,
        etag: &str,
        last_modified: &str,
    ) {
        let now = unix_now();
        let db = self.db.lock().await;
        let _ = store::save_probe_result(&db, id, total, ranges, etag, last_modified, now);
    }

    pub async fn complete_job(
        &self,
        id: &str,
        file_path: &str,
        total_bytes: u64,
    ) -> Result<(), String> {
        let now = unix_now();
        let db = self.db.lock().await;
        store::complete_job(&db, id, file_path, total_bytes, now)
            .map_err(|error| format!("complete job in database: {error}"))?;
        // Also mark in downloaded_files with route url and source url
        if let Ok(path) = std::fs::canonicalize(file_path) {
            if let Ok(Some(job)) = store::get_job(&db, id) {
                let url_opt = if job.url.is_empty() {
                    None
                } else {
                    Some(job.url.as_str())
                };
                let src_opt = if job.src_url.is_empty() {
                    None
                } else {
                    Some(job.src_url.as_str())
                };
                let _ = store::mark_download(&db, &path, url_opt, src_opt, None);
            }
        }
        Ok(())
    }

    pub async fn fail_or_retry(
        &self,
        id: &str,
        error_msg: &str,
        max_retries: u32,
        retry_interval: u64,
    ) -> bool {
        if classify_failure(error_msg) == FailureKind::DiskFull {
            self.pause_for_disk(0).await;
            return false;
        }
        let now = unix_now();
        let db = self.db.lock().await;
        match classify_failure(error_msg) {
            FailureKind::Permanent => {
                let _ = store::fail_job(&db, id, error_msg, now);
                false
            }
            FailureKind::DiskFull => unreachable!(),
            _ => {
                let retry_count = store::get_job(&db, id)
                    .ok()
                    .flatten()
                    .map(|job| job.retry_count)
                    .unwrap_or(0);
                let delay = retry_delay(retry_interval, retry_count, id);
                store::schedule_retry(&db, id, error_msg, now, max_retries, delay).unwrap_or(false)
            }
        }
    }

    pub fn is_resource_paused(&self) -> bool {
        self.resource_paused.load(Ordering::Relaxed)
    }

    pub fn available_space(&self) -> u64 {
        self.available_space.load(Ordering::Relaxed)
    }

    pub async fn pause_for_disk(&self, available: u64) -> usize {
        self.resource_paused.store(true, Ordering::Relaxed);
        self.available_space.store(available, Ordering::Relaxed);
        let active = self.active.lock().await;
        for flag in active.values() {
            flag.store(true, Ordering::Relaxed);
        }
        drop(active);
        let db = self.db.lock().await;
        store::pause_jobs_for_resource(
            &db,
            &format!("insufficient disk space: {available} bytes available"),
            unix_now(),
        )
        .unwrap_or(0)
    }

    pub async fn resume_after_disk(&self, available: u64) -> usize {
        self.available_space.store(available, Ordering::Relaxed);
        let db = self.db.lock().await;
        let resumed = store::resume_resource_wait_jobs(&db, unix_now()).unwrap_or(0);
        self.resource_paused.store(false, Ordering::Relaxed);
        resumed
    }

    pub async fn cancel_job(&self, id: &str) -> bool {
        // Set a cancel flag in active set if running
        {
            let active = self.active.lock().await;
            if let Some(flag) = active.get(id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        let now = unix_now();
        let db = self.db.lock().await;
        store::cancel_job(&db, id, now).unwrap_or(false)
    }

    pub async fn retry_job(&self, id: &str) -> bool {
        let now = unix_now();
        let db = self.db.lock().await;
        store::retry_job(&db, id, now).unwrap_or(false)
    }

    pub async fn retry_file_job(&self, id: &str) -> bool {
        let now = unix_now();
        let db = self.db.lock().await;
        store::retry_file_job(&db, id, now).unwrap_or(false)
    }

    pub async fn clear_job(&self, id: &str) -> bool {
        let db = self.db.lock().await;
        store::delete_job(&db, id).unwrap_or(false)
    }

    pub async fn clear_selected_jobs(&self, ids: &[String]) -> usize {
        if ids.is_empty() {
            return 0;
        }
        let db = self.db.lock().await;
        store::delete_jobs(&db, ids).unwrap_or(0)
    }

    pub async fn set_job_phase(&self, id: &str, phase: &str) -> bool {
        let now = unix_now();
        let db = self.db.lock().await;
        store::set_job_phase(&db, id, phase, now).unwrap_or(false)
    }

    pub async fn set_total_segments(&self, id: &str, total: u32) -> bool {
        let db = self.db.lock().await;
        store::set_total_segments(&db, id, total).unwrap_or(false)
    }

    pub async fn stale_browser_hls_cleanup(
        &self,
        stale_timeout_secs: u64,
        max_restart_attempts: u32,
    ) -> usize {
        let now = unix_now();
        let db = self.db.lock().await;
        store::stale_browser_hls_cleanup(&db, now, stale_timeout_secs, max_restart_attempts)
            .unwrap_or(0)
    }

    pub async fn register_active(&self, id: &str, cancel: Arc<AtomicBool>) {
        self.active.lock().await.insert(id.to_string(), cancel);
    }

    pub async fn unregister_active(&self, id: &str) {
        self.active.lock().await.remove(id);
    }

    pub async fn is_active(&self, id: &str) -> bool {
        self.active.lock().await.contains_key(id)
    }
}

// ── VPN ────────────────────────────────────────────────────

#[derive(Debug)]
pub enum VpnError {
    NotInstalled,
    NotLoggedIn,
    WrongMode { expected: String, actual: String },
    Disconnected,
    WrongLocation { expected: String, actual: String },
    ConnectFailed(String),
    CommandFailed(String),
}

impl std::fmt::Display for VpnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VpnError::NotInstalled => write!(f, "adguardvpn-cli not found"),
            VpnError::NotLoggedIn => write!(f, "adguardvpn-cli logged out"),
            VpnError::WrongMode { expected, actual } => {
                write!(f, "mode is '{actual}', expected '{expected}'")
            }
            VpnError::Disconnected => write!(f, "disconnected"),
            VpnError::WrongLocation { expected, actual } => {
                write!(f, "location '{actual}', expected '{expected}'")
            }
            VpnError::ConnectFailed(m) => write!(f, "connect failed: {m}"),
            VpnError::CommandFailed(m) => write!(f, "command failed: {m}"),
        }
    }
}

fn run_cli(config: &VpnConfig, args: &[&str]) -> Command {
    let mut cmd = Command::new(&config.command);
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd
}

fn strip_ansi(s: &str) -> String {
    s.replace("\x1b[1m", "").replace("\x1b[0m", "")
}

fn vpn_error_from_output(stdout: &[u8], stderr: &[u8]) -> Option<VpnError> {
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    let text = strip_ansi(&combined).to_ascii_lowercase();
    if text.contains("you are not logged in") {
        Some(VpnError::NotLoggedIn)
    } else {
        None
    }
}

#[derive(Debug, Default)]
pub struct StatusInfo {
    pub connected: bool,
    pub logged_out: bool,
    pub location: String,
}

fn parse_status_info(stdout: &str) -> StatusInfo {
    let mut info = StatusInfo::default();
    for line in stdout.lines() {
        let t = strip_ansi(line.trim());
        if t.to_ascii_lowercase().contains("you are not logged in") {
            info.logged_out = true;
        }
        if t.starts_with("Connected to ") || t.starts_with("connected to ") {
            info.connected = true;
            let s = t
                .trim_start_matches("Connected to ")
                .trim_start_matches("connected to ");
            info.location = s
                .split_once(" in ")
                .map(|(location, _)| location)
                .unwrap_or(s)
                .trim()
                .to_lowercase();
        }
    }
    info
}

#[derive(Debug, Clone)]
pub struct VpnLocation {
    pub name: String,
    pub label: String,
}

fn location_columns(line: &str) -> Vec<String> {
    let mut columns = Vec::new();
    let mut value_start = 0;
    let mut whitespace_start = None;
    let mut whitespace_count = 0;

    for (index, character) in line.char_indices() {
        if character.is_whitespace() {
            if whitespace_count == 0 {
                whitespace_start = Some(index);
            }
            whitespace_count += 1;
            continue;
        }

        if whitespace_count >= 2 {
            let value = line[value_start..whitespace_start.unwrap()].trim();
            if !value.is_empty() {
                columns.push(value.to_string());
            }
            value_start = index;
        }
        whitespace_start = None;
        whitespace_count = 0;
    }

    let value = line[value_start..].trim();
    if !value.is_empty() {
        columns.push(value.to_string());
    }
    columns
}

fn parse_vpn_locations(stdout: &str) -> Vec<VpnLocation> {
    let mut locations = Vec::new();
    let mut rows = stdout.lines();
    for line in rows.by_ref() {
        if strip_ansi(line).trim_start().starts_with("ISO") {
            break;
        }
    }

    for line in rows {
        let columns = location_columns(&strip_ansi(line));
        if columns.len() != 4 || columns[3].parse::<u32>().is_err() {
            continue;
        }
        locations.push(VpnLocation {
            name: columns[2].clone(),
            label: format!("{}, {}", columns[2], columns[1]),
        });
    }
    locations
}

pub async fn check_status(config: &VpnConfig) -> Result<StatusInfo, VpnError> {
    let output = run_cli(config, &["status"])
        .output()
        .await
        .map_err(|_| VpnError::NotInstalled)?;
    let parsed = parse_status_info(&String::from_utf8_lossy(&output.stdout));
    if parsed.logged_out {
        return Err(VpnError::NotLoggedIn);
    }
    if !output.status.success() {
        if let Some(error) = vpn_error_from_output(&output.stdout, &output.stderr) {
            return Err(error);
        }
        return Err(VpnError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }
    Ok(parsed)
}

pub async fn list_locations(config: &VpnConfig) -> Result<Vec<VpnLocation>, VpnError> {
    let output = run_cli(config, &["list-locations"])
        .output()
        .await
        .map_err(|_| VpnError::NotInstalled)?;
    if !output.status.success() {
        if let Some(error) = vpn_error_from_output(&output.stdout, &output.stderr) {
            return Err(error);
        }
        return Err(VpnError::CommandFailed(format!(
            "list locations: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(parse_vpn_locations(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

async fn check_mode(config: &VpnConfig) -> Result<(), VpnError> {
    let output = run_cli(config, &["config", "show"])
        .output()
        .await
        .map_err(|_| VpnError::NotInstalled)?;
    if !output.status.success() {
        if let Some(error) = vpn_error_from_output(&output.stdout, &output.stderr) {
            return Err(error);
        }
        return Err(VpnError::CommandFailed(format!(
            "config show: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let mode = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|l| l.trim().starts_with("Mode:"))
        .and_then(|l| l.split(':').nth(1))
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if mode != config.required_mode {
        return Err(VpnError::WrongMode {
            expected: config.required_mode.clone(),
            actual: mode,
        });
    }
    Ok(())
}

async fn connect_vpn(config: &VpnConfig) -> Result<(), VpnError> {
    let args: Vec<&str> = config.connect_command.iter().map(|s| s.as_str()).collect();
    let output = tokio::time::timeout(
        Duration::from_secs(config.connect_timeout_secs),
        run_cli(config, &args).output(),
    )
    .await
    .map_err(|_| VpnError::ConnectFailed("timeout".into()))?
    .map_err(|_| VpnError::NotInstalled)?;
    if !output.status.success() {
        if let Some(error) = vpn_error_from_output(&output.stdout, &output.stderr) {
            return Err(error);
        }
        return Err(VpnError::ConnectFailed(format!("exit {}", output.status)));
    }
    info!(
        "VPN connect output: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    tokio::time::sleep(Duration::from_secs(3)).await;
    let status = check_status(config).await?;
    if !status.connected {
        return Err(VpnError::ConnectFailed("still disconnected".into()));
    }
    if !status.location.contains(&config.required_location) {
        return Err(VpnError::WrongLocation {
            expected: config.required_location.clone(),
            actual: status.location,
        });
    }
    info!("VPN connected, location: {}", status.location);
    Ok(())
}

pub(crate) fn config_for_location(config: &VpnConfig, location: &str) -> VpnConfig {
    let mut config = config.clone();
    let location = location.trim();
    config.required_location = location.to_lowercase();

    let mut updated = false;
    for index in 0..config.connect_command.len() {
        if config.connect_command[index] == "-l" || config.connect_command[index] == "--location" {
            if let Some(value) = config.connect_command.get_mut(index + 1) {
                *value = location.into();
            } else {
                config.connect_command.push(location.into());
            }
            updated = true;
            break;
        }
        if config.connect_command[index].starts_with("--location=") {
            config.connect_command[index] = format!("--location={location}");
            updated = true;
            break;
        }
    }
    if !updated {
        if config.connect_command.is_empty() {
            config.connect_command.push("connect".into());
        }
        config.connect_command.push("-l".into());
        config.connect_command.push(location.into());
    }
    config
}

pub async fn switch_vpn_location(
    config: &VpnConfig,
    location: &str,
) -> Result<VpnConfig, VpnError> {
    let config = config_for_location(config, location);
    let _guard = VPN_ENSURE_LOCK.lock().await;
    check_mode(&config).await?;

    if let Ok(status) = check_status(&config).await
        && status.connected
        && status.location.contains(&config.required_location)
    {
        return Ok(config);
    }

    info!("Switching VPN to {}...", config.required_location);
    connect_vpn(&config).await?;
    Ok(config)
}

pub async fn ensure_vpn(config: &VpnConfig) -> Result<(), VpnError> {
    if !config.verify_before_each_job {
        return Ok(());
    }
    ensure_vpn_connected(config).await
}

pub async fn ensure_vpn_connected(config: &VpnConfig) -> Result<(), VpnError> {
    let _guard = VPN_ENSURE_LOCK.lock().await;
    check_mode(config).await?;
    match check_status(config).await {
        Ok(status) if status.connected => {
            if status.location.contains(&config.required_location) {
                return Ok(());
            }
            warn!(
                "connected to '{}', expected '{}'. reconnecting...",
                status.location, config.required_location
            );
            if !config.auto_connect {
                return Err(VpnError::WrongLocation {
                    expected: config.required_location.clone(),
                    actual: status.location,
                });
            }
        }
        Ok(status) if status.logged_out => {
            info!("VPN logged out");
            return Err(VpnError::NotLoggedIn);
        }
        Ok(_) => {
            info!("VPN disconnected");
            if !config.auto_connect {
                return Err(VpnError::Disconnected);
            }
        }
        Err(VpnError::NotLoggedIn) => return Err(VpnError::NotLoggedIn),
        Err(error) => {
            warn!("VPN status unavailable: {error}. reconnecting...");
            if !config.auto_connect {
                return Err(error);
            }
        }
    }

    info!("Auto-connecting VPN to {}...", config.required_location);
    connect_vpn(config).await
}

pub async fn run_vpn_monitor(config: Arc<RwLock<VpnConfig>>) {
    if !config.read().await.auto_connect {
        return;
    }
    let mut interval = tokio::time::interval(Duration::from_secs(10));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let config = config.read().await;
        if let Err(error) = ensure_vpn_connected(&config).await {
            warn!("VPN auto-connect failed: {error}");
        }
    }
}

// ── HTTP client ─────────────────────────────────────────────

mod http_client {
    use super::*;
    pub fn build(config: &AppConfig) -> reqwest::Client {
        let proxy = reqwest::Proxy::all(&config.vpn.socks_url).expect("invalid SOCKS proxy URL");
        reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(30))
            .user_agent(&config.download.user_agent)
            .build()
            .expect("failed to build HTTP client")
    }
}

// ── Helpers ─────────────────────────────────────────────────

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "host"
            | "connection"
            | "keep-alive"
            | "proxy-connection"
            | "transfer-encoding"
            | "upgrade"
            | "proxy-authorization"
            | "te"
            | "content-length"
            | "range"
    )
}

fn sanitize_filename(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '–' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.trim().is_empty() {
        "download".into()
    } else {
        safe
    }
}

fn headers_from_json(json: &str) -> Vec<(String, String)> {
    serde_json::from_str(json).unwrap_or_default()
}

fn bytes_to_human(b: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v > 1024.0 && i + 1 < UNITS.len() {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{v:.0} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

fn is_hls_url(url: &str) -> bool {
    store::is_hls_url(url)
}

// ── Probe ───────────────────────────────────────────────────

struct RangeCheck {
    total_size: u64,
    accept_ranges: bool,
    etag: String,
    last_modified: String,
}

async fn probe(
    url: &str,
    headers: &[(String, String)],
    client: &reqwest::Client,
) -> Result<RangeCheck, String> {
    let mut req = client.get(url).header("Range", "bytes=0-0");
    for (k, v) in headers {
        if !is_hop_by_hop(k) {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req.send().await.map_err(|e| format!("probe: {e}"))?;
    let status = resp.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("HTTP {status}"));
    }
    let h = resp.headers().clone();
    drop(resp);
    let mut check = RangeCheck {
        total_size: 0,
        accept_ranges: false,
        etag: String::new(),
        last_modified: String::new(),
    };
    if let Some(cr) = h.get("content-range").and_then(|v| v.to_str().ok()) {
        check.accept_ranges = status.as_u16() == 206;
        if let Some(total) = cr
            .split('/')
            .nth(1)
            .and_then(|s| s.trim().parse::<u64>().ok())
        {
            check.total_size = total;
        }
    }
    if check.total_size == 0 {
        check.total_size = h
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
    }
    check.etag = h
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    check.last_modified = h
        .get("last-modified")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    Ok(check)
}

// ── Single-stream download (resume-aware) ───────────────────

async fn download_single(
    url: &str,
    headers: &[(String, String)],
    dest: &Path,
    client: &reqwest::Client,
    cancel: Arc<AtomicBool>,
    resume_offset: u64,
    progress: Arc<dyn Fn(u64, u64) + Send + Sync>,
) -> Result<u64, String> {
    let mut req = client.get(url);
    if resume_offset > 0 {
        req = req.header("Range", format!("bytes={resume_offset}-"));
    }
    for (k, v) in headers {
        if !is_hop_by_hop(k) {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req.send().await.map_err(|e| format!("request: {e}"))?;
    if resume_offset > 0 && resp.status().as_u16() != 206 {
        return Err(format!(
            "resume response ignored Range: HTTP {}",
            resp.status()
        ));
    }
    if resume_offset == 0 && !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    if resume_offset > 0 {
        let expected_prefix = format!("bytes {resume_offset}-");
        let actual_range = resp
            .headers()
            .get("content-range")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if !actual_range.starts_with(&expected_prefix) {
            return Err(format!(
                "resume response has invalid Content-Range '{actual_range}'"
            ));
        }
    }
    let total = if resume_offset > 0 {
        // For Range requests, total may be content-range or content-length
        resp.content_length().unwrap_or(0) + resume_offset
    } else {
        resp.content_length().unwrap_or(0)
    };

    let mut file = if resume_offset > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(dest)
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::fs::File::create(dest)
            .await
            .map_err(|e| e.to_string())?
    };
    let mut downloaded = resume_offset;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        progress(downloaded, total);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(downloaded)
}

// ── Chunked download (resume-aware) ─────────────────────────

async fn download_chunked(
    url: &str,
    headers: &[(String, String)],
    total_size: u64,
    num_chunks: usize,
    dest: &Path,
    client: &reqwest::Client,
    cancel: Arc<AtomicBool>,
    job_id: &str,
    jobs: Arc<JobManager>,
    existing: HashMap<usize, u64>, // part_index -> already_downloaded_bytes
    progress: Arc<dyn Fn(u64, u64) + Send + Sync>,
) -> Result<u64, String> {
    use futures_util::future::try_join_all;
    let chunk_size = (total_size + num_chunks as u64 - 1) / num_chunks as u64;
    let downloaded = Arc::new(AtomicU64::new(existing.values().sum::<u64>()));
    let dest = dest.to_path_buf();
    let dest_text = dest.display().to_string();
    let mut tasks = Vec::new();
    for i in 0..num_chunks {
        let start = i as u64 * chunk_size;
        let end = (start + chunk_size - 1).min(total_size - 1);
        let existing_bytes = existing.get(&i).copied().unwrap_or(0);

        // Skip fully downloaded chunks
        let expected_size = end - start + 1;
        if existing_bytes >= expected_size {
            continue;
        }

        let range_start = start + existing_bytes;
        let range = format!("bytes={range_start}-{end}");
        let cl = client.clone();
        let u = url.to_owned();
        let hdrs = headers.to_vec();
        let cncl = cancel.clone();
        let dl = downloaded.clone();
        let pg = progress.clone();
        let path = dest.clone();
        let path_text = dest_text.clone();
        let jid = job_id.to_string();
        let jobs_mgr = jobs.clone();
        tasks.push(tokio::spawn(async move {
            let mut req = cl.get(&u).header("Range", &range);
            for (k, v) in &hdrs {
                if !is_hop_by_hop(k) {
                    req = req.header(k.as_str(), v.as_str());
                }
            }
            let resp = req.send().await.map_err(|e| format!("chunk {i}: {e}"))?;
            if resp.status().as_u16() != 206 {
                return Err(format!("chunk {i}: HTTP {}", resp.status()));
            }
            let expected_range = format!("bytes {range_start}-{end}/{total_size}");
            let actual_range = resp
                .headers()
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if actual_range != expected_range {
                return Err(format!(
                    "chunk {i}: invalid Content-Range '{actual_range}', expected '{expected_range}'"
                ));
            }
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(&path)
                .await
                .map_err(|e| format!("chunk {i}: {e}"))?;
            file.seek(std::io::SeekFrom::Start(range_start))
                .await
                .map_err(|e| format!("chunk {i}: seek: {e}"))?;
            let mut stream = resp.bytes_stream();
            let mut part_downloaded = existing_bytes;
            let mut last_flush = store::unix_now();
            while let Some(chunk) = stream.next().await {
                if cncl.load(Ordering::Relaxed) {
                    return Err("cancelled".into());
                }
                let b = chunk.map_err(|e| format!("chunk {i}: {e}"))?;
                file.write_all(&b)
                    .await
                    .map_err(|e| format!("chunk {i}: {e}"))?;
                part_downloaded += b.len() as u64;
                let p = dl.fetch_add(b.len() as u64, Ordering::Relaxed);
                pg(p + b.len() as u64, total_size);

                let now = store::unix_now();
                if now.saturating_sub(last_flush) >= 1 {
                    last_flush = now;
                    jobs_mgr
                        .upsert_job_part(&JobPart {
                            job_id: jid.clone(),
                            part_index: i as u32,
                            start_byte: start,
                            end_byte: end,
                            downloaded_bytes: part_downloaded,
                            part_path: path_text.clone(),
                            status: "running".into(),
                            updated_at: now,
                        })
                        .await;
                }
            }
            file.flush().await.map_err(|e| format!("chunk {i}: {e}"))?;
            let now = store::unix_now();
            jobs_mgr
                .upsert_job_part(&JobPart {
                    job_id: jid,
                    part_index: i as u32,
                    start_byte: start,
                    end_byte: end,
                    downloaded_bytes: expected_size,
                    part_path: path_text,
                    status: "completed".into(),
                    updated_at: now,
                })
                .await;
            Ok::<_, String>(())
        }));
    }
    // If all chunks were already downloaded, the staged file is already complete.
    if tasks.is_empty() {
        return Ok(total_size);
    }
    try_join_all(tasks)
        .await
        .map_err(|e| format!("join: {e}"))?
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    Ok(total_size)
}

// ── Main job runner ─────────────────────────────────────────

pub async fn run_job(job_id: String, config: AppConfig, jobs: Arc<JobManager>) {
    // Read job from DB
    let job_row = jobs.get_job(&job_id).await;
    let job = match job_row {
        Some(j) => j,
        None => {
            error!("job {job_id} not found in DB");
            return;
        }
    };

    // Register cancel flag
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.register_active(&job_id, cancel.clone()).await;

    let filename = sanitize_filename(&job.filename);
    let target_name = filename;
    let temp_dir = PathBuf::from(&job.temp_dir);
    let final_dir = config.download_root.clone();
    let final_path = crate::config::final_download_path(&config, &target_name);
    let staged_path = final_dir.join(format!(".{job_id}.{target_name}.staged"));

    // Create temp/final dirs
    if let Err(e) = tokio::fs::create_dir_all(&temp_dir).await {
        let msg = format!("create temp dir: {e}");
        error!("job {job_id}: {msg}");
        jobs.fail_or_retry(
            &job_id,
            &msg,
            config.retry.max_retries,
            config.retry.retry_interval_secs,
        )
        .await;
        jobs.unregister_active(&job_id).await;
        return;
    }
    if let Err(e) = tokio::fs::create_dir_all(&final_dir).await {
        let msg = format!("create final dir: {e}");
        error!("job {job_id}: {msg}");
        jobs.fail_or_retry(
            &job_id,
            &msg,
            config.retry.max_retries,
            config.retry.retry_interval_secs,
        )
        .await;
        jobs.unregister_active(&job_id).await;
        return;
    }

    let start = SystemTime::now();
    info!(
        "job {job_id}: starting download of {} (source page: {})",
        job.src_url, job.url
    );

    let client = http_client::build(&config);
    let last_downloaded = job.downloaded_bytes;
    let last_completed_segments = job.uploaded_segments as u64;
    let flush_interval =
        tokio::time::Duration::from_millis(config.scheduler.progress_flush_interval_ms);

    // Probe for range support, store in DB
    let is_hls = is_hls_url(&job.src_url);
    let (supports_ranges, total_bytes, _etag, _last_modified) = if is_hls {
        jobs.save_probe_result(&job_id, 0, false, "", "").await;
        (false, 0, String::new(), String::new())
    } else {
        let probe_result =
            probe(&job.src_url, &headers_from_json(&job.headers_json), &client).await;
        match probe_result {
            Ok(p) => {
                jobs.save_probe_result(
                    &job_id,
                    p.total_size,
                    p.accept_ranges,
                    &p.etag,
                    &p.last_modified,
                )
                .await;
                (p.accept_ranges, p.total_size, p.etag, p.last_modified)
            }
            Err(e) => {
                let msg = format!("probe failed: {e}");
                error!("job {job_id}: {msg}");
                let will_retry = jobs
                    .fail_or_retry(
                        &job_id,
                        &msg,
                        config.retry.max_retries,
                        config.retry.retry_interval_secs,
                    )
                    .await;
                jobs.unregister_active(&job_id).await;
                if !will_retry {
                    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
                }
                return;
            }
        }
    };

    let download_result: Result<u64, String> = async {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if is_hls {
            info!("job {job_id}: HLS download via reqwest ({})", job.src_url);

            let hls_headers = headers_from_json(&job.headers_json);

            jobs.set_job_phase(&job_id, "download").await;

            let resolved =
                hls::fetch_and_resolve(&job.src_url, &client, cancel.clone(), &hls_headers).await?;

            let mut streaming_mux = if resolved.map_uri.is_none() {
                let pipe_dir = temp_dir.join("mux-pipes");
                let _ = tokio::fs::remove_dir_all(&pipe_dir).await;
                tokio::fs::create_dir_all(&pipe_dir)
                    .await
                    .map_err(|e| format!("create streaming HLS pipe dir: {e}"))?;
                let pipes = (0..resolved.segments.len())
                    .map(|index| pipe_dir.join(format!("segment-{index:06}.ts")))
                    .collect::<Vec<_>>();
                for pipe in &pipes {
                    create_named_pipe(pipe)?;
                }
                let concat_list_path = pipe_dir.join("segments.ffconcat");
                let concat_list = pipes
                    .iter()
                    .map(|path| crate::ffmpeg_concat_entry(path))
                    .collect::<String>();
                tokio::fs::write(&concat_list_path, concat_list)
                    .await
                    .map_err(|e| format!("write streaming HLS concat list: {e}"))?;

                let mut command = Command::new("ffmpeg");
                command
                    .arg("-y")
                    .arg("-nostdin")
                    .arg("-loglevel")
                    .arg("error")
                    .arg("-f")
                    .arg("concat")
                    .arg("-safe")
                    .arg("0")
                    .arg("-i")
                    .arg(&concat_list_path)
                    .arg("-c")
                    .arg("copy")
                    .arg("-bsf:a")
                    .arg("aac_adtstoasc")
                    .arg("-f")
                    .arg("mp4")
                    .arg(&staged_path)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true);
                let child = command
                    .spawn()
                    .map_err(|error| format!("spawn streaming HLS mux: {error}"))?;
                let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
                let feeder = tokio::spawn(feed_segment_pipes(rx, pipes));
                info!("job {job_id}: streaming HLS segments through concat pipes");
                Some((child, tx, feeder, pipe_dir))
            } else {
                None
            };

            let (progress_tx, mut progress_rx) =
                tokio::sync::mpsc::unbounded_channel::<(u64, u64, u64)>();
            let jobs_mgr = jobs.clone();
            let jid = job_id.clone();
            let progress_task = tokio::spawn(async move {
                let mut reported = 0u64;
                while let Some(mut latest) = progress_rx.recv().await {
                    while let Ok(progress) = progress_rx.try_recv() {
                        latest = progress;
                    }
                    let (completed, total, downloaded_bytes) = latest;
                    if completed >= reported {
                        jobs_mgr
                            .update_hls_progress(
                                &jid,
                                completed.max(last_completed_segments),
                                total,
                                downloaded_bytes.max(last_downloaded),
                            )
                            .await;
                        reported = completed;
                    }
                }
            });
            let hls_progress: Arc<dyn Fn(u64, u64, u64) + Send + Sync> =
                Arc::new(move |completed, total, downloaded_bytes| {
                    let _ = progress_tx.send((completed, total, downloaded_bytes));
                });

            let segment_result = hls::download_segments(
                &resolved,
                &client,
                &temp_dir,
                cancel.clone(),
                hls_progress.clone(),
                &hls_headers,
                streaming_mux.as_ref().map(|(_, tx, _, _)| tx),
            )
            .await;
            drop(hls_progress);
            let _ = progress_task.await;
            let (segment_files, _segment_bytes) = match segment_result {
                Ok(result) => result,
                Err(error) => {
                    if let Some((mut child, tx, feeder, pipe_dir)) = streaming_mux.take() {
                        drop(tx);
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        feeder.abort();
                        let _ = tokio::fs::remove_dir_all(pipe_dir).await;
                    }
                    return Err(error);
                }
            };

            jobs.set_job_phase(&job_id, "mux").await;
            if let Some((child, tx, feeder, pipe_dir)) = streaming_mux {
                drop(tx);
                feeder
                    .await
                    .map_err(|e| format!("join streaming HLS feeder: {e}"))??;
                let result =
                    monitor_ffmpeg_mux(child, &staged_path, &job_id, &jobs, Some(&cancel)).await;
                let _ = tokio::fs::remove_dir_all(pipe_dir).await;
                result?;
            } else {
                let concat_list_path = temp_dir.join("segments.ffconcat");
                let concat_list = segment_files
                    .iter()
                    .map(|path| crate::ffmpeg_concat_entry(path))
                    .collect::<String>();
                tokio::fs::write(&concat_list_path, concat_list)
                    .await
                    .map_err(|e| format!("write concat list: {e}"))?;

                let mut command = Command::new("ffmpeg");
                command
                    .arg("-y")
                    .arg("-nostdin")
                    .arg("-loglevel")
                    .arg("error")
                    .arg("-f")
                    .arg("concat")
                    .arg("-safe")
                    .arg("0")
                    .arg("-i")
                    .arg(&concat_list_path)
                    .arg("-c")
                    .arg("copy")
                    .arg("-f")
                    .arg("mp4")
                    .arg(&staged_path)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null());
                run_ffmpeg_mux(&mut command, &staged_path, &job_id, &jobs, Some(&cancel)).await?;
            }

            let size = std::fs::metadata(&staged_path)
                .map(|meta| meta.len())
                .map_err(|e| format!("stat staged: {e}"))?;

            jobs.update_progress(&job_id, size as u64, size as u64)
                .await;
            Ok(size)
        } else if supports_ranges
            && total_bytes > 1_048_576
            && config.download.default_concurrency > 1
        {
            let n = config
                .download
                .default_concurrency
                .min(config.download.max_concurrency);
            info!(
                "concurrent: {n} chunks, {} bytes",
                bytes_to_human(total_bytes)
            );

            let existing_parts = if staged_path.exists() {
                jobs.get_job_parts(&job_id).await
            } else {
                jobs.clear_job_parts(&job_id).await;
                Vec::new()
            };
            let mut existing_chunks: HashMap<usize, u64> = HashMap::new();
            for part in existing_parts {
                existing_chunks.insert(part.part_index as usize, part.downloaded_bytes);
            }

            let jobs_mgr = jobs.clone();
            let jid = job_id.clone();
            let last_flush = std::sync::atomic::AtomicU64::new(store::unix_now());
            let progress: Arc<dyn Fn(u64, u64) + Send + Sync> = Arc::new(move |dl, total| {
                let jm = jobs_mgr.clone();
                let id = jid.clone();
                let lf = &last_flush;
                let fi = flush_interval;
                let now = store::unix_now();
                let prev = lf.load(Ordering::Relaxed);
                if now - prev >= fi.as_secs().max(1) {
                    lf.store(now, Ordering::Relaxed);
                    tokio::spawn(async move {
                        jm.update_progress(&id, dl, total).await;
                    });
                }
            });
            download_chunked(
                &job.src_url,
                &headers_from_json(&job.headers_json),
                total_bytes,
                n,
                &staged_path,
                &client,
                cancel.clone(),
                &job_id,
                jobs.clone(),
                existing_chunks,
                progress,
            )
            .await
        } else {
            let resume_offset = if supports_ranges && last_downloaded > 0 {
                std::fs::metadata(&staged_path)
                    .map(|m| m.len())
                    .unwrap_or(0)
            } else {
                if last_downloaded > 0 {
                    info!("job {job_id}: no Range support, restarting from 0");
                }
                0
            };
            if resume_offset == 0 && last_downloaded > 0 {
                info!("job {job_id}: discarding partial, restarting from 0");
                let _ = tokio::fs::remove_file(&staged_path).await;
            }
            info!(
                "single-stream (size={}, ranges={}, resume={})",
                bytes_to_human(total_bytes),
                supports_ranges,
                resume_offset
            );
            let jobs_mgr = jobs.clone();
            let jid = job_id.clone();
            let last_flush = std::sync::atomic::AtomicU64::new(store::unix_now());
            let progress: Arc<dyn Fn(u64, u64) + Send + Sync> = Arc::new(move |dl, total| {
                let jm = jobs_mgr.clone();
                let id = jid.clone();
                let lf = &last_flush;
                let fi = flush_interval;
                let now = store::unix_now();
                let prev = lf.load(Ordering::Relaxed);
                if now - prev >= fi.as_secs().max(1) {
                    lf.store(now, Ordering::Relaxed);
                    tokio::spawn(async move {
                        jm.update_progress(&id, dl, total).await;
                    });
                }
            });
            let size = download_single(
                &job.src_url,
                &headers_from_json(&job.headers_json),
                &staged_path,
                &client,
                cancel.clone(),
                resume_offset,
                progress,
            )
            .await?;
            Ok(size)
        }
    }
    .await;

    // Handle result
    match download_result {
        Ok(size) if !store::completed_file_size_is_valid(size) => {
            let msg = format!(
                "downloaded file is too small: {size} bytes (minimum {} bytes)",
                store::MIN_COMPLETED_FILE_BYTES
            );
            error!("job {job_id}: {msg}");
            let will_retry = jobs
                .fail_or_retry(
                    &job_id,
                    &msg,
                    config.retry.max_retries,
                    config.retry.retry_interval_secs,
                )
                .await;
            jobs.unregister_active(&job_id).await;
            let _ = tokio::fs::remove_file(&staged_path).await;
            if !will_retry {
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            }
        }
        Ok(size) => {
            let transfer_elapsed = SystemTime::now().duration_since(start).unwrap_or_default();
            let finalize_started = SystemTime::now();
            match finalize_staged_output(&staged_path, &final_path).await {
                Ok(final_path) => {
                    let finalize_elapsed = finalize_started.elapsed().unwrap_or_default();
                    let total_elapsed = SystemTime::now().duration_since(start).unwrap_or_default();
                    if let Err(error) = jobs
                        .complete_job(&job_id, &final_path.display().to_string(), size)
                        .await
                    {
                        error!("job {job_id}: {error}");
                        jobs.fail_or_retry(
                            &job_id,
                            &error,
                            config.retry.max_retries,
                            config.retry.retry_interval_secs,
                        )
                        .await;
                        jobs.unregister_active(&job_id).await;
                        return;
                    }
                    jobs.unregister_active(&job_id).await;
                    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
                    info!(
                        "job {job_id}: saved to {}, bytes={}, transfer_wall={transfer_elapsed:.2?}, finalize_wall={finalize_elapsed:.2?}, total_wall={total_elapsed:.2?}",
                        final_path.display(),
                        bytes_to_human(size),
                    );
                }
                Err(e) => {
                    let msg = format!("finalize output: {e}");
                    error!("job {job_id}: {msg}");
                    let will_retry = jobs
                        .fail_or_retry(
                            &job_id,
                            &msg,
                            config.retry.max_retries,
                            config.retry.retry_interval_secs,
                        )
                        .await;
                    jobs.unregister_active(&job_id).await;
                    if !will_retry {
                        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
                    }
                }
            }
        }
        Err(e) => {
            let msg = if e == "cancelled" {
                "cancelled".to_string()
            } else {
                format!("download failed: {e}")
            };
            error!("job {job_id}: {msg}");
            let was_requeued = msg == "cancelled"
                && jobs
                    .get_job(&job_id)
                    .await
                    .is_some_and(|job| matches!(job.status.as_str(), "queued" | "retry_wait"));
            if classify_failure(&e) == FailureKind::DiskFull {
                let available = available_space(&config.temp_root).unwrap_or(0);
                let paused = jobs.pause_for_disk(available).await;
                warn!("job {job_id}: disk full, paused {paused} jobs");
                jobs.unregister_active(&job_id).await;
            } else if was_requeued || jobs.is_resource_paused() {
                info!("job {job_id}: paused and returned to queue");
                jobs.unregister_active(&job_id).await;
            } else if msg == "cancelled" {
                jobs.cancel_job(&job_id).await;
                jobs.unregister_active(&job_id).await;
                let _ = tokio::fs::remove_file(&staged_path).await;
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            } else {
                let will_retry = jobs
                    .fail_or_retry(
                        &job_id,
                        &msg,
                        config.retry.max_retries,
                        config.retry.retry_interval_secs,
                    )
                    .await;
                jobs.unregister_active(&job_id).await;
                if !will_retry {
                    let _ = tokio::fs::remove_file(&staged_path).await;
                    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
                }
            }
        }
    }
}

// ── Scheduler ───────────────────────────────────────────────

fn is_ip_blocked_retry(job: &JobRow) -> bool {
    if job.status != "retry_wait" || job.is_browser_hls() {
        return false;
    }
    is_ip_block_error(&job.last_error)
}

fn is_ip_block_error(error: &str) -> bool {
    classify_failure(error) == FailureKind::IpBlocked
}

fn next_vpn_location(
    locations: &[VpnLocation],
    current: &str,
    excluded: &[String],
) -> Option<String> {
    let usable: Vec<&VpnLocation> = locations
        .iter()
        .filter(|location| {
            !excluded
                .iter()
                .any(|name| name.eq_ignore_ascii_case(&location.name))
        })
        .collect();
    if usable.is_empty() {
        return None;
    }
    let current_index = usable
        .iter()
        .position(|location| location.name.eq_ignore_ascii_case(current));
    match current_index {
        Some(index) if usable.len() > 1 => Some(usable[(index + 1) % usable.len()].name.clone()),
        Some(_) => None,
        None => Some(usable[0].name.clone()),
    }
}

async fn rotate_vpn_for_blocked_retry(
    jobs: &JobManager,
    vpn: &RwLock<VpnConfig>,
) -> Result<String, String> {
    let mut config = vpn.write().await;
    let locations = list_locations(&config)
        .await
        .map_err(|error| format!("list locations: {error}"))?;
    let next = next_vpn_location(
        &locations,
        &config.required_location,
        &config.excluded_locations,
    )
    .ok_or_else(|| "no alternate VPN location available".to_string())?;
    let updated = switch_vpn_location(&config, &next)
        .await
        .map_err(|error| format!("switch to {next}: {error}"))?;
    jobs.save_vpn_location(&updated.required_location).await;
    *config = updated;
    Ok(next)
}

pub async fn run_scheduler(
    jobs: Arc<JobManager>,
    config: AppConfig,
    vpn: Arc<RwLock<VpnConfig>>,
    max_concurrent_jobs: Arc<AtomicUsize>,
    concurrency_mode: Arc<AtomicU8>,
) {
    let poll = Duration::from_secs(config.scheduler.poll_interval_secs);
    let mut next_rotation_attempt = Instant::now();
    loop {
        tokio::time::sleep(poll).await;

        let free_space = available_space(&config.temp_root)
            .and_then(|temp| available_space(&config.download_root).map(|output| temp.min(output)));
        match free_space {
            Ok(available) => {
                jobs.available_space.store(available, Ordering::Relaxed);
                match disk_space_action(
                    jobs.is_resource_paused(),
                    available,
                    config.scheduler.disk_pause_below_bytes,
                    config.scheduler.disk_resume_above_bytes,
                ) {
                    DiskSpaceAction::Continue => {}
                    DiskSpaceAction::Pause => {
                        let paused = jobs.pause_for_disk(available).await;
                        warn!(
                            "scheduler: low disk space ({available} bytes), paused {paused} jobs"
                        );
                        continue;
                    }
                    DiskSpaceAction::StayPaused => continue,
                    DiskSpaceAction::Resume => {
                        let resumed = jobs.resume_after_disk(available).await;
                        info!(
                            "scheduler: disk space recovered ({available} bytes), resumed {resumed} jobs"
                        );
                    }
                }
            }
            Err(error) => {
                warn!("scheduler: disk space check failed: {error}");
                continue;
            }
        }

        for jid in jobs.requeue_stalled_running_jobs(120).await {
            warn!("scheduler: stalled job {jid} returned to queue");
        }

        let mode = store::ConcurrencyMode::from_u8(concurrency_mode.load(Ordering::Relaxed));
        let running = jobs.list_running_jobs().await;
        let mut due = jobs.list_due_jobs(unix_now(), running.len() + 32).await;
        if mode == store::ConcurrencyMode::Global {
            let available = max_concurrent_jobs
                .load(Ordering::Relaxed)
                .saturating_sub(running.len());
            if available == 0 {
                continue;
            }
            due.truncate(available);
        } else {
            let limit = max_concurrent_jobs.load(Ordering::Relaxed);
            let mut active_by_domain: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for job in &running {
                *active_by_domain
                    .entry(
                        mode.group_key(&job.url, &job.src_url)
                            .expect("domain mode has a group key"),
                    )
                    .or_insert(0) += 1;
            }
            due.retain(|job| {
                let domain = mode.group_key(&job.url, &job.src_url).expect("domain mode has a group key");
                let count = active_by_domain.entry(domain).or_insert(0);
                if *count >= limit {
                    false
                } else {
                    *count += 1;
                    true
                }
            });
            if due.is_empty() {
                continue;
            }
        }

        let has_blocked_retry = due.iter().any(is_ip_blocked_retry);
        if has_blocked_retry && config.vpn.auto_rotate_on_ip_block {
            if !running.is_empty() {
                due.retain(|job| !is_ip_blocked_retry(job));
            } else if Instant::now() >= next_rotation_attempt {
                match rotate_vpn_for_blocked_retry(&jobs, &vpn).await {
                    Ok(location) => {
                        info!("scheduler: VPN rotated to {location} for IP-blocked retries");
                        next_rotation_attempt = Instant::now() + Duration::from_secs(60);
                    }
                    Err(error) => {
                        warn!("scheduler: VPN rotation deferred: {error}");
                        next_rotation_attempt = Instant::now() + Duration::from_secs(60);
                        due.retain(|job| !is_ip_blocked_retry(job));
                    }
                }
            } else {
                due.retain(|job| !is_ip_blocked_retry(job));
            }
        }

        for job_row in due {
            let jid = job_row.id.clone();
            if jobs.is_active(&jid).await {
                info!("scheduler: job {jid} still has an active worker, skipping");
                continue;
            }
            let claimed = jobs.set_job_running(&jid).await;
            if !claimed {
                info!("scheduler: job {jid} claimed by another worker, skipping");
                continue;
            }
            if job_row.is_browser_hls() {
                info!("scheduler: browser-refreshed source ready for {jid}");
            }
            info!(
                "scheduler: launching job {jid} (url={}, src_url={})",
                job_row.url, job_row.src_url
            );
            let jobs = jobs.clone();
            let mut cfg = config.clone();
            cfg.vpn = vpn.read().await.clone();
            tokio::spawn(async move {
                run_job(jid, cfg, jobs).await;
            });
        }
    }
}

// ── Restart recovery ────────────────────────────────────────

pub async fn recover_jobs(jobs: Arc<JobManager>, _config: &AppConfig) {
    info!("recovering pending jobs...");
    let pending = jobs.recover_pending(store::unix_now()).await;
    if pending.is_empty() {
        info!("recovery: no pending jobs found");
        return;
    }
    info!("recovery: {} pending jobs to process", pending.len());
    for job_row in &pending {
        let jid = job_row.id.clone();
        info!(
            "recovery: rescheduling job {jid} (url={}, src_url={})",
            job_row.url, job_row.src_url
        );
        // Clean up temp dir to avoid stale state, let download restart fresh
        // (the scheduler will re-create it)
        let temp_dir = Path::new(&job_row.temp_dir);
        if temp_dir.exists() && !job_row.is_hls() {
            let _ = tokio::fs::remove_dir_all(temp_dir).await;
        }
    }
}

/// Move staged outputs from the legacy hidden final directory into the configured root.
/// This runs before recovery/scheduling, so no download worker can hold an old path open.
pub async fn migrate_staged_files(download_root: &Path) -> Result<usize, String> {
    let legacy_dir = download_root.join(".video-downloader");
    let mut entries = match tokio::fs::read_dir(&legacy_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(format!("read legacy staged directory: {error}")),
    };
    let mut moved = 0;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("read legacy staged entry: {error}"))?
    {
        let source = entry.path();
        let file_type = entry
            .file_type()
            .await
            .map_err(|error| format!("inspect legacy staged entry: {error}"))?;
        let name = entry.file_name();
        let is_staged = name.to_string_lossy().ends_with(".staged");
        if !file_type.is_file() || !is_staged {
            continue;
        }

        let destination = download_root.join(&name);
        if tokio::fs::try_exists(&destination)
            .await
            .map_err(|error| format!("check staged destination: {error}"))?
        {
            warn!(
                "staged migration skipped because destination exists: {}",
                destination.display()
            );
            continue;
        }

        tokio::fs::rename(&source, &destination)
            .await
            .map_err(|error| format!("move staged output {}: {error}", source.display()))?;
        moved += 1;
        info!(
            "migrated staged output: {} -> {}",
            source.display(),
            destination.display()
        );
    }

    Ok(moved)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    use super::{
        DiskSpaceAction, FailureKind, JobManager, VpnLocation, classify_failure,
        config_for_location, disk_space_action, is_hls_url, is_ip_block_error,
        migrate_staged_files, next_vpn_location, parse_status_info, parse_vpn_locations,
        retry_delay,
    };
    use crate::config::VpnConfig;

    fn vpn_config() -> VpnConfig {
        VpnConfig {
            command: PathBuf::from("adguardvpn-cli"),
            socks_url: "socks5h://127.0.0.1:1080".into(),
            auto_connect: true,
            connect_command: vec!["connect".into(), "-l".into(), "tokyo".into()],
            connect_timeout_secs: 20,
            verify_before_each_job: true,
            required_location: "tokyo".into(),
            required_mode: "socks".into(),
            auto_rotate_on_ip_block: true,
            excluded_locations: vec!["Seoul".into()],
        }
    }

    #[tokio::test]
    async fn active_worker_is_visible_until_unregistered() {
        let jobs = JobManager::new(rusqlite::Connection::open_in_memory().unwrap());
        jobs.register_active("job", Arc::new(AtomicBool::new(false)))
            .await;
        assert!(jobs.is_active("job").await);

        jobs.unregister_active("job").await;
        assert!(!jobs.is_active("job").await);
    }

    #[test]
    fn parses_multi_word_location_from_status() {
        let status =
            parse_status_info("Connected to NEW YORK in SOCKS mode, listening on 127.0.0.1:1080");

        assert!(status.connected);
        assert!(!status.logged_out);
        assert_eq!(status.location, "new york");
    }

    #[test]
    fn parses_logged_out_status() {
        let status = parse_status_info("You are not logged in\nYou can log in by running `adguardvpn-cli login`");

        assert!(!status.connected);
        assert!(status.logged_out);
        assert_eq!(status.location, "");
    }

    #[test]
    fn parses_locations_from_cli_table() {
        let locations = parse_vpn_locations(
            "ISO   COUNTRY              CITY                           PING ESTIMATE\n\
             JP    Japan                Tokyo                          34\n\
             US    United States        New York                       191\n\
             You can connect to a location by running `adguardvpn-cli connect -l 'city'`",
        );

        assert_eq!(locations.len(), 2);
        assert_eq!(locations[1].name, "New York");
        assert_eq!(locations[1].label, "New York, United States");
    }

    #[test]
    fn config_for_location_replaces_the_connect_target() {
        let config = config_for_location(&vpn_config(), "New York");

        assert_eq!(config.required_location, "new york");
        assert_eq!(config.connect_command, ["connect", "-l", "New York"]);
    }

    #[test]
    fn vpn_rotation_skips_seoul_and_wraps() {
        let locations = vec![
            VpnLocation {
                name: "Seoul".into(),
                label: "Seoul, South Korea".into(),
            },
            VpnLocation {
                name: "Tokyo".into(),
                label: "Tokyo, Japan".into(),
            },
            VpnLocation {
                name: "Hong Kong".into(),
                label: "Hong Kong, Hong Kong".into(),
            },
        ];
        let excluded = vec!["Seoul".to_string()];

        assert_eq!(
            next_vpn_location(&locations, "tokyo", &excluded).as_deref(),
            Some("Hong Kong")
        );
        assert_eq!(
            next_vpn_location(&locations, "Hong Kong", &excluded).as_deref(),
            Some("Tokyo")
        );
    }

    #[test]
    fn detects_only_forbidden_http_errors_as_ip_blocks() {
        assert!(is_ip_block_error(
            "download failed: fetch text: HTTP 403 Forbidden"
        ));
        assert!(!is_ip_block_error("download failed: HTTP 404 Not Found"));
        assert!(!is_ip_block_error("download failed: connection reset"));
    }

    #[test]
    fn classifies_failures_by_recovery_policy() {
        assert_eq!(classify_failure("cancelled"), FailureKind::Cancelled);
        assert_eq!(
            classify_failure("write segment: No space left on device (os error 28)"),
            FailureKind::DiskFull
        );
        assert_eq!(
            classify_failure("download: HTTP 403 Forbidden"),
            FailureKind::IpBlocked
        );
        assert_eq!(
            classify_failure("download: HTTP 404 Not Found"),
            FailureKind::Permanent
        );
        assert_eq!(
            classify_failure("download: HTTP 429 Too Many Requests"),
            FailureKind::Transient
        );
        assert_eq!(
            classify_failure("download: HTTP 503 Service Unavailable"),
            FailureKind::Transient
        );
        assert_eq!(
            classify_failure("encrypted HLS is not supported"),
            FailureKind::Permanent
        );
    }

    #[test]
    fn retry_delay_is_exponential_bounded_and_deterministic() {
        assert_eq!(retry_delay(30, 0, "job-a"), retry_delay(30, 0, "job-a"));
        let first = retry_delay(30, 0, "job-a");
        let second = retry_delay(30, 1, "job-a");
        let capped = retry_delay(30, 20, "job-a");
        assert!((30..38).contains(&first));
        assert!((60..75).contains(&second));
        assert!((1_920..2_400).contains(&capped));
    }

    #[test]
    fn disk_space_policy_uses_hysteresis() {
        const GIB: u64 = 1024 * 1024 * 1024;
        assert_eq!(
            disk_space_action(false, 4 * GIB, 5 * GIB, 10 * GIB),
            DiskSpaceAction::Pause
        );
        assert_eq!(
            disk_space_action(false, 7 * GIB, 5 * GIB, 10 * GIB),
            DiskSpaceAction::Continue
        );
        assert_eq!(
            disk_space_action(true, 7 * GIB, 5 * GIB, 10 * GIB),
            DiskSpaceAction::StayPaused
        );
        assert_eq!(
            disk_space_action(true, 10 * GIB, 5 * GIB, 10 * GIB),
            DiskSpaceAction::Resume
        );
    }

    #[tokio::test]
    async fn migrates_only_staged_files_from_legacy_root() {
        let root =
            std::env::temp_dir().join(format!("stash-staged-migration-{}", uuid::Uuid::new_v4()));
        let legacy = root.join(".video-downloader");
        tokio::fs::create_dir_all(&legacy).await.unwrap();
        tokio::fs::write(legacy.join(".job.video.mp4.staged"), b"staged")
            .await
            .unwrap();
        tokio::fs::write(legacy.join("keep.txt"), b"keep")
            .await
            .unwrap();

        assert_eq!(migrate_staged_files(&root).await.unwrap(), 1);
        assert_eq!(
            tokio::fs::read(root.join(".job.video.mp4.staged"))
                .await
                .unwrap(),
            b"staged"
        );
        assert!(legacy.join("keep.txt").exists());

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[test]
    fn detects_hls_urls_with_disguised_txt_manifests() {
        assert!(is_hls_url("https://cdn.example/video.m3u8?token=1"));
        assert!(is_hls_url(
            "https://cdn.example/id_,l,n,h,.urlset/master.txt"
        ));
        assert!(!is_hls_url("https://cdn.example/error.txt"));
    }
}

// ── Sync helper (preserved for health) ──────────────────────
