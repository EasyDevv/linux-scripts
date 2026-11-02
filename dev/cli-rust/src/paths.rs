//! cli 가 쓰는 폴더 위치. 환경변수로 바꿀 수 있어 테스트는 임시 폴더를 쓴다.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

pub fn proto_root() -> PathBuf {
    std::env::var_os("PROTO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".proto")))
        .unwrap_or_else(|| PathBuf::from(".proto"))
}

fn bun_install_dir() -> PathBuf {
    std::env::var_os("BUN_INSTALL")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".bun")))
        .unwrap_or_else(|| PathBuf::from(".bun"))
}

#[derive(Debug, Clone)]
pub struct Paths {
    /// proto 락파일(.protolock)과 플러그인 TOML 이 있는 폴더. 기본 `~/.local/share/cli`.
    pub cli_home: PathBuf,
    /// lock.json, 임시 다운로드, 이전 바이너리. 기본 `~/.local/state/cli`.
    pub state: PathBuf,
    /// proto 실행 파일 이름 또는 경로.
    pub proto_bin: String,
    /// go·cargo 가 설치하는 접두 폴더(`bin/` 가 그 아래). 기본 `~/.local`.
    pub prefix: PathBuf,
    /// bun·go·cargo 실행 파일 이름 또는 경로.
    pub bun_bin: String,
    pub go_bin: String,
    pub cargo_bin: String,
    pub osv_bin: String,
}

impl Paths {
    pub fn new(cli_home: PathBuf, state: PathBuf, proto_bin: impl Into<String>) -> Self {
        Self {
            prefix: PathBuf::from(".local"),
            cli_home,
            state,
            proto_bin: proto_bin.into(),
            bun_bin: "bun".into(),
            go_bin: "go".into(),
            cargo_bin: "cargo".into(),
            osv_bin: "osv-scanner".into(),
        }
    }

    pub fn from_env() -> Result<Self> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let cli_home = match std::env::var_os("CLI_HOME") {
            Some(value) => PathBuf::from(value),
            None => home
                .clone()
                .ok_or_else(|| anyhow!("HOME is not set"))?
                .join(".local/share/cli"),
        };
        let state = match std::env::var_os("CLI_STATE") {
            Some(value) => PathBuf::from(value),
            None => home
                .ok_or_else(|| anyhow!("HOME is not set"))?
                .join(".local/state/cli"),
        };
        let proto_bin = std::env::var("CLI_PROTO").unwrap_or_else(|_| "proto".to_string());
        let mut paths = Self::new(cli_home, state, proto_bin);
        paths.prefix = match std::env::var_os("CLI_PREFIX") {
            Some(value) => PathBuf::from(value),
            None => std::env::var_os("HOME")
                .map(PathBuf::from)
                .ok_or_else(|| anyhow!("HOME is not set"))?
                .join(".local"),
        };
        for (field, key) in [
            (&mut paths.bun_bin, "CLI_BUN"),
            (&mut paths.go_bin, "CLI_GO"),
            (&mut paths.cargo_bin, "CLI_CARGO"),
            (&mut paths.osv_bin, "CLI_OSV"),
        ] {
            if let Ok(value) = std::env::var(key) {
                *field = value;
            }
        }
        Ok(paths)
    }

    /// go·cargo 바이너리가 놓이는 폴더.
    pub fn bin_dir(&self) -> PathBuf {
        self.prefix.join("bin")
    }

    /// `bun add -g` 바이너리 폴더. `BUN_INSTALL` 이 있으면 그 아래, 없으면 `~/.bun/bin`.
    pub fn bun_global_bin(&self) -> PathBuf {
        bun_install_dir().join("bin")
    }

    /// bun 전역 프로젝트의 lock 파일.
    pub fn bun_global_lock(&self) -> PathBuf {
        bun_install_dir().join("install/global/bun.lock")
    }

    pub fn plugins_dir(&self) -> PathBuf {
        self.cli_home.join("plugins")
    }

    pub fn plugin_file(&self, name: &str) -> PathBuf {
        self.plugins_dir().join(format!("{name}.toml"))
    }

    pub fn protolock(&self) -> PathBuf {
        self.cli_home.join(".protolock")
    }

    pub fn prototools(&self) -> PathBuf {
        self.cli_home.join(".prototools")
    }

    pub fn lock_json(&self) -> PathBuf {
        self.state.join("lock.json")
    }

    pub fn tmp_dir(&self, name: &str) -> PathBuf {
        self.state.join("tmp").join(name)
    }

    /// proto 가 풀어 둔 도구 폴더(`$PROTO_HOME/tools/<name>/<version>`).
    pub fn proto_tool_dir(&self, name: &str, version: &str) -> PathBuf {
        proto_root().join("tools").join(name).join(version)
    }

    /// proto 심 폴더. `PROTO_HOME` 이 있으면 그 아래, 없으면 `~/.proto/shims`.
    pub fn shim(&self, exe: &str) -> PathBuf {
        proto_root().join("shims").join(exe)
    }

    /// 전용 폴더와 `.prototools`(락파일 설정)를 준비한다. 이미 있으면 그대로 둔다.
    pub fn ensure_cli_home(&self) -> Result<()> {
        std::fs::create_dir_all(self.plugins_dir())?;
        std::fs::create_dir_all(&self.state)?;
        let tools = self.prototools();
        if !tools.exists() {
            std::fs::write(&tools, "[settings]\nunstable-lockfile = true\n")?;
        }
        Ok(())
    }
}
