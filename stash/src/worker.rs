use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tracing::{info, warn};

use crate::config::AppConfig;
use crate::downloads::JobManager;
use crate::store::JobRow;

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct WorkerTab {
    target_id: String,
    session_id: String,
}

struct BrowserTarget {
    target_id: String,
    title: String,
    url: String,
    target_type: String,
}

pub async fn run_browser_hls_worker(jobs: Arc<JobManager>, cfg: AppConfig) {
    let poll = Duration::from_secs(cfg.browser_hls.stale_check_interval_secs);
    let mut ws: Option<(Ws, Arc<AtomicU64>)> = None;
    let mut tabs: HashMap<String, WorkerTab> = HashMap::new();
    info!("browser-hls worker: started");

    loop {
        actix_web::rt::time::sleep(poll).await;

        let stale = jobs
            .stale_browser_hls_cleanup(
                cfg.browser_hls.stale_timeout_secs,
                cfg.browser_hls.max_restart_attempts,
            )
            .await;
        if stale > 0 {
            info!("browser-hls stale cleanup: {stale} jobs marked stale");
        }

        let desired_urls: Vec<String> = jobs
            .list_jobs(50)
            .await
            .into_iter()
            .filter(is_active_browser_hls_job)
            .map(|job| job.url)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        if desired_urls.is_empty() {
            if let Some((ws_stream, msg_id)) = ws.as_mut() {
                for (_, tab) in tabs.drain() {
                    let _ = close_target(ws_stream, msg_id, &tab.target_id).await;
                }
            }
            continue;
        }

        if ws.is_none() {
            match connect_browser(&cfg.browser_hls.worker_cdp_url).await {
                Ok(conn) => {
                    info!("browser-hls worker: CDP connected");
                    ws = Some(conn);
                }
                Err(error) => {
                    warn!("browser-hls worker: CDP connect failed: {error}");
                    continue;
                }
            }
        }

        let Some((ws_stream, msg_id)) = ws.as_mut() else {
            continue;
        };

        if let Err(error) = reconcile_worker_tabs(ws_stream, msg_id, &mut tabs, &desired_urls).await
        {
            warn!("browser-hls worker: reconcile failed: {error}");
            for (_, tab) in tabs.drain() {
                let _ = close_target(ws_stream, msg_id, &tab.target_id).await;
            }
            ws = None;
            continue;
        }

        let desired_set: HashSet<&str> = desired_urls.iter().map(String::as_str).collect();
        let stale_urls: Vec<String> = tabs
            .keys()
            .filter(|url| !desired_set.contains(url.as_str()))
            .cloned()
            .collect();
        for url in stale_urls {
            if let Some(tab) = tabs.remove(&url) {
                let _ = close_target(ws_stream, msg_id, &tab.target_id).await;
                info!("browser-hls worker: closed worker tab for {url}");
            }
        }

        let mut reset_connection = false;
        for desired_url in desired_urls {
            match ensure_worker_tab(ws_stream, msg_id, tabs.get_mut(&desired_url), &desired_url)
                .await
            {
                Ok(Some(tab)) => {
                    tabs.insert(desired_url, tab);
                }
                Ok(None) => {}
                Err(error) => {
                    warn!(
                        "browser-hls worker: failed to ensure tab for {}: {}",
                        desired_url, error
                    );
                    if let Some(tab) = tabs.remove(&desired_url) {
                        let _ = close_target(ws_stream, msg_id, &tab.target_id).await;
                    }
                    reset_connection = true;
                    break;
                }
            }
        }

        if reset_connection {
            for (_, tab) in tabs.drain() {
                let _ = close_target(ws_stream, msg_id, &tab.target_id).await;
            }
            ws = None;
        }
    }
}

fn is_active_browser_hls_job(job: &JobRow) -> bool {
    matches!(job.status.as_str(), "running" | "queued" | "retry_wait")
        && job.is_browser_hls()
        && job.retry_count < 3
}

async fn connect_browser(cdp_url: &str) -> Result<(Ws, Arc<AtomicU64>), String> {
    let resp: serde_json::Value =
        reqwest::get(format!("{}/json/version", cdp_url.trim_end_matches('/')))
            .await
            .map_err(|e| format!("json/version: {e}"))?
            .json()
            .await
            .map_err(|e| format!("parse json/version: {e}"))?;
    let browser_ws = resp["webSocketDebuggerUrl"]
        .as_str()
        .ok_or_else(|| "no webSocketDebuggerUrl".to_string())?;
    let (ws, _) = connect_async(browser_ws)
        .await
        .map_err(|e| format!("connect ws: {e}"))?;
    Ok((ws, Arc::new(AtomicU64::new(1))))
}

async fn reconcile_worker_tabs(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    tabs: &mut HashMap<String, WorkerTab>,
    desired_urls: &[String],
) -> Result<(), String> {
    let targets = list_browser_targets(ws, msg_id).await?;
    let target_ids: HashSet<&str> = targets
        .iter()
        .map(|target| target.target_id.as_str())
        .collect();
    tabs.retain(|_, tab| target_ids.contains(tab.target_id.as_str()));

    let desired_set: HashSet<&str> = desired_urls.iter().map(String::as_str).collect();
    let worker_targets: Vec<BrowserTarget> =
        targets.into_iter().filter(is_worker_page_target).collect();

    let mut adopted_urls = HashSet::new();
    for target in &worker_targets {
        if !desired_set.contains(target.url.as_str()) {
            info!(
                "browser-hls worker: closing stale worker tab {} ({})",
                target.url, target.target_id
            );
            let _ = close_target(ws, msg_id, &target.target_id).await;
            continue;
        }

        if let Some(tab) = tabs.get(target.url.as_str()) {
            if tab.target_id != target.target_id {
                info!(
                    "browser-hls worker: closing duplicate worker tab {} ({})",
                    target.url, target.target_id
                );
                let _ = close_target(ws, msg_id, &target.target_id).await;
            }
            continue;
        }

        if adopted_urls.contains(target.url.as_str()) {
            info!(
                "browser-hls worker: closing extra adopted worker tab {} ({})",
                target.url, target.target_id
            );
            let _ = close_target(ws, msg_id, &target.target_id).await;
            continue;
        }

        let tab = attach_worker_tab(ws, msg_id, &target.target_id).await?;
        info!(
            "browser-hls worker: adopted existing worker tab for {}",
            target.url
        );
        tabs.insert(target.url.clone(), tab);
        adopted_urls.insert(target.url.as_str().to_string());
    }

    Ok(())
}

async fn list_browser_targets(
    ws: &mut Ws,
    msg_id: &AtomicU64,
) -> Result<Vec<BrowserTarget>, String> {
    let result = send_cmd(ws, msg_id, "Target.getTargets", serde_json::json!({})).await?;
    let infos = result["targetInfos"]
        .as_array()
        .ok_or_else(|| "Target.getTargets missing targetInfos".to_string())?;
    let mut targets = Vec::with_capacity(infos.len());
    for info in infos {
        let target_id = info["targetId"]
            .as_str()
            .ok_or_else(|| "targetInfo missing targetId".to_string())?;
        let target_type = info["type"].as_str().unwrap_or("");
        let title = info["title"].as_str().unwrap_or("");
        let url = info["url"].as_str().unwrap_or("");
        targets.push(BrowserTarget {
            target_id: target_id.to_string(),
            title: title.to_string(),
            url: url.to_string(),
            target_type: target_type.to_string(),
        });
    }
    Ok(targets)
}

fn is_worker_page_target(target: &BrowserTarget) -> bool {
    target.target_type == "page"
        && (target.title == "stash worker" || target.title.starts_with("stash worker:"))
}

async fn attach_worker_tab(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    target_id: &str,
) -> Result<WorkerTab, String> {
    let attached = send_cmd(
        ws,
        msg_id,
        "Target.attachToTarget",
        serde_json::json!({
            "targetId": target_id,
            "flatten": true,
        }),
    )
    .await?;
    let session = attached["sessionId"]
        .as_str()
        .ok_or_else(|| "attachToTarget missing sessionId".to_string())?
        .to_string();

    send_session_cmd(ws, msg_id, &session, "Page.enable", serde_json::json!({})).await?;
    send_session_cmd(
        ws,
        msg_id,
        &session,
        "Runtime.enable",
        serde_json::json!({}),
    )
    .await?;
    send_session_cmd(
        ws,
        msg_id,
        &session,
        "Page.addScriptToEvaluateOnNewDocument",
        serde_json::json!({
            "source": "try { sessionStorage.setItem('__stash_worker', '1'); } catch (_) {}",
        }),
    )
    .await?;

    Ok(WorkerTab {
        target_id: target_id.to_string(),
        session_id: session,
    })
}

async fn ensure_worker_tab(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    tab: Option<&mut WorkerTab>,
    desired_url: &str,
) -> Result<Option<WorkerTab>, String> {
    if let Some(tab) = tab {
        if let Ok(current_url) = current_url(ws, msg_id, &tab.session_id).await {
            if current_url == desired_url {
                return Ok(None);
            }
            info!("browser-hls worker: navigating existing tab to {desired_url}");
            navigate(ws, msg_id, &tab.session_id, desired_url).await?;
            return Ok(None);
        }
    }

    let created = send_cmd(
        ws,
        msg_id,
        "Target.createTarget",
        serde_json::json!({
            "url": desired_url,
        }),
    )
    .await?;
    let target = created["targetId"]
        .as_str()
        .ok_or_else(|| "createTarget missing targetId".to_string())?
        .to_string();

    let WorkerTab {
        session_id: session,
        ..
    } = attach_worker_tab(ws, msg_id, &target).await?;
    navigate(ws, msg_id, &session, desired_url).await?;

    info!("browser-hls worker: opened worker tab at {desired_url}");
    Ok(Some(WorkerTab {
        target_id: target,
        session_id: session,
    }))
}

async fn current_url(ws: &mut Ws, msg_id: &AtomicU64, session_id: &str) -> Result<String, String> {
    let result = send_session_cmd(
        ws,
        msg_id,
        session_id,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": "window.location.href",
            "returnByValue": true,
            "awaitPromise": false,
        }),
    )
    .await?;
    result["result"]["value"]
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "missing window.location.href".to_string())
}

async fn navigate(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    session_id: &str,
    url: &str,
) -> Result<(), String> {
    send_session_cmd(
        ws,
        msg_id,
        session_id,
        "Page.navigate",
        serde_json::json!({ "url": url }),
    )
    .await?;
    Ok(())
}

async fn close_target(ws: &mut Ws, msg_id: &AtomicU64, target_id: &str) -> Result<(), String> {
    send_cmd(
        ws,
        msg_id,
        "Target.closeTarget",
        serde_json::json!({ "targetId": target_id }),
    )
    .await?;
    Ok(())
}

async fn send_cmd(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = msg_id.fetch_add(1, Ordering::Relaxed);
    let cmd = serde_json::json!({
        "id": id,
        "method": method,
        "params": params,
    });
    ws.send(Message::Text(serde_json::to_string(&cmd).unwrap().into()))
        .await
        .map_err(|e| format!("send {method}: {e}"))?;

    loop {
        let msg = ws
            .next()
            .await
            .ok_or_else(|| format!("{method}: connection closed"))?
            .map_err(|e| format!("recv {method}: {e}"))?;
        if let Message::Text(text) = msg {
            let val: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("parse {method}: {e}"))?;
            if val.get("id").and_then(|v| v.as_i64()) == Some(id as i64) {
                if let Some(error) = val.get("error") {
                    return Err(format!("{method}: {error}"));
                }
                return Ok(val
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null));
            }
        }
    }
}

async fn send_session_cmd(
    ws: &mut Ws,
    msg_id: &AtomicU64,
    session_id: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = msg_id.fetch_add(1, Ordering::Relaxed);
    let cmd = serde_json::json!({
        "id": id,
        "sessionId": session_id,
        "method": method,
        "params": params,
    });
    ws.send(Message::Text(serde_json::to_string(&cmd).unwrap().into()))
        .await
        .map_err(|e| format!("send {method}: {e}"))?;

    loop {
        let msg = ws
            .next()
            .await
            .ok_or_else(|| format!("{method}: connection closed"))?
            .map_err(|e| format!("recv {method}: {e}"))?;
        if let Message::Text(text) = msg {
            let val: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("parse {method}: {e}"))?;
            if val.get("id").and_then(|v| v.as_i64()) == Some(id as i64) {
                if let Some(error) = val.get("error") {
                    return Err(format!("{method}: {error}"));
                }
                return Ok(val
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null));
            }
        }
    }
}
