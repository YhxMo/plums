//! Feature-gated loopback-only probe, not a production network/credential broker.
use futures_util::future::{select, Either};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::Duration,
};
use tokio::sync::watch;

#[derive(Debug, Serialize)]
pub struct Failure {
    code: &'static str,
    outcome: &'static str,
}
fn denied() -> Failure {
    Failure {
        code: "denied",
        outcome: "not-dispatched",
    }
}
fn unknown(code: &'static str) -> Failure {
    Failure {
        code,
        outcome: "unknown",
    }
}
#[derive(Clone)]
struct Request {
    binding: String,
    body: String,
    cancel: watch::Sender<bool>,
    started: bool,
}
#[derive(Default)]
struct Inner {
    grants: HashSet<String>,
    requests: HashMap<(String, String), Request>,
}
#[derive(Default)]
pub struct Probe(Mutex<Inner>);
#[derive(Serialize)]
pub struct Response {
    status: u16,
    body: String,
}
fn owner_ok(owner: &str) -> bool {
    matches!(owner, "probe.alpha" | "probe.beta")
}
impl Probe {
    fn grant(&self, owner: &str, allow: bool) -> Result<(), Failure> {
        if !owner_ok(owner) {
            return Err(denied());
        }
        let mut inner = self.0.lock().unwrap();
        inner.grants.remove(owner);
        inner.requests.retain(|(who, _), request| {
            if who != owner {
                return true;
            }
            request.cancel.send_replace(true);
            request.started
        });
        if allow {
            inner.grants.insert(owner.to_owned());
        }
        Ok(())
    }
    fn prepare(&self, owner: &str, id: &str, binding: &str, body: &str) -> Result<(), Failure> {
        let mut inner = self.0.lock().unwrap();
        let key = (owner.to_owned(), id.to_owned());
        if !inner.grants.contains(owner)
            || id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !matches!(
                binding,
                "echo"
                    | "delay"
                    | "redirect"
                    | "oversize"
                    | "chunked"
                    | "report"
                    | "stats"
                    | "slow"
            )
            || body.len() > 4096
            || body.contains('\0')
            || inner.requests.len() >= 16
            || inner.requests.contains_key(&key)
        {
            return Err(denied());
        }
        let (cancel, _) = watch::channel(false);
        inner.requests.insert(
            key,
            Request {
                binding: binding.to_owned(),
                body: body.to_owned(),
                cancel,
                started: false,
            },
        );
        Ok(())
    }
    fn cancel(&self, owner: &str, id: &str) -> Result<(), Failure> {
        let mut inner = self.0.lock().unwrap();
        let key = (owner.to_owned(), id.to_owned());
        let request = inner.requests.get(&key).ok_or_else(denied)?;
        request.cancel.send_replace(true);
        if !request.started {
            inner.requests.remove(&key);
        }
        Ok(())
    }
    fn pending(&self) -> usize {
        self.0.lock().unwrap().requests.len()
    }
    async fn execute(&self, owner: &str, id: &str) -> Result<Response, Failure> {
        let key = (owner.to_owned(), id.to_owned());
        let request = {
            let mut inner = self.0.lock().unwrap();
            if !inner.grants.contains(owner) {
                return Err(denied());
            }
            let request = inner.requests.get_mut(&key).ok_or_else(denied)?;
            if request.started || *request.cancel.borrow() {
                return Err(denied());
            }
            request.started = true;
            request.clone()
        };
        let mut cancelled = request.cancel.subscribe();
        let transfer = async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(800))
                .build()
                .map_err(|error| {
                    unknown(if error.is_timeout() {
                        "timeout"
                    } else {
                        "transport"
                    })
                })?;
            let mut response = client
                .post(format!("http://127.0.0.1:18765/{}", request.binding))
                .header("Content-Type", "text/plain")
                .body(request.body.clone())
                .send()
                .await
                .map_err(|error| {
                    unknown(if error.is_timeout() {
                        "timeout"
                    } else {
                        "transport"
                    })
                })?;
            let status = response.status().as_u16();
            if (300..400).contains(&status) {
                return Err(unknown("redirect"));
            }
            if response.content_length().is_some_and(|size| size > 8192) {
                return Err(unknown("limit"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|error| {
                unknown(if error.is_timeout() {
                    "timeout"
                } else {
                    "transport"
                })
            })? {
                if bytes.len() + chunk.len() > 8192 {
                    return Err(unknown("limit"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let body = String::from_utf8(bytes).map_err(|_| unknown("encoding"))?;
            Ok(Response { status, body })
        };
        let stop = async {
            if !*cancelled.borrow() {
                let _ = cancelled.changed().await;
            }
        };
        let result = match tokio::time::timeout(
            Duration::from_millis(800),
            select(std::pin::pin!(transfer), std::pin::pin!(stop)),
        )
        .await
        {
            Err(_) => Err(unknown("timeout")),
            Ok(Either::Right(_)) => Err(unknown("cancelled")),
            Ok(Either::Left((value, _))) => value,
        };
        let mut inner = self.0.lock().unwrap();
        let cancelled = *request.cancel.borrow();
        inner.requests.remove(&key);
        if cancelled {
            Err(unknown("cancelled"))
        } else {
            result
        }
    }
}
#[tauri::command]
pub fn probe_grant(
    owner: String,
    allow: bool,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.grant(&owner, allow)
}
#[tauri::command]
pub fn probe_prepare(
    owner: String,
    id: String,
    binding: String,
    body: String,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.prepare(&owner, &id, &binding, &body)
}
#[tauri::command]
pub fn probe_cancel(
    owner: String,
    id: String,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.cancel(&owner, &id)
}
#[tauri::command]
pub async fn probe_execute(
    owner: String,
    id: String,
    state: tauri::State<'_, Probe>,
) -> Result<Response, Failure> {
    state.execute(&owner, &id).await
}
#[tauri::command]
pub fn probe_info(state: tauri::State<'_, Probe>) -> serde_json::Value {
    serde_json::json!({"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"pending":state.pending()})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn denied_and_cross_owner_never_reserve() {
        let p = Probe::default();
        assert_eq!(
            p.prepare("probe.alpha", "one", "echo", "hello")
                .unwrap_err()
                .outcome,
            "not-dispatched"
        );
        p.grant("probe.alpha", true).unwrap();
        p.prepare("probe.alpha", "one", "echo", "hello").unwrap();
        assert!(p.cancel("probe.beta", "one").is_err());
        assert!(p.prepare("probe.alpha", "one", "echo", "hello").is_err());
        p.cancel("probe.alpha", "one").unwrap();
        assert_eq!(p.pending(), 0);
    }
    #[test]
    fn validates_request_before_reserving() {
        let p = Probe::default();
        p.grant("probe.alpha", true).unwrap();
        for (binding, body) in [("http://example.com", "hello"), ("echo", "\0")] {
            assert!(p.prepare("probe.alpha", "one", binding, body).is_err());
        }
        assert!(p
            .prepare("probe.alpha", "one", "echo", &"x".repeat(4097))
            .is_err());
        assert_eq!(p.pending(), 0);
    }
    #[test]
    fn reservations_are_bounded_and_revocation_releases_them() {
        let p = Probe::default();
        p.grant("probe.alpha", true).unwrap();
        for i in 0..16 {
            p.prepare("probe.alpha", &format!("r{i}"), "echo", "x")
                .unwrap();
        }
        assert!(p.prepare("probe.alpha", "overflow", "echo", "x").is_err());
        p.grant("probe.alpha", false).unwrap();
        assert_eq!(p.pending(), 0);
        p.grant("probe.alpha", true).unwrap();
        p.prepare("probe.alpha", "new", "echo", "x").unwrap();
        p.cancel("probe.alpha", "new").unwrap();
        assert_eq!(p.pending(), 0);
    }
}
