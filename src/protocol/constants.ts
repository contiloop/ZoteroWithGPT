import type { MutationOperationName, NativeAnnotationColor, OperationName } from "./types.js";

export const MAX_REQUEST_BYTES = 1_048_576;
export const MAX_TEXT_BYTES = 524_288;
export const MAX_EXCERPT_BYTES = 65_536;
export const MAX_QUERY_BYTES = 4_096;
export const MAX_URL_BYTES = 4_096;
export const MAX_AUTHORIZATION_SCOPE_BYTES = 16_384;
export const MAX_IDENTIFIER_BYTES = 512;
export const MAX_PAGE_SPAN = 200;
export const MAX_RESULT_LIMIT = 100;
export const MAX_RECTANGLES = 512;

export const NATIVE_ANNOTATION_COLORS = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
] as const satisfies readonly NativeAnnotationColor[];

export const BASE_OPERATION_NAMES = [
  "connection_status",
  "search_papers",
  "read_pdf",
  "list_annotations",
  "list_notes",
  "read_note",
  "resolve_anchor",
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "verify_annotation",
] as const satisfies readonly OperationName[];

export const ARXIV_OPERATION_NAMES = [
  "inspect_arxiv",
  "ensure_arxiv_pdf",
] as const satisfies readonly OperationName[];

/** Parsed protocol members that remain unadvertised until their native wiring lands. */
export const LOCAL_STUDY_OPERATION_NAMES = [
  "find_local_arxiv",
] as const satisfies readonly OperationName[];

export const OPERATION_NAMES = [
  ...BASE_OPERATION_NAMES,
  ...ARXIV_OPERATION_NAMES,
  ...LOCAL_STUDY_OPERATION_NAMES,
] as const satisfies readonly OperationName[];

export const MUTATION_OPERATION_NAMES = [
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "ensure_arxiv_pdf",
] as const satisfies readonly MutationOperationName[];

export function isMutationOperation(operation: OperationName): operation is MutationOperationName {
  return (MUTATION_OPERATION_NAMES as readonly OperationName[]).includes(operation);
}
