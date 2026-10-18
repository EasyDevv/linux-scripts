//! OpenRouter probe.
//!
//! OpenRouter is prepaid: credits are bought up front and every request debits
//! the balance, so there is no subscription to renew and no rate window to
//! reset. `GET /api/v1/credits` answers the lifetime totals in dollars —
//! `total_credits` bought, `total_usage` spent — and the balance is the
//! difference. `total_credits` is therefore the purchase anchor for the card's
//! `Credit` window: it is the only limit reference the key can read.
//!
//! The account activity feed (`GET /api/v1/activity`) is management-key only
//! (403 for a normal key), so the card never asks for it: dated daily spend
//! comes from the board's own balance snapshots, exactly as for LithosAI.
//!
//! The key is `OPENROUTER_API_KEY`; a missing key is `config`, a rejected one
//! is `key`.

use serde_json::Value;

use crate::cache::{ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const API_BASE: &str = "https://openrouter.ai/api/v1";

/// Lifetime credits bought and spent, in cents.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Credits {
    pub bought_cents: i64,
    pub spent_cents: i64,
}

impl Credits {
    fn remaining_cents(self) -> i64 {
        (self.bought_cents - self.spent_cents).max(0)
    }
}

pub fn cache_key(key: Option<&str>) -> String {
    crate::auth::cache_key("openrouter", trimmed(key))
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
        tickets: Vec::new(),
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

/// Dollars to cents without letting a non-finite number through as a value.
fn cents(dollars: f64) -> Option<i64> {
    dollars
        .is_finite()
        .then(|| (dollars * 100.0).round() as i64)
}

pub fn parse_credits(body: &str) -> Option<Credits> {
    let json: Value = serde_json::from_str(body).ok()?;
    let data = json.get("data")?;
    let bought = cents(data.get("total_credits")?.as_f64()?)?;
    let spent = cents(data.get("total_usage")?.as_f64()?)?;
    Some(Credits {
        bought_cents: bought,
        spent_cents: spent,
    })
}

/// Spent share of the credits bought, as the card's `Credit` window.
///
/// A balance above what was bought (a bonus grant) clamps to no spend, and an
/// account with no purchase on record has no anchor, so it keeps the balance
/// text and no bar.
fn credit_window(credits: Credits) -> Option<UsageWindow> {
    if credits.bought_cents <= 0 {
        return None;
    }
    let spent = credits.spent_cents.max(0);
    let used = spent as f64 / credits.bought_cents as f64 * 100.0;
    Some(UsageWindow {
        name: "Credit".into(),
        used_percent: used.clamp(0.0, 100.0),
        reset_at: None,
        limit_cents: Some(credits.bought_cents),
    })
}

pub fn probe(http: &dyn Http, key: Option<&str>) -> ProbeOutcome {
    let cache_key = cache_key(key);
    let Some(key) = trimmed(key) else {
        return unknown(cache_key, "config");
    };
    let response = match http.get(
        &format!("{API_BASE}/credits"),
        &[
            ("accept", "application/json"),
            ("authorization", &format!("Bearer {key}")),
        ],
    ) {
        Ok(response) => response,
        Err(_) => return unknown(cache_key, "network"),
    };
    if matches!(response.status, 401 | 403) {
        return unknown(cache_key, "key");
    }
    if response.status != 200 {
        return unknown(cache_key, &format!("http:{}", response.status));
    }
    let Some(credits) = parse_credits(&response.body) else {
        return unknown(cache_key, "billing");
    };
    let remaining = credits.remaining_cents();
    let exhausted = remaining <= 0;
    outcome(
        cache_key,
        if exhausted {
            ProviderState::Exhausted
        } else {
            ProviderState::Available
        },
        exhausted.then(|| "balance".to_string()),
        Some(remaining),
        credit_window(credits).into_iter().collect(),
    )
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

    /// The live body observed 2026-10-18.
    const LIVE: &str = r#"{"data":{"total_credits":50,"total_usage":29.238142596}}"#;

    #[test]
    fn credits_become_a_balance_and_a_dollar_anchored_window() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 200, LIVE)]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        assert_eq!(outcome.state, ProviderState::Available);
        // $50.00 bought, $29.24 spent -> $20.76 left.
        assert_eq!(outcome.remaining_credits, Some(2076));
        assert_eq!(outcome.reason, None);
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].name, "Credit");
        assert_eq!(outcome.windows[0].limit_cents, Some(5000));
        assert_eq!(outcome.windows[0].reset_at, None);
        let used = outcome.windows[0].used_percent;
        assert!((used - 58.48).abs() < 0.01, "used was {used}");
        assert_eq!(
            outcome.cache_key,
            crate::auth::cache_key("openrouter", Some("sk-or-v1-abc"))
        );
    }

    #[test]
    fn a_spent_balance_is_exhausted_and_fully_spent() {
        let http = http(vec![(
            "openrouter.ai/api/v1/credits",
            200,
            r#"{"data":{"total_credits":20,"total_usage":20}}"#,
        )]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.reason.as_deref(), Some("balance"));
        assert_eq!(outcome.remaining_credits, Some(0));
        assert_eq!(outcome.windows[0].used_percent, 100.0);
    }

    #[test]
    fn a_bonus_above_the_purchase_clamps_to_no_spend() {
        let http = http(vec![(
            "openrouter.ai/api/v1/credits",
            200,
            r#"{"data":{"total_credits":10,"total_usage":0}}"#,
        )]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(1000));
        assert_eq!(outcome.windows[0].used_percent, 0.0);
    }

    #[test]
    fn no_purchase_on_record_keeps_the_balance_without_a_bar() {
        let http = http(vec![(
            "openrouter.ai/api/v1/credits",
            200,
            r#"{"data":{"total_credits":0,"total_usage":0}}"#,
        )]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        // Nothing left and nothing bought: exhausted, and no window to draw.
        assert_eq!(outcome.state, ProviderState::Exhausted);
        assert_eq!(outcome.remaining_credits, Some(0));
        assert!(outcome.windows.is_empty());
    }

    #[test]
    fn a_rejected_key_is_unknown_with_the_key_reason() {
        for status in [401, 403] {
            let http = http(vec![(
                "openrouter.ai/api/v1/credits",
                status,
                r#"{"error":{"message":"No auth credentials found","code":401}}"#,
            )]);
            let outcome = probe(&http, Some("sk-or-v1-stale"));
            assert_eq!(outcome.state, ProviderState::Unknown);
            assert_eq!(outcome.reason.as_deref(), Some("key"));
            assert_eq!(outcome.remaining_credits, None);
            assert!(outcome.windows.is_empty());
        }
    }

    #[test]
    fn a_missing_or_blank_key_never_reaches_the_network() {
        // No routes: any request would answer 404, not `config`.
        let http = http(Vec::new());
        for key in [None, Some("   ")] {
            let outcome = probe(&http, key);
            assert_eq!(outcome.state, ProviderState::Unknown);
            assert_eq!(outcome.reason.as_deref(), Some("config"));
            assert_eq!(outcome.cache_key, "openrouter:anon");
        }
    }

    #[test]
    fn an_unreadable_body_is_unknown() {
        let http = http(vec![(
            "openrouter.ai/api/v1/credits",
            200,
            r#"{"data":{"total_credits":"50"}}"#,
        )]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("billing"));
    }

    #[test]
    fn an_outage_is_unknown_with_its_status() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 502, "")]);
        let outcome = probe(&http, Some("sk-or-v1-abc"));
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("http:502"));
    }

    #[test]
    fn parse_credits_requires_a_data_block_of_numbers() {
        assert_eq!(
            parse_credits(LIVE),
            Some(Credits {
                bought_cents: 5000,
                spent_cents: 2924
            })
        );
        assert_eq!(parse_credits(r#"{"data":{"total_usage":1}}"#), None);
        assert_eq!(
            parse_credits(r#"{"total_credits":1,"total_usage":1}"#),
            None
        );
        assert_eq!(parse_credits("not json"), None);
    }
}
