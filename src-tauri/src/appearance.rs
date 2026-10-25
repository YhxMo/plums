use crate::ipc::{ipc_command, wire_enum};
use tauri::Manager;

wire_enum! {
#[derive(serde::Deserialize)]
pub enum Theme { Light => "light", Dark => "dark" }
}

#[cfg(target_os = "android")]
pub struct Appearance(pub tauri::plugin::PluginHandle<tauri::Wry>);

ipc_command! {
pub async fn shell_set_theme(app: tauri::AppHandle, theme: Theme) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let target = match theme {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        };
        // The Mac window stays clear so the rail shows the sidebar material.
        let bg = match theme {
            _ if cfg!(target_os = "macos") => tauri::window::Color(0, 0, 0, 0),
            Theme::Light => tauri::window::Color(247, 247, 248, 255),
            Theme::Dark => tauri::window::Color(30, 30, 30, 255),
        };
        let window = app
            .get_webview_window("main")
            .ok_or("main window unavailable")?;
        app.set_theme(Some(target));
        window
            .set_theme(Some(target))
            .map_err(|error| error.to_string())?;
        window
            .set_background_color(Some(bg))
            .map_err(|error| error.to_string())?;
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
}
