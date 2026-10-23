use crate::ipc::wire_enum;
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, SystemTime},
};

wire_enum! {
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum StateErrorCode {
    InvalidOwner => "invalid-owner",
    InvalidKey => "invalid-key",
    UnknownCapability => "unknown-capability",
    GrantLock => "grant-lock",
    GrantUnavailable => "grant-unavailable",
    StateLock => "state-lock",
    StateTooLarge => "state-too-large",
    StateCorrupt => "state-corrupt",
    StateSchema => "state-schema",
    StateRead => "state-read",
    MissingRevision => "missing-revision",
    MissingValue => "missing-value",
    RevisionLimit => "revision-limit",
    RevisionConflict => "revision-conflict",
    StateDirectory => "state-directory",
    StateWrite => "state-write",
    StateSync => "state-sync",
    PermissionDenied => "permission-denied",
    Serialization => "serialization",
}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub schema: u32,
    pub revision: u64,
    pub value: Value,
}

/// Largest stored document, envelope included, as in the JSON files before SQLite.
const MAX_DOCUMENT: usize = 65536;
const MAX_REVISION: u64 = 9_007_199_254_740_991;

/// Owner-scoped documents, one SQLite database per owner under `root/state/`.
pub struct Broker {
    root: PathBuf,
    grants: Mutex<HashMap<String, HashSet<String>>>,
    /// Open databases by owner; the lock also serializes every state call.
    databases: Mutex<HashMap<String, Connection>>,
}

impl Broker {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            grants: Mutex::new(HashMap::new()),
            databases: Mutex::new(HashMap::new()),
        }
    }
    /// Owners are the shell or `extension.<id>`, so no owner can name a file
    /// that another native store keeps in the same directory.
    fn owner(owner: &str) -> Result<(), StateErrorCode> {
        let valid_id = |id: &str| {
            id.len() <= 64
                && id.starts_with(|c: char| c.is_ascii_lowercase())
                && id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
                && !id.contains("..")
        };
        if owner == "host.shell" || owner.strip_prefix("extension.").is_some_and(valid_id) {
            return Ok(());
        }
        Err(StateErrorCode::InvalidOwner)
    }
    /// Remove temporary files that an interrupted credential write left in the
    /// data root. Run at startup, with an age margin in case another process still writes.
    pub fn sweep(&self, older_than: Duration) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        let cutoff = SystemTime::now().checked_sub(older_than);
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .is_ok_and(|modified| cutoff.is_some_and(|cutoff| modified < cutoff));
            if stale && entry.file_name().to_string_lossy().ends_with(".pending") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    pub fn validate_grant(owner: &str, capabilities: &[String]) -> Result<(), StateErrorCode> {
        Self::owner(owner)?;
        if capabilities.iter().any(|cap| {
            ![
                "state.read",
                "state.write",
                "platform.info",
                "document.read",
                "credential.request",
                "credential.connect",
                "network.read",
            ]
            .contains(&cap.as_str())
        }) {
            return Err(StateErrorCode::UnknownCapability);
        }
        Ok(())
    }
    pub fn grant(&self, owner: &str, capabilities: Vec<String>) -> Result<(), StateErrorCode> {
        Self::validate_grant(owner, &capabilities)?;
        self.grants
            .lock()
            .map_err(|_| StateErrorCode::GrantLock)?
            .insert(owner.into(), capabilities.into_iter().collect());
        Ok(())
    }
    pub fn allows(&self, owner: &str, capability: &str) -> bool {
        self.grants.lock().is_ok_and(|grants| {
            grants
                .get(owner)
                .is_some_and(|caps| caps.contains(capability))
        })
    }
    /// The document key: `""` for the owner's main document.
    fn key(payload: &Value) -> Result<String, StateErrorCode> {
        match payload.get("key") {
            None | Some(Value::Null) => Ok(String::new()),
            Some(Value::String(key)) if valid_key(key) => Ok(key.clone()),
            Some(_) => Err(StateErrorCode::InvalidKey),
        }
    }
    pub fn call(
        &self,
        owner: &str,
        capability: &str,
        payload: Value,
    ) -> Result<Value, StateErrorCode> {
        Self::owner(owner)?;
        if !self.allows(owner, capability) {
            return Err(StateErrorCode::PermissionDenied);
        }
        match capability {
            "platform.info" => {
                return Ok(
                    serde_json::json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "storage": "isolated-experiment" }),
                )
            }
            "state.read" | "state.write" => {}
            _ => return Err(StateErrorCode::UnknownCapability),
        }
        // Validate before opening, so a bad request never creates storage.
        let key = Self::key(&payload)?;
        let mut databases = self.databases()?;
        let database = self.open(&mut databases, owner)?;
        if capability == "state.read" {
            return serde_json::to_value(read(database, &key)?)
                .map_err(|_| StateErrorCode::Serialization);
        }
        write(database, &key, &payload)
    }
    fn databases(&self) -> Result<MutexGuard<'_, HashMap<String, Connection>>, StateErrorCode> {
        self.databases.lock().map_err(|_| StateErrorCode::StateLock)
    }
    fn open<'a>(
        &self,
        databases: &'a mut HashMap<String, Connection>,
        owner: &str,
    ) -> Result<&'a mut Connection, StateErrorCode> {
        if !databases.contains_key(owner) {
            let connection = self.connect(owner)?;
            databases.insert(owner.into(), connection);
        }
        databases.get_mut(owner).ok_or(StateErrorCode::StateLock)
    }
    fn connect(&self, owner: &str) -> Result<Connection, StateErrorCode> {
        let directory = self.root.join("state");
        fs::create_dir_all(&directory).map_err(|_| StateErrorCode::StateDirectory)?;
        let mut connection = Connection::open(directory.join(format!("{owner}.sqlite3")))
            .map_err(|_| StateErrorCode::StateRead)?;
        // WAL with full sync: a committed write survives a crash or power loss.
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .and_then(|_| connection.pragma_update(None, "synchronous", "FULL"))
            .and_then(|_| connection.busy_timeout(Duration::from_secs(5)))
            .map_err(|_| StateErrorCode::StateRead)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| StateErrorCode::StateRead)?;
        match version {
            1 => Ok(connection),
            0 => {
                let imported = self.create(&mut connection, owner)?;
                self.back_up(&imported);
                Ok(connection)
            }
            _ => Err(StateErrorCode::StateSchema),
        }
    }
    /// Creates the schema and, in the same transaction, imports the owner's
    /// documents from the JSON files used before SQLite. Returns those files.
    fn create(
        &self,
        connection: &mut Connection,
        owner: &str,
    ) -> Result<Vec<PathBuf>, StateErrorCode> {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StateErrorCode::StateWrite)?;
        // `error` keeps an earlier file that could not be read unreadable,
        // instead of letting it look empty and be overwritten.
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS documents (
                    key TEXT PRIMARY KEY NOT NULL,
                    revision INTEGER NOT NULL,
                    value TEXT,
                    error TEXT
                ) STRICT;
                PRAGMA user_version = 1;",
            )
            .map_err(|_| StateErrorCode::StateWrite)?;
        let mut imported = Vec::new();
        for (key, path) in legacy_documents(&self.root, owner) {
            let (revision, value, error) = match legacy_document(&path) {
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
        transaction.commit().map_err(commit_failure)?;
        Ok(imported)
    }
    /// Moves imported files to `legacy-json/`; one left behind is harmless,
    /// since only a new database imports.
    fn back_up(&self, files: &[PathBuf]) {
        if files.is_empty() {
            return;
        }
        let backup = self.root.join("legacy-json");
        if fs::create_dir_all(&backup).is_err() {
            return;
        }
        for file in files {
            if let Some(name) = file.file_name() {
                let _ = fs::rename(file, backup.join(name));
            }
        }
    }
}

fn valid_key(key: &str) -> bool {
    (1..=64).contains(&key.len())
        && key.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && key
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// The owner's earlier `<owner>.json` and `<owner>+<key>.json` files, by key.
fn legacy_documents(root: &Path, owner: &str) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let keyed = format!("{owner}+");
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stem = name.strip_suffix(".json")?;
            let key = if stem == owner {
                String::new()
            } else {
                stem.strip_prefix(&keyed)
                    .filter(|key| valid_key(key))?
                    .into()
            };
            Some((key, entry.path()))
        })
        .collect()
}

fn legacy_document(path: &Path) -> Result<Document, StateErrorCode> {
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
fn imported_error(stored: &str) -> StateErrorCode {
    match stored {
        "state-too-large" => StateErrorCode::StateTooLarge,
        "state-schema" => StateErrorCode::StateSchema,
        "state-read" => StateErrorCode::StateRead,
        _ => StateErrorCode::StateCorrupt,
    }
}

/// The stored document at `key`, or the error an unreadable import recorded.
fn current(connection: &Connection, key: &str) -> Result<Option<Document>, StateErrorCode> {
    let row: Option<(i64, Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT revision, value, error FROM documents WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| StateErrorCode::StateRead)?;
    match row {
        None => Ok(None),
        Some((_, _, Some(error))) => Err(imported_error(&error)),
        Some((revision, Some(value), None)) => Ok(Some(Document {
            schema: 1,
            revision: u64::try_from(revision).map_err(|_| StateErrorCode::StateCorrupt)?,
            value: serde_json::from_str(&value).map_err(|_| StateErrorCode::StateCorrupt)?,
        })),
        Some((_, None, None)) => Err(StateErrorCode::StateCorrupt),
    }
}

fn read(connection: &Connection, key: &str) -> Result<Option<Document>, StateErrorCode> {
    current(connection, key)
}

fn write(connection: &mut Connection, key: &str, payload: &Value) -> Result<Value, StateErrorCode> {
    let expected = payload
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or(StateErrorCode::MissingRevision)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| StateErrorCode::StateWrite)?;
    let current = current(&transaction, key)?.map_or(0, |document| document.revision);
    if expected != current {
        return Err(StateErrorCode::RevisionConflict);
    }
    if payload.get("remove") == Some(&Value::Bool(true)) {
        if current > 0 {
            transaction
                .execute("DELETE FROM documents WHERE key = ?1", params![key])
                .map_err(|_| StateErrorCode::StateWrite)?;
            transaction.commit().map_err(commit_failure)?;
        }
        return Ok(Value::Null);
    }
    let value = payload.get("value").ok_or(StateErrorCode::MissingValue)?;
    if current >= MAX_REVISION {
        return Err(StateErrorCode::RevisionLimit);
    }
    let document = Document {
        schema: 1,
        revision: current + 1,
        value: value.clone(),
    };
    let size = serde_json::to_vec(&document)
        .map_err(|_| StateErrorCode::Serialization)?
        .len();
    if size > MAX_DOCUMENT {
        return Err(StateErrorCode::StateTooLarge);
    }
    transaction
        .execute(
            "INSERT INTO documents (key, revision, value, error) VALUES (?1, ?2, ?3, NULL)
             ON CONFLICT (key) DO UPDATE SET revision = excluded.revision, value = excluded.value",
            params![key, document.revision as i64, value.to_string()],
        )
        .map_err(|_| StateErrorCode::StateWrite)?;
    transaction.commit().map_err(commit_failure)?;
    serde_json::to_value(document).map_err(|_| StateErrorCode::Serialization)
}

/// An I/O failure while committing may have reached the disk or not.
fn commit_failure(error: rusqlite::Error) -> StateErrorCode {
    match error.sqlite_error_code() {
        Some(ErrorCode::SystemIoFailure) => StateErrorCode::StateSync,
        _ => StateErrorCode::StateWrite,
    }
}

#[cfg(test)]
#[path = "storage_keyed_tests.rs"]
mod keyed_tests;
#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
