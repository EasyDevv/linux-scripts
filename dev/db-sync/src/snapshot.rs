use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use rusqlite::Connection;

use crate::util::{db_stem, snapshots_dir, sql_quote_path};

pub fn snapshot_local(db_path: &Path, retention: usize) -> Result<PathBuf> {
    if !db_path.is_file() {
        bail!("database not found: {}", db_path.display());
    }
    let snap_dir = snapshots_dir(db_path);
    fs::create_dir_all(&snap_dir).with_context(|| format!("create {}", snap_dir.display()))?;
    fs::set_permissions(&snap_dir, fs::Permissions::from_mode(0o700))?;

    let stem = db_stem(db_path);
    let prefix = format!("{stem}-");
    let timestamp = crate::util::unix_millis();
    let tmp = snap_dir.join(format!("_tmp_{stem}-{timestamp}.db"));
    let final_path = snap_dir.join(format!("{stem}-{timestamp}.db"));
    let latest = snap_dir.join(format!("{stem}-latest.db"));

    let result = (|| {
        let conn =
            Connection::open(db_path).with_context(|| format!("open {}", db_path.display()))?;
        integrity_or_err(&conn, db_path)?;
        conn.execute_batch(&format!("VACUUM INTO {}", sql_quote_path(&tmp)))
            .with_context(|| format!("VACUUM INTO {}", tmp.display()))?;
        drop(conn);

        let verify = Connection::open(&tmp)?;
        integrity_or_err(&verify, &tmp)?;
        drop(verify);

        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        fs::rename(&tmp, &final_path)
            .with_context(|| format!("rename {}", final_path.display()))?;

        if latest.exists() || latest.symlink_metadata().is_ok() {
            let _ = fs::remove_file(&latest);
        }
        symlink(format!("{stem}-{timestamp}.db"), &latest)
            .with_context(|| format!("symlink {}", latest.display()))?;

        prune_snapshots(&snap_dir, &prefix, &format!("{stem}-latest.db"), retention)?;
        Ok(final_path.clone())
    })();

    if result.is_err() && tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn prune_snapshots(
    dir: &Path,
    prefix: &str,
    latest_name: &str,
    retention: usize,
) -> Result<Vec<PathBuf>> {
    let mut files = list_snapshots(dir, prefix, latest_name)?;
    files.sort();
    if retention == 0 || files.len() <= retention {
        return Ok(Vec::new());
    }
    let remove_n = files.len() - retention;
    let mut removed = Vec::new();
    for path in files.into_iter().take(remove_n) {
        fs::remove_file(&path)
            .with_context(|| format!("remove old snapshot {}", path.display()))?;
        removed.push(path);
    }
    Ok(removed)
}

pub fn list_snapshots(dir: &Path, prefix: &str, latest_name: &str) -> Result<Vec<PathBuf>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !is_snapshot_name(&name, prefix, latest_name) {
            continue;
        }
        files.push(entry.path());
    }
    Ok(files)
}

pub fn is_snapshot_name(name: &str, prefix: &str, latest_name: &str) -> bool {
    if name == latest_name || name.starts_with("_tmp_") {
        return false;
    }
    name.starts_with(prefix) && name.ends_with(".db")
}

pub fn integrity_or_err(conn: &Connection, path: &Path) -> Result<()> {
    let status: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .with_context(|| format!("integrity_check {}", path.display()))?;
    if status != "ok" {
        bail!("corrupt {}: {status}", path.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_db(path: &Path, value: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
        conn.execute("INSERT INTO t VALUES (?1)", [value]).unwrap();
    }

    #[test]
    fn snapshot_and_prune_keeps_newest() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("app.db");
        write_db(&db, "one");

        let first = snapshot_local(&db, 2).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = snapshot_local(&db, 2).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let third = snapshot_local(&db, 2).unwrap();

        assert!(second.exists());
        assert!(third.exists());
        assert!(!first.exists());

        let snap_dir = snapshots_dir(&db);
        let files = list_snapshots(&snap_dir, "app-", "app-latest.db").unwrap();
        assert_eq!(files.len(), 2);
        let latest = snap_dir.join("app-latest.db");
        assert!(latest.exists());
    }

    #[test]
    fn rejects_corrupt_source() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("app.db");
        fs::write(&db, b"BROKEN").unwrap();
        assert!(snapshot_local(&db, 5).is_err());
    }
}
