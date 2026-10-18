use super::tests::Fixture;
use super::*;
#[test]
fn keyed_documents_have_their_own_revision_and_cap() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    let owner = "extension.sample";
    let write = |payload: Value| broker.call(owner, "state.write", payload);
    write(serde_json::json!({"revision":0,"value":"index"})).unwrap();
    write(serde_json::json!({"key":"s-1","revision":0,"value":"one"})).unwrap();
    write(serde_json::json!({"key":"s-1","revision":1,"value":"two"})).unwrap();
    assert_eq!(
        write(serde_json::json!({"key":"s-1","revision":0,"value":"stale"})).unwrap_err(),
        StateErrorCode::RevisionConflict
    );
    let read = |key: Value| broker.call(owner, "state.read", serde_json::json!({ "key": key }));
    assert_eq!(read(Value::Null).unwrap()["revision"], 1);
    assert_eq!(read("s-1".into()).unwrap()["value"], "two");
    assert_eq!(read("s-2".into()).unwrap(), Value::Null);
    // Each key is capped separately, so the index stays writable.
    let big = "x".repeat(60_000);
    write(serde_json::json!({"key":"s-2","revision":0,"value":big})).unwrap();
    write(serde_json::json!({"key":"s-3","revision":0,"value":big})).unwrap();
    write(serde_json::json!({"revision":1,"value":"index 2"})).unwrap();
    assert!(fixture.0.join("extension.sample+s-1.json").exists());
}
#[test]
fn invalid_keys_are_rejected_without_touching_files() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    for key in [
        serde_json::json!(""),
        serde_json::json!("-a"),
        serde_json::json!("A"),
        serde_json::json!("a.b"),
        serde_json::json!("a+b"),
        serde_json::json!("../x"),
        serde_json::json!("a".repeat(65)),
        serde_json::json!(7),
    ] {
        assert_eq!(
            broker
                .call(
                    "extension.sample",
                    "state.write",
                    serde_json::json!({"key":key,"revision":0,"value":1})
                )
                .unwrap_err(),
            StateErrorCode::InvalidKey,
            "{key}"
        );
        assert_eq!(
            broker
                .call(
                    "extension.sample",
                    "state.read",
                    serde_json::json!({ "key": key })
                )
                .unwrap_err(),
            StateErrorCode::InvalidKey
        );
    }
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
}
#[test]
fn remove_checks_the_revision_and_deletes_only_that_key() {
    let fixture = Fixture::new();
    let broker = fixture.broker();
    let call = |payload: Value| broker.call("extension.sample", "state.write", payload);
    call(serde_json::json!({"revision":0,"value":"index"})).unwrap();
    call(serde_json::json!({"key":"s-1","revision":0,"value":"one"})).unwrap();
    assert_eq!(
        call(serde_json::json!({"key":"s-1","revision":0,"remove":true})).unwrap_err(),
        StateErrorCode::RevisionConflict
    );
    assert_eq!(
        call(serde_json::json!({"key":"s-1","revision":1,"remove":true})).unwrap(),
        Value::Null
    );
    // Removing an absent key at revision 0 is an idempotent no-op.
    assert_eq!(
        call(serde_json::json!({"key":"s-1","revision":0,"remove":true})).unwrap(),
        Value::Null
    );
    assert!(!fixture.0.join("extension.sample+s-1.json").exists());
    assert!(fixture.0.join("extension.sample.json").exists());
}
