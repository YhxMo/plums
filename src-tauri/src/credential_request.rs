//! `credential.request`: one bound request per owner (a POST to the target or
//! a GET on the same site), confirmed by the user once
//! per binding revision (remembered across restarts), cancellable from the WebView.
use crate::credential_bindings::{Bindings, Failure, Route, View};
use crate::credential_transport::{self as transport, Fault, Reply, MAX_REQUEST};
use crate::credentials_native::prompt;
use crate::ipc::{ipc_command, wire_object};
use crate::storage::Broker;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard},
};
use tauri::Manager;
use tokio::sync::watch;

wire_object! {
#[derive(Debug, PartialEq, Serialize)]
pub struct RequestFailure, rename_all = "camelCase" {
    code: &'static str,
    outcome: &'static str,
}
}
impl From<Fault> for RequestFailure {
    fn from(fault: Fault) -> Self {
        match fault {
            Fault::NotDispatched(code) => Self {
                code,
                outcome: "not-dispatched",
            },
            Fault::Unknown(code) => Self {
                code,
                outcome: "unknown",
            },
        }
    }
}

#[derive(Default)]
struct Inner {
    /// `(owner, alias, revision)` the user allowed to send in this process.
    confirmed: HashSet<(String, String, u64)>,
    active: HashMap<String, (String, watch::Sender<bool>)>,
    /// An abort that arrived before its request registered.
    aborted: HashMap<String, String>,
}
#[derive(Default)]
pub struct Requests(Mutex<Inner>);
/// The owner's single request slot, released on drop.
pub struct Slot<'a> {
    requests: &'a Requests,
    owner: String,
    id: String,
    cancelled: watch::Receiver<bool>,
}
impl Slot<'_> {
    pub fn cancelled(&self) -> bool {
        *self.cancelled.borrow()
    }
    pub(crate) async fn until_cancelled(&mut self) {
        let _ = self.cancelled.wait_for(|cancelled| *cancelled).await;
    }
}
impl Drop for Slot<'_> {
    fn drop(&mut self) {
        let mut inner = self.requests.lock();
        if inner
            .active
            .get(&self.owner)
            .is_some_and(|(id, _)| *id == self.id)
        {
            inner.active.remove(&self.owner);
        }
    }
}
impl Requests {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
    pub fn reserve(&self, owner: &str, id: &str) -> Result<Slot<'_>, Failure> {
        let mut inner = self.lock();
        if inner
            .aborted
            .get(owner)
            .is_some_and(|aborted| aborted == id)
        {
            inner.aborted.remove(owner);
            return Err("cancelled");
        }
        if inner.active.contains_key(owner) {
            return Err("busy");
        }
        let (cancel, cancelled) = watch::channel(false);
        inner.active.insert(owner.into(), (id.into(), cancel));
        Ok(Slot {
            requests: self,
            owner: owner.into(),
            id: id.into(),
            cancelled,
        })
    }
    pub fn abort(&self, owner: &str, id: &str) {
        let mut inner = self.lock();
        match inner.active.get(owner) {
            Some((active, cancel)) if active == id => {
                let _ = cancel.send(true);
            }
            _ => {
                inner.aborted.insert(owner.into(), id.into());
            }
        }
    }
    /// Forget the owner's confirmations and cancel its request in flight.
    pub fn release(&self, owner: &str) {
        let mut inner = self.lock();
        inner
            .confirmed
            .retain(|(confirmed, _, _)| confirmed != owner);
        if let Some((_, cancel)) = inner.active.get(owner) {
            let _ = cancel.send(true);
        }
    }
    pub fn confirmed(&self, view: &View) -> bool {
        self.lock().confirmed.contains(&key(view))
    }
    /// Remember the user's consent unless the request was cancelled or
    /// released while the panel was open; checked under the release lock.
    pub fn confirm(&self, view: &View, slot: &Slot) -> bool {
        let mut inner = self.lock();
        if slot.cancelled() {
            return false;
        }
        inner.confirmed.insert(key(view));
        true
    }
}
fn key(view: &View) -> (String, String, u64) {
    (view.owner.clone(), view.alias.clone(), view.revision)
}
fn consent(view: &View) -> String {
    let declaration = &view.declaration;
    format!("{}\n{}\n扩展：{} / {}\n来源：{} · {}\nPOST · {} · 认证：{}\n\n允许该扩展通过此绑定把文本发送到上述地址，并读取同一站点的信息（如模型列表）？确认后同一绑定不再询问；修改绑定、重新录入密钥或替换扩展后需重新确认。", declaration.label, declaration.target, view.owner, view.alias, view.source, view.version, declaration.content_type, declaration.authentication.name())
}

async fn dispatch(
    app: &tauri::AppHandle,
    owner: &str,
    id: &str,
    alias: &str,
    body: String,
    path: Option<String>,
) -> Result<Reply, Fault> {
    use Fault::NotDispatched as Refused;
    if !crate::credentials::credential_supported() {
        return Err(Refused("unavailable"));
    }
    if body.len() > MAX_REQUEST
        || id.is_empty()
        || id.len() > 64
        || (path.is_some() && !body.is_empty())
    {
        return Err(Refused("invalid-request"));
    }
    let allowed = || app.state::<Broker>().allows(owner, "credential.request");
    if !allowed() {
        return Err(Refused("denied"));
    }
    let requests = app.state::<Requests>();
    let mut slot = requests.reserve(owner, id).map_err(Refused)?;
    let bindings = app.state::<Bindings>();
    let (view, _) = bindings.resolve(owner, alias).map_err(Refused)?;
    if view.route != Route::Direct {
        return Err(Refused("proxy-unsupported"));
    }
    if let Some(path) = &path {
        view.declaration.read_target(path).map_err(Refused)?;
    }
    if !requests.confirmed(&view) && !bindings.consented(&view) {
        match prompt(app.clone(), "允许发送请求", &consent(&view), None).await {
            Ok(Some(_)) if requests.confirm(&view, &slot) => {
                // Unsaved consent still holds for this run.
                let _ = bindings.consent(&view);
            }
            Ok(Some(_)) => return Err(Refused("cancelled")),
            Ok(None) => return Err(Refused("not-confirmed")),
            Err(_) => return Err(Refused("unavailable")),
        }
    }
    // The binding, grant or caller may have changed while the panel was open.
    let (current, reference) = bindings.resolve(owner, alias).map_err(Refused)?;
    if current.revision != view.revision || !allowed() {
        return Err(Refused("stale"));
    }
    if slot.cancelled() {
        return Err(Refused("cancelled"));
    }
    let declaration = &current.declaration;
    let (target, body) = match path {
        Some(path) => (declaration.read_target(&path).map_err(Refused)?, None),
        None => (declaration.target.clone(), Some(body)),
    };
    let reply = tokio::select! {
        result = transport::send(app, id, &current, &reference, &target, body) => result,
        _ = slot.until_cancelled() => {
            transport::cancel(app, id).await;
            Err(Fault::Unknown("cancelled"))
        }
    }?;
    // A response for a revoked grant or changed binding is never delivered.
    match bindings.resolve(owner, alias) {
        Ok((latest, _))
            if latest.revision == current.revision && allowed() && !slot.cancelled() =>
        {
            Ok(reply)
        }
        _ => Err(Fault::Unknown("stale")),
    }
}

ipc_command! {
pub async fn credential_request(
    app: tauri::AppHandle,
    owner: String,
    id: String,
    binding: String,
    body: String,
    path: Option<String>,
) -> Result<Reply, RequestFailure> {
    dispatch(&app, &owner, &id, &binding, body, path)
        .await
        .map_err(RequestFailure::from)
}
}
ipc_command! {
#[allow(clippy::unused_unit)]
pub fn credential_abort(owner: String, id: String, requests: tauri::State<'_, Requests>) -> () {
    requests.abort(&owner, &id);
}
}
ipc_command! {
#[allow(clippy::unused_unit)]
pub fn credential_release(owner: String, requests: tauri::State<'_, Requests>) -> () {
    requests.release(&owner);
}
}

#[cfg(test)]
#[path = "credential_request_tests.rs"]
mod tests;
