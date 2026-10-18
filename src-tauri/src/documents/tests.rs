use super::*;
fn broker() -> Documents {
    let broker = Documents::default();
    broker.grant("sample", true).unwrap();
    broker
}
fn source() -> SelectedSource {
    SelectedSource {
        name: "test.txt".into(),
        source: Source::Test(b"safe text".to_vec()),
    }
}
fn selected(broker: &Documents, operation: &str) -> String {
    let ticket = broker.begin("sample", operation, true).unwrap();
    match broker.finish_select(ticket, Ok(Some(vec![source()]))) {
        SelectResponse::Selected { documents } => documents[0].handle.clone(),
        other => panic!("{other:?}"),
    }
}
#[test]
fn handles_are_owner_bound_and_revocation_is_final() {
    let broker = broker();
    let handle = selected(&broker, "pick");
    broker.grant("other", true).unwrap();
    assert_eq!(broker.list("other").unwrap().len(), 0);
    assert!(matches!(
        broker.begin_read("other", &handle, 64, "cross"),
        Err(ReadResponse::Rejected { reason: "denied" })
    ));
    broker.revoke("other", Some(&handle)).unwrap();
    assert_eq!(broker.list("sample").unwrap().len(), 1);
    broker.revoke("sample", Some(&handle)).unwrap();
    assert!(matches!(
        broker.begin_read("sample", &handle, 64, "old"),
        Err(ReadResponse::Rejected { reason: "denied" })
    ));
}
#[test]
fn cancelled_selection_and_late_grant_generation_do_not_bind() {
    let broker = broker();
    let ticket = broker.begin("sample", "cancel-picker", true).unwrap();
    broker.cancel("sample", "cancel-picker").unwrap();
    assert!(matches!(
        broker.finish_select(ticket, Ok(Some(vec![source()]))),
        SelectResponse::Cancelled
    ));
    let ticket = broker.begin("sample", "old-picker", true).unwrap();
    broker.revoke("sample", None).unwrap();
    assert!(matches!(
        broker.finish_select(ticket, Ok(Some(vec![source()]))),
        SelectResponse::Cancelled
    ));
    assert!(broker.list("sample").unwrap().is_empty());
    let ticket = broker.begin("sample", "decline", true).unwrap();
    assert!(matches!(
        broker.finish_select(ticket, Ok(None)),
        SelectResponse::Cancelled
    ));
}
#[test]
fn pre_cancel_and_reused_operation_cannot_start_even_after_release() {
    let broker = broker();
    broker.cancel("sample", "before").unwrap();
    broker.revoke("sample", None).unwrap();
    assert!(matches!(
        broker.begin("sample", "before", false),
        Err("cancelled")
    ));
    selected(&broker, "once");
    assert!(matches!(
        broker.begin("sample", "once", false),
        Err("invalid-request")
    ));
}
#[test]
fn selection_capacity_is_atomic_and_no_existing_handle_is_evicted() {
    let broker = broker();
    for i in 0..7 {
        selected(&broker, &format!("pick-{i}"));
    }
    let ticket = broker.begin("sample", "too-many", true).unwrap();
    assert!(matches!(
        broker.finish_select(ticket, Ok(Some(vec![source(), source()]))),
        SelectResponse::Rejected {
            reason: "resource-limit"
        }
    ));
    assert_eq!(broker.list("sample").unwrap().len(), 7);
    selected(&broker, "last");
    assert_eq!(broker.list("sample").unwrap().len(), 8);
}
#[test]
fn reads_recheck_cancellation_revocation_and_grant_after_io() {
    for mode in 0..3 {
        let broker = broker();
        let handle = selected(&broker, "pick");
        let ticket = broker.begin_read("sample", &handle, 64, "read").unwrap();
        match mode {
            0 => broker.cancel("sample", "read").unwrap(),
            1 => broker.revoke("sample", Some(&handle)).unwrap(),
            _ => broker.grant("sample", false).unwrap(),
        }
        assert!(!matches!(
            broker.finish_read(ticket, Ok("private".into())),
            ReadResponse::Read { .. }
        ));
    }
}
#[test]
fn byte_limit_utf8_errors_and_fixed_failures_have_no_payload() {
    assert!(matches!(decode_bytes(vec![0xff], 64), Err("encoding")));
    assert!(matches!(
        decode_bytes("梅子".as_bytes().to_vec(), 5),
        Err("too-large")
    ));
    let broker = broker();
    let handle = selected(&broker, "pick");
    for bytes in [0, 65537] {
        assert!(matches!(
            broker.begin_read("sample", &handle, bytes, &format!("bad-{bytes}")),
            Err(ReadResponse::Rejected {
                reason: "invalid-request"
            })
        ));
    }
    let ticket = broker.begin_read("sample", &handle, 64, "read").unwrap();
    let response = broker.finish_read(ticket, Err("io"));
    assert_eq!(
        serde_json::to_string(&response).unwrap(),
        r#"{"status":"rejected","reason":"io"}"#
    );
}
#[test]
fn global_capacity_picker_busy_pending_and_operation_budgets_are_bounded() {
    let broker = broker();
    let picker = broker.begin("sample", "picker", true).unwrap();
    assert!(matches!(
        broker.begin("sample", "second-picker", true),
        Err("busy")
    ));
    broker.finish_select(picker, Ok(None));
    let tickets: Vec<_> = (0..8)
        .map(|i| broker.begin("sample", &format!("hold-{i}"), false).unwrap())
        .collect();
    assert!(matches!(
        broker.begin("sample", "ninth", false),
        Err("resource-limit")
    ));
    for ticket in tickets {
        broker.finish_select(ticket, Ok(None));
    }
    for i in 0..1015 {
        broker.cancel("sample", &format!("cancel-{i}")).unwrap();
    }
    assert!(matches!(
        broker.begin("sample", "over-budget", false),
        Err("resource-limit")
    ));
    broker.revoke("sample", None).unwrap();
    assert!(matches!(
        broker.begin("sample", "still-over-budget", false),
        Err("resource-limit")
    ));
    let broker = super::tests::broker();
    for owner in 0..4 {
        let owner = format!("owner-{owner}");
        broker.grant(&owner, true).unwrap();
        let ticket = broker.begin(&owner, "pick", true).unwrap();
        assert!(matches!(
            broker.finish_select(ticket, Ok(Some((0..8).map(|_| source()).collect()))),
            SelectResponse::Selected { .. }
        ));
    }
    let ticket = broker.begin("sample", "global-full", true).unwrap();
    assert!(matches!(
        broker.finish_select(ticket, Ok(Some(vec![source()]))),
        SelectResponse::Rejected {
            reason: "resource-limit"
        }
    ));
}
#[test]
fn owner_budget_and_grant_failure_preserve_existing_bindings() {
    let broker = broker();
    selected(&broker, "pick");
    assert_eq!(
        broker.grant_with("sample", false, || Err("unknown")),
        Err("unknown")
    );
    assert_eq!(broker.list("sample").unwrap().len(), 1);
    for owner in 0..31 {
        broker.grant(&format!("owner-{owner}"), true).unwrap();
    }
    assert_eq!(broker.grant("extra", true), Err("resource-limit"));
    // Owners without document permission do not consume this platform budget.
    assert_eq!(broker.grant("state-only", false), Ok(()));
}
#[test]
fn grants_and_release_do_not_resurrect_old_documents() {
    let broker = broker();
    let handle = selected(&broker, "pick");
    broker.grant("sample", true).unwrap();
    assert_eq!(broker.list("sample").unwrap().len(), 1);
    broker.grant("sample", false).unwrap();
    broker.grant("sample", true).unwrap();
    assert!(broker.list("sample").unwrap().is_empty());
    assert!(matches!(
        broker.begin_read("sample", &handle, 64, "old"),
        Err(ReadResponse::Rejected { reason: "denied" })
    ));
}
