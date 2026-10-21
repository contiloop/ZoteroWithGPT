import type { ProtocolRequest, ProtocolResponse } from "../../protocol/index.js";

export const FILE_BRIDGE_VERSION = 1 as const;
export const FILE_BRIDGE_READINESS_FILENAME = "bridge-v1.json";
export const FILE_BRIDGE_SESSION_STATUS_FILENAME = "status-v1.json";
export const FILE_BRIDGE_REQUEST_SUFFIX = ".request.json";
export const FILE_BRIDGE_RESULT_SUFFIX = ".result.json";
export const MIN_FILE_BRIDGE_RESULT_BYTES = 1_024;
export const MAX_FILE_BRIDGE_RESULT_BYTES = 8_388_608;
export const MAX_FILE_BRIDGE_REQUESTS_PER_SCAN = 100;

export type FileBridgeEntryKind = "file" | "directory" | "symlink" | "other";

export interface FileBridgeEntryInfo {
  kind: FileBridgeEntryKind;
  /** Zero for entries whose byte length is not meaningful. */
  size: number;
}

/**
 * Small filesystem boundary implemented by Gecko IOUtils/PathUtils in the
 * plugin and by the real host filesystem in transport tests.
 */
export interface FileBridgeFileSystem {
  isAbsolute(path: string): boolean;
  join(...parts: string[]): string;
  filename(path: string): string;
  parent(path: string): string | null;
  /** Resolves dot segments and symbolic links. The path must exist. */
  canonicalizeExisting(path: string): Promise<string>;
  /** lstat-like inspection: a final symbolic link must report `symlink`. */
  inspect(path: string): Promise<FileBridgeEntryInfo | undefined>;
  createDirectory(path: string, options: { exclusive: boolean }): Promise<void>;
  /** Returns absolute paths for immediate children only. */
  list(path: string): Promise<readonly string[]>;
  /** Reads at most byteLimit bytes; it must never allocate beyond that bound. */
  readBounded(path: string, byteLimit: number): Promise<Uint8Array>;
  /** Writes through temporaryPath and atomically replaces path. */
  atomicWrite(path: string, bytes: Uint8Array, temporaryPath: string): Promise<void>;
}

export interface FileBridgeReadiness {
  bridgeVersion: typeof FILE_BRIDGE_VERSION;
  protocolVersion: 1;
  profileId: string;
  /** Random 128-bit hex session name. It is a freshness nonce, not a credential. */
  sessionId: string;
  /** Relative to the explicitly selected bridge root. */
  requestDirectory: string;
  /** Relative to the explicitly selected bridge root. */
  resultDirectory: string;
  /** Relative to the explicitly selected bridge root and authoritative for enabled state. */
  statusFile: string;
  requestSuffix: typeof FILE_BRIDGE_REQUEST_SUFFIX;
  resultSuffix: typeof FILE_BRIDGE_RESULT_SUFFIX;
  maxRequestBytes: number;
  maxResultBytes: number;
  maxRequestsPerScan: number;
}

export interface FileBridgeSessionStatus {
  bridgeVersion: typeof FILE_BRIDGE_VERSION;
  protocolVersion: 1;
  sessionId: string;
  profileId: string;
  enabled: boolean;
}

export interface FileBridgeSessionPaths {
  rootDirectory: string;
  sessionDirectory: string;
  requestDirectory: string;
  resultDirectory: string;
  statusFile: string;
}

export type FileBridgeRequestHandler = (
  request: ProtocolRequest,
  connectedProfileId: string,
) => Promise<ProtocolResponse>;

export interface FileBridgeSubscription {
  readonly readiness: FileBridgeReadiness;
  /** Absolute, host-internal paths; the published readiness file uses relatives. */
  readonly paths: FileBridgeSessionPaths;
  pollOnce(): Promise<void>;
  close(): Promise<void>;
}

export interface FileBridgeTransportOptions {
  fileSystem: FileBridgeFileSystem;
  /** Existing, dedicated, absolute, canonical directory selected by the user. */
  directory: string;
  connectedProfileId: string;
  createSessionId?: () => string;
  pollIntervalMs?: number;
  maxResultBytes?: number;
  onError?: (error: unknown) => void;
}

export interface GeckoIOUtilsLike {
  makeDirectory(
    path: string,
    options: {
      createAncestors: boolean;
      ignoreExisting: boolean;
      permissions: number;
    },
  ): Promise<void>;
  getChildren(path: string): Promise<string[]>;
  read(path: string, options: { maxBytes: number }): Promise<Uint8Array>;
  write(
    path: string,
    bytes: Uint8Array,
    options: { tmpPath: string; mode: "overwrite"; flush: boolean },
  ): Promise<number>;
}

export interface GeckoPathUtilsLike {
  isAbsolute(path: string): boolean;
  join(...parts: string[]): string;
  filename(path: string): string;
  parent(path: string): string | null;
  normalize(path: string): string;
}

export interface GeckoNsIFileLike {
  initWithPath(path: string): void;
  exists(): boolean;
  isSymlink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
  readonly fileSize: number;
}

export interface GeckoFileBridgeGlobals {
  IOUtils: GeckoIOUtilsLike;
  PathUtils: GeckoPathUtilsLike;
  Cc: Record<string, { createInstance(iid: unknown): GeckoNsIFileLike }>;
  Ci: { nsIFile: unknown };
}
