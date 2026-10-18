use super::*;
#[cfg(target_os = "macos")]
pub(super) async fn select_native(
    app: tauri::AppHandle,
    multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let marker = MainThreadMarker::new().ok_or("unavailable")?;
            let panel = NSOpenPanel::openPanel(marker);
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(false);
            panel.setAllowsMultipleSelection(multiple);
            panel.setCanCreateDirectories(false);
            panel.setTreatsFilePackagesAsDirectories(false);
            if panel.runModal() != NSModalResponseOK {
                return Ok(None);
            }
            let urls = panel.URLs();
            if urls.len() > OWNER_HANDLES {
                return Err("resource-limit");
            }
            let mut paths = Vec::new();
            for url in urls.iter() {
                if !url.isFileURL() {
                    return Err("denied");
                }
                let path = url.path().ok_or("io")?.to_string();
                let name = url
                    .lastPathComponent()
                    .map(|name| name.to_string())
                    .unwrap_or_else(|| "Selected document".into());
                paths.push((path, name));
            }
            Ok(Some(paths))
        })();
        let _ = send.send(result);
    })
    .map_err(|_| "unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(paths) = receive.recv().map_err(|_| "unknown")?? else {
            return Ok(None);
        };
        let mut selected = Vec::new();
        for (path, name) in paths {
            let file = std::fs::File::open(path).map_err(|_| "io")?;
            if !file.metadata().map_err(|_| "io")?.is_file() {
                return Err("denied");
            }
            selected.push(SelectedSource {
                name,
                source: Source::File(Arc::new(Mutex::new(file))),
            });
        }
        Ok(Some(selected))
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "macos")]
pub(super) async fn read_native(
    _app: tauri::AppHandle,
    source: Source,
    max_bytes: usize,
) -> Result<String, &'static str> {
    use std::io::{Read, Seek, SeekFrom};
    tauri::async_runtime::spawn_blocking(move || match source {
        Source::File(file) => {
            let mut file = file.lock().map_err(|_| "unknown")?;
            file.seek(SeekFrom::Start(0)).map_err(|_| "io")?;
            let mut bytes = Vec::new();
            (&mut *file)
                .take(max_bytes as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "io")?;
            decode_bytes(bytes, max_bytes)
        }
        #[cfg(test)]
        Source::Test(bytes) => decode_bytes(bytes, max_bytes),
    })
    .await
    .map_err(|_| "unknown")?
}
#[cfg(target_os = "android")]
pub struct AndroidDocuments(pub tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
pub(super) async fn select_native(
    app: tauri::AppHandle,
    multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    use tauri::Manager;
    let response: serde_json::Value = app
        .state::<AndroidDocuments>()
        .0
        .run_mobile_plugin_async("select", serde_json::json!({ "multiple": multiple }))
        .await
        .map_err(|_| "unknown")?;
    match response.get("status").and_then(serde_json::Value::as_str) {
        Some("cancelled") => Ok(None),
        Some("selected") => {
            let documents = response
                .get("documents")
                .and_then(serde_json::Value::as_array)
                .ok_or("unknown")?;
            if documents.is_empty() || documents.len() > OWNER_HANDLES {
                return Err("resource-limit");
            }
            documents
                .iter()
                .map(|document| {
                    let uri = document
                        .get("uri")
                        .and_then(serde_json::Value::as_str)
                        .ok_or("unknown")?;
                    if !uri.starts_with("content://") || uri.len() > 8192 {
                        return Err("denied");
                    }
                    let name = document
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .ok_or("unknown")?;
                    Ok(SelectedSource {
                        name: name.into(),
                        source: Source::Uri(uri.into()),
                    })
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some)
        }
        Some("rejected") => Err(native_reason(&response)),
        _ => Err("unknown"),
    }
}
#[cfg(target_os = "android")]
pub(super) async fn read_native(
    app: tauri::AppHandle,
    source: Source,
    max_bytes: usize,
) -> Result<String, &'static str> {
    use tauri::Manager;
    let uri = match source {
        Source::Uri(uri) => uri,
        #[cfg(test)]
        Source::Test(bytes) => return decode_bytes(bytes, max_bytes),
    };
    let response: serde_json::Value = app
        .state::<AndroidDocuments>()
        .0
        .run_mobile_plugin_async(
            "read",
            serde_json::json!({ "uri": uri, "maxBytes": max_bytes }),
        )
        .await
        .map_err(|_| "unknown")?;
    match response.get("status").and_then(serde_json::Value::as_str) {
        Some("read") => {
            let text = response
                .get("text")
                .and_then(serde_json::Value::as_str)
                .ok_or("unknown")?;
            if text.len() > max_bytes {
                return Err("too-large");
            }
            Ok(text.into())
        }
        Some("rejected") => Err(native_reason(&response)),
        _ => Err("unknown"),
    }
}
#[cfg(target_os = "android")]
fn native_reason(value: &serde_json::Value) -> &'static str {
    match value.get("reason").and_then(serde_json::Value::as_str) {
        Some("denied") => "denied",
        Some("unavailable") => "unavailable",
        Some("resource-limit") => "resource-limit",
        Some("too-large") => "too-large",
        Some("encoding") => "encoding",
        Some("io") => "io",
        _ => "unknown",
    }
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(super) async fn select_native(
    _app: tauri::AppHandle,
    _multiple: bool,
) -> Result<Option<Vec<SelectedSource>>, &'static str> {
    Err("unavailable")
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub(super) async fn read_native(
    _app: tauri::AppHandle,
    _source: Source,
    _max_bytes: usize,
) -> Result<String, &'static str> {
    Err("unavailable")
}
