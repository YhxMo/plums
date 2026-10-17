//! Native management entry points. API keys never enter a WebView command or response.
use crate::credential_bindings::{Bindings, Declaration, Failure, KeyResult, Route, Status, View};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Response {
    Saved,
    Cancelled,
    Rejected { reason: Failure },
    Unknown,
}
fn response(result: Result<(), Failure>) -> Response {
    match result {
        Ok(()) => Response::Saved,
        Err("unknown" | "unavailable") => Response::Unknown,
        Err(reason) => Response::Rejected { reason },
    }
}
#[tauri::command]
pub fn credential_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "android"))
}
#[tauri::command]
pub fn credential_list(
    owner: String,
    bindings: tauri::State<'_, Bindings>,
) -> Result<Vec<View>, String> {
    bindings.list(&owner).map_err(str::to_owned)
}
#[tauri::command]
pub fn credential_inventory(bindings: tauri::State<'_, Bindings>) -> Result<Vec<View>, String> {
    bindings.inventory().map_err(str::to_owned)
}
#[tauri::command]
pub fn credential_retain(owner: String, bindings: tauri::State<'_, Bindings>) -> Response {
    response(bindings.retain_disabled(&owner))
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn credential_configure(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    source: String,
    version: String,
    declaration: Declaration,
    revision: u64,
) -> Response {
    if !credential_supported() {
        return Response::Rejected {
            reason: "unavailable",
        };
    }
    let bindings = app.state::<Bindings>().inner().clone();
    let ticket = match bindings.begin_key(owner, alias, source, version, declaration, revision) {
        Ok(ticket) => ticket,
        Err(error) => return response(Err(error)),
    };
    let Some(reference) = ticket.reference.as_deref() else {
        let _ = bindings.finish_key(ticket, KeyResult::Unknown);
        return Response::Unknown;
    };
    let result = store_key(app, &ticket.view, reference).await;
    match bindings.finish_key(ticket, result) {
        Ok(()) => match result {
            KeyResult::Stored => Response::Saved,
            KeyResult::Cancelled => Response::Cancelled,
            KeyResult::Rejected => Response::Rejected {
                reason: "invalid-key",
            },
            KeyResult::Unknown => Response::Unknown,
        },
        Err(error) => response(Err(error)),
    }
}
#[tauri::command]
pub async fn credential_route(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    let bindings = app.state::<Bindings>().inner().clone();
    let ticket = match bindings.begin_action(&owner, &alias, revision) {
        Ok(ticket) => ticket,
        Err(error) => return response(Err(error)),
    };
    let current = match &ticket.view.route {
        Route::Direct => "",
        Route::Proxy { url } => url,
    };
    let result = prompt(
        app,
        "网络设置",
        &format!(
            "{}\n{}\n\n代理地址留空表示直连。可填写 HTTP(S) 代理地址；不自动使用系统或环境代理。",
            ticket.view.declaration.label, ticket.view.declaration.target
        ),
        Some(current.into()),
        false,
    )
    .await;
    match result {
        Ok(Some(value)) => match Route::from_input(&value) {
            Ok(route) => response(bindings.finish_route(ticket, route)),
            Err(error) => {
                let _ = bindings.cancel_action(&ticket);
                response(Err(error))
            }
        },
        Ok(None) => {
            let _ = bindings.cancel_action(&ticket);
            Response::Cancelled
        }
        Err(error) => {
            let _ = bindings.cancel_action(&ticket);
            response(Err(error))
        }
    }
}
#[tauri::command]
pub async fn credential_reconcile(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    let bindings = app.state::<Bindings>().inner().clone();
    let ticket = match bindings.begin_action(&owner, &alias, revision) {
        Ok(ticket) => ticket,
        Err(error) => return response(Err(error)),
    };
    if ticket.view.status != Status::Pending {
        let _ = bindings.cancel_action(&ticket);
        return Response::Rejected {
            reason: "invalid-request",
        };
    }
    let Some(reference) = ticket.reference.as_deref() else {
        let _ = bindings.cancel_action(&ticket);
        return Response::Unknown;
    };
    let result = key_exists(app, reference).await;
    response(bindings.finish_reconcile(ticket, result))
}
#[tauri::command]
pub async fn credential_delete(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    let bindings = app.state::<Bindings>().inner().clone();
    let ticket = match bindings.begin_action(&owner, &alias, revision) {
        Ok(ticket) => ticket,
        Err(error) => return response(Err(error)),
    };
    match prompt(
        app.clone(),
        "撤销并删除凭据",
        &format!(
            "{}\n{}\n\n将禁用此连接，并删除此绑定持有的系统凭据。",
            ticket.view.declaration.label, ticket.view.declaration.target
        ),
        None,
        false,
    )
    .await
    {
        Ok(Some(_)) => {}
        Ok(None) => {
            let _ = bindings.cancel_action(&ticket);
            return Response::Cancelled;
        }
        Err(error) => {
            let _ = bindings.cancel_action(&ticket);
            return response(Err(error));
        }
    }
    if let Err(error) = bindings.disable(&ticket) {
        let _ = bindings.cancel_action(&ticket);
        return response(Err(error));
    }
    let mut removed = true;
    for reference in &ticket.references {
        if delete_key(app.clone(), reference).await.is_err() {
            removed = false;
        }
    }
    response(bindings.finish_delete(ticket, removed))
}
#[cfg(target_os = "macos")]
fn key_valid(bytes: &[u8]) -> bool {
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
async fn store_key(app: tauri::AppHandle, view: &View, reference: &str) -> KeyResult {
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
async fn key_exists(app: tauri::AppHandle, reference: &str) -> Result<bool, Failure> {
    let service = format!("{}.credentials.v1", app.config().identifier);
    let reference = reference.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(&service, &reference);
        options.set_access_synchronized(Some(false));
        match generic_password(options) {
            Ok(mut bytes) => {
                let valid = key_valid(&bytes);
                bytes.fill(0);
                if valid {
                    Ok(true)
                } else {
                    Err("invalid-key")
                }
            }
            Err(error) if error.code() == -25300 => Ok(false),
            Err(_) => Err("unknown"),
        }
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
async fn delete_key(app: tauri::AppHandle, reference: &str) -> Result<(), Failure> {
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
async fn prompt(
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
async fn mobile(
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
async fn store_key(app: tauri::AppHandle, view: &View, reference: &str) -> KeyResult {
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
        _ => KeyResult::Unknown,
    }
}
#[cfg(target_os = "android")]
async fn key_exists(app: tauri::AppHandle, reference: &str) -> Result<bool, Failure> {
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
async fn delete_key(app: tauri::AppHandle, reference: &str) -> Result<(), Failure> {
    let result = mobile(app, "remove", serde_json::json!({ "reference": reference })).await?;
    if result["status"] == "removed" {
        Ok(())
    } else {
        Err("unknown")
    }
}
#[cfg(target_os = "android")]
async fn prompt(
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
        Some("confirmed") => result["value"]
            .as_str()
            .map(|value| Some(value.into()))
            .ok_or("unknown"),
        _ => Err("unknown"),
    }
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn store_key(_app: tauri::AppHandle, _view: &View, _reference: &str) -> KeyResult {
    KeyResult::Rejected
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn key_exists(_app: tauri::AppHandle, _reference: &str) -> Result<bool, Failure> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn delete_key(_app: tauri::AppHandle, _reference: &str) -> Result<(), Failure> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
async fn prompt(
    _app: tauri::AppHandle,
    _title: &str,
    _description: &str,
    _input: Option<String>,
    _secure: bool,
) -> Result<Option<String>, Failure> {
    Err("unavailable")
}
