//! `cli doctor` — 도구별 설치·버전·PATH 충돌·lock 일치·환경변수 이름 점검(읽기 전용).
//! 환경변수는 이름과 설정 여부만 다루고 값은 읽어 보여주지 않는다.

use std::ffi::OsStr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::lock::LockFile;
use crate::manifest::{Manifest, Tool};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct EnvStatus {
    pub name: String,
    pub set: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Row {
    pub name: String,
    pub method: String,
    /// ok | missing | unmanaged | problem
    pub status: &'static str,
    pub installed: bool,
    pub managed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub locked_version: Option<String>,
    pub manifest_version: Option<String>,
    pub issues: Vec<String>,
    pub env: Vec<EnvStatus>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Runtime {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Report {
    pub tools: Vec<Row>,
    pub runtimes: Vec<Runtime>,
    pub missing: Vec<String>,
    pub problems: usize,
}

const RUNTIMES: [&str; 5] = ["proto", "bun", "go", "cargo", "gpg"];

fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// PATH 순서대로 모든 실행 파일 후보.
pub fn which_all(exe: &str, path: Option<&OsStr>) -> Vec<PathBuf> {
    let Some(path) = path else {
        return Vec::new();
    };
    if exe.is_empty() || exe.contains('/') || exe.contains('\0') {
        return Vec::new();
    }
    let mut found: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(path) {
        let candidate = dir.join(exe);
        if is_executable(&candidate) && !found.iter().any(|seen| same_file(seen, &candidate)) {
            found.push(candidate);
        }
    }
    found
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn inspect_tool(
    tool: &Tool,
    lock: &LockFile,
    path_var: Option<&OsStr>,
    env_set: &dyn Fn(&str) -> bool,
    probe: &dyn Fn(&[String]) -> Option<String>,
) -> Row {
    let matches = which_all(tool.exe_name(), path_var);
    let entry = lock.tools.get(&tool.name);
    let installed = !matches.is_empty();
    let mut issues = Vec::new();
    let mut hard = false;

    let env: Vec<EnvStatus> = tool
        .env
        .iter()
        .map(|name| EnvStatus {
            name: name.clone(),
            set: env_set(name),
        })
        .collect();

    let mut version = None;
    if installed {
        if !tool.probe.is_empty() {
            match probe(&tool.probe) {
                Some(text) => version = Some(text),
                None => {
                    issues.push(format!("프로브 실패: {}", tool.probe.join(" ")));
                    hard = true;
                }
            }
        }
        // proto 는 shims 와 bin 에 같은 도구를 둔다. 둘 다 proto 폴더 안이면 중복으로 보지 않는다.
        let proto_dir = crate::paths::proto_root();
        let others: Vec<String> = matches[1..]
            .iter()
            .filter(|other| !(other.starts_with(&proto_dir) && matches[0].starts_with(&proto_dir)))
            .map(|p| p.display().to_string())
            .collect();
        if !others.is_empty() {
            issues.push(format!("PATH 에 중복: {}", others.join(", ")));
        }
    }

    if let Some(entry) = entry {
        if let Some(wanted) = tool.version.as_deref() {
            if wanted.trim_start_matches('v') != entry.version.trim_start_matches('v') {
                issues.push(format!("lock {} ≠ 목록 {}", entry.version, wanted));
                hard = true;
            }
        }
        if !Path::new(&entry.bin).exists() {
            issues.push(format!("기록된 실행 파일이 없음: {}", entry.bin));
            hard = true;
        } else if let Some(first) = matches.first() {
            if !same_file(first, Path::new(&entry.bin)) {
                issues.push(format!(
                    "PATH 충돌: {} 가 먼저 잡힘 (기록: {})",
                    first.display(),
                    entry.bin
                ));
                hard = true;
            }
        }
    } else if installed {
        issues.push("cli 밖에서 설치됨 (cli install 로 이행 필요)".to_string());
    }

    let status = if !installed {
        issues.insert(0, "미설치".to_string());
        "missing"
    } else if hard {
        "problem"
    } else if entry.is_none() {
        "unmanaged"
    } else {
        "ok"
    };

    Row {
        name: tool.name.clone(),
        method: tool.method.as_str().to_string(),
        status,
        installed,
        managed: entry.is_some(),
        path: matches.first().map(|p| p.display().to_string()),
        version,
        locked_version: entry.map(|e| e.version.clone()),
        manifest_version: tool.version.clone(),
        issues,
        env,
    }
}

pub fn inspect(
    manifest: &Manifest,
    lock: &LockFile,
    path_var: Option<&OsStr>,
    env_set: &dyn Fn(&str) -> bool,
    probe: &dyn Fn(&[String]) -> Option<String>,
) -> Report {
    let tools: Vec<Row> = manifest
        .tools
        .iter()
        .map(|tool| inspect_tool(tool, lock, path_var, env_set, probe))
        .collect();
    let runtimes = RUNTIMES
        .iter()
        .map(|name| {
            let found = which_all(name, path_var);
            Runtime {
                name: (*name).to_string(),
                found: !found.is_empty(),
                path: found.first().map(|p| p.display().to_string()),
            }
        })
        .collect();
    let missing = tools
        .iter()
        .filter(|row| row.status == "missing")
        .map(|row| row.name.clone())
        .collect();
    let problems = tools
        .iter()
        .filter(|row| matches!(row.status, "missing" | "problem"))
        .count();
    Report {
        tools,
        runtimes,
        missing,
        problems,
    }
}

/// 출력에서 보여줄 한 줄. 표(박스 문자)는 숫자가 든 첫 줄을 골라 칸 구분을 공백으로 바꾼다.
fn pick_line(text: &str) -> Option<String> {
    let lines = || text.lines().map(str::trim).filter(|line| !line.is_empty());
    let chosen = if text.contains('│') {
        lines().find(|line| line.contains('│') && line.chars().any(|ch| ch.is_ascii_digit()))?
    } else {
        lines().next()?
    };
    let flat: Vec<&str> = chosen.split(|ch: char| ch == '│' || ch.is_whitespace()).filter(|part| !part.is_empty()).collect();
    Some(flat.join(" ").chars().take(120).collect())
}

/// 읽기 전용 프로브를 10초 제한으로 실행하고 첫 줄만 돌려준다.
pub fn run_probe(argv: &[String]) -> Option<String> {
    let (program, args) = argv.split_first()?;
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    return None;
                }
                let text = String::from_utf8_lossy(&output.stdout).to_string()
                    + &String::from_utf8_lossy(&output.stderr);
                return pick_line(&text);
            }
            None if started.elapsed() > Duration::from_secs(10) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(30)),
        }
    }
}

pub fn render(report: &Report, color_on: bool) -> String {
    use crate::color::{paint, BOLD, DIM, GREEN, RED, YELLOW};
    let mut out = String::new();
    let name_w = report.tools.iter().map(|r| r.name.len()).max().unwrap_or(4).max(4);
    for row in &report.tools {
        let (mark, style): (&str, &[&str]) = match row.status {
            "ok" => ("ok", &[GREEN]),
            "unmanaged" => ("밖", &[YELLOW]),
            "missing" => ("없음", &[DIM]),
            _ => ("문제", &[RED, BOLD]),
        };
        out.push_str(&format!(
            "{:<name_w$}  {}  {}\n",
            row.name,
            paint(&format!("{mark:<4}"), style, color_on),
            row.version.as_deref().unwrap_or("-"),
        ));
        for issue in &row.issues {
            out.push_str(&format!("{:<name_w$}    - {issue}\n", ""));
        }
        let unset: Vec<&str> = row.env.iter().filter(|e| !e.set).map(|e| e.name.as_str()).collect();
        if !row.env.is_empty() {
            let set: Vec<&str> = row.env.iter().filter(|e| e.set).map(|e| e.name.as_str()).collect();
            out.push_str(&format!(
                "{:<name_w$}    env 설정: [{}] 미설정: [{}]\n",
                "",
                set.join(", "),
                unset.join(", ")
            ));
        }
    }
    out.push('\n');
    let runtimes: Vec<String> = report
        .runtimes
        .iter()
        .map(|r| format!("{}{}", r.name, if r.found { "" } else { "(없음)" }))
        .collect();
    out.push_str(&format!("런타임: {}\n", runtimes.join(" ")));
    out.push_str(&format!(
        "미설치 {}개, 문제 {}개\n",
        report.missing.len(),
        report.problems - report.missing.len()
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lock::LockEntry;
    use crate::manifest::load_str;

    const TOML: &str = "[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"aa\"\nmethod = \"vendor\"\nurl = \"https://example.com/aa.zip\"\nbin = \"aa\"\nversion = \"1.0.0\"\nenv = [\"AA_TOKEN\", \"AA_OTHER\"]\nprobe = [\"aa\", \"--version\"]\n\n[[tool]]\nname = \"bb\"\nmethod = \"vendor\"\nurl = \"https://example.com/bb.zip\"\nbin = \"bb\"\nversion = \"2.0.0\"\n\n[[tool]]\nname = \"cc\"\nmethod = \"vendor\"\nurl = \"https://example.com/cc.zip\"\nbin = \"cc\"\nversion = \"3.0.0\"\n";

    fn exe(dir: &Path, name: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn entry(version: &str, bin: &Path) -> LockEntry {
        LockEntry {
            method: "vendor".into(),
            version: version.into(),
            source: String::new(),
            digest: String::new(),
            level: "pinned".into(),
            package: String::new(),
            bin: bin.display().to_string(),
            installed_at: String::new(),
            previous: None,
        }
    }

    #[test]
    fn classifies_ok_unmanaged_missing_and_conflicts_without_reading_env_values() {
        let root = std::env::temp_dir().join(format!("cli-doctor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let first = root.join("first");
        let second = root.join("second");
        let aa = exe(&second, "aa");
        exe(&first, "aa"); // 먼저 잡히는 다른 aa → 충돌
        let bb = exe(&second, "bb");
        let manifest = load_str(TOML).unwrap();
        let mut lock = LockFile::default();
        lock.tools.insert("aa".into(), entry("1.0.0", &aa));
        lock.tools.insert("bb".into(), entry("9.9.9", &bb)); // 목록과 다른 버전
        let path = std::env::join_paths([&first, &second]).unwrap();
        let report = inspect(
            &manifest,
            &lock,
            Some(path.as_os_str()),
            &|name| name == "AA_TOKEN",
            &|_| Some("1.0.0".into()),
        );
        let row = |n: &str| report.tools.iter().find(|r| r.name == n).unwrap();
        assert_eq!(row("aa").status, "problem");
        assert!(row("aa").issues.iter().any(|i| i.contains("PATH 충돌")));
        assert_eq!(
            row("aa").env,
            vec![
                EnvStatus { name: "AA_TOKEN".into(), set: true },
                EnvStatus { name: "AA_OTHER".into(), set: false }
            ]
        );
        assert_eq!(row("bb").status, "problem");
        assert!(row("bb").issues.iter().any(|i| i.contains("lock 9.9.9")));
        assert_eq!(row("cc").status, "missing");
        assert_eq!(report.missing, vec!["cc".to_string()]);
        assert_eq!(report.problems, 3);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn installed_without_a_lock_entry_is_unmanaged_not_a_problem() {
        let root = std::env::temp_dir().join(format!("cli-doctor-un-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        exe(&root, "cc");
        let manifest = load_str(TOML).unwrap();
        let path = root.as_os_str().to_os_string();
        let report = inspect(&manifest, &LockFile::default(), Some(&path), &|_| false, &|_| None);
        let cc = report.tools.iter().find(|r| r.name == "cc").unwrap();
        assert_eq!(cc.status, "unmanaged");
        assert!(!cc.managed);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failing_probe_is_a_problem() {
        let root = std::env::temp_dir().join(format!("cli-doctor-pr-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let aa = exe(&root, "aa");
        let manifest = load_str(TOML).unwrap();
        let mut lock = LockFile::default();
        lock.tools.insert("aa".into(), entry("1.0.0", &aa));
        let path = root.as_os_str().to_os_string();
        let report = inspect(&manifest, &lock, Some(&path), &|_| false, &|_| None);
        let row = report.tools.iter().find(|r| r.name == "aa").unwrap();
        assert_eq!(row.status, "problem");
        assert!(row.issues.iter().any(|i| i.contains("프로브 실패")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn table_output_collapses_to_the_first_data_row() {
        let text = "┌───┬───┐\n│ version │ commit │\n├───┼───┤\n│ v0.12.0 │ da7b6 │\n└───┴───┘\ntip";
        assert_eq!(pick_line(text).as_deref(), Some("v0.12.0 da7b6"));
        assert_eq!(pick_line("\n 1.2.3 \nx").as_deref(), Some("1.2.3"));
    }

    #[test]
    fn probe_returns_the_first_line_and_none_on_failure() {
        assert_eq!(
            run_probe(&["sh".into(), "-c".into(), "echo hello; echo second".into()]).as_deref(),
            Some("hello")
        );
        assert_eq!(run_probe(&["sh".into(), "-c".into(), "exit 3".into()]), None);
        assert_eq!(run_probe(&["definitely-not-a-binary-xyz".into()]), None);
    }
}
