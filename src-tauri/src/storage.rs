use crate::ipc::wire_enum;
use rusqlite::{
    params, Connection, ErrorCode, OptionalExtension, Transaction, TransactionBehavior,
};
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
    InvalidBatch => "invalid-batch",
    InvalidCollection => "invalid-collection",
    InvalidRecord => "invalid-record",
    InvalidQuery => "invalid-query",
}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub schema: u32,
    pub revision: u64,
    pub value: Value,
}

/// Largest stored document, envelope included.
const MAX_DOCUMENT: usize = 1 << 20;
/// Largest record's value and text: one chat message with its pictures.
const MAX_RECORD: usize = 8 << 20;
/// Values and text one `records.list` or `records.search` page returns.
const MAX_PAGE_BYTES: usize = 16 << 20;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
/// Writes in one `state.batch`, and the value and text bytes they may carry.
const MAX_BATCH_OPERATIONS: usize = 1000;
const MAX_BATCH_BYTES: usize = 16 << 20;

/// Owner-scoped documents and records, one SQLite database per owner under `root/state/`.
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
                "state.batch",
                "records.list",
                "records.search",
                "platform.info",
                "link.open",
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
        if capability == "platform.info" {
            return Ok(
                serde_json::json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "storage": "isolated-experiment" }),
            );
        }
        // Validate before opening, so a bad request never creates storage.
        let request = Request::parse(capability, &payload)?;
        let mut databases = self.databases()?;
        let database = self.open(&mut databases, owner)?;
        request.run(database)
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
            2 => {}
            1 => records::upgrade(&mut connection)?,
            0 => {
                let imported = self.create(&mut connection, owner)?;
                legacy::back_up(&self.root, &imported);
            }
            _ => return Err(StateErrorCode::StateSchema),
        }
        Ok(connection)
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
            .execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS documents (
                    key TEXT PRIMARY KEY NOT NULL,
                    revision INTEGER NOT NULL,
                    value TEXT,
                    error TEXT
                ) STRICT;
                {}
                PRAGMA user_version = 2;",
                records::SCHEMA
            ))
            .map_err(|_| StateErrorCode::StateWrite)?;
        let imported = legacy::import(&transaction, &self.root, owner)?;
        transaction.commit().map_err(commit_failure)?;
        Ok(imported)
    }
}

fn valid_key(key: &str) -> bool {
    (1..=64).contains(&key.len())
        && key.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && key
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
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
        Some((_, _, Some(error))) => Err(legacy::imported_error(&error)),
        Some((revision, Some(value), None)) => Ok(Some(Document {
            schema: 1,
            revision: u64::try_from(revision).map_err(|_| StateErrorCode::StateCorrupt)?,
            value: serde_json::from_str(&value).map_err(|_| StateErrorCode::StateCorrupt)?,
        })),
        Some((_, None, None)) => Err(StateErrorCode::StateCorrupt),
    }
}

/// A state call checked before its database is opened.
enum Request {
    Read(String),
    Write(DocumentWrite),
    Batch(records::Batch),
    List(records::List),
    Search(records::Search),
}

impl Request {
    fn parse(capability: &str, payload: &Value) -> Result<Self, StateErrorCode> {
        Ok(match capability {
            "state.read" => Self::Read(key(payload)?),
            "state.write" => Self::Write(DocumentWrite::parse(payload)?),
            "state.batch" => Self::Batch(records::Batch::parse(payload)?),
            "records.list" => Self::List(records::List::parse(payload)?),
            "records.search" => Self::Search(records::Search::parse(payload)?),
            _ => return Err(StateErrorCode::UnknownCapability),
        })
    }
    fn run(self, connection: &mut Connection) -> Result<Value, StateErrorCode> {
        let document = match self {
            Self::Read(key) => current(connection, &key)?,
            Self::Write(write) => {
                let transaction = connection
                    .transaction_with_behavior(TransactionBehavior::Immediate)
                    .map_err(|_| StateErrorCode::StateWrite)?;
                let document = write.apply(&transaction)?;
                transaction.commit().map_err(commit_failure)?;
                document
            }
            Self::Batch(batch) => return batch.apply(connection),
            Self::List(list) => return list.run(connection),
            Self::Search(search) => return search.run(connection),
        };
        serde_json::to_value(document).map_err(|_| StateErrorCode::Serialization)
    }
}

/// The document key: `""` for the owner's main document.
fn key(payload: &Value) -> Result<String, StateErrorCode> {
    match payload.get("key") {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(key)) if valid_key(key) => Ok(key.clone()),
        Some(_) => Err(StateErrorCode::InvalidKey),
    }
}

/// A checked document write or, without a value, removal.
struct DocumentWrite {
    key: String,
    revision: u64,
    value: Option<Value>,
}

impl DocumentWrite {
    fn parse(payload: &Value) -> Result<Self, StateErrorCode> {
        let key = key(payload)?;
        let revision = payload
            .get("revision")
            .and_then(Value::as_u64)
            .ok_or(StateErrorCode::MissingRevision)?;
        let value = if payload.get("remove") == Some(&Value::Bool(true)) {
            None
        } else {
            Some(
                payload
                    .get("value")
                    .ok_or(StateErrorCode::MissingValue)?
                    .clone(),
            )
        };
        Ok(Self {
            key,
            revision,
            value,
        })
    }
    /// The bytes of the value this write stores.
    fn size(&self) -> usize {
        self.value
            .as_ref()
            .map_or(0, |value| value.to_string().len())
    }
    /// Applies the write in `transaction`: the stored document, or `None` once removed.
    fn apply(self, transaction: &Transaction) -> Result<Option<Document>, StateErrorCode> {
        let current = current(transaction, &self.key)?.map_or(0, |document| document.revision);
        if self.revision != current {
            return Err(StateErrorCode::RevisionConflict);
        }
        let Some(value) = self.value else {
            transaction
                .execute("DELETE FROM documents WHERE key = ?1", params![self.key])
                .map_err(|_| StateErrorCode::StateWrite)?;
            return Ok(None);
        };
        if current >= MAX_REVISION {
            return Err(StateErrorCode::RevisionLimit);
        }
        let document = Document {
            schema: 1,
            revision: current + 1,
            value,
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
                params![self.key, document.revision as i64, document.value.to_string()],
            )
            .map_err(|_| StateErrorCode::StateWrite)?;
        Ok(Some(document))
    }
}

/// An I/O failure while committing may have reached the disk or not.
fn commit_failure(error: rusqlite::Error) -> StateErrorCode {
    match error.sqlite_error_code() {
        Some(ErrorCode::SystemIoFailure) => StateErrorCode::StateSync,
        _ => StateErrorCode::StateWrite,
    }
}

#[path = "storage_legacy.rs"]
mod legacy;
#[path = "storage_records.rs"]
mod records;

#[cfg(test)]
#[path = "storage_keyed_tests.rs"]
mod keyed_tests;
#[cfg(test)]
#[path = "storage_records_tests.rs"]
mod records_tests;
#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
