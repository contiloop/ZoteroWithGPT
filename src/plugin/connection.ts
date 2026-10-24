import { OperationCoordinator } from "../core/index.js";
import { NativeOperationExecutor } from "./execute.js";
import {
  createZoteroNativeApi, DomPurifyNativeNoteContentPolicy,
  ZoteroLibraryAdapter, ZoteroOperationRecovery,
  MutableZoteroAccessGate, type ZoteroNativeEnvironment,
  LegacyArxivRecovery,
  type DomPurifyNativeNoteContentPolicyOptions,
} from "../adapters/zotero/index.js";
import { ZoteroAnchorResolver } from "../adapters/anchors/index.js";
import {
  DurableOperationStore, KeyedMutationSerializer, WebCryptoPayloadDigest,
  IOUtilsAtomicTextFile, recommendedOperationStorePath,
  type IOUtilsTextApi, type PathUtilsApi,
} from "../adapters/operation-store/index.js";
import {
  FileBridgeTransport, GeckoFileBridgeFileSystem,
  type GeckoFileBridgeGlobals, type FileBridgeSubscription,
} from "../adapters/file-bridge/index.js";
import type {
  FormattedPreviewVerificationPort,
  VisiblePreviewFailureReason,
  ZoteroViewerVerificationPort,
} from "../ports/zotero.js";
import { BASE_OPERATION_NAMES, LOCAL_STUDY_OPERATION_NAMES } from "../protocol/index.js";

export interface ProductionConnectionEnvironment extends GeckoFileBridgeGlobals {
  Zotero: ZoteroNativeEnvironment["Zotero"] & {
    Profile: { dir: string };
  };
  IOUtils: GeckoFileBridgeGlobals["IOUtils"] & IOUtilsTextApi &
    ZoteroNativeEnvironment["IOUtils"];
  PathUtils: GeckoFileBridgeGlobals["PathUtils"] & PathUtilsApi;
  crypto: ZoteroNativeEnvironment["crypto"] & { randomUUID(): string };
  cloneInto: ZoteroNativeEnvironment["cloneInto"];
  noteWindow: DomPurifyNativeNoteContentPolicyOptions["window"];
  reportError(error: unknown): void;
}

export interface ViewerVerificationDependencies {
  findAttachment(
    libraryId: number,
    attachmentKey: string,
  ): Promise<{ id?: number } | false | undefined>;
  readAnnotation(
    libraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<{ comment: string } | undefined>;
  formattedPreview: FormattedPreviewVerificationPort;
  nativeViewer: ZoteroViewerVerificationPort;
  reportError(error: unknown): void;
}

/** Adds optional formatted-preview evidence without weakening native fallback. */
export function createViewerVerificationPort(
  dependencies: ViewerVerificationDependencies,
): ZoteroViewerVerificationPort {
  return {
    async verifyAnnotationInViewer(request) {
      const { libraryId, attachmentKey, annotationKey } = request.payload;
      const item = await dependencies.findAttachment(Number(libraryId), attachmentKey);
      const record = await dependencies.readAnnotation(libraryId, attachmentKey, annotationKey);
      let formattedFailure: VisiblePreviewFailureReason | "attachment_record_missing" |
        "annotation_record_missing" | "inspection_error";
      if (item && item.id !== undefined && record) {
        try {
          const inspection = await dependencies.formattedPreview.inspectVisiblePreview({
            attachmentItemId: item.id,
            annotationKey,
            expectedNativeComment: record.comment,
          });
          if (inspection.visible) {
            return {
              confirmed: true,
              description: "Current native annotation content is visible in its formatted reader preview",
            };
          }
          formattedFailure = inspection.reason;
        } catch (error) {
          formattedFailure = "inspection_error";
          dependencies.reportError(error);
        }
      } else if (!item || item.id === undefined) {
        formattedFailure = "attachment_record_missing";
      } else {
        formattedFailure = "annotation_record_missing";
      }
      const nativeResult = await dependencies.nativeViewer.verifyAnnotationInViewer(request);
      if (nativeResult.confirmed) return nativeResult;
      return {
        ...nativeResult,
        description: `${nativeResult.description} Formatted preview check failed at gate ` +
          `"${formattedFailure}".`,
      };
    },
  };
}

/** Production composition: all operations remain behind their existing ports. */
export async function openProductionConnection(
  environment: ProductionConnectionEnvironment,
  version: string,
  directory: string,
  previews: FormattedPreviewVerificationPort,
): Promise<{ profileId: string; subscription: FileBridgeSubscription; close(): Promise<void> }> {
  const gate = new MutableZoteroAccessGate(true);
  const noteContent = new DomPurifyNativeNoteContentPolicy({ window: environment.noteWindow });
  const digest = new WebCryptoPayloadDigest(environment.crypto);
  const native = createZoteroNativeApi({
    ...environment,
    noteContent,
    accessGate: gate,
  });
  const store = new DurableOperationStore(
    new IOUtilsAtomicTextFile(environment.IOUtils, environment.PathUtils,
      recommendedOperationStorePath(environment.Zotero.Profile.dir, environment.PathUtils)),
    { generateProfileId: () => environment.crypto.randomUUID() },
  );
  const profileId = await store.profileId();
  const bridge = new FileBridgeTransport({
    fileSystem: new GeckoFileBridgeFileSystem(environment), directory,
    connectedProfileId: profileId, onError: environment.reportError,
  });
  const activeOperations = [...BASE_OPERATION_NAMES, ...LOCAL_STUDY_OPERATION_NAMES];
  const library = new ZoteroLibraryAdapter({
    native, noteContent, digest, profileId, pluginVersion: version, enabled: true,
    accessGate: gate, transport: bridge.describe(), operations: activeOperations,
  });
  const viewer = createViewerVerificationPort({
    findAttachment: (libraryId, attachmentKey) =>
      environment.Zotero.Items.getByLibraryAndKeyAsync(libraryId, attachmentKey),
    readAnnotation: (libraryId, attachmentKey, annotationKey) =>
      native.getAnnotation(libraryId, attachmentKey, annotationKey),
    formattedPreview: previews,
    nativeViewer: library,
    reportError: environment.reportError,
  });
  const executor = new NativeOperationExecutor({
    reads: library, writes: library, storage: library, viewer,
    anchors: new ZoteroAnchorResolver(library),
  });
  const coordinator = new OperationCoordinator({
    store, digest, serializer: new KeyedMutationSerializer(),
  });
  const recovery = new ZoteroOperationRecovery(native, digest, new LegacyArxivRecovery(native, store));
  try {
    await coordinator.recoverPending(profileId, recovery);
    const subscription = await bridge.listen(async (request, connectedProfile) => {
      const result = await coordinator.submit(request, connectedProfile,
        (accepted, identity) => executor.execute(accepted, identity));
      return result.state === "running"
        ? coordinator.reconcileRunning(request.operationId, connectedProfile, recovery)
        : result;
    });
    let close: Promise<void> | undefined;
    return {
      profileId, subscription,
      close() {
        if (close !== undefined) return close;
        // Close mutation authority before awaiting transport shutdown.
        library.setEnabled(false);
        try {
          close = subscription.close();
        } catch (error) {
          close = Promise.reject(error);
        }
        return close;
      },
    };
  } catch (error) {
    library.setEnabled(false);
    throw error;
  }
}
