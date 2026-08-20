use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

use crate::util::infer_machine_from_path;
use crate::verify::VerifyMode;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Local,
    Remote,
}

impl Side {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw {
            "local" | "left" => Ok(Self::Local),
            "remote" | "right" => Ok(Self::Remote),
            other => bail!("unknown side '{other}'; use local or remote"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    Local(PathBuf),
    Remote { host: String, path: PathBuf },
}

impl Target {
    pub fn parse(raw: &str) -> Self {
        if let Some((host, path)) = split_remote(raw) {
            Self::Remote {
                host: host.to_string(),
                path: PathBuf::from(path),
            }
        } else {
            Self::Local(PathBuf::from(raw))
        }
    }

    pub fn display(&self) -> String {
        match self {
            Self::Local(path) => path.display().to_string(),
            Self::Remote { host, path } => format!("{host}:{}", path.display()),
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self, Self::Remote { .. })
    }
}

fn split_remote(raw: &str) -> Option<(&str, &str)> {
    let (host, path) = raw.split_once(':')?;
    if host.is_empty() || path.is_empty() {
        return None;
    }
    if host.contains('/') || host == "." || host == ".." {
        return None;
    }
    if host.len() == 1 && host.chars().next()?.is_ascii_alphabetic() {
        return None;
    }
    Some((host, path))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub help: bool,
    pub local: PathBuf,
    pub remote: Target,
    pub prefer: Option<Side>,
    pub item_prefer: Option<Side>,
    pub dry_run: bool,
    pub yes: bool,
    pub snapshot: bool,
    pub retention: usize,
    pub remote_sudo: bool,
    pub remote_unit: Option<String>,
    pub remote_machine: Option<String>,
    pub reencrypt: bool,
    pub local_env: Option<PathBuf>,
    pub remote_env: Option<PathBuf>,
    pub verify: VerifyMode,
}

impl Options {
    pub fn remote_machine(&self) -> Option<String> {
        if let Some(machine) = &self.remote_machine {
            return Some(machine.clone());
        }
        match &self.remote {
            Target::Remote { path, .. } => infer_machine_from_path(path),
            Target::Local(_) => None,
        }
    }
}

const HELP: &str = "\
Usage: db-sync [options] <local-db> <remote>

Sync two SQLite databases. Remote is host:path or another local path.

After you confirm the write, both sides take a snapshots/ copy (VACUUM INTO)
and keep the newest --retention files (default 5). Abort and --dry-run do not
snapshot.

Conflict modes:
  (default, TTY)     Review each conflicting row
  --item-prefer X    Merge both sides; conflicts take X
  --prefer X         Ignore the merge and copy that entire .db

Options:
      --prefer local|remote        Replace the other side with this .db
      --item-prefer local|remote   Merge; resolve every conflict toward X
      --dry-run                    Diff only; do not snapshot or write
      --yes                        Skip the final apply prompt
      --no-snapshot                Do not write snapshots/
      --retention <n>              Snapshot cap (default 5)
      --remote-sudo                Use sudo -n for remote file commands
      --remote-unit <name>         Stop/start this user unit around remote write
      --remote-machine <name>      systemctl --machine value (default: /home/USER)
      --reencrypt                  Re-encrypt sensitive columns toward the dest key
      --no-reencrypt               Copy ciphertext as-is (default)
      --local-env <file>           Local data-key env (with --reencrypt)
      --remote-env <file>          Remote data-key env (with --reencrypt)
      --verify sample|deep|skip    After write, check both sides (default sample)
      --deep                       Full-row verify (same as --verify deep)
      --skip-verify                Do not verify (same as --verify skip)
  -h, --help                       Show this help
";

pub fn help_text() -> &'static str {
    HELP
}

pub fn parse_args(argv: &[String]) -> Result<Options> {
    let mut help = false;
    let mut prefer = None;
    let mut item_prefer = None;
    let mut dry_run = false;
    let mut yes = false;
    let mut snapshot = true;
    let mut retention = 5usize;
    let mut remote_sudo = false;
    let mut remote_unit = None;
    let mut remote_machine = None;
    let mut reencrypt = false;
    let mut local_env = None;
    let mut remote_env = None;
    let mut verify = VerifyMode::sample();
    let mut positional = Vec::new();

    let mut i = 0;
    while i < argv.len() {
        let arg = argv[i].as_str();
        match arg {
            "-h" | "--help" => help = true,
            "--dry-run" => dry_run = true,
            "--yes" | "-y" => yes = true,
            "--no-snapshot" => snapshot = false,
            "--remote-sudo" => remote_sudo = true,
            "--prefer" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --prefer");
                };
                prefer = Some(Side::parse(value)?);
            }
            arg if arg.starts_with("--prefer=") => {
                prefer = Some(Side::parse(&arg[9..])?);
            }
            "--item-prefer" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --item-prefer");
                };
                item_prefer = Some(Side::parse(value)?);
            }
            arg if arg.starts_with("--item-prefer=") => {
                item_prefer = Some(Side::parse(&arg[14..])?);
            }
            "--retention" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --retention");
                };
                retention = parse_retention(value)?;
            }
            arg if arg.starts_with("--retention=") => {
                retention = parse_retention(&arg[12..])?;
            }
            "--remote-unit" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --remote-unit");
                };
                remote_unit = Some(value.clone());
            }
            arg if arg.starts_with("--remote-unit=") => {
                remote_unit = Some(arg[14..].to_string());
            }
            "--remote-machine" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --remote-machine");
                };
                remote_machine = Some(value.clone());
            }
            arg if arg.starts_with("--remote-machine=") => {
                remote_machine = Some(arg[17..].to_string());
            }
            "--reencrypt" => reencrypt = true,
            "--no-reencrypt" => reencrypt = false,
            "--local-env" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --local-env");
                };
                local_env = Some(PathBuf::from(value));
            }
            arg if arg.starts_with("--local-env=") => {
                local_env = Some(PathBuf::from(arg.split_once('=').unwrap().1));
            }
            "--remote-env" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --remote-env");
                };
                remote_env = Some(PathBuf::from(value));
            }
            arg if arg.starts_with("--remote-env=") => {
                remote_env = Some(PathBuf::from(arg.split_once('=').unwrap().1));
            }
            "--verify" => {
                i += 1;
                let Some(value) = argv.get(i) else {
                    bail!("missing value for --verify");
                };
                verify = VerifyMode::parse(value)?;
            }
            arg if arg.starts_with("--verify=") => {
                verify = VerifyMode::parse(&arg["--verify=".len()..])?;
            }
            "--deep" => verify = VerifyMode::Deep,
            "--skip-verify" => verify = VerifyMode::Skip,
            arg if arg.starts_with('-') => bail!("unknown option {arg}"),

            _ => positional.push(PathBuf::from(arg)),
        }
        i += 1;
    }

    if help {
        return Ok(Options {
            help: true,
            local: PathBuf::new(),
            remote: Target::Local(PathBuf::new()),
            prefer,
            item_prefer,
            dry_run,
            yes,
            snapshot,
            retention,
            remote_sudo,
            remote_unit,
            remote_machine,
            reencrypt,
            local_env,
            remote_env,
            verify,
        });
    }

    if positional.len() != 2 {
        bail!("expected <local-db> <remote>\n\n{HELP}");
    }
    if prefer.is_some() && item_prefer.is_some() {
        bail!("use either --prefer or --item-prefer, not both");
    }

    let local = positional[0].clone();
    let remote = Target::parse(&positional[1].to_string_lossy());
    if let Target::Local(path) = &remote {
        if same_path(&local, path) {
            bail!("local and remote paths are the same");
        }
    }
    if remote_unit.is_some() && matches!(remote, Target::Local(_)) {
        bail!("--remote-unit requires a host:path remote");
    }
    if reencrypt {
        if local_env.is_none() || remote_env.is_none() {
            bail!("--reencrypt requires --local-env and --remote-env");
        }
    }

    Ok(Options {
        help: false,
        local,
        remote,
        prefer,
        item_prefer,
        dry_run,
        yes,
        snapshot,
        retention,
        remote_sudo,
        remote_unit,
        remote_machine,
        reencrypt,
        local_env,
        remote_env,
        verify,
    })
}

fn parse_retention(raw: &str) -> Result<usize> {
    let value: usize = raw
        .parse()
        .map_err(|_| anyhow::anyhow!("--retention must be a non-negative integer"))?;
    Ok(value)
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn parses_remote_host_path() {
        match Target::parse("ovh-vps:/home/svc-internal/data/app.db") {
            Target::Remote { host, path } => {
                assert_eq!(host, "ovh-vps");
                assert_eq!(path, PathBuf::from("/home/svc-internal/data/app.db"));
            }
            Target::Local(_) => panic!("expected remote"),
        }
        match Target::parse("/tmp/other.db") {
            Target::Local(path) => assert_eq!(path, PathBuf::from("/tmp/other.db")),
            Target::Remote { .. } => panic!("expected local"),
        }
    }

    #[test]
    fn parses_item_and_whole_prefer() {
        let opts = parse_args(&args(&[
            "--item-prefer",
            "local",
            "--remote-sudo",
            "a.db",
            "host:/tmp/b.db",
        ]))
        .unwrap();
        assert_eq!(opts.item_prefer, Some(Side::Local));
        assert!(opts.prefer.is_none());
        assert!(opts.remote_sudo);
        assert_eq!(opts.retention, 5);
    }

    #[test]
    fn infers_machine_from_home_path() {
        let opts = parse_args(&args(&[
            "a.db",
            "ovh-vps:/home/svc-internal/share/app.db",
            "--remote-unit",
            "property-portal-server",
        ]))
        .unwrap();
        assert_eq!(opts.remote_machine, None);
        assert_eq!(opts.remote_machine().as_deref(), Some("svc-internal@"));
    }

    #[test]
    fn reencrypt_requires_both_env_files() {
        let err = parse_args(&args(&[
            "--reencrypt",
            "a.db",
            "host:/tmp/b.db",
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("--local-env"));
    }

    #[test]
    fn parses_verify_flags() {
        let deep = parse_args(&args(&["--deep", "a.db", "b.db"])).unwrap();
        assert_eq!(deep.verify, crate::verify::VerifyMode::Deep);
        let skip = parse_args(&args(&["--skip-verify", "a.db", "b.db"])).unwrap();
        assert_eq!(skip.verify, crate::verify::VerifyMode::Skip);
        let sample = parse_args(&args(&["--verify", "sample", "a.db", "b.db"])).unwrap();
        assert_eq!(sample.verify, crate::verify::VerifyMode::sample());
    }

    #[test]
    fn rejects_both_prefer_flags() {

        let err = parse_args(&args(&[
            "--prefer",
            "local",
            "--item-prefer",
            "remote",
            "a.db",
            "b.db",
        ]))
        .unwrap_err();
        assert!(err.to_string().contains("either --prefer"));
    }
}
