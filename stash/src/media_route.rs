//! Optional native media egress. No browser/CDP dependency, even on retries.
//!
//! Two transports behind one interface:
//! - `Proxy`: reqwest through the configured HTTPS proxy (unchanged behavior).
//! - `BrowserTls`: Chrome-compatible TLS via the `curl_chrome131` helper,
//!   restricted to the exact `surrit.com` origin (see [`browser_tls`]).
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, Instant};

use crate::browser_tls::{self, BrowserTls};

// Never derive Debug: this is a local credential file, not job metadata.
#[derive(Deserialize)]
struct ProxyConfig {
    url: String,
    username: String,
    password: String,
}

/// The AdGuard proxy password rotates while stash runs. A stale password makes
/// the CONNECT answer 407; the route then runs the configured sync command,
/// re-reads `media_proxy_file`, and retries the request once.
struct ProxyRoute {
    client: RwLock<reqwest::Client>,
    path: PathBuf,
    user_agent: String,
    sync_command: Vec<String>,
}

enum Transport {
    Proxy(ProxyRoute),
    BrowserTls(BrowserTls),
}

const PROXY_AUTH_REJECTED: &str = "media route proxy auth rejected";
const SYNC_MIN_INTERVAL: Duration = Duration::from_secs(60);
const SYNC_TIMEOUT: Duration = Duration::from_secs(40);
/// Serializes credential syncs process-wide; holds the last run time.
static SYNC_STATE: tokio::sync::Mutex<Option<Instant>> = tokio::sync::Mutex::const_new(None);

pub struct MediaRoute {
    transport: Transport,
}

/// Hop-by-hop, proxy-auth, and Host headers are never forwarded on any
/// transport; the connection layer owns them.
pub(crate) fn blocked_request_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "proxy-authorization"
            | "proxy-connection"
            | "content-length"
            | "transfer-encoding"
            | "range"
    )
}

impl MediaRoute {
    pub fn from_file(
        path: Option<&Path>,
        user_agent: &str,
        sync_command: &[String],
    ) -> Result<Option<Self>, String> {
        let Some(path) = path else { return Ok(None) };
        let client = proxy_client_from_file(path, user_agent)?;
        Ok(Some(Self {
            transport: Transport::Proxy(ProxyRoute {
                client: RwLock::new(client),
                path: path.to_path_buf(),
                user_agent: user_agent.to_string(),
                sync_command: sync_command.to_vec(),
            }),
        }))
    }

    /// Chrome-TLS route for the exact HTTPS origin `surrit.com`, pinned to the
    /// configured SOCKS endpoint (`socks_url`, e.g. `socks5h://host:port`,
    /// optional `user:pass@` credentials). Returns `Ok(None)` when
    /// `source_url` is not on the allowlist so callers can fall back to the
    /// normal path; `Err` only for invalid proxy/helper configuration. Secret
    /// material never appears in returned strings.
    pub fn for_browser_tls(source_url: &str, socks_url: &str) -> Result<Option<Self>, String> {
        if !browser_tls::is_allowed_source(source_url) {
            return Ok(None);
        }
        let route = BrowserTls::connect(socks_url)?;
        Ok(Some(Self {
            transport: Transport::BrowserTls(route),
        }))
    }

    pub async fn fetch_text(
        &self,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<String, String> {
        String::from_utf8(self.fetch_bytes(referer, url, headers).await?)
            .map_err(|_| "media route returned non-UTF8 playlist".into())
    }

    pub async fn fetch_bytes(
        &self,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<u8>, String> {
        match &self.transport {
            Transport::Proxy(route) => route.fetch_bytes(referer, url, headers).await,
            Transport::BrowserTls(route) => route.fetch_bytes(referer, url, headers).await,
        }
    }
}

fn proxy_client_from_file(path: &Path, user_agent: &str) -> Result<reqwest::Client, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "media proxy configuration unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() > 65536 {
        return Err("invalid media proxy configuration file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("media proxy configuration must be owner-only (0600)".into());
        }
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| "media proxy configuration unreadable".to_string())?;
    let config: ProxyConfig = serde_json::from_str(&text)
        .map_err(|_| "invalid media proxy configuration".to_string())?;
    proxy_client(config, user_agent)
}

fn proxy_client(config: ProxyConfig, user_agent: &str) -> Result<reqwest::Client, String> {
    let url = url::Url::parse(&config.url).map_err(|_| "invalid media proxy endpoint")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || config.username.is_empty()
        || config.password.is_empty()
    {
        return Err("media proxy requires HTTPS and separate credentials".into());
    }
    let proxy = reqwest::Proxy::all(url.as_str())
        .map_err(|_| "invalid media proxy endpoint")?
        .basic_auth(&config.username, &config.password);
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .user_agent(user_agent)
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(150))
        .build()
        .map_err(|_| "media proxy client initialization failed")?;
    Ok(client)
}

impl ProxyRoute {
    async fn fetch_bytes(
        &self,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<u8>, String> {
        let client = self.client.read().unwrap().clone();
        match fetch_via_proxy(&client, referer, url, headers).await {
            Err(error) if error == PROXY_AUTH_REJECTED => {
                self.refresh().await?;
                let client = self.client.read().unwrap().clone();
                fetch_via_proxy(&client, referer, url, headers).await
            }
            result => result,
        }
    }

    /// Runs the sync command at most once per [`SYNC_MIN_INTERVAL`] across all
    /// jobs, then always reloads the file: another job may have synced already.
    async fn refresh(&self) -> Result<(), String> {
        {
            let mut last_run = SYNC_STATE.lock().await;
            let due = last_run.is_none_or(|at| at.elapsed() >= SYNC_MIN_INTERVAL);
            if due && let Some((program, args)) = self.sync_command.split_first() {
                *last_run = Some(Instant::now());
                let status = tokio::time::timeout(
                    SYNC_TIMEOUT,
                    tokio::process::Command::new(program)
                        .args(args)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .kill_on_drop(true)
                        .status(),
                )
                .await;
                if !matches!(status, Ok(Ok(status)) if status.success()) {
                    tracing::warn!("media proxy credential sync failed");
                }
            }
        }
        let client = proxy_client_from_file(&self.path, &self.user_agent)
            .map_err(|_| PROXY_AUTH_REJECTED.to_string())?;
        *self.client.write().unwrap() = client;
        Ok(())
    }
}

async fn fetch_via_proxy(
    client: &reqwest::Client,
    referer: &str,
    url: &str,
    headers: &[(String, String)],
) -> Result<Vec<u8>, String> {
    let mut request = client.get(url);
    for (name, value) in headers {
        if !blocked_request_header(name) {
            request = request.header(name.as_str(), value.as_str());
        }
    }
    if !referer.is_empty() {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let response = request.send().await.map_err(|error| {
        if is_proxy_auth_error(&error) {
            PROXY_AUTH_REJECTED
        } else if error.is_timeout() {
            "media route timed out"
        } else {
            "media route connection failed"
        }
        .to_string()
    })?;
    if !response.status().is_success() {
        return Err(format!("media route: HTTP {}", response.status()));
    }
    let body = response.bytes().await.map_err(|error| {
        // Do not format reqwest errors: they may contain signed URLs.
        if error.is_timeout() {
            "media route body timed out"
        } else {
            "media route body failed"
        }
        .to_string()
    })?;
    Ok(body.to_vec())
}

/// hyper-util reports a 407 CONNECT answer as `TunnelError::ProxyAuthRequired`
/// somewhere in the source chain. Only matched, never returned: the outer
/// reqwest message may contain a signed URL.
fn is_proxy_auth_error(error: &reqwest::Error) -> bool {
    let mut source: Option<&dyn std::error::Error> = Some(error);
    while let Some(current) = source {
        if current.to_string().contains("proxy authorization required") {
            return true;
        }
        source = current.source();
    }
    false
}

pub fn referer_from_headers(headers: &[(String, String)]) -> String {
    headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("referer"))
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_route_is_disabled_and_bad_credentials_are_not_disclosed() {
        assert!(MediaRoute::from_file(None, "test", &[]).unwrap().is_none());
        let error = proxy_client(
            ProxyConfig {
                url: "http://proxy.example".into(),
                username: "private-user".into(),
                password: "private-pass".into(),
            },
            "test",
        )
        .err()
        .unwrap();
        assert!(!error.contains("private-user"));
        assert!(!error.contains("private-pass"));
        assert!(error.contains("HTTPS"));
    }
    #[tokio::test]
    async fn proxy_407_is_reported_as_auth_rejected_without_url() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 1024];
            let _ = socket.read(&mut buffer).await;
            let _ = socket
                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await;
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
            .build()
            .unwrap();
        let error = fetch_via_proxy(&client, "", "https://cdn.example/a.m3u8?t=secret", &[])
            .await
            .unwrap_err();
        assert_eq!(error, PROXY_AUTH_REJECTED);
    }
    #[test]
    fn refuses_world_readable_secret_files() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("stash-proxy-test-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let result = MediaRoute::from_file(Some(&path), "test", &[]);
        std::fs::remove_file(&path).unwrap();
        assert!(result.err().unwrap().contains("owner-only"));
    }
    #[test]
    fn browser_tls_gate_is_exact_https_surrit_host() {
        let socks = "socks5h://127.0.0.1:1080";
        assert!(MediaRoute::for_browser_tls("https://surrit.com/hls/a.m3u8", socks)
            .unwrap()
            .is_some());
        for denied in [
            "http://surrit.com/a.m3u8",
            "https://evil.com/a.m3u8",
            "https://cdn.surrit.com/a.m3u8",
            "https://surrit.com.evil.net/a.m3u8",
            "https://user:pass@surrit.com/a.m3u8",
            "https://surrit.com:8443/a.m3u8",
            "not-a-url",
        ] {
            assert!(
                MediaRoute::for_browser_tls(denied, socks).unwrap().is_none(),
                "must be None for {denied}"
            );
        }
    }
    #[test]
    fn browser_tls_invalid_proxy_error_redacts_credentials() {
        let error = MediaRoute::for_browser_tls(
            "https://surrit.com/a.m3u8",
            "socks5h://socksuser:socksp@ss@not a host",
        )
        .err()
        .unwrap();
        assert!(!error.contains("socksp@ss"), "{error}");
        assert!(!error.contains("socksuser"), "{error}");
        let error = MediaRoute::for_browser_tls(
            "https://surrit.com/a.m3u8",
            "http://opaque-user:opaque-pass@127.0.0.1:3128",
        )
        .err()
        .unwrap();
        assert!(!error.contains("opaque-pass"), "{error}");
        assert!(!error.contains("opaque-user"), "{error}");
    }
}
