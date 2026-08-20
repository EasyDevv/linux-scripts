use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

use crate::util::{db_stem, shlex_quote, snapshots_dir};

pub struct RemoteExec {
    pub host: String,
    pub sudo: bool,
}

impl RemoteExec {
    pub fn run_script(&self, script: &str) -> Result<String> {
        let output = self.spawn_bash(script)?;
        if !output.status.success() {
            bail!(
                "ssh {} failed ({}): {}",
                self.host,
                output.status,
                tail_text(&output.stderr, &output.stdout)
            );
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    pub fn pull_file(&self, remote: &Path, local: &Path) -> Result<()> {
        if let Some(parent) = local.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = format!(
            "/tmp/db-sync-pull-{}-{}.db",
            std::process::id(),
            crate::util::unix_millis()
        );
        let script = format!(
            r#"
set -euo pipefail
src={src}
tmp={tmp}
python3 - "$src" "$tmp" <<'PY'
import os, sqlite3, sys
src, tmp = sys.argv[1], sys.argv[2]
if os.path.exists(tmp):
    os.remove(tmp)
con = sqlite3.connect(src)
status = con.execute("PRAGMA integrity_check").fetchone()[0]
if status != "ok":
    con.close()
    raise SystemExit("corrupt %s: %s" % (src, status))
con.execute("VACUUM INTO %s" % (repr(tmp),))
con.close()
PY
cat -- "$tmp"
rm -f -- "$tmp"
"#,
            src = shlex_quote(&remote.to_string_lossy()),
            tmp = shlex_quote(&tmp),
        );
        let output = self.spawn_bash(&script)?;
        if !output.status.success() {
            let _ = self.remove_file(Path::new(&tmp));
            bail!(
                "pull {} failed: {}",
                remote.display(),
                tail_text(&output.stderr, &output.stdout)
            );
        }
        if output.stdout.len() < 100 {
            bail!(
                "pull {} produced a tiny file ({} bytes)",
                remote.display(),
                output.stdout.len()
            );
        }
        fs::write(local, output.stdout).with_context(|| format!("write {}", local.display()))?;
        Ok(())
    }

    pub fn push_file(&self, local: &Path, remote: &Path) -> Result<()> {
        let bytes = fs::read(local).with_context(|| format!("read {}", local.display()))?;
        let tmp = format!(
            "/tmp/db-sync-incoming-{}-{}.db",
            std::process::id(),
            crate::util::unix_millis()
        );
        let mut cmd = Command::new("ssh");
        cmd.arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("ConnectTimeout=15")
            .arg(&self.host);
        if self.sudo {
            cmd.arg("sudo").arg("-n");
        }
        cmd.arg("tee").arg("--").arg(&tmp);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .with_context(|| format!("ssh {} tee", self.host))?;
        child.stdin.as_mut().expect("stdin").write_all(&bytes)?;
        // close stdin so tee sees EOF
        drop(child.stdin.take());
        let output = child.wait_with_output().context("wait ssh tee")?;
        if !output.status.success() {
            let _ = self.remove_file(Path::new(&tmp));
            bail!(
                "push {} failed: {}",
                remote.display(),
                tail_text(&output.stderr, &output.stdout)
            );
        }

        let parent = remote.parent().unwrap_or(Path::new("."));
        let script = format!(
            r#"
set -euo pipefail
mkdir -p -- {parent}
mv -f -- {tmp} {dest}
chmod 600 -- {dest}
"#,
            parent = shlex_quote(&parent.to_string_lossy()),
            tmp = shlex_quote(&tmp),
            dest = shlex_quote(&remote.to_string_lossy()),
        );
        self.run_script(&script)
            .with_context(|| format!("install incoming {}", remote.display()))?;
        Ok(())
    }

    pub fn remove_file(&self, remote: &Path) -> Result<()> {
        let script = format!("rm -f -- {}", shlex_quote(&remote.to_string_lossy()));
        self.run_script(&script)?;
        Ok(())
    }

    fn spawn_bash(&self, script: &str) -> Result<std::process::Output> {
        let mut cmd = Command::new("ssh");
        cmd.arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("ConnectTimeout=20")
            .arg(&self.host);
        if self.sudo {
            cmd.arg("sudo").arg("-n").arg("bash").arg("-s");
        } else {
            cmd.arg("bash").arg("-s");
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().with_context(|| format!("ssh {}", self.host))?;
        child
            .stdin
            .as_mut()
            .expect("stdin piped")
            .write_all(script.as_bytes())?;
        child.wait_with_output().context("wait ssh")
    }
}

pub fn snapshot_remote(exec: &RemoteExec, db_path: &Path, retention: usize) -> Result<PathBuf> {
    let stem = db_stem(db_path);
    let snap_dir = snapshots_dir(db_path);
    let timestamp = crate::util::unix_millis();
    let final_path = snap_dir.join(format!("{stem}-{timestamp}.db"));
    let quoted_db = shlex_quote(&db_path.to_string_lossy());
    let quoted_dir = shlex_quote(&snap_dir.to_string_lossy());
    let quoted_final = shlex_quote(&final_path.to_string_lossy());
    let quoted_stem = shlex_quote(&stem);
    let script = format!(
        r#"
set -euo pipefail
db={quoted_db}
dir={quoted_dir}
final={quoted_final}
stem={quoted_stem}
retention={retention}
if [ ! -f "$db" ]; then
  echo "database not found: $db" >&2
  exit 1
fi
mkdir -p "$dir"
chmod 700 "$dir"
tmp="$dir/_tmp_${{stem}}-$$.db"
python3 - "$db" "$tmp" "$final" <<'PY'
import os, sqlite3, sys
src, tmp, final = sys.argv[1], sys.argv[2], sys.argv[3]
if os.path.exists(tmp):
    os.remove(tmp)
con = sqlite3.connect(src)
status = con.execute("PRAGMA integrity_check").fetchone()[0]
if status != "ok":
    con.close()
    raise SystemExit(f"corrupt {{src}}: {{status}}")
con.execute("VACUUM INTO %s" % (repr(tmp),))
con.close()
verify = sqlite3.connect(tmp)
vstatus = verify.execute("PRAGMA integrity_check").fetchone()[0]
verify.close()
if vstatus != "ok":
    os.remove(tmp)
    raise SystemExit(f"verify-failed: {{vstatus}}")
os.replace(tmp, final)
os.chmod(final, 0o600)
PY
ln -sfn "$(basename "$final")" "$dir/${{stem}}-latest.db"
python3 - "$dir" "$stem" "$retention" <<'PY'
import os, sys
dir_path, stem, retention = sys.argv[1], sys.argv[2], int(sys.argv[3])
prefix = f"{{stem}}-"
latest = f"{{stem}}-latest.db"
names = []
for name in os.listdir(dir_path):
    if name == latest or name.startswith("_tmp_"):
        continue
    if name.startswith(prefix) and name.endswith(".db"):
        names.append(name)
names.sort()
if retention > 0 and len(names) > retention:
    for name in names[: len(names) - retention]:
        os.remove(os.path.join(dir_path, name))
PY
if [ "$(id -un)" = root ]; then
  owner=$(stat -c %U -- "$db")
  chown -R "$owner:$owner" "$dir" || true
fi
printf '%s\n' "$final"
"#
    );
    let stdout = exec.run_script(&script)?;
    let remote_path = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
        .ok_or_else(|| anyhow::anyhow!("remote snapshot produced no path"))?;
    Ok(PathBuf::from(remote_path))
}

pub fn backup_install_remote(exec: &RemoteExec, incoming: &Path, dest: &Path) -> Result<()> {
    let quoted_src = shlex_quote(&incoming.to_string_lossy());
    let quoted_dest = shlex_quote(&dest.to_string_lossy());
    let script = format!(
        r#"
set -euo pipefail
python3 - {quoted_src} {quoted_dest} <<'PY'
import sqlite3, sys
src, dest = sys.argv[1], sys.argv[2]
source = sqlite3.connect(src)
dest_conn = sqlite3.connect(dest)
source.backup(dest_conn)
dest_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
dest_conn.close()
source.close()
PY
"#
    );
    exec.run_script(&script)?;
    Ok(())
}

pub fn replace_file_remote(exec: &RemoteExec, incoming: &Path, dest: &Path) -> Result<()> {
    let quoted_src = shlex_quote(&incoming.to_string_lossy());
    let quoted_dest = shlex_quote(&dest.to_string_lossy());
    let script = format!(
        r#"
set -euo pipefail
src={quoted_src}
dest={quoted_dest}
rm -f -- "$dest-wal" "$dest-shm"
mv -f -- "$src" "$dest"
chmod 600 -- "$dest"
"#
    );
    exec.run_script(&script)?;
    Ok(())
}

pub fn chown_remote(exec: &RemoteExec, path: &Path, owner: &str) -> Result<()> {
    let script = format!(
        "chown {owner}:{owner} -- {}",
        shlex_quote(&path.to_string_lossy())
    );
    exec.run_script(&script)?;
    Ok(())
}

pub fn remote_owner(exec: &RemoteExec, path: &Path) -> Result<String> {
    let script = format!("stat -c %U -- {}", shlex_quote(&path.to_string_lossy()));
    Ok(exec.run_script(&script)?.trim().to_string())
}

pub fn systemctl_user(exec: &RemoteExec, machine: &str, action: &str, unit: &str) -> Result<()> {
    let script = format!(
        "systemctl --machine={} --user {} {}",
        shlex_quote(machine),
        shlex_quote(action),
        shlex_quote(unit)
    );
    exec.run_script(&script)?;
    Ok(())
}

fn tail_text(stderr: &[u8], stdout: &[u8]) -> String {
    let err = String::from_utf8_lossy(stderr);
    let out = String::from_utf8_lossy(stdout);
    let text = if err.trim().is_empty() {
        out.into_owned()
    } else {
        err.into_owned()
    };
    let trimmed = text.trim();
    if trimmed.len() <= 800 {
        trimmed.to_string()
    } else {
        trimmed[trimmed.len() - 800..].to_string()
    }
}

pub fn incoming_path(db_path: &Path) -> PathBuf {
    match db_path.parent() {
        Some(parent) => parent.join(".db-sync-incoming.db"),
        None => PathBuf::from(".db-sync-incoming.db"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_sits_beside_db() {
        assert_eq!(
            incoming_path(Path::new("/data/app.db")),
            PathBuf::from("/data/.db-sync-incoming.db")
        );
    }
}
