use std::io::{self, Write};

use anyhow::{bail, Result};

use crate::color::{self, paint, BOLD, CYAN, DIM, GREEN, YELLOW};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub yes: bool,
    pub dry_run: bool,
    pub json: bool,
    pub check: bool,
    pub rollback: bool,
    pub names: Vec<String>,
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Default,
    Help,
    List,
    Install,
    Remove,
    Update,
    Audit,
    Doctor,
}

pub fn parse(args: impl IntoIterator<Item = impl AsRef<str>>) -> Result<Options> {
    let args: Vec<String> = args
        .into_iter()
        .map(|arg| arg.as_ref().to_string())
        .collect();
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        return Ok(Options {
            yes: false,
            dry_run: false,
            json: false,
            check: false,
            rollback: false,
            names: Vec::new(),
            command: Command::Help,
        });
    }

    let mut yes = false;
    let mut dry_run = false;
    let mut json = false;
    let mut check = false;
    let mut rollback = false;
    let mut positionals = Vec::new();
    for arg in &args {
        match arg.as_str() {
            "--yes" => yes = true,
            "--dry-run" => dry_run = true,
            "--json" => json = true,
            "--check" => check = true,
            "--rollback" => rollback = true,
            other if other.starts_with('-') => bail!("unknown option: {other}"),
            other => positionals.push(other.to_string()),
        }
    }

    let command = match positionals.first().map(String::as_str) {
        None => Command::Default,
        Some("list") => {
            reject_extra(&positionals)?;
            Command::List
        }
        Some("install") => Command::Install,
        Some("remove") => Command::Remove,
        Some("update") => Command::Update,
        Some("audit") => {
            reject_extra(&positionals)?;
            Command::Audit
        }
        Some("doctor") => {
            reject_extra(&positionals)?;
            Command::Doctor
        }
        Some(other) => bail!("unknown command: {other}"),
    };

    let names = match command {
        Command::Install | Command::Remove | Command::Update => positionals[1..].to_vec(),
        _ => Vec::new(),
    };
    Ok(Options {
        yes,
        dry_run,
        json,
        check,
        rollback,
        names,
        command,
    })
}

fn reject_extra(positionals: &[String]) -> Result<()> {
    if let Some(extra) = positionals.get(1) {
        bail!("unexpected argument: {extra}");
    }
    Ok(())
}

pub fn print_help() {
    let mut stdout = io::stdout();
    let _ = write_help(&mut stdout);
}

pub fn write_help(out: &mut impl Write) -> io::Result<()> {
    let enabled = color::stdout_enabled();
    let command = paint("명령", &[BOLD, CYAN], enabled);
    let flags = paint("공통 옵션", &[BOLD, YELLOW], enabled);
    writeln!(out, "{}", paint("cli — 도구 설치·점검", &[BOLD], enabled))?;
    writeln!(out)?;
    writeln!(out, "사용법:")?;
    writeln!(out, "  cli")?;
    writeln!(out, "  cli <명령> [옵션]")?;
    writeln!(out)?;
    writeln!(out, "{command}")?;
    for (name, detail) in COMMANDS {
        writeln!(
            out,
            "  {} {}",
            paint(&format!("{name:<10}"), &[GREEN], enabled),
            paint(detail, &[DIM], enabled)
        )?;
    }
    writeln!(out)?;
    writeln!(out, "{flags}")?;
    for (name, detail) in FLAGS {
        writeln!(
            out,
            "  {} {}",
            paint(&format!("{name:<16}"), &[CYAN], enabled),
            paint(detail, &[DIM], enabled)
        )?;
    }
    Ok(())
}

const COMMANDS: &[(&str, &str)] = &[
    ("list", "목록과 설치 상태"),
    ("install", "게이트 통과 후 설치"),
    ("remove", "기록된 항목 삭제"),
    ("update", "후보 조회와 교체"),
    ("audit", "정책·취약점 점검"),
    ("doctor", "설치·환경 점검"),
];

const FLAGS: &[(&str, &str)] = &[
    ("--yes", "승인 생략"),
    ("--dry-run", "바꾸지 않고 계획만 표시"),
    ("--check", "update: 후보만 조회"),
    ("--rollback", "update: 직전 버전으로 되돌림"),
    ("--json", "JSON으로 출력"),
    ("-h, --help", "이 도움말"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_list_json_and_help() {
        let opts = parse(["list", "--json"]).unwrap();
        assert_eq!(opts.command, Command::List);
        assert!(opts.json);

        let opts = parse(["--json", "list", "--yes"]).unwrap();
        assert_eq!(opts.command, Command::List);
        assert!(opts.yes);

        assert_eq!(parse(["-h"]).unwrap().command, Command::Help);
        assert_eq!(parse(["install", "--help"]).unwrap().command, Command::Help);
        assert_eq!(
            parse(["install", "litestream"]).unwrap().command,
            Command::Install
        );
        assert_eq!(
            parse(Vec::<String>::new()).unwrap().command,
            Command::Default
        );
    }

    #[test]
    fn rejects_unknown_command_and_option() {
        assert!(parse(["npm"])
            .unwrap_err()
            .to_string()
            .contains("unknown command"));
        assert!(parse(["list", "--force"])
            .unwrap_err()
            .to_string()
            .contains("unknown option"));
    }
}
