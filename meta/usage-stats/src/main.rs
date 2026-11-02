//! usage-stats — count how often each public command is invoked.
//!
//! Sources: fish history, Claude Code transcripts, pi transcripts. Everything is
//! streamed line by line, a cheap substring pre-filter runs before any JSON
//! parsing, and the transcript files are spread over scoped threads.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

const USAGE: &str = "\
usage-stats — count public command invocations in fish, claude and pi histories

usage: usage-stats [--json | --markdown] [--days N] [--home DIR] [--verbose]

  --json        print a JSON array instead of the TSV table
  --markdown    print a GitHub markdown table instead of the TSV table
  --days N      recent window in days (default 30)
  --home DIR    use DIR as $HOME for every source path (for tests)
  --verbose     note unreadable or missing sources on stderr
  -h, --help    show this help

Sources: $HOME/.local/share/fish/fish_history, $HOME/.claude/projects/**/*.jsonl,
$HOME/.pi/agent/sessions/**/*.jsonl. Command names come from
$HOME/.local/share/scripts/meta/cmd-links.json.

Columns: command, fish, claude, pi, total, last<days>d, last_seen.
last_seen is a UTC date (YYYY-MM-DD). Missing sources are skipped silently.";


/// Substring that must appear in a transcript line before it is worth parsing.
const CLAUDE_KEY: &str = "\"Bash\"";
const PI_KEY: &str = "\"toolCall\"";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Source {
    Fish,
    Claude,
    Pi,
}

#[derive(Clone, Copy, Default)]
struct Stat {
    fish: u64,
    claude: u64,
    pi: u64,
    recent: u64,
    last: i64,
}

impl Stat {
    fn total(&self) -> u64 {
        self.fish + self.claude + self.pi
    }
}

struct Row {
    name: String,
    stat: Stat,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Tsv,
    Json,
    Markdown,
}

struct Args {
    format: Format,
    days: u64,
    home: PathBuf,
    verbose: bool,
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(argv) {
        Ok(Some(args)) => args,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("usage-stats: {message}");
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match collect(&args) {
        Ok(rows) => {
            let text = match args.format {
                Format::Tsv => render_tsv(&rows, args.days),
                Format::Json => render_json(&rows, args.days),
                Format::Markdown => render_markdown(&rows, args.days),
            };
            let stdout = std::io::stdout();
            let mut out = stdout.lock();
            if out.write_all(text.as_bytes()).and_then(|()| out.flush()).is_err() {
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("usage-stats: {message}");
            ExitCode::FAILURE
        }
    }
}

fn parse_args(argv: Vec<String>) -> Result<Option<Args>, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let mut args = Args {
        format: Format::Tsv,
        days: 30,
        home,
        verbose: false,
    };
    let mut rest = argv.into_iter();
    while let Some(arg) = rest.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag.to_string(), Some(value.to_string())),
            _ => (arg.clone(), None),
        };
        match flag.as_str() {
            "--json" => set_format(&mut args.format, Format::Json)?,
            "--markdown" => set_format(&mut args.format, Format::Markdown)?,
            "--verbose" => args.verbose = true,
            "--days" => {
                let raw = value(&inline, &mut rest, &flag)?;
                let days: u64 = raw
                    .parse()
                    .map_err(|_| format!("--days needs a positive integer, got {raw:?}"))?;
                if days == 0 {
                    return Err("--days needs a positive integer, got 0".to_string());
                }
                args.days = days;
            }
            "--home" => {
                let dir = value(&inline, &mut rest, &flag)?;
                if dir.is_empty() {
                    return Err("--home needs a directory".to_string());
                }
                args.home = PathBuf::from(dir);
            }
            "-h" | "--help" => return Ok(None),
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Some(args))
}

fn value(
    inline: &Option<String>,
    rest: &mut std::vec::IntoIter<String>,
    flag: &str,
) -> Result<String, String> {
    inline
        .clone()
        .or_else(|| rest.next())
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn set_format(current: &mut Format, wanted: Format) -> Result<(), String> {
    if *current != Format::Tsv && *current != wanted {
        return Err("--json and --markdown are mutually exclusive".to_string());
    }
    *current = wanted;
    Ok(())
}

// ---------------------------------------------------------------- sources ---

fn collect(args: &Args) -> Result<Vec<Row>, String> {
    let names = load_names(&args.home)?;
    let matcher = Matcher::new(&names)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let window = (args.days as i64).saturating_mul(86_400);

    let tasks = build_tasks(&args.home, args.verbose);
    let stats = scan(&tasks, &matcher, now, window, args.verbose);

    let mut rows: Vec<Row> = names
        .into_iter()
        .zip(stats)
        .map(|(name, stat)| Row { name, stat })
        .collect();
    rows.sort_by(|a, b| {
        b.stat
            .total()
            .cmp(&a.stat.total())
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(rows)
}

fn load_names(home: &Path) -> Result<Vec<String>, String> {
    let path = home.join(".local/share/scripts/meta/cmd-links.json");
    let text = std::fs::read_to_string(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let doc: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("cannot parse {}: {error}", path.display()))?;
    let commands = doc
        .get("commands")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("{} has no commands array", path.display()))?;
    let mut names: Vec<String> = commands
        .iter()
        .filter_map(|command| command.get("name").and_then(serde_json::Value::as_str))
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

struct Task {
    source: Source,
    path: PathBuf,
}

fn build_tasks(home: &Path, verbose: bool) -> Vec<Task> {
    let mut tasks = Vec::new();

    let fish = home.join(".local/share/fish/fish_history");
    if fish.is_file() {
        tasks.push(Task {
            source: Source::Fish,
            path: fish,
        });
    } else if verbose {
        eprintln!("usage-stats: skipping missing {}", fish.display());
    }

    for (source, dir) in [
        (Source::Claude, home.join(".claude/projects")),
        (Source::Pi, home.join(".pi/agent/sessions")),
    ] {
        if !dir.is_dir() {
            if verbose {
                eprintln!("usage-stats: skipping missing {}", dir.display());
            }
            continue;
        }
        let mut files = Vec::new();
        collect_jsonl(&dir, &mut files);
        if files.is_empty() && verbose {
            eprintln!("usage-stats: no *.jsonl under {}", dir.display());
        }
        files.sort();
        tasks.extend(files.into_iter().map(|path| Task { source, path }));
    }
    tasks
}

fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_jsonl(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "jsonl") {
            out.push(path);
        }
    }
}

fn scan(tasks: &[Task], matcher: &Matcher, now: i64, window: i64, verbose: bool) -> Vec<Stat> {
    let names = matcher.len();
    let threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .clamp(1, 32)
        .min(tasks.len().max(1));
    let chunk_size = tasks.len().div_ceil(threads).max(1);

    let merged: Vec<Vec<Stat>> = std::thread::scope(|scope| {
        let handles: Vec<_> = tasks
            .chunks(chunk_size)
            .map(|chunk| {
                scope.spawn(move || {
                    let mut stats = vec![Stat::default(); names];
                    let mut scratch = Scratch::new(names);
                    for task in chunk {
                        match task.source {
                            Source::Fish => scratch.fish_history(&task.path, matcher, &mut stats, Window { now, window }, verbose),
                            Source::Claude | Source::Pi => {
                                scratch.jsonl(&task.path, task.source, matcher, &mut stats, Window { now, window }, verbose)
                            }
                        }
                    }
                    stats
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("scan thread panicked"))
            .collect()
    });

    let mut stats = vec![Stat::default(); names];
    for local in merged {
        for (slot, part) in stats.iter_mut().zip(local) {
            slot.fish += part.fish;
            slot.claude += part.claude;
            slot.pi += part.pi;
            slot.recent += part.recent;
            slot.last = slot.last.max(part.last);
        }
    }
    stats
}

/// "Now" and the recent-window length, both in unix seconds.
#[derive(Clone, Copy)]
struct Window {
    now: i64,
    window: i64,
}

/// Per-thread reusable buffers: the line buffer and the per-command hit flags.
struct Scratch {
    line: Vec<u8>,
    flags: Vec<bool>,
}

impl Scratch {
    fn new(names: usize) -> Self {
        Self {
            line: Vec::with_capacity(8192),
            flags: vec![false; names],
        }
    }

    /// Stream a transcript, prefiltering each line before parsing it as JSON.
    fn jsonl(
        &mut self,
        path: &Path,
        source: Source,
        matcher: &Matcher,
        stats: &mut [Stat],
        win: Window,
        verbose: bool,
    ) {
        let key = if source == Source::Claude { CLAUDE_KEY } else { PI_KEY };
        let Some(mut reader) = open(path, verbose) else {
            return;
        };
        loop {
            self.line.clear();
            match reader.read_until(b'\n', &mut self.line) {
                Ok(0) => break,
                Ok(_) => {}
                Err(error) => {
                    if verbose {
                        eprintln!("usage-stats: read error in {}: {error}", path.display());
                    }
                    break;
                }
            }
            if !contains_key(&self.line, key) {
                continue;
            }
            let Ok(text) = std::str::from_utf8(&self.line) else {
                continue;
            };
            let flags = &mut self.flags;
            match source {
                Source::Claude => claude_line(text, flags, matcher, stats, win),
                Source::Pi => pi_line(text, flags, matcher, stats, win),
                Source::Fish => {}
            }
        }
    }

    /// fish history: `- cmd: <text>` lines, each followed by `  when: <unix>`.
    fn fish_history(
        &mut self,
        path: &Path,
        matcher: &Matcher,
        stats: &mut [Stat],
        win: Window,
        verbose: bool,
    ) {
        let Some(mut reader) = open(path, verbose) else {
            return;
        };
        let mut command: Option<String> = None;
        let mut when = 0i64;
        loop {
            self.line.clear();
            match reader.read_until(b'\n', &mut self.line) {
                Ok(0) => break,
                Ok(_) => {}
                Err(error) => {
                    if verbose {
                        eprintln!("usage-stats: read error in {}: {error}", path.display());
                    }
                    break;
                }
            }
            let Ok(line) = std::str::from_utf8(&self.line) else {
                continue;
            };
            let line = line.trim_end_matches(['\n', '\r']);
            if let Some(rest) = line.strip_prefix("- cmd:") {
                if let Some(previous) = command.take() {
                    record(&mut self.flags, matcher, stats, Source::Fish, &previous, when, win);
                }
                command = Some(rest.trim_start().to_string());
                when = 0;
            } else if let Some(rest) = line.strip_prefix("  when:") {
                when = rest.trim().parse().unwrap_or(0);
            }
        }
        if let Some(previous) = command.take() {
            record(&mut self.flags, matcher, stats, Source::Fish, &previous, when, win);
        }
    }
}

fn open(path: &Path, verbose: bool) -> Option<BufReader<File>> {
    match File::open(path) {
        Ok(file) => Some(BufReader::with_capacity(64 * 1024, file)),
        Err(error) => {
            if verbose {
                eprintln!("usage-stats: skipping {}: {error}", path.display());
            }
            None
        }
    }
}

fn claude_line(line: &str, flags: &mut [bool], matcher: &Matcher, stats: &mut [Stat], win: Window) {
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let when = timestamp(&doc);
    let Some(items) = content(&doc) else {
        return;
    };
    for item in items {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
            continue;
        }
        if item.get("name").and_then(serde_json::Value::as_str) != Some("Bash") {
            continue;
        }
        if let Some(command) = item
            .get("input")
            .and_then(|input| input.get("command"))
            .and_then(serde_json::Value::as_str)
        {
            record(flags, matcher, stats, Source::Claude, command, when, win);
        }
    }
}

fn pi_line(line: &str, flags: &mut [bool], matcher: &Matcher, stats: &mut [Stat], win: Window) {
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let when = timestamp(&doc);
    let Some(items) = content(&doc) else {
        return;
    };
    for item in items {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("toolCall") {
            continue;
        }
        if !matches!(
            item.get("name").and_then(serde_json::Value::as_str),
            Some("bash") | Some("Bash")
        ) {
            continue;
        }
        if let Some(command) = item
            .get("arguments")
            .and_then(|arguments| arguments.get("command"))
            .and_then(serde_json::Value::as_str)
        {
            record(flags, matcher, stats, Source::Pi, command, when, win);
        }
    }
}

fn timestamp(doc: &serde_json::Value) -> i64 {
    doc.get("timestamp")
        .and_then(serde_json::Value::as_str)
        .map(parse_iso)
        .unwrap_or(0)
}

fn content(doc: &serde_json::Value) -> Option<&Vec<serde_json::Value>> {
    doc.get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_array)
}

fn record(
    flags: &mut [bool],
    matcher: &Matcher,
    stats: &mut [Stat],
    source: Source,
    command: &str,
    when: i64,
    win: Window,
) {
    matcher.hits(command, flags);
    for (slot, hit) in flags.iter().enumerate() {
        if !hit {
            continue;
        }
        let stat = &mut stats[slot];
        match source {
            Source::Fish => stat.fish += 1,
            Source::Claude => stat.claude += 1,
            Source::Pi => stat.pi += 1,
        }
        if win.now - when < win.window {
            stat.recent += 1;
        }
        if when > stat.last {
            stat.last = when;
        }
    }
}

/// Cheap pre-filter: is the marker substring present in this raw line?
fn contains_key(line: &[u8], key: &str) -> bool {
    let key = key.as_bytes();
    if key.is_empty() || key.len() > line.len() {
        return false;
    }
    let first = key[0];
    let last_start = line.len() - key.len();
    let mut index = 0;
    while index <= last_start {
        match line[index..=last_start].iter().position(|byte| *byte == first) {
            Some(offset) => {
                let at = index + offset;
                if line[at..at + key.len()] == *key {
                    return true;
                }
                index = at + 1;
            }
            None => return false,
        }
    }
    false
}

// --------------------------------------------------------------- rendering --

fn render_tsv(rows: &[Row], days: u64) -> String {
    let mut out = String::new();
    header(&mut out, "\t", days);
    for row in rows {
        let _ = writeln!(
            out,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            row.name,
            row.stat.fish,
            row.stat.claude,
            row.stat.pi,
            row.stat.total(),
            row.stat.recent,
            format_day(row.stat.last),
        );
    }
    out
}

fn render_markdown(rows: &[Row], days: u64) -> String {
    let mut out = String::from("| ");
    header(&mut out, " | ", days);
    out.insert_str(out.len() - 1, " |");
    let _ = writeln!(out, "| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for row in rows {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} |",
            row.name,
            row.stat.fish,
            row.stat.claude,
            row.stat.pi,
            row.stat.total(),
            row.stat.recent,
            format_day(row.stat.last),
        );
    }
    out
}

fn header(out: &mut String, separator: &str, days: u64) {
    let _ = writeln!(
        out,
        "command{separator}fish{separator}claude{separator}pi{separator}total{separator}last{days}d{separator}last_seen"
    );
}

fn render_json(rows: &[Row], days: u64) -> String {
    let mut out = String::from("[\n");
    for (index, row) in rows.iter().enumerate() {
        let _ = write!(
            out,
            "  {{\"name\": {}, \"fish\": {}, \"claude\": {}, \"pi\": {}, \"total\": {}, \"recent\": {}, \"days\": {}, \"last_seen\": {}}}",
            quote(&row.name),
            row.stat.fish,
            row.stat.claude,
            row.stat.pi,
            row.stat.total(),
            row.stat.recent,
            days,
            quote(&format_day(row.stat.last)),
        );
        out.push_str(if index + 1 == rows.len() { "\n" } else { ",\n" });
    }
    out.push_str("]\n");
    out
}

fn quote(value: &str) -> String {
    serde_json::Value::String(value.to_string()).to_string()
}

fn format_day(unix: i64) -> String {
    if unix <= 0 {
        return "-".to_string();
    }
    let (year, month, day) = civil_from_days(unix.div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

// ---------------------------------------------------------------- matching --

/// One combined regex over every command name; the command-position context is
/// checked on the bytes around each match (Rust's regex has no lookahead).
struct Matcher {
    re: regex::Regex,
    index: HashMap<String, usize>,
}

impl Matcher {
    fn new(names: &[String]) -> Result<Self, String> {
        let mut ordered: Vec<&String> = names.iter().collect();
        ordered.sort_by_key(|name| std::cmp::Reverse(name.len()));
        let alternatives: Vec<String> = ordered.iter().map(|name| escape_name(name)).collect();
        let re = regex::Regex::new(&alternatives.join("|"))
            .map_err(|error| format!("cannot build name matcher: {error}"))?;
        let index = names
            .iter()
            .enumerate()
            .map(|(slot, name)| (name.clone(), slot))
            .collect();
        Ok(Self { re, index })
    }

    fn len(&self) -> usize {
        self.index.len()
    }


    /// Mark every command name that appears at command position in `command`.
    /// Each name is marked at most once, however often it occurs.
    fn hits(&self, command: &str, flags: &mut [bool]) {
        flags.fill(false);
        let bytes = command.as_bytes();
        let mut pos = 0;
        while pos <= command.len() {
            let Some(found) = self.re.find_at(command, pos) else {
                break;
            };
            let end = found.end();
            let trailing_ok = bytes
                .get(end)
                .is_none_or(|byte| byte.is_ascii_whitespace() || *byte == b')');
            if trailing_ok && at_command_position(bytes, found.start()) {
                if let Some(slot) = self.index.get(found.as_str()) {
                    flags[*slot] = true;
                }
                pos = end.max(found.start() + 1);
            } else {
                let mut next = found.start() + 1;
                while next < command.len() && !command.is_char_boundary(next) {
                    next += 1;
                }
                pos = next;
            }
        }
    }
}

fn escape_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    for ch in name.chars() {
        if !ch.is_ascii_alphanumeric() {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Python semantics of `(?:^|[|;&(\n]\s*|sudo\s+|\$\(\s*|exec\s+)` without lookaround.
fn at_command_position(bytes: &[u8], start: usize) -> bool {
    if start == 0 {
        return true;
    }
    let mut index = start;
    while index > 0 && bytes[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    if index > 0 && matches!(bytes[index - 1], b'|' | b';' | b'&' | b'(' | b'\n') {
        return true;
    }
    // A newline inside the whitespace run is a separator too: `[|;&(\n]\s*` allows
    // any whitespace after it, the newline included.
    if bytes[index..start].contains(&b'\n') {
        return true;
    }
    if index < start {
        let before = &bytes[..index];
        if before.ends_with(b"sudo") || before.ends_with(b"exec") {
            return true;
        }
    }
    index >= 2 && &bytes[index - 2..index] == b"$("
}

// ------------------------------------------------------------------- time ---

/// Parse an ISO 8601 timestamp to unix seconds; 0 when it cannot be parsed.
fn parse_iso(text: &str) -> i64 {
    let bytes = text.as_bytes();
    let mut cursor = 0;
    let (Some(year), Some(month), Some(day)) = (
        take_digits(bytes, &mut cursor, 4, b'-'),
        take_digits(bytes, &mut cursor, 2, b'-'),
        take_digits(bytes, &mut cursor, 2, b'T'),
    ) else {
        return 0;
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return 0;
    }
    let mut hour = 0;
    let mut minute = 0;
    let mut second = 0;
    if cursor < bytes.len() {
        let (Some(h), Some(m), Some(s)) = (
            take_digits(bytes, &mut cursor, 2, b':'),
            take_digits(bytes, &mut cursor, 2, b':'),
            take_digits(bytes, &mut cursor, 2, 0),
        ) else {
            return 0;
        };
        if h > 23 || m > 59 || s > 60 {
            return 0;
        }
        hour = h;
        minute = m;
        second = s;
    }
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
    }
    let offset = match bytes.get(cursor) {
        None => 0,
        Some(b'Z') | Some(b'z') => {
            cursor += 1;
            0
        }
        Some(b'+') | Some(b'-') => {
            let sign = if bytes[cursor] == b'-' { -1 } else { 1 };
            cursor += 1;
            let Some(oh) = take_digits_raw(bytes, &mut cursor, 2) else {
                return 0;
            };
            if bytes.get(cursor) == Some(&b':') {
                cursor += 1;
            }
            let om = take_digits_raw(bytes, &mut cursor, 2).unwrap_or(0);
            if oh > 23 || om > 59 {
                return 0;
            }
            sign * (oh * 3600 + om * 60)
        }
        Some(_) => return 0,
    };
    if cursor != bytes.len() {
        return 0;
    }
    let days = days_from_civil(year, month, day);
    days * 86_400 + hour * 3600 + minute * 60 + second - offset
}

/// Read exactly `count` ASCII digits at `cursor`, then require and consume a
/// single `separator` byte. `separator == 0` means "no separator".
fn take_digits(bytes: &[u8], cursor: &mut usize, count: usize, separator: u8) -> Option<i64> {
    let start = *cursor;
    let digits = take_digits_raw(bytes, cursor, count)?;
    if separator != 0 {
        if bytes.get(*cursor) != Some(&separator) {
            *cursor = start;
            return None;
        }
        *cursor += 1;
    }
    Some(digits)
}

fn take_digits_raw(bytes: &[u8], cursor: &mut usize, count: usize) -> Option<i64> {
    let start = *cursor;
    if start + count > bytes.len() {
        return None;
    }
    let mut value = 0i64;
    for byte in &bytes[start..start + count] {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(byte - b'0');
    }
    *cursor = start + count;
    Some(value)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

// ------------------------------------------------------------------ tests ---

#[cfg(test)]
mod tests {
    use super::*;

    const NAMES: [&str; 5] = ["browser", "cli", "phone", "port", "ship"];

    fn matcher() -> (Matcher, Vec<String>) {
        let names: Vec<String> = NAMES.iter().map(|name| name.to_string()).collect();
        (Matcher::new(&names).expect("matcher"), names)
    }

    fn hit_names(command: &str) -> Vec<String> {
        let (matcher, names) = matcher();
        let mut flags = vec![false; names.len()];
        matcher.hits(command, &mut flags);
        names
            .into_iter()
            .zip(flags)
            .filter_map(|(name, hit)| hit.then_some(name))
            .collect()
    }

    #[test]
    fn matcher_hits_command_position() {
        for command in ["cli install x", "cd a && ship -m x", "sudo port kill", "$(phone screen)"] {
            assert!(!hit_names(command).is_empty(), "expected a hit in {command:?}");
        }
        assert_eq!(hit_names("cli install x"), ["cli"]);
        assert_eq!(hit_names("cd a && ship -m x"), ["ship"]);
        assert_eq!(hit_names("sudo port kill"), ["port"]);
        assert_eq!(hit_names("$(phone screen)"), ["phone"]);
    }

    #[test]
    fn matcher_skips_non_command_occurrences() {
        for command in ["cat cli.md", "git/ship.ts", "docs port", "browserx"] {
            assert!(hit_names(command).is_empty(), "unexpected hit in {command:?}");
        }
    }

    #[test]
    fn matcher_counts_each_name_once() {
        assert_eq!(hit_names("cli && cli | cli"), ["cli"]);
        assert_eq!(hit_names("cli && ship"), ["cli", "ship"]);
        assert_eq!(hit_names("(port)"), ["port"]);
        assert_eq!(hit_names("x; exec ship"), ["ship"]);
        assert_eq!(hit_names("echo cli && cli install"), ["cli"]);
    }

    #[test]
    fn iso_parser_matches_known_instants() {
        // 2025-01-01T00:00:00Z
        assert_eq!(parse_iso("2025-01-01T00:00:00Z"), 1_735_689_600);
        assert_eq!(parse_iso("2025-01-01T09:00:00+09:00"), 1_735_689_600);
        assert_eq!(parse_iso("2025-01-01T09:00:00+0900"), 1_735_689_600);
        assert_eq!(parse_iso("2024-12-31T19:00:00-05:00"), 1_735_689_600);
        assert_eq!(parse_iso("2025-01-01T00:00:00.123Z"), 1_735_689_600);
        assert_eq!(parse_iso("2025-01-01T00:00:00"), 1_735_689_600);
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), 0);
        assert_eq!(parse_iso("2025-10-30T12:34:56Z"), 1_761_827_696);
    }

    #[test]
    fn iso_parser_rejects_garbage() {
        assert_eq!(parse_iso(""), 0);
        assert_eq!(parse_iso("not a timestamp"), 0);
        assert_eq!(parse_iso("2025-13-01T00:00:00Z"), 0);
        assert_eq!(parse_iso("2025-01-01T25:00:00Z"), 0);
        assert_eq!(parse_iso("2025-01-01T00:00:00Z junk"), 0);
    }

    #[test]
    fn format_day_is_utc() {
        assert_eq!(format_day(1_735_689_600), "2025-01-01");
        assert_eq!(format_day(0), "-");
        assert_eq!(format_day(1_761_827_696), "2025-10-30");
    }

    fn temp_home(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("usage-stats-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp home");
        dir
    }

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent dir");
        }
        std::fs::write(path, body).expect("write fixture");
    }

    #[test]
    fn collects_from_fish_claude_and_pi() {
        let home = temp_home("collect");
        let recent = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or(0)
            - 3_600;

        write(
            &home.join(".local/share/scripts/meta/cmd-links.json"),
            r#"{"commands":[{"name":"cli"},{"name":"ship"},{"name":"port"},{"name":"phone"},{"name":"browser"}]}"#,
        );
        write(
            &home.join(".local/share/fish/fish_history"),
            &format!(
                "- cmd: cli install x\n  when: {recent}\n- cmd: cat cli.md\n  when: {recent}\n- cmd: sudo port kill\n  when: 1700000200\n"
            ),
        );
        write(
            &home.join(".claude/projects/project-a/session.jsonl"),
            concat!(
                "{\"timestamp\":\"2025-01-01T00:00:00Z\",\"message\":{\"content\":[",
                "{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"cd a && ship -m x\"}}]}}\n",
                "{\"timestamp\":\"2025-01-01T00:00:00Z\",\"message\":{\"content\":[",
                "{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"git/ship.ts\"}}]}}\n",
                "{\"timestamp\":\"2025-01-01T00:00:00Z\",\"message\":{\"content\":[",
                "{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"command\":\"cli install x\"}}]}}\n",
            ),
        );
        write(
            &home.join(".pi/agent/sessions/session.jsonl"),
            concat!(
                "{\"timestamp\":\"2025-01-02T00:00:00Z\",\"message\":{\"content\":[",
                "{\"type\":\"toolCall\",\"name\":\"bash\",\"arguments\":{\"command\":\"$(phone screen)\"}}]}}\n",
                "{\"timestamp\":\"2025-01-02T00:00:00Z\",\"message\":{\"content\":[",
                "{\"type\":\"toolCall\",\"name\":\"read\",\"arguments\":{\"command\":\"ship -m y\"}}]}}\n",
            ),
        );

        let args = Args {
            format: Format::Tsv,
            days: 30,
            home: home.clone(),
            verbose: false,
        };
        let rows = collect(&args).expect("collect");
        let stat = |name: &str| {
            let row = rows.iter().find(|row| row.name == name).expect("row");
            row.stat
        };

        assert_eq!((stat("cli").fish, stat("cli").claude, stat("cli").pi), (1, 0, 0));
        assert_eq!(stat("cli").recent, 1);
        assert_eq!((stat("port").fish, stat("port").recent), (1, 0));
        assert_eq!((stat("ship").fish, stat("ship").claude, stat("ship").pi), (0, 1, 0));
        assert_eq!((stat("phone").fish, stat("phone").pi), (0, 1));
        assert_eq!(stat("browser").total(), 0);
        assert_eq!(stat("ship").last, 1_735_689_600);
        assert_eq!(stat("cli").last, recent);
        assert_eq!(rows[0].name, "cli");
        assert!(render_tsv(&rows, 30).starts_with("command\tfish\tclaude\tpi\ttotal\tlast30d\tlast_seen\n"));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn prefilter_finds_markers() {
        assert!(contains_key(br#"{"a":"Bash"}"#, CLAUDE_KEY));
        assert!(!contains_key(br#"{"a":"bash"}"#, CLAUDE_KEY));
        assert!(contains_key(br#"{"type":"toolCall"}"#, PI_KEY));
        assert!(!contains_key(br#"{"type":"toolcall"}"#, PI_KEY));
        assert!(!contains_key(b"", CLAUDE_KEY));
    }
}
