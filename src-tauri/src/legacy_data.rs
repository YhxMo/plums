//! One-time copy of the data kept before the app identifier became
//! `dev.plums.plums`. The earlier folder is only read, so it stays as a backup.
use std::{fs, io, path::Path};

/// The earlier data folder, relative to the platform's application data folder.
pub const LEGACY: &str = "dev.plums.m1/m1-experiment";
/// Written into the new folder so the copy can be traced.
const MARKER: &str = "migrated-from.json";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Copied,
    Skipped,
}

/// Copies `legacy` into `root` when `root` holds no data yet. The copy is
/// assembled beside `root` and renamed into place, so a failure leaves no
/// partial data and the next start tries again.
pub fn migrate(legacy: &Path, root: &Path) -> io::Result<Outcome> {
    if !legacy.is_dir() || has_entries(root)? {
        return Ok(Outcome::Skipped);
    }
    let parent = root
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "data folder has no parent"))?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".data-migration-{}", uuid::Uuid::new_v4()));
    let result = copy_tree(legacy, &staging)
        .and_then(|_| {
            let marker = serde_json::json!({ "schema": 1, "from": LEGACY });
            fs::write(staging.join(MARKER), format!("{marker}\n"))
        })
        .and_then(|_| {
            if root.exists() {
                fs::remove_dir(root)?;
            }
            fs::rename(&staging, root)
        })
        .and_then(|_| fs::File::open(parent)?.sync_all());
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result.map(|_| Outcome::Copied)
}

fn has_entries(root: &Path) -> io::Result<bool> {
    match fs::read_dir(root) {
        Ok(mut entries) => Ok(entries.next().is_some()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Copies files with their permission bits; links are refused, not followed.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    fs::set_permissions(to, fs::metadata(from)?.permissions())?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
            fs::File::open(&target)?.sync_all()?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "earlier data contains a link or special file",
            ));
        }
    }
    Ok(())
}

/// Runs before anything reads `root` (the platform data folder's `data`). When
/// the copy fails, the person is told why and the app quits, so no new data
/// is written in its place and the next start tries again.
pub fn prepare(root: &Path) {
    let Some(base) = root.parent().and_then(Path::parent) else {
        return;
    };
    let legacy = base.join(LEGACY);
    if let Err(error) = migrate(&legacy, root) {
        let detail = format!(
            "旧版本的数据没有改动，仍在 {}。请检查磁盘空间与访问权限，退出旧版本 Plums 后重新打开。\n\n{error}",
            legacy.display()
        );
        report(&detail);
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
fn report(detail: &str) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSAlert;
    use objc2_foundation::NSString;
    // Tauri runs setup on the AppKit main thread.
    let Some(marker) = MainThreadMarker::new() else {
        eprintln!("{detail}");
        return;
    };
    let alert = NSAlert::new(marker);
    alert.setMessageText(&NSString::from_str("无法复制旧版本的数据"));
    alert.setInformativeText(&NSString::from_str(detail));
    alert.runModal();
}
#[cfg(not(target_os = "macos"))]
fn report(detail: &str) {
    eprintln!("{detail}");
}

#[cfg(test)]
#[path = "legacy_data_tests.rs"]
mod tests;
