mod config;
mod downloads;
mod hls;
mod store;
mod web;
mod worker;

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use actix_web::{App, HttpResponse, HttpServer, ResponseError, web as aw};
use futures_util::StreamExt;
use rusqlite::Connection;
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

use config::AppConfig;
use downloads::JobManager;

struct AppState {
    config: AppConfig,
    vpn: Arc<RwLock<config::VpnConfig>>,
    db: StdMutex<Connection>,
    jobs: Arc<JobManager>,
    web: web::WebAssets,
    browser_hls_level: AtomicU8,
    max_concurrent_jobs: Arc<AtomicUsize>,
    concurrency_mode: Arc<AtomicU8>,
}

const DEFAULT_BROWSER_HLS_LEVEL: u8 = 1;

#[derive(Deserialize)]
struct SearchReq {
    query: String,
    under: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct CheckReq {
    path: String,
}

#[derive(Deserialize)]
struct MarkReq {
    path: String,
    url: Option<String>,
    src_url: Option<String>,
    note: Option<String>,
}

#[derive(Deserialize)]
struct JobReq {
    url: String,
    src_url: String,
    filename: Option<String>,
    referer: Option<String>,
    origin: Option<String>,
    headers: Option<Vec<HeaderPair>>,
}

#[derive(Deserialize)]
struct BrowserHlsReq {
    url: String,
    src_url: String,
    filename: String,
    segment_count: Option<usize>,
}

#[derive(serde::Deserialize)]
struct BrowserHlsRefreshReq {
    src_url: String,
    referer: Option<String>,
    origin: Option<String>,
}

#[derive(Deserialize)]
struct BrowserHlsSettingsReq {
    level: u8,
}

#[derive(Deserialize)]
struct SchedulerSettingsReq {
    max_concurrent_jobs: usize,
    concurrency_mode: Option<String>,
}

#[derive(Deserialize)]
struct CompleteBrowserHlsQuery {
    segment_total: Option<usize>,
}

fn browser_hls_concurrency(level: u8) -> u8 {
    match level.clamp(1, 3) {
        1 => 1,
        2 => 3,
        _ => 6,
    }
}

fn browser_hls_settings_json(level: u8) -> serde_json::Value {
    let level = level.clamp(1, 3);
    serde_json::json!({
        "level": level,
        "concurrency": browser_hls_concurrency(level),
    })
}

#[derive(Deserialize, Clone)]
struct HeaderPair {
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct ListJobsQuery {
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct ListFilesQuery {
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct PageStatusQuery {
    url: String,
}

#[derive(Deserialize)]
struct PageStatusesReq {
    urls: Vec<String>,
}

#[derive(Debug)]
struct HttpError {
    status: actix_web::http::StatusCode,
    message: String,
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.status.as_u16(), self.message)
    }
}

impl ResponseError for HttpError {
    fn status_code(&self) -> actix_web::http::StatusCode {
        self.status
    }
    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status).json(serde_json::json!({ "error": &self.message }))
    }
}

fn bad_request(msg: &str) -> HttpError {
    HttpError {
        status: actix_web::http::StatusCode::BAD_REQUEST,
        message: msg.into(),
    }
}

fn unavailable(msg: &str) -> HttpError {
    HttpError {
        status: actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
        message: msg.into(),
    }
}

async fn health(state: aw::Data<AppState>) -> HttpResponse {
    let vpn_config = state.vpn.read().await.clone();
    let vpn = downloads::check_status(&vpn_config).await;
    let (vpn_ok, vpn_loc) = match vpn {
        Ok(s) => (s.connected, s.location),
        Err(_) => (false, String::new()),
    };
    let db_ok = state.db.lock().is_ok();
    HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "bind": state.config.bind,
        "download_root": state.config.download_root.display().to_string(),
        "sqlite_path": state.config.sqlite_path.display().to_string(),
        "allowed_roots": state.config.allowed_roots.iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
        "vpn_connected": vpn_ok,
        "vpn_location": vpn_loc,
        "database_ok": db_ok,
        "downloads_paused": state.jobs.is_resource_paused(),
        "available_space_bytes": state.jobs.available_space(),
        "disk_pause_below_bytes": state.config.scheduler.disk_pause_below_bytes,
        "disk_resume_above_bytes": state.config.scheduler.disk_resume_above_bytes,
    }))
}

async fn search(
    state: aw::Data<AppState>,
    body: aw::Json<SearchReq>,
) -> Result<HttpResponse, HttpError> {
    let db = state
        .db
        .lock()
        .map_err(|_| unavailable("db lock poisoned"))?;
    let limit = body.limit.unwrap_or(state.config.max_results);
    store::search(
        &state.config,
        &db,
        &body.query,
        body.under.as_deref(),
        limit,
    )
    .map(|r| HttpResponse::Ok().json(r))
    .map_err(|e| bad_request(&e))
}

async fn check(
    state: aw::Data<AppState>,
    body: aw::Json<CheckReq>,
) -> Result<HttpResponse, HttpError> {
    let db = state
        .db
        .lock()
        .map_err(|_| unavailable("db lock poisoned"))?;
    store::check(&state.config, &db, &body.path)
        .map(|r| HttpResponse::Ok().json(r))
        .map_err(|e| bad_request(&e))
}

async fn mark(
    state: aw::Data<AppState>,
    body: aw::Json<MarkReq>,
) -> Result<HttpResponse, HttpError> {
    let db = state
        .db
        .lock()
        .map_err(|_| unavailable("db lock poisoned"))?;
    let path =
        store::resolve_requested_path(&body.path, &state.config).map_err(|e| bad_request(&e.0))?;
    if !path.exists() {
        return Err(bad_request("path does not exist"));
    }
    let path = path
        .canonicalize()
        .map_err(|e| bad_request(&e.to_string()))?;
    if !path.is_file() {
        return Err(bad_request("path must point to a file"));
    }
    store::mark_download(
        &db,
        &path,
        body.url.as_deref(),
        body.src_url.as_deref(),
        body.note.as_deref(),
    )
    .map(|r| HttpResponse::Ok().json(r))
    .map_err(|e| bad_request(&e.to_string()))
}

async fn create_job(
    state: aw::Data<AppState>,
    body: aw::Json<JobReq>,
) -> Result<HttpResponse, HttpError> {
    if body.url.is_empty() {
        return Err(bad_request("url is required"));
    }
    if body.src_url.is_empty() {
        return Err(bad_request("src_url is required"));
    }
    info!("create_job: url={}, src_url={}", body.url, body.src_url);

    let vpn_config = state.vpn.read().await.clone();
    if let Err(e) = downloads::ensure_vpn(&vpn_config).await {
        warn!("VPN check failed: {e}");
        return Err(unavailable(&format!("VPN not ready: {e}")));
    }

    let mut headers: Vec<(String, String)> = body
        .headers
        .as_ref()
        .map(|h| {
            h.iter()
                .map(|p| (p.name.clone(), p.value.clone()))
                .collect()
        })
        .unwrap_or_default();
    if let Some(ref r) = body.referer {
        if !headers.iter().any(|(k, _)| k.to_lowercase() == "referer") {
            headers.push(("Referer".into(), r.clone()));
        }
    }
    if let Some(ref o) = body.origin {
        if !headers.iter().any(|(k, _)| k.to_lowercase() == "origin") {
            headers.push(("Origin".into(), o.clone()));
        }
    }

    let filename = body.filename.clone().unwrap_or_else(|| {
        let u = &body.url;
        u.split('?')
            .next()
            .unwrap_or(u)
            .split('/')
            .last()
            .filter(|s| !s.is_empty())
            .unwrap_or("download.mp4")
            .to_string()
    });

    let headers_json = serde_json::to_string(&headers).unwrap_or_else(|_| "[]".to_string());

    let removed_failed = state
        .jobs
        .delete_failed_duplicates(&filename, &body.url)
        .await;
    if removed_failed > 0 {
        info!("removed {removed_failed} failed duplicate(s) for {filename}");
    }

    // Dedup: if an active job exists for the same filename + page URL, return it silently.
    if let Some(existing) = state.jobs.find_active_duplicate(&filename, &body.url).await {
        info!(
            "dedup: returning existing job {} for {filename}",
            existing.id
        );
        return Ok(HttpResponse::Ok().json(existing.to_response()));
    }

    let job_id = Uuid::new_v4().to_string();
    let temp_dir = state.config.temp_root.join(&job_id);
    let _ = std::fs::create_dir_all(&temp_dir);

    let job_row = state
        .jobs
        .create_job(
            &job_id,
            &body.url,
            &body.src_url,
            &filename,
            &headers_json,
            &temp_dir.display().to_string(),
            state.config.retry.max_retries,
            state.config.retry.retry_interval_secs,
        )
        .await;
    info!("job created: id={job_id}, filename={filename}");

    let resp = job_row.to_response();

    Ok(HttpResponse::Created().json(resp))
}

fn sanitize_browser_filename(name: &str) -> String {
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
        "download.mp4".into()
    } else {
        safe
    }
}

fn ffmpeg_concat_entry(path: &std::path::Path) -> String {
    let escaped = path.display().to_string().replace('\'', "'\\''");
    format!("file '{}'\n", escaped)
}

async fn create_browser_hls_job(
    state: aw::Data<AppState>,
    body: aw::Json<BrowserHlsReq>,
) -> Result<HttpResponse, HttpError> {
    if body.url.is_empty() {
        return Err(bad_request("url is required"));
    }
    if body.src_url.is_empty() {
        return Err(bad_request("src_url is required"));
    }
    if body.filename.is_empty() {
        return Err(bad_request("filename is required"));
    }

    let job_id = Uuid::new_v4().to_string();
    let temp_dir = state.config.temp_root.join(&job_id);
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| bad_request(&format!("create temp dir: {e}")))?;

    let headers_json = serde_json::to_string(&serde_json::json!({
        "transport": "browser-hls",
        "segment_count": body.segment_count,
    }))
    .unwrap_or_else(|_| "{}".to_string());
    let filename = sanitize_browser_filename(&body.filename);

    let removed_failed = state
        .jobs
        .delete_failed_duplicates(&filename, &body.url)
        .await;
    if removed_failed > 0 {
        info!("removed {removed_failed} failed browser HLS duplicate(s) for {filename}");
    }

    // Dedup: if an active job exists for the same filename + page URL, return it silently.
    if let Some(existing) = state.jobs.find_active_duplicate(&filename, &body.url).await {
        info!(
            "dedup (browser HLS): returning existing job {} for {filename}",
            existing.id
        );
        return Ok(HttpResponse::Ok().json(existing.to_response()));
    }

    let job = state
        .jobs
        .create_job(
            &job_id,
            &body.url,
            &body.src_url,
            &filename,
            &headers_json,
            &temp_dir.display().to_string(),
            1,
            0,
        )
        .await;
    if let Some(sc) = body.segment_count {
        state.jobs.set_total_segments(&job_id, sc as u32).await;
    }
    state.jobs.set_job_running(&job_id).await;
    let job = state.jobs.get_job(&job_id).await.unwrap_or(job);
    info!(
        "browser HLS job created: id={job_id}, filename={filename}, url={}",
        body.url
    );

    Ok(HttpResponse::Created().json(job.to_response()))
}

async fn refresh_browser_hls_source(
    state: aw::Data<AppState>,
    path: aw::Path<String>,
    body: aw::Json<BrowserHlsRefreshReq>,
) -> Result<HttpResponse, HttpError> {
    let mut headers = Vec::new();
    if let Some(referer) = body.referer.as_ref() {
        headers.push(("Referer".to_string(), referer.clone()));
    }
    if let Some(origin) = body.origin.as_ref() {
        headers.push(("Origin".to_string(), origin.clone()));
    }
    let headers_json = serde_json::to_string(&headers).map_err(|e| bad_request(&e.to_string()))?;
    if !state
        .jobs
        .refresh_browser_hls_source(&path, &body.src_url, &headers_json)
        .await
    {
        return Err(bad_request("browser HLS job is not refreshable"));
    }
    Ok(HttpResponse::Ok().json(serde_json::json!({ "id": path.into_inner() })))
}

async fn upload_browser_hls_segment(
    state: aw::Data<AppState>,
    path: aw::Path<(String, usize)>,
    mut payload: aw::Payload,
) -> Result<HttpResponse, HttpError> {
    let (job_id, index) = path.into_inner();
    let job = state
        .jobs
        .get_job(&job_id)
        .await
        .ok_or_else(|| bad_request("job not found"))?;
    if !matches!(
        job.status.as_str(),
        "running" | "finalizing" | "assembling" | "remuxing"
    ) {
        return Err(bad_request("job is not accepting segments"));
    }
    let temp_dir = std::path::PathBuf::from(&job.temp_dir);
    if temp_dir.as_os_str().is_empty() {
        return Err(bad_request("job temp dir is empty"));
    }
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| bad_request(&format!("create temp dir: {e}")))?;

    let segment_path = temp_dir.join(format!("segment-{index:06}.ts"));
    let mut file = tokio::fs::File::create(&segment_path)
        .await
        .map_err(|e| bad_request(&format!("create segment: {e}")))?;
    let mut written = 0usize;
    while let Some(chunk) = payload.next().await {
        let chunk = chunk.map_err(|e| bad_request(&format!("read segment body: {e}")))?;
        written += chunk.len();
        file.write_all(&chunk)
            .await
            .map_err(|e| bad_request(&format!("write segment: {e}")))?;
    }
    file.flush()
        .await
        .map_err(|e| bad_request(&format!("flush segment: {e}")))?;

    let (_, downloaded, uploaded_segments) = state
        .jobs
        .record_browser_hls_segment(
            &job_id,
            index,
            written as u64,
            &segment_path.display().to_string(),
        )
        .await;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "id": job_id,
        "index": index,
        "bytes": written,
        "downloaded_bytes": downloaded,
        "uploaded_segments": uploaded_segments,
    })))
}

async fn set_browser_hls_total_segments(
    state: aw::Data<AppState>,
    path: aw::Path<String>,
    body: aw::Json<serde_json::Value>,
) -> Result<HttpResponse, HttpError> {
    let job_id = path.into_inner();
    let total = body
        .get("total_segments")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| bad_request("total_segments required"))?;
    state.jobs.set_total_segments(&job_id, total as u32).await;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "id": job_id, "total_segments": total })))
}

async fn complete_browser_hls_job(
    state: aw::Data<AppState>,
    path: aw::Path<String>,
    query: aw::Query<CompleteBrowserHlsQuery>,
) -> Result<HttpResponse, HttpError> {
    let job_id = path.into_inner();
    let job = state
        .jobs
        .get_job(&job_id)
        .await
        .ok_or_else(|| bad_request("job not found"))?;
    let temp_dir = std::path::PathBuf::from(&job.temp_dir);
    if temp_dir.as_os_str().is_empty() {
        return Err(bad_request("job temp dir is empty"));
    }

    // If the worker reports total_segments after parsing the m3u8, store it.
    if let Some(total) = query.segment_total {
        state.jobs.set_total_segments(&job_id, total as u32).await;
    }

    let mut segments: Vec<std::path::PathBuf> = std::fs::read_dir(&temp_dir)
        .map_err(|e| bad_request(&format!("read temp dir: {e}")))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("segment-"))
                .unwrap_or(false)
        })
        .collect();
    segments.sort();
    if segments.is_empty() {
        return Err(bad_request("no segments uploaded"));
    }

    // ── Finalizing: prepare concat manifest ──
    state.jobs.set_job_phase(&job_id, "prepare").await;

    let finalize_started = std::time::SystemTime::now();
    let concat_list_path = temp_dir.join("segments.ffconcat");
    let concat_list = segments
        .iter()
        .map(|segment| ffmpeg_concat_entry(segment))
        .collect::<String>();
    tokio::fs::write(&concat_list_path, concat_list)
        .await
        .map_err(|e| bad_request(&format!("write concat list: {e}")))?;

    let prepare_elapsed = finalize_started.elapsed().unwrap_or_default();

    // ── Finalizing: mux container ──
    state.jobs.set_job_phase(&job_id, "mux").await;

    let final_dir = state.config.download_root.clone();
    tokio::fs::create_dir_all(&final_dir)
        .await
        .map_err(|e| bad_request(&format!("create final dir: {e}")))?;
    let final_path =
        config::final_download_path(&state.config, &sanitize_browser_filename(&job.filename));
    let staged_path = final_dir.join(format!(
        ".{}.{}",
        job_id,
        sanitize_browser_filename(&job.filename)
    ));
    let mux_started = std::time::SystemTime::now();
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
        .arg(&staged_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Err(error) =
        downloads::run_ffmpeg_mux(&mut command, &staged_path, &job_id, &state.jobs, None).await
    {
        let msg = format!("browser HLS remux failed: {error}");
        state.jobs.fail_or_retry(&job_id, &msg, 1, 0).await;
        return Err(bad_request(&msg));
    }
    let mux_elapsed = mux_started.elapsed().unwrap_or_default();

    let staged_size = std::fs::metadata(&staged_path)
        .map_err(|e| bad_request(&format!("stat staged browser HLS file: {e}")))?
        .len();
    if !store::completed_file_size_is_valid(staged_size) {
        let msg = format!(
            "browser HLS output is too small: {staged_size} bytes (minimum {} bytes)",
            store::MIN_COMPLETED_FILE_BYTES
        );
        state.jobs.fail_or_retry(&job_id, &msg, 1, 0).await;
        state.jobs.unregister_active(&job_id).await;
        let _ = tokio::fs::remove_file(&staged_path).await;
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        return Err(bad_request(&msg));
    }

    let commit_started = std::time::SystemTime::now();
    let final_path = crate::downloads::finalize_staged_output(&staged_path, &final_path)
        .await
        .map_err(|e| bad_request(&format!("finalize browser HLS output: {e}")))?;
    let commit_elapsed = commit_started.elapsed().unwrap_or_default();
    let size = std::fs::metadata(&final_path)
        .map_err(|e| bad_request(&format!("stat final file: {e}")))?
        .len();
    let finalize_elapsed = finalize_started.elapsed().unwrap_or_default();
    state
        .jobs
        .complete_job(&job_id, &final_path.display().to_string(), size)
        .await
        .map_err(|error| bad_request(&error))?;
    state.jobs.unregister_active(&job_id).await;
    info!(
        "browser HLS job completed: id={job_id}, file={}, bytes={}, segments={}, prepare_wall={prepare_elapsed:.2?}, mux_wall={mux_elapsed:.2?}, commit_wall={commit_elapsed:.2?}, finalize_wall={finalize_elapsed:.2?}, saved_full_file_passes=2",
        final_path.display(),
        size,
        segments.len(),
    );
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "id": job_id, "status": "completed", "file_path": final_path, "bytes": size })))
}

async fn list_jobs(state: aw::Data<AppState>, query: aw::Query<ListJobsQuery>) -> HttpResponse {
    let limit = query.limit.unwrap_or(50);
    let jobs = state.jobs.list_jobs(limit).await;
    let responses: Vec<store::JobResponse> = jobs.iter().map(|j| j.to_response()).collect();
    HttpResponse::Ok().json(serde_json::json!({ "results": responses }))
}

async fn list_files(state: aw::Data<AppState>, query: aw::Query<ListFilesQuery>) -> HttpResponse {
    let limit = query.limit.unwrap_or(100);
    let files = match state.db.lock() {
        Ok(db) => store::list_downloaded(&db, None, limit).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    HttpResponse::Ok().json(serde_json::json!({ "results": files }))
}

async fn page_status(state: aw::Data<AppState>, query: aw::Query<PageStatusQuery>) -> HttpResponse {
    let url = query.url.trim();
    if url.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "url is required"
        }));
    }

    let jobs = state.jobs.list_jobs_for_url(url, 50).await;
    let files = state
        .db
        .lock()
        .ok()
        .and_then(|db| store::list_downloaded_for_url(&db, url, 50).ok())
        .unwrap_or_default();
    let responses: Vec<store::JobResponse> = jobs
        .iter()
        .map(|job| job.to_response_without_file_check())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "jobs": responses,
        "files": files,
    }))
}

async fn page_statuses(state: aw::Data<AppState>, body: aw::Json<PageStatusesReq>) -> HttpResponse {
    let urls: Vec<String> = body
        .urls
        .iter()
        .filter(|url| !url.is_empty())
        .take(200)
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if urls.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "urls are required"
        }));
    }

    let mut results = serde_json::Map::new();
    for url in urls {
        let jobs = state.jobs.list_jobs_for_url(&url, 50).await;
        let files = state
            .db
            .lock()
            .ok()
            .and_then(|db| store::list_downloaded_for_url(&db, &url, 50).ok())
            .unwrap_or_default();
        let responses: Vec<store::JobResponse> = jobs
            .iter()
            .map(|job| job.to_response_without_file_check())
            .collect();
        results.insert(
            url,
            serde_json::json!({ "jobs": responses, "files": files }),
        );
    }

    HttpResponse::Ok().json(serde_json::json!({ "results": results }))
}

async fn get_job(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    match state.jobs.get_job(&id).await {
        Some(job) => HttpResponse::Ok().json(job.to_response()),
        None => HttpResponse::NotFound()
            .json(serde_json::json!({ "error": format!("job {id} not found") })),
    }
}

async fn get_browser_hls_settings(state: aw::Data<AppState>) -> HttpResponse {
    let level = state.browser_hls_level.load(Ordering::Relaxed);
    HttpResponse::Ok().json(browser_hls_settings_json(level))
}

async fn set_browser_hls_settings(
    state: aw::Data<AppState>,
    body: aw::Json<BrowserHlsSettingsReq>,
) -> HttpResponse {
    let level = body.level.clamp(1, 3);
    if let Ok(db) = state.db.lock() {
        if let Err(error) = store::save_browser_hls_level(&db, level) {
            warn!("browser HLS level persistence failed: {error}");
        }
    } else {
        warn!("browser HLS level persistence failed: database lock poisoned");
    }
    state.browser_hls_level.store(level, Ordering::Relaxed);
    info!(
        "browser HLS level changed: level={}, concurrency={}",
        level,
        browser_hls_concurrency(level)
    );
    HttpResponse::Ok().json(browser_hls_settings_json(level))
}

async fn get_scheduler_settings(state: aw::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "max_concurrent_jobs": state.max_concurrent_jobs.load(Ordering::Relaxed),
        "concurrency_mode": store::ConcurrencyMode::from_u8(
            state.concurrency_mode.load(Ordering::Relaxed),
        )
        .as_str(),
        "downloads_paused": state.jobs.is_resource_paused(),
        "available_space_bytes": state.jobs.available_space(),
        "disk_pause_below_bytes": state.config.scheduler.disk_pause_below_bytes,
        "disk_resume_above_bytes": state.config.scheduler.disk_resume_above_bytes,
    }))
}

async fn set_scheduler_settings(
    state: aw::Data<AppState>,
    body: aw::Json<SchedulerSettingsReq>,
) -> HttpResponse {
    if !(3..=10).contains(&body.max_concurrent_jobs) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "max_concurrent_jobs must be between 3 and 10" }));
    }
    let mode = match body
        .concurrency_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(store::ConcurrencyMode::parse)
    {
        None => store::ConcurrencyMode::from_u8(state.concurrency_mode.load(Ordering::Relaxed)),
        Some(Some(mode)) => mode,
        Some(None) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "concurrency_mode must be src_domain, url_domain, or global"
            }));
        }
    };
    if let Ok(db) = state.db.lock() {
        if let Err(error) = store::save_max_concurrent_jobs(&db, body.max_concurrent_jobs) {
            warn!("scheduler settings persistence failed: {error}");
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "could not save scheduler settings" }));
        }
        if let Err(error) = store::save_concurrency_mode(&db, mode) {
            warn!("scheduler settings persistence failed: {error}");
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": "could not save scheduler settings" }));
        }
    } else {
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": "database lock poisoned" }));
    }
    let previous = state
        .max_concurrent_jobs
        .swap(body.max_concurrent_jobs, Ordering::Relaxed);
    let previous_mode = store::ConcurrencyMode::from_u8(
        state.concurrency_mode.swap(mode.as_u8(), Ordering::Relaxed),
    );
    let requeued = if body.max_concurrent_jobs < previous || mode != previous_mode {
        state
            .jobs
            .requeue_excess_running_jobs(body.max_concurrent_jobs, mode)
            .await
    } else {
        Vec::new()
    };
    info!(
        "max concurrent downloads changed: {} ({})",
        body.max_concurrent_jobs,
        mode.as_str()
    );
    HttpResponse::Ok().json(serde_json::json!({
        "max_concurrent_jobs": body.max_concurrent_jobs,
        "concurrency_mode": mode.as_str(),
        "requeued_jobs": requeued,
    }))
}

async fn cancel_job(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    if state.jobs.cancel_job(&id).await {
        info!("job cancelled: {id}");
        HttpResponse::Ok().json(serde_json::json!({ "id": id, "status": "cancelled" }))
    } else {
        HttpResponse::NotFound()
            .json(serde_json::json!({ "error": format!("job {id} not found or finished") }))
    }
}

async fn retry_job(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    if state.jobs.retry_job(&id).await {
        let job = state.jobs.get_job(&id).await;
        if let Some(job) = job {
            if job.is_browser_hls() {
                let started = state.jobs.set_job_running(&id).await;
                info!("job retried: {id}, transport=browser-hls, started={started}");
                let refreshed = state.jobs.get_job(&id).await.unwrap_or(job);
                HttpResponse::Ok().json(refreshed.to_response())
            } else {
                info!("job retried: {id}, transport=direct, status=queued");
                let refreshed = state.jobs.get_job(&id).await.unwrap_or(job);
                HttpResponse::Ok().json(refreshed.to_response())
            }
        } else {
            HttpResponse::NotFound()
                .json(serde_json::json!({ "error": format!("job {id} not found after retry") }))
        }
    } else {
        HttpResponse::NotFound().json(
            serde_json::json!({ "error": format!("job {id} not found or cannot be retried") }),
        )
    }
}

async fn fixture() -> HttpResponse {
    let html = include_str!("../fixtures/video-fixture.html");
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

async fn fixture_userscript() -> HttpResponse {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/easydev".to_string());
    let path = std::path::Path::new(&home)
        .join("dev/hobby/tampermonkey/projects/missav/dist/missav.user.js");
    match std::fs::read_to_string(&path) {
        Ok(us) => HttpResponse::Ok()
            .content_type("text/javascript; charset=utf-8")
            .body(us),
        Err(_) => HttpResponse::Ok()
            .content_type("text/javascript; charset=utf-8")
            .body(format!("// userscript not found at {}", path.display())),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,stash=debug".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let mut config_path = None::<String>;
    let mut port_override = None::<String>;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--port" && i + 1 < args.len() {
            port_override = Some(args[i + 1].clone());
            i += 2;
        } else if args[i].starts_with("--port=") {
            port_override = Some(args[i]["--port=".len()..].to_string());
            i += 1;
        } else if !args[i].starts_with('-') {
            config_path = Some(args[i].clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let config_path = config_path.unwrap_or_else(|| {
        format!(
            "{}/.config/stash/config.toml",
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        )
    });
    let mut cfg = config::load_config(Some(&config_path))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    if let Some(port) = port_override {
        cfg.bind = format!("127.0.0.1:{port}");
    }

    let db = store::open_db(&cfg.sqlite_path)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    match store::load_vpn_location(&db) {
        Ok(Some(location)) if !location.trim().is_empty() => {
            info!("restoring saved VPN location: {location}");
            cfg.vpn = downloads::config_for_location(&cfg.vpn, &location);
        }
        Ok(Some(_)) => warn!("ignoring empty saved VPN location"),
        Ok(None) => {}
        Err(error) => warn!("could not restore saved VPN location: {error}"),
    }
    let browser_hls_level = match store::load_browser_hls_level(&db) {
        Ok(Some(level)) => {
            info!("restoring saved browser HLS level: {level}");
            level
        }
        Ok(None) => DEFAULT_BROWSER_HLS_LEVEL,
        Err(error) => {
            warn!("could not restore saved browser HLS level: {error}");
            DEFAULT_BROWSER_HLS_LEVEL
        }
    };
    let max_concurrent_jobs = match store::load_max_concurrent_jobs(&db) {
        Ok(Some(value)) => value,
        Ok(None) => cfg.scheduler.max_concurrent_jobs.clamp(3, 10),
        Err(error) => {
            warn!("could not restore max concurrent downloads: {error}");
            cfg.scheduler.max_concurrent_jobs.clamp(3, 10)
        }
    };
    let concurrency_mode = match store::load_concurrency_mode(&db) {
        Ok(Some(mode)) => mode,
        Ok(None) => store::ConcurrencyMode::SrcDomain,
        Err(error) => {
            warn!("could not restore concurrency mode: {error}");
            store::ConcurrencyMode::SrcDomain
        }
    };
    info!(
        "stash starting: bind={}, sqlite={}, root={}",
        cfg.bind,
        cfg.sqlite_path.display(),
        cfg.download_root.display()
    );

    match downloads::ensure_vpn(&cfg.vpn).await {
        Ok(()) => info!("VPN check passed"),
        Err(e) => warn!("VPN check failed (jobs fail until connected): {e}"),
    }

    let job_db = store::open_db(&cfg.sqlite_path)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let job_manager = Arc::new(JobManager::new(job_db));
    let vpn_config = Arc::new(RwLock::new(cfg.vpn.clone()));

    match downloads::migrate_staged_files(&cfg.download_root).await {
        Ok(moved) if moved > 0 => info!("migrated {moved} legacy staged output(s)"),
        Ok(_) => {}
        Err(error) => warn!("legacy staged output migration failed: {error}"),
    }

    if cfg.scheduler.resume_on_start {
        downloads::recover_jobs(job_manager.clone(), &cfg).await;
    }

    let sched_cfg = cfg.clone();
    let sched_jobs = job_manager.clone();
    let sched_vpn = vpn_config.clone();
    let scheduler_limit = Arc::new(AtomicUsize::new(max_concurrent_jobs));
    let scheduler_mode = Arc::new(AtomicU8::new(concurrency_mode.as_u8()));
    let sched_limit = scheduler_limit.clone();
    let sched_mode = scheduler_mode.clone();
    tokio::spawn(async move {
        downloads::run_scheduler(sched_jobs, sched_cfg, sched_vpn, sched_limit, sched_mode).await;
    });

    let vpn_cfg = vpn_config.clone();
    tokio::spawn(async move {
        downloads::run_vpn_monitor(vpn_cfg).await;
    });

    // CDP-driven browser-HLS worker
    let worker_jobs = job_manager.clone();
    let worker_cfg = cfg.clone();
    actix_web::rt::spawn(async move {
        worker::run_browser_hls_worker(worker_jobs, worker_cfg).await;
    });

    let web_assets = web::load_web_assets();
    let state = aw::Data::new(AppState {
        config: cfg.clone(),
        vpn: vpn_config,
        db: StdMutex::new(db),
        jobs: job_manager,
        web: web_assets,
        browser_hls_level: AtomicU8::new(browser_hls_level),
        max_concurrent_jobs: scheduler_limit,
        concurrency_mode: scheduler_mode,
    });
    let bind = cfg.bind.clone();

    let worker_count = std::thread::available_parallelism()
        .map(|n| (n.get() * 4).clamp(16, 64))
        .unwrap_or(16);
    info!("listening on {bind}, actix_workers={worker_count}");
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/", aw::get().to(web::index))
            .route("/health", aw::get().to(health))
            .route("/ui/app.css", aw::get().to(web::app_css))
            .route("/ui/app.js", aw::get().to(web::app_js))
            .route("/ui/dev/version", aw::get().to(web::dev_version))
            .route("/ui/vendor/{path:.*}", aw::get().to(web::vendor_asset))
            .route(
                "/ui/partials/jobs-count",
                aw::get().to(web::jobs_count_partial),
            )
            .route(
                "/ui/partials/files-count",
                aw::get().to(web::files_count_partial),
            )
            .route("/ui/partials/jobs", aw::get().to(web::jobs_partial))
            .route("/ui/partials/files", aw::get().to(web::files_partial))
            .route("/ui/partials/vpn", aw::get().to(web::vpn_badge))
            .route("/ui/vpn/location", aw::post().to(web::set_vpn_location))
            .route(
                "/ui/jobs/{id}/cancel",
                aw::post().to(web::cancel_job_partial),
            )
            .route("/ui/jobs/{id}/retry", aw::post().to(web::retry_job_partial))
            .route("/ui/jobs/{id}/clear", aw::post().to(web::clear_job_partial))
            .route(
                "/ui/jobs/retry-selected",
                aw::post().to(web::retry_selected_jobs_partial),
            )
            .route(
                "/ui/jobs/retry-failed",
                aw::post().to(web::retry_failed_jobs_partial),
            )
            .route("/ui/files/retry", aw::post().to(web::retry_file_partial))
            .route(
                "/ui/jobs/clear-selected",
                aw::post().to(web::clear_selected_jobs_partial),
            )
            .route(
                "/ui/files/clear-selected",
                aw::post().to(web::clear_selected_files_partial),
            )
            .route(
                "/ui/files/delete-selected",
                aw::post().to(web::delete_selected_files_partial),
            )
            .route("/ui/files/delete", aw::post().to(web::delete_file_partial))
            .route("/stash/files", aw::get().to(list_files))
            .route("/stash/files/search", aw::post().to(search))
            .route("/stash/files/check", aw::post().to(check))
            .route("/stash/downloads/mark", aw::post().to(mark))
            .route(
                "/stash/jobs/browser-hls",
                aw::post().to(create_browser_hls_job),
            )
            .route(
                "/stash/browser-hls/settings",
                aw::get().to(get_browser_hls_settings),
            )
            .route(
                "/stash/browser-hls/settings",
                aw::post().to(set_browser_hls_settings),
            )
            .route(
                "/stash/scheduler/settings",
                aw::get().to(get_scheduler_settings),
            )
            .route(
                "/stash/scheduler/settings",
                aw::post().to(set_scheduler_settings),
            )
            .route(
                "/stash/jobs/browser-hls/{id}/segments/{index}",
                aw::put().to(upload_browser_hls_segment),
            )
            .route(
                "/stash/jobs/browser-hls/{id}/source",
                aw::put().to(refresh_browser_hls_source),
            )
            .route(
                "/stash/jobs/browser-hls/{id}/complete",
                aw::post().to(complete_browser_hls_job),
            )
            .route(
                "/stash/jobs/browser-hls/{id}/total-segments",
                aw::put().to(set_browser_hls_total_segments),
            )
            .route("/stash/jobs/static", aw::post().to(create_job))
            .route("/stash/jobs", aw::get().to(list_jobs))
            .route("/stash/page-status", aw::get().to(page_status))
            .route("/stash/page-status/batch", aw::post().to(page_statuses))
            .route("/stash/jobs/{id}", aw::get().to(get_job))
            .route("/stash/jobs/{id}/cancel", aw::post().to(cancel_job))
            .route("/stash/jobs/{id}/retry", aw::post().to(retry_job))
            .route("/stash/test/fixture", aw::get().to(fixture))
            .route(
                "/stash/test/userscript.user.js",
                aw::get().to(fixture_userscript),
            )
    })
    .workers(worker_count)
    .bind(&bind)?
    .run()
    .await
}
