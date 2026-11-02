//! tools.toml 의 한 도구에 sha256/version 을 기록한다(주석·순서 보존).

use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use toml_edit::{value, DocumentMut};

pub fn write_pin(path: &Path, name: &str, sha256: &str, version: Option<&str>) -> Result<()> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let updated = apply_pin(&text, name, sha256, version)?;
    let tmp = path.with_extension("toml.tmp");
    fs::write(&tmp, updated)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// sha256 이 없는 방식(bun·go·cargo)이 처음 설치될 때 검증한 버전만 고정한다.
pub fn write_version(path: &Path, name: &str, version: &str) -> Result<()> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let mut doc: DocumentMut = text.parse().context("invalid tools.toml")?;
    let tools = doc
        .get_mut("tool")
        .and_then(|item| item.as_array_of_tables_mut())
        .context("tools.toml has no [[tool]]")?;
    let table = tools
        .iter_mut()
        .find(|table| table.get("name").and_then(|v| v.as_str()) == Some(name))
        .with_context(|| format!("tool {name} not found"))?;
    table["version"] = value(version);
    if table.get("status").and_then(|v| v.as_str()) == Some("pending") {
        table.remove("status");
    }
    let tmp = path.with_extension("toml.tmp");
    fs::write(&tmp, doc.to_string())?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn apply_pin(text: &str, name: &str, sha256: &str, version: Option<&str>) -> Result<String> {
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("sha256 must be 64 hex characters");
    }
    let mut doc: DocumentMut = text.parse().context("invalid tools.toml")?;
    let tools = doc
        .get_mut("tool")
        .and_then(|item| item.as_array_of_tables_mut())
        .context("tools.toml has no [[tool]]")?;
    let table = tools
        .iter_mut()
        .find(|table| table.get("name").and_then(|v| v.as_str()) == Some(name))
        .with_context(|| format!("tool {name} not found"))?;
    table["sha256"] = value(sha256.to_ascii_lowercase());
    if let Some(version) = version {
        table["version"] = value(version);
    }
    if table.get("status").and_then(|v| v.as_str()) == Some("pending") {
        table.remove("status");
    }
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "# 머리 주석\n[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"a\"\nmethod = \"vendor\"\n# 이 줄은 남아야 한다\nurl = \"https://example.com/a.zip\"\nbin = \"a\"\nstatus = \"pending\"\n\n[[tool]]\nname = \"b\"\nmethod = \"vendor\"\nurl = \"https://example.com/b.zip\"\nbin = \"b\"\nversion = \"1\"\n";

    #[test]
    fn pins_one_tool_and_keeps_comments_and_the_other_tool() {
        let hash = "a".repeat(64);
        let out = apply_pin(SRC, "a", &hash, Some("2.0.0")).unwrap();
        assert!(out.contains("# 머리 주석"));
        assert!(out.contains("# 이 줄은 남아야 한다"));
        assert!(out.contains(&format!("sha256 = \"{hash}\"")));
        assert!(out.contains("version = \"2.0.0\""));
        assert!(!out.contains("pending"));
        let parsed = crate::manifest::load_str(&out).unwrap();
        assert_eq!(parsed.tools[0].sha256.as_deref(), Some(hash.as_str()));
        assert_eq!(parsed.tools[1].sha256, None);
    }

    #[test]
    fn rejects_bad_hash_and_unknown_tool() {
        assert!(apply_pin(SRC, "a", "xyz", None).is_err());
        assert!(apply_pin(SRC, "zzz", &"a".repeat(64), None).is_err());
    }
}
