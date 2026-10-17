mod appearance;
mod credential_bindings;
mod credentials;
mod credentials_native;
mod documents;
mod storage;
#[cfg(feature = "native-transport-experiment")]
mod transport_probe;
use serde::Serialize;
use serde_json::Value;
use storage::Broker;
use tauri::Manager;

#[tauri::command]
fn platform_grant(
    owner: String,
    capabilities: Vec<String>,
    state: tauri::State<'_, Broker>,
    documents: tauri::State<'_, documents::Documents>,
) -> Result<(), String> {
    Broker::validate_grant(&owner, &capabilities)?;
    documents
        .grant_with(
            &owner,
            capabilities.iter().any(|cap| cap == "document.read"),
            || state.grant(&owner, capabilities).map_err(|_| "unknown"),
        )
        .map_err(str::to_owned)
}

#[derive(Serialize)]
struct PlatformFailure {
    message: String,
    outcome: &'static str,
}

#[tauri::command]
fn platform_call(
    owner: String,
    capability: String,
    payload: Option<Value>,
    state: tauri::State<'_, Broker>,
) -> Result<Value, PlatformFailure> {
    state
        .call(&owner, &capability, payload.unwrap_or(Value::Null))
        .map_err(|message| PlatformFailure {
            message,
            outcome: "not-committed",
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
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
    // One command list for both builds; the experiment only appends its probes.
    macro_rules! handler {
        ($($extra:path),* $(,)?) => {
            tauri::generate_handler![
                credentials::credential_supported,
                credentials::credential_list,
                credentials::credential_inventory,
                credentials::credential_retain,
                credentials::credential_configure,
                credentials::credential_route,
                credentials::credential_reconcile,
                credentials::credential_delete,
                documents::document_supported,
                documents::document_select,
                documents::document_list,
                documents::document_read,
                documents::document_cancel,
                documents::document_revoke,
                platform_grant,
                platform_call,
                appearance::shell_set_theme
                $(, $extra)*
            ]
        };
    }
    #[cfg(feature = "native-transport-experiment")]
    let builder = builder
        .manage(transport_probe::Probe::default())
        .invoke_handler(handler![
            transport_probe::probe_grant,
            transport_probe::probe_prepare,
            transport_probe::probe_cancel,
            transport_probe::probe_execute,
            transport_probe::probe_faults,
            transport_probe::probe_info,
        ]);
    #[cfg(not(feature = "native-transport-experiment"))]
    let builder = builder.invoke_handler(handler![]);
    builder
        .setup(|app| {
            let root = std::env::var_os("PLUMS_M1_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("data"));
            app.manage(credential_bindings::Bindings::new(root.clone()));
            app.manage(Broker::new(root));
            app.manage(documents::Documents::default());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Plums M1 runtime failed");
}
