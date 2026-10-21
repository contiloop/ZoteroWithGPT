export const PROTOCOL_VERSION = 1 as const;

export type OperationName =
  | "connection_status"
  | "search_papers"
  | "read_pdf"
  | "list_annotations"
  | "list_notes"
  | "read_note"
  | "resolve_anchor"
  | "create_annotation"
  | "update_annotation"
  | "create_note"
  | "update_note"
  | "verify_annotation";

export type MutationOperationName =
  | "create_annotation"
  | "update_annotation"
  | "create_note"
  | "update_note";

export type ReadOperationName = Exclude<OperationName, MutationOperationName>;

export interface AuthorizationMetadata {
  /** Records human intent. It is not a signature or cryptographic proof. */
  kind: "explicit_request" | "approved_proposal";
  /** Human-readable description of the approved content and target. */
  scope: string;
}

export interface NativeRectangle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AnchorMatchEvidence {
  method: "exact_quote" | "quote_with_context" | "inspected_region";
  matchedText?: string;
  exact: boolean;
}

/**
 * A resolver-produced anchor. This remains untrusted at a write boundary: a
 * native adapter must revalidate the fingerprint and match evidence.
 */
export interface ResolvedAnchor {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  attachmentFingerprint: string;
  pageIndex: number;
  pageLabel: string;
  rectangles: NativeRectangle[];
  selectedText?: string;
  matchEvidence: AnchorMatchEvidence;
}

export type ConnectionStatusPayload = Record<string, never>;

export interface SearchPapersPayload {
  query: string;
  limit?: number;
}

export interface PageRange {
  /** Zero-based, inclusive. */
  startPageIndex: number;
  /** Zero-based, inclusive. */
  endPageIndex: number;
}

export interface ReadPdfPayload {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  pageRange: PageRange;
}

export interface ListAnnotationsPayload {
  libraryId: string;
  attachmentKey: string;
}

export interface ListNotesPayload {
  libraryId: string;
  itemKey: string;
  limit?: number;
}

export interface ReadNotePayload {
  libraryId: string;
  itemKey: string;
  noteKey: string;
}

export interface QuoteAnchorInput {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface InspectedRegionInput {
  rectangles: NativeRectangle[];
  selectedText?: string;
}

export type ResolveAnchorPayload = {
  libraryId: string;
  attachmentKey: string;
  fingerprint: string;
  pageIndex: number;
} & (
  | { quote: QuoteAnchorInput; inspectedRegion?: never }
  | { quote?: never; inspectedRegion: InspectedRegionInput }
);

export interface CreateAnnotationPayload {
  anchor: ResolvedAnchor;
  type: "highlight" | "note";
  comment: string;
  color?: NativeAnnotationColor;
}

export interface UpdateAnnotationPayload {
  libraryId: string;
  attachmentKey: string;
  annotationKey: string;
  expectedRevision: string;
  mode: "append" | "replace";
  comment: string;
}

export interface CreateNotePayload {
  libraryId: string;
  itemKey: string;
  content: string;
}

export interface UpdateNotePayload {
  libraryId: string;
  itemKey: string;
  noteKey: string;
  expectedRevision: string;
  mode: "append" | "replace";
  content: string;
}

export interface VerifyAnnotationPayload {
  libraryId: string;
  attachmentKey: string;
  annotationKey: string;
}

export interface OperationPayloadMap {
  connection_status: ConnectionStatusPayload;
  search_papers: SearchPapersPayload;
  read_pdf: ReadPdfPayload;
  list_annotations: ListAnnotationsPayload;
  list_notes: ListNotesPayload;
  read_note: ReadNotePayload;
  resolve_anchor: ResolveAnchorPayload;
  create_annotation: CreateAnnotationPayload;
  update_annotation: UpdateAnnotationPayload;
  create_note: CreateNotePayload;
  update_note: UpdateNotePayload;
  verify_annotation: VerifyAnnotationPayload;
}

interface RequestBase<O extends OperationName> {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  operation: O;
  payload: OperationPayloadMap[O];
}

export type ConnectionStatusRequest = RequestBase<"connection_status"> & {
  profileId?: string;
  authorization?: never;
};

export type ProfiledReadRequest<O extends Exclude<ReadOperationName, "connection_status">> =
  RequestBase<O> & {
    profileId: string;
    authorization?: never;
  };

export type AuthorizedMutationRequest<O extends MutationOperationName> = RequestBase<O> & {
  profileId: string;
  authorization: AuthorizationMetadata;
};

export type ProtocolRequest =
  | ConnectionStatusRequest
  | ProfiledReadRequest<"search_papers">
  | ProfiledReadRequest<"read_pdf">
  | ProfiledReadRequest<"list_annotations">
  | ProfiledReadRequest<"list_notes">
  | ProfiledReadRequest<"read_note">
  | ProfiledReadRequest<"resolve_anchor">
  | AuthorizedMutationRequest<"create_annotation">
  | AuthorizedMutationRequest<"update_annotation">
  | AuthorizedMutationRequest<"create_note">
  | AuthorizedMutationRequest<"update_note">
  | ProfiledReadRequest<"verify_annotation">;

export type RequestFor<O extends OperationName> = Extract<ProtocolRequest, { operation: O }>;

export type NativeAnnotationColor =
  | "#ffd400"
  | "#ff6666"
  | "#5fb236"
  | "#2ea8e5"
  | "#a28ae5"
  | "#e56eee"
  | "#f19837"
  | "#aaaaaa";

export interface TransportDescription {
  kind: "http" | "native_messaging" | "custom";
  description: string;
}

export interface ProtocolCapabilities {
  operations: OperationName[];
  annotationTypes: Array<"highlight" | "note">;
  annotationColors: NativeAnnotationColor[];
  maxRequestBytes: number;
  maxTextBytes: number;
}

export interface ConnectionStatusResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  pluginVersion: string;
  zoteroVersion: string;
  profile: { id: string; name?: string };
  enabled: boolean;
  capabilities: ProtocolCapabilities;
  transport: TransportDescription;
}

export interface AttachmentSummary {
  attachmentKey: string;
  title: string;
  contentType: string;
  fingerprint?: string;
}

export interface PaperMatch {
  libraryId: string;
  itemKey: string;
  title: string;
  creators: string[];
  year?: number;
  attachments: AttachmentSummary[];
}

export interface SearchPapersResult {
  matches: PaperMatch[];
}

export interface PassageCandidate {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface RegionCandidate {
  rectangles: NativeRectangle[];
  selectedText?: string;
}

export interface PdfPage {
  pageIndex: number;
  pageLabel: string;
  text: string;
  passageCandidates: PassageCandidate[];
  regionCandidates: RegionCandidate[];
}

export interface ReadPdfResult {
  attachmentFingerprint: string;
  attachmentRevision: string;
  pages: PdfPage[];
}

export interface NativeAnnotation {
  annotationKey: string;
  revision: string;
  type: "highlight" | "note";
  anchor: ResolvedAnchor;
  text?: string;
  comment: string;
  color?: NativeAnnotationColor;
  deepLink: string;
}

export interface ListAnnotationsResult {
  annotations: NativeAnnotation[];
}

export interface NoteSummary {
  noteKey: string;
  parentItemKey: string;
  title: string;
  revision: string;
}

export interface ListNotesResult {
  notes: NoteSummary[];
}

export interface ReadNoteResult {
  parentItemKey: string;
  noteKey: string;
  revision: string;
  content: string;
  deepLink: string;
}

export interface AnchorCandidate {
  anchor: ResolvedAnchor;
  reason: string;
}

export type ResolveAnchorResult =
  | { status: "resolved"; anchor: ResolvedAnchor }
  | { status: "unresolved"; reason: string; candidates: AnchorCandidate[] };

export interface SavedAnnotationSnapshot {
  pageIndex: number;
  pageLabel: string;
  rectangles: NativeRectangle[];
  selectedText?: string;
  comment: string;
}

export interface CreateAnnotationResult {
  annotationKey: string;
  revision: string;
  deepLink: string;
  saved: SavedAnnotationSnapshot;
}

export interface UpdateAnnotationResult {
  annotationKey: string;
  revision: string;
  comment: string;
  deepLink: string;
}

export interface CreateNoteResult {
  noteKey: string;
  revision: string;
  content: string;
  deepLink: string;
}

export interface UpdateNoteResult extends CreateNoteResult {}

export interface VerificationDetail {
  confirmed: boolean;
  description: string;
}

export interface VerifyAnnotationResult {
  annotationKey: string;
  storageEvidence: VerificationDetail;
  viewerEvidence: VerificationDetail;
}

export interface OperationResultMap {
  connection_status: ConnectionStatusResult;
  search_papers: SearchPapersResult;
  read_pdf: ReadPdfResult;
  list_annotations: ListAnnotationsResult;
  list_notes: ListNotesResult;
  read_note: ReadNoteResult;
  resolve_anchor: ResolveAnchorResult;
  create_annotation: CreateAnnotationResult;
  update_annotation: UpdateAnnotationResult;
  create_note: CreateNoteResult;
  update_note: UpdateNoteResult;
  verify_annotation: VerifyAnnotationResult;
}

export type ResultFor<O extends OperationName> = OperationResultMap[O];

export type OperationState =
  | "queued"
  | "running"
  | "succeeded"
  | "rejected"
  | "failed"
  | "indeterminate";

export type VerificationState =
  | "not_applicable"
  | "not_checked"
  | "confirmed"
  | "failed";

export interface VerificationSummary {
  storage: VerificationState;
  viewer: VerificationState;
}

export type ProtocolErrorCode =
  | "invalid_request"
  | "unsupported_version"
  | "unsupported_operation"
  | "permission_denied"
  | "not_connected"
  | "not_found"
  | "ambiguous_target"
  | "unresolved_anchor"
  | "stale_attachment"
  | "conflict"
  | "duplicate_id_mismatch"
  | "unsupported_capability"
  | "too_large"
  | "storage_error"
  | "verification_failed"
  | "unknown_outcome";

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  retryable: boolean;
}

export interface ProtocolResponse<D extends object = object> {
  protocolVersion: typeof PROTOCOL_VERSION;
  operationId: string;
  state: OperationState;
  data: D | null;
  error: ProtocolError | null;
  verification: VerificationSummary;
}
