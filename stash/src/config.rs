use std::io;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind: String,
    pub sqlite_path: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    pub max_results: usize,
    pub download_root: PathBuf,
    pub temp_root: PathBuf,
    pub download: DownloadConfig,
    pub vpn: VpnConfig,
    pub scheduler: SchedulerConfig,
    pub retry: RetryConfig,
    pub browser_hls: BrowserHlsConfig,
}

#[derive(Clone, Debug)]
pub struct DownloadConfig {
    pub default_concurrency: usize,
    pub max_concurrency: usize,
    #[allow(dead_code)]
    pub chunk_size_bytes: u64,
    pub user_agent: String,
}

#[derive(Clone, Debug)]
pub struct SchedulerConfig {
    pub poll_interval_secs: u64,
    pub resume_on_start: bool,
    pub progress_flush_interval_ms: u64,
    pub max_concurrent_jobs: usize,
    pub disk_pause_below_bytes: u64,
    pub disk_resume_above_bytes: u64,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct BrowserHlsConfig {
    pub worker_cdp_url: String,
    pub poll_interval_secs: u64,
    pub stale_check_interval_secs: u64,
    pub stale_timeout_secs: u64,
    pub max_restart_attempts: u32,
    pub restart_interval_secs: u64,
}

#[derive(Clone, Debug)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub retry_interval_secs: u64,
}

#[derive(Clone, Debug)]
pub struct VpnConfig {
    pub command: PathBuf,
    pub socks_url: String,
    pub auto_connect: bool,
    pub connect_command: Vec<String>,
    pub connect_timeout_secs: u64,
    pub verify_before_each_job: bool,
    pub required_location: String,
    pub required_mode: String,
    pub auto_rotate_on_ip_block: bool,
    pub excluded_locations: Vec<String>,
}

#[derive(serde::Deserialize)]
struct RawConfig {
    bind: Option<String>,
    sqlite_path: Option<String>,
    allowed_roots: Option<Vec<String>>,
    max_results: Option<usize>,
    download_root: Option<String>,
    temp_root: Option<String>,
    download: Option<RawDownload>,
    scheduler: Option<RawScheduler>,
    retry: Option<RawRetry>,
    vpn: Option<RawVpn>,
    browser_hls: Option<RawBrowserHls>,
}

#[derive(serde::Deserialize)]
struct RawDownload {
    default_concurrency: Option<usize>,
    max_concurrency: Option<usize>,
    chunk_size_bytes: Option<u64>,
    user_agent: Option<String>,
}

#[derive(serde::Deserialize)]
struct RawScheduler {
    poll_interval_secs: Option<u64>,
    resume_on_start: Option<bool>,
    progress_flush_interval_ms: Option<u64>,
    max_concurrent_jobs: Option<usize>,
    disk_pause_below_bytes: Option<u64>,
    disk_resume_above_bytes: Option<u64>,
}

#[derive(serde::Deserialize)]
struct RawRetry {
    max_retries: Option<u32>,
    retry_interval_secs: Option<u64>,
}

#[derive(serde::Deserialize)]
struct RawBrowserHls {
    worker_cdp_url: Option<String>,
    poll_interval_secs: Option<u64>,
    stale_check_interval_secs: Option<u64>,
    stale_timeout_secs: Option<u64>,
    max_restart_attempts: Option<u32>,
    restart_interval_secs: Option<u64>,
}

#[derive(serde::Deserialize)]
struct RawVpn {
    command: Option<String>,
    socks_url: Option<String>,
    auto_connect: Option<bool>,
    connect_command: Option<Vec<String>>,
    connect_timeout_secs: Option<u64>,
    verify_before_each_job: Option<bool>,
    required_location: Option<String>,
    required_mode: Option<String>,
    auto_rotate_on_ip_block: Option<bool>,
    excluded_locations: Option<Vec<String>>,
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
    }
    if let Some(suffix) = path.strip_prefix("~/") {
        let mut home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
        home.push(suffix);
        return home;
    }
    PathBuf::from(path)
}

pub fn final_download_path(config: &AppConfig, filename: &str) -> PathBuf {
    config.download_root.join(filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_download_path_uses_configured_root_directly() {
        let config = AppConfig {
            bind: String::new(),
            sqlite_path: PathBuf::new(),
            allowed_roots: Vec::new(),
            max_results: 1,
            download_root: PathBuf::from("/mnt/shared"),
            temp_root: PathBuf::from("/mnt/shared/.stash"),
            download: DownloadConfig {
                default_concurrency: 1,
                max_concurrency: 1,
                chunk_size_bytes: 1,
                user_agent: String::new(),
            },
            vpn: VpnConfig {
                command: PathBuf::new(),
                socks_url: String::new(),
                auto_connect: false,
                connect_command: Vec::new(),
                connect_timeout_secs: 1,
                verify_before_each_job: false,
                required_location: String::new(),
                required_mode: String::new(),
                auto_rotate_on_ip_block: false,
                excluded_locations: Vec::new(),
            },
            scheduler: SchedulerConfig {
                poll_interval_secs: 1,
                resume_on_start: true,
                progress_flush_interval_ms: 1,
                max_concurrent_jobs: 1,
                disk_pause_below_bytes: 1,
                disk_resume_above_bytes: 2,
            },
            retry: RetryConfig {
                max_retries: 1,
                retry_interval_secs: 1,
            },
            browser_hls: BrowserHlsConfig {
                worker_cdp_url: String::new(),
                poll_interval_secs: 1,
                stale_check_interval_secs: 1,
                stale_timeout_secs: 1,
                max_restart_attempts: 1,
                restart_interval_secs: 1,
            },
        };

        assert_eq!(
            final_download_path(&config, "video.mp4"),
            PathBuf::from("/mnt/shared/video.mp4")
        );
    }
}

fn default_config_path() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".to_string()))
        .join(".config/stash/config.toml")
}

pub fn load_config(path: Option<&str>) -> io::Result<AppConfig> {
    let config_path = path.map(PathBuf::from).unwrap_or_else(default_config_path);
    let raw_text = std::fs::read_to_string(&config_path)
        .map_err(|e| io::Error::new(e.kind(), format!("config {}: {e}", config_path.display())))?;
    let raw: RawConfig = toml::from_str(&raw_text)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

    let download_root = raw
        .download_root
        .map(|s| expand_home(&s))
        .unwrap_or_else(|| PathBuf::from("/mnt/shared"));
    let temp_root = raw
        .temp_root
        .map(|s| expand_home(&s))
        .unwrap_or_else(|| download_root.join(".stash"));
    let allowed_roots = raw
        .allowed_roots
        .map(|v| v.into_iter().map(|s| expand_home(&s)).collect())
        .unwrap_or_else(|| vec![download_root.clone()]);
    let sqlite_path = raw
        .sqlite_path
        .map(|s| expand_home(&s))
        .unwrap_or_else(|| temp_root.join("file.db"));

    std::fs::create_dir_all(&download_root)?;
    std::fs::create_dir_all(&temp_root)?;
    if let Some(parent) = sqlite_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let download = raw.download.unwrap_or(RawDownload {
        default_concurrency: None,
        max_concurrency: None,
        chunk_size_bytes: None,
        user_agent: None,
    });
    let scheduler = raw.scheduler.unwrap_or(RawScheduler {
        poll_interval_secs: None,
        resume_on_start: None,
        progress_flush_interval_ms: None,
        max_concurrent_jobs: None,
        disk_pause_below_bytes: None,
        disk_resume_above_bytes: None,
    });
    let retry = raw.retry.unwrap_or(RawRetry {
        max_retries: None,
        retry_interval_secs: None,
    });
    let browser_hls = raw.browser_hls.unwrap_or(RawBrowserHls {
        worker_cdp_url: None,
        poll_interval_secs: None,
        stale_check_interval_secs: None,
        stale_timeout_secs: None,
        max_restart_attempts: None,
        restart_interval_secs: None,
    });
    let vpn = raw.vpn.unwrap_or(RawVpn {
        command: None,
        socks_url: None,
        auto_connect: None,
        connect_command: None,
        connect_timeout_secs: None,
        verify_before_each_job: None,
        required_location: None,
        required_mode: None,
        auto_rotate_on_ip_block: None,
        excluded_locations: None,
    });

    Ok(AppConfig {
        bind: raw.bind.unwrap_or_else(|| "127.0.0.1:38481".to_string()),
        sqlite_path,
        allowed_roots,
        max_results: raw.max_results.unwrap_or(100).max(1),
        download_root,
        temp_root,
        download: DownloadConfig {
            default_concurrency: download.default_concurrency.unwrap_or(3),
            max_concurrency: download.max_concurrency.unwrap_or(3),
            chunk_size_bytes: download.chunk_size_bytes.unwrap_or(8_388_608),
            user_agent: download
                .user_agent
                .unwrap_or_else(|| "stash/0.1".to_string()),
        },
        scheduler: SchedulerConfig {
            poll_interval_secs: scheduler.poll_interval_secs.unwrap_or(2),
            resume_on_start: scheduler.resume_on_start.unwrap_or(true),
            progress_flush_interval_ms: scheduler.progress_flush_interval_ms.unwrap_or(1000),
            max_concurrent_jobs: scheduler.max_concurrent_jobs.unwrap_or(3).max(1),
            disk_pause_below_bytes: scheduler
                .disk_pause_below_bytes
                .unwrap_or(5 * 1024 * 1024 * 1024),
            disk_resume_above_bytes: scheduler
                .disk_resume_above_bytes
                .unwrap_or(10 * 1024 * 1024 * 1024),
        },
        retry: RetryConfig {
            max_retries: retry.max_retries.unwrap_or(5),
            retry_interval_secs: retry.retry_interval_secs.unwrap_or(30),
        },
        browser_hls: BrowserHlsConfig {
            worker_cdp_url: browser_hls
                .worker_cdp_url
                .unwrap_or_else(|| "http://127.0.0.1:12345".to_string()),
            poll_interval_secs: browser_hls.poll_interval_secs.unwrap_or(2),
            stale_check_interval_secs: browser_hls.stale_check_interval_secs.unwrap_or(60),
            stale_timeout_secs: browser_hls.stale_timeout_secs.unwrap_or(300),
            max_restart_attempts: browser_hls.max_restart_attempts.unwrap_or(3),
            restart_interval_secs: browser_hls.restart_interval_secs.unwrap_or(300),
        },
        vpn: VpnConfig {
            command: expand_home(
                &vpn.command
                    .unwrap_or_else(|| "/usr/local/bin/adguardvpn-cli".to_string()),
            ),
            socks_url: vpn
                .socks_url
                .unwrap_or_else(|| "socks5h://127.0.0.1:1080".to_string()),
            auto_connect: vpn.auto_connect.unwrap_or(true),
            connect_command: vpn
                .connect_command
                .unwrap_or_else(|| vec!["connect".into(), "-l".into(), "tokyo".into()]),
            connect_timeout_secs: vpn.connect_timeout_secs.unwrap_or(20),
            verify_before_each_job: vpn.verify_before_each_job.unwrap_or(true),
            required_location: vpn.required_location.unwrap_or_else(|| "tokyo".to_string()),
            required_mode: vpn.required_mode.unwrap_or_else(|| "socks".to_string()),
            auto_rotate_on_ip_block: vpn.auto_rotate_on_ip_block.unwrap_or(true),
            excluded_locations: vpn
                .excluded_locations
                .unwrap_or_else(|| vec!["Seoul".to_string()]),
        },
    })
}
