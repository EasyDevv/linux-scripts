use std::io::{self, IsTerminal, Write};

use anyhow::{Context, Result};
use crossterm::cursor::{Hide, MoveToColumn, MoveToPreviousLine, Show};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal::{self, Clear, ClearType};
use crossterm::{execute, queue};

use crate::color::{paint, BOLD, DIM};

pub struct Choice<T> {
    pub label: String,
    pub value: T,
    pub style: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectAction {
    Up,
    Down,
    First,
    Last,
    Accept,
    Abort,
    Redraw,
    Ignore,
}

pub fn classify_key(code: KeyCode, modifiers: KeyModifiers) -> SelectAction {
    if modifiers.contains(KeyModifiers::CONTROL) && matches!(code, KeyCode::Char('c')) {
        return SelectAction::Abort;
    }
    match code {
        KeyCode::Up | KeyCode::Char('k') => SelectAction::Up,
        KeyCode::Down | KeyCode::Char('j') => SelectAction::Down,
        KeyCode::Home | KeyCode::Char('g') => SelectAction::First,
        KeyCode::End | KeyCode::Char('G') => SelectAction::Last,
        KeyCode::Enter => SelectAction::Accept,
        KeyCode::Esc | KeyCode::Char('q') => SelectAction::Abort,
        _ => SelectAction::Ignore,
    }
}

pub fn select_one<T: Clone>(
    header: &[String],
    choices: &[Choice<T>],
    footer: &str,
) -> Result<Option<T>> {
    if choices.is_empty() {
        anyhow::bail!("select list is empty");
    }
    if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
        anyhow::bail!("arrow selection requires an interactive terminal");
    }

    terminal::enable_raw_mode().context("enable raw mode")?;
    let mut stderr = io::stderr();
    queue!(stderr, Hide).ok();
    let _guard = RawGuard;

    let mut current = 0usize;
    let mut drawn = 0usize;
    loop {
        let lines = render_lines(header, choices, current, footer);
        drawn = redraw(&mut stderr, &lines, drawn)?;
        match next_action()? {
            SelectAction::Up => current = current.saturating_sub(1),
            SelectAction::Down => current = (current + 1).min(choices.len() - 1),
            SelectAction::First => current = 0,
            SelectAction::Last => current = choices.len() - 1,
            SelectAction::Accept => return Ok(Some(choices[current].value.clone())),
            SelectAction::Abort => return Ok(None),
            SelectAction::Redraw | SelectAction::Ignore => {}
        }
    }
}

fn next_action() -> Result<SelectAction> {
    loop {
        match event::read().context("read terminal event")? {
            Event::Resize(_, _) => return Ok(SelectAction::Redraw),
            Event::Key(KeyEvent {
                code,
                modifiers,
                kind,
                ..
            }) if kind == KeyEventKind::Press || kind == KeyEventKind::Repeat => {
                return Ok(classify_key(code, modifiers));
            }
            _ => {}
        }
    }
}

fn render_lines<T>(
    header: &[String],
    choices: &[Choice<T>],
    current: usize,
    footer: &str,
) -> Vec<String> {
    let mut lines = Vec::new();
    if !header.is_empty() {
        lines.extend(header.iter().cloned());
        lines.push(String::new());
    }
    for (index, choice) in choices.iter().enumerate() {
        let selected = index == current;
        let marker = if selected { ">" } else { " " };
        let styles: Vec<&str> = if selected {
            let mut styles = vec![BOLD];
            styles.extend_from_slice(choice.style);
            styles
        } else {
            choice.style.to_vec()
        };
        lines.push(format!(
            "  {} {}",
            paint(marker, &styles),
            paint(&choice.label, &styles)
        ));
    }
    if !footer.is_empty() {
        lines.push(paint(footer, &[DIM]));
    }
    lines
}

fn redraw(stderr: &mut io::Stderr, lines: &[String], previous: usize) -> Result<usize> {
    if previous > 1 {
        queue!(stderr, MoveToPreviousLine((previous as u16) - 1))?;
    }
    let total = previous.max(lines.len());
    for index in 0..total {
        queue!(stderr, MoveToColumn(0), Clear(ClearType::CurrentLine))?;
        if index < lines.len() {
            queue!(stderr, crossterm::style::Print(&lines[index]))?;
        }
        if index + 1 < total {
            queue!(stderr, crossterm::style::Print("\r\n"))?;
        }
    }
    stderr.flush()?;
    Ok(lines.len())
}

struct RawGuard;

impl Drop for RawGuard {
    fn drop(&mut self) {
        let mut stderr = io::stderr();
        let _ = execute!(stderr, Show);
        let _ = terminal::disable_raw_mode();
        let _ = writeln!(stderr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_arrows_and_vim_keys() {
        assert_eq!(
            classify_key(KeyCode::Up, KeyModifiers::NONE),
            SelectAction::Up
        );
        assert_eq!(
            classify_key(KeyCode::Char('j'), KeyModifiers::NONE),
            SelectAction::Down
        );
        assert_eq!(
            classify_key(KeyCode::Char('g'), KeyModifiers::NONE),
            SelectAction::First
        );
        assert_eq!(
            classify_key(KeyCode::Enter, KeyModifiers::NONE),
            SelectAction::Accept
        );
        assert_eq!(
            classify_key(KeyCode::Esc, KeyModifiers::NONE),
            SelectAction::Abort
        );
        assert_eq!(
            classify_key(KeyCode::Char('c'), KeyModifiers::CONTROL),
            SelectAction::Abort
        );
    }
}
