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

pub fn color_enabled() -> bool {
    io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

pub fn paint(text: impl AsRef<str>, styles: &[&str]) -> String {
    if styles.is_empty() || !color_enabled() {
        return text.as_ref().to_string();
    }
    format!("{}{}{}", styles.concat(), text.as_ref(), RESET)
}

pub fn table_category(name: &str) -> (&'static str, &'static str) {
    match name.split('_').next().unwrap_or(name) {
        "prop" => ("Property", MAGENTA),
        "bldg" => ("Building", MAGENTA),
        "sys" => ("System", CYAN),
        "ref" => ("Reference", BLUE),
        "cache" => ("Cache", BLUE),
        "log" => ("Log", YELLOW),
        _ => ("Other", DIM),
    }
}

pub fn category_rank(label: &str) -> u8 {
    match label {
        "Property" => 0,
        "Building" => 1,
        "System" => 2,
        "Reference" => 3,
        "Cache" => 4,
        "Log" => 5,
        _ => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorizes_known_prefixes() {
        assert_eq!(table_category("prop_units").0, "Property");
        assert_eq!(table_category("sys_users").0, "System");
        assert_eq!(table_category("log_audit").0, "Log");
        assert_eq!(table_category("sqlite_stat1").0, "Other");
    }
}
