import {
  MAX_IDENTIFIER_BYTES,
  MAX_REQUEST_BYTES,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  canonicalRequestBytes,
  isMutationOperation,
  parseProtocolRequest,
  type ProtocolErrorCode,
  type ProtocolRequest,
  type ProtocolResponse,
  type TransportDescription,
  type VerificationSummary,
} from "../../protocol/index.js";
import {
  FileBridgeConfigurationError,
  FileBridgeSecurityError,
  FileBridgeTooLargeError,
} from "./errors.js";
import {
  FILE_BRIDGE_READINESS_FILENAME,
  FILE_BRIDGE_REQUEST_SUFFIX,
  FILE_BRIDGE_RESULT_SUFFIX,
  FILE_BRIDGE_SESSION_STATUS_FILENAME,
  FILE_BRIDGE_VERSION,
  MAX_FILE_BRIDGE_REQUESTS_PER_SCAN,
  MAX_FILE_BRIDGE_RESULT_BYTES,
  MIN_FILE_BRIDGE_RESULT_BYTES,
  type FileBridgeFileSystem,
  type FileBridgeReadiness,
  type FileBridgeRequestHandler,
  type FileBridgeSessionPaths,
  type FileBridgeSessionStatus,
  type FileBridgeSubscription,
  type FileBridgeTransportOptions,
} from "./types.js";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SESSION_ID_ATTEMPTS = 8;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_CONFIGURABLE_RESULT_BYTES = 67_108_864;
const encoder = new TextEncoder();
const activeRuntimeRoots = new Map<string, symbol>();

interface IndeterminateMutationCacheEntry {
  readonly canonicalRequest: Uint8Array;
  readonly response: ProtocolResponse;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function operationIdFromFilename(filename: string): string | undefined {
  if (!filename.endsWith(FILE_BRIDGE_REQUEST_SUFFIX)) return undefined;
  const operationId = filename.slice(0, -FILE_BRIDGE_REQUEST_SUFFIX.length);
  return OPERATION_ID_PATTERN.test(operationId) ? operationId : undefined;
}

function uncheckedVerification(): VerificationSummary {
  return { storage: "not_checked", viewer: "not_checked" };
}

function errorResponse(
  operationId: string,
  code: ProtocolErrorCode,
  message: string,
  options: {
    state?: "rejected" | "failed" | "indeterminate";
    retryable?: boolean;
    verification?: VerificationSummary;
  } = {},
): ProtocolResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    operationId,
    state: options.state ?? "rejected",
    data: null,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
    },
    verification: options.verification ?? uncheckedVerification(),
  };
}

function assertPlainJson(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a nonfinite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainJson(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains non-JSON data`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain JSON objects`);
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) throw new TypeError(`${path}.${key} is undefined`);
    assertPlainJson(entry, `${path}.${key}`);
  }
}

function serializeResponse(response: ProtocolResponse, maxBytes: number): Uint8Array {
  assertPlainJson(response, "$response");
  const bytes = encoder.encode(JSON.stringify(response));
  if (bytes.byteLength > maxBytes) {
    throw new FileBridgeTooLargeError(
      `Response exceeds the file bridge limit of ${maxBytes} UTF-8 bytes`,
      maxBytes,
    );
  }
  return bytes;
}

function validateHandlerResponse(
  response: ProtocolResponse,
  operationId: string,
): ProtocolResponse {
  if (
    response === null ||
    typeof response !== "object" ||
    response.protocolVersion !== PROTOCOL_VERSION ||
    response.operationId !== operationId
  ) {
    throw new TypeError("The request handler returned a response for a different protocol identity");
  }
  return response;
}

function defaultSessionId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== "function") {
    throw new FileBridgeConfigurationError("A cryptographic random source is required");
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateOptions(options: FileBridgeTransportOptions): void {
  if (!options.fileSystem.isAbsolute(options.directory)) {
    throw new FileBridgeConfigurationError("The selected bridge directory must be absolute");
  }
  if (options.connectedProfileId.trim().length === 0) {
    throw new FileBridgeConfigurationError("The connected profile ID must not be empty");
  }
  if (encoder.encode(options.connectedProfileId).byteLength > MAX_IDENTIFIER_BYTES) {
    throw new FileBridgeConfigurationError(
      `The connected profile ID exceeds ${MAX_IDENTIFIER_BYTES} UTF-8 bytes`,
    );
  }
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(interval) || interval < 50 || interval > 60_000) {
    throw new FileBridgeConfigurationError("pollIntervalMs must be an integer from 50 to 60000");
  }
  const resultLimit = options.maxResultBytes ?? MAX_FILE_BRIDGE_RESULT_BYTES;
  if (
    !Number.isSafeInteger(resultLimit) ||
    resultLimit < MIN_FILE_BRIDGE_RESULT_BYTES ||
    resultLimit > MAX_CONFIGURABLE_RESULT_BYTES
  ) {
    throw new FileBridgeConfigurationError(
      `maxResultBytes must be an integer from ${MIN_FILE_BRIDGE_RESULT_BYTES} to ${MAX_CONFIGURABLE_RESULT_BYTES}`,
    );
  }
}

export class FileBridgeTransport {
  readonly #options: FileBridgeTransportOptions;
  #active: ActiveFileBridgeSession | undefined;

  constructor(options: FileBridgeTransportOptions) {
    validateOptions(options);
    this.#options = options;
  }

  describe(): TransportDescription {
    return {
      kind: "custom",
      description:
        "Versioned, bounded UTF-8 request/result files in an explicitly enabled local directory",
    };
  }

  async listen(handler: FileBridgeRequestHandler): Promise<FileBridgeSubscription> {
    if (this.#active !== undefined) {
      throw new FileBridgeConfigurationError("The file bridge is already enabled");
    }
    const root = this.#options.directory;
    if (activeRuntimeRoots.has(root)) {
      throw new FileBridgeConfigurationError(
        "The selected bridge directory already has an active owner in this runtime",
      );
    }
    const ownership = Symbol(root);
    activeRuntimeRoots.set(root, ownership);
    let session: ActiveFileBridgeSession;
    try {
      session = await ActiveFileBridgeSession.create(this.#options, handler, () => {
        if (activeRuntimeRoots.get(root) === ownership) activeRuntimeRoots.delete(root);
        if (this.#active === session) this.#active = undefined;
      });
    } catch (error) {
      if (activeRuntimeRoots.get(root) === ownership) activeRuntimeRoots.delete(root);
      throw error;
    }
    this.#active = session;
    session.startPolling();
    return session;
  }
}

class ActiveFileBridgeSession implements FileBridgeSubscription {
  readonly readiness: FileBridgeReadiness;
  readonly paths: FileBridgeSessionPaths;

  readonly #fileSystem: FileBridgeFileSystem;
  readonly #configuredRoot: string;
  readonly #handler: FileBridgeRequestHandler;
  readonly #pollIntervalMs: number;
  readonly #maxResultBytes: number;
  readonly #readinessPath: string;
  readonly #onError: (error: unknown) => void;
  readonly #onClosed: () => void;
  #enabled = true;
  #polling: Promise<void> | undefined;
  #timer: number | undefined;
  #lastProcessedRequestPath: string | undefined;
  readonly #indeterminateMutationResponses = new Map<
    string,
    IndeterminateMutationCacheEntry
  >();
  readonly #enabledStatus: FileBridgeSessionStatus;

  private constructor(
    options: FileBridgeTransportOptions,
    handler: FileBridgeRequestHandler,
    readiness: FileBridgeReadiness,
    paths: FileBridgeSessionPaths,
    readinessPath: string,
    onClosed: () => void,
  ) {
    this.#fileSystem = options.fileSystem;
    this.#configuredRoot = options.directory;
    this.#handler = handler;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#maxResultBytes = options.maxResultBytes ?? MAX_FILE_BRIDGE_RESULT_BYTES;
    this.#onError = options.onError ?? ((error) => console.error("File bridge poll failed", error));
    this.#onClosed = onClosed;
    this.readiness = Object.freeze({ ...readiness });
    this.paths = Object.freeze({ ...paths });
    this.#enabledStatus = Object.freeze({
      bridgeVersion: FILE_BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: readiness.sessionId,
      profileId: readiness.profileId,
      enabled: true,
    });
    this.#readinessPath = readinessPath;
  }

  static async create(
    options: FileBridgeTransportOptions,
    handler: FileBridgeRequestHandler,
    onClosed: () => void,
  ): Promise<ActiveFileBridgeSession> {
    const fileSystem = options.fileSystem;
    const configuredInfo = await fileSystem.inspect(options.directory);
    if (configuredInfo?.kind !== "directory") {
      throw new FileBridgeConfigurationError(
        "The selected bridge root must be an existing non-symlink directory",
      );
    }
    const canonicalRoot = await fileSystem.canonicalizeExisting(options.directory);
    if (canonicalRoot !== options.directory) {
      throw new FileBridgeConfigurationError(
        "The selected bridge directory must already be its canonical path",
      );
    }

    const sessionsDirectory = fileSystem.join(canonicalRoot, "sessions");
    await ActiveFileBridgeSession.ensureDirectory(fileSystem, sessionsDirectory);

    const createSessionId = options.createSessionId ?? defaultSessionId;
    let sessionId: string | undefined;
    let sessionDirectory: string | undefined;
    for (let attempt = 0; attempt < MAX_SESSION_ID_ATTEMPTS; attempt += 1) {
      const candidate = createSessionId();
      if (!SESSION_ID_PATTERN.test(candidate)) {
        throw new FileBridgeConfigurationError(
          "createSessionId must return exactly 128 bits as 32 lowercase hex characters",
        );
      }
      const candidateDirectory = fileSystem.join(sessionsDirectory, candidate);
      if ((await fileSystem.inspect(candidateDirectory)) === undefined) {
        sessionId = candidate;
        sessionDirectory = candidateDirectory;
        break;
      }
    }
    if (sessionId === undefined || sessionDirectory === undefined) {
      throw new FileBridgeConfigurationError("Could not allocate a fresh file bridge session");
    }

    await fileSystem.createDirectory(sessionDirectory, { exclusive: true });
    const requestDirectory = fileSystem.join(sessionDirectory, "requests");
    const resultDirectory = fileSystem.join(sessionDirectory, "results");
    await fileSystem.createDirectory(requestDirectory, { exclusive: true });
    await fileSystem.createDirectory(resultDirectory, { exclusive: true });

    const maxResultBytes = options.maxResultBytes ?? MAX_FILE_BRIDGE_RESULT_BYTES;
    const statusFile = fileSystem.join(sessionDirectory, FILE_BRIDGE_SESSION_STATUS_FILENAME);
    const readiness: FileBridgeReadiness = {
      bridgeVersion: FILE_BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      profileId: options.connectedProfileId,
      sessionId,
      requestDirectory: `sessions/${sessionId}/requests`,
      resultDirectory: `sessions/${sessionId}/results`,
      statusFile: `sessions/${sessionId}/${FILE_BRIDGE_SESSION_STATUS_FILENAME}`,
      requestSuffix: FILE_BRIDGE_REQUEST_SUFFIX,
      resultSuffix: FILE_BRIDGE_RESULT_SUFFIX,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxResultBytes,
      maxRequestsPerScan: MAX_FILE_BRIDGE_REQUESTS_PER_SCAN,
    };
    const paths: FileBridgeSessionPaths = {
      rootDirectory: canonicalRoot,
      sessionDirectory,
      requestDirectory,
      resultDirectory,
      statusFile,
    };
    const readinessPath = fileSystem.join(canonicalRoot, FILE_BRIDGE_READINESS_FILENAME);
    const session = new ActiveFileBridgeSession(
      options,
      handler,
      readiness,
      paths,
      readinessPath,
      onClosed,
    );
    await session.#assertDirectoryTree();
    await session.#publishSessionStatus(session.#enabledStatus);
    await session.#publishReadiness(readiness);
    return session;
  }

  static async ensureDirectory(
    fileSystem: FileBridgeFileSystem,
    directory: string,
  ): Promise<void> {
    const existing = await fileSystem.inspect(directory);
    if (existing === undefined) {
      await fileSystem.createDirectory(directory, { exclusive: true });
      return;
    }
    if (existing.kind !== "directory") {
      throw new FileBridgeSecurityError("A required bridge directory is not a real directory");
    }
    const canonical = await fileSystem.canonicalizeExisting(directory);
    if (canonical !== directory) {
      throw new FileBridgeSecurityError("A required bridge directory is not canonical");
    }
  }

  startPolling(): void {
    this.#scheduleNextPoll();
  }

  pollOnce(): Promise<void> {
    if (!this.#enabled) return Promise.resolve();
    if (this.#polling !== undefined) return this.#polling;
    const polling = this.#scan().finally(() => {
      if (this.#polling === polling) this.#polling = undefined;
    });
    this.#polling = polling;
    return polling;
  }

  async close(): Promise<void> {
    if (!this.#enabled) return;
    this.#enabled = false;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    try {
      await this.#polling;
    } catch (error) {
      this.#onError(error);
    }
    try {
      await this.#publishSessionStatus({ ...this.#enabledStatus, enabled: false });
    } catch (error) {
      this.#onError(error);
    } finally {
      this.#onClosed();
    }
  }

  #scheduleNextPoll(): void {
    if (!this.#enabled) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.pollOnce()
        .catch((error: unknown) => this.#onError(error))
        .finally(() => this.#scheduleNextPoll());
    }, this.#pollIntervalMs);
  }

  async #scan(): Promise<void> {
    await this.#assertDirectoryTree();
    await this.#assertOwnEnabledSession();
    const entries = [...(await this.#fileSystem.list(this.paths.requestDirectory))].sort();
    const requests: Array<{ entry: string; operationId: string }> = [];
    for (const entry of entries) {
      if (this.#fileSystem.parent(entry) !== this.paths.requestDirectory) {
        throw new FileBridgeSecurityError("The filesystem returned a non-child request path");
      }
      const operationId = operationIdFromFilename(this.#fileSystem.filename(entry));
      if (operationId === undefined) continue;
      requests.push({ entry, operationId });
    }
    if (requests.length === 0) return;

    const nextIndex =
      this.#lastProcessedRequestPath === undefined
        ? 0
        : requests.findIndex(({ entry }) => entry > this.#lastProcessedRequestPath!);
    const startIndex = nextIndex < 0 ? 0 : nextIndex;
    const scanCount = Math.min(requests.length, MAX_FILE_BRIDGE_REQUESTS_PER_SCAN);
    for (let offset = 0; offset < scanCount; offset += 1) {
      if (!this.#enabled) break;
      const request = requests[(startIndex + offset) % requests.length]!;
      await this.#processRequest(request.entry, request.operationId);
      this.#lastProcessedRequestPath = request.entry;
    }
  }

  async #processRequest(requestPath: string, filenameOperationId: string): Promise<void> {
    await this.#assertResultTargets(filenameOperationId);

    let bytes: Uint8Array;
    try {
      bytes = await this.#readSecureFile(
        requestPath,
        this.paths.requestDirectory,
        MAX_REQUEST_BYTES,
        "request",
      );
    } catch (error) {
      const response =
        error instanceof FileBridgeTooLargeError
          ? errorResponse(filenameOperationId, "too_large", error.message)
          : error instanceof FileBridgeSecurityError
            ? errorResponse(filenameOperationId, "permission_denied", error.message)
            : undefined;
      if (response === undefined) throw error;
      await this.#publishResponse(response);
      return;
    }

    let request: ProtocolRequest;
    try {
      request = parseProtocolRequest(bytes);
    } catch (error) {
      if (!(error instanceof ProtocolValidationError)) throw error;
      await this.#publishResponse(
        errorResponse(filenameOperationId, error.code, error.message, {
          retryable: error.retryable,
        }),
      );
      return;
    }

    if (request.operationId !== filenameOperationId) {
      await this.#publishResponse(
        errorResponse(
          filenameOperationId,
          "invalid_request",
          "The request operationId does not match its validated filename",
        ),
      );
      return;
    }
    if (request.profileId !== undefined && request.profileId !== this.readiness.profileId) {
      await this.#publishResponse(
        errorResponse(
          filenameOperationId,
          "permission_denied",
          "The request profile does not match this enabled file bridge session",
        ),
      );
      return;
    }
    await this.#assertOwnEnabledSession();
    if (!this.#enabled) return;

    // This is the final filesystem ownership fence. A different process can
    // activate a new descriptor after it returns; that makes this request an
    // already-dispatched operation whose outcome is governed by durable identity.

    const mutationIdentity = isMutationOperation(request.operation)
      ? canonicalRequestBytes(request)
      : undefined;
    const priorUnknownOutcome = this.#indeterminateMutationResponses.get(filenameOperationId);
    if (priorUnknownOutcome !== undefined) {
      const response =
        mutationIdentity !== undefined &&
        byteArraysEqual(priorUnknownOutcome.canonicalRequest, mutationIdentity)
          ? priorUnknownOutcome.response
          : errorResponse(
              filenameOperationId,
              "duplicate_id_mismatch",
              "The operation ID already identifies a different indeterminate mutation request",
            );
      await this.#publishResponse(response);
      return;
    }

    let response: ProtocolResponse;
    try {
      response = validateHandlerResponse(
        await this.#handler(request, this.readiness.profileId),
        filenameOperationId,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown request handler error";
      response = isMutationOperation(request.operation)
        ? errorResponse(
            filenameOperationId,
            "unknown_outcome",
            `The mutation handler outcome is unknown: ${detail}`,
            { state: "indeterminate" },
          )
        : errorResponse(filenameOperationId, "storage_error", detail, {
            state: "failed",
            retryable: true,
            verification: { storage: "not_applicable", viewer: "not_checked" },
          });
      if (isMutationOperation(request.operation)) {
        this.#indeterminateMutationResponses.set(filenameOperationId, {
          canonicalRequest: mutationIdentity!,
          response,
        });
      }
    }

    try {
      await this.#publishResponse(response);
    } catch (error) {
      if (error instanceof FileBridgeTooLargeError) {
        await this.#publishResponse(
          errorResponse(filenameOperationId, "too_large", error.message, {
            state: "failed",
            verification: response.verification,
          }),
        );
        return;
      }
      if (error instanceof TypeError) {
        await this.#publishResponse(
          errorResponse(
            filenameOperationId,
            "storage_error",
            `The handler response is not valid bounded JSON: ${error.message}`,
            {
              state: "failed",
              verification: response.verification,
            },
          ),
        );
        return;
      }
      throw error;
    }
  }

  async #readSecureFile(
    path: string,
    expectedParent: string,
    maxBytes: number,
    label: string,
  ): Promise<Uint8Array> {
    await this.#assertDirectoryTree();
    if (this.#fileSystem.parent(path) !== expectedParent) {
      throw new FileBridgeSecurityError(`The ${label} path escaped its dedicated directory`);
    }
    const before = await this.#fileSystem.inspect(path);
    if (before?.kind !== "file") {
      throw new FileBridgeSecurityError(`The ${label} must be a regular non-symlink file`);
    }
    if (before.size > maxBytes) {
      throw new FileBridgeTooLargeError(
        `The ${label} exceeds ${maxBytes} UTF-8 bytes`,
        maxBytes,
      );
    }
    const canonicalBefore = await this.#fileSystem.canonicalizeExisting(path);
    if (canonicalBefore !== path) {
      throw new FileBridgeSecurityError(`The ${label} path is not canonical`);
    }
    const bytes = await this.#fileSystem.readBounded(path, maxBytes + 1);
    if (bytes.byteLength > maxBytes) {
      throw new FileBridgeTooLargeError(
        `The ${label} exceeds ${maxBytes} UTF-8 bytes`,
        maxBytes,
      );
    }
    const after = await this.#fileSystem.inspect(path);
    const canonicalAfter = await this.#fileSystem.canonicalizeExisting(path);
    if (after?.kind !== "file" || canonicalAfter !== path) {
      throw new FileBridgeSecurityError(`The ${label} changed to an unsafe path while reading`);
    }
    await this.#assertDirectoryTree();
    return bytes;
  }

  async #publishResponse(response: ProtocolResponse): Promise<void> {
    const bytes = serializeResponse(response, this.#maxResultBytes);
    const { target, temporary, targetExists } = await this.#assertResultTargets(
      response.operationId,
    );
    if (targetExists) {
      const existing = await this.#readSecureFile(
        target,
        this.paths.resultDirectory,
        this.#maxResultBytes,
        "result",
      );
      if (byteArraysEqual(existing, bytes)) return;
    }
    await this.#fileSystem.atomicWrite(target, bytes, temporary);
    const stored = await this.#readSecureFile(
      target,
      this.paths.resultDirectory,
      this.#maxResultBytes,
      "result",
    );
    if (!byteArraysEqual(stored, bytes)) {
      throw new Error("Atomic result readback did not match the response bytes");
    }
  }

  async #assertResultTargets(operationId: string): Promise<{
    target: string;
    temporary: string;
    targetExists: boolean;
  }> {
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      throw new FileBridgeSecurityError("A result path requires a validated operation ID");
    }
    await this.#assertDirectoryTree();
    const target = this.#fileSystem.join(
      this.paths.resultDirectory,
      `${operationId}${FILE_BRIDGE_RESULT_SUFFIX}`,
    );
    const temporary = `${target}.tmp`;
    if (
      this.#fileSystem.parent(target) !== this.paths.resultDirectory ||
      this.#fileSystem.parent(temporary) !== this.paths.resultDirectory
    ) {
      throw new FileBridgeSecurityError("A result path escaped its dedicated directory");
    }
    const targetExists = await this.#assertOptionalRegularCanonicalFile(target, "result");
    await this.#assertOptionalRegularCanonicalFile(temporary, "temporary result");
    return { target, temporary, targetExists };
  }

  async #publishReadiness(readiness: FileBridgeReadiness): Promise<void> {
    await this.#assertRoot();
    const temporary = `${this.#readinessPath}.tmp`;
    await this.#assertOptionalRegularCanonicalFile(this.#readinessPath, "readiness");
    await this.#assertOptionalRegularCanonicalFile(temporary, "temporary readiness");
    const bytes = encoder.encode(JSON.stringify(readiness));
    await this.#fileSystem.atomicWrite(this.#readinessPath, bytes, temporary);
    const stored = await this.#readSecureRootFile(this.#readinessPath, bytes.byteLength);
    if (!byteArraysEqual(stored, bytes)) {
      throw new Error("Atomic readiness readback did not match the published bytes");
    }
  }

  async #publishSessionStatus(status: FileBridgeSessionStatus): Promise<void> {
    await this.#assertDirectoryTree();
    const temporary = `${this.paths.statusFile}.tmp`;
    await this.#assertOptionalRegularCanonicalFile(this.paths.statusFile, "session status");
    await this.#assertOptionalRegularCanonicalFile(temporary, "temporary session status");
    const bytes = encoder.encode(JSON.stringify(status));
    await this.#fileSystem.atomicWrite(this.paths.statusFile, bytes, temporary);
    const stored = await this.#readSecureFile(
      this.paths.statusFile,
      this.paths.sessionDirectory,
      bytes.byteLength,
      "session status",
    );
    if (!byteArraysEqual(stored, bytes)) {
      throw new Error("Atomic session status readback did not match the published bytes");
    }
  }

  async #assertOwnEnabledSession(): Promise<void> {
    const expected = encoder.encode(JSON.stringify(this.readiness));
    const stored = await this.#readSecureRootFile(this.#readinessPath, expected.byteLength);
    if (!byteArraysEqual(stored, expected)) {
      throw new FileBridgeSecurityError(
        "The published readiness belongs to a different or altered bridge session",
      );
    }
    const expectedStatus = encoder.encode(JSON.stringify(this.#enabledStatus));
    const storedStatus = await this.#readSecureFile(
      this.paths.statusFile,
      this.paths.sessionDirectory,
      expectedStatus.byteLength,
      "session status",
    );
    if (!byteArraysEqual(storedStatus, expectedStatus)) {
      throw new FileBridgeSecurityError("The active bridge session is disabled or altered");
    }
    const confirmed = await this.#readSecureRootFile(this.#readinessPath, expected.byteLength);
    if (!byteArraysEqual(confirmed, expected)) {
      throw new FileBridgeSecurityError(
        "The active bridge descriptor changed while confirming session status",
      );
    }
  }

  async #readSecureRootFile(path: string, maxBytes: number): Promise<Uint8Array> {
    await this.#assertRoot();
    if (this.#fileSystem.parent(path) !== this.paths.rootDirectory) {
      throw new FileBridgeSecurityError("The readiness path escaped the selected root");
    }
    const info = await this.#fileSystem.inspect(path);
    const canonical = await this.#fileSystem.canonicalizeExisting(path);
    if (info?.kind !== "file" || canonical !== path || info.size > maxBytes) {
      throw new FileBridgeSecurityError("The readiness file is not a bounded canonical file");
    }
    const bytes = await this.#fileSystem.readBounded(path, maxBytes + 1);
    if (bytes.byteLength > maxBytes) {
      throw new FileBridgeSecurityError("The readiness file exceeded its published size");
    }
    await this.#assertRoot();
    return bytes;
  }

  async #assertOptionalRegularCanonicalFile(path: string, label: string): Promise<boolean> {
    const info = await this.#fileSystem.inspect(path);
    if (info === undefined) return false;
    if (info.kind !== "file") {
      throw new FileBridgeSecurityError(`The ${label} path is not a regular non-symlink file`);
    }
    const canonical = await this.#fileSystem.canonicalizeExisting(path);
    if (canonical !== path) {
      throw new FileBridgeSecurityError(`The ${label} path is not canonical`);
    }
    return true;
  }

  async #assertRoot(): Promise<void> {
    const configured = await this.#fileSystem.inspect(this.#configuredRoot);
    if (configured?.kind !== "directory") {
      throw new FileBridgeSecurityError("The configured bridge root is no longer a real directory");
    }
    const configuredCanonical = await this.#fileSystem.canonicalizeExisting(this.#configuredRoot);
    if (
      configuredCanonical !== this.paths.rootDirectory ||
      this.#configuredRoot !== this.paths.rootDirectory
    ) {
      throw new FileBridgeSecurityError("The configured bridge root changed canonical identity");
    }
  }

  async #assertDirectoryTree(): Promise<void> {
    await this.#assertRoot();
    const directories = [
      this.#fileSystem.join(this.paths.rootDirectory, "sessions"),
      this.paths.sessionDirectory,
      this.paths.requestDirectory,
      this.paths.resultDirectory,
    ];
    for (const directory of directories) {
      if (directory === null) {
        throw new FileBridgeSecurityError("A bridge directory has no canonical parent");
      }
      const info = await this.#fileSystem.inspect(directory);
      if (info?.kind !== "directory") {
        throw new FileBridgeSecurityError("A bridge session directory is no longer a real directory");
      }
      const canonical = await this.#fileSystem.canonicalizeExisting(directory);
      if (canonical !== directory) {
        throw new FileBridgeSecurityError("A bridge session directory changed canonical identity");
      }
    }
  }
}
