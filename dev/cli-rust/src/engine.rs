//! proto 호출. 모든 명령은 인자 배열로 실행하고, 물려받은 PROTO_*VERSION 같은 덮어쓰기 변수는 지운다.

use std::path::Path;
use std::process::{Command, Output};

use anyhow::{bail, Context, Result};

use crate::paths::Paths;

pub struct Proto<'a> {
    pub paths: &'a Paths,
}

/// proto 가 이전 세션에서 export 한 값들이 새 호출을 덮어쓰지 않도록 지우는 변수.
pub fn is_inherited_override(key: &str) -> bool {
    key == "PROTO_VERSION"
        || key == "PROTO_SHIM_NAME"
        || key == "PROTO_SHIM_PATH"
        || (key.starts_with("PROTO_") && key.ends_with("_VERSION"))
}

pub fn plugin_add_args(name: &str, plugin_file: &Path) -> Vec<String> {
    vec![
        "-y".into(),
        "-r".into(),
        "text".into(),
        "plugin".into(),
        "add".into(),
        name.into(),
        format!("file://{}", plugin_file.display()),
        "--to".into(),
        "global".into(),
    ]
}

pub fn install_args(name: &str, version: &str) -> Vec<String> {
    vec![
        "-y".into(),
        "-r".into(),
        "text".into(),
        "-c".into(),
        "upwards-global".into(),
        "install".into(),
        name.into(),
        version.into(),
        "--pin".into(),
        "global".into(),
    ]
}

pub fn uninstall_args(name: &str, version: &str) -> Vec<String> {
    vec![
        "-y".into(),
        "-r".into(),
        "text".into(),
        "-c".into(),
        "upwards-global".into(),
        "uninstall".into(),
        name.into(),
        version.into(),
    ]
}

pub fn plugin_remove_args(name: &str) -> Vec<String> {
    vec![
        "-y".into(),
        "-r".into(),
        "text".into(),
        "plugin".into(),
        "remove".into(),
        name.into(),
        "--from".into(),
        "global".into(),
    ]
}

/// 외부 명령을 인자 배열로 실행한다(셸 문자열 없음). 실패하면 출력 끝 8줄을 담아 오류로 돌려준다.
pub fn run_external(program: &str, args: &[String], cwd: &Path, envs: &[(String, String)]) -> Result<Output> {
    let mut command = Command::new(program);
    command.args(args).current_dir(cwd);
    for (key, _) in std::env::vars_os() {
        if let Some(key) = key.to_str() {
            if is_inherited_override(key) {
                command.env_remove(key);
            }
        }
    }
    for (key, value) in envs {
        command.env(key, value);
    }
    let output = command.output().with_context(|| format!("run {program}"))?;
    if !output.status.success() {
        let mut text = String::from_utf8_lossy(&output.stderr).to_string();
        text.push_str(&String::from_utf8_lossy(&output.stdout));
        let tail: Vec<&str> = text.lines().rev().take(8).collect();
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        bail!("{program} {} failed:\n{}", args.join(" "), tail.join("\n"));
    }
    Ok(output)
}

impl Proto<'_> {
    fn run(&self, args: &[String]) -> Result<Output> {
        run_external(&self.paths.proto_bin, args, &self.paths.cli_home, &[])
    }

    pub fn plugin_add(&self, name: &str, plugin_file: &Path) -> Result<()> {
        self.run(&plugin_add_args(name, plugin_file)).map(|_| ())
    }

    pub fn install(&self, name: &str, version: &str) -> Result<()> {
        self.run(&install_args(name, version)).map(|_| ())
    }

    pub fn uninstall(&self, name: &str, version: &str) -> Result<()> {
        self.run(&uninstall_args(name, version)).map(|_| ())
    }

    pub fn plugin_remove(&self, name: &str) -> Result<()> {
        self.run(&plugin_remove_args(name)).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_always_pins_globally_from_the_cli_home() {
        let args = install_args("litestream", "0.5.17");
        assert_eq!(args[3..5], ["-c", "upwards-global"]);
        assert!(args.windows(2).any(|w| w == ["--pin", "global"]));
        assert_eq!(&args[5..8], ["install", "litestream", "0.5.17"]);
    }

    #[test]
    fn plugin_is_registered_in_the_global_config() {
        let args = plugin_add_args("aws", Path::new("/x/plugins/aws.toml"));
        assert!(args.contains(&"file:///x/plugins/aws.toml".to_string()));
        assert!(args.windows(2).any(|w| w == ["--to", "global"]));
    }

    #[test]
    fn inherited_version_overrides_are_detected() {
        for key in ["PROTO_VERSION", "PROTO_BUN_VERSION", "PROTO_SHIM_NAME", "PROTO_SHIM_PATH", "PROTO_NODE_VERSION"] {
            assert!(is_inherited_override(key), "{key}");
        }
        for key in ["PROTO_HOME", "PATH", "PROTO_APP_LOG", "BUN_VERSION"] {
            assert!(!is_inherited_override(key), "{key}");
        }
    }
}
