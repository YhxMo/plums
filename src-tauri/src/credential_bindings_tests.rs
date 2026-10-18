use super::*;
const OWNER: &str = "extension.connector.test";
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("plums-binding-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn store(&self) -> Bindings {
        Bindings::new(self.0.clone())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn declaration() -> Declaration {
    serde_json::from_value(serde_json::json!({
        "label": "synthetic model",
        "target": "https://model.invalid/chat/completions",
        "contentType": "application/json",
        "headers": {},
        "authentication": {"type": "bearer"}
    }))
    .unwrap()
}
fn begin(store: &Bindings, revision: u64) -> Result<Ticket, Failure> {
    store.begin_key(
        OWNER.into(),
        "text".into(),
        "/connectors/test.js".into(),
        "0.1.0".into(),
        declaration(),
        revision,
    )
}
fn ready(store: &Bindings) {
    let ticket = begin(store, 0).unwrap();
    store.finish_key(ticket, KeyResult::Stored).unwrap();
}
#[test]
fn records_keep_policies_without_keys_and_restart_is_not_a_vault_check() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let views = fixture.store().list(OWNER).unwrap();
    assert_eq!(views[0].route, Route::Direct);
    assert_eq!(views[0].status, Status::Ready);
    let ipc = serde_json::to_string(&views).unwrap();
    assert!(!ipc.contains("reference"));
    assert!(!ipc.contains("retired"));
    assert!(fixture.store().list("extension.other").unwrap().is_empty());
    assert!(
        !fs::read_to_string(fixture.0.join("credential-bindings.json"))
            .unwrap()
            .contains("synthetic-key")
    );
}
#[test]
fn prewrite_cancel_rejection_or_unavailability_restores_previous_binding() {
    for result in [
        KeyResult::Cancelled,
        KeyResult::Rejected,
        KeyResult::Unavailable,
    ] {
        let fixture = Fixture::new();
        let store = fixture.store();
        let ticket = begin(&store, 0).unwrap();
        store.finish_key(ticket, result).unwrap();
        assert!(store.list(OWNER).unwrap().is_empty());
        ready(&store);
        let ticket = begin(&store, 1).unwrap();
        store.finish_key(ticket, result).unwrap();
        let view = &store.list(OWNER).unwrap()[0];
        assert_eq!(view.status, Status::Ready);
        assert_eq!(view.revision, 3);
    }
}
#[test]
fn unknown_write_stays_pending_across_restart_and_requires_reconciliation() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ticket = begin(&store, 0).unwrap();
    assert_eq!(store.finish_key(ticket, KeyResult::Unknown), Err("unknown"));
    let store = fixture.store();
    assert_eq!(store.list(OWNER).unwrap()[0].status, Status::Pending);
    assert!(matches!(begin(&store, 1), Err("reconcile-required")));
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    assert_eq!(
        store.finish_reconcile(ticket, Err("unknown")),
        Err("unknown")
    );
    assert_eq!(store.list(OWNER).unwrap()[0].status, Status::Pending);
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    store.finish_reconcile(ticket, Ok(true)).unwrap();
    assert_eq!(store.list(OWNER).unwrap()[0].status, Status::Ready);
}
#[test]
fn absent_key_disables_pending_binding_without_restoring_old_key() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let ticket = begin(&store, 1).unwrap();
    store.finish_key(ticket, KeyResult::Unknown).unwrap_err();
    let ticket = store.begin_action(OWNER, "text", 2).unwrap();
    store.finish_reconcile(ticket, Ok(false)).unwrap();
    assert_eq!(store.list(OWNER).unwrap()[0].status, Status::Disabled);
}
#[test]
fn revocation_is_persisted_before_secret_deletion_and_unknown_is_retryable() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    store.disable(&ticket).unwrap();
    assert_eq!(
        fixture.store().list(OWNER).unwrap()[0].status,
        Status::DeletePending
    );
    assert_eq!(store.finish_delete(ticket, false), Err("unknown"));
    assert!(matches!(begin(&store, 2), Err("reconcile-required")));
    let ticket = store.begin_action(OWNER, "text", 2).unwrap();
    store.disable(&ticket).unwrap();
    store.finish_delete(ticket, true).unwrap();
    let view = &fixture.store().list(OWNER).unwrap()[0];
    assert_eq!(view.status, Status::Disabled);
    let saved = fs::read_to_string(fixture.0.join("credential-bindings.json")).unwrap();
    assert!(saved.contains("\"reference\":null"));
    assert!(saved.contains("\"retired\":[]"));
}
#[test]
fn explicit_proxy_changes_revision_and_keeps_target_unchanged() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    store
        .finish_route(ticket, Route::from_input("http://127.0.0.1:7890").unwrap())
        .unwrap();
    let view = &fixture.store().list(OWNER).unwrap()[0];
    assert_eq!(view.revision, 2);
    assert_eq!(view.declaration.target, declaration().target);
    assert!(matches!(view.route, Route::Proxy { .. }));
    let ticket = store.begin_action(OWNER, "text", 2).unwrap();
    store.cancel_action(&ticket).unwrap();
    assert!(matches!(
        store.list(OWNER).unwrap()[0].route,
        Route::Proxy { .. }
    ));
}
#[test]
fn stale_controls_cross_owner_and_concurrent_panels_cannot_replace_records() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    assert!(matches!(begin(&store, 0), Err("conflict")));
    assert!(matches!(
        store.begin_action("extension.other", "text", 1),
        Err("missing")
    ));
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    assert!(matches!(begin(&store, 1), Err("busy")));
    store.cancel_action(&ticket).unwrap();
    assert_eq!(store.cancel_action(&ticket), Err("unknown"));
}
#[test]
fn bad_metadata_and_failed_persistence_do_not_replace_original_or_claim_success() {
    let fixture = Fixture::new();
    let path = fixture.0.join("credential-bindings.json");
    fs::write(&path, "{broken").unwrap();
    let store = fixture.store();
    assert!(store.list(OWNER).is_err());
    assert!(begin(&store, 0).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
    fs::remove_file(path).unwrap();
    let store = fixture.store();
    fs::create_dir(fixture.0.join("credential-bindings.json")).unwrap();
    assert!(matches!(begin(&store, 0), Err("unknown")));
    assert!(store.list(OWNER).is_err());
}
#[test]
fn interrupted_temporary_metadata_does_not_block_restart_or_reconciliation() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let ticket = begin(&store, 0).unwrap();
    let blocked = fixture.0.join("blocked");
    fs::write(&blocked, "synthetic write failure").unwrap();
    store.0.lock().unwrap().root = blocked;
    assert_eq!(store.finish_key(ticket, KeyResult::Stored), Err("unknown"));
    fs::write(
        fixture.0.join("credential-bindings.interrupted.pending"),
        "partial",
    )
    .unwrap();
    let store = fixture.store();
    assert_eq!(store.list(OWNER).unwrap()[0].status, Status::Pending);
    let ticket = store.begin_action(OWNER, "text", 1).unwrap();
    store.finish_reconcile(ticket, Ok(true)).unwrap();
    assert_eq!(
        fixture.store().list(OWNER).unwrap()[0].status,
        Status::Ready
    );
}
#[test]
fn pending_metadata_without_current_reference_is_corrupt_and_preserved() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let _ticket = begin(&store, 0).unwrap();
    let path = fixture.0.join("credential-bindings.json");
    let mut saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    saved["bindings"][format!("{OWNER}:text")]["reference"] = serde_json::Value::Null;
    let broken = serde_json::to_vec(&saved).unwrap();
    fs::write(&path, &broken).unwrap();
    let restarted = fixture.store();
    assert!(restarted.list(OWNER).is_err());
    assert!(restarted.begin_action(OWNER, "text", 1).is_err());
    assert_eq!(fs::read(path).unwrap(), broken);
}
#[test]
fn uninstalled_owner_stays_in_inventory_disabled_and_can_be_cleaned_up() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    store.retain_disabled(OWNER).unwrap();
    let inventory = fixture.store().inventory().unwrap();
    assert_eq!(inventory[0].status, Status::Disabled);
    assert_eq!(inventory[0].owner, OWNER);
    let ticket = store.begin_action(OWNER, "text", 2).unwrap();
    assert_eq!(ticket.references.len(), 1);
    store.disable(&ticket).unwrap();
    store.finish_delete(ticket, true).unwrap();
    assert!(store.inventory().unwrap().is_empty());
    let ticket = store.begin_action(OWNER, "text", 3).unwrap();
    assert!(ticket.references.is_empty());
    store.cancel_action(&ticket).unwrap();
}
#[test]
fn unsafe_headers_urls_and_proxy_policies_are_rejected_before_persistence() {
    for name in [
        "Host",
        "Content-Type",
        "content-length",
        "Proxy-Authorization",
    ] {
        let mut declaration = declaration();
        declaration.headers.insert(name.into(), "synthetic".into());
        assert!(declaration.validate().is_err());
        declaration.headers.clear();
        declaration.authentication = Authentication::Header { name: name.into() };
        assert!(declaration.validate().is_err());
    }
    let mut declaration = declaration();
    declaration.headers.insert("X-Version".into(), "1".into());
    declaration.headers.insert("x-version".into(), "2".into());
    assert!(declaration.validate().is_err());
    for target in [
        "http://model.invalid/text",
        "https://model.invalid:8443/text",
        "https://user@model.invalid/text",
        "https://model.invalid/text?",
        "https://model.invalid/text#",
    ] {
        declaration.headers.clear();
        declaration.target = target.into();
        assert!(declaration.validate().is_err());
    }
    for proxy in [
        "socks5://127.0.0.1:1080",
        "http://user:pass@127.0.0.1:7890",
        "http://127.0.0.1:7890/path",
        "http://127.0.0.1:7890?",
    ] {
        assert!(Route::from_input(proxy).is_err());
    }
    assert!(Route::from_input("https://proxy.invalid:8443").is_ok());
    assert!(Route::from_input("").is_ok());
}
#[test]
fn re_entry_retires_old_references_until_their_deletion_is_confirmed() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let first = begin(&store, 1).unwrap();
    let old = first.references.clone();
    store.finish_key(first, KeyResult::Stored).unwrap();
    let second = begin(&store, 2).unwrap();
    let newest = second.reference.clone().unwrap();
    store.finish_key(second, KeyResult::Stored).unwrap();
    let cleanup = store.begin_action(OWNER, "text", 3).unwrap();
    let retired = cleanup.retired();
    assert_eq!(retired.len(), 2);
    assert!(!retired.contains(&newest));
    assert!(old.iter().all(|reference| retired.contains(reference)));
    // Only confirmed deletions leave the record; the rest are retried later.
    store
        .finish_retire(cleanup, vec![retired[0].clone()])
        .unwrap();
    let next = fixture.store().begin_action(OWNER, "text", 3).unwrap();
    assert_eq!(next.retired(), vec![retired[1].clone()]);
    assert_eq!(next.reference.as_deref(), Some(newest.as_str()));
    assert_eq!(next.view.status, Status::Ready);
    assert_eq!(next.view.revision, 3);
}
#[test]
fn retirement_cleanup_never_drops_the_current_reference() {
    let fixture = Fixture::new();
    let store = fixture.store();
    ready(&store);
    let cleanup = store.begin_action(OWNER, "text", 1).unwrap();
    let current = cleanup.reference.clone().unwrap();
    assert!(cleanup.retired().is_empty());
    store.finish_retire(cleanup, vec![current.clone()]).unwrap();
    let next = store.begin_action(OWNER, "text", 1).unwrap();
    assert_eq!(next.reference, Some(current));
}
