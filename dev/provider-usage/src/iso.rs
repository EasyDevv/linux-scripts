//! UTC ISO-8601 to epoch seconds for provider reset/renew timestamps.

pub(crate) fn parse_iso_unix(s: &str) -> Option<i64> {
    let s = s.trim();
    let s = s.strip_suffix('Z').unwrap_or(s);
    let s = if let Some(head) = s.strip_suffix("+00:00") {
        head
    } else if let Some(head) = s.strip_suffix("+0000") {
        head
    } else {
        s
    };
    let (date, time) = s.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i32 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.split('.').next()?.parse().ok()?;
    unix_from_utc(year, month, day, hour, minute, second)
}

pub(crate) fn unix_from_utc(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> Option<i64> {
    if !(1..=12).contains(&month) || day == 0 || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut y = year;
    let mut m = month as i32;
    if m <= 2 {
        y -= 1;
        m += 12;
    }
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as i64;
    let days = era as i64 * 146097 + doe - 719468;
    Some(days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64)
}
