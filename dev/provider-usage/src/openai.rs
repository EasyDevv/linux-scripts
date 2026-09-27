use anyhow::Result;
use serde_json::Value;

use crate::cache::{PlanState, ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;
use crate::iso::parse_iso_unix;

pub const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
pub const ACCOUNTS_URL: &str = "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const SESSION_MINUTES: f64 = 300.0;
const WEEKLY_MINUTES: f64 = 10_080.0;
const MONTHLY_MINUTES: f64 = 43_200.0;
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
        return Ok(unknown(
            cache_key,
            Some(format!("http:{}", response.status)),
        ));
    }
    let json: Value = match serde_json::from_str(&response.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("usage".into()))),
    };
    if json.get("plan_type").and_then(Value::as_str).is_none() {
        return Ok(unknown(cache_key, Some("usage".into())));
    }
    let mut windows: Vec<UsageWindow> = json
        .get("rate_limit")
        .and_then(Value::as_object)
        .map(|rate| {
            rate.iter()
                .filter(|(key, value)| key.ends_with("_window") && value.is_object())
                .filter_map(|(key, value)| {
                    let fallback = key.strip_suffix("_window").unwrap_or(key);
                    window_from(value, fallback)
                })
                .collect()
        })
        .unwrap_or_default();
    windows.sort_by_key(|window| window_rank(&window.name));
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
    let account = account_state(http, &session);
    let plan = PlanState {
        name: json
            .get("plan_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        display: account.as_ref().and_then(|state| state.display.clone()),
        active: account
            .as_ref()
            .and_then(|state| state.active)
            .unwrap_or(true),
        ends_at: account.as_ref().and_then(|state| state.ends_at),
    };
    Ok(ProbeOutcome {
        plan: Some(plan),
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
        renews_at: account.as_ref().and_then(|state| state.renews_at),
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

#[derive(Clone, Debug, Default)]
struct AccountState {
    renews_at: Option<i64>,
    display: Option<String>,
    active: Option<bool>,
    ends_at: Option<i64>,
}

fn account_state(http: &dyn Http, session: &Session) -> Option<AccountState> {
    let response = authed_get(http, session, ACCOUNTS_URL).ok()?;
    if response.status >= 400 {
        return None;
    }
    let json: Value = serde_json::from_str(&response.body).ok()?;
    account_state_from_json(&json)
}

fn account_state_from_json(json: &Value) -> Option<AccountState> {
    let accounts = json.get("accounts")?.as_object()?;
    let order: Vec<&Value> = accounts
        .get("default")
        .into_iter()
        .chain(
            accounts
                .iter()
                .filter(|(k, _)| *k != "default")
                .map(|(_, v)| v),
        )
        .collect();
    for account in order {
        let Some(ent) = account.get("entitlement") else {
            continue;
        };
        let renews_at = ent
            .get("renews_at")
            .and_then(Value::as_str)
            .and_then(parse_iso_unix);
        let ends_at = ent
            .get("expires_at")
            .and_then(Value::as_str)
            .and_then(parse_iso_unix)
            .or_else(|| {
                ent.get("cancels_at")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_unix)
            });
        let display = account
            .get("account")
            .and_then(|value| value.get("plan_display_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        return Some(AccountState {
            renews_at,
            display,
            active: ent.get("has_active_subscription").and_then(Value::as_bool),
            ends_at,
        });
    }
    None
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
    let Ok(response) = http.post(REFRESH_URL, &[("accept", "application/json")], &body) else {
        return false;
    };
    if response.status >= 400 {
        return false;
    }
    let Ok(json) = serde_json::from_str::<Value>(&response.body) else {
        return false;
    };
    let Some(access) = json
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        return false;
    };
    let new_refresh = json
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if let Some(path) = session.auth_path.as_deref() {
        let _ = crate::auth::persist_openai_tokens(path, access, new_refresh);
    }
    session.access_token = access.to_string();
    if let Some(refresh) = new_refresh {
        session.refresh_token = Some(refresh.to_string());
    }
    true
}

fn known_window_name(minutes: f64) -> Option<&'static str> {
    if (minutes - SESSION_MINUTES).abs() <= DURATION_TOLERANCE {
        Some("5h")
    } else if (minutes - WEEKLY_MINUTES).abs() <= DURATION_TOLERANCE {
        Some("weekly")
    } else if (minutes - MONTHLY_MINUTES).abs() <= DURATION_TOLERANCE {
        Some("monthly")
    } else {
        None
    }
}

fn window_name(value: &Value, fallback: &str) -> String {
    if let Some(name) = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return name.to_string();
    }
    let Some(seconds) = value
        .get("limit_window_seconds")
        .and_then(Value::as_f64)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
    else {
        return fallback.into();
    };
    let minutes = (seconds / 60.0).ceil();
    known_window_name(minutes)
        .map(str::to_string)
        .unwrap_or_else(|| duration_name(minutes))
}

fn duration_name(minutes: f64) -> String {
    let minutes = minutes.max(1.0) as u64;
    if minutes % 1_440 == 0 {
        format!("{}d", minutes / 1_440)
    } else if minutes % 60 == 0 {
        format!("{}h", minutes / 60)
    } else {
        format!("{}m", minutes)
    }
}

fn window_rank(name: &str) -> u8 {
    match name {
        "5h" | "session" | "rolling" => 0,
        "weekly" => 1,
        "monthly" => 2,
        _ => 3,
    }
}

fn window_from(value: &Value, fallback: &str) -> Option<UsageWindow> {
    let used = value.get("used_percent")?.as_f64()?;
    if !used.is_finite() {
        return None;
    }
    Some(UsageWindow {
        name: window_name(value, fallback),
        used_percent: used.clamp(0.0, 100.0),
        reset_at: value.get("reset_at").and_then(Value::as_i64),
    })
}

fn unknown(cache_key: String, reason: Option<String>) -> ProbeOutcome {
    ProbeOutcome {
        plan: None,
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
            routes: vec![
                (
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
                                    "renews_at": "2026-09-21T00:40:14+00:00",
                                    "has_active_subscription": true,
                                    "expires_at": "2026-10-21T00:40:14+00:00"
                                },
                                "account": {
                                    "plan_display_name": "Plus"
                                }
                            }
                        }
                    })
                    .to_string(),
                ),
            ],
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
        let plan = outcome.plan.expect("plan state");
        assert_eq!(plan.name, "plus");
        assert_eq!(plan.display.as_deref(), Some("Plus"));
        assert!(plan.active);
        assert_eq!(plan.ends_at, Some(1_792_543_214));
    }

    #[test]
    fn probe_reports_canceled_plan_state() {
        let http = MapHttp {
            routes: vec![
                (
                    "chatgpt.com/backend-api/wham/usage".into(),
                    200,
                    json!({
                        "plan_type": "free",
                        "rate_limit": {
                            "primary_window": {
                                "used_percent": 13.0,
                                "limit_window_seconds": 2_592_000,
                                "reset_at": 1_792_620_978
                            },
                            "secondary_window": null
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
                                    "renews_at": null,
                                    "has_active_subscription": false,
                                    "expires_at": "2026-09-21T06:40:14+00:00",
                                    "cancels_at": "2026-09-21T00:40:14+00:00"
                                },
                                "account": {
                                    "plan_display_name": "Free"
                                }
                            }
                        }
                    })
                    .to_string(),
                ),
            ],
        };
        let outcome = probe(
            &http,
            &Session {
                access_token: "tok".into(),
                refresh_token: None,
                account_id: None,
                auth_path: None,
            },
        )
        .unwrap();
        assert_eq!(outcome.renews_at, None);
        let plan = outcome.plan.expect("plan state");
        assert_eq!(plan.name, "free");
        assert_eq!(plan.display.as_deref(), Some("Free"));
        assert!(!plan.active);
        assert!(plan.ends_at.is_some());
    }

    #[test]
    fn probe_maps_free_monthly_primary_window() {
        let http = MapHttp {
            routes: vec![(
                "chatgpt.com/backend-api/wham/usage".into(),
                200,
                json!({
                    "plan_type": "free",
                    "rate_limit": {
                        "primary_window": {
                            "used_percent": 0.0,
                            "limit_window_seconds": 2_592_000,
                            "reset_at": 1_792_620_978
                        },
                        "secondary_window": null
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
                account_id: None,
                auth_path: None,
            },
        )
        .unwrap();
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].name, "monthly");
        assert_eq!(outcome.windows[0].reset_at, Some(1_792_620_978));
    }

    #[test]
    fn probe_keeps_policy_defined_window_names() {
        let http = MapHttp {
            routes: vec![(
                "chatgpt.com/backend-api/wham/usage".into(),
                200,
                json!({
                    "plan_type": "plus",
                    "rate_limit": {
                        "primary_window": {
                            "used_percent": 42.0,
                            "limit_window_seconds": 86_400,
                            "reset_at": 1_700_100_000
                        },
                        "tertiary_window": {
                            "name": "burst",
                            "used_percent": 18.0,
                            "limit_window_seconds": 1234,
                            "reset_at": 1_700_101_000
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
                account_id: None,
                auth_path: None,
            },
        )
        .unwrap();
        assert_eq!(outcome.windows.len(), 2);
        assert!(outcome
            .windows
            .iter()
            .any(|window| window.name == "1d" && window.used_percent == 42.0));
        assert!(outcome
            .windows
            .iter()
            .any(|window| window.name == "burst" && window.used_percent == 18.0));
    }

    #[test]
    fn probe_names_a_weekly_primary_window_by_duration() {
        let http = MapHttp {
            routes: vec![(
                "chatgpt.com/backend-api/wham/usage".into(),
                200,
                json!({
                    "plan_type": "plus",
                    "rate_limit": {
                        "primary_window": {
                            "used_percent": 42.0,
                            "limit_window_seconds": 604_800,
                            "reset_at": 1_700_100_000
                        },
                        "secondary_window": null
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
                account_id: None,
                auth_path: None,
            },
        )
        .unwrap();
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].name, "weekly");
        assert_eq!(outcome.windows[0].used_percent, 42.0);
    }
}
