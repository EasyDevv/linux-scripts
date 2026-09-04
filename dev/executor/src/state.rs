use crate::cli::CliError;
use crate::paths::runtime_state_file;
use crate::pm::ManagedProcessSnapshot;
use crate::proxy::ProxySnapshot;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorInfo {
    pub pid: u32,
    pub version: String,
    pub started_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStateFile {
    pub version: u32,
    pub supervisor: SupervisorInfo,
    pub instances: BTreeMap<String, ManagedProcessSnapshot>,
    pub proxy: ProxySnapshot,
}

pub async fn read_runtime_state() -> Result<Option<RuntimeStateFile>, CliError> {
    let path = runtime_state_file();
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text).ok())
}

pub fn write_runtime_state(state: &RuntimeStateFile) -> Result<(), CliError> {
    let path = runtime_state_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&tmp, format!("{}\n", serde_json::to_string_pretty(state).unwrap()))?;
    fs::rename(&tmp, path)?;
    let _ = fs::remove_file(&tmp);
    Ok(())
}
