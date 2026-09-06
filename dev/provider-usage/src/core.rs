use anyhow::Result;
use serde::Serialize;

use crate::auth::{self, cache_key};
use crate::cache::{CacheFile, FileStore, ProviderSnapshot, ProviderState, Store, DEFAULT_CACHE_PATH};
use crate::commandcode;
use crate::http::{Http, ReqwestHttp};
use crate::opencode_go;
use crate::policy::{self, Remaining};

pub const REMAINING_TIMEOUT_MS: u64 = 5_000;

#[derive(Clone, Debug)]
pub struct ProbeOutcome {
    pub cache_key: String,
    pub state: ProviderState,
    pub reason: Option<String>,
    pub reset_at: Option<i64>,
    pub remaining_credits: Option<i64>,
}

pub trait Clock {
    fn now(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

pub trait Probes {
    fn cache_key(&self, provider: &str) -> String;
    fn probe(&self, provider: &str, now: i64) -> ProbeOutcome;
}

pub struct UsageCore<C, S, P> {
    pub clock: C,
    pub store: S,
    pub probes: P,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemainingAnswer {
    pub model: String,
    pub provider: String,
    pub remaining: serde_json::Value,
    pub cached: bool,
    pub state: ProviderState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fresh_until: Option<i64>,
}

impl RemainingAnswer {
    fn from_snapshot(model: &str, provider: &str, snapshot: &ProviderSnapshot, cached: bool) -> Self {
        Self {
            model: model.to_string(),
            provider: provider.to_string(),
            remaining: Remaining::from_state(snapshot.state).json_value(),
            cached,
            state: snapshot.state,
            reason: snapshot.reason.clone(),
            reset_at: snapshot.reset_at,
            fresh_until: Some(snapshot.fresh_until),
        }
    }
}

impl<C: Clock, S: Store, P: Probes> UsageCore<C, S, P> {
    pub fn remaining(&self, model: &str, force: bool) -> Result<RemainingAnswer> {
        let Some(provider) = provider_from_model(model) else {
            return Ok(unknown_model(model));
        };
        let now = self.clock.now();
        let key = self.probes.cache_key(&provider);
        if !force {
            let cache = self.store.load()?;
            if let Some(snapshot) = cache.providers.get(&key) {
                if policy::is_fresh(now, snapshot.fresh_until) {
                    return Ok(RemainingAnswer::from_snapshot(model, &provider, snapshot, true));
                }
            }
        }
        let snapshot = self.probe_provider(&provider, now)?;
        Ok(RemainingAnswer::from_snapshot(model, &provider, &snapshot, false))
    }

    pub fn refresh(&self, provider_or_model: &str) -> Result<RemainingAnswer> {
        let provider = provider_from_model(provider_or_model)
            .unwrap_or_else(|| provider_or_model.trim().to_ascii_lowercase());
        let model = if provider_or_model.contains('/') {
            provider_or_model.to_string()
        } else {
            format!("{provider}/")
        };
        self.remaining(&model, true)
    }

    pub fn mark_exhausted(&self, model: &str, until: Option<i64>) -> Result<RemainingAnswer> {
        let Some(provider) = provider_from_model(model) else {
            return Ok(unknown_model(model));
        };
        let now = self.clock.now();
        let key = self.probes.cache_key(&provider);
        let reset_at = until.filter(|ts| *ts > now);
        let snapshot = ProviderSnapshot {
            checked_at: now,
            state: ProviderState::Exhausted,
            reason: Some("live-limit".into()),
            reset_at,
            fresh_until: policy::fresh_until(now, ProviderState::Exhausted, reset_at),
            remaining_credits: None,
        };
        self.upsert(key, snapshot.clone())?;
        Ok(RemainingAnswer::from_snapshot(model, &provider, &snapshot, false))
    }

    pub fn status(&self) -> Result<CacheFile> {
        self.store.load()
    }

    fn probe_provider(&self, provider: &str, now: i64) -> Result<ProviderSnapshot> {
        let outcome = self.probes.probe(provider, now);
        let snapshot = ProviderSnapshot {
            checked_at: now,
            state: outcome.state,
            reason: outcome.reason,
            reset_at: outcome.reset_at,
            fresh_until: policy::fresh_until(now, outcome.state, outcome.reset_at),
            remaining_credits: outcome.remaining_credits,
        };
        self.upsert(outcome.cache_key, snapshot.clone())?;
        Ok(snapshot)
    }

    fn upsert(&self, key: String, snapshot: ProviderSnapshot) -> Result<()> {
        let mut cache = self.store.load()?;
        cache.providers.insert(key, snapshot);
        self.store.save(&cache)
    }
}

pub fn provider_from_model(model: &str) -> Option<String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return None;
    }
    let key = match trimmed.split_once('/') {
        Some((provider, _)) => provider,
        None => trimmed,
    };
    let lower = key.to_ascii_lowercase();
    if lower.is_empty() {
        None
    } else {
        Some(lower)
    }
}

fn unknown_model(model: &str) -> RemainingAnswer {
    RemainingAnswer {
        model: model.to_string(),
        provider: String::new(),
        remaining: Remaining::Unknown.json_value(),
        cached: false,
        state: ProviderState::Unknown,
        reason: Some("model".into()),
        reset_at: None,
        fresh_until: None,
    }
}

pub struct LiveProbes<H> {
    pub http: H,
    pub commandcode_key: Option<String>,
    pub opencode_cookie: Option<String>,
    pub opencode_workspace: Option<String>,
    pub commandcode_base: String,
}

impl LiveProbes<ReqwestHttp> {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            http: ReqwestHttp::with_timeout_ms(REMAINING_TIMEOUT_MS)?,
            commandcode_key: auth::commandcode_api_key(&auth::env_lookup),
            opencode_cookie: auth::opencode_cookie(&auth::env_lookup, None),
            opencode_workspace: auth::opencode_workspace_id(&auth::env_lookup, None),
            commandcode_base: DEFAULT_COMMANDCODE_BASE.to_string(),
        })
    }
}

const DEFAULT_COMMANDCODE_BASE: &str = commandcode::DEFAULT_API_BASE;

impl<H: Http> Probes for LiveProbes<H> {
    fn cache_key(&self, provider: &str) -> String {
        match provider {
            "commandcode" => cache_key(provider, self.commandcode_key.as_deref()),
            "opencode-go" => cache_key(provider, self.opencode_cookie.as_deref()),
            other => cache_key(other, None),
        }
    }

    fn probe(&self, provider: &str, now: i64) -> ProbeOutcome {
        match provider {
            "commandcode" => match self.commandcode_key.as_deref() {
                Some(key) => commandcode::probe(&self.http, key, &self.commandcode_base).unwrap_or_else(|_| {
                    ProbeOutcome {
                        cache_key: self.cache_key(provider),
                        state: ProviderState::Unknown,
                        reason: Some("network".into()),
                        reset_at: None,
                        remaining_credits: None,
                    }
                }),
                None => ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("config".into()),
                    reset_at: None,
                    remaining_credits: None,
                },
            },
            "opencode-go" => match self.opencode_cookie.as_deref() {
                Some(cookie) => opencode_go::probe(
                    &self.http,
                    cookie,
                    self.opencode_workspace.as_deref(),
                    now,
                )
                .unwrap_or_else(|_| ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("network".into()),
                    reset_at: None,
                    remaining_credits: None,
                }),
                None => ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("config".into()),
                    reset_at: None,
                    remaining_credits: None,
                },
            },
            _ => ProbeOutcome {
                cache_key: self.cache_key(provider),
                state: ProviderState::Unknown,
                reason: Some("unsupported".into()),
                reset_at: None,
                remaining_credits: None,
            },
        }
    }
}

pub fn default_store(path: Option<&str>) -> FileStore {
    FileStore::new(path.unwrap_or(DEFAULT_CACHE_PATH))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::MemoryStore;
    use crate::policy::NEGATIVE_CAP_SECS;
    use std::cell::Cell;
    use std::collections::HashMap;

    struct FakeClock(Cell<i64>);

    impl Clock for FakeClock {
        fn now(&self) -> i64 {
            self.0.get()
        }
    }

    struct FakeProbes {
        key: String,
        outcomes: HashMap<String, ProbeOutcome>,
        probes: Cell<u32>,
    }

    impl Probes for FakeProbes {
        fn cache_key(&self, _provider: &str) -> String {
            self.key.clone()
        }

        fn probe(&self, provider: &str, _now: i64) -> ProbeOutcome {
            self.probes.set(self.probes.get() + 1);
            self.outcomes
                .get(provider)
                .cloned()
                .unwrap_or(ProbeOutcome {
                    cache_key: self.key.clone(),
                    state: ProviderState::Unknown,
                    reason: Some("missing".into()),
                    reset_at: None,
                    remaining_credits: None,
                })
        }
    }

    fn core(now: i64, outcome: ProbeOutcome) -> UsageCore<FakeClock, MemoryStore, FakeProbes> {
        let key = outcome.cache_key.clone();
        let mut outcomes = HashMap::new();
        outcomes.insert("commandcode".into(), outcome);
        UsageCore {
            clock: FakeClock(Cell::new(now)),
            store: MemoryStore::default(),
            probes: FakeProbes {
                key,
                outcomes,
                probes: Cell::new(0),
            },
        }
    }

    #[test]
    fn cache_hit_skips_probe() {
        let outcome = ProbeOutcome {
            cache_key: "commandcode:abc".into(),
            state: ProviderState::Exhausted,
            reason: Some("credits".into()),
            reset_at: Some(5_000),
            remaining_credits: Some(0),
        };
        let core = core(1_000, outcome);
        let first = core
            .remaining("commandcode/deepseek/deepseek-v4-flash", false)
            .unwrap();
        assert_eq!(first.remaining, serde_json::Value::Bool(false));
        assert!(!first.cached);
        assert_eq!(core.probes.probes.get(), 1);
        let second = core
            .remaining("commandcode/deepseek/deepseek-v4-flash", false)
            .unwrap();
        assert!(second.cached);
        assert_eq!(core.probes.probes.get(), 1);
        assert_eq!(second.remaining, serde_json::Value::Bool(false));
    }

    #[test]
    fn past_fresh_until_reprobes() {
        let outcome = ProbeOutcome {
            cache_key: "commandcode:abc".into(),
            state: ProviderState::Exhausted,
            reason: Some("credits".into()),
            reset_at: None,
            remaining_credits: Some(0),
        };
        let core = core(1_000, outcome);
        core.remaining("commandcode/x", false).unwrap();
        core.clock.0.set(1_000 + NEGATIVE_CAP_SECS + 1);
        core.remaining("commandcode/x", false).unwrap();
        assert_eq!(core.probes.probes.get(), 2);
    }

    #[test]
    fn mark_exhausted_is_live_signal() {
        let outcome = ProbeOutcome {
            cache_key: "commandcode:abc".into(),
            state: ProviderState::Available,
            reason: None,
            reset_at: None,
            remaining_credits: Some(9),
        };
        let core = core(1_000, outcome);
        core.remaining("commandcode/x", false).unwrap();
        core.mark_exhausted("commandcode/x", None).unwrap();
        let answer = core.remaining("commandcode/x", false).unwrap();
        assert_eq!(answer.remaining, serde_json::Value::Bool(false));
        assert!(answer.cached);
        assert_eq!(answer.reason.as_deref(), Some("live-limit"));
        assert_eq!(core.probes.probes.get(), 1);
    }

    #[test]
    fn force_refresh_ignores_fresh_cache() {
        let outcome = ProbeOutcome {
            cache_key: "commandcode:abc".into(),
            state: ProviderState::Exhausted,
            reason: Some("credits".into()),
            reset_at: None,
            remaining_credits: Some(0),
        };
        let core = core(1_000, outcome);
        core.remaining("commandcode/x", false).unwrap();
        core.remaining("commandcode/x", true).unwrap();
        assert_eq!(core.probes.probes.get(), 2);
    }
}
