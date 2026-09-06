use std::io::{self, IsTerminal};

pub const RESET: &str = "\x1b[0m";
pub const DIM: &str = "\x1b[2m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";

pub fn color_enabled() -> bool {
    io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

pub fn paint(text: impl AsRef<str>, style: &str) -> String {
    if !color_enabled() {
        return text.as_ref().to_string();
    }
    format!("{style}{}{RESET}", text.as_ref())
}
