use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use rusqlite::types::Value;
use rusqlite::{Connection, Transaction};

use crate::args::Side;
use crate::diff::{DbDiff, TableDiff, TableSchema};
use crate::util::quote_ident;

#[derive(Clone, Debug, Default)]
pub struct MergeChoices {
    pub conflicts: BTreeMap<(String, String), Side>,
}

impl MergeChoices {
    pub fn prefer_all(diff: &DbDiff, side: Side) -> Self {
        let mut conflicts = BTreeMap::new();
        for table in &diff.tables {
            for conflict in &table.conflicts {
                conflicts.insert((table.schema.name.clone(), conflict.pk.clone()), side);
            }
        }
        Self { conflicts }
    }

    pub fn unresolved<'a>(&self, diff: &'a DbDiff) -> Vec<(&'a TableDiff, usize)> {
        let mut out = Vec::new();
        for table in &diff.tables {
            for (idx, conflict) in table.conflicts.iter().enumerate() {
                if !self
                    .conflicts
                    .contains_key(&(table.schema.name.clone(), conflict.pk.clone()))
                {
                    out.push((table, idx));
                }
            }
        }
        out
    }
}

pub fn build_merged_db(
    local_db: &Path,
    remote_db: &Path,
    diff: &DbDiff,
    choices: &MergeChoices,
) -> Result<PathBuf> {
    if let Some((table, idx)) = choices.unresolved(diff).into_iter().next() {
        let conflict = &table.conflicts[idx];
        bail!(
            "unresolved conflict {} {}",
            table.schema.name,
            conflict.display_pk
        );
    }

    let merged = local_db.with_file_name(format!(
        ".db-sync-merged-{}-{}.db",
        std::process::id(),
        crate::util::unix_millis()
    ));
    if merged.exists() {
        fs::remove_file(&merged)?;
    }
    fs::copy(local_db, &merged)
        .with_context(|| format!("copy {} -> {}", local_db.display(), merged.display()))?;

    let mut conn =
        Connection::open(&merged).with_context(|| format!("open merged {}", merged.display()))?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    conn.execute(
        "ATTACH DATABASE ?1 AS remote",
        [remote_db.to_string_lossy().as_ref()],
    )?;

    let tx = conn.transaction()?;
    apply_shared_tables(&tx, diff, choices)?;
    apply_remote_only_tables(&tx, diff)?;
    tx.commit()?;
    conn.execute_batch("DETACH DATABASE remote; PRAGMA foreign_keys = ON;")?;
    drop(conn);
    Ok(merged)
}

fn apply_shared_tables(tx: &Transaction<'_>, diff: &DbDiff, choices: &MergeChoices) -> Result<()> {
    for table in &diff.tables {
        for row in &table.remote_only {
            upsert_row(tx, &table.schema, &row.values)?;
        }
        for conflict in &table.conflicts {
            let side = choices
                .conflicts
                .get(&(table.schema.name.clone(), conflict.pk.clone()))
                .copied()
                .unwrap_or(Side::Local);
            if side == Side::Remote {
                upsert_row(tx, &table.schema, &conflict.remote)?;
            }
        }
    }
    Ok(())
}

fn apply_remote_only_tables(tx: &Transaction<'_>, diff: &DbDiff) -> Result<()> {
    for name in &diff.remote_only_tables {
        let sql: Option<String> = tx.query_row(
            "SELECT sql FROM remote.sqlite_master WHERE type = 'table' AND name = ?1",
            [name.as_str()],
            |row| row.get(0),
        )?;
        let Some(sql) = sql else {
            bail!("missing CREATE TABLE for remote-only {name}");
        };
        tx.execute_batch(&sql)?;
        let insert = format!(
            "INSERT INTO {} SELECT * FROM remote.{}",
            quote_ident(name),
            quote_ident(name)
        );
        tx.execute(&insert, [])?;

        let mut stmt = tx.prepare(
            "SELECT sql FROM remote.sqlite_master
             WHERE tbl_name = ?1 AND type IN ('index','trigger') AND sql IS NOT NULL",
        )?;
        let sqls = stmt
            .query_map([name.as_str()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for extra in sqls {
            tx.execute_batch(&extra)?;
        }
    }
    Ok(())
}

fn upsert_row(
    tx: &Transaction<'_>,
    schema: &TableSchema,
    values: &BTreeMap<String, Value>,
) -> Result<()> {
    let cols = schema
        .columns
        .iter()
        .map(|c| quote_ident(&c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = schema
        .columns
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO {} ({cols}) VALUES ({placeholders})",
        quote_ident(&schema.name)
    );
    let params: Vec<Value> = schema
        .columns
        .iter()
        .map(|c| values.get(&c.name).cloned().unwrap_or(Value::Null))
        .collect();
    tx.execute(&sql, rusqlite::params_from_iter(params))
        .with_context(|| format!("upsert {}", schema.name))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::diff_dbs;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn write_pair() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempdir().unwrap();
        let local = dir.path().join("local.db");
        let remote = dir.path().join("remote.db");
        let l = Connection::open(&local).unwrap();
        let r = Connection::open(&remote).unwrap();
        for conn in [&l, &r] {
            conn.execute_batch(
                "CREATE TABLE items (
                    id TEXT PRIMARY KEY,
                    name TEXT
                );",
            )
            .unwrap();
        }
        l.execute("INSERT INTO items VALUES ('keep','L')", [])
            .unwrap();
        l.execute("INSERT INTO items VALUES ('both','LOCAL')", [])
            .unwrap();
        r.execute("INSERT INTO items VALUES ('new','R')", [])
            .unwrap();
        r.execute("INSERT INTO items VALUES ('both','REMOTE')", [])
            .unwrap();
        drop(l);
        drop(r);
        (dir, local, remote)
    }

    #[test]
    fn merge_prefers_remote_conflicts_and_keeps_both_inserts() {
        let (_dir, local, remote) = write_pair();
        let l = Connection::open(&local).unwrap();
        let r = Connection::open(&remote).unwrap();
        let diff = diff_dbs(&l, &r, None).unwrap();
        drop(l);
        drop(r);
        let choices = MergeChoices::prefer_all(&diff, Side::Remote);
        let merged = build_merged_db(&local, &remote, &diff, &choices).unwrap();
        let conn = Connection::open(&merged).unwrap();
        let mut names = conn
            .prepare("SELECT id, name FROM items ORDER BY id")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        names.sort();
        assert_eq!(
            names,
            vec![
                ("both".into(), "REMOTE".into()),
                ("keep".into(), "L".into()),
                ("new".into(), "R".into()),
            ]
        );
        let _ = fs::remove_file(&merged);
    }

    #[test]
    fn merge_prefers_local_conflicts() {
        let (_dir, local, remote) = write_pair();
        let l = Connection::open(&local).unwrap();
        let r = Connection::open(&remote).unwrap();
        let diff = diff_dbs(&l, &r, None).unwrap();
        drop(l);
        drop(r);
        let choices = MergeChoices::prefer_all(&diff, Side::Local);
        let merged = build_merged_db(&local, &remote, &diff, &choices).unwrap();
        let name: String = Connection::open(&merged)
            .unwrap()
            .query_row("SELECT name FROM items WHERE id = 'both'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "LOCAL");
        let _ = fs::remove_file(&merged);
    }
}
