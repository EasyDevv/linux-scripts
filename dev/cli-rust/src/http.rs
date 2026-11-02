//! HTTPS downloads limited to a per-tool host allow-list.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use reqwest::header::{HeaderValue, AUTHORIZATION, LAST_MODIFIED};

use crate::manifest::{Method, Tool};

const USER_AGENT: &str = "cli/0.1 (+local)";
const MAX_REDIRECTS: usize = 5;
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;

const GITHUB_HOSTS: &[&str] = &[
    "github.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

#[derive(Debug, Clone)]
pub struct HostPolicy {
    pub allowed: Vec<String>,
    test_ports: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostBlocked {
    pub url: String,
    pub reason: String,
}

impl HostBlocked {
    fn new(url: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            reason: reason.into(),
        }
    }
}

impl std::fmt::Display for HostBlocked {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "host blocked: {} ({})", self.url, self.reason)
    }
}

impl std::error::Error for HostBlocked {}

impl HostPolicy {
    pub fn for_tool(tool: &Tool) -> Self {
        let mut allowed = Vec::new();
        if tool
            .repo
            .as_deref()
            .is_some_and(|repo| !repo.trim().is_empty())
        {
            for host in GITHUB_HOSTS {
                push_host(&mut allowed, host);
            }
        }
        if let Some(url) = tool.url.as_deref() {
            if let Some(host) = host_of(url) {
                push_host(&mut allowed, &host);
            }
        }
        if let Some(url) = tool.sig_url.as_deref() {
            if let Some(host) = host_of(url) {
                push_host(&mut allowed, &host);
            }
        }
        if tool
            .version_from
            .as_deref()
            .is_some_and(|value| value.starts_with("github:"))
        {
            push_host(&mut allowed, "api.github.com");
        }
        let fixed: &[&str] = match tool.method {
            Method::Go => &["proxy.golang.org", "sum.golang.org"],
            Method::Cargo => &["crates.io", "static.crates.io", "index.crates.io"],
            Method::Bun => &["registry.npmjs.org"],
            Method::Release | Method::Vendor => &[],
        };
        for host in fixed {
            push_host(&mut allowed, host);
        }
        Self {
            allowed,
            test_ports: Vec::new(),
        }
    }

    /// Allows `http://127.0.0.1:<port>/…` only. Not part of the install policy.
    #[doc(hidden)]
    pub fn allow_localhost_for_tests(port: u16) -> Self {
        Self {
            allowed: Vec::new(),
            test_ports: vec![port],
        }
    }

    /// Adds another loopback port to a test policy (two local servers).
    #[doc(hidden)]
    pub fn and_localhost_for_tests(mut self, port: u16) -> Self {
        if !self.test_ports.contains(&port) {
            self.test_ports.push(port);
        }
        self
    }

    pub fn check_url(&self, url: &str) -> Result<(), HostBlocked> {
        let parsed = reqwest::Url::parse(url).map_err(|_| HostBlocked::new(url, "invalid url"))?;
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(HostBlocked::new(url, "userinfo is not allowed"));
        }
        let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
        if host.is_empty() {
            return Err(HostBlocked::new(url, "missing host"));
        }
        // url::Url hides a default port (443/80), but an explicit port is still rejected.
        let explicit_port = raw_port(url);
        let test_local = host == "127.0.0.1"
            && explicit_port.is_some_and(|port| self.test_ports.contains(&port));
        let scheme = parsed.scheme();
        if scheme != "https" && !(scheme == "http" && test_local) {
            return Err(HostBlocked::new(url, "scheme is not https"));
        }
        if test_local {
            return Ok(());
        }
        if !self
            .allowed
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&host))
        {
            return Err(HostBlocked::new(url, "host is not allowed"));
        }
        if explicit_port.is_some() {
            return Err(HostBlocked::new(url, "port is not allowed"));
        }
        Ok(())
    }
}

pub fn client(policy: HostPolicy) -> Result<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(redirect_policy(policy))
        .build()
        .context("build http client")
}

pub fn get_text(client: &Client, policy: &HostPolicy, url: &str) -> Result<String> {
    let response = send(client, policy, reqwest::Method::GET, url)?;
    let bytes = read_body(response, url, MAX_TEXT_BYTES)?;
    String::from_utf8(bytes).with_context(|| format!("GET {url} body is not utf-8"))
}

pub fn get_json(client: &Client, policy: &HostPolicy, url: &str) -> Result<serde_json::Value> {
    let text = get_text(client, policy, url)?;
    serde_json::from_str(&text).with_context(|| format!("invalid json from {url}"))
}

pub fn head_last_modified(
    client: &Client,
    policy: &HostPolicy,
    url: &str,
) -> Result<Option<String>> {
    let response = send(client, policy, reqwest::Method::HEAD, url)?;
    let status = response.status();
    if !status.is_success() {
        bail!("HEAD {url} status {}", status.as_u16());
    }
    Ok(response
        .headers()
        .get(LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string))
}

pub fn download(client: &Client, policy: &HostPolicy, url: &str, dest: &Path) -> Result<()> {
    let mut response = send(client, policy, reqwest::Method::GET, url)?;
    let status = response.status();
    if !status.is_success() {
        bail!("GET {url} status {}", status.as_u16());
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_DOWNLOAD_BYTES)
    {
        bail!("GET {url} exceeds 2 GiB");
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create {}", parent.display()))?;
        }
    }
    let part = part_path(dest);
    let mut file =
        std::fs::File::create(&part).with_context(|| format!("create {}", part.display()))?;
    let mut cleanup = RemoveOnDrop {
        path: &part,
        armed: true,
    };
    if let Err(error) = copy_capped(&mut response, &mut file, MAX_DOWNLOAD_BYTES) {
        drop(file);
        return Err(error);
    }
    file.flush()
        .with_context(|| format!("write {}", part.display()))?;
    drop(file);
    std::fs::rename(&part, dest)
        .with_context(|| format!("rename {} -> {}", part.display(), dest.display()))?;
    cleanup.armed = false;
    Ok(())
}

fn redirect_policy(policy: HostPolicy) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        // previous includes the initial URL, so len > 5 means a 6th hop.
        if attempt.previous().len() > MAX_REDIRECTS {
            return attempt.error(anyhow::anyhow!("too many redirects"));
        }
        if let Err(error) = policy.check_url(attempt.url().as_str()) {
            return attempt.error(error);
        }
        attempt.follow()
    })
}

fn send(
    client: &Client,
    policy: &HostPolicy,
    method: reqwest::Method,
    url: &str,
) -> Result<reqwest::blocking::Response> {
    policy.check_url(url)?;
    let mut builder = client.request(method.clone(), url);
    // Attached per request, and only for api.github.com, so a redirect cannot carry the token.
    if let Some(value) = authorization_for(url)? {
        builder = builder.header(AUTHORIZATION, value);
    }
    let response = builder.send().with_context(|| format!("{method} {url}"))?;
    Ok(response)
}

fn authorization_for(url: &str) -> Result<Option<HeaderValue>> {
    let host = match reqwest::Url::parse(url) {
        Ok(parsed) => parsed.host_str().unwrap_or("").to_ascii_lowercase(),
        Err(_) => return Ok(None),
    };
    if host != "api.github.com" {
        return Ok(None);
    }
    let Ok(token) = std::env::var("GITHUB_TOKEN") else {
        return Ok(None);
    };
    let token = token.trim();
    if token.is_empty() {
        return Ok(None);
    }
    let mut value = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| anyhow::anyhow!("GITHUB_TOKEN cannot be used as an Authorization header"))?;
    value.set_sensitive(true);
    Ok(Some(value))
}

fn read_body(response: reqwest::blocking::Response, url: &str, cap: u64) -> Result<Vec<u8>> {
    let status = response.status();
    if !status.is_success() {
        bail!("GET {url} status {}", status.as_u16());
    }
    if response.content_length().is_some_and(|len| len > cap) {
        bail!("GET {url} exceeds {cap} bytes");
    }
    let mut bytes = Vec::new();
    copy_capped(&mut response.take(cap.saturating_add(1)), &mut bytes, cap)?;
    Ok(bytes)
}

fn copy_capped(reader: &mut impl Read, writer: &mut impl Write, cap: u64) -> Result<u64> {
    let mut buf = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let read = reader.read(&mut buf)?;
        if read == 0 {
            return Ok(total);
        }
        total = total.saturating_add(read as u64);
        if total > cap {
            bail!("response exceeds {cap} bytes");
        }
        writer.write_all(&buf[..read])?;
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

struct RemoveOnDrop<'a> {
    path: &'a Path,
    armed: bool,
}

impl Drop for RemoveOnDrop<'_> {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(self.path);
        }
    }
}

fn push_host(allowed: &mut Vec<String>, host: &str) {
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty() || allowed.iter().any(|item| item == &host) {
        return;
    }
    allowed.push(host);
}

fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_ascii_lowercase()))
}

fn raw_port(url: &str) -> Option<u16> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let hostport = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    let port = if let Some(rest) = hostport.strip_prefix('[') {
        let (_, after) = rest.split_once(']')?;
        after.strip_prefix(':')?
    } else {
        hostport.split_once(':')?.1
    };
    port.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Status;

    fn empty(method: Method) -> Tool {
        Tool {
            name: "t".into(),
            method,
            repo: None,
            url: None,
            sig_url: None,
            gpg_fingerprint: None,
            sig: None,
            key_file: None,
            sha256: None,
            version: None,
            version_from: None,
            asset: None,
            checksum: None,
            package: None,
            module: None,
            bin: None,
            exe: None,
            priority: "P1".into(),
            group: "g".into(),
            category: String::new(),
            env: Vec::new(),
            probe: Vec::new(),
            status: Status::Ready,
        }
    }

    fn release() -> Tool {
        let mut tool = empty(Method::Release);
        tool.repo = Some("benbjohnson/litestream".into());
        tool
    }

    #[test]
    fn allows_https_host_from_the_tool() {
        let policy = HostPolicy::for_tool(&release());
        assert!(policy
            .check_url("https://github.com/benbjohnson/litestream")
            .is_ok());
        assert!(policy
            .check_url("https://api.github.com/repos/benbjohnson/litestream")
            .is_ok());
        assert!(policy
            .check_url("https://objects.githubusercontent.com/a")
            .is_ok());
        assert!(policy
            .check_url("https://release-assets.githubusercontent.com/a")
            .is_ok());
        assert!(policy
            .check_url("https://github-releases.githubusercontent.com/a")
            .is_ok());
    }

    #[test]
    fn rejects_http() {
        let policy = HostPolicy::for_tool(&release());
        let error = policy
            .check_url("http://github.com/benbjohnson/litestream")
            .unwrap_err();
        assert_eq!(error.reason, "scheme is not https");
    }

    #[test]
    fn rejects_arbitrary_host() {
        let policy = HostPolicy::for_tool(&release());
        let error = policy
            .check_url("https://example.com/litestream")
            .unwrap_err();
        assert_eq!(error.reason, "host is not allowed");
        assert!(error.to_string().contains("https://example.com/litestream"));
    }

    #[test]
    fn rejects_explicit_port() {
        let policy = HostPolicy::for_tool(&release());
        let error = policy
            .check_url("https://github.com:443/benbjohnson/litestream")
            .unwrap_err();
        assert_eq!(error.reason, "port is not allowed");
    }

    #[test]
    fn matches_host_case_insensitively() {
        let policy = HostPolicy::for_tool(&release());
        assert!(policy
            .check_url("https://GitHub.COM/benbjohnson/litestream")
            .is_ok());
        assert!(policy.check_url("HTTPS://api.github.com/repos/x").is_ok());
    }

    #[test]
    fn rejects_lookalike_suffix_host() {
        let policy = HostPolicy::for_tool(&release());
        let error = policy
            .check_url("https://github.com.evil.com/repo")
            .unwrap_err();
        assert_eq!(error.reason, "host is not allowed");
    }

    #[test]
    fn rejects_userinfo_even_when_it_looks_like_the_host() {
        let policy = HostPolicy::for_tool(&release());
        let error = policy
            .check_url("https://github.com@evil.com/")
            .unwrap_err();
        assert_eq!(error.reason, "userinfo is not allowed");
        let sneaky = policy
            .check_url("https://token@github.com/benbjohnson/litestream")
            .unwrap_err();
        assert_eq!(sneaky.reason, "userinfo is not allowed");
    }

    #[test]
    fn vendor_without_repo_allows_only_url_hosts() {
        let mut tool = empty(Method::Vendor);
        tool.url = Some("https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip".into());
        tool.sig_url = Some("https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip.sig".into());
        let policy = HostPolicy::for_tool(&tool);
        assert_eq!(policy.allowed, vec!["awscli.amazonaws.com".to_string()]);
        assert!(policy
            .check_url("https://AWSCLI.AMAZONAWS.COM/awscli-exe-linux-x86_64.zip")
            .is_ok());
        assert!(policy.check_url("https://github.com/aws/aws-cli").is_err());
        assert!(policy
            .check_url("https://api.github.com/repos/aws/aws-cli")
            .is_err());
        assert!(policy.allowed.iter().all(|host| !host.contains("github")));
    }

    #[test]
    fn method_fixed_hosts_and_distinct_sig_host() {
        let go = empty(Method::Go);
        let go_policy = HostPolicy::for_tool(&go);
        assert!(go_policy
            .check_url("https://proxy.golang.org/mod/@v/v1.info")
            .is_ok());
        assert!(go_policy
            .check_url("https://sum.golang.org/lookup/mod")
            .is_ok());
        assert!(go_policy.check_url("https://github.com/x").is_err());

        let cargo = HostPolicy::for_tool(&empty(Method::Cargo));
        assert!(cargo
            .check_url("https://crates.io/api/v1/crates/serde")
            .is_ok());
        assert!(cargo
            .check_url("https://static.crates.io/crates/serde/serde-1.0.0.crate")
            .is_ok());
        assert!(cargo
            .check_url("https://index.crates.io/se/rd/serde")
            .is_ok());

        let bun = HostPolicy::for_tool(&empty(Method::Bun));
        assert!(bun.check_url("https://registry.npmjs.org/cf").is_ok());

        let mut vendor = empty(Method::Vendor);
        vendor.url = Some("https://dl.google.com/dl/a.tar.gz".into());
        vendor.sig_url = Some("https://example.com/a.tar.gz.sig".into());
        let policy = HostPolicy::for_tool(&vendor);
        assert!(policy
            .check_url("https://dl.google.com/dl/a.tar.gz")
            .is_ok());
        assert!(policy.check_url("https://example.com/a.tar.gz.sig").is_ok());
        assert!(policy.check_url("https://github.com/").is_err());
        let _ = go;
    }

    #[test]
    fn localhost_test_exception_is_exact_port() {
        let policy = HostPolicy::allow_localhost_for_tests(9);
        assert!(policy.check_url("http://127.0.0.1:9/file").is_ok());
        assert!(policy.check_url("http://127.0.0.1:10/file").is_err());
        assert!(policy.check_url("http://localhost:9/file").is_err());
        assert!(policy.check_url("https://github.com/").is_err());
        assert_eq!(
            policy.check_url("not a url").unwrap_err().reason,
            "invalid url"
        );
    }

    #[test]
    fn invalid_token_is_not_copied_into_the_error() {
        let previous = std::env::var("GITHUB_TOKEN").ok();
        let marker = "cli-test-token-do-not-leak";
        unsafe { std::env::set_var("GITHUB_TOKEN", format!("bad\n{marker}")) };
        let error = authorization_for("https://api.github.com/repos/a/b").unwrap_err();
        let text = error.to_string();
        unsafe {
            match previous {
                Some(value) => std::env::set_var("GITHUB_TOKEN", value),
                None => std::env::remove_var("GITHUB_TOKEN"),
            }
        }
        assert!(!text.contains(marker), "token leaked into error");
        assert!(text.contains("GITHUB_TOKEN"));
        assert!(authorization_for("https://github.com/a").unwrap().is_none());
    }
}
