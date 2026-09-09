use std::path::Path;

use crate::hls;
use crate::store;

#[test]
fn requeue_stalled_running_jobs_respects_hls_download_timeout() {
    let db = store::open_db(Path::new(":memory:")).unwrap();

    store::create_job(
        &db,
        "hls",
        "page",
        "source",
        "video.mp4",
        "[]",
        "",
        5,
        30,
        1,
    )
    .unwrap();
    store::create_job(
        &db,
        "direct",
        "page",
        "source",
        "video.mp4",
        "[]",
        "",
        5,
        30,
        1,
    )
    .unwrap();

    db.execute("UPDATE download_jobs SET status = 'running', updated_at = 100", [])
        .unwrap();
    db.execute("UPDATE download_jobs SET phase = 'download' WHERE id = 'hls'", [])
        .unwrap();

    let now: u64 = 400;
    let stale_before: u64 = now - 120;
    let hls_stale_before: u64 = now.saturating_sub(hls::STALL_TIMEOUT_SECS);

    let requeued = store::requeue_stalled_running_jobs(&db, stale_before, hls_stale_before, now)
        .unwrap();
    assert_eq!(requeued, vec!["direct".to_string()]);

    let hls_job = store::get_job(&db, "hls").unwrap().unwrap();
    assert_eq!(hls_job.status, "running");
    assert_eq!(hls_job.retry_count, 0);

    let now: u64 = 100 + hls::STALL_TIMEOUT_SECS + 1;
    let stale_before: u64 = now - 120;
    let hls_stale_before: u64 = now.saturating_sub(hls::STALL_TIMEOUT_SECS);

    let requeued = store::requeue_stalled_running_jobs(&db, stale_before, hls_stale_before, now)
        .unwrap();
    assert_eq!(requeued, vec!["hls".to_string()]);

    let hls_job = store::get_job(&db, "hls").unwrap().unwrap();
    assert_eq!(hls_job.status, "retry_wait");
    assert_eq!(hls_job.retry_count, 1);

    assert!(hls::STALL_TIMEOUT_SECS >= 604u64);
}