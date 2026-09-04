use crate::config::NormalizedConfig;
use crate::runner::extract_port;
use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, FromRequest};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite;

const DEFAULT_NAV_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_START_BUDGET_MS: u64 = 120_000;
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

#[derive(Clone, Debug)]
pub struct LocalProxyOptions {
    pub stop_grace_period_ms: u64,
    pub websocket_queue_bytes: usize,
    pub websocket_queue_messages: usize,
    pub websocket_connect_timeout_ms: u64,
}

impl Default for LocalProxyOptions {
    fn default() -> Self {
        Self {
            stop_grace_period_ms: 5_000,
            websocket_queue_bytes: 1024 * 1024,
            websocket_queue_messages: 256,
            websocket_connect_timeout_ms: 5_000,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySnapshot {
    pub pending_requests: u64,
    #[serde(rename = "pendingWebSockets")]
    pub pending_websockets: u64,
}

struct ProxyState {
    routes: Mutex<HashMap<String, String>>,
    navigation_succeeded: Mutex<HashSet<String>>,
    navigation_failure_started: Mutex<HashMap<String, std::time::Instant>>,
    pending_requests: AtomicU64,
    pending_websockets: AtomicU64,
    navigation_timeout: Duration,
    start_budget: Duration,
    on_navigation_timeout: Option<Arc<dyn Fn(String) + Send + Sync>>,
    options: LocalProxyOptions,
    client: reqwest::Client,
}

pub struct LocalProxy {
    state: Arc<ProxyState>,
    port: u16,
    shutdown: watch::Sender<bool>,
}

impl LocalProxy {
    pub async fn bind(
        port: u16,
        navigation_timeout_ms: u64,
        on_navigation_timeout: Option<Arc<dyn Fn(String) + Send + Sync>>,
        start_budget_ms: u64,
        options: LocalProxyOptions,
    ) -> Result<Self, std::io::Error> {
        let listener = TcpListener::bind(("127.0.0.1", port)).await?;
        let bound = listener.local_addr()?.port();
        println!("[proxy] listening on http://localhost:{bound}");
        let state = Arc::new(ProxyState {
            routes: Mutex::new(HashMap::new()),
            navigation_succeeded: Mutex::new(HashSet::new()),
            navigation_failure_started: Mutex::new(HashMap::new()),
            pending_requests: AtomicU64::new(0),
            pending_websockets: AtomicU64::new(0),
            navigation_timeout: Duration::from_millis(if navigation_timeout_ms == 0 {
                DEFAULT_NAV_TIMEOUT_MS
            } else {
                navigation_timeout_ms
            }),
            start_budget: Duration::from_millis(if start_budget_ms == 0 {
                DEFAULT_START_BUDGET_MS
            } else {
                start_budget_ms
            }),
            on_navigation_timeout,
            options,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("client"),
        });
        let (shutdown, rx) = watch::channel(false);
        let app_state = state.clone();
        tokio::spawn(async move {
            let app = Router::new().fallback(any(handle)).with_state(app_state);
            let mut rx = rx;
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                while !*rx.borrow() {
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await
            .ok();
        });
        Ok(Self {
            state,
            port: bound,
            shutdown,
        })
    }

    pub fn update(&self, config: &NormalizedConfig) {
        let mut routes = HashMap::new();
        for (name, instance) in &config.instances {
            if config.is_enabled(name) {
                let port = extract_port(&instance.cmd);
                if !port.is_empty() {
                    routes.insert(name.to_lowercase(), port);
                }
            }
        }
        *self.state.routes.lock().unwrap() = routes;
    }

    pub fn snapshot(&self) -> ProxySnapshot {
        ProxySnapshot {
            pending_requests: self.state.pending_requests.load(Ordering::Relaxed),
            pending_websockets: self.state.pending_websockets.load(Ordering::Relaxed),
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn stop(&self, grace: Option<Duration>) -> Result<(), std::io::Error> {
        let _ = self.shutdown.send(true);
        let wait = grace.unwrap_or(Duration::from_millis(self.state.options.stop_grace_period_ms));
        tokio::time::sleep(wait.min(Duration::from_millis(50)).max(Duration::from_millis(5))).await;
        Ok(())
    }
}

pub fn local_url(name: &str) -> String {
    format!("http://{name}.localhost")
}

pub fn upstream_unavailable_response(html: bool, ready: bool) -> Response {
    unavailable(html, ready)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn hop_names(headers: &HeaderMap) -> HashSet<String> {
    let mut names: HashSet<String> = HOP_BY_HOP.iter().map(|name| (*name).to_string()).collect();
    for header in ["connection", "proxy-connection"] {
        if let Some(value) = headers.get(header).and_then(|value| value.to_str().ok()) {
            for token in value.split(',') {
                let token = token.trim().to_ascii_lowercase();
                if !token.is_empty() {
                    names.insert(token);
                }
            }
        }
    }
    names
}

async fn handle(
    axum::extract::State(state): axum::extract::State<Arc<ProxyState>>,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
) -> Response {
    let host = req
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let hostname = host.split(':').next().unwrap_or("").to_ascii_lowercase();
    if hostname == "127.0.0.1" || hostname == "localhost" || hostname.is_empty() {
        return index(&state);
    }
    let Some(name) = hostname.strip_suffix(".localhost").map(str::to_string) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let port = state.routes.lock().unwrap().get(&name).cloned();
    let Some(port) = port else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let is_ws = req
        .headers()
        .get("upgrade")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);
    if is_ws {
        return proxy_ws(state, req, name, port).await;
    }
    proxy_http(state, req, name, port, host).await
}

async fn proxy_ws(state: Arc<ProxyState>, req: Request<Body>, name: String, port: String) -> Response {
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let protocols = req
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let timeout = state.options.websocket_connect_timeout_ms;
    let queue_bytes = state.options.websocket_queue_bytes;
    let queue_messages = state.options.websocket_queue_messages;
    match WebSocketUpgrade::from_request(req, &state).await {
        Ok(upgrade) => {
            state.pending_websockets.fetch_add(1, Ordering::Relaxed);
            upgrade
                .on_upgrade(move |socket| async move {
                    relay_ws(
                        socket,
                        format!("ws://127.0.0.1:{port}{path_and_query}"),
                        timeout,
                        queue_bytes,
                        queue_messages,
                        protocols,
                    )
                    .await;
                    state.pending_websockets.fetch_sub(1, Ordering::Relaxed);
                    let _ = name;
                })
                .into_response()
        }
        Err(error) => error.into_response(),
    }
}

async fn close_ws(socket: &mut WebSocket, code: u16, reason: &str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: code.into(),
            reason: reason.to_string().into(),
        })))
        .await;
}

async fn relay_ws(
    mut socket: WebSocket,
    target: String,
    timeout_ms: u64,
    queue_bytes: usize,
    queue_messages: usize,
    _protocols: Vec<String>,
) {
    let connect = tokio_tungstenite::connect_async(&target);
    let connect = tokio::time::timeout(Duration::from_millis(timeout_ms), connect);
    tokio::pin!(connect);
    let mut queued: Vec<tungstenite::Message> = Vec::new();
    let mut queued_bytes = 0usize;
    loop {
        tokio::select! {
            result = &mut connect => {
                match result {
                    Ok(Ok((upstream, _))) => {
                        if pump_ws(socket, upstream, queued).await.is_err() {
                            return;
                        }
                        return;
                    }
                    _ => {
                        close_ws(&mut socket, 1013, "Upstream WebSocket timeout").await;
                        return;
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let bytes = text.len();
                        if queued.len() >= queue_messages || queued_bytes + bytes > queue_bytes {
                            close_ws(&mut socket, 1013, "WebSocket queue overflow").await;
                            return;
                        }
                        queued_bytes += bytes;
                        queued.push(tungstenite::Message::Text(text.to_string().into()));
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        let bytes = bin.len();
                        if queued.len() >= queue_messages || queued_bytes + bytes > queue_bytes {
                            close_ws(&mut socket, 1013, "WebSocket queue overflow").await;
                            return;
                        }
                        queued_bytes += bytes;
                        queued.push(tungstenite::Message::Binary(bin.to_vec().into()));
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                }
            }
        }
    }
}

async fn pump_ws(
    socket: WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    queued: Vec<tungstenite::Message>,
) -> Result<(), ()> {
    let (mut client_tx, mut client_rx) = socket.split();
    let (mut up_tx, mut up_rx) = upstream.split();
    for message in queued {
        if up_tx.send(message).await.is_err() {
            return Err(());
        }
    }
    loop {
        tokio::select! {
            msg = client_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if up_tx.send(tungstenite::Message::Text(text.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Binary(bin))) => {
                        if up_tx.send(tungstenite::Message::Binary(bin.to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = up_tx.send(tungstenite::Message::Ping(payload.to_vec().into())).await;
                    }
                    Some(Ok(Message::Pong(payload))) => {
                        let _ = up_tx.send(tungstenite::Message::Pong(payload.to_vec().into())).await;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                }
            }
            msg = up_rx.next() => {
                match msg {
                    Some(Ok(tungstenite::Message::Text(text))) => {
                        if client_tx.send(Message::Text(text.as_str().to_owned().into())).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(tungstenite::Message::Binary(bin))) => {
                        if client_tx.send(Message::Binary(Bytes::from(bin.to_vec()))).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(tungstenite::Message::Ping(payload))) => {
                        let _ = client_tx.send(Message::Ping(Bytes::from(payload.to_vec()))).await;
                    }
                    Some(Ok(tungstenite::Message::Pong(payload))) => {
                        let _ = client_tx.send(Message::Pong(Bytes::from(payload.to_vec()))).await;
                    }
                    _ => break,
                }
            }
        }
    }
    Ok(())
}

fn index(state: &ProxyState) -> Response {
    let routes = state.routes.lock().unwrap();
    if routes.is_empty() {
        return (StatusCode::NOT_FOUND, Html("<h1>Executor</h1>".to_string())).into_response();
    }
    let mut items = String::new();
    for name in routes.keys() {
        items.push_str(&format!(
            "<li><a href=\"{}\">{}</a></li>",
            escape_html(&local_url(name)),
            escape_html(name)
        ));
    }
    (
        StatusCode::OK,
        Html(format!(
            "<!doctype html><meta charset=\"utf-8\"><title>Executor</title><h1>Executor</h1><ul>{items}</ul>"
        )),
    )
        .into_response()
}

fn is_navigation(headers: &HeaderMap, method: &http::Method) -> bool {
    if method != http::Method::GET {
        return false;
    }
    if headers
        .get("sec-fetch-mode")
        .and_then(|value| value.to_str().ok())
        == Some("navigate")
    {
        return true;
    }
    headers
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/html"))
        .unwrap_or(false)
}

struct PendingGuard(Arc<ProxyState>);

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.0.pending_requests.fetch_sub(1, Ordering::Relaxed);
    }
}

async fn proxy_http(
    state: Arc<ProxyState>,
    req: Request<Body>,
    name: String,
    port: String,
    forwarded_host: String,
) -> Response {
    state.pending_requests.fetch_add(1, Ordering::Relaxed);
    let method = req.method().clone();
    let headers = req.headers().clone();
    let navigation = is_navigation(&headers, &method);
    let first_boot = !name_in_succeeded(&state, &name);
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let url = format!("http://127.0.0.1:{port}{path_and_query}");
    let body = req.into_body();
    let body_bytes = if method == http::Method::GET || method == http::Method::HEAD {
        Bytes::new()
    } else {
        match axum::body::to_bytes(body, 128 * 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => {
                let _guard = PendingGuard(state);
                return StatusCode::BAD_REQUEST.into_response();
            }
        }
    };
    let mut builder = state.client.request(method.clone(), &url);
    let skip = hop_names(&headers);
    for (header_name, value) in headers.iter() {
        let key = header_name.as_str();
        if skip.contains(key) || key == "host" || key == "accept-encoding" {
            continue;
        }
        builder = builder.header(key, value);
    }
    builder = builder.header("host", format!("127.0.0.1:{port}"));
    builder = builder.header(
        "x-forwarded-host",
        if forwarded_host.is_empty() {
            format!("{name}.localhost")
        } else {
            forwarded_host
        },
    );
    builder = builder.header("x-forwarded-proto", "http");
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes);
    }

    let send = builder.send();
    let ready = !first_boot;
    if navigation {
        let handle = tokio::spawn(send);
        let abort = handle.abort_handle();
        match tokio::time::timeout(state.navigation_timeout, handle).await {
            Ok(Ok(Ok(response))) => {
                record_nav(&state, &name, true, false);
                return stream_response(state, response).await;
            }
            Ok(_) => {
                record_nav(&state, &name, false, false);
                let _guard = PendingGuard(state);
                return unavailable(true, ready);
            }
            Err(_) => {
                if !first_boot {
                    abort.abort();
                }
                record_nav(&state, &name, false, true);
                let _guard = PendingGuard(state);
                return unavailable(true, ready);
            }
        }
    }

    let handle = tokio::spawn(send);
    let abort = handle.abort_handle();
    let abort_on_drop = PendingAbort(abort);
    match handle.await {
        Ok(Ok(response)) => {
            std::mem::forget(abort_on_drop);
            record_nav(&state, &name, true, false);
            stream_response(state, response).await
        }
        _ => {
            drop(abort_on_drop);
            record_nav(&state, &name, false, false);
            let _guard = PendingGuard(state);
            unavailable(false, ready)
        }
    }
}

struct PendingAbort(tokio::task::AbortHandle);

impl Drop for PendingAbort {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn stream_response(state: Arc<ProxyState>, response: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let skip = hop_names(response.headers());
    let mut out_headers = HeaderMap::new();
    for (key, value) in response.headers() {
        let name = key.as_str();
        if skip.contains(name) || matches!(name, "content-encoding" | "content-length") {
            continue;
        }
        if let (Ok(name), Ok(header_value)) = (
            HeaderName::from_bytes(key.as_ref()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            out_headers.append(name, header_value);
        }
    }
    let stream = response.bytes_stream();
    let body = Body::from_stream(CountedStream {
        inner: stream,
        _guard: PendingGuard(state),
    });
    let mut resp = Response::new(body);
    *resp.status_mut() = status;
    *resp.headers_mut() = out_headers;
    resp
}

struct CountedStream<S> {
    inner: S,
    _guard: PendingGuard,
}

impl<S, E> futures_util::Stream for CountedStream<S>
where
    S: futures_util::Stream<Item = Result<Bytes, E>> + Unpin,
{
    type Item = Result<Bytes, E>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::pin::Pin::new(&mut self.inner).poll_next(cx)
    }
}

fn name_in_succeeded(state: &ProxyState, name: &str) -> bool {
    state.navigation_succeeded.lock().unwrap().contains(name)
}

fn record_nav(state: &ProxyState, name: &str, succeeded: bool, timed_out: bool) {
    if succeeded {
        state.navigation_succeeded.lock().unwrap().insert(name.to_string());
        state.navigation_failure_started.lock().unwrap().remove(name);
        return;
    }
    let now = std::time::Instant::now();
    let mut started = state.navigation_failure_started.lock().unwrap();
    let start = *started.entry(name.to_string()).or_insert(now);
    let elapsed = now.saturating_duration_since(start);
    let ready = state.navigation_succeeded.lock().unwrap().contains(name);
    let restart_after = if ready {
        state.navigation_timeout
    } else if timed_out {
        state.start_budget
    } else {
        state.navigation_timeout
    };
    if elapsed < restart_after {
        return;
    }
    state.navigation_succeeded.lock().unwrap().remove(name);
    started.insert(name.to_string(), now);
    if let Some(callback) = &state.on_navigation_timeout {
        callback(name.to_string());
    }
}

fn unavailable(html: bool, ready: bool) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert("cache-control", HeaderValue::from_static("no-store, max-age=0"));
    headers.insert("retry-after", HeaderValue::from_static("1"));
    if html {
        let title = if ready { "Restarting…" } else { "Starting…" };
        let verb = if ready { "restarting" } else { "starting" };
        let body = format!(
            "<!doctype html><html><head><meta http-equiv=\"refresh\" content=\"1\"><title>{title}</title></head><body><p>Development server {verb}…</p></body></html>"
        );
        let mut response = Html(body).into_response();
        *response.status_mut() = StatusCode::BAD_GATEWAY;
        response.headers_mut().extend(headers);
        response
    } else {
        let mut response = Response::new(Body::from("Upstream unavailable"));
        *response.status_mut() = StatusCode::BAD_GATEWAY;
        *response.headers_mut() = headers;
        response
    }
}
