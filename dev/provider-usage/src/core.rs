use anyhow::Result;
use serde::Serialize;

use crate::auth::{self, cache_key};
use crate::cache::{
    CacheFile, FileStore, ProviderSnapshot, ProviderState, Store, DEFAULT_CACHE_PATH,
};
use crate::commandcode;
use crate::grok;
use crate::http::{Http, ReqwestHttp};
use crate::openai;
use crate::opencode_go;
use crate::policy::{self, Remaining};

pub const REMAINING_TIMEOUT_MS: u64 = 8_000;

#[derive(Clone, Debug)]
pub struct ProbeOutcome {
    pub cache_key: String,
    pub state: ProviderState,
    pub reason: Option<String>,
    pub reset_at: Option<i64>,
    pub remaining_credits: Option<i64>,
    pub windows: Vec<crate::cache::UsageWindow>,
    pub renews_at: Option<i64>,
}

impl ProbeOutcome {
    pub fn unknown(cache_key: String, reason: Option<String>) -> Self {
        Self {
            cache_key,
            state: ProviderState::Unknown,
            reason,
            reset_at: None,
            remaining_credits: None,
            windows: Vec::new(),
            renews_at: None,
        }
    }
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
    fn from_snapshot(
        model: &str,
        provider: &str,
        snapshot: &ProviderSnapshot,
        cached: bool,
    ) -> Self {
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
                    return Ok(RemainingAnswer::from_snapshot(
                        model, &provider, snapshot, true,
                    ));
                }
            }
        }
        let snapshot = self.probe_provider(&provider, now)?;
        Ok(RemainingAnswer::from_snapshot(
            model, &provider, &snapshot, false,
        ))
    }

    pub fn refresh(&self, provider_or_model: &str) -> Result<RemainingAnswer> {
        let (_provider, model) = refresh_target(provider_or_model);
        self.remaining(&model, true)
    }

    pub fn refresh_many(&self, providers: &[String]) -> Result<Vec<RemainingAnswer>>
    where
        P: Sync,
    {
        if providers.len() <= 1 {
            return providers.iter().map(|item| self.refresh(item)).collect();
        }
        let now = self.clock.now();
        let before = self.store.load()?;
        let jobs: Vec<(String, String)> =
            providers.iter().map(|item| refresh_target(item)).collect();
        let probes = &self.probes;
        let jobs_ref = &jobs;
        let outcomes: Vec<ProbeOutcome> = std::thread::scope(|scope| {
            let mut joins = Vec::with_capacity(jobs.len());
            for i in 0..jobs.len() {
                joins.push(scope.spawn(move || probes.probe(&jobs_ref[i].0, now)));
            }
            joins
                .into_iter()
                .enumerate()
                .map(|(i, join)| {
                    join.join().unwrap_or_else(|_| {
                        ProbeOutcome::unknown(
                            probes.cache_key(&jobs_ref[i].0),
                            Some("probe".into()),
                        )
                    })
                })
                .collect()
        });
        let mut cache = self.store.load()?;
        let mut answers = Vec::with_capacity(jobs.len());
        for ((provider, model), outcome) in jobs.into_iter().zip(outcomes) {
            let prev = before.providers.get(&outcome.cache_key).cloned();
            let (key, snapshot) = outcome_snapshot(&provider, now, outcome, prev.as_ref());
            cache.providers.insert(key, snapshot.clone());
            answers.push(RemainingAnswer::from_snapshot(
                &model, &provider, &snapshot, false,
            ));
        }
        self.store.save(&cache)?;
        Ok(answers)
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
            windows: Vec::new(),
            renews_at: None,
        };
        self.upsert(key, snapshot.clone())?;
        Ok(RemainingAnswer::from_snapshot(
            model, &provider, &snapshot, false,
        ))
    }

    pub fn status(&self) -> Result<CacheFile> {
        self.store.load()
    }

    fn probe_provider(&self, provider: &str, now: i64) -> Result<ProviderSnapshot> {
        let outcome = self.probes.probe(provider, now);
        let mut cache = self.store.load()?;
        let prev = cache.providers.get(&outcome.cache_key).cloned();
        let (key, snapshot) = outcome_snapshot(provider, now, outcome, prev.as_ref());
        cache.providers.insert(key, snapshot.clone());
        self.store.save(&cache)?;
        Ok(snapshot)
    }

    fn upsert(&self, key: String, snapshot: ProviderSnapshot) -> Result<()> {
        let mut cache = self.store.load()?;
        cache.providers.insert(key, snapshot);
        self.store.save(&cache)
    }
}

fn refresh_target(provider_or_model: &str) -> (String, String) {
    let provider = provider_from_model(provider_or_model)
        .unwrap_or_else(|| provider_or_model.trim().to_ascii_lowercase());
    let model = if provider_or_model.contains('/') {
        provider_or_model.to_string()
    } else {
        format!("{provider}/")
    };
    (provider, model)
}

fn outcome_snapshot(
    provider: &str,
    now: i64,
    mut outcome: ProbeOutcome,
    prev: Option<&ProviderSnapshot>,
) -> (String, ProviderSnapshot) {
    if provider == "grok" {
        grok::apply_inferred_weekly_reset(&mut outcome, prev, now);
    }
    let key = outcome.cache_key;
    let snapshot = ProviderSnapshot {
        checked_at: now,
        state: outcome.state,
        reason: outcome.reason,
        reset_at: outcome.reset_at,
        fresh_until: policy::fresh_until(now, outcome.state, outcome.reset_at),
        remaining_credits: outcome.remaining_credits,
        windows: outcome.windows,
        renews_at: outcome.renews_at,
    };
    (key, snapshot)
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
    pub openai: Option<auth::OpenaiSession>,
    pub grok: Option<auth::GrokSession>,
    pub grok_management_key: Option<String>,
    pub grok_team_id: Option<String>,
}

impl LiveProbes<ReqwestHttp> {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            http: ReqwestHttp::with_timeout_ms(REMAINING_TIMEOUT_MS)?,
            commandcode_key: auth::commandcode_api_key(&auth::env_lookup, None),
            opencode_cookie: auth::opencode_cookie(&auth::env_lookup, None),
            opencode_workspace: auth::opencode_workspace_id(&auth::env_lookup, None),
            commandcode_base: DEFAULT_COMMANDCODE_BASE.to_string(),
            openai: auth::openai_session(&auth::env_lookup),
            grok: auth::grok_session(&auth::env_lookup),
            grok_management_key: auth::grok_management_key(&auth::env_lookup, None),
            grok_team_id: auth::grok_team_id(&auth::env_lookup),
        })
    }
}

const DEFAULT_COMMANDCODE_BASE: &str = commandcode::DEFAULT_API_BASE;

impl<H: Http> Probes for LiveProbes<H> {
    fn cache_key(&self, provider: &str) -> String {
        match provider {
            "commandcode" => cache_key(provider, self.commandcode_key.as_deref()),
            "opencode-go" => cache_key(provider, self.opencode_cookie.as_deref()),
            "openai" => cache_key(
                provider,
                self.openai.as_ref().map(|s| s.access_token.as_str()),
            ),
            "grok" => cache_key(
                provider,
                self.grok_management_key
                    .as_deref()
                    .or_else(|| self.grok.as_ref().map(|s| s.access_token.as_str())),
            ),
            other => cache_key(other, None),
        }
    }

    fn probe(&self, provider: &str, now: i64) -> ProbeOutcome {
        match provider {
            "commandcode" => match self.commandcode_key.as_deref() {
                Some(key) => commandcode::probe(&self.http, key, &self.commandcode_base)
                    .unwrap_or_else(|_| ProbeOutcome {
                        cache_key: self.cache_key(provider),
                        state: ProviderState::Unknown,
                        reason: Some("network".into()),
                        reset_at: None,
                        remaining_credits: None,
                        windows: Vec::new(),
                        renews_at: None,
                    }),
                None => ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("config".into()),
                    reset_at: None,
                    remaining_credits: None,
                    windows: Vec::new(),
                    renews_at: None,
                },
            },
            "opencode-go" => match self.opencode_cookie.as_deref() {
                Some(cookie) => {
                    opencode_go::probe(&self.http, cookie, self.opencode_workspace.as_deref(), now)
                        .unwrap_or_else(|_| ProbeOutcome {
                            cache_key: self.cache_key(provider),
                            state: ProviderState::Unknown,
                            reason: Some("network".into()),
                            reset_at: None,
                            remaining_credits: None,
                            windows: Vec::new(),
                            renews_at: None,
                        })
                }
                None => ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("config".into()),
                    reset_at: None,
                    remaining_credits: None,
                    windows: Vec::new(),
                    renews_at: None,
                },
            },
            "openai" => match &self.openai {
                Some(session) => openai::probe(
                    &self.http,
                    &openai::Session {
                        access_token: session.access_token.clone(),
                        refresh_token: session.refresh_token.clone(),
                        account_id: session.account_id.clone(),
                        auth_path: Some(session.auth_path.clone()),
                    },
                )
                .unwrap_or_else(|_| ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("network".into()),
                    reset_at: None,
                    remaining_credits: None,
                    windows: Vec::new(),
                    renews_at: None,
                }),
                None => ProbeOutcome {
                    cache_key: self.cache_key(provider),
                    state: ProviderState::Unknown,
                    reason: Some("config".into()),
                    reset_at: None,
                    remaining_credits: None,
                    windows: Vec::new(),
                    renews_at: None,
                },
            },
            "grok" => {
                if let Some(key) = self.grok_management_key.as_deref() {
                    grok::probe_management(&self.http, key, self.grok_team_id.as_deref())
                        .unwrap_or_else(|_| ProbeOutcome {
                            cache_key: self.cache_key(provider),
                            state: ProviderState::Unknown,
                            reason: Some("network".into()),
                            reset_at: None,
                            remaining_credits: None,
                            windows: Vec::new(),
                            renews_at: None,
                        })
                } else if let Some(session) = &self.grok {
                    grok::probe(
                        &self.http,
                        &grok::Session {
                            access_token: session.access_token.clone(),
                            user_id: session.user_id.clone(),
                        },
                    )
                    .unwrap_or_else(|_| ProbeOutcome {
                        cache_key: self.cache_key(provider),
                        state: ProviderState::Unknown,
                        reason: Some("network".into()),
                        reset_at: None,
                        remaining_credits: None,
                        windows: Vec::new(),
                        renews_at: None,
                    })
                } else {
                    ProbeOutcome {
                        cache_key: self.cache_key(provider),
                        state: ProviderState::Unknown,
                        reason: Some("config".into()),
                        reset_at: None,
                        remaining_credits: None,
                        windows: Vec::new(),
                        renews_at: None,
                    }
                }
            }
            _ => ProbeOutcome {
                cache_key: self.cache_key(provider),
                state: ProviderState::Unknown,
                reason: Some("unsupported".into()),
                reset_at: None,
                remaining_credits: None,
                windows: Vec::new(),
                renews_at: None,
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
                    windows: Vec::new(),
                    renews_at: None,
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
            windows: Vec::new(),
            renews_at: None,
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
            windows: Vec::new(),
            renews_at: None,
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
            windows: Vec::new(),
            renews_at: None,
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
            windows: Vec::new(),
            renews_at: None,
        };
        let core = core(1_000, outcome);
        core.remaining("commandcode/x", false).unwrap();
        core.remaining("commandcode/x", true).unwrap();
        assert_eq!(core.probes.probes.get(), 2);
    }

    struct GrokProbes {
        key: String,
        remaining: Cell<i64>,
        probes: Cell<u32>,
    }

    impl Probes for GrokProbes {
        fn cache_key(&self, _provider: &str) -> String {
            self.key.clone()
        }

        fn probe(&self, _provider: &str, _now: i64) -> ProbeOutcome {
            self.probes.set(self.probes.get() + 1);
            let remaining = self.remaining.get();
            ProbeOutcome {
                cache_key: self.key.clone(),
                state: ProviderState::Available,
                reason: None,
                reset_at: None,
                remaining_credits: Some(remaining),
                windows: vec![crate::cache::UsageWindow {
                    name: "weekly".into(),
                    used_percent: 0.0,
                    reset_at: None,
                }],
                renews_at: None,
            }
        }
    }

    #[test]
    fn grok_locks_weekly_reset_after_grant_fill() {
        let core = UsageCore {
            clock: FakeClock(Cell::new(1_000)),
            store: MemoryStore::default(),
            probes: GrokProbes {
                key: "grok:abc".into(),
                remaining: Cell::new(4_000),
                probes: Cell::new(0),
            },
        };
        let first = core.remaining("grok/x", true).unwrap();
        let expected = crate::grok::next_saturday_utc(1_000);
        assert_eq!(first.reset_at, Some(expected));
        core.probes.remaining.set(15_000);
        core.clock.0.set(1_060);
        let second = core.remaining("grok/x", true).unwrap();
        assert_eq!(second.reset_at, Some(expected));
        let status = core.status().unwrap();
        let snap = status.providers.get("grok:abc").unwrap();
        assert_eq!(snap.windows[0].reset_at, Some(expected));
    }

    #[test]
    fn refresh_many_probes_in_parallel_and_merges_cache() {
        use std::sync::Mutex;
        use std::time::{Duration, Instant};

        struct Frozen(i64);
        impl Clock for Frozen {
            fn now(&self) -> i64 {
                self.0
            }
        }

        struct DelayProbes {
            delay: Duration,
            count: Mutex<u32>,
        }
        impl Probes for DelayProbes {
            fn cache_key(&self, provider: &str) -> String {
                format!("{provider}:k")
            }
            fn probe(&self, provider: &str, _now: i64) -> ProbeOutcome {
                *self.count.lock().expect("count") += 1;
                std::thread::sleep(self.delay);
                ProbeOutcome {
                    cache_key: format!("{provider}:k"),
                    state: ProviderState::Available,
                    reason: None,
                    reset_at: None,
                    remaining_credits: Some(1),
                    windows: Vec::new(),
                    renews_at: None,
                }
            }
        }

        let delay = Duration::from_millis(150);
        let core = UsageCore {
            clock: Frozen(1_000),
            store: MemoryStore::default(),
            probes: DelayProbes {
                delay,
                count: Mutex::new(0),
            },
        };
        let names = vec![
            "openai".into(),
            "commandcode".into(),
            "opencode-go".into(),
            "grok".into(),
        ];
        let started = Instant::now();
        let answers = core.refresh_many(&names).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(answers.len(), 4);
        assert_eq!(*core.probes.count.lock().expect("count"), 4);
        assert_eq!(core.store.load().unwrap().providers.len(), 4);
        assert!(
            elapsed < delay * 3,
            "expected parallel wall < {:?}, got {:?}",
            delay * 3,
            elapsed
        );
    }
}
