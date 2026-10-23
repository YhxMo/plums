use crate::ipc::{ipc_command, wire_enum, wire_object};
mod appearance;
mod credential_bindings;
mod credential_request;
mod credential_secrets;
mod credential_transport;
mod credential_types;
mod credentials;
mod credentials_native;
mod documents;
mod ipc;
mod network;
mod storage;
use serde::Serialize;
use serde_json::Value;
use storage::Broker;
use tauri::Manager;

ipc_command! {
fn platform_grant(
    owner: String,
    capabilities: Vec<String>,
    state: tauri::State<'_, Broker>,
    documents: tauri::State<'_, documents::Documents>,
    requests: tauri::State<'_, credential_request::Requests>,
    reads: tauri::State<'_, network::Reads>,
) -> Result<(), storage::StateErrorCode> {
    Broker::validate_grant(&owner, &capabilities)?;
    // Any grant change ends send confirmations and the requests in flight.
    requests.release(&owner);
    reads.0.release(&owner);
    documents
        .grant_with(
            &owner,
            capabilities.iter().any(|cap| cap == "document.read"),
            || state.grant(&owner, capabilities).map_err(|_| "unknown"),
        )
        .map_err(|_| storage::StateErrorCode::GrantUnavailable)
}
}

wire_object! {
#[derive(Serialize)]
struct PlatformFailure, rename_all = "camelCase" { code: storage::StateErrorCode, outcome: CommitOutcome }
}
wire_enum! {
#[derive(Serialize)]
enum CommitOutcome { NotCommitted => "not-committed", Unknown => "unknown" }
}

ipc_command! {
fn platform_call(
    owner: String,
    capability: String,
    payload: Option<Value>,
    state: tauri::State<'_, Broker>,
) -> Result<Value, PlatformFailure> {
    state
        .call(&owner, &capability, payload.unwrap_or(Value::Null))
        .map_err(|code| PlatformFailure {
            code,
            // Only a failed directory sync happens after the file was replaced.
            outcome: if code == storage::StateErrorCode::StateSync {
                CommitOutcome::Unknown
            } else {
                CommitOutcome::NotCommitted
            },
        })
}
}

// Both runtime registration and the compiled exporter consume this list.
macro_rules! native_commands {
    ($callback:ident) => {
        $callback! {
            credentials::credential_supported,
            credentials::credential_list,
            credentials::credential_inventory,
            credentials::credential_retain,
            credentials::credential_configure,
            credentials::credential_route,
            credentials::credential_reconcile,
            credentials::credential_delete,
            credential_request::credential_request,
            credential_request::credential_abort,
            credential_request::credential_release,
            documents::document_supported,
            documents::document_select,
            documents::document_list,
            documents::document_read,
            documents::document_cancel,
            documents::document_revoke,
            network::network_read,
            network::network_abort,
            network::network_release,
            crate::platform_grant,
            crate::platform_call,
            appearance::shell_set_theme
        }
    };
}
macro_rules! native_handler {
    ($($module:ident :: $name:ident),*) => {
        tauri::generate_handler![$($module::$name),*]
    };
}
macro_rules! native_contract {
    ($($module:ident :: $name:ident),*) => {{
        let header = "// Generated from compiled Rust IPC declarations. Do not edit.\n";
        let ordinary = vec![$($module::$name::contract()),*].join("");
        format!("{header}export interface NativeCommands {{\n{ordinary}}}\n")
    }};
}
/// Export tooling only; does not start Tauri or access application data.
pub fn ipc_typescript() -> String {
    native_commands!(native_contract)
}
fn command_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    native_commands!(native_handler)
}

/// Development and preview builds may redirect data for isolated runs; a
/// release build always uses the platform data directory.
fn data_dir_override() -> Option<std::path::PathBuf> {
    #[cfg(debug_assertions)]
    return std::env::var_os("PLUMS_DATA_DIR").map(std::path::PathBuf::from);
    #[cfg(not(debug_assertions))]
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Registered first: a second launch only focuses the running window, so
    // two processes never write the same state directory.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("appearance")
            .setup(|app, api| {
                app.manage(appearance::Appearance(api.register_android_plugin(
                    &app.config().identifier,
                    "AppearancePlugin",
                )?));
                Ok(())
            })
            .build(),
    );
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("documents")
            .setup(|app, api| {
                app.manage(documents::AndroidDocuments(api.register_android_plugin(
                    &app.config().identifier,
                    "DocumentsPlugin",
                )?));
                Ok(())
            })
            .build(),
    );
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("credentials")
            .setup(|app, api| {
                app.manage(credentials::AndroidCredentials(
                    api.register_android_plugin(&app.config().identifier, "CredentialsPlugin")?,
                ));
                Ok(())
            })
            .build(),
    );
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("network")
            .setup(|app, api| {
                app.manage(network::AndroidNetwork(api.register_android_plugin(
                    &app.config().identifier,
                    "NetworkPlugin",
                )?));
                Ok(())
            })
            .build(),
    );
    let builder = builder.invoke_handler(command_handler());
    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use objc2_app_kit::{NSControlSize, NSWindow, NSWindowButton};
                let pointer = window.ns_window()?;
                // Tauri runs setup on the AppKit thread; the window owns this pointer.
                let native = unsafe { &*pointer.cast::<NSWindow>() };
                // Use AppKit's small control specification, not a frame/scale override.
                for kind in [
                    NSWindowButton::CloseButton,
                    NSWindowButton::MiniaturizeButton,
                    NSWindowButton::ZoomButton,
                ] {
                    if let Some(button) = native.standardWindowButton(kind) {
                        button.setControlSize(NSControlSize::Small);
                    }
                }
            }
            let root =
                data_dir_override().unwrap_or(app.path().app_data_dir()?.join("data"));
            app.manage(credential_bindings::Bindings::new(root.clone()));
            #[cfg(not(target_os = "android"))]
            app.manage(credential_secrets::Vault::new(root.clone()));
            let broker = Broker::new(root);
            broker.sweep(std::time::Duration::from_secs(3600));
            app.manage(broker);
            app.manage(documents::Documents::default());
            app.manage(credential_request::Requests::default());
            app.manage(network::Reads::default());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Plums runtime failed");
}

#[cfg(test)]
mod ipc_tests;
