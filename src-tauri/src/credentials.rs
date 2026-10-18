//! Native management entry points. API keys never enter a WebView command or response.
use crate::credential_bindings::{Bindings, Declaration, Failure, KeyResult, Route, Status, View};
#[cfg(target_os = "android")]
pub use crate::credentials_native::AndroidCredentials;
use crate::credentials_native::{delete_key, key_exists, prompt, store_key};
use crate::ipc::{ipc_command, wire_enum};
use serde::Serialize;
use tauri::Manager;

wire_enum! {
#[derive(Serialize)]
pub enum Response, tag = "status" {
    Saved => "saved", Cancelled => "cancelled",
    Rejected => "rejected" { reason: Failure }, Unknown => "unknown"
}
}
fn unavailable() -> Response {
    Response::Rejected {
        reason: "unavailable",
    }
}
fn response(result: Result<(), Failure>) -> Response {
    match result {
        Ok(()) => Response::Saved,
        Err("unknown") => Response::Unknown,
        Err("unavailable") => Response::Rejected {
            reason: "unavailable",
        },
        Err(reason) => Response::Rejected { reason },
    }
}
ipc_command! {
pub fn credential_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "android"))
}
}
ipc_command! {
pub fn credential_list(
    owner: String,
    bindings: tauri::State<'_, Bindings>,
) -> Result<Vec<View>, String> {
    if !credential_supported() {
        return Err("unavailable".into());
    }
    bindings.list(&owner).map_err(str::to_owned)
}
}
ipc_command! {
pub fn credential_inventory(bindings: tauri::State<'_, Bindings>) -> Result<Vec<View>, String> {
    if !credential_supported() {
        return Err("unavailable".into());
    }
    bindings.inventory().map_err(str::to_owned)
}
}
ipc_command! {
pub fn credential_retain(owner: String, bindings: tauri::State<'_, Bindings>) -> Response {
    if !credential_supported() {
        return unavailable();
    }
    response(bindings.retain_disabled(&owner))
}
}
ipc_command! {
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
        return unavailable();
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
            KeyResult::Unavailable => unavailable(),
            KeyResult::Unknown => Response::Unknown,
        },
        Err(error) => response(Err(error)),
    }
}
}
ipc_command! {
pub async fn credential_route(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    if !credential_supported() {
        return unavailable();
    }
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
}
ipc_command! {
pub async fn credential_reconcile(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    if !credential_supported() {
        return unavailable();
    }
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
}
ipc_command! {
pub async fn credential_delete(
    app: tauri::AppHandle,
    owner: String,
    alias: String,
    revision: u64,
) -> Response {
    if !credential_supported() {
        return unavailable();
    }
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
}

#[cfg(test)]
#[path = "credentials_tests.rs"]
mod tests;
