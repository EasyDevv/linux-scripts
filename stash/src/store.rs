use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use walkdir::WalkDir;

use crate::config::AppConfig;

pub const MIN_COMPLETED_FILE_BYTES: u64 = 1024 * 1024;

pub fn completed_file_size_is_valid(size: u64) -> bool {
    size >= MIN_COMPLETED_FILE_BYTES
}

pub fn is_hls_url(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    path.ends_with(".m3u8")
        || path.ends_with(".m3u")
        || (path.contains(".urlset/") && path.ends_with(".txt"))
}

// ── Existing types ──────────────────────────────────────────

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub downloaded: bool,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub results: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct CheckResponse {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub size: Option<u64>,
    pub modified_at: Option<u64>,
    pub downloaded: bool,
}

#[derive(Serialize)]
pub struct MarkResponse {
    pub path: String,
    pub downloaded: bool,
    pub downloaded_at: u64,
}

// ── Persistent job types ────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct JobRow {
    pub id: String,
    pub url: String,
    pub src_url: String,
    pub filename: String,
    pub headers_json: String,
    pub status: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub supports_ranges: bool,
    pub etag: String,
    pub last_modified: String,
    pub retry_count: u32,
    pub max_retries: u32,
    pub retry_interval_secs: u64,
    pub next_retry_at: u64,
    pub last_error: String,
    pub cancel_requested: bool,
    pub file_path: String,
    pub temp_dir: String,
    pub created_at: u64,
    pub started_at: u64,
    pub completed_at: u64,
    pub updated_at: u64,
    pub uploaded_segments: u32,
    pub total_segments: u32,
    pub phase: String,
}

impl JobRow {
    pub fn is_browser_hls(&self) -> bool {
        self.headers_json.contains("browser-hls")
    }

    pub fn is_hls(&self) -> bool {
        self.is_browser_hls() || is_hls_url(&self.src_url)
    }

    pub fn to_response(&self) -> JobResponse {
        let file_exists = if self.file_path.is_empty() {
            None
        } else {
            Some(std::path::Path::new(&self.file_path).exists())
        };
        self.response(file_exists)
    }

    pub fn to_response_without_file_check(&self) -> JobResponse {
        let file_exists = if self.status == "completed" && !self.file_path.is_empty() {
            Some(true)
        } else {
            None
        };
        self.response(file_exists)
    }

    fn response(&self, file_exists: Option<bool>) -> JobResponse {
        let uploaded = if self.is_hls() {
            Some(self.uploaded_segments)
        } else {
            None
        };
        let total_seg = self.total_segments.max(self.uploaded_segments);
        JobResponse {
            id: self.id.clone(),
            url: self.url.clone(),
            src_url: self.src_url.clone(),
            filename: self.filename.clone(),
            status: self.status.clone(),
            total_bytes: self.total_bytes,
            downloaded_bytes: self.downloaded_bytes,
            error: if self.last_error.is_empty() {
                None
            } else {
                Some(self.last_error.clone())
            },
            file_path: if self.file_path.is_empty() {
                None
            } else {
                Some(self.file_path.clone())
            },
            file_exists,
            created_at: self.created_at,
            completed_at: if self.completed_at > 0 {
                Some(self.completed_at)
            } else {
                None
            },
            headers_json: self.headers_json.clone(),
            retry_count: self.retry_count,
            uploaded_segments: uploaded,
            total_segments: total_seg,
            phase: self.phase.clone(),
        }
    }
}

pub fn uploaded_segment_count(temp_dir: &str) -> Option<u32> {
    if temp_dir.is_empty() {
        return None;
    }
    let entries = std::fs::read_dir(temp_dir).ok()?;
    let count = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with("segment-") && name.ends_with(".ts"))
        .count();
    Some(count as u32)
}

pub fn downloaded_hls_progress(temp_dir: &str) -> Option<(u32, u64)> {
    if temp_dir.is_empty() {
        return None;
    }
    let entries = std::fs::read_dir(temp_dir).ok()?;
    let mut completed = 0u32;
    let mut bytes = 0u64;
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if (name.starts_with("segment-") && name.ends_with(".ts")) || name == "init.ts" {
            if let Ok(metadata) = entry.metadata()
                && metadata.len() > 0
            {
                completed += 1;
                bytes += metadata.len();
            }
        }
    }
    Some((completed, bytes))
}

#[derive(Serialize)]
pub struct JobResponse {
    pub id: String,
    pub url: String,
    pub src_url: String,
    pub filename: String,
    pub status: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub error: Option<String>,
    pub file_path: Option<String>,
    pub file_exists: Option<bool>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub headers_json: String,
    pub retry_count: u32,
    pub uploaded_segments: Option<u32>,
    pub total_segments: u32,
    pub phase: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct JobPart {
    pub job_id: String,
    pub part_index: u32,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded_bytes: u64,
    pub part_path: String,
    pub status: String,
    pub updated_at: u64,
}

#[derive(Clone, Serialize)]
pub struct DownloadedFileRow {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub downloaded_at: u64,
    pub exists: bool,
    pub url: Option<String>,
    pub src_url: Option<String>,
    pub job_id: Option<String>,
}

// ── DB open & migration ────────────────────────────────────

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS downloaded_files (
           path TEXT PRIMARY KEY,
           downloaded_at INTEGER NOT NULL,
           source_url TEXT,
           note TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_downloaded_files_downloaded_at
           ON downloaded_files(downloaded_at);",
    )?;

    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS download_jobs (
           id TEXT PRIMARY KEY,
           url TEXT NOT NULL,
           filename TEXT NOT NULL,
           headers_json TEXT NOT NULL DEFAULT '[]',
           status TEXT NOT NULL DEFAULT 'queued',
           total_bytes INTEGER NOT NULL DEFAULT 0,
           downloaded_bytes INTEGER NOT NULL DEFAULT 0,
           supports_ranges INTEGER NOT NULL DEFAULT 0,
           etag TEXT NOT NULL DEFAULT '',
           last_modified TEXT NOT NULL DEFAULT '',
           retry_count INTEGER NOT NULL DEFAULT 0,
           max_retries INTEGER NOT NULL DEFAULT 5,
           retry_interval_secs INTEGER NOT NULL DEFAULT 30,
           next_retry_at INTEGER NOT NULL DEFAULT 0,
           last_error TEXT NOT NULL DEFAULT '',
           cancel_requested INTEGER NOT NULL DEFAULT 0,
           file_path TEXT NOT NULL DEFAULT '',
           temp_dir TEXT NOT NULL DEFAULT '',
           created_at INTEGER NOT NULL,
           started_at INTEGER NOT NULL DEFAULT 0,
           completed_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            uploaded_segments INTEGER NOT NULL DEFAULT 0,
            total_segments INTEGER NOT NULL DEFAULT 0,
            phase TEXT NOT NULL DEFAULT ''
          );
         CREATE INDEX IF NOT EXISTS idx_download_jobs_status
            ON download_jobs(status);
          CREATE INDEX IF NOT EXISTS idx_download_jobs_next_retry
            ON download_jobs(next_retry_at);
          CREATE INDEX IF NOT EXISTS idx_download_jobs_url_normalized
            ON download_jobs(rtrim(url, '/'));",
    )?;

    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS download_job_parts (
           job_id TEXT NOT NULL REFERENCES download_jobs(id) ON DELETE CASCADE,
           part_index INTEGER NOT NULL,
           start_byte INTEGER NOT NULL,
           end_byte INTEGER NOT NULL,
           downloaded_bytes INTEGER NOT NULL DEFAULT 0,
           part_path TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'pending',
           updated_at INTEGER NOT NULL,
          PRIMARY KEY (job_id, part_index)
          );",
    )?;

    // ── v0.2 migration: add url columns ──────────────────────
    let _ = db.execute_batch(
        "ALTER TABLE download_jobs ADD COLUMN src_url TEXT NOT NULL DEFAULT '';
         UPDATE download_jobs SET src_url = url WHERE src_url = '';
         ALTER TABLE downloaded_files ADD COLUMN url TEXT;",
    );
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_downloaded_files_url_normalized
           ON downloaded_files(rtrim(COALESCE(url, ''), '/'));
         CREATE INDEX IF NOT EXISTS idx_downloaded_files_source_url_normalized
           ON downloaded_files(rtrim(COALESCE(source_url, ''), '/'));",
    )?;

    // ── v0.3 migration: swap url / src_url semantics ─────────
    // Before: download_jobs.url = media URL, download_jobs.src_url = page URL
    // After : download_jobs.url = page URL,  download_jobs.src_url = media URL
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS user_migrations (
           name TEXT PRIMARY KEY,
           applied_at INTEGER NOT NULL
          );",
    )?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (
           name TEXT PRIMARY KEY,
           value TEXT NOT NULL
          );",
    )?;
    let already_done: bool = db
        .query_row(
            "SELECT 1 FROM user_migrations WHERE name = 'swap_url_src_url_v1'",
            [],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !already_done {
        // Swap download_jobs.url ↔ download_jobs.src_url
        db.execute_batch(
            "UPDATE download_jobs
                SET url = (SELECT src_url FROM download_jobs j2 WHERE j2.id = download_jobs.id),
                    src_url = (SELECT url   FROM download_jobs j3 WHERE j3.id = download_jobs.id);",
        )?;
        // Swap downloaded_files.url ↔ downloaded_files.source_url
        db.execute_batch(
            "UPDATE downloaded_files
                SET url = (SELECT source_url FROM downloaded_files d2 WHERE d2.path = downloaded_files.path),
                    source_url = (SELECT url       FROM downloaded_files d3 WHERE d3.path = downloaded_files.path);",
        )?;
        let now = unix_now();
        db.execute(
            "INSERT INTO user_migrations (name, applied_at) VALUES ('swap_url_src_url_v1', ?1)",
            params![now],
        )?;
    }

    // ── v0.4 migration: add browser-HLS progress columns ─────
    let _ = db.execute(
        "ALTER TABLE download_jobs ADD COLUMN total_segments INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE download_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = db.execute(
        "ALTER TABLE download_jobs ADD COLUMN uploaded_segments INTEGER NOT NULL DEFAULT 0",
        [],
    );

    {
        let mut backfill_stmt = db.prepare(
            "SELECT id, temp_dir
             FROM download_jobs
             WHERE headers_json LIKE '%browser-hls%'
               AND uploaded_segments = 0
               AND temp_dir != ''",
        )?;
        let rows = backfill_stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (id, temp_dir) = row?;
            if let Some(count) = uploaded_segment_count(&temp_dir) {
                db.execute(
                    "UPDATE download_jobs SET uploaded_segments = ?2 WHERE id = ?1",
                    params![id, count as i64],
                )?;
            }
        }
    }

    db.execute(
        "UPDATE download_jobs
         SET uploaded_segments = total_segments
         WHERE headers_json LIKE '%browser-hls%'
           AND status = 'completed'
           AND total_segments > uploaded_segments",
        [],
    )?;

    db.execute(
        "UPDATE download_jobs
         SET phase = CASE
               WHEN status = 'prepare' THEN 'prepare'
               WHEN status = 'mux' THEN 'mux'
               WHEN phase = '' AND status = 'assembling' THEN 'prepare'
               WHEN phase = '' AND status = 'remuxing' THEN 'mux'
               WHEN phase = 'assembling' THEN 'prepare'
               WHEN phase = 'remuxing' THEN 'mux'
               ELSE phase
             END,
             status = 'finalizing'
         WHERE status IN ('assembling', 'remuxing', 'prepare', 'mux')",
        [],
    )?;

    invalidate_small_completed_jobs(&db, unix_now())?;

    Ok(db)
}

pub fn invalidate_small_completed_jobs(db: &Connection, now: u64) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE download_jobs
         SET status = 'failed', phase = '',
             last_error = 'downloaded file is smaller than 1 MiB',
             updated_at = ?2
         WHERE status = 'completed' AND downloaded_bytes < ?1",
        params![MIN_COMPLETED_FILE_BYTES as i64, now as i64],
    )
}

const VPN_LOCATION_SETTING: &str = "vpn_location";
const BROWSER_HLS_LEVEL_SETTING: &str = "browser_hls_level";
const MAX_CONCURRENT_JOBS_SETTING: &str = "max_concurrent_jobs";
const CONCURRENCY_MODE_SETTING: &str = "concurrency_mode";

pub fn load_vpn_location(db: &Connection) -> rusqlite::Result<Option<String>> {
    db.query_row(
        "SELECT value FROM app_settings WHERE name = ?1",
        params![VPN_LOCATION_SETTING],
        |row| row.get(0),
    )
    .optional()
}

pub fn save_vpn_location(db: &Connection, location: &str) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO app_settings (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value",
        params![VPN_LOCATION_SETTING, location.trim()],
    )?;
    Ok(())
}

pub fn load_browser_hls_level(db: &Connection) -> rusqlite::Result<Option<u8>> {
    let level: Option<String> = db
        .query_row(
            "SELECT value FROM app_settings WHERE name = ?1",
            params![BROWSER_HLS_LEVEL_SETTING],
            |row| row.get(0),
        )
        .optional()?;
    Ok(level
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|level| (1..=3).contains(level)))
}

pub fn save_browser_hls_level(db: &Connection, level: u8) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO app_settings (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value",
        params![BROWSER_HLS_LEVEL_SETTING, level.clamp(1, 3).to_string()],
    )?;
    Ok(())
}

pub fn load_max_concurrent_jobs(db: &Connection) -> rusqlite::Result<Option<usize>> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM app_settings WHERE name = ?1",
            params![MAX_CONCURRENT_JOBS_SETTING],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| (3..=10).contains(value)))
}

pub fn save_max_concurrent_jobs(db: &Connection, value: usize) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO app_settings (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value",
        params![MAX_CONCURRENT_JOBS_SETTING, value.clamp(3, 10).to_string()],
    )?;
    Ok(())
}


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConcurrencyMode {
    SrcDomain,
    UrlDomain,
    Global,
}

impl ConcurrencyMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SrcDomain => "src_domain",
            Self::UrlDomain => "url_domain",
            Self::Global => "global",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "src_domain" => Some(Self::SrcDomain),
            "url_domain" => Some(Self::UrlDomain),
            "global" => Some(Self::Global),
            _ => None,
        }
    }

    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Global,
            2 => Self::UrlDomain,
            _ => Self::SrcDomain,
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::SrcDomain => 0,
            Self::Global => 1,
            Self::UrlDomain => 2,
        }
    }

    pub fn group_key(self, url: &str, src_url: &str) -> Option<String> {
        match self {
            Self::Global => None,
            Self::SrcDomain => Some(src_url_domain(src_url)),
            Self::UrlDomain => Some(src_url_domain(url)),
        }
    }
}

pub fn src_url_domain(src_url: &str) -> String {
    let trimmed = src_url.trim();
    let rest = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = rest
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or(rest)
        .trim()
        .trim_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        trimmed.to_ascii_lowercase()
    } else {
        host
    }
}

pub fn load_concurrency_mode(db: &Connection) -> rusqlite::Result<Option<ConcurrencyMode>> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM app_settings WHERE name = ?1",
            params![CONCURRENCY_MODE_SETTING],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.and_then(|value| ConcurrencyMode::parse(&value)))
}

pub fn save_concurrency_mode(db: &Connection, mode: ConcurrencyMode) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO app_settings (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value",
        params![CONCURRENCY_MODE_SETTING, mode.as_str()],
    )?;
    Ok(())
}

// ── Existing store functions ────────────────────────────────

fn is_downloaded_inner(db: &Connection, path: &Path) -> bool {
    let path_text = path.display().to_string();
    db.query_row(
        "SELECT 1 FROM downloaded_files WHERE path = ?1 LIMIT 1",
        params![path_text],
        |_| Ok(true),
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or(false)
}

pub fn mark_download(
    db: &Connection,
    path: &Path,
    url: Option<&str>,
    src_url: Option<&str>,
    note: Option<&str>,
) -> rusqlite::Result<MarkResponse> {
    let downloaded_at = unix_now();
    let path_text = path.display().to_string();
    db.execute(
        "INSERT INTO downloaded_files (path, downloaded_at, source_url, url, note)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET
           downloaded_at = excluded.downloaded_at,
           source_url = excluded.source_url,
           url = excluded.url,
           note = excluded.note",
        params![path_text, downloaded_at, src_url, url, note],
    )?;
    Ok(MarkResponse {
        path: path_text,
        downloaded: true,
        downloaded_at,
    })
}

pub fn search(
    config: &AppConfig,
    db: &Connection,
    query: &str,
    under: Option<&str>,
    limit: usize,
) -> Result<SearchResponse, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Err("query is required".into());
    }
    let limit = limit.min(config.max_results);
    let roots = match under {
        Some(u) => vec![resolve_existing_directory(u, config).map_err(|e| e.to_string())?],
        None => config.allowed_roots.clone(),
    };
    let mut results = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root).follow_links(false) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().contains(&q) {
                continue;
            }
            let path = entry.path().canonicalize().map_err(|e| e.to_string())?;
            ensure_allowed(&path, config).map_err(|e| e.0)?;
            let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            results.push(FileEntry {
                path: path.display().to_string(),
                name,
                size: metadata.len(),
                modified_at: modified_at(&metadata),
                downloaded: is_downloaded_inner(db, &path),
            });
            if results.len() >= limit {
                return Ok(SearchResponse { results });
            }
        }
    }
    Ok(SearchResponse { results })
}

pub fn check(
    config: &AppConfig,
    db: &Connection,
    input_path: &str,
) -> Result<CheckResponse, String> {
    let requested = resolve_requested_path(input_path, config).map_err(|e| e.to_string())?;
    if !requested.exists() {
        return Ok(CheckResponse {
            path: requested.display().to_string(),
            exists: false,
            is_file: false,
            size: None,
            modified_at: None,
            downloaded: false,
        });
    }
    let path = requested.canonicalize().map_err(|e| e.to_string())?;
    ensure_allowed(&path, config).map_err(|e| e.0)?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(CheckResponse {
        path: path.display().to_string(),
        exists: true,
        is_file: metadata.is_file(),
        size: Some(metadata.len()),
        modified_at: modified_at(&metadata),
        downloaded: is_downloaded_inner(db, &path),
    })
}

// ── Job store functions ─────────────────────────────────────

pub fn create_job(
    db: &Connection,
    id: &str,
    url: &str,
    src_url: &str,
    filename: &str,
    headers_json: &str,
    _temp_dir: &str,
    max_retries: u32,
    retry_interval_secs: u64,
    now: u64,
) -> rusqlite::Result<JobRow> {
    db.execute(
        "INSERT INTO download_jobs
           (id, url, src_url, filename, headers_json, status, max_retries, retry_interval_secs,
            next_retry_at, temp_dir, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            url,
            src_url,
            filename,
            headers_json,
            max_retries,
            retry_interval_secs,
            now,
            _temp_dir,
            now
        ],
    )?;
    get_job(db, id).map(|r| r.unwrap())
}

pub fn get_job(db: &Connection, id: &str) -> rusqlite::Result<Option<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], row_to_job)?;
    Ok(rows.next().transpose()?)
}

pub fn list_jobs(db: &Connection, limit: usize) -> rusqlite::Result<Vec<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], row_to_job)?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn list_failed_job_ids(db: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = db.prepare(
        "SELECT id FROM download_jobs
         WHERE status = 'failed'
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn delete_failed_duplicates(
    db: &Connection,
    _filename: &str,
    url: &str,
) -> rusqlite::Result<usize> {
    db.execute(
        "DELETE FROM download_job_parts
         WHERE job_id IN (
           SELECT id FROM download_jobs
           WHERE rtrim(url, '/') = rtrim(?1, '/')
             AND status = 'failed'
         )",
        params![url],
    )?;
    db.execute(
        "DELETE FROM download_jobs
         WHERE rtrim(url, '/') = rtrim(?1, '/')
           AND status = 'failed'",
        params![url],
    )
}

pub fn list_jobs_for_url(
    db: &Connection,
    url: &str,
    limit: usize,
) -> rusqlite::Result<Vec<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs
         WHERE rtrim(url, '/') = rtrim(?1, '/')
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![url, limit as i64], row_to_job)?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn count_active_jobs(db: &Connection) -> rusqlite::Result<usize> {
    db.query_row(
        "SELECT COUNT(*) FROM download_jobs
         WHERE status = 'running'",
        [],
        |row| row.get(0),
    )
}

pub fn list_running_jobs(db: &Connection) -> rusqlite::Result<Vec<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs
         WHERE status = 'running'
         ORDER BY started_at ASC, created_at ASC",
    )?;
    let rows = stmt.query_map([], row_to_job)?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn has_resource_wait_jobs(db: &Connection) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM download_jobs WHERE status = 'resource_wait')",
        [],
        |row| row.get(0),
    )
}

pub fn requeue_excess_running_jobs(
    db: &Connection,
    max_concurrent_jobs: usize,
    now: u64,
    mode: ConcurrencyMode,
) -> rusqlite::Result<Vec<String>> {
    let running = list_running_jobs(db)?;
    let ids = match mode {
        ConcurrencyMode::Global => {
            let excess = running.len().saturating_sub(max_concurrent_jobs);
            if excess == 0 {
                Vec::new()
            } else {
                let mut ids = running.into_iter().map(|job| job.id).collect::<Vec<_>>();
                ids.reverse();
                ids.truncate(excess);
                ids
            }
        }
        ConcurrencyMode::SrcDomain | ConcurrencyMode::UrlDomain => {
            let mut ids = Vec::new();
            let mut seen: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for job in running {
                let domain = mode
                    .group_key(&job.url, &job.src_url)
                    .expect("domain mode has a group key");
                let count = seen.entry(domain).or_insert(0);
                *count += 1;
                if *count > max_concurrent_jobs {
                    ids.push(job.id);
                }
            }
            ids
        }
    };
    for id in &ids {
        db.execute(
            "UPDATE download_jobs
             SET status = 'queued', cancel_requested = 0,
                 next_retry_at = 0, last_error = '', updated_at = ?2
             WHERE id = ?1 AND status = 'running'",
            params![id, now as i64],
        )?;
    }
    Ok(ids)
}

pub fn requeue_stalled_running_jobs(
    db: &Connection,
    stale_before: u64,
    now: u64,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = db.prepare(
        "SELECT id FROM download_jobs
         WHERE status = 'running' AND updated_at < ?1",
    )?;
    let ids = stmt
        .query_map(params![stale_before as i64], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for id in &ids {
        db.execute(
            "UPDATE download_jobs
             SET status = 'retry_wait', cancel_requested = 0, next_retry_at = ?2 + 30,
                 last_error = 'stalled download waiting to retry', updated_at = ?2
             WHERE id = ?1 AND status = 'running'",
            params![id, now as i64],
        )?;
    }
    Ok(ids)
}

pub fn list_due_jobs(db: &Connection, now: u64, max_count: usize) -> rusqlite::Result<Vec<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs
          WHERE ((status = 'queued' AND cancel_requested = 0)
             OR (status = 'retry_wait' AND next_retry_at <= ?1 AND cancel_requested = 0))
         ORDER BY created_at ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![now, max_count as i64], row_to_job)?;
    rows.collect::<Result<Vec<_>, _>>()
}

pub fn find_active_duplicate(
    db: &Connection,
    filename: &str,
    url: &str,
) -> rusqlite::Result<Option<JobRow>> {
    let mut stmt = db.prepare(
        "SELECT id, url, src_url, filename, headers_json, status,
                total_bytes, downloaded_bytes,
                supports_ranges, etag, last_modified,
                retry_count, max_retries, retry_interval_secs,
                next_retry_at, last_error,
                cancel_requested, file_path, temp_dir,
                created_at, started_at, completed_at, updated_at,
                uploaded_segments, total_segments, phase
         FROM download_jobs
         WHERE filename = ?1 AND url = ?2
            AND status IN ('running', 'queued', 'retry_wait', 'finalizing', 'assembling', 'remuxing')
         ORDER BY created_at DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![filename, url], row_to_job)?;
    Ok(rows.next().transpose()?)
}

pub fn recover_pending_jobs(db: &Connection, now: u64) -> rusqlite::Result<Vec<JobRow>> {
    // Browser-driven HLS jobs are handled by the CDP worker, so keep them running.
    // The stale cleanup will eventually fail them if the CDP worker cannot process them.
    // Normal downloader jobs from a dead process can restart from queued.
    db.execute(
        "UPDATE download_jobs
         SET status = 'queued', last_error = 'recovered from unclean shutdown',
              updated_at = ?1
         WHERE status IN ('running', 'finalizing', 'assembling', 'remuxing') AND headers_json NOT LIKE '%browser-hls%'",
        params![now],
    )?;
    // Return all non-terminal jobs
    list_due_jobs(db, now, 100)
}

/// Periodically clean up browser-hls jobs that haven't made progress.
/// Jobs exceeding `max_restart_attempts` are marked `failed`.
/// Others have their `retry_count` incremented so the CDP worker can pick them up.
pub fn stale_browser_hls_cleanup(
    db: &Connection,
    now: u64,
    stale_timeout_secs: u64,
    max_restart_attempts: u32,
) -> rusqlite::Result<usize> {
    let cutoff = (now as i64).saturating_sub(stale_timeout_secs as i64);
    let max_attempts = max_restart_attempts as i64;
    // Mark as failed if retry_count already >= max attempts
    db.execute(
        "UPDATE download_jobs
         SET status = 'failed',
             last_error = 'exceeded max browser-hls restart attempts',
             completed_at = ?1,
             updated_at = ?1
          WHERE status IN ('running', 'finalizing', 'assembling', 'remuxing')
           AND headers_json LIKE '%browser-hls%'
           AND updated_at < ?2
           AND retry_count >= ?3",
        params![now as i64, cutoff, max_attempts],
    )?;
    // Return interrupted browser finalization to a state the browser worker can resume.
    let affected = db.execute(
        "UPDATE download_jobs
          SET status = 'running',
              phase = 'download',
              retry_count = retry_count + 1,
             last_error = 'stale: no progress for > ' || ?2 || ' seconds',
             updated_at = ?1
          WHERE status IN ('running', 'finalizing', 'assembling', 'remuxing')
           AND headers_json LIKE '%browser-hls%'
           AND updated_at < ?3
           AND retry_count < ?4",
        params![now as i64, stale_timeout_secs as i64, cutoff, max_attempts],
    )?;
    Ok(affected as usize)
}

pub fn set_job_running(db: &Connection, id: &str, started_at: u64) -> rusqlite::Result<bool> {
    let rows = db.execute(
        "UPDATE download_jobs
         SET status = 'running', started_at = ?2, updated_at = ?2
         WHERE id = ?1 AND status IN ('queued', 'retry_wait') AND cancel_requested = 0",
        params![id, started_at],
    )?;
    Ok(rows > 0)
}

pub fn refresh_browser_hls_source(
    db: &Connection,
    id: &str,
    src_url: &str,
    headers_json: &str,
    now: u64,
) -> rusqlite::Result<bool> {
    let rows = db.execute(
        "UPDATE download_jobs
         SET src_url = ?2, headers_json = ?3, status = 'queued', phase = '',
             last_error = '', next_retry_at = 0, updated_at = ?4
         WHERE id = ?1 AND headers_json LIKE '%browser-hls%'
           AND status IN ('queued', 'running', 'retry_wait')",
        params![id, src_url, headers_json, now as i64],
    )?;
    Ok(rows > 0)
}

pub fn set_job_phase(db: &Connection, id: &str, phase: &str, now: u64) -> rusqlite::Result<bool> {
    let rows = db.execute(
        "UPDATE download_jobs
         SET phase = ?2,
             status = CASE WHEN ?2 = 'download' THEN 'running' ELSE 'finalizing' END,
             updated_at = ?3
         WHERE id = ?1 AND status IN ('running', 'queued', 'finalizing', 'assembling', 'remuxing') AND cancel_requested = 0",
        params![id, phase, now],
    )?;
    Ok(rows > 0)
}

pub fn set_total_segments(db: &Connection, id: &str, total: u32) -> rusqlite::Result<bool> {
    let rows = db.execute(
        "UPDATE download_jobs
         SET total_segments = ?2
         WHERE id = ?1",
        params![id, total as i32],
    )?;
    Ok(rows > 0)
}

pub fn update_job_progress(
    db: &Connection,
    id: &str,
    downloaded: u64,
    total: u64,
    now: u64,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE download_jobs
         SET downloaded_bytes = ?2, total_bytes = ?3, updated_at = ?4
         WHERE id = ?1 AND status IN ('running', 'queued', 'retry_wait', 'finalizing', 'assembling', 'remuxing')",
        params![id, downloaded as i64, total as i64, now],
    )?;
    Ok(())
}

pub fn update_hls_progress(
    db: &Connection,
    id: &str,
    completed: u64,
    total: u64,
    downloaded_bytes: u64,
    now: u64,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE download_jobs
         SET downloaded_bytes = ?2, uploaded_segments = ?3, total_segments = ?4, updated_at = ?5
         WHERE id = ?1 AND status = 'running'",
        params![
            id,
            downloaded_bytes as i64,
            completed as i64,
            total as i64,
            now as i64
        ],
    )?;
    Ok(())
}

pub fn record_browser_hls_segment(
    db: &Connection,
    id: &str,
    index: usize,
    bytes: u64,
    part_path: &str,
    now: u64,
) -> rusqlite::Result<(bool, u64, u32)> {
    let inserted = db.execute(
        "INSERT OR IGNORE INTO download_job_parts
           (job_id, part_index, start_byte, end_byte, downloaded_bytes, part_path, status, updated_at)
         VALUES (?1, ?2, 0, ?3, ?4, ?5, 'completed', ?6)",
        params![id, index as i64, bytes.saturating_sub(1) as i64, bytes as i64, part_path, now],
    )?;
    if inserted > 0 {
        db.execute(
            "UPDATE download_jobs
             SET downloaded_bytes = downloaded_bytes + ?2,
                 uploaded_segments = uploaded_segments + 1,
                 updated_at = ?3
             WHERE id = ?1 AND status IN ('running', 'queued', 'retry_wait', 'finalizing', 'assembling', 'remuxing')",
            params![id, bytes as i64, now],
        )?;
    }
    let state = db.query_row(
        "SELECT downloaded_bytes, uploaded_segments FROM download_jobs WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u32)),
    )?;
    Ok((inserted > 0, state.0, state.1))
}

pub fn complete_job(
    db: &Connection,
    id: &str,
    file_path: &str,
    total_bytes: u64,
    now: u64,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE download_jobs
         SET status = 'completed', phase = '', file_path = ?2, total_bytes = ?3,
             downloaded_bytes = ?3, last_error = '',
             uploaded_segments = CASE
               WHEN total_segments > uploaded_segments THEN total_segments
               ELSE uploaded_segments
             END,
             completed_at = ?4, updated_at = ?4
         WHERE id = ?1",
        params![id, file_path, total_bytes as i64, now],
    )?;
    db.execute(
        "DELETE FROM download_job_parts WHERE job_id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn schedule_retry(
    db: &Connection,
    id: &str,
    error_msg: &str,
    now: u64,
    max_retries: u32,
    retry_interval: u64,
) -> rusqlite::Result<bool> {
    // Atomically increment retry_count and check
    let updated = db.execute(
        "UPDATE download_jobs
         SET status = CASE
               WHEN retry_count + 1 >= ?2 THEN 'failed'
               ELSE 'retry_wait'
             END,
             last_error = ?3,
             retry_count = retry_count + 1,
             next_retry_at = CASE
               WHEN retry_count + 1 >= ?2 THEN 0
               ELSE ?4 + ?5
             END,
             completed_at = CASE
               WHEN retry_count + 1 >= ?2 THEN ?4
               ELSE 0
             END,
             updated_at = ?4
         WHERE id = ?1 AND status IN ('running', 'retry_wait', 'queued', 'finalizing', 'assembling', 'remuxing')",
        params![id, max_retries, error_msg, now, retry_interval as i64],
    )?;
    if updated == 0 {
        return Ok(false);
    }
    // Check if it went to 'failed' or 'retry_wait'
    let job = get_job(db, id)?.unwrap();
    Ok(job.status == "retry_wait")
}

pub fn fail_job(db: &Connection, id: &str, error_msg: &str, now: u64) -> rusqlite::Result<bool> {
    let rows = db.execute(
        "UPDATE download_jobs
         SET status = 'failed', last_error = ?2, next_retry_at = 0,
             completed_at = ?3, updated_at = ?3
         WHERE id = ?1 AND status NOT IN ('completed', 'cancelled')",
        params![id, error_msg, now as i64],
    )?;
    Ok(rows > 0)
}

pub fn pause_jobs_for_resource(
    db: &Connection,
    error_msg: &str,
    now: u64,
) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE download_jobs
         SET status = 'resource_wait', last_error = ?1, updated_at = ?2
         WHERE status IN ('queued', 'running', 'finalizing', 'assembling', 'remuxing')",
        params![error_msg, now as i64],
    )
}

pub fn resume_resource_wait_jobs(db: &Connection, now: u64) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE download_jobs
         SET status = 'queued', last_error = '', next_retry_at = 0, updated_at = ?1
         WHERE status = 'resource_wait' AND cancel_requested = 0",
        params![now as i64],
    )
}

pub fn delete_job(db: &Connection, id: &str) -> rusqlite::Result<bool> {
    let filename: String = db
        .query_row(
            "SELECT filename FROM download_jobs WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_default();
    if filename.is_empty() {
        return Ok(false);
    }
    // Clear all terminal jobs sharing the same filename (prevents duplicate
    // same-filename entries like completed + cancelled from confusing the UI).
    db.execute(
        "DELETE FROM download_job_parts
         WHERE job_id IN (
           SELECT id FROM download_jobs
           WHERE filename = ?1 AND status IN ('completed', 'failed', 'cancelled')
         )",
        params![filename],
    )?;
    let rows = db.execute(
        "DELETE FROM download_jobs
         WHERE filename = ?1 AND status IN ('completed', 'failed', 'cancelled')",
        params![filename],
    )?;
    Ok(rows > 0)
}

pub fn delete_jobs(db: &Connection, ids: &[String]) -> rusqlite::Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    // Collect unique filenames from the selected jobs
    let mut filenames: Vec<String> = vec![];
    for id in ids {
        let filename: String = db
            .query_row(
                "SELECT filename FROM download_jobs WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_default();
        if !filename.is_empty() && !filenames.contains(&filename) {
            filenames.push(filename);
        }
    }
    if filenames.is_empty() {
        return Ok(0);
    }
    let mut count = 0;
    for fname in &filenames {
        db.execute(
            "DELETE FROM download_job_parts
             WHERE job_id IN (
               SELECT id FROM download_jobs
               WHERE filename = ?1 AND status IN ('completed', 'failed', 'cancelled')
             )",
            params![fname],
        )?;
        let rows = db.execute(
            "DELETE FROM download_jobs
             WHERE filename = ?1 AND status IN ('completed', 'failed', 'cancelled')",
            params![fname],
        )?;
        count += rows;
    }
    Ok(count)
}

pub fn cancel_job(db: &Connection, id: &str, now: u64) -> rusqlite::Result<bool> {
    let mut rows = db.execute(
        "UPDATE download_jobs
         SET cancel_requested = 1, status = 'cancelled', phase = '', completed_at = ?2, updated_at = ?2
         WHERE id = ?1 AND status NOT IN ('completed', 'failed', 'cancelled')",
        params![id, now],
    )?;
    if rows == 0 {
        rows = db.execute(
            "UPDATE download_jobs
             SET cancel_requested = 1, status = 'cancelled', completed_at = ?2, updated_at = ?2
             WHERE id = ?1 AND status = 'resource_wait'",
            params![id, now],
        )?;
    }
    if rows > 0 {
        db.execute(
            "DELETE FROM download_job_parts WHERE job_id = ?1",
            params![id],
        )?;
    }
    Ok(rows > 0)
}

pub fn retry_job(db: &Connection, id: &str, now: u64) -> rusqlite::Result<bool> {
    let resume = get_job(db, id)?.and_then(|job| {
        if job.is_hls() && !job.is_browser_hls() {
            downloaded_hls_progress(&job.temp_dir)
                .map(|(completed, bytes)| (completed, bytes, job.total_segments))
        } else {
            None
        }
    });
    let rows = db.execute(
        "UPDATE download_jobs
           SET status = 'queued', phase = '', cancel_requested = 0, retry_count = 0, last_error = '',
                next_retry_at = 0, completed_at = 0, total_bytes = 0, downloaded_bytes = 0,
                supports_ranges = 0, etag = '', last_modified = '', uploaded_segments = 0,
                file_path = '', updated_at = ?2
           WHERE id = ?1 AND status IN ('completed', 'failed', 'cancelled', 'retry_wait')",
        params![id, now],
    )?;
    if rows > 0 {
        db.execute(
            "DELETE FROM download_job_parts WHERE job_id = ?1",
            params![id],
        )?;
        if let Some((completed, bytes, total)) = resume {
            db.execute(
                "UPDATE download_jobs
                 SET downloaded_bytes = ?2, uploaded_segments = ?3, total_segments = ?4
                 WHERE id = ?1",
                params![id, bytes as i64, completed as i64, total as i64],
            )?;
        }
    }
    Ok(rows > 0)
}

pub fn retry_file_job(db: &Connection, id: &str, now: u64) -> rusqlite::Result<bool> {
    let file_path = get_job(db, id)?
        .map(|job| job.file_path)
        .unwrap_or_default();
    if !retry_job(db, id, now)? {
        return Ok(false);
    }
    if !file_path.is_empty() {
        db.execute(
            "DELETE FROM downloaded_files WHERE path = ?1",
            params![file_path],
        )?;
    }
    Ok(true)
}

pub fn clear_job_parts(db: &Connection, id: &str) -> rusqlite::Result<()> {
    db.execute(
        "DELETE FROM download_job_parts WHERE job_id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn save_probe_result(
    db: &Connection,
    id: &str,
    total_bytes: u64,
    supports_ranges: bool,
    etag: &str,
    last_modified: &str,
    now: u64,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE download_jobs
         SET total_bytes = ?2, supports_ranges = ?3, etag = ?4, last_modified = ?5,
             updated_at = ?6
         WHERE id = ?1",
        params![
            id,
            total_bytes as i64,
            supports_ranges as i32,
            etag,
            last_modified,
            now
        ],
    )?;
    Ok(())
}

// ── Part store ─────────────────────────────────────────────

#[allow(dead_code)]
pub fn upsert_job_part(db: &Connection, part: &JobPart) -> rusqlite::Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO download_job_parts
           (job_id, part_index, start_byte, end_byte, downloaded_bytes, part_path, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            part.job_id, part.part_index as i64,
            part.start_byte as i64, part.end_byte as i64,
            part.downloaded_bytes as i64,
            part.part_path, part.status, part.updated_at as i64,
        ],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_job_parts(db: &Connection, job_id: &str) -> rusqlite::Result<Vec<JobPart>> {
    let mut stmt = db.prepare(
        "SELECT job_id, part_index, start_byte, end_byte,
                downloaded_bytes, part_path, status, updated_at
         FROM download_job_parts WHERE job_id = ?1 ORDER BY part_index",
    )?;
    let rows = stmt.query_map(params![job_id], |r| {
        Ok(JobPart {
            job_id: r.get(0)?,
            part_index: r.get::<_, i64>(1)? as u32,
            start_byte: r.get::<_, i64>(2)? as u64,
            end_byte: r.get::<_, i64>(3)? as u64,
            downloaded_bytes: r.get::<_, i64>(4)? as u64,
            part_path: r.get(5)?,
            status: r.get(6)?,
            updated_at: r.get::<_, i64>(7)? as u64,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
}

// ── Downloaded files management ─────────────────────────────

pub fn list_downloaded(
    db: &Connection,
    query: Option<&str>,
    limit: usize,
) -> rusqlite::Result<Vec<DownloadedFileRow>> {
    let q = query.unwrap_or("").trim().to_lowercase();
    let limit = limit.max(1) as i64;

    let mut stmt = if q.is_empty() {
        db.prepare(
            "SELECT df.path, df.downloaded_at, df.source_url, df.url,
                    (SELECT id FROM download_jobs
                     WHERE file_path = df.path
                     ORDER BY created_at DESC LIMIT 1)
             FROM downloaded_files df
             ORDER BY downloaded_at DESC
             LIMIT ?1",
        )?
    } else {
        db.prepare(
            "SELECT df.path, df.downloaded_at, df.source_url, df.url,
                    (SELECT id FROM download_jobs
                     WHERE file_path = df.path
                     ORDER BY created_at DESC LIMIT 1)
             FROM downloaded_files df
             WHERE LOWER(df.path) LIKE '%' || ?2 || '%'
             ORDER BY downloaded_at DESC
             LIMIT ?1",
        )?
    };

    let mut results = Vec::new();
    let rows: Vec<(String, u64, Option<String>, Option<String>, Option<String>)> = if q.is_empty() {
        let map = |r: &rusqlite::Row| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)? as u64,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        };
        stmt.query_map(params![limit], map)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        let map = |r: &rusqlite::Row| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)? as u64,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        };
        stmt.query_map(params![limit, q], map)?
            .collect::<Result<Vec<_>, _>>()?
    };

    for (path_str, downloaded_at, src_url, url, job_id) in rows {
        let p = Path::new(&path_str);
        let exists = p.exists();
        let size = if exists {
            std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        results.push(DownloadedFileRow {
            path: path_str,
            name,
            size,
            downloaded_at,
            exists,
            url,
            src_url,
            job_id,
        });
    }
    Ok(results)
}

pub fn list_downloaded_for_url(
    db: &Connection,
    url: &str,
    limit: usize,
) -> rusqlite::Result<Vec<DownloadedFileRow>> {
    let mut stmt = db.prepare(
        "SELECT df.path, df.downloaded_at, df.source_url, df.url,
                (SELECT id FROM download_jobs
                 WHERE file_path = df.path
                 ORDER BY created_at DESC LIMIT 1)
         FROM downloaded_files df
         WHERE rtrim(COALESCE(df.url, ''), '/') = rtrim(?1, '/')
            OR rtrim(COALESCE(df.source_url, ''), '/') = rtrim(?1, '/')
         ORDER BY downloaded_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![url, limit.max(1) as i64], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)? as u64,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut results = Vec::new();
    for row in rows {
        let (path_str, downloaded_at, src_url, page_url, job_id) = row?;
        let path = Path::new(&path_str);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        results.push(DownloadedFileRow {
            path: path_str,
            name,
            size: 0,
            downloaded_at,
            exists: true,
            url: page_url,
            src_url,
            job_id,
        });
    }
    Ok(results)
}

pub fn delete_downloaded(db: &Connection, path: &str) -> rusqlite::Result<(bool, bool)> {
    let path_obj = Path::new(path);
    let disk_deleted = if path_obj.exists() {
        std::fs::remove_file(path_obj).is_ok()
    } else {
        false
    };
    let db_deleted = db
        .execute(
            "DELETE FROM downloaded_files WHERE path = ?1",
            params![path],
        )
        .is_ok();
    Ok((disk_deleted, db_deleted))
}

pub fn clear_downloaded_entries(db: &Connection, paths: &[String]) -> rusqlite::Result<usize> {
    if paths.is_empty() {
        return Ok(0);
    }
    let mut count = 0;
    for path in paths {
        let rows = db.execute(
            "DELETE FROM downloaded_files WHERE path = ?1",
            params![path],
        )?;
        count += rows;
    }
    Ok(count)
}

pub fn delete_downloaded_many(db: &Connection, paths: &[String]) -> rusqlite::Result<usize> {
    if paths.is_empty() {
        return Ok(0);
    }
    let mut count = 0;
    for path in paths {
        let p = std::path::Path::new(path);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
        let rows = db.execute(
            "DELETE FROM downloaded_files WHERE path = ?1",
            params![path],
        )?;
        count += rows;
    }
    Ok(count)
}

// ── Helpers ─────────────────────────────────────────────────

fn row_to_job(r: &rusqlite::Row) -> rusqlite::Result<JobRow> {
    Ok(JobRow {
        id: r.get(0)?,
        url: r.get(1)?,
        src_url: r.get(2)?,
        filename: r.get(3)?,
        headers_json: r.get(4)?,
        status: r.get(5)?,
        total_bytes: r.get::<_, i64>(6)? as u64,
        downloaded_bytes: r.get::<_, i64>(7)? as u64,
        supports_ranges: r.get::<_, i32>(8)? != 0,
        etag: r.get(9)?,
        last_modified: r.get(10)?,
        retry_count: r.get::<_, i32>(11)? as u32,
        max_retries: r.get::<_, i32>(12)? as u32,
        retry_interval_secs: r.get::<_, i64>(13)? as u64,
        next_retry_at: r.get::<_, i64>(14)? as u64,
        last_error: r.get(15)?,
        cancel_requested: r.get::<_, i32>(16)? != 0,
        file_path: r.get(17)?,
        temp_dir: r.get(18)?,
        created_at: r.get::<_, i64>(19)? as u64,
        started_at: r.get::<_, i64>(20)? as u64,
        completed_at: r.get::<_, i64>(21)? as u64,
        updated_at: r.get::<_, i64>(22)? as u64,
        uploaded_segments: r.get::<_, i32>(23)? as u32,
        total_segments: r.get::<_, i32>(24)? as u32,
        phase: r.get(25)?,
    })
}

mod err {
    use std::fmt;
    #[derive(Debug)]
    pub struct StoreError(pub String);
    impl fmt::Display for StoreError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{}", self.0)
        }
    }
}

fn resolve_existing_directory(input: &str, config: &AppConfig) -> Result<PathBuf, err::StoreError> {
    let path = resolve_requested_path(input, config)?;
    if !path.exists() {
        return Err(err::StoreError("under path does not exist".into()));
    }
    let path = path
        .canonicalize()
        .map_err(|e| err::StoreError(e.to_string()))?;
    ensure_allowed(&path, config)?;
    if !path.is_dir() {
        return Err(err::StoreError("under path must be a directory".into()));
    }
    Ok(path)
}

pub fn resolve_requested_path(input: &str, config: &AppConfig) -> Result<PathBuf, err::StoreError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(err::StoreError("path is required".into()));
    }
    let candidate = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        if Path::new(trimmed)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(err::StoreError("relative path cannot contain ..".into()));
        }
        config.allowed_roots[0].join(trimmed)
    };
    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .map_err(|e| err::StoreError(e.to_string()))?;
        ensure_allowed(&canonical, config)?;
        return Ok(canonical);
    }
    if candidate.is_absolute() {
        ensure_allowed_prefix(&candidate, config)?;
        Ok(candidate)
    } else {
        let root = std::fs::canonicalize(&config.allowed_roots[0])
            .map_err(|e| err::StoreError(e.to_string()))?;
        let abs = root.join(&candidate);
        ensure_allowed_prefix(&abs, config)?;
        Ok(abs)
    }
}

fn ensure_allowed(path: &Path, config: &AppConfig) -> Result<(), err::StoreError> {
    if config.allowed_roots.iter().any(|r| path.starts_with(r)) {
        Ok(())
    } else {
        Err(err::StoreError("path is outside allowed_roots".into()))
    }
}

fn ensure_allowed_prefix(path: &Path, config: &AppConfig) -> Result<(), err::StoreError> {
    if config.allowed_roots.iter().any(|r| path.starts_with(r)) {
        Ok(())
    } else {
        Err(err::StoreError("path is outside allowed_roots".into()))
    }
}

fn modified_at(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
        .map(|v| v.as_secs())
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> (Connection, PathBuf) {
        let path =
            std::env::temp_dir().join(format!("stash-store-test-{}.db", uuid::Uuid::new_v4()));
        (open_db(&path).unwrap(), path)
    }

    #[test]
    fn completed_file_requires_at_least_one_mibibyte() {
        assert!(!completed_file_size_is_valid(MIN_COMPLETED_FILE_BYTES - 1));
        assert!(completed_file_size_is_valid(MIN_COMPLETED_FILE_BYTES));
    }

    #[test]
    fn recovery_requeues_interrupted_direct_hls_finalization() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "direct-hls",
            "page",
            "https://example.test/video.m3u8",
            "video.mp4",
            "[]",
            "/tmp/direct-hls",
            5,
            30,
            1,
        )
        .unwrap();
        set_job_phase(&db, "direct-hls", "mux", 2).unwrap();

        let recovered = recover_pending_jobs(&db, 3).unwrap();
        let job = get_job(&db, "direct-hls").unwrap().unwrap();
        assert_eq!(job.status, "queued");
        assert!(recovered.iter().any(|job| job.id == "direct-hls"));

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn stale_browser_finalization_returns_to_running() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "browser-hls",
            "page",
            "source",
            "video.mp4",
            r#"{"transport":"browser-hls"}"#,
            "/tmp/browser-hls",
            5,
            30,
            1,
        )
        .unwrap();
        set_job_phase(&db, "browser-hls", "mux", 2).unwrap();

        assert_eq!(stale_browser_hls_cleanup(&db, 100, 10, 3).unwrap(), 1);
        let job = get_job(&db, "browser-hls").unwrap().unwrap();
        assert_eq!(job.status, "running");
        assert_eq!(job.phase, "download");
        assert_eq!(job.retry_count, 1);

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn invalid_small_completion_can_be_retried() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "job-1",
            "page",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        complete_job(&db, "job-1", "/tmp/video.mp4", 8_192, 2).unwrap();

        assert_eq!(invalidate_small_completed_jobs(&db, 3).unwrap(), 1);
        let failed = get_job(&db, "job-1").unwrap().unwrap();
        assert_eq!(failed.status, "failed");
        assert!(failed.last_error.contains("smaller than 1 MiB"));

        assert!(retry_job(&db, "job-1", 4).unwrap());
        let queued = get_job(&db, "job-1").unwrap().unwrap();
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.downloaded_bytes, 0);
        assert_eq!(queued.total_bytes, 0);
        assert!(queued.file_path.is_empty());

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn jobs_are_listed_by_added_time_without_status_priority() {
        let (db, db_path) = test_db();
        create_job(&db, "old", "page", "source", "old.mp4", "[]", "", 5, 30, 1).unwrap();
        create_job(&db, "new", "page", "source", "new.mp4", "[]", "", 5, 30, 2).unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'failed' WHERE id = 'new'",
            [],
        )
        .unwrap();

        let jobs = list_jobs(&db, 10).unwrap();
        assert_eq!(jobs[0].id, "new");
        assert_eq!(jobs[1].id, "old");

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn page_status_url_queries_use_normalized_indexes() {
        let (db, db_path) = test_db();
        let job_plan: String = db
            .query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM download_jobs
                 WHERE rtrim(url, '/') = rtrim(?1, '/')",
                params!["https://example.test/video/"],
                |row| row.get(3),
            )
            .unwrap();
        assert!(job_plan.contains("idx_download_jobs_url_normalized"));

        let mut stmt = db
            .prepare(
                "EXPLAIN QUERY PLAN SELECT path FROM downloaded_files
                 WHERE rtrim(COALESCE(url, ''), '/') = rtrim(?1, '/')
                    OR rtrim(COALESCE(source_url, ''), '/') = rtrim(?1, '/')",
            )
            .unwrap();
        let file_plan = stmt
            .query_map(params!["https://example.test/video/"], |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        assert!(file_plan.contains("idx_downloaded_files_url_normalized"));
        assert!(file_plan.contains("idx_downloaded_files_source_url_normalized"));

        drop(stmt);
        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn lists_all_failed_job_ids() {
        let (db, db_path) = test_db();
        create_job(&db, "old", "page", "source", "old.mp4", "[]", "", 5, 30, 1).unwrap();
        create_job(&db, "new", "page", "source", "new.mp4", "[]", "", 5, 30, 2).unwrap();
        create_job(
            &db,
            "completed",
            "page",
            "source",
            "completed.mp4",
            "[]",
            "",
            5,
            30,
            3,
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'failed' WHERE id IN ('old', 'new')",
            [],
        )
        .unwrap();

        assert_eq!(
            list_failed_job_ids(&db).unwrap(),
            vec!["new".to_string(), "old".to_string()]
        );

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn deletes_all_failed_jobs_with_the_same_url() {
        let (db, db_path) = test_db();
        for (id, url, filename, status) in [
            (
                "matching",
                "https://example.test/video",
                "video.mp4",
                "failed",
            ),
            (
                "other-url",
                "https://example.test/other",
                "video.mp4",
                "failed",
            ),
            (
                "other-name",
                "https://example.test/video",
                "other.mp4",
                "failed",
            ),
            (
                "active",
                "https://example.test/video",
                "video.mp4",
                "running",
            ),
            (
                "completed",
                "https://example.test/video",
                "video.mp4",
                "completed",
            ),
        ] {
            create_job(&db, id, url, "source", filename, "[]", "", 5, 30, 1).unwrap();
            db.execute(
                "UPDATE download_jobs SET status = ?2 WHERE id = ?1",
                params![id, status],
            )
            .unwrap();
        }
        db.execute(
            "INSERT INTO download_job_parts
             (job_id, part_index, start_byte, end_byte, part_path, status, updated_at)
             VALUES ('matching', 0, 0, 9, '/tmp/part', 'failed', 1)",
            [],
        )
        .unwrap();

        assert_eq!(
            delete_failed_duplicates(&db, "video.mp4", "https://example.test/video/").unwrap(),
            2
        );
        assert!(get_job(&db, "matching").unwrap().is_none());
        assert!(get_job(&db, "other-name").unwrap().is_none());
        assert!(get_job_parts(&db, "matching").unwrap().is_empty());
        for id in ["other-url", "active", "completed"] {
            assert!(get_job(&db, id).unwrap().is_some(), "{id} should remain");
        }

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn persists_vpn_location() {
        let (db, db_path) = test_db();
        assert_eq!(load_vpn_location(&db).unwrap(), None);

        save_vpn_location(&db, "Hong Kong").unwrap();
        assert_eq!(
            load_vpn_location(&db).unwrap(),
            Some("Hong Kong".to_string())
        );

        save_vpn_location(&db, "Tokyo").unwrap();
        assert_eq!(load_vpn_location(&db).unwrap(), Some("Tokyo".to_string()));

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn persists_browser_hls_level() {
        let (db, db_path) = test_db();
        assert_eq!(load_browser_hls_level(&db).unwrap(), None);

        save_browser_hls_level(&db, 3).unwrap();
        assert_eq!(load_browser_hls_level(&db).unwrap(), Some(3));

        save_browser_hls_level(&db, 1).unwrap();
        assert_eq!(load_browser_hls_level(&db).unwrap(), Some(1));

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn persists_max_concurrent_jobs() {
        let (db, db_path) = test_db();
        assert_eq!(load_max_concurrent_jobs(&db).unwrap(), None);

        save_max_concurrent_jobs(&db, 7).unwrap();
        assert_eq!(load_max_concurrent_jobs(&db).unwrap(), Some(7));

        save_max_concurrent_jobs(&db, 20).unwrap();
        assert_eq!(load_max_concurrent_jobs(&db).unwrap(), Some(10));

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn persists_concurrency_mode() {
        let (db, db_path) = test_db();
        assert_eq!(load_concurrency_mode(&db).unwrap(), None);

        save_concurrency_mode(&db, ConcurrencyMode::Global).unwrap();
        assert_eq!(
            load_concurrency_mode(&db).unwrap(),
            Some(ConcurrencyMode::Global)
        );

        save_concurrency_mode(&db, ConcurrencyMode::SrcDomain).unwrap();
        assert_eq!(
            load_concurrency_mode(&db).unwrap(),
            Some(ConcurrencyMode::SrcDomain)
        );

        save_concurrency_mode(&db, ConcurrencyMode::UrlDomain).unwrap();
        assert_eq!(
            load_concurrency_mode(&db).unwrap(),
            Some(ConcurrencyMode::UrlDomain)
        );

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn parses_src_url_domain() {
        assert_eq!(
            src_url_domain("https://cdn.example.com:443/a.m3u8?x=1"),
            "cdn.example.com"
        );
        assert_eq!(src_url_domain("recordplay.biz/e/abc"), "recordplay.biz");
        assert_eq!(src_url_domain(""), "");
    }

    #[test]
        fn finalizing_jobs_do_not_use_download_slots() {
        let (db, db_path) = test_db();
        for (id, status) in [
            ("running", "running"),
            ("finalizing", "finalizing"),
            ("assembling", "assembling"),
            ("remuxing", "remuxing"),
        ] {
            create_job(&db, id, "url", "source", "video.mp4", "[]", "", 5, 30, 1).unwrap();
            db.execute(
                "UPDATE download_jobs SET status = ?2 WHERE id = ?1",
                params![id, status],
            )
            .unwrap();
        }

        assert_eq!(count_active_jobs(&db).unwrap(), 1);

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn requeues_newest_running_jobs_when_limit_shrinks() {
        let (db, db_path) = test_db();
        for index in 1..=10 {
            let id = format!("job-{index}");
            create_job(&db, &id, "url", "source", "video.mp4", "[]", "", 5, 30, 1).unwrap();
            db.execute(
                "UPDATE download_jobs
                 SET status = 'running', started_at = ?2, downloaded_bytes = ?2
                 WHERE id = ?1",
                params![id, index],
            )
            .unwrap();
        }
        let ids = requeue_excess_running_jobs(&db, 3, 20, ConcurrencyMode::Global).unwrap();

        assert_eq!(ids.len(), 7);
        assert_eq!(ids.first().map(String::as_str), Some("job-10"));
        assert_eq!(ids.last().map(String::as_str), Some("job-4"));
        assert_eq!(count_active_jobs(&db).unwrap(), 3);
        for index in 1..=3 {
            assert_eq!(
                get_job(&db, &format!("job-{index}"))
                    .unwrap()
                    .unwrap()
                    .status,
                "running"
            );
        }
        for index in 4..=10 {
            let job = get_job(&db, &format!("job-{index}")).unwrap().unwrap();
            assert_eq!(job.status, "queued");
            assert_eq!(job.downloaded_bytes, index);
        }

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn requeues_newest_running_jobs_per_src_domain() {
        let (db, db_path) = test_db();
        for index in 1..=4 {
            let id = format!("a-{index}");
            create_job(
                &db,
                &id,
                "url",
                "https://a.example/video.mp4",
                "a.mp4",
                "[]",
                "",
                5,
                30,
                1,
            )
            .unwrap();
            db.execute(
                "UPDATE download_jobs SET status = 'running', started_at = ?2 WHERE id = ?1",
                params![id, index],
            )
            .unwrap();
        }
        for index in 1..=2 {
            let id = format!("b-{index}");
            create_job(
                &db,
                &id,
                "url",
                "https://b.example/video.mp4",
                "b.mp4",
                "[]",
                "",
                5,
                30,
                1,
            )
            .unwrap();
            db.execute(
                "UPDATE download_jobs SET status = 'running', started_at = ?2 WHERE id = ?1",
                params![id, index + 10],
            )
            .unwrap();
        }
        let ids = requeue_excess_running_jobs(&db, 3, 50, ConcurrencyMode::SrcDomain).unwrap();
        assert_eq!(ids, vec!["a-4".to_string()]);
        assert_eq!(count_active_jobs(&db).unwrap(), 5);
        assert_eq!(get_job(&db, "a-4").unwrap().unwrap().status, "queued");
        assert_eq!(get_job(&db, "a-1").unwrap().unwrap().status, "running");
        assert_eq!(get_job(&db, "b-2").unwrap().unwrap().status, "running");

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn requeues_newest_running_jobs_per_url_domain() {
        let (db, db_path) = test_db();
        for index in 1..=4 {
            let id = format!("a-{index}");
            create_job(
                &db,
                &id,
                "https://a.example/video.mp4",
                "https://page.example/a",
                "a.mp4",
                "[]",
                "",
                5,
                30,
                1,
            )
            .unwrap();
            db.execute(
                "UPDATE download_jobs SET status = 'running', started_at = ?2 WHERE id = ?1",
                params![id, index],
            )
            .unwrap();
        }
        for index in 1..=2 {
            let id = format!("b-{index}");
            create_job(
                &db,
                &id,
                "https://b.example/video.mp4",
                "https://page.example/b",
                "b.mp4",
                "[]",
                "",
                5,
                30,
                1,
            )
            .unwrap();
            db.execute(
                "UPDATE download_jobs SET status = 'running', started_at = ?2 WHERE id = ?1",
                params![id, index + 10],
            )
            .unwrap();
        }
        let ids = requeue_excess_running_jobs(&db, 3, 50, ConcurrencyMode::UrlDomain).unwrap();
        assert_eq!(ids, vec!["a-4".to_string()]);
        assert_eq!(count_active_jobs(&db).unwrap(), 5);
        assert_eq!(get_job(&db, "a-4").unwrap().unwrap().status, "queued");
        assert_eq!(get_job(&db, "a-1").unwrap().unwrap().status, "running");
        assert_eq!(get_job(&db, "b-2").unwrap().unwrap().status, "running");

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn stalled_running_jobs_wait_before_retrying() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "stalled",
            "url",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'running', updated_at = 10 WHERE id = 'stalled'",
            [],
        )
        .unwrap();

        assert_eq!(
            requeue_stalled_running_jobs(&db, 20, 100).unwrap(),
            vec!["stalled"]
        );
        let job = get_job(&db, "stalled").unwrap().unwrap();
        assert_eq!(job.status, "retry_wait");
        assert_eq!(job.retry_count, 0);
        assert_eq!(job.next_retry_at, 130);
        assert_eq!(count_active_jobs(&db).unwrap(), 0);

        drop(db);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn resource_pause_preserves_retry_budget_and_resumes_jobs() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "disk",
            "page",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'running', retry_count = 2 WHERE id = 'disk'",
            [],
        )
        .unwrap();

        assert_eq!(pause_jobs_for_resource(&db, "disk full", 10).unwrap(), 1);
        let paused = get_job(&db, "disk").unwrap().unwrap();
        assert_eq!(paused.status, "resource_wait");
        assert_eq!(paused.retry_count, 2);
        assert_eq!(paused.last_error, "disk full");

        assert_eq!(resume_resource_wait_jobs(&db, 20).unwrap(), 1);
        let resumed = get_job(&db, "disk").unwrap().unwrap();
        assert_eq!(resumed.status, "queued");
        assert_eq!(resumed.retry_count, 2);
        assert!(resumed.last_error.is_empty());

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn job_manager_can_restore_resource_pause_from_database() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "disk",
            "page",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        pause_jobs_for_resource(&db, "disk full", 2).unwrap();

        assert!(has_resource_wait_jobs(&db).unwrap());

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn resource_wait_job_can_be_cancelled() {
        let (db, db_path) = test_db();
        create_job(
            &db,
            "disk",
            "page",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        pause_jobs_for_resource(&db, "disk full", 2).unwrap();

        assert!(cancel_job(&db, "disk", 3).unwrap());
        let job = get_job(&db, "disk").unwrap().unwrap();
        assert_eq!(job.status, "cancelled");

        drop(db);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn retrying_hls_restores_progress_from_existing_segments() {
        let (db, db_path) = test_db();
        let temp_dir =
            std::env::temp_dir().join(format!("stash-hls-retry-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("segment-000000.ts"), vec![1; 11]).unwrap();
        std::fs::write(temp_dir.join("segment-000001.ts"), vec![2; 13]).unwrap();
        std::fs::write(temp_dir.join("segment-000002.ts"), Vec::<u8>::new()).unwrap();
        create_job(
            &db,
            "hls-job",
            "page",
            "https://cdn.example/video.m3u8",
            "video.mp4",
            "[]",
            &temp_dir.display().to_string(),
            5,
            30,
            1,
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs
             SET status = 'failed', downloaded_bytes = 0, uploaded_segments = 0, total_segments = 5
             WHERE id = 'hls-job'",
            [],
        )
        .unwrap();

        assert!(retry_job(&db, "hls-job", 2).unwrap());
        let job = get_job(&db, "hls-job").unwrap().unwrap();
        assert_eq!(job.status, "queued");
        assert_eq!(job.downloaded_bytes, 24);
        assert_eq!(job.uploaded_segments, 2);
        assert_eq!(job.total_segments, 5);
        assert_eq!(job.to_response().uploaded_segments, Some(2));

        drop(db);
        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn retrying_file_clears_listing_but_keeps_existing_file() {
        let (db, db_path) = test_db();
        let file_path = std::env::temp_dir().join(format!(
            "stash-retry-file-test-{}.mp4",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&file_path, vec![0; MIN_COMPLETED_FILE_BYTES as usize]).unwrap();
        create_job(
            &db,
            "job",
            "page",
            "source",
            "video.mp4",
            "[]",
            "",
            5,
            30,
            1,
        )
        .unwrap();
        complete_job(
            &db,
            "job",
            &file_path.display().to_string(),
            MIN_COMPLETED_FILE_BYTES,
            2,
        )
        .unwrap();
        mark_download(&db, &file_path, Some("page"), Some("source"), None).unwrap();

        assert!(retry_file_job(&db, "job", 3).unwrap());
        assert!(list_downloaded(&db, None, 10).unwrap().is_empty());
        assert!(file_path.exists());
        assert!(get_job(&db, "job").unwrap().unwrap().file_path.is_empty());

        drop(db);
        let _ = std::fs::remove_file(file_path);
        let _ = std::fs::remove_file(db_path);
    }
}
