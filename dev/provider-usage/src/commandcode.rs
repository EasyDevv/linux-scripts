use anyhow::Result;
use serde_json::Value;

use crate::cache::ProviderState;
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const DEFAULT_API_BASE: &str = "https://api.commandcode.ai";

#[derive(Clone, Debug)]
pub struct Credits {
    pub remaining_credits: i64,
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

fn earliest_reset(
    a: (String, Option<i64>),
    b: (String, Option<i64>),
) -> (String, Option<i64>) {
    match (a.1, b.1) {
        (Some(left), Some(right)) if right < left => b,
        (None, Some(_)) => b,
        _ => a,
    }
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
        return Ok(unknown(cache_key, Some(format!("http:{}", credits_res.status))));
    }
    let credits_json: Value = match serde_json::from_str(&credits_res.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("credits".into()))),
    };
    let Some(credits) = parse_credits(&credits_json) else {
        return Ok(unknown(cache_key, Some("credits".into())));
    };
    if is_credits_exhausted(&credits) {
        let (reason, reset_at) = exhaustion_reason(&credits).unwrap_or(("credits".into(), None));
        return Ok(ProbeOutcome {
            cache_key,
            state: ProviderState::Exhausted,
            reason: Some(reason),
            reset_at,
            remaining_credits: Some(credits.remaining_credits),
        });
    }
    Ok(ProbeOutcome {
        cache_key,
        state: ProviderState::Available,
        reason: None,
        reset_at: None,
        remaining_credits: Some(credits.remaining_credits),
    })
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
        window_limits: window_limits(value.get("windowLimits")),
    })
}

fn window_limits(value: Option<&Value>) -> Vec<WindowLimit> {
    let Some(obj) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut limits = Vec::new();
    for window in ["fiveHour", "weekly"] {
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
            window_limits: vec![],
        }));
        assert!(is_credits_exhausted(&Credits {
            remaining_credits: 12,
            window_limits: vec![WindowLimit {
                window: "fiveHour".into(),
                used: 5.0,
                cap: 5.0,
                reset_at: Some(99),
            }],
        }));
        assert!(!is_credits_exhausted(&Credits {
            remaining_credits: 12,
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
            ],
        };
        let outcome = probe(&http, "test-key", "https://api.commandcode.ai").unwrap();
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("window:fiveHour"));
        assert_eq!(outcome.reset_at, Some(1_778_003_600));
        assert_eq!(outcome.remaining_credits, Some(12));
    }
}
