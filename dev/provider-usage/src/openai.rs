use anyhow::Result;
use serde_json::Value;

use crate::cache::{ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
pub const ACCOUNTS_URL: &str = "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const SESSION_MINUTES: f64 = 300.0;
const WEEKLY_MINUTES: f64 = 10_080.0;
const DURATION_TOLERANCE: f64 = 1.0;

pub struct Session {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub account_id: Option<String>,
    pub auth_path: Option<std::path::PathBuf>,
}

const REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

pub fn probe(http: &dyn Http, session: &Session) -> Result<ProbeOutcome> {
    let mut session = Session {
        access_token: session.access_token.clone(),
        refresh_token: session.refresh_token.clone(),
        account_id: session.account_id.clone(),
        auth_path: session.auth_path.clone(),
    };
    let response = usage_request(http, &session)?;
    let response = if response.status == 401 || response.status == 403 {
        if refresh_session(http, &mut session) {
            usage_request(http, &session)?
        } else {
            response
        }
    } else {
        response
    };
    let cache_key = crate::auth::cache_key("openai", Some(&session.access_token));
    if response.status == 401 || response.status == 403 || response.status >= 400 {
        return Ok(unknown(cache_key, Some(format!("http:{}", response.status))));
    }
    let json: Value = match serde_json::from_str(&response.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("usage".into()))),
    };
    if json.get("plan_type").and_then(Value::as_str).is_none() {
        return Ok(unknown(cache_key, Some("usage".into())));
    }
    let rate = json.get("rate_limit");
    let primary = rate.and_then(|v| v.get("primary_window"));
    let secondary = rate.and_then(|v| v.get("secondary_window"));
    let mut session_win = classify(primary, "5h");
    let mut weekly_win = classify(secondary, "weekly");
    if session_win.is_none() {
        session_win = unnamed(primary, "5h");
    }
    if weekly_win.is_none() {
        weekly_win = unnamed(secondary, "weekly");
    }
    let mut windows = Vec::new();
    if let Some(window) = session_win {
        windows.push(window);
    }
    if let Some(window) = weekly_win {
        windows.push(window);
    }
    if windows.is_empty() {
        return Ok(unknown(cache_key, Some("usage".into())));
    }
    let exhausted = windows.iter().any(|w| w.used_percent >= 100.0);
    let reset_at = windows
        .iter()
        .filter(|w| w.used_percent >= 100.0)
        .filter_map(|w| w.reset_at)
        .min()
        .or_else(|| windows.iter().filter_map(|w| w.reset_at).min());
    Ok(ProbeOutcome {
        cache_key,
        state: if exhausted {
            ProviderState::Exhausted
        } else {
            ProviderState::Available
        },
        reason: if exhausted {
            Some("window".into())
        } else {
            None
        },
        reset_at,
        remaining_credits: None,
        windows,
        renews_at: renews_from_accounts(http, &session),
    })
}

fn usage_request(http: &dyn Http, session: &Session) -> Result<crate::http::HttpResponse> {
    authed_get(http, session, USAGE_URL)
}

fn authed_get(http: &dyn Http, session: &Session, url: &str) -> Result<crate::http::HttpResponse> {
    let auth = format!("Bearer {}", session.access_token);
    let mut headers = vec![
        ("accept", "application/json"),
        ("Authorization", auth.as_str()),
        ("User-Agent", "codex-cli"),
        ("OpenAI-Beta", "codex-1"),
        ("originator", "Codex Desktop"),
    ];
    if let Some(account) = session.account_id.as_deref() {
        headers.push(("ChatGPT-Account-Id", account));
    }
    http.get(url, &headers)
}

fn renews_from_accounts(http: &dyn Http, session: &Session) -> Option<i64> {
    let response = authed_get(http, session, ACCOUNTS_URL).ok()?;
    if response.status >= 400 {
        return None;
    }
    let json: Value = serde_json::from_str(&response.body).ok()?;
    entitlement_renews_at(&json)
}

fn entitlement_renews_at(json: &Value) -> Option<i64> {
    let accounts = json.get("accounts")?.as_object()?;
    let order: Vec<&Value> = accounts
        .get("default")
        .into_iter()
        .chain(accounts.iter().filter(|(k, _)| *k != "default").map(|(_, v)| v))
        .collect();
    for account in order {
        let ent = match account.get("entitlement") {
            Some(value) => value,
            None => continue,
        };
        if let Some(raw) = ent.get("renews_at").and_then(Value::as_str) {
            if let Some(ts) = parse_iso_unix(raw) {
                return Some(ts);
            }
        }
    }
    None
}

fn parse_iso_unix(s: &str) -> Option<i64> {
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
    let second: u32 = time_parts
        .next()?
        .split('.')
        .next()?
        .parse()
        .ok()?;
    unix_from_utc(year, month, day, hour, minute, second)
}

fn unix_from_utc(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Option<i64> {
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

fn refresh_session(http: &dyn Http, session: &mut Session) -> bool {
    let Some(refresh) = session.refresh_token.as_deref().filter(|v| !v.is_empty()) else {
        return false;
    };
    let body = serde_json::json!({
        "client_id": CLIENT_ID,
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    })
    .to_string();
    let Ok(response) = http.post(
        REFRESH_URL,
        &[("accept", "application/json")],
        &body,
    ) else {
        return false;
    };
    if response.status >= 400 {
        return false;
    }
    let Ok(json) = serde_json::from_str::<Value>(&response.body) else {
        return false;
    };
    let Some(access) = json.get("access_token").and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()) else {
        return false;
    };
    let new_refresh = json.get("refresh_token").and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    if let Some(path) = session.auth_path.as_deref() {
        let _ = crate::auth::persist_openai_tokens(path, access, new_refresh);
    }
    session.access_token = access.to_string();
    if let Some(refresh) = new_refresh {
        session.refresh_token = Some(refresh.to_string());
    }
    true
}

fn classify(value: Option<&Value>, fallback: &str) -> Option<UsageWindow> {
    let used = value?.get("used_percent")?.as_f64()?;
    if !used.is_finite() {
        return None;
    }
    let seconds = value?.get("limit_window_seconds").and_then(Value::as_f64);
    let minutes = seconds.filter(|s| *s > 0.0).map(|s| (s / 60.0).ceil());
    let name = match minutes {
        Some(m) if (m - SESSION_MINUTES).abs() <= DURATION_TOLERANCE => "5h",
        Some(m) if (m - WEEKLY_MINUTES).abs() <= DURATION_TOLERANCE => "weekly",
        _ => return None,
    };
    if fallback == "5h" && name != "5h" {
        return None;
    }
    if fallback == "weekly" && name != "weekly" {
        return None;
    }
    Some(UsageWindow {
        name: name.into(),
        used_percent: used.clamp(0.0, 100.0),
        reset_at: value?.get("reset_at").and_then(Value::as_i64),
    })
}

fn unnamed(value: Option<&Value>, name: &str) -> Option<UsageWindow> {
    let used = value?.get("used_percent")?.as_f64()?;
    if !used.is_finite() {
        return None;
    }
    Some(UsageWindow {
        name: name.into(),
        used_percent: used.clamp(0.0, 100.0),
        reset_at: value?.get("reset_at").and_then(Value::as_i64),
    })
}

fn unknown(cache_key: String, reason: Option<String>) -> ProbeOutcome {
    ProbeOutcome {
        cache_key,
        state: ProviderState::Unknown,
        reason,
        reset_at: None,
        remaining_credits: None,
        windows: Vec::new(),
        renews_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MapHttp;
    use serde_json::json;

    #[test]
    fn probe_maps_session_and_weekly() {
        let http = MapHttp {
            routes: vec![(
                "chatgpt.com/backend-api/wham/usage".into(),
                200,
                json!({
                    "plan_type": "plus",
                    "rate_limit": {
                        "primary_window": {
                            "used_percent": 10.0,
                            "limit_window_seconds": 18000,
                            "reset_at": 1_700_000_000
                        },
                        "secondary_window": {
                            "used_percent": 80.0,
                            "limit_window_seconds": 604800,
                            "reset_at": 1_700_100_000
                        }
                    }
                })
                .to_string(),
            ),
            (
                "accounts/check/v4-2023-04-27".into(),
                200,
                json!({
                    "accounts": {
                        "default": {
                            "entitlement": {
                                "renews_at": "2026-09-21T00:40:14+00:00"
                            }
                        }
                    }
                })
                .to_string(),
            )],
        };
        let outcome = probe(
            &http,
            &Session {
                access_token: "tok".into(),
                refresh_token: None,
                account_id: Some("acct".into()),
                auth_path: None,
            },
        )
        .unwrap();
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows[0].name, "5h");
        assert_eq!(outcome.windows[0].used_percent, 10.0);
        assert_eq!(outcome.windows[1].name, "weekly");
        assert_eq!(outcome.windows[1].used_percent, 80.0);
        assert_eq!(outcome.renews_at, Some(1_789_951_214));
    }
}
