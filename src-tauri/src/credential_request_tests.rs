use super::*;

fn view(revision: u64) -> View {
    serde_json::from_value(serde_json::json!({
        "owner": "extension.connector.test", "alias": "text",
        "source": "/connectors/test.js", "version": "0.1.0",
        "declaration": {
            "label": "synthetic model", "target": "https://model.invalid/chat",
            "contentType": "application/json", "headers": {},
            "authentication": {"type": "bearer"},
        },
        "route": {"type": "direct"}, "revision": revision, "status": "ready",
    }))
    .unwrap()
}
const OWNER: &str = "extension.connector.test";

#[test]
fn each_owner_has_one_request_slot_released_on_drop() {
    let requests = Requests::default();
    let first = requests.reserve(OWNER, "a").unwrap();
    assert_eq!(requests.reserve(OWNER, "b").err(), Some("busy"));
    let other = requests.reserve("extension.other", "c").unwrap();
    drop(first);
    assert!(requests.reserve(OWNER, "b").is_ok());
    drop(other);
}
#[test]
fn abort_cancels_only_the_matching_request_even_before_it_registers() {
    let requests = Requests::default();
    let slot = requests.reserve(OWNER, "a").unwrap();
    requests.abort(OWNER, "stale-id");
    assert!(!slot.cancelled());
    requests.abort(OWNER, "a");
    assert!(slot.cancelled());
    drop(slot);
    requests.abort(OWNER, "early");
    assert_eq!(requests.reserve(OWNER, "early").err(), Some("cancelled"));
    assert!(requests.reserve(OWNER, "early").is_ok());
}
#[test]
fn confirmation_is_per_revision_and_release_forgets_it_and_cancels() {
    let requests = Requests::default();
    let slot = requests.reserve(OWNER, "a").unwrap();
    assert!(requests.confirm(&view(1), &slot));
    assert!(requests.confirmed(&view(1)));
    assert!(!requests.confirmed(&view(2)));
    requests.release(OWNER);
    assert!(slot.cancelled());
    assert!(!requests.confirmed(&view(1)));
}
#[test]
fn a_confirmation_answered_after_release_is_not_remembered() {
    let requests = Requests::default();
    let slot = requests.reserve(OWNER, "a").unwrap();
    // The panel is still open when the grant changes.
    requests.release(OWNER);
    assert!(!requests.confirm(&view(1), &slot));
    assert!(!requests.confirmed(&view(1)));
}
#[test]
fn cancellation_wakes_a_waiting_request() {
    let requests = Requests::default();
    let mut slot = requests.reserve(OWNER, "a").unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            requests.abort(OWNER, "a");
        });
        tauri::async_runtime::block_on(slot.until_cancelled());
    });
    assert!(slot.cancelled());
}
#[test]
fn failures_report_whether_network_io_may_have_started() {
    assert_eq!(
        serde_json::to_value(RequestFailure::from(Fault::NotDispatched("denied"))).unwrap(),
        serde_json::json!({"code": "denied", "outcome": "not-dispatched"})
    );
    assert_eq!(
        serde_json::to_value(RequestFailure::from(Fault::Unknown("timeout"))).unwrap(),
        serde_json::json!({"code": "timeout", "outcome": "unknown"})
    );
}
