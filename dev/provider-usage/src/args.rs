use anyhow::{bail, Result};

use crate::cache::{ProviderState, DEFAULT_CACHE_PATH};
use crate::color::{self, DIM, GREEN, RED, YELLOW};
use crate::core::{default_store, LiveProbes, SystemClock, UsageCore};

#[derive(Debug, PartialEq)]
enum Command {
    Remaining { model: String, force: bool },
    Status,
    Refresh { target: Option<String> },
    MarkExhausted { model: String, until: Option<i64> },
}

struct Options {
    json: bool,
    cache: Option<String>,
    command: Command,
}

pub fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    dispatch(&args)
}

pub fn dispatch(args: &[String]) -> Result<()> {
    let options = parse(args)?;
    let core = UsageCore {
        clock: SystemClock,
        store: default_store(options.cache.as_deref()),
        probes: LiveProbes::from_env()?,
    };
    match options.command {
        Command::Remaining { model, force } => {
            let answer = core.remaining(&model, force)?;
            if options.json {
                println!("{}", serde_json::to_string_pretty(&answer)?);
            } else {
                println!(
                    "{} {} {}",
                    answer.provider,
                    format_state(answer.state),
                    remaining_label(&answer.remaining)
                );
            }
        }
        Command::Status => {
            let cache = core.status()?;
            if options.json {
                println!("{}", serde_json::to_string_pretty(&cache)?);
            } else if cache.providers.is_empty() {
                println!(
                    "no snapshots in {}",
                    options.cache.as_deref().unwrap_or(DEFAULT_CACHE_PATH)
                );
            } else {
                for (key, snapshot) in &cache.providers {
                    let extra = snapshot.reason.clone().unwrap_or_default();
                    println!("{} {} {}", key, format_state(snapshot.state), extra);
                }
            }
        }
        Command::Refresh { target } => {
            let target = target.unwrap_or_default();
            let providers = if target.is_empty() {
                vec![
                    "openai".to_string(),
                    "commandcode".to_string(),
                    "opencode-go".to_string(),
                    "grok".to_string(),
                ]
            } else {
                vec![target]
            };
            let answers = core.refresh_many(&providers)?;
            if options.json {
                println!("{}", serde_json::to_string_pretty(&answers)?);
            } else {
                for answer in answers {
                    println!(
                        "{} {} {}",
                        answer.provider,
                        format_state(answer.state),
                        remaining_label(&answer.remaining)
                    );
                }
            }
        }
        Command::MarkExhausted { model, until } => {
            let answer = core.mark_exhausted(&model, until)?;
            if options.json {
                println!("{}", serde_json::to_string_pretty(&answer)?);
            } else {
                println!("{} exhausted", answer.provider);
            }
        }
    }
    Ok(())
}

fn format_state(state: ProviderState) -> String {
    match state {
        ProviderState::Available => color::paint("available", GREEN),
        ProviderState::Exhausted => color::paint("exhausted", RED),
        ProviderState::Unknown => color::paint("unknown", YELLOW),
    }
}

fn remaining_label(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Bool(true) => color::paint("remaining=true", GREEN),
        serde_json::Value::Bool(false) => color::paint("remaining=false", RED),
        _ => color::paint("remaining=unknown", DIM),
    }
}

fn parse(args: &[String]) -> Result<Options> {
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        print_help();
        std::process::exit(0);
    }
    let mut json = false;
    let mut force = false;
    let mut cache = None;
    let mut until = None;
    let mut positional = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => json = true,
            "--refresh" => force = true,
            "--cache" => {
                i += 1;
                let Some(value) = args.get(i) else {
                    bail!("--cache needs a path");
                };
                cache = Some(value.clone());
            }
            "--until" => {
                i += 1;
                let Some(value) = args.get(i) else {
                    bail!("--until needs an epoch second");
                };
                until = Some(
                    value
                        .parse::<i64>()
                        .map_err(|_| anyhow::anyhow!("invalid --until"))?,
                );
            }
            other if other.starts_with('-') => bail!("unknown flag {other}"),
            other => positional.push(other.to_string()),
        }
        i += 1;
    }
    let Some(verb) = positional.first().map(String::as_str) else {
        bail!("missing command. try --help");
    };
    let command = match verb {
        "remaining" => {
            let Some(model) = positional.get(1) else {
                bail!("remaining needs a model");
            };
            Command::Remaining {
                model: model.clone(),
                force,
            }
        }
        "status" => Command::Status,
        "refresh" => Command::Refresh {
            target: positional.get(1).cloned(),
        },
        "mark-exhausted" | "mark_exhausted" => {
            let Some(model) = positional.get(1) else {
                bail!("mark-exhausted needs a model");
            };
            Command::MarkExhausted {
                model: model.clone(),
                until,
            }
        }
        other => bail!("unknown command {other}"),
    };
    Ok(Options {
        json,
        cache,
        command,
    })
}

fn print_help() {
    println!(
        "\
provider-usage remaining <model> [--json] [--refresh] [--cache PATH]
provider-usage status [--json] [--cache PATH]
provider-usage refresh [provider] [--json] [--cache PATH]
provider-usage mark-exhausted <model> [--until EPOCH] [--json] [--cache PATH]"
    );
}
