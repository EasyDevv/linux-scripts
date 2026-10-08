use anyhow::Result;
use serde_json::Value;

use crate::cache::{ProviderState, UsageWindow};
use crate::core::ProbeOutcome;
use crate::http::Http;
use crate::iso::{parse_iso_unix, unix_from_utc};

pub const MGMT_BASE: &str = "https://management-api.x.ai";

pub fn probe_management(
    http: &dyn Http,
    management_key: &str,
    team_hint: Option<&str>,
) -> Result<ProbeOutcome> {
    let cache_key = crate::auth::cache_key("grok", Some(management_key));
    let auth = format!("Bearer {management_key}");
    let headers = [
        ("accept", "application/json"),
        ("Authorization", auth.as_str()),
    ];
    let team_id = match team_hint.map(str::trim).filter(|v| !v.is_empty()) {
        Some(id) => id.to_string(),
        None => {
            let validation = http.get(
                &format!("{MGMT_BASE}/auth/management-keys/validation"),
                &headers,
            )?;
            if validation.status >= 400 {
                return Ok(unknown(
                    cache_key,
                    Some(format!("http:{}", validation.status)),
                ));
            }
            let json: Value = match serde_json::from_str(&validation.body) {
                Ok(value) => value,
                Err(_) => return Ok(unknown(cache_key, Some("team".into()))),
            };
            match parse_team_id(&json) {
                Some(id) => id,
                None => return Ok(unknown(cache_key, Some("team".into()))),
            }
        }
    };
    let preview = http.get(
        &format!("{MGMT_BASE}/v1/billing/teams/{team_id}/postpaid/invoice/preview"),
        &headers,
    )?;
    if preview.status >= 400 {
        return Ok(unknown(cache_key, Some(format!("http:{}", preview.status))));
    }
    let json: Value = match serde_json::from_str(&preview.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("billing".into()))),
    };
    let invoices = http.get(
        &format!("{MGMT_BASE}/v1/billing/teams/{team_id}/invoices"),
        &headers,
    )?;
    let renews_at = if invoices.status < 400 {
        serde_json::from_str(&invoices.body)
            .ok()
            .and_then(|value| license_renews_from_invoices(&value))
    } else {
        None
    };
    match remaining_from_preview(cache_key.clone(), &json, renews_at) {
        Some(outcome) => Ok(outcome),
        None => Ok(unknown(cache_key, Some("billing".into()))),
    }
}

fn remaining_from_preview(
    cache_key: String,
    json: &Value,
    renews_at: Option<i64>,
) -> Option<ProbeOutcome> {
    let core = json.get("coreInvoice").unwrap_or(json);
    let default_credits = signed_cents(json.get("defaultCredits"))
        .or_else(|| signed_cents(core.get("defaultCredits")))?;
    if default_credits <= 0 {
        return None;
    }
    let issued = signed_cents(core.get("defaultCreditsIssued")).unwrap_or(0);
    let prepaid = signed_cents(core.get("prepaidCredits")).unwrap_or(0);
    let remaining = default_credits + issued + prepaid;
    let used = if issued < 0 {
        issued.unsigned_abs() as f64
    } else {
        0.0
    };
    let used_percent = ((used / default_credits as f64) * 100.0).clamp(0.0, 100.0);
    Some(finish(
        cache_key,
        UsageWindow {
            name: "monthly".into(),
            used_percent,
            reset_at: cycle_end(json).or_else(|| cycle_end(core)),
        },
        if remaining > 0 { Some(remaining) } else { None },
        renews_at,
    ))
}

/// Credits reset when the billing cycle rolls over: 00:00 UTC on the 1st of the next month.
fn cycle_end(json: &Value) -> Option<i64> {
    let cycle = json.get("billingCycle")?;
    let year = cycle.get("year")?.as_i64()? as i32;
    let month = cycle.get("month")?.as_i64()? as i32;
    let next = month; // 0-based index of the following month
    unix_from_utc(year + next.div_euclid(12), (next.rem_euclid(12) + 1) as u32, 1, 0, 0, 0)
}

fn license_renews_from_invoices(json: &Value) -> Option<i64> {
    let invoices = json.get("invoices")?.as_array()?;
    let mut best: Option<(String, i64)> = None;
    for invoice in invoices {
        if !is_paid_license(invoice) {
            continue;
        }
        let created = invoice
            .get("createTime")
            .and_then(Value::as_str)?
            .to_string();
        let cents = seat_cents(invoice)?;
        if cents < 1_000 {
            continue;
        }
        let replace = match &best {
            None => true,
            Some((prev, _)) => created > *prev,
        };
        if replace {
            best = Some((created, cents));
        }
    }
    let (created, cents) = best?;
    if cents >= 20_000 {
        bump_iso_years(&created, 1)
    } else {
        bump_iso_months(&created, 1)
    }
}

fn is_paid_license(invoice: &Value) -> bool {
    let status = invoice
        .get("invoiceStatus")
        .and_then(Value::as_str)
        .unwrap_or("")
        .eq_ignore_ascii_case("paid");
    if !status {
        return false;
    }
    invoice
        .get("lines")
        .and_then(Value::as_array)
        .is_some_and(|lines| {
            lines.iter().any(|line| {
                let desc = line
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let unit = line.get("unitType").and_then(Value::as_str).unwrap_or("");
                desc.to_ascii_lowercase().contains("licen") || unit.contains("Grok for Orgs")
            })
        })
}

fn seat_cents(invoice: &Value) -> Option<i64> {
    if let Some(n) = signed_cents(invoice.get("total")).filter(|n| *n > 0) {
        return Some(n);
    }
    let lines = invoice.get("lines")?.as_array()?;
    for line in lines {
        if let Some(n) = signed_cents(line.get("amount")).filter(|n| *n > 0) {
            return Some(n);
        }
    }
    None
}

fn bump_iso_years(s: &str, years: i32) -> Option<i64> {
    bump_iso(s, years, 0)
}

fn bump_iso_months(s: &str, months: i32) -> Option<i64> {
    bump_iso(s, 0, months)
}

fn bump_iso(s: &str, add_years: i32, add_months: i32) -> Option<i64> {
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
    let mut year: i32 = date_parts.next()?.parse().ok()?;
    let mut month: i32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.split('.').next()?.parse().ok()?;
    month += add_months;
    year += add_years + (month - 1).div_euclid(12);
    month = (month - 1).rem_euclid(12) + 1;
    unix_from_utc(year, month as u32, day, hour, minute, second)
}

fn parse_team_id(value: &Value) -> Option<String> {
    string_json(value.get("teamId"))
        .or_else(|| string_json(value.get("team_id")))
        .or_else(|| value.get("team").and_then(|t| string_json(t.get("id"))))
}

fn string_json(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

fn signed_cents(value: Option<&Value>) -> Option<i64> {
    let raw = value?;
    let raw = raw.get("val").unwrap_or(raw);
    if let Some(n) = raw.as_i64() {
        return Some(n);
    }
    if let Some(n) = raw.as_f64().filter(|n| n.is_finite()) {
        return Some(n.round() as i64);
    }
    raw.as_str()?
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        .map(|n| n.round() as i64)
}

pub const BILLING_CREDITS_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
pub const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing";

pub struct Session {
    pub access_token: String,
    pub user_id: Option<String>,
}

pub fn probe(http: &dyn Http, session: &Session) -> Result<ProbeOutcome> {
    let cache_key = crate::auth::cache_key("grok", Some(&session.access_token));
    let auth = format!("Bearer {}", session.access_token);
    let mut headers = vec![
        ("accept", "application/json"),
        ("Authorization", auth.as_str()),
        ("X-XAI-Token-Auth", "xai-grok-cli"),
    ];
    if let Some(user) = session.user_id.as_deref() {
        headers.push(("x-userid", user));
    }
    let credits = http.get(BILLING_CREDITS_URL, &headers)?;
    if credits.status == 401 || credits.status == 403 {
        return Ok(unknown(cache_key, Some(format!("http:{}", credits.status))));
    }
    if credits.status >= 400 {
        return Ok(unknown(cache_key, Some(format!("http:{}", credits.status))));
    }
    let json: Value = match serde_json::from_str(&credits.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("billing".into()))),
    };
    let config = json.get("config").unwrap_or(&json);
    if let Some(outcome) = credits_from_config(cache_key.clone(), config) {
        return Ok(outcome);
    }
    let fallback = http.get(BILLING_URL, &headers)?;
    if fallback.status >= 400 {
        return Ok(unknown(
            cache_key,
            Some(format!("http:{}", fallback.status)),
        ));
    }
    let json: Value = match serde_json::from_str(&fallback.body) {
        Ok(value) => value,
        Err(_) => return Ok(unknown(cache_key, Some("billing".into()))),
    };
    let config = json.get("config").unwrap_or(&json);
    if let Some(outcome) = monthly_from_config(cache_key.clone(), config) {
        return Ok(outcome);
    }
    Ok(unknown(cache_key, Some("billing".into())))
}

fn credits_from_config(cache_key: String, config: &Value) -> Option<ProbeOutcome> {
    let percent = config
        .get("creditUsagePercent")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())?;
    let reset_at = period_end(config);
    Some(finish(
        cache_key,
        UsageWindow {
            name: "monthly".into(),
            used_percent: percent.clamp(0.0, 100.0),
            reset_at,
        },
        remaining_credits(config),
        None,
    ))
}

fn monthly_from_config(cache_key: String, config: &Value) -> Option<ProbeOutcome> {
    let limit = money(config.get("monthlyLimit"))?;
    let used = money(config.get("used"))?;
    if limit <= 0.0 {
        return None;
    }
    let percent = ((used / limit) * 100.0).clamp(0.0, 100.0);
    Some(finish(
        cache_key,
        UsageWindow {
            name: "monthly".into(),
            used_percent: percent,
            reset_at: period_end(config),
        },
        Some((limit - used).max(0.0).round() as i64),
        None,
    ))
}

fn remaining_credits(config: &Value) -> Option<i64> {
    if let Some(prepaid) = money(config.get("prepaidBalance")).filter(|n| *n > 0.0) {
        return Some(prepaid.round() as i64);
    }
    let limit = money(config.get("monthlyLimit"))?;
    let used = money(config.get("used"))?;
    Some((limit - used).max(0.0).round() as i64)
}

fn money(value: Option<&Value>) -> Option<f64> {
    let val = value?.get("val")?;
    val.as_f64()
        .or_else(|| val.as_str().and_then(|s| s.parse().ok()))
        .filter(|n| n.is_finite())
}

fn period_end(config: &Value) -> Option<i64> {
    let raw = config
        .get("currentPeriod")
        .and_then(|p| p.get("end"))
        .or_else(|| config.get("billingPeriodEnd"))?;
    raw.as_i64()
        .or_else(|| raw.as_str().and_then(parse_iso_unix))
}

fn finish(
    cache_key: String,
    window: UsageWindow,
    remaining_credits: Option<i64>,
    renews_at: Option<i64>,
) -> ProbeOutcome {
    let exhausted = window.used_percent >= 100.0;
    let reason = if exhausted {
        Some(format!("window:{}", window.name))
    } else {
        None
    };
    ProbeOutcome {
        plan: None,
        cache_key,
        state: if exhausted {
            ProviderState::Exhausted
        } else {
            ProviderState::Available
        },
        reason,
        reset_at: window.reset_at,
        remaining_credits,
        windows: vec![window],
        renews_at,
    }
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
    fn probe_management_reads_invoice_preview() {
        let http = MapHttp {
            routes: vec![
                (
                    "postpaid/invoice/preview".into(),
                    200,
                    json!({
                        "defaultCredits": "15000",
                        "billingCycle": { "year": 2026, "month": 9 },
                        "coreInvoice": {
                            "defaultCreditsIssued": "-10933",
                            "prepaidCredits": { "val": "0" }
                        }
                    })
                    .to_string(),
                ),
                (
                    "/invoices".into(),
                    200,
                    json!({
                        "invoices": [{
                            "createTime": "2026-09-04T23:40:51Z",
                            "firstDesiredNextCycleTs": "2026-09-12T16:30:09Z",
                            "invoiceStatus": "PENDING"
                        }, {
                            "createTime": "2026-08-14T23:16:02Z",
                            "invoiceStatus": "PAID",
                            "total": 30000,
                            "lines": [{
                                "description": "Subscription for grok.com licences",
                                "unitType": "Grok for Orgs",
                                "amount": "30000"
                            }]
                        }]
                    })
                    .to_string(),
                ),
            ],
        };
        let outcome = probe_management(&http, "mgmt-key", Some("team-1")).unwrap();
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.remaining_credits, Some(4067));
        assert_eq!(outcome.windows.len(), 1);
        assert_eq!(outcome.windows[0].name, "monthly");
        assert_eq!(outcome.windows[0].reset_at, Some(1_790_812_800));
        assert_eq!(outcome.renews_at, Some(1_818_285_362));
        assert!((outcome.windows[0].used_percent - 72.886).abs() < 0.02);
    }

    #[test]
    fn probe_maps_cli_credits() {
        let http = MapHttp {
            routes: vec![(
                "billing?format=credits".into(),
                200,
                json!({
                    "config": {
                        "creditUsagePercent": 71.0,
                        "prepaidBalance": { "val": "44" },
                        "currentPeriod": {
                            "type": "USAGE_PERIOD_TYPE_WEEKLY",
                            "end": "2026-07-07T18:36:14.268512+00:00"
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
                user_id: Some("u1".into()),
            },
        )
        .unwrap();
        assert_eq!(outcome.state, ProviderState::Available);
        assert_eq!(outcome.windows[0].name, "monthly");
        assert_eq!(outcome.windows[0].used_percent, 71.0);
        assert_eq!(outcome.remaining_credits, Some(44));
        assert_eq!(outcome.windows[0].reset_at, Some(1_783_449_374));
    }
}
