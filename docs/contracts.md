# Consumer file protocol

Access requires an enabled Zotero extension and an already authorized local-file client. No HTTP endpoint or model API credential is part of this interface. A user-selected dedicated directory is represented below by `<BRIDGE_ROOT>`.

## Session discovery and publication

Read `<BRIDGE_ROOT>/bridge-v1.json`, then the relative `statusFile` it names, then the descriptor again. Require identical complete descriptors and matching bridgeVersion 1, protocolVersion 1, sessionId, profileId, with enabled true in status. Missing, disabled, changed, or wrong-profile state stops publication. Do not choose sessions by modification time.

The descriptor publishes `requestDirectory`, `resultDirectory`, `statusFile`, `requestSuffix`, `resultSuffix`, `maxRequestBytes`, `maxResultBytes`, and `maxRequestsPerScan`. Session paths are relative to the selected root, normally `sessions/<128-bit-session-id>/requests`, `results`, and `status-v1.json`. Current maxima are 1,048,576 request bytes, 8,388,608 result bytes, and 100 requests per scan. Status contains bridgeVersion, protocolVersion, sessionId, profileId, and enabled.

Publish exactly `<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json` as one complete create-only atomic UTF-8 file. If staging is needed, create `<operationId>.request.json.partial` and atomically rename in the same directory without replacing an existing final file. Partial names are ignored. Poll only `<BRIDGE_ROOT>/<resultDirectory>/<operationId>.result.json`; absence means no published result yet, not a proven non-write. Validate response identity and version. Zotero must be running to process requests.

A new connection session does not resume old pending writes. After reconnect, re-establish readiness and renew mutation authority before recovery. Potentially dispatched or running operations retain the same ID and canonical payload. Never infer nonexecution from a missing old-session result. Only an explicit definitive queued-interruption non-write permits rereading the target and approving a fresh mutation identity.

## Request envelope

Every request is a JSON object with these fields:

| Field | Type | Rule |
| --- | --- | --- |
| `protocolVersion` | `1` | Other values return `unsupported_version`. |
| `operationId` | string | Opaque, 1-128 ASCII characters, matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. |
| `operation` | operation name | Must be one of the operations below. |
| `profileId` | string | Required except for `connection_status`, which may use discovery without it. |
| `authorization` | object | Required for mutations and forbidden for reads. |
| `payload` | object | Operation-specific and strictly checked. |

Unknown envelope fields, unknown payload fields, invalid shapes, and invalid values are rejected before a mutation can run. `operationId` may be used to derive a filename only after validation; other request strings must never be used as filenames without an adapter-specific safe mapping.

Mutation authorization has this shape:

```json
{
  "kind": "explicit_request",
  "scope": "Save the full proof on the selected theorem in attachment ATTACH01."
}
```

`kind` is `explicit_request` when the human directly asked for the write or `approved_proposal` when the human accepted an assistant proposal. `scope` is nonempty human-readable text naming the approved content and target. This metadata records intent; it is not a signature or cryptographic proof. It does not replace target validation, revision checks, or anchor revalidation.

The maximum encoded request is 1,048,576 UTF-8 bytes. Query text is limited to 4,096 bytes, quoted passages and contexts to 65,536 bytes each, authorization scope to 16,384 bytes, and a saved comment or note body to 524,288 bytes. A value over a limit returns `too_large`; accepted saved content is never silently truncated.

The saved-body limit includes existing content, separators, and the addition for an append. Note HTML safety encoding also counts toward that limit. An over-limit append leaves the existing record unchanged.

Use a fresh operation ID for each new observation, including reads, status checks, and viewer verification. Reusing an ID returns its recorded historical outcome. Recover an uncertain write using the same ID and byte-equivalent payload. On startup, an interrupted durable `queued` operation becomes `rejected` with nonretryable `storage_error` explaining that it was never executed; it is not resumed. Only after that definitive non-writing result may the client re-read the target, obtain renewed mutation approval, and submit a new ID. An interrupted `running` operation requires native identity reconciliation and may remain `indeterminate`; never replace an unknown write with a new ID.

## Optional note content

Annotation comments retain their editable Markdown and LaTeX source. Optional child notes use Zotero note HTML and follow a separate content policy. Safe new paragraphs, lists, tables, code/preformatted blocks, and HTTP(S) reference links remain functional. Restricted Zotero links may select a library/group item or open its PDF with page/annotation parameters. Links do not load their destination automatically.

Unsafe resource elements in new content are displayed as escaped source instead of active elements. If the remaining content has unsafe destinations, ambiguous HTML, or another sanitizer difference, the complete original fragment is stored as escaped source in a readable preformatted block. The submitted characters remain readable without creating active images, frames, scripts, styles, or automatic network loads. Control characters that Zotero would strip are represented by replacement characters. Safety encoding counts toward the final saved-body byte limit.

Before DOM parsing, note HTML is limited to 64 nesting levels, 2,048 elements, and 65,536 aggregate raw tag characters. New over-budget content uses the escaped-original fallback; an existing over-budget body is unsupported for append. These HTML-work limits do not reduce the plain-text byte allowance.

An append preserves the existing native note body byte-for-byte and adds only the validated new fragment. If the existing body contains active resource markup, unsupported attributes, ambiguous structure, or content that Zotero would normalize destructively, the append is rejected before native mutation. Read the current note and use Zotero's editor to resolve that content, or explicitly approve a replacement; the companion never silently repairs existing rich content. The complete combined note, including the separator, must fit the saved-body limit.

## Primitive wire shapes

Page indexes are zero-based. A page range is inclusive at both ends:

```json
{ "startPageIndex": 0, "endPageIndex": 4 }
```

A range may contain at most 200 pages. A list `limit` is an integer from 1 through 100.

A native rectangle uses the coordinate values supplied by the Zotero/PDF reader boundary:

```json
{ "x1": 10, "y1": 20, "x2": 110, "y2": 34 }
```

All coordinates are finite and nonnegative, with `x2 > x1` and `y2 > y1`. A rectangle list contains 1 through 512 entries. Clients must preserve the adapter-provided native coordinate space. A client-supplied rectangle is only a locator candidate; its shape does not make it trusted geometry.

The native annotation colors supported by v1 are:

```text
#ffd400 #ff6666 #5fb236 #2ea8e5 #a28ae5 #e56eee #f19837 #aaaaaa
```

A resolved anchor has this shape:

```json
{
  "libraryId": "1",
  "itemKey": "ITEM1234",
  "attachmentKey": "ATTACH01",
  "attachmentFingerprint": "sha256:pdf-revision-a",
  "pageIndex": 2,
  "pageLabel": "3",
  "rectangles": [{ "x1": 12, "y1": 30, "x2": 140, "y2": 45 }],
  "selectedText": "posterior concentration",
  "matchEvidence": {
    "method": "exact_quote",
    "matchedText": "posterior concentration",
    "exact": true
  }
}
```

`matchEvidence.method` is `exact_quote`, `quote_with_context`, or `inspected_region`. Quote methods require `matchedText`; `exact_quote` also requires `exact: true`. `selectedText` is required for a highlight and optional for a region-linked note.

The anchor is still untrusted at the native write boundary. Immediately before writing, the native adapter must check the attachment fingerprint, parent and attachment identity, page, quote or inspected-region evidence, and rectangles against the current attachment. A changed fingerprint returns `stale_attachment` and requires resolution again. A missing or ambiguous match returns `unresolved_anchor`; the companion does not guess among geometries.

Revisions and attachment fingerprints are opaque snapshot tokens. Clients compare them for equality and do not interpret their contents.

## Operations

### `connection_status`

Payload: `{}`. `profileId` may be omitted for discovery.

Result fields: protocol version, plugin version, Zotero version, profile identity, enabled state, supported operations, annotation types, native colors, size capabilities, and transport description.

Only operations wired in the running build appear in `capabilities.operations`. The two arXiv operations below are additive protocol-v1 members, but a build that has not wired their source acquisition and native import adapters returns `unsupported_capability` and does not advertise them.

### `inspect_arxiv`

Payload: `{ "url": "https://arxiv.org/abs/2401.01234v2" }`. The URL is nonempty, limited to 4,096 UTF-8 bytes, and must be an uncredentialed official HTTP or HTTPS arXiv abstract or PDF article URL. Modern identifiers use `YYMM.NNNN` or `YYMM.NNNNN`; legacy identifiers use `archive/YYMMNNN`. Numeric months and serials must be valid. A URL may include a positive version suffix and an optional terminal `.pdf`; harmless query and fragment decoration does not change identity. The host retains only the recognized identifier and optional version, and constructs canonical HTTPS URLs itself. `ArticleIdentity.arxivId` never includes the version suffix.

This is a profiled read. Authorization is forbidden, and the host selects the profile's personal library. The result has this shape:

```typescript
type ArticleIdentity = { arxivId: string; version: number };
type ArxivSource = ArticleIdentity & {
  abstractUrl: string;
  pdfUrl: string;
  metadata: {
    title: string;
    authors: string[];
    published: string; // ISO timestamp
    updated: string; // ISO timestamp
    abstract: string; // may be empty
    doi?: string;
  };
};
type ImportSelection =
  | { kind: "create" }
  | { kind: "attach"; itemKey: string; expectedItemRevision: string }
  | { kind: "reuse"; itemKey: string; attachmentKey: string; expectedFingerprint: string };
type ArxivCandidate = {
  itemKey: string;
  itemRevision: string;
  title: string;
  attachments: {
    attachmentKey: string;
    fingerprint: string | null;
    version: number | null;
    identity: "verified" | "unverified";
  }[];
};
type InspectArxivData = {
  source: ArxivSource;
  libraryId: string;
  candidates: ArxivCandidate[];
  decision: "create" | "attach" | "reuse" | "needs_choice";
  reason: string;
  inspectionToken: string;
  selection?: ImportSelection;
};
```

The source comes from one matching metadata entry and names a concrete version. The extension constructs `abstractUrl` and `pdfUrl`; a client cannot provide a download URL or trusted metadata. All returned strings are nonempty except `metadata.abstract`, and optional fields are omitted rather than set to `null`.

Candidate URL or title similarity cannot override conflicting evidence. `identity: "verified"` requires trustworthy native provenance or a demonstrated matching PDF fingerprint. A different existing version or a competing unverified PDF yields `needs_choice`. `selection` is present only for an unambiguous matching `create`, `attach`, or `reuse` decision and is omitted for `needs_choice`; `create` is available only when there is no canonical parent candidate.

The inspection token binds the source identity and version, selected library, and complete relevant native candidate snapshot. It is optimistic conflict evidence, not a credential or mutation authority. A later ensure rejects the token with `conflict` if any bound source, library, item revision, attachment identity, version, or fingerprint changed.

### `ensure_arxiv_pdf`

This is an authorized profiled mutation. Payload:

```json
{
  "source": { "arxivId": "2401.01234", "version": 2 },
  "inspectionToken": "opaque-inspection-token",
  "selection": { "kind": "create" }
}
```

`source` must exactly match the inspected unversioned identity plus positive safe-integer version. `selection` must be one of the strict `ImportSelection` shapes and match the token-bound decision. Unknown or stale tokens do not authorize a best guess. A successful result is:

```typescript
type EnsureArxivPdfData = {
  source: ArticleIdentity;
  libraryId: string;
  completion: "ready" | "item_only";
  itemKey: string;
  itemAction: "created" | "reused";
  attachmentKey: string | null;
  attachmentFingerprint: string | null;
  pdfAction: "downloaded" | "reused" | "none";
  deepLink: string;
};
```

For `succeeded`, `completion` is `ready`, both attachment fields are nonnull, `pdfAction` is `downloaded` or `reused`, storage is `confirmed` by actual native readback, and viewer is `not_checked`. This operation creates no annotations.

If a parent item was definitively committed and read back but PDF acquisition or import then fails, the response may be `failed` with `storage_error` and bounded retained data: `completion: "item_only"`, null attachment fields, `pdfAction: "none"`, and a parent-item deep link. Its verification is `storage: "confirmed"`, `viewer: "not_checked"`. Other precommit failed or rejected responses have null data. A possibly committed outcome is `indeterminate` with `unknown_outcome` and null data; retryability never authorizes a different operation ID for a possibly committed request.

### `search_papers`

Payload:

```json
{ "query": "Bayesian inference", "limit": 25 }
```

`query` is nonempty and `limit` is optional. The result contains `matches`; each match gives `libraryId`, `itemKey`, title, creators, optional year, and attachment summaries. A match list is discovery data. It never implicitly selects a paper or attachment for a later operation.

### `read_pdf`

Payload:

```json
{
  "libraryId": "1",
  "itemKey": "ITEM1234",
  "attachmentKey": "ATTACH01",
  "pageRange": { "startPageIndex": 0, "endPageIndex": 4 }
}
```

The result gives `attachmentFingerprint`, opaque `attachmentRevision`, and `pages`. Each page contains zero-based `pageIndex`, visible `pageLabel`, full extracted `text`, quote `passageCandidates`, and inspected `regionCandidates`.

### `list_annotations`

Payload: `{ "libraryId": "1", "attachmentKey": "ATTACH01" }`.

The result contains native annotation keys, revisions, types, resolved anchors, optional selected text, comments, optional native colors, and deep links.

### `list_notes`

Payload: `{ "libraryId": "1", "itemKey": "ITEM1234", "limit": 25 }`. `limit` is optional.

The result contains child note keys, parent item keys, titles, and current opaque revisions. Listing notes does not select one for an update.

### `read_note`

Payload: `{ "libraryId": "1", "itemKey": "ITEM1234", "noteKey": "NOTE1234" }`.

The result contains the parent item key, note key, current revision, full content, and deep link.

### `resolve_anchor`

The common fields are:

```json
{
  "libraryId": "1",
  "attachmentKey": "ATTACH01",
  "fingerprint": "sha256:pdf-revision-a",
  "pageIndex": 2
}
```

Exactly one locator follows. A quote locator is:

```json
{
  "quote": {
    "exact": "posterior concentration",
    "prefix": "We next prove ",
    "suffix": " under regularity assumptions."
  }
}
```

An inspected-region locator is:

```json
{
  "inspectedRegion": {
    "rectangles": [{ "x1": 12, "y1": 30, "x2": 140, "y2": 45 }],
    "selectedText": "posterior concentration"
  }
}
```

The result is either `{ "status": "resolved", "anchor": ... }` or `{ "status": "unresolved", "reason": ..., "candidates": [...] }`. Candidate anchors are evidence for human inspection, not permission to choose automatically.

### `create_annotation`

This is an authorized mutation. The following complete requests illustrate the intended saved content. Each request has its own identity and approval scope.

A passage-linked study question:

```json
{
  "protocolVersion": 1,
  "operationId": "op.question-2026-10-21-01",
  "operation": "create_annotation",
  "profileId": "profile-A",
  "authorization": {
    "kind": "explicit_request",
    "scope": "Save this study question on the selected posterior-concentration passage in ATTACH01."
  },
  "payload": {
    "anchor": {
      "libraryId": "1",
      "itemKey": "ITEM1234",
      "attachmentKey": "ATTACH01",
      "attachmentFingerprint": "sha256:pdf-revision-a",
      "pageIndex": 2,
      "pageLabel": "3",
      "rectangles": [{ "x1": 12, "y1": 30, "x2": 140, "y2": 45 }],
      "selectedText": "posterior concentration",
      "matchEvidence": {
        "method": "exact_quote",
        "matchedText": "posterior concentration",
        "exact": true
      }
    },
    "type": "note",
    "comment": "Question: Which step fails if the prior assigns zero mass to every Kullback-Leibler neighborhood of the true distribution?",
    "color": "#2ea8e5"
  }
}
```

A long proof saved in full as an annotation comment:

```json
{
  "protocolVersion": 1,
  "operationId": "op.proof-2026-10-21-01",
  "operation": "create_annotation",
  "profileId": "profile-A",
  "authorization": {
    "kind": "approved_proposal",
    "scope": "Save the complete proof explanation below on the selected theorem passage in ATTACH01; keep it as an annotation comment."
  },
  "payload": {
    "anchor": {
      "libraryId": "1",
      "itemKey": "ITEM1234",
      "attachmentKey": "ATTACH01",
      "attachmentFingerprint": "sha256:pdf-revision-a",
      "pageIndex": 2,
      "pageLabel": "3",
      "rectangles": [{ "x1": 12, "y1": 30, "x2": 140, "y2": 45 }],
      "selectedText": "posterior concentration",
      "matchEvidence": {
        "method": "exact_quote",
        "matchedText": "posterior concentration",
        "exact": true
      }
    },
    "type": "highlight",
    "comment": "Proof explanation: Let U be any open neighborhood of the true parameter and write U^c for its complement. The denominator of Bayes' rule receives positive prior mass from a Kullback-Leibler neighborhood of the truth. The law of large numbers therefore gives a lower exponential bound for that denominator with probability tending to one. For the numerator over U^c, cover U^c by finitely many sets separated from the truth and choose a uniformly consistent test for each set. Split the numerator according to the test outcome. The type-I terms vanish under the true distribution, while the type-II terms are exponentially small uniformly on each separated set. Summing the finite cover preserves exponential decay. Dividing this numerator bound by the denominator bound shows that the posterior mass of U^c converges to zero. Hence the posterior mass of U converges to one. The two essential assumptions are positive prior mass near the truth and tests that separate the complement; without either assumption the ratio argument does not close.",
    "color": "#ffd400"
  }
}
```

A passage-linked reference annotation:

```json
{
  "protocolVersion": 1,
  "operationId": "op.references-2026-10-21-01",
  "operation": "create_annotation",
  "profileId": "profile-A",
  "authorization": {
    "kind": "explicit_request",
    "scope": "Save these two reference links and their relevance on the selected posterior-concentration passage in ATTACH01."
  },
  "payload": {
    "anchor": {
      "libraryId": "1",
      "itemKey": "ITEM1234",
      "attachmentKey": "ATTACH01",
      "attachmentFingerprint": "sha256:pdf-revision-a",
      "pageIndex": 2,
      "pageLabel": "3",
      "rectangles": [{ "x1": 12, "y1": 30, "x2": 140, "y2": 45 }],
      "selectedText": "posterior concentration",
      "matchEvidence": {
        "method": "exact_quote",
        "matchedText": "posterior concentration",
        "exact": true
      }
    },
    "type": "highlight",
    "comment": "References: Ghosal and van der Vaart, Fundamentals of Nonparametric Bayesian Inference, https://doi.org/10.1017/CBO9781139029834, gives the testing-and-prior-mass framework used here. Kleijn and van der Vaart, The Bernstein-von Mises theorem under misspecification, https://doi.org/10.1214/12-EJS675, explains how the concentration argument changes when the model is misspecified.",
    "color": "#a28ae5"
  }
}
```

`type` is `highlight` or `note`; `color` is optional. Long content stays in `comment` and is not converted into a child note. The result contains the native `annotationKey`, revision, deep link, and an exact `saved` snapshot with page, rectangles, selected text when applicable, and complete comment. The native writer must revalidate the anchor before creating anything.

### `update_annotation`

This is an authorized mutation. A complete revision-checked append request is:

```json
{
  "protocolVersion": 1,
  "operationId": "op.annotation-revision-2026-10-21-01",
  "operation": "update_annotation",
  "profileId": "profile-A",
  "authorization": {
    "kind": "explicit_request",
    "scope": "After reading ANN00001 at rev:9, append the denominator detail to that annotation while preserving its existing comment."
  },
  "payload": {
    "libraryId": "1",
    "attachmentKey": "ATTACH01",
    "annotationKey": "ANN00001",
    "expectedRevision": "rev:9",
    "mode": "append",
    "comment": "Additional detail: the denominator bound uses positive prior mass in a Kullback-Leibler neighborhood."
  }
}
```

The result contains the key, new revision, complete saved comment, and deep link. `mode` must be `append` or `replace`. `append` preserves the existing comment verbatim and adds the requested content; `replace` uses the complete approved replacement comment. If the stored revision differs from `expectedRevision`, the adapter returns `conflict` without writing.

### `create_note`

This is an authorized mutation. Payload: `{ "libraryId": "1", "itemKey": "ITEM1234", "content": "Create this separate synthesis note because the researcher explicitly requested one." }`.

The result contains the child note key, revision, complete saved content, and deep link. This operation is never inferred from annotation length.

### `update_note`

This is an authorized mutation. Payload:

```json
{
  "libraryId": "1",
  "itemKey": "ITEM1234",
  "noteKey": "NOTE1234",
  "expectedRevision": "rev:9",
  "mode": "append",
  "content": "A new study question"
}
```

The result contains the key, new revision, complete saved content, and deep link. `mode` must be `append` or `replace`. `append` preserves existing content; `replace` uses the complete approved replacement content under the note safety policy. A stale `expectedRevision` returns `conflict` without writing.

### `verify_annotation`

Payload: `{ "libraryId": "1", "attachmentKey": "ATTACH01", "annotationKey": "ANN00001" }`.

The result reports two pieces of evidence: a storage readback and evidence from the actual Zotero PDF reader. Reading the storage record is not viewer confirmation. Viewer evidence must come from the reader integration.

## Response envelope

Every response has this exact top-level form:

```json
{
  "protocolVersion": 1,
  "operationId": "op.create-1",
  "state": "succeeded",
  "data": {},
  "error": null,
  "verification": {
    "storage": "confirmed",
    "viewer": "failed"
  }
}
```

`state` is `queued`, `running`, `succeeded`, `rejected`, `failed`, or `indeterminate`. `data` is an operation-specific object or `null`. `error` is `null` or `{ "code": string, "message": string, "retryable": boolean }`.

Both verification fields use `not_applicable`, `not_checked`, `confirmed`, or `failed`. A persisted write reaches `succeeded` only after storage readback is `confirmed`. Viewer confirmation is separate: a write with confirmed storage and failed viewer evidence remains `succeeded`, reports `viewer: "failed"`, and is not retried. If a possible native write has no confirmed readback, its state is `indeterminate` and the same operation must not be blindly executed again.

Error codes are:

```text
invalid_request unsupported_version unsupported_operation permission_denied
not_connected not_found ambiguous_target unresolved_anchor stale_attachment
conflict duplicate_id_mismatch unsupported_capability too_large storage_error
verification_failed unknown_outcome
```

For the arXiv operations, malformed or unsupported source input maps to `invalid_request` or `unsupported_capability`; an absent article/version maps to `not_found`; source retrieval, PDF download, and a known import failure map to `storage_error`. Missing local authority maps to `permission_denied` or `not_connected`, limits to `too_large`, a stale inspection token to `conflict`, a changed selected attachment to `stale_attachment`, and unresolved competing candidates to `ambiguous_target`. `retryable` describes the same operation's condition; it never authorizes a new operation ID for a possibly committed mutation.

## Successful response data

The following shapes describe `data` inside the response envelope, not additional top-level fields. `?` denotes a field that may be omitted (not an alternative `null` value), `[]` an array, and `ResolvedAnchor` the complete anchor shape defined above. Strings containing content are returned in full within the response limits. Compare opaque revision tokens exactly; use the returned revision for a later approved update.

| Operation | `data` shape |
| --- | --- |
| `connection_status` | `ConnectionStatus` |
| `inspect_arxiv` | `InspectArxivData` |
| `ensure_arxiv_pdf` | `EnsureArxivPdfData` with `completion: "ready"` on success |
| `search_papers` | `{ matches: PaperMatch[] }` |
| `read_pdf` | `{ attachmentFingerprint: string, attachmentRevision: string, pages: PdfPage[] }` |
| `list_annotations` | `{ annotations: NativeAnnotation[] }` |
| `list_notes` | `{ notes: NoteSummary[] }` |
| `read_note` | `{ parentItemKey: string, noteKey: string, revision: string, content: string, deepLink: string }` |
| `resolve_anchor` | `{ status: "resolved", anchor: ResolvedAnchor }` or `{ status: "unresolved", reason: string, candidates: AnchorCandidate[] }` |
| `create_annotation` | `{ annotationKey: string, revision: string, deepLink: string, saved: SavedAnnotationSnapshot }` |
| `update_annotation` | `{ annotationKey: string, revision: string, comment: string, deepLink: string }` |
| `create_note`, `update_note` | `{ noteKey: string, revision: string, content: string, deepLink: string }` |
| `verify_annotation` | `{ annotationKey: string, storageEvidence: VerificationDetail, viewerEvidence: VerificationDetail }` |

Named shapes use this TypeScript-style notation solely to specify JSON fields; clients need no TypeScript runtime:

```typescript
type ConnectionStatus = {
  protocolVersion: 1;
  pluginVersion: string;
  zoteroVersion: string;
  profile: { id: string; name?: string };
  enabled: boolean;
  capabilities: {
    operations: string[]; // operation names from this contract
    annotationTypes: ("highlight" | "note")[];
    annotationColors: string[]; // supported colors listed above
    maxRequestBytes: number;
    maxTextBytes: number;
  };
  transport: {
    kind: "http" | "native_messaging" | "custom";
    description: string;
  };
};
type AttachmentSummary = {
  attachmentKey: string;
  title: string;
  contentType: string;
  fingerprint?: string;
};
type PaperMatch = {
  libraryId: string;
  itemKey: string;
  title: string;
  creators: string[];
  year?: number;
  attachments: AttachmentSummary[];
};
type PdfPage = {
  pageIndex: number;
  pageLabel: string;
  text: string;
  passageCandidates: { exact: string; prefix?: string; suffix?: string }[];
  regionCandidates: { rectangles: NativeRectangle[]; selectedText?: string }[];
};
type NativeAnnotation = {
  annotationKey: string;
  revision: string;
  type: "highlight" | "note";
  anchor: ResolvedAnchor;
  text?: string;
  comment: string;
  color?: string; // supported native color
  deepLink: string;
};
type NoteSummary = {
  noteKey: string;
  parentItemKey: string;
  title: string;
  revision: string;
};
type AnchorCandidate = { anchor: ResolvedAnchor; reason: string };
type SavedAnnotationSnapshot = {
  pageIndex: number;
  pageLabel: string;
  rectangles: NativeRectangle[];
  selectedText?: string;
  comment: string;
};
type VerificationDetail = { confirmed: boolean; description: string };
```

`NativeRectangle` is the four-number rectangle defined above. Page labels are display strings; page indexes remain zero-based. Passage and region candidates are evidence for resolution, not preapproved write targets. An unresolved resolver result does not authorize a write even if the operation itself completed successfully.

For annotation creation, `saved.comment` is the persisted complete comment; for annotation updates, `comment` is the complete resulting comment rather than only the appended fragment. Note mutation `content` is the complete saved native HTML after the note safety policy. `deepLink` selects the native record; opening it is an explicit client/user action, not automatic network access.

Verification descriptions are diagnostic text, not stable machine-readable error codes. Read each evidence object's `confirmed` boolean together with the envelope's independent `verification.storage` and `verification.viewer` states. Neither a successful verification request nor a deep link proves that its viewer evidence is confirmed. The current file transport reports `kind: "custom"`; other transport kinds in the versioned shape do not claim an installed HTTP or native-messaging endpoint.

The response validator receives the submitted operation name and validates its complete result shape. The published response schema has no generic object fallback: each of the fourteen success data shapes is closed to unknown fields. It also constrains lifecycle data. Queued and running responses have null data and error; succeeded responses have a complete success shape and null error; rejected and indeterminate responses have null data. The sole failed-data exception is the confirmed `ensure_arxiv_pdf` `item_only` shape described above. A malformed arXiv object cannot pass through one of the legacy result alternatives.

## Identity, lifecycle, conflicts, and recovery

The canonical digest covers `protocolVersion`, `operation`, `profileId` when present, authorization when present, and the operation payload. It excludes `operationId`, because the durable identity is the pair of the opaque ID and this digest. Object keys are sorted recursively; array order is preserved; non-JSON values and nonfinite numbers are rejected. The identity digest is a collision-resistant cryptographic hash of the canonical UTF-8 bytes.

An operation store atomically claims the ID and digest. The allowed lifecycle is:

```text
queued -> running -> succeeded | rejected | failed | indeterminate
queued -> rejected
```

The second path is only for a request rejected before execution. Terminal states are immutable. A second submission with the same ID and canonical request returns the durable prior state and result. The executor does not run again. Reusing the same ID with different request content returns `duplicate_id_mismatch` and leaves the historical record unchanged. Polling reads the durable record and never submits an operation.

Mutations are serialized per profile. There is no implicit atomic batch transaction across operation IDs.

`expectedRevision` is checked against the actual current target immediately before an update. A manual edit or sync update that changes the revision returns `conflict`; it is never overwritten. After a conflict, the client must read the target again and obtain renewed human approval for the updated content and target before sending a new operation ID.

Historical operation identity and results survive ordinary plugin reinstall or upgrade. A crash-left `running` write is reconciled against its recorded native identity; recovery does not create the item again. A previously succeeded operation is returned from history even if a person later deletes its annotation. If commit status cannot be proven, recovery returns `indeterminate` with `unknown_outcome`.

This additive change retains `protocolVersion: 1`. Requests for the original twelve operations and durable journal records written by plugin version 0.1.0 remain readable with their historical outcomes unchanged.
