//! OpenRouter probe.
//!
//! OpenRouter is prepaid: credits are bought up front and every request debits
//! the balance, so there is no subscription to renew and no rate window to
//! reset. `GET /api/v1/credits` answers the lifetime totals in dollars —
//! `total_credits` bought, `total_usage` spent — and the balance is the
//! difference. `total_credits` is therefore the purchase anchor for the card's
//! `Credit` window: it is the only limit reference the key can read.
//!
//! Dated daily spend is the Management API's analytics query.
//! `POST /api/v1/analytics/query` (management key) returns `total_usage` in USD
//! per UTC day, today included; the probe keeps the `date__day` date part and
//! converts each row to cents. The previous source was the signed-in console's
//! version of the same query with the browser `OPENROUTER_COOKIE`, whose Clerk
//! `__session` JWT expires after 60 seconds, so it silently stopped answering.
//! A refused query (401/403) reports an empty day list, which keeps the board's
//! last snapshot. Any other failure falls back to `GET /api/v1/activity`, which
//! is management-key only (403 for a normal key) and returns one row per
//! (date, model, endpoint) for the last 30 completed UTC days, summed per date.
//! A per-key `usage_daily` from `GET /api/v1/keys` is not a substitute for
//! today: it reads 0 while a session is running. A missing management key
//! keeps the balance (the inference key still works) and omits `spendDays` so
//! LithosAI-style snapshots remain the fallback.
//!
//! The key is `OPENROUTER_API_KEY`; a missing key is `config`, a rejected one
//! is `key`. The management key is `OPENROUTER_MANAGEMENT_KEY` (alias
//! `OPENROUTER_MANAGEMENT_API_KEY`).

use std::collections::BTreeMap;

use serde_json::Value;

use crate::cache::{DaySpend, ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;

pub const API_BASE: &str = "https://openrouter.ai/api/v1";
pub const ANALYTICS_URL: &str = "https://openrouter.ai/api/v1/analytics/query";
pub const ACTIVITY_URL: &str = "https://openrouter.ai/api/v1/activity";
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

/// Window the analytics query asks for: the last 31 days, ending today.
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

/// A JSON number, or a numeric string (the API returns count metrics as
/// strings; accepting both keeps a spend value from silently dropping a row).
fn usd(value: Option<&Value>) -> Option<f64> {
    let value = value?;
    let dollars = value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse::<f64>().ok())?;
    dollars.is_finite().then_some(dollars)
}

/// UTC `YYYY-MM-DD` from a `date__day` instant, or from a bare date.
fn date_part(value: &Value) -> Option<String> {
    let day = value.as_str()?.trim().split('T').next()?.trim();
    (!day.is_empty()).then(|| day.to_string())
}

/// `analytics/query` rows: one `DaySpend` per UTC date, oldest first.
pub fn parse_analytics_days(body: &str) -> Option<Vec<DaySpend>> {
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
                day: date_part(row.get("date__day").or_else(|| row.get("date"))?)?,
                cents: cents(usd(row.get("total_usage").or_else(|| row.get("usage")))?)?,
            })
        })
        .collect();
    days.sort_by(|a, b| a.day.cmp(&b.day));
    Some(days)
}

/// `/activity` rows summed into one `DaySpend` per UTC date, oldest first.
pub fn parse_activity_days(body: &str) -> Option<Vec<DaySpend>> {
    let json: Value = serde_json::from_str(body).ok()?;
    let rows = json.get("data")?.as_array()?;
    let mut totals: BTreeMap<String, f64> = BTreeMap::new();
    for row in rows {
        if let (Some(day), Some(usage)) =
            (row.get("date").and_then(date_part), usd(row.get("usage")))
        {
            *totals.entry(day).or_default() += usage;
        }
    }
    Some(
        totals
            .into_iter()
            .filter_map(|(day, usage)| {
                Some(DaySpend {
                    day,
                    cents: cents(usage)?,
                })
            })
            .collect(),
    )
}

/// What the analytics query answered: days, a refusal, or a retryable failure.
enum Spend {
    Days(Vec<DaySpend>),
    Refused,
    Failed,
}

/// Live daily spend from the Management API, today included.
fn analytics_days(http: &dyn Http, management_key: &str, now: i64) -> Spend {
    let authorization = format!("Bearer {management_key}");
    let Ok(response) = http.post(
        ANALYTICS_URL,
        &[
            ("accept", "application/json"),
            ("authorization", &authorization),
        ],
        &activity_query_body(now),
    ) else {
        return Spend::Failed;
    };
    match response.status {
        200 => match parse_analytics_days(&response.body) {
            Some(days) => Spend::Days(days),
            None => Spend::Failed,
        },
        401 | 403 => Spend::Refused,
        _ => Spend::Failed,
    }
}

/// The last 30 completed UTC days, summed per date; it never covers today.
fn activity_days(http: &dyn Http, management_key: &str) -> Vec<DaySpend> {
    let authorization = format!("Bearer {management_key}");
    let Ok(response) = http.get(
        ACTIVITY_URL,
        &[
            ("accept", "application/json"),
            ("authorization", &authorization),
        ],
    ) else {
        return Vec::new();
    };
    if response.status != 200 {
        return Vec::new();
    }
    parse_activity_days(&response.body).unwrap_or_default()
}

/// Cents per day from the Management API; empty means "refused", which keeps
/// the board's previous snapshot.
fn fetch_spend_days(http: &dyn Http, management_key: &str, now: i64) -> Vec<DaySpend> {
    match analytics_days(http, management_key, now) {
        Spend::Days(days) => days,
        Spend::Refused => Vec::new(),
        Spend::Failed => activity_days(http, management_key),
    }
}

pub fn probe(
    http: &dyn Http,
    key: Option<&str>,
    management_key: Option<&str>,
    now: i64,
) -> ProbeOutcome {
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
    let spend_days =
        trimmed(management_key).map(|management_key| fetch_spend_days(http, management_key, now));
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
    /// The documented `/activity` shape: one row per (date, model, endpoint).
    const LIVE_ACTIVITY: &str = r#"{"data":[{"date":"2026-10-20","model":"openai/gpt-4.1","endpoint_id":"a","usage":0.005997},{"date":"2026-10-19","model":"openai/gpt-4.1","endpoint_id":"a","usage":0.01},{"date":"2026-10-19","model":"anthropic/claude-sonnet-4","endpoint_id":"b","usage":0.003691},{"date":"2026-10-18","model":"openai/gpt-4.1","endpoint_id":"a","usage":0.124049},{"date":"2026-10-18","model":"google/gemini-2.5-pro","endpoint_id":"c","usage":0.001},{"date":"2026-09-21","model":"openai/gpt-4.1","endpoint_id":"a","usage":0.008993},{"date":"2026-09-20","model":"openai/gpt-4.1","endpoint_id":"a","usage":0.02344}]}"#;
    /// The live analytics body observed 2026-10-20 from the Activity page.
    const LIVE_ANALYTICS: &str = r#"{"data":{"data":[{"date__day":"2026-10-20T00:00:00.000Z","total_usage":0.005997},{"date__day":"2026-10-19T00:00:00.000Z","total_usage":0.013691},{"date__day":"2026-10-18T00:00:00.000Z","total_usage":0.124049},{"date__day":"2026-09-21T00:00:00.000Z","total_usage":0.008993},{"date__day":"2026-09-20T00:00:00.000Z","total_usage":0.02344}],"metadata":{"query_time_ms":11,"row_count":5,"truncated":false}}}"#;
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
    fn activity_rows_are_summed_into_daily_cents() {
        let days = parse_activity_days(LIVE_ACTIVITY).unwrap();
        let got: Vec<(&str, i64)> = days.iter().map(|d| (d.day.as_str(), d.cents)).collect();
        assert_eq!(
            got,
            vec![
                ("2026-09-20", 2),
                ("2026-09-21", 1),
                ("2026-10-18", 13),
                ("2026-10-19", 1),
                ("2026-10-20", 1),
            ]
        );
    }

    #[test]
    fn analytics_rows_become_daily_cents_including_today() {
        let days = parse_analytics_days(LIVE_ANALYTICS).unwrap();
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
    fn the_query_asks_for_the_last_31_days_of_daily_usage() {
        assert_eq!(
            activity_query_body(NOW),
            r#"{"dimensions":[],"granularity":"day","metrics":["total_usage"],"time_range":{"start":"2026-09-19T00:00:00.000Z","end":"2026-10-20T23:59:59.000Z"}}"#
        );
    }

    #[test]
    fn analytics_rows_are_parsed_defensively() {
        // A bare date and a string-encoded amount still become a day.
        let days = parse_analytics_days(
            r#"{"data":{"data":[{"date__day":"2026-10-20","total_usage":"1.25"}]}}"#,
        )
        .unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].day, "2026-10-20");
        assert_eq!(days[0].cents, 125);
        // A row without a date or an amount is skipped, not fatal.
        let days = parse_analytics_days(
            r#"{"data":{"data":[{"date__day":""},{"date__day":"2026-10-19"}]}}"#,
        )
        .unwrap();
        assert!(days.is_empty());
        assert_eq!(parse_analytics_days("not json"), None);
        assert_eq!(parse_analytics_days(r#"{"data":{}}"#), None);
    }

    #[test]
    fn today_arrives_with_the_analytics_query() {
        let http = http(vec![
            ("analytics/query", 200, LIVE_ANALYTICS),
            ("openrouter.ai/api/v1/credits", 200, LIVE),
        ]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), Some("mgmt-key"), NOW);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(2076));
        let days = outcome.spend_days.unwrap();
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
    fn a_missing_management_key_leaves_spend_days_unset() {
        let http = http(vec![("openrouter.ai/api/v1/credits", 200, LIVE)]);
        for management_key in [None, Some("   ")] {
            let outcome = probe(&http, Some("sk-or-v1-abc"), management_key, NOW);
            assert_eq!(outcome.state, ProviderState::Available);
            assert_eq!(outcome.spend_days, None);
        }
    }

    #[test]
    fn a_refused_analytics_query_keeps_the_balance_and_clears_spend_days() {
        for status in [401, 403] {
            let http = http(vec![
                (
                    "analytics/query",
                    status,
                    r#"{"error":{"code":401,"message":"No auth credentials found"}}"#,
                ),
                // A refusal must not fall through to `/activity`.
                ("openrouter.ai/api/v1/activity", 200, LIVE_ACTIVITY),
                ("openrouter.ai/api/v1/credits", 200, LIVE),
            ]);
            let outcome = probe(&http, Some("sk-or-v1-abc"), Some("mgmt-key"), NOW);
            assert_eq!(outcome.state, ProviderState::Available);
            assert_eq!(outcome.remaining_credits, Some(2076));
            assert_eq!(outcome.spend_days.as_deref(), Some(&[][..]));
        }
    }

    #[test]
    fn a_failed_analytics_query_falls_back_to_activity() {
        for status in [408, 500, 502] {
            let http = http(vec![
                ("analytics/query", status, ""),
                ("openrouter.ai/api/v1/activity", 200, LIVE_ACTIVITY),
                ("openrouter.ai/api/v1/credits", 200, LIVE),
            ]);
            let outcome = probe(&http, Some("sk-or-v1-abc"), Some("mgmt-key"), NOW);
            let days = outcome.spend_days.unwrap();
            let got: Vec<(&str, i64)> = days.iter().map(|d| (d.day.as_str(), d.cents)).collect();
            assert_eq!(
                got,
                vec![
                    ("2026-09-20", 2),
                    ("2026-09-21", 1),
                    ("2026-10-18", 13),
                    ("2026-10-19", 1),
                    ("2026-10-20", 1),
                ]
            );
        }
        // Unreadable JSON is a failure too, not a refusal.
        let http = http(vec![
            ("analytics/query", 200, "not json"),
            ("openrouter.ai/api/v1/activity", 200, LIVE_ACTIVITY),
            ("openrouter.ai/api/v1/credits", 200, LIVE),
        ]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), Some("mgmt-key"), NOW);
        assert_eq!(outcome.spend_days.unwrap().len(), 5);
    }

    #[test]
    fn both_sources_failing_clears_spend_days() {
        let http = http(vec![
            ("analytics/query", 500, ""),
            ("openrouter.ai/api/v1/activity", 500, ""),
            ("openrouter.ai/api/v1/credits", 200, LIVE),
        ]);
        let outcome = probe(&http, Some("sk-or-v1-abc"), Some("mgmt-key"), NOW);
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(2076));
        assert_eq!(outcome.spend_days.as_deref(), Some(&[][..]));
    }
}
