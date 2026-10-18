//! Claude Code quota windows from the signed-in claude.ai web session.
//!
//! The only credential is the browser `Cookie:` header pasted into
//! `CLAUDE_COOKIE` (`sessionKey` plus the Cloudflare `cf_clearance`). The
//! `claude` CLI's OAuth file is not read. Three claude.ai endpoints carry
//! everything the card shows:
//!
//! - `GET /api/organizations` names the org and its plan (`capabilities`).
//! - `GET /api/organizations/{uuid}/usage` has the same `limits[]` the CLI's
//!   `/usage` screen reads: the 5h session and the weekly window. With the
//!   `cedar_ember=1` experiment param it also carries the usage-limit reset
//!   ("reset ticket") grants the account can spend.
//! - `POST /api/organizations/{uuid}/reset_rate_limits` spends one of those
//!   grants (`program` `cedar_ember`).
//! - `GET /api/organizations/{uuid}/subscription_details` has the next charge.
//!
//! Cloudflare answers a stale `cf_clearance` with a 403 challenge page, which
//! is its own `challenge` reason rather than a board error.

use anyhow::Result;
use serde_json::Value;

use crate::cache::{PlanState, ProviderState, ResetTicket, UsageWindow};
use crate::core::{ProbeOutcome, RedeemOutcome};
use crate::http::Http;
use crate::iso::parse_iso_unix;

pub const DEFAULT_BASE: &str = "https://claude.ai";
/// `cf_clearance` is minted for a browser; the endpoints answer a bare client
/// with the challenge page, so the probe presents as one.
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/// `limits[].kind` mapped to the board's window names, shortest window first.
/// The per-model weekly kinds (`weekly_opus`, `weekly_sonnet`) are deliberately
/// unmapped: the footer chip contract is `s`/`w`/`m` only, and a model name
/// has no letter.
const WINDOW_KINDS: [(&str, &str); 2] = [("session", "5h"), ("weekly_all", "weekly")];

/// Experiment flag that makes `/usage` return the reset-ticket grants, and the
/// `program` the redeem endpoint expects for them.
const RESET_PROGRAM: &str = "cedar_ember";

pub fn probe(http: &dyn Http, cookie: Option<&str>, base_url: &str) -> ProbeOutcome {
    let cookie = cookie.map(str::trim).filter(|value| !value.is_empty());
    let cache_key = crate::auth::cache_key("claude", cookie);
    let Some(cookie) = cookie else {
        return unknown(cache_key, Some("config".into()));
    };
    let orgs = match get_json(http, cookie, &format!("{base_url}/api/organizations")) {
        Ok(json) => json,
        Err(reason) => return unknown(cache_key, Some(reason)),
    };
    let Some(org) = pick_org(&orgs, cookie) else {
        return unknown(cache_key, Some("org".into()));
    };
    let Some(uuid) = org.get("uuid").and_then(Value::as_str) else {
        return unknown(cache_key, Some("org".into()));
    };
    let org_url = format!("{base_url}/api/organizations/{uuid}");
    let usage = match get_json(http, cookie, &format!("{org_url}/usage")) {
        Ok(json) => json,
        Err(reason) => return unknown(cache_key, Some(reason)),
    };
    let windows = parse_windows(&usage);
    if windows.is_empty() {
        return unknown(cache_key, Some("usage".into()));
    }
    // Best effort: the ticket lives behind an experiment query param, so an
    // account without one (or a renamed param) still gets its windows.
    let tickets = get_json(
        http,
        cookie,
        &format!("{org_url}/usage?{RESET_PROGRAM}=1&skip_spend=1"),
    )
    .map(|json| parse_tickets(&json))
    .unwrap_or_default();
    let exhausted = windows.iter().any(|window| window.used_percent >= 100.0);
    let reset_at = windows
        .iter()
        .filter(|window| window.used_percent >= 100.0)
        .filter_map(|window| window.reset_at)
        .min()
        .or_else(|| windows.iter().filter_map(|window| window.reset_at).min());
    // Best effort: an unreadable subscription leaves the plan and no bill line
    // instead of failing a probe that already holds its windows.
    let subscription = get_json(http, cookie, &format!("{org_url}/subscription_details")).ok();
    ProbeOutcome {
        plan: parse_plan(org, subscription.as_ref()),
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
        tickets,
        renews_at: subscription.as_ref().and_then(parse_renews_at),
    }
}

/// One GET with the session cookie; the `Err` is the probe's `reason`.
/// One GET with the session cookie; the `Err` carries an `anyhow` error for
/// callers outside the probe's `reason` vocabulary (the redeem path).
fn get_json_raw(http: &dyn Http, cookie: &str, url: &str) -> Result<Value> {
    let response = authed_get(http, cookie, url)?;
    if response.status >= 400 {
        return Err(anyhow::anyhow!("http:{}", response.status));
    }
    serde_json::from_str(&response.body).map_err(|_| anyhow::anyhow!("unreadable response"))
}

/// One GET with the session cookie; the `Err` is the probe's `reason`.
fn get_json(http: &dyn Http, cookie: &str, url: &str) -> std::result::Result<Value, String> {
    let response = authed_get(http, cookie, url).map_err(|_| "network".to_string())?;
    match response.status {
        401 => return Err("cookie".into()),
        403 if response.body.contains("Just a moment") => return Err("challenge".into()),
        status if status >= 400 => return Err(format!("http:{status}")),
        _ => {}
    }
    serde_json::from_str(&response.body).map_err(|_| "usage".to_string())
}

/// The cookie's `lastActiveOrg` is the org the web app has open, so it wins; an
/// account with several orgs otherwise falls to the first one that carries a
/// paid plan, then to the first at all.
pub fn pick_org<'a>(orgs: &'a Value, cookie: &str) -> Option<&'a Value> {
    let list = orgs.as_array()?;
    if let Some(active) = cookie_value(cookie, "lastActiveOrg") {
        if let Some(found) = list
            .iter()
            .find(|org| org.get("uuid").and_then(Value::as_str) == Some(active))
        {
            return Some(found);
        }
    }
    list.iter()
        .find(|org| plan_key(org).is_some())
        .or_else(|| list.first())
}

fn cookie_value<'a>(cookie: &'a str, name: &str) -> Option<&'a str> {
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key.trim() == name)
            .then(|| value.trim())
            .filter(|value| !value.is_empty())
    })
}

/// `capabilities` lists `claude_pro` / `claude_max` next to the generic `chat`.
fn plan_key(org: &Value) -> Option<&str> {
    org.get("capabilities")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_str)
        .find(|capability| capability.starts_with("claude_"))
}

pub fn parse_plan(org: &Value, subscription: Option<&Value>) -> Option<PlanState> {
    let name = plan_key(org)?;
    let ends_at = subscription
        .and_then(|value| value.get("plan_ending_at"))
        .and_then(Value::as_str)
        .and_then(parse_iso_unix);
    let status_active = subscription
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .map(|status| status == "active")
        .unwrap_or(true);
    Some(PlanState {
        name: name.to_string(),
        display: plan_display(name),
        // A scheduled cancellation keeps the plan live until `plan_ending_at`.
        active: status_active && ends_at.is_none(),
        ends_at,
    })
}

/// Next charge instant; the date-only field covers a response without `_at`.
pub fn parse_renews_at(subscription: &Value) -> Option<i64> {
    subscription
        .get("next_charge_at")
        .and_then(Value::as_str)
        .and_then(parse_iso_unix)
        .or_else(|| {
            subscription
                .get("next_charge_date")
                .and_then(Value::as_str)
                .and_then(|date| parse_iso_unix(&format!("{date}T00:00:00Z")))
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
            limit_cents: None,
        });
    }
    windows
}

/// Reset-ticket grants from the `cedar_ember` block of a usage response. A
/// spent grant (`resets_left` 0) is not a card row, and a grant without an
/// expiry carries none.
pub fn parse_tickets(json: &Value) -> Vec<ResetTicket> {
    let Some(grants) = json
        .get(RESET_PROGRAM)
        .and_then(|block| block.get("grants"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    grants
        .iter()
        .filter_map(|grant| {
            let id = grant.get("id").and_then(Value::as_str)?.to_string();
            let resets_left = grant.get("resets_left").and_then(Value::as_u64)? as u32;
            if resets_left == 0 {
                return None;
            }
            Some(ResetTicket {
                id,
                label: grant
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                resets_left,
                expires_at: grant
                    .get("ends_at")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_unix)
                    .unwrap_or(i64::MAX),
            })
        })
        .collect()
}

fn authed_get(http: &dyn Http, cookie: &str, url: &str) -> Result<crate::http::HttpResponse> {
    http.get(
        url,
        &[
            ("accept", "application/json"),
            ("user-agent", USER_AGENT),
            ("cookie", cookie),
        ],
    )
}

/// Redeem one reset ticket. Spends the account's grant for real; the caller
/// must only reach this on an explicit confirmation.
pub fn redeem(
    http: &dyn Http,
    cookie: Option<&str>,
    base_url: &str,
    grant_id: &str,
) -> Result<RedeemOutcome> {
    let cookie = cookie
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing CLAUDE_COOKIE"))?;
    let orgs = get_json_raw(http, cookie, &format!("{base_url}/api/organizations"))?;
    let org = pick_org(&orgs, cookie).ok_or_else(|| anyhow::anyhow!("no organization"))?;
    let uuid = org
        .get("uuid")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("no organization"))?;
    let body = serde_json::json!({
        "program": RESET_PROGRAM,
        "grant_id": grant_id,
        "request_id": uuid::Uuid::new_v4().to_string(),
    })
    .to_string();
    let response = http
        .post(
            &format!("{base_url}/api/organizations/{uuid}/reset_rate_limits"),
            &[
                ("accept", "application/json"),
                ("user-agent", USER_AGENT),
                ("cookie", cookie),
            ],
            &body,
        )
        .map_err(|_| anyhow::anyhow!("network"))?;
    if response.status >= 400 {
        // 4xx is the provider's verdict on the ticket, not a transport error:
        // keep the result so the caller can tell the user what happened.
        return Ok(RedeemOutcome {
            provider: "claude".into(),
            result: "error".into(),
            resets_left: None,
        });
    }
    let json: Value = serde_json::from_str(&response.body)
        .map_err(|_| anyhow::anyhow!("unreadable reset response"))?;
    Ok(RedeemOutcome {
        provider: "claude".into(),
        result: parse_redeem_result(&json),
        resets_left: json
            .get("resets_left")
            .and_then(Value::as_u64)
            .map(|left| left as u32),
    })
}

/// The redeem endpoint answers the verdict in `result`; anything unrecognized
/// is the board's `error`.
fn parse_redeem_result(json: &Value) -> String {
    const RESULTS: [&str; 6] = [
        "reset",
        "already_used",
        "not_limited",
        "cooldown",
        "ineligible",
        "unavailable",
    ];
    json.get("result")
        .and_then(Value::as_str)
        .filter(|result| RESULTS.contains(result))
        .unwrap_or("error")
        .to_string()
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
        tickets: Vec::new(),
        renews_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MapHttp;
    use serde_json::json;

    const COOKIE: &str = "sessionKey=sk-1; lastActiveOrg=org-pro; cf_clearance=cf-2";
    const SESSION_RESET_ISO: &str = "2026-09-27T14:00:00+00:00";
    const WEEKLY_RESET_ISO: &str = "2026-09-29T15:00:00+00:00";
    const NEXT_CHARGE_ISO: &str = "2026-10-27T08:48:49Z";

    fn org(uuid: &str, capabilities: &[&str]) -> Value {
        json!({ "uuid": uuid, "name": "EasyDev", "capabilities": capabilities })
    }

    fn orgs_body(orgs: Vec<Value>) -> String {
        Value::Array(orgs).to_string()
    }

    /// Trimmed from a real `GET /api/organizations/{uuid}/usage`.
    fn usage_body(session_percent: f64, weekly_percent: f64) -> String {
        json!({
            "five_hour": { "utilization": session_percent, "resets_at": SESSION_RESET_ISO },
            "seven_day": { "utilization": weekly_percent, "resets_at": WEEKLY_RESET_ISO },
            "seven_day_opus": null,
            "limits": [
                { "kind": "session", "group": "session", "percent": session_percent,
                  "resets_at": SESSION_RESET_ISO, "is_active": false },
                { "kind": "weekly_all", "group": "weekly", "percent": weekly_percent,
                  "resets_at": WEEKLY_RESET_ISO, "is_active": true }
            ],
            "extra_usage": { "is_enabled": false }
        })
        .to_string()
    }

    fn subscription_body(status: &str, ending_at: Option<&str>) -> String {
        json!({
            "status": status,
            "billing_interval": "monthly",
            "next_charge_date": "2026-10-27",
            "next_charge_at": NEXT_CHARGE_ISO,
            "plan_ending_at": ending_at,
        })
        .to_string()
    }

    /// Most specific pattern first: `contains` would let `/api/organizations`
    /// swallow the per-org paths.
    fn routes(orgs: (u16, String), usage: (u16, String), subscription: (u16, String)) -> MapHttp {
        MapHttp {
            routes: vec![
                (
                    "/subscription_details".into(),
                    subscription.0,
                    subscription.1,
                ),
                ("usage?cedar_ember=1".into(), 200, usage_body(0.0, 0.0)),
                ("/usage".into(), usage.0, usage.1),
                ("/api/organizations".into(), orgs.0, orgs.1),
            ],
        }
    }

    /// A usage response that also carries one reset-ticket grant.
    fn tickets_body() -> String {
        json!({
            "cedar_ember": {
                "eligible": true,
                "next_grant_id": "opus55-launch-promax-20260921",
                "weekly_resets_at": "2026-10-20T15:00:00+00:00",
                "grants": [
                    {
                        "id": "opus55-launch-promax-20260921",
                        "label": "Claude Opus 5.5 launch: one usage-limit reset for Pro and Max",
                        "resets_total": 1,
                        "resets_left": 1,
                        "starts_at": "2026-09-22T16:00:00+00:00",
                        "ends_at": "2026-10-22T16:00:00+00:00",
                        "paused": false,
                        "usable_now": true,
                    },
                    {
                        "id": "spent-grant",
                        "resets_total": 1,
                        "resets_left": 0,
                        "ends_at": "2026-10-22T16:00:00+00:00",
                    }
                ]
            }
        })
        .to_string()
    }

    /// Pro routes whose ticket GET answers with `tickets_body`.
    fn ticketed_routes() -> MapHttp {
        let mut map = pro_routes(42.0, 5.0);
        map.routes[1].2 = tickets_body();
        map
    }

    fn pro_routes(session_percent: f64, weekly_percent: f64) -> MapHttp {
        routes(
            (
                200,
                orgs_body(vec![org("org-pro", &["claude_pro", "chat"])]),
            ),
            (200, usage_body(session_percent, weekly_percent)),
            (200, subscription_body("active", None)),
        )
    }

    #[test]
    fn probe_maps_session_weekly_plan_and_next_charge() {
        let outcome = probe(&pro_routes(33.0, 5.0), Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.reason, None);
        assert_eq!(outcome.windows.len(), 2);
        assert_eq!(outcome.windows[0].name, "5h");
        assert_eq!(outcome.windows[0].used_percent, 33.0);
        assert_eq!(
            outcome.windows[0].reset_at,
            Some(parse_iso_unix(SESSION_RESET_ISO).unwrap())
        );
        assert_eq!(outcome.windows[1].name, "weekly");
        assert_eq!(outcome.windows[1].used_percent, 5.0);
        // A subscription quota has no balance; the bill date is the card's.
        assert_eq!(outcome.remaining_credits, None);
        assert_eq!(
            outcome.renews_at,
            Some(parse_iso_unix(NEXT_CHARGE_ISO).unwrap())
        );
        let plan = outcome.plan.expect("plan from the org");
        assert_eq!(plan.name, "claude_pro");
        assert_eq!(plan.display.as_deref(), Some("Pro"));
        assert!(plan.active);
        assert_eq!(plan.ends_at, None);
        assert_eq!(
            outcome.cache_key,
            crate::auth::cache_key("claude", Some(COOKIE))
        );
    }

    #[test]
    fn a_full_session_window_is_exhausted_at_its_reset() {
        let outcome = probe(&pro_routes(100.0, 12.0), Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("window"));
        assert_eq!(
            outcome.reset_at,
            Some(parse_iso_unix(SESSION_RESET_ISO).unwrap())
        );
        assert_eq!(outcome.windows.len(), 2);
    }

    #[test]
    fn a_full_weekly_window_reports_the_weekly_reset() {
        let outcome = probe(&pro_routes(10.0, 100.0), Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(
            outcome.reset_at,
            Some(parse_iso_unix(WEEKLY_RESET_ISO).unwrap())
        );
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
    fn a_rejected_cookie_is_unknown_with_the_cookie_reason() {
        let http = MapHttp {
            routes: vec![(
                "/api/organizations".into(),
                401,
                r#"{"error":"auth"}"#.into(),
            )],
        };
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("cookie"));
        assert!(outcome.windows.is_empty());
        assert_eq!(outcome.plan, None);
    }

    #[test]
    fn a_cloudflare_challenge_is_its_own_reason() {
        let http = MapHttp {
            routes: vec![(
                "/api/organizations".into(),
                403,
                "<!DOCTYPE html><title>Just a moment...</title>".into(),
            )],
        };
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.reason.as_deref(), Some("challenge"));
        // Any other 403 keeps its status.
        let http = MapHttp {
            routes: vec![("/api/organizations".into(), 403, "{}".into())],
        };
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.reason.as_deref(), Some("http:403"));
    }

    #[test]
    fn a_missing_cookie_never_reaches_the_network() {
        // No routes: any request would answer 404, not `config`.
        let http = MapHttp { routes: Vec::new() };
        for cookie in [None, Some("  ")] {
            let outcome = probe(&http, cookie, DEFAULT_BASE);
            assert_eq!(outcome.reason.as_deref(), Some("config"));
            assert_eq!(outcome.cache_key, "claude:anon");
        }
    }

    #[test]
    fn a_dead_subscription_keeps_the_windows_and_the_plan() {
        let http = routes(
            (
                200,
                orgs_body(vec![org("org-pro", &["claude_pro", "chat"])]),
            ),
            (200, usage_body(33.0, 5.0)),
            (500, String::new()),
        );
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows.len(), 2);
        assert_eq!(outcome.renews_at, None);
        assert_eq!(outcome.plan.expect("plan").name, "claude_pro");
    }

    #[test]
    fn a_usage_body_without_limits_is_unknown() {
        let http = routes(
            (200, orgs_body(vec![org("org-pro", &["claude_pro"])])),
            (200, json!({ "spend": { "enabled": false } }).to_string()),
            (200, subscription_body("active", None)),
        );
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("usage"));
    }

    #[test]
    fn an_empty_org_list_is_unknown() {
        let http = routes(
            (200, "[]".into()),
            (200, usage_body(1.0, 2.0)),
            (200, subscription_body("active", None)),
        );
        let outcome = probe(&http, Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.reason.as_deref(), Some("org"));
    }

    #[test]
    fn the_org_the_web_app_has_open_wins() {
        let orgs = json!([
            org("org-team", &["claude_max", "chat"]),
            org("org-pro", &["claude_pro", "chat"]),
        ]);
        let picked = pick_org(&orgs, COOKIE).expect("org");
        assert_eq!(picked["uuid"], "org-pro");
        // No `lastActiveOrg`: the first org carrying a Claude plan.
        let orgs = json!([org("org-api", &["api"]), org("org-pro", &["claude_pro"])]);
        assert_eq!(
            pick_org(&orgs, "sessionKey=sk-1").expect("org")["uuid"],
            "org-pro"
        );
        // A `lastActiveOrg` the account no longer has falls back, never fails.
        let orgs = json!([org("org-api", &["api"])]);
        assert_eq!(
            pick_org(&orgs, "lastActiveOrg=gone").expect("org")["uuid"],
            "org-api"
        );
    }

    #[test]
    fn an_unpriced_plan_keeps_its_label_and_loses_its_price() {
        let max = org("org-max", &["claude_max", "chat"]);
        let plan = parse_plan(&max, None).expect("plan");
        assert_eq!(plan.name, "claude_max");
        // The label is derived; the price is the board's decision, not the
        // probe's, because Max tiers share one key and two prices.
        assert_eq!(plan.display.as_deref(), Some("Max"));
        assert_eq!(plan_display("claude_pro").as_deref(), Some("Pro"));
        assert_eq!(
            plan_display("claude_enterprise").as_deref(),
            Some("Enterprise")
        );
        assert_eq!(plan_display(""), None);
        assert_eq!(parse_plan(&org("org-api", &["api"]), None), None);
    }

    #[test]
    fn a_canceled_or_ending_subscription_is_not_active() {
        let pro = org("org-pro", &["claude_pro"]);
        let canceled: Value = serde_json::from_str(&subscription_body("canceled", None)).unwrap();
        assert!(!parse_plan(&pro, Some(&canceled)).expect("plan").active);
        let ending: Value =
            serde_json::from_str(&subscription_body("active", Some("2026-11-01T00:00:00Z")))
                .unwrap();
        let plan = parse_plan(&pro, Some(&ending)).expect("plan");
        assert!(!plan.active);
        assert_eq!(
            plan.ends_at,
            Some(parse_iso_unix("2026-11-01T00:00:00Z").unwrap())
        );
        let active: Value = serde_json::from_str(&subscription_body("active", None)).unwrap();
        assert!(parse_plan(&pro, Some(&active)).expect("plan").active);
    }

    #[test]
    fn next_charge_falls_back_to_the_date_only_field() {
        let date_only = json!({ "next_charge_date": "2026-10-27" });
        assert_eq!(
            parse_renews_at(&date_only),
            Some(parse_iso_unix("2026-10-27T00:00:00Z").unwrap())
        );
        assert_eq!(parse_renews_at(&json!({})), None);
    }

    #[test]
    fn probe_carries_the_unspent_reset_tickets() {
        let outcome = probe(&ticketed_routes(), Some(COOKIE), DEFAULT_BASE);
        assert_eq!(outcome.windows.len(), 2);
        assert_eq!(outcome.tickets.len(), 1);
        let ticket = &outcome.tickets[0];
        assert_eq!(ticket.id, "opus55-launch-promax-20260921");
        assert_eq!(ticket.resets_left, 1);
        assert_eq!(
            ticket.expires_at,
            parse_iso_unix("2026-10-22T16:00:00+00:00").unwrap()
        );
        assert!(ticket
            .label
            .as_deref()
            .unwrap()
            .starts_with("Claude Opus 5.5"));
    }

    #[test]
    fn a_usage_response_without_the_experiment_block_has_no_tickets() {
        let outcome = probe(&pro_routes(10.0, 20.0), Some(COOKIE), DEFAULT_BASE);
        assert!(outcome.tickets.is_empty());
    }

    #[test]
    fn parse_tickets_skips_a_spent_or_expiry_less_grant() {
        let mut json: Value = serde_json::from_str(&tickets_body()).unwrap();
        let grants = json
            .get_mut("cedar_ember")
            .and_then(|block| block.get_mut("grants"))
            .and_then(Value::as_array_mut)
            .expect("grants");
        grants.push(json!({
            "id": "no-expiry",
            "resets_left": 2,
        }));
        let tickets = parse_tickets(&json);
        assert_eq!(
            tickets.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["opus55-launch-promax-20260921", "no-expiry"]
        );
        assert_eq!(tickets[1].expires_at, i64::MAX);
        assert_eq!(parse_tickets(&json!({})).len(), 0);
    }

    #[test]
    fn redeem_posts_the_grant_and_reads_the_verdict() {
        let http = MapHttp {
            routes: vec![
                (
                    "POST https://claude.ai/api/organizations/org-pro/reset_rate_limits".into(),
                    200,
                    json!({ "result": "reset", "resets_left": 0, "cleared": ["five_hour", "seven_day"] })
                        .to_string(),
                ),
                (
                    "/api/organizations".into(),
                    200,
                    orgs_body(vec![org("org-pro", &["claude_pro"])]),
                ),
            ],
        };
        let outcome = redeem(
            &http,
            Some(COOKIE),
            DEFAULT_BASE,
            "opus55-launch-promax-20260921",
        )
        .expect("redeem");
        assert_eq!(outcome.provider, "claude");
        assert_eq!(outcome.result, "reset");
        assert_eq!(outcome.resets_left, Some(0));
    }

    #[test]
    fn redeem_maps_an_unknown_verdict_and_a_rejected_cookie_to_errors() {
        let unknown = MapHttp {
            routes: vec![
                (
                    "POST https://claude.ai/api/organizations/org-pro/reset_rate_limits".into(),
                    200,
                    json!({ "result": "whatever" }).to_string(),
                ),
                (
                    "/api/organizations".into(),
                    200,
                    orgs_body(vec![org("org-pro", &["claude_pro"])]),
                ),
            ],
        };
        assert_eq!(
            redeem(&unknown, Some(COOKIE), DEFAULT_BASE, "g")
                .unwrap()
                .result,
            "error"
        );
        assert!(redeem(&pro_routes(1.0, 1.0), None, DEFAULT_BASE, "g").is_err());
    }
}
