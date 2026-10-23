//! Desktop key storage, and secret cleanup over the native store; cleanup
//! callers hold the binding ticket.
//!
//! Desktop keeps plaintext keys in an owner-only file, separate from ordinary
//! configuration. Same-user processes can read it; this is not a security
//! sandbox. No Keychain or signing identity is needed to read existing keys.
//! Keys are read natively and never reach a WebView response.
use crate::credential_bindings::Bindings;
use crate::credentials_native::delete_key;

/// What a stored key may be: 1–4096 printable ASCII bytes, no spaces.
pub(crate) fn key_valid(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.len() <= 4096 && bytes.iter().all(|c| (33..=126).contains(c))
}

#[cfg(not(target_os = "android"))]
pub use vault::Vault;
#[cfg(not(target_os = "android"))]
mod vault {
    use super::key_valid;
    use crate::credential_bindings::{persist, Failure};
    use serde::{Deserialize, Serialize};
    use std::{collections::BTreeMap, fs, io::Read, path::PathBuf};

    const FILE: &str = "credential-secrets.json";
    /// Room for every binding's key and the retired ones awaiting removal.
    const MAX_BYTES: usize = 1024 * 1024;

    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Saved {
        schema: u8,
        keys: BTreeMap<String, String>,
    }
    /// Keys by binding reference, in `credential-secrets.json`.
    pub struct Vault {
        root: PathBuf,
    }
    impl Vault {
        pub fn new(root: PathBuf) -> Self {
            Self { root }
        }
        fn load(&self) -> Result<Saved, Failure> {
            let file = match fs::File::open(self.root.join(FILE)) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(Saved {
                        schema: 1,
                        keys: BTreeMap::new(),
                    })
                }
                Err(_) => return Err("unavailable"),
            };
            private_file(&file)?;
            let mut bytes = Vec::new();
            file.take(MAX_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "unavailable")?;
            if bytes.len() > MAX_BYTES {
                return Err("corrupt");
            }
            let saved: Saved = serde_json::from_slice(&bytes).map_err(|_| "corrupt")?;
            if saved.schema != 1 || saved.keys.values().any(|key| !key_valid(key.as_bytes())) {
                return Err("corrupt");
            }
            Ok(saved)
        }
        fn update(
            &self,
            change: impl FnOnce(&mut BTreeMap<String, String>) -> Result<bool, Failure>,
        ) -> Result<(), Failure> {
            fs::create_dir_all(&self.root).map_err(|_| "unavailable")?;
            let mut options = fs::OpenOptions::new();
            options.read(true).write(true).create(true).truncate(false);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            // A separate, stable inode survives atomic replacement of the data
            // file. Closing releases the OS lock, including after process exit.
            let lock = options
                .open(self.root.join("credential-secrets.lock"))
                .map_err(|_| "unavailable")?;
            private_file(&lock)?;
            lock.lock().map_err(|_| "unavailable")?;
            // Reread only after acquiring the lock; multiple Vaults/processes
            // must not overwrite a completed update from another writer.
            let mut saved = self.load()?;
            if !change(&mut saved.keys)? {
                return Ok(());
            }
            let bytes = serde_json::to_vec(&saved).map_err(|_| "unknown")?;
            if bytes.len() > MAX_BYTES {
                return Err("resource-limit");
            }
            persist(&self.root, FILE, &bytes).map_err(|_| "unknown")
        }
        /// Saves the key of a new reference; references are never reused.
        pub fn put(&self, reference: &str, key: &str) -> Result<(), Failure> {
            if !key_valid(key.as_bytes()) {
                return Err("invalid-key");
            }
            self.update(|keys| {
                if keys.contains_key(reference) {
                    return Err("unknown");
                }
                keys.insert(reference.into(), key.into());
                Ok(true)
            })
        }
        pub fn get(&self, reference: &str) -> Result<Option<Vec<u8>>, Failure> {
            // Atomic rename gives readers a complete old or new snapshot.
            Ok(self
                .load()?
                .keys
                .get(reference)
                .map(|key| key.as_bytes().to_vec()))
        }
        /// Removes a key; a missing one counts as removed.
        pub fn remove(&self, reference: &str) -> Result<(), Failure> {
            self.update(|keys| Ok(keys.remove(reference).is_some()))
        }
    }
    fn private_file(file: &fs::File) -> Result<(), Failure> {
        let metadata = file.metadata().map_err(|_| "unavailable")?;
        if !metadata.is_file() {
            return Err("unavailable");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o777 != 0o600 {
                return Err("unavailable");
            }
        }
        Ok(())
    }
}

/// Delete secrets left by earlier entries once the new one is saved. Best
/// effort: a busy binding or failed deletion keeps the references, and the
/// next re-entry or revocation retries them.
pub(crate) async fn retire(
    app: tauri::AppHandle,
    bindings: &Bindings,
    owner: &str,
    alias: &str,
    revision: u64,
) {
    let Ok(ticket) = bindings.begin_action(owner, alias, revision) else {
        return;
    };
    let deleted = delete_all(app, &ticket.retired()).await;
    let _ = bindings.finish_retire(ticket, deleted);
}
/// References whose secrets are confirmed absent; missing items count as deleted.
pub(crate) async fn delete_all(app: tauri::AppHandle, references: &[String]) -> Vec<String> {
    let mut deleted = Vec::new();
    for reference in references {
        if delete_key(app.clone(), reference).await.is_ok() {
            deleted.push(reference.clone());
        }
    }
    deleted
}
#[cfg(test)]
#[path = "credential_secrets_tests.rs"]
mod tests;
