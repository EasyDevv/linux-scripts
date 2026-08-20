use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::types::Value;

pub fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn db_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "db".to_string())
}

pub fn snapshots_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("snapshots")
}

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn sql_quote_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

pub fn shlex_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:@+".contains(c))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub fn encode_value(value: &Value) -> String {
    match value {
        Value::Null => "N".to_string(),
        Value::Integer(v) => format!("I{v}"),
        Value::Real(v) => format!("R{v:.17}"),
        Value::Text(v) => format!("T{v}"),
        Value::Blob(v) => {
            let mut out = String::from("B");
            for byte in v {
                out.push_str(&format!("{byte:02x}"));
            }
            out
        }
    }
}

pub fn display_value(value: &Value) -> String {
    const LIMIT: usize = 80;
    let raw = match value {
        Value::Null => "NULL".to_string(),
        Value::Integer(v) => v.to_string(),
        Value::Real(v) => v.to_string(),
        Value::Text(v) => format!("\"{v}\""),
        Value::Blob(v) => format!("<blob {}B>", v.len()),
    };
    if raw.chars().count() <= LIMIT {
        raw
    } else {
        let trimmed: String = raw.chars().take(LIMIT).collect();
        format!("{trimmed}…")
    }
}

pub fn infer_machine_from_path(path: &Path) -> Option<String> {
    let mut comps = path.components();
    let first = comps.next()?;
    if first.as_os_str() != "/" {
        return None;
    }
    let home = comps.next()?;
    if home.as_os_str() != "home" {
        return None;
    }
    let user = comps.next()?.as_os_str().to_str()?;
    if user.is_empty() || user == "root" {
        return None;
    }
    Some(format!("{user}@"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_ident_escapes_quotes() {
        assert_eq!(quote_ident("unit"), "\"unit\"");
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn shlex_quote_wraps_spaces() {
        assert_eq!(shlex_quote("ovh-vps"), "ovh-vps");
        assert_eq!(shlex_quote("a b"), "'a b'");
        assert_eq!(shlex_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn infer_machine_from_home_path() {
        assert_eq!(
            infer_machine_from_path(Path::new(
                "/home/svc-internal/.local/share/property-portal/data/app.db"
            ))
            .as_deref(),
            Some("svc-internal@")
        );
        assert_eq!(
            infer_machine_from_path(Path::new("/var/lib/app/app.db")),
            None
        );
    }
}
