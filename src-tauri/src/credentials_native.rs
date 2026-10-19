//! Platform secret storage and native panels. Kept separate from the Tauri
//! command layer so each file stays reviewable.
use crate::credential_bindings::{Failure, KeyResult};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "macos")]
fn vault<T: Send + 'static>(
    app: tauri::AppHandle,
    run: impl FnOnce(&crate::credential_secrets::Vault) -> T + Send + 'static,
) -> impl std::future::Future<Output = Result<T, tauri::Error>> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        run(&app.state::<crate::credential_secrets::Vault>())
    })
}
#[cfg(target_os = "macos")]
pub(crate) async fn store_key(app: tauri::AppHandle, reference: &str, key: String) -> KeyResult {
    let reference = reference.to_owned();
    match vault(app, move |vault| vault.put(&reference, &key)).await {
        Ok(Ok(())) => KeyResult::Stored,
        Ok(Err("invalid-key")) => KeyResult::Rejected,
        // Nothing replaced the file: the key is certainly not saved.
        Ok(Err("unavailable" | "corrupt" | "resource-limit")) => KeyResult::Unavailable,
        _ => KeyResult::Unknown,
    }
}
#[cfg(target_os = "macos")]
pub(crate) async fn read_key(
    app: &tauri::AppHandle,
    reference: &str,
) -> Result<Option<Vec<u8>>, Failure> {
    let reference = reference.to_owned();
    vault(app.clone(), move |vault| vault.get(&reference))
        .await
        .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
pub(crate) async fn key_exists(app: tauri::AppHandle, reference: &str) -> Result<bool, Failure> {
    Ok(read_key(&app, reference).await?.is_some())
}
#[cfg(target_os = "macos")]
pub(crate) async fn delete_key(app: tauri::AppHandle, reference: &str) -> Result<(), Failure> {
    let reference = reference.to_owned();
    vault(app, move |vault| vault.remove(&reference))
        .await
        .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
pub(crate) async fn prompt(
    app: tauri::AppHandle,
    title: &str,
    description: &str,
    input: Option<String>,
) -> Result<Option<String>, Failure> {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSTextField};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let title = title.to_owned();
    let description = description.to_owned();
    app.run_on_main_thread(move || {
        let result = (|| {
            let marker = MainThreadMarker::new().ok_or("unavailable")?;
            let panel = NSAlert::new(marker);
            panel.setMessageText(&NSString::from_str(&title));
            panel.setInformativeText(&NSString::from_str(&description));
            panel.addButtonWithTitle(&NSString::from_str("确认"));
            panel
                .addButtonWithTitle(&NSString::from_str("取消"))
                .setKeyEquivalent(&NSString::from_str("\u{1b}"));
            let field = input.map(|value| {
                let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(360.0, 28.0));
                let field = NSTextField::initWithFrame(NSTextField::alloc(marker), frame);
                field.setStringValue(&NSString::from_str(&value));
                field.setPlaceholderString(Some(&NSString::from_str(
                    "留空直连，或 http://127.0.0.1:7890",
                )));
                panel.setAccessoryView(Some(&field));
                panel.window().setInitialFirstResponder(Some(&field));
                field
            });
            let accepted = panel.runModal() == NSAlertFirstButtonReturn;
            let value = field
                .as_ref()
                .map(|field| field.stringValue().to_string())
                .unwrap_or_default();
            if let Some(field) = field {
                field.setStringValue(&NSString::new());
            }
            Ok(accepted.then_some(value))
        })();
        let _ = send.send(result);
    })
    .map_err(|_| "unavailable")?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|_| "unknown")?)
        .await
        .map_err(|_| "unknown")?
}

#[cfg(target_os = "android")]
pub struct AndroidCredentials(pub tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
pub(crate) async fn mobile(
    app: tauri::AppHandle,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, Failure> {
    app.state::<AndroidCredentials>()
        .0
        .run_mobile_plugin_async(command, args)
        .await
        .map_err(|_| "unknown")
}
#[cfg(target_os = "android")]
pub(crate) async fn store_key(app: tauri::AppHandle, reference: &str, key: String) -> KeyResult {
    let result = mobile(
        app,
        "store",
        serde_json::json!({ "reference": reference, "key": key }),
    )
    .await;
    match result
        .as_ref()
        .ok()
        .and_then(|value| value["status"].as_str())
    {
        Some("stored") => KeyResult::Stored,
        Some("rejected") => KeyResult::Rejected,
        Some("unavailable") => KeyResult::Unavailable,
        _ => KeyResult::Unknown,
    }
}
#[cfg(target_os = "android")]
pub(crate) async fn key_exists(app: tauri::AppHandle, reference: &str) -> Result<bool, Failure> {
    let result = mobile(
        app,
        "inspect",
        serde_json::json!({ "reference": reference }),
    )
    .await?;
    match result["status"].as_str() {
        Some("present") => Ok(true),
        Some("missing") => Ok(false),
        _ => Err("unknown"),
    }
}
#[cfg(target_os = "android")]
pub(crate) async fn delete_key(app: tauri::AppHandle, reference: &str) -> Result<(), Failure> {
    let result = mobile(app, "remove", serde_json::json!({ "reference": reference })).await?;
    if result["status"] == "removed" {
        Ok(())
    } else {
        Err("unknown")
    }
}
#[cfg(target_os = "android")]
pub(crate) async fn prompt(
    app: tauri::AppHandle,
    title: &str,
    description: &str,
    input: Option<String>,
) -> Result<Option<String>, Failure> {
    let result = mobile(
        app,
        "prompt",
        serde_json::json!({ "title": title, "description": description, "input": input }),
    )
    .await?;
    match result["status"].as_str() {
        Some("cancelled") => Ok(None),
        Some("unavailable") => Err("unavailable"),
        Some("confirmed") => result["value"]
            .as_str()
            .map(|value| Some(value.into()))
            .ok_or("unknown"),
        _ => Err("unknown"),
    }
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(crate) async fn store_key(_app: tauri::AppHandle, _reference: &str, _key: String) -> KeyResult {
    KeyResult::Rejected
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(crate) async fn key_exists(_app: tauri::AppHandle, _reference: &str) -> Result<bool, Failure> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(crate) async fn delete_key(_app: tauri::AppHandle, _reference: &str) -> Result<(), Failure> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(crate) async fn prompt(
    _app: tauri::AppHandle,
    _title: &str,
    _description: &str,
    _input: Option<String>,
) -> Result<Option<String>, Failure> {
    Err("unavailable")
}
