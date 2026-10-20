//! OpenRouter probe.
//!
//! OpenRouter is prepaid: credits are bought up front and every request debits
//! the balance, so there is no subscription to renew and no rate window to
//! reset. `GET /api/v1/credits` answers the lifetime totals in dollars —
//! `total_credits` bought, `total_usage` spent — and the balance is the
//! difference. `total_credits` is therefore the purchase anchor for the card's
//! `Credit` window: it is the only limit reference the key can read.
//!
//! Dated daily spend is the workspace Activity feed. `GET /api/v1/activity` is
//! management-key only (403 for a normal key); the signed-in console answers
//! the same series at `POST /api/frontend/v1/private/analytics-query`. The
//! probe reads that with `OPENROUTER_COOKIE` and leaves the board's snapshot
//! deltas unused when the cookie is present. A missing cookie keeps the
//! balance (the key still works) and omits `spendDays` so LithosAI-style
//! snapshots remain the fallback.
//!
//! The key is `OPENROUTER_API_KEY`; a missing key is `config`, a rejected one
//! is `key`.

use serde_json::Value;

use crate::cache::{DaySpend, ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const API_BASE: &str = "https://openrouter.ai/api/v1";
pub const ANALYTICS_URL: &str = "https://openrouter.ai/api/frontend/v1/private/analytics-query";
const ACTIVITY_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const ACTIVITY_DAYS: i64 = 31;

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
    spend_days: Option<Vec<DaySpend>>,
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
        spend_days,
    }
}

fn unknown(cache_key: String, reason: &str) -> ProbeOutcome {
    outcome(
        cache_key,
        ProviderState::Unknown,
        Some(reason.to_string()),
        None,
        Vec::new(),
        None,
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

/// UTC `YYYY-MM-DD` of an epoch-second instant.
fn utc_date(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn activity_range(now: i64) -> (String, String) {
    let end = now.max(0);
    let start = end.saturating_sub(ACTIVITY_DAYS * 86_400);
    (
        format!("{}T00:00:00.000Z", utc_date(start)),
        format!("{}T23:59:59.000Z", utc_date(end)),
    )
}

fn activity_query_body(now: i64) -> String {
    let (start, end) = activity_range(now);
    format!(
        r#"{{"dimensions":[],"granularity":"day","metrics":["total_usage"],"time_range":{{"start":"{start}","end":"{end}"}}}}"#
    )
}

fn row_day(row: &Value) -> Option<String> {
    row.get("date__day")
        .or_else(|| row.get("date"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|day| !day.is_empty())
        .map(str::to_string)
}

fn row_cents(row: &Value) -> Option<i64> {
    cents(
        row.get("total_usage")
            .or_else(|| row.get("usage"))?
            .as_f64()?,
    )
}

/// Daily `total_usage` rows from the console analytics query, oldest first.
pub fn parse_activity_days(body: &str) -> Option<Vec<DaySpend>> {
    let json: Value = serde_json::from_str(body).ok()?;
    let data = json.get("data")?;
    let rows = data
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| data.as_array())?;
    let mut days: Vec<DaySpend> = rows
        .iter()
        .filter_map(|row| {
            Some(DaySpend {
                day: row_day(row)?,
                cents: row_cents(row)?,
            })
        })
        .collect();
    days.sort_by(|a, b| a.day.cmp(&b.day));
    Some(days)
}

fn fetch_activity_days(http: &dyn Http, cookie: &str, now: i64) -> Vec<DaySpend> {
    let response = match http.post(
        ANALYTICS_URL,
        &[
            ("accept", "application/json"),
            ("cookie", cookie),
            ("origin", "https://openrouter.ai"),
            (
                "referer",
                "https://openrouter.ai/workspaces/default/activity",
            ),
            ("user-agent", ACTIVITY_UA),
        ],
        &activity_query_body(now),
    ) {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    if response.status != 200 {
        return Vec::new();
    }
    parse_activity_days(&response.body).unwrap_or_default()
}

pub fn probe(http: &dyn Http, key: Option<&str>, cookie: Option<&str>, now: i64) -> ProbeOutcome {
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
    let spend_days = trimmed(cookie).map(|cookie| fetch_activity_days(http, cookie, now));
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
        spend_days,
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
    /// The live analytics body observed 2026-10-20 from the Activity page.
    const LIVE_ACTIVITY: &str = r#"{"data":{"data":[{"date__day":"2026-10-20","total_usage":0.005997},{"date__day":"2026-10-19","total_usage":0.013691},{"date__day":"2026-10-18","total_usage":0.124049},{"date__day":"2026-09-21","total_usage":0.008993},{"date__day":"2026-09-20","total_usage":0.02344}],"metadata":{"query_time_ms":11,"row_count":5,"truncated":false}}}"#;
    const NOW: i64 = 1_792_460_808;

    #[test]
    fn credits_become_a_balance_and_a_dollar_anchored_window() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 200, LIVE)]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
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
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
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
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
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
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
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
            let outcome = probe(&http, Some("sk-or-v1-stale"), None, NOW);
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
            let outcome = probe(&http, key, None, NOW);
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
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
        assert_eq!(outcome.state, ProviderState::Unknown);
        assert_eq!(outcome.reason.as_deref(), Some("billing"));
    }

    #[test]
    fn an_outage_is_unknown_with_its_status() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 502, "")]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
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

    #[test]
    fn activity_days_are_oldest_first_in_cents() {
        let days = parse_activity_days(LIVE_ACTIVITY).unwrap();
        let got: Vec<(&str, i64)> = days.iter().map(|d| (d.day.as_str(), d.cents)).collect();
        assert_eq!(
            got,
            vec![
                ("2026-09-20", 2),
                ("2026-09-21", 1),
                ("2026-10-18", 12),
                ("2026-10-19", 1),
                ("2026-10-20", 1),
            ]
        );
    }

    #[test]
    fn a_cookie_fills_spend_days_from_activity() {
        let http = http(vec![
            ("analytics-query", 200, LIVE_ACTIVITY),
            ("openrouter.ai/api/v1/credits", 200, LIVE),
        ]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), Some("session=abc"), NOW);
        assert_eq!(outcome.state, ProviderState::Available);
        let days = outcome.spend_days.unwrap();
        assert_eq!(days.len(), 5);
        assert_eq!(days[2].day, "2026-10-18");
        assert_eq!(days[2].cents, 12);
    }

    #[test]
    fn a_missing_cookie_leaves_spend_days_unset() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 200, LIVE)]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), None, NOW);
        assert_eq!(outcome.spend_days, None);
    }

    #[test]
    fn a_rejected_cookie_keeps_the_balance_and_clears_spend_days() {
        let http = http(vec![
            (
                "analytics-query",
                401,
                r#"{"error":{"message":"No cookie auth credentials found","code":401}}"#,
            ),
            ("openrouter.ai/api/v1/credits", 200, LIVE),
        ]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), Some("session=stale"), NOW);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(2076));
        assert_eq!(outcome.spend_days.as_deref(), Some(&[][..]));
    }
}
