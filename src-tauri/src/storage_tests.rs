use super::*;
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub(super) struct Fixture(pub(super) PathBuf);
impl Fixture {
    pub(super) fn new() -> Self {
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
    pub(super) fn broker(&self) -> Broker {
        let broker = Broker::new(self.0.clone());
        broker
            .grant(
                "extension.sample",
                vec!["state.read".into(), "state.write".into()],
            )
            .unwrap();
        broker
    }
    /// A document as builds before SQLite kept it, at `<stem>.json`.
    pub(super) fn legacy(&self, stem: &str, text: &str) -> PathBuf {
        let path = self.0.join(format!("{stem}.json"));
        fs::write(&path, text).unwrap();
        path
    }
    pub(super) fn names(&self, dir: &str) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(self.0.join(dir))
            .map(|entries| {
                entries
                    .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn read(broker: &Broker, payload: Value) -> Result<Value, StateErrorCode> {
    broker.call("extension.sample", "state.read", payload)
}
fn write(broker: &Broker, payload: Value) -> Result<Value, StateErrorCode> {
    broker.call("extension.sample", "state.write", payload)
}
#[test]
fn round_trip_and_restart_preserve_revision() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    assert_eq!(read(&broker, Value::Null).unwrap(), Value::Null);
    write(
        &broker,
        serde_json::json!({"revision":0,"value":{"text":"first"}}),
    )
    .unwrap();
    drop(broker);
    let restarted = fixture.broker();
    let saved = read(&restarted, Value::Null).unwrap();
    assert_eq!(saved["value"]["text"], "first");
    assert_eq!(saved["revision"], 1);
    // One database per owner (beside its WAL files); no per-document files.
    let databases: Vec<_> = fixture
        .names("state")
        .into_iter()
        .filter(|name| name.ends_with(".sqlite3"))
        .collect();
    assert_eq!(databases, ["extension.sample.sqlite3"]);
    assert!(!fixture.0.join("extension.sample.json").exists());
}
#[test]
fn denied_and_revoked_calls_do_not_write() {
    let fixture = Fixture::new();
    let broker = Broker::new(fixture.0.clone());
    assert_eq!(
        write(&broker, serde_json::json!({"revision":0,"value":1})).unwrap_err(),
        StateErrorCode::PermissionDenied
    );
    broker
        .grant("extension.sample", vec!["state.write".into()])
        .unwrap();
    broker.grant("extension.sample", vec![]).unwrap();
    assert!(write(&broker, serde_json::json!({"revision":0,"value":1})).is_err());
    assert!(!fixture.0.join("state").exists());
}
#[test]
fn earlier_documents_are_imported_once_and_kept_as_a_backup() {
    let fixture = Fixture::new();
    let main = r#"{"schema":1,"revision":3,"value":"main"}"#;
    let keyed = r#"{"schema":1,"revision":1,"value":"page"}"#;
    fixture.legacy("extension.sample", main);
    fixture.legacy("extension.sample+p-1", keyed);
    fixture.legacy("host.shell", r#"{"schema":1,"revision":1,"value":"shell"}"#);
    // Temporary files of interrupted earlier writes are not documents.
    fs::write(fixture.0.join("extension.sample.0a1b.pending"), "partial").unwrap();
    let broker = fixture.broker();

    let saved = read(&broker, Value::Null).unwrap();
    assert_eq!(
        (saved["revision"].clone(), saved["value"].clone()),
        (3.into(), "main".into())
    );
    assert_eq!(
        read(&broker, serde_json::json!({"key":"p-1"})).unwrap()["value"],
        "page"
    );
    // The next write continues from the imported revision.
    write(&broker, serde_json::json!({"revision":3,"value":"next"})).unwrap();
    assert_eq!(
        fixture.names("legacy-json"),
        ["extension.sample+p-1.json", "extension.sample.json"]
    );
    assert_eq!(
        fs::read_to_string(fixture.0.join("legacy-json/extension.sample.json")).unwrap(),
        main
    );
    // Other owners and non-document files stay where they were.
    assert!(fixture.0.join("host.shell.json").exists());
    assert!(fixture.0.join("extension.sample.0a1b.pending").exists());

    // A file that reappears later is not imported over the database.
    fixture.legacy(
        "extension.sample",
        r#"{"schema":1,"revision":9,"value":"stale"}"#,
    );
    drop(broker);
    let restarted = fixture.broker();
    assert_eq!(read(&restarted, Value::Null).unwrap()["value"], "next");
}
#[test]
fn unreadable_earlier_documents_stay_unreadable_and_backed_up() {
    for (original, code) in [
        ("{broken", StateErrorCode::StateCorrupt),
        (
            r#"{"schema":99,"revision":1,"value":4}"#,
            StateErrorCode::StateSchema,
        ),
    ] {
        let fixture = Fixture::new();
        fixture.legacy("extension.sample", original);
        let broker = fixture.broker();
        // Neither read as empty nor overwritten: the extension sees the damage.
        assert_eq!(read(&broker, Value::Null).unwrap_err(), code);
        assert_eq!(
            write(&broker, serde_json::json!({"revision":0,"value":"lost"})).unwrap_err(),
            code
        );
        assert_eq!(
            fs::read_to_string(fixture.0.join("legacy-json/extension.sample.json")).unwrap(),
            original
        );
    }
}
#[cfg(unix)]
#[test]
fn failed_legacy_enumeration_can_retry_without_committing_an_empty_database() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let original = r#"{"schema":1,"revision":7,"value":"kept"}"#;
    let legacy = fixture.legacy("extension.sample", original);
    let broker = fixture.broker();
    // Creating a database is still possible, but discovering legacy files is not.
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o300)).unwrap();
    let enforced = fs::read_dir(&fixture.0).is_err();
    let result = enforced.then(|| read(&broker, Value::Null));
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o700)).unwrap();
    let Some(result) = result else {
        return;
    };
    assert_eq!(result.unwrap_err(), StateErrorCode::StateRead);
    let connection = Connection::open(fixture.0.join("state/extension.sample.sqlite3")).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 0);
    assert_eq!(fs::read_to_string(&legacy).unwrap(), original);
    let saved = read(&broker, Value::Null).unwrap();
    assert_eq!(saved["revision"], 7);
    assert_eq!(saved["value"], "kept");
}
#[test]
fn an_oversized_earlier_document_is_refused_without_reading_it() {
    let fixture = Fixture::new();
    // A sparse 4 GiB file would exhaust memory if read before the size check.
    fs::File::create(fixture.0.join("extension.sample.json"))
        .unwrap()
        .set_len(4 << 30)
        .unwrap();
    let broker = fixture.broker();
    assert_eq!(
        read(&broker, Value::Null).unwrap_err(),
        StateErrorCode::StateTooLarge
    );
    assert_eq!(fixture.names("legacy-json"), ["extension.sample.json"]);
}
#[test]
fn values_over_the_cap_are_refused_and_keep_the_prior_value() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    write(&broker, serde_json::json!({"revision":0,"value":"saved"})).unwrap();
    let big = "x".repeat(MAX_DOCUMENT);
    assert_eq!(
        write(&broker, serde_json::json!({"revision":1,"value":big})).unwrap_err(),
        StateErrorCode::StateTooLarge
    );
    assert_eq!(read(&broker, Value::Null).unwrap()["revision"], 1);
}
#[test]
fn stale_revision_and_failed_write_preserve_prior_state() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    write(&broker, serde_json::json!({"revision":0,"value":"saved"})).unwrap();
    assert_eq!(
        write(&broker, serde_json::json!({"revision":0,"value":"stale"})).unwrap_err(),
        StateErrorCode::RevisionConflict
    );
    drop(broker);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |bits| fs::Permissions::from_mode(bits);
        let state = fixture.0.join("state");
        let database = state.join("extension.sample.sqlite3");
        fs::set_permissions(&database, mode(0o444)).unwrap();
        fs::set_permissions(&state, mode(0o555)).unwrap();
        // Privileged runs (for example root) bypass the mode; skip rather than misreport.
        let enforced = fs::write(state.join("probe"), "").is_err();
        let failed = enforced.then(|| {
            write(
                &fixture.broker(),
                serde_json::json!({"revision":1,"value":"failed"}),
            )
        });
        fs::set_permissions(&state, mode(0o755)).unwrap();
        fs::set_permissions(&database, mode(0o644)).unwrap();
        if let Some(failed) = failed {
            assert!(failed.is_err());
        }
    }
    assert_eq!(
        read(&fixture.broker(), Value::Null).unwrap()["value"],
        "saved"
    );
}
#[test]
fn rejects_path_escape_and_cross_owner_access() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    assert!(broker.grant("../escape", vec![]).is_err());
    assert!(broker
        .call("extension.other", "state.read", Value::Null)
        .is_err());
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
#[test]
fn only_shell_and_extension_namespaces_are_owners() {
    let fixture = Fixture::new();
    let broker = Broker::new(fixture.0.clone());
    let caps = || vec!["state.read".to_string(), "state.write".to_string()];
    for reserved in [
        "credential-bindings",
        "sample",
        "host.other",
        "extension.",
        "extension.1a",
    ] {
        assert_eq!(
            broker.grant(reserved, caps()).unwrap_err(),
            StateErrorCode::InvalidOwner,
            "{reserved}"
        );
    }
    fs::write(fixture.0.join("credential-bindings.json"), "secret refs").unwrap();
    assert_eq!(
        broker
            .call("credential-bindings", "state.read", Value::Null)
            .unwrap_err(),
        StateErrorCode::InvalidOwner
    );
    for owner in ["host.shell", "extension.a", "extension.agents.local"] {
        broker.grant(owner, caps()).unwrap();
    }
}
#[test]
fn sweep_removes_only_old_temporary_files() {
    let fixture = Fixture::new();
    let old = fixture.0.join("credential-bindings.json.abandoned.pending");
    let fresh = fixture.0.join("credential-bindings.json.writing.pending");
    let saved = fixture.0.join("credential-bindings.json");
    for path in [&old, &fresh, &saved] {
        fs::write(path, "x").unwrap();
    }
    let past = SystemTime::now() - std::time::Duration::from_secs(7200);
    for path in [&old, &saved] {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(past)
            .unwrap();
    }
    Broker::new(fixture.0.clone()).sweep(std::time::Duration::from_secs(3600));
    assert!(!old.exists());
    assert!(fresh.exists());
    assert!(saved.exists());
}
