use super::*;
use std::fs;

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("plums-vault-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn write(&self, text: &str) {
        crate::credential_bindings::persist(&self.0, "credential-secrets.json", text.as_bytes())
            .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn keys_live_in_a_file_only_this_user_can_read() {
    let fixture = Fixture::new();
    let vault = Vault::new(fixture.0.clone());
    assert_eq!(vault.get("a").unwrap(), None);
    vault.put("a", "synthetic-key-a").unwrap();
    vault.put("b", "synthetic-key-b").unwrap();
    // A reference is never reused for another key.
    assert_eq!(vault.put("a", "other"), Err("unknown"));
    let restarted = Vault::new(fixture.0.clone());
    assert_eq!(restarted.get("a").unwrap().unwrap(), b"synthetic-key-a");
    restarted.remove("a").unwrap();
    restarted.remove("a").unwrap();
    assert_eq!(restarted.get("a").unwrap(), None);
    assert_eq!(restarted.get("b").unwrap().unwrap(), b"synthetic-key-b");
    let path = fixture.0.join("credential-secrets.json");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    // The stable lock file is not unlinked: otherwise waiters could lock a
    // different inode. No pending file containing secret bytes remains.
    assert!(fs::read_dir(&fixture.0).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".pending")));
}

#[test]
fn rejects_malformed_keys_and_keeps_a_damaged_file() {
    let fixture = Fixture::new();
    let vault = Vault::new(fixture.0.clone());
    for key in ["", "has space", "中文", &"k".repeat(4097)] {
        assert_eq!(vault.put("a", key), Err("invalid-key"));
    }
    assert!(!fixture.0.join("credential-secrets.json").exists());
    fixture.write("{");
    assert_eq!(vault.get("a"), Err("corrupt"));
    assert_eq!(vault.put("a", "synthetic-key"), Err("corrupt"));
    assert_eq!(
        fs::read_to_string(fixture.0.join("credential-secrets.json")).unwrap(),
        "{"
    );
}

#[test]
fn preserves_existing_format_references_and_rejects_bad_entries_without_overwriting() {
    let fixture = Fixture::new();
    let original = r#"{"schema":1,"keys":{"existing-reference":"synthetic-old"}}"#;
    fixture.write(original);
    let vault = Vault::new(fixture.0.clone());
    assert_eq!(
        vault.get("existing-reference").unwrap().unwrap(),
        b"synthetic-old"
    );
    assert_eq!(
        fs::read_to_string(fixture.0.join("credential-secrets.json")).unwrap(),
        original
    );
    vault.put("new-reference", "synthetic-new").unwrap();
    assert_eq!(
        vault.get("existing-reference").unwrap().unwrap(),
        b"synthetic-old"
    );
    for bad in [
        r#"{"schema":2,"keys":{}}"#,
        r#"{"schema":1,"keys":{"a":"invalid key"}}"#,
        r#"{"schema":1,"keys":{"a":""}}"#,
        r#"{"schema":1,"keys":{},"extra":true}"#,
    ] {
        fixture.write(bad);
        assert_eq!(vault.get("a"), Err("corrupt"));
        assert_eq!(vault.put("b", "synthetic-b"), Err("corrupt"));
        assert_eq!(vault.remove("a"), Err("corrupt"));
        assert_eq!(
            fs::read_to_string(fixture.0.join("credential-secrets.json")).unwrap(),
            bad
        );
    }
}

#[cfg(unix)]
#[test]
fn refuses_overly_broad_permissions_without_reading_or_replacing_secrets() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    fixture.write(r#"{"schema":1,"keys":{"a":"synthetic-a"}}"#);
    let path = fixture.0.join("credential-secrets.json");
    let before = fs::read(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let vault = Vault::new(fixture.0.clone());
    assert_eq!(vault.get("a"), Err("unavailable"));
    assert_eq!(vault.put("b", "synthetic-b"), Err("unavailable"));
    assert_eq!(vault.remove("a"), Err("unavailable"));
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[test]
fn waits_for_the_file_lock_then_rereads_before_updating() {
    use std::{sync::mpsc, thread, time::Duration};
    let fixture = Fixture::new();
    let lock = fs::File::create(fixture.0.join("credential-secrets.lock")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        lock.set_permissions(fs::Permissions::from_mode(0o600))
            .unwrap();
    }
    lock.lock().unwrap();
    let root = fixture.0.clone();
    let (started, start) = mpsc::channel();
    let (done, result) = mpsc::channel();
    let worker = thread::spawn(move || {
        started.send(()).unwrap();
        let outcome = Vault::new(root).put("second", "synthetic-second");
        done.send(outcome).unwrap();
    });
    start.recv().unwrap();
    let blocked = result.recv_timeout(Duration::from_millis(150)).is_err();
    fixture.write(r#"{"schema":1,"keys":{"first":"synthetic-first"}}"#);
    drop(lock);
    worker.join().unwrap();
    assert!(
        blocked,
        "write completed while another handle held the file lock"
    );
    assert_eq!(result.recv().unwrap(), Ok(()));
    let vault = Vault::new(fixture.0.clone());
    assert_eq!(vault.get("first").unwrap().unwrap(), b"synthetic-first");
    assert_eq!(vault.get("second").unwrap().unwrap(), b"synthetic-second");
}

#[test]
fn independent_writers_do_not_lose_keys() {
    let fixture = Fixture::new();
    std::thread::scope(|scope| {
        for index in 0..8 {
            let root = fixture.0.clone();
            scope.spawn(move || {
                let vault = Vault::new(root);
                for key in 0..4 {
                    vault
                        .put(&format!("{index}-{key}"), "synthetic-key")
                        .unwrap();
                }
            });
        }
    });
    let vault = Vault::new(fixture.0.clone());
    for index in 0..8 {
        for key in 0..4 {
            assert_eq!(
                vault.get(&format!("{index}-{key}")).unwrap().unwrap(),
                b"synthetic-key"
            );
        }
    }
}
