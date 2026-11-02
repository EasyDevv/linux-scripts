use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// Exit codes from the plan constraints: 0 ok, 1 error, 2 gate or audit.
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_BLOCKED: i32 = 2;

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub cooldown_days: u32,
    pub tools: Vec<Tool>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tool {
    pub name: String,
    pub method: Method,
    pub repo: Option<String>,
    pub url: Option<String>,
    pub sig_url: Option<String>,
    pub gpg_fingerprint: Option<String>,
    pub sig: Option<String>,
    pub key_file: Option<String>,
    pub sha256: Option<String>,
    pub version: Option<String>,
    pub version_from: Option<String>,
    pub asset: Option<String>,
    pub checksum: Option<String>,
    pub package: Option<String>,
    pub module: Option<String>,
    pub bin: Option<String>,
    pub exe: Option<String>,
    pub priority: String,
    pub group: String,
    pub category: String,
    pub env: Vec<String>,
    pub probe: Vec<String>,
    pub status: Status,
}

impl Tool {
    pub fn exe_name(&self) -> &str {
        self.exe
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&self.name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Release,
    Vendor,
    Bun,
    Go,
    Cargo,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Release => "release",
            Method::Vendor => "vendor",
            Method::Bun => "bun",
            Method::Go => "go",
            Method::Cargo => "cargo",
        }
    }

    fn parse(name: &str, raw: &str) -> Result<Self> {
        match raw.trim() {
            "release" => Ok(Method::Release),
            "vendor" => Ok(Method::Vendor),
            "bun" => Ok(Method::Bun),
            "go" => Ok(Method::Go),
            "cargo" => Ok(Method::Cargo),
            other => bail!("{name}: unknown method: {other}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ready,
    Pending,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    defaults: Defaults,
    #[serde(default)]
    tool: Vec<RawTool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Defaults {
    cooldown_days: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTool {
    name: String,
    method: String,
    repo: Option<String>,
    url: Option<String>,
    sig_url: Option<String>,
    gpg_fingerprint: Option<String>,
    sig: Option<String>,
    key_file: Option<String>,
    sha256: Option<String>,
    version: Option<String>,
    version_from: Option<String>,
    asset: Option<String>,
    checksum: Option<String>,
    package: Option<String>,
    module: Option<String>,
    bin: Option<String>,
    exe: Option<String>,
    #[serde(default)]
    priority: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    env: Vec<String>,
    #[serde(default)]
    probe: Vec<String>,
    status: Option<String>,
}

pub fn load_path(path: &Path) -> Result<Manifest> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    load_str(&text).with_context(|| format!("parse {}", path.display()))
}

pub fn load_str(text: &str) -> Result<Manifest> {
    let file: ManifestFile = toml::from_str(text).context("invalid tools.toml")?;
    let mut tools = Vec::with_capacity(file.tool.len());
    let mut seen = Vec::new();
    for raw in file.tool {
        let tool = normalize(raw)?;
        if seen.iter().any(|name| name == &tool.name) {
            bail!("{}: duplicate name", tool.name);
        }
        seen.push(tool.name.clone());
        tools.push(tool);
    }
    Ok(Manifest {
        cooldown_days: file.defaults.cooldown_days,
        tools,
    })
}

fn normalize(raw: RawTool) -> Result<Tool> {
    let name = raw.name.trim().to_string();
    if name.is_empty() {
        bail!("missing name");
    }
    let method = Method::parse(&name, &raw.method)?;
    let status = parse_status(&name, raw.status.as_deref())?;
    let version = nonempty(raw.version);
    let sha256 = nonempty(raw.sha256);
    if status != Status::Pending && version.is_none() {
        bail!("{name}: missing version");
    }
    match method {
        Method::Release => {
            require(&name, "repo", raw.repo.as_deref())?;
            require(&name, "asset", raw.asset.as_deref())?;
            require(&name, "checksum", raw.checksum.as_deref())?;
            require(&name, "bin", raw.bin.as_deref())?;
            if status != Status::Pending {
                require(&name, "version", version.as_deref())?;
            }
        }
        Method::Vendor => {
            require(&name, "url", raw.url.as_deref())?;
            require(&name, "bin", raw.bin.as_deref())?;
        }
        Method::Bun => {
            require(&name, "package", raw.package.as_deref())?;
            if status != Status::Pending {
                require(&name, "version", version.as_deref())?;
            }
        }
        Method::Go => {
            require(&name, "module", raw.module.as_deref())?;
            if status != Status::Pending {
                require(&name, "version", version.as_deref())?;
            }
        }
        Method::Cargo => {
            require(&name, "package", raw.package.as_deref())?;
            if status != Status::Pending {
                require(&name, "version", version.as_deref())?;
            }
        }
    }
    check_https(&name, "url", raw.url.as_deref())?;
    check_https(&name, "sig_url", raw.sig_url.as_deref())?;
    Ok(Tool {
        name,
        method,
        repo: nonempty(raw.repo),
        url: nonempty(raw.url),
        sig_url: nonempty(raw.sig_url),
        gpg_fingerprint: nonempty(raw.gpg_fingerprint),
        sig: nonempty(raw.sig),
        key_file: nonempty(raw.key_file),
        sha256,
        version,
        version_from: nonempty(raw.version_from),
        asset: nonempty(raw.asset),
        checksum: nonempty(raw.checksum),
        package: nonempty(raw.package),
        module: nonempty(raw.module),
        bin: nonempty(raw.bin),
        exe: nonempty(raw.exe),
        priority: raw.priority.trim().to_string(),
        group: raw.group.trim().to_string(),
        category: raw.category.trim().to_string(),
        env: raw.env,
        probe: raw.probe,
        status,
    })
}

fn parse_status(name: &str, raw: Option<&str>) -> Result<Status> {
    match raw.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(Status::Ready),
        Some("pending") => Ok(Status::Pending),
        Some(other) => bail!("{name}: unknown status: {other}"),
    }
}

fn require(name: &str, field: &str, value: Option<&str>) -> Result<()> {
    if nonempty_ref(value).is_none() {
        bail!("{name}: missing {field}");
    }
    Ok(())
}

fn check_https(name: &str, field: &str, value: Option<&str>) -> Result<()> {
    let Some(value) = nonempty_ref(value) else {
        return Ok(());
    };
    if value.starts_with("https://")
        && value.len() > "https://".len()
        && !value.contains(char::is_whitespace)
    {
        return Ok(());
    }
    bail!("{name}: {field} must be https");
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn nonempty_ref(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(body: &str) -> String {
        format!("[defaults]\ncooldown_days = 7\n\n[[tool]]\n{body}\n")
    }

    fn release(extra: &str) -> String {
        wrap(&format!(
            "name = \"litestream\"\nmethod = \"release\"\nrepo = \"benbjohnson/litestream\"\nversion = \"0.5.17\"\nasset = \"litestream-{{version}}-linux-x86_64.tar.gz\"\nchecksum = \"checksums.txt\"\nbin = \"litestream\"\n{extra}"
        ))
    }

    #[test]
    fn parses_seed_file() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tools.toml");
        let manifest = load_path(&path).unwrap();
        assert_eq!(manifest.cooldown_days, 7);
        assert_eq!(manifest.tools.len(), 11);
        assert_eq!(manifest.tools[0].name, "litestream");
        assert_eq!(manifest.tools[0].method, Method::Release);
        assert_eq!(manifest.tools[1].name, "aws");
        assert_eq!(manifest.tools[1].exe_name(), "aws");
        assert_eq!(manifest.tools[1].status, Status::Pending);
        assert!(manifest.tools[1].version.is_none());
        assert!(manifest.tools[1].sha256.is_none());
        let gcloud = manifest
            .tools
            .iter()
            .find(|tool| tool.name == "gcloud")
            .unwrap();
        assert_eq!(gcloud.exe_name(), "gcloud");
        assert_eq!(gcloud.bin.as_deref(), Some("google-cloud-sdk/bin/gcloud"));
        let ant = manifest
            .tools
            .iter()
            .find(|tool| tool.name == "ant")
            .unwrap();
        assert_eq!(ant.method, Method::Release);
        assert_eq!(ant.version.as_deref(), Some("2.4.0"));
        let goat = manifest
            .tools
            .iter()
            .find(|tool| tool.name == "goat")
            .unwrap();
        assert_eq!(
            goat.sig.as_deref(),
            Some("goat_{version}_checksums.txt.sig")
        );
        assert_eq!(goat.gpg_fingerprint.as_deref().map(str::len), Some(40));
        assert_eq!(
            manifest
                .tools
                .iter()
                .find(|tool| tool.name == "litestream")
                .unwrap()
                .exe_name(),
            "litestream"
        );
    }

    #[test]
    fn rejects_duplicate_names() {
        let text = format!("{}\n[[tool]]\nname = \"litestream\"\nmethod = \"vendor\"\nurl = \"https://example.com/a\"\nbin = \"litestream\"\nversion = \"1\"\n", release(""));
        let error = load_str(&text).unwrap_err().to_string();
        assert!(error.contains("duplicate name"), "{error}");
    }

    #[test]
    fn rejects_unknown_method() {
        let error = load_str(&wrap("name = \"x\"\nmethod = \"npm\"\nversion = \"1\"\n"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("unknown method"), "{error}");
    }

    #[test]
    fn release_requires_repo_version_asset_checksum_bin() {
        for (field, body) in [
            ("repo", "name = \"x\"\nmethod = \"release\"\nversion = \"1\"\nasset = \"a\"\nchecksum = \"c\"\nbin = \"x\"\n"),
            ("version", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nasset = \"a\"\nchecksum = \"c\"\nbin = \"x\"\n"),
            ("asset", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nchecksum = \"c\"\nbin = \"x\"\n"),
            ("checksum", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nasset = \"a\"\nbin = \"x\"\n"),
            ("bin", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nasset = \"a\"\nchecksum = \"c\"\n"),
        ] {
            let error = load_str(&wrap(body)).unwrap_err().to_string();
            assert!(error.contains(&format!("missing {field}")), "{field}: {error}");
        }
    }

    #[test]
    fn vendor_requires_url_and_bin() {
        let missing_url = load_str(&wrap(
            "name = \"aws\"\nmethod = \"vendor\"\nbin = \"aws\"\nversion = \"1\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(missing_url.contains("missing url"), "{missing_url}");
        let missing_bin = load_str(&wrap(
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nversion = \"1\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(missing_bin.contains("missing bin"), "{missing_bin}");
    }

    #[test]
    fn bun_requires_package_and_version() {
        let missing_package = load_str(&wrap("name = \"cf\"\nmethod = \"bun\"\nversion = \"1\"\n"))
            .unwrap_err()
            .to_string();
        assert!(
            missing_package.contains("missing package"),
            "{missing_package}"
        );
        let missing_version =
            load_str(&wrap("name = \"cf\"\nmethod = \"bun\"\npackage = \"cf\"\n"))
                .unwrap_err()
                .to_string();
        assert!(
            missing_version.contains("missing version"),
            "{missing_version}"
        );
    }

    #[test]
    fn go_requires_module_and_version() {
        let missing_module = load_str(&wrap("name = \"ant\"\nmethod = \"go\"\nversion = \"1\"\n"))
            .unwrap_err()
            .to_string();
        assert!(
            missing_module.contains("missing module"),
            "{missing_module}"
        );
        let missing_version = load_str(&wrap(
            "name = \"ant\"\nmethod = \"go\"\nmodule = \"github.com/example/ant\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(
            missing_version.contains("missing version"),
            "{missing_version}"
        );
    }

    #[test]
    fn cargo_requires_package_and_version() {
        let missing_package = load_str(&wrap(
            "name = \"toy\"\nmethod = \"cargo\"\nversion = \"1\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(
            missing_package.contains("missing package"),
            "{missing_package}"
        );
        let missing_version = load_str(&wrap(
            "name = \"toy\"\nmethod = \"cargo\"\npackage = \"toy\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(
            missing_version.contains("missing version"),
            "{missing_version}"
        );
    }

    #[test]
    fn non_pending_requires_version() {
        let error = load_str(&wrap(
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nbin = \"aws\"\n",
        ))
        .unwrap_err()
        .to_string();
        assert!(error.contains("missing version"), "{error}");
    }

    #[test]
    fn pending_allows_empty_version_and_sha256() {
        let manifest = load_str(&wrap(
            "name = \"ant\"\nmethod = \"go\"\nmodule = \"github.com/example/ant\"\nstatus = \"pending\"\nsha256 = \"\"\nversion = \"\"\n",
        ))
        .unwrap();
        assert_eq!(manifest.tools[0].status, Status::Pending);
        assert!(manifest.tools[0].version.is_none());
        assert!(manifest.tools[0].sha256.is_none());
    }

    #[test]
    fn rejects_non_https_url() {
        for body in [
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"http://example.com/a.zip\"\nbin = \"aws\"\nversion = \"1\"\n",
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nsig_url = \"http://example.com/a.zip.sig\"\nbin = \"aws\"\nversion = \"1\"\n",
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"file:///tmp/a.zip\"\nbin = \"aws\"\nversion = \"1\"\n",
        ] {
            let error = load_str(&wrap(body)).unwrap_err().to_string();
            assert!(error.contains("must be https"), "{error}");
        }
        let ok = load_str(&wrap(
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nsig_url = \"https://example.com/a.zip.sig\"\nbin = \"aws\"\nversion = \"1\"\n",
        ))
        .unwrap();
        assert_eq!(
            ok.tools[0].url.as_deref(),
            Some("https://example.com/a.zip")
        );
    }

    #[test]
    fn exe_defaults_to_name() {
        let manifest = load_str(&release("")).unwrap();
        assert_eq!(manifest.tools[0].exe_name(), "litestream");
        let manifest = load_str(&wrap(
            "name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nbin = \"aws/dist/aws\"\nexe = \"aws\"\nversion = \"1\"\n",
        ))
        .unwrap();
        assert_eq!(manifest.tools[0].exe_name(), "aws");
    }
}
