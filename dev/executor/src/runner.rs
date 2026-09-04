use crate::cli::CliError;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const DEFAULT_RUN_TIMEOUT_MS: u64 = 2_000;
const DEFAULT_RUN_MAX_BUFFER: usize = 1024 * 1024;
const JOURNAL_FAILURE_RATE_LIMIT_MS: u64 = 60_000;

pub struct RunResult {
    pub ok: bool,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub signal_code: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub spawn_error: Option<String>,
    pub timed_out: bool,
    pub output_overflow: bool,
}

pub struct RunOptions {
    pub cwd: Option<String>,
    pub timeout_ms: u64,
    pub max_buffer: usize,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            cwd: None,
            timeout_ms: DEFAULT_RUN_TIMEOUT_MS,
            max_buffer: DEFAULT_RUN_MAX_BUFFER,
        }
    }
}

pub fn extract_port(cmd: &str) -> String {
    if cmd.is_empty() {
        return String::new();
    }
    for key in ["--web-port", "--client-port", "--port"] {
        if let Some(value) = match_flag(cmd, key) {
            return value;
        }
    }
    String::new()
}

fn match_flag(cmd: &str, flag: &str) -> Option<String> {
    let bytes = cmd.as_bytes();
    let needle = flag.as_bytes();
    let mut i = 0;
    while i + needle.len() < bytes.len() {
        if &bytes[i..i + needle.len()] == needle {
            let mut j = i + needle.len();
            if j < bytes.len() && (bytes[j] == b'=' || bytes[j] == b' ') {
                j += 1;
                let start = j;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j > start {
                    return Some(String::from_utf8_lossy(&bytes[start..j]).into_owned());
                }
            }
        }
        i += 1;
    }
    None
}

pub fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".into();
    }
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | ':' | '@' | '%' | '+' | '=' | ',' | '-'))
    {
        return value.into();
    }
    format!("'{}'", value.replace('\'', r"'\''"))
}

pub fn print_command(args: &[String]) {
    let joined = args.iter().map(|a| shell_quote(a)).collect::<Vec<_>>().join(" ");
    println!("▶ {joined}");
}

pub fn run_text(args: &[String], options: RunOptions) -> RunResult {
    run_text_timed(args, options)
}

pub fn format_since() -> String {
    let now = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or(std::time::UNIX_EPOCH);
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format_iso8601(secs)
}

fn format_iso8601(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let hours = rem / 3_600;
    let minutes = (rem % 3_600) / 60;
    let seconds = rem % 60;
    let mut y = 1970i32;
    let mut remaining = days as i64;
    loop {
        let diy = if is_leap(y) { 366 } else { 365 };
        if remaining < diy {
            break;
        }
        remaining -= diy;
        y += 1;
    }
    let mut m = 1u32;
    let mdays = [
        31,
        if is_leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for (idx, count) in mdays.iter().enumerate() {
        if remaining < *count as i64 {
            m = idx as u32 + 1;
            break;
        }
        remaining -= *count as i64;
    }
    let d = remaining as u32 + 1;
    format!("{y:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}.000Z")
}

fn is_leap(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

pub fn run_text_timed(args: &[String], options: RunOptions) -> RunResult {
    if args.is_empty() {
        return RunResult {
            ok: false,
            success: false,
            exit_code: None,
            signal_code: None,
            stdout: String::new(),
            stderr: String::new(),
            spawn_error: Some("missing command".into()),
            timed_out: false,
            output_overflow: false,
        };
    }
    let mut command = Command::new(&args[0]);
    command.args(&args[1..]);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.stdin(Stdio::null());
    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    let start = Instant::now();
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return RunResult {
                ok: false,
                success: false,
                exit_code: None,
                signal_code: None,
                stdout: String::new(),
                stderr: String::new(),
                spawn_error: Some(error.to_string()),
                timed_out: false,
                output_overflow: false,
            };
        }
    };
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_buf = std::sync::Arc::new(Mutex::new(Vec::new()));
    let stderr_buf = std::sync::Arc::new(Mutex::new(Vec::new()));
    let out_thread = stdout_pipe.map(|mut pipe| {
        let buf = stdout_buf.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
            *buf.lock().unwrap() = bytes;
        })
    });
    let err_thread = stderr_pipe.map(|mut pipe| {
        let buf = stderr_buf.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
            *buf.lock().unwrap() = bytes;
        })
    });
    let finish = |timed_out: bool, overflow: bool, status: Option<std::process::ExitStatus>| {
        if let Some(thread) = out_thread {
            let _ = thread.join();
        }
        if let Some(thread) = err_thread {
            let _ = thread.join();
        }
        let stdout = String::from_utf8_lossy(&stdout_buf.lock().unwrap()).into_owned();
        let stderr = String::from_utf8_lossy(&stderr_buf.lock().unwrap()).into_owned();
        let overflow = overflow || stdout.len() + stderr.len() > options.max_buffer;
        let code = status.and_then(|status| status.code());
        let ok = status.map(|status| status.success()).unwrap_or(false) && !overflow && !timed_out;
        RunResult {
            ok,
            success: ok,
            exit_code: code,
            signal_code: None,
            stdout,
            stderr,
            spawn_error: None,
            timed_out,
            output_overflow: overflow,
        }
    };
    loop {
        {
            let size = stdout_buf.lock().unwrap().len() + stderr_buf.lock().unwrap().len();
            if size > options.max_buffer {
                let _ = child.kill();
                let _ = child.wait();
                return finish(false, true, None);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => return finish(false, false, Some(status)),
            Ok(None) => {
                if start.elapsed() >= Duration::from_millis(options.timeout_ms) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return finish(true, false, None);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                return RunResult {
                    ok: false,
                    success: false,
                    exit_code: None,
                    signal_code: None,
                    stdout: String::new(),
                    stderr: String::new(),
                    spawn_error: Some(error.to_string()),
                    timed_out: false,
                    output_overflow: false,
                };
            }
        }
    }
}

pub fn run_inherit(args: &[String]) -> i32 {
    if args.is_empty() {
        eprintln!("[executor] unable to run : missing command");
        return 1;
    }
    match Command::new(&args[0]).args(&args[1..]).status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("[executor] unable to run {}: {error}", args[0]);
            1
        }
    }
}

fn journal_failures() -> &'static Mutex<std::collections::HashMap<String, u64>> {
    static MAP: OnceLock<Mutex<std::collections::HashMap<String, u64>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub fn journal_log(tag: &str, message: &str, command_path: &str) {
    let mut child = match Command::new(command_path)
        .args(["-t", tag])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            fallback_journal(tag, message, command_path, &error.to_string());
            return;
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(message.as_bytes());
    }
    match child.wait() {
        Ok(status) if status.success() => {}
        Ok(_) | Err(_) => fallback_journal(tag, message, command_path, "journal command failed"),
    }
}

fn fallback_journal(tag: &str, message: &str, command_path: &str, detail: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut map = journal_failures().lock().unwrap();
    let last = map.get(command_path).copied().unwrap_or(0);
    if now.saturating_sub(last) >= JOURNAL_FAILURE_RATE_LIMIT_MS {
        map.insert(command_path.to_string(), now);
        eprintln!("[executor] journal logging unavailable; falling back to supervisor stderr ({detail})");
    }
    eprint!("[{tag}] {message}");
    if !message.ends_with('\n') {
        eprintln!();
    }
}

pub fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn fingerprint(text: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

pub fn split_lines(output: &str) -> Vec<String> {
    output.replace('\r', "").lines().map(str::to_string).collect()
}

impl From<std::io::Error> for CliError {
    fn from(value: std::io::Error) -> Self {
        CliError::new(value.to_string())
    }
}
