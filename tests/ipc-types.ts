// Included by tsc; this function is never run. Errors must remain compile-time failures.
import * as productionBridge from "../src/native/invoke";
import { invokeNative } from "../src/native/invoke";
import { invokeExperimental } from "./fixtures/native-invoke";
import type { NativeCommands } from "../src/native/contract.generated";
import type {
  CredentialBindingDeclaration,
  NetworkRoute,
  SelectedDocument,
} from "../modules/sdk";
export function checkNativeContractTypes() {
  // @ts-expect-error The production bridge cannot expose experimental commands.
  void productionBridge.invokeExperimental("probe_info");
  void invokeNative("document_read", {
    owner: "sample",
    operationId: "one",
    handle: "h",
    maxBytes: 10,
  });
  void invokeNative("document_revoke", { owner: "sample" });
  void invokeNative("credential_supported");
  // @ts-expect-error Unknown command names cannot reach the bridge.
  void invokeNative("document_read_renamed", {});
  void invokeNative("document_read", {
    owner: "sample",
    // @ts-expect-error The wire uses camelCase, not the Rust identifier.
    operation_id: "one",
    handle: "h",
    maxBytes: 10,
  });
  void invokeNative("document_read", {
    owner: "sample",
    operationId: "one",
    handle: "h",
    // @ts-expect-error Argument type changes are observed at the caller.
    maxBytes: "10",
  });
  // @ts-expect-error Required revision cannot be omitted.
  void invokeNative("credential_delete", { owner: "sample", alias: "text" });
  // @ts-expect-error No-argument commands do not accept accidental payload fields.
  void invokeNative("credential_supported", { owner: "sample" });
  // @ts-expect-error Probe commands are not in the ordinary native contract.
  void invokeNative("probe_info");
  void invokeExperimental("probe_faults", {
    owner: "probe.alpha",
    faults: { prepare_receipt: true },
  });
  void invokeExperimental("probe_faults", {
    owner: "probe.alpha",
    // @ts-expect-error Nested fault keys retain their existing snake_case wire names.
    faults: { prepareReceipt: true },
  });
}
type Assert<T extends true> = T;
type Binding = NativeCommands["credential_list"]["response"][number];
export type PublicContractCompatibility = [
  Assert<
    Binding["declaration"] extends CredentialBindingDeclaration ? true : false
  >,
  Assert<
    CredentialBindingDeclaration extends Binding["declaration"] ? true : false
  >,
  Assert<Binding["route"] extends NetworkRoute ? true : false>,
  Assert<NetworkRoute extends Binding["route"] ? true : false>,
  Assert<
    NativeCommands["document_list"]["response"][number] extends SelectedDocument
      ? true
      : false
  >,
];
export const invalidResponse: NativeCommands["credential_configure"]["response"] =
  // @ts-expect-error A response status cannot drift to the binding-record status.
  { status: "ready" };
// @ts-expect-error A required response field cannot disappear.
export const missingResponseField: NativeCommands["document_list"]["response"][number] =
  { name: "document" };
