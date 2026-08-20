use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use rusqlite::backup::Backup;
use rusqlite::Connection;

use crate::args::{Options, Side, Target};
use crate::color::{paint, DIM};
use crate::crypto::{DataKey, Keyring};
use crate::reencrypt::reencrypt_file;
use crate::remote::{
    backup_install_remote, chown_remote, incoming_path, remote_owner, replace_file_remote,
    snapshot_remote, systemctl_user, RemoteExec,
};
use crate::snapshot::integrity_or_err;

pub fn backup_install_local(src: &Path, dest: &Path) -> Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if !dest.exists() {
        Connection::open(dest).with_context(|| format!("create {}", dest.display()))?;
    }
    let src_conn = Connection::open(src).with_context(|| format!("open {}", src.display()))?;
    let mut dest_conn =
        Connection::open(dest).with_context(|| format!("open dest {}", dest.display()))?;
    {
        let backup = Backup::new(&src_conn, &mut dest_conn)
            .with_context(|| format!("backup {} -> {}", src.display(), dest.display()))?;
        backup
            .run_to_completion(100, Duration::from_millis(25), None)
            .context("backup run")?;
    }
    dest_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    integrity_or_err(&dest_conn, dest)?;
    Ok(())
}

pub fn apply_to_target(
    opts: &Options,
    source: &Path,
    dest: &Target,
    write_remote_service: bool,
) -> Result<()> {
    match dest {
        Target::Local(path) => backup_install_local(source, path),
        Target::Remote { host, path } => {
            let exec = RemoteExec {
                host: host.clone(),
                sudo: opts.remote_sudo,
            };
            apply_remote(opts, &exec, source, path, write_remote_service)
        }
    }
}

fn apply_remote(
    opts: &Options,
    exec: &RemoteExec,
    source: &Path,
    dest: &Path,
    control_unit: bool,
) -> Result<()> {
    let incoming = incoming_path(dest);
    let owner = remote_owner(exec, dest)
        .ok()
        .filter(|name| !name.is_empty());
    let machine = opts.remote_machine();
    let unit = opts.remote_unit.as_deref();

    let stopped = if control_unit {
        if let (Some(machine), Some(unit)) = (machine.as_deref(), unit) {
            systemctl_user(exec, machine, "stop", unit)?;
            true
        } else {
            false
        }
    } else {
        false
    };

    let result = (|| -> Result<()> {
        if opts.snapshot {
            let snap = snapshot_remote(exec, dest, opts.retention)?;
            eprintln!(
                "{}",
                paint(
                    format!("snapshot remote: {}:{}", exec.host, snap.display()),
                    &[DIM]
                )
            );
        }
        exec.push_file(source, &incoming)?;
        if let Some(owner) = &owner {
            if opts.remote_sudo {
                let _ = chown_remote(exec, &incoming, owner);
            }
        }
        if stopped {
            replace_file_remote(exec, &incoming, dest)?;
            if let Some(owner) = &owner {
                if opts.remote_sudo {
                    let _ = chown_remote(exec, dest, owner);
                }
            }
        } else {
            backup_install_remote(exec, &incoming, dest)?;
            let _ = exec.remove_file(&incoming);
        }
        Ok(())
    })();

    if control_unit {
        if let (Some(machine), Some(unit)) = (machine.as_deref(), unit) {
            if let Err(err) = systemctl_user(exec, machine, "start", unit) {
                if result.is_ok() {
                    return Err(err).context("remote unit start after write");
                }
            }
        }
    }
    result
}

pub struct Applied {
    pub local: PathBuf,
    pub remote: PathBuf,
}

pub fn apply_plan(opts: &Options, winner_or_merged: &Path, mode: ApplyMode) -> Result<Applied> {
    match mode {
        ApplyMode::Whole { winner } => match winner {
            Side::Local => {
                let dest = opts.remote.clone();
                let source = prepare_encrypted(opts, winner_or_merged, Side::Remote)?;
                apply_to_target(opts, &source, &dest, true)?;
                let remote = match &opts.remote {
                    Target::Local(path) => path.clone(),
                    Target::Remote { .. } => source,
                };
                Ok(Applied {
                    local: opts.local.clone(),
                    remote,
                })
            }
            Side::Remote => {
                let source = prepare_encrypted(opts, winner_or_merged, Side::Local)?;
                backup_install_local(&source, &opts.local)?;
                Ok(Applied {
                    local: opts.local.clone(),
                    remote: winner_or_merged.to_path_buf(),
                })
            }
        },
        ApplyMode::Merged => {
            let local_src = prepare_encrypted(opts, winner_or_merged, Side::Local)?;
            backup_install_local(&local_src, &opts.local)?;
            let remote_src = prepare_encrypted(opts, winner_or_merged, Side::Remote)?;
            apply_to_target(opts, &remote_src, &opts.remote, true)?;
            let remote = match &opts.remote {
                Target::Local(path) => path.clone(),
                Target::Remote { .. } => remote_src,
            };
            Ok(Applied {
                local: opts.local.clone(),
                remote,
            })
        }
    }
}

fn prepare_encrypted(opts: &Options, source: &Path, dest_side: Side) -> Result<PathBuf> {
    if !opts.reencrypt {
        return Ok(source.to_path_buf());
    }
    let local_env = opts
        .local_env
        .as_deref()
        .context("--reencrypt requires --local-env")?;
    let remote_env = opts
        .remote_env
        .as_deref()
        .context("--reencrypt requires --remote-env")?;
    let local_key = DataKey::load_file(local_env)?;
    let remote_key = DataKey::load_file(remote_env)?;
    let dest_key = match dest_side {
        Side::Local => local_key.clone(),
        Side::Remote => remote_key.clone(),
    };
    let ring = Keyring::new([local_key, remote_key])?;
    let out = source.with_file_name(format!(
        "{}.reenc-{}.db",
        source.file_stem().and_then(|s| s.to_str()).unwrap_or("db"),
        dest_side.as_str()
    ));
    let started = std::time::Instant::now();
    let n = reencrypt_file(source, &out, &ring, &dest_key)?;
    eprintln!(
        "{}",
        paint(
            format!(
                "re-encrypt {n} fields toward {} ({}ms)",
                dest_side.as_str(),
                started.elapsed().as_millis()
            ),
            &[DIM]
        )
    );
    Ok(out)
}

#[derive(Clone, Copy, Debug)]
pub enum ApplyMode {
    Whole { winner: Side },
    Merged,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    #[test]
    fn backup_replaces_live_sqlite() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src.db");
        let dest = dir.path().join("dest.db");
        let s = Connection::open(&src).unwrap();
        s.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('new');")
            .unwrap();
        drop(s);
        let d = Connection::open(&dest).unwrap();
        d.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('old');")
            .unwrap();
        drop(d);
        backup_install_local(&src, &dest).unwrap();
        let value: String = Connection::open(&dest)
            .unwrap()
            .query_row("SELECT v FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "new");
    }
}
