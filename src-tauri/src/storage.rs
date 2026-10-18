use crate::ipc::wire_enum;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

wire_enum! {
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum StateErrorCode {
    InvalidOwner => "invalid-owner",
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
    fn owner(owner: &str) -> Result<(), StateErrorCode> {
        if owner.is_empty()
            || owner.len() > 96
            || !owner
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
            || owner.contains("..")
        {
            return Err(StateErrorCode::InvalidOwner);
        }
        Ok(())
    }
    pub fn validate_grant(owner: &str, capabilities: &[String]) -> Result<(), StateErrorCode> {
        Self::owner(owner)?;
        if capabilities.iter().any(|cap| {
            ![
                "state.read",
                "state.write",
                "platform.info",
                "document.read",
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
    fn read_unlocked(&self, owner: &str) -> Result<Option<Document>, StateErrorCode> {
        let path = self.root.join(format!("{owner}.json"));
        match fs::read(&path) {
            Ok(bytes) => {
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
        match capability {
            "platform.info" => Ok(
                serde_json::json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "storage": "isolated-experiment" }),
            ),
            "state.read" => serde_json::to_value(self.read_unlocked(owner)?)
                .map_err(|_| StateErrorCode::Serialization),
            "state.write" => {
                let expected = payload
                    .get("revision")
                    .and_then(Value::as_u64)
                    .ok_or(StateErrorCode::MissingRevision)?;
                let value = payload.get("value").ok_or(StateErrorCode::MissingValue)?;
                let current = self
                    .read_unlocked(owner)?
                    .map_or(0, |document| document.revision);
                if current >= 9_007_199_254_740_991 {
                    return Err(StateErrorCode::RevisionLimit);
                }
                if expected != current {
                    return Err(StateErrorCode::RevisionConflict);
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
                commit(&self.root, owner, &bytes)?;
                serde_json::to_value(document).map_err(|_| StateErrorCode::Serialization)
            }
            _ => Err(StateErrorCode::UnknownCapability),
        }
    }
}

/// Writes `{owner}.json` through a temporary file unique to this write, so an
/// interrupted write cannot block later ones and concurrent writers never
/// commit each other's file.
fn commit(root: &Path, owner: &str, bytes: &[u8]) -> Result<(), StateErrorCode> {
    let path = root.join(format!("{owner}.json"));
    let temporary = root.join(format!("{owner}.{}.pending", uuid::Uuid::new_v4()));
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
    Ok(())
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
