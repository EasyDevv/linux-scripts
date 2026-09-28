//! Streaming (named-pipe + concat-demuxer) mux for browser-HLS jobs.
//!
//! Mirrors the reqwest-HLS streaming mux in `downloads.rs` (same pipe
//! mechanics, same "pipes on local disk, never raw-byte-concat segments"
//! rules — see docs/study/260927-mpmux-and-finalize-failures.md for why),
//! adapted for a job whose segments arrive one HTTP PUT at a time instead of
//! from a single owning download loop. Because there is no one task that
//! spans the whole upload window, a job that stalls or never calls
//! `complete` needs an external sweep to kill its ffmpeg child and free the
//! pipes — see `sweep_stale`, driven by the same worker loop that already
//! polls browser-HLS job staleness in `worker.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use tokio::process::Child;
use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;
use tracing::info;

use crate::downloads::JobManager;

pub struct StreamingMux {
    pub child: Option<Child>,
    pub feeder: Option<JoinHandle<Result<(), String>>>,
    pub tx: Option<UnboundedSender<PathBuf>>,
    pub pipe_dir: PathBuf,
    pub staged_path: PathBuf,
    pub next_feed_index: u64,
}

/// job_id -> in-progress streaming mux. An entry's presence *is* "this job is
/// streaming"; `upload_browser_hls_segment` and `complete_browser_hls_job`
/// both no-op into the batch (concat-list) path when their job has no entry.
pub type Registry = Arc<StdMutex<HashMap<String, Arc<AsyncMutex<StreamingMux>>>>>;

pub fn new_registry() -> Registry {
    Arc::new(StdMutex::new(HashMap::new()))
}

/// Sends any newly-ready, contiguous `segment-{next_feed_index:06}.ts` files
/// into the mux's pipes, stopping at the first gap. Cheap when nothing new is
/// ready (one failed stat). Call after every segment upload and once more at
/// completion to catch whatever landed since the last upload's call.
pub async fn feed_ready_segments(mux: &mut StreamingMux, temp_dir: &std::path::Path) {
    let Some(tx) = mux.tx.as_ref() else { return };
    loop {
        let path = temp_dir.join(format!("segment-{:06}.ts", mux.next_feed_index));
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            break;
        }
        if tx.send(path).is_err() {
            break; // feeder task died; the caller's eventual join will surface why
        }
        mux.next_feed_index += 1;
    }
}

/// Kills the child, aborts the feeder, and removes the pipe dir. Used when a
/// job goes stale mid-stream (never reaches `complete`) or when setup fails
/// partway through.
pub async fn abort(mux: &mut StreamingMux) {
    mux.tx.take(); // drop the sender: unblocks the feeder if it's mid-write
    if let Some(mut child) = mux.child.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    if let Some(feeder) = mux.feeder.take() {
        feeder.abort();
    }
    let _ = tokio::fs::remove_dir_all(&mux.pipe_dir).await;
}

/// Removes and aborts any streaming mux whose job is no longer accepting
/// segments (status left running/finalizing/assembling/remuxing) or hasn't
/// progressed in `stale_timeout_secs`. Call this on the same cadence as
/// `stale_browser_hls_cleanup` (see `worker.rs`) — after that call has had a
/// chance to update job status/`updated_at` for this tick.
pub async fn sweep_stale(registry: &Registry, jobs: &JobManager, stale_timeout_secs: u64) {
    let job_ids: Vec<String> = {
        let map = registry.lock().unwrap();
        map.keys().cloned().collect()
    };
    for job_id in job_ids {
        let job = jobs.get_job(&job_id).await;
        let alive = job.as_ref().is_some_and(|j| {
            matches!(
                j.status.as_str(),
                "running" | "finalizing" | "assembling" | "remuxing"
            )
        });
        let now = crate::store::unix_now();
        let stale = job
            .as_ref()
            .map(|j| now.saturating_sub(j.updated_at) >= stale_timeout_secs)
            .unwrap_or(true);
        if alive && !stale {
            continue;
        }
        let entry = { registry.lock().unwrap().remove(&job_id) };
        let Some(entry) = entry else { continue };
        let mut mux = entry.lock().await;
        info!("job {job_id}: streaming browser HLS mux went stale, tearing down");
        abort(&mut mux).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_mux(tx: UnboundedSender<PathBuf>) -> StreamingMux {
        StreamingMux {
            child: None,
            feeder: None,
            tx: Some(tx),
            pipe_dir: PathBuf::new(),
            staged_path: PathBuf::new(),
            next_feed_index: 0,
        }
    }

    async fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stash-browser-hls-stream-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        dir
    }

    #[tokio::test]
    async fn feed_ready_segments_sends_contiguous_segments_in_order_and_stops_at_gap() {
        let dir = scratch_dir("gap").await;
        tokio::fs::write(dir.join("segment-000000.ts"), b"a")
            .await
            .unwrap();
        tokio::fs::write(dir.join("segment-000001.ts"), b"a")
            .await
            .unwrap();
        tokio::fs::write(dir.join("segment-000003.ts"), b"a") // index 2 missing
            .await
            .unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut mux = dummy_mux(tx);
        feed_ready_segments(&mut mux, &dir).await;

        assert_eq!(mux.next_feed_index, 2);
        assert_eq!(rx.try_recv().unwrap(), dir.join("segment-000000.ts"));
        assert_eq!(rx.try_recv().unwrap(), dir.join("segment-000001.ts"));
        assert!(rx.try_recv().is_err());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn feed_ready_segments_resumes_from_a_nonzero_index() {
        let dir = scratch_dir("resume").await;
        for i in 0..4u64 {
            tokio::fs::write(dir.join(format!("segment-{i:06}.ts")), b"a")
                .await
                .unwrap();
        }
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut mux = dummy_mux(tx);
        mux.next_feed_index = 2;
        feed_ready_segments(&mut mux, &dir).await;

        assert_eq!(mux.next_feed_index, 4);
        assert_eq!(rx.try_recv().unwrap(), dir.join("segment-000002.ts"));
        assert_eq!(rx.try_recv().unwrap(), dir.join("segment-000003.ts"));
        assert!(rx.try_recv().is_err());
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn feed_ready_segments_is_a_noop_once_tx_has_been_taken() {
        let dir = scratch_dir("no-tx").await;
        tokio::fs::write(dir.join("segment-000000.ts"), b"a")
            .await
            .unwrap();

        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut mux = dummy_mux(tx);
        mux.tx.take();
        feed_ready_segments(&mut mux, &dir).await;

        assert_eq!(mux.next_feed_index, 0);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
