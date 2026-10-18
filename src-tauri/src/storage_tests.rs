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
    assert!(
        broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":1})
            )
            .unwrap_err()
            == StateErrorCode::PermissionDenied
    );
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
    assert!(
        broker
            .call(
                "sample",
                "state.write",
                serde_json::json!({"revision":0,"value":"stale"})
            )
            .unwrap_err()
            == StateErrorCode::RevisionConflict
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // A read-only directory rejects the temporary file; the original stays.
        let mode = |bits| fs::Permissions::from_mode(bits);
        fs::set_permissions(&fixture.0, mode(0o555)).unwrap();
        // Privileged runs (for example root) bypass the mode; skip rather than misreport.
        let enforced = fs::write(fixture.0.join("probe"), "").is_err();
        let failed = enforced.then(|| {
            broker.call(
                "sample",
                "state.write",
                serde_json::json!({"revision":1,"value":"failed"}),
            )
        });
        fs::set_permissions(&fixture.0, mode(0o755)).unwrap();
        if let Some(failed) = failed {
            assert!(failed.is_err());
        }
    }
    assert_eq!(
        broker.call("sample", "state.read", Value::Null).unwrap()["value"],
        "saved"
    );
}
#[test]
fn interrupted_temporary_file_does_not_block_later_writes() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    let leftover = fixture.0.join("sample.pending");
    fs::write(&leftover, "partial").unwrap();
    broker
        .call(
            "sample",
            "state.write",
            serde_json::json!({"revision":0,"value":"saved"}),
        )
        .unwrap();
    assert_eq!(
        broker.call("sample", "state.read", Value::Null).unwrap()["value"],
        "saved"
    );
    // Another writer's file is never adopted or removed.
    assert_eq!(fs::read_to_string(&leftover).unwrap(), "partial");
}
#[test]
fn failed_commit_removes_only_its_own_temporary_file() {
    let fixture = Fixture::new();
    let foreign = fixture.0.join("sample.other.pending");
    fs::write(&foreign, "other writer").unwrap();
    // A non-empty directory at the target makes the final rename fail.
    fs::create_dir(fixture.0.join("sample.json")).unwrap();
    fs::write(fixture.0.join("sample.json").join("keep"), "").unwrap();
    assert_eq!(
        commit(&fixture.0, "sample", b"{}").unwrap_err(),
        StateErrorCode::StateWrite
    );
    let pending: Vec<_> = fs::read_dir(&fixture.0)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".pending"))
        .collect();
    assert_eq!(pending, ["sample.other.pending"]);
    assert_eq!(fs::read_to_string(&foreign).unwrap(), "other writer");
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
