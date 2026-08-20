pub mod apply;
pub mod args;
pub mod color;
pub mod crypto;
pub mod diff;
pub mod merge;
pub mod prompt;
pub mod reencrypt;
pub mod remote;
pub mod select;
pub mod snapshot;
pub mod util;
pub mod verify;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use apply::{apply_plan, backup_install_local, ApplyMode};
use args::{help_text, parse_args, Options, Side, Target};
use color::{paint, BLUE, BOLD, DIM, GREEN};
use crypto::{DataKey, Keyring};
use diff::{diff_dbs, open_readonly};
use merge::{build_merged_db, MergeChoices};
use prompt::{ask_menu, confirm_apply, print_summary, review_conflicts, stdin_is_tty, MenuChoice};
use remote::{snapshot_remote, RemoteExec};
use snapshot::snapshot_local;
use verify::{print_report, print_skip, verify_files, VerifyKeys, VerifyMode};

pub fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let opts = parse_args(&argv)?;
    if opts.help {
        print!("{}", help_text());
        return Ok(());
    }
    run_with_opts(opts)
}

pub fn run_with_opts(opts: Options) -> Result<()> {
    let local = resolve_existing(&opts.local)?;
    eprintln!(
        "{}",
        paint(format!("local:  {}", local.display()), &[BOLD, BLUE])
    );
    eprintln!(
        "{}",
        paint(format!("remote: {}", opts.remote.display()), &[BOLD, BLUE])
    );

    let work = tempfile_dir()?;
    let (local_snap, remote_snap) = prepare_copies(&opts, &local, &work)?;

    let local_conn = open_readonly(&local_snap)?;
    let remote_conn = open_readonly(&remote_snap)?;
    let crypto = load_crypto(&opts)?;
    let keys = crypto.as_ref().map(|(ring, _, _)| ring);
    let diff = diff_dbs(&local_conn, &remote_conn, keys)?;
    drop(local_conn);
    drop(remote_conn);

    print_summary(&diff);
    if diff.is_identical() && opts.prefer.is_none() {
        eprintln!("{}", paint("already in sync", &[GREEN]));
        if !opts.dry_run {
            run_verify(&opts, &local, &remote_snap, crypto.as_ref())?;
        }
        return Ok(());
    }

    let (source, mode) = resolve_plan(&opts, &diff, &local_snap, &remote_snap, &work)?;
    if opts.dry_run {
        eprintln!("{}", paint("dry-run: not writing", &[DIM]));
        return Ok(());
    }

    if !opts.yes {
        let msg = match mode {
            ApplyMode::Whole {
                winner: Side::Local,
            } => "overwrite remote with the entire local .db?",
            ApplyMode::Whole {
                winner: Side::Remote,
            } => "overwrite local with the entire remote .db?",
            ApplyMode::Merged => "apply the merged database to both sides?",
        };
        if !confirm_apply(msg)? {
            bail!("aborted");
        }
    }

    snapshot_after_confirm(&opts, &local, mode)?;
    let applied = apply_plan(&opts, &source, mode)?;
    run_verify(&opts, &applied.local, &applied.remote, crypto.as_ref())?;
    eprintln!("{}", paint("done", &[BOLD, GREEN]));
    Ok(())
}

fn load_crypto(opts: &Options) -> Result<Option<(Keyring, DataKey, DataKey)>> {
    match (&opts.local_env, &opts.remote_env) {
        (Some(local_env), Some(remote_env)) => {
            let local_key = DataKey::load_file(local_env)?;
            let remote_key = DataKey::load_file(remote_env)?;
            let ring = Keyring::new([local_key.clone(), remote_key.clone()])?;
            Ok(Some((ring, local_key, remote_key)))
        }
        _ => Ok(None),
    }
}

fn run_verify(
    opts: &Options,
    local: &Path,
    remote: &Path,
    crypto: Option<&(Keyring, DataKey, DataKey)>,
) -> Result<()> {
    if matches!(opts.verify, VerifyMode::Skip) {
        print_skip();
        return Ok(());
    }
    let keys = crypto.map(|(ring, local_key, remote_key)| VerifyKeys {
        ring,
        local: local_key,
        remote: remote_key,
        expect_dest_keys: opts.reencrypt,
    });
    let report = verify_files(local, remote, opts.verify, keys.as_ref())?;
    print_report(&report, opts.verify);
    if !report.ok() {
        bail!("post-sync verify failed");
    }
    Ok(())
}

fn resolve_plan(
    opts: &Options,
    diff: &diff::DbDiff,
    local_snap: &Path,
    remote_snap: &Path,
    work: &Path,
) -> Result<(PathBuf, ApplyMode)> {
    if let Some(winner) = opts.prefer {
        let source = match winner {
            Side::Local => local_snap.to_path_buf(),
            Side::Remote => remote_snap.to_path_buf(),
        };
        return Ok((source, ApplyMode::Whole { winner }));
    }

    let choices = if let Some(side) = opts.item_prefer {
        MergeChoices::prefer_all(diff, side)
    } else if stdin_is_tty() {
        match ask_menu()? {
            MenuChoice::ReviewItems => review_conflicts(diff)?,
            MenuChoice::WholeLocal => {
                return Ok((
                    local_snap.to_path_buf(),
                    ApplyMode::Whole {
                        winner: Side::Local,
                    },
                ));
            }
            MenuChoice::WholeRemote => {
                return Ok((
                    remote_snap.to_path_buf(),
                    ApplyMode::Whole {
                        winner: Side::Remote,
                    },
                ));
            }
            MenuChoice::Abort => bail!("aborted"),
        }
    } else {
        bail!("non-interactive stdin requires --prefer or --item-prefer");
    };

    let merged = build_merged_db(local_snap, remote_snap, diff, &choices)?;
    let dest = work.join("merged.db");
    if dest.exists() {
        fs::remove_file(&dest)?;
    }
    fs::rename(&merged, &dest).or_else(|_| {
        fs::copy(&merged, &dest)?;
        fs::remove_file(&merged)?;
        Ok::<(), anyhow::Error>(())
    })?;
    Ok((dest, ApplyMode::Merged))
}

fn prepare_copies(opts: &Options, local: &Path, work: &Path) -> Result<(PathBuf, PathBuf)> {
    let local_copy = work.join("local.db");
    copy_sqlite(local, &local_copy)?;

    let remote_copy = work.join("remote.db");
    match &opts.remote {
        Target::Local(path) => {
            let path = resolve_existing(path)?;
            copy_sqlite(&path, &remote_copy)?;
        }
        Target::Remote { host, path } => {
            let exec = RemoteExec {
                host: host.clone(),
                sudo: opts.remote_sudo,
            };
            exec.pull_file(path, &remote_copy)?;
        }
    };
    Ok((local_copy, remote_copy))
}

fn writes_remote(mode: ApplyMode) -> bool {
    match mode {
        ApplyMode::Whole {
            winner: Side::Local,
        }
        | ApplyMode::Merged => true,
        ApplyMode::Whole {
            winner: Side::Remote,
        } => false,
    }
}

fn snapshot_after_confirm(opts: &Options, local: &Path, mode: ApplyMode) -> Result<()> {
    if !opts.snapshot {
        return Ok(());
    }
    let path = snapshot_local(local, opts.retention)?;
    eprintln!(
        "{}",
        paint(format!("snapshot local:  {}", path.display()), &[DIM])
    );
    match &opts.remote {
        Target::Local(path) => {
            let path = resolve_existing(path)?;
            let snap = snapshot_local(&path, opts.retention)?;
            eprintln!(
                "{}",
                paint(format!("snapshot remote: {}", snap.display()), &[DIM])
            );
        }
        Target::Remote { host, path } if !writes_remote(mode) => {
            let exec = RemoteExec {
                host: host.clone(),
                sudo: opts.remote_sudo,
            };
            let snap = snapshot_remote(&exec, path, opts.retention)?;
            eprintln!(
                "{}",
                paint(
                    format!("snapshot remote: {}:{}", host, snap.display()),
                    &[DIM]
                )
            );
        }
        Target::Remote { .. } => {}
    }
    Ok(())
}

fn copy_sqlite(src: &Path, dest: &Path) -> Result<()> {
    backup_install_local(src, dest)
}

fn resolve_existing(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("database not found: {}", path.display()))
}

fn tempfile_dir() -> Result<PathBuf> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "db-sync-{}-{}-{}",
        std::process::id(),
        util::unix_millis(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    #[test]
    fn file_pair_same_pk_is_conflict() {
        let dir = tempdir().unwrap();
        let local = dir.path().join("app.db");
        let remote = dir.path().join("other.db");
        for (path, name) in [(&local, "L"), (&remote, "R")] {
            let conn = Connection::open(path).unwrap();
            conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT);")
                .unwrap();
            conn.execute("INSERT INTO items VALUES ('x', ?1)", [name])
                .unwrap();
        }
        let l = open_readonly(&local).unwrap();
        let r = open_readonly(&remote).unwrap();
        let schema = crate::diff::table_schema(&l, "items").unwrap();
        let lrows = crate::diff::load_rows(&l, &schema).unwrap();
        let rrows = crate::diff::load_rows(&r, &schema).unwrap();
        assert_eq!(schema.pk, vec!["id".to_string()], "pk={:?}", schema.pk);
        assert_eq!(
            lrows.keys().cloned().collect::<Vec<_>>(),
            rrows.keys().cloned().collect::<Vec<_>>(),
            "local={:?} remote={:?}",
            lrows.keys().collect::<Vec<_>>(),
            rrows.keys().collect::<Vec<_>>()
        );
        let diff = diff_dbs(&l, &r, None).unwrap();
        assert_eq!(diff.conflict_rows(), 1);
        assert_eq!(diff.local_only_rows(), 0);
        assert_eq!(diff.remote_only_rows(), 0);
    }

    #[test]
    fn end_to_end_local_item_prefer() {
        let dir = tempdir().unwrap();
        let local = dir.path().join("app.db");
        let remote = dir.path().join("other.db");
        for (path, name) in [(&local, "L"), (&remote, "R")] {
            let conn = Connection::open(path).unwrap();
            conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT);")
                .unwrap();
            conn.execute("INSERT INTO items VALUES ('x', ?1)", [name])
                .unwrap();
        }
        let opts = Options {
            help: false,
            local: local.clone(),
            remote: Target::Local(remote.clone()),
            prefer: None,
            item_prefer: Some(Side::Remote),
            dry_run: false,
            yes: true,
            snapshot: false,
            retention: 5,
            remote_sudo: false,
            remote_unit: None,
            remote_machine: None,
            reencrypt: false,
            local_env: None,
            remote_env: None,
            verify: VerifyMode::Skip,
        };
        run_with_opts(opts).unwrap();
        let name: String = Connection::open(&local)
            .unwrap()
            .query_row("SELECT name FROM items WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "R");
        let remote_name: String = Connection::open(&remote)
            .unwrap()
            .query_row("SELECT name FROM items WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remote_name, "R");
    }

    #[test]
    fn whole_db_prefer_local_overwrites_other() {
        let dir = tempdir().unwrap();
        let local = dir.path().join("app.db");
        let remote = dir.path().join("other.db");
        let l = Connection::open(&local).unwrap();
        l.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT); INSERT INTO items VALUES ('x','L');")
            .unwrap();
        drop(l);
        let r = Connection::open(&remote).unwrap();
        r.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT); INSERT INTO items VALUES ('y','R');")
            .unwrap();
        drop(r);
        let opts = Options {
            help: false,
            local: local.clone(),
            remote: Target::Local(remote.clone()),
            prefer: Some(Side::Local),
            item_prefer: None,
            dry_run: false,
            yes: true,
            snapshot: false,
            retention: 5,
            remote_sudo: false,
            remote_unit: None,
            remote_machine: None,
            reencrypt: false,
            local_env: None,
            remote_env: None,
            verify: VerifyMode::Skip,
        };
        run_with_opts(opts).unwrap();
        let count: i64 = Connection::open(&remote)
            .unwrap()
            .query_row("SELECT count(*) FROM items", [], |row| row.get(0))
            .unwrap();
        let name: String = Connection::open(&remote)
            .unwrap()
            .query_row("SELECT name FROM items WHERE id = 'x'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(name, "L");
    }

    #[test]
    fn dry_run_does_not_snapshot() {
        let dir = tempdir().unwrap();
        let local = dir.path().join("app.db");
        let remote = dir.path().join("other.db");
        for path in [&local, &remote] {
            let conn = Connection::open(path).unwrap();
            conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT); INSERT INTO items VALUES ('x','L');")
                .unwrap();
        }
        let opts = Options {
            help: false,
            local: local.clone(),
            remote: Target::Local(remote.clone()),
            prefer: Some(Side::Local),
            item_prefer: None,
            dry_run: true,
            yes: true,
            snapshot: true,
            retention: 5,
            remote_sudo: false,
            remote_unit: None,
            remote_machine: None,
            reencrypt: false,
            local_env: None,
            remote_env: None,
            verify: VerifyMode::Skip,
        };
        run_with_opts(opts).unwrap();
        assert!(!dir.path().join("snapshots").exists());
    }

    #[test]
    fn snapshots_after_apply_only() {
        let dir = tempdir().unwrap();
        let local = dir.path().join("app.db");
        let remote = dir.path().join("other.db");
        for (path, name) in [(&local, "L"), (&remote, "R")] {
            let conn = Connection::open(path).unwrap();
            conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT);")
                .unwrap();
            conn.execute("INSERT INTO items VALUES ('x', ?1)", [name])
                .unwrap();
        }
        let opts = Options {
            help: false,
            local: local.clone(),
            remote: Target::Local(remote.clone()),
            prefer: Some(Side::Local),
            item_prefer: None,
            dry_run: false,
            yes: true,
            snapshot: true,
            retention: 5,
            remote_sudo: false,
            remote_unit: None,
            remote_machine: None,
            reencrypt: false,
            local_env: None,
            remote_env: None,
            verify: VerifyMode::Skip,
        };
        run_with_opts(opts).unwrap();
        let snaps: Vec<_> = std::fs::read_dir(dir.path().join("snapshots"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".db") && !n.contains("latest"))
            .collect();
        assert!(snaps.iter().any(|n| n.starts_with("app-")), "{snaps:?}");
        assert!(snaps.iter().any(|n| n.starts_with("other-")), "{snaps:?}");
    }
}
