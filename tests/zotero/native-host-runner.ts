/**
 * Developer-only Zotero host checks. This module has no startup side effects.
 * A caller must invoke a named export and mutation checks require both a
 * literal opt-in and a pre-existing ownership marker child note.
 */
import { CoreOperationError, type OperationRecord } from "../../src/core/index.js";
import { ZoteroAnchorResolver } from "../../src/adapters/anchors/index.js";
import { renderTextLayer } from "../../src/adapters/anchors/text-layer.js";
import { WebCryptoPayloadDigest } from "../../src/adapters/operation-store/index.js";
import {
  MutableZoteroAccessGate,
  ZoteroLibraryAdapter,
  ZoteroOperationRecovery,
  createZoteroNativeApi,
  operationIdentityMarker,
  type ZoteroNativeApi,
  type ZoteroNativeEnvironment,
} from "../../src/adapters/zotero/index.js";
import type { ProtocolErrorCode, ResolvedAnchor } from "../../src/protocol/types.js";

export const OWNED_FIXTURE_MARKER =
  "ZOTERO_AI_RESEARCH_COMPANION_OWNED_NATIVE_FIXTURE_V1";

export interface OwnedNativeFixture {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  ownershipNoteKey: string;
  pageIndex: number;
  exactQuote: string;
  quotePrefix?: string;
  quoteSuffix?: string;
  /** Optional quote deliberately repeated on the fixture page. */
  ambiguousQuote?: string;
}

export interface OwnedMutationInvocation {
  fixture: OwnedNativeFixture;
  /** Must be a fresh safe ID for a first run. Reuse triggers recovery only. */
  runId: string;
  allowMutations: true;
}

interface OwnedContext {
  native: ZoteroNativeApi;
  attachment: NonNullable<Awaited<ReturnType<ZoteroNativeApi["getPdfAttachment"]>>>;
}

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(runId)) {
    throw new Error("runId must be a safe opaque ID of at most 64 characters");
  }
}

function operationId(runId: string, suffix: string): string {
  return `dev-${runId}-${suffix}`;
}

async function ownedContext(
  environment: ZoteroNativeEnvironment,
  fixture: OwnedNativeFixture,
): Promise<OwnedContext> {
  const native = createZoteroNativeApi(environment);
  const ownershipNote = await native.getNote(
    fixture.libraryId,
    fixture.itemKey,
    fixture.ownershipNoteKey,
  );
  if (ownershipNote === undefined || !ownershipNote.content.includes(OWNED_FIXTURE_MARKER)) {
    throw new Error(
      `Refusing fixture access: child note ${fixture.ownershipNoteKey} does not contain ${OWNED_FIXTURE_MARKER}`,
    );
  }
  const attachment = await native.getPdfAttachment(
    fixture.libraryId,
    fixture.attachmentKey,
    fixture.itemKey,
  );
  if (attachment === undefined) {
    throw new Error("The explicitly owned fixture PDF was not found under the fixture item");
  }
  if (fixture.pageIndex < 0 || fixture.pageIndex >= attachment.pageCount) {
    throw new Error("The owned fixture page index is outside the current PDF");
  }
  return { native, attachment };
}

/**
 * First host check to invoke. It reads bounded runtime and fixture evidence and
 * never creates or updates a Zotero object.
 */
export async function runZoteroNativeReadOnlyHealth(
  environment: ZoteroNativeEnvironment,
  fixture?: OwnedNativeFixture,
): Promise<Record<string, unknown>> {
  const native = createZoteroNativeApi(environment);
  const runtime = await native.runtimeStatus();
  if (fixture === undefined) {
    return { mode: "read_only", runtime };
  }
  const owned = await ownedContext(environment, fixture);
  const page = await owned.native.readPdfPage(owned.attachment, fixture.pageIndex);
  const layer = renderTextLayer(page.chars);
  const exactOccurrences = layer.text.split(fixture.exactQuote).length - 1;
  const ambiguousOccurrences =
    fixture.ambiguousQuote === undefined
      ? undefined
      : layer.text.split(fixture.ambiguousQuote).length - 1;
  return {
    mode: "read_only",
    runtime,
    fixture: {
      libraryId: fixture.libraryId,
      itemKey: fixture.itemKey,
      attachmentKey: fixture.attachmentKey,
      fingerprint: owned.attachment.fingerprint,
      pageCount: owned.attachment.pageCount,
      pageIndex: page.pageIndex,
      pageLabel: page.pageLabel,
      nativeCharacterCount: page.chars.length,
      normalizedTextLength: layer.text.length,
      exactQuoteOccurrences: exactOccurrences,
      ...(ambiguousOccurrences === undefined ? {} : { ambiguousQuoteOccurrences: ambiguousOccurrences }),
    },
  };
}

function expectedError(error: unknown, code: ProtocolErrorCode): boolean {
  return error instanceof CoreOperationError && error.code === code;
}

function runningRecord(
  operation: "create_annotation",
  id: string,
  requestDigest: string,
): OperationRecord {
  return {
    protocolVersion: 1,
    operationId: id,
    requestDigest,
    operation,
    profileId: "developer-owned-native-fixture",
    mutation: true,
    state: "running",
    response: {
      protocolVersion: 1,
      operationId: id,
      state: "running",
      data: null,
      error: null,
      verification: { storage: "not_checked", viewer: "not_checked" },
    },
  };
}

/**
 * Adds one annotation and one child note to the marked fixture, then updates
 * both. It never deletes data. Reusing a runId performs marker recovery and
 * refuses to issue another write.
 */
export async function runZoteroOwnedFixtureMutationChecks(
  environment: ZoteroNativeEnvironment,
  invocation: OwnedMutationInvocation,
): Promise<Record<string, unknown>> {
  if (invocation.allowMutations !== true) {
    throw new Error("allowMutations must be the literal value true");
  }
  assertSafeRunId(invocation.runId);
  const { fixture, runId } = invocation;
  const owned = await ownedContext(environment, fixture);
  const gate = environment.accessGate ?? new MutableZoteroAccessGate(true);
  if (!gate.isEnabled()) throw new Error("The live Zotero access gate is disabled");
  const native =
    environment.accessGate === gate
      ? owned.native
      : createZoteroNativeApi({ ...environment, accessGate: gate });
  const digest = new WebCryptoPayloadDigest(environment.crypto);
  const library = new ZoteroLibraryAdapter({
    native,
    noteContent: environment.noteContent,
    digest,
    profileId: "developer-owned-native-fixture",
    pluginVersion: "developer-native-runner",
    enabled: true,
    accessGate: gate,
    transport: { kind: "custom", description: "Explicit developer-owned Zotero fixture" },
  });
  const resolver = new ZoteroAnchorResolver(library);
  const recovery = new ZoteroOperationRecovery(native, digest);

  const createId = operationId(runId, "annotation-create");
  const createDigest = await digest.digest(new TextEncoder().encode(createId));
  const createIdentity = { operationId: createId, requestDigest: createDigest };
  const prior = await native.findByOperationMarker(operationIdentityMarker(createIdentity));
  if (prior.length > 0) {
    const outcome = await recovery.reconcile(
      runningRecord("create_annotation", createId, createDigest),
    );
    return {
      mode: "owned_mutation",
      status: "recovered_no_write",
      priorNativeMatches: prior.length,
      recoveryKind: outcome.kind,
      storageEvidence:
        outcome.kind === "completed" ? outcome.verification.storage : "not_checked",
    };
  }

  const resolveRequest = {
    protocolVersion: 1 as const,
    operationId: operationId(runId, "resolve"),
    operation: "resolve_anchor" as const,
    profileId: "developer-owned-native-fixture",
    payload: {
      libraryId: fixture.libraryId,
      attachmentKey: fixture.attachmentKey,
      fingerprint: owned.attachment.fingerprint,
      pageIndex: fixture.pageIndex,
      quote: {
        exact: fixture.exactQuote,
        ...(fixture.quotePrefix === undefined ? {} : { prefix: fixture.quotePrefix }),
        ...(fixture.quoteSuffix === undefined ? {} : { suffix: fixture.quoteSuffix }),
      },
    },
  };
  const resolved = await resolver.resolve(resolveRequest);
  if (resolved.status !== "resolved") {
    throw new Error(`Owned fixture quote did not resolve uniquely: ${resolved.reason}`);
  }
  const revalidated = await resolver.revalidate(resolved.anchor);
  if (revalidated.status !== "confirmed") {
    throw new Error(`Owned fixture anchor revalidation failed: ${revalidated.reason}`);
  }

  let repeatedQuoteEvidence: Record<string, unknown> = { checked: false };
  if (fixture.ambiguousQuote !== undefined) {
    const ambiguous = await resolver.resolve({
      ...resolveRequest,
      operationId: operationId(runId, "resolve-ambiguous"),
      payload: {
        ...resolveRequest.payload,
        quote: { exact: fixture.ambiguousQuote },
      },
    });
    if (ambiguous.status !== "unresolved" || ambiguous.candidates.length < 2) {
      throw new Error("The fixture ambiguous quote did not remain unresolved with candidates");
    }
    repeatedQuoteEvidence = { checked: true, candidateCount: ambiguous.candidates.length };
  }

  const nativePage = await library.readAnchorPage(
    fixture.libraryId,
    fixture.attachmentKey,
    fixture.pageIndex,
  );
  const [left, bottom, right, top] = nativePage.viewBox;
  const coordinateOnly = await resolver.resolve({
    ...resolveRequest,
    operationId: operationId(runId, "resolve-coordinate-only"),
    payload: {
      libraryId: fixture.libraryId,
      attachmentKey: fixture.attachmentKey,
      fingerprint: owned.attachment.fingerprint,
      pageIndex: fixture.pageIndex,
      inspectedRegion: {
        rectangles: [
          {
            x1: left,
            y1: bottom,
            x2: left + Math.min(1, (right - left) / 2),
            y2: bottom + Math.min(1, (top - bottom) / 2),
          },
        ],
      },
    },
  });
  if (coordinateOnly.status !== "unresolved") {
    throw new Error("An unevidenced coordinate-only region was unexpectedly accepted");
  }

  const createRequest = {
    protocolVersion: 1 as const,
    operationId: createId,
    operation: "create_annotation" as const,
    profileId: "developer-owned-native-fixture",
    authorization: {
      kind: "explicit_request" as const,
      scope: `Developer-owned native fixture ${runId}`,
    },
    payload: {
      anchor: revalidated.anchor,
      type: "highlight" as const,
      comment: `Research Companion owned fixture annotation ${runId}`,
      color: "#ffd400" as const,
    },
  };
  const created = await library.createAnnotation(
    createRequest,
    revalidated.anchor,
    createIdentity,
  );
  const storage = await library.confirmAnnotation(
    {
      libraryId: fixture.libraryId,
      attachmentKey: fixture.attachmentKey,
      annotationKey: created.annotationKey,
      expectedRevision: created.revision,
    },
    createIdentity,
  );
  if (!storage.confirmed) throw new Error(`Native annotation storage failed: ${storage.description}`);

  const updateId = operationId(runId, "annotation-update");
  const updateIdentity = {
    operationId: updateId,
    requestDigest: await digest.digest(new TextEncoder().encode(updateId)),
  };
  const updated = await library.updateAnnotation(
    {
      protocolVersion: 1,
      operationId: updateId,
      operation: "update_annotation",
      profileId: "developer-owned-native-fixture",
      authorization: { kind: "explicit_request", scope: `Update owned fixture ${runId}` },
      payload: {
        libraryId: fixture.libraryId,
        attachmentKey: fixture.attachmentKey,
        annotationKey: created.annotationKey,
        expectedRevision: created.revision,
        mode: "append",
        comment: `Owned fixture update ${runId}`,
      },
    },
    updateIdentity,
  );

  let annotationConflictPreserved = false;
  const staleUpdateId = operationId(runId, "annotation-stale-update");
  try {
    await library.updateAnnotation(
      {
        protocolVersion: 1,
        operationId: staleUpdateId,
        operation: "update_annotation",
        profileId: "developer-owned-native-fixture",
        authorization: { kind: "explicit_request", scope: "Deliberate stale revision check" },
        payload: {
          libraryId: fixture.libraryId,
          attachmentKey: fixture.attachmentKey,
          annotationKey: created.annotationKey,
          expectedRevision: created.revision,
          mode: "replace",
          comment: "This stale write must not commit",
        },
      },
      {
        operationId: staleUpdateId,
        requestDigest: await digest.digest(new TextEncoder().encode(staleUpdateId)),
      },
    );
  } catch (error) {
    annotationConflictPreserved = expectedError(error, "conflict");
  }
  if (!annotationConflictPreserved) throw new Error("The deliberate stale annotation update was not rejected");

  const staleAttachmentId = operationId(runId, "stale-attachment");
  const staleAnchor: ResolvedAnchor = {
    ...revalidated.anchor,
    attachmentFingerprint: `sha256:deliberately-stale-${runId}`,
  };
  let staleAttachmentRejected = false;
  try {
    await library.createAnnotation(
      {
        ...createRequest,
        operationId: staleAttachmentId,
        payload: { ...createRequest.payload, anchor: staleAnchor },
      },
      staleAnchor,
      {
        operationId: staleAttachmentId,
        requestDigest: await digest.digest(new TextEncoder().encode(staleAttachmentId)),
      },
    );
  } catch (error) {
    staleAttachmentRejected = expectedError(error, "stale_attachment");
  }
  if (!staleAttachmentRejected) throw new Error("The deliberate stale PDF identity was not rejected");

  const noteCreateId = operationId(runId, "note-create");
  const noteCreateIdentity = {
    operationId: noteCreateId,
    requestDigest: await digest.digest(new TextEncoder().encode(noteCreateId)),
  };
  const note = await library.createNote(
    {
      protocolVersion: 1,
      operationId: noteCreateId,
      operation: "create_note",
      profileId: "developer-owned-native-fixture",
      authorization: { kind: "explicit_request", scope: `Create owned fixture note ${runId}` },
      payload: {
        libraryId: fixture.libraryId,
        itemKey: fixture.itemKey,
        content: `<p>Research Companion owned fixture note ${runId}</p>`,
      },
    },
    noteCreateIdentity,
  );
  const noteUpdateId = operationId(runId, "note-update");
  const noteUpdated = await library.updateNote(
    {
      protocolVersion: 1,
      operationId: noteUpdateId,
      operation: "update_note",
      profileId: "developer-owned-native-fixture",
      authorization: { kind: "explicit_request", scope: `Update owned fixture note ${runId}` },
      payload: {
        libraryId: fixture.libraryId,
        itemKey: fixture.itemKey,
        noteKey: note.noteKey,
        expectedRevision: note.revision,
        mode: "append",
        content: `<p>Owned fixture note update ${runId}</p>`,
      },
    },
    {
      operationId: noteUpdateId,
      requestDigest: await digest.digest(new TextEncoder().encode(noteUpdateId)),
    },
  );

  let noteConflictPreserved = false;
  const staleNoteId = operationId(runId, "note-stale-update");
  try {
    await library.updateNote(
      {
        protocolVersion: 1,
        operationId: staleNoteId,
        operation: "update_note",
        profileId: "developer-owned-native-fixture",
        authorization: { kind: "explicit_request", scope: "Deliberate stale note revision check" },
        payload: {
          libraryId: fixture.libraryId,
          itemKey: fixture.itemKey,
          noteKey: note.noteKey,
          expectedRevision: note.revision,
          mode: "replace",
          content: "This stale note write must not commit",
        },
      },
      {
        operationId: staleNoteId,
        requestDigest: await digest.digest(new TextEncoder().encode(staleNoteId)),
      },
    );
  } catch (error) {
    noteConflictPreserved = expectedError(error, "conflict");
  }
  if (!noteConflictPreserved) throw new Error("The deliberate stale child-note update was not rejected");

  const recovered = await recovery.reconcile(
    runningRecord("create_annotation", createId, createDigest),
  );
  if (recovered.kind !== "completed") {
    throw new Error("Committed annotation identity could not be recovered after simulated result loss");
  }
  const markerMatches = await native.findByOperationMarker(operationIdentityMarker(createIdentity));
  if (markerMatches.length !== 1) {
    throw new Error(`Expected one committed create marker, found ${markerMatches.length}`);
  }

  const viewer = await library.verifyAnnotationInViewer({
    protocolVersion: 1,
    operationId: operationId(runId, "viewer"),
    operation: "verify_annotation",
    profileId: "developer-owned-native-fixture",
    payload: {
      libraryId: fixture.libraryId,
      attachmentKey: fixture.attachmentKey,
      annotationKey: created.annotationKey,
    },
  });

  return {
    mode: "owned_mutation",
    status: "completed",
    annotation: {
      key: created.annotationKey,
      createRevision: created.revision,
      updateRevision: updated.revision,
      storageConfirmed: storage.confirmed,
      viewerRendered: viewer.confirmed,
      staleRevisionRejected: annotationConflictPreserved,
      staleAttachmentRejected,
      durableMarkerMatches: markerMatches.length,
      crashRecovery: recovered.kind,
    },
    note: {
      key: note.noteKey,
      createRevision: note.revision,
      updateRevision: noteUpdated.revision,
      staleRevisionRejected: noteConflictPreserved,
    },
    anchors: {
      exactQuote: "resolved_and_revalidated",
      repeatedQuote: repeatedQuoteEvidence,
      unevidencedCoordinateRegion: "rejected",
    },
  };
}

/** Rechecks rendered DOM evidence after a human opens the owned annotation. */
export async function runZoteroOwnedFixtureViewerCheck(
  environment: ZoteroNativeEnvironment,
  fixture: OwnedNativeFixture,
  annotationKey: string,
  runId: string,
): Promise<Record<string, unknown>> {
  assertSafeRunId(runId);
  const owned = await ownedContext(environment, fixture);
  const record = await owned.native.getAnnotation(
    fixture.libraryId,
    fixture.attachmentKey,
    annotationKey,
  );
  if (
    record === undefined ||
    !record.comment.includes(`Research Companion owned fixture annotation ${runId}`)
  ) {
    throw new Error("The requested annotation is not owned by this developer fixture run");
  }
  return {
    mode: "read_only_viewer_check",
    annotationKey,
    rendered: await owned.native.annotationVisible(
      fixture.libraryId,
      fixture.attachmentKey,
      annotationKey,
    ),
  };
}
