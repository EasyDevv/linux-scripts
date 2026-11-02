use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cli::http::{client, download, get_json, get_text, head_last_modified, HostPolicy};

struct Server {
    port: u16,
    hits: Arc<Mutex<u32>>,
}

fn spawn(handler: impl Fn(String, &mut TcpStream) + Send + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(Mutex::new(0u32));
    let hits_thread = Arc::clone(&hits);
    thread::spawn(move || {
        for _ in 0..8 {
            let Ok((mut stream, _)) = listener.accept() else {
                break;
            };
            *hits_thread.lock().unwrap() += 1;
            stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
            let request = read_request(&mut stream);
            handler(request, &mut stream);
            let _ = stream.flush();
        }
    });
    Server { port, hits }
}

fn read_request(stream: &mut TcpStream) -> String {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(read) => {
                buf.extend_from_slice(&tmp[..read]);
                if buf.windows(4).any(|window| window == b"\r\n\r\n") || buf.len() > 8192 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn response(status: u16, reason: &str, headers: &[(&str, &str)], body: &str) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} {reason}\r\n");
    let mut has_length = false;
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-length") {
            has_length = true;
        }
        out.push_str(name);
        out.push_str(": ");
        out.push_str(value);
        out.push_str("\r\n");
    }
    if !has_length {
        out.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    out.push_str("Connection: close\r\n\r\n");
    out.push_str(body);
    out.into_bytes()
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, &str)],
    body: &str,
) {
    let _ = stream.write_all(&response(status, reason, headers, body));
}

fn temp_dest(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cli-http-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("artifact.bin")
}

#[test]
fn redirect_to_disallowed_host_fails_before_connect() {
    let blocked = spawn(|_, stream| write_response(stream, 200, "OK", &[], "should-not-run"));
    let blocked_port = blocked.port;
    // Bind is 127.0.0.1; the Location host is a different loopback address, not on the allow-list.
    let allowed = spawn(move |_, stream| {
        let location = format!("https://127.0.0.2:{blocked_port}/nope");
        write_response(stream, 302, "Found", &[("Location", &location)], "");
    });
    let policy = HostPolicy::allow_localhost_for_tests(allowed.port);
    let http = client(policy.clone()).unwrap();
    let dest = temp_dest("blocked");
    let error = download(
        &http,
        &policy,
        &format!("http://127.0.0.1:{}/file", allowed.port),
        &dest,
    )
    .unwrap_err();
    let text = format!("{error:#}");
    assert!(
        text.contains("host is not allowed") || text.contains("host blocked"),
        "{text}"
    );
    thread::sleep(Duration::from_millis(80));
    assert_eq!(*blocked.hits.lock().unwrap(), 0);
    assert!(!dest.with_extension("bin.part").exists());
    let _ = std::fs::remove_dir_all(dest.parent().unwrap());
}

#[test]
fn redirect_to_allowed_host_succeeds() {
    let next = spawn(|_, stream| write_response(stream, 200, "OK", &[], "followed"));
    let next_port = next.port;
    let first = spawn(move |_, stream| {
        let location = format!("http://127.0.0.1:{next_port}/body");
        write_response(stream, 302, "Found", &[("Location", &location)], "");
    });
    let policy =
        HostPolicy::allow_localhost_for_tests(first.port).and_localhost_for_tests(next.port);
    let http = client(policy.clone()).unwrap();
    let body = get_text(
        &http,
        &policy,
        &format!("http://127.0.0.1:{}/start", first.port),
    )
    .unwrap();
    assert_eq!(body, "followed");
    assert_eq!(*next.hits.lock().unwrap(), 1);
}

#[test]
fn download_writes_part_then_renames() {
    let port_slot = Arc::new(Mutex::new(0u16));
    let port_for_server = Arc::clone(&port_slot);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    *port_slot.lock().unwrap() = port;
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_request(&mut stream);
        let header = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhel";
        stream.write_all(header).unwrap();
        stream.flush().unwrap();
        thread::sleep(Duration::from_millis(400));
        stream.write_all(b"lo").unwrap();
        let _ = port_for_server;
    });
    let policy = HostPolicy::allow_localhost_for_tests(port);
    let http = client(policy.clone()).unwrap();
    let dest = temp_dest("part");
    let part = {
        let mut name = dest.as_os_str().to_owned();
        name.push(".part");
        PathBuf::from(name)
    };
    let seen = Arc::new(Mutex::new(false));
    let seen_thread = Arc::clone(&seen);
    let part_watch = part.clone();
    thread::spawn(move || {
        for _ in 0..50 {
            if part_watch.exists() {
                *seen_thread.lock().unwrap() = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
    download(
        &http,
        &policy,
        &format!("http://127.0.0.1:{port}/file"),
        &dest,
    )
    .unwrap();
    assert!(
        *seen.lock().unwrap(),
        ".part was not observed during download"
    );
    assert!(!part.exists());
    assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
    let _ = std::fs::remove_dir_all(dest.parent().unwrap());
}

#[test]
fn download_404_is_an_error_and_leaves_no_part() {
    let seen = Arc::new(Mutex::new(String::new()));
    let seen_thread = Arc::clone(&seen);
    let server = spawn(move |request, stream| {
        *seen_thread.lock().unwrap() = request;
        write_response(stream, 404, "Not Found", &[], "missing");
    });
    let policy = HostPolicy::allow_localhost_for_tests(server.port);
    let http = client(policy.clone()).unwrap();
    let dest = temp_dest("missing");
    std::fs::write(&dest, b"old").unwrap();
    let error = download(
        &http,
        &policy,
        &format!("http://127.0.0.1:{}/nope", server.port),
        &dest,
    )
    .unwrap_err();
    assert!(error.to_string().contains("404"), "{error}");
    let request = seen.lock().unwrap().to_ascii_lowercase();
    assert!(request.contains("user-agent: cli/0.1 (+local)"), "missing user-agent");
    assert_eq!(std::fs::read(&dest).unwrap(), b"old");
    let mut part = dest.as_os_str().to_owned();
    part.push(".part");
    assert!(!PathBuf::from(part).exists());
    let _ = std::fs::remove_dir_all(dest.parent().unwrap());
}

#[test]
fn redirect_cap_stops_at_five_hops() {
    let hits = Arc::new(Mutex::new(0u32));
    let hits_thread = Arc::clone(&hits);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for _ in 0..8 {
            let Ok((mut stream, _)) = listener.accept() else {
                break;
            };
            *hits_thread.lock().unwrap() += 1;
            let _ = read_request(&mut stream);
            let location = format!("http://127.0.0.1:{port}/loop");
            write_response(&mut stream, 302, "Found", &[("Location", &location)], "");
        }
    });
    let policy = HostPolicy::allow_localhost_for_tests(port);
    let http = client(policy.clone()).unwrap();
    let error = get_text(&http, &policy, &format!("http://127.0.0.1:{port}/loop")).unwrap_err();
    let text = format!("{error:#}");
    assert!(text.contains("too many redirects"), "{text}");
    assert_eq!(*hits.lock().unwrap(), 6);
}

#[test]
fn localhost_request_does_not_send_github_token() {
    let marker = "cli-test-token-do-not-leak";
    let previous = std::env::var("GITHUB_TOKEN").ok();
    unsafe { std::env::set_var("GITHUB_TOKEN", marker) };
    let saw_auth = Arc::new(Mutex::new(false));
    let saw_auth_thread = Arc::clone(&saw_auth);
    let server = spawn(move |request, stream| {
        if request.to_ascii_lowercase().contains("authorization:") {
            *saw_auth_thread.lock().unwrap() = true;
        }
        write_response(stream, 200, "OK", &[], r#"{"ok":true}"#);
    });
    let policy = HostPolicy::allow_localhost_for_tests(server.port);
    let http = client(policy.clone()).unwrap();
    let url = format!("http://127.0.0.1:{}/json", server.port);
    let value = get_json(&http, &policy, &url).unwrap();
    unsafe {
        match &previous {
            Some(value) => std::env::set_var("GITHUB_TOKEN", value),
            None => std::env::remove_var("GITHUB_TOKEN"),
        }
    }
    assert_eq!(value["ok"], true);
    assert!(
        !*saw_auth.lock().unwrap(),
        "authorization sent to non-github host"
    );
    let head = spawn(|_, stream| {
        write_response(
            stream,
            200,
            "OK",
            &[("Last-Modified", "Sat, 01 Jun 2024 00:00:00 GMT")],
            "",
        );
    });
    let head_policy = HostPolicy::allow_localhost_for_tests(head.port);
    let head_client = client(head_policy.clone()).unwrap();
    let modified = head_last_modified(
        &head_client,
        &head_policy,
        &format!("http://127.0.0.1:{}/file", head.port),
    )
    .unwrap();
    assert_eq!(modified.as_deref(), Some("Sat, 01 Jun 2024 00:00:00 GMT"));
    let _ = previous;
}
