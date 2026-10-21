import { OperationCoordinator } from "../core/index.js";
import { NativeOperationExecutor } from "./execute.js";
import {
  createZoteroNativeApi, ZoteroLibraryAdapter, ZoteroOperationRecovery,
  MutableZoteroAccessGate, type ZoteroNativeEnvironment,
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
import type { ZoteroReaderRenderingAdapter } from "../adapters/reader/index.js";
import type { ZoteroViewerVerificationPort } from "../ports/zotero.js";

export interface ProductionConnectionEnvironment extends GeckoFileBridgeGlobals {
  Zotero: ZoteroNativeEnvironment["Zotero"] & { Profile: { dir: string } };
  IOUtils: GeckoFileBridgeGlobals["IOUtils"] & IOUtilsTextApi & ZoteroNativeEnvironment["IOUtils"];
  PathUtils: GeckoFileBridgeGlobals["PathUtils"] & PathUtilsApi;
  crypto: ZoteroNativeEnvironment["crypto"] & { randomUUID(): string };
  cloneInto: ZoteroNativeEnvironment["cloneInto"];
  reportError(error: unknown): void;
}

/** Production composition: all operations remain behind their existing ports. */
export async function openProductionConnection(
  environment: ProductionConnectionEnvironment,
  version: string,
  directory: string,
  previews: Pick<ZoteroReaderRenderingAdapter, "verifyVisiblePreview">,
): Promise<{ profileId: string; subscription: FileBridgeSubscription; close(): Promise<void> }> {
  const gate = new MutableZoteroAccessGate(true);
  const native = createZoteroNativeApi({ ...environment, accessGate: gate });
  const digest = new WebCryptoPayloadDigest(environment.crypto);
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
  const library = new ZoteroLibraryAdapter({
    native, digest, profileId, pluginVersion: version, enabled: true,
    accessGate: gate, transport: bridge.describe(),
  });
  const viewer: ZoteroViewerVerificationPort = {
    async verifyAnnotationInViewer(request) {
      const { libraryId, attachmentKey, annotationKey } = request.payload;
      const item = await environment.Zotero.Items.getByLibraryAndKeyAsync(Number(libraryId), attachmentKey);
      const record = await native.getAnnotation(libraryId, attachmentKey, annotationKey);
      if (item && item.id !== undefined && record && await previews.verifyVisiblePreview({
        attachmentItemId: item.id, annotationKey, expectedNativeComment: record.comment,
      })) {
        return { confirmed: true, description: "Current native annotation content is visible in its formatted reader preview" };
      }
      return library.verifyAnnotationInViewer(request);
    },
  };
  const executor = new NativeOperationExecutor({
    reads: library, writes: library, storage: library, viewer,
    anchors: new ZoteroAnchorResolver(library),
  });
  const coordinator = new OperationCoordinator({
    store, digest, serializer: new KeyedMutationSerializer(),
  });
  const recovery = new ZoteroOperationRecovery(native, digest);
  try {
    const subscription = await bridge.listen(async (request, connectedProfile) => {
      const result = await coordinator.submit(request, connectedProfile,
        (accepted, identity) => executor.execute(accepted, identity));
      return result.state === "running"
        ? coordinator.reconcileRunning(request.operationId, connectedProfile, recovery)
        : result;
    });
    return {
      profileId, subscription,
      async close() {
        // Close mutation authority before awaiting transport shutdown.
        library.setEnabled(false);
        await subscription.close();
      },
    };
  } catch (error) {
    library.setEnabled(false);
    throw error;
  }
}
