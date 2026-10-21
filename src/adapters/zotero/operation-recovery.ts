import type { OperationRecord } from "../../core/operation-record.js";
import type { PayloadDigestPort } from "../../ports/digest.js";
import type {
  OperationExecutionOutcome,
  OperationRecoveryPort,
} from "../../ports/execution.js";
import type { NativeAnnotationRecord, NativeNoteRecord, ZoteroNativeApi } from "./native-api.js";
import {
  annotationDeepLink,
  annotationRevision,
  noteDeepLink,
  noteRevision,
  operationIdentityMarker,
} from "./record-utils.js";

function unknown(message: string): OperationExecutionOutcome {
  return {
    kind: "indeterminate",
    error: { code: "unknown_outcome", message, retryable: false },
    verification: { storage: "not_checked", viewer: "not_checked" },
  };
}

function isAnnotation(record: NativeAnnotationRecord | NativeNoteRecord): record is NativeAnnotationRecord {
  return "annotationKey" in record;
}

export class ZoteroOperationRecovery implements OperationRecoveryPort {
  readonly #native: ZoteroNativeApi;
  readonly #digest: PayloadDigestPort;

  constructor(native: ZoteroNativeApi, digest: PayloadDigestPort) {
    this.#native = native;
    this.#digest = digest;
  }

  async reconcile(record: OperationRecord): Promise<OperationExecutionOutcome> {
    const marker = operationIdentityMarker({
      operationId: record.operationId,
      requestDigest: record.requestDigest,
    });
    const matches = await this.#native.findByOperationMarker(marker);
    if (matches.length === 0) {
      return unknown(
        "No native object carries the historical operation identity; the write must not be retried blindly",
      );
    }
    if (matches.length !== 1) {
      return unknown(
        `The historical operation identity appears on ${matches.length} native objects; reconciliation is ambiguous`,
      );
    }
    const match = matches[0];
    if (match === undefined) return unknown("The native recovery result disappeared");

    if (record.operation === "create_annotation" || record.operation === "update_annotation") {
      if (!isAnnotation(match)) {
        return unknown("The historical annotation operation identity is attached to a different item type");
      }
      const revision = await annotationRevision(match, this.#digest);
      const data =
        record.operation === "create_annotation"
          ? {
              annotationKey: match.annotationKey,
              revision,
              deepLink: annotationDeepLink(match),
              saved: {
                pageIndex: match.pageIndex,
                pageLabel: match.pageLabel,
                rectangles: match.rectangles.map((rectangle) => ({ ...rectangle })),
                ...(match.text === undefined ? {} : { selectedText: match.text }),
                comment: match.comment,
              },
            }
          : {
              annotationKey: match.annotationKey,
              revision,
              comment: match.comment,
              deepLink: annotationDeepLink(match),
            };
      return {
        kind: "completed",
        data,
        verification: { storage: "confirmed", viewer: "not_checked" },
      };
    }

    if (record.operation === "create_note" || record.operation === "update_note") {
      if (isAnnotation(match)) {
        return unknown("The historical child-note operation identity is attached to an annotation");
      }
      return {
        kind: "completed",
        data: {
          noteKey: match.noteKey,
          revision: await noteRevision(match, this.#digest),
          content: match.content,
          deepLink: noteDeepLink(match),
        },
        verification: { storage: "confirmed", viewer: "not_checked" },
      };
    }

    return unknown("Only native mutations can be reconciled from operation identity metadata");
  }
}
