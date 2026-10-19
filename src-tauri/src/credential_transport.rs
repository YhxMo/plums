//! HTTPS for bound credential requests: the fixed target, or a read on its site. The secret is read and
//! injected into one header here; it never returns to the WebView or a log.
use crate::credential_bindings::{Failure, View};
use crate::ipc::wire_object;
use serde::Serialize;

/// Room for a 1M-token conversation, which is a few MB of text.
pub const MAX_REQUEST: usize = 8 * 1024 * 1024;
/// Room for a provider's model list as well as a reply.
pub const MAX_RESPONSE: usize = 2 * 1024 * 1024;

/// Where a request stopped: before any network I/O, or after it may have
/// reached the remote service. Neither is retried automatically.
#[derive(Debug, PartialEq)]
pub enum Fault {
    NotDispatched(Failure),
    Unknown(Failure),
}
wire_object! {
#[derive(Debug, PartialEq, Serialize)]
pub struct Reply, rename_all = "camelCase" {
    pub status: u16,
    pub body: String,
}
}
/// Only a complete, non-redirect UTF-8 response within the cap is delivered;
/// HTTP 4xx/5xx stay for the extension to interpret.
pub fn accept(status: u16, body: Vec<u8>) -> Result<Reply, Fault> {
    if !(200..=599).contains(&status) || (300..400).contains(&status) {
        return Err(Fault::Unknown("status"));
    }
    if body.len() > MAX_RESPONSE {
        return Err(Fault::Unknown("response-too-large"));
    }
    let body = String::from_utf8(body).map_err(|_| Fault::Unknown("response-encoding"))?;
    Ok(Reply { status, body })
}

#[cfg(desktop)]
pub(crate) mod desktop {
    use super::{accept, Fault, Reply, View, MAX_RESPONSE};
    use crate::credential_types::Authentication;
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
    use std::time::Duration;

    pub const CONNECT: Duration = Duration::from_secs(10);
    /// A long context or reply can take minutes; the caller may cancel sooner.
    pub const TOTAL: Duration = Duration::from_secs(600);

    /// No redirects, no system or environment proxy, no cookies, no implicit
    /// decompression; certificates are checked by the operating system.
    pub fn client(https_only: bool) -> reqwest::Result<reqwest::Client> {
        reqwest::Client::builder()
            .https_only(https_only)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT)
            .timeout(TOTAL)
            .build()
    }
    /// `content` adds the bound content type; a read sends no body.
    pub fn headers(view: &View, secret: &[u8], content: bool) -> Result<HeaderMap, Fault> {
        let invalid = || Fault::NotDispatched("invalid-policy");
        let declaration = &view.declaration;
        let mut map = HeaderMap::new();
        if content {
            map.insert(
                CONTENT_TYPE,
                HeaderValue::from_str(&declaration.content_type).map_err(|_| invalid())?,
            );
        }
        for (name, value) in &declaration.headers {
            map.insert(
                HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid())?,
                HeaderValue::from_str(value).map_err(|_| invalid())?,
            );
        }
        let (name, mut raw) = match &declaration.authentication {
            Authentication::Bearer => (AUTHORIZATION, [b"Bearer ".as_slice(), secret].concat()),
            Authentication::Header { name } => (
                HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid())?,
                secret.to_vec(),
            ),
        };
        let value = HeaderValue::from_bytes(&raw);
        raw.fill(0);
        let mut value = value.map_err(|_| invalid())?;
        value.set_sensitive(true);
        map.insert(name, value);
        Ok(map)
    }
    /// POSTs `body`, or GETs when there is none.
    pub async fn transmit(
        client: &reqwest::Client,
        target: &str,
        headers: HeaderMap,
        body: Option<String>,
        total: Duration,
    ) -> Result<Reply, Fault> {
        let exchange = async {
            let failed = |_| Fault::Unknown("transport");
            let request = match body {
                Some(body) => client.post(target).body(body),
                None => client.get(target),
            };
            let mut response = request.headers(headers).send().await.map_err(failed)?;
            let status = response.status().as_u16();
            if (300..400).contains(&status) {
                return Err(Fault::Unknown("redirect"));
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE as u64)
            {
                return Err(Fault::Unknown("response-too-large"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(failed)? {
                if bytes.len() + chunk.len() > MAX_RESPONSE {
                    return Err(Fault::Unknown("response-too-large"));
                }
                bytes.extend_from_slice(&chunk);
            }
            accept(status, bytes)
        };
        tokio::time::timeout(total, exchange)
            .await
            .map_err(|_| Fault::Unknown("timeout"))?
    }
}

/// The stored key, `None` when the item does not exist.
#[cfg(target_os = "macos")]
pub(crate) async fn read_key(
    app: &tauri::AppHandle,
    reference: &str,
) -> Result<Option<Vec<u8>>, Failure> {
    use crate::credential_secrets::{recall, remember};
    use security_framework::passwords::{generic_password, PasswordOptions};
    if let Some(bytes) = recall(reference) {
        return Ok(Some(bytes));
    }
    let service = format!("{}.credentials.v1", app.config().identifier);
    let reference = reference.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut options = PasswordOptions::new_generic_password(&service, &reference);
        options.set_access_synchronized(Some(false));
        match generic_password(options) {
            Ok(mut bytes) if !crate::credentials_native::key_valid(&bytes) => {
                bytes.fill(0);
                Err("invalid-key")
            }
            Ok(bytes) => {
                remember(&reference, &bytes);
                Ok(Some(bytes))
            }
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("unknown"),
        }
    })
    .await
    .map_err(|_| "unknown")?
}
/// POSTs `body` to the bound target, or GETs `target` (a read on the same
/// site) when there is no body.
#[cfg(target_os = "macos")]
pub async fn send(
    app: &tauri::AppHandle,
    _id: &str,
    view: &View,
    reference: &str,
    target: &str,
    body: Option<String>,
) -> Result<Reply, Fault> {
    let mut secret = match read_key(app, reference).await {
        Ok(Some(secret)) => secret,
        _ => return Err(Fault::NotDispatched("secret-unavailable")),
    };
    let headers = desktop::headers(view, &secret, body.is_some());
    secret.fill(0);
    let client =
        desktop::client(true).map_err(|_| Fault::NotDispatched("transport-unavailable"))?;
    desktop::transmit(&client, target, headers?, body, desktop::TOTAL).await
}
/// Dropping the request future closes the connection on desktop.
#[cfg(not(target_os = "android"))]
pub async fn cancel(_app: &tauri::AppHandle, _id: &str) {}

/// Android sends from Kotlin with the same policy; the key is decrypted there.
#[cfg(target_os = "android")]
pub async fn send(
    app: &tauri::AppHandle,
    id: &str,
    view: &View,
    reference: &str,
    target: &str,
    body: Option<String>,
) -> Result<Reply, Fault> {
    use crate::credential_types::Authentication;
    let declaration = &view.declaration;
    let header = match &declaration.authentication {
        Authentication::Bearer => None,
        Authentication::Header { name } => Some(name.clone()),
    };
    let result = crate::credentials_native::mobile(
        app.clone(),
        "request",
        serde_json::json!({
            "id": id, "reference": reference, "target": target,
            "method": if body.is_some() { "POST" } else { "GET" },
            "contentType": declaration.content_type, "headers": declaration.headers,
            "header": header, "body": body.unwrap_or_default(),
        }),
    )
    .await
    .map_err(|_| Fault::Unknown("transport"))?;
    const CODES: [&str; 8] = [
        "secret-unavailable",
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
            accept(u16::try_from(status).unwrap_or(0), body.as_bytes().to_vec())
        }
        Some("not-dispatched") => Err(Fault::NotDispatched(code())),
        _ => Err(Fault::Unknown(code())),
    }
}
#[cfg(target_os = "android")]
pub async fn cancel(app: &tauri::AppHandle, id: &str) {
    let _ =
        crate::credentials_native::mobile(app.clone(), "cancel", serde_json::json!({ "id": id }))
            .await;
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub async fn send(
    _app: &tauri::AppHandle,
    _id: &str,
    _view: &View,
    _reference: &str,
    _target: &str,
    _body: Option<String>,
) -> Result<Reply, Fault> {
    Err(Fault::NotDispatched("unavailable"))
}

#[cfg(all(test, desktop))]
#[path = "credential_transport_tests.rs"]
mod tests;
