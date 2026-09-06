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

fn agent_auth_path(env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    agent_dir(env).join("auth.json")
}

fn load_json(path: &Path) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn env_override(
    env: &dyn Fn(&str) -> Option<String>,
    env_file: Option<&Path>,
    keys: &[&str],
) -> Option<String> {
    let path = env_file
        .map(Path::to_path_buf)
        .unwrap_or_else(|| agent_dir(env).join(".env"));
    for key in keys {
        if let Some(value) = env_file_value(&path, key) {
            return Some(value);
        }
    }
    first_env(env, keys)
}

fn agent_credential(env: &dyn Fn(&str) -> Option<String>, names: &[&str]) -> Option<String> {
    let parsed = load_json(&agent_auth_path(env))?;
    for name in names {
        if let Some(value) = credential_key(parsed.get(*name)) {
            return Some(value);
        }
        if let Some(value) = string_field(parsed.get(*name)) {
            return Some(value);
        }
    }
    None
}

pub fn commandcode_api_key(
    env: &dyn Fn(&str) -> Option<String>,
    env_file: Option<&Path>,
) -> Option<String> {
    let path = env_file
        .map(Path::to_path_buf)
        .unwrap_or_else(|| agent_dir(env).join(".env"));
    env_file_value(&path, "COMMAND_CODE_API_KEY")
        .or_else(|| env_file_value(&path, "COMMANDCODE_API_KEY"))
        .or_else(|| agent_credential(env, &["commandcode", "command-code"]))
}


#[derive(Clone, Debug)]
pub struct OpenaiSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub account_id: Option<String>,
    pub auth_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct GrokSession {
    pub access_token: String,
    pub user_id: Option<String>,
    pub team_id: Option<String>,
}

pub fn openai_session(env: &dyn Fn(&str) -> Option<String>) -> Option<OpenaiSession> {
    let agent = agent_auth_path(env);
    if let Some(session) = openai_from_agent(&agent) {
        return Some(session);
    }
    let home = env("CODEX_HOME")
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir(env).join(".codex"));
    openai_from_codex(&home.join("auth.json"))
}

fn openai_from_agent(path: &Path) -> Option<OpenaiSession> {
    let parsed = load_json(path)?;
    let entry = parsed.get("openai-codex")?;
    let access_token = string_field(entry.get("access"))?;
    Some(OpenaiSession {
        access_token,
        refresh_token: string_field(entry.get("refresh")),
        account_id: string_field(entry.get("accountId"))
            .or_else(|| string_field(entry.get("account_id"))),
        auth_path: path.to_path_buf(),
    })
}

fn openai_from_codex(path: &Path) -> Option<OpenaiSession> {
    let parsed = load_json(path)?;
    let tokens = parsed.get("tokens")?;
    let access_token = string_field(tokens.get("access_token"))?;
    Some(OpenaiSession {
        access_token,
        refresh_token: string_field(tokens.get("refresh_token")),
        account_id: string_field(tokens.get("account_id")),
        auth_path: path.to_path_buf(),
    })
}

pub fn persist_openai_tokens(
    path: &Path,
    access_token: &str,
    refresh_token: Option<&str>,
) -> std::io::Result<()> {
    let raw = fs::read_to_string(path)?;
    let mut parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    if let Some(entry) = parsed
        .get_mut("openai-codex")
        .and_then(|v| v.as_object_mut())
    {
        entry.insert(
            "access".into(),
            serde_json::Value::String(access_token.to_string()),
        );
        if let Some(refresh) = refresh_token.filter(|v| !v.is_empty()) {
            entry.insert("refresh".into(), serde_json::Value::String(refresh.to_string()));
        }
    } else {
        let tokens = parsed
            .get_mut("tokens")
            .and_then(|v| v.as_object_mut())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "tokens"))?;
        tokens.insert(
            "access_token".into(),
            serde_json::Value::String(access_token.to_string()),
        );
        if let Some(refresh) = refresh_token.filter(|v| !v.is_empty()) {
            tokens.insert(
                "refresh_token".into(),
                serde_json::Value::String(refresh.to_string()),
            );
        }
    }
    let encoded = serde_json::to_string_pretty(&parsed)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(path, encoded)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn grok_management_key(
    env: &dyn Fn(&str) -> Option<String>,
    env_file: Option<&Path>,
) -> Option<String> {
    env_override(
        env,
        env_file,
        &["XAI_MANAGEMENT_KEY", "XAI_MANAGEMENT_API_KEY"],
    )
    .or_else(|| agent_credential(env, &["xai-management", "xai-management-key"]))
}

pub fn grok_team_id(env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if let Some(value) = first_env(env, &["XAI_TEAM_ID"]) {
        return Some(value);
    }
    grok_session(env).and_then(|s| s.team_id)
}

pub fn grok_session(env: &dyn Fn(&str) -> Option<String>) -> Option<GrokSession> {
    grok_session_from_cli(env).or_else(|| grok_session_from_agent(env))
}

fn grok_session_from_agent(env: &dyn Fn(&str) -> Option<String>) -> Option<GrokSession> {
    let access_token = agent_credential(env, &["xai-auth", "xai"])?;
    Some(GrokSession {
        access_token,
        user_id: None,
        team_id: None,
    })
}

fn grok_session_from_cli(env: &dyn Fn(&str) -> Option<String>) -> Option<GrokSession> {
    let home = env("GROK_HOME")
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir(env).join(".grok"));
    let parsed = load_json(&home.join("auth.json"))?;
    let obj = parsed.as_object()?;
    let mut preferred = None;
    let mut fallback = None;
    for (key, entry) in obj {
        let access = string_field(entry.get("key"));
        let Some(access_token) = access else {
            continue;
        };
        let session = GrokSession {
            access_token,
            user_id: string_field(entry.get("user_id")),
            team_id: string_field(entry.get("team_id")),
        };
        if key == "https://auth.x.ai" || key.starts_with("https://auth.x.ai::") {
            preferred = Some(session);
            break;
        }
        if fallback.is_none() {
            fallback = Some(session);
        }
    }
    preferred.or(fallback)
}

pub fn opencode_cookie(
    env: &dyn Fn(&str) -> Option<String>,
    env_file: Option<&Path>,
) -> Option<String> {
    env_override(env, env_file, &["OPENCODE_GO_SESSION_COOKIE"])
        .or_else(|| agent_credential(env, &["opencode-go", "opencode_go"]))
}

pub fn opencode_workspace_id(
    env: &dyn Fn(&str) -> Option<String>,
    env_file: Option<&Path>,
) -> Option<String> {
    if let Some(value) = env("OPENCODE_GO_WORKSPACE_ID") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    env_file_value(
        env_file.unwrap_or(&agent_dir(env).join(".env")),
        "OPENCODE_GO_WORKSPACE_ID",
    )
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
    if kind == "api" || kind == "api_key" || kind == "api-key" {
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
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
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
        assert_eq!(
            cache_key("commandcode", Some("test")),
            "commandcode:9f86d081884c"
        );
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
        let map: HashMap<String, String> = HashMap::from([(
            "OPENCODE_GO_SESSION_COOKIE".into(),
            "cookie-from-env".into(),
        )]);
        let env = |key: &str| map.get(key).cloned();
        assert_eq!(
            opencode_cookie(&env, Some(&path)).as_deref(),
            Some("cookie-from-file")
        );
    }

    #[test]
    fn reads_agent_auth_json_with_env_override() {
        let dir = tempdir().unwrap();
        let home = dir.path();
        let agent = home.join(".pi").join("agent");
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("auth.json"),
            r#"{"openai-codex":{"type":"oauth","access":"pi-codex","refresh":"r","accountId":"acct"},"commandcode":{"type":"oauth","access":"pi-cc"},"opencode-go":{"type":"api-key","key":"pi-cookie"}}"#,
        )
        .unwrap();
        fs::write(agent.join(".env"), "COMMAND_CODE_API_KEY=override-cc\n").unwrap();
        let home_s = home.to_string_lossy().to_string();
        let env = |key: &str| {
            if key == "HOME" {
                Some(home_s.clone())
            } else {
                None
            }
        };
        let openai = openai_session(&env).unwrap();
        assert_eq!(openai.access_token, "pi-codex");
        assert_eq!(openai.account_id.as_deref(), Some("acct"));
        assert_eq!(commandcode_api_key(&env, None).as_deref(), Some("override-cc"));
        assert_eq!(opencode_cookie(&env, None).as_deref(), Some("pi-cookie"));
    }

    #[test]
    fn reads_commandcode_api_key_from_pi_auth() {
        let dir = tempdir().unwrap();
        let home = dir.path();
        let agent = home.join(".pi").join("agent");
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("auth.json"),
            r#"{"commandcode":{"type":"api_key","key":"pi-cc-key"}}"#,
        )
        .unwrap();
        let home_s = home.to_string_lossy().to_string();
        let map: HashMap<String, String> = HashMap::from([
            ("HOME".into(), home_s.clone()),
            ("COMMAND_CODE_API_KEY".into(), "leftover-env".into()),
        ]);
        let env = |key: &str| map.get(key).cloned();
        assert_eq!(commandcode_api_key(&env, None).as_deref(), Some("pi-cc-key"));
    }

    #[test]
    fn reads_codex_and_grok_sessions() {
        let dir = tempdir().unwrap();
        let home = dir.path();
        fs::create_dir(home.join(".codex")).unwrap();
        fs::create_dir(home.join(".grok")).unwrap();
        fs::write(
            home.join(".codex").join("auth.json"),
            r#"{"tokens":{"access_token":"codex-tok","account_id":"acct"}}"#,
        )
        .unwrap();
        fs::write(
            home.join(".grok").join("auth.json"),
            r#"{"https://auth.x.ai::x":{"key":"grok-tok","user_id":"u1"}}"#,
        )
        .unwrap();
        let home_s = home.to_string_lossy().to_string();
        let env = |key: &str| {
            if key == "HOME" {
                Some(home_s.clone())
            } else {
                None
            }
        };
        let openai = openai_session(&env).unwrap();
        assert_eq!(openai.access_token, "codex-tok");
        assert_eq!(openai.account_id.as_deref(), Some("acct"));
        assert!(openai.refresh_token.is_none());
        let grok = grok_session(&env).unwrap();
        assert_eq!(grok.access_token, "grok-tok");
        assert_eq!(grok.user_id.as_deref(), Some("u1"));
    }
}
