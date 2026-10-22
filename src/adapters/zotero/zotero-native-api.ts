import { CoreOperationError } from "../../core/errors.js";
import { canonicalizeJson } from "../../protocol/canonical.js";
import type {
  ArxivCandidate,
  ArxivSource,
  NativeRectangle,
  ResolvedAnchor,
} from "../../protocol/types.js";
import { isValidArxivId, parseArxivUrl } from "../../protocol/validation.js";
import type { WebCryptoLike } from "../operation-store/web-crypto-digest.js";
import type { NativePageChar, NativeRectTuple } from "../anchors/text-layer.js";
import {
  ARXIV_PROVENANCE_RELATION_PREDICATE,
  arxivAttachmentProvenance,
  isSafeNativeNoteContent,
  OPERATION_RELATION_PREDICATE,
} from "./record-utils.js";
import type {
  NativeArxivAttachmentCreate,
  NativeArxivAttachmentRecord,
  NativeArxivKeyPlan,
  NativeArxivOperationObject,
  NativeArxivParentCreate,
  NativeArxivParentRecord,
  NativeArxivPdfInstall,
  NativeArxivSynchronousFileFingerprintPort,
  NativeArxivStagedFileInstaller,
  NativeAnnotationCreate,
  NativeAnnotationRecord,
  NativeAnnotationUpdate,
  NativeInspectedRegionEvidence,
  NativeMutationRecord,
  NativeNoteCreate,
  NativeNoteContentPolicy,
  NativeNoteRecord,
  NativeNoteUpdate,
  NativePaperRecord,
  NativePdfAttachment,
  NativePdfPageRecord,
  NativeRuntimeStatus,
  ZoteroAccessGate,
  ZoteroNativeApi,
} from "./native-api.js";

interface ZoteroCreatorLike {
  firstName?: string;
  lastName?: string;
  name?: string;
}

interface ZoteroItemLike {
  id?: number;
  key?: string;
  libraryID?: number;
  parentID?: number;
  parentItemID?: number | false;
  itemType?: string;
  deleted?: boolean;
  version?: number;
  dateModified?: string;
  attachmentContentType?: string;
  attachmentLinkMode?: number;
  attachmentPath?: string;
  annotationType?: string;
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string;
  annotationPosition?: string;
  isPDFAttachment(): boolean;
  isRegularItem(): boolean;
  isAnnotation(): boolean;
  isNote(): boolean;
  isEditable(): boolean;
  getField(field: string, unformatted?: boolean, includeBaseMapped?: boolean): unknown;
  setField(field: string, value: unknown): unknown;
  getDisplayTitle(): string;
  getCreators?(): ZoteroCreatorLike[];
  setCreators?(creators: Array<ZoteroCreatorLike & { creatorType: "author" }>): void;
  getAttachments?(includeTrashed?: boolean): number[];
  getCollections?(): number[];
  getAnnotations?(): ZoteroItemLike[];
  getNotes?(includeTrashed?: boolean): number[];
  getFilePathAsync(): Promise<string | false | undefined>;
  getRelationsByPredicate(predicate: string): string[];
  addRelation(predicate: string, object: string): boolean;
  getNote?(): string;
  getNoteTitle?(): string;
  setNote?(content: string): void;
  loadPrimaryData(reload?: boolean, failOnMissing?: boolean): Promise<unknown>;
  loadAllData?(): Promise<unknown>;
  getFilePath(): string | false;
  save(options?: Record<string, unknown>): Promise<unknown>;
  saveTx(options?: Record<string, unknown>): Promise<unknown>;
}

interface ZoteroSearchLike {
  libraryID: number;
  addCondition(condition: string, operator: string, value: string): void;
  search(): Promise<number[]>;
}

interface PdfCharLike {
  u?: unknown;
  c?: unknown;
  rect?: unknown;
  inlineRect?: unknown;
  spaceAfter?: unknown;
  lineBreakAfter?: unknown;
  paragraphBreakAfter?: unknown;
  ignorable?: unknown;
}

interface PdfPageDataLike {
  viewBox?: unknown;
  chars?: unknown;
}

interface PdfDocumentLike {
  numPages?: unknown;
  getData?(): Promise<Uint8Array | ArrayBuffer>;
  getPageLabels2?(): Promise<unknown>;
  getPageData(input: { pageIndex: number }): Promise<PdfPageDataLike>;
}

interface SelectionAnnotationLike {
  text?: unknown;
  position?: { pageIndex?: unknown; rects?: unknown };
}

interface ReaderPrimaryViewLike {
  initializedPromise?: Promise<unknown>;
  _iframeWindow?: {
    PDFViewerApplication?: { pdfDocument?: PdfDocumentLike };
    document?: QueryDocumentLike;
  };
  _selectionRanges?: unknown[];
  _getAnnotationFromSelectionRanges?(
    ranges: unknown[],
    type: "highlight",
  ): SelectionAnnotationLike | null;
  getAnnotationMeta?(position: { pageIndex: number; rects: NativeRectTuple[] }):
    | { sortIndex?: unknown; pageLabel?: unknown }
    | null;
}

interface ReaderLike {
  itemID?: number;
  tabID?: unknown;
  _iframe?: QueryNodeLike;
  _iframeWindow?: {
    document?: QueryDocumentLike;
    frameElement?: QueryNodeLike | null;
  };
  _tabContainer?: QueryNodeLike;
  _window?: { Zotero_Tabs?: { selectedID?: unknown } };
  _initPromise?: Promise<unknown>;
  _internalReader?: {
    _primaryView?: ReaderPrimaryViewLike;
    _state?: {
      annotations?: unknown;
      selectedAnnotationIDs?: unknown;
      sidebarOpen?: unknown;
      sidebarView?: unknown;
    };
  };
  close?(): void;
}

interface ZoteroLibraryLike {
  libraryID?: number;
  clientVersion?: number;
  waitForDataLoad?(type: string): Promise<unknown>;
}

export interface ZoteroHostGlobal {
  version?: string;
  Profile?: { name?: string };
  DB: {
    executeTransaction<T>(work: () => Promise<T>): Promise<T>;
    inTransaction(): boolean;
  };
  Libraries: {
    userLibraryID: number;
    getAll(): ZoteroLibraryLike[];
    get?(libraryId: number): ZoteroLibraryLike | undefined;
  };
  Items: {
    getAll(
      libraryId: number,
      onlyTopLevel?: boolean,
      includeDeleted?: boolean,
      asIds?: false,
    ): Promise<ZoteroItemLike[]>;
    getByLibraryAndKeyAsync(
      libraryId: number,
      key: string,
      options?: { noCache?: boolean },
    ): Promise<ZoteroItemLike | false | undefined>;
    getAsync(
      ids: number | number[],
      options?: { noCache?: boolean },
    ): Promise<ZoteroItemLike | ZoteroItemLike[] | false | undefined>;
    get(id: number): ZoteroItemLike | false | undefined;
  };
  Attachments: {
    LINK_MODE_IMPORTED_FILE: number;
    getStorageDirectory(item: ZoteroItemLike): { path: string };
  };
  Search: new () => ZoteroSearchLike;
  Item: new (type: string) => ZoteroItemLike;
  Reader: {
    _readers: ReaderLike[];
    open(
      itemId: number,
      location?: null,
      options?: { openInBackground?: boolean; allowDuplicate?: boolean },
    ): Promise<ReaderLike | undefined>;
  };
  Annotations: {
    saveFromJSON(
      attachment: ZoteroItemLike,
      json: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<ZoteroItemLike>;
  };
  Relations: {
    getByPredicateAndObject(
      objectType: "item",
      predicate: string,
      object: string,
    ): Promise<ZoteroItemLike[]>;
  };
  DataObjectUtilities: { generateKey(): string };
  API: { getLibraryPrefix(libraryId: number): string };
  Promise?: { delay(milliseconds: number): Promise<unknown> };
}

export interface ZoteroNativeEnvironment {
  Zotero: ZoteroHostGlobal;
  IOUtils: { read(path: string): Promise<Uint8Array | ArrayBuffer> };
  crypto: WebCryptoLike;
  cloneInto<T>(value: T, target: object): T;
  noteContent: NativeNoteContentPolicy;
  accessGate?: ZoteroAccessGate;
  arxivStaging?: NativeArxivStagedFileInstaller;
  arxivFileFingerprint?: NativeArxivSynchronousFileFingerprintPort;
}

interface QueryNodeLike {
  textContent?: string | null;
  innerText?: string;
  isConnected?: boolean;
  ownerDocument?: QueryDocumentLike;
  getClientRects?(): { length: number };
  getBoundingClientRect?(): QueryRectLike;
  parentElement?: QueryNodeLike | null;
  querySelector?(selector: string): QueryNodeLike | null;
}

interface QueryRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface QueryStyleLike {
  display?: string;
  visibility?: string;
  opacity?: string;
  contentVisibility?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
}

interface QueryDocumentLike {
  hidden?: boolean;
  visibilityState?: string;
  body?: QueryNodeLike | null;
  defaultView?: {
    innerWidth?: number;
    innerHeight?: number;
    getComputedStyle?(node: QueryNodeLike): QueryStyleLike;
  };
  documentElement?: { clientWidth?: number; clientHeight?: number };
  querySelector(selector: string): QueryNodeLike | null;
}

function libraryId(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new CoreOperationError("invalid_request", `Invalid Zotero library ID '${value}'`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CoreOperationError("invalid_request", `Invalid Zotero library ID '${value}'`);
  }
  return parsed;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) throw new Error(`Native ${label} is missing`);
  return value as number;
}

function requiredString(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Native ${label} is missing`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tuple(value: unknown): NativeRectTuple | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) {
    return undefined;
  }
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}

function rectangle(value: unknown): NativeRectangle | undefined {
  const source = tuple(value);
  if (source === undefined || source[2] <= source[0] || source[3] <= source[1]) return undefined;
  return { x1: source[0], y1: source[1], x2: source[2], y2: source[3] };
}

function rectangles(value: unknown): NativeRectangle[] {
  if (!Array.isArray(value)) return [];
  return value.map(rectangle).filter((entry): entry is NativeRectangle => entry !== undefined);
}

function rectangleTuples(value: readonly NativeRectangle[]): NativeRectTuple[] {
  return value.map((entry) => [entry.x1, entry.y1, entry.x2, entry.y2]);
}

function parsePosition(item: ZoteroItemLike): { pageIndex: number; rectangles: NativeRectangle[] } {
  let value: unknown;
  try {
    value = JSON.parse(requiredString(item.annotationPosition, "annotation position"));
  } catch {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid position`);
  }
  if (value === null || typeof value !== "object") {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid position`);
  }
  const position = value as { pageIndex?: unknown; rects?: unknown };
  if (!Number.isInteger(position.pageIndex) || (position.pageIndex as number) < 0) {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has an invalid page index`);
  }
  const parsedRectangles = rectangles(position.rects);
  if (parsedRectangles.length === 0) {
    throw new Error(`Native annotation '${item.key ?? "unknown"}' has no valid rectangles`);
  }
  return { pageIndex: position.pageIndex as number, rectangles: parsedRectangles };
}

function creatorName(creator: ZoteroCreatorLike): string | undefined {
  const name = creator.name?.trim();
  if (name) return name;
  const joined = [creator.firstName, creator.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  return joined || undefined;
}

function yearFor(item: ZoteroItemLike): number | undefined {
  const value = String(item.getField("date", false, true) ?? "");
  const match = /(?:^|\D)([12][0-9]{3})(?:\D|$)/u.exec(value);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function annotationMaterial(record: NativeAnnotationRecord): string {
  return JSON.stringify({
    libraryId: record.libraryId,
    itemKey: record.itemKey,
    attachmentKey: record.attachmentKey,
    annotationKey: record.annotationKey,
    type: record.type,
    text: record.text ?? null,
    comment: record.comment,
    color: record.color ?? null,
    pageIndex: record.pageIndex,
    pageLabel: record.pageLabel,
    rectangles: record.rectangles,
    version: record.version,
    dateModified: record.dateModified,
    operationMarkers: [...record.operationMarkers].sort(),
  });
}

function assertNativeAnnotationCommentRepresentable(comment: string): void {
  // Zotero's public annotationComment setter applies trim().normalize(). Check
  // that pure transformation before invoking the setter so the approved body
  // is either stored exactly or rejected without changing native item state.
  if (comment.trim().normalize() !== comment) {
    throw new CoreOperationError(
      "invalid_request",
      "Zotero cannot preserve this annotation comment exactly: native annotation comments " +
        "must be NFC text without leading or trailing whitespace. This request was rejected " +
        "before native mutation. Review and authorize an exact representable body, then use a " +
        "new operation ID; never resubmit an operation with an indeterminate outcome.",
    );
  }
}

function noteMaterial(record: NativeNoteRecord): string {
  return JSON.stringify({
    libraryId: record.libraryId,
    itemKey: record.itemKey,
    noteKey: record.noteKey,
    title: record.title,
    content: record.content,
    version: record.version,
    dateModified: record.dateModified,
    operationMarkers: [...record.operationMarkers].sort(),
  });
}

function clipsOverflow(value: string | undefined): boolean {
  return value === "auto" || value === "clip" || value === "hidden" || value === "scroll";
}

function normalizedRenderedText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function isRenderedNode(
  node: QueryNodeLike | null | undefined,
  document: QueryDocumentLike | undefined,
): node is QueryNodeLike {
  if (
    node?.isConnected !== true ||
    node.getClientRects === undefined ||
    node.getClientRects().length === 0 ||
    node.getBoundingClientRect === undefined ||
    document === undefined
  ) {
    return false;
  }
  const width = document.defaultView?.innerWidth ?? document.documentElement?.clientWidth;
  const height = document.defaultView?.innerHeight ?? document.documentElement?.clientHeight;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    (width ?? 0) <= 0 ||
    (height ?? 0) <= 0
  ) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) return false;
  let left = Math.max(0, rect.left);
  let right = Math.min(width as number, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(height as number, rect.bottom);
  if (right <= left || bottom <= top) return false;

  for (
    let current: QueryNodeLike | null | undefined = node;
    current;
    current = current.parentElement
  ) {
    const style = document.defaultView?.getComputedStyle?.(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.contentVisibility === "hidden" ||
      (style?.opacity !== undefined && Number(style.opacity) === 0)
    ) {
      return false;
    }
    if (current === node || style === undefined) continue;
    const clipX = clipsOverflow(style.overflowX || style.overflow);
    const clipY = clipsOverflow(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const ancestor = current.getBoundingClientRect?.();
    if (ancestor === undefined) return false;
    if (clipX) {
      left = Math.max(left, ancestor.left);
      right = Math.min(right, ancestor.right);
    }
    if (clipY) {
      top = Math.max(top, ancestor.top);
      bottom = Math.min(bottom, ancestor.bottom);
    }
    if (right <= left || bottom <= top) return false;
  }
  return true;
}

function hasVisibleStyleChain(
  node: QueryNodeLike,
  document: QueryDocumentLike,
): boolean {
  if (document.defaultView?.getComputedStyle === undefined) return false;
  for (
    let current: QueryNodeLike | null | undefined = node;
    current;
    current = current.parentElement
  ) {
    const style = document.defaultView.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      (style.opacity !== undefined && Number(style.opacity) === 0)
    ) {
      return false;
    }
  }
  return true;
}

function visibleDocument(document: QueryDocumentLike | undefined): document is QueryDocumentLike {
  return (
    document !== undefined &&
    document.hidden === false &&
    document.visibilityState === "visible" &&
    document.body !== undefined &&
    document.body !== null &&
    hasVisibleStyleChain(document.body, document)
  );
}

function hasOwnerVisibilityApis(document: QueryDocumentLike | undefined): document is QueryDocumentLike {
  return typeof document?.defaultView?.getComputedStyle === "function";
}

function owningReaderVisible(reader: ReaderLike, document: QueryDocumentLike): boolean {
  if (!visibleDocument(document)) return false;
  if (
    reader.tabID !== undefined &&
    reader.tabID !== null &&
    reader._window?.Zotero_Tabs?.selectedID !== reader.tabID
  ) {
    return false;
  }

  let frame: QueryNodeLike | null | undefined;
  try {
    frame = reader._iframe ?? reader._iframeWindow?.frameElement;
  } catch {
    return false;
  }
  const ownerDocument = frame?.ownerDocument;
  if (
    frame === undefined ||
    frame === null ||
    !hasOwnerVisibilityApis(ownerDocument) ||
    !isRenderedNode(frame, ownerDocument)
  ) {
    return false;
  }
  const tabContainer = reader._tabContainer;
  if (tabContainer === undefined) return true;
  const tabDocument = tabContainer.ownerDocument;
  return (
    hasOwnerVisibilityApis(tabDocument) &&
    isRenderedNode(tabContainer, tabDocument)
  );
}

function mapPageChars(value: unknown): NativePageChar[] {
  if (!Array.isArray(value)) return [];
  const output: NativePageChar[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") continue;
    const source = raw as PdfCharLike;
    const rect = tuple(source.rect);
    const text = typeof source.u === "string" ? source.u : typeof source.c === "string" ? source.c : "";
    if (rect === undefined || text.length === 0) continue;
    const inlineRect = tuple(source.inlineRect);
    output.push({
      text,
      rect,
      ...(inlineRect === undefined ? {} : { inlineRect }),
      spaceAfter: source.spaceAfter === true,
      lineBreakAfter: source.lineBreakAfter === true,
      paragraphBreakAfter: source.paragraphBreakAfter === true,
      ignorable: source.ignorable === true,
    });
  }
  return output;
}

interface ArxivIdentityEvidence {
  arxivId: string;
  version?: number;
}

interface ArxivPdfProvenance extends ArxivIdentityEvidence {
  version: number;
  fingerprint: string;
}

function parseIdentityText(value: unknown): ArxivIdentityEvidence | undefined {
  if (typeof value !== "string") return undefined;
  let candidate = value.trim().replace(/^arxiv\s*:\s*/iu, "");
  candidate = candidate.split(/[\s[]/u, 1)[0] ?? "";
  candidate = candidate.replace(/\.pdf$/iu, "");
  const versionMatch = /^(.*)v([1-9][0-9]*)$/u.exec(candidate);
  const arxivId = versionMatch?.[1] ?? candidate;
  if (!isValidArxivId(arxivId)) return undefined;
  if (versionMatch === null) return { arxivId };
  const version = Number(versionMatch[2]);
  return Number.isSafeInteger(version) ? { arxivId, version } : undefined;
}

function parseOfficialArxivField(value: unknown): ArxivIdentityEvidence | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    return parseArxivUrl(value.trim());
  } catch {
    return undefined;
  }
}

function extraLines(item: ZoteroItemLike): string[] {
  return String(item.getField("extra") ?? "").split(/\r?\n/u);
}

function parentIdentityEvidence(item: ZoteroItemLike): ArxivIdentityEvidence[] {
  const evidence: ArxivIdentityEvidence[] = [];
  const fromUrl = parseOfficialArxivField(item.getField("url"));
  if (fromUrl !== undefined) evidence.push(fromUrl);
  const fromArchive = parseIdentityText(item.getField("archiveID"));
  if (fromArchive !== undefined) evidence.push(fromArchive);
  const extraIdentities: ArxivIdentityEvidence[] = [];
  const extraVersions: number[] = [];
  for (const line of extraLines(item)) {
    const identity = /^\s*arxiv\s*:\s*(.+?)\s*$/iu.exec(line)?.[1];
    if (identity !== undefined) {
      const parsed = parseIdentityText(identity);
      if (parsed !== undefined) extraIdentities.push(parsed);
    }
    const version = /^\s*version\s*:\s*([1-9][0-9]*)\s*$/iu.exec(line)?.[1];
    if (version !== undefined) {
      const parsed = Number(version);
      if (Number.isSafeInteger(parsed)) extraVersions.push(parsed);
    }
  }
  for (const extraIdentity of extraIdentities) {
    evidence.push(extraIdentity);
    for (const extraVersion of extraVersions) {
      if (extraIdentity.version !== extraVersion) {
        evidence.push({ arxivId: extraIdentity.arxivId, version: extraVersion });
      }
    }
  }
  return evidence;
}

function allParentIdentityEvidence(item: ZoteroItemLike): ArxivIdentityEvidence[] {
  return [
    ...parentIdentityEvidence(item),
    ...item
      .getRelationsByPredicate(ARXIV_PROVENANCE_RELATION_PREDICATE)
      .map(parseParentProvenance)
      .filter((entry): entry is ArxivIdentityEvidence => entry !== undefined),
  ];
}

function attachmentIdentityEvidence(item: ZoteroItemLike): ArxivIdentityEvidence[] {
  const fromUrl = parseOfficialArxivField(item.getField("url"));
  const fromProvenance = item
    .getRelationsByPredicate(ARXIV_PROVENANCE_RELATION_PREDICATE)
    .map(parsePdfProvenance)
    .filter((entry): entry is ArxivPdfProvenance => entry !== undefined)
    .map(({ arxivId, version }) => ({ arxivId, version }));
  return [...(fromUrl === undefined ? [] : [fromUrl]), ...fromProvenance];
}

function parseParentProvenance(value: string): ArxivIdentityEvidence | undefined {
  const match = /^urn:zotero-ai-research-companion:arxiv-parent:(.+):v([1-9][0-9]*)$/u.exec(
    value,
  );
  if (match === null) return undefined;
  try {
    const arxivId = decodeURIComponent(match[1] as string);
    const version = Number(match[2]);
    return isValidArxivId(arxivId) && Number.isSafeInteger(version)
      ? { arxivId, version }
      : undefined;
  } catch {
    return undefined;
  }
}

function parsePdfProvenance(value: string): ArxivPdfProvenance | undefined {
  const match =
    /^urn:zotero-ai-research-companion:arxiv-pdf:(.+):v([1-9][0-9]*):(.+)$/u.exec(value);
  if (match === null) return undefined;
  try {
    const arxivId = decodeURIComponent(match[1] as string);
    const version = Number(match[2]);
    const fingerprint = decodeURIComponent(match[3] as string);
    return isValidArxivId(arxivId) && Number.isSafeInteger(version) && fingerprint.length > 0
      ? { arxivId, version, fingerprint }
      : undefined;
  } catch {
    return undefined;
  }
}

function sortedRelations(item: ZoteroItemLike, predicate: string): string[] {
  return [...item.getRelationsByPredicate(predicate)].sort();
}

function targetVersions(
  source: ArxivSource,
  evidence: readonly ArxivIdentityEvidence[],
): number[] {
  return [
    ...new Set(
      evidence
        .filter((entry) => entry.arxivId === source.arxivId)
        .map((entry) => entry.version)
        .filter((version): version is number => version !== undefined),
    ),
  ].sort((left, right) => left - right);
}

function identifiesSource(
  source: ArxivSource,
  evidence: readonly ArxivIdentityEvidence[],
): boolean {
  return evidence.some((entry) => entry.arxivId === source.arxivId);
}

function sourceExtraValue(item: ZoteroItemLike, field: "published" | "updated"): string | undefined {
  const expression = new RegExp(`^\\s*${field}\\s*:\\s*(.+?)\\s*$`, "iu");
  for (const line of extraLines(item)) {
    const value = expression.exec(line)?.[1];
    if (value !== undefined) return value;
  }
  return undefined;
}

function arxivFileName(source: ArxivSource): string {
  const safeId = source.arxivId.replace(/[^A-Za-z0-9._-]/gu, "_");
  return `arxiv-${safeId}-v${String(source.version)}.pdf`;
}

function sameCandidates(
  left: readonly ArxivCandidate[],
  right: readonly ArxivCandidate[],
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

interface ArxivLibraryFence {
  libraryId: number;
  clientVersion: number;
}

interface PreparedArxivFileEvidence {
  expectedFingerprint: string | null;
  attachment: ZoteroItemLike;
}

const MAX_SYNCHRONOUS_ARXIV_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SYNCHRONOUS_ARXIV_TOTAL_BYTES = 128 * 1024 * 1024;

type ArxivCommitAttempt<T> =
  | { kind: "saved"; value: T }
  | { kind: "blocked"; error: CoreOperationError };

function arxivParentMetadataMaterial(parent: ZoteroItemLike): object {
  return {
    libraryId: requiredNumber(parent.libraryID, "library ID"),
    itemKey: requiredString(parent.key, "parent item key"),
    deleted: parent.deleted === true,
    itemType: parent.itemType ?? null,
    version: parent.version ?? null,
    dateModified: parent.dateModified ?? null,
    title: String(parent.getField("title") ?? ""),
    abstractNote: String(parent.getField("abstractNote") ?? ""),
    date: String(parent.getField("date") ?? ""),
    url: String(parent.getField("url") ?? ""),
    extra: String(parent.getField("extra") ?? ""),
    archiveID: String(parent.getField("archiveID") ?? ""),
    DOI: String(parent.getField("DOI") ?? ""),
    creators: (parent.getCreators?.() ?? []).map((creator) => creatorName(creator) ?? null),
    collections: [...(parent.getCollections?.() ?? [])].sort((left, right) => left - right),
    operationMarkers: sortedRelations(parent, OPERATION_RELATION_PREDICATE),
    provenanceMarkers: sortedRelations(parent, ARXIV_PROVENANCE_RELATION_PREDICATE),
  };
}

export class ZoteroGlobalNativeApi implements ZoteroNativeApi {
  readonly #zotero: ZoteroHostGlobal;
  readonly #io: ZoteroNativeEnvironment["IOUtils"];
  readonly #crypto: WebCryptoLike;
  readonly #cloneInto: ZoteroNativeEnvironment["cloneInto"];
  readonly #noteContent: NativeNoteContentPolicy;
  readonly #accessGate: ZoteroAccessGate | undefined;
  readonly #arxivStaging: NativeArxivStagedFileInstaller | undefined;
  readonly #arxivFileFingerprint:
    | NativeArxivSynchronousFileFingerprintPort
    | undefined;

  constructor(environment: ZoteroNativeEnvironment) {
    this.#zotero = environment.Zotero;
    this.#io = environment.IOUtils;
    this.#crypto = environment.crypto;
    this.#cloneInto = environment.cloneInto;
    this.#noteContent = environment.noteContent;
    this.#accessGate = environment.accessGate;
    this.#arxivStaging = environment.arxivStaging;
    this.#arxivFileFingerprint = environment.arxivFileFingerprint;
  }

  async runtimeStatus(): Promise<NativeRuntimeStatus> {
    const profileName = optionalString(this.#zotero.Profile?.name);
    return {
      zoteroVersion: this.#zotero.version ?? "unknown",
      ...(profileName === undefined ? {} : { profileName }),
    };
  }

  captureArxivAccessFence(): string {
    if (this.#accessGate === undefined) {
      throw new CoreOperationError(
        "unsupported_capability",
        "The native arXiv importer requires a shared live access gate",
      );
    }
    if (!this.#accessGate.isEnabled()) {
      throw new CoreOperationError(
        "permission_denied",
        "Zotero companion access is disabled",
      );
    }
    return this.#accessGate.capture();
  }

  assertArxivAccessFence(fence: string): void {
    this.#assertArxivFence(fence);
  }

  async inspectArxiv(source: ArxivSource): Promise<import("../../ports/arxiv.js").ArxivNativeInspection> {
    const personalLibraryId = requiredNumber(
      this.#zotero.Libraries.userLibraryID,
      "personal library ID",
    );
    await this.#zotero.Libraries.get?.(personalLibraryId)?.waitForDataLoad?.("item");
    const loaded = await this.#zotero.Items.getAll(personalLibraryId, true, false, false);
    const candidates: ArxivCandidate[] = [];
    for (const cached of loaded) {
      if (cached.key === undefined) continue;
      const item = await this.#fresh(String(personalLibraryId), cached.key);
      if (item === undefined || item.deleted === true || !item.isRegularItem()) {
        continue;
      }
      if (!identifiesSource(source, await this.#familyIdentityEvidence(item))) continue;
      candidates.push(await this.#arxivCandidate(source, item));
    }
    candidates.sort((left, right) => left.itemKey.localeCompare(right.itemKey));
    return { libraryId: String(personalLibraryId), candidates };
  }

  async planArxivImportKeys(createParent: boolean): Promise<NativeArxivKeyPlan> {
    const personalLibraryId = requiredNumber(
      this.#zotero.Libraries.userLibraryID,
      "personal library ID",
    );
    const nextKey = async (): Promise<string> => {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const key = this.#zotero.DataObjectUtilities.generateKey();
        if (typeof key !== "string" || !/^[A-Za-z0-9]+$/u.test(key)) continue;
        const existing = await this.#zotero.Items.getByLibraryAndKeyAsync(personalLibraryId, key, {
          noCache: true,
        });
        if (!existing) return key;
      }
      throw new Error("Zotero could not allocate a unique prospective item key");
    };
    const itemKey = createParent ? await nextKey() : "existing-parent";
    const attachmentKey = await nextKey();
    return { itemKey, attachmentKey };
  }

  async getArxivParent(
    source: ArxivSource,
    itemKey: string,
  ): Promise<NativeArxivParentRecord | undefined> {
    const personalLibraryId = String(
      requiredNumber(this.#zotero.Libraries.userLibraryID, "personal library ID"),
    );
    const item = await this.#fresh(personalLibraryId, itemKey);
    if (
      item === undefined ||
      item.deleted === true ||
      !item.isRegularItem() ||
      !identifiesSource(source, await this.#familyIdentityEvidence(item))
    ) {
      return undefined;
    }
    const candidate = await this.#arxivCandidate(source, item);
    return this.#arxivParentRecord(source, item, candidate);
  }

  async getArxivAttachment(
    source: ArxivSource,
    itemKey: string,
    attachmentKey: string,
  ): Promise<NativeArxivAttachmentRecord | undefined> {
    const personalLibraryId = String(
      requiredNumber(this.#zotero.Libraries.userLibraryID, "personal library ID"),
    );
    const parent = await this.#fresh(personalLibraryId, itemKey);
    const attachment = await this.#fresh(personalLibraryId, attachmentKey);
    if (
      parent === undefined ||
      parent.deleted === true ||
      !parent.isRegularItem() ||
      !identifiesSource(source, await this.#familyIdentityEvidence(parent)) ||
      attachment === undefined ||
      attachment.deleted === true ||
      !attachment.isPDFAttachment() ||
      attachment.parentItemID !== parent.id
    ) {
      return undefined;
    }
    const pdfCount = await this.#pdfChildCount(parent);
    return this.#arxivAttachmentRecord(source, parent, attachment, pdfCount, true);
  }

  async createArxivParent(input: NativeArxivParentCreate): Promise<NativeArxivParentRecord> {
    const personalLibraryId = requiredNumber(
      this.#zotero.Libraries.userLibraryID,
      "personal library ID",
    );
    let commitBoundaryReached = false;
    let attempt: ArxivCommitAttempt<ZoteroItemLike>;
    try {
      attempt = await this.#zotero.DB.executeTransaction<
        ArxivCommitAttempt<ZoteroItemLike>
      >(async () => {
        const accessProblem = this.#arxivAccessProblem(input.accessFence);
        if (accessProblem !== undefined) return { kind: "blocked", error: accessProblem };
        const libraryFence = this.#captureArxivLibraryFence(true);
        const current = await this.inspectArxiv(input.source);
        const existing = await this.#zotero.Items.getByLibraryAndKeyAsync(
          personalLibraryId,
          input.itemKey,
          { noCache: true },
        );
        const fileEvidence = await this.#prepareArxivFileEvidence(current.candidates);
        const preparationProblem = this.#arxivPrecommitProblem(
          input.accessFence,
          libraryFence,
          true,
        );
        if (preparationProblem !== undefined) {
          return { kind: "blocked", error: preparationProblem };
        }
        if (!sameCandidates(current.candidates, input.expectedCandidates)) {
          return {
            kind: "blocked",
            error: new CoreOperationError(
              "conflict",
              "The complete canonical arXiv parent set changed during parent preparation",
            ),
          };
        }
        if (existing) {
          return {
            kind: "blocked",
            error: new CoreOperationError(
              "conflict",
              "The prospective arXiv parent key is already used",
            ),
          };
        }

        const parent = new this.#zotero.Item("preprint");
        this.#assertArxivFence(input.accessFence);
        parent.libraryID = personalLibraryId;
        this.#assertArxivFence(input.accessFence);
        parent.key = input.itemKey;
        const initializationProblem = await this.#initializeProspectiveArxivItem(
          parent,
          "parent",
          input.accessFence,
          libraryFence,
          fileEvidence,
        );
        if (initializationProblem !== undefined) {
          return { kind: "blocked", error: initializationProblem };
        }
        for (const [field, value] of [
          ["title", input.source.metadata.title],
          ["abstractNote", input.source.metadata.abstract],
          ["date", input.source.metadata.published],
          ["url", input.source.abstractUrl],
          [
            "extra",
            [
              `arXiv:${input.source.arxivId}`,
              `version: ${String(input.source.version)}`,
              `published: ${input.source.metadata.published}`,
              `updated: ${input.source.metadata.updated}`,
            ].join("\n"),
          ],
        ] as const) {
          this.#assertArxivFence(input.accessFence);
          parent.setField(field, value);
        }
        if (input.source.metadata.doi !== undefined) {
          this.#assertArxivFence(input.accessFence);
          parent.setField("DOI", input.source.metadata.doi);
        }
        this.#assertArxivFence(input.accessFence);
        parent.setCreators?.(
          input.source.metadata.authors.map((name) => ({
            name,
            creatorType: "author" as const,
          })),
        );
        this.#assertArxivFence(input.accessFence);
        parent.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
        this.#assertArxivFence(input.accessFence);
        parent.addRelation(ARXIV_PROVENANCE_RELATION_PREDICATE, input.parentProvenance);
        this.#assertArxivFence(input.accessFence);
        this.#assertPreparedArxivFiles(fileEvidence);
        await parent.save({ skipSelect: true });
        this.#assertArxivFence(input.accessFence);
        if (!this.#zotero.DB.inTransaction()) {
          throw new CoreOperationError(
            "conflict",
            "The native arXiv parent transaction ended before commit",
          );
        }
        this.#assertPreparedArxivFiles(fileEvidence);
        commitBoundaryReached = true;
        return { kind: "saved", value: parent };
      });
    } catch (error) {
      if (commitBoundaryReached) {
        throw new CoreOperationError(
          "unknown_outcome",
          "The native arXiv parent commit completed its callback but its final outcome is unknown",
        );
      }
      throw error;
    }
    if (attempt.kind === "blocked") throw attempt.error;
    try {
      this.#assertArxivFence(input.accessFence);
      const record = await this.getArxivParent(input.source, input.itemKey);
      if (
        record === undefined ||
        !record.metadataMatchesSource ||
        record.operationMarkers.length !== 1 ||
        record.operationMarkers[0] !== input.operationMarker ||
        record.provenanceMarkers.length !== 1 ||
        record.provenanceMarkers[0] !== input.parentProvenance
      ) {
        throw new Error("The committed arXiv parent failed exact native readback");
      }
      return record;
    } catch {
      throw new CoreOperationError(
        "unknown_outcome",
        "The native arXiv parent committed but current readback could not be confirmed",
      );
    }
  }

  async createArxivAttachment(
    input: NativeArxivAttachmentCreate,
  ): Promise<NativeArxivAttachmentRecord> {
    const personalLibraryId = requiredNumber(
      this.#zotero.Libraries.userLibraryID,
      "personal library ID",
    );
    let commitBoundaryReached = false;
    let attempt: ArxivCommitAttempt<{
      parent: ZoteroItemLike;
      attachment: ZoteroItemLike;
    }>;
    try {
      attempt = await this.#zotero.DB.executeTransaction<
        ArxivCommitAttempt<{ parent: ZoteroItemLike; attachment: ZoteroItemLike }>
      >(async () => {
        const accessProblem = this.#arxivAccessProblem(input.accessFence);
        if (accessProblem !== undefined) return { kind: "blocked", error: accessProblem };
        const libraryFence = this.#captureArxivLibraryFence(true);
        const current = await this.inspectArxiv(input.source);
        const parent = await this.#fresh(String(personalLibraryId), input.itemKey);
        const parentIdentifiesSource =
          parent !== undefined &&
          parent.deleted !== true &&
          parent.isRegularItem() &&
          parent.isEditable() &&
          identifiesSource(input.source, await this.#familyIdentityEvidence(parent));
        const existing = await this.#zotero.Items.getByLibraryAndKeyAsync(
          personalLibraryId,
          input.attachmentKey,
          { noCache: true },
        );
        const fileEvidence = await this.#prepareArxivFileEvidence(current.candidates);
        const preparationProblem = this.#arxivPrecommitProblem(
          input.accessFence,
          libraryFence,
          true,
        );
        if (preparationProblem !== undefined) {
          return { kind: "blocked", error: preparationProblem };
        }
        if (!sameCandidates(current.candidates, input.expectedCandidates)) {
          return {
            kind: "blocked",
            error: new CoreOperationError(
              "conflict",
              "The complete canonical arXiv attachment set changed during attachment preparation",
            ),
          };
        }
        if (!parentIdentifiesSource || parent === undefined) {
          return {
            kind: "blocked",
            error: new CoreOperationError(
              "conflict",
              "The selected canonical arXiv parent changed",
            ),
          };
        }
        if (existing) {
          return {
            kind: "blocked",
            error: new CoreOperationError(
              "conflict",
              "The prospective arXiv attachment key is already used",
            ),
          };
        }

        const attachment = new this.#zotero.Item("attachment");
        this.#assertArxivFence(input.accessFence);
        attachment.libraryID = personalLibraryId;
        this.#assertArxivFence(input.accessFence);
        attachment.key = input.attachmentKey;
        const initializationProblem = await this.#initializeProspectiveArxivItem(
          attachment,
          "attachment",
          input.accessFence,
          libraryFence,
          fileEvidence,
        );
        if (initializationProblem !== undefined) {
          return { kind: "blocked", error: initializationProblem };
        }
        this.#assertArxivFence(input.accessFence);
        attachment.parentID = requiredNumber(parent.id, "parent item ID");
        this.#assertArxivFence(input.accessFence);
        attachment.attachmentLinkMode = this.#zotero.Attachments.LINK_MODE_IMPORTED_FILE;
        this.#assertArxivFence(input.accessFence);
        attachment.attachmentContentType = "application/pdf";
        this.#assertArxivFence(input.accessFence);
        attachment.attachmentPath = `storage:${arxivFileName(input.source)}`;
        this.#assertArxivFence(input.accessFence);
        attachment.setField(
          "title",
          `arXiv:${input.source.arxivId}v${String(input.source.version)} PDF`,
        );
        this.#assertArxivFence(input.accessFence);
        attachment.setField("url", input.source.pdfUrl);
        this.#assertArxivFence(input.accessFence);
        attachment.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
        this.#assertArxivFence(input.accessFence);
        attachment.addRelation(
          ARXIV_PROVENANCE_RELATION_PREDICATE,
          input.attachmentProvenance,
        );
        this.#assertArxivFence(input.accessFence);
        this.#assertPreparedArxivFiles(fileEvidence);
        await attachment.save({ skipSelect: true });
        this.#assertArxivFence(input.accessFence);
        if (!this.#zotero.DB.inTransaction()) {
          throw new CoreOperationError(
            "conflict",
            "The native arXiv attachment transaction ended before commit",
          );
        }
        this.#assertPreparedArxivFiles(fileEvidence);
        commitBoundaryReached = true;
        return { kind: "saved", value: { parent, attachment } };
      });
    } catch (error) {
      if (commitBoundaryReached) {
        throw new CoreOperationError(
          "unknown_outcome",
          "The native arXiv attachment commit completed its callback but its final outcome is unknown",
        );
      }
      throw error;
    }
    if (attempt.kind === "blocked") throw attempt.error;
    try {
      this.#assertArxivFence(input.accessFence);
      const { parent, attachment } = attempt.value;
      const pdfCount = await this.#pdfChildCount(parent);
      const record = await this.#arxivAttachmentRecord(
        input.source,
        parent,
        attachment,
        pdfCount,
        false,
      );
      if (
        record.operationMarkers.length !== 1 ||
        record.operationMarkers[0] !== input.operationMarker ||
        record.provenanceMarkers.length !== 1 ||
        record.provenanceMarkers[0] !== input.attachmentProvenance
      ) {
        throw new Error("The committed arXiv attachment identity failed native readback");
      }
      return record;
    } catch {
      throw new CoreOperationError(
        "unknown_outcome",
        "The native arXiv attachment committed but current readback could not be confirmed",
      );
    }
  }

  async installArxivPdf(input: NativeArxivPdfInstall): Promise<NativeArxivAttachmentRecord> {
    const current = await this.inspectArxiv(input.source);
    if (!sameCandidates(current.candidates, input.expectedCandidates)) {
      throw new CoreOperationError(
        "conflict",
        "The complete canonical arXiv attachment set changed before file installation",
      );
    }
    const personalLibraryId = String(
      requiredNumber(this.#zotero.Libraries.userLibraryID, "personal library ID"),
    );
    const parent = await this.#fresh(personalLibraryId, input.itemKey);
    const attachment = await this.#fresh(personalLibraryId, input.attachmentKey);
    if (
      parent === undefined ||
      !parent.isRegularItem() ||
      parent.deleted === true ||
      !identifiesSource(input.source, await this.#familyIdentityEvidence(parent)) ||
      attachment === undefined ||
      !attachment.isPDFAttachment() ||
      attachment.deleted === true ||
      attachment.parentItemID !== parent.id
    ) {
      throw new CoreOperationError("conflict", "The planned arXiv attachment changed");
    }
    const expectedProvenance = arxivAttachmentProvenance(
      input.source,
      input.stagedPdf.fingerprint,
    );
    if (
      !attachment
        .getRelationsByPredicate(ARXIV_PROVENANCE_RELATION_PREDICATE)
        .includes(expectedProvenance)
    ) {
      throw new CoreOperationError("conflict", "The planned arXiv attachment lost provenance");
    }
    let existingFingerprint: string | undefined;
    try {
      existingFingerprint = await this.#fingerprint(attachment);
    } catch {
      existingFingerprint = undefined;
    }
    const preinstall = await this.inspectArxiv(input.source);
    this.#assertArxivFence(input.accessFence);
    if (!sameCandidates(preinstall.candidates, input.expectedCandidates)) {
      throw new CoreOperationError(
        "conflict",
        "The complete canonical arXiv attachment set changed during file preparation",
      );
    }
    if (existingFingerprint !== undefined) {
      if (existingFingerprint !== input.stagedPdf.fingerprint) {
        throw new CoreOperationError(
          "stale_attachment",
          "The planned arXiv attachment already contains different bytes",
        );
      }
      const existing = await this.getArxivAttachment(
        input.source,
        input.itemKey,
        input.attachmentKey,
      );
      if (existing !== undefined) return existing;
    }
    if (this.#arxivStaging === undefined) {
      throw new CoreOperationError(
        "unsupported_capability",
        "No native staged-file installer is configured for arXiv import",
      );
    }
    const destination = this.#zotero.Attachments.getStorageDirectory(attachment).path;
    this.#assertArxivFence(input.accessFence);
    let fileCreateAttempted = false;
    try {
      await this.#arxivStaging.installCreateOnly(
        input.stagedPdf.stagingId,
        destination,
        arxivFileName(input.source),
        async (createImmediately) => {
          this.#assertArxivFence(input.accessFence);
          const libraryFence = this.#captureArxivLibraryFence(false);
          const finalInspection = await this.inspectArxiv(input.source);
          const fileEvidence = await this.#prepareArxivFileEvidence(
            finalInspection.candidates,
          );
          const preparationProblem = this.#arxivPrecommitProblem(
            input.accessFence,
            libraryFence,
            false,
          );
          if (preparationProblem !== undefined) throw preparationProblem;
          if (!sameCandidates(finalInspection.candidates, input.expectedCandidates)) {
            throw new CoreOperationError(
              "conflict",
              "The complete canonical arXiv attachment set changed during file preparation",
            );
          }
          this.#assertArxivFence(input.accessFence);
          this.#assertArxivLibraryFence(libraryFence, false);
          this.#assertPreparedArxivFiles(fileEvidence);
          fileCreateAttempted = true;
          createImmediately();
        },
      );
    } catch (error) {
      if (fileCreateAttempted) {
        throw new CoreOperationError(
          "unknown_outcome",
          "The native arXiv file create was attempted but its final outcome is unknown",
        );
      }
      throw error;
    }
    try {
      this.#assertArxivFence(input.accessFence);
      const installed = await this.getArxivAttachment(
        input.source,
        input.itemKey,
        input.attachmentKey,
      );
      if (installed === undefined) {
        throw new Error("The installed arXiv PDF attachment could not be reloaded");
      }
      return installed;
    } catch {
      throw new CoreOperationError(
        "unknown_outcome",
        "The native arXiv file was created but current readback could not be confirmed",
      );
    }
  }

  async findArxivByOperationMarker(marker: string): Promise<NativeArxivOperationObject[]> {
    const values = await this.#zotero.Relations.getByPredicateAndObject(
      "item",
      OPERATION_RELATION_PREDICATE,
      marker,
    );
    const records: NativeArxivOperationObject[] = [];
    for (const value of values) {
      if (value.key === undefined || value.libraryID !== this.#zotero.Libraries.userLibraryID) {
        continue;
      }
      const fresh = await this.#fresh(String(value.libraryID), value.key);
      if (fresh === undefined || fresh.deleted === true) continue;
      if (fresh.isRegularItem()) {
        records.push({ kind: "parent", itemKey: value.key });
      } else if (fresh.isPDFAttachment() && typeof fresh.parentItemID === "number") {
        const parent = await this.#zotero.Items.getAsync(fresh.parentItemID, { noCache: true });
        if (Array.isArray(parent) || !parent || parent.key === undefined) continue;
        records.push({
          kind: "attachment",
          itemKey: parent.key,
          attachmentKey: value.key,
        });
      }
    }
    return records.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  async searchPapers(query: string, limit: number): Promise<NativePaperRecord[]> {
    const results: NativePaperRecord[] = [];
    for (const library of this.#zotero.Libraries.getAll()) {
      const id = library.libraryID;
      if (!Number.isSafeInteger(id) || (id ?? 0) <= 0) continue;
      await library.waitForDataLoad?.("item");
      const search = new this.#zotero.Search();
      search.libraryID = id as number;
      search.addCondition("quicksearch-titleCreatorYear", "contains", query);
      const ids = await search.search();
      const loaded = await this.#zotero.Items.getAsync(ids);
      const items = Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];
      for (const item of items) {
        if (!item.isRegularItem() || item.deleted === true) continue;
        await item.loadAllData?.();
        const attachments: NativePaperRecord["attachments"] = [];
        const childIds = item.getAttachments?.(false) ?? [];
        const childrenValue = await this.#zotero.Items.getAsync(childIds);
        const children = Array.isArray(childrenValue)
          ? childrenValue
          : childrenValue
            ? [childrenValue]
            : [];
        for (const attachment of children) {
          if (!attachment.isPDFAttachment() || attachment.deleted === true) continue;
          let fingerprint: string | undefined;
          try {
            fingerprint = await this.#fingerprint(attachment);
          } catch {
            fingerprint = undefined;
          }
          attachments.push({
            attachmentKey: requiredString(attachment.key, "attachment key"),
            title: String(
              attachment.getField("title") || attachment.getDisplayTitle() || "PDF attachment",
            ),
            contentType: attachment.attachmentContentType ?? "application/pdf",
            ...(fingerprint === undefined ? {} : { fingerprint }),
          });
        }
        const year = yearFor(item);
        results.push({
          libraryId: String(id),
          itemKey: requiredString(item.key, "item key"),
          title: String(item.getField("title") || item.getDisplayTitle() || "Untitled"),
          creators: (item.getCreators?.() ?? [])
            .map(creatorName)
            .filter((name): name is string => name !== undefined),
          ...(year === undefined ? {} : { year }),
          attachments,
        });
      }
    }
    return results.slice(0, limit);
  }

  async getPdfAttachment(
    requestedLibraryId: string,
    attachmentKey: string,
    itemKey?: string,
  ): Promise<NativePdfAttachment | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (
      attachment === undefined ||
      attachment.deleted === true ||
      !attachment.isPDFAttachment()
    ) {
      return undefined;
    }
    const parent = await this.#parentRecord(attachment);
    const parentKey = parent?.key ?? attachment.key;
    if (parentKey === undefined || (itemKey !== undefined && parentKey !== itemKey)) return undefined;
    const readerSnapshot = await this.#withReader(
      requiredNumber(attachment.id, "attachment ID"),
      true,
      async (_reader, view) => {
        const document = view._iframeWindow?.PDFViewerApplication?.pdfDocument;
        if (document === undefined) throw new Error("The Zotero reader PDF document is unavailable");
        const count = document.numPages;
        if (!Number.isSafeInteger(count) || (count as number) <= 0) {
          throw new Error("The initialized Zotero PDF reader did not expose a page count");
        }
        return {
          pageCount: count as number,
          fingerprint: await this.#readerFingerprint(document),
        };
      },
    );
    const fingerprint = await this.#fingerprint(attachment);
    if (readerSnapshot.fingerprint !== fingerprint) {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader is displaying different PDF bytes; reload the reader and retry",
      );
    }
    return {
      libraryId: String(requiredNumber(attachment.libraryID, "library ID")),
      itemKey: parentKey,
      attachmentKey: requiredString(attachment.key, "attachment key"),
      title: String(attachment.getField("title") || attachment.getDisplayTitle() || "PDF attachment"),
      contentType: attachment.attachmentContentType ?? "application/pdf",
      fingerprint,
      revision: await this.#digestText(
        JSON.stringify({
          fingerprint,
          version: attachment.version ?? 0,
          dateModified: attachment.dateModified ?? "",
        }),
      ),
      pageCount: readerSnapshot.pageCount,
    };
  }

  async readPdfPage(
    attachment: NativePdfAttachment,
    pageIndex: number,
  ): Promise<NativePdfPageRecord> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= attachment.pageCount) {
      throw new CoreOperationError("not_found", "The requested PDF page is out of range");
    }
    const item = await this.#fresh(attachment.libraryId, attachment.attachmentKey);
    if (item === undefined || !item.isPDFAttachment()) {
      throw new CoreOperationError("not_found", "The requested PDF attachment is no longer available");
    }
    const result = await this.#withReader(
      requiredNumber(item.id, "attachment ID"),
      true,
      async (_reader, view) => {
        const frame = view._iframeWindow;
        if (frame === undefined) throw new Error("The Zotero reader PDF frame is unavailable");
        const document = frame.PDFViewerApplication?.pdfDocument;
        if (document === undefined) throw new Error("The Zotero reader PDF document is unavailable");
        if ((await this.#readerFingerprint(document)) !== attachment.fingerprint) {
          throw new CoreOperationError(
            "stale_attachment",
            "The open Zotero reader is displaying different PDF bytes; reload the reader and retry",
          );
        }
        const data = await document.getPageData(this.#cloneInto({ pageIndex }, frame));
        const viewBox = tuple(data.viewBox);
        if (viewBox === undefined) throw new Error("The Zotero reader returned an invalid PDF view box");
        const labelsValue = await document.getPageLabels2?.();
        const labels = Array.isArray(labelsValue) ? labelsValue : [];
        return {
          pageIndex,
          pageLabel: optionalString(labels[pageIndex]) ?? String(pageIndex + 1),
          viewBox,
          chars: mapPageChars(data.chars),
        };
      },
    );
    if ((await this.#fingerprint(item)) !== attachment.fingerprint) {
      throw new CoreOperationError(
        "stale_attachment",
        "The PDF bytes changed while the native page was being read",
      );
    }
    return result;
  }

  async confirmInspectedRegion(
    requestedLibraryId: string,
    attachmentKey: string,
    pageIndex: number,
  ): Promise<NativeInspectedRegionEvidence | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.id === undefined) {
      return undefined;
    }
    return this.#withReader(attachment.id, false, async (_reader, view) => {
      const ranges = view._selectionRanges;
      const derive = view._getAnnotationFromSelectionRanges;
      if (ranges === undefined || ranges.length === 0 || derive === undefined) return undefined;
      const selected = derive.call(view, ranges, "highlight");
      if (selected?.position?.pageIndex !== pageIndex) return undefined;
      const selectedRectangles = rectangles(selected.position.rects);
      if (selectedRectangles.length === 0) return undefined;
      return {
        rectangles: selectedRectangles,
        ...(typeof selected.text === "string" && selected.text.length > 0
          ? { selectedText: selected.text }
          : {}),
      };
    });
  }

  async listAnnotations(
    requestedLibraryId: string,
    attachmentKey: string,
  ): Promise<NativeAnnotationRecord[]> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment()) return [];
    await attachment.loadAllData?.();
    const annotations = attachment.getAnnotations?.() ?? [];
    const records: NativeAnnotationRecord[] = [];
    for (const candidate of annotations) {
      if (candidate.key === undefined) continue;
      const annotation = await this.#fresh(requestedLibraryId, candidate.key);
      if (
        annotation === undefined ||
        !annotation.isAnnotation() ||
        annotation.deleted === true ||
        annotation.parentItemID !== attachment.id
      ) {
        continue;
      }
      const record = await this.#annotationRecord(annotation, attachment);
      if (record !== undefined) records.push(record);
    }
    return records;
  }

  async getAnnotation(
    requestedLibraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<NativeAnnotationRecord | undefined> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment()) return undefined;
    const annotation = await this.#fresh(requestedLibraryId, annotationKey);
    if (
      annotation === undefined ||
      !annotation.isAnnotation() ||
      annotation.deleted === true ||
      annotation.parentItemID !== attachment.id
    ) {
      return undefined;
    }
    return this.#annotationRecord(annotation, attachment);
  }

  async createAnnotation(input: NativeAnnotationCreate): Promise<NativeAnnotationRecord> {
    const attachment = await this.#fresh(input.anchor.libraryId, input.anchor.attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.deleted === true) {
      throw new CoreOperationError("not_found", "The annotation PDF attachment was not found");
    }
    if (!attachment.isEditable()) {
      throw new CoreOperationError("permission_denied", "The PDF attachment is not editable");
    }
    const parent = await this.#parentRecord(attachment);
    if ((parent?.key ?? attachment.key) !== input.anchor.itemKey) {
      throw new CoreOperationError("unresolved_anchor", "The PDF belongs to a different parent item");
    }
    if ((await this.#fingerprint(attachment)) !== input.anchor.attachmentFingerprint) {
      throw new CoreOperationError("stale_attachment", "The PDF bytes changed before annotation commit");
    }
    const position = {
      pageIndex: input.anchor.pageIndex,
      rects: rectangleTuples(input.anchor.rectangles),
    };
    const meta = await this.#withReader(
      requiredNumber(attachment.id, "attachment ID"),
      true,
      async (reader, view) => {
        const frame = reader._iframeWindow;
        if (frame === undefined) throw new Error("The Zotero reader frame is unavailable");
        return view.getAnnotationMeta?.(this.#cloneInto(position, frame)) ?? null;
      },
    );
    const sortIndex = optionalString(meta?.sortIndex);
    const pageLabel = optionalString(meta?.pageLabel) ?? input.anchor.pageLabel;
    if (sortIndex === undefined) {
      throw new CoreOperationError(
        "unresolved_anchor",
        "The native Zotero reader could not derive annotation ordering metadata",
      );
    }
    if (pageLabel !== input.anchor.pageLabel) {
      throw new CoreOperationError(
        "unresolved_anchor",
        "The native Zotero page label changed before annotation commit",
      );
    }
    const current = await this.#fresh(input.anchor.libraryId, input.anchor.attachmentKey);
    if (
      current === undefined ||
      !current.isPDFAttachment() ||
      (await this.#fingerprint(current)) !== input.anchor.attachmentFingerprint
    ) {
      throw new CoreOperationError("stale_attachment", "The PDF bytes changed before annotation commit");
    }
    const key = this.#zotero.DataObjectUtilities.generateKey();
    this.#assertMutationEnabled();
    assertNativeAnnotationCommentRepresentable(input.comment);
    const saved = await this.#zotero.Annotations.saveFromJSON(
      current,
      {
        key,
        type: input.type,
        ...(input.type === "highlight" ? { text: input.anchor.selectedText ?? "" } : {}),
        comment: input.comment,
        color: input.color,
        pageLabel,
        sortIndex,
        position,
        relations: { [OPERATION_RELATION_PREDICATE]: input.operationMarker },
      },
      { skipSelect: true },
    );
    const fresh = await this.#fresh(input.anchor.libraryId, requiredString(saved.key, "annotation key"));
    if (fresh === undefined) throw new Error("The committed native annotation could not be reloaded");
    const record = await this.#annotationRecord(fresh, current);
    if (record === undefined) throw new Error("The committed native annotation has an unsupported type");
    return record;
  }

  async updateAnnotation(input: NativeAnnotationUpdate): Promise<NativeAnnotationRecord> {
    const attachment = await this.#fresh(
      input.expected.libraryId,
      input.expected.attachmentKey,
    );
    const item = await this.#fresh(input.expected.libraryId, input.expected.annotationKey);
    if (
      attachment === undefined ||
      !attachment.isPDFAttachment() ||
      item === undefined ||
      !item.isAnnotation() ||
      item.parentItemID !== attachment.id
    ) {
      throw new CoreOperationError("not_found", "The annotation was not found");
    }
    const fresh = await this.#annotationRecord(item, attachment);
    if (fresh === undefined) {
      throw new CoreOperationError("unsupported_capability", "The annotation type is not supported");
    }
    if (annotationMaterial(fresh) !== annotationMaterial(input.expected)) {
      throw new CoreOperationError(
        "conflict",
        "The native annotation changed after authorization; reread it before updating",
      );
    }
    if (!item.isEditable()) {
      throw new CoreOperationError("permission_denied", "The annotation is not editable");
    }
    this.#assertMutationEnabled();
    assertNativeAnnotationCommentRepresentable(input.comment);
    item.annotationComment = input.comment;
    item.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    await item.saveTx({ skipSelect: true });
    const record = await this.getAnnotation(
      input.expected.libraryId,
      input.expected.attachmentKey,
      input.expected.annotationKey,
    );
    if (record === undefined) throw new Error("The updated native annotation could not be reloaded");
    return record;
  }

  async listNotes(requestedLibraryId: string, itemKey: string): Promise<NativeNoteRecord[]> {
    const parent = await this.#fresh(requestedLibraryId, itemKey);
    if (parent === undefined || !parent.isRegularItem() || parent.deleted === true) return [];
    await parent.loadAllData?.();
    const ids = parent.getNotes?.(false) ?? [];
    const records: NativeNoteRecord[] = [];
    for (const id of ids) {
      const value = await this.#zotero.Items.getAsync(id, { noCache: true });
      if (Array.isArray(value) || !value || !value.isNote() || value.deleted === true) continue;
      records.push(await this.#noteRecord(value, parent));
    }
    return records;
  }

  async getNote(
    requestedLibraryId: string,
    itemKey: string,
    noteKey: string,
  ): Promise<NativeNoteRecord | undefined> {
    const parent = await this.#fresh(requestedLibraryId, itemKey);
    const note = await this.#fresh(requestedLibraryId, noteKey);
    if (
      parent === undefined ||
      !parent.isRegularItem() ||
      note === undefined ||
      !note.isNote() ||
      note.deleted === true ||
      note.parentItemID !== parent.id
    ) {
      return undefined;
    }
    return this.#noteRecord(note, parent);
  }

  async createNote(input: NativeNoteCreate): Promise<NativeNoteRecord> {
    if (!isSafeNativeNoteContent(input.content, this.#noteContent)) {
      throw new CoreOperationError(
        "invalid_request",
        "Child-note content is not canonical safe native HTML",
      );
    }
    const parent = await this.#fresh(input.libraryId, input.itemKey);
    if (parent === undefined || !parent.isRegularItem() || parent.deleted === true) {
      throw new CoreOperationError("not_found", "The parent library item was not found");
    }
    if (!parent.isEditable()) {
      throw new CoreOperationError("permission_denied", "The parent library item is not editable");
    }
    const note = new this.#zotero.Item("note");
    note.libraryID = requiredNumber(parent.libraryID, "library ID");
    note.parentID = requiredNumber(parent.id, "parent item ID");
    note.setNote?.(input.content);
    note.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    this.#assertMutationEnabled();
    await note.saveTx({ skipSelect: true });
    const record = await this.getNote(
      input.libraryId,
      input.itemKey,
      requiredString(note.key, "note key"),
    );
    if (record === undefined) throw new Error("The committed native child note could not be reloaded");
    return record;
  }

  async updateNote(input: NativeNoteUpdate): Promise<NativeNoteRecord> {
    if (!isSafeNativeNoteContent(input.content, this.#noteContent)) {
      throw new CoreOperationError(
        "invalid_request",
        "Child-note content is not canonical safe native HTML",
      );
    }
    const parent = await this.#fresh(input.expected.libraryId, input.expected.itemKey);
    const note = await this.#fresh(input.expected.libraryId, input.expected.noteKey);
    if (
      parent === undefined ||
      !parent.isRegularItem() ||
      note === undefined ||
      !note.isNote() ||
      note.parentItemID !== parent.id
    ) {
      throw new CoreOperationError("not_found", "The child note was not found");
    }
    const current = await this.#noteRecord(note, parent);
    if (noteMaterial(current) !== noteMaterial(input.expected)) {
      throw new CoreOperationError(
        "conflict",
        "The native child note changed after authorization; reread it before updating",
      );
    }
    if (!note.isEditable()) {
      throw new CoreOperationError("permission_denied", "The child note is not editable");
    }
    this.#assertMutationEnabled();
    note.setNote?.(input.content);
    note.addRelation(OPERATION_RELATION_PREDICATE, input.operationMarker);
    await note.saveTx({ skipSelect: true });
    const record = await this.getNote(
      input.expected.libraryId,
      input.expected.itemKey,
      input.expected.noteKey,
    );
    if (record === undefined) throw new Error("The updated native child note could not be reloaded");
    return record;
  }

  async annotationVisible(
    requestedLibraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<boolean> {
    const attachment = await this.#fresh(requestedLibraryId, attachmentKey);
    if (attachment === undefined || !attachment.isPDFAttachment() || attachment.id === undefined) {
      return false;
    }
    if (!/^[A-Za-z0-9]+$/u.test(annotationKey)) return false;
    const record = await this.getAnnotation(requestedLibraryId, attachmentKey, annotationKey);
    if (record === undefined) return false;
    const readers = this.#zotero.Reader._readers.filter(
      (candidate) => candidate.itemID === attachment.id,
    );
    for (const reader of readers) {
      try {
        await reader._initPromise;
        const view = reader._internalReader?._primaryView;
        if (view === undefined) continue;
        await view.initializedPromise;
        const internal = reader._internalReader;
        const readerDocument = reader._iframeWindow?.document;
        if (readerDocument === undefined || !owningReaderVisible(reader, readerDocument)) continue;
        const sidebar = readerDocument?.querySelector(
          `[data-sidebar-annotation-id="${annotationKey}"]`,
        );
        const commentMatches = (
          node: QueryNodeLike | null | undefined,
          document: QueryDocumentLike | undefined,
        ): boolean => {
          if (!isRenderedNode(node, document)) return false;
          if (record.comment.length === 0) return true;
          const content = node.querySelector?.(".comment .content");
          return (
            isRenderedNode(content, document) &&
            typeof content.innerText === "string" &&
            normalizedRenderedText(content.innerText) === normalizedRenderedText(record.comment)
          );
        };
        if (
          internal?._state?.sidebarOpen === true &&
          internal._state.sidebarView === "annotations" &&
          commentMatches(sidebar, readerDocument)
        ) {
          return true;
        }

        const selected = internal?._state?.selectedAnnotationIDs;
        if (
          Array.isArray(selected) &&
          selected.includes(annotationKey) &&
          commentMatches(readerDocument?.querySelector(".annotation-popup"), readerDocument)
        ) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  async findByOperationMarker(marker: string): Promise<NativeMutationRecord[]> {
    const values = await this.#zotero.Relations.getByPredicateAndObject(
      "item",
      OPERATION_RELATION_PREDICATE,
      marker,
    );
    const records: NativeMutationRecord[] = [];
    for (const value of values) {
      const key = value.key;
      const id = value.libraryID;
      if (key === undefined || id === undefined) continue;
      const fresh = await this.#fresh(String(id), key);
      if (fresh === undefined || fresh.deleted === true) continue;
      if (fresh.isAnnotation()) {
        const attachmentId = fresh.parentItemID;
        if (typeof attachmentId !== "number") continue;
        const attachmentValue = await this.#zotero.Items.getAsync(attachmentId, { noCache: true });
        if (Array.isArray(attachmentValue) || !attachmentValue || !attachmentValue.isPDFAttachment()) {
          continue;
        }
        const record = await this.#annotationRecord(fresh, attachmentValue);
        if (record !== undefined) records.push(record);
      } else if (fresh.isNote()) {
        const parentId = fresh.parentItemID;
        if (typeof parentId !== "number") continue;
        const parentValue = await this.#zotero.Items.getAsync(parentId, { noCache: true });
        if (Array.isArray(parentValue) || !parentValue || !parentValue.isRegularItem()) continue;
        records.push(await this.#noteRecord(fresh, parentValue));
      }
    }
    return records;
  }

  async #pdfChildren(parent: ZoteroItemLike): Promise<ZoteroItemLike[]> {
    const attachmentIds = parent.getAttachments?.(true);
    if (!Array.isArray(attachmentIds)) {
      throw new CoreOperationError(
        "unsupported_capability",
        "Zotero did not expose the complete child attachment set",
      );
    }
    const children: ZoteroItemLike[] = [];
    for (const attachmentId of attachmentIds) {
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
        throw new Error("Zotero returned an invalid child attachment identity");
      }
      const loaded = await this.#zotero.Items.getAsync(attachmentId, { noCache: true });
      if (Array.isArray(loaded) || !loaded) {
        throw new CoreOperationError(
          "storage_error",
          "Zotero could not load the complete child attachment set",
          true,
        );
      }
      if (loaded.isPDFAttachment()) children.push(loaded);
    }
    return children.sort((left, right) =>
      requiredString(left.key, "attachment key").localeCompare(
        requiredString(right.key, "attachment key"),
      ),
    );
  }

  async #pdfChildCount(parent: ZoteroItemLike): Promise<number> {
    return (await this.#pdfChildren(parent)).length;
  }

  async #familyIdentityEvidence(parent: ZoteroItemLike): Promise<ArxivIdentityEvidence[]> {
    await parent.loadAllData?.();
    const evidence = allParentIdentityEvidence(parent);
    for (const child of await this.#pdfChildren(parent)) {
      await child.loadAllData?.();
      evidence.push(...attachmentIdentityEvidence(child));
    }
    return evidence;
  }

  async #arxivCandidate(source: ArxivSource, parent: ZoteroItemLike): Promise<ArxivCandidate> {
    await parent.loadAllData?.();
    const children = await this.#pdfChildren(parent);
    const attachments: NativeArxivAttachmentRecord[] = [];
    for (const child of children) {
      attachments.push(
        await this.#arxivAttachmentRecord(source, parent, child, children.length, false),
      );
    }
    const material = {
      ...arxivParentMetadataMaterial(parent),
      attachments: children.map((child, index) => ({
        attachmentKey: requiredString(child.key, "attachment key"),
        deleted: child.deleted === true,
        version: child.version ?? null,
        dateModified: child.dateModified ?? null,
        contentType: child.attachmentContentType ?? null,
        linkMode: child.attachmentLinkMode ?? null,
        path: child.attachmentPath ?? null,
        title: String(child.getField("title") ?? ""),
        url: String(child.getField("url") ?? ""),
        operationMarkers: sortedRelations(child, OPERATION_RELATION_PREDICATE),
        provenanceMarkers: sortedRelations(child, ARXIV_PROVENANCE_RELATION_PREDICATE),
        fingerprint: attachments[index]?.fingerprint ?? null,
        canonicalVersion: attachments[index]?.version ?? null,
        canonicalIdentity: attachments[index]?.identity ?? "unverified",
      })),
    };
    return {
      itemKey: requiredString(parent.key, "parent item key"),
      itemRevision: await this.#digestText(canonicalizeJson(material)),
      title: parent.getDisplayTitle(),
      attachments: attachments.map((attachment) => ({
        attachmentKey: attachment.attachmentKey,
        fingerprint: attachment.fingerprint,
        version: attachment.version,
        identity: attachment.identity,
      })),
    };
  }

  async #arxivParentRecord(
    source: ArxivSource,
    item: ZoteroItemLike,
    candidate: ArxivCandidate,
  ): Promise<NativeArxivParentRecord> {
    const parentEvidence = allParentIdentityEvidence(item);
    const evidence = await this.#familyIdentityEvidence(item);
    const creators = (item.getCreators?.() ?? [])
      .map(creatorName)
      .filter((name): name is string => name !== undefined);
    const sourceDoi = source.metadata.doi;
    const metadataMatchesSource =
      item.itemType === "preprint" &&
      targetVersions(source, parentEvidence).includes(source.version) &&
      String(item.getField("title") ?? "") === source.metadata.title &&
      String(item.getField("abstractNote") ?? "") === source.metadata.abstract &&
      String(item.getField("date") ?? "") === source.metadata.published &&
      String(item.getField("url") ?? "") === source.abstractUrl &&
      sourceExtraValue(item, "published") === source.metadata.published &&
      sourceExtraValue(item, "updated") === source.metadata.updated &&
      creators.length === source.metadata.authors.length &&
      creators.every((name, index) => name === source.metadata.authors[index]) &&
      (sourceDoi === undefined
        ? String(item.getField("DOI") ?? "") === ""
        : String(item.getField("DOI") ?? "") === sourceDoi) &&
      (item.getCollections?.() ?? []).length === 0;
    return {
      libraryId: String(requiredNumber(item.libraryID, "library ID")),
      itemKey: candidate.itemKey,
      itemRevision: candidate.itemRevision,
      metadataRevision: await this.#digestText(
        canonicalizeJson(arxivParentMetadataMaterial(item)),
      ),
      title: candidate.title,
      canonicalVersions: targetVersions(source, evidence),
      metadataMatchesSource,
      operationMarkers: sortedRelations(item, OPERATION_RELATION_PREDICATE),
      provenanceMarkers: sortedRelations(item, ARXIV_PROVENANCE_RELATION_PREDICATE),
      deepLink: `zotero://select/library/items/${encodeURIComponent(candidate.itemKey)}`,
    };
  }

  async #arxivAttachmentRecord(
    source: ArxivSource,
    parent: ZoteroItemLike,
    attachment: ZoteroItemLike,
    pdfCount: number,
    verifyReadable: boolean,
  ): Promise<NativeArxivAttachmentRecord> {
    await attachment.loadAllData?.();
    const deleted = attachment.deleted === true;
    let fingerprint: string | null = null;
    if (!deleted) {
      try {
        fingerprint = await this.#fingerprint(attachment);
      } catch {
        fingerprint = null;
      }
    }

    const provenanceMarkers = sortedRelations(
      attachment,
      ARXIV_PROVENANCE_RELATION_PREDICATE,
    );
    const provenance = provenanceMarkers
      .map(parsePdfProvenance)
      .filter((entry): entry is ArxivPdfProvenance => entry !== undefined);
    const ownEvidence = attachmentIdentityEvidence(attachment);
    const explicitVersions = [
      ...new Set(
        ownEvidence
          .filter((entry) => entry.arxivId === source.arxivId)
          .map((entry) => entry.version)
          .filter((version): version is number => version !== undefined),
      ),
    ];
    const parentEvidence = allParentIdentityEvidence(parent);
    const parentVersions = targetVersions(source, parentEvidence);
    let version: number | null = explicitVersions.length === 1 ? explicitVersions[0] as number : null;
    if (
      version === null &&
      explicitVersions.length === 0 &&
      ownEvidence.some(
        (entry) => entry.arxivId === source.arxivId && entry.version === undefined,
      ) &&
      parentVersions.length === 1 &&
      pdfCount === 1
    ) {
      version = parentVersions[0] as number;
    }
    const identityConflict =
      ownEvidence.some((entry) => entry.arxivId !== source.arxivId) ||
      explicitVersions.length > 1 ||
      parentEvidence.some((entry) => entry.arxivId !== source.arxivId) ||
      parentVersions.length > 1;
    const provenanceConsistent =
      provenance.length > 0 &&
      provenanceMarkers.length === provenance.length &&
      provenance.every(
        (entry) =>
          entry.arxivId === source.arxivId &&
          entry.version === version &&
          fingerprint !== null &&
          entry.fingerprint === fingerprint,
      );
    const hasCanonicalAttachmentEvidence = ownEvidence.some(
      (entry) => entry.arxivId === source.arxivId,
    );
    const hasCanonicalParentEvidence = parentEvidence.some(
      (entry) =>
        entry.arxivId === source.arxivId &&
        (entry.version === undefined || entry.version === source.version),
    );
    const canonicalSourceEvidence =
      (hasCanonicalAttachmentEvidence || hasCanonicalParentEvidence) &&
      !identityConflict &&
      provenanceMarkers.length === provenance.length &&
      explicitVersions.every((entry) => entry === source.version);
    const identity =
      !deleted &&
      fingerprint !== null &&
      version !== null &&
      hasCanonicalAttachmentEvidence &&
      !identityConflict &&
      provenanceConsistent
        ? "verified"
        : "unverified";

    let readable = false;
    let pageCount: number | null = null;
    if (verifyReadable && fingerprint !== null && !deleted) {
      try {
        const result = await this.#withReader(
          requiredNumber(attachment.id, "attachment ID"),
          true,
          async (_reader, view) => {
            const document = view._iframeWindow?.PDFViewerApplication?.pdfDocument;
            const count = document?.numPages;
            if (
              document === undefined ||
              !Number.isSafeInteger(count) ||
              (count as number) <= 0 ||
              (await this.#readerFingerprint(document)) !== fingerprint
            ) {
              return null;
            }
            return count as number;
          },
        );
        if (result !== null) {
          readable = true;
          pageCount = result;
        }
      } catch {
        readable = false;
        pageCount = null;
      }
    }
    const attachmentKey = requiredString(attachment.key, "attachment key");
    return {
      libraryId: String(requiredNumber(attachment.libraryID, "library ID")),
      itemKey: requiredString(parent.key, "parent item key"),
      attachmentKey,
      fingerprint,
      readable,
      pageCount,
      version,
      identity,
      canonicalSourceEvidence,
      operationMarkers: sortedRelations(attachment, OPERATION_RELATION_PREDICATE),
      provenanceMarkers,
      deepLink: `zotero://open-pdf/library/items/${encodeURIComponent(attachmentKey)}`,
    };
  }

  async #prepareArxivFileEvidence(
    candidates: readonly ArxivCandidate[],
  ): Promise<PreparedArxivFileEvidence[]> {
    const personalLibraryId = String(
      requiredNumber(this.#zotero.Libraries.userLibraryID, "personal library ID"),
    );
    const prepared: PreparedArxivFileEvidence[] = [];
    for (const candidate of candidates) {
      const parent = await this.#fresh(personalLibraryId, candidate.itemKey);
      if (
        parent === undefined ||
        parent.deleted === true ||
        !parent.isRegularItem()
      ) {
        throw new CoreOperationError(
          "conflict",
          "A canonical arXiv parent changed during PDF freshness preparation",
        );
      }
      for (const evidence of candidate.attachments) {
        const attachment = await this.#fresh(personalLibraryId, evidence.attachmentKey);
        if (
          attachment === undefined ||
          attachment.deleted === true ||
          !attachment.isPDFAttachment() ||
          attachment.parentItemID !== parent.id
        ) {
          throw new CoreOperationError(
            "conflict",
            "A canonical arXiv PDF changed during freshness preparation",
          );
        }
        prepared.push({
          expectedFingerprint: evidence.fingerprint,
          attachment,
        });
      }
    }
    return prepared;
  }

  #assertPreparedArxivFiles(evidence: readonly PreparedArxivFileEvidence[]): void {
    let remainingBytes = MAX_SYNCHRONOUS_ARXIV_TOTAL_BYTES;
    const fingerprintsByPath = new Map<
      string,
      { fingerprint: string; byteLength: number } | null
    >();
    for (const entry of evidence) {
      let path: string | false;
      try {
        path = entry.attachment.getFilePath();
      } catch {
        throw new CoreOperationError(
          "unsupported_capability",
          "Zotero could not synchronously resolve a relevant PDF path",
        );
      }
      if (path === false) {
        if (entry.expectedFingerprint !== null) {
          throw new CoreOperationError(
            "conflict",
            "Existing PDF bytes changed during native arXiv preparation",
          );
        }
        continue;
      }
      let actual = fingerprintsByPath.get(path);
      if (!fingerprintsByPath.has(path)) {
        if (this.#arxivFileFingerprint === undefined) {
          throw new CoreOperationError(
            "unsupported_capability",
            "No synchronous native PDF fingerprint provider is configured",
          );
        }
        const maximumByteLength = Math.min(
          MAX_SYNCHRONOUS_ARXIV_FILE_BYTES,
          remainingBytes,
        );
        try {
          actual = this.#arxivFileFingerprint.fingerprintNow(path, maximumByteLength);
        } catch {
          throw new CoreOperationError(
            "unsupported_capability",
            "A relevant PDF could not be fingerprinted synchronously within the safety bound",
          );
        }
        if (
          actual !== null &&
          (
            !Number.isSafeInteger(actual.byteLength) ||
            actual.byteLength < 0 ||
            actual.byteLength > maximumByteLength ||
            !/^sha256:[0-9a-f]{64}$/u.test(actual.fingerprint)
          )
        ) {
          throw new CoreOperationError(
            "unsupported_capability",
            "The synchronous native PDF fingerprint provider returned invalid evidence",
          );
        }
        fingerprintsByPath.set(path, actual ?? null);
        if (actual !== null) remainingBytes -= actual.byteLength;
      }
      if (actual === undefined) actual = null;
      const actualFingerprint = actual === null ? null : actual.fingerprint;
      if (actualFingerprint !== entry.expectedFingerprint) {
        throw new CoreOperationError(
          "conflict",
          "Existing PDF bytes changed during native arXiv preparation",
        );
      }
    }
  }

  #arxivAccessProblem(fence: string): CoreOperationError | undefined {
    return this.#accessGate === undefined || !this.#accessGate.isCurrent(fence)
      ? new CoreOperationError(
          "permission_denied",
          "Zotero companion access changed before native arXiv commit",
        )
      : undefined;
  }

  #personalLibrary(): ZoteroLibraryLike {
    const libraryId = requiredNumber(
      this.#zotero.Libraries.userLibraryID,
      "personal library ID",
    );
    const library = this.#zotero.Libraries.get?.(libraryId);
    if (library === undefined || library.libraryID !== libraryId) {
      throw new CoreOperationError(
        "unsupported_capability",
        "Zotero did not expose the personal library revision fence",
      );
    }
    return library;
  }

  #captureArxivLibraryFence(transactionRequired: boolean): ArxivLibraryFence {
    if (this.#zotero.DB.inTransaction() !== transactionRequired) {
      throw new CoreOperationError(
        "conflict",
        transactionRequired
          ? "The native arXiv commit is outside its serialized transaction"
          : "A native transaction is active during arXiv file preparation",
      );
    }
    const library = this.#personalLibrary();
    if (!Number.isSafeInteger(library.clientVersion) || (library.clientVersion ?? -1) < 0) {
      throw new CoreOperationError(
        "unsupported_capability",
        "Zotero did not expose a valid personal library client revision",
      );
    }
    return {
      libraryId: requiredNumber(library.libraryID, "personal library ID"),
      clientVersion: library.clientVersion as number,
    };
  }

  #assertArxivLibraryFence(
    fence: ArxivLibraryFence,
    transactionRequired: boolean,
  ): void {
    if (this.#zotero.DB.inTransaction() !== transactionRequired) {
      throw new CoreOperationError(
        "conflict",
        transactionRequired
          ? "The native arXiv transaction ended during preparation"
          : "A native transaction began during arXiv file preparation",
      );
    }
    const library = this.#personalLibrary();
    if (
      library.libraryID !== fence.libraryId ||
      library.clientVersion !== fence.clientVersion
    ) {
      throw new CoreOperationError(
        "conflict",
        transactionRequired
          ? "The personal library changed during native arXiv commit preparation"
          : "The personal library changed during file preparation for arXiv import",
      );
    }
  }

  #arxivPrecommitProblem(
    accessFence: string,
    libraryFence: ArxivLibraryFence,
    transactionRequired: boolean,
  ): CoreOperationError | undefined {
    const accessProblem = this.#arxivAccessProblem(accessFence);
    if (accessProblem !== undefined) return accessProblem;
    try {
      this.#assertArxivLibraryFence(libraryFence, transactionRequired);
      return undefined;
    } catch (error) {
      if (error instanceof CoreOperationError) return error;
      throw error;
    }
  }

  async #initializeProspectiveArxivItem(
    item: ZoteroItemLike,
    kind: "parent" | "attachment",
    accessFence: string,
    libraryFence: ArxivLibraryFence,
    fileEvidence: readonly PreparedArxivFileEvidence[],
  ): Promise<CoreOperationError | undefined> {
    await item.loadPrimaryData();
    const preparationProblem = this.#arxivPrecommitProblem(
      accessFence,
      libraryFence,
      true,
    );
    if (preparationProblem !== undefined) return preparationProblem;
    if (typeof item.id === "number") {
      return new CoreOperationError(
        "conflict",
        `The prospective arXiv ${kind} key became occupied during native initialization`,
      );
    }
    this.#assertPreparedArxivFiles(fileEvidence);
    return undefined;
  }

  #assertArxivFence(fence: string): void {
    const problem = this.#arxivAccessProblem(fence);
    if (problem !== undefined) throw problem;
  }

  async #fresh(requestedLibraryId: string, key: string): Promise<ZoteroItemLike | undefined> {
    const value = await this.#zotero.Items.getByLibraryAndKeyAsync(
      libraryId(requestedLibraryId),
      key,
      { noCache: true },
    );
    return value || undefined;
  }

  async #parentRecord(attachment: ZoteroItemLike): Promise<ZoteroItemLike | undefined> {
    if (typeof attachment.parentItemID !== "number") return undefined;
    const value = await this.#zotero.Items.getAsync(attachment.parentItemID, { noCache: true });
    return Array.isArray(value) || !value ? undefined : value;
  }

  async #fingerprint(item: ZoteroItemLike): Promise<string> {
    const path = await item.getFilePathAsync();
    if (typeof path !== "string" || path.length === 0) {
      throw new CoreOperationError("not_found", "The PDF attachment file is unavailable");
    }
    const bytes = await this.#io.read(path);
    const byteLength = bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength;
    if (byteLength === 0) {
      throw new CoreOperationError("not_found", "The PDF attachment file is empty");
    }
    return this.#fingerprintBytes(bytes);
  }

  async #readerFingerprint(document: PdfDocumentLike): Promise<string> {
    if (document.getData === undefined) {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader cannot verify its loaded PDF bytes; reload the reader and retry",
      );
    }
    let bytes: Uint8Array | ArrayBuffer;
    try {
      bytes = await document.getData();
    } catch {
      throw new CoreOperationError(
        "stale_attachment",
        "The open Zotero reader could not verify its loaded PDF bytes; reload the reader and retry",
      );
    }
    return this.#fingerprintBytes(bytes);
  }

  async #fingerprintBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
    const source = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
    const digest = await this.#crypto.subtle.digest("SHA-256", source);
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  async #digestText(value: string): Promise<string> {
    const digest = await this.#crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  async #withReader<T>(
    itemId: number,
    openIfMissing: boolean,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T | undefined>;
  async #withReader<T>(
    itemId: number,
    openIfMissing: true,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T>;
  async #withReader<T>(
    itemId: number,
    openIfMissing: boolean,
    work: (reader: ReaderLike, view: ReaderPrimaryViewLike) => Promise<T> | T,
  ): Promise<T | undefined> {
    const prior = this.#zotero.Reader._readers.find((candidate) => candidate.itemID === itemId);
    if (prior === undefined && !openIfMissing) return undefined;
    let reader = prior;
    let openedByAdapter = false;
    if (reader === undefined) {
      const before = new Set(this.#zotero.Reader._readers);
      reader = await this.#zotero.Reader.open(itemId, null, {
        openInBackground: true,
        allowDuplicate: false,
      });
      for (let attempt = 0; reader === undefined && attempt < 40; attempt += 1) {
        await this.#delay(25);
        reader = this.#zotero.Reader._readers.find((candidate) => candidate.itemID === itemId);
      }
      openedByAdapter = reader !== undefined && !before.has(reader);
    }
    if (reader === undefined) throw new Error("Zotero did not initialize a reader for the PDF");
    try {
      await reader._initPromise;
      const view = reader._internalReader?._primaryView;
      if (view === undefined) throw new Error("The initialized Zotero reader has no primary view");
      await view.initializedPromise;
      return await work(reader, view);
    } finally {
      if (openedByAdapter) reader.close?.();
    }
  }

  async #delay(milliseconds: number): Promise<void> {
    if (this.#zotero.Promise?.delay !== undefined) {
      await this.#zotero.Promise.delay(milliseconds);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  #assertMutationEnabled(): void {
    if (this.#accessGate !== undefined && !this.#accessGate.isEnabled()) {
      throw new CoreOperationError(
        "permission_denied",
        "Zotero companion access was disabled before native commit",
      );
    }
  }

  async #annotationRecord(
    item: ZoteroItemLike,
    attachment: ZoteroItemLike,
  ): Promise<NativeAnnotationRecord | undefined> {
    await item.loadAllData?.();
    const nativeType = item.annotationType;
    if (nativeType !== "highlight" && nativeType !== "note") return undefined;
    const position = parsePosition(item);
    const parent = await this.#parentRecord(attachment);
    const library = requiredNumber(item.libraryID, "library ID");
    const annotationKey = requiredString(item.key, "annotation key");
    const attachmentKey = requiredString(attachment.key, "attachment key");
    const prefix = this.#zotero.API.getLibraryPrefix(library);
    return {
      libraryId: String(library),
      itemKey: requiredString(parent?.key ?? attachment.key, "parent item key"),
      attachmentKey,
      annotationKey,
      type: nativeType,
      ...(nativeType === "highlight" && typeof item.annotationText === "string"
        ? { text: item.annotationText }
        : {}),
      comment: item.annotationComment ?? "",
      ...(optionalString(item.annotationColor) === undefined ? {} : { color: item.annotationColor }),
      pageIndex: position.pageIndex,
      pageLabel: item.annotationPageLabel ?? String(position.pageIndex + 1),
      rectangles: position.rectangles,
      version: item.version ?? 0,
      dateModified: item.dateModified ?? "",
      operationMarkers: [...item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE)],
      deepLink:
        `zotero://open-pdf/${prefix}/items/${encodeURIComponent(attachmentKey)}` +
        `?page=${position.pageIndex + 1}&annotation=${encodeURIComponent(annotationKey)}`,
    };
  }

  async #noteRecord(item: ZoteroItemLike, parent: ZoteroItemLike): Promise<NativeNoteRecord> {
    await item.loadAllData?.();
    const library = requiredNumber(item.libraryID, "library ID");
    const noteKey = requiredString(item.key, "note key");
    const prefix = this.#zotero.API.getLibraryPrefix(library);
    return {
      libraryId: String(library),
      itemKey: requiredString(parent.key, "parent item key"),
      noteKey,
      title: item.getNoteTitle?.() ?? "",
      content: item.getNote?.() ?? "",
      version: item.version ?? 0,
      dateModified: item.dateModified ?? "",
      operationMarkers: [...item.getRelationsByPredicate(OPERATION_RELATION_PREDICATE)],
      deepLink: `zotero://select/${prefix}/items/${encodeURIComponent(noteKey)}`,
    };
  }
}

export function createZoteroNativeApi(environment: ZoteroNativeEnvironment): ZoteroNativeApi {
  return new ZoteroGlobalNativeApi(environment);
}
