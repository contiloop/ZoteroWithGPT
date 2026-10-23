import { DigestArxivInspectionTokens } from "../../../src/adapters/arxiv/inspection-tokens.js";
import {
  DurableOperationStore,
  IOUtilsAtomicTextFile,
  KeyedMutationSerializer,
  WebCryptoPayloadDigest,
  type IOUtilsTextApi,
  type PathUtilsApi,
} from "../../../src/adapters/operation-store/index.js";
import { ZoteroArxivNativeImport } from "../../../src/adapters/zotero/arxiv-native-import.js";
import {
  MutableZoteroAccessGate,
  type NativeNoteContentPolicy,
  type ZoteroNativeApi,
} from "../../../src/adapters/zotero/native-api.js";
import { operationIdentityMarker } from "../../../src/adapters/zotero/record-utils.js";
import {
  createZoteroNativeApi,
  type ZoteroNativeEnvironment,
} from "../../../src/adapters/zotero/zotero-native-api.js";
import { CoreOperationError } from "../../../src/core/errors.js";
import { OperationCoordinator } from "../../../src/core/operation-coordinator.js";
import type { OperationRecord } from "../../../src/core/operation-record.js";
import type {
  ArxivPdfAcquisitionPort,
  ArxivPdfStagingPort,
  StagedArxivPdf,
  VerifiedArxivPdf,
} from "../../../src/ports/arxiv.js";
import {
  PROTOCOL_VERSION,
  validateArxivSource,
  validateProtocolRequest,
  validateProtocolResponse,
  type ArxivSource,
  type ProtocolResponse,
  type RequestFor,
} from "../../../src/protocol/index.js";

declare const __CONTROLLED_PDF_BYTES__: readonly number[];
declare const __CONTROLLED_PDF_FINGERPRINT__: string;
declare const __CONTROLLED_PDF_BYTE_LENGTH__: number;
declare const __CONTROLLED_PDF_PAGE_COUNT__: number;

type DiagnosticCase = "parent_item_only" | "disable_during_await";

interface DiagnosticWindow {
  closed?: boolean;
  document: {
    getElementById(id: string): DiagnosticMenu | DiagnosticMenuItem | null;
    createXULElement(name: "menuitem"): DiagnosticMenuItem;
  };
}

interface DiagnosticMenu {
  appendChild(item: DiagnosticMenuItem): unknown;
}

interface DiagnosticMenuItem {
  setAttribute(name: string, value: string): void;
  addEventListener(type: "command", listener: () => void): void;
  removeEventListener(type: "command", listener: () => void): void;
  remove(): void;
}

interface PromptService {
  confirm(window: DiagnosticWindow, title: string, text: string): boolean;
  alert(window: DiagnosticWindow, title: string, text: string): void;
}

declare const Zotero: ZoteroNativeEnvironment["Zotero"] & {
  Profile: { dir: string };
  getMainWindows(): DiagnosticWindow[];
  logError?(error: unknown): void;
  debug?(message: string): void;
};
declare const IOUtils: ZoteroNativeEnvironment["IOUtils"] & IOUtilsTextApi;
declare const PathUtils: PathUtilsApi;
declare const Services: { prompt: PromptService };
declare const crypto: ZoteroNativeEnvironment["crypto"];
declare function setTimeout(callback: () => void, milliseconds: number): unknown;

const DIAGNOSTIC_ID = "r12-native-fault-acceptance-v1";
const DIAGNOSTIC_PROFILE_ID = "r12-controlled-native-fault-profile-v1";
const JOURNAL_DIRECTORY = "zotero-ai-r12-native-fault-acceptance-v1";
const JOURNAL_FILENAME = "operations-v1.json";
const MENU_A = "r12-native-fault-acceptance-parent-item-only";
const MENU_B = "r12-native-fault-acceptance-disable-await";
const FIXED_STAGING_IDS = Object.freeze({
  parent_item_only: "r12-controlled-stage-parent-item-only-v1",
  disable_during_await: "r12-controlled-stage-disable-await-v1",
});

const CASE_A_SOURCE = controlledSource(
  "0001.99999",
  "[CONTROLLED R12 FIXTURE - NOT A VERIFIED ARXIV SOURCE] Retained parent after attachment fault",
  "Synthetic local host acceptance fixture. No network metadata or source identity was verified.",
);
const CASE_B_SOURCE = controlledSource(
  "0001.99998",
  "[CONTROLLED R12 FIXTURE - NOT A VERIFIED ARXIV SOURCE] Disable during awaited acquisition",
  "Synthetic local host acceptance fixture. It must be rejected before any native item mutation.",
);

const CASE_DETAILS = Object.freeze({
  parent_item_only: {
    operationId: "r12-native-fault-parent-item-only-v1",
    source: CASE_A_SOURCE,
    authorization:
      "Run the reviewed controlled R12 fixture that creates one synthetic parent and deliberately faults before attachment creation.",
  },
  disable_during_await: {
    operationId: "r12-native-fault-disable-during-await-v1",
    source: CASE_B_SOURCE,
    authorization:
      "Run the reviewed controlled R12 fixture that disables only its isolated gate during awaited in-memory PDF acquisition.",
  },
});

interface NativeCallCounts {
  planKeys: number;
  createParent: number;
  createAttachment: number;
  installPdf: number;
}

interface AcquisitionState {
  calls: number;
  awaited: boolean;
  gateDisabled: boolean;
}

interface StagingState {
  stageCalls: number;
  discardCalls: number;
}

interface DiagnosticReport {
  schemaVersion: 1;
  diagnostic: typeof DIAGNOSTIC_ID;
  case: DiagnosticCase;
  controlledSourceEvidence: "synthetic_fixture_not_network_verified";
  operationId: string;
  historicalReplay: boolean;
  pass: boolean;
  response: {
    state: ProtocolResponse["state"];
    errorCode: string | null;
    retryable: boolean | null;
    completion: string | null;
    itemKey: string | null;
    plannedAttachmentKey: string | null;
    verification: ProtocolResponse["verification"];
  };
  observations: {
    nativeCalls: NativeCallCounts;
    acquisition: AcquisitionState;
    staging: StagingState;
    durableStage: string | null;
    nativeMarkerKinds: string[];
    sourceCandidateCount: number;
    retainedParentConfirmed: boolean;
    plannedAttachmentAbsent: boolean;
    isolatedGateEnabledDuringReadback: boolean;
  };
  checks: Record<string, boolean>;
  effects: string[];
}

const rejectingNoteContent: NativeNoteContentPolicy = Object.freeze({
  sanitize(): string {
    throw new CoreOperationError(
      "unsupported_capability",
      "The controlled arXiv diagnostic does not expose note mutation",
    );
  },
  accepts(): boolean {
    return false;
  },
});

function controlledSource(arxivId: string, title: string, abstract: string): ArxivSource {
  return Object.freeze(validateArxivSource({
    arxivId,
    version: 1,
    abstractUrl: `https://arxiv.org/abs/${arxivId}v1`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}v1`,
    metadata: {
      title,
      authors: ["Research Companion Diagnostic Fixture"],
      published: "2000-01-01T00:00:00Z",
      updated: "2000-01-01T00:00:00Z",
      abstract,
    },
  }));
}

function exactControlledPdf(source: ArxivSource): VerifiedArxivPdf {
  return {
    source: { arxivId: source.arxivId, version: source.version },
    contentType: "application/pdf",
    body: Uint8Array.from(__CONTROLLED_PDF_BYTES__),
    fingerprint: __CONTROLLED_PDF_FINGERPRINT__,
    byteLength: __CONTROLLED_PDF_BYTE_LENGTH__,
    pageCount: __CONTROLLED_PDF_PAGE_COUNT__,
  };
}

class ControlledPdfAcquisition implements ArxivPdfAcquisitionPort {
  readonly state: AcquisitionState = { calls: 0, awaited: false, gateDisabled: false };

  constructor(
    private readonly source: ArxivSource,
    private readonly disableGateAfterAwait?: MutableZoteroAccessGate,
  ) {}

  async acquire(identity: { arxivId: string; version: number }): Promise<VerifiedArxivPdf> {
    this.state.calls += 1;
    if (identity.arxivId !== this.source.arxivId || identity.version !== this.source.version) {
      throw new CoreOperationError("conflict", "The controlled PDF identity changed");
    }
    if (this.disableGateAfterAwait !== undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      this.state.awaited = true;
      this.disableGateAfterAwait.setEnabled(false);
      this.state.gateDisabled = true;
    }
    return exactControlledPdf(this.source);
  }
}

class ControlledMemoryStaging implements ArxivPdfStagingPort {
  readonly state: StagingState = { stageCalls: 0, discardCalls: 0 };

  constructor(private readonly diagnosticCase: DiagnosticCase) {}

  async stage(pdf: VerifiedArxivPdf): Promise<StagedArxivPdf> {
    this.state.stageCalls += 1;
    const expected = CASE_DETAILS[this.diagnosticCase].source;
    if (
      pdf.source.arxivId !== expected.arxivId ||
      pdf.source.version !== expected.version ||
      pdf.fingerprint !== __CONTROLLED_PDF_FINGERPRINT__
    ) {
      throw new CoreOperationError("storage_error", "The controlled in-memory stage changed");
    }
    return {
      stagingId: FIXED_STAGING_IDS[this.diagnosticCase],
      source: { ...pdf.source },
      fingerprint: pdf.fingerprint,
      byteLength: pdf.byteLength,
      pageCount: pdf.pageCount,
    };
  }

  async discard(stagingId: string): Promise<void> {
    if (!(Object.values(FIXED_STAGING_IDS) as string[]).includes(stagingId)) {
      throw new Error("The controlled staging ID is outside this diagnostic");
    }
    this.state.discardCalls += 1;
  }
}

function instrumentNative(
  native: ZoteroNativeApi,
  diagnosticCase: DiagnosticCase,
  counts: NativeCallCounts,
): ZoteroNativeApi {
  return new Proxy(native, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "planArxivImportKeys") {
        return (...args: unknown[]) => {
          counts.planKeys += 1;
          return (value as (...values: unknown[]) => unknown).apply(target, args);
        };
      }
      if (property === "createArxivParent") {
        return (...args: unknown[]) => {
          counts.createParent += 1;
          return (value as (...values: unknown[]) => unknown).apply(target, args);
        };
      }
      if (property === "createArxivAttachment") {
        return (...args: unknown[]) => {
          counts.createAttachment += 1;
          if (diagnosticCase === "parent_item_only") {
            throw new CoreOperationError(
              "storage_error",
              "Controlled R12 fault before native attachment mutation",
            );
          }
          return (value as (...values: unknown[]) => unknown).apply(target, args);
        };
      }
      if (property === "installArxivPdf") {
        return (...args: unknown[]) => {
          counts.installPdf += 1;
          return (value as (...values: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ZoteroNativeApi;
}

function operationRequest(
  diagnosticCase: DiagnosticCase,
  profileId: string,
  inspectionToken: string,
): RequestFor<"ensure_arxiv_pdf"> {
  const detail = CASE_DETAILS[diagnosticCase];
  return validateProtocolRequest({
    protocolVersion: PROTOCOL_VERSION,
    operationId: detail.operationId,
    operation: "ensure_arxiv_pdf",
    profileId,
    authorization: { kind: "explicit_request", scope: detail.authorization },
    payload: {
      source: { arxivId: detail.source.arxivId, version: detail.source.version },
      inspectionToken,
      selection: { kind: "create" },
    },
  }) as RequestFor<"ensure_arxiv_pdf">;
}

function journalPath(): string {
  return PathUtils.join(Zotero.Profile.dir, JOURNAL_DIRECTORY, JOURNAL_FILENAME);
}

function terminal(state: OperationRecord["state"]): boolean {
  return state === "succeeded" || state === "rejected" || state === "failed" ||
    state === "indeterminate";
}

async function runDiagnostic(diagnosticCase: DiagnosticCase): Promise<DiagnosticReport> {
  const detail = CASE_DETAILS[diagnosticCase];
  const gate = new MutableZoteroAccessGate(true);
  activeGates.add(gate);
  const counts: NativeCallCounts = {
    planKeys: 0,
    createParent: 0,
    createAttachment: 0,
    installPdf: 0,
  };
  const baseNative = createZoteroNativeApi({
    Zotero,
    IOUtils,
    crypto,
    cloneInto: <T>(value: T) => value,
    noteContent: rejectingNoteContent,
    accessGate: gate,
  });
  const native = instrumentNative(baseNative, diagnosticCase, counts);
  const digest = new WebCryptoPayloadDigest(crypto);
  const tokens = new DigestArxivInspectionTokens(digest);
  const staging = new ControlledMemoryStaging(diagnosticCase);
  const acquisition = new ControlledPdfAcquisition(
    detail.source,
    diagnosticCase === "disable_during_await" ? gate : undefined,
  );
  const store = new DurableOperationStore(
    new IOUtilsAtomicTextFile(IOUtils, PathUtils, journalPath()),
    { generateProfileId: () => DIAGNOSTIC_PROFILE_ID },
  );
  const importer = new ZoteroArxivNativeImport({
    native,
    acquisition,
    staging,
    tokens,
    operations: store,
  });
  const coordinator = new OperationCoordinator({
    store,
    digest,
    serializer: new KeyedMutationSerializer(),
  });

  try {
    const profileId = await store.profileId();
    const existing = await store.load(detail.operationId);
    let historicalReplay = existing !== undefined;
    let response: ProtocolResponse;
    if (existing !== undefined && terminal(existing.state)) {
      response = existing.response;
    } else if (existing !== undefined) {
      const recovered = await coordinator.recoverPending(profileId, importer);
      response = recovered.find((candidate) => candidate.operationId === detail.operationId) ??
        await coordinator.get(detail.operationId) ??
        (() => { throw new Error("The controlled pending operation could not be recovered"); })();
    } else {
      historicalReplay = false;
      const inspection = await baseNative.inspectArxiv(detail.source);
      if (inspection.candidates.length !== 0) {
        throw new CoreOperationError(
          "conflict",
          "The controlled source identity already exists; the diagnostic refused a new operation",
        );
      }
      const inspectionToken = await tokens.issue({ source: detail.source, ...inspection });
      const request = operationRequest(diagnosticCase, profileId, inspectionToken);
      response = await coordinator.submit(request, profileId, (_accepted, identity) => {
        const accessFence = importer.captureAccessFence();
        return importer.ensure({
          source: detail.source,
          selection: request.payload.selection,
          inspectionToken,
          accessFence,
          identity,
        });
      });
    }
    validateProtocolResponse("ensure_arxiv_pdf", response);
    const record = await store.load(detail.operationId);
    if (record === undefined) throw new Error("The controlled operation record is missing");
    return await diagnosticReport({
      diagnosticCase,
      historicalReplay,
      response,
      record,
      baseNative,
      gate,
      counts,
      acquisition: acquisition.state,
      staging: staging.state,
    });
  } finally {
    if (gate.isEnabled()) gate.setEnabled(false);
    activeGates.delete(gate);
  }
}

async function diagnosticReport(input: {
  diagnosticCase: DiagnosticCase;
  historicalReplay: boolean;
  response: ProtocolResponse;
  record: OperationRecord;
  baseNative: ZoteroNativeApi;
  gate: MutableZoteroAccessGate;
  counts: NativeCallCounts;
  acquisition: AcquisitionState;
  staging: StagingState;
}): Promise<DiagnosticReport> {
  const detail = CASE_DETAILS[input.diagnosticCase];
  const evidence = input.record.nativeEvidence;
  const marker = evidence?.operationMarker ?? operationIdentityMarker({
    operationId: input.record.operationId,
    requestDigest: input.record.requestDigest,
  });
  const markerObjects = await input.baseNative.findArxivByOperationMarker(marker);
  const inspection = await input.baseNative.inspectArxiv(detail.source);
  const parent = evidence === undefined
    ? undefined
    : await input.baseNative.getArxivParent(detail.source, evidence.itemKey);
  const attachment = evidence === undefined
    ? undefined
    : await input.baseNative.getArxivAttachment(
      detail.source,
      evidence.itemKey,
      evidence.attachmentKey,
    );
  const data = input.response.data as Record<string, unknown> | null;
  const responseSummary = {
    state: input.response.state,
    errorCode: input.response.error?.code ?? null,
    retryable: input.response.error?.retryable ?? null,
    completion: typeof data?.completion === "string" ? data.completion : null,
    itemKey: evidence?.itemKey ?? null,
    plannedAttachmentKey: evidence?.attachmentKey ?? null,
    verification: input.response.verification,
  };
  const retainedParentConfirmed = parent !== undefined &&
    parent.metadataMatchesSource &&
    parent.title === detail.source.metadata.title;
  const plannedAttachmentAbsent = evidence === undefined || attachment === undefined;
  const common = {
    terminal: terminal(input.response.state),
    protocolValidated: true,
    sourceEvidenceIsExplicitlySynthetic:
      detail.source.metadata.title.includes("NOT A VERIFIED ARXIV SOURCE"),
  };
  const checks: Record<string, boolean> = input.diagnosticCase === "parent_item_only"
    ? {
        ...common,
        failedItemOnly: input.response.state === "failed" &&
          responseSummary.errorCode === "storage_error" &&
          responseSummary.retryable === false &&
          responseSummary.completion === "item_only",
        confirmedStorage: input.response.verification.storage === "confirmed" &&
          input.response.verification.viewer === "not_checked",
        durableParentStage: evidence?.stage === "parent_committed",
        exactRetainedParent: retainedParentConfirmed,
        oneOwnedParentMarker: markerObjects.length === 1 &&
          markerObjects[0]?.kind === "parent" &&
          markerObjects[0].itemKey === evidence?.itemKey,
        noPlannedAttachment: plannedAttachmentAbsent &&
          inspection.candidates.length === 1 &&
          inspection.candidates[0]?.itemKey === evidence?.itemKey &&
          inspection.candidates[0]?.attachments.length === 0,
        controlledFaultBoundary: input.historicalReplay || (
          input.counts.planKeys === 1 &&
          input.counts.createParent === 1 &&
          input.counts.createAttachment === 1 &&
          input.counts.installPdf === 0
        ),
        inMemoryStageDiscarded: input.historicalReplay || (
          input.staging.stageCalls === 1 && input.staging.discardCalls === 1
        ),
      }
    : {
        ...common,
        definitePermissionRejection: input.response.state === "rejected" &&
          responseSummary.errorCode === "permission_denied" &&
          responseSummary.retryable === false &&
          input.response.data === null,
        noNativeCheckpoint: evidence === undefined,
        noNativeMarker: markerObjects.length === 0,
        noSourceCandidate: inspection.candidates.length === 0,
        noNativeMutationCall: input.counts.planKeys === 0 &&
          input.counts.createParent === 0 &&
          input.counts.createAttachment === 0 &&
          input.counts.installPdf === 0,
        awaitedGateTransition: input.historicalReplay || (
          input.acquisition.calls === 1 &&
          input.acquisition.awaited &&
          input.acquisition.gateDisabled
        ),
        noStaging: input.staging.stageCalls === 0 && input.staging.discardCalls === 0,
        uncheckedNonwrite: input.response.verification.storage === "not_checked" &&
          input.response.verification.viewer === "not_checked",
      };
  return {
    schemaVersion: 1,
    diagnostic: DIAGNOSTIC_ID,
    case: input.diagnosticCase,
    controlledSourceEvidence: "synthetic_fixture_not_network_verified",
    operationId: detail.operationId,
    historicalReplay: input.historicalReplay,
    pass: Object.values(checks).every(Boolean),
    response: responseSummary,
    observations: {
      nativeCalls: input.counts,
      acquisition: input.acquisition,
      staging: input.staging,
      durableStage: evidence?.stage ?? null,
      nativeMarkerKinds: markerObjects.map((entry) => entry.kind),
      sourceCandidateCount: inspection.candidates.length,
      retainedParentConfirmed,
      plannedAttachmentAbsent,
      isolatedGateEnabledDuringReadback: input.gate.isEnabled(),
    },
    checks,
    effects: input.diagnosticCase === "parent_item_only"
      ? [
          "On PASS, one synthetic controlled preprint parent is retained in the personal library.",
          "On PASS, no attachment record or PDF file is created by the controlled fault.",
          "The diagnostic journal retains the terminal operation identity for replay safety.",
        ]
      : [
          "On PASS, no native item, attachment, or PDF file is created.",
          "Only the isolated diagnostic gate is disabled; companion settings remain unchanged.",
          "The diagnostic journal retains the definite rejected operation identity.",
        ],
  };
}

const windowCleanups = new Map<DiagnosticWindow, () => void>();
const activeGates = new Set<MutableZoteroAccessGate>();
let activeRun: Promise<void> | undefined;
let running = false;

function boundedError(error: unknown): string {
  if (error instanceof CoreOperationError) {
    return `${error.code}: ${error.message}`.slice(0, 500);
  }
  return "The controlled diagnostic failed before producing a classified report.";
}

function confirmationText(diagnosticCase: DiagnosticCase): string {
  return diagnosticCase === "parent_item_only"
    ? [
        "This reviewed controlled host test creates one clearly synthetic preprint parent in the personal library.",
        "It then injects a fixed fault before native attachment creation and retains the parent as evidence.",
        "It uses embedded owned PDF bytes in memory, makes no network request, and writes no PDF file.",
        "Continue?",
      ].join("\n\n")
    : [
        "This reviewed controlled host test awaits an in-memory PDF acquisition, then disables only its isolated diagnostic access gate.",
        "The expected result is a definite permission rejection before any native item mutation.",
        "It does not change Research Companion settings and makes no network request.",
        "Continue?",
      ].join("\n\n");
}

function begin(window: DiagnosticWindow, diagnosticCase: DiagnosticCase): void {
  if (!running) {
    Services.prompt.alert(window, "R12 Controlled Native Fault Acceptance", "The diagnostic is stopped.");
    return;
  }
  if (activeRun !== undefined) {
    Services.prompt.alert(
      window,
      "R12 Controlled Native Fault Acceptance",
      "A controlled diagnostic case is already running.",
    );
    return;
  }
  if (!Services.prompt.confirm(
    window,
    "R12 Controlled Native Fault Acceptance",
    confirmationText(diagnosticCase),
  )) return;

  const task = runDiagnostic(diagnosticCase)
    .then((report) => {
      const serialized = JSON.stringify(report, null, 2);
      Zotero.debug?.(`[${DIAGNOSTIC_ID}] ${JSON.stringify(report)}`);
      Services.prompt.alert(
        window,
        `R12 controlled result: ${report.pass ? "PASS" : "FAIL"}`,
        serialized,
      );
    })
    .catch((error: unknown) => {
      const message = boundedError(error);
      Zotero.logError?.(new Error(`[${DIAGNOSTIC_ID}] ${message}`));
      Services.prompt.alert(window, "R12 controlled diagnostic stopped", message);
    })
    .finally(() => {
      if (activeRun === task) activeRun = undefined;
    });
  activeRun = task;
}

function attachWindow(window: DiagnosticWindow): void {
  if (!running || window.closed || windowCleanups.has(window)) return;
  const tools = window.document.getElementById("menu_ToolsPopup") as DiagnosticMenu | null;
  if (tools === null || typeof tools.appendChild !== "function") {
    Zotero.logError?.(new Error(`[${DIAGNOSTIC_ID}] Zotero Tools menu is unavailable`));
    return;
  }
  (window.document.getElementById(MENU_A) as DiagnosticMenuItem | null)?.remove();
  (window.document.getElementById(MENU_B) as DiagnosticMenuItem | null)?.remove();
  const items: Array<{ item: DiagnosticMenuItem; command: () => void }> = [];
  for (const [id, label, diagnosticCase] of [
    [MENU_A, "R12 controlled check A - retained parent", "parent_item_only"],
    [MENU_B, "R12 controlled check B - disable during await", "disable_during_await"],
  ] as const) {
    const item = window.document.createXULElement("menuitem");
    item.setAttribute("id", id);
    item.setAttribute("label", label);
    const command = () => begin(window, diagnosticCase);
    item.addEventListener("command", command);
    tools.appendChild(item);
    items.push({ item, command });
  }
  windowCleanups.set(window, () => {
    for (const { item, command } of items) {
      item.removeEventListener("command", command);
      item.remove();
    }
  });
}

export async function start(_context: { id: string; version: string; rootURI: string }): Promise<void> {
  if (running) return;
  running = true;
  for (const window of Zotero.getMainWindows()) attachWindow(window);
}

export function onMainWindowLoad(window: DiagnosticWindow): void {
  attachWindow(window);
}

export function onMainWindowUnload(window: DiagnosticWindow): void {
  windowCleanups.get(window)?.();
  windowCleanups.delete(window);
}

export async function stop(): Promise<void> {
  running = false;
  for (const gate of activeGates) gate.setEnabled(false);
  for (const cleanup of windowCleanups.values()) cleanup();
  windowCleanups.clear();
  try {
    await activeRun;
  } catch {
    // The command handler already reports a bounded error.
  }
}
