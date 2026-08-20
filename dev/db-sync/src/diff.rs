use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{bail, Context, Result};
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags};

use crate::crypto::Keyring;
use crate::reencrypt::SENSITIVE_FIELDS;
use crate::snapshot::integrity_or_err;
use crate::util::{encode_value, quote_ident};

#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    pub name: String,
    pub pk: i32,
}

#[derive(Clone, Debug)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<Column>,
    pub pk: Vec<String>,
}

impl TableSchema {
    pub fn pk_key(&self, values: &BTreeMap<String, Value>) -> String {
        if self.pk.is_empty() {
            let mut parts = Vec::new();
            for (name, value) in values {
                parts.push(format!("{name}={}", encode_value(value)));
            }
            return parts.join("|");
        }
        self.pk
            .iter()
            .map(|name| {
                let value = values.get(name).cloned().unwrap_or(Value::Null);
                format!("{name}={}", encode_value(&value))
            })
            .collect::<Vec<_>>()
            .join("|")
    }

    pub fn display_pk(&self, values: &BTreeMap<String, Value>) -> String {
        if self.pk.is_empty() {
            return self.pk_key(values);
        }
        self.pk
            .iter()
            .map(|name| {
                let value = values.get(name).cloned().unwrap_or(Value::Null);
                format!("{name}={}", crate::util::display_value(&value))
            })
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[derive(Clone, Debug)]
pub struct Row {
    pub pk: String,
    pub display_pk: String,
    pub values: BTreeMap<String, Value>,
}

#[derive(Clone, Debug)]
pub struct Conflict {
    pub pk: String,
    pub display_pk: String,
    pub local: BTreeMap<String, Value>,
    pub remote: BTreeMap<String, Value>,
    pub changed: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct TableDiff {
    pub schema: TableSchema,
    pub local_only: Vec<Row>,
    pub remote_only: Vec<Row>,
    pub conflicts: Vec<Conflict>,
    pub identical: usize,
    pub column_order_differs: bool,
}

impl TableDiff {
    pub fn is_empty(&self) -> bool {
        self.local_only.is_empty() && self.remote_only.is_empty() && self.conflicts.is_empty()
    }
}

#[derive(Clone, Debug)]
pub struct DbDiff {
    pub tables: Vec<TableDiff>,
    pub local_only_tables: Vec<String>,
    pub remote_only_tables: Vec<String>,
}

impl DbDiff {
    pub fn local_only_rows(&self) -> usize {
        self.tables.iter().map(|t| t.local_only.len()).sum()
    }

    pub fn remote_only_rows(&self) -> usize {
        self.tables.iter().map(|t| t.remote_only.len()).sum()
    }

    pub fn conflict_rows(&self) -> usize {
        self.tables.iter().map(|t| t.conflicts.len()).sum()
    }

    pub fn identical_rows(&self) -> usize {
        self.tables.iter().map(|t| t.identical).sum()
    }

    pub fn is_identical(&self) -> bool {
        self.local_only_rows() == 0
            && self.remote_only_rows() == 0
            && self.conflict_rows() == 0
            && self.local_only_tables.is_empty()
            && self.remote_only_tables.is_empty()
    }
}

pub fn open_readonly(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("open {}", path.display()))?;
    integrity_or_err(&conn, path)?;
    Ok(conn)
}

pub fn list_user_tables(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    )?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names)
}

pub fn table_schema(conn: &Connection, name: &str) -> Result<TableSchema> {
    let mut stmt = conn.prepare("SELECT name, pk FROM pragma_table_info(?1) ORDER BY cid")?;
    let mut columns = Vec::new();
    let mut pk_slots: Vec<(i32, String)> = Vec::new();
    let rows = stmt.query_map([name], |row| {
        let col_name: String = row.get(0)?;
        let pk: i32 = row.get(1)?;
        Ok((col_name, pk))
    })?;
    for row in rows {
        let (col_name, pk) = row?;
        if pk > 0 {
            pk_slots.push((pk, col_name.clone()));
        }
        columns.push(Column { name: col_name, pk });
    }
    pk_slots.sort_by_key(|(pk, _)| *pk);
    Ok(TableSchema {
        name: name.to_string(),
        columns,
        pk: pk_slots.into_iter().map(|(_, name)| name).collect(),
    })
}

pub fn column_names(schema: &TableSchema) -> BTreeSet<&str> {
    schema.columns.iter().map(|c| c.name.as_str()).collect()
}

pub fn column_order_differs(local: &TableSchema, remote: &TableSchema) -> bool {
    local
        .columns
        .iter()
        .map(|c| c.name.as_str())
        .ne(remote.columns.iter().map(|c| c.name.as_str()))
}

pub fn schema_compatible(local: &TableSchema, remote: &TableSchema) -> Result<()> {
    let local_names = column_names(local);
    let remote_names = column_names(remote);
    if local_names == remote_names && local.pk == remote.pk {
        return Ok(());
    }
    let local_only: Vec<&str> = local_names.difference(&remote_names).copied().collect();
    let remote_only: Vec<&str> = remote_names.difference(&local_names).copied().collect();
    bail!(
        "schema mismatch for {}: local-only columns {:?} remote-only columns {:?} pk {:?} vs {:?}",
        local.name,
        local_only,
        remote_only,
        local.pk,
        remote.pk
    );
}

pub fn load_rows(conn: &Connection, schema: &TableSchema) -> Result<BTreeMap<String, Row>> {
    let cols = schema
        .columns
        .iter()
        .map(|c| quote_ident(&c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("SELECT {cols} FROM {}", quote_ident(&schema.name));
    let mut stmt = conn.prepare(&sql)?;
    let col_count = schema.columns.len();
    let mut out = BTreeMap::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let mut values = BTreeMap::new();
        for (idx, col) in schema.columns.iter().enumerate() {
            if idx >= col_count {
                break;
            }
            let value: Value = row.get(idx)?;
            values.insert(col.name.clone(), value);
        }
        let pk = schema.pk_key(&values);
        let display_pk = schema.display_pk(&values);
        out.insert(
            pk.clone(),
            Row {
                pk,
                display_pk,
                values,
            },
        );
    }
    Ok(out)
}

pub fn diff_dbs(local: &Connection, remote: &Connection, keys: Option<&Keyring>) -> Result<DbDiff> {
    let local_tables: BTreeSet<String> = list_user_tables(local)?.into_iter().collect();
    let remote_tables: BTreeSet<String> = list_user_tables(remote)?.into_iter().collect();

    let local_only_tables = local_tables
        .difference(&remote_tables)
        .cloned()
        .collect::<Vec<_>>();
    let remote_only_tables = remote_tables
        .difference(&local_tables)
        .cloned()
        .collect::<Vec<_>>();

    let mut tables = Vec::new();
    for name in local_tables.intersection(&remote_tables) {
        let local_schema = table_schema(local, name)?;
        let remote_schema = table_schema(remote, name)?;
        schema_compatible(&local_schema, &remote_schema)?;
        let mut table = diff_table(local, remote, &local_schema, keys)?;
        table.column_order_differs = column_order_differs(&local_schema, &remote_schema);
        tables.push(table);
    }
    tables.sort_by(|a, b| a.schema.name.cmp(&b.schema.name));

    Ok(DbDiff {
        tables,
        local_only_tables,
        remote_only_tables,
    })
}

pub fn diff_table(
    local: &Connection,
    remote: &Connection,
    schema: &TableSchema,
    keys: Option<&Keyring>,
) -> Result<TableDiff> {
    let local_rows = load_rows(local, schema)?;
    let remote_rows = load_rows(remote, schema)?;
    let mut local_only = Vec::new();
    let mut remote_only = Vec::new();
    let mut conflicts = Vec::new();
    let mut identical = 0usize;

    for (pk, row) in &local_rows {
        match remote_rows.get(pk) {
            None => local_only.push(row.clone()),
            Some(other) if row_equal(&schema.name, &row.values, &other.values, keys) => identical += 1,
            Some(other) => conflicts.push(Conflict {
                pk: pk.clone(),
                display_pk: row.display_pk.clone(),
                local: row.values.clone(),
                remote: other.values.clone(),
                changed: changed_columns(&schema.name, &row.values, &other.values, keys),
            }),
        }
    }
    for (pk, row) in &remote_rows {
        if !local_rows.contains_key(pk) {
            remote_only.push(row.clone());
        }
    }

    local_only.sort_by(|a, b| a.pk.cmp(&b.pk));
    remote_only.sort_by(|a, b| a.pk.cmp(&b.pk));
    conflicts.sort_by(|a, b| a.pk.cmp(&b.pk));

    Ok(TableDiff {
        schema: schema.clone(),
        local_only,
        remote_only,
        conflicts,
        identical,
        column_order_differs: false,
    })
}

pub fn row_equal(
    table: &str,
    a: &BTreeMap<String, Value>,
    b: &BTreeMap<String, Value>,
    keys: Option<&Keyring>,
) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().all(|(k, v)| match b.get(k) {
        Some(other) => cell_equal(table, k, a, v, other, keys),
        None => false,
    })
}

pub fn changed_columns(
    table: &str,
    a: &BTreeMap<String, Value>,
    b: &BTreeMap<String, Value>,
    keys: Option<&Keyring>,
) -> Vec<String> {
    let mut names: BTreeSet<String> = a.keys().cloned().collect();
    names.extend(b.keys().cloned());
    names
        .into_iter()
        .filter(|name| match (a.get(name), b.get(name)) {
            (Some(l), Some(r)) => !cell_equal(table, name, a, l, r, keys),
            _ => true,
        })
        .collect()
}

fn cell_equal(
    table: &str,
    field: &str,
    row: &BTreeMap<String, Value>,
    left: &Value,
    right: &Value,
    keys: Option<&Keyring>,
) -> bool {
    if encode_value(left) == encode_value(right) {
        return true;
    }
    let Some(ring) = keys else {
        return false;
    };
    if !SENSITIVE_FIELDS.contains(&(table, field)) {
        return false;
    }
    let (Value::Text(lt), Value::Text(rt)) = (left, right) else {
        return false;
    };
    let record_id = match row.get("id") {
        Some(Value::Text(s)) => s.as_str(),
        _ => return false,
    };
    match (
        ring.plaintext(table, record_id, field, lt),
        ring.plaintext(table, record_id, field, rt),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE items (
                id TEXT PRIMARY KEY,
                name TEXT,
                n INTEGER
            );",
        )
        .unwrap();
    }

    #[test]
    fn classifies_only_conflict_and_equal() {
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        seed(&local);
        seed(&remote);
        local
            .execute("INSERT INTO items VALUES ('a','one',1)", [])
            .unwrap();
        local
            .execute("INSERT INTO items VALUES ('b','two',2)", [])
            .unwrap();
        local
            .execute("INSERT INTO items VALUES ('c','same',3)", [])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('b','TWO',9)", [])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('c','same',3)", [])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('d','new',4)", [])
            .unwrap();

        let diff = diff_dbs(&local, &remote, None).unwrap();
        assert_eq!(diff.tables.len(), 1);
        let table = &diff.tables[0];
        assert_eq!(table.local_only.len(), 1);
        assert_eq!(table.local_only[0].pk, "id=Ta");
        assert_eq!(table.remote_only.len(), 1);
        assert_eq!(table.remote_only[0].pk, "id=Td");
        assert_eq!(table.conflicts.len(), 1);
        assert_eq!(table.conflicts[0].pk, "id=Tb");
        assert_eq!(table.identical, 1);
        assert_eq!(table.conflicts[0].changed, vec!["n", "name"]);
    }

    #[test]
    fn schema_mismatch_errors() {
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        seed(&local);
        remote
            .execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, extra TEXT);")
            .unwrap();
        local
            .execute("INSERT INTO items VALUES ('a','one',1)", [])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('a','x')", [])
            .unwrap();
        let err = diff_dbs(&local, &remote, None).unwrap_err();
        assert!(err.to_string().contains("schema mismatch"));
    }

    #[test]
    fn file_db_detects_text_pk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT);")
            .unwrap();
        drop(conn);
        let conn = open_readonly(&path).unwrap();
        let schema = table_schema(&conn, "items").unwrap();
        assert_eq!(schema.pk, vec!["id".to_string()]);
    }

    #[test]
    fn column_order_difference_is_compatible() {
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        local
            .execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, n INTEGER);")
            .unwrap();
        remote
            .execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER, name TEXT);")
            .unwrap();
        local
            .execute("INSERT INTO items VALUES ('a','one',1)", [])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('a',1,'two')", [])
            .unwrap();
        let diff = diff_dbs(&local, &remote, None).unwrap();
        assert_eq!(diff.tables.len(), 1);
        assert!(diff.tables[0].column_order_differs);
        assert_eq!(diff.conflict_rows(), 1);
        assert_eq!(diff.tables[0].conflicts[0].changed, vec!["name"]);
    }

    #[test]
    fn plaintext_ciphertexts_count_as_equal() {
        use crate::crypto::{DataKey, Keyring};
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;
        let local_key = DataKey::from_base64("local", &URL_SAFE_NO_PAD.encode([3u8; 32])).unwrap();
        let remote_key = DataKey::from_base64("prod", &URL_SAFE_NO_PAD.encode([7u8; 32])).unwrap();
        let ring = Keyring::new([local_key.clone(), remote_key.clone()]).unwrap();
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        for conn in [&local, &remote] {
            conn.execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
                .unwrap();
        }
        let left = ring
            .encrypt(&local_key, "prop_units", "u1", "memo", "hello")
            .unwrap();
        let right = ring
            .encrypt(&remote_key, "prop_units", "u1", "memo", "hello")
            .unwrap();
        local
            .execute("INSERT INTO prop_units VALUES ('u1', ?1)", [&left])
            .unwrap();
        remote
            .execute("INSERT INTO prop_units VALUES ('u1', ?1)", [&right])
            .unwrap();
        let raw = diff_dbs(&local, &remote, None).unwrap();
        assert_eq!(raw.conflict_rows(), 1);
        let plain = diff_dbs(&local, &remote, Some(&ring)).unwrap();
        assert_eq!(plain.conflict_rows(), 0);
        assert_eq!(plain.identical_rows(), 1);
    }
}
