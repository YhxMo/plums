//! `network.read`: a GET of a public HTTPS resource with no credentials,
//! cookies, proxy or redirects; one read per owner, cancellable from the
//! WebView. The host checks the URL against the owner's declared sources.
use crate::credential_bindings::Failure;
use crate::credential_request::{RequestFailure, Requests};
use crate::credential_transport::{Fault, Reply};
use crate::ipc::ipc_command;
use crate::storage::Broker;
use tauri::Manager;

/// Room for a public model catalog such as models.dev (about 6 MB).
pub const MAX_RESPONSE: usize = 16 * 1024 * 1024;
/// Android enforces the same limit in Kotlin.
#[cfg(desktop)]
pub const TOTAL: std::time::Duration = std::time::Duration::from_secs(60);

/// Reads in flight, one per owner; separate from credential requests.
#[derive(Default)]
pub struct Reads(pub Requests);

/// HTTPS on the default port to a DNS name with a dot; no user info,
/// fragment, IP literal or `localhost`.
pub fn target(url: &str) -> Result<url::Url, Failure> {
    let invalid = "invalid-request";
    if url.len() > 2048 {
        return Err(invalid);
    }
    let parsed = url::Url::parse(url).map_err(|_| invalid)?;
    let public = match parsed.host() {
        Some(url::Host::Domain(name)) => {
            name.rsplit('.')
                .next()
                .is_some_and(|tld| tld.starts_with(|c: char| c.is_ascii_alphabetic()))
                && name.contains('.')
        }
        _ => false,
    };
    if parsed.scheme() != "https"
        || !public
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid);
    }
    Ok(parsed)
}

#[cfg(desktop)]
async fn fetch(_app: &tauri::AppHandle, _id: &str, url: &str) -> Result<Reply, Fault> {
    use crate::credential_transport::desktop;
    let client =
        desktop::client(true).map_err(|_| Fault::NotDispatched("transport-unavailable"))?;
    desktop::transmit(
        &client,
        url,
        reqwest::header::HeaderMap::new(),
        None,
        TOTAL,
        MAX_RESPONSE,
    )
    .await
}
#[cfg(desktop)]
async fn cancel(_app: &tauri::AppHandle, _id: &str) {}

#[cfg(target_os = "android")]
pub struct AndroidNetwork(pub tauri::plugin::PluginHandle<tauri::Wry>);
/// Android reads from Kotlin with the same policy.
#[cfg(target_os = "android")]
async fn fetch(app: &tauri::AppHandle, id: &str, url: &str) -> Result<Reply, Fault> {
    let result = app
        .state::<AndroidNetwork>()
        .0
        .run_mobile_plugin_async::<serde_json::Value>(
            "read",
            serde_json::json!({ "id": id, "url": url }),
        )
        .await
        .map_err(|_| Fault::Unknown("transport"))?;
    const CODES: [&str; 7] = [
        "invalid-request",
        "cancelled",
        "redirect",
        "timeout",
        "response-too-large",
        "response-encoding",
        "transport",
    ];
    let code = || {
        CODES
            .into_iter()
            .find(|code| result["code"].as_str() == Some(*code))
            .unwrap_or("transport")
    };
    match result["status"].as_str() {
        Some("ok") => {
            let status = result["httpStatus"].as_u64().unwrap_or(0);
            let body = result["body"].as_str().ok_or(Fault::Unknown("transport"))?;
            crate::credential_transport::accept(
                u16::try_from(status).unwrap_or(0),
                body.as_bytes().to_vec(),
                MAX_RESPONSE,
            )
        }
        Some("not-dispatched") => Err(Fault::NotDispatched(code())),
        _ => Err(Fault::Unknown(code())),
    }
}
#[cfg(target_os = "android")]
async fn cancel(app: &tauri::AppHandle, id: &str) {
    let _ = app
        .state::<AndroidNetwork>()
        .0
        .run_mobile_plugin_async::<serde_json::Value>("cancel", serde_json::json!({ "id": id }))
        .await;
}
#[cfg(not(any(desktop, target_os = "android")))]
async fn fetch(_app: &tauri::AppHandle, _id: &str, _url: &str) -> Result<Reply, Fault> {
    Err(Fault::NotDispatched("unavailable"))
}
#[cfg(not(any(desktop, target_os = "android")))]
async fn cancel(_app: &tauri::AppHandle, _id: &str) {}

async fn dispatch(
    app: &tauri::AppHandle,
    owner: &str,
    id: &str,
    url: &str,
) -> Result<Reply, Fault> {
    use Fault::NotDispatched as Refused;
    if id.is_empty() || id.len() > 64 {
        return Err(Refused("invalid-request"));
    }
    let url = target(url).map_err(Refused)?;
    let allowed = || app.state::<Broker>().allows(owner, "network.read");
    if !allowed() {
        return Err(Refused("denied"));
    }
    let reads = app.state::<Reads>();
    let mut slot = reads.0.reserve(owner, id).map_err(Refused)?;
    let reply = tokio::select! {
        result = fetch(app, id, url.as_str()) => result,
        _ = slot.until_cancelled() => {
            cancel(app, id).await;
            Err(Fault::Unknown("cancelled"))
        }
    }?;
    // A revoked grant or a cancelled read is never delivered.
    if !allowed() || slot.cancelled() {
        return Err(Fault::Unknown("stale"));
    }
    Ok(reply)
}

ipc_command! {
pub async fn network_read(
    app: tauri::AppHandle,
    owner: String,
    id: String,
    url: String,
) -> Result<Reply, RequestFailure> {
    dispatch(&app, &owner, &id, &url)
        .await
        .map_err(RequestFailure::from)
}
}
ipc_command! {
#[allow(clippy::unused_unit)]
pub fn network_abort(owner: String, id: String, reads: tauri::State<'_, Reads>) -> () {
    reads.0.abort(&owner, &id);
}
}
ipc_command! {
#[allow(clippy::unused_unit)]
pub fn network_release(owner: String, reads: tauri::State<'_, Reads>) -> () {
    reads.0.release(&owner);
}
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;
