//! Secret cleanup over the native store; callers hold the binding ticket.
use crate::credential_bindings::Bindings;
use crate::credentials_native::delete_key;

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
        if delete_key(app.clone(), reference).await.is_ok() {
            deleted.push(reference.clone());
        }
    }
    deleted
}
