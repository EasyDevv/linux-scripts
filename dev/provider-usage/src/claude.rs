//! Claude Code quota windows from the Claude CLI's own OAuth token.
//!
//! The credential is the one the `claude` CLI already holds in
//! `~/.claude/.credentials.json`; Pi auth is not involved and the dashboard
//! stores no Claude secret. Both endpoints below are the ones the CLI's
//! `/usage` screen reads, so an expired token is a "run claude" state rather
//! than a board error.

use anyhow::Result;
use serde_json::Value;

use crate::cache::{PlanState, ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;
use crate::iso::parse_iso_unix;

pub const DEFAULT_API_BASE: &str = "https://api.anthropic.com";
/// The Claude CLI sends this beta to authenticate an OAuth access token.
pub const OAUTH_BETA: &str = "oauth-2025-04-20";
pub const USAGE_PATH: &str = "/api/oauth/usage";
pub const PROFILE_PATH: &str = "/api/oauth/profile";

/// `limits[].kind` mapped to the board's window names, shortest window first.
/// The per-model weekly kinds (`weekly_opus`, `weekly_sonnet`) are deliberately
/// unmapped: the footer chip contract is `s`/`w`/`m` only, and a model name
/// has no letter.
const WINDOW_KINDS: [(&str, &str); 2] = [("session", "5h"), ("weekly_all", "weekly")];

#[derive(Clone, Debug)]
pub struct Session {
    pub access_token: String,
    /// OAuth expiry in epoch **milliseconds**, the unit the CLI writes.
    pub expires_at_ms: Option<i64>,
}

pub fn probe(
    http: &dyn Http,
    session: Option<&Session>,
    base_url: &str,
    now: i64,
) -> ProbeOutcome {
    let Some(session) = session else {
        return unknown(crate::auth::cache_key("claude", None), Some("config".into()));
    };
    let cache_key = crate::auth::cache_key("claude", Some(&session.access_token));
    if is_expired(session, now) {
        return unknown(cache_key, Some("expired".into()));
    }
    let usage = match authed_get(http, session, &format!("{base_url}{USAGE_PATH}")) {
        Ok(response) => response,
        Err(_) => return unknown(cache_key, Some("network".into())),
    };
    if usage.status >= 400 {
        return unknown(cache_key, Some(format!("http:{}", usage.status)));
    }
    let Ok(json) = serde_json::from_str::<Value>(&usage.body) else {
        return unknown(cache_key, Some("usage".into()));
    };
    let windows = parse_windows(&json);
    if windows.is_empty() {
        return unknown(cache_key, Some("usage".into()));
    }
    let exhausted = windows
        .iter()
        .any(|window| window.used_percent >= 100.0);
    let reset_at = windows
        .iter()
        .filter(|window| window.used_percent >= 100.0)
        .filter_map(|window| window.reset_at)
        .min()
        .or_else(|| windows.iter().filter_map(|window| window.reset_at).min());
    ProbeOutcome {
        plan: plan_state(http, session, base_url),
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
        // A subscription quota, never a balance: nothing to render as a metric.
        remaining_credits: None,
        windows,
        // Neither endpoint exposes a billing period end, so the card carries no
        // next-bill line rather than a guessed one.
        renews_at: None,
    }
}
/// Best effort: a profile that cannot be read leaves the catalog copy standing
/// instead of failing a probe that already holds its windows.
fn plan_state(http: &dyn Http, session: &Session, base_url: &str) -> Option<PlanState> {
    let response = authed_get(http, session, &format!("{base_url}{PROFILE_PATH}")).ok()?;
    if response.status >= 400 {
        return None;
    }
    let json: Value = serde_json::from_str(&response.body).ok()?;
    parse_plan(&json)
}

pub fn parse_plan(json: &Value) -> Option<PlanState> {
    let organization = json.get("organization")?;
    let name = organization
        .get("organization_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())?;
    Some(PlanState {
        name: name.to_string(),
        display: plan_display(name),
        active: organization
            .get("subscription_status")
            .and_then(Value::as_str)
            .map(|status| status == "active")
            .unwrap_or(true),
        ends_at: None,
    })
}

/// `claude_pro` → `Pro`, `claude_max` → `Max`. A plan key the board cannot
/// price still gets a label; it just carries no price copy of its own.
pub fn plan_display(kind: &str) -> Option<String> {
    let tail = kind.strip_prefix("claude_").unwrap_or(kind);
    let mut chars = tail.chars();
    let first = chars.next()?;
    let rest: String = chars.collect();
    Some(first.to_uppercase().collect::<String>() + &rest)
}

pub fn parse_windows(json: &Value) -> Vec<UsageWindow> {
    let Some(limits) = json.get("limits").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut windows = Vec::new();
    for (kind, name) in WINDOW_KINDS {
        let Some(limit) = limits
            .iter()
            .find(|entry| entry.get("kind").and_then(Value::as_str) == Some(kind))
        else {
            continue;
        };
        let Some(used) = limit
            .get("percent")
            .and_then(Value::as_f64)
            .filter(|used| used.is_finite())
        else {
            continue;
        };
        windows.push(UsageWindow {
            name: name.to_string(),
            used_percent: used.clamp(0.0, 100.0),
            reset_at: limit
                .get("resets_at")
                .and_then(Value::as_str)
                .and_then(parse_iso_unix),
        });
    }
    windows
}

fn is_expired(session: &Session, now: i64) -> bool {
    session
        .expires_at_ms
        .is_some_and(|expires_at_ms| expires_at_ms <= now.saturating_mul(1000))
}

fn authed_get(http: &dyn Http, session: &Session, url: &str) -> Result<crate::http::HttpResponse> {
    http.get(
        url,
        &[
            ("accept", "application/json"),
            ("Authorization", &format!("Bearer {}", session.access_token)),
            ("anthropic-beta", OAUTH_BETA),
        ],
    )
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

    fn session() -> Session {
        Session {
            access_token: "oauth-token".into(),
            expires_at_ms: Some(1_800_000_000_000),
        }
    }

    /// Trimmed from a real 202 call to `/api/oauth/usage`.
    fn usage_body(session_percent: f64, weekly_percent: f64) -> String {
        json!({
            "five_hour": { "utilization": session_percent, "resets_at": "2026-09-27T14:00:00.311373+00:00" },
            "seven_day": { "utilization": weekly_percent, "resets_at": "2026-09-29T15:00:00.311395+00:00" },
            "seven_day_opus": null,
            "limits": [
                {
                    "kind": "session",
                    "group": "session",
                    "percent": session_percent,
                    "resets_at": "2026-09-27T14:00:00.311373+00:00",
                    "is_active": true
                },
                {
                    "kind": "weekly_all",
                    "group": "weekly",
                    "percent": weekly_percent,
                    "resets_at": "2026-09-29T15:00:00.311395+00:00",
                    "is_active": false
                }
            ],
            "extra_usage": { "is_enabled": false }
        })
        .to_string()
    }

    fn profile_body(organization_type: &str, status: &str) -> String {
        json!({
            "account": { "uuid": "acct-1", "has_claude_max": false, "has_claude_pro": true },
            "organization": {
                "organization_type": organization_type,
                "rate_limit_tier": "default_claude_ai",
                "subscription_status": status
            },
            "application": { "slug": "claude-code" }
        })
        .to_string()
    }

    fn routes(usage: (u16, String), profile: (u16, String)) -> MapHttp {
        MapHttp {
            routes: vec![
                (USAGE_PATH.into(), usage.0, usage.1),
                (PROFILE_PATH.into(), profile.0, profile.1),
            ],
        }
    }

    #[test]
    fn probe_maps_session_and_weekly_from_the_limits_list() {
        let http = routes(
            (200, usage_body(33.0, 5.0)),
            (200, profile_body("claude_pro", "active")),
        );
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.reason, None);
        assert_eq!(outcome.windows.len(), 2);
        assert_eq!(outcome.windows[0].name, "5h");
        assert_eq!(outcome.windows[0].used_percent, 33.0);
        assert_eq!(outcome.windows[0].reset_at, Some(1_790_517_600));
        assert_eq!(outcome.windows[1].name, "weekly");
        assert_eq!(outcome.windows[1].used_percent, 5.0);
        // A subscription quota has no balance and no bill date to show.
        assert_eq!(outcome.remaining_credits, None);
        assert_eq!(outcome.renews_at, None);
        let plan = outcome.plan.expect("plan from the profile");
        assert_eq!(plan.name, "claude_pro");
        assert_eq!(plan.display.as_deref(), Some("Pro"));
        assert!(plan.active);
    }

    #[test]
    fn a_full_session_window_is_exhausted_at_its_reset() {
        let http = routes(
            (200, usage_body(100.0, 12.0)),
            (200, profile_body("claude_pro", "active")),
        );
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("window"));
        assert_eq!(outcome.reset_at, Some(1_790_517_600));
        assert_eq!(outcome.windows.len(), 2);
    }

    #[test]
    fn a_full_weekly_window_reports_the_weekly_reset() {
        let http = routes(
            (200, usage_body(10.0, 100.0)),
            (200, profile_body("claude_pro", "active")),
        );
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reset_at, Some(1_790_694_000));
    }

    #[test]
    fn window_percent_clamps_on_both_ends() {
        let json: Value = serde_json::from_str(&usage_body(150.0, -5.0)).unwrap();
        let windows = parse_windows(&json);
        assert_eq!(windows[0].used_percent, 100.0);
        assert_eq!(windows[1].used_percent, 0.0);
    }

    #[test]
    fn per_model_weekly_kinds_do_not_become_windows() {
        let mut json: Value = serde_json::from_str(&usage_body(1.0, 2.0)).unwrap();
        let limits = json
            .get_mut("limits")
            .and_then(Value::as_array_mut)
            .expect("limits");
        limits.push(json!({ "kind": "weekly_opus", "percent": 80.0 }));
        limits.push(json!({ "kind": "weekly_sonnet", "percent": 60.0 }));
        let windows = parse_windows(&json);
        assert_eq!(
            windows.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(),
            vec!["5h", "weekly"]
        );
    }

    #[test]
    fn a_refused_token_is_unknown_with_its_status() {
        let http = MapHttp {
            routes: vec![(USAGE_PATH.into(), 401, r#"{"error":"expired"}"#.into())],
        };
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("http:401"));
        assert!(outcome.windows.is_empty());
        assert_eq!(outcome.plan, None);
    }

    #[test]
    fn an_expired_token_never_reaches_the_api() {
        // No routes: any request would answer 404, not `expired`.
        let http = MapHttp { routes: Vec::new() };
        let mut stale = session();
        stale.expires_at_ms = Some(1_700_000_000_000);
        let outcome = probe(&http, Some(&stale), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("expired"));
    }

    #[test]
    fn a_missing_credential_is_config() {
        let http = MapHttp { routes: Vec::new() };
        let outcome = probe(&http, None, DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.reason.as_deref(), Some("config"));
        assert_eq!(outcome.cache_key, "claude:anon");
    }

    #[test]
    fn a_dead_profile_keeps_the_windows() {
        let http = routes((200, usage_body(33.0, 5.0)), (403, String::new()));
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows.len(), 2);
        // Catalog copy stands when the account cannot be read.
        assert_eq!(outcome.plan, None);
    }

    #[test]
    fn a_usage_body_without_limits_is_unknown() {
        let http = routes(
            (200, json!({ "spend": { "enabled": false } }).to_string()),
            (200, profile_body("claude_pro", "active")),
        );
        let outcome = probe(&http, Some(&session()), DEFAULT_API_BASE, 1_790_000_000);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("usage"));
    }

    #[test]
    fn an_unpriced_plan_keeps_its_label_and_loses_its_price() {
        let json: Value = serde_json::from_str(&profile_body("claude_max", "active")).unwrap();
        let plan = parse_plan(&json).expect("plan");
        assert_eq!(plan.name, "claude_max");
        // The label is derived; the price is the board's decision, not the
        // probe's, because Max tiers share one key and two prices.
        assert_eq!(plan.display.as_deref(), Some("Max"));
        assert_eq!(plan_display("claude_pro").as_deref(), Some("Pro"));
        assert_eq!(plan_display("claude_enterprise").as_deref(), Some("Enterprise"));
        assert_eq!(plan_display(""), None);
    }

    #[test]
    fn a_canceled_subscription_is_not_active() {
        let json: Value = serde_json::from_str(&profile_body("claude_pro", "canceled")).unwrap();
        assert!(!parse_plan(&json).expect("plan").active);
        let json: Value = serde_json::from_str(&profile_body("claude_pro", "active")).unwrap();
        assert!(parse_plan(&json).expect("plan").active);
    }
}
