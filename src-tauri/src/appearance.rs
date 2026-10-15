#[cfg(target_os = "android")]
use tauri::Manager;

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

#[cfg(target_os = "android")]
pub struct Appearance(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
pub async fn shell_set_theme(app: tauri::AppHandle, theme: Theme) -> Result<(), String> {
    #[cfg(desktop)]
    {
        app.set_theme(Some(match theme {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        }));
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        app.state::<Appearance>()
            .0
            .run_mobile_plugin_async::<()>(
                "apply",
                serde_json::json!({ "dark": matches!(theme, Theme::Dark) }),
            )
            .await
            .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, theme);
        Err("Native appearance is not implemented on iOS".into())
    }
}
