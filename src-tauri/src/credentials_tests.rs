use super::*;
#[test]
fn unavailable_is_rejected_instead_of_reported_as_unknown() {
    assert!(matches!(
        response(Err("unavailable")),
        Response::Rejected {
            reason: "unavailable"
        }
    ));
    assert!(matches!(response(Err("unknown")), Response::Unknown));
    assert!(matches!(
        response(Err("invalid-policy")),
        Response::Rejected {
            reason: "invalid-policy"
        }
    ));
}
