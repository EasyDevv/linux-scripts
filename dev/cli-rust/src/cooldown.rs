use anyhow::{bail, Result};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CooldownViolation {
    pub published: DateTime<Utc>,
    pub age_days: i64,
    pub required_days: u32,
}

impl std::fmt::Display for CooldownViolation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "cooldown: published {}, age {}d, required {}d",
            self.published.to_rfc3339(),
            self.age_days,
            self.required_days
        )
    }
}

impl std::error::Error for CooldownViolation {}

pub fn parse_time(text: &str) -> Result<DateTime<Utc>> {
    let text = text.trim();
    if let Ok(parsed) = DateTime::parse_from_rfc3339(text) {
        return Ok(parsed.with_timezone(&Utc));
    }
    if let Ok(parsed) = DateTime::parse_from_rfc2822(text) {
        return Ok(parsed.with_timezone(&Utc));
    }
    bail!("unrecognized time: {text}");
}

pub fn check_cooldown(
    published: DateTime<Utc>,
    now: DateTime<Utc>,
    required_days: u32,
) -> Result<(), CooldownViolation> {
    let age = now.signed_duration_since(published);
    let required_seconds = i64::from(required_days).saturating_mul(86_400);
    if age.num_seconds() < required_seconds {
        return Err(CooldownViolation {
            published,
            age_days: age.num_seconds().div_euclid(86_400),
            required_days,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn parses_rfc3339_and_http_date() {
        let rfc3339 = parse_time("2026-10-30T18:58:48Z").unwrap();
        let http = parse_time("Fri, 30 Oct 2026 18:58:48 GMT").unwrap();
        assert_eq!(rfc3339, http);
        assert_eq!(rfc3339.to_rfc3339(), "2026-10-30T18:58:48+00:00");
    }

    #[test]
    fn cooldown_boundary_is_inclusive_and_future_fails() {
        let published = parse_time("2026-10-30T18:58:48Z").unwrap();
        assert!(check_cooldown(published, published + Duration::days(7), 7).is_ok());
        let early = published + Duration::days(6) + Duration::hours(23);
        let violation = check_cooldown(published, early, 7).unwrap_err();
        assert_eq!(violation.required_days, 7);
        assert_eq!(violation.age_days, 6);
        assert!(check_cooldown(published, published - Duration::seconds(1), 7).is_err());
    }
}
