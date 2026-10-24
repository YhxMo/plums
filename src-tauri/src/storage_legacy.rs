//! Import of the JSON files each owner's documents lived in before SQLite.
use super::*;

/// Inserts the owner's earlier documents into a new database's `documents`,
/// in its creating transaction. Returns the files imported.
pub(super) fn import(
    transaction: &Transaction,
    root: &Path,
    owner: &str,
) -> Result<Vec<PathBuf>, StateErrorCode> {
    let mut imported = Vec::new();
    for (key, path) in documents(root, owner)? {
        let (revision, value, error) = match document(&path) {
            Ok(document) => (
                document.revision as i64,
                Some(document.value.to_string()),
                None,
            ),
            Err(code) => (0, None, Some(import_error(code))),
        };
        transaction
            .execute(
                "INSERT INTO documents (key, revision, value, error) VALUES (?1, ?2, ?3, ?4)",
                params![key, revision, value, error],
            )
            .map_err(|_| StateErrorCode::StateWrite)?;
        imported.push(path);
    }
    Ok(imported)
}

/// Moves imported files to `legacy-json/`; one left behind is harmless,
/// since only a new database imports.
pub(super) fn back_up(root: &Path, files: &[PathBuf]) {
    if files.is_empty() {
        return;
    }
    let backup = root.join("legacy-json");
    if fs::create_dir_all(&backup).is_err() {
        return;
    }
    for file in files {
        if let Some(name) = file.file_name() {
            let _ = fs::rename(file, backup.join(name));
        }
    }
}

/// The owner's earlier `<owner>.json` and `<owner>+<key>.json` files, by key.
fn documents(root: &Path, owner: &str) -> Result<Vec<(String, PathBuf)>, StateErrorCode> {
    let entries = fs::read_dir(root).map_err(|_| StateErrorCode::StateRead)?;
    let keyed = format!("{owner}+");
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| StateErrorCode::StateRead)?;
        if !entry
            .file_type()
            .map_err(|_| StateErrorCode::StateRead)?
            .is_file()
        {
            continue;
        }
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        let key = if stem == owner {
            String::new()
        } else if let Some(key) = stem.strip_prefix(&keyed).filter(|key| valid_key(key)) {
            key.into()
        } else {
            continue;
        };
        found.push((key, entry.path()));
    }
    Ok(found)
}

fn document(path: &Path) -> Result<Document, StateErrorCode> {
    // The size is checked before reading, so a huge file is never loaded.
    let size = fs::metadata(path)
        .map_err(|_| StateErrorCode::StateRead)?
        .len();
    if size > MAX_DOCUMENT as u64 {
        return Err(StateErrorCode::StateTooLarge);
    }
    let bytes = fs::read(path).map_err(|_| StateErrorCode::StateRead)?;
    let document: Document =
        serde_json::from_slice(&bytes).map_err(|_| StateErrorCode::StateCorrupt)?;
    if document.schema != 1 || document.revision == 0 || document.revision > MAX_REVISION {
        return Err(StateErrorCode::StateSchema);
    }
    Ok(document)
}

/// The reason an earlier file could not be imported, as stored in `error`.
fn import_error(code: StateErrorCode) -> &'static str {
    match code {
        StateErrorCode::StateTooLarge => "state-too-large",
        StateErrorCode::StateSchema => "state-schema",
        StateErrorCode::StateRead => "state-read",
        _ => "state-corrupt",
    }
}
pub(super) fn imported_error(stored: &str) -> StateErrorCode {
    match stored {
        "state-too-large" => StateErrorCode::StateTooLarge,
        "state-schema" => StateErrorCode::StateSchema,
        "state-read" => StateErrorCode::StateRead,
        _ => StateErrorCode::StateCorrupt,
    }
}
