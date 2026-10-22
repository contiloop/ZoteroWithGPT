import { CoreOperationError, revalidateAnnotationAnchor } from "../core/index.js";
import type {
  AnchorResolutionPort, AnchorRevalidationPort, OperationExecutionOutcome,
  OperationExecutorPort, OperationIdentity, ZoteroReadPort, ZoteroWritePort,
  ZoteroStorageReadbackPort, ZoteroViewerVerificationPort,
} from "../ports/index.js";
import type { ProtocolRequest, VerificationSummary, VerificationDetail, VerificationState } from "../protocol/index.js";

export interface NativeExecutionDependencies {
  reads: ZoteroReadPort;
  writes: ZoteroWritePort;
  anchors: AnchorResolutionPort & AnchorRevalidationPort;
  storage: ZoteroStorageReadbackPort;
  viewer: ZoteroViewerVerificationPort;
}

const readVerification: VerificationSummary = {
  storage: "not_applicable", viewer: "not_applicable",
};

function completed(data: object, verification = readVerification): OperationExecutionOutcome {
  return { kind: "completed", data, verification: { ...verification } };
}

// A returned native result may already be committed. Failed readback must never
// turn that write into a pre-commit rejection or invite a fresh blind write.
async function readbackStatus(read: () => Promise<VerificationDetail>): Promise<VerificationState> {
  try {
    return (await read()).confirmed ? "confirmed" : "failed";
  } catch {
    return "not_checked";
  }
}

/** Routes validated requests; the coordinator owns authorization and identity. */
export class NativeOperationExecutor implements OperationExecutorPort {
  constructor(private readonly ports: NativeExecutionDependencies) {}

  async execute(request: ProtocolRequest, identity: OperationIdentity): Promise<OperationExecutionOutcome> {
    try {
      return await this.dispatch(request, identity);
    } catch (error) {
      if (!(error instanceof CoreOperationError)) throw error;
      // Storage failures can occur after commit. Let the coordinator mark a
      // mutation indeterminate instead of reporting a safe preflight rejection.
      if (error.code === "storage_error" || error.code === "verification_failed") throw error;
      return {
        kind: error.code === "unknown_outcome" ? "indeterminate" : "rejected",
        error: error.toProtocolError(),
        verification: { storage: "not_checked", viewer: "not_checked" },
      };
    }
  }

  private async dispatch(request: ProtocolRequest, identity: OperationIdentity): Promise<OperationExecutionOutcome> {
    const { reads, writes, anchors, storage, viewer } = this.ports;
    switch (request.operation) {
      case "connection_status": return completed(await reads.connectionStatus(request));
      case "search_papers": return completed(await reads.searchPapers(request));
      case "read_pdf": return completed(await reads.readPdf(request));
      case "list_annotations": return completed(await reads.listAnnotations(request));
      case "list_notes": return completed(await reads.listNotes(request));
      case "read_note": return completed(await reads.readNote(request));
      case "resolve_anchor": return completed(await anchors.resolve(request));
      case "create_annotation": {
        const check = await revalidateAnnotationAnchor(request, anchors, identity);
        if (!check.ok) throw check.error;
        const saved = await writes.createAnnotation(request, check.anchor, identity);
        const status = await readbackStatus(() => storage.confirmAnnotation({
          libraryId: check.anchor.libraryId,
          attachmentKey: check.anchor.attachmentKey,
          annotationKey: saved.annotationKey,
          expectedRevision: saved.revision,
        }, identity));
        return completed(saved, {
          storage: status, viewer: "not_checked",
        });
      }
      case "update_annotation": {
        const saved = await writes.updateAnnotation(request, identity);
        const status = await readbackStatus(() => storage.confirmAnnotation({
          libraryId: request.payload.libraryId,
          attachmentKey: request.payload.attachmentKey,
          annotationKey: saved.annotationKey,
          expectedRevision: saved.revision,
        }, identity));
        return completed(saved, {
          storage: status, viewer: "not_checked",
        });
      }
      case "create_note": {
        const saved = await writes.createNote(request, identity);
        const status = await readbackStatus(() => storage.confirmNote({
          libraryId: request.payload.libraryId,
          itemKey: request.payload.itemKey,
          noteKey: saved.noteKey,
          expectedRevision: saved.revision,
        }, identity));
        return completed(saved, {
          storage: status, viewer: "not_applicable",
        });
      }
      case "update_note": {
        const saved = await writes.updateNote(request, identity);
        const status = await readbackStatus(() => storage.confirmNote({
          libraryId: request.payload.libraryId,
          itemKey: request.payload.itemKey,
          noteKey: saved.noteKey,
          expectedRevision: saved.revision,
        }, identity));
        return completed(saved, {
          storage: status, viewer: "not_applicable",
        });
      }
      case "verify_annotation": {
        const storageEvidence = await storage.verifyAnnotationStorage(request);
        const viewerEvidence = await viewer.verifyAnnotationInViewer(request);
        return completed({
          annotationKey: request.payload.annotationKey, storageEvidence, viewerEvidence,
        }, {
          storage: storageEvidence.confirmed ? "confirmed" : "failed",
          viewer: viewerEvidence.confirmed ? "confirmed" : "failed",
        });
      }
      case "inspect_arxiv":
      case "ensure_arxiv_pdf":
        throw new CoreOperationError(
          "unsupported_capability",
          `${request.operation} is defined by protocol v1 but is not active in this build`,
        );
    }
  }
}
