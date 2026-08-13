use actix_web::{HttpResponse, web as aw};
use tracing::info;

use crate::AppState;
use crate::store;

// ── Web assets ────────────────────────────────────────────────

pub struct WebAssets {
    pub dir: std::path::PathBuf,
}

fn web_dir() -> std::path::PathBuf {
    let mut candidates = Vec::new();
    candidates.push(std::path::PathBuf::from("web"));

    if let Ok(exe) = std::env::current_exe()
        && let Some(exe_dir) = exe.parent()
    {
        candidates.push(exe_dir.join("../../web"));
        candidates.push(exe_dir.join("../web"));
        candidates.push(exe_dir.join("web"));
    }

    candidates.push(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("web"));

    for dir in candidates {
        if dir.join("index.html").is_file()
            && dir.join("app.css").is_file()
            && dir.join("app.js").is_file()
        {
            return dir;
        }
    }

    panic!("web assets directory not found from cwd, executable path, or CARGO_MANIFEST_DIR");
}

pub fn load_web_assets() -> WebAssets {
    WebAssets { dir: web_dir() }
}

pub async fn vendor_asset(path: aw::Path<String>) -> HttpResponse {
    let rel = path.into_inner();
    let base = web_dir().join("vendor");
    let full = base.join(&rel);
    let canonical = match full.canonicalize() {
        Ok(p) => p,
        Err(_) => return HttpResponse::NotFound().finish(),
    };
    let base_canonical = match base.canonicalize() {
        Ok(p) => p,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };
    if !canonical.starts_with(&base_canonical) || !canonical.is_file() {
        return HttpResponse::NotFound().finish();
    }
    let bytes = match std::fs::read(&canonical) {
        Ok(b) => b,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };
    let content_type = match canonical.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    HttpResponse::Ok()
        .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
        .content_type(content_type)
        .body(bytes)
}

// ── Helpers ───────────────────────────────────────────────────

fn fmt_size(b: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let mut v = b as f64;
    let mut i = 0;
    while v > 1024.0 && i + 1 < UNITS.len() {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{v:.0}{}", UNITS[i])
    } else {
        format!("{v:.1}{}", UNITS[i])
    }
}

fn fmt_pct(dl: u64, total: u64) -> String {
    if total == 0 {
        return "\u{2014}".into();
    }
    let pct = (dl as f64 / total as f64 * 100.0).min(100.0);
    if pct >= 99.95 {
        "100%".into()
    } else if pct >= 10.0 {
        format!("{:.0}%", pct)
    } else {
        format!("{:.1}%", pct)
    }
}

fn status_badge_class(status: &str) -> &'static str {
    match status {
        "running" => "badge-running",
        "finalizing" | "assembling" | "remuxing" => "badge-finalizing",
        "queued" => "badge-queued",
        "retry_wait" => "badge-retry_wait",
        "completed" => "badge-completed",
        "failed" => "badge-failed",
        "cancelled" => "badge-cancelled",
        _ => "",
    }
}

fn status_label(status: &str) -> &'static str {
    match status {
        "running" => "Downloading",
        "finalizing" | "assembling" | "remuxing" => "Finalizing",
        "queued" => "Queued",
        "retry_wait" => "Retrying",
        "completed" => "Completed",
        "failed" => "Failed",
        "cancelled" => "Cancelled",
        _ => "Unknown",
    }
}

fn segment_info(completed: Option<u32>, total: u32) -> String {
    let c = completed.unwrap_or(0);
    if total > 0 {
        format!(
            r#"<span class="segment-completed">{c}</span>/<span class="segment-total">{total}</span>"#
        )
    } else if completed.is_some() {
        format!(
            r#"<span class="segment-completed">{c}</span>/<span class="segment-total">?</span>"#
        )
    } else {
        "\u{2014}".into()
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn relative_time(ts: u64) -> String {
    if ts == 0 {
        return "\u{2014}".into();
    }
    let now = store::unix_now();
    let diff = now.saturating_sub(ts);
    if diff < 60 {
        format!("{diff}s ago")
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else if diff < 86400 {
        format!("{}h ago", diff / 3600)
    } else {
        format!("{}d ago", diff / 86400)
    }
}

fn parse_form_values(body: &aw::Bytes, key: &str) -> Result<Vec<String>, String> {
    serde_urlencoded::from_bytes::<Vec<(String, String)>>(body.as_ref())
        .map_err(|e| e.to_string())
        .map(|pairs| {
            pairs
                .into_iter()
                .filter_map(|(k, v)| if k == key { Some(v) } else { None })
                .collect()
        })
}

// ── Page handlers ─────────────────────────────────────────────

fn max_file_mtime(dir: &std::path::Path) -> u64 {
    let mut max = 0u64;
    for name in &["index.html", "app.css", "app.js"] {
        if let Ok(meta) = std::fs::metadata(dir.join(name)) {
            if let Ok(m) = meta.modified() {
                let ts = m
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                max = max.max(ts);
            }
        }
    }
    max
}

pub async fn index(state: aw::Data<AppState>) -> HttpResponse {
    let html = match std::fs::read_to_string(state.web.dir.join("index.html")) {
        Ok(h) => h,
        Err(_) => return HttpResponse::InternalServerError().body("index.html not found"),
    };
    let version = max_file_mtime(&state.web.dir);
    let script = format!(
        r#"<script>(function(){{var v={version};setInterval(function(){{fetch('/ui/dev/version').then(function(r){{return r.text()}}).then(function(n){{if(Number(n)!==v){{location.reload()}}}}).catch(function(){{}})}},600);}})();</script></body>"#,
        version = version,
    );
    let body = html.replace("</body>", &script);
    HttpResponse::Ok()
        .insert_header(("Cache-Control", "no-store"))
        .content_type("text/html; charset=utf-8")
        .body(body)
}

pub async fn app_css(state: aw::Data<AppState>) -> HttpResponse {
    match std::fs::read_to_string(state.web.dir.join("app.css")) {
        Ok(css) => HttpResponse::Ok()
            .insert_header(("Cache-Control", "no-store"))
            .content_type("text/css; charset=utf-8")
            .body(css),
        Err(_) => HttpResponse::InternalServerError().body("app.css not found"),
    }
}

pub async fn app_js(state: aw::Data<AppState>) -> HttpResponse {
    match std::fs::read_to_string(state.web.dir.join("app.js")) {
        Ok(js) => HttpResponse::Ok()
            .insert_header(("Cache-Control", "no-store"))
            .content_type("application/javascript; charset=utf-8")
            .body(js),
        Err(_) => HttpResponse::InternalServerError().body("app.js not found"),
    }
}

pub async fn dev_version(state: aw::Data<AppState>) -> HttpResponse {
    let v = max_file_mtime(&state.web.dir);
    HttpResponse::Ok()
        .insert_header(("Cache-Control", "no-store"))
        .content_type("text/plain; charset=utf-8")
        .body(v.to_string())
}

// ── Partial handlers ──────────────────────────────────────────

pub async fn vpn_badge(state: aw::Data<AppState>) -> HttpResponse {
    let config = state.vpn.read().await.clone();
    let (connected, location) = match crate::downloads::check_status(&config).await {
        Ok(s) => (s.connected, s.location),
        Err(_) => (false, String::new()),
    };
    let selected_location = if connected && !location.is_empty() {
        location
    } else {
        config.required_location.to_lowercase()
    };
    let locations = crate::downloads::list_locations(&config)
        .await
        .unwrap_or_default();
    let mut has_selected_location = false;
    let mut options = String::new();
    for vpn_location in locations {
        let selected = vpn_location.name.eq_ignore_ascii_case(&selected_location);
        has_selected_location |= selected;
        options.push_str(&format!(
            r#"<option value="{value}"{selected}>VPN {label}</option>"#,
            value = escape_html(&vpn_location.name),
            selected = if selected { " selected" } else { "" },
            label = escape_html(&vpn_location.label),
        ));
    }
    if !has_selected_location {
        options.push_str(&format!(
            r#"<option value="{value}" selected>VPN {value}</option>"#,
            value = escape_html(&selected_location),
        ));
    }
    let (cls, title) = if connected {
        ("connected", format!("VPN connected to {selected_location}"))
    } else {
        ("disconnected", "VPN disconnected".into())
    };
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(format!(
            r##"<select class="vpn-badge vpn-location-select {cls}" name="location" aria-label="VPN location" title="{title}" hx-post="/ui/vpn/location" hx-trigger="change" hx-target="#vpn-badge" hx-swap="innerHTML">{options}</select>"##,
            cls = cls,
            title = escape_html(&title),
            options = options,
        ))
}

#[derive(serde::Deserialize)]
pub struct VpnLocationReq {
    location: String,
}

pub async fn set_vpn_location(
    state: aw::Data<AppState>,
    body: aw::Form<VpnLocationReq>,
) -> HttpResponse {
    let config = state.vpn.read().await.clone();
    let locations = match crate::downloads::list_locations(&config).await {
        Ok(locations) => locations,
        Err(error) => {
            info!("web VPN location list error: {error}");
            return vpn_badge(state).await;
        }
    };
    let Some(location) = locations
        .into_iter()
        .find(|candidate| candidate.name.eq_ignore_ascii_case(body.location.trim()))
    else {
        info!("web VPN location rejected: {}", body.location);
        return vpn_badge(state).await;
    };

    let mut config = state.vpn.write().await;
    match crate::downloads::switch_vpn_location(&config, &location.name).await {
        Ok(updated_config) => {
            if let Ok(db) = state.db.lock() {
                if let Err(error) = store::save_vpn_location(&db, &updated_config.required_location)
                {
                    info!("web VPN location persistence failed: {error}");
                }
            } else {
                info!("web VPN location persistence failed: database lock poisoned");
            }
            info!(
                "web VPN location changed: {}",
                updated_config.required_location
            );
            *config = updated_config;
        }
        Err(error) => info!("web VPN location change failed: {error}"),
    }
    drop(config);
    vpn_badge(state).await
}

pub async fn jobs_count_partial(state: aw::Data<AppState>) -> HttpResponse {
    let count = state.jobs.list_jobs(50).await.len();
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(count.to_string())
}

pub async fn files_count_partial(state: aw::Data<AppState>) -> HttpResponse {
    let db = match state.db.lock() {
        Ok(d) => d,
        Err(_) => {
            return HttpResponse::Ok()
                .content_type("text/html; charset=utf-8")
                .body("0");
        }
    };
    let count = store::list_downloaded(&db, None, 100)
        .map(|files| files.len())
        .unwrap_or(0);
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(count.to_string())
}

pub async fn jobs_partial(state: aw::Data<AppState>) -> HttpResponse {
    let jobs = state.jobs.list_jobs(50).await;

    if jobs.is_empty() {
        return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(r#"<tr><td colspan="11" class="empty">No jobs yet</td></tr>"#);
    }

    let mut rows = String::new();
    for job in &jobs {
        let pct_text =
            if job.status == "finalizing" || job.status == "assembling" || job.status == "remuxing"
            {
                // During post-download phases the progress bar is about the file, not segments
                fmt_pct(job.downloaded_bytes, job.total_bytes)
            } else if job.status == "running" && job.is_hls() && job.total_segments > 0 {
                fmt_pct(job.uploaded_segments as u64, job.total_segments as u64)
            } else {
                fmt_pct(job.downloaded_bytes, job.total_bytes)
            };
        let can_cancel = matches!(
            job.status.as_str(),
            "running" | "queued" | "retry_wait" | "finalizing" | "assembling" | "remuxing"
        );
        let can_retry = matches!(job.status.as_str(), "completed" | "failed" | "cancelled");
        let is_terminal = matches!(job.status.as_str(), "completed" | "failed" | "cancelled");

        let size_info = fmt_size(job.downloaded_bytes);

        // Segment: completed / total for HLS, dash otherwise
        let is_hls = job.is_hls();
        let completed = if is_hls {
            Some(job.uploaded_segments)
        } else {
            None
        };
        let (segment_text, segment_title) = if is_hls {
            (segment_info(completed, job.total_segments), "")
        } else {
            (
                "\u{2014}".into(),
                r#" title="Direct download; segments do not apply""#,
            )
        };

        let restart_info = if job.retry_count > 0 && job.status == "running" && is_hls {
            format!(
                r#" <span class="badge badge-stale" title="Stale restart #{}">↻{}</span>"#,
                job.retry_count, job.retry_count
            )
        } else {
            String::new()
        };

        let error_attr = if job.last_error.is_empty() || job.last_error == "cancelled" {
            String::new()
        } else {
            format!(" title=\"{}\"", escape_html(&job.last_error))
        };

        // Client-side speed via data attributes
        let pct_sort = if job.status == "running" && is_hls && job.total_segments > 0 {
            job.uploaded_segments as f64 / job.total_segments as f64
        } else if job.total_bytes > 0 {
            job.downloaded_bytes as f64 / job.total_bytes as f64
        } else {
            0.0
        };
        let speed_attrs = format!(
            r#" data-job-id="{}" data-status="{}" data-downloaded="{}" data-updated="{}" data-sort-name="{}" data-sort-status="{}" data-sort-pct="{}" data-sort-segment="{}" data-sort-size="{}" data-sort-speed="" data-sort-url="{}" data-sort-src-url="{}" data-sort-added="{}""#,
            job.id,
            job.status,
            job.downloaded_bytes,
            job.updated_at,
            escape_html(&job.filename.to_lowercase()),
            job.status,
            pct_sort,
            job.uploaded_segments,
            job.downloaded_bytes,
            escape_html(&job.url.to_lowercase()),
            escape_html(&job.src_url.to_lowercase()),
            job.created_at,
        );

        let jt = "#jobs-list";
        let mut actions = String::new();
        if can_cancel {
            actions.push_str(&format!(
                r#"<button class="btn-icon btn-danger btn-sm" title="Cancel + Clear"
                        hx-post="/ui/jobs/{id}/cancel" hx-target="{jt}" hx-swap="innerHTML"
                        hx-confirm="Cancel and clear this job?"><i class="bi bi-x-circle"></i></button>"#,
                id = job.id, jt = jt,
            ));
        }
        if can_retry {
            actions.push_str(&format!(
                r#"<button class="btn-icon btn-primary btn-sm" title="Retry"
                        hx-post="/ui/jobs/{id}/retry" hx-target="{jt}" hx-swap="innerHTML"><i class="bi bi-arrow-clockwise"></i></button>"#,
                id = job.id, jt = jt,
            ));
        }
        if is_terminal {
            actions.push_str(&format!(
                r#"<button class="btn-icon btn-sm" title="Clear"
                        hx-post="/ui/jobs/{id}/clear" hx-target="{jt}" hx-swap="innerHTML"
                        hx-confirm="Clear this job?"><i class="bi bi-eraser"></i></button>"#,
                id = job.id,
                jt = jt,
            ));
        }

        rows.push_str(&format!(
            r#"<tr id="job-{id}"{error_attr}{speed_attrs}>
  <td class="col-select"><input type="checkbox" name="job_ids" value="{id}"></td>
  <td><div class="truncate">{name}</div></td>
  <td><span class="badge {badge}">{label}</span>{restart}</td>
  <td class="info-text">{pct}</td>
  <td class="info-text segment-cell"{segment_title}>{segment}</td>
  <td class="info-text">{size}</td>
  <td class="info-text speed-cell"></td>
  <td><div class="info-text truncate"><a href="{url}" target="_blank" rel="noopener noreferrer">{url}</a></div></td>
  <td><div class="info-text truncate">{src_url}</div></td>
  <td class="info-text">{updated}</td>
  <td class="actions-cell">{actions}</td>
</tr>"#,
            id = job.id,
            error_attr = error_attr,
            speed_attrs = speed_attrs,
            name = escape_html(&job.filename),
            badge = status_badge_class(&job.status),
            label = status_label(&job.status),
            restart = restart_info,
            pct = pct_text,
            segment = segment_text,
            segment_title = segment_title,
            size = size_info,
            url = escape_html(&job.url),
            src_url = escape_html(&job.src_url),
            updated = relative_time(job.created_at),
            actions = actions,
        ));
    }

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(rows)
}

pub async fn files_partial(state: aw::Data<AppState>) -> HttpResponse {
    let db = match state.db.lock() {
        Ok(d) => d,
        Err(_) => {
            return HttpResponse::Ok()
                .content_type("text/html; charset=utf-8")
                .body(r#"<tr><td colspan="9" class="empty" style="color:#991b1b">DB lock poisoned</td></tr>"#);
        }
    };

    let files = store::list_downloaded(&db, None, 100).unwrap_or_default();

    if files.is_empty() {
        return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(r#"<tr><td colspan="9" class="empty">No downloaded files yet</td></tr>"#);
    }

    let ft = "#files-section";
    let mut rows = String::new();
    for f in &files {
        let (badge, label) = if !f.exists {
            ("badge-failed", "Missing")
        } else if !store::completed_file_size_is_valid(f.size) {
            ("badge-failed", "Invalid")
        } else {
            ("badge-completed", "Present")
        };
        let url_display = f
            .url
            .as_deref()
            .filter(|u| !u.is_empty())
            .map(escape_html)
            .unwrap_or_else(|| "\u{2014}".to_string());
        let src_url_display = f
            .src_url
            .as_deref()
            .filter(|u| !u.is_empty())
            .map(escape_html)
            .unwrap_or_else(|| "\u{2014}".to_string());

        let retry_confirm = if f.exists {
            format!(
                r#" hx-confirm="{} already exists. Retry and replace it?""#,
                escape_html(&f.name)
            )
        } else {
            String::new()
        };
        let can_retry = f.src_url.as_deref().is_some_and(|url| !url.is_empty());
        let retry = can_retry.then(|| format!(
            r#"<button class="btn-icon btn-primary btn-sm" title="Retry {name}"
                    hx-post="/ui/files/retry" hx-vals='{{"path":"{ep}"}}'
                    hx-target="{ft}" hx-swap="innerHTML"{confirm}><i class="bi bi-arrow-clockwise"></i></button>"#,
            name = escape_html(&f.name), ep = escape_html(&f.path), ft = ft, confirm = retry_confirm,
        )).unwrap_or_default();

        rows.push_str(&format!(
            r#"<tr data-sort-name="{sort_name}" data-sort-status="{sort_status}" data-sort-size="{sort_size}" data-sort-path="{sort_path}" data-sort-url="{sort_url}" data-sort-src-url="{sort_src_url}" data-sort-time="{sort_time}">
  <td class="col-select"><input type="checkbox" name="paths" value="{ep}"></td>
  <td><div class="truncate">{name}</div></td>
  <td><span class="badge {badge}">{label}</span></td>
  <td class="info-text">{size}</td>
  <td><div class="info-text truncate">{path}</div></td>
  <td><div class="info-text truncate">{url_display}</div></td>
  <td><div class="info-text truncate">{src_url_display}</div></td>
  <td class="info-text">{time}</td>
  <td class="actions-cell">
    {retry}
    <button class="btn-icon btn-danger btn-sm" title="Delete {name}"
            hx-post="/ui/files/delete" hx-vals='{{"path":"{ep}"}}'
            hx-target="{ft}" hx-swap="innerHTML"
            hx-confirm="Delete {name}?"><i class="bi bi-trash"></i></button>
  </td>
</tr>"#,
            name = escape_html(&f.name),
            badge = badge,
            label = label,
            size = fmt_size(f.size),
            path = escape_html(&f.path),
            url_display = url_display,
            src_url_display = src_url_display,
            ep = escape_html(&f.path),
            ft = ft,
            time = relative_time(f.downloaded_at),
            retry = retry,
            sort_name = escape_html(&f.name.to_lowercase()),
            sort_status = label.to_lowercase(),
            sort_size = f.size,
            sort_path = escape_html(&f.path.to_lowercase()),
            sort_url = escape_html(&f.url.as_deref().unwrap_or("").to_lowercase()),
            sort_src_url = escape_html(&f.src_url.as_deref().unwrap_or("").to_lowercase()),
            sort_time = f.downloaded_at,
        ));
    }

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(rows)
}

pub async fn cancel_job_partial(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let cancelled = state.jobs.cancel_job(&id).await;
    if cancelled {
        info!("web cancel: {id}");
        let cleared = state.jobs.clear_job(&id).await;
        if cleared {
            info!("web clear after cancel: {id}");
        }
    }
    jobs_partial(state).await
}

async fn activate_retried_job(state: &aw::Data<AppState>, id: &str, source: &str) {
    let Some(job) = state.jobs.get_job(id).await else {
        return;
    };
    if job.is_browser_hls() {
        let started = state.jobs.set_job_running(id).await;
        info!("web retry: source={source}, id={id}, transport=browser-hls, started={started}");
    } else {
        info!("web retry: source={source}, id={id}, transport=direct");
    }
}

pub async fn retry_job_partial(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    if state.jobs.retry_job(&id).await {
        activate_retried_job(&state, &id, "jobs").await;
    }
    jobs_partial(state).await
}

pub async fn retry_selected_jobs_partial(
    state: aw::Data<AppState>,
    body: aw::Bytes,
) -> HttpResponse {
    let ids = match parse_form_values(&body, "job_ids") {
        Ok(values) => values,
        Err(error) => {
            info!("web retry selected jobs parse error: {error}");
            return jobs_partial(state).await;
        }
    };
    for id in ids {
        if state.jobs.retry_job(&id).await {
            activate_retried_job(&state, &id, "selected").await;
        }
    }
    jobs_partial(state).await
}

pub async fn retry_failed_jobs_partial(state: aw::Data<AppState>) -> HttpResponse {
    let ids = state.jobs.list_failed_job_ids().await;
    let candidate_count = ids.len();
    let mut retried = 0;
    for id in ids {
        if state.jobs.retry_job(&id).await {
            activate_retried_job(&state, &id, "failed").await;
            retried += 1;
        }
    }
    info!("web retry failed: candidates={candidate_count}, retried={retried}");
    jobs_partial(state).await
}

#[derive(serde::Deserialize)]
pub struct RetryFileReq {
    path: String,
}

pub async fn retry_file_partial(
    state: aw::Data<AppState>,
    body: aw::Form<RetryFileReq>,
) -> HttpResponse {
    let file = state.db.lock().ok().and_then(|db| {
        store::list_downloaded(&db, None, 100)
            .ok()?
            .into_iter()
            .find(|file| file.path == body.path)
    });
    let Some(file) = file else {
        return files_partial(state).await;
    };

    if let Some(id) = file.job_id.as_deref()
        && state.jobs.retry_file_job(id).await
    {
        activate_retried_job(&state, id, "files").await;
        return files_partial(state).await;
    }

    let Some(src_url) = file.src_url.as_deref().filter(|url| !url.is_empty()) else {
        return files_partial(state).await;
    };
    let vpn_config = state.vpn.read().await.clone();
    if let Err(error) = crate::downloads::ensure_vpn(&vpn_config).await {
        info!("web file retry VPN error: {error}");
        return files_partial(state).await;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let temp_dir = state.config.temp_root.join(&id);
    let _ = std::fs::create_dir_all(&temp_dir);
    state
        .jobs
        .create_job(
            &id,
            file.url.as_deref().unwrap_or(src_url),
            src_url,
            &file.name,
            "[]",
            &temp_dir.display().to_string(),
            state.config.retry.max_retries,
            state.config.retry.retry_interval_secs,
        )
        .await;
    if let Ok(db) = state.db.lock() {
        let _ = store::clear_downloaded_entries(&db, std::slice::from_ref(&file.path));
    }
    info!("web file retry: {id}, transport=direct, recreated=true");
    files_partial(state).await
}

pub async fn clear_job_partial(state: aw::Data<AppState>, path: aw::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let cleared = state.jobs.clear_job(&id).await;
    if cleared {
        info!("web clear job: {id}");
    }
    jobs_partial(state).await
}

pub async fn clear_selected_jobs_partial(
    state: aw::Data<AppState>,
    body: aw::Bytes,
) -> HttpResponse {
    let ids = match parse_form_values(&body, "job_ids") {
        Ok(v) => v,
        Err(e) => {
            info!("web clear selected jobs parse error: {e}");
            return jobs_partial(state).await;
        }
    };
    if !ids.is_empty() {
        state.jobs.clear_selected_jobs(&ids).await;
    }
    jobs_partial(state).await
}

pub async fn clear_selected_files_partial(
    state: aw::Data<AppState>,
    body: aw::Bytes,
) -> HttpResponse {
    let paths = match parse_form_values(&body, "paths") {
        Ok(v) => v,
        Err(e) => {
            info!("web clear selected files parse error: {e}");
            return files_partial(state).await;
        }
    };
    let db = match state.db.lock() {
        Ok(d) => d,
        Err(_) => return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(r#"<tr><td colspan="9" class="empty" style="color:#991b1b">DB lock poisoned</td></tr>"#),
    };
    if !paths.is_empty() {
        let _ = store::clear_downloaded_entries(&db, &paths);
    }
    drop(db);
    files_partial(state).await
}

pub async fn delete_selected_files_partial(
    state: aw::Data<AppState>,
    body: aw::Bytes,
) -> HttpResponse {
    let paths = match parse_form_values(&body, "paths") {
        Ok(v) => v,
        Err(e) => {
            info!("web delete selected files parse error: {e}");
            return files_partial(state).await;
        }
    };
    let db = match state.db.lock() {
        Ok(d) => d,
        Err(_) => return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(r#"<tr><td colspan="9" class="empty" style="color:#991b1b">DB lock poisoned</td></tr>"#),
    };
    if !paths.is_empty() {
        let _ = store::delete_downloaded_many(&db, &paths);
    }
    drop(db);
    files_partial(state).await
}

#[derive(serde::Deserialize)]
pub struct DeleteFileReq {
    path: String,
}

pub async fn delete_file_partial(
    state: aw::Data<AppState>,
    body: aw::Form<DeleteFileReq>,
) -> HttpResponse {
    let db =
        match state.db.lock() {
            Ok(d) => d,
            Err(_) => return HttpResponse::Ok()
                .content_type("text/html; charset=utf-8")
                .body(
                    r#"<tr><td colspan="9" class="empty" style="color:#991b1b">DB error</td></tr>"#,
                ),
        };
    let _ = store::delete_downloaded(&db, &body.path);
    info!("web delete: {}", body.path);
    drop(db);
    files_partial(state).await
}

#[cfg(test)]
mod tests {
    use super::parse_form_values;
    use actix_web::web::Bytes;

    #[test]
    fn parse_form_values_handles_single_value() {
        let body = Bytes::from_static(b"paths=%2Fmnt%2Fshared%2Fa.mp4");
        let values = parse_form_values(&body, "paths").unwrap();
        assert_eq!(values, vec!["/mnt/shared/a.mp4"]);
    }

    #[test]
    fn parse_form_values_handles_duplicate_keys() {
        let body =
            Bytes::from_static(b"paths=%2Fmnt%2Fshared%2Fa.mp4&paths=%2Fmnt%2Fshared%2Fb.mp4");
        let values = parse_form_values(&body, "paths").unwrap();
        assert_eq!(values, vec!["/mnt/shared/a.mp4", "/mnt/shared/b.mp4"]);
    }
}
