use executor::runner::{journal_log, run_text, RunOptions};

#[test]
fn missing_executable() {
    let result = run_text(
        &["/executor-test/missing-executable".into()],
        RunOptions::default(),
    );
    assert!(!result.ok);
    assert!(!result.success);
    assert!(result.exit_code.is_none());
    assert!(result.spawn_error.is_some());
    assert!(!result.timed_out);
}

#[test]
fn bounded_timeout() {
    let result = run_text(
        &["/bin/sh".into(), "-c".into(), "sleep 1".into()],
        RunOptions {
            timeout_ms: 25,
            max_buffer: 1024,
            cwd: None,
        },
    );
    assert!(!result.ok);
    assert!(result.timed_out);
    assert!(result.spawn_error.is_none());
}

#[test]
fn output_overflow() {
    let result = run_text(
        &[
            "/bin/sh".into(),
            "-c".into(),
            "printf 123456789; sleep 1".into(),
        ],
        RunOptions {
            timeout_ms: 1_000,
            max_buffer: 4,
            cwd: None,
        },
    );
    assert!(!result.ok);
    assert!(result.output_overflow);
    assert!(result.spawn_error.is_none());
}

#[test]
fn journal_fallback() {
    journal_log(
        "executor/test-journal-fallback",
        "[executor] fallback test\n",
        "/executor-test/missing-systemd-cat",
    );
}
