use std::fs;
use std::path::Path;

pub fn is_vite_command(cmd: &str) -> bool {
    cmd.contains("vite") || cmd.contains("desktop:web")
}

pub fn vite_ready_pattern() -> String {
    "ready in ".into()
}

fn vite_version(dir: &str) -> String {
    let expanded = if let Some(rest) = dir.strip_prefix("~/") {
        format!(
            "{}/{}",
            std::env::var("HOME").unwrap_or_default(),
            rest
        )
    } else {
        dir.to_string()
    };
    let path = Path::new(&expanded).join("apps/desktop/node_modules/vite/package.json");
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    value
        .get("version")
        .and_then(|value| value.as_str())
        .map(|version| format!(" v{version}"))
        .unwrap_or_default()
}

pub fn print_vite_ready_fallback(dir: &str, name: &str, _port: &str, elapsed_ms: u64) {
    println!("  VITE{}  ready in {elapsed_ms} ms", vite_version(dir));
    println!("  ➜  Local:   http://{name}.localhost/");
}
