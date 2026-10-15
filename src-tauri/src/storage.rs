use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

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
    fn owner(owner: &str) -> Result<(), String> {
        if owner.is_empty()
            || owner.len() > 96
            || !owner
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
            || owner.contains("..")
        {
            return Err("Invalid state owner".into());
        }
        Ok(())
    }
    pub fn grant(&self, owner: &str, capabilities: Vec<String>) -> Result<(), String> {
        Self::owner(owner)?;
        if capabilities
            .iter()
            .any(|cap| !["state.read", "state.write", "platform.info"].contains(&cap.as_str()))
        {
            return Err("Unknown capability".into());
        }
        self.grants
            .lock()
            .map_err(|_| "Grant lock poisoned")?
            .insert(owner.into(), capabilities.into_iter().collect());
        Ok(())
    }
    fn read_unlocked(&self, owner: &str) -> Result<Option<Document>, String> {
        let path = self.root.join(format!("{owner}.json"));
        match fs::read(&path) {
            Ok(bytes) => {
                if bytes.len() > 65536 {
                    return Err("State exceeds experiment limit".into());
                }
                let document: Document = serde_json::from_slice(&bytes)
                    .map_err(|_| "State is corrupt; original preserved")?;
                if document.schema != 1
                    || document.revision == 0
                    || document.revision > 9_007_199_254_740_991
                {
                    return Err("Unsupported state schema; original preserved".into());
                }
                Ok(Some(document))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("State read failed; original preserved".into()),
        }
    }
    pub fn call(&self, owner: &str, capability: &str, payload: Value) -> Result<Value, String> {
        Self::owner(owner)?;
        let grants = self.grants.lock().map_err(|_| "Grant lock poisoned")?;
        if !grants
            .get(owner)
            .is_some_and(|caps| caps.contains(capability))
        {
            return Err(format!("Permission denied: {capability}"));
        }
        let _guard = self.io.lock().map_err(|_| "State lock poisoned")?;
        match capability {
            "platform.info" => Ok(
                serde_json::json!({ "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "storage": "isolated-experiment" }),
            ),
            "state.read" => {
                serde_json::to_value(self.read_unlocked(owner)?).map_err(|e| e.to_string())
            }
            "state.write" => {
                let expected = payload
                    .get("revision")
                    .and_then(Value::as_u64)
                    .ok_or("Missing state revision")?;
                let value = payload.get("value").ok_or("Missing state value")?;
                let current = self
                    .read_unlocked(owner)?
                    .map_or(0, |document| document.revision);
                if current >= 9_007_199_254_740_991 {
                    return Err("Revision limit reached".into());
                }
                if expected != current {
                    return Err("State revision conflict; reload before retry".into());
                }
                let revision = current.checked_add(1).ok_or("Revision limit reached")?;
                let document = Document {
                    schema: 1,
                    revision,
                    value: value.clone(),
                };
                let bytes = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
                if bytes.len() > 65536 {
                    return Err("State exceeds experiment limit".into());
                }
                fs::create_dir_all(&self.root).map_err(|_| "State directory unavailable")?;
                let path = self.root.join(format!("{owner}.json"));
                let temporary = self.root.join(format!("{owner}.pending"));
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)
                    .map_err(|_| "State temporary file unavailable; original preserved")?;
                let result = file
                    .write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .and_then(|_| fs::rename(&temporary, &path));
                if result.is_err() {
                    let _ = fs::remove_file(&temporary);
                    return Err("State write failed; original preserved".into());
                }
                serde_json::to_value(document).map_err(|e| e.to_string())
            }
            _ => Err("Unknown capability".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };
    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "plums-test-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn broker(&self) -> Broker {
            let broker = Broker::new(self.0.clone());
            broker
                .grant("sample", vec!["state.read".into(), "state.write".into()])
                .unwrap();
            broker
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn round_trip_and_restart_preserve_revision() {
        let fixture = Fixture::new();
        let broker = fixture.broker();
        assert_eq!(
            broker.call("sample", "state.read", Value::Null).unwrap(),
            Value::Null
        );
        broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":{"text":"first"}}),
            )
            .unwrap();
        let restarted = fixture.broker();
        let saved = restarted.call("sample", "state.read", Value::Null).unwrap();
        assert_eq!(saved["value"]["text"], "first");
        assert_eq!(saved["revision"], 1);
    }
    #[test]
    fn denied_and_revoked_calls_do_not_write() {
        let fixture = Fixture::new();
        let broker = Broker::new(fixture.0.clone());
        assert!(broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":1})
            )
            .unwrap_err()
            .contains("Permission denied"));
        broker.grant("sample", vec!["state.write".into()]).unwrap();
        broker.grant("sample", vec![]).unwrap();
        assert!(broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":1})
            )
            .is_err());
        assert!(!fixture.0.join("sample.json").exists());
    }
    #[test]
    fn corrupt_and_future_schema_files_are_not_overwritten() {
        let fixture = Fixture::new();
        let broker = fixture.broker();
        let path = fixture.0.join("sample.json");
        for original in ["{broken", "{\"schema\":99,\"revision\":1,\"value\":4}"] {
            fs::write(&path, original).unwrap();
            assert!(broker.call("sample", "state.read", Value::Null).is_err());
            assert!(broker
                .call(
                    "sample",
                    "state.write",
                    serde_json::json!({"revision":0,"value":"lost"})
                )
                .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
        }
    }
    #[test]
    fn stale_revision_and_failed_temporary_file_preserve_prior_state() {
        let fixture = Fixture::new();
        let broker = fixture.broker();
        broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":"saved"}),
            )
            .unwrap();
        assert!(broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":"stale"})
            )
            .unwrap_err()
            .contains("conflict"));
        fs::create_dir(fixture.0.join("sample.pending")).unwrap();
        assert!(broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":1,"value":"failed"})
            )
            .is_err());
        assert_eq!(
            broker.call("sample", "state.read", Value::Null).unwrap()["value"],
            "saved"
        );
    }
    #[test]
    fn rejects_path_escape_and_cross_owner_access() {
        let fixture = Fixture::new();
        let broker = fixture.broker();
        assert!(broker.grant("../escape", vec![]).is_err());
        assert!(broker.call("other", "state.read", Value::Null).is_err());
    }
    #[test]
    fn two_authorized_namespaces_do_not_share_state() {
        let fixture = Fixture::new();
        let broker = fixture.broker();
        for owner in ["host.shell", "extension.host.shell"] {
            broker
                .grant(owner, vec!["state.read".into(), "state.write".into()])
                .unwrap();
        }
        broker
            .call(
                "host.shell",
                "state.write",
                serde_json::json!({"revision":0,"value":"shell"}),
            )
            .unwrap();
        assert_eq!(
            broker
                .call("extension.host.shell", "state.read", Value::Null)
                .unwrap(),
            Value::Null
        );
        broker
            .call(
                "extension.host.shell",
                "state.write",
                serde_json::json!({"revision":0,"value":"extension"}),
            )
            .unwrap();
        assert_eq!(
            broker
                .call("host.shell", "state.read", Value::Null)
                .unwrap()["value"],
            "shell"
        );
        assert_eq!(
            broker
                .call("extension.host.shell", "state.read", Value::Null)
                .unwrap()["value"],
            "extension"
        );
    }
}
