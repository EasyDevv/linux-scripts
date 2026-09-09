//! Chrome-compatible TLS transport for surrit.com media, via the installed
//! `curl_chrome131` (curl-impersonate) helper. The helper runs as a short-lived
//! subprocess with the browser closed; the configured SOCKS endpoint is passed
//! explicitly and every URL/header/proxy value travels through one piped stdin
//! `--config -` document, so secrets never appear in argv, logs, or stdout.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

/// Exact origin host served by this transport. Everything else is refused.
pub const ALLOWED_HOST: &str = "surrit.com";
const HELPER_PATH: &str = "/usr/bin/curl-impersonate";
const CONNECT_TIMEOUT_SECS: &str = "15";
const MAX_TIME_SECS: &str = "150";
/// curl ceiling (connect + transfer) plus a kill/grace margin.
const OUTER_TIMEOUT: Duration = Duration::from_secs(170);
const MAX_CONFIG_VALUE: usize = 16 * 1024;
const MAX_CONFIG_TOTAL: usize = 128 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

pub struct BrowserTls {
    helper: PathBuf,
    /// Rebuilt `scheme://host:port` (no credentials) for the curl `proxy` option.
    proxy: String,
    /// Decoded `user:pass` for the curl `proxy-user` option, when present.
    proxy_user: Option<String>,
}

/// True when `url` is an HTTPS URL whose host is exactly [`ALLOWED_HOST`].
pub fn is_allowed_source(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str() == Some(ALLOWED_HOST)
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
}

impl BrowserTls {
    /// Configured helper plus validated SOCKS endpoint. Credentials embedded in
    /// `socks_url` are split out for `proxy-user`; all error strings are static
    /// so they can never disclose them.
    pub fn connect(socks_url: &str) -> Result<Self, String> {
        Self::with_helper(PathBuf::from(HELPER_PATH), socks_url)
    }

    fn with_helper(helper: PathBuf, socks_url: &str) -> Result<Self, String> {
        if !helper.is_file() {
            return Err("chrome TLS helper unavailable".into());
        }
        let parsed = url::Url::parse(socks_url).map_err(|_| "invalid chrome TLS proxy endpoint")?;
        let scheme = match parsed.scheme() {
            "socks5" | "socks5h" | "socks4" | "socks4a" => parsed.scheme(),
            _ => return Err("chrome TLS proxy must be SOCKS".into()),
        };
        let host = parsed.host_str().ok_or("invalid chrome TLS proxy endpoint")?;
        if !(parsed.path().is_empty() || parsed.path() == "/") {
            return Err("invalid chrome TLS proxy endpoint".into());
        }
        // Reject malformed credential pairs; never echo the values.
        if parsed.username().is_empty() != parsed.password().is_none() {
            return Err("invalid chrome TLS proxy credentials".into());
        }
        let port = parsed.port().unwrap_or(1080);
        let host_part = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        let proxy = format!("{scheme}://{host_part}:{port}");
        let proxy_user = match parsed.password() {
            Some(password) => {
                let user = percent_decode(parsed.username())?;
                let secret = percent_decode(password)?;
                Some(format!("{user}:{secret}"))
            }
            None => None,
        };
        Ok(Self {
            helper,
            proxy,
            proxy_user,
        })
    }

    pub async fn fetch_bytes(
        &self,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<u8>, String> {
        if !is_allowed_source(url) {
            return Err("chrome TLS route: host not allowed".into());
        }
        // A random nonce keeps the end-of-stream trailer marker unguessable so
        // a hostile response body can never forge a status line.
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let marker = format!("__STASH_CURL_{nonce}__");
        self.fetch_with_marker(referer, url, headers, &marker).await
    }

    async fn fetch_with_marker(
        &self,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
        marker: &str,
    ) -> Result<Vec<u8>, String> {
        if !is_allowed_source(url) {
            return Err("chrome TLS route: host not allowed".into());
        }
        let config = self.build_config(marker, referer, url, headers)?;
        let output = self.run(config).await?;

        let trailer = parse_status_tail(&output.stdout, marker.as_bytes());
        // Preserve HTTP status errors (403/404/407, ...) even when the helper
        // exits non-zero after writing the trailer.
        if let Some((_, status)) = trailer {
            if status >= 400 {
                return Err(format!("media route: HTTP {status}"));
            }
        }
        if !output.success {
            return Err(match output.code {
                Some(28) => "media route timed out",
                _ => "media route connection failed",
            }
            .to_string());
        }
        let (body, status) = trailer.ok_or("media route: status trailer missing")?;
        if status == 0 {
            return Err("media route connection failed".into());
        }
        if !(200..300).contains(&status) {
            return Err(format!("media route: HTTP {status}"));
        }
        Ok(body.to_vec())
    }

    fn build_config(
        &self,
        marker: &str,
        referer: &str,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<u8>, String> {
        let mut lines: Vec<String> = vec![include_str!("browser_tls_profile.conf").into()];
        lines.push("silent".into());
        lines.push(format!("proto = {}", config_quote("=https")?));
        lines.push(format!(
            "connect-timeout = {}",
            config_quote(CONNECT_TIMEOUT_SECS)?
        ));
        lines.push(format!("max-time = {}", config_quote(MAX_TIME_SECS)?));
        lines.push(format!("proxy = {}", config_quote(&self.proxy)?));
        if let Some(user) = &self.proxy_user {
            lines.push(format!("proxy-user = {}", config_quote(user)?));
        }
        lines.push(format!("url = {}", config_quote(url)?));
        if !referer.is_empty() {
            lines.push(format!("referer = {}", config_quote(referer)?));
        }
        for (name, value) in headers {
            if !forwardable_header(name) {
                continue;
            }
            let Some(line) = config_header_line(name, value) else {
                continue;
            };
            lines.push(format!("header = {}", config_quote(&line)?));
        }
        let write_out = format!("{marker}%{{http_code}}");
        lines.push(format!("write-out = {}", config_quote(&write_out)?));

        let mut config = lines.join("\n").into_bytes();
        if config.len() > MAX_CONFIG_TOTAL {
            return Err("chrome TLS route request too large".into());
        }
        config.push(b'\n');
        Ok(config)
    }

    /// Spawn the helper with a scrubbed environment: no ambient proxy vars can
    /// leak in, and the config (with credentials) is only ever piped on stdin.
    async fn run(&self, config: Vec<u8>) -> Result<CurlOutput, String> {
        let attempt = async {
            let mut command = Command::new(&self.helper);
            command
                .arg("-q")
                .arg("--config")
                .arg("-")
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            let mut child = command
                .spawn()
                .map_err(|_| "chrome TLS route spawn failed".to_string())?;
            {
                let mut stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "chrome TLS route spawn failed".to_string())?;
                stdin
                    .write_all(&config)
                    .await
                    .map_err(|_| "chrome TLS route helper input failed".to_string())?;
                stdin
                    .shutdown()
                    .await
                    .map_err(|_| "chrome TLS route helper input failed".to_string())?;
            }
            let stdout = child.stdout.take()
                .ok_or_else(|| "chrome TLS route stdout unavailable".to_string())?;
            let mut bytes = Vec::new();
            stdout.take(MAX_RESPONSE_BYTES as u64 + 1).read_to_end(&mut bytes).await
                .map_err(|_| "chrome TLS route body failed".to_string())?;
            if bytes.len() > MAX_RESPONSE_BYTES {
                return Err("media route response too large".into());
            }
            let status = child.wait().await
                .map_err(|_| "chrome TLS route helper failed".to_string())?;
            Ok(CurlOutput { stdout: bytes, success: status.success(), code: status.code() })
        };
        // Bounded outer guard on top of curl's internal max-time; dropping the
        // future kills the helper via kill_on_drop.
        let output = match tokio::time::timeout(OUTER_TIMEOUT, attempt).await {
            Err(_) => return Err("media route timed out".into()),
            Ok(Err(message)) => return Err(message),
            Ok(Ok(output)) => output,
        };
        Ok(output)
    }
}

struct CurlOutput {
    stdout: Vec<u8>,
    success: bool,
    code: Option<i32>,
}

/// Split `output` at the end-anchored `<marker><3 digits>` trailer written by
/// `--write-out`. Returns the untouched body (binary-safe) and the HTTP code
/// (`000` becomes `0`). Any shape mismatch yields `None` — never a guess.
fn parse_status_tail<'a>(output: &'a [u8], marker: &[u8]) -> Option<(&'a [u8], u16)> {
    if output.len() < marker.len() + 3 {
        return None;
    }
    let split = output.len() - marker.len() - 3;
    if &output[split..split + marker.len()] != marker {
        return None;
    }
    let digits = &output[split + marker.len()..];
    if !digits.iter().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let text = std::str::from_utf8(digits).ok()?;
    let status: u16 = text.parse().ok()?;
    Some((&output[..split], status))
}

/// The wrapper supplies canonical Chrome `user-agent`/`accept-encoding`;
/// forwarding job copies would duplicate them and break the impersonated
/// fingerprint. Everything else keeps the MediaRoute hop-by-hop filter.
fn forwardable_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "user-agent" | "accept-encoding"
    ) && !crate::media_route::blocked_request_header(name)
}

fn config_header_line(name: &str, value: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty()
        || name.contains(':')
        || name.contains(' ')
        || name.chars().any(|c| (c as u32) < 0x21 || (c as u32) == 0x7f)
    {
        return None;
    }
    let value = value.trim();
    if value.is_empty() {
        // `Header:` in curl config sends the header as deliberately empty.
        Some(format!("{name}:"))
    } else {
        Some(format!("{name}: {value}"))
    }
}

/// Quote a value for the curl `--config` format: reject control characters
/// (CR/LF included, which would start a new option line) and escape `"` `\`.
fn config_quote(value: &str) -> Result<String, String> {
    if value.len() > MAX_CONFIG_VALUE {
        return Err("chrome TLS route value too long".into());
    }
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                return Err("chrome TLS route value contains control characters".into());
            }
            c => out.push(c),
        }
    }
    out.push('"');
    Ok(out)
}

fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 3 <= bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
                let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) else {
                    return Err("invalid chrome TLS proxy credentials".into());
                };
                out.push(byte);
                index += 3;
            }
            b'%' => return Err("invalid chrome TLS proxy credentials".into()),
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| "invalid chrome TLS proxy credentials".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route() -> BrowserTls {
        BrowserTls::with_helper(PathBuf::from("/bin/false"), "socks5h://127.0.0.1:1080").unwrap()
    }

    // ---- exact host allowlist ----

    #[test]
    fn allowlist_matches_exact_https_host_only() {
        assert!(is_allowed_source("https://surrit.com/hls/a/1.m3u8"));
        assert!(is_allowed_source("https://surrit.com/seg/video1.jpeg"));
        assert!(!is_allowed_source("http://surrit.com/x.m3u8"));
        assert!(!is_allowed_source("https://cdn.surrit.com/x.m3u8"));
        assert!(!is_allowed_source("https://surrit.com.evil.net/x"));
        assert!(!is_allowed_source("https://evil.com/@surrit.com"));
        assert!(!is_allowed_source("https://user:pass@surrit.com/x"));
        assert!(!is_allowed_source("https://surrit.com:8443/x"));
        assert!(!is_allowed_source("file:///etc/passwd"));
        assert!(!is_allowed_source("/relative.m3u8"));
    }

    #[test]
    fn constructor_validates_helper_and_socks_only() {
        // Host gating lives in fetch/for_browser_tls; here proxy + helper checks.
        assert!(
            BrowserTls::with_helper(PathBuf::from("/bin/false"), "http://127.0.0.1:1080").is_err()
        );
        assert!(
            BrowserTls::with_helper(PathBuf::from("/bin/false"), "socks5h://127.0.0.1:1080")
                .is_ok()
        );
        assert!(
            BrowserTls::with_helper(PathBuf::from("/nonexistent/curl"), "socks5h://127.0.0.1:1080")
                .is_err()
        );
    }

    // ---- config escaping / injection rejection ----

    #[test]
    fn config_quote_escapes_quotes_and_rejects_controls() {
        assert_eq!(config_quote("a\"b\\c").unwrap(), "\"a\\\"b\\\\c\"");
        for bad in [
            "line1\r\nurl = \"file:///etc/passwd\"",
            "cr\rhere",
            "lf\nhere",
            "tab\there",
            "nul\0here",
            "del\x7fhere",
        ] {
            let error = config_quote(bad).err().unwrap();
            assert!(error.contains("control characters"));
            assert!(!error.contains("etc/passwd"));
        }
        assert!(config_quote(&"x".repeat(MAX_CONFIG_VALUE + 1)).is_err());
    }

    #[test]
    fn build_config_rejects_injected_header_and_url_values() {
        let r = route();
        let headers = vec![
            ("Referer".into(), "https://surrit.com/live".into()),
            ("X-Tag".into(), "ok\r\nurl = \"file:///proc/self/environ\"".into()),
        ];
        let error = r
            .build_config("MK", "", "https://surrit.com/a.m3u8", &headers)
            .err()
            .unwrap();
        assert!(error.contains("control characters"), "{error}");
        assert!(!error.contains("proc/self"));
    }

    #[test]
    fn build_config_filters_fingerprint_and_hop_by_hop_headers() {
        let r = route();
        let headers = vec![
            ("user-agent".into(), "stash/1".into()),
            ("Accept-Encoding".into(), "identity".into()),
            ("Host".into(), "evil.example".into()),
            ("connection".into(), "close".into()),
            ("Proxy-Authorization".into(), "Basic zzz".into()),
            ("Cookie".into(), "session=abc".into()),
            ("Range".into(), "bytes=0-".into()),
        ];
        let config = String::from_utf8(
            r.build_config(
                "MK",
                "https://surrit.com/",
                "https://surrit.com/a.m3u8",
                &headers,
            )
            .unwrap(),
        )
        .unwrap();
        assert!(!config.contains("stash/1"));
        assert!(!config.contains("identity"));
        assert!(!config.contains("evil.example"));
        assert!(!config.contains("Basic zzz"));
        assert!(!config.contains("bytes=0-"));
        assert!(config.contains("header = \"Cookie: session=abc\""));
        assert!(config.contains("referer = \"https://surrit.com/\""));
        assert!(config.contains("url = \"https://surrit.com/a.m3u8\""));
        assert!(config.contains("proxy = \"socks5h://127.0.0.1:1080\""));
        assert!(config.contains("connect-timeout = \"15\""));
        assert!(config.contains("max-time = \"150\""));
        assert!(config.contains("write-out = \"MK%{http_code}\""));
    }

    // ---- trailer parser ----

    #[test]
    fn trailer_preserves_binary_body_and_http_403() {
        let marker = b"__STASH_CURL_abc__";
        let mut output: Vec<u8> = vec![0x00, 0xFF, 0x10, b'#', b'\n'];
        output.extend_from_slice(marker);
        output.extend_from_slice(b"403");
        let (body, status) = parse_status_tail(&output, marker).unwrap();
        assert_eq!(status, 403);
        assert_eq!(body, &[0x00, 0xFF, 0x10, b'#', b'\n']);

        // A body containing the marker text mid-stream must not confuse parsing.
        let mut sneaky: Vec<u8> = b"playlist __STASH_CURL_abc__999 trailing".to_vec();
        sneaky.extend_from_slice(marker);
        sneaky.extend_from_slice(b"200");
        let (body, status) = parse_status_tail(&sneaky, marker).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, &b"playlist __STASH_CURL_abc__999 trailing"[..]);

        // 000 (no response) parses as status 0.
        let mut zero: Vec<u8> = Vec::new();
        zero.extend_from_slice(marker);
        zero.extend_from_slice(b"000");
        let (body, status) = parse_status_tail(&zero, marker).unwrap();
        assert!(body.is_empty());
        assert_eq!(status, 0);
    }

    #[test]
    fn trailer_parser_rejects_malformed_or_missing_trailers() {
        let marker = b"MK";
        assert!(parse_status_tail(b"", marker).is_none());
        assert!(parse_status_tail(b"MK20", marker).is_none());
        assert!(parse_status_tail(b"MK20a", marker).is_none());
        assert!(parse_status_tail(b"no trailer here at all", marker).is_none());
        let mut garbage = Vec::new();
        garbage.extend_from_slice(b"body");
        garbage.extend_from_slice(marker);
        garbage.extend_from_slice(b"404extra");
        assert!(parse_status_tail(&garbage, marker).is_none());
    }

    // ---- proxy credential redaction ----

    #[test]
    fn proxy_credentials_never_appear_in_errors_or_proxy_line() {
        let error = BrowserTls::with_helper(
            PathBuf::from("/bin/false"),
            "socks5h://u1:secr3t@not a valid host",
        )
        .err()
        .unwrap();
        assert!(!error.contains("secr3t"), "{error}");

        let error = BrowserTls::with_helper(
            PathBuf::from("/bin/false"),
            "socks5h://:onlypass@127.0.0.1:1080",
        )
        .err()
        .unwrap();
        assert!(!error.contains("onlypass"), "{error}");

        let r = BrowserTls::with_helper(
            PathBuf::from("/bin/false"),
            "socks5h://proxyuser:pr%40x%3Bss@127.0.0.1:1080",
        )
        .unwrap();
        assert_eq!(r.proxy, "socks5h://127.0.0.1:1080");
        assert_eq!(r.proxy_user.as_deref(), Some("proxyuser:pr@x;ss"));
        // Credentials live only in the stdin-fed config, isolated on proxy-user.
        let config = String::from_utf8(
            r.build_config("MK", "", "https://surrit.com/a.m3u8", &[])
                .unwrap(),
        )
        .unwrap();
        assert!(config.contains("proxy-user = \"proxyuser:pr@x;ss\""));
        assert!(config.contains("proxy = \"socks5h://127.0.0.1:1080\""));
    }

    // ---- end-to-end against a fake helper (browser closed, no live job) ----

    /// Builds a fake helper that drains stdin, prints a binary body and the
    /// end-of-stream `write-out` trailer, then exits with `code`.
    fn fake_helper(marker: &str, status: &str, exit_code: i32) -> (PathBuf, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("stash-curl-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("curl_chrome131");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\ncat >/dev/null 2>&1\nprintf '\\000\\377\\020manifest\\377'\nprintf '{marker}{status}'\nexit {exit_code}\n"
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, PermissionsExt::from_mode(0o755)).unwrap();
        (dir, script)
    }

    #[tokio::test]
    async fn fake_helper_403_preserves_status_and_binary_never_leaks_credentials() {
        let (dir, script) = fake_helper("__STASH_CURL_t1__", "403", 0);
        let r =
            BrowserTls::with_helper(script, "socks5h://admin:sup3rs3cr3t@127.0.0.1:1080").unwrap();
        let error = r
            .fetch_with_marker("", "https://surrit.com/a.m3u8", &[], "__STASH_CURL_t1__")
            .await
            .err()
            .unwrap();
        assert_eq!(error, "media route: HTTP 403");
        assert!(!error.contains("sup3rs3cr3t"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn fake_helper_200_returns_exact_binary_body() {
        let (dir, script) = fake_helper("__STASH_CURL_t2__", "200", 0);
        let r = BrowserTls::with_helper(script, "socks5h://127.0.0.1:1080").unwrap();
        let body = r
            .fetch_with_marker("", "https://surrit.com/a.m3u8", &[], "__STASH_CURL_t2__")
            .await
            .unwrap();
        assert_eq!(body, vec![0x00, 0xFF, 0x10, b'm', b'a', b'n', b'i', b'f', b'e', b's', b't', 0xFF]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn fake_helper_timeout_exit_maps_to_sanitized_timeout() {
        let (dir, script) = fake_helper("__STASH_CURL_t3__", "000", 28);
        let r = BrowserTls::with_helper(script, "socks5h://127.0.0.1:1080").unwrap();
        let error = r
            .fetch_with_marker("", "https://surrit.com/a.m3u8", &[], "__STASH_CURL_t3__")
            .await
            .err()
            .unwrap();
        assert_eq!(error, "media route timed out");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn host_not_allowed_short_circuits_before_spawn() {
        // Helper path need not exist: the allowlist rejects before any process.
        let r = BrowserTls::with_helper(PathBuf::from("/bin/false"), "socks5h://127.0.0.1:1080")
            .unwrap();
        for url in [
            "https://evil.com/a.m3u8",
            "http://surrit.com/a.m3u8",
            "https://cdn.surrit.com/a.m3u8",
        ] {
            let error = r.fetch_bytes("", url, &[]).await.err().unwrap();
            assert_eq!(error, "chrome TLS route: host not allowed");
        }
    }
}
