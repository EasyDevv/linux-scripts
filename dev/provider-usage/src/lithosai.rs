//! LithosAI probe.
//!
//! LithosAI is prepaid: every request debits an organization credit balance,
//! there is no subscription to renew and no rate window to reset. The
//! OpenAI-compatible API has no balance read, but the console does expose
//! `GET /api/billing` `balanceNanos` to a signed-in console session. The pasted
//! console cookie (`LITHOSAI_COOKIE`) is therefore the only credential: it
//! names the account and reads the balance. A missing cookie is `config`, a
//! rejected one is `cookie`; the API key is not consulted.
//!
//! Credit is topped up by hand, so the percentage anchor is the newest positive
//! `GET /api/billing/history` entry (top-up, promotion or bonus): the `Credit`
//! window reports how much of that purchase is spent. No usable history leaves
//! the card with a balance and no bar.

use serde_json::Value;

use crate::cache::{ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;
use crate::iso::parse_iso_unix;

pub const CONSOLE_BASE: &str = "https://console.lithosai.cloud";

/// `balanceNanos` are 1e-9 dollars; the cache carries credits in cents.
const NANOS_PER_CENT: i64 = 10_000_000;

/// The cookie names the account, so a re-login keys a fresh snapshot.
pub fn cache_key(cookie: Option<&str>) -> String {
    crate::auth::cache_key("lithosai", trimmed(cookie))
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn outcome(
    cache_key: String,
    state: ProviderState,
    reason: Option<String>,
    remaining_cents: Option<i64>,
    windows: Vec<UsageWindow>,
) -> ProbeOutcome {
    ProbeOutcome {
        plan: None,
        cache_key,
        state,
        reason,
        reset_at: None,
        remaining_credits: remaining_cents,
        windows,
        renews_at: None,
    }
}

fn unknown(cache_key: String, reason: &str) -> ProbeOutcome {
    outcome(
        cache_key,
        ProviderState::Unknown,
        Some(reason.to_string()),
        None,
        Vec::new(),
    )
}

/// Remaining prepaid credit from the console billing summary, in nanos.
pub fn parse_balance_nanos(body: &str) -> Option<i64> {
    let json: Value = serde_json::from_str(body).ok()?;
    json.get("balanceNanos")?.as_i64()
}

fn entry_created_at(entry: &Value) -> Option<i64> {
    let value = entry.get("createdAt")?;
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(parse_iso_unix))
}

/// The newest credit the organization bought or was granted, in nanos.
///
/// One purchase posts several lines (the live payload pairs a `grant` with a
/// `promotion`), so the newest positive entry only names the purchase and the
/// whole `purchaseId` group is summed. Entries may arrive in either order, so
/// the pick follows `createdAt` and falls back to the first positive entry when
/// the timestamps are unusable. A refunded group sums to zero and yields no
/// anchor.
pub fn parse_latest_credit_nanos(body: &str) -> Option<i64> {
    let json: Value = serde_json::from_str(body).ok()?;
    let entries = json.get("entries")?.as_array()?;
    let mut newest: Option<(Option<i64>, &Value)> = None;
    for entry in entries {
        match amount_of(entry) {
            Some(amount) if amount > 0 => {}
            _ => continue,
        }
        let created_at = entry_created_at(entry);
        let replace = match &newest {
            None => true,
            Some((previous, _)) => {
                matches!((previous, created_at), (Some(before), Some(now)) if now > *before)
            }
        };
        if replace {
            newest = Some((created_at, entry));
        }
    }
    let (_, newest) = newest?;
    let purchase = newest
        .get("purchaseId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let total: i64 = match purchase {
        Some(id) => entries
            .iter()
            .filter(|entry| entry.get("purchaseId").and_then(Value::as_str) == Some(id))
            .filter_map(amount_of)
            .sum(),
        None => amount_of(newest).unwrap_or(0),
    };
    (total > 0).then_some(total)
}

fn amount_of(entry: &Value) -> Option<i64> {
    entry.get("amountNanos").and_then(Value::as_i64)
}

/// Spent share of the newest manual purchase, as the card's `Credit` window.
fn credit_window(balance_nanos: i64, credit_nanos: i64) -> Option<UsageWindow> {
    if credit_nanos <= 0 {
        return None;
    }
    let used = (credit_nanos - balance_nanos).max(0) as f64 / credit_nanos as f64 * 100.0;
    Some(UsageWindow {
        name: "Credit".into(),
        used_percent: used.clamp(0.0, 100.0),
        reset_at: None,
    })
}

fn balance_outcome(cache_key: String, nanos: i64, windows: Vec<UsageWindow>) -> ProbeOutcome {
    let exhausted = nanos <= 0;
    outcome(
        cache_key,
        if exhausted {
            ProviderState::Exhausted
        } else {
            ProviderState::Available
        },
        exhausted.then(|| "balance".to_string()),
        Some(nanos.max(0) / NANOS_PER_CENT),
        windows,
    )
}

pub fn probe(http: &dyn Http, cookie: Option<&str>) -> ProbeOutcome {
    let key = cache_key(cookie);
    let Some(cookie) = trimmed(cookie) else {
        return unknown(key, "config");
    };
    match read_console(http, cookie) {
        ConsoleRead::Balance(nanos) => {
            let windows = read_latest_credit(http, cookie)
                .and_then(|credit| credit_window(nanos, credit))
                .into_iter()
                .collect();
            balance_outcome(key, nanos, windows)
        }
        ConsoleRead::Unreadable => unknown(key, "billing"),
        ConsoleRead::Expired => unknown(key, "cookie"),
        ConsoleRead::Network => unknown(key, "network"),
        ConsoleRead::Failed(status) => unknown(key, &format!("http:{status}")),
    }
}

enum ConsoleRead {
    Balance(i64),
    Unreadable,
    Expired,
    Network,
    Failed(u16),
}

fn read_console(http: &dyn Http, cookie: &str) -> ConsoleRead {
    let response = match http.get(
        &format!("{CONSOLE_BASE}/api/billing"),
        &[("accept", "application/json"), ("cookie", cookie)],
    ) {
        Ok(response) => response,
        Err(_) => return ConsoleRead::Network,
    };
    match response.status {
        200 => match parse_balance_nanos(&response.body) {
            Some(nanos) => ConsoleRead::Balance(nanos),
            None => ConsoleRead::Unreadable,
        },
        401 | 403 => ConsoleRead::Expired,
        status => ConsoleRead::Failed(status),
    }
}

/// The manual top-up anchor. Any failure only drops the bar: the balance is
/// still worth showing, so a broken history never fails the probe.
fn read_latest_credit(http: &dyn Http, cookie: &str) -> Option<i64> {
    let response = http
        .get(
            &format!("{CONSOLE_BASE}/api/billing/history"),
            &[("accept", "application/json"), ("cookie", cookie)],
        )
        .ok()?;
    if response.status != 200 {
        return None;
    }
    parse_latest_credit_nanos(&response.body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MapHttp;

    fn http(routes: Vec<(&str, u16, &str)>) -> MapHttp {
        MapHttp {
            routes: routes
                .into_iter()
                .map(|(pattern, status, body)| (pattern.to_string(), status, body.to_string()))
                .collect(),
        }
    }

    #[test]
    fn console_balance_becomes_remaining_credits() {
        let http = http(vec![(
            "console.lithosai.cloud/api/billing",
            200,
            r#"{"balanceNanos":12340000000,"floorNanos":0,"billed":true,"hasCard":true,"onHold":false,"publishableKey":"pk"}"#,
        )]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(1234));
        assert_eq!(outcome.reason, None);
        assert!(outcome.windows.is_empty());
        assert_eq!(
            outcome.cache_key,
            crate::auth::cache_key("lithosai", Some("session=abc"))
        );
    }

    #[test]
    fn empty_balance_is_exhausted_and_fully_spent() {
        let http = http(vec![
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[{"kind":"topup","amountNanos":10000000000,"createdAt":"2026-09-10T00:00:00.000Z"}],"nextCursor":null}"#,
            ),
            (
                "console.lithosai.cloud/api/billing",
                200,
                r#"{"balanceNanos":0,"billed":true}"#,
            ),
        ]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("balance"));
        assert_eq!(outcome.remaining_credits, Some(0));
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].name, "Credit");
        assert_eq!(outcome.windows[0].used_percent, 100.0);
        assert_eq!(outcome.windows[0].reset_at, None);
    }

    #[test]
    fn manual_top_up_anchors_the_credit_window() {
        let http = http(vec![
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[{"kind":"promotion","amountNanos":1000000000,"createdAt":"2026-09-01T00:00:00.000Z"},{"kind":"topup","amountNanos":10000000000,"createdAt":"2026-09-20T00:00:00.000Z"},{"kind":"spend","amountNanos":-3000000000,"createdAt":"2026-09-21T00:00:00.000Z"}],"nextCursor":null}"#,
            ),
            (
                "console.lithosai.cloud/api/billing",
                200,
                r#"{"balanceNanos":6200000000,"billed":true,"reload":{"enabled":false}}"#,
            ),
        ]);
        let outcome = probe(&http, Some("session=abc"));
        // $10.00 bought on 2026-09-20, $6.20 left -> 38% spent.
        assert_eq!(outcome.remaining_credits, Some(620));
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].used_percent, 38.0);
    }

    #[test]
    fn one_purchase_with_two_lines_is_summed() {
        // Live shape (2026-09-26): a $10 grant and a $20 promotion in one purchase.
        let http = http(vec![
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[{"kind":"promotion","amountNanos":20000000000,"purchaseId":"p1","purchaseKind":"manual","createdAt":"2026-09-26T01:59:51.135709Z"},{"kind":"grant","amountNanos":10000000000,"purchaseId":"p1","purchaseKind":"manual","createdAt":"2026-09-26T01:59:51.133330Z"}],"nextCursor":null}"#,
            ),
            (
                "console.lithosai.cloud/api/billing",
                200,
                r#"{"balanceNanos":29150000000,"billed":true}"#,
            ),
        ]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.remaining_credits, Some(2915));
        assert_eq!(outcome.windows.len(), 1);
        // $30.00 bought, $29.15 left -> 2.83% spent.
        let used = outcome.windows[0].used_percent;
        assert!((used - 2.83).abs() < 0.01, "used was {used}");
    }

    #[test]
    fn balance_above_the_top_up_clamps_to_zero() {
        let http = http(vec![
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[{"kind":"topup","amountNanos":10000000000,"createdAt":"2026-09-20T00:00:00.000Z"}]}"#,
            ),
            (
                "console.lithosai.cloud/api/billing",
                200,
                r#"{"balanceNanos":15000000000,"billed":true}"#,
            ),
        ]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows[0].used_percent, 0.0);
    }

    #[test]
    fn unusable_history_keeps_the_balance_without_a_bar() {
        for failure in [
            (
                "console.lithosai.cloud/api/billing/history",
                401,
                r#"{"error":"unauthenticated"}"#,
            ),
            ("console.lithosai.cloud/api/billing/history", 500, ""),
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[{"kind":"spend","amountNanos":-1000}],"nextCursor":null}"#,
            ),
            (
                "console.lithosai.cloud/api/billing/history",
                200,
                r#"{"entries":[],"nextCursor":null}"#,
            ),
        ] {
            let http = http(vec![
                failure,
                (
                    "console.lithosai.cloud/api/billing",
                    200,
                    r#"{"balanceNanos":6200000000,"billed":true}"#,
                ),
            ]);
            let outcome = probe(&http, Some("session=abc"));
            assert_eq!(outcome.state, ProviderState::Available);
            assert_eq!(outcome.remaining_credits, Some(620));
            assert!(outcome.windows.is_empty());
        }
    }

    #[test]
    fn parse_latest_credit_nanos_picks_the_newest_positive() {
        assert_eq!(
            parse_latest_credit_nanos(
                r#"{"entries":[{"amountNanos":1000,"createdAt":"2026-09-01T00:00:00Z"},{"amountNanos":5000,"createdAt":"2026-09-20T00:00:00Z"}]}"#
            ),
            Some(5000)
        );
        // Without usable timestamps the first positive entry wins.
        assert_eq!(
            parse_latest_credit_nanos(r#"{"entries":[{"amountNanos":700},{"amountNanos":900}]}"#),
            Some(700)
        );
        // One purchase's lines are summed, and older purchases are ignored.
        assert_eq!(
            parse_latest_credit_nanos(
                r#"{"entries":[{"amountNanos":1000,"purchaseId":"p1","createdAt":"2026-09-01T00:00:00Z"},{"amountNanos":500,"purchaseId":"p1","createdAt":"2026-09-01T00:00:00Z"},{"amountNanos":400,"purchaseId":"p0","createdAt":"2026-08-01T00:00:00Z"}]}"#
            ),
            Some(1500)
        );
        // A refunded purchase leaves no anchor at all.
        assert_eq!(
            parse_latest_credit_nanos(
                r#"{"entries":[{"amountNanos":1000,"purchaseId":"p2","createdAt":"2026-09-02T00:00:00Z"},{"amountNanos":-1000,"purchaseId":"p2","createdAt":"2026-09-03T00:00:00Z"}]}"#
            ),
            None
        );
        // Debits and unknown bodies never anchor the bar.
        assert_eq!(
            parse_latest_credit_nanos(r#"{"entries":[{"amountNanos":-700}]}"#),
            None
        );
        assert_eq!(parse_latest_credit_nanos(r#"{"entries":[]}"#), None);
        assert_eq!(parse_latest_credit_nanos("not json"), None);
    }

    #[test]
    fn unreadable_billing_body_is_unknown() {
        let http = http(vec![(
            "console.lithosai.cloud/api/billing",
            200,
            r#"{"balance":"12.34"}"#,
        )]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("billing"));
    }

    #[test]
    fn rejected_console_cookie_is_unknown_with_the_cookie_reason() {
        let http = http(vec![(
            "console.lithosai.cloud/api/billing",
            401,
            r#"{"error":"unauthenticated"}"#,
        )]);
        let outcome = probe(&http, Some("session=stale"));
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("cookie"));
        assert_eq!(outcome.remaining_credits, None);
        assert!(outcome.windows.is_empty());
    }

    #[test]
    fn a_missing_or_blank_cookie_never_reaches_the_network() {
        // No routes: any request would answer 404, not `config`.
        let http = http(Vec::new());
        for cookie in [None, Some("   ")] {
            let outcome = probe(&http, cookie);
            assert_eq!(outcome.state, ProviderState::Unknown);
            assert_eq!(outcome.reason.as_deref(), Some("config"));
            assert_eq!(outcome.cache_key, "lithosai:anon");
        }
    }

    #[test]
    fn console_outage_is_unknown_with_status() {
        let http = http(vec![("console.lithosai.cloud/api/billing", 500, "")]);
        let outcome = probe(&http, Some("session=abc"));
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("http:500"));
    }

    #[test]
    fn parse_balance_nanos_requires_an_integer_field() {
        assert_eq!(parse_balance_nanos(r#"{"balanceNanos":-5}"#), Some(-5));
        assert_eq!(parse_balance_nanos(r#"{"balanceNanos":"5"}"#), None);
        assert_eq!(parse_balance_nanos("not json"), None);
    }
}
