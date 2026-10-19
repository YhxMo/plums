//! The in-process copy of stored keys, and secret cleanup over the native
//! store; cleanup callers hold the binding ticket.
use crate::credential_bindings::Bindings;
use crate::credentials_native::delete_key;
use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
};

/// Keys already read in this process. Each keychain read may raise a system
/// access prompt, so a key is read once per launch; the copy stays in native
/// memory and never reaches the WebView. References are never reused.
static KEYS: Mutex<BTreeMap<String, Vec<u8>>> = Mutex::new(BTreeMap::new());
fn keys() -> MutexGuard<'static, BTreeMap<String, Vec<u8>>> {
    KEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
#[cfg(target_os = "macos")]
pub(crate) fn recall(reference: &str) -> Option<Vec<u8>> {
    keys().get(reference).cloned()
}
#[cfg(target_os = "macos")]
pub(crate) fn remember(reference: &str, bytes: &[u8]) {
    if let Some(mut previous) = keys().insert(reference.to_owned(), bytes.to_vec()) {
        previous.fill(0);
    }
}
fn forget(reference: &str) {
    if let Some(mut bytes) = keys().remove(reference) {
        bytes.fill(0);
    }
}

/// Delete secrets left by earlier entries once the new one is saved. Best
/// effort: a busy binding or failed deletion keeps the references, and the
/// next re-entry or revocation retries them.
pub(crate) async fn retire(
    app: tauri::AppHandle,
    bindings: &Bindings,
    owner: &str,
    alias: &str,
    revision: u64,
) {
    let Ok(ticket) = bindings.begin_action(owner, alias, revision) else {
        return;
    };
    let deleted = delete_all(app, &ticket.retired()).await;
    let _ = bindings.finish_retire(ticket, deleted);
}
/// References whose secrets are confirmed absent; missing items count as deleted.
pub(crate) async fn delete_all(app: tauri::AppHandle, references: &[String]) -> Vec<String> {
    let mut deleted = Vec::new();
    for reference in references {
        forget(reference);
        if delete_key(app.clone(), reference).await.is_ok() {
            deleted.push(reference.clone());
        }
    }
    deleted
}
