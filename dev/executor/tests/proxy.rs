use axum::body::Body;
use axum::extract::ws::WebSocketUpgrade;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use executor::config::{NormalizedConfig, NormalizedInstance};
use executor::proxy::{local_url, upstream_unavailable_response, LocalProxy, LocalProxyOptions};
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::{stream, SinkExt, StreamExt};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

fn config_for(port: u16, name: &str) -> NormalizedConfig {
    let mut instances = BTreeMap::new();
    instances.insert(
        name.into(),
        NormalizedInstance {
            name: name.into(),
            dir: "/tmp".into(),
            cmd: format!("server --port {port}"),
            enabled: true,
            env: BTreeMap::new(),
        },
    );
    NormalizedConfig {
        instances,
        disabled: BTreeSet::new(),
        restart_tokens: BTreeMap::new(),
    }
}

async fn wait_until(mut check: impl FnMut() -> bool, timeout_ms: u64) {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("timed out waiting for proxy state");
}

async fn spawn_router(app: Router) -> (u16, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
            .ok();
    });
    (port, tx)
}

async fn connect_proxy_ws(
    proxy_port: u16,
    path: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = format!("ws://127.0.0.1:{proxy_port}{path}")
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        "host",
        format!("sample.localhost:{proxy_port}").parse().unwrap(),
    );
    let (ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    ws
}

#[test]
fn local_url_maps_name() {
    assert_eq!(local_url("postdock"), "http://postdock.localhost");
}

#[tokio::test]
async fn unavailable_html_is_not_cached() {
    let response = upstream_unavailable_response(true, true);
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(
        response.headers().get("cache-control").unwrap(),
        "no-store, max-age=0"
    );
    assert_eq!(response.headers().get("retry-after").unwrap(), "1");
    let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&body);
    assert!(text.contains("http-equiv=\"refresh\""));
}

#[tokio::test]
async fn stalled_html_does_not_restart_first_boot() {
    let app = Router::new().fallback(any(|| async {
        std::future::pending::<Response>().await
    }));
    let (port, stop) = spawn_router(app).await;
    let timed_out = Arc::new(Mutex::new(Vec::new()));
    let proxy = LocalProxy::bind(
        0,
        25,
        Some({
            let timed_out = timed_out.clone();
            Arc::new(move |name| timed_out.lock().unwrap().push(name))
        }),
        10_000,
        LocalProxyOptions::default(),
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    let response = client
        .get(format!("http://127.0.0.1:{}/stalled", proxy.port()))
        .header("host", format!("sample.localhost:{}", proxy.port()))
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(started.elapsed() < Duration::from_millis(500));
    assert!(timed_out.lock().unwrap().is_empty());
    let body = response.text().await.unwrap();
    assert!(body.contains("Development server starting"));
    assert!(body.contains("http-equiv=\"refresh\""));
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn first_boot_does_not_abort_compile() {
    let aborted = Arc::new(AtomicBool::new(false));
    let app = Router::new().fallback(any({
        let aborted = aborted.clone();
        move |request: axum::http::Request<Body>| {
            let aborted = aborted.clone();
            async move {
                let _ = request;
                tokio::select! {
                    _ = std::future::pending::<()>() => {}
                    _ = tokio::time::sleep(Duration::from_secs(30)) => {}
                }
                aborted.store(true, Ordering::SeqCst);
                StatusCode::OK.into_response()
            }
        }
    }));
    let (port, stop) = spawn_router(app).await;
    let proxy = LocalProxy::bind(0, 25, None, 10_000, LocalProxyOptions::default())
        .await
        .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let response = client
        .get(format!("http://127.0.0.1:{}/stalled", proxy.port()))
        .header("host", format!("sample.localhost:{}", proxy.port()))
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(!aborted.load(Ordering::SeqCst));
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn restarts_after_start_budget() {
    let app = Router::new().fallback(any(|| async {
        std::future::pending::<Response>().await
    }));
    let (port, stop) = spawn_router(app).await;
    let timed_out = Arc::new(Mutex::new(Vec::new()));
    let proxy = LocalProxy::bind(
        0,
        20,
        Some({
            let timed_out = timed_out.clone();
            Arc::new(move |name| timed_out.lock().unwrap().push(name))
        }),
        45,
        LocalProxyOptions::default(),
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let navigate = || {
        let client = client.clone();
        let url = format!("http://127.0.0.1:{}/stalled", proxy.port());
        let host = format!("sample.localhost:{}", proxy.port());
        async move {
            client
                .get(url)
                .header("host", host)
                .header("accept", "text/html")
                .send()
                .await
                .unwrap()
        }
    };
    let _ = navigate().await;
    assert!(timed_out.lock().unwrap().is_empty());
    tokio::time::sleep(Duration::from_millis(30)).await;
    let _ = navigate().await;
    assert_eq!(timed_out.lock().unwrap().as_slice(), ["sample"]);
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn restarts_after_healthy_stall() {
    let stall = Arc::new(AtomicBool::new(false));
    let app = Router::new().fallback(any({
        let stall = stall.clone();
        move || {
            let stall = stall.clone();
            async move {
                if stall.load(Ordering::SeqCst) {
                    std::future::pending::<Response>().await
                } else {
                    "ok".into_response()
                }
            }
        }
    }));
    let (port, stop) = spawn_router(app).await;
    let timed_out = Arc::new(Mutex::new(Vec::new()));
    let proxy = LocalProxy::bind(
        0,
        25,
        Some({
            let timed_out = timed_out.clone();
            Arc::new(move |name| timed_out.lock().unwrap().push(name))
        }),
        10_000,
        LocalProxyOptions::default(),
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/page", proxy.port());
    let host = format!("sample.localhost:{}", proxy.port());
    let first = client
        .get(&url)
        .header("host", &host)
        .header("accept", "text/html")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(first, "ok");
    stall.store(true, Ordering::SeqCst);
    let _ = client
        .get(&url)
        .header("host", &host)
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert!(timed_out.lock().unwrap().is_empty());
    tokio::time::sleep(Duration::from_millis(30)).await;
    let _ = client
        .get(&url)
        .header("host", &host)
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(timed_out.lock().unwrap().as_slice(), ["sample"]);
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn slow_first_html_keeps_running() {
    let served = Arc::new(AtomicU32::new(0));
    let delay = Arc::new(AtomicU32::new(60));
    let app = Router::new().fallback(any({
        let served = served.clone();
        let delay = delay.clone();
        move || {
            let served = served.clone();
            let delay = delay.clone();
            async move {
                let n = served.fetch_add(1, Ordering::SeqCst) + 1;
                let wait = delay.swap(0, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(wait as u64)).await;
                format!("ok-{n}").into_response()
            }
        }
    }));
    let (port, stop) = spawn_router(app).await;
    let timed_out = Arc::new(Mutex::new(Vec::new()));
    let proxy = LocalProxy::bind(
        0,
        20,
        Some({
            let timed_out = timed_out.clone();
            Arc::new(move |name| timed_out.lock().unwrap().push(name))
        }),
        10_000,
        LocalProxyOptions::default(),
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/slow", proxy.port());
    let host = format!("sample.localhost:{}", proxy.port());
    let first = client
        .get(&url)
        .header("host", &host)
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::BAD_GATEWAY);
    assert!(timed_out.lock().unwrap().is_empty());
    tokio::time::sleep(Duration::from_millis(80)).await;
    let second = client
        .get(&url)
        .header("host", &host)
        .header("accept", "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    assert!(second.text().await.unwrap().starts_with("ok-"));
    assert!(timed_out.lock().unwrap().is_empty());
    assert!(served.load(Ordering::SeqCst) >= 1);
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn refused_html_restarts() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let failed = Arc::new(Mutex::new(Vec::new()));
    let proxy = LocalProxy::bind(
        0,
        25,
        Some({
            let failed = failed.clone();
            Arc::new(move |name| failed.lock().unwrap().push(name))
        }),
        5_000,
        LocalProxyOptions::default(),
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let navigate = || {
        let client = client.clone();
        let url = format!("http://127.0.0.1:{}/stalled", proxy.port());
        let host = format!("sample.localhost:{}", proxy.port());
        async move {
            client
                .get(url)
                .header("host", host)
                .header("accept", "text/html")
                .send()
                .await
                .unwrap()
        }
    };
    let _ = navigate().await;
    assert!(failed.lock().unwrap().is_empty());
    tokio::time::sleep(Duration::from_millis(30)).await;
    let _ = navigate().await;
    assert_eq!(failed.lock().unwrap().as_slice(), ["sample"]);
    let _ = proxy.stop(None).await;
}

#[tokio::test]
async fn forwards_http_and_websocket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new()
        .route(
            "/hmr",
            get(|ws: WebSocketUpgrade| async {
                ws.on_upgrade(|mut socket| async move {
                    while let Some(Ok(msg)) = socket.recv().await {
                        if socket.send(msg).await.is_err() {
                            break;
                        }
                    }
                })
            }),
        )
        .route(
            "/compressed",
            get(|| async {
                let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
                encoder.write_all(b"compressed").unwrap();
                let bytes = encoder.finish().unwrap();
                Response::builder()
                    .header("content-encoding", "gzip")
                    .body(Body::from(bytes))
                    .unwrap()
            }),
        )
        .fallback(any(|req: axum::http::Request<Body>| async move {
            req.uri().path().to_string()
        }));
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    let proxy = LocalProxy::bind(0, 5_000, None, 10_000, LocalProxyOptions::default())
        .await
        .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let host = format!("sample.localhost:{}", proxy.port());
    let health = client
        .get(format!("http://127.0.0.1:{}/health", proxy.port()))
        .header("host", &host)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(health, "/health");
    let compressed = client
        .get(format!("http://127.0.0.1:{}/compressed", proxy.port()))
        .header("host", &host)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(compressed, "compressed");
    let mut ws = connect_proxy_ws(proxy.port(), "/hmr").await;
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        "ready".into(),
    ))
    .await
    .unwrap();
    let echoed = ws.next().await.unwrap().unwrap();
    assert_eq!(echoed.to_text().unwrap(), "ready");
    let _ = proxy.stop(None).await;
}

#[tokio::test]
async fn streams_and_strips_hop_headers() {
    let received = Arc::new(Mutex::new(HeaderMap::new()));
    let app = Router::new().fallback(any({
        let received = received.clone();
        move |req: axum::http::Request<Body>| {
            let received = received.clone();
            async move {
                *received.lock().unwrap() = req.headers().clone();
                let body = Body::from_stream(
                    stream::once(async {
                        Ok::<_, std::io::Error>(bytes::Bytes::from_static(b"first-"))
                    })
                    .chain(stream::once(async {
                        tokio::time::sleep(Duration::from_millis(25)).await;
                        Ok(bytes::Bytes::from_static(b"second"))
                    })),
                );
                Response::builder()
                    .header("connection", "keep-alive, x-response-hop")
                    .header("x-response-hop", "remove")
                    .header("keep-alive", "timeout=5")
                    .header("te", "trailers")
                    .header("x-response-visible", "keep")
                    .header("location", "/next")
                    .header("set-cookie", "session=ok; Path=/")
                    .body(body)
                    .unwrap()
            }
        }
    }));
    let (port, stop) = spawn_router(app).await;
    let proxy = LocalProxy::bind(0, 20, None, 10_000, LocalProxyOptions::default())
        .await
        .unwrap();
    proxy.update(&config_for(port, "sample"));
    let client = reqwest::Client::new();
    let response = client
        .get(format!("http://127.0.0.1:{}/stream", proxy.port()))
        .header("host", format!("sample.localhost:{}", proxy.port()))
        .header("accept", "text/html")
        .header("connection", "keep-alive, x-request-hop")
        .header("x-request-hop", "remove")
        .header("keep-alive", "timeout=5")
        .header("te", "trailers")
        .header("upgrade", "h2c")
        .header("x-request-visible", "keep")
        .send()
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(35)).await;
    let text = response.text().await.unwrap();
    assert_eq!(text, "first-second");
    let forwarded = received.lock().unwrap().clone();
    assert!(forwarded.get("x-request-hop").is_none());
    assert!(forwarded.get("keep-alive").is_none());
    assert!(forwarded.get("te").is_none());
    assert_eq!(
        forwarded.get("x-request-visible").unwrap(),
        "keep"
    );
    assert_eq!(
        forwarded.get("host").unwrap(),
        format!("127.0.0.1:{port}").as_str()
    );
    assert_eq!(
        forwarded.get("x-forwarded-host").unwrap(),
        format!("sample.localhost:{}", proxy.port()).as_str()
    );
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn escapes_index_names() {
    let name = "bad\"><script>alert(1)</script>&'";
    let proxy = LocalProxy::bind(0, 5_000, None, 10_000, LocalProxyOptions::default())
        .await
        .unwrap();
    proxy.update(&config_for(31_337, name));
    let html = reqwest::get(format!("http://127.0.0.1:{}/", proxy.port()))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("&lt;script&gt;"));
    assert!(html.contains("&quot;"));
    assert!(html.contains("&#39;"));
    assert!(html.contains("&amp;"));
    assert!(!html.contains("<script>"));
    let _ = proxy.stop(None).await;
}

#[tokio::test]
async fn websocket_connect_timeout_closes() {
    let app = Router::new().fallback(any(|| async {
        std::future::pending::<Response>().await
    }));
    let (port, stop) = spawn_router(app).await;
    let proxy = LocalProxy::bind(
        0,
        5_000,
        None,
        10_000,
        LocalProxyOptions {
            websocket_connect_timeout_ms: 25,
            ..LocalProxyOptions::default()
        },
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let mut ws = connect_proxy_ws(proxy.port(), "/hmr").await;
    wait_until(|| proxy.snapshot().pending_websockets == 1, 500).await;
    let close = loop {
        match ws.next().await {
            Some(Ok(tokio_tungstenite::tungstenite::Message::Close(frame))) => break frame,
            Some(Ok(_)) => continue,
            other => panic!("unexpected {other:?}"),
        }
    };
    assert_eq!(close.unwrap().code, tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Again);
    wait_until(|| proxy.snapshot().pending_websockets == 0, 500).await;
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}

#[tokio::test]
async fn websocket_queue_is_bounded() {
    let app = Router::new().fallback(any(|| async {
        std::future::pending::<Response>().await
    }));
    let (port, stop) = spawn_router(app).await;
    let proxy = LocalProxy::bind(
        0,
        5_000,
        None,
        10_000,
        LocalProxyOptions {
            websocket_queue_bytes: 4,
            websocket_queue_messages: 2,
            websocket_connect_timeout_ms: 250,
            ..LocalProxyOptions::default()
        },
    )
    .await
    .unwrap();
    proxy.update(&config_for(port, "sample"));
    let mut ws = connect_proxy_ws(proxy.port(), "/hmr").await;
    wait_until(|| proxy.snapshot().pending_websockets == 1, 500).await;
    ws.send(tokio_tungstenite::tungstenite::Message::Text("aa".into()))
        .await
        .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text("bb".into()))
        .await
        .unwrap();
    let _ = ws
        .send(tokio_tungstenite::tungstenite::Message::Text("c".into()))
        .await;
    let close = loop {
        match ws.next().await {
            Some(Ok(tokio_tungstenite::tungstenite::Message::Close(frame))) => break frame,
            Some(Ok(_)) => continue,
            Some(Err(_)) | None => break None,
        }
    };
    if let Some(frame) = close {
        assert_eq!(
            frame.code,
            tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Again
        );
    }
    wait_until(|| proxy.snapshot().pending_websockets == 0, 800).await;
    let _ = proxy.stop(None).await;
    let _ = stop.send(());
}
