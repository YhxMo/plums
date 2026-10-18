use super::*;
use crate::ipc::Wire;

#[test]
fn command_contract_uses_actual_wire_names_and_native_injection() {
    let read = documents::document_read::contract();
    assert!(read.contains("operationId: string"));
    assert!(read.contains("maxBytes: number"));
    assert!(!read.contains("app:"));
    assert!(!read.contains("state:"));
    assert!(documents::document_revoke::contract().contains("handle?: string | null"));
    assert!(documents::document_supported::contract().contains("Record<string, never>"));
}
#[test]
fn wire_enum_export_and_serde_agree() {
    assert_eq!(
        serde_json::to_value(credential_types::Status::DeletePending).unwrap(),
        "delete-pending"
    );
    assert!(credential_types::Status::typescript().contains("\"delete-pending\""));
    assert_eq!(
        serde_json::to_value(PlatformFailure {
            code: storage::StateErrorCode::StateCorrupt,
            outcome: CommitOutcome::NotCommitted
        })
        .unwrap(),
        serde_json::json!({"code":"state-corrupt","outcome":"not-committed"})
    );
    assert!(PlatformFailure::typescript().contains("\"state-corrupt\""));
}
#[test]
fn feature_contract_matches_the_registered_command_set() {
    let output = ipc_typescript();
    assert_eq!(output.matches(": { args:").count(), 20);
    assert!(output.contains(
        "credential_request: { args: { owner: string; id: string; binding: string; body: string }"
    ));
    assert!(output.contains("platform_call:"));
}
