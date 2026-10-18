//! Feature-gated loopback-only probe, not a production network/credential broker.
use crate::ipc::{ipc_command, wire_object};
use futures_util::future::{select, Either};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::watch;

wire_object! {
#[derive(Debug, Serialize)]
pub struct Failure, rename_all = "camelCase" {
    code: &'static str,
    outcome: &'static str,
}
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
const RESERVATION_TTL: Duration = Duration::from_millis(1000);
wire_object! {
#[derive(Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Faults, rename_all = "snake_case" {
    prepare_receipt: bool = default,
    prepare_before: bool = default,
    cancel_before: bool = default,
    cancel_receipt: bool = default,
    execute_receipt: bool = default,
}
}
#[derive(Clone)]
struct Request {
    binding: String,
    body: String,
    cancel: watch::Sender<bool>,
    started: bool,
    expires: Instant,
    faults: Faults,
}
#[derive(Default)]
struct Inner {
    grants: HashSet<String>,
    faults: HashMap<String, Faults>,
    requests: HashMap<(String, String), Request>,
}
#[derive(Default)]
pub struct Probe(Mutex<Inner>);
wire_object! {
#[derive(Serialize)]
pub struct Response, rename_all = "camelCase" {
    status: u16,
    body: String,
}
}
fn owner_ok(owner: &str) -> bool {
    matches!(owner, "probe.alpha" | "probe.beta")
}
impl Inner {
    fn reap(&mut self) {
        let now = Instant::now();
        self.requests.retain(|_, r| r.started || r.expires > now);
    }
}
impl Probe {
    fn faults(&self, owner: &str, faults: Faults) -> Result<(), Failure> {
        let mut inner = self.0.lock().unwrap();
        inner.reap();
        if !inner.grants.contains(owner) {
            return Err(denied());
        }
        inner.faults.insert(owner.to_owned(), faults);
        Ok(())
    }
    fn grant(&self, owner: &str, allow: bool) -> Result<(), Failure> {
        if !owner_ok(owner) {
            return Err(denied());
        }
        let mut inner = self.0.lock().unwrap();
        inner.reap();
        inner.grants.remove(owner);
        inner.faults.remove(owner);
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
        inner.reap();
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
        let faults = inner.faults.remove(owner).unwrap_or_default();
        if faults.prepare_before {
            return Err(unknown("injected-prepare"));
        }
        let lost = faults.prepare_receipt;
        let (cancel, _) = watch::channel(false);
        inner.requests.insert(
            key,
            Request {
                binding: binding.to_owned(),
                body: body.to_owned(),
                cancel,
                started: false,
                expires: Instant::now() + RESERVATION_TTL,
                faults,
            },
        );
        if lost {
            Err(unknown("injected-receipt"))
        } else {
            Ok(())
        }
    }
    fn cancel(&self, owner: &str, id: &str) -> Result<(), Failure> {
        let mut inner = self.0.lock().unwrap();
        inner.reap();
        let key = (owner.to_owned(), id.to_owned());
        let request = inner.requests.get(&key).ok_or_else(denied)?;
        if request.faults.cancel_before {
            return Err(unknown("injected-cancel"));
        }
        let lost = request.faults.cancel_receipt;
        request.cancel.send_replace(true);
        if !request.started {
            inner.requests.remove(&key);
        }
        if lost {
            Err(unknown("injected-receipt"))
        } else {
            Ok(())
        }
    }
    fn pending(&self) -> usize {
        let mut inner = self.0.lock().unwrap();
        inner.reap();
        inner.requests.len()
    }
    async fn execute(&self, owner: &str, id: &str) -> Result<Response, Failure> {
        let key = (owner.to_owned(), id.to_owned());
        let request = {
            let mut inner = self.0.lock().unwrap();
            inner.reap();
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
        inner.reap();
        let cancelled = *request.cancel.borrow();
        inner.requests.remove(&key);
        if cancelled {
            Err(unknown("cancelled"))
        } else if request.faults.execute_receipt {
            Err(unknown("injected-receipt"))
        } else {
            result
        }
    }
}
ipc_command! {
pub fn probe_faults(
    owner: String,
    faults: Faults,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.faults(&owner, faults)
}
}
ipc_command! {
pub fn probe_grant(
    owner: String,
    allow: bool,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.grant(&owner, allow)
}
}
ipc_command! {
pub fn probe_prepare(
    owner: String,
    id: String,
    binding: String,
    body: String,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.prepare(&owner, &id, &binding, &body)
}
}
ipc_command! {
pub fn probe_cancel(
    owner: String,
    id: String,
    state: tauri::State<'_, Probe>,
) -> Result<(), Failure> {
    state.cancel(&owner, &id)
}
}
ipc_command! {
pub async fn probe_execute(
    owner: String,
    id: String,
    state: tauri::State<'_, Probe>,
) -> Result<Response, Failure> {
    state.execute(&owner, &id).await
}
}
wire_object! {
#[derive(Serialize)]
pub struct Info, rename_all = "camelCase" { os: String, arch: String, pending: usize }
}
ipc_command! {
pub fn probe_info(state: tauri::State<'_, Probe>) -> Info {
    Info { os: std::env::consts::OS.into(), arch: std::env::consts::ARCH.into(), pending: state.pending() }
}
}

#[cfg(test)]
#[path = "transport_probe_tests.rs"]
mod tests;
