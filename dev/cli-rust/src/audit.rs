//! `cli audit` — 목록 정책 점검 + `osv-scanner` 취약점 스캔.
//! 종료 코드: 0 문제 없음, 2 정책 위반 또는 취약점 발견, 1 스캔 도구 오류(main 이 매핑).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::Serialize;

use crate::lock::LockFile;
use crate::manifest::{Manifest, Method, Status, Tool};
use crate::paths::Paths;

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct PolicyFinding {
    pub tool: String,
    /// error | warn
    pub severity: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct VulnFinding {
    pub target: String,
    pub package: String,
    pub version: String,
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, Default)]
pub struct Report {
    pub policy: Vec<PolicyFinding>,
    pub vulns: Vec<VulnFinding>,
    pub scanned: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

impl Report {
    /// 0 정상, 2 위반·취약점, 1 스캔 오류(위반이 없을 때만).
    pub fn exit_code(&self) -> i32 {
        let violations = self.policy.iter().any(|f| f.severity == "error") || !self.vulns.is_empty();
        if violations {
            crate::manifest::EXIT_BLOCKED
        } else if !self.errors.is_empty() {
            crate::manifest::EXIT_ERROR
        } else {
            0
        }
    }
}

/// 목록과 lock 만 보는 정책 점검(네트워크 없음).
pub fn policy_findings(manifest: &Manifest, lock: &LockFile) -> Vec<PolicyFinding> {
    let mut out = Vec::new();
    let mut push = |tool: &str, severity: &'static str, message: String| {
        out.push(PolicyFinding {
            tool: tool.to_string(),
            severity,
            message,
        });
    };
    for tool in &manifest.tools {
        if tool.status == Status::Pending {
            push(&tool.name, "warn", "버전·해시가 아직 고정되지 않음(pending)".into());
            continue;
        }
        match tool.method {
            Method::Release if tool.checksum.is_none() => {
                push(&tool.name, "error", "release 인데 체크섬 파일이 지정되지 않음".into());
            }
            Method::Vendor if !has_verification(tool) => {
                push(&tool.name, "error", "vendor 인데 서명·체크섬·고정 sha256 이 모두 없음".into());
            }
            _ => {}
        }
        if let Some(entry) = lock.tools.get(&tool.name) {
            if let Some(wanted) = tool.version.as_deref() {
                if wanted.trim_start_matches('v') != entry.version.trim_start_matches('v') {
                    push(&tool.name, "warn", format!("lock {} ≠ 목록 {}", entry.version, wanted));
                }
            }
            if entry.level == "pinned" {
                push(&tool.name, "warn", "서명·체크섬 없이 고정 해시로만 검증됨".into());
            }
            if let (Some(pinned), true) = (tool.sha256.as_deref(), entry.level == "pinned") {
                if !pinned.eq_ignore_ascii_case(&entry.digest) {
                    push(&tool.name, "error", "lock 해시가 목록에 고정된 sha256 과 다름".into());
                }
            }
        }
    }
    for name in lock.tools.keys() {
        if !manifest.tools.iter().any(|tool| &tool.name == name) {
            push(name, "warn", "lock 에는 있으나 목록(tools.toml)에 없음".into());
        }
    }
    out
}

fn has_verification(tool: &Tool) -> bool {
    tool.sha256.is_some()
        || tool.checksum.is_some()
        || (tool.sig_url.is_some() && tool.gpg_fingerprint.is_some())
}

#[derive(Debug, Clone)]
pub enum Source {
    /// `go/binary` 플러그인으로 폴더 안의 Go 바이너리를 읽는다.
    Binaries(PathBuf),
    /// 잠금 파일(bun.lock, Cargo.lock 등).
    Lockfile(PathBuf),
}

#[derive(Debug, Clone)]
pub struct Target {
    pub label: String,
    pub source: Source,
}

/// lock 에 기록된 도구와 이 크레이트의 Cargo.lock 에서 스캔 대상을 모은다.
pub fn targets(paths: &Paths, lock: &LockFile, crate_lock: Option<&Path>, skipped: &mut Vec<String>) -> Vec<Target> {
    let mut out = Vec::new();
    let mut bun_added = false;
    for (name, entry) in &lock.tools {
        match entry.method.as_str() {
            "release" | "vendor" => {
                let root = paths.proto_tool_dir(name, &entry.version);
                if root.is_dir() {
                    out.push(Target {
                        label: name.clone(),
                        source: Source::Binaries(root),
                    });
                } else {
                    skipped.push(format!("{name}: 설치 폴더 {} 없음", root.display()));
                }
            }
            "go" => {
                let dir = paths.tmp_dir(&format!("audit-{name}"));
                match stage_binary(Path::new(&entry.bin), &dir) {
                    Ok(()) => out.push(Target {
                        label: name.clone(),
                        source: Source::Binaries(dir),
                    }),
                    Err(error) => skipped.push(format!("{name}: {error:#}")),
                }
            }
            "bun" => {
                if !bun_added {
                    bun_added = true;
                    let lockfile = paths.bun_global_lock();
                    if lockfile.is_file() {
                        out.push(Target {
                            label: "bun-global".into(),
                            source: Source::Lockfile(lockfile),
                        });
                    }
                }
            }
            "cargo" => skipped.push(format!("{name}: cargo 바이너리는 의존성 정보가 없어 스캔하지 못함")),
            _ => {}
        }
    }
    if let Some(path) = crate_lock.filter(|path| path.is_file()) {
        out.push(Target {
            label: "cli(Cargo.lock)".into(),
            source: Source::Lockfile(path.to_path_buf()),
        });
    }
    out
}

fn stage_binary(bin: &Path, dir: &Path) -> Result<()> {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir)?;
    let name = bin.file_name().context("bin has no file name")?;
    let dest = dir.join(name);
    if fs::hard_link(bin, &dest).is_err() {
        fs::copy(bin, &dest).with_context(|| format!("copy {}", bin.display()))?;
    }
    Ok(())
}

/// osv-scanner JSON 출력에서 취약점이 있는 패키지만 뽑는다.
pub fn parse_osv_json(text: &str, label: &str) -> Result<Vec<VulnFinding>> {
    let value: serde_json::Value = serde_json::from_str(text).context("osv-scanner 출력이 JSON 이 아님")?;
    let mut out: Vec<VulnFinding> = Vec::new();
    for result in value.get("results").and_then(|v| v.as_array()).into_iter().flatten() {
        for package in result.get("packages").and_then(|v| v.as_array()).into_iter().flatten() {
            let ids: Vec<String> = package
                .get("vulnerabilities")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|vuln| vuln.get("id").and_then(|id| id.as_str()).map(str::to_string))
                .collect();
            if ids.is_empty() {
                continue;
            }
            let name = package.pointer("/package/name").and_then(|v| v.as_str()).unwrap_or("?");
            let version = package.pointer("/package/version").and_then(|v| v.as_str()).unwrap_or("?");
            if !out.iter().any(|f| f.package == name && f.version == version) {
                out.push(VulnFinding {
                    target: label.to_string(),
                    package: name.to_string(),
                    version: version.to_string(),
                    ids,
                });
            }
        }
    }
    Ok(out)
}

pub fn osv_args(source: &Source, out_file: &Path) -> Vec<String> {
    let mut args: Vec<String> = vec!["scan".into(), "source".into()];
    match source {
        Source::Binaries(dir) => {
            args.extend([
                "--x-no-default-plugins".into(),
                "--x-plugins=go/binary".into(),
                "--format".into(),
                "json".into(),
                "--output-file".into(),
                out_file.display().to_string(),
                dir.display().to_string(),
            ]);
        }
        Source::Lockfile(path) => {
            args.extend([
                "--format".into(),
                "json".into(),
                "--output-file".into(),
                out_file.display().to_string(),
                "-L".into(),
                path.display().to_string(),
            ]);
        }
    }
    args
}

/// osv-scanner 한 번 실행. 종료 코드 0·1(취약점 있음)은 정상, 128(대상 없음)은 빈 결과.
pub fn run_osv(osv_bin: &str, target: &Target, out_file: &Path) -> Result<Vec<VulnFinding>> {
    let _ = fs::remove_file(out_file);
    let args = osv_args(&target.source, out_file);
    let output = Command::new(osv_bin)
        .args(&args)
        .output()
        .with_context(|| format!("run {osv_bin}"))?;
    let code = output.status.code().unwrap_or(-1);
    match code {
        0 | 1 => {
            let text = fs::read_to_string(out_file)
                .with_context(|| format!("{}: 결과 파일이 없음 (exit {code})", target.label))?;
            parse_osv_json(&text, &target.label)
        }
        128 => Ok(Vec::new()),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
            bail!("{}: osv-scanner exit {code}: {}", target.label, tail.into_iter().rev().collect::<Vec<_>>().join(" | "))
        }
    }
}

pub fn audit(
    manifest: &Manifest,
    lock: &LockFile,
    paths: &Paths,
    crate_lock: Option<&Path>,
    scan: &dyn Fn(&Target, &Path) -> Result<Vec<VulnFinding>>,
) -> Report {
    let mut report = Report {
        policy: policy_findings(manifest, lock),
        ..Report::default()
    };
    let targets = targets(paths, lock, crate_lock, &mut report.skipped);
    let out_dir = paths.tmp_dir("audit");
    if let Err(error) = fs::create_dir_all(&out_dir) {
        report.errors.push(format!("임시 폴더: {error}"));
        return report;
    }
    for target in &targets {
        let out_file = out_dir.join("osv.json");
        match scan(target, &out_file) {
            Ok(found) => {
                report.scanned.push(target.label.clone());
                report.vulns.extend(found);
            }
            Err(error) => report.errors.push(format!("{error:#}")),
        }
    }
    let _ = fs::remove_dir_all(&out_dir);
    for tool in lock.tools.keys() {
        let _ = fs::remove_dir_all(paths.tmp_dir(&format!("audit-{tool}")));
    }
    report
}

pub fn render(report: &Report) -> String {
    let mut out = String::new();
    for finding in &report.policy {
        out.push_str(&format!("[정책/{}] {}: {}\n", finding.severity, finding.tool, finding.message));
    }
    for vuln in &report.vulns {
        out.push_str(&format!(
            "[취약점] {}: {} {} — {}\n",
            vuln.target,
            vuln.package,
            vuln.version,
            vuln.ids.join(", ")
        ));
    }
    for note in &report.skipped {
        out.push_str(&format!("[건너뜀] {note}\n"));
    }
    for error in &report.errors {
        out.push_str(&format!("[오류] {error}\n"));
    }
    out.push_str(&format!(
        "스캔 {}건 · 정책 {}건 · 취약 패키지 {}개 · 오류 {}건\n",
        report.scanned.len(),
        report.policy.len(),
        report.vulns.len(),
        report.errors.len()
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lock::LockEntry;
    use crate::manifest::load_str;
    use std::os::unix::fs::PermissionsExt;

    fn entry(method: &str, level: &str, digest: &str, bin: &str) -> LockEntry {
        LockEntry {
            method: method.into(),
            version: "1.0.0".into(),
            source: String::new(),
            digest: digest.into(),
            level: level.into(),
            package: "p".into(),
            bin: bin.into(),
            installed_at: String::new(),
            previous: None,
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cli-audit-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const OSV: &str = r#"{"results":[{"source":{"path":"/x/bin","type":"filesystem"},"packages":[
      {"package":{"name":"golang.org/x/net","version":"0.61.0","ecosystem":"Go"},"vulnerabilities":[{"id":"GO-1"},{"id":"GO-2"}]},
      {"package":{"name":"safe","version":"1.0.0","ecosystem":"Go"},"vulnerabilities":[]},
      {"package":{"name":"golang.org/x/net","version":"0.61.0","ecosystem":"Go"},"vulnerabilities":[{"id":"GO-1"}]}]}]}"#;

    #[test]
    fn parses_only_vulnerable_packages_once() {
        let found = parse_osv_json(OSV, "t").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].package, "golang.org/x/net");
        assert_eq!(found[0].ids, ["GO-1", "GO-2"]);
        assert!(parse_osv_json("nope", "t").is_err());
        assert!(parse_osv_json("{}", "t").unwrap().is_empty());
    }

    #[test]
    fn osv_args_pick_the_binary_plugin_or_a_lockfile() {
        let out = Path::new("/o.json");
        let bin = osv_args(&Source::Binaries("/d".into()), out);
        assert!(bin.contains(&"--x-plugins=go/binary".to_string()));
        assert_eq!(bin.last().unwrap(), "/d");
        let lockf = osv_args(&Source::Lockfile("/l/bun.lock".into()), out);
        assert_eq!(&lockf[lockf.len() - 2..], ["-L", "/l/bun.lock"]);
    }

    #[test]
    fn policy_flags_unverifiable_vendor_pending_and_unknown_lock_entries() {
        let toml = "[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"v1\"\nmethod = \"vendor\"\nurl = \"https://e.com/a.zip\"\nbin = \"v1\"\nversion = \"1.0.0\"\n\n[[tool]]\nname = \"v2\"\nmethod = \"vendor\"\nurl = \"https://e.com/b.zip\"\nbin = \"v2\"\nstatus = \"pending\"\n\n[[tool]]\nname = \"v3\"\nmethod = \"vendor\"\nurl = \"https://e.com/c.zip\"\nbin = \"v3\"\nversion = \"1.0.0\"\nsha256 = \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"\n";
        let manifest = load_str(toml).unwrap();
        let mut lock = LockFile::default();
        lock.tools.insert("v3".into(), entry("vendor", "pinned", &"b".repeat(64), "/x"));
        lock.tools.insert("ghost".into(), entry("release", "checksum", "", "/y"));
        let findings = policy_findings(&manifest, &lock);
        let has = |tool: &str, sev: &str, text: &str| {
            findings.iter().any(|f| f.tool == tool && f.severity == sev && f.message.contains(text))
        };
        assert!(has("v1", "error", "모두 없음"));
        assert!(has("v2", "warn", "pending"));
        assert!(has("v3", "error", "다름"));
        assert!(has("v3", "warn", "고정 해시로만"));
        assert!(has("ghost", "warn", "목록"));
    }

    #[test]
    fn exit_code_is_2_for_vulns_or_errors_only_when_nothing_else() {
        let mut report = Report::default();
        assert_eq!(report.exit_code(), 0);
        report.errors.push("x".into());
        assert_eq!(report.exit_code(), 1);
        report.vulns.push(VulnFinding { target: "t".into(), package: "p".into(), version: "1".into(), ids: vec!["A".into()] });
        assert_eq!(report.exit_code(), 2);
        let mut warn_only = Report::default();
        warn_only.policy.push(PolicyFinding { tool: "t".into(), severity: "warn", message: "m".into() });
        assert_eq!(warn_only.exit_code(), 0);
    }

    #[test]
    fn a_fake_osv_scanner_with_a_known_vulnerable_module_yields_code_2() {
        let dir = tmp("fake");
        let fake = dir.join("osv");
        // 마지막 --output-file 값에 고정 JSON 을 쓰고 취약점 있음(1)으로 끝난다.
        fs::write(
            &fake,
            format!(
                "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--output-file\" ]; then out=\"$2\"; fi; shift; done\ncat > \"$out\" <<'EOF'\n{OSV}\nEOF\nexit 1\n"
            ),
        )
        .unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();

        let paths = Paths::new(dir.join("home"), dir.join("state"), "proto");
        let tool_dir = paths.proto_tool_dir("lite", "1.0.0");
        fs::create_dir_all(&tool_dir).unwrap();
        let mut lock = LockFile::default();
        lock.tools.insert("lite".into(), entry("release", "checksum", "", "/s/lite"));
        let manifest = load_str("[defaults]\ncooldown_days = 7\n").unwrap();
        let bin = fake.display().to_string();
        let report = audit(&manifest, &lock, &paths, None, &|target, out| run_osv(&bin, target, out));
        assert_eq!(report.scanned, ["lite"]);
        assert_eq!(report.vulns.len(), 1);
        assert_eq!(report.exit_code(), 2);
        assert!(render(&report).contains("golang.org/x/net 0.61.0"));
    }

    #[test]
    fn osv_failure_is_reported_as_an_error_not_a_finding() {
        let dir = tmp("fail");
        let fake = dir.join("osv");
        fs::write(&fake, "#!/bin/sh\necho boom >&2\nexit 7\n").unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let target = Target { label: "t".into(), source: Source::Lockfile("/x".into()) };
        let error = run_osv(&fake.display().to_string(), &target, &dir.join("o.json")).unwrap_err();
        assert!(format!("{error:#}").contains("exit 7"));
    }
}
