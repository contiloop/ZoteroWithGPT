import { assertExpectedRevision } from "../../core/revision-policy.js";
import { CoreOperationError } from "../../core/errors.js";
import type { PayloadDigestPort } from "../../ports/digest.js";
import type { OperationIdentity } from "../../ports/execution.js";
import type { AnchorPage, AnchorPageSource } from "../anchors/zotero-anchor-resolver.js";
import {
  MAX_REQUEST_BYTES,
  MAX_TEXT_BYTES,
  NATIVE_ANNOTATION_COLORS,
  OPERATION_NAMES,
  PROTOCOL_VERSION,
  type ConnectionStatusResult,
  type CreateAnnotationResult,
  type CreateNoteResult,
  type ListAnnotationsResult,
  type ListNotesResult,
  type NativeAnnotation,
  type NativeAnnotationColor,
  type ReadNoteResult,
  type ReadPdfResult,
  type RequestFor,
  type SearchPapersResult,
  type UpdateAnnotationResult,
  type UpdateNoteResult,
  type VerificationDetail,
} from "../../protocol/index.js";
import type {
  AnnotationReadbackTarget,
  NoteReadbackTarget,
  ZoteroReadPort,
  ZoteroStorageReadbackPort,
  ZoteroViewerVerificationPort,
  ZoteroWritePort,
} from "../../ports/zotero.js";
import { passageCandidates, rectanglesForTextRange, renderTextLayer } from "../anchors/text-layer.js";
import type {
  NativeAnnotationRecord,
  NativeNoteRecord,
  ZoteroLibraryAdapterOptions,
  ZoteroNativeApi,
} from "./native-api.js";
import {
  annotationDeepLink,
  annotationRevision,
  appendNoteContent,
  nativeNoteContent,
  noteDeepLink,
  noteRevision,
  operationIdentityMarker,
} from "./record-utils.js";

const DEFAULT_LIMIT = 25;
const DEFAULT_ANNOTATION_COLOR: NativeAnnotationColor = "#ffd400";

function notFound(message: string): never {
  throw new CoreOperationError("not_found", message);
}

function exactRectangles(left: readonly object[], right: readonly object[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasMarker(record: { operationMarkers: string[] }, marker: string): boolean {
  return record.operationMarkers.includes(marker);
}

function annotationSavedMatches(
  record: NativeAnnotationRecord,
  expected: {
    comment: string;
    marker: string;
    pageIndex: number;
    pageLabel: string;
    rectangles: readonly object[];
    selectedText?: string;
  },
): boolean {
  return (
    record.comment === expected.comment &&
    record.pageIndex === expected.pageIndex &&
    record.pageLabel === expected.pageLabel &&
    exactRectangles(record.rectangles, expected.rectangles) &&
    (expected.selectedText === undefined || record.text === expected.selectedText) &&
    hasMarker(record, expected.marker)
  );
}

function supportedColor(value: string | undefined): value is NativeAnnotationColor {
  return (
    value !== undefined &&
    (NATIVE_ANNOTATION_COLORS as readonly string[]).includes(value)
  );
}

export class ZoteroLibraryAdapter
  implements
    ZoteroReadPort,
    ZoteroWritePort,
    ZoteroStorageReadbackPort,
    ZoteroViewerVerificationPort,
    AnchorPageSource
{
  readonly #native: ZoteroNativeApi;
  readonly #digest: PayloadDigestPort;
  readonly #profileId: string;
  readonly #pluginVersion: string;
  #enabled: boolean;
  readonly #accessGate: ZoteroLibraryAdapterOptions["accessGate"];
  readonly #transport: ZoteroLibraryAdapterOptions["transport"];

  constructor(options: ZoteroLibraryAdapterOptions) {
    this.#native = options.native;
    this.#digest = options.digest;
    this.#profileId = options.profileId;
    this.#pluginVersion = options.pluginVersion;
    this.#enabled = options.enabled;
    this.#accessGate = options.accessGate;
    this.#transport = options.transport;
  }

  async connectionStatus(
    _request: RequestFor<"connection_status">,
  ): Promise<ConnectionStatusResult> {
    const runtime = await this.#native.runtimeStatus();
    return {
      protocolVersion: PROTOCOL_VERSION,
      pluginVersion: this.#pluginVersion,
      zoteroVersion: runtime.zoteroVersion,
      profile: {
        id: this.#profileId,
        ...(runtime.profileName === undefined ? {} : { name: runtime.profileName }),
      },
      enabled: this.#isEnabled(),
      capabilities: {
        operations: [...OPERATION_NAMES],
        annotationTypes: ["highlight", "note"],
        annotationColors: [...NATIVE_ANNOTATION_COLORS],
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxTextBytes: MAX_TEXT_BYTES,
      },
      transport: { ...this.#transport },
    };
  }

  async searchPapers(request: RequestFor<"search_papers">): Promise<SearchPapersResult> {
    this.#assertProfile(request.profileId);
    const matches = await this.#native.searchPapers(
      request.payload.query,
      request.payload.limit ?? DEFAULT_LIMIT,
    );
    return {
      matches: matches.map((match) => ({
        libraryId: match.libraryId,
        itemKey: match.itemKey,
        title: match.title,
        creators: [...match.creators],
        ...(match.year === undefined ? {} : { year: match.year }),
        attachments: match.attachments.map((attachment) => ({ ...attachment })),
      })),
    };
  }

  async readPdf(request: RequestFor<"read_pdf">): Promise<ReadPdfResult> {
    this.#assertProfile(request.profileId);
    const attachment = await this.#native.getPdfAttachment(
      request.payload.libraryId,
      request.payload.attachmentKey,
      request.payload.itemKey,
    );
    if (attachment === undefined) notFound("The requested PDF attachment was not found under that item");
    const { startPageIndex, endPageIndex } = request.payload.pageRange;
    if (endPageIndex >= attachment.pageCount) {
      notFound("The requested page range exceeds the current PDF page count");
    }
    const pages = [];
    for (let pageIndex = startPageIndex; pageIndex <= endPageIndex; pageIndex += 1) {
      const page = await this.#native.readPdfPage(attachment, pageIndex);
      const layer = renderTextLayer(page.chars);
      const regionRectangles = rectanglesForTextRange(
        page.chars,
        layer,
        0,
        layer.text.length,
      );
      pages.push({
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        text: layer.text,
        passageCandidates: passageCandidates(layer.text),
        regionCandidates:
          regionRectangles.length === 0
            ? []
            : [{ rectangles: regionRectangles, ...(layer.text ? { selectedText: layer.text } : {}) }],
      });
    }
    return {
      attachmentFingerprint: attachment.fingerprint,
      attachmentRevision: attachment.revision,
      pages,
    };
  }

  async readAnchorPage(
    libraryId: string,
    attachmentKey: string,
    pageIndex: number,
  ): Promise<AnchorPage> {
    const attachment = await this.#native.getPdfAttachment(libraryId, attachmentKey);
    if (attachment === undefined) notFound("The PDF attachment was not found");
    if (pageIndex >= attachment.pageCount) notFound("The PDF page was not found");
    const page = await this.#native.readPdfPage(attachment, pageIndex);
    return {
      libraryId: attachment.libraryId,
      itemKey: attachment.itemKey,
      attachmentKey: attachment.attachmentKey,
      attachmentFingerprint: attachment.fingerprint,
      pageIndex: page.pageIndex,
      pageLabel: page.pageLabel,
      viewBox: page.viewBox,
      chars: page.chars,
    };
  }

  async confirmInspectedRegion(
    page: AnchorPage,
    _region: {
      rectangles: import("../../protocol/types.js").NativeRectangle[];
      selectedText?: string;
    },
  ): Promise<
    | {
        confirmed: true;
        rectangles: import("../../protocol/types.js").NativeRectangle[];
        selectedText?: string;
      }
    | { confirmed: false; reason: string }
  > {
    const confirm = this.#native.confirmInspectedRegion;
    if (confirm === undefined) {
      return {
        confirmed: false,
        reason: "The native adapter cannot inspect a live Zotero reader selection",
      };
    }
    const evidence = await confirm.call(
      this.#native,
      page.libraryId,
      page.attachmentKey,
      page.pageIndex,
    );
    return evidence === undefined
      ? {
          confirmed: false,
          reason: "No matching live Zotero reader selection is currently available",
        }
      : { confirmed: true, ...evidence };
  }

  async listAnnotations(
    request: RequestFor<"list_annotations">,
  ): Promise<ListAnnotationsResult> {
    this.#assertProfile(request.profileId);
    const attachment = await this.#native.getPdfAttachment(
      request.payload.libraryId,
      request.payload.attachmentKey,
    );
    if (attachment === undefined) notFound("The PDF attachment was not found");
    const records = await this.#native.listAnnotations(
      request.payload.libraryId,
      request.payload.attachmentKey,
    );
    return {
      annotations: await Promise.all(
        records.map((record) => this.#nativeAnnotation(record, attachment.fingerprint)),
      ),
    };
  }

  async listNotes(request: RequestFor<"list_notes">): Promise<ListNotesResult> {
    this.#assertProfile(request.profileId);
    const records = await this.#native.listNotes(request.payload.libraryId, request.payload.itemKey);
    return {
      notes: await Promise.all(
        records.slice(0, request.payload.limit ?? DEFAULT_LIMIT).map(async (record) => ({
          noteKey: record.noteKey,
          parentItemKey: record.itemKey,
          title: record.title,
          revision: await noteRevision(record, this.#digest),
        })),
      ),
    };
  }

  async readNote(request: RequestFor<"read_note">): Promise<ReadNoteResult> {
    this.#assertProfile(request.profileId);
    const record = await this.#native.getNote(
      request.payload.libraryId,
      request.payload.itemKey,
      request.payload.noteKey,
    );
    if (record === undefined) notFound("The child note was not found under that item");
    return this.#readNoteResult(record);
  }

  async createAnnotation(
    request: RequestFor<"create_annotation">,
    revalidatedAnchor: import("../../protocol/types.js").ResolvedAnchor,
    identity: OperationIdentity,
  ): Promise<CreateAnnotationResult> {
    this.#assertProfile(request.profileId);
    if (
      request.payload.anchor.libraryId !== revalidatedAnchor.libraryId ||
      request.payload.anchor.itemKey !== revalidatedAnchor.itemKey ||
      request.payload.anchor.attachmentKey !== revalidatedAnchor.attachmentKey ||
      request.payload.anchor.attachmentFingerprint !== revalidatedAnchor.attachmentFingerprint ||
      !exactRectangles(request.payload.anchor.rectangles, revalidatedAnchor.rectangles)
    ) {
      throw new CoreOperationError("unresolved_anchor", "The write anchor differs from revalidated evidence");
    }
    if (request.payload.type === "highlight" && revalidatedAnchor.selectedText === undefined) {
      throw new CoreOperationError("unresolved_anchor", "A highlight requires revalidated selected text");
    }
    const attachment = await this.#native.getPdfAttachment(
      revalidatedAnchor.libraryId,
      revalidatedAnchor.attachmentKey,
      revalidatedAnchor.itemKey,
    );
    if (attachment === undefined) notFound("The revalidated PDF attachment was not found");
    if (attachment.fingerprint !== revalidatedAnchor.attachmentFingerprint) {
      throw new CoreOperationError(
        "stale_attachment",
        "The PDF fingerprint changed immediately before the native write",
      );
    }
    const marker = operationIdentityMarker(identity);
    this.#assertProfile(request.profileId);
    const record = await this.#native.createAnnotation({
      anchor: revalidatedAnchor,
      type: request.payload.type,
      comment: request.payload.comment,
      color: request.payload.color ?? DEFAULT_ANNOTATION_COLOR,
      operationMarker: marker,
    });
    const readback = await this.#native.getAnnotation(
      revalidatedAnchor.libraryId,
      revalidatedAnchor.attachmentKey,
      record.annotationKey,
    );
    if (
      readback === undefined ||
      !annotationSavedMatches(readback, {
        comment: request.payload.comment,
        marker,
        pageIndex: revalidatedAnchor.pageIndex,
        pageLabel: revalidatedAnchor.pageLabel,
        rectangles: revalidatedAnchor.rectangles,
        ...(request.payload.type !== "highlight" || revalidatedAnchor.selectedText === undefined
          ? {}
          : { selectedText: revalidatedAnchor.selectedText }),
      })
    ) {
      throw new Error("Native annotation commit could not be confirmed by exact storage readback");
    }
    return {
      annotationKey: readback.annotationKey,
      revision: await annotationRevision(readback, this.#digest),
      deepLink: annotationDeepLink(readback),
      saved: {
        pageIndex: readback.pageIndex,
        pageLabel: readback.pageLabel,
        rectangles: readback.rectangles.map((rectangle) => ({ ...rectangle })),
        ...(readback.text === undefined && revalidatedAnchor.selectedText === undefined
          ? {}
          : { selectedText: readback.text ?? revalidatedAnchor.selectedText }),
        comment: readback.comment,
      },
    };
  }

  async updateAnnotation(
    request: RequestFor<"update_annotation">,
    identity: OperationIdentity,
  ): Promise<UpdateAnnotationResult> {
    this.#assertProfile(request.profileId);
    const current = await this.#native.getAnnotation(
      request.payload.libraryId,
      request.payload.attachmentKey,
      request.payload.annotationKey,
    );
    if (current === undefined) notFound("The annotation was not found under that attachment");
    assertExpectedRevision(
      request.payload.expectedRevision,
      await annotationRevision(current, this.#digest),
    );
    const comment =
      request.payload.mode === "append"
        ? `${current.comment}\n\n${request.payload.comment}`
        : request.payload.comment;
    const marker = operationIdentityMarker(identity);
    this.#assertProfile(request.profileId);
    await this.#native.updateAnnotation({ expected: current, comment, operationMarker: marker });
    const readback = await this.#native.getAnnotation(
      request.payload.libraryId,
      request.payload.attachmentKey,
      request.payload.annotationKey,
    );
    if (readback === undefined || readback.comment !== comment || !hasMarker(readback, marker)) {
      throw new Error("Native annotation update could not be confirmed by exact storage readback");
    }
    return {
      annotationKey: readback.annotationKey,
      revision: await annotationRevision(readback, this.#digest),
      comment: readback.comment,
      deepLink: annotationDeepLink(readback),
    };
  }

  async createNote(
    request: RequestFor<"create_note">,
    identity: OperationIdentity,
  ): Promise<CreateNoteResult> {
    this.#assertProfile(request.profileId);
    const marker = operationIdentityMarker(identity);
    const content = nativeNoteContent(request.payload.content);
    this.#assertProfile(request.profileId);
    const record = await this.#native.createNote({
      libraryId: request.payload.libraryId,
      itemKey: request.payload.itemKey,
      content,
      operationMarker: marker,
    });
    const readback = await this.#native.getNote(
      request.payload.libraryId,
      request.payload.itemKey,
      record.noteKey,
    );
    if (readback === undefined || readback.content !== content || !hasMarker(readback, marker)) {
      throw new Error("Native child-note commit could not be confirmed by exact storage readback");
    }
    return this.#createNoteResult(readback);
  }

  async updateNote(
    request: RequestFor<"update_note">,
    identity: OperationIdentity,
  ): Promise<UpdateNoteResult> {
    this.#assertProfile(request.profileId);
    const current = await this.#native.getNote(
      request.payload.libraryId,
      request.payload.itemKey,
      request.payload.noteKey,
    );
    if (current === undefined) notFound("The child note was not found under that item");
    assertExpectedRevision(request.payload.expectedRevision, await noteRevision(current, this.#digest));
    const content =
      request.payload.mode === "append"
        ? appendNoteContent(current.content, request.payload.content)
        : nativeNoteContent(request.payload.content);
    const marker = operationIdentityMarker(identity);
    this.#assertProfile(request.profileId);
    await this.#native.updateNote({ expected: current, content, operationMarker: marker });
    const readback = await this.#native.getNote(
      request.payload.libraryId,
      request.payload.itemKey,
      request.payload.noteKey,
    );
    if (readback === undefined || readback.content !== content || !hasMarker(readback, marker)) {
      throw new Error("Native child-note update could not be confirmed by exact storage readback");
    }
    return this.#createNoteResult(readback);
  }

  async confirmAnnotation(
    target: AnnotationReadbackTarget,
    identity: OperationIdentity,
  ): Promise<VerificationDetail> {
    const record = await this.#native.getAnnotation(
      target.libraryId,
      target.attachmentKey,
      target.annotationKey,
    );
    if (record === undefined) {
      return { confirmed: false, description: "The native annotation is absent from storage" };
    }
    const marker = operationIdentityMarker(identity);
    if (!hasMarker(record, marker)) {
      return {
        confirmed: false,
        description: "The native annotation lacks the committed operation identity",
      };
    }
    const revision = await annotationRevision(record, this.#digest);
    return {
      confirmed: revision === target.expectedRevision,
      description:
        revision === target.expectedRevision
          ? "Fresh native storage readback confirmed the annotation revision and operation identity"
          : "The native annotation revision changed before storage confirmation",
    };
  }

  async confirmNote(
    target: NoteReadbackTarget,
    identity: OperationIdentity,
  ): Promise<VerificationDetail> {
    const record = await this.#native.getNote(target.libraryId, target.itemKey, target.noteKey);
    if (record === undefined) {
      return { confirmed: false, description: "The native child note is absent from storage" };
    }
    const marker = operationIdentityMarker(identity);
    if (!hasMarker(record, marker)) {
      return {
        confirmed: false,
        description: "The native child note lacks the committed operation identity",
      };
    }
    const revision = await noteRevision(record, this.#digest);
    return {
      confirmed: revision === target.expectedRevision,
      description:
        revision === target.expectedRevision
          ? "Fresh native storage readback confirmed the child-note revision and operation identity"
          : "The native child-note revision changed before storage confirmation",
    };
  }

  async verifyAnnotationStorage(
    request: RequestFor<"verify_annotation">,
  ): Promise<VerificationDetail> {
    this.#assertProfile(request.profileId);
    const record = await this.#native.getAnnotation(
      request.payload.libraryId,
      request.payload.attachmentKey,
      request.payload.annotationKey,
    );
    return record === undefined
      ? { confirmed: false, description: "The annotation is absent from native storage" }
      : {
          confirmed: true,
          description: `Fresh native storage readback found annotation ${record.annotationKey}`,
        };
  }

  async verifyAnnotationInViewer(
    request: RequestFor<"verify_annotation">,
  ): Promise<VerificationDetail> {
    this.#assertProfile(request.profileId);
    const visible = await this.#native.annotationVisible(
      request.payload.libraryId,
      request.payload.attachmentKey,
      request.payload.annotationKey,
    );
    return {
      confirmed: visible,
      description: visible
        ? "The current native annotation comment is visible in an active Zotero reader"
        : "Could not confirm the current native annotation comment in an active Zotero reader",
    };
  }

  async #nativeAnnotation(
    record: NativeAnnotationRecord,
    attachmentFingerprint: string,
  ): Promise<NativeAnnotation> {
    return {
      annotationKey: record.annotationKey,
      revision: await annotationRevision(record, this.#digest),
      type: record.type,
      anchor: {
        libraryId: record.libraryId,
        itemKey: record.itemKey,
        attachmentKey: record.attachmentKey,
        attachmentFingerprint,
        pageIndex: record.pageIndex,
        pageLabel: record.pageLabel,
        rectangles: record.rectangles.map((rectangle) => ({ ...rectangle })),
        ...(record.text === undefined ? {} : { selectedText: record.text }),
        matchEvidence: {
          method: "inspected_region",
          ...(record.text === undefined ? {} : { matchedText: record.text }),
          exact: true,
        },
      },
      ...(record.text === undefined ? {} : { text: record.text }),
      comment: record.comment,
      ...(supportedColor(record.color) ? { color: record.color } : {}),
      deepLink: annotationDeepLink(record),
    };
  }

  async #readNoteResult(record: NativeNoteRecord): Promise<ReadNoteResult> {
    return {
      parentItemKey: record.itemKey,
      noteKey: record.noteKey,
      revision: await noteRevision(record, this.#digest),
      content: record.content,
      deepLink: noteDeepLink(record),
    };
  }

  async #createNoteResult(record: NativeNoteRecord): Promise<CreateNoteResult> {
    return {
      noteKey: record.noteKey,
      revision: await noteRevision(record, this.#digest),
      content: record.content,
      deepLink: noteDeepLink(record),
    };
  }

  /** Stops new reads and prevents mutations that have not reached native commit. */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#accessGate?.setEnabled?.(enabled);
  }

  #isEnabled(): boolean {
    return this.#enabled && (this.#accessGate?.isEnabled() ?? true);
  }

  #assertProfile(profileId: string): void {
    if (profileId !== this.#profileId) {
      throw new CoreOperationError("permission_denied", "The request targets a different Zotero profile");
    }
    if (!this.#isEnabled()) {
      throw new CoreOperationError("permission_denied", "Zotero companion writes and reads are disabled");
    }
  }
}
