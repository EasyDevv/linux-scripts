use executor::config::{read_config, write_config, write_restart_token, ConfigMutator};
use std::fs;
use std::sync::Mutex;
use tempfile::TempDir;

static LOCK: Mutex<()> = Mutex::new(());

fn setup() -> TempDir {
    let dir = TempDir::new().unwrap();
    unsafe {
        std::env::set_var("XDG_CONFIG_HOME", dir.path().join("config"));
        std::env::set_var("XDG_RUNTIME_DIR", dir.path().join("runtime"));
    }
    fs::create_dir_all(dir.path().join("config/systemd/user")).unwrap();
    fs::create_dir_all(dir.path().join("runtime")).unwrap();
    dir
}

fn write_json(body: &str) {
    let path = executor::paths::config_file();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();
}

#[tokio::test]
async fn reads_instances() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"node server.js"},"bar":{"dir":"/home/bar","cmd":"bun run dev","enabled":false}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    assert!(config.has_instance("foo"));
    assert!(config.has_instance("bar"));
    assert!(!config.has_instance("nonexistent"));
}

#[tokio::test]
async fn get_port_parses() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"web":{"dir":"/tmp/web","cmd":"moon run desktop:web -- --port 5180"},"api":{"dir":"/tmp/api","cmd":"bun run dev --port 4173 --host"},"noport":{"dir":"/tmp/noport","cmd":"node server.js"}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    assert_eq!(config.get_port("web"), "5180");
    assert_eq!(config.get_port("api"), "4173");
    assert_eq!(config.get_port("noport"), "");
}

#[tokio::test]
async fn prefers_client_port() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"both":{"dir":"/tmp","cmd":"bun run dev --client-port 5182 --port 9999"}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    assert_eq!(config.get_port("both"), "5182");
}

#[tokio::test]
async fn prefers_web_port() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"app":{"dir":"/tmp","cmd":"x --port 1 --client-port 2 --web-port 3"}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    assert_eq!(config.get_port("app"), "3");
}

#[tokio::test]
async fn metadata_as_env() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"echo foo","browser":false,"browser-cdp":"9222","CUSTOM_ENV":"value"}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    let instance = config.get_instance("foo").unwrap();
    assert_eq!(instance.env.get("browser").map(String::as_str), Some("false"));
    assert_eq!(instance.env.get("browser-cdp").map(String::as_str), Some("9222"));
    assert_eq!(instance.env.get("CUSTOM_ENV").map(String::as_str), Some("value"));
}

#[tokio::test]
async fn is_enabled_disabled_sets() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"enabled":{"dir":"/tmp/a","cmd":"echo a"},"disabled_field":{"dir":"/tmp/b","cmd":"echo b","enabled":false},"disabled_control":{"dir":"/tmp/c","cmd":"echo c"},"$control":{"disabled":["disabled_control"]}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    assert!(config.is_enabled("enabled"));
    assert!(!config.is_enabled("disabled_field"));
    assert!(!config.is_enabled("disabled_control"));
}

#[tokio::test]
async fn enabling_removes_control_disabled() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"echo foo"},"bar":{"dir":"/tmp/bar","cmd":"echo bar"},"$control":{"disabled":["foo","bar"]}}"#);
    write_config(|m: &mut ConfigMutator| m.set_enabled("foo", true))
        .await
        .unwrap();
    let config = read_config(true).await.unwrap().unwrap();
    assert!(config.is_enabled("foo"));
    assert!(!config.is_enabled("bar"));
}

#[tokio::test]
async fn unknown_instance() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"app":{"dir":"/tmp","cmd":"echo"}}"#);
    let config = read_config(true).await.unwrap().unwrap();
    let err = config.get_instance("nope").unwrap_err();
    assert!(err.message.contains("Unknown executor item"));
}

#[tokio::test]
async fn write_disable_persists() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"app":{"dir":"/tmp","cmd":"echo"}}"#);
    write_config(|m: &mut ConfigMutator| m.set_enabled("app", false))
        .await
        .unwrap();
    let config = read_config(true).await.unwrap().unwrap();
    assert!(!config.is_enabled("app"));
}

#[tokio::test]
async fn restart_token_stays_out_of_config() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"app":{"dir":"/tmp","cmd":"echo"}}"#);
    write_restart_token("app", "tok").await.unwrap();
    let text = fs::read_to_string(executor::paths::config_file()).unwrap();
    assert!(!text.contains("$control"));
    let config = read_config(true).await.unwrap().unwrap();
    assert_eq!(config.restart_tokens.get("app").map(String::as_str), Some("tok"));
}

#[tokio::test]
async fn malformed_json_fails() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json("{");
    let err = read_config(true).await.unwrap_err();
    assert!(err.message.contains("Invalid config file"));
}

#[tokio::test]
async fn missing_dir_fails() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"app":{"cmd":"echo"}}"#);
    let err = read_config(true).await.unwrap_err();
    assert!(err.message.contains("Missing string dir"));
}

#[tokio::test]
async fn missing_cmd_fails() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo"}}"#);
    let err = read_config(true).await.unwrap_err();
    assert!(err.message.contains("Missing string cmd"));
}

#[tokio::test]
async fn non_object_control_fails() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp","cmd":"echo"},"$control":"bad"}"#);
    let err = read_config(true).await.unwrap_err();
    assert!(err.message.contains("must be an object"));
}

#[tokio::test]
async fn disabled_non_array_fails() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp","cmd":"echo"},"$control":{"disabled":"bad"}}"#);
    let err = read_config(true).await.unwrap_err();
    assert!(err.message.contains("must contain only strings"));
}

#[tokio::test]
async fn concurrent_writes() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"echo foo"},"bar":{"dir":"/tmp/bar","cmd":"echo bar"}}"#);
    let a = write_config(|m: &mut ConfigMutator| m.set_enabled("foo", false));
    let b = write_config(|m: &mut ConfigMutator| m.set_enabled("bar", false));
    tokio::try_join!(a, b).unwrap();
    let config = read_config(true).await.unwrap().unwrap();
    assert!(!config.is_enabled("foo"));
    assert!(!config.is_enabled("bar"));
}

#[tokio::test]
async fn live_lock_not_reclaimed() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"echo foo"}}"#);
    let lock_path = format!("{}.lock", executor::paths::config_file().display());
    fs::write(
        &lock_path,
        serde_json::json!({"pid": std::process::id(), "createdAt": 1}).to_string(),
    )
    .unwrap();
    let err = write_config(|m: &mut ConfigMutator| m.set_enabled("foo", false))
        .await
        .unwrap_err();
    let _ = fs::remove_file(&lock_path);
    assert!(err.message.contains("Timed out waiting for config lock"));
}

#[tokio::test]
async fn release_does_not_remove_successor() {
    let _g = LOCK.lock().unwrap();
    let _dir = setup();
    write_json(r#"{"foo":{"dir":"/tmp/foo","cmd":"echo foo"}}"#);
    let lock_path = format!("{}.lock", executor::paths::config_file().display());
    let successor = serde_json::json!({
        "pid": std::process::id(),
        "createdAt": 1,
        "token": "successor-owner"
    });
    write_config(|m: &mut ConfigMutator| {
        m.set_enabled("foo", false)?;
        let _ = fs::remove_file(&lock_path);
        fs::write(&lock_path, successor.to_string()).unwrap();
        Ok(())
    })
    .await
    .unwrap();
    let saved: serde_json::Value = serde_json::from_str(&fs::read_to_string(&lock_path).unwrap()).unwrap();
    let _ = fs::remove_file(&lock_path);
    assert_eq!(saved["token"], "successor-owner");
}
