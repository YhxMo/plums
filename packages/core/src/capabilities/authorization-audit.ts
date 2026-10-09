import { randomUUID } from "node:crypto";
import { CAPABILITY_FAILED, PlumsError } from "../errors.js";
import { knownSecrets } from "../install/settings.js";
import { redact } from "../redact.js";
import type { ServiceContext } from "./services.js";
import type { AuditEvent } from "./types.js";

export interface AuthorizationFailureControl {
  callId?: string;
  grantId?: string;
  phase: string;
  executionState: "not_started" | "completed";
}

/** Private to one public authorization call; never accepts adapter provenance. */
export interface AuthorizationCall {
  failures: WeakMap<PlumsError, Readonly<AuthorizationFailureControl>>;
  secrets: Set<string>;
}

export function authorizationFailure(
  call: AuthorizationCall | undefined,
  message: string,
  control: AuthorizationFailureControl,
): PlumsError {
  const fixed = Object.freeze({ ...control });
  const error = new PlumsError({
    code: CAPABILITY_FAILED,
    message,
    details: fixed,
  });
  call?.failures.set(error, fixed);
  return error;
}

type Subject =
  | { kind: "engine"; extensionId: string; grantId: string }
  | { kind: "service"; extensionId: string; permissionId: string };

export async function authorizationAudit(
  ctx: ServiceContext,
  subject: Subject,
  phase: "grant" | "revoke",
  call?: AuthorizationCall,
): Promise<void> {
  const callId = randomUUID();
  try {
    if (!ctx.onAudit) throw new Error();
    const secrets = call?.secrets ?? new Set<string>();
    for (const value of await knownSecrets(ctx)) secrets.add(value);
    const values = [...secrets];
    // Only this constructor's generated controls survive collisions. Declaration
    // text remains redacted; arbitrary business objects never pass this boundary.
    const event: AuditEvent = {
      callId,
      timestamp: new Date().toISOString(),
      extensionId: redact(subject.extensionId, values),
      ...(subject.kind === "engine"
        ? { grantId: subject.grantId }
        : { permissionId: redact(subject.permissionId, values) }),
      kind: subject.kind,
      phase,
      outcome: phase === "grant" ? "allowed" : "completed",
      executionState: phase === "grant" ? "not_started" : "completed",
    };
    await ctx.onAudit(Object.freeze(event));
  } catch {
    throw authorizationFailure(
      call,
      subject.kind === "engine"
        ? "授权审计未能完成。"
        : "后台授权审计未能完成。",
      {
        callId,
        phase: "audit_" + phase,
        executionState: phase === "grant" ? "not_started" : "completed",
      },
    );
  }
}
