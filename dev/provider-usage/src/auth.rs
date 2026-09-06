use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub fn fingerprint(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    hex_encode(&digest)[..12].to_string()
}

pub fn cache_key(provider: &str, secret: Option<&str>) -> String {
    match secret {
        Some(value) if !value.is_empty() => format!("{provider}:{}", fingerprint(value)),
        _ => format!("{provider}:anon"),
    }
}

pub fn agent_dir(env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(dir) = env("PI_CODING_AGENT_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    home_dir(env).join(".pi").join("agent")
}

pub fn home_dir(env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    env("HOME")
        .or_else(|| env("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn commandcode_api_key(env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if let Some(key) = first_env(env, &["COMMAND_CODE_API_KEY", "COMMANDCODE_API_KEY"]) {
        return Some(key);
    }
    let home = home_dir(env);
    let paths = [
        home.join(".commandcode").join("auth.json"),
        agent_dir(env).join("auth.json"),
        home.join(".omp").join("agent").join("auth.json"),
    ];
    for path in paths {
        if let Some(key) = api_key_from_auth_file(&path) {
            return Some(key);
        }
    }
    None
}

pub fn opencode_cookie(env: &dyn Fn(&str) -> Option<String>, env_file: Option<&Path>) -> Option<String> {
    if let Some(value) = env("OPENCODE_GO_SESSION_COOKIE") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    env_file_value(env_file.unwrap_or(&agent_dir(env).join(".env")), "OPENCODE_GO_SESSION_COOKIE")
}

pub fn opencode_workspace_id(env: &dyn Fn(&str) -> Option<String>, env_file: Option<&Path>) -> Option<String> {
    if let Some(value) = env("OPENCODE_GO_WORKSPACE_ID") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    env_file_value(env_file.unwrap_or(&agent_dir(env).join(".env")), "OPENCODE_GO_WORKSPACE_ID")
}

fn first_env(env: &dyn Fn(&str) -> Option<String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = env(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn api_key_from_auth_file(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let obj = parsed.as_object()?;
    if let Some(key) = string_field(obj.get("apiKey")) {
        return Some(key);
    }
    if let Some(key) = string_field(obj.get("commandcode")) {
        return Some(key);
    }
    if let Some(key) = credential_key(obj.get("commandcode")) {
        return Some(key);
    }
    if let Some(key) = string_field(obj.get("command-code")) {
        return Some(key);
    }
    credential_key(obj.get("command-code"))
}

fn credential_key(value: Option<&serde_json::Value>) -> Option<String> {
    let obj = value?.as_object()?;
    let kind = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "oauth" {
        return string_field(obj.get("access"));
    }
    if kind == "api" {
        return string_field(obj.get("key"));
    }
    string_field(obj.get("access")).or_else(|| string_field(obj.get("key")))
}

fn string_field(value: Option<&serde_json::Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

pub fn env_file_value(path: &Path, key: &str) -> Option<String> {
    let source = fs::read_to_string(path).ok()?;
    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let body = line.strip_prefix("export ").unwrap_or(line).trim();
        let eq = body.find('=')?;
        if body[..eq].trim() != key {
            continue;
        }
        let mut value = body[eq + 1..].trim().to_string();
        if (value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\'')) {
            value = value[1..value.len() - 1].to_string();
        }
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }
    None
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub fn env_lookup(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[test]
    fn fingerprint_matches_sha256_prefix() {
        assert_eq!(fingerprint("test"), "9f86d081884c");
        assert_eq!(cache_key("commandcode", Some("test")), "commandcode:9f86d081884c");
        assert_eq!(cache_key("commandcode", None), "commandcode:anon");
    }

    #[test]
    fn reads_cookie_from_env_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "OPENCODE_GO_SESSION_COOKIE=\"cookie-from-file\"\n").unwrap();
        assert_eq!(
            env_file_value(&path, "OPENCODE_GO_SESSION_COOKIE").as_deref(),
            Some("cookie-from-file")
        );
        let map: HashMap<String, String> =
            HashMap::from([("OPENCODE_GO_SESSION_COOKIE".into(), "cookie-from-env".into())]);
        let env = |key: &str| map.get(key).cloned();
        assert_eq!(
            opencode_cookie(&env, Some(&path)).as_deref(),
            Some("cookie-from-env")
        );
    }
}
