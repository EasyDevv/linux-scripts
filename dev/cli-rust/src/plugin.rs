//! proto TOML 플러그인 생성과 `.protolock` 읽기.

use anyhow::{bail, Context, Result};

use crate::manifest::{Method, Tool};

/// tools.toml 의 도구 하나를 proto 플러그인 TOML 로 바꾼다.
/// `tag` 는 release 의 실제 태그(`v1.2.3` 또는 `1.2.3`). vendor 는 무시한다.
pub fn render(tool: &Tool, version: &str, tag: Option<&str>) -> Result<String> {
    let bin = tool.bin.as_deref().context("missing bin")?;
    let exe = tool.exe_name();
    let mut out = String::new();
    out.push_str(&format!("name = {}\ntype = \"cli\"\n\n", quote(&tool.name)));
    out.push_str(&format!("[resolve]\nversions = [{}]\n\n", quote(version)));
    match tool.method {
        Method::Release => {
            let repo = tool.repo.as_deref().context("missing repo")?;
            let tag = tag.context("missing release tag")?;
            let template = tag.replace(version, "{version}");
            if !template.contains("{version}") {
                bail!("release tag {tag} does not contain version {version}");
            }
            let asset = tool.asset.as_deref().context("missing asset")?;
            let checksum = tool.checksum.as_deref().context("missing checksum")?;
            let base = format!("https://github.com/{repo}/releases/download/{template}");
            out.push_str(&format!(
                "[install]\ndownload-url = {}\nchecksum-url = {}\n\n",
                quote(&format!("{base}/{{download_file}}")),
                quote(&format!("{base}/{{checksum_file}}")),
            ));
            out.push_str(&format!("[install.exes.{}]\nprimary = true\n\n", quote(exe)));
            out.push_str(&format!(
                "[platform.linux]\ndownload-file = {}\nchecksum-file = {}\nexe-path = {}\n",
                quote(asset),
                quote(checksum),
                quote(bin),
            ));
        }
        Method::Vendor => {
            let url = tool.url.as_deref().context("missing url")?;
            let (dir, file) = url.rsplit_once('/').context("invalid url")?;
            out.push_str(&format!(
                "[install]\ndownload-url = {}\n\n",
                quote(&format!("{dir}/{{download_file}}"))
            ));
            out.push_str(&format!("[install.exes.{}]\nprimary = true\n\n", quote(exe)));
            out.push_str(&format!(
                "[platform.linux]\ndownload-file = {}\nexe-path = {}\n",
                quote(file),
                quote(bin),
            ));
        }
        other => bail!("{other:?} is not installed through a proto plugin"),
    }
    Ok(out)
}

fn quote(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// `.protolock` 에서 (도구, 버전)의 아티팩트 sha256 을 꺼낸다.
/// 형식: `sha256:<hex>` 또는 `gpg:<fp>:sha256:<hex>`.
pub fn protolock_sha256(lock_text: &str, name: &str, version: &str) -> Option<String> {
    let value: toml::Value = toml::from_str(lock_text).ok()?;
    let records = value.get("tools")?.get(name)?.as_array()?;
    for record in records {
        if record.get("version").and_then(|v| v.as_str()) != Some(version) {
            continue;
        }
        let checksum = record.get("checksum")?.as_str()?;
        let hash = checksum.rsplit("sha256:").next()?;
        if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::load_str;

    fn tool(body: &str) -> Tool {
        load_str(&format!("[defaults]\ncooldown_days = 7\n\n{body}"))
            .unwrap()
            .tools
            .remove(0)
    }

    #[test]
    fn release_plugin_uses_the_real_tag_shape() {
        let t = tool("[[tool]]\nname=\"litestream\"\nmethod=\"release\"\nrepo=\"benbjohnson/litestream\"\nversion=\"0.5.17\"\nasset=\"litestream-{version}-linux-x86_64.tar.gz\"\nchecksum=\"checksums.txt\"\nbin=\"litestream\"\n");
        let text = render(&t, "0.5.17", Some("v0.5.17")).unwrap();
        let parsed: toml::Value = toml::from_str(&text).unwrap();
        assert_eq!(parsed["install"]["download-url"].as_str().unwrap(),
            "https://github.com/benbjohnson/litestream/releases/download/v{version}/{download_file}");
        assert_eq!(parsed["resolve"]["versions"][0].as_str().unwrap(), "0.5.17");
        assert_eq!(parsed["platform"]["linux"]["checksum-file"].as_str().unwrap(), "checksums.txt");
        assert!(parsed["install"]["exes"]["litestream"]["primary"].as_bool().unwrap());
        let plain = render(&t, "0.5.17", Some("0.5.17")).unwrap();
        assert!(plain.contains("/download/{version}/{download_file}"));
    }

    #[test]
    fn tag_without_the_version_is_rejected() {
        let t = tool("[[tool]]\nname=\"x\"\nmethod=\"release\"\nrepo=\"o/r\"\nversion=\"1.0.0\"\nasset=\"a\"\nchecksum=\"c\"\nbin=\"x\"\n");
        assert!(render(&t, "1.0.0", Some("latest")).is_err());
        assert!(render(&t, "1.0.0", None).is_err());
    }

    #[test]
    fn vendor_plugin_keeps_the_file_name_and_exe_path() {
        let t = tool("[[tool]]\nname=\"aws\"\nmethod=\"vendor\"\nurl=\"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\"\nversion=\"2.39.3\"\nbin=\"aws/dist/aws\"\nexe=\"aws\"\n");
        let text = render(&t, "2.39.3", None).unwrap();
        let parsed: toml::Value = toml::from_str(&text).unwrap();
        assert_eq!(parsed["install"]["download-url"].as_str().unwrap(),
            "https://awscli.amazonaws.com/{download_file}");
        assert_eq!(parsed["platform"]["linux"]["download-file"].as_str().unwrap(), "awscli-exe-linux-x86_64.zip");
        assert_eq!(parsed["platform"]["linux"]["exe-path"].as_str().unwrap(), "aws/dist/aws");
    }

    #[test]
    fn protolock_hash_handles_plain_and_gpg_records() {
        let hash = "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d";
        let text = format!(
            "[[tools.lite]]\nos=\"linux\"\nspec=\"1\"\nversion=\"1.0.0\"\nchecksum=\"sha256:{hash}\"\n\n[[tools.aws]]\nversion=\"2\"\nchecksum=\"gpg:ABCD:sha256:{hash}\"\n\n[[tools.nohash]]\nversion=\"3\"\n"
        );
        assert_eq!(protolock_sha256(&text, "lite", "1.0.0").as_deref(), Some(hash));
        assert_eq!(protolock_sha256(&text, "aws", "2").as_deref(), Some(hash));
        assert_eq!(protolock_sha256(&text, "lite", "9"), None);
        assert_eq!(protolock_sha256(&text, "nohash", "3"), None);
        assert_eq!(protolock_sha256("not toml [[", "lite", "1"), None);
    }
}
