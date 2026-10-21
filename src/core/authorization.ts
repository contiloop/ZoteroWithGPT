import {
  isMutationOperation,
  type ProtocolRequest,
} from "../protocol/index.js";
import { CoreOperationError } from "./errors.js";

/** Enforces connection/profile scope again at the execution boundary. */
export function assertRequestAuthorizedForProfile(
  request: ProtocolRequest,
  connectedProfileId: string | undefined,
): void {
  if (request.operation === "connection_status") return;
  if (connectedProfileId === undefined) {
    throw new CoreOperationError("not_connected", "No enabled Zotero profile is connected");
  }
  if (request.profileId !== connectedProfileId) {
    throw new CoreOperationError(
      "permission_denied",
      "The request profile does not match the connected Zotero profile",
    );
  }
  if (isMutationOperation(request.operation)) {
    const authorization = "authorization" in request ? request.authorization : undefined;
    if (
      authorization === undefined ||
      (authorization.kind !== "explicit_request" && authorization.kind !== "approved_proposal") ||
      authorization.scope.trim().length === 0
    ) {
      throw new CoreOperationError(
        "permission_denied",
        "The mutation is outside an accepted authorization scope",
      );
    }
  }
}

export function assertMutationAuthorizedForProfile(
  request: ProtocolRequest,
  connectedProfileId: string | undefined,
): void {
  if (!isMutationOperation(request.operation)) {
    throw new CoreOperationError("invalid_request", "Expected a mutation request");
  }
  assertRequestAuthorizedForProfile(request, connectedProfileId);
}
