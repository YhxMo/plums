//! Platform secret storage and native panels. Kept separate from the Tauri
//! command layer so each file stays reviewable.
use crate::credential_bindings::{Failure, KeyResult, View};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "macos")]
pub(crate) fn key_valid(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.len() <= 4096 && bytes.iter().all(|c| (33..=126).contains(c))
}
fn context(view: &View) -> String {
    let headers = view
        .declaration
        .headers
        .iter()
        .map(|(key, value)| format!("{key}: {value}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n{}\n扩展：{} / {}\n来源：{} · {}\nPOST · {}\n认证：{}\n{}\n\nAPI Key 仅保存到系统凭据存储。此操作不发送请求。", view.declaration.label, view.declaration.target, view.owner, view.alias, view.source, view.version, view.declaration.content_type, view.declaration.authentication.name(), headers)
}

#[cfg(target_os = "macos")]
pub(crate) async fn store_key(app: tauri::AppHandle, view: &View, reference: &str) -> KeyResult {
    use security_framework::passwords::{set_generic_password_options, PasswordOptions};
    let mut bytes = match prompt(
        app.clone(),
        "录入 API Key",
        &context(view),
        Some(String::new()),
        true,
    )
    .await
    {
        Ok(Some(value)) => value.into_bytes(),
        Ok(None) => return KeyResult::Cancelled,
        Err("unavailable") => return KeyResult::Unavailable,
        Err(_) => return KeyResult::Unknown,
    };
    if !key_valid(&bytes) {
        bytes.fill(0);
        return KeyResult::Rejected;
    }
    let service = format!("{}.credentials.v1", app.config().identifier);
    let reference = reference.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut options = PasswordOptions::new_generic_password(&service, &reference);
        options.set_access_synchronized(Some(false));
        let result = set_generic_password_options(&bytes, options);
        bytes.fill(0);
        if result.is_ok() {
            KeyResult::Stored
        } else {
            KeyResult::Unknown
        }
    })
    .await
    .unwrap_or(KeyResult::Unknown)
}
#[cfg(target_os = "macos")]
pub(crate) async fn key_exists(app: tauri::AppHandle, reference: &str) -> Result<bool, Failure> {
    let key = crate::credential_transport::read_key(&app, reference).await?;
    Ok(key.map(|mut bytes| bytes.fill(0)).is_some())
}
#[cfg(target_os = "macos")]
pub(crate) async fn delete_key(app: tauri::AppHandle, reference: &str) -> Result<(), Failure> {
    let service = format!("{}.credentials.v1", app.config().identifier);
    let reference = reference.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        use security_framework::passwords::{delete_generic_password_options, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(&service, &reference);
        options.set_access_synchronized(Some(false));
        match delete_generic_password_options(options) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err("unknown"),
        }
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
pub(crate) async fn prompt(
    app: tauri::AppHandle,
    title: &str,
    description: &str,
    input: Option<String>,
    secure: bool,
) -> Result<Option<String>, Failure> {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSSecureTextField, NSTextField};
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
                let field: objc2::rc::Retained<NSTextField> = if secure {
                    NSSecureTextField::initWithFrame(NSSecureTextField::alloc(marker), frame)
                        .into_super()
                } else {
                    NSTextField::initWithFrame(NSTextField::alloc(marker), frame)
                };
                field.setStringValue(&NSString::from_str(&value));
                field.setPlaceholderString(Some(&NSString::from_str(if secure {
                    "API Key"
                } else {
                    "留空直连，或 http://127.0.0.1:7890"
                })));
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
pub(crate) async fn store_key(app: tauri::AppHandle, view: &View, reference: &str) -> KeyResult {
    let result = mobile(
        app,
        "store",
        serde_json::json!({ "reference": reference, "description": context(view) }),
    )
    .await;
    match result
        .as_ref()
        .ok()
        .and_then(|value| value["status"].as_str())
    {
        Some("stored") => KeyResult::Stored,
        Some("cancelled") => KeyResult::Cancelled,
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
    _secure: bool,
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
pub(crate) async fn store_key(_app: tauri::AppHandle, _view: &View, _reference: &str) -> KeyResult {
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
    _secure: bool,
) -> Result<Option<String>, Failure> {
    Err("unavailable")
}
