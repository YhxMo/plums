use crate::ipc::{ipc_command, wire_enum};
use tauri::Manager;

wire_enum! {
#[derive(serde::Deserialize)]
pub enum Theme { System => "system", Light => "light", Dark => "dark" }
}

#[cfg(target_os = "android")]
pub struct Appearance(pub tauri::plugin::PluginHandle<tauri::Wry>);

ipc_command! {
pub async fn shell_set_theme(app: tauri::AppHandle, theme: Theme) -> Result<(), String> {
    #[cfg(desktop)]
    {
        // `None` hands the window back to the system, which the page then follows.
        let target = match theme {
            Theme::System => None,
            Theme::Light => Some(tauri::Theme::Light),
            Theme::Dark => Some(tauri::Theme::Dark),
        };
        let window = app
            .get_webview_window("main")
            .ok_or("main window unavailable")?;
        app.set_theme(target);
        window
            .set_theme(target)
            .map_err(|error| error.to_string())?;
        // The Mac window stays clear so the rail shows the sidebar material;
        // elsewhere the colour is read now and not followed afterwards.
        let bg = if cfg!(target_os = "macos") {
            tauri::window::Color(0, 0, 0, 0)
        } else {
            let dark = match target {
                Some(theme) => theme,
                None => window.theme().map_err(|error| error.to_string())?,
            } == tauri::Theme::Dark;
            if dark {
                tauri::window::Color(30, 30, 30, 255)
            } else {
                tauri::window::Color(247, 247, 248, 255)
            }
        };
        window
            .set_background_color(Some(bg))
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        if matches!(theme, Theme::System) {
            return Err("Following the system is not implemented on Android".into());
        }
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
