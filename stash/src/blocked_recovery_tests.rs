#[cfg(test)]
mod source_regression_tests {
    use crate::downloads::JobManager;
    use crate::job_sources::JobSource;
    use crate::store;
    use crate::store::unix_now;
    use std::path::Path;

    #[tokio::test]
    async fn test_source_without_candidates_durable_fails_immediately() {
        let db = store::open_db(Path::new(":memory:")).unwrap();
        let job_id = "test-no-candidates";

        store::create_job(
            &db,
            job_id,
            "https://page.test/video",
            "https://cdn/master.txt",
            "test.mp4",
            "[]",
            "/tmp/stash-test-no-candidates",
            3,
            30,
            unix_now(),
        )
        .unwrap();

        db.execute(
            "UPDATE download_jobs SET status = 'running' WHERE id = ?1",
            rusqlite::params![job_id],
        )
        .unwrap();

        let jobs = JobManager::new(db);

        let will_retry = jobs
            .fail_or_retry(job_id, "download failed: HTTP 403 Forbidden", 3, 30)
            .await;

        assert!(
            !will_retry,
            "Should not retry when no alternate sources are available"
        );

        let job = jobs.get_job(job_id).await.unwrap();
        assert_eq!(job.status, "failed");
        assert_eq!(
            job.retry_count, 0,
            "Retry count should remain unchanged if it fails immediately without switching"
        );
    }

    #[tokio::test]
    async fn test_two_eligible_durable_candidates_switch_and_exhaust() {
        let db = store::open_db(Path::new(":memory:")).unwrap();
        let job_id = "test-two-candidates";

        let unique_id = uuid::Uuid::new_v4().to_string();
        let temp_dir = std::env::temp_dir().join(format!("stash-test-{}", unique_id));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let sentinel_path = temp_dir.join("cache_sentinel");
        std::fs::write(&sentinel_path, b"sentinel").unwrap();

        let temp_dir_str = temp_dir.to_str().unwrap();

        store::create_job(
            &db,
            job_id,
            "https://page.test/video",
            "https://cdn/original.txt",
            "test.mp4",
            "[]",
            temp_dir_str,
            3,
            30,
            unix_now(),
        )
        .unwrap();

        db.execute(
            "UPDATE download_jobs SET status = 'running', downloaded_bytes = 600 WHERE id = ?1",
            rusqlite::params![job_id],
        )
        .unwrap();

        let jobs = JobManager::new(db);

        let sources = vec![
            JobSource {
                url: "https://cdn/original.txt".into(),
                size_bytes: Some(600),
                tried: true,
            },
            JobSource {
                url: "https://cdn/alt700.txt".into(),
                size_bytes: Some(700),
                tried: false,
            },
            JobSource {
                url: "https://cdn/huge1200.txt".into(),
                size_bytes: Some(1200),
                tried: false,
            },
            JobSource {
                url: "https://cdn/signed.m3u8?asn=1".into(),
                size_bytes: None,
                tried: false,
            },
        ];

        jobs.set_job_sources(job_id, &sources, Some(600)).await;

        let will_retry_1 = jobs
            .fail_or_retry(job_id, "download failed: HTTP 403 Forbidden", 3, 30)
            .await;

        assert!(
            will_retry_1,
            "Should switch to alternate source and return true"
        );

        let job_after_1 = jobs.get_job(job_id).await.unwrap();
        assert_eq!(
            job_after_1.src_url, "https://cdn/alt700.txt",
            "Source should switch to alt700"
        );
        assert_eq!(
            job_after_1.downloaded_bytes, 0,
            "Downloaded progress should reset to zero on source switch"
        );
        assert_eq!(job_after_1.status, "queued");
        assert!(jobs.set_job_running(job_id).await);

        assert!(sentinel_path.exists(), "Cache sentinel should be retained");

        let will_retry_2 = jobs
            .fail_or_retry(job_id, "download failed: HTTP 403 Forbidden", 3, 30)
            .await;

        assert!(
            !will_retry_2,
            "Should fail exhausted when no more eligible alternates"
        );

        let job_after_2 = jobs.get_job(job_id).await.unwrap();
        assert_eq!(job_after_2.status, "failed");

        let _ = std::fs::remove_file(&sentinel_path);
        let _ = std::fs::remove_dir(&temp_dir);
    }

    #[tokio::test]
    async fn test_legacy_retry_wait_settlement() {
        let db = store::open_db(Path::new(":memory:")).unwrap();

        let setup_retry_job = |id: &str, error_msg: &str, src_url: &str| {
            store::create_job(
                &db,
                id,
                "https://page.test/video",
                src_url,
                "test.mp4",
                "[]",
                "/tmp/stash-test-legacy",
                3,
                30,
                unix_now(),
            )
            .unwrap();

            let future_time = unix_now() + 1000;
            db.execute(
                "UPDATE download_jobs SET status = 'retry_wait', last_error = ?1, next_retry_at = ?2, retry_count = 1 WHERE id = ?3",
                rusqlite::params![error_msg, future_time, id],
            )
            .unwrap();
        };

        setup_retry_job(
            "legacy-durable-403",
            "HTTP 403 Forbidden",
            "https://cdn/durable.txt",
        );

        setup_retry_job(
            "legacy-signed-403",
            "HTTP 403 Forbidden",
            "https://cdn/signed.m3u8?token=abc",
        );

        setup_retry_job(
            "legacy-404",
            "HTTP 404 Not Found",
            "https://cdn/permanent.txt",
        );

        setup_retry_job(
            "legacy-transient-502",
            "HTTP 502 Bad Gateway",
            "https://cdn/transient.txt",
        );

        store::create_job(
            &db,
            "healthy-running",
            "https://page.test/video",
            "https://cdn/healthy.txt",
            "test.mp4",
            "[]",
            "/tmp/stash-test-legacy",
            3,
            30,
            unix_now(),
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'running' WHERE id = ?1",
            rusqlite::params!["healthy-running"],
        )
        .unwrap();

        store::create_job(
            &db,
            "queued-403",
            "https://page.test/video",
            "https://cdn/queued.txt",
            "test.mp4",
            "[]",
            "/tmp/stash-test-legacy",
            3,
            30,
            unix_now(),
        )
        .unwrap();
        db.execute(
            "UPDATE download_jobs SET status = 'queued', last_error = 'HTTP 403 Forbidden' WHERE id = ?1",
            rusqlite::params!["queued-403"],
        )
        .unwrap();

        let jobs = JobManager::new(db);

        let settled_count = jobs.settle_nonretryable_retries().await.unwrap();

        assert_eq!(
            settled_count, 3,
            "Should settle exactly 3 non-retryable legacy retries"
        );

        let j1 = jobs.get_job("legacy-durable-403").await.unwrap();
        assert_eq!(j1.status, "failed");
        assert_eq!(
            j1.retry_count, 1,
            "Retry count should NOT increment during settlement"
        );

        let j2 = jobs.get_job("legacy-signed-403").await.unwrap();
        assert_eq!(j2.status, "failed");
        assert_eq!(j2.retry_count, 1);

        let j3 = jobs.get_job("legacy-404").await.unwrap();
        assert_eq!(j3.status, "failed");
        assert_eq!(j3.retry_count, 1);

        let j4 = jobs.get_job("legacy-transient-502").await.unwrap();
        assert_eq!(
            j4.status, "retry_wait",
            "Transient errors should remain in retry_wait"
        );
        assert_eq!(j4.retry_count, 1);

        let j5 = jobs.get_job("healthy-running").await.unwrap();
        assert_eq!(j5.status, "running");

        let j6 = jobs.get_job("queued-403").await.unwrap();
        assert_eq!(j6.status, "queued");
    }

    #[tokio::test]
    async fn test_transient_failure_schedules_retry() {
        let db = store::open_db(Path::new(":memory:")).unwrap();
        let job_id = "test-transient-retry";

        store::create_job(
            &db,
            job_id,
            "https://page.test/video",
            "https://cdn/master.txt",
            "test.mp4",
            "[]",
            "/tmp/stash-test-transient",
            3,
            30,
            unix_now(),
        )
        .unwrap();

        db.execute(
            "UPDATE download_jobs SET status = 'running' WHERE id = ?1",
            rusqlite::params![job_id],
        )
        .unwrap();

        let jobs = JobManager::new(db);

        let will_retry = jobs
            .fail_or_retry(job_id, "download failed: HTTP 502 Bad Gateway", 3, 30)
            .await;

        assert!(will_retry, "Transient failures should schedule a retry");

        let job = jobs.get_job(job_id).await.unwrap();
        assert_eq!(job.status, "retry_wait");
        assert_eq!(job.retry_count, 1, "Retry count should increment to 1");
    }
}
