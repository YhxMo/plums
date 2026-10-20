use crate::ipc::wire_enum;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
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
    StateTemporary => "state-temporary",
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

pub struct Broker {
    root: PathBuf,
    grants: Mutex<HashMap<String, HashSet<String>>>,
    io: Mutex<()>,
}

impl Broker {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            grants: Mutex::new(HashMap::new()),
            io: Mutex::new(()),
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
    /// Remove temporary files abandoned by an interrupted write. Run at startup,
    /// before any write, with an age margin in case another process still writes.
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
    /// File stem for an owner's main document or one of its keyed documents.
    /// `+` never occurs in owners or keys, so stems cannot collide.
    fn stem(owner: &str, payload: &Value) -> Result<String, StateErrorCode> {
        match payload.get("key") {
            None | Some(Value::Null) => Ok(owner.into()),
            Some(Value::String(key))
                if (1..=64).contains(&key.len())
                    && key.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                    && key
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') =>
            {
                Ok(format!("{owner}+{key}"))
            }
            Some(_) => Err(StateErrorCode::InvalidKey),
        }
    }
    fn read_unlocked(&self, stem: &str) -> Result<Option<Document>, StateErrorCode> {
        let path = self.root.join(format!("{stem}.json"));
        match fs::metadata(&path).and_then(|meta| {
            if meta.len() > 65536 {
                return Ok(None);
            }
            fs::read(&path).map(Some)
        }) {
            Ok(None) => Err(StateErrorCode::StateTooLarge),
            Ok(Some(bytes)) => {
                if bytes.len() > 65536 {
                    return Err(StateErrorCode::StateTooLarge);
                }
                let document: Document =
                    serde_json::from_slice(&bytes).map_err(|_| StateErrorCode::StateCorrupt)?;
                if document.schema != 1
                    || document.revision == 0
                    || document.revision > 9_007_199_254_740_991
                {
                    return Err(StateErrorCode::StateSchema);
                }
                Ok(Some(document))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(StateErrorCode::StateRead),
        }
    }
    pub fn call(
        &self,
        owner: &str,
        capability: &str,
        payload: Value,
    ) -> Result<Value, StateErrorCode> {
        Self::owner(owner)?;
        let grants = self.grants.lock().map_err(|_| StateErrorCode::GrantLock)?;
        if !grants
            .get(owner)
            .is_some_and(|caps| caps.contains(capability))
        {
            return Err(StateErrorCode::PermissionDenied);
        }
        let _guard = self.io.lock().map_err(|_| StateErrorCode::StateLock)?;
        let stem = || Self::stem(owner, &payload);
        match capability {
            "platform.info" => Ok(
                serde_json::json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "storage": "isolated-experiment" }),
            ),
            "state.read" => serde_json::to_value(self.read_unlocked(&stem()?)?)
                .map_err(|_| StateErrorCode::Serialization),
            "state.write" => {
                let stem = stem()?;
                let expected = payload
                    .get("revision")
                    .and_then(Value::as_u64)
                    .ok_or(StateErrorCode::MissingRevision)?;
                let current = self
                    .read_unlocked(&stem)?
                    .map_or(0, |document| document.revision);
                if expected != current {
                    return Err(StateErrorCode::RevisionConflict);
                }
                if payload.get("remove") == Some(&Value::Bool(true)) {
                    if current > 0 {
                        fs::remove_file(self.root.join(format!("{stem}.json")))
                            .map_err(|_| StateErrorCode::StateWrite)?;
                        sync_directory(&self.root)?;
                    }
                    return Ok(Value::Null);
                }
                let value = payload.get("value").ok_or(StateErrorCode::MissingValue)?;
                if current >= 9_007_199_254_740_991 {
                    return Err(StateErrorCode::RevisionLimit);
                }
                let revision = current
                    .checked_add(1)
                    .ok_or(StateErrorCode::RevisionLimit)?;
                let document = Document {
                    schema: 1,
                    revision,
                    value: value.clone(),
                };
                let bytes =
                    serde_json::to_vec(&document).map_err(|_| StateErrorCode::Serialization)?;
                if bytes.len() > 65536 {
                    return Err(StateErrorCode::StateTooLarge);
                }
                fs::create_dir_all(&self.root).map_err(|_| StateErrorCode::StateDirectory)?;
                commit(&self.root, &stem, &bytes)?;
                serde_json::to_value(document).map_err(|_| StateErrorCode::Serialization)
            }
            _ => Err(StateErrorCode::UnknownCapability),
        }
    }
}

/// Writes `{stem}.json` through a temporary file unique to this write, so an
/// interrupted write cannot block later ones and concurrent writers never
/// commit each other's file. The directory is synced so the rename survives
/// power loss.
fn commit(root: &Path, stem: &str, bytes: &[u8]) -> Result<(), StateErrorCode> {
    let path = root.join(format!("{stem}.json"));
    let temporary = root.join(format!("{stem}.{}.pending", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| StateErrorCode::StateTemporary)?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temporary, &path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(StateErrorCode::StateWrite);
    }
    sync_directory(root)
}

#[cfg(unix)]
fn sync_directory(root: &Path) -> Result<(), StateErrorCode> {
    // The file is already in place; a failed directory sync leaves durability unknown.
    fs::File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| StateErrorCode::StateSync)
}
#[cfg(not(unix))]
fn sync_directory(_root: &Path) -> Result<(), StateErrorCode> {
    Ok(())
}

#[cfg(test)]
#[path = "storage_keyed_tests.rs"]
mod keyed_tests;
#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
