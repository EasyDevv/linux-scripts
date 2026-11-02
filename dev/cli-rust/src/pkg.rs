//! bun / go / cargo 방식 설치·삭제. 플랜 §3 표.
//! proto 플러그인 없이 각 도구의 공식 명령을 쓰되, 설치 전에 cooldown 을 직접 판정한다.
//! 상태는 `lock.json` 에만 기록한다.

use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};

use crate::cooldown::check_cooldown;
use crate::engine::run_external;
use crate::gate::Blocked;
use crate::http::HostPolicy;
use crate::install::{approve, Env, Outcome};
use crate::lock::{Guard, LockEntry, LockFile};
use crate::manifest::{Method, Status, Tool};
use crate::paths::Paths;
use crate::pin::write_version;
use crate::resolve::{latest_candidate, npm_version_info, published_at, HttpFetch};

/// 외부 명령 한 번의 계획(프로그램, 인자 배열, 추가 환경변수).
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub program: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
}

pub fn bun_install_plan(paths: &Paths, package: &str, version: &str, cooldown_days: u32) -> Plan {
    Plan {
        program: paths.bun_bin.clone(),
        args: vec![
            "add".into(),
            "-g".into(),
            format!("{package}@{version}"),
            // 의존성의 lifecycle script 는 실행하지 않고, 의존성까지 같은 cooldown 을 적용한다.
            "--ignore-scripts".into(),
            format!("--minimum-release-age={}", u64::from(cooldown_days) * 86_400),
        ],
        envs: Vec::new(),
    }
}

pub fn bun_remove_plan(paths: &Paths, package: &str) -> Plan {
    Plan {
        program: paths.bun_bin.clone(),
        args: vec!["remove".into(), "-g".into(), package.into()],
        envs: Vec::new(),
    }
}

pub fn go_install_plan(paths: &Paths, module: &str, version: &str) -> Plan {
    Plan {
        program: paths.go_bin.clone(),
        args: vec!["install".into(), format!("{module}@{}", go_version(version))],
        envs: vec![("GOBIN".into(), paths.bin_dir().display().to_string())],
    }
}

pub fn cargo_install_plan(paths: &Paths, package: &str, version: &str) -> Plan {
    Plan {
        program: paths.cargo_bin.clone(),
        args: vec![
            "install".into(),
            "--locked".into(),
            "--root".into(),
            paths.prefix.display().to_string(),
            format!("{package}@{version}"),
        ],
        envs: Vec::new(),
    }
}

pub fn cargo_uninstall_plan(paths: &Paths, package: &str) -> Plan {
    Plan {
        program: paths.cargo_bin.clone(),
        args: vec![
            "uninstall".into(),
            "--root".into(),
            paths.prefix.display().to_string(),
            package.into(),
        ],
        envs: Vec::new(),
    }
}

/// Go 는 버전에 `v` 를 붙여 쓴다.
fn go_version(version: &str) -> String {
    if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{version}")
    }
}

fn plain_version(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

fn run(paths: &Paths, plan: &Plan) -> Result<()> {
    run_external(&plan.program, &plan.args, &paths.cli_home, &plan.envs).map(|_| ())
}

/// 실행 파일이 놓이는 경로.
fn bin_path(paths: &Paths, tool: &Tool) -> PathBuf {
    match tool.method {
        Method::Bun => paths.bun_global_bin().join(tool.exe_name()),
        _ => paths.bin_dir().join(tool.exe_name()),
    }
}

fn package_of(tool: &Tool) -> Result<&str> {
    let value = match tool.method {
        Method::Go => tool.module.as_deref(),
        _ => tool.package.as_deref(),
    };
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| anyhow!("{}: package/module 이 없습니다", tool.name))
}

/// `bun.lock` 에서 `package@version` 항목 뒤의 첫 `sha512-…` 값.
pub fn bun_lock_integrity(text: &str, package: &str, version: &str) -> Option<String> {
    let key = format!("\"{package}@{version}\"");
    let rest = &text[text.find(&key)? + key.len()..];
    let start = rest.find("sha512-")?;
    let value: String = rest[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '-'))
        .collect();
    Some(value)
}

pub fn install(env: &Env<'_>, tool: &Tool, _replace: bool) -> Result<Outcome> {
    let package = package_of(tool)?.to_string();
    let policy = HostPolicy::for_tool(tool);
    let fetch = HttpFetch::new(policy)?;

    let pending = tool.status == Status::Pending;
    let version = match tool.version.as_deref().filter(|v| !v.is_empty()) {
        Some(version) => plain_version(version).to_string(),
        None if pending => plain_version(&latest_candidate(tool, &fetch)?).to_string(),
        None => bail!("{}: tools.toml 에 version 이 없습니다", tool.name),
    };

    let (published, integrity) = match tool.method {
        Method::Bun => npm_version_info(tool, &version, &fetch)?,
        _ => (published_at(tool, &version, &fetch)?, None),
    };
    check_cooldown(published, env.now, env.cooldown_days)
        .map_err(|violation| anyhow::Error::from(Blocked::Cooldown(violation)))?;

    let (plan, level) = match tool.method {
        Method::Bun => (
            bun_install_plan(env.paths, &package, &version, env.cooldown_days),
            "registry",
        ),
        Method::Go => (go_install_plan(env.paths, &package, &version), "sumdb"),
        _ => (cargo_install_plan(env.paths, &package, &version), "locked"),
    };

    if env.dry_run {
        return Ok(Outcome::DryRun {
            version,
            decision: format!(
                "통과: cooldown {}일 이상 ({}), 실행: {} {}",
                env.cooldown_days,
                published.format("%Y-%m-%d"),
                plan.program,
                plan.args.join(" ")
            ),
        });
    }

    approve(env, &format!("{} {} ({level}) 를 설치할까요?", tool.name, version))?;
    if pending {
        write_version(env.manifest_path, &tool.name, &version)?;
    }

    let _guard = Guard::acquire(&env.paths.lock_json())?;
    env.paths.ensure_cli_home()?;
    if matches!(tool.method, Method::Go | Method::Cargo) {
        fs::create_dir_all(env.paths.bin_dir())?;
    }
    run(env.paths, &plan)?;

    let bin = bin_path(env.paths, tool);
    if !bin.exists() {
        bail!(
            "{}: 설치 후 실행 파일 {} 이 없습니다 (tools.toml 의 bin 이 실제 이름과 같은지 확인)",
            tool.name,
            bin.display()
        );
    }

    // bun: 전역 lock 에 기록된 integrity 가 레지스트리 값과 같아야 한다.
    if tool.method == Method::Bun {
        if let (Some(expected), Ok(text)) = (&integrity, fs::read_to_string(env.paths.bun_global_lock())) {
            if let Some(actual) = bun_lock_integrity(&text, &package, &version) {
                if &actual != expected {
                    let _ = run(env.paths, &bun_remove_plan(env.paths, &package));
                    return Err(anyhow::Error::from(Blocked::HashMismatch(
                        crate::checksum::ChecksumMismatch {
                            expected: expected.clone(),
                            actual,
                        },
                    )));
                }
            } else {
                eprintln!("경고: bun.lock 에 {package}@{version} integrity 가 없어 교차 대조를 건너뜀");
            }
        }
    }

    let mut lock = LockFile::load(&env.paths.lock_json())?;
    lock.tools.insert(
        tool.name.clone(),
        LockEntry {
            method: tool.method.as_str().to_string(),
            version: version.clone(),
            source: match tool.method {
                Method::Bun => format!("https://registry.npmjs.org/{package}"),
                Method::Go => format!("https://proxy.golang.org/{package}"),
                _ => format!("https://crates.io/crates/{package}"),
            },
            digest: integrity.unwrap_or_default(),
            level: level.to_string(),
            package,
            bin: bin.display().to_string(),
            installed_at: env.now.to_rfc3339(),
            previous: crate::install::previous_of(&lock, &tool.name, &version),
        },
    );
    lock.save(&env.paths.lock_json())?;
    Ok(Outcome::Installed {
        version,
        level: level.to_string(),
    })
}

/// 삭제 계획을 사람이 읽을 문장으로.
pub fn describe_removal(paths: &Paths, entry: &LockEntry) -> String {
    match entry.method.as_str() {
        "bun" => format!("bun remove -g {}", entry.package),
        "cargo" => format!("cargo uninstall --root {} {}", paths.prefix.display(), entry.package),
        _ => format!("파일 삭제 {}", entry.bin),
    }
}

pub fn uninstall(paths: &Paths, entry: &LockEntry) -> Result<()> {
    match entry.method.as_str() {
        "bun" => run(paths, &bun_remove_plan(paths, &entry.package)),
        "cargo" => run(paths, &cargo_uninstall_plan(paths, &entry.package)),
        "go" => {
            // go 는 제거 명령이 없다. lock 이 기록한 바이너리 하나만 지운다.
            let bin = PathBuf::from(&entry.bin);
            if !bin.starts_with(paths.bin_dir()) {
                bail!("{} 는 {} 밖이라 지우지 않습니다", bin.display(), paths.bin_dir().display());
            }
            match fs::remove_file(&bin) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error).with_context(|| format!("remove {}", bin.display())),
            }
        }
        other => bail!("{other}: 지원하지 않는 방식"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> Paths {
        let mut paths = Paths::new("/h/cli".into(), "/h/state".into(), "proto");
        paths.prefix = "/h/.local".into();
        paths
    }

    #[test]
    fn bun_install_ignores_scripts_and_sets_the_cooldown_in_seconds() {
        let plan = bun_install_plan(&paths(), "cf", "1.0.0-beta.26", 7);
        assert_eq!(plan.program, "bun");
        assert_eq!(
            plan.args,
            ["add", "-g", "cf@1.0.0-beta.26", "--ignore-scripts", "--minimum-release-age=604800"]
        );
    }

    #[test]
    fn go_install_pins_the_version_and_targets_the_prefix_bin() {
        let plan = go_install_plan(&paths(), "github.com/x/y/cmd/y", "1.2.3");
        assert_eq!(plan.args, ["install", "github.com/x/y/cmd/y@v1.2.3"]);
        assert_eq!(plan.envs, [("GOBIN".to_string(), "/h/.local/bin".to_string())]);
        assert_eq!(go_install_plan(&paths(), "m", "v1.2.3").args[1], "m@v1.2.3");
    }

    #[test]
    fn cargo_install_is_locked_and_rooted_at_the_prefix() {
        let plan = cargo_install_plan(&paths(), "ripgrep", "14.1.0");
        assert_eq!(
            plan.args,
            ["install", "--locked", "--root", "/h/.local", "ripgrep@14.1.0"]
        );
        assert_eq!(
            cargo_uninstall_plan(&paths(), "ripgrep").args,
            ["uninstall", "--root", "/h/.local", "ripgrep"]
        );
    }

    #[test]
    fn bun_lock_integrity_reads_the_hash_after_the_entry() {
        let text = r#"{ "packages": {
  "other": ["other@1.0.0", "", {}, "sha512-AAAA=="],
  "cf": ["cf@1.0.0-beta.26", "", { "bin": { "cf": "bin/cf" } }, "sha512-Zm9v+/bar=="],
}}"#;
        assert_eq!(
            bun_lock_integrity(text, "cf", "1.0.0-beta.26").as_deref(),
            Some("sha512-Zm9v+/bar==")
        );
        assert_eq!(bun_lock_integrity(text, "cf", "9.9.9"), None);
    }

    #[test]
    fn go_removal_refuses_paths_outside_the_bin_dir() {
        let entry = LockEntry {
            method: "go".into(),
            version: "1.0.0".into(),
            source: String::new(),
            digest: String::new(),
            level: "sumdb".into(),
            package: "m".into(),
            bin: "/etc/passwd".into(),
            installed_at: String::new(),
            previous: None,
        };
        assert!(uninstall(&paths(), &entry).is_err());
    }
}
