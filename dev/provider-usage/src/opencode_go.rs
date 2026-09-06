use anyhow::Result;
use uuid::Uuid;

use crate::cache::ProviderState;
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const OPENCODE_BASE_URL: &str = "https://opencode.ai";
const OPENCODE_SERVER_URL: &str = "https://opencode.ai/_server";
const WORKSPACES_SERVER_ID: &str =
    "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";

#[derive(Clone, Debug, PartialEq)]
pub struct UsageWindow {
    pub name: String,
    pub used_percent: f64,
    pub reset_in_sec: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionUsage {
    pub windows: Vec<UsageWindow>,
}

pub fn normalize_cookie_input(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    if trimmed.contains(';')
        || trimmed.to_ascii_lowercase().starts_with("auth=")
        || trimmed.to_ascii_lowercase().starts_with("__host-auth=")
    {
        return trimmed.to_string();
    }
    if trimmed.starts_with("Fe26.2**")
        || trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_')
    {
        return format!("auth={trimmed}");
    }
    trimmed.to_string()
}

pub fn parse_auth_cookies(raw: &str) -> Vec<(String, String)> {
    raw.split(';')
        .filter_map(|part| {
            let pair = part.trim();
            let eq = pair.find('=')?;
            let name = pair[..eq].trim();
            let value = pair[eq + 1..].trim();
            if value.is_empty() {
                return None;
            }
            if name == "auth" || name == "__Host-auth" {
                Some((name.to_string(), value.to_string()))
            } else {
                None
            }
        })
        .collect()
}

pub fn parse_workspace_ids(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(rest) = text[i..].strip_prefix("id") {
            let after = rest.trim_start();
            if let Some(after_colon) = after.strip_prefix(':') {
                let quoted = after_colon.trim_start();
                if let Some(body) = quoted.strip_prefix('"').or_else(|| quoted.strip_prefix('\'')) {
                    let end = body.find(|ch| ch == '"' || ch == '\'').unwrap_or(body.len());
                    let id = &body[..end];
                    if (id.starts_with("wrk_") || id.starts_with("wk_"))
                        && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
                        && !ids.contains(&id.to_string())
                    {
                        ids.push(id.to_string());
                    }
                }
            }
        }
        i += 1;
    }
    ids
}

pub fn parse_subscription_from_page_text(text: &str) -> Option<SubscriptionUsage> {
    if text.is_empty() || text.len() > 10_000_000 {
        return None;
    }
    let rolling = extract_usage_block(text, "rollingUsage")?;
    let weekly = extract_usage_block(text, "weeklyUsage")?;
    let monthly = extract_usage_block(text, "monthlyUsage");
    let rolling_percent = extract_top_level_number(&rolling, "usagePercent")?;
    let weekly_percent = extract_top_level_number(&weekly, "usagePercent")?;
    let mut windows = vec![
        UsageWindow {
            name: "rolling".into(),
            used_percent: clamp_percent(rolling_percent),
            reset_in_sec: extract_top_level_number(&rolling, "resetInSec").map(|n| n as i64),
        },
        UsageWindow {
            name: "weekly".into(),
            used_percent: clamp_percent(weekly_percent),
            reset_in_sec: extract_top_level_number(&weekly, "resetInSec").map(|n| n as i64),
        },
    ];
    if let Some(block) = monthly {
        if let Some(percent) = extract_top_level_number(&block, "usagePercent") {
            windows.push(UsageWindow {
                name: "monthly".into(),
                used_percent: clamp_percent(percent),
                reset_in_sec: extract_top_level_number(&block, "resetInSec").map(|n| n as i64),
            });
        }
    }
    Some(SubscriptionUsage { windows })
}

pub fn is_windows_exhausted(windows: &[UsageWindow]) -> bool {
    windows.iter().any(|window| window.used_percent >= 100.0)
}

fn clamp_percent(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn extract_top_level_number(obj_text: &str, field_name: &str) -> Option<f64> {
    let mut depth = 0i32;
    let bytes = obj_text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        if depth == 1 {
            if obj_text[i..].starts_with(field_name) {
                let after_name = &obj_text[i + field_name.len()..];
                let trimmed = after_name.trim_start();
                if let Some(after_colon) = trimmed.strip_prefix(':') {
                    let number = after_colon.trim_start();
                    let mut end = 0;
                    if number.starts_with('-') {
                        end = 1;
                    }
                    while end < number.len()
                        && (number.as_bytes()[end].is_ascii_digit() || number.as_bytes()[end] == b'.')
                    {
                        end += 1;
                    }
                    if end > 0 {
                        if let Ok(parsed) = number[..end].parse::<f64>() {
                            if parsed.is_finite() {
                                return Some(parsed);
                            }
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn extract_usage_block(text: &str, key: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find(key) {
        let key_at = search_from + rel;
        let search_start = key_at + key.len();
        let window_end = (search_start + 30).min(text.len());
        let search_window = &text[search_start..window_end];
        if let Some(brace_offset) = search_window.find('{') {
            let open_brace = search_start + brace_offset;
            let mut depth = 0i32;
            for (offset, ch) in text[open_brace..].char_indices() {
                if ch == '{' {
                    depth += 1;
                } else if ch == '}' {
                    depth -= 1;
                    if depth == 0 {
                        let block = text[open_brace..=open_brace + offset].to_string();
                        if extract_top_level_number(&block, "usagePercent").is_some()
                            && extract_top_level_number(&block, "resetInSec").is_some()
                        {
                            return Some(block);
                        }
                        break;
                    }
                }
            }
        }
        search_from = search_start;
    }
    None
}

pub fn probe(http: &dyn Http, cookie: &str, workspace_id: Option<&str>, now: i64) -> Result<ProbeOutcome> {
    let cache_key = crate::auth::cache_key("opencode-go", Some(cookie));
    let normalized = normalize_cookie_input(cookie);
    if normalized.is_empty() {
        return Ok(unknown(cache_key, Some("unavailable".into())));
    }
    let cookies = parse_auth_cookies(&normalized);
    if cookies.is_empty() {
        return Ok(unknown(cache_key, Some("cookie".into())));
    }
    let cookie_header = cookies
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ");
    let headers = [
        ("Cookie", cookie_header.as_str()),
        ("Origin", OPENCODE_BASE_URL),
        ("Referer", OPENCODE_BASE_URL),
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    ];

    let ids = if let Some(override_id) = workspace_id.map(str::trim).filter(|id| !id.is_empty()) {
        if !is_workspace_id(override_id) {
            return Ok(unknown(cache_key, Some("workspace".into())));
        }
        vec![override_id.to_string()]
    } else {
        let instance = format!("server-fn:{}", Uuid::new_v4());
        let url = format!("{OPENCODE_SERVER_URL}?id={WORKSPACES_SERVER_ID}");
        let response = http.get(
            &url,
            &[
                ("Cookie", cookie_header.as_str()),
                ("Origin", OPENCODE_BASE_URL),
                ("Referer", OPENCODE_BASE_URL),
                ("X-Server-Id", WORKSPACES_SERVER_ID),
                ("X-Server-Instance", instance.as_str()),
                ("Accept", "text/javascript, application/json;q=0.9, */*;q=0.8"),
            ],
        )?;
        if response.status >= 400 {
            return Ok(unknown(cache_key, Some(format!("http:{}", response.status))));
        }
        parse_workspace_ids(&response.body)
    };
    if ids.is_empty() {
        return Ok(unknown(cache_key, Some("workspace".into())));
    }

    for id in ids {
        let url = format!("{OPENCODE_BASE_URL}/workspace/{id}/go");
        let response = match http.get(&url, &headers) {
            Ok(response) => response,
            Err(_) => continue,
        };
        if response.status >= 400 {
            continue;
        }
        if let Some(parsed) = parse_subscription_from_page_text(&response.body) {
            if is_windows_exhausted(&parsed.windows) {
                let window = parsed
                    .windows
                    .iter()
                    .find(|item| item.used_percent >= 100.0)
                    .unwrap_or(&parsed.windows[0]);
                let reset_at = window.reset_in_sec.map(|secs| now.saturating_add(secs));
                return Ok(ProbeOutcome {
                    cache_key,
                    state: ProviderState::Exhausted,
                    reason: Some(format!("window:{}", window.name)),
                    reset_at,
                    remaining_credits: None,
                });
            }
            return Ok(ProbeOutcome {
                cache_key,
                state: ProviderState::Available,
                reason: None,
                reset_at: None,
                remaining_credits: None,
            });
        }
    }
    Ok(unknown(cache_key, Some("error".into())))
}

fn is_workspace_id(value: &str) -> bool {
    let rest = value
        .strip_prefix("wrk_")
        .or_else(|| value.strip_prefix("wk_"));
    rest.is_some_and(|body| !body.is_empty() && body.chars().all(|ch| ch.is_ascii_alphanumeric()))
}

fn unknown(cache_key: String, reason: Option<String>) -> ProbeOutcome {
    ProbeOutcome {
        cache_key,
        state: ProviderState::Unknown,
        reason,
        reset_at: None,
        remaining_credits: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MapHttp;

    const USAGE_PAGE: &str = r#"
<html><body><script>
$R[20]={rollingUsage:$R[21]={status:"ok",resetInSec:7200,usagePercent:30},weeklyUsage:$R[22]={status:"ok",resetInSec:259200,usagePercent:51},monthlyUsage:$R[23]={status:"ok",resetInSec:1296000,usagePercent:89}};
$R[14]={customerID:"cus_ABC",reloadTrigger:5,monthlyLimit:null,monthlyUsage:null,timeMonthlyUsageUpdated:null};
</script></body></html>
"#;

    const EXHAUSTED_PAGE: &str = r#"
<html><body><script>
$R[20]={rollingUsage:$R[21]={status:"ok",resetInSec:7200,usagePercent:100},weeklyUsage:$R[22]={status:"ok",resetInSec:259200,usagePercent:51}};
</script></body></html>
"#;

    #[test]
    fn normalize_cookie_input_wraps_bare_iron_seals() {
        assert_eq!(normalize_cookie_input("Fe26.2**abc"), "auth=Fe26.2**abc");
        assert_eq!(normalize_cookie_input("auth=Fe26.2**abc"), "auth=Fe26.2**abc");
        assert_eq!(normalize_cookie_input(""), "");
    }

    #[test]
    fn parse_subscription_prefers_usage_objects() {
        let parsed = parse_subscription_from_page_text(USAGE_PAGE).unwrap();
        assert_eq!(parsed.windows[0].used_percent, 30.0);
        assert_eq!(parsed.windows[1].used_percent, 51.0);
        assert_eq!(parsed.windows[2].used_percent, 89.0);
        assert_eq!(parsed.windows[0].reset_in_sec, Some(7200));
        assert_eq!(
            parse_workspace_ids(r#"id: "wrk_TESTWORKSPACEID123""#),
            vec!["wrk_TESTWORKSPACEID123"]
        );
    }

    #[test]
    fn probe_reads_workspace_page() {
        let http = MapHttp {
            routes: vec![(
                "/workspace/wrk_TESTWORKSPACEID123/go".into(),
                200,
                USAGE_PAGE.to_string(),
            )],
        };
        let outcome = probe(&http, "auth=token", Some("wrk_TESTWORKSPACEID123"), 1_000).unwrap();
        assert_eq!(outcome.state, ProviderState::Available);
    }

    #[test]
    fn probe_marks_full_window_exhausted_with_reset() {
        let http = MapHttp {
            routes: vec![(
                "/workspace/wrk_TESTWORKSPACEID123/go".into(),
                200,
                EXHAUSTED_PAGE.to_string(),
            )],
        };
        let outcome = probe(&http, "auth=token", Some("wrk_TESTWORKSPACEID123"), 1_000).unwrap();
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("window:rolling"));
        assert_eq!(outcome.reset_at, Some(1_000 + 7200));
    }
}
