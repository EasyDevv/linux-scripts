use crate::cache::ProviderState;

pub const NEGATIVE_CAP_SECS: i64 = 20 * 60;
pub const UNKNOWN_TTL_SECS: i64 = 10;
pub const AVAILABLE_TTL_SECS: i64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Remaining {
    Available,
    Exhausted,
    Unknown,
}

impl Remaining {
    pub fn from_state(state: ProviderState) -> Self {
        match state {
            ProviderState::Available => Remaining::Available,
            ProviderState::Exhausted => Remaining::Exhausted,
            ProviderState::Unknown => Remaining::Unknown,
        }
    }

    pub fn json_value(self) -> serde_json::Value {
        match self {
            Remaining::Available => serde_json::Value::Bool(true),
            Remaining::Exhausted => serde_json::Value::Bool(false),
            Remaining::Unknown => serde_json::Value::String("unknown".into()),
        }
    }
}

pub fn fresh_until(now: i64, state: ProviderState, reset_at: Option<i64>) -> i64 {
    match state {
        ProviderState::Exhausted => {
            let cap = now.saturating_add(NEGATIVE_CAP_SECS);
            match reset_at {
                Some(reset) if reset > now => reset.min(cap),
                _ => cap,
            }
        }
        ProviderState::Available => now.saturating_add(AVAILABLE_TTL_SECS),
        ProviderState::Unknown => now.saturating_add(UNKNOWN_TTL_SECS),
    }
}

pub fn is_fresh(now: i64, fresh_until_at: i64) -> bool {
    now < fresh_until_at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhausted_uses_reset_when_sooner_than_cap() {
        let now = 1_000;
        assert_eq!(
            fresh_until(now, ProviderState::Exhausted, Some(now + 60)),
            now + 60
        );
        assert_eq!(
            fresh_until(
                now,
                ProviderState::Exhausted,
                Some(now + NEGATIVE_CAP_SECS + 50)
            ),
            now + NEGATIVE_CAP_SECS
        );
        assert_eq!(
            fresh_until(now, ProviderState::Exhausted, Some(now - 1)),
            now + NEGATIVE_CAP_SECS
        );
    }

    #[test]
    fn available_and_unknown_use_short_ttl() {
        let now = 50;
        assert_eq!(
            fresh_until(now, ProviderState::Available, None),
            now + AVAILABLE_TTL_SECS
        );
        assert_eq!(
            fresh_until(now, ProviderState::Unknown, None),
            now + UNKNOWN_TTL_SECS
        );
    }
}
