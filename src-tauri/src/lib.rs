mod appearance;
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
) -> Result<(), String> {
    state.grant(&owner, capabilities)
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
    #[cfg(feature = "native-transport-experiment")]
    let builder = builder
        .manage(transport_probe::Probe::default())
        .invoke_handler(tauri::generate_handler![
            platform_grant,
            platform_call,
            appearance::shell_set_theme,
            transport_probe::probe_grant,
            transport_probe::probe_prepare,
            transport_probe::probe_cancel,
            transport_probe::probe_execute,
            transport_probe::probe_faults,
            transport_probe::probe_info
        ]);
    #[cfg(not(feature = "native-transport-experiment"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_grant,
        platform_call,
        appearance::shell_set_theme
    ]);
    builder
        .setup(|app| {
            let root = std::env::var_os("PLUMS_M1_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("data"));
            app.manage(Broker::new(root));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Plums M1 runtime failed");
}
