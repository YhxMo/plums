//! `link.open`: hands an HTTPS link to the default browser. The opener is
//! called only from here and never registered as a plugin, so the WebView
//! has no opener command of its own.
use crate::credential_bindings::Failure;
use crate::ipc::ipc_command;
use crate::storage::Broker;

/// HTTPS with a host and no user info, at most 2048 characters.
pub fn target(url: &str) -> Result<url::Url, Failure> {
    let invalid = "invalid-request";
    if url.len() > 2048 {
        return Err(invalid);
    }
    let parsed = url::Url::parse(url).map_err(|_| invalid)?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none_or(str::is_empty)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(invalid);
    }
    Ok(parsed)
}

#[cfg(desktop)]
fn open(url: &url::Url) -> Result<(), Failure> {
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|_| "unavailable")
}
#[cfg(not(desktop))]
fn open(_url: &url::Url) -> Result<(), Failure> {
    Err("unavailable")
}

ipc_command! {
pub fn link_open(owner: String, url: String, state: tauri::State<'_, Broker>) -> Result<(), &'static str> {
    if !state.allows(&owner, "link.open") {
        return Err("denied");
    }
    open(&target(&url)?)
}
}

#[cfg(test)]
#[path = "links_tests.rs"]
mod tests;
