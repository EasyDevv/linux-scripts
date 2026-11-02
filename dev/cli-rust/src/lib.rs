mod args;
pub mod audit;
pub mod doctor;
pub mod engine;
pub mod install;
pub mod lock;
pub mod paths;
pub mod pkg;
pub mod pin;
pub mod plugin;
pub mod checksum;
mod color;
pub mod cooldown;
pub mod gate;
pub mod http;
mod manifest;
pub mod resolve;
pub mod update;
mod select;
pub mod verify;

use std::io::{self, IsTerminal};
use std::path::Path;

use anyhow::anyhow;
use serde::Serialize;

use crate::args::{Command, Options};
use crate::color::{paint, BOLD, DIM, GREEN};
use crate::manifest::{Manifest, Tool, EXIT_BLOCKED, EXIT_ERROR};
use crate::select::{Choice, Section};

#[derive(Debug)]
pub struct ExitError {
    pub code: i32,
    pub help: bool,
    inner: anyhow::Error,
}

impl std::fmt::Display for ExitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if formatter.alternate() {
            write!(formatter, "{:#}", self.inner)
        } else {
            write!(formatter, "{}", self.inner)
        }
    }
}

impl From<anyhow::Error> for ExitError {
    fn from(inner: anyhow::Error) -> Self {
        Self {
            code: EXIT_ERROR,
            help: false,
            inner,
        }
    }
}

impl ExitError {
    fn msg(message: impl Into<String>) -> Self {
        Self::from(anyhow!(message.into()))
    }

    fn help() -> Self {
        Self {
            code: EXIT_ERROR,
            help: true,
            inner: anyhow!("help"),
        }
    }

    #[allow(dead_code)]
    pub fn blocked(inner: anyhow::Error) -> Self {
        Self {
            code: EXIT_BLOCKED,
            help: false,
            inner,
        }
    }
}

pub fn print_help() {
    args::print_help();
}

pub fn run() -> Result<(), ExitError> {
    let opts = args::parse(std::env::args().skip(1))?;
    dispatch(opts, &default_manifest_path())
}

fn default_manifest_path() -> std::path::PathBuf {
    if let Some(path) = std::env::var_os("CLI_MANIFEST") {
        return std::path::PathBuf::from(path);
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools.toml")
}

fn dispatch(opts: Options, manifest_path: &Path) -> Result<(), ExitError> {
    match opts.command {
        Command::Help => {
            print_help();
            Ok(())
        }
        Command::List => list(manifest_path, opts.json),
        Command::Default => {
            if io::stdin().is_terminal() && io::stderr().is_terminal() {
                pick(manifest_path)
            } else {
                Err(ExitError::help())
            }
        }
        Command::Install => install_or_remove(&opts, manifest_path, true),
        Command::Remove => install_or_remove(&opts, manifest_path, false),
        Command::Doctor => run_doctor(manifest_path, opts.json),
        Command::Audit => run_audit(manifest_path, opts.json),
        Command::Update => run_update(&opts, manifest_path),
    }
}

fn install_or_remove(opts: &Options, manifest_path: &Path, install: bool) -> Result<(), ExitError> {
    use crate::install::{install_tool, remove_tool, Env, Outcome, TtyPrompt};

    if opts.names.is_empty() {
        let verb = if install { "install" } else { "remove" };
        return Err(ExitError::msg(format!("사용법: cli {verb} <이름…>")));
    }
    let manifest = manifest::load_path(manifest_path)?;
    let paths = crate::paths::Paths::from_env()?;
    let prompt = TtyPrompt;
    let env = Env {
        paths: &paths,
        manifest_path,
        cooldown_days: manifest.cooldown_days,
        yes: opts.yes,
        dry_run: opts.dry_run,
        prompt: &prompt,
        now: chrono::Utc::now(),
    };
    let mut failures = Failures::default();
    for name in &opts.names {
        let tool = manifest
            .tools
            .iter()
            .find(|tool| &tool.name == name)
            .ok_or_else(|| ExitError::msg(format!("{name}: tools.toml 에 없는 도구")))?;
        let outcome = if install {
            install_tool(&env, tool)
        } else {
            remove_tool(&env, name)
        };
        match outcome {
            Ok(Outcome::Installed { version, level }) => {
                println!("{name} {version} 설치됨 (검증: {level})");
            }
            Ok(Outcome::AlreadyInstalled { version }) => println!("{name} {version} 이미 설치됨"),
            Ok(Outcome::DryRun { version, decision }) => {
                println!("[dry-run] {name} {version}: {decision}");
            }
            Ok(Outcome::Removed) => println!("{name} 삭제됨"),
            Err(error) => failures.record(name, error),
        }
    }
    failures.finish()
}

/// 여러 도구를 한꺼번에 처리할 때 하나가 실패해도 나머지를 계속하고, 마지막에 가장 무거운 종료 코드로 알린다.
#[derive(Default)]
struct Failures {
    count: usize,
    code: i32,
}

impl Failures {
    fn record(&mut self, name: &str, error: anyhow::Error) {
        let code = match error.downcast_ref::<crate::gate::Blocked>() {
            Some(blocked) => blocked.exit_code(),
            None => EXIT_ERROR,
        };
        eprintln!("error: {name} 실패: {error:#}");
        self.count += 1;
        self.code = self.code.max(code);
    }

    fn finish(self) -> Result<(), ExitError> {
        if self.count == 0 {
            return Ok(());
        }
        Err(ExitError {
            code: self.code,
            help: false,
            inner: anyhow!("{}개 도구 실패", self.count),
        })
    }
}

fn run_update(opts: &Options, manifest_path: &Path) -> Result<(), ExitError> {
    use crate::install::{Env, Outcome, TtyPrompt};

    let manifest = manifest::load_path(manifest_path)?;
    let paths = crate::paths::Paths::from_env()?;
    let lock = crate::lock::LockFile::load(&paths.lock_json())?;
    let now = chrono::Utc::now();

    let mut selected: Vec<&Tool> = Vec::new();
    if opts.names.is_empty() {
        selected.extend(manifest.tools.iter().filter(|tool| lock.tools.contains_key(&tool.name)));
    } else {
        for name in &opts.names {
            selected.push(
                manifest
                    .tools
                    .iter()
                    .find(|tool| &tool.name == name)
                    .ok_or_else(|| ExitError::msg(format!("{name}: tools.toml 에 없는 도구")))?,
            );
        }
    }

    if opts.check {
        let candidates = update::check_all(&selected, &lock, now, manifest.cooldown_days);
        if opts.json {
            let text = serde_json::to_string_pretty(&candidates).map_err(|error| ExitError::from(anyhow!(error)))?;
            println!("{text}");
        } else {
            print!("{}", update::render(&candidates));
        }
        return Ok(());
    }
    if selected.is_empty() {
        println!("cli 로 설치한 도구가 없습니다");
        return Ok(());
    }

    let prompt = TtyPrompt;
    let env = Env {
        paths: &paths,
        manifest_path,
        cooldown_days: manifest.cooldown_days,
        yes: opts.yes,
        dry_run: opts.dry_run,
        prompt: &prompt,
        now,
    };
    let mut failures = Failures::default();
    for tool in selected {
        let outcome = if opts.rollback {
            update::rollback_tool(&env, tool)
        } else {
            let fetch = resolve::HttpFetch::new(http::HostPolicy::for_tool(tool))?;
            update::update_tool(&env, tool, &fetch)
        };
        let name = &tool.name;
        match outcome {
            Ok(Outcome::Installed { version, level }) => {
                let verb = if opts.rollback { "되돌림" } else { "업데이트됨" };
                println!("{name} {version} {verb} (검증: {level})");
            }
            Ok(Outcome::AlreadyInstalled { version }) => println!("{name} {version} 최신"),
            Ok(Outcome::DryRun { version, decision }) => println!("[dry-run] {name} {version}: {decision}"),
            Ok(Outcome::Removed) => {}
            Err(error) => failures.record(name, error),
        }
    }
    failures.finish()
}

fn run_audit(path: &Path, json: bool) -> Result<(), ExitError> {
    let manifest = manifest::load_path(path)?;
    let paths = crate::paths::Paths::from_env()?;
    let lock = crate::lock::LockFile::load(&paths.lock_json())?;
    let crate_lock = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock");
    let osv = paths.osv_bin.clone();
    let report = audit::audit(&manifest, &lock, &paths, Some(&crate_lock), &|target, out| {
        audit::run_osv(&osv, target, out)
    });
    if json {
        let text = serde_json::to_string_pretty(&report).map_err(|error| ExitError::from(anyhow!(error)))?;
        println!("{text}");
    } else {
        print!("{}", audit::render(&report));
    }
    match report.exit_code() {
        0 => Ok(()),
        code => Err(ExitError {
            code,
            help: false,
            inner: anyhow!("audit: 정책 위반 {}건, 취약 패키지 {}개, 오류 {}건",
                report.policy.iter().filter(|f| f.severity == "error").count(),
                report.vulns.len(),
                report.errors.len()),
        }),
    }
}

fn run_doctor(path: &Path, json: bool) -> Result<(), ExitError> {
    let manifest = manifest::load_path(path)?;
    let paths = crate::paths::Paths::from_env()?;
    let lock = crate::lock::LockFile::load(&paths.lock_json())?;
    let path_var = std::env::var_os("PATH");
    let report = doctor::inspect(
        &manifest,
        &lock,
        path_var.as_deref(),
        &|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()),
        &doctor::run_probe,
    );
    if json {
        let text = serde_json::to_string_pretty(&report).map_err(|error| ExitError::from(anyhow!(error)))?;
        println!("{text}");
    } else {
        print!("{}", doctor::render(&report, color::stdout_enabled()));
    }
    if report.problems > 0 {
        return Err(ExitError {
            code: EXIT_ERROR,
            help: false,
            inner: anyhow!("doctor: 문제 {}개 (미설치 포함)", report.problems),
        });
    }
    Ok(())
}

fn list(path: &Path, json: bool) -> Result<(), ExitError> {
    let manifest = manifest::load_path(path)?;
    let path_var = std::env::var_os("PATH");
    let rows = list_rows(&manifest, path_var.as_deref());
    if json {
        let text =
            serde_json::to_string_pretty(&rows).map_err(|error| ExitError::from(anyhow!(error)))?;
        println!("{text}");
        return Ok(());
    }
    print_table(&rows);
    Ok(())
}

fn pick(path: &Path) -> Result<(), ExitError> {
    let manifest = manifest::load_path(path)?;
    let installed = installed_versions();
    let sections = picker_sections(&manifest.tools, &installed);
    let names: Vec<String> = sections
        .iter()
        .flat_map(|section| section.choices.iter().map(|choice| choice.label.clone()))
        .collect();
    let Some(outcome) = select::select_many("도구", &sections)? else {
        return Err(ExitError::msg("취소"));
    };
    let chosen: Vec<String> = outcome.selected.iter().map(|&index| names[index].clone()).collect();
    let (command, check) = match action_for_key(outcome.key) {
        Some(action) => action,
        None => {
            let summary = if chosen.len() == 1 {
                chosen[0].clone()
            } else {
                format!("{}개 선택", chosen.len())
            };
            let Some(action) = pick_action(&summary)? else {
                return Err(ExitError::msg("취소"));
            };
            action
        }
    };
    // 선택한 작업은 명령줄과 같은 경로로 실행하고, 쓰기 작업은 평소처럼 승인을 묻는다.
    dispatch(
        Options {
            yes: false,
            dry_run: false,
            json: false,
            check,
            rollback: false,
            names: chosen,
            command,
        },
        path,
    )
}

/// cli 로 설치한 도구의 버전(lock). 읽지 못하면 비어 있는 것으로 본다.
fn installed_versions() -> std::collections::BTreeMap<String, String> {
    let Ok(paths) = crate::paths::Paths::from_env() else {
        return Default::default();
    };
    crate::lock::LockFile::load(&paths.lock_json())
        .map(|lock| {
            lock.tools
                .into_iter()
                .map(|(name, entry)| (name, entry.version))
                .collect()
        })
        .unwrap_or_default()
}

const ACTIONS: [(&str, Command, bool); 4] = [
    ("설치", Command::Install, false),
    ("삭제", Command::Remove, false),
    ("업데이트 확인", Command::Update, true),
    ("업데이트", Command::Update, false),
];

/// 목록 화면의 작업 키(`i` `x` `c` `u`)를 작업으로 바꾼다. Enter(`\r`)는 None — 작업 메뉴를 연다.
fn action_for_key(key: char) -> Option<(Command, bool)> {
    let index = match key {
        'i' => 0,
        'x' => 1,
        'c' => 2,
        'u' => 3,
        _ => return None,
    };
    Some((ACTIONS[index].1.clone(), ACTIONS[index].2))
}

fn pick_action(name: &str) -> Result<Option<(Command, bool)>, ExitError> {
    let sections = vec![Section {
        title: format!("{name} — 작업"),
        color: GREEN,
        choices: ACTIONS
            .iter()
            .map(|(label, _, _)| Choice {
                label: (*label).to_string(),
                color: GREEN,
                note: String::new(),
            })
            .collect(),
    }];
    Ok(select::select_one("작업", &sections)?
        .map(|index| (ACTIONS[index].1.clone(), ACTIONS[index].2)))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct ListRow {
    name: String,
    method: String,
    priority: String,
    group: String,
    installed: bool,
    version: Option<String>,
}

fn list_rows(manifest: &Manifest, path: Option<&std::ffi::OsStr>) -> Vec<ListRow> {
    manifest
        .tools
        .iter()
        .map(|tool| ListRow {
            name: tool.name.clone(),
            method: tool.method.as_str().to_string(),
            priority: tool.priority.clone(),
            group: tool.group.clone(),
            installed: exe_in_path(tool.exe_name(), path),
            version: tool.version.clone(),
        })
        .collect()
}

fn print_table(rows: &[ListRow]) {
    let enabled = color::stdout_enabled();
    let name_w = col_width(rows, "name", |row| row.name.len());
    let method_w = col_width(rows, "method", |row| row.method.len());
    let priority_w = col_width(rows, "priority", |row| row.priority.len());
    let group_w = col_width(rows, "group", |row| row.group.len());
    println!(
        "{} {} {} {} {}",
        paint(&format!("{:<name_w$}", "name"), &[BOLD, DIM], enabled),
        paint(&format!("{:<method_w$}", "method"), &[BOLD, DIM], enabled),
        paint(
            &format!("{:<priority_w$}", "priority"),
            &[BOLD, DIM],
            enabled
        ),
        paint(&format!("{:<group_w$}", "group"), &[BOLD, DIM], enabled),
        paint("installed", &[BOLD, DIM], enabled)
    );
    for (label, rank) in [("P1", 0u8), ("P2", 1), ("P3", 2)] {
        let group: Vec<&ListRow> = rows
            .iter()
            .filter(|row| priority_rank(&row.priority) == rank)
            .collect();
        if group.is_empty() {
            continue;
        }
        let color = color::priority_color(label);
        println!();
        println!(
            "{}",
            paint(
                &format!("{label} ({})", group.len()),
                &[BOLD, color],
                enabled
            )
        );
        for row in group {
            let installed = if row.installed { "yes" } else { "no" };
            let installed_style: &[&str] = if row.installed { &[GREEN] } else { &[DIM] };
            println!(
                "{} {} {} {} {}",
                paint(&format!("{:<name_w$}", row.name), &[color], enabled),
                format!("{:<method_w$}", row.method),
                format!("{:<priority_w$}", row.priority),
                format!("{:<group_w$}", row.group),
                paint(installed, installed_style, enabled)
            );
        }
    }
    let other: Vec<&ListRow> = rows
        .iter()
        .filter(|row| priority_rank(&row.priority) > 2)
        .collect();
    if !other.is_empty() {
        println!();
        println!(
            "{}",
            paint(&format!("Other ({})", other.len()), &[BOLD, DIM], enabled)
        );
        for row in other {
            println!(
                "{:<name_w$} {:<method_w$} {:<priority_w$} {:<group_w$} {}",
                row.name,
                row.method,
                row.priority,
                row.group,
                if row.installed { "yes" } else { "no" }
            );
        }
    }
}

fn col_width(rows: &[ListRow], header: &str, field: impl Fn(&ListRow) -> usize) -> usize {
    rows.iter().map(&field).max().unwrap_or(0).max(header.len())
}

fn priority_rank(priority: &str) -> u8 {
    match priority {
        "P1" => 0,
        "P2" => 1,
        "P3" => 2,
        _ => 3,
    }
}

/// 목록 화면에 나오는 순서. 목록에 없는 카테고리는 `other` 로 모은다.
const CATEGORIES: [&str; 6] = ["cloud", "payment", "database", "ai", "social", "security"];

fn category_of(tool: &Tool) -> &str {
    let category = tool.category.as_str();
    if CATEGORIES.contains(&category) {
        category
    } else {
        "other"
    }
}

fn picker_sections(
    tools: &[Tool],
    installed: &std::collections::BTreeMap<String, String>,
) -> Vec<Section> {
    let mut sections = Vec::new();
    for label in CATEGORIES.iter().copied().chain(["other"]) {
        let color = color::category_color(label);
        let choices: Vec<Choice> = tools
            .iter()
            .filter(|tool| category_of(tool) == label)
            .map(|tool| Choice {
                label: tool.name.clone(),
                color,
                note: match installed.get(&tool.name) {
                    Some(version) => format!("설치됨 {version}"),
                    None if tool.status == manifest::Status::Pending => "대기(pending)".into(),
                    None => "미설치".into(),
                },
            })
            .collect();
        if choices.is_empty() {
            continue;
        }
        sections.push(Section {
            title: format!("{label} ({})", choices.len()),
            color,
            choices,
        });
    }
    sections
}

pub fn exe_in_path(exe: &str, path: Option<&std::ffi::OsStr>) -> bool {
    let Some(path) = path else {
        return false;
    };
    if exe.is_empty() || exe.contains('/') || exe.contains('\0') {
        return false;
    }
    for dir in std::env::split_paths(path) {
        let candidate = dir.join(exe);
        if is_executable(&candidate) {
            return true;
        }
    }
    false
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn finds_executable_on_path_only() {
        let dir = std::env::temp_dir().join(format!("cli-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("aws");
        std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
        let mut perms = std::fs::metadata(&exe).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&exe, perms).unwrap();
        let plain = dir.join("creem");
        std::fs::write(&plain, b"nope").unwrap();
        let path = dir.as_os_str();
        assert!(exe_in_path("aws", Some(path)));
        assert!(!exe_in_path("creem", Some(path)));
        assert!(!exe_in_path("missing", Some(path)));
        assert!(!exe_in_path("aws/dist/aws", Some(path)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_json_uses_manifest_version_or_null() {
        let manifest = manifest::load_path(&default_manifest_path()).unwrap();
        let rows = list_rows(&manifest, None);
        assert_eq!(rows.len(), 11);
        assert_eq!(rows[0].version.as_deref(), Some("0.5.17"));
        assert!(!rows[0].installed);
        let aws = rows.iter().find(|row| row.name == "aws").unwrap();
        assert_eq!(aws.method, "vendor");
        assert!(aws.version.is_none());
        let text = serde_json::to_string(&rows).unwrap();
        assert!(text.contains("\"version\":null"));
    }

    fn opts(command: Command, names: &[&str]) -> Options {
        Options {
            yes: true,
            dry_run: true,
            json: false,
            check: false,
            rollback: false,
            names: names.iter().map(|n| n.to_string()).collect(),
            command,
        }
    }

    #[test]
    fn failures_keep_going_and_report_the_heaviest_code() {
        let mut failures = Failures::default();
        failures.record("a", anyhow!("boom"));
        failures.record(
            "b",
            crate::gate::Blocked::Prerelease { version: "1.0.0-beta.1".into() }.into(),
        );
        let error = failures.finish().unwrap_err();
        assert_eq!(error.code, EXIT_BLOCKED);
        assert!(error.to_string().contains("2개"), "{error}");
        assert!(Failures::default().finish().is_ok());
    }

    #[test]
    fn picker_keys_map_to_actions() {
        assert_eq!(action_for_key('i'), Some((Command::Install, false)));
        assert_eq!(action_for_key('x'), Some((Command::Remove, false)));
        assert_eq!(action_for_key('c'), Some((Command::Update, true)));
        assert_eq!(action_for_key('u'), Some((Command::Update, false)));
        assert_eq!(action_for_key('\r'), None);
    }

    #[test]
    fn picker_groups_tools_by_category_with_install_state() {
        let manifest = manifest::load_path(&default_manifest_path()).unwrap();
        let mut installed = std::collections::BTreeMap::new();
        installed.insert("creem".to_string(), "0.9.0".to_string());
        let sections = picker_sections(&manifest.tools, &installed);
        let titles: Vec<&str> = sections.iter().map(|s| s.title.split(' ').next().unwrap()).collect();
        assert_eq!(titles, ["cloud", "payment", "database", "ai", "social", "security"]);
        let total: usize = sections.iter().map(|s| s.choices.len()).sum();
        assert_eq!(total, manifest.tools.len());
        let payment = &sections[1];
        assert_eq!(payment.choices[0].label, "creem");
        assert_eq!(payment.choices[0].note, "설치됨 0.9.0");
        let cloud = &sections[0];
        assert!(cloud.choices.iter().any(|c| c.label == "aws" && c.note.contains("pending")));
    }

    #[test]
    fn picker_actions_map_to_install_remove_and_update_variants() {
        let commands: Vec<(Command, bool)> = ACTIONS.iter().map(|(_, c, check)| (c.clone(), *check)).collect();
        assert_eq!(
            commands,
            [
                (Command::Install, false),
                (Command::Remove, false),
                (Command::Update, true),
                (Command::Update, false)
            ]
        );
    }

    #[test]
    fn install_and_remove_need_a_name_and_a_known_tool() {
        let path = default_manifest_path();
        for command in [Command::Install, Command::Remove] {
            let error = dispatch(opts(command.clone(), &[]), &path).unwrap_err();
            assert_eq!(error.code, EXIT_ERROR);
            assert!(error.to_string().contains("사용법"), "{error}");
            let error = dispatch(opts(command, &["no-such-tool"]), &path).unwrap_err();
            assert_eq!(error.code, EXIT_ERROR);
            assert!(error.to_string().contains("tools.toml 에 없는 도구"), "{error}");
        }
    }
}
