use super::*;
#[test]
fn native_receipt_failures_preserve_unknown_and_cleanup_boundary() {
    let p = Probe::default();
    p.grant("probe.alpha", true).unwrap();
    p.faults(
        "probe.alpha",
        Faults {
            prepare_receipt: true,
            cancel_before: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        p.prepare("probe.alpha", "lost", "echo", "x")
            .unwrap_err()
            .outcome,
        "unknown"
    );
    assert_eq!(
        p.cancel("probe.alpha", "lost").unwrap_err().outcome,
        "unknown"
    );
    assert_eq!(p.pending(), 1);
    assert!(p.cancel("probe.beta", "lost").is_err());
    p.0.lock()
        .unwrap()
        .requests
        .get_mut(&("probe.alpha".into(), "lost".into()))
        .unwrap()
        .expires = Instant::now();
    assert_eq!(p.pending(), 0);
    p.faults(
        "probe.alpha",
        Faults {
            prepare_receipt: true,
            cancel_receipt: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(p.prepare("probe.alpha", "lost", "echo", "x").is_err());
    assert_eq!(
        p.cancel("probe.alpha", "lost").unwrap_err().outcome,
        "unknown"
    );
    assert_eq!(p.pending(), 0);
    p.prepare("probe.alpha", "fresh", "echo", "x").unwrap();
    p.cancel("probe.alpha", "fresh").unwrap();
}
#[test]
fn expiry_does_not_remove_running_request_or_other_owner() {
    let p = Probe::default();
    for owner in ["probe.alpha", "probe.beta"] {
        p.grant(owner, true).unwrap();
        p.prepare(owner, "same", "echo", "x").unwrap();
    }
    {
        let mut inner = p.0.lock().unwrap();
        let r = inner
            .requests
            .get_mut(&("probe.alpha".into(), "same".into()))
            .unwrap();
        r.expires = Instant::now();
        r.started = true;
    }
    assert_eq!(p.pending(), 2);
    assert!(p.prepare("probe.alpha", "same", "echo", "x").is_err());
    p.cancel("probe.beta", "same").unwrap();
    assert_eq!(p.pending(), 1);
}
#[test]
fn abandoned_reservation_expires_without_revoking_owner() {
    let p = Probe::default();
    p.grant("probe.alpha", true).unwrap();
    p.prepare("probe.alpha", "lost", "echo", "x").unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    assert_eq!(p.pending(), 0);
    p.prepare("probe.alpha", "fresh", "echo", "x").unwrap();
}
#[test]
fn denied_and_cross_owner_never_reserve() {
    let p = Probe::default();
    assert_eq!(
        p.prepare("probe.alpha", "one", "echo", "hello")
            .unwrap_err()
            .outcome,
        "not-dispatched"
    );
    p.grant("probe.alpha", true).unwrap();
    p.prepare("probe.alpha", "one", "echo", "hello").unwrap();
    assert!(p.cancel("probe.beta", "one").is_err());
    assert!(p.prepare("probe.alpha", "one", "echo", "hello").is_err());
    p.cancel("probe.alpha", "one").unwrap();
    assert_eq!(p.pending(), 0);
}
#[test]
fn validates_request_before_reserving() {
    let p = Probe::default();
    p.grant("probe.alpha", true).unwrap();
    for (binding, body) in [("http://example.com", "hello"), ("echo", "\0")] {
        assert!(p.prepare("probe.alpha", "one", binding, body).is_err());
    }
    assert!(p
        .prepare("probe.alpha", "one", "echo", &"x".repeat(4097))
        .is_err());
    assert_eq!(p.pending(), 0);
}
#[test]
fn reservations_are_bounded_and_revocation_releases_them() {
    let p = Probe::default();
    p.grant("probe.alpha", true).unwrap();
    for i in 0..16 {
        p.prepare("probe.alpha", &format!("r{i}"), "echo", "x")
            .unwrap();
    }
    assert!(p.prepare("probe.alpha", "overflow", "echo", "x").is_err());
    p.grant("probe.alpha", false).unwrap();
    assert_eq!(p.pending(), 0);
    p.grant("probe.alpha", true).unwrap();
    p.prepare("probe.alpha", "new", "echo", "x").unwrap();
    p.cancel("probe.alpha", "new").unwrap();
    assert_eq!(p.pending(), 0);
}
