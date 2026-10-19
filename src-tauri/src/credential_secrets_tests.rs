use super::*;
use std::fs;

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("plums-vault-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
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
    // Nothing but the file itself is left behind.
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn rejects_malformed_keys_and_keeps_a_damaged_file() {
    let fixture = Fixture::new();
    let vault = Vault::new(fixture.0.clone());
    for key in ["", "has space", "中文", &"k".repeat(4097)] {
        assert_eq!(vault.put("a", key), Err("invalid-key"));
    }
    assert!(!fixture.0.join("credential-secrets.json").exists());
    fs::write(fixture.0.join("credential-secrets.json"), "{").unwrap();
    assert_eq!(vault.get("a"), Err("corrupt"));
    assert_eq!(vault.put("a", "synthetic-key"), Err("corrupt"));
    assert_eq!(
        fs::read_to_string(fixture.0.join("credential-secrets.json")).unwrap(),
        "{"
    );
}
