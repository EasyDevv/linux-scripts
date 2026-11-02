use std::io::{self, IsTerminal, Write};
use std::mem;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{bail, Context, Result};

use crate::color::{self, paint, BOLD, DIM, GREEN, YELLOW};

const FOOTER: &str = "↑/↓ move  enter select  q abort";

static WINCH: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    pub label: String,
    pub color: &'static str,
    /// 라벨 뒤에 흐리게 붙이는 부가 정보(설치 버전 등).
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub title: String,
    pub color: &'static str,
    pub choices: Vec<Choice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectAction {
    Up,
    Down,
    First,
    Last,
    Accept,
    Abort,
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Char(char),
    Esc,
    Csi(char),
    Ss3(char),
    Tilde(u16),
}

pub fn select_one(title: &str, sections: &[Section]) -> Result<Option<usize>> {
    let total: usize = sections.iter().map(|section| section.choices.len()).sum();
    if total == 0 {
        bail!("select list is empty");
    }
    if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
        bail!("arrow selection requires an interactive terminal");
    }

    let guard = enter_raw().context("enable raw mode")?;
    let _guard = guard;
    let mut stderr = io::stderr();
    let _ = write!(stderr, "\x1b[?25l");
    let _ = stderr.flush();

    let mut current = 0usize;
    let mut drawn = 0usize;
    let mut pending = Vec::new();
    loop {
        let lines = render_lines(title, sections, current, color::stderr_enabled());
        drawn = redraw(&mut stderr, &lines, drawn)?;
        match read_tokens(&mut pending)? {
            Read::Eof => return Ok(None),
            Read::Resize => {}
            Read::Tokens(tokens) => {
                for action in tokens.into_iter().map(classify_token) {
                    match action {
                        SelectAction::Up => current = current.saturating_sub(1),
                        SelectAction::Down => current = (current + 1).min(total - 1),
                        SelectAction::First => current = 0,
                        SelectAction::Last => current = total - 1,
                        SelectAction::Accept => return Ok(Some(current)),
                        SelectAction::Abort => return Ok(None),
                        SelectAction::Ignore => {}
                    }
                }
            }
        }
    }
}

pub fn split_read(input: &[u8]) -> (Vec<Token>, usize) {
    let mut index = 0;
    let mut tokens = Vec::new();
    while index < input.len() {
        if input[index] == 0x1b {
            match parse_escape(&input[index..]) {
                EscapeParse::NeedMore => break,
                EscapeParse::Token(token, width) => {
                    tokens.push(token);
                    index += width;
                }
            }
        } else {
            let (token, width) = next_char(&input[index..]);
            tokens.push(token);
            index += width;
        }
    }
    (tokens, index)
}

pub fn classify_token(token: Token) -> SelectAction {
    match token {
        Token::Char('\u{3}') | Token::Char('q') | Token::Esc => SelectAction::Abort,
        Token::Char('j') | Token::Csi('B') | Token::Ss3('B') => SelectAction::Down,
        Token::Char('k') | Token::Csi('A') | Token::Ss3('A') => SelectAction::Up,
        Token::Char('g') | Token::Csi('H') | Token::Ss3('H') => SelectAction::First,
        Token::Char('G') | Token::Csi('F') | Token::Ss3('F') => SelectAction::Last,
        Token::Char('\r') | Token::Char('\n') => SelectAction::Accept,
        Token::Tilde(1 | 7) => SelectAction::First,
        Token::Tilde(4 | 8) => SelectAction::Last,
        _ => SelectAction::Ignore,
    }
}

enum EscapeParse {
    NeedMore,
    Token(Token, usize),
}

fn parse_escape(input: &[u8]) -> EscapeParse {
    if input.len() < 2 {
        return EscapeParse::NeedMore;
    }
    match input[1] {
        b'[' => parse_csi(input),
        b'O' => {
            if input.len() < 3 {
                return EscapeParse::NeedMore;
            }
            EscapeParse::Token(Token::Ss3(input[2] as char), 3)
        }
        _ => EscapeParse::Token(Token::Esc, 1),
    }
}

fn parse_csi(input: &[u8]) -> EscapeParse {
    let mut end = 2;
    while end < input.len() && end < 32 {
        let byte = input[end];
        if (0x40..=0x7e).contains(&byte) {
            let params = &input[2..end];
            let token = if byte == b'~' {
                Token::Tilde(first_param(params))
            } else {
                Token::Csi(byte as char)
            };
            return EscapeParse::Token(token, end + 1);
        }
        end += 1;
    }
    if input.len() >= 32 {
        return EscapeParse::Token(Token::Esc, 1);
    }
    EscapeParse::NeedMore
}

fn first_param(params: &[u8]) -> u16 {
    let text = std::str::from_utf8(params).unwrap_or("");
    text.split([';', ':'])
        .next()
        .unwrap_or("")
        .parse()
        .unwrap_or(0)
}

fn next_char(input: &[u8]) -> (Token, usize) {
    let width = utf8_width(input[0]).min(input.len()).max(1);
    let text = std::str::from_utf8(&input[..width]).unwrap_or("");
    let ch = text.chars().next().unwrap_or('\u{fffd}');
    (Token::Char(ch), width)
}

fn utf8_width(lead: u8) -> usize {
    if lead < 0x80 {
        1
    } else if lead < 0xe0 {
        2
    } else if lead < 0xf0 {
        3
    } else {
        4
    }
}

fn render_lines(title: &str, sections: &[Section], current: usize, enabled: bool) -> Vec<String> {
    let mut lines = vec![paint(title, &[BOLD], enabled), String::new()];
    let mut index = 0usize;
    for (section_index, section) in sections.iter().enumerate() {
        if section_index > 0 {
            lines.push(String::new());
        }
        lines.push(paint(&section.title, &[BOLD, section.color], enabled));
        for choice in &section.choices {
            let selected = index == current;
            let marker = if selected { ">" } else { " " };
            let styles: Vec<&str> = if selected {
                vec![BOLD, choice.color]
            } else {
                vec![choice.color]
            };
            lines.push(format!(
                "  {} {}{}",
                paint(marker, &styles, enabled),
                paint(&choice.label, &styles, enabled),
                note_suffix(&choice.note, enabled)
            ));
            index += 1;
        }
    }
    lines.push(paint(FOOTER, &[DIM], enabled));
    lines
}

fn note_suffix(note: &str, enabled: bool) -> String {
    if note.is_empty() {
        String::new()
    } else {
        format!("  {}", paint(note, &[DIM], enabled))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MultiAction {
    Up,
    Down,
    First,
    Last,
    Toggle,
    SelectAll,
    SelectNone,
    /// 선택 항목에 바로 적용하는 작업 키(`i` 설치, `x` 삭제, `u` 업데이트, `c` 업데이트 확인).
    Do(char),
    /// Enter: 작업 메뉴.
    Menu,
    Abort,
    Ignore,
}

pub fn classify_multi(token: Token) -> MultiAction {
    match token {
        Token::Char(' ') => MultiAction::Toggle,
        Token::Char('a') => MultiAction::SelectAll,
        Token::Char('n') => MultiAction::SelectNone,
        Token::Char('i') => MultiAction::Do('i'),
        Token::Char('x') | Token::Char('d') | Token::Tilde(3) => MultiAction::Do('x'),
        Token::Char('u') => MultiAction::Do('u'),
        Token::Char('c') => MultiAction::Do('c'),
        Token::Char('\r') | Token::Char('\n') => MultiAction::Menu,
        Token::Char('\u{3}') | Token::Char('q') | Token::Esc => MultiAction::Abort,
        other => match classify_token(other) {
            SelectAction::Up => MultiAction::Up,
            SelectAction::Down => MultiAction::Down,
            SelectAction::First => MultiAction::First,
            SelectAction::Last => MultiAction::Last,
            _ => MultiAction::Ignore,
        },
    }
}

/// 다중 선택 결과. `key` 는 `i` `x` `u` `c` 중 하나이거나, 작업 메뉴를 요청한 Enter(`\r`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiOutcome {
    pub selected: Vec<usize>,
    pub key: char,
}

const MULTI_HINT_MOVE: &str = "↑/↓ j/k 이동  space 선택  a 전체선택  n 전체해제  g/G 처음/끝";
const MULTI_HINT_ACT: &str = "i 설치  x 삭제  u 업데이트  c 업데이트 확인  enter 작업 메뉴  q 취소";

/// 체크박스 목록. 처음에는 아무것도 선택되지 않는다.
pub fn select_many(title: &str, sections: &[Section]) -> Result<Option<MultiOutcome>> {
    let total: usize = sections.iter().map(|section| section.choices.len()).sum();
    if total == 0 {
        bail!("select list is empty");
    }
    if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
        bail!("checkbox selection requires an interactive terminal");
    }

    let guard = enter_raw().context("enable raw mode")?;
    let _guard = guard;
    let mut stderr = io::stderr();
    let _ = write!(stderr, "\x1b[?25l");
    let _ = stderr.flush();

    let mut state = MultiState::new(total);
    let mut drawn = 0usize;
    let mut pending = Vec::new();
    loop {
        let lines = render_multi(title, sections, &state, color::stderr_enabled());
        drawn = redraw(&mut stderr, &lines, drawn)?;
        match read_tokens(&mut pending)? {
            Read::Eof => return Ok(None),
            Read::Resize => {}
            Read::Tokens(tokens) => {
                for token in tokens {
                    if let Some(result) = state.apply(classify_multi(token)) {
                        return Ok(result);
                    }
                }
            }
        }
    }
}

/// 화면과 무관한 선택 상태. 터미널 없이 시험할 수 있다.
pub struct MultiState {
    pub current: usize,
    pub checked: Vec<bool>,
    pub message: String,
}

impl MultiState {
    pub fn new(total: usize) -> Self {
        MultiState {
            current: 0,
            checked: vec![false; total],
            message: String::new(),
        }
    }

    pub fn selected(&self) -> Vec<usize> {
        self.checked
            .iter()
            .enumerate()
            .filter_map(|(index, on)| on.then_some(index))
            .collect()
    }

    /// 종료해야 하면 `Some(결과)`(취소는 `Some(None)`), 계속이면 `None`.
    pub fn apply(&mut self, action: MultiAction) -> Option<Option<MultiOutcome>> {
        let total = self.checked.len();
        if action != MultiAction::Ignore {
            self.message.clear();
        }
        match action {
            MultiAction::Up => self.current = self.current.saturating_sub(1),
            MultiAction::Down => self.current = (self.current + 1).min(total - 1),
            MultiAction::First => self.current = 0,
            MultiAction::Last => self.current = total - 1,
            MultiAction::Toggle => self.checked[self.current] = !self.checked[self.current],
            MultiAction::SelectAll => self.checked.iter_mut().for_each(|on| *on = true),
            MultiAction::SelectNone => self.checked.iter_mut().for_each(|on| *on = false),
            MultiAction::Do(key) => return self.finish(key),
            MultiAction::Menu => return self.finish('\r'),
            MultiAction::Abort => return Some(None),
            MultiAction::Ignore => {}
        }
        None
    }

    fn finish(&mut self, key: char) -> Option<Option<MultiOutcome>> {
        let selected = self.selected();
        if selected.is_empty() {
            self.message = "선택된 항목이 없습니다 — space 로 선택하세요".into();
            return None;
        }
        Some(Some(MultiOutcome { selected, key }))
    }
}

fn render_multi(title: &str, sections: &[Section], state: &MultiState, enabled: bool) -> Vec<String> {
    let total = state.checked.len();
    let count = state.checked.iter().filter(|on| **on).count();
    let mut lines = vec![
        format!(
            "{}  {}",
            paint(title, &[BOLD], enabled),
            paint(&format!("선택 {count}/{total}"), &[DIM], enabled)
        ),
        String::new(),
    ];
    let mut index = 0usize;
    for (section_index, section) in sections.iter().enumerate() {
        if section_index > 0 {
            lines.push(String::new());
        }
        lines.push(paint(&section.title, &[BOLD, section.color], enabled));
        for choice in &section.choices {
            let here = index == state.current;
            let marker = if here { ">" } else { " " };
            let mut styles: Vec<&str> = vec![choice.color];
            if here {
                styles.insert(0, BOLD);
            }
            let (mark, mark_styles): (&str, Vec<&str>) = if state.checked[index] {
                ("[x]", vec![BOLD, GREEN])
            } else {
                ("[ ]", vec![DIM])
            };
            lines.push(format!(
                "  {} {} {}{}",
                paint(marker, &styles, enabled),
                paint(mark, &mark_styles, enabled),
                paint(&choice.label, &styles, enabled),
                note_suffix(&choice.note, enabled)
            ));
            index += 1;
        }
    }
    lines.push(String::new());
    if !state.message.is_empty() {
        lines.push(paint(&state.message, &[YELLOW], enabled));
    }
    lines.push(paint(MULTI_HINT_MOVE, &[DIM], enabled));
    lines.push(paint(MULTI_HINT_ACT, &[DIM], enabled));
    lines
}

fn redraw(stderr: &mut io::Stderr, lines: &[String], previous: usize) -> Result<usize> {
    if previous > 1 {
        write!(stderr, "\x1b[{}A", previous - 1)?;
    }
    let total = previous.max(lines.len());
    for index in 0..total {
        write!(stderr, "\r\x1b[2K")?;
        if index < lines.len() {
            write!(stderr, "{}", lines[index])?;
        }
        if index + 1 < total {
            write!(stderr, "\r\n")?;
        }
    }
    stderr.flush()?;
    Ok(lines.len())
}

enum Read {
    Tokens(Vec<Token>),
    Resize,
    Eof,
}

fn read_tokens(pending: &mut Vec<u8>) -> Result<Read> {
    if WINCH.swap(false, Ordering::SeqCst) {
        return Ok(Read::Resize);
    }
    let timeout = if pending.is_empty() { 200 } else { 50 };
    match poll_stdin(timeout)? {
        Poll::Eof => return Ok(Read::Eof),
        Poll::Timeout => {
            if WINCH.swap(false, Ordering::SeqCst) {
                return Ok(Read::Resize);
            }
            if pending.is_empty() {
                return Ok(Read::Tokens(Vec::new()));
            }
            return Ok(Read::Tokens(flush_pending(pending)));
        }
        Poll::Ready => {}
    }
    let mut buf = [0u8; 64];
    match read_stdin(&mut buf)? {
        None => Ok(Read::Tokens(Vec::new())),
        Some(0) => Ok(Read::Eof),
        Some(n) => {
            pending.extend_from_slice(&buf[..n]);
            let (tokens, consumed) = split_read(pending);
            pending.drain(..consumed);
            Ok(Read::Tokens(tokens))
        }
    }
}

fn flush_pending(pending: &mut Vec<u8>) -> Vec<Token> {
    let lone_escape = pending.as_slice() == b"\x1b";
    pending.clear();
    if lone_escape {
        vec![Token::Esc]
    } else {
        Vec::new()
    }
}

enum Poll {
    Ready,
    Timeout,
    Eof,
}

fn poll_stdin(timeout_ms: i32) -> Result<Poll> {
    let mut fd = libc::pollfd {
        fd: 0,
        events: libc::POLLIN,
        revents: 0,
    };
    let rc = unsafe { libc::poll(&mut fd, 1, timeout_ms) };
    if rc < 0 {
        let err = io::Error::last_os_error();
        if err.kind() == io::ErrorKind::Interrupted {
            return Ok(Poll::Timeout);
        }
        return Err(err).context("poll stdin");
    }
    if rc == 0 {
        return Ok(Poll::Timeout);
    }
    if fd.revents & libc::POLLIN != 0 {
        return Ok(Poll::Ready);
    }
    if fd.revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Ok(Poll::Eof);
    }
    Ok(Poll::Timeout)
}

fn read_stdin(buf: &mut [u8]) -> Result<Option<usize>> {
    let n = unsafe { libc::read(0, buf.as_mut_ptr().cast(), buf.len()) };
    if n < 0 {
        let err = io::Error::last_os_error();
        if err.kind() == io::ErrorKind::Interrupted {
            return Ok(None);
        }
        return Err(err).context("read stdin");
    }
    Ok(Some(n as usize))
}

struct RawGuard {
    original: libc::termios,
    saved: libc::sigaction,
}

impl Drop for RawGuard {
    fn drop(&mut self) {
        let mut stderr = io::stderr();
        let _ = write!(stderr, "\x1b[?25h");
        let _ = stderr.flush();
        restore_termios(&self.original);
        unsafe {
            libc::sigaction(libc::SIGWINCH, &self.saved, std::ptr::null_mut());
        }
        let _ = writeln!(stderr);
    }
}

fn enter_raw() -> Result<RawGuard> {
    let mut term: libc::termios = unsafe { mem::zeroed() };
    if unsafe { libc::tcgetattr(0, &mut term) } != 0 {
        bail!("tcgetattr: {}", io::Error::last_os_error());
    }
    let original = term;
    unsafe { libc::cfmakeraw(&mut term) };
    if unsafe { libc::tcsetattr(0, libc::TCSANOW, &term) } != 0 {
        bail!("tcsetattr: {}", io::Error::last_os_error());
    }
    match install_winch() {
        Ok(saved) => Ok(RawGuard { original, saved }),
        Err(error) => {
            restore_termios(&original);
            Err(error)
        }
    }
}

fn restore_termios(original: &libc::termios) {
    unsafe {
        libc::tcsetattr(0, libc::TCSANOW, original);
    }
}

fn install_winch() -> Result<libc::sigaction> {
    WINCH.store(false, Ordering::SeqCst);
    let mut saved: libc::sigaction = unsafe { mem::zeroed() };
    let mut action: libc::sigaction = unsafe { mem::zeroed() };
    action.sa_sigaction = winch_handler as usize;
    unsafe {
        libc::sigemptyset(&mut action.sa_mask);
        if libc::sigaction(libc::SIGWINCH, &action, &mut saved) != 0 {
            bail!("sigaction: {}", io::Error::last_os_error());
        }
    }
    Ok(saved)
}

extern "C" fn winch_handler(_signal: i32) {
    WINCH.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_combined_reads_before_classifying() {
        let (tokens, consumed) = split_read(b"j\r");
        assert_eq!(consumed, 2);
        assert_eq!(tokens, vec![Token::Char('j'), Token::Char('\r')]);
        assert_eq!(classify_token(tokens[0].clone()), SelectAction::Down);
        assert_eq!(classify_token(tokens[1].clone()), SelectAction::Accept);

        let combined = b"\x1b[B\x1b[A\r";
        let (tokens, consumed) = split_read(combined);
        assert_eq!(consumed, combined.len());
        assert_eq!(
            tokens,
            vec![Token::Csi('B'), Token::Csi('A'), Token::Char('\r')]
        );
        assert_eq!(
            tokens.into_iter().map(classify_token).collect::<Vec<_>>(),
            vec![SelectAction::Down, SelectAction::Up, SelectAction::Accept]
        );
    }

    #[test]
    fn leaves_incomplete_escape_for_the_next_read() {
        let (tokens, consumed) = split_read(b"j\x1b");
        assert_eq!(tokens, vec![Token::Char('j')]);
        assert_eq!(consumed, 1);
        let (tokens, consumed) = split_read(b"\x1b[");
        assert!(tokens.is_empty());
        assert_eq!(consumed, 0);
        let (tokens, consumed) = split_read(b"\x1b[1~");
        assert_eq!(consumed, 4);
        assert_eq!(tokens, vec![Token::Tilde(1)]);
        assert_eq!(classify_token(Token::Tilde(1)), SelectAction::First);
    }

    #[test]
    fn maps_cancel_and_vim_keys() {
        assert_eq!(classify_token(Token::Char('q')), SelectAction::Abort);
        assert_eq!(classify_token(Token::Char('\u{3}')), SelectAction::Abort);
        assert_eq!(classify_token(Token::Esc), SelectAction::Abort);
        assert_eq!(classify_token(Token::Char('k')), SelectAction::Up);
        assert_eq!(classify_token(Token::Char('g')), SelectAction::First);
        assert_eq!(classify_token(Token::Char('G')), SelectAction::Last);
        assert_eq!(classify_token(Token::Ss3('H')), SelectAction::First);
        assert_eq!(classify_token(Token::Csi('F')), SelectAction::Last);
    }

    #[test]
    fn multi_keys_map_to_toggle_all_none_and_actions() {
        assert_eq!(classify_multi(Token::Char(' ')), MultiAction::Toggle);
        assert_eq!(classify_multi(Token::Char('a')), MultiAction::SelectAll);
        assert_eq!(classify_multi(Token::Char('n')), MultiAction::SelectNone);
        assert_eq!(classify_multi(Token::Char('i')), MultiAction::Do('i'));
        assert_eq!(classify_multi(Token::Char('d')), MultiAction::Do('x'));
        assert_eq!(classify_multi(Token::Char('x')), MultiAction::Do('x'));
        assert_eq!(classify_multi(Token::Char('u')), MultiAction::Do('u'));
        assert_eq!(classify_multi(Token::Char('c')), MultiAction::Do('c'));
        assert_eq!(classify_multi(Token::Char('\r')), MultiAction::Menu);
        assert_eq!(classify_multi(Token::Csi('B')), MultiAction::Down);
        assert_eq!(classify_multi(Token::Char('k')), MultiAction::Up);
        assert_eq!(classify_multi(Token::Char('q')), MultiAction::Abort);
        assert_eq!(classify_multi(Token::Char('z')), MultiAction::Ignore);
    }

    #[test]
    fn nothing_is_selected_at_first_and_actions_need_a_selection() {
        let mut state = MultiState::new(3);
        assert!(state.selected().is_empty());
        assert_eq!(state.apply(MultiAction::Do('i')), None);
        assert!(state.message.contains("선택된 항목이 없습니다"));
        assert_eq!(state.apply(MultiAction::Menu), None);
        state.apply(MultiAction::Down);
        assert!(state.message.is_empty());
    }

    #[test]
    fn toggle_all_none_and_move_work_together() {
        let mut state = MultiState::new(3);
        state.apply(MultiAction::Toggle);
        state.apply(MultiAction::Down);
        state.apply(MultiAction::Down);
        state.apply(MultiAction::Down);
        assert_eq!(state.current, 2);
        state.apply(MultiAction::Toggle);
        assert_eq!(state.selected(), vec![0, 2]);
        state.apply(MultiAction::Toggle);
        assert_eq!(state.selected(), vec![0]);
        state.apply(MultiAction::SelectAll);
        assert_eq!(state.selected(), vec![0, 1, 2]);
        state.apply(MultiAction::SelectNone);
        assert!(state.selected().is_empty());
        state.apply(MultiAction::First);
        state.apply(MultiAction::Up);
        assert_eq!(state.current, 0);
        state.apply(MultiAction::Last);
        assert_eq!(state.current, 2);
    }

    #[test]
    fn action_keys_return_the_selection_and_abort_returns_none() {
        let mut state = MultiState::new(3);
        state.apply(MultiAction::Toggle);
        state.apply(MultiAction::Last);
        state.apply(MultiAction::Toggle);
        let done = state.apply(MultiAction::Do('u')).unwrap().unwrap();
        assert_eq!(done, MultiOutcome { selected: vec![0, 2], key: 'u' });
        let menu = state.apply(MultiAction::Menu).unwrap().unwrap();
        assert_eq!(menu.key, '\r');
        assert_eq!(state.apply(MultiAction::Abort), Some(None));
    }

    #[test]
    fn multi_render_shows_checkboxes_counts_and_footer() {
        let sections = vec![Section {
            title: "cloud (2)".into(),
            color: GREEN,
            choices: vec![
                Choice { label: "aws".into(), color: GREEN, note: "미설치".into() },
                Choice { label: "cf".into(), color: GREEN, note: String::new() },
            ],
        }];
        let mut state = MultiState::new(2);
        state.apply(MultiAction::Toggle);
        let text = render_multi("도구", &sections, &state, false).join("\n");
        assert!(text.contains("선택 1/2"), "{text}");
        assert!(text.contains("> [x] aws  미설치"), "{text}");
        assert!(text.contains("  [ ] cf"), "{text}");
        assert!(text.contains("a 전체선택") && text.contains("n 전체해제"), "{text}");
        assert!(text.contains("i 설치") && text.contains("x 삭제") && text.contains("u 업데이트"), "{text}");
    }
}
