import type {
  ConnectionStatusResult,
  CreateAnnotationResult,
  CreateNoteResult,
  FindLocalArxivResult,
  ListAnnotationsResult,
  ListNotesResult,
  ReadNoteResult,
  ReadPdfResult,
  RequestFor,
  ResolvedAnchor,
  SearchPapersResult,
  UpdateAnnotationResult,
  UpdateNoteResult,
  VerificationDetail,
} from "../protocol/types.js";
import type { OperationIdentity } from "./execution.js";

export interface ZoteroReadPort {
  connectionStatus(request: RequestFor<"connection_status">): Promise<ConnectionStatusResult>;
  searchPapers(request: RequestFor<"search_papers">): Promise<SearchPapersResult>;
  findLocalArxiv(
    request: RequestFor<"find_local_arxiv">,
  ): Promise<FindLocalArxivResult>;
  readPdf(request: RequestFor<"read_pdf">): Promise<ReadPdfResult>;
  listAnnotations(request: RequestFor<"list_annotations">): Promise<ListAnnotationsResult>;
  listNotes(request: RequestFor<"list_notes">): Promise<ListNotesResult>;
  readNote(request: RequestFor<"read_note">): Promise<ReadNoteResult>;
}

/**
 * Native writes. Implementations must preserve existing files/manual comments,
 * enforce expectedRevision, and record operation identity for reconciliation.
 */
export interface ZoteroWritePort {
  createAnnotation(
    request: RequestFor<"create_annotation">,
    revalidatedAnchor: ResolvedAnchor,
    identity: OperationIdentity,
  ): Promise<CreateAnnotationResult>;
  updateAnnotation(
    request: RequestFor<"update_annotation">,
    identity: OperationIdentity,
  ): Promise<UpdateAnnotationResult>;
  createNote(
    request: RequestFor<"create_note">,
    identity: OperationIdentity,
  ): Promise<CreateNoteResult>;
  updateNote(
    request: RequestFor<"update_note">,
    identity: OperationIdentity,
  ): Promise<UpdateNoteResult>;
}

export interface AnnotationReadbackTarget {
  libraryId: string;
  attachmentKey: string;
  annotationKey: string;
  expectedRevision: string;
}

export interface NoteReadbackTarget {
  libraryId: string;
  itemKey: string;
  noteKey: string;
  expectedRevision: string;
}

/** Storage readback is the success gate for every persisted write. */
export interface ZoteroStorageReadbackPort {
  confirmAnnotation(
    target: AnnotationReadbackTarget,
    identity: OperationIdentity,
  ): Promise<VerificationDetail>;
  confirmNote(target: NoteReadbackTarget, identity: OperationIdentity): Promise<VerificationDetail>;
  verifyAnnotationStorage(
    request: RequestFor<"verify_annotation">,
  ): Promise<VerificationDetail>;
}

/** Viewer evidence comes from the actual reader and is reported independently. */
export interface ZoteroViewerVerificationPort {
  verifyAnnotationInViewer(
    request: RequestFor<"verify_annotation">,
  ): Promise<VerificationDetail>;
}

export interface VisiblePreviewRequest {
  attachmentItemId: number;
  annotationKey: string;
  expectedNativeComment: string;
}

export type VisiblePreviewFailureReason =
  | "renderer_inactive"
  | "attachment_id_invalid"
  | "attachment_reader_missing"
  | "render_format_mismatch"
  | "reader_not_visible"
  | "annotation_surface_inactive"
  | "annotation_surface_missing"
  | "preview_missing"
  | "annotation_key_mismatch"
  | "attachment_id_mismatch"
  | "source_mode"
  | "body_missing"
  | "content_mismatch"
  | "preview_not_visible"
  | "body_not_visible"
  | "annotation_surface_not_visible";

export type VisiblePreviewInspection =
  | { visible: true }
  | { visible: false; reason: VisiblePreviewFailureReason };

/** Content-safe formatted-preview evidence supplied by a reader adapter. */
export interface FormattedPreviewVerificationPort {
  inspectVisiblePreview(request: VisiblePreviewRequest): Promise<VisiblePreviewInspection>;
}
