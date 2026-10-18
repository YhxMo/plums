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
    #[cfg(not(feature = "native-transport-experiment"))]
    {
        assert_eq!(output.matches(": { args:").count(), 17);
        assert!(output.contains("platform_call:"));
        assert!(!output.contains("probe_info:"));
    }
    #[cfg(feature = "native-transport-experiment")]
    {
        assert_eq!(output.matches(": { args:").count(), 6);
        assert!(output.contains("extends NativeCommands"));
        assert!(output.contains("prepare_receipt?: boolean"));
        let faults: transport_probe::Faults =
            serde_json::from_value(serde_json::json!({"prepare_receipt":true})).unwrap();
        let _ = faults;
        assert!(serde_json::from_value::<transport_probe::Faults>(
            serde_json::json!({"prepareReceipt":true})
        )
        .is_err());
    }
}
