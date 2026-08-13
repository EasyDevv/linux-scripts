use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

const HTTP_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const SEGMENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

#[derive(Debug, Clone)]
pub struct HlsSegment {
    pub uri: String,
}

#[derive(Debug)]
pub struct ResolvedPlaylist {
    pub segments: Vec<HlsSegment>,
    pub has_encryption: bool,
    pub map_uri: Option<String>,
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "host"
            | "connection"
            | "keep-alive"
            | "proxy-connection"
            | "transfer-encoding"
            | "upgrade"
            | "proxy-authorization"
            | "te"
            | "content-length"
            | "range"
    )
}

fn parse_attrs(s: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut chars = s.chars().peekable();

    loop {
        while chars
            .peek()
            .map_or(false, |c| c.is_whitespace() || *c == ',')
        {
            chars.next();
        }
        let mut key = String::new();
        while let Some(&c) = chars.peek() {
            if c == '=' {
                break;
            }
            key.push(c);
            chars.next();
        }
        if chars.next() != Some('=') {
            break;
        }
        let mut value = String::new();
        if chars.peek() == Some(&'"') {
            chars.next();
            loop {
                match chars.next() {
                    Some('"') => break,
                    Some(c) => value.push(c),
                    None => break,
                }
            }
        } else {
            while let Some(&c) = chars.peek() {
                if c == ',' || c == '"' || c.is_whitespace() {
                    break;
                }
                value.push(c);
                chars.next();
            }
        }
        map.insert(key.trim().to_uppercase(), value);
        if chars.peek() == Some(&',') {
            chars.next();
        }
    }

    map
}

fn resolve_url(base: &str, uri: &str) -> String {
    if let Ok(parsed) = url::Url::parse(base) {
        if let Ok(joined) = parsed.join(uri) {
            return joined.to_string();
        }
    }
    uri.to_string()
}

pub fn parse_playlist(body: &str, base_url: &str) -> Result<ResolvedPlaylist, String> {
    if !body.starts_with("#EXTM3U") {
        return Err("not a valid M3U8 playlist (missing #EXTM3U)".into());
    }

    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;
    let mut variants: Vec<(u64, String)> = Vec::new();

    while i < lines.len() {
        let line = lines[i].trim();
        if line.starts_with("#EXT-X-STREAM-INF:") {
            let attrs = parse_attrs(line.trim_start_matches("#EXT-X-STREAM-INF:"));
            let bandwidth: u64 = attrs
                .get("BANDWIDTH")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if let Some(uri) = lines
                .get(i + 1)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty() && !s.starts_with('#'))
            {
                variants.push((bandwidth, resolve_url(base_url, uri)));
                i += 1;
            }
        }
        i += 1;
    }

    if !variants.is_empty() {
        let best = variants
            .into_iter()
            .max_by_key(|(bw, _)| *bw)
            .ok_or_else(|| "no variants in master playlist".to_string())?;
        return Ok(ResolvedPlaylist {
            segments: Vec::new(),
            has_encryption: false,
            map_uri: Some(best.1),
        });
    }

    let mut segments = Vec::new();
    let mut has_encryption = false;
    let mut map_uri = None;

    for line in &lines {
        let line = line.trim();
        if line.starts_with("#EXT-X-KEY:") {
            let attrs = parse_attrs(line.trim_start_matches("#EXT-X-KEY:"));
            let method = attrs.get("METHOD").map(|s| s.as_str()).unwrap_or("");
            if method != "NONE" {
                has_encryption = true;
            }
        } else if line.starts_with("#EXT-X-MAP:") {
            let attrs = parse_attrs(line.trim_start_matches("#EXT-X-MAP:"));
            map_uri = attrs.get("URI").map(|u| resolve_url(base_url, u));
        } else if !line.is_empty() && !line.starts_with('#') {
            segments.push(HlsSegment {
                uri: resolve_url(base_url, line),
            });
        }
    }

    Ok(ResolvedPlaylist {
        segments,
        has_encryption,
        map_uri,
    })
}

pub async fn fetch_and_resolve(
    url: &str,
    client: &reqwest::Client,
    cancel: Arc<AtomicBool>,
    headers: &[(String, String)],
) -> Result<ResolvedPlaylist, String> {
    let mut current_url = url.to_string();
    loop {
        let body = fetch_text(client, &current_url, cancel.clone(), headers).await?;
        let resolved = parse_playlist(&body, &current_url)?;

        match resolved.map_uri.as_ref() {
            Some(variant_uri) if resolved.segments.is_empty() => {
                current_url = variant_uri.clone();
                continue;
            }
            _ => return Ok(resolved),
        }
    }
}

pub async fn download_segments(
    resolved: &ResolvedPlaylist,
    client: &reqwest::Client,
    dest_dir: &Path,
    cancel: Arc<AtomicBool>,
    progress: Arc<dyn Fn(u64, u64, u64) + Send + Sync>,
    headers: &[(String, String)],
) -> Result<(Vec<PathBuf>, u64), String> {
    if resolved.has_encryption {
        return Err("encrypted HLS (EXT-X-KEY) is not supported".into());
    }

    tokio::fs::create_dir_all(dest_dir)
        .await
        .map_err(|e| format!("create seg dir: {e}"))?;

    let total_count = resolved.segments.len() + resolved.map_uri.is_some() as usize;
    if total_count == 0 {
        return Err("playlist has no segments".into());
    }

    let mut files = Vec::with_capacity(total_count);
    let mut completed: u64 = 0;
    let mut total_bytes: u64 = 0;

    if let Some(ref map_uri) = resolved.map_uri {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let path = dest_dir.join("init.mp4");
        let seg_bytes = match existing_file_size(&path).await {
            Some(size) => size,
            None => {
                let (data, size) =
                    download_data_with_timeout(client, map_uri, cancel.clone(), headers).await?;
                write_file(&path, &data).await?;
                size
            }
        };
        total_bytes += seg_bytes;
        completed += 1;
        progress(completed, total_count as u64, total_bytes);
        files.push(path);
    }

    for (i, seg) in resolved.segments.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let path = dest_dir.join(format!("segment-{i:06}.ts"));
        let seg_bytes = match existing_file_size(&path).await {
            Some(size) => size,
            None => {
                let (data, size) =
                    download_data_with_timeout(client, &seg.uri, cancel.clone(), headers).await?;
                write_file(&path, &data).await?;
                size
            }
        };
        total_bytes += seg_bytes;
        completed += 1;
        progress(completed, total_count as u64, total_bytes);
        files.push(path);
    }

    Ok((files, total_bytes))
}

async fn existing_file_size(path: &Path) -> Option<u64> {
    tokio::fs::metadata(path)
        .await
        .ok()
        .map(|metadata| metadata.len())
        .filter(|size| *size > 0)
}

async fn fetch_text(
    client: &reqwest::Client,
    url: &str,
    cancel: Arc<AtomicBool>,
    headers: &[(String, String)],
) -> Result<String, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let mut req = client.get(url);
    for (k, v) in headers {
        if !is_hop_by_hop(k) {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = tokio::time::timeout(HTTP_IDLE_TIMEOUT, req.send())
        .await
        .map_err(|_| "fetch text: timed out waiting for response".to_string())?
        .map_err(|e| format!("fetch text: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("fetch text: HTTP {}", resp.status()));
    }
    tokio::time::timeout(HTTP_IDLE_TIMEOUT, resp.text())
        .await
        .map_err(|_| "read text body: timed out waiting for data".to_string())?
        .map_err(|e| format!("read text body: {e}"))
}

async fn download_data(
    client: &reqwest::Client,
    url: &str,
    cancel: Arc<AtomicBool>,
    headers: &[(String, String)],
) -> Result<(Vec<u8>, u64), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let mut req = client.get(url);
    for (k, v) in headers {
        if !is_hop_by_hop(k) {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = tokio::time::timeout(HTTP_IDLE_TIMEOUT, req.send())
        .await
        .map_err(|_| "download: timed out waiting for response".to_string())?
        .map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::with_capacity(total as usize);
    loop {
        let next = tokio::time::timeout(HTTP_IDLE_TIMEOUT, stream.next())
            .await
            .map_err(|_| "download body: timed out waiting for data".to_string())?;
        let Some(chunk) = next else { break };
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| format!("download chunk: {e}"))?;
        buf.extend_from_slice(&chunk);
    }
    let buf = unwrap_png_transport(buf);
    let size = buf.len() as u64;
    Ok((buf, size))
}

async fn download_data_with_timeout(
    client: &reqwest::Client,
    url: &str,
    cancel: Arc<AtomicBool>,
    headers: &[(String, String)],
) -> Result<(Vec<u8>, u64), String> {
    tokio::time::timeout(SEGMENT_TIMEOUT, download_data(client, url, cancel, headers))
        .await
        .map_err(|_| "download: segment exceeded 90 seconds".to_string())?
}

fn unwrap_png_transport(mut data: Vec<u8>) -> Vec<u8> {
    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const IEND: &[u8] = b"IEND\xaeB`\x82";
    if !data.starts_with(PNG_SIGNATURE) {
        return data;
    }
    let Some(marker) = data.windows(IEND.len()).position(|window| window == IEND) else {
        return data;
    };
    let payload = marker + IEND.len();
    if data.get(payload) == Some(&0x47) && data.get(payload + 188) == Some(&0x47) {
        return data.split_off(payload);
    }
    data
}

async fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut f = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("create {}: {e}", path.display()))?;
    f.write_all(data)
        .await
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    f.flush()
        .await
        .map_err(|e| format!("flush {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_master_playlist_selects_highest_bandwidth() {
        let body = "#EXTM3U\n\
                     #EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=720x480\n\
                     medium.m3u8\n\
                     #EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1280x720\n\
                     high.m3u8\n\
                     #EXT-X-STREAM-INF:BANDWIDTH=5120000,RESOLUTION=1920x1080\n\
                     highest.m3u8\n";
        let base = "https://example.com/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert_eq!(result.map_uri.unwrap(), "https://example.com/highest.m3u8");
    }

    #[test]
    fn test_parse_media_playlist_segments() {
        let body = "#EXTM3U\n\
                     #EXT-X-TARGETDURATION:10\n\
                     #EXTINF:10.000,\n\
                     https://cdn.example.com/seg1.ts\n\
                     #EXTINF:9.500,\n\
                     seg2.ts\n\
                     #EXT-X-ENDLIST\n";
        let base = "https://example.com/path/to/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert!(!result.has_encryption);
        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.segments[0].uri, "https://cdn.example.com/seg1.ts");
        assert_eq!(
            result.segments[1].uri,
            "https://example.com/path/to/seg2.ts"
        );
    }

    #[test]
    fn test_unwraps_png_prefixed_transport_stream() {
        let mut wrapped = b"\x89PNG\r\n\x1a\nIEND\xaeB`\x82".to_vec();
        let mut transport = vec![0_u8; 377];
        transport[0] = 0x47;
        transport[188] = 0x47;
        wrapped.extend_from_slice(&transport);
        assert_eq!(unwrap_png_transport(wrapped), transport);
    }

    #[test]
    fn test_reject_encrypted_hls() {
        let body = "#EXTM3U\n\
                     #EXT-X-TARGETDURATION:10\n\
                     #EXT-X-KEY:METHOD=AES-128,URI=\"https://keys.example.com/key\"\n\
                     #EXTINF:10.000,\n\
                     seg1.ts\n\
                     #EXT-X-ENDLIST\n";
        let base = "https://example.com/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert!(result.has_encryption);
    }

    #[test]
    fn test_allow_none_encryption() {
        let body = "#EXTM3U\n\
                     #EXT-X-KEY:METHOD=NONE\n\
                     #EXTINF:10.000,\n\
                     seg1.ts\n";
        let base = "https://example.com/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert!(!result.has_encryption);
        assert_eq!(result.segments.len(), 1);
    }

    #[test]
    fn test_ext_x_map_uri() {
        let body = "#EXTM3U\n\
                     #EXT-X-TARGETDURATION:10\n\
                     #EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"1000@0\"\n\
                     #EXTINF:10.000,\n\
                     seg1.ts\n\
                     #EXT-X-ENDLIST\n";
        let base = "https://example.com/path/to/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert_eq!(
            result.map_uri.unwrap(),
            "https://example.com/path/to/init.mp4"
        );
        assert_eq!(result.segments.len(), 1);
    }

    #[test]
    fn test_resolve_absolute_url() {
        let result = resolve_url(
            "https://example.com/path/to/p.m3u8",
            "https://cdn.example.com/seg.ts",
        );
        assert_eq!(result, "https://cdn.example.com/seg.ts");
    }

    #[test]
    fn test_resolve_absolute_path() {
        let result = resolve_url("https://example.com/path/to/p.m3u8", "/segments/seg.ts");
        assert_eq!(result, "https://example.com/segments/seg.ts");
    }

    #[test]
    fn test_resolve_relative_url() {
        let result = resolve_url("https://example.com/path/to/p.m3u8", "seg.ts");
        assert_eq!(result, "https://example.com/path/to/seg.ts");
    }

    #[test]
    fn test_resolve_relative_with_subdir() {
        let result = resolve_url("https://example.com/path/to/p.m3u8", "sub/seg.ts");
        assert_eq!(result, "https://example.com/path/to/sub/seg.ts");
    }

    #[test]
    fn test_resolve_relative_base_with_query() {
        let result = resolve_url("https://example.com/path/to/p.m3u8?token=abc", "seg.ts");
        assert_eq!(result, "https://example.com/path/to/seg.ts");
    }

    #[test]
    fn test_resolve_base_at_root() {
        let result = resolve_url("https://example.com/playlist.m3u8", "seg.ts");
        assert_eq!(result, "https://example.com/seg.ts");
    }

    #[test]
    fn test_resolve_dotdot_url() {
        let result = resolve_url("https://example.com/path/to/p.m3u8", "../seg.ts");
        assert_eq!(result, "https://example.com/path/seg.ts");
    }

    #[test]
    fn test_resolve_dotdot_deep() {
        let result = resolve_url("https://example.com/a/b/c/p.m3u8", "../../seg.ts");
        assert_eq!(result, "https://example.com/a/seg.ts");
    }

    #[test]
    fn test_resolve_origin_relative() {
        let result = resolve_url("https://example.com/path/to/p.m3u8", "/root/seg.ts");
        assert_eq!(result, "https://example.com/root/seg.ts");
    }

    #[test]
    fn test_resolve_query_with_dotdot() {
        let result = resolve_url(
            "https://example.com/a/b/p.m3u8?token=abc",
            "../c/seg.ts?q=1",
        );
        assert_eq!(result, "https://example.com/a/c/seg.ts?q=1");
    }

    #[test]
    fn test_parse_invalid_playlist() {
        let result = parse_playlist("NOT AN M3U8", "https://example.com/");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("#EXTM3U"));
    }

    #[test]
    fn test_parse_master_playlist_no_variants_yields_empty() {
        let body = "#EXTM3U\n#EXT-X-STREAM-INF:\n";
        let result = parse_playlist(body, "https://example.com/");
        assert!(result.is_ok());
        assert!(result.unwrap().segments.is_empty());
    }

    #[test]
    fn test_media_playlist_with_absolute_segments() {
        let body = "#EXTM3U\n\
                     #EXTINF:10.000,\n\
                     https://cdn1.example.com/seg1.ts\n\
                     https://cdn2.example.com/seg2.ts\n";
        let base = "https://example.com/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.segments[0].uri, "https://cdn1.example.com/seg1.ts");
        assert_eq!(result.segments[1].uri, "https://cdn2.example.com/seg2.ts");
    }

    #[test]
    fn test_media_playlist_with_dotdot_segments() {
        let body = "#EXTM3U\n\
                     #EXTINF:10.000,\n\
                     ../segments/seg1.ts\n";
        let base = "https://example.com/a/b/playlist.m3u8";
        let result = parse_playlist(body, base).unwrap();
        assert_eq!(
            result.segments[0].uri,
            "https://example.com/a/segments/seg1.ts"
        );
    }

    #[test]
    fn test_headers_filtered_on_all_fetches() {
        let pairs: Vec<(String, String)> = vec![
            (
                "Referer".to_string(),
                "https://page.example.com".to_string(),
            ),
            ("Origin".to_string(), "https://page.example.com".to_string()),
            ("Connection".to_string(), "keep-alive".to_string()),
        ];
        let mut req = reqwest::Client::new().get("https://example.com/seg.ts");
        for (k, v) in &pairs {
            if !is_hop_by_hop(k) {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        let built = req.build().unwrap();
        let hdrs = built.headers();
        assert!(hdrs.contains_key("referer"));
        assert!(hdrs.contains_key("origin"));
        assert!(!hdrs.contains_key("connection"));
    }
}
