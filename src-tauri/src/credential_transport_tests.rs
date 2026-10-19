use super::desktop::{client, headers, transmit};
use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    time::Duration,
};

/// Loopback HTTP server that records each request and answers from a script.
/// `None` holds the connection open without answering.
fn serve(replies: Vec<Option<String>>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&buffer[..n]),
                }
            }
            let text = String::from_utf8_lossy(&request).to_lowercase();
            let length = text
                .lines()
                .find_map(|line| line.strip_prefix("content-length: "))
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let head = request
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .unwrap_or(0)
                + 4;
            while request.len() < head + length {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&buffer[..n]),
                }
            }
            log.lock()
                .unwrap()
                .push(String::from_utf8_lossy(&request).into());
            match reply {
                Some(reply) => {
                    let _ = stream.write_all(reply.as_bytes());
                }
                None => std::thread::sleep(Duration::from_secs(5)),
            }
        }
    });
    (url, seen)
}
fn reply(status: &str, extra: &str, body: &str) -> Option<String> {
    Some(format!(
        "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ))
}
fn view(authentication: serde_json::Value) -> View {
    serde_json::from_value(serde_json::json!({
        "owner": "extension.connector.test", "alias": "text",
        "source": "/connectors/test.js", "version": "0.1.0",
        "declaration": {
            "label": "synthetic model", "target": "https://model.invalid/chat",
            "contentType": "application/json", "headers": {"x-api-version": "1"},
            "authentication": authentication,
        },
        "route": {"type": "direct"}, "revision": 1, "status": "ready",
    }))
    .unwrap()
}
fn run(url: &str, total: Duration, auth: serde_json::Value, body: &str) -> Result<Reply, Fault> {
    let map = headers(&view(auth), b"synthetic-key", true).unwrap();
    tauri::async_runtime::block_on(transmit(
        &client(false).unwrap(),
        url,
        map,
        Some(body.into()),
        total,
    ))
}
fn bearer() -> serde_json::Value {
    serde_json::json!({"type": "bearer"})
}

#[test]
fn delivers_status_and_body_with_only_the_bound_headers() {
    let (url, seen) = serve(vec![
        reply("200 OK", "", "{\"ok\":true}"),
        reply("429 Too Many Requests", "", "slow down"),
    ]);
    let ok = run(
        &format!("{url}/chat"),
        desktop::TOTAL,
        bearer(),
        "{\"q\":1}",
    )
    .unwrap();
    assert_eq!(
        ok,
        Reply {
            status: 200,
            body: "{\"ok\":true}".into()
        }
    );
    let limited = run(&format!("{url}/chat"), desktop::TOTAL, bearer(), "x").unwrap();
    assert_eq!(limited.status, 429);
    let request = seen.lock().unwrap()[0].to_lowercase();
    assert!(request.starts_with("post /chat http/1.1"));
    assert!(request.contains("authorization: bearer synthetic-key"));
    assert!(request.contains("content-type: application/json"));
    assert!(request.contains("x-api-version: 1"));
    assert!(request.ends_with("{\"q\":1}"));
    assert!(!request.contains("accept-encoding"));
    assert!(!request.contains("cookie"));
}
#[test]
fn a_read_sends_get_with_the_key_and_no_body() {
    let (url, seen) = serve(vec![reply("200 OK", "", "{\"data\":[]}")]);
    let map = headers(&view(bearer()), b"synthetic-key", false).unwrap();
    let read = tauri::async_runtime::block_on(transmit(
        &client(false).unwrap(),
        &format!("{url}/v1/models"),
        map,
        None,
        desktop::TOTAL,
    ))
    .unwrap();
    assert_eq!(read.body, "{\"data\":[]}");
    let request = seen.lock().unwrap()[0].to_lowercase();
    assert!(request.starts_with("get /v1/models http/1.1"));
    assert!(request.contains("authorization: bearer synthetic-key"));
    assert!(request.contains("x-api-version: 1"));
    assert!(!request.contains("content-type"));
    assert!(!request.contains("content-length"));
}
#[test]
fn custom_authentication_header_carries_the_raw_secret_marked_sensitive() {
    let map = headers(
        &view(serde_json::json!({"type": "header", "name": "x-api-key"})),
        b"synthetic-key",
        true,
    )
    .unwrap();
    assert_eq!(map["x-api-key"], "synthetic-key");
    assert!(map["x-api-key"].is_sensitive());
    assert!(!map.contains_key("authorization"));
}
#[test]
fn redirects_are_rejected_without_visiting_the_location() {
    let (other, visited) = serve(vec![reply("200 OK", "", "moved")]);
    let (url, _) = serve(vec![reply(
        "302 Found",
        &format!("Location: {other}/elsewhere\r\n"),
        "",
    )]);
    assert_eq!(
        run(&url, desktop::TOTAL, bearer(), "x"),
        Err(Fault::Unknown("redirect"))
    );
    std::thread::sleep(Duration::from_millis(100));
    assert!(visited.lock().unwrap().is_empty());
}
// A provider's model list must fit.
const _: () = assert!(MAX_RESPONSE >= 1 << 20);
#[test]
fn oversized_responses_stop_with_declared_or_streamed_length() {
    let large = "a".repeat(MAX_RESPONSE + 1);
    let streamed = format!("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{large}");
    let (url, _) = serve(vec![reply("200 OK", "", &large), Some(streamed)]);
    for _ in 0..2 {
        assert_eq!(
            run(&url, desktop::TOTAL, bearer(), "x"),
            Err(Fault::Unknown("response-too-large"))
        );
    }
    let exact = "b".repeat(MAX_RESPONSE);
    let (url, _) = serve(vec![reply("200 OK", "", &exact)]);
    assert_eq!(
        run(&url, desktop::TOTAL, bearer(), "x").unwrap().body,
        exact
    );
}
#[test]
fn a_silent_server_times_out_as_unknown() {
    let (url, seen) = serve(vec![None]);
    assert_eq!(
        run(&url, Duration::from_millis(300), bearer(), "x"),
        Err(Fault::Unknown("timeout"))
    );
    assert_eq!(seen.lock().unwrap().len(), 1);
}
#[test]
fn production_client_never_sends_plain_http() {
    let (url, seen) = serve(vec![reply("200 OK", "", "ok")]);
    let map = headers(&view(bearer()), b"synthetic-key", true).unwrap();
    let result = tauri::async_runtime::block_on(transmit(
        &client(true).unwrap(),
        &url,
        map,
        Some("x".into()),
        desktop::TOTAL,
    ));
    assert_eq!(result, Err(Fault::Unknown("transport")));
    std::thread::sleep(Duration::from_millis(100));
    assert!(seen.lock().unwrap().is_empty());
}
#[test]
fn only_complete_utf8_non_redirect_responses_are_accepted() {
    assert_eq!(accept(304, vec![]), Err(Fault::Unknown("status")));
    assert_eq!(accept(199, vec![]), Err(Fault::Unknown("status")));
    assert_eq!(accept(600, vec![]), Err(Fault::Unknown("status")));
    assert_eq!(
        accept(200, vec![0xff, 0xfe]),
        Err(Fault::Unknown("response-encoding"))
    );
    assert_eq!(accept(503, b"down".to_vec()).unwrap().status, 503);
}
