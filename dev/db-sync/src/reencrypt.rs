use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{params_from_iter, Connection};

use crate::crypto::{ciphertext_key_id, DataKey, Keyring};
use crate::snapshot::integrity_or_err;
use crate::util::{quote_ident, sql_quote_path};

pub const SENSITIVE_FIELDS: &[(&str, &str)] = &[
    ("prop_units", "door_password"),
    ("prop_units", "memo"),
    ("prop_units", "contacts_json"),
    ("prop_units", "passwords_json"),
    ("prop_units", "owner_name"),
    ("prop_units", "owner_phone"),
    ("prop_comments", "content"),
    ("sys_pending_approvals", "payload"),
    ("sys_trash", "resource_data"),
    ("log_history", "before_data"),
    ("log_history", "after_data"),
    ("log_snapshots", "snapshot_data"),
];

const PARALLEL_MIN_ROWS: usize = 64;

pub fn reencrypt_file(
    src: &Path,
    dest: &Path,
    keys: &Keyring,
    dest_key: &DataKey,
) -> Result<usize> {
    clone_db(src, dest)?;
    let mut conn =
        Connection::open(dest).with_context(|| format!("open {}", dest.display()))?;
    let _journal: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    conn.execute_batch("PRAGMA synchronous = OFF")?;
    let changed = reencrypt_conn(&mut conn, keys, dest_key)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(changed)
}

fn clone_db(src: &Path, dest: &Path) -> Result<()> {
    if dest.exists() {
        std::fs::remove_file(dest).ok();
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if sidecar_len(src, "-wal")? == 0 && sidecar_len(src, "-journal")? == 0 {
        std::fs::copy(src, dest)
            .with_context(|| format!("copy {} -> {}", src.display(), dest.display()))?;
        return Ok(());
    }
    let src_conn =
        Connection::open(src).with_context(|| format!("open {}", src.display()))?;
    integrity_or_err(&src_conn, src)?;
    src_conn
        .execute(&format!("VACUUM INTO {}", sql_quote_path(dest)), [])
        .with_context(|| format!("copy {} -> {}", src.display(), dest.display()))?;
    Ok(())
}

fn sidecar_len(path: &Path, suffix: &str) -> Result<u64> {
    let mut raw = path.as_os_str().to_owned();
    raw.push(suffix);
    match std::fs::metadata(PathBuf::from(raw)) {
        Ok(meta) => Ok(meta.len()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(0),
        Err(err) => Err(err.into()),
    }
}

fn reencrypt_conn(conn: &mut Connection, keys: &Keyring, dest_key: &DataKey) -> Result<usize> {
    let grouped = fields_by_table();
    let tx = conn.transaction()?;
    let mut changed = 0;
    for (table, fields) in grouped {
        changed += reencrypt_table(&tx, table, &fields, keys, dest_key)?;
    }
    tx.commit()?;
    Ok(changed)
}

fn reencrypt_table(
    conn: &Connection,
    table: &str,
    fields: &[&str],
    keys: &Keyring,
    dest_key: &DataKey,
) -> Result<usize> {
    let live: Vec<&str> = fields
        .iter()
        .copied()
        .filter(|field| table_has_column(conn, table, field).unwrap_or(false))
        .collect();
    if live.is_empty() {
        return Ok(0);
    }
    let Some(pk) = single_pk(conn, table)? else {
        return Ok(0);
    };
    let pk_ident = quote_ident(&pk);
    let table_ident = quote_ident(table);
    let field_idents: Vec<String> = live.iter().map(|field| quote_ident(field)).collect();
    let like = dest_like_pattern(&dest_key.id);
    let where_sql = field_idents
        .iter()
        .map(|ident| {
            format!("{ident} IS NOT NULL AND {ident} != '' AND {ident} NOT LIKE ?1 ESCAPE '\\'")
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    let select = format!(
        "SELECT {pk_ident}, {} FROM {table_ident} WHERE {where_sql}",
        field_idents.join(", ")
    );
    let rows: Vec<(String, Vec<Option<String>>)> = {
        let mut stmt = conn.prepare(&select)?;
        let mapped = stmt.query_map([&like], |row| {
            let id: String = row.get(0)?;
            let mut values = Vec::with_capacity(live.len());
            for idx in 0..live.len() {
                values.push(row.get(idx + 1)?);
            }
            Ok((id, values))
        })?;
        mapped.collect::<rusqlite::Result<_>>()?
    };
    if rows.is_empty() {
        return Ok(0);
    }

    let (changed, pending) = transform_rows(table, &live, rows, keys, dest_key)?;
    if pending.is_empty() {
        return Ok(0);
    }

    let temp = quote_ident(&format!("reenc_{table}"));
    conn.execute(&format!("DROP TABLE IF EXISTS {temp}"), [])?;
    let create_cols = std::iter::once(format!("{pk_ident} TEXT PRIMARY KEY"))
        .chain(field_idents.iter().map(|ident| format!("{ident} TEXT")))
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute(&format!("CREATE TEMP TABLE {temp} ({create_cols})"), [])?;

    let placeholders = (1..=live.len() + 1)
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let insert_cols = std::iter::once(pk_ident.clone())
        .chain(field_idents.iter().cloned())
        .collect::<Vec<_>>()
        .join(", ");
    let insert_sql = format!("INSERT INTO {temp} ({insert_cols}) VALUES ({placeholders})");
    let mut insert = conn.prepare(&insert_sql)?;
    for (id, values) in &pending {
        let mut params: Vec<Option<String>> = Vec::with_capacity(live.len() + 1);
        params.push(Some(id.clone()));
        params.extend(values.iter().cloned());
        insert.execute(params_from_iter(params))?;
    }
    drop(insert);

    let set_sql = field_idents
        .iter()
        .map(|ident| format!("{ident} = COALESCE({temp}.{ident}, {table_ident}.{ident})"))
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute(
        &format!(
            "UPDATE {table_ident} SET {set_sql} FROM {temp} WHERE {table_ident}.{pk_ident} = {temp}.{pk_ident}"
        ),
        [],
    )?;
    conn.execute(&format!("DROP TABLE {temp}"), [])?;
    Ok(changed)
}

fn transform_rows(
    table: &str,
    live: &[&str],
    rows: Vec<(String, Vec<Option<String>>)>,
    keys: &Keyring,
    dest_key: &DataKey,
) -> Result<(usize, Vec<(String, Vec<Option<String>>)>)> {
    let transformed = map_parallel(rows, |(id, values)| {
        transform_row(table, live, id, values, keys, dest_key)
    })?;
    let mut changed = 0;
    let mut pending = Vec::new();
    for (n, row) in transformed {
        changed += n;
        if let Some(row) = row {
            pending.push(row);
        }
    }
    Ok((changed, pending))
}

fn transform_row(
    table: &str,
    live: &[&str],
    id: &str,
    values: &[Option<String>],
    keys: &Keyring,
    dest_key: &DataKey,
) -> Result<(usize, Option<(String, Vec<Option<String>>)>)> {
    let mut next_row = vec![None; live.len()];
    let mut row_changed = false;
    let mut changed = 0;
    for (idx, field) in live.iter().enumerate() {
        let Some(value) = values.get(idx).and_then(|v| v.as_deref()).filter(|s| !s.is_empty())
        else {
            continue;
        };
        if ciphertext_key_id(value) == Some(dest_key.id.as_str()) {
            continue;
        }
        let next = keys
            .toward_dest(dest_key, table, id, field, value)
            .with_context(|| format!("re-encrypt {table}.{field}"))?;
        if next != value {
            next_row[idx] = Some(next);
            row_changed = true;
            changed += 1;
        }
    }
    if row_changed {
        Ok((changed, Some((id.to_string(), next_row))))
    } else {
        Ok((changed, None))
    }
}

fn map_parallel<T, R, F>(items: Vec<T>, map: F) -> Result<Vec<R>>
where
    T: Send + Sync,
    R: Send,
    F: Fn(&T) -> Result<R> + Sync,
{
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    if items.len() < PARALLEL_MIN_ROWS || threads <= 1 {
        return items.iter().map(map).collect();
    }
    let chunk_len = items.len().div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in items.chunks(chunk_len) {
            handles.push(scope.spawn(|| chunk.iter().map(&map).collect::<Result<Vec<_>>>()));
        }
        let mut out = Vec::with_capacity(items.len());
        for handle in handles {
            match handle.join() {
                Ok(Ok(part)) => out.extend(part),
                Ok(Err(err)) => return Err(err),
                Err(_) => anyhow::bail!("reencrypt worker panicked"),
            }
        }
        Ok(out)
    })
}

fn fields_by_table() -> BTreeMap<&'static str, Vec<&'static str>> {
    let mut grouped = BTreeMap::new();
    for &(table, field) in SENSITIVE_FIELDS {
        grouped.entry(table).or_insert_with(Vec::new).push(field);
    }
    grouped
}

fn dest_like_pattern(key_id: &str) -> String {
    let escaped = key_id
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("enc:v1:{escaped}:%")
}

fn single_pk(conn: &Connection, table: &str) -> Result<Option<String>> {
    let mut stmt =
        conn.prepare("SELECT name FROM pragma_table_info(?1) WHERE pk > 0 ORDER BY pk")?;
    let names = stmt
        .query_map([table], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if names.len() == 1 {
        Ok(Some(names.into_iter().next().unwrap()))
    } else {
        Ok(None)
    }
}

fn table_has_column(conn: &Connection, table: &str, field: &str) -> Result<bool> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(false);
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        rusqlite::params![table, field],
        |row| row.get(0),
    )?;
    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::DataKey;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use tempfile::tempdir;

    fn key(id: &str, fill: u8) -> DataKey {
        DataKey::from_base64(id, &URL_SAFE_NO_PAD.encode([fill; 32])).unwrap()
    }

    #[test]
    fn reencrypts_unit_memo_to_dest_key() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src.db");
        let dest = dir.path().join("dest.db");
        let local = key("local", 3);
        let prod = key("prod", 7);
        let ring = Keyring::new([local.clone(), prod.clone()]).unwrap();
        let conn = Connection::open(&src).unwrap();
        conn.execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
            .unwrap();
        let enc = ring
            .encrypt(&local, "prop_units", "u1", "memo", "hello")
            .unwrap();
        conn.execute(
            "INSERT INTO prop_units (id, memo) VALUES ('u1', ?1)",
            [&enc],
        )
        .unwrap();
        drop(conn);
        let n = reencrypt_file(&src, &dest, &ring, &prod).unwrap();
        assert_eq!(n, 1);
        let stored: String = Connection::open(&dest)
            .unwrap()
            .query_row("SELECT memo FROM prop_units WHERE id = 'u1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(stored.starts_with("enc:v1:prod:"));
        assert_eq!(
            ring.decrypt("prop_units", "u1", "memo", &stored).unwrap(),
            "hello"
        );
    }

    #[test]
    fn skips_rows_already_on_dest_key() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src.db");
        let dest = dir.path().join("dest.db");
        let local = key("local", 3);
        let prod = key("prod", 7);
        let ring = Keyring::new([local.clone(), prod.clone()]).unwrap();
        let conn = Connection::open(&src).unwrap();
        conn.execute_batch(
            "CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT, contacts_json TEXT);",
        )
        .unwrap();
        let keep = ring
            .encrypt(&prod, "prop_units", "keep", "memo", "stay")
            .unwrap();
        let move_me = ring
            .encrypt(&local, "prop_units", "move", "memo", "go")
            .unwrap();
        conn.execute(
            "INSERT INTO prop_units (id, memo) VALUES ('keep', ?1), ('move', ?2)",
            rusqlite::params![keep, move_me],
        )
        .unwrap();
        drop(conn);
        let n = reencrypt_file(&src, &dest, &ring, &prod).unwrap();
        assert_eq!(n, 1);
        let out = Connection::open(&dest).unwrap();
        let keep_id: String = out
            .query_row(
                "SELECT memo FROM prop_units WHERE id = 'keep'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(keep_id.starts_with("enc:v1:prod:"));
        let moved: String = out
            .query_row(
                "SELECT memo FROM prop_units WHERE id = 'move'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(moved.starts_with("enc:v1:prod:"));
        assert_eq!(
            ring.decrypt("prop_units", "move", "memo", &moved).unwrap(),
            "go"
        );
    }

    #[test]
    fn reencrypts_many_rows_in_parallel() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src.db");
        let dest = dir.path().join("dest.db");
        let local = key("local", 3);
        let prod = key("prod", 7);
        let ring = Keyring::new([local.clone(), prod.clone()]).unwrap();
        let conn = Connection::open(&src).unwrap();
        conn.execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
            .unwrap();
        let mut insert = conn
            .prepare("INSERT INTO prop_units (id, memo) VALUES (?1, ?2)")
            .unwrap();
        for i in 0..256 {
            let id = format!("u{i}");
            let enc = ring
                .encrypt(&local, "prop_units", &id, "memo", "payload")
                .unwrap();
            insert.execute(rusqlite::params![id, enc]).unwrap();
        }
        drop(insert);
        drop(conn);
        let n = reencrypt_file(&src, &dest, &ring, &prod).unwrap();
        assert_eq!(n, 256);
        let out = Connection::open(&dest).unwrap();
        let count: i64 = out
            .query_row(
                "SELECT count(*) FROM prop_units WHERE memo LIKE 'enc:v1:prod:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 256);
        let sample: String = out
            .query_row("SELECT memo FROM prop_units WHERE id = 'u0'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            ring.decrypt("prop_units", "u0", "memo", &sample).unwrap(),
            "payload"
        );
    }
}
