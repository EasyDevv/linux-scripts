use std::io::{self, IsTerminal};

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const DIM: &str = "\x1b[2m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const YELLOW: &str = "\x1b[33m";
pub const BLUE: &str = "\x1b[34m";
pub const MAGENTA: &str = "\x1b[35m";
pub const CYAN: &str = "\x1b[36m";

pub fn stdout_enabled() -> bool {
    io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

pub fn stderr_enabled() -> bool {
    io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

pub fn paint(text: &str, styles: &[&str], enabled: bool) -> String {
    if !enabled || styles.is_empty() {
        return text.to_string();
    }
    format!("{}{}{RESET}", styles.concat(), text)
}

pub fn category_color(category: &str) -> &'static str {
    match category {
        "cloud" => CYAN,
        "payment" => YELLOW,
        "database" => GREEN,
        "ai" => MAGENTA,
        "social" => BLUE,
        "security" => RED,
        _ => DIM,
    }
}

pub fn priority_color(priority: &str) -> &'static str {
    match priority {
        "P1" => YELLOW,
        "P2" => CYAN,
        "P3" => BLUE,
        _ => DIM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paint_resets_when_enabled() {
        let painted = paint("명령", &[BOLD, CYAN], true);
        assert!(painted.starts_with(BOLD));
        assert!(painted.contains(CYAN));
        assert!(painted.ends_with(RESET));
        assert!(painted.contains("명령"));
    }

    #[test]
    fn paint_is_plain_when_disabled() {
        assert_eq!(paint("명령", &[BOLD], false), "명령");
        assert_eq!(paint("명령", &[], true), "명령");
    }
}
