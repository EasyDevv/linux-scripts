use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{bail, Result};
use rusqlite::types::Value;
use rusqlite::Connection;

use crate::color::{paint, BOLD, DIM, GREEN, RED};
use crate::crypto::{ciphertext_key_id, DataKey, Keyring};
use crate::diff::{list_user_tables, load_rows, open_readonly, table_schema, TableSchema};
use crate::reencrypt::SENSITIVE_FIELDS;
use crate::util::{encode_value, quote_ident};

const DEFAULT_SAMPLE: usize = 10;
const MAX_ERRORS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyMode {
    Sample { n: usize },
    Deep,
    Skip,
}

impl VerifyMode {
    pub fn sample() -> Self {
        Self::Sample { n: DEFAULT_SAMPLE }
    }

    pub fn parse(raw: &str) -> Result<Self> {
        match raw {
            "sample" => Ok(Self::sample()),
            "deep" => Ok(Self::Deep),
            "skip" => Ok(Self::Skip),
            other => bail!("--verify must be sample, deep, or skip (got {other})"),
        }
    }
}

impl Default for VerifyMode {
    fn default() -> Self {
        Self::sample()
    }
}

pub struct VerifyKeys<'a> {
    pub ring: &'a Keyring,
    pub local: &'a DataKey,
    pub remote: &'a DataKey,
    pub expect_dest_keys: bool,
}

#[derive(Debug)]
pub struct VerifyReport {
    pub tables: usize,
    pub rows: usize,
    pub errors: Vec<String>,
}

impl VerifyReport {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
}

pub fn verify_files(
    local: &Path,
    remote: &Path,
    mode: VerifyMode,
    keys: Option<&VerifyKeys<'_>>,
) -> Result<VerifyReport> {
    if matches!(mode, VerifyMode::Skip) {
        return Ok(VerifyReport {
            tables: 0,
            rows: 0,
            errors: Vec::new(),
        });
    }
    let local_conn = open_readonly(local)?;
    let remote_conn = open_readonly(remote)?;
    verify_conns(&local_conn, &remote_conn, mode, keys)
}

pub fn verify_conns(
    local: &Connection,
    remote: &Connection,
    mode: VerifyMode,
    keys: Option<&VerifyKeys<'_>>,
) -> Result<VerifyReport> {
    let sample_n = match mode {
        VerifyMode::Skip => return Ok(VerifyReport { tables: 0, rows: 0, errors: Vec::new() }),
        VerifyMode::Sample { n } => n.max(1),
        VerifyMode::Deep => usize::MAX,
    };
    let local_tables: BTreeSet<String> = list_user_tables(local)?.into_iter().collect();
    let remote_tables: BTreeSet<String> = list_user_tables(remote)?.into_iter().collect();
    let mut errors = Vec::new();
    let mut tables = 0usize;
    let mut rows = 0usize;

    for name in local_tables.difference(&remote_tables) {
        push_err(&mut errors, format!("table {name} missing on remote"));
    }
    for name in remote_tables.difference(&local_tables) {
        push_err(&mut errors, format!("table {name} missing on local"));
    }

    for name in local_tables.intersection(&remote_tables) {
        tables += 1;
        let schema = table_schema(local, name)?;
        let remote_schema = table_schema(remote, name)?;
        if let Err(err) = crate::diff::schema_compatible(&schema, &remote_schema) {
            push_err(&mut errors, err.to_string());
            continue;
        }
        let local_count = table_count(local, name)?;
        let remote_count = table_count(remote, name)?;
        if local_count != remote_count {
            push_err(
                &mut errors,
                format!("table {name} count {local_count} vs {remote_count}"),
            );
        }
        let pks = select_pks(local, remote, &schema, sample_n)?;
        rows += pks.len();
        compare_rows(local, remote, &schema, &pks, keys, &mut errors)?;
    }

    Ok(VerifyReport {
        tables,
        rows,
        errors,
    })
}

pub fn print_report(report: &VerifyReport, mode: VerifyMode) {
    let label = match mode {
        VerifyMode::Deep => "verify deep",
        VerifyMode::Sample { n } => {
            return print_sample(report, n);
        }
        VerifyMode::Skip => return,
    };
    if report.ok() {
        eprintln!(
            "{}",
            paint(
                format!(
                    "{label}: {} tables, {} rows, ok",
                    report.tables, report.rows
                ),
                &[BOLD, GREEN]
            )
        );
        return;
    }
    print_errors(label, report);
}

fn print_sample(report: &VerifyReport, n: usize) {
    let label = format!("verify sample {n}");
    if report.ok() {
        eprintln!(
            "{}",
            paint(
                format!(
                    "{label}: {} tables, {} rows, ok",
                    report.tables, report.rows
                ),
                &[BOLD, GREEN]
            )
        );
        return;
    }
    print_errors(&label, report);
}

fn print_errors(label: &str, report: &VerifyReport) {
    eprintln!(
        "{}",
        paint(
            format!(
                "{label}: {} tables, {} rows, {} mismatch",
                report.tables,
                report.rows,
                report.errors.len()
            ),
            &[BOLD, RED]
        )
    );
    for err in &report.errors {
        eprintln!("{}", paint(format!("  {err}"), &[RED]));
    }
}

pub fn print_skip() {
    eprintln!("{}", paint("verify skipped", &[DIM]));
}

fn compare_rows(
    local: &Connection,
    remote: &Connection,
    schema: &TableSchema,
    pks: &[String],
    keys: Option<&VerifyKeys<'_>>,
    errors: &mut Vec<String>,
) -> Result<()> {
    if pks.is_empty() {
        return Ok(());
    }
    let local_rows = load_selected(local, schema, pks)?;
    let remote_rows = load_selected(remote, schema, pks)?;
    let sensitive = sensitive_for(schema.name.as_str());
    for pk in pks {
        let Some(left) = local_rows.get(pk) else {
            push_err(errors, format!("{} {pk} missing on local", schema.name));
            continue;
        };
        let Some(right) = remote_rows.get(pk) else {
            push_err(errors, format!("{} {pk} missing on remote", schema.name));
            continue;
        };
        let record_id = record_id(left);
        let names: BTreeSet<&String> = left.keys().chain(right.keys()).collect();
        for name in names {
            let lv = left.get(name);
            let rv = right.get(name);
            match (lv, rv) {
                (Some(l), Some(r)) => {
                    compare_cell(
                        schema.name.as_str(),
                        pk,
                        name,
                        &record_id,
                        l,
                        r,
                        sensitive.contains(name.as_str()),
                        keys,
                        errors,
                    );
                }
                _ => push_err(
                    errors,
                    format!("{} {pk} column {name} missing on one side", schema.name),
                ),
            }
        }
    }
    Ok(())
}

fn compare_cell(
    table: &str,
    pk: &str,
    field: &str,
    record_id: &str,
    local: &Value,
    remote: &Value,
    sensitive: bool,
    keys: Option<&VerifyKeys<'_>>,
    errors: &mut Vec<String>,
) {
    if !sensitive || keys.is_none() {
        if encode_value(local) != encode_value(remote) {
            push_err(errors, format!("{table} {pk} {field} value mismatch"));
        }
        return;
    }
    let Some(keys) = keys else {
        return;
    };
    let lt = text_of(local);
    let rt = text_of(remote);
    if keys.expect_dest_keys {
        if let Some(text) = lt {
            if let Some(id) = ciphertext_key_id(text) {
                if id != keys.local.id {
                    push_err(
                        errors,
                        format!("{table} {pk} {field} local key-id {id} expected {}", keys.local.id),
                    );
                }
            }
        }
        if let Some(text) = rt {
            if let Some(id) = ciphertext_key_id(text) {
                if id != keys.remote.id {
                    push_err(
                        errors,
                        format!(
                            "{table} {pk} {field} remote key-id {id} expected {}",
                            keys.remote.id
                        ),
                    );
                }
            }
        }
    }
    let left_plain = match lt {
        None => match local {
            Value::Null => String::new(),
            other => encode_value(other),
        },
        Some(text) => match keys.ring.plaintext(table, record_id, field, text) {
            Ok(plain) => plain,
            Err(_) => {
                push_err(
                    errors,
                    format!("{table} {pk} {field} local decrypt failed"),
                );
                return;
            }
        },
    };
    let right_plain = match rt {
        None => match remote {
            Value::Null => String::new(),
            other => encode_value(other),
        },
        Some(text) => match keys.ring.plaintext(table, record_id, field, text) {
            Ok(plain) => plain,
            Err(_) => {
                push_err(
                    errors,
                    format!("{table} {pk} {field} remote decrypt failed"),
                );
                return;
            }
        },
    };
    if left_plain != right_plain {
        push_err(errors, format!("{table} {pk} {field} plaintext mismatch"));
    }
}

fn select_pks(
    local: &Connection,
    remote: &Connection,
    schema: &TableSchema,
    limit: usize,
) -> Result<Vec<String>> {
    if schema.pk.is_empty() {
        return Ok(Vec::new());
    }
    if limit == usize::MAX {
        let mut pks: BTreeSet<String> = load_pk_set(local, schema, None, usize::MAX)?.into_iter().collect();
        pks.extend(load_pk_set(remote, schema, None, usize::MAX)?);
        return Ok(pks.into_iter().collect());
    }
    let sensitive = sensitive_for(&schema.name);
    let mut pks = if sensitive.is_empty() {
        load_pk_set(local, schema, None, limit)?
    } else {
        load_pk_set(local, schema, Some(&sensitive), limit)?
    };
    if pks.len() < limit {
        for pk in load_pk_set(local, schema, None, limit)? {
            if pks.len() >= limit {
                break;
            }
            if !pks.contains(&pk) {
                pks.push(pk);
            }
        }
    }
    Ok(pks)
}

fn load_pk_set(
    conn: &Connection,
    schema: &TableSchema,
    encrypted_fields: Option<&BTreeSet<&str>>,
    limit: usize,
) -> Result<Vec<String>> {
    let pk_sql = schema
        .pk
        .iter()
        .map(|name| quote_ident(name))
        .collect::<Vec<_>>()
        .join(", ");
    let table = quote_ident(&schema.name);
    let where_sql = match encrypted_fields {
        Some(fields) if !fields.is_empty() => {
            let pred = fields
                .iter()
                .map(|field| format!("{} LIKE 'enc:v1:%'", quote_ident(field)))
                .collect::<Vec<_>>()
                .join(" OR ");
            format!("WHERE {pred}")
        }
        _ => String::new(),
    };
    let sql = if limit == usize::MAX {
        format!("SELECT {pk_sql} FROM {table} {where_sql}")
    } else {
        format!("SELECT {pk_sql} FROM {table} {where_sql} ORDER BY RANDOM() LIMIT {limit}")
    };
    let mut stmt = conn.prepare(&sql)?;
    let col_count = schema.pk.len();
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut values = BTreeMap::new();
        for (idx, name) in schema.pk.iter().enumerate() {
            if idx >= col_count {
                break;
            }
            let value: Value = row.get(idx)?;
            values.insert(name.clone(), value);
        }
        out.push(schema.pk_key(&values));
    }
    Ok(out)
}

fn load_selected(
    conn: &Connection,
    schema: &TableSchema,
    pks: &[String],
) -> Result<BTreeMap<String, BTreeMap<String, Value>>> {
    if pks.is_empty() {
        return Ok(BTreeMap::new());
    }
    if pks.len() > 64 || schema.pk.len() != 1 {
        let all = load_rows(conn, schema)?;
        let mut out = BTreeMap::new();
        for pk in pks {
            if let Some(row) = all.get(pk) {
                out.insert(pk.clone(), row.values.clone());
            }
        }
        return Ok(out);
    }
    let pk_name = &schema.pk[0];
    let wanted: BTreeSet<&str> = pks.iter().map(String::as_str).collect();
    let all = load_rows(conn, schema)?;
    let mut out = BTreeMap::new();
    for (pk, row) in all {
        if wanted.contains(pk.as_str())
            || wanted.contains(display_pk_value(row.values.get(pk_name)))
        {
            out.insert(pk, row.values);
        }
    }
    Ok(out)
}

fn display_pk_value(value: Option<&Value>) -> &str {
    match value {
        Some(Value::Text(s)) => s.as_str(),
        _ => "",
    }
}

fn table_count(conn: &Connection, table: &str) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
    Ok(conn.query_row(&sql, [], |row| row.get(0))?)
}

fn sensitive_for(table: &str) -> BTreeSet<&'static str> {
    SENSITIVE_FIELDS
        .iter()
        .filter(|(name, _)| *name == table)
        .map(|(_, field)| *field)
        .collect()
}

fn record_id(values: &BTreeMap<String, Value>) -> String {
    match values.get("id") {
        Some(Value::Text(s)) => s.clone(),
        Some(Value::Integer(n)) => n.to_string(),
        _ => values
            .iter()
            .map(|(k, v)| format!("{k}={}", encode_value(v)))
            .collect::<Vec<_>>()
            .join("|"),
    }
}

fn text_of(value: &Value) -> Option<&str> {
    match value {
        Value::Text(s) => Some(s.as_str()),
        _ => None,
    }
}

fn push_err(errors: &mut Vec<String>, msg: String) {
    if errors.len() < MAX_ERRORS {
        errors.push(msg);
    } else if errors.len() == MAX_ERRORS {
        errors.push("…".to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::DataKey;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use rusqlite::Connection;

    fn key(id: &str, fill: u8) -> DataKey {
        DataKey::from_base64(id, &URL_SAFE_NO_PAD.encode([fill; 32])).unwrap()
    }

    fn seed_pair(local: &Connection, remote: &Connection, left: &str, right: &str) {
        for conn in [local, remote] {
            conn.execute_batch("CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT);")
                .unwrap();
        }
        local
            .execute("INSERT INTO items VALUES ('a', ?1)", [left])
            .unwrap();
        remote
            .execute("INSERT INTO items VALUES ('a', ?1)", [right])
            .unwrap();
    }

    #[test]
    fn sample_accepts_matching_rows() {
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        seed_pair(&local, &remote, "same", "same");
        let report = verify_conns(&local, &remote, VerifyMode::sample(), None).unwrap();
        assert!(report.ok(), "{:?}", report.errors);
        assert_eq!(report.rows, 1);
    }

    #[test]
    fn sample_flags_value_mismatch() {
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        seed_pair(&local, &remote, "L", "R");
        let report = verify_conns(&local, &remote, VerifyMode::sample(), None).unwrap();
        assert!(!report.ok());
        assert!(report.errors.iter().any(|e| e.contains("value mismatch")));
    }

    #[test]
    fn plaintext_match_with_different_keys() {
        let local_key = key("local", 3);
        let remote_key = key("prod", 7);
        let ring = Keyring::new([local_key.clone(), remote_key.clone()]).unwrap();
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        local
            .execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
            .unwrap();
        remote
            .execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
            .unwrap();
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
        let keys = VerifyKeys {
            ring: &ring,
            local: &local_key,
            remote: &remote_key,
            expect_dest_keys: true,
        };
        let report = verify_conns(&local, &remote, VerifyMode::Deep, Some(&keys)).unwrap();
        assert!(report.ok(), "{:?}", report.errors);
    }

    #[test]
    fn flags_wrong_dest_key_id() {
        let local_key = key("local", 3);
        let remote_key = key("prod", 7);
        let ring = Keyring::new([local_key.clone(), remote_key.clone()]).unwrap();
        let local = Connection::open_in_memory().unwrap();
        let remote = Connection::open_in_memory().unwrap();
        for conn in [&local, &remote] {
            conn.execute_batch("CREATE TABLE prop_units (id TEXT PRIMARY KEY, memo TEXT);")
                .unwrap();
        }
        let enc = ring
            .encrypt(&local_key, "prop_units", "u1", "memo", "hello")
            .unwrap();
        local
            .execute("INSERT INTO prop_units VALUES ('u1', ?1)", [&enc])
            .unwrap();
        remote
            .execute("INSERT INTO prop_units VALUES ('u1', ?1)", [&enc])
            .unwrap();
        let keys = VerifyKeys {
            ring: &ring,
            local: &local_key,
            remote: &remote_key,
            expect_dest_keys: true,
        };
        let report = verify_conns(&local, &remote, VerifyMode::Deep, Some(&keys)).unwrap();
        assert!(!report.ok());
        assert!(report
            .errors
            .iter()
            .any(|e| e.contains("remote key-id") || e.contains("plaintext mismatch") || e.contains("decrypt failed")));
    }
}
