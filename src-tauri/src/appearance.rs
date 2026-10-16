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
        let target = match theme {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        };
        let bg = match theme {
            Theme::Light => tauri::window::Color(247, 247, 248, 255),
            Theme::Dark => tauri::window::Color(30, 30, 30, 255),
        };
        app.set_theme(Some(target));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_theme(Some(target));
            let _ = window.set_background_color(Some(bg));
        }
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
