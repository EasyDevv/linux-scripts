//! Published-time and candidate-version lookup. Network goes through [`Fetch`] only.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};

use crate::http::{self, HostPolicy};
use crate::manifest::{Method, Tool};

pub trait Fetch {
    fn get_text(&self, url: &str) -> Result<String>;
    fn head_last_modified(&self, url: &str) -> Result<Option<String>>;
}

pub struct HttpFetch {
    client: reqwest::blocking::Client,
    policy: HostPolicy,
}

impl HttpFetch {
    pub fn new(policy: HostPolicy) -> Result<Self> {
        let client = http::client(policy.clone())?;
        Ok(Self { client, policy })
    }
}

impl Fetch for HttpFetch {
    fn get_text(&self, url: &str) -> Result<String> {
        http::get_text(&self.client, &self.policy, url)
    }

    fn head_last_modified(&self, url: &str) -> Result<Option<String>> {
        http::head_last_modified(&self.client, &self.policy, url)
    }
}

pub fn published_at(tool: &Tool, version: &str, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    if version.trim().is_empty() {
        bail!("missing version");
    }
    match tool.method {
        Method::Release => release_published(tool, version, fetch),
        Method::Vendor => vendor_published(tool, fetch),
        Method::Go => go_published(tool, version, fetch),
        Method::Cargo => cargo_published(tool, version, fetch),
        Method::Bun => bun_published(tool, version, fetch),
    }
}

pub fn latest_candidate(tool: &Tool, fetch: &dyn Fetch) -> Result<String> {
    match tool.method {
        Method::Release => {
            let repo = github_repo(need(tool.repo.as_deref(), "repo")?)?;
            let url = format!("https://api.github.com/repos/{repo}/releases/latest");
            let value = parse_json(&fetch.get_text(&url)?)?;
            let tag = value
                .get("tag_name")
                .and_then(|item| item.as_str())
                .context("missing tag_name")?;
            Ok(tag.strip_prefix('v').unwrap_or(tag).to_string())
        }
        Method::Go => {
            let module = go_escape(need(tool.module.as_deref(), "module")?);
            let url = format!("https://proxy.golang.org/{module}/@latest");
            let value = parse_json(&fetch.get_text(&url)?)?;
            value
                .get("Version")
                .and_then(|item| item.as_str())
                .map(str::to_string)
                .context("missing Version")
        }
        Method::Cargo => {
            let package = need(tool.package.as_deref(), "package")?;
            let url = format!("https://crates.io/api/v1/crates/{package}");
            let value = parse_json(&fetch.get_text(&url)?)?;
            value
                .pointer("/crate/max_stable_version")
                .and_then(|item| item.as_str())
                .map(str::to_string)
                .context("missing crate.max_stable_version")
        }
        Method::Bun => {
            let package = npm_path(need(tool.package.as_deref(), "package")?);
            let url = format!("https://registry.npmjs.org/{package}");
            let value = parse_json(&fetch.get_text(&url)?)?;
            let tagged = value
                .pointer("/dist-tags/latest")
                .and_then(|item| item.as_str())
                .context("missing dist-tags.latest")?;
            if is_stable(tagged) {
                return Ok(tagged.to_string());
            }
            // latest 태그가 prerelease 면 정식 버전 중 가장 높은 것을 쓴다.
            value
                .get("versions")
                .and_then(|item| item.as_object())
                .and_then(|versions| {
                    versions
                        .keys()
                        .filter(|name| is_stable(name))
                        .max_by_key(|name| stable_key(name))
                        .cloned()
                })
                .with_context(|| format!("{package}: 정식(non-prerelease) 버전이 없습니다"))
        }
        Method::Vendor => vendor_latest(tool, fetch),
    }
}

fn release_published(tool: &Tool, version: &str, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    release_info(tool, version, fetch).map(|(_, time)| time)
}

/// 릴리스의 실제 태그 이름(`v1.2.3` 또는 `1.2.3`)과 게시 시각.
pub fn release_info(
    tool: &Tool,
    version: &str,
    fetch: &dyn Fetch,
) -> Result<(String, DateTime<Utc>)> {
    let repo = github_repo(need(tool.repo.as_deref(), "repo")?)?;
    let prefixed = format!("https://api.github.com/repos/{repo}/releases/tags/v{version}");
    let body = match fetch.get_text(&prefixed) {
        Ok(body) => body,
        Err(error) if is_not_found(&error) => {
            let plain = format!("https://api.github.com/repos/{repo}/releases/tags/{version}");
            fetch.get_text(&plain)?
        }
        Err(error) => return Err(error),
    };
    let value = parse_json(&body)?;
    let raw = value
        .get("published_at")
        .and_then(|item| item.as_str())
        .context("missing published_at")?;
    let tag = value
        .get("tag_name")
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("v{version}"));
    Ok((tag, parse_ts(raw)?))
}

fn vendor_published(tool: &Tool, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    let url = need(tool.url.as_deref(), "url")?;
    let header = fetch
        .head_last_modified(url)?
        .context("published time unknown")?;
    parse_ts(&header)
}

fn go_published(tool: &Tool, version: &str, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    let module = go_escape(need(tool.module.as_deref(), "module")?);
    let url = format!("https://proxy.golang.org/{module}/@v/v{version}.info");
    let value = parse_json(&fetch.get_text(&url)?)?;
    let raw = value
        .get("Time")
        .and_then(|item| item.as_str())
        .context("missing Time")?;
    parse_ts(raw)
}

fn cargo_published(tool: &Tool, version: &str, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    let package = need(tool.package.as_deref(), "package")?;
    let url = format!("https://crates.io/api/v1/crates/{package}/{version}");
    let value = parse_json(&fetch.get_text(&url)?)?;
    let raw = value
        .pointer("/version/created_at")
        .and_then(|item| item.as_str())
        .context("missing version.created_at")?;
    parse_ts(raw)
}

/// npm 레지스트리의 한 버전: 게시 시각과 `dist.integrity`(sha512-…).
pub fn npm_version_info(
    tool: &Tool,
    version: &str,
    fetch: &dyn Fetch,
) -> Result<(DateTime<Utc>, Option<String>)> {
    let package = npm_path(need(tool.package.as_deref(), "package")?);
    let url = format!("https://registry.npmjs.org/{package}");
    let value = parse_json(&fetch.get_text(&url)?)?;
    let raw = value
        .get("time")
        .and_then(|time| time.get(version))
        .and_then(|item| item.as_str())
        .context("missing time[version]")?;
    let integrity = value
        .pointer(&format!("/versions/{}/dist/integrity", version.replace('~', "~0").replace('/', "~1")))
        .and_then(|item| item.as_str())
        .map(str::to_string);
    Ok((parse_ts(raw)?, integrity))
}

fn bun_published(tool: &Tool, version: &str, fetch: &dyn Fetch) -> Result<DateTime<Utc>> {
    let package = npm_path(need(tool.package.as_deref(), "package")?);
    let url = format!("https://registry.npmjs.org/{package}");
    let value = parse_json(&fetch.get_text(&url)?)?;
    let raw = value
        .get("time")
        .and_then(|time| time.get(version))
        .and_then(|item| item.as_str())
        .context("missing time[version]")?;
    parse_ts(raw)
}

fn vendor_latest(tool: &Tool, fetch: &dyn Fetch) -> Result<String> {
    let raw = need(tool.version_from.as_deref(), "version_from")?;
    let Some(rest) = raw.strip_prefix("github:") else {
        bail!("version_from is not github:owner/repo");
    };
    let repo = github_repo(rest)?;
    let url = format!("https://api.github.com/repos/{repo}/tags");
    let value = parse_json(&fetch.get_text(&url)?)?;
    let tags = value.as_array().context("tags are not an array")?;
    for tag in tags {
        if let Some(name) = tag.get("name").and_then(|item| item.as_str()) {
            if is_stable(name) {
                return Ok(name.to_string());
            }
        }
    }
    bail!("no semver tag")
}

fn need<'a>(value: Option<&'a str>, field: &str) -> Result<&'a str> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .with_context(|| format!("missing {field}"))
}

fn github_repo(repo: &str) -> Result<&str> {
    let Some((owner, name)) = repo.split_once('/') else {
        bail!("repo must be owner/name");
    };
    if !github_component(owner) || !github_component(name) || name.contains('/') {
        bail!("repo must be owner/name");
    }
    Ok(repo)
}

fn github_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
}

/// Go module proxy case encoding: each ASCII uppercase letter becomes `!` + lowercase.
fn go_escape(module: &str) -> String {
    let mut out = String::with_capacity(module.len());
    for ch in module.chars() {
        if ch.is_ascii_uppercase() {
            out.push('!');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Scoped npm names encode the single slash (`@scope/name` → `@scope%2Fname`). Other names are literal.
fn npm_path(package: &str) -> String {
    if let Some(rest) = package.strip_prefix('@') {
        if let Some((scope, name)) = rest.split_once('/') {
            if !scope.is_empty() && !name.is_empty() && !name.contains('/') {
                return format!("@{scope}%2F{name}");
            }
        }
    }
    package.to_string()
}

fn parse_json(text: &str) -> Result<serde_json::Value> {
    serde_json::from_str(text).context("invalid json")
}

fn parse_ts(raw: &str) -> Result<DateTime<Utc>> {
    crate::cooldown::parse_time(raw)
}

fn is_not_found(error: &anyhow::Error) -> bool {
    format!("{error:#}")
        .split(|ch: char| !ch.is_ascii_digit())
        .any(|part| part == "404")
}

/// 버전에 prerelease 꼬리표(`-beta.1`, `-rc.2` 등)가 붙었는가.
pub fn is_prerelease(version: &str) -> bool {
    let rest = version.strip_prefix('v').unwrap_or(version);
    let rest = rest.split_once('+').map(|(core, _)| core).unwrap_or(rest);
    rest.contains('-')
}

/// `major.minor.patch` 로 된 정식 버전인가.
pub fn is_stable(version: &str) -> bool {
    is_semver_tag(version) && !is_prerelease(version)
}

fn stable_key(version: &str) -> (u64, u64, u64) {
    let rest = version.strip_prefix('v').unwrap_or(version);
    let rest = rest.split_once('+').map(|(core, _)| core).unwrap_or(rest);
    let mut parts = rest.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

fn is_semver_tag(name: &str) -> bool {
    let rest = name.strip_prefix('v').unwrap_or(name);
    let rest = rest.split_once('+').map(|(core, _)| core).unwrap_or(rest);
    let (core, pre) = match rest.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (rest, None),
    };
    let mut parts = core.split('.');
    let (Some(major), Some(minor), Some(patch)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if parts.next().is_some() || !numeric_id(major) || !numeric_id(minor) || !numeric_id(patch) {
        return false;
    }
    match pre {
        None => true,
        Some(pre) => {
            !pre.is_empty()
                && pre.split('.').all(|part| {
                    !part.is_empty()
                        && part
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                })
        }
    }
}

fn numeric_id(part: &str) -> bool {
    !part.is_empty()
        && part.bytes().all(|byte| byte.is_ascii_digit())
        && (part.len() == 1 || !part.starts_with('0'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Status;
    use std::sync::Mutex;

    struct SeqFetch {
        gets: Mutex<Vec<(String, Result<String, String>)>>,
        heads: Mutex<Vec<(String, Result<Option<String>, String>)>>,
    }

    impl SeqFetch {
        fn gets(items: Vec<(String, Result<String, String>)>) -> Self {
            Self {
                gets: Mutex::new(items),
                heads: Mutex::new(Vec::new()),
            }
        }

        fn heads(items: Vec<(String, Result<Option<String>, String>)>) -> Self {
            Self {
                gets: Mutex::new(Vec::new()),
                heads: Mutex::new(items),
            }
        }
    }

    impl Fetch for SeqFetch {
        fn get_text(&self, url: &str) -> Result<String> {
            let mut gets = self.gets.lock().expect("fetch lock");
            if gets.is_empty() {
                bail!("unexpected GET {url}");
            }
            let (expected, result) = gets.remove(0);
            if expected != url {
                bail!("GET {url} != {expected}");
            }
            result.map_err(anyhow::Error::msg)
        }

        fn head_last_modified(&self, url: &str) -> Result<Option<String>> {
            let mut heads = self.heads.lock().expect("fetch lock");
            if heads.is_empty() {
                bail!("unexpected HEAD {url}");
            }
            let (expected, result) = heads.remove(0);
            if expected != url {
                bail!("HEAD {url} != {expected}");
            }
            result.map_err(anyhow::Error::msg)
        }
    }

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

    fn at(raw: &str) -> DateTime<Utc> {
        parse_ts(raw).unwrap()
    }

    #[test]
    fn published_at_release_parses_published_at_only() {
        let mut tool = empty(Method::Release);
        tool.repo = Some("benbjohnson/litestream".into());
        let url = "https://api.github.com/repos/benbjohnson/litestream/releases/tags/v0.5.17";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(
                r#"{"created_at":"2019-01-01T00:00:00Z","published_at":"2024-06-01T00:00:00Z"}"#
                    .into(),
            ),
        )]);
        assert_eq!(
            published_at(&tool, "0.5.17", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
    }

    #[test]
    fn published_at_release_does_not_use_created_at() {
        let mut tool = empty(Method::Release);
        tool.repo = Some("benbjohnson/litestream".into());
        let url = "https://api.github.com/repos/benbjohnson/litestream/releases/tags/v0.5.17";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"created_at":"2024-06-01T00:00:00Z"}"#.into()),
        )]);
        let error = published_at(&tool, "0.5.17", &fetch)
            .unwrap_err()
            .to_string();
        assert!(error.contains("missing published_at"), "{error}");
    }

    #[test]
    fn published_at_vendor_uses_last_modified() {
        let mut tool = empty(Method::Vendor);
        tool.url = Some("https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip".into());
        let fetch = SeqFetch::heads(vec![(
            tool.url.clone().unwrap(),
            Ok(Some("Sat, 01 Jun 2024 00:00:00 GMT".into())),
        )]);
        assert_eq!(
            published_at(&tool, "2.15.0", &fetch).unwrap(),
            at("Sat, 01 Jun 2024 00:00:00 GMT")
        );
    }

    #[test]
    fn published_at_vendor_missing_last_modified_is_an_error() {
        let mut tool = empty(Method::Vendor);
        tool.url = Some("https://awscli.amazonaws.com/a.zip".into());
        let fetch = SeqFetch::heads(vec![(tool.url.clone().unwrap(), Ok(None))]);
        let error = published_at(&tool, "1", &fetch).unwrap_err().to_string();
        assert!(error.contains("published time unknown"), "{error}");
    }

    #[test]
    fn published_at_go_parses_time() {
        let mut tool = empty(Method::Go);
        tool.module = Some("golang.org/x/tools".into());
        let url = "https://proxy.golang.org/golang.org/x/tools/@v/v0.1.0.info";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"Version":"v0.1.0","Time":"2024-06-01T00:00:00Z"}"#.into()),
        )]);
        assert_eq!(
            published_at(&tool, "0.1.0", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
    }

    #[test]
    fn published_at_cargo_parses_created_at() {
        let mut tool = empty(Method::Cargo);
        tool.package = Some("serde".into());
        let url = "https://crates.io/api/v1/crates/serde/1.0.210";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"version":{"num":"1.0.210","created_at":"2024-06-01T00:00:00Z"}}"#.into()),
        )]);
        assert_eq!(
            published_at(&tool, "1.0.210", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
    }

    #[test]
    fn published_at_bun_parses_time_map() {
        let mut tool = empty(Method::Bun);
        tool.package = Some("cf".into());
        let url = "https://registry.npmjs.org/cf";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"dist-tags":{"latest":"9.9.9"},"time":{"1.0.0-beta.26":"2024-06-01T00:00:00.123Z"}}"#.into()),
        )]);
        assert_eq!(
            published_at(&tool, "1.0.0-beta.26", &fetch).unwrap(),
            at("2024-06-01T00:00:00.123Z")
        );
    }

    #[test]
    fn release_retries_without_v_prefix_on_404() {
        let mut tool = empty(Method::Release);
        tool.repo = Some("ovh/ovhcloud-cli".into());
        let fetch = SeqFetch::gets(vec![
            (
                "https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/v0.16.0".into(),
                Err("GET status 404".into()),
            ),
            (
                "https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/0.16.0".into(),
                Ok(r#"{"published_at":"2024-06-01T00:00:00Z"}"#.into()),
            ),
        ]);
        assert_eq!(
            published_at(&tool, "0.16.0", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
    }

    #[test]
    fn release_does_not_retry_on_other_status() {
        let mut tool = empty(Method::Release);
        tool.repo = Some("ovh/ovhcloud-cli".into());
        let fetch = SeqFetch::gets(vec![(
            "https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/v0.16.0".into(),
            Err("GET status 500".into()),
        )]);
        let error = published_at(&tool, "0.16.0", &fetch)
            .unwrap_err()
            .to_string();
        assert!(error.contains("500"), "{error}");
    }

    #[test]
    fn go_upper_case_is_escaped() {
        let mut tool = empty(Method::Go);
        tool.module = Some("github.com/Foo/Bar".into());
        let url = "https://proxy.golang.org/github.com/!foo/!bar/@v/v1.2.3.info";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"Time":"2024-06-01T00:00:00Z"}"#.into()),
        )]);
        assert_eq!(
            published_at(&tool, "1.2.3", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
        assert_eq!(go_escape("github.com/Foo/Bar"), "github.com/!foo/!bar");
    }

    #[test]
    fn scoped_npm_encodes_only_the_slash() {
        let mut tool = empty(Method::Bun);
        tool.package = Some("@creem_io/cli".into());
        let url = "https://registry.npmjs.org/@creem_io%2Fcli";
        let fetch = SeqFetch::gets(vec![(
            url.into(),
            Ok(r#"{"time":{"0.9.0":"2024-06-01T00:00:00Z"}}"#.into()),
        )]);
        assert_eq!(
            published_at(&tool, "0.9.0", &fetch).unwrap(),
            at("2024-06-01T00:00:00Z")
        );
        assert_eq!(npm_path("@creem_io/cli"), "@creem_io%2Fcli");
        assert_eq!(npm_path("cf"), "cf");
    }

    #[test]
    fn latest_release_strips_one_v() {
        let mut tool = empty(Method::Release);
        tool.repo = Some("benbjohnson/litestream".into());
        let fetch = SeqFetch::gets(vec![(
            "https://api.github.com/repos/benbjohnson/litestream/releases/latest".into(),
            Ok(r#"{"tag_name":"v0.5.17"}"#.into()),
        )]);
        assert_eq!(latest_candidate(&tool, &fetch).unwrap(), "0.5.17");
    }

    #[test]
    fn latest_go_cargo_and_bun() {
        let mut go = empty(Method::Go);
        go.module = Some("github.com/Foo/Bar".into());
        let go_fetch = SeqFetch::gets(vec![(
            "https://proxy.golang.org/github.com/!foo/!bar/@latest".into(),
            Ok(r#"{"Version":"v1.2.3"}"#.into()),
        )]);
        assert_eq!(latest_candidate(&go, &go_fetch).unwrap(), "v1.2.3");

        let mut cargo = empty(Method::Cargo);
        cargo.package = Some("serde".into());
        let cargo_fetch = SeqFetch::gets(vec![(
            "https://crates.io/api/v1/crates/serde".into(),
            Ok(r#"{"crate":{"max_stable_version":"1.0.210"}}"#.into()),
        )]);
        assert_eq!(latest_candidate(&cargo, &cargo_fetch).unwrap(), "1.0.210");

        let mut bun = empty(Method::Bun);
        bun.package = Some("@creem_io/cli".into());
        let bun_fetch = SeqFetch::gets(vec![(
            "https://registry.npmjs.org/@creem_io%2Fcli".into(),
            Ok(r#"{"dist-tags":{"latest":"0.9.0"}}"#.into()),
        )]);
        assert_eq!(latest_candidate(&bun, &bun_fetch).unwrap(), "0.9.0");
    }

    #[test]
    fn prerelease_detection_and_stable_pick() {
        assert!(is_prerelease("1.0.0-beta.26"));
        assert!(is_prerelease("v2.0.0-rc.1"));
        assert!(!is_prerelease("0.15.0"));
        assert!(!is_prerelease("1.2.3+build-5"));
        assert!(is_stable("v1.2.3"));
        assert!(!is_stable("1.0.0-beta.1"));
        let mut bun = empty(Method::Bun);
        bun.package = Some("cf".into());
        let body = r#"{"dist-tags":{"latest":"1.0.0-beta.26"},"versions":{"0.9.1":{},"0.15.0":{},"0.10.0":{},"1.0.0-beta.26":{}}}"#;
        let fetch = SeqFetch::gets(vec![("https://registry.npmjs.org/cf".into(), Ok(body.into()))]);
        assert_eq!(latest_candidate(&bun, &fetch).unwrap(), "0.15.0");
    }

    #[test]
    fn latest_vendor_takes_first_semver_tag() {
        let mut tool = empty(Method::Vendor);
        tool.version_from = Some("github:aws/aws-cli".into());
        let fetch = SeqFetch::gets(vec![(
            "https://api.github.com/repos/aws/aws-cli/tags".into(),
            Ok(
                r#"[{"name":"latest"},{"name":"nightly"},{"name":"v2.15.0"},{"name":"v2.14.0"}]"#
                    .into(),
            ),
        )]);
        assert_eq!(latest_candidate(&tool, &fetch).unwrap(), "v2.15.0");
    }
}
