use crate::cli::{fail, CliError};
use crate::paths::SERVICE_NAME as PATH_SERVICE;
use crate::runner::{print_command, run_text, split_lines, RunOptions};

pub const SERVICE_NAME: &str = PATH_SERVICE;

pub fn show_recent_logs(name: &str) {
    let args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-t".into(),
        format!("executor/{name}"),
        "-n".into(),
        "5".into(),
        "--output=cat".into(),
        "--no-pager".into(),
    ];
    let logs = run_text(&args, RunOptions::default());
    let output = logs.stdout.trim_end();
    if output.is_empty() {
        println!("    (no logs)");
    } else {
        println!("{output}");
    }
}

pub fn show_instance_logs(name: &str, since: Option<&str>) {
    let mut args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-t".into(),
        format!("executor/{name}"),
        "--output=cat".into(),
        "--no-pager".into(),
    ];
    if let Some(since) = since {
        args.push("--since".into());
        args.push(since.into());
    } else {
        args.push("-n".into());
        args.push("20".into());
    }
    print_command(&args);
    let result = run_text(&args, RunOptions::default());
    let output = result.stdout.trim_end();
    if !output.is_empty() {
        println!("{output}");
    }
}

pub fn reload_executor_service() -> Result<(), CliError> {
    let active_args = vec![
        "/usr/bin/systemctl".into(),
        "--user".into(),
        "is-active".into(),
        SERVICE_NAME.into(),
    ];
    let active = run_text(&active_args, RunOptions::default()).stdout.trim().to_string();
    if active == "active" {
        let args = vec![
            "/usr/bin/systemctl".into(),
            "--user".into(),
            "reload".into(),
            SERVICE_NAME.into(),
        ];
        print_command(&args);
        let result = run_text(&args, RunOptions::default());
        if !result.success {
            let stderr = result.stderr.trim();
            if !stderr.is_empty() {
                eprintln!("{stderr}");
            }
            return Err(fail(format!("failed to reload {SERVICE_NAME}")));
        }
        return Ok(());
    }
    let reset_args = vec![
        "/usr/bin/systemctl".into(),
        "--user".into(),
        "reset-failed".into(),
        SERVICE_NAME.into(),
    ];
    print_command(&reset_args);
    let _ = run_text(&reset_args, RunOptions::default());
    let start_args = vec![
        "/usr/bin/systemctl".into(),
        "--user".into(),
        "start".into(),
        SERVICE_NAME.into(),
    ];
    print_command(&start_args);
    let start = run_text(&start_args, RunOptions::default());
    if !start.success {
        let output = format!("{}{}", start.stdout, start.stderr).trim().to_string();
        if !output.is_empty() {
            eprintln!("{output}");
        }
        return Err(fail(format!("failed to start {SERVICE_NAME}")));
    }
    Ok(())
}

pub fn verify_executor_service_active() -> Result<(), CliError> {
    let active_args = vec![
        "/usr/bin/systemctl".into(),
        "--user".into(),
        "is-active".into(),
        SERVICE_NAME.into(),
    ];
    print_command(&active_args);
    let active = run_text(&active_args, RunOptions::default());
    let state = {
        let trimmed = active.stdout.trim();
        if trimmed.is_empty() {
            "unknown"
        } else {
            trimmed
        }
        .to_string()
    };
    println!("{state}");
    if state == "active" {
        return Ok(());
    }
    let status_args = vec![
        "/usr/bin/systemctl".into(),
        "--user".into(),
        "--no-pager".into(),
        "--full".into(),
        "status".into(),
        SERVICE_NAME.into(),
    ];
    print_command(&status_args);
    let status = run_text(&status_args, RunOptions::default());
    let output = format!("{}{}", status.stdout, status.stderr).trim().to_string();
    if !output.is_empty() {
        println!("{output}");
    }
    Err(fail("executor service is not active after reload"))
}

pub fn show_executor_service_logs(since: Option<&str>) {
    let mut args = vec![
        "/usr/bin/journalctl".into(),
        "--user".into(),
        "-u".into(),
        SERVICE_NAME.into(),
        "--no-pager".into(),
    ];
    if let Some(since) = since {
        args.push("--since".into());
        args.push(since.into());
    } else {
        args.push("-n".into());
        args.push("50".into());
    }
    print_command(&args);
    let result = run_text(&args, RunOptions::default());
    let lines: Vec<_> = split_lines(&result.stdout)
        .into_iter()
        .filter(|line| {
            line.contains("systemd[")
                && (line.contains("Reloading")
                    || line.contains("Reloaded")
                    || line.contains("Starting")
                    || line.contains("Started")
                    || line.contains("Stopping")
                    || line.contains("Stopped")
                    || line.contains("Failed"))
        })
        .collect();
    if !lines.is_empty() {
        println!("{}", lines.join("\n"));
    }
}
