mod storage;
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
    tauri::Builder::default()
        .setup(|app| {
            let root = std::env::var_os("PLUMS_M1_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("data"));
            app.manage(Broker::new(root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![platform_grant, platform_call])
        .run(tauri::generate_context!())
        .expect("Plums M1 runtime failed");
}
