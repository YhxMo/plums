//! `file.save`: writes bytes where the person chooses in the system's save
//! panel. Only PNG pictures and `.plums` bundles, named without folders.
use crate::ipc::ipc_command;
use crate::storage::Broker;
use tauri::Manager;

/// Largest file saved, matching `MAX_SAVE_BYTES` on the web side.
pub const MAX_BYTES: usize = 32 * 1024 * 1024;

/// A suggested name: no folders, at most 200 characters, `.png` or `.plums`.
pub fn file_name(name: &str) -> Result<&str, &'static str> {
    let invalid = "invalid-request";
    if name.is_empty()
        || name.chars().count() > 200
        || name.starts_with('.')
        || name.contains(['/', '\\', ':', '\0'])
    {
        return Err(invalid);
    }
    let lower = name.to_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".plums") {
        Ok(name)
    } else {
        Err(invalid)
    }
}

/// Standard base64 with padding.
pub fn decode(data: &str) -> Result<Vec<u8>, &'static str> {
    let invalid = "invalid-request";
    let bytes = data.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return Err(invalid);
    }
    let value = |c: u8| -> Result<u32, &'static str> {
        Ok(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(invalid),
        } as u32)
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let quads = bytes.chunks(4).count();
    for (i, quad) in bytes.chunks(4).enumerate() {
        let pad = quad.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && i + 1 != quads) || quad[..4 - pad].contains(&b'=') {
            return Err(invalid);
        }
        let mut n = 0u32;
        for &c in &quad[..4 - pad] {
            n = (n << 6) | value(c)?;
        }
        n <<= 6 * pad as u32;
        let decoded = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&decoded[..3 - pad]);
    }
    Ok(out)
}

#[cfg(target_os = "macos")]
async fn choose(app: tauri::AppHandle, name: String) -> Result<Option<String>, &'static str> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let marker = MainThreadMarker::new().ok_or("unavailable")?;
            let panel = NSSavePanel::savePanel(marker);
            panel.setNameFieldStringValue(&NSString::from_str(&name));
            panel.setCanCreateDirectories(true);
            if panel.runModal() != NSModalResponseOK {
                return Ok(None);
            }
            let url = panel.URL().ok_or("io")?;
            if !url.isFileURL() {
                return Err("denied");
            }
            Ok(Some(url.path().ok_or("io")?.to_string()))
        })();
        let _ = send.send(result);
    })
    .map_err(|_| "unavailable")?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|_| "unknown")?)
        .await
        .map_err(|_| "unknown")?
}
#[cfg(not(target_os = "macos"))]
async fn choose(_app: tauri::AppHandle, _name: String) -> Result<Option<String>, &'static str> {
    Err("unavailable")
}

ipc_command! {
pub async fn file_save(
    app: tauri::AppHandle,
    owner: String,
    name: String,
    data: String,
) -> Result<&'static str, &'static str> {
    if !app.state::<Broker>().allows(&owner, "file.save") {
        return Err("denied");
    }
    let name = file_name(&name)?.to_owned();
    if data.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("too-large");
    }
    let bytes = decode(&data)?;
    let Some(path) = choose(app, name).await? else {
        return Ok("cancelled");
    };
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, bytes))
        .await
        .map_err(|_| "unknown")?
        .map_err(|_| "io")?;
    Ok("saved")
}
}

#[cfg(test)]
#[path = "files_tests.rs"]
mod tests;
