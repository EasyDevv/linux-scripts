use anyhow::Result;
use serde_json::Value;

use crate::cache::ProviderState;
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const DEFAULT_API_BASE: &str = "https://api.commandcode.ai";

#[derive(Clone, Debug)]
pub struct Credits {
    pub remaining_credits: i64,
    pub remaining_monthly: f64,
    pub window_limits: Vec<WindowLimit>,
}

#[derive(Clone, Debug)]
pub struct WindowLimit {
    pub window: String,
    pub used: f64,
    pub cap: f64,
    pub reset_at: Option<i64>,
}

pub fn is_credits_exhausted(credits: &Credits) -> bool {
    if credits.remaining_credits == 0 {
        return true;
    }
    credits
        .window_limits
        .iter()
        .any(|limit| limit.cap > 0.0 && limit.used >= limit.cap)
}

pub fn exhaustion_reason(credits: &Credits) -> Option<(String, Option<i64>)> {
    if credits.remaining_credits == 0 {
        return Some(("credits".into(), None));
    }
    let mut best: Option<(String, Option<i64>)> = None;
    for limit in &credits.window_limits {
        if limit.cap > 0.0 && limit.used >= limit.cap {
            let candidate = (format!("window:{}", limit.window), limit.reset_at);
            best = Some(match best {
                Some(existing) => earliest_reset(existing, candidate),
                None => candidate,
            });
        }
    }
    best
}

fn earliest_reset(a: (String, Option<i64>), b: (String, Option<i64>)) -> (String, Option<i64>) {
    match (a.1, b.1) {
        (Some(left), Some(right)) if right < left => b,
        (None, Some(_)) => b,
        _ => a,
    }
}

fn cache_windows(credits: &Credits) -> Vec<crate::cache::UsageWindow> {
    credits
        .window_limits
        .iter()
        .filter_map(|limit| {
            if limit.cap <= 0.0 {
                return None;
            }
            Some(crate::cache::UsageWindow {
                name: match limit.window.as_str() {
                    "fiveHour" => "5h".into(),
                    other => other.to_string(),
                },
                used_percent: ((limit.used / limit.cap) * 100.0).clamp(0.0, 100.0),
                reset_at: limit.reset_at,
            })
        })
        .collect()
}

pub fn probe(http: &dyn Http, api_key: &str, base_url: &str) -> Result<ProbeOutcome> {
    let cache_key = crate::auth::cache_key("commandcode", Some(api_key));
    let whoami = http.get(
        &format!("{base_url}/alpha/whoami"),
        &[
            ("accept", "application/json"),
            ("Authorization", &format!("Bearer {api_key}")),
        ],
    )?;
    if whoami.status == 401 || whoami.status == 403 || whoami.status >= 400 {
        return Ok(unknown(cache_key, Some(format!("http:{}", whoami.status))));
    }
    let whoami_json: Value = match serde_json::from_str(&whoami.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("whoami".into()))),
    };
    let org_id = parse_org_id(&whoami_json);
    let credits_url = match org_id {
        Some(id) => format!("{base_url}/alpha/billing/credits?orgId={id}"),
        None => format!("{base_url}/alpha/billing/credits"),
    };
    let credits_res = http.get(
        &credits_url,
        &[
            ("accept", "application/json"),
            ("Authorization", &format!("Bearer {api_key}")),
        ],
    )?;
    if credits_res.status == 401 || credits_res.status == 403 {
        return Ok(unknown(
            cache_key,
            Some(format!("http:{}", credits_res.status)),
        ));
    }
    let credits_json: Value = match serde_json::from_str(&credits_res.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("credits".into()))),
    };
    let Some(mut credits) = parse_credits(&credits_json) else {
        return Ok(unknown(cache_key, Some("credits".into())));
    };
    let subscription = subscription_from_api(http, api_key, base_url);
    let renews_at = subscription.as_ref().and_then(|s| s.period_end);
    if let Some(monthly) = monthly_window(&credits, subscription.as_ref()) {
        if !credits.window_limits.iter().any(|w| w.window == "monthly") {
            credits.window_limits.push(monthly);
        }
    }
    if is_credits_exhausted(&credits) {
        let (reason, reset_at) = exhaustion_reason(&credits).unwrap_or(("credits".into(), None));
        return Ok(ProbeOutcome {
            cache_key,
            state: ProviderState::Exhausted,
            reason: Some(reason),
            reset_at,
            remaining_credits: Some(credits.remaining_credits),
            windows: cache_windows(&credits),
            renews_at,
        });
    }
    Ok(ProbeOutcome {
        cache_key,
        state: ProviderState::Available,
        reason: None,
        reset_at: None,
        remaining_credits: Some(credits.remaining_credits),
        windows: cache_windows(&credits),
        renews_at,
    })
}

struct Subscription {
    period_end: Option<i64>,
    plan_id: Option<String>,
}

fn subscription_from_api(http: &dyn Http, api_key: &str, base_url: &str) -> Option<Subscription> {
    let response = http
        .get(
            &format!("{base_url}/alpha/billing/subscriptions"),
            &[
                ("accept", "application/json"),
                ("Authorization", &format!("Bearer {api_key}")),
            ],
        )
        .ok()?;
    if response.status >= 400 {
        return None;
    }
    let json: Value = serde_json::from_str(&response.body).ok()?;
    let data = json.get("data")?;
    let period_end = data
        .get("currentPeriodEnd")
        .and_then(Value::as_str)
        .and_then(parse_iso_unix);
    let plan_id = data
        .get("planId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);
    Some(Subscription {
        period_end,
        plan_id,
    })
}

fn monthly_cap(plan_id: &str) -> Option<f64> {
    let id = plan_id.to_ascii_lowercase();
    if id.contains("goat") {
        Some(70.0)
    } else if id.contains("max") && id.contains("20") {
        Some(300.0)
    } else if id.contains("max") {
        Some(150.0)
    } else if id.contains("team") && id.contains("pro") {
        Some(40.0)
    } else if id.contains("pro") {
        Some(80.0)
    } else if id.contains("-go") || id == "go" {
        Some(10.0)
    } else {
        None
    }
}

fn monthly_window(credits: &Credits, subscription: Option<&Subscription>) -> Option<WindowLimit> {
    let existing = credits
        .window_limits
        .iter()
        .find(|limit| limit.window == "monthly");
    if let Some(existing) = existing {
        return Some(existing.clone());
    }
    let remaining = credits.remaining_monthly;
    let cap = subscription
        .and_then(|s| s.plan_id.as_deref())
        .and_then(monthly_cap)?;
    if cap <= 0.0 {
        return None;
    }
    let used = (cap - remaining).max(0.0);
    Some(WindowLimit {
        window: "monthly".into(),
        used,
        cap,
        reset_at: subscription.and_then(|s| s.period_end),
    })
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

fn parse_org_id(value: &Value) -> Option<String> {
    value
        .get("org")
        .and_then(|org| org.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub fn parse_credits(value: &Value) -> Option<Credits> {
    let credits = value.get("credits")?.as_object()?;
    let monthly = number_value(credits.get("monthlyCredits")).unwrap_or(0.0);
    let purchased = number_value(credits.get("purchasedCredits")).unwrap_or(0.0);
    let free = number_value(credits.get("freeCredits")).unwrap_or(0.0);
    if credits.get("monthlyCredits").is_none()
        && credits.get("purchasedCredits").is_none()
        && credits.get("freeCredits").is_none()
    {
        return None;
    }
    Some(Credits {
        remaining_credits: (monthly + purchased + free) as i64,
        remaining_monthly: monthly,
        window_limits: window_limits(value.get("windowLimits")),
    })
}

fn window_limits(value: Option<&Value>) -> Vec<WindowLimit> {
    let Some(obj) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut limits = Vec::new();
    for window in ["fiveHour", "weekly", "monthly"] {
        let Some(entry) = obj.get(window).and_then(Value::as_object) else {
            continue;
        };
        let Some(used) = number_value(entry.get("used")) else {
            continue;
        };
        let Some(cap) = number_value(entry.get("cap")) else {
            continue;
        };
        if used == 0.0 && cap == 0.0 {
            continue;
        }
        limits.push(WindowLimit {
            window: window.to_string(),
            used,
            cap,
            reset_at: normalize_reset_at(entry.get("resetAt")),
        });
    }
    limits
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    let number = value?.as_f64()?;
    if number.is_finite() && number >= 0.0 {
        Some(number)
    } else {
        None
    }
}

fn normalize_reset_at(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    let timestamp = if let Some(number) = value.as_f64() {
        number
    } else if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
            trimmed.parse::<f64>().ok()?
        } else {
            return None;
        }
    } else {
        return None;
    };
    if !timestamp.is_finite() || timestamp < 0.0 {
        return None;
    }
    let as_i64 = timestamp.round() as i64;
    Some(if as_i64 >= 1_000_000_000_000 {
        as_i64 / 1000
    } else {
        as_i64
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MapHttp;
    use serde_json::json;

    #[test]
    fn zero_credits_or_full_window_is_exhausted() {
        assert!(is_credits_exhausted(&Credits {
            remaining_credits: 0,
            remaining_monthly: 0.0,
            window_limits: vec![],
        }));
        assert!(is_credits_exhausted(&Credits {
            remaining_credits: 12,
            remaining_monthly: 12.0,
            window_limits: vec![WindowLimit {
                window: "fiveHour".into(),
                used: 5.0,
                cap: 5.0,
                reset_at: Some(99),
            }],
        }));
        assert!(!is_credits_exhausted(&Credits {
            remaining_credits: 12,
            remaining_monthly: 12.0,
            window_limits: vec![WindowLimit {
                window: "fiveHour".into(),
                used: 1.0,
                cap: 5.0,
                reset_at: None,
            }],
        }));
    }

    #[test]
    fn probe_reads_credits_and_window() {
        let http = MapHttp {
            routes: vec![
                (
                    "/alpha/whoami".into(),
                    200,
                    json!({ "org": { "login": "x", "id": "org_1" } }).to_string(),
                ),
                (
                    "/alpha/billing/credits".into(),
                    200,
                    json!({
                        "credits": { "monthlyCredits": 12, "purchasedCredits": 0, "freeCredits": 0 },
                        "windowLimits": {
                            "fiveHour": { "used": 5, "cap": 5, "resetAt": 1778003600 }
                        }
                    })
                    .to_string(),
                ),
                (
                    "/alpha/billing/subscriptions".into(),
                    200,
                    json!({
                        "success": true,
                        "data": { "currentPeriodEnd": "2026-10-02T00:11:42.000Z", "planId": "individual-goat" }
                    })
                    .to_string(),
                ),
            ],
        };
        let outcome = probe(&http, "test-key", "https://api.commandcode.ai").unwrap();
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("window:fiveHour"));
        assert_eq!(outcome.reset_at, Some(1_778_003_600));
        assert_eq!(outcome.remaining_credits, Some(12));
        assert_eq!(outcome.renews_at, Some(1_790_899_902));
        assert_eq!(outcome.windows.len(), 2);
        assert_eq!(outcome.windows[0].name, "5h");
        assert_eq!(outcome.windows[0].used_percent, 100.0);
        assert_eq!(outcome.windows[0].reset_at, Some(1_778_003_600));
        assert_eq!(outcome.windows[1].name, "monthly");
        assert!((outcome.windows[1].used_percent - ((70.0 - 12.0) / 70.0 * 100.0)).abs() < 0.02);
        assert_eq!(outcome.windows[1].reset_at, Some(1_790_899_902));
    }
}
