import {
  constants as fsConstants,
} from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  MAX_IDENTIFIER_BYTES,
  MAX_REQUEST_BYTES,
  canonicalRequestBytes,
  parseProtocolRequest,
  validateProtocolRequest,
} from "../../../dist/protocol/index.js";
import { BridgeAdapterError, MAX_WAIT_TIMEOUT_MS } from "./bridge-port.mjs";

export { BridgeAdapterError, MAX_WAIT_TIMEOUT_MS } from "./bridge-port.mjs";

const DESCRIPTOR_FILENAME = "bridge-v1.json";
const STATUS_FILENAME = "status-v1.json";
const REQUEST_SUFFIX = ".request.json";
const RESULT_SUFFIX = ".result.json";
const SESSION_PATTERN = /^[0-9a-f]{32}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_DESCRIPTOR_BYTES = 65_536;
const MAX_STATUS_BYTES = 16_384;
const encoder = new TextEncoder();
export const MAX_SERVER_RESULT_BYTES = 8_388_608;

const descriptorKeys = [
  "bridgeVersion",
  "protocolVersion",
  "profileId",
  "sessionId",
  "requestDirectory",
  "resultDirectory",
  "statusFile",
  "requestSuffix",
  "resultSuffix",
  "maxRequestBytes",
  "maxResultBytes",
  "maxRequestsPerScan",
];
const statusKeys = [
  "bridgeVersion",
  "protocolVersion",
  "sessionId",
  "profileId",
  "enabled",
];

function bridgeError(code, message, publication = "unknown", cause = undefined) {
  const options = cause === undefined ? undefined : { cause };
  return new BridgeAdapterError(code, message, publication, options);
}

function withPublication(error, publication) {
  if (error instanceof BridgeAdapterError) {
    if (error.publication === publication) return error;
    return bridgeError(error.code, error.message, publication, error);
  }
  return bridgeError("io_error", "The dedicated Zotero bridge could not be accessed safely.", publication, error);
}

function validateDeadline(deadline) {
  if (deadline !== undefined && (typeof deadline !== "number" || !Number.isFinite(deadline))) {
    throw new TypeError("deadline must be a finite monotonic timestamp");
  }
  return deadline;
}

function assertDeadline(deadline, publication) {
  if (deadline !== undefined && performance.now() >= deadline) {
    throw bridgeError(
      "wait_expired",
      "No complete Zotero result arrived before the invocation deadline.",
      publication,
    );
  }
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeError("connection_unavailable", `The ${label} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw bridgeError("connection_unavailable", `The ${label} shape is unsupported.`);
  }
  return value;
}

function json(bytes, label, errorCode = "connection_unavailable") {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw bridgeError(errorCode, `The ${label} is not complete UTF-8.`, "unknown", cause);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw bridgeError(errorCode, `The ${label} is not complete JSON.`, "unknown", cause);
  }
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function identity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function within(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function parsePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw bridgeError("connection_unavailable", `The ${label} is unsupported.`);
  }
  return value;
}

function relativeTarget(root, value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\u0000")
  ) {
    throw bridgeError("access_denied", `The ${label} is not a safe relative path.`);
  }
  const target = path.resolve(root, value);
  if (!within(root, target)) {
    throw bridgeError("access_denied", `The ${label} escapes the dedicated bridge root.`);
  }
  return target;
}

function validateDescriptor(value, root) {
  const descriptor = exactObject(value, descriptorKeys, "bridge descriptor");
  if (descriptor.bridgeVersion !== 1 || descriptor.protocolVersion !== 1) {
    throw bridgeError("connection_unavailable", "The bridge descriptor version is unsupported.");
  }
  if (
    typeof descriptor.profileId !== "string" ||
    descriptor.profileId.trim().length === 0 ||
    encoder.encode(descriptor.profileId).byteLength > MAX_IDENTIFIER_BYTES
  ) {
    throw bridgeError("connection_unavailable", "The bridge profile identity is invalid.");
  }
  if (typeof descriptor.sessionId !== "string" || !SESSION_PATTERN.test(descriptor.sessionId)) {
    throw bridgeError("connection_unavailable", "The bridge session identity is invalid.");
  }
  if (descriptor.requestSuffix !== REQUEST_SUFFIX || descriptor.resultSuffix !== RESULT_SUFFIX) {
    throw bridgeError("connection_unavailable", "The bridge filename contract is unsupported.");
  }
  parsePositiveInteger(descriptor.maxRequestBytes, "bridge request limit");
  parsePositiveInteger(descriptor.maxResultBytes, "bridge result limit");
  parsePositiveInteger(descriptor.maxRequestsPerScan, "bridge scan limit", 100);
  const requestDirectory = relativeTarget(root, descriptor.requestDirectory, "request directory");
  const resultDirectory = relativeTarget(root, descriptor.resultDirectory, "result directory");
  const statusPath = relativeTarget(root, descriptor.statusFile, "status file");
  return { descriptor, requestDirectory, resultDirectory, statusPath };
}

function validateStatus(value, descriptor, allowDisabled) {
  const status = exactObject(value, statusKeys, "session status");
  if (status.bridgeVersion !== 1 || status.protocolVersion !== 1) {
    throw bridgeError("connection_unavailable", "The bridge status version is unsupported.");
  }
  if (
    status.profileId !== descriptor.profileId ||
    status.sessionId !== descriptor.sessionId
  ) {
    throw bridgeError("connection_changed", "The bridge status identity changed.");
  }
  if (typeof status.enabled !== "boolean") {
    throw bridgeError("connection_unavailable", "The bridge enabled state is invalid.");
  }
  if (!allowDisabled && !status.enabled) {
    throw bridgeError("connection_unavailable", "The Zotero bridge session is disabled.");
  }
  return status;
}

export class NodeSecureFileSystem {
  constructor(options = {}) {
    this.afterRead = options.afterRead;
  }

  async canonicalDirectory(directory, expectedIdentity = undefined) {
    let info;
    let canonical;
    try {
      info = await lstat(directory);
      canonical = await realpath(directory);
    } catch (cause) {
      throw bridgeError("access_denied", "A required bridge directory is unavailable.", "unknown", cause);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || canonical !== path.resolve(directory)) {
      throw bridgeError("access_denied", "A required bridge directory is not canonical.");
    }
    const foundIdentity = identity(info);
    if (expectedIdentity !== undefined && foundIdentity !== expectedIdentity) {
      throw bridgeError("connection_changed", "A bridge directory changed identity.");
    }
    return foundIdentity;
  }

  async readRegularFile(filename, byteLimit, options = {}) {
    let before;
    try {
      before = await lstat(filename);
    } catch (cause) {
      if (options.optional === true && cause?.code === "ENOENT") return undefined;
      throw bridgeError("access_denied", "A required bridge file is unavailable.", "unknown", cause);
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw bridgeError("access_denied", "A bridge file is not a regular non-symlink file.");
    }
    if (before.size > byteLimit) {
      throw bridgeError(options.tooLargeCode ?? "result_too_large", "A bridge file exceeds the supported byte limit.");
    }

    let handle;
    try {
      handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || identity(opened) !== identity(before) || opened.size !== before.size) {
        throw bridgeError("connection_changed", "A bridge file changed while opening.");
      }
      const bytes = new Uint8Array(await handle.readFile());
      const after = await handle.stat();
      const current = await lstat(filename);
      if (
        bytes.byteLength !== opened.size ||
        after.size !== opened.size ||
        identity(after) !== identity(opened) ||
        identity(current) !== identity(opened) ||
        !current.isFile() ||
        current.isSymbolicLink()
      ) {
        throw bridgeError("connection_changed", "A bridge file changed while reading.");
      }
      const result = { bytes, identity: identity(opened) };
      if (this.afterRead !== undefined) await this.afterRead(filename, result);
      return result;
    } catch (cause) {
      if (cause instanceof BridgeAdapterError) throw cause;
      if (options.optional === true && cause?.code === "ENOENT") return undefined;
      throw bridgeError("access_denied", "A bridge file could not be read safely.", "unknown", cause);
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}

export class NodeFileBridgeAdapter {
  constructor(options) {
    if (options === null || typeof options !== "object" || typeof options.root !== "string") {
      throw new TypeError("NodeFileBridgeAdapter requires one configured bridge root");
    }
    if (!path.isAbsolute(options.root) || path.resolve(options.root) !== options.root) {
      throw new TypeError("NodeFileBridgeAdapter bridge root must be an absolute normalized path");
    }
    this.root = options.root;
    this.fileSystem = options.fileSystem ?? new NodeSecureFileSystem();
    this.pollIntervalMs = options.pollIntervalMs ?? 25;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1 || this.pollIntervalMs > 1_000) {
      throw new TypeError("pollIntervalMs must be an integer from 1 to 1000");
    }
  }

  async openCurrent(expectedConnection = undefined, options = {}) {
    try {
      const deadline = validateDeadline(options.deadline);
      assertDeadline(deadline, "not_published");
      const session = await this.#openConfiguredSession(false, expectedConnection);
      assertDeadline(deadline, "not_published");
      return session;
    } catch (error) {
      throw withPublication(error, "not_published");
    }
  }

  async openHistorical(connection, options = {}) {
    try {
      const deadline = validateDeadline(options.deadline);
      assertDeadline(deadline, "unknown");
      if (
        connection === null ||
        typeof connection !== "object" ||
        typeof connection.profileId !== "string" ||
        connection.profileId.trim().length === 0 ||
        encoder.encode(connection.profileId).byteLength > MAX_IDENTIFIER_BYTES ||
        !SESSION_PATTERN.test(connection.sessionId)
      ) {
        throw bridgeError("access_denied", "The historical bridge identity is invalid.");
      }
      const configured = await this.#openConfiguredSession(true);
      if (configured.connection.profileId !== connection.profileId) {
        throw bridgeError(
          "connection_changed",
          "Historical lookup profile does not match the currently configured bridge profile.",
        );
      }
      const rootIdentity = configured.rootIdentity;
      const sessionsDirectory = path.join(this.root, "sessions");
      const sessionDirectory = path.join(sessionsDirectory, connection.sessionId);
      const requestDirectory = path.join(sessionDirectory, "requests");
      const resultDirectory = path.join(sessionDirectory, "results");
      const statusPath = path.join(sessionDirectory, STATUS_FILENAME);
      const directoryIdentities = {
        sessions: await this.fileSystem.canonicalDirectory(sessionsDirectory),
        session: await this.fileSystem.canonicalDirectory(sessionDirectory),
        requests: await this.fileSystem.canonicalDirectory(requestDirectory),
        results: await this.fileSystem.canonicalDirectory(resultDirectory),
      };
      const statusRead = await this.fileSystem.readRegularFile(statusPath, MAX_STATUS_BYTES);
      const statusDescriptor = {
        profileId: connection.profileId,
        sessionId: connection.sessionId,
      };
      const status = validateStatus(json(statusRead.bytes, "session status"), statusDescriptor, true);
      await this.#assertHistoricalProfile(connection.profileId);
      assertDeadline(deadline, "unknown");
      return Object.freeze({
        kind: "historical",
        root: this.root,
        rootIdentity,
        sessionDirectory,
        requestDirectory,
        resultDirectory,
        statusPath,
        status: Object.freeze({ ...status }),
        statusIdentity: statusRead.identity,
        directoryIdentities: Object.freeze(directoryIdentities),
        connection: Object.freeze({ ...connection }),
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxResultBytes: MAX_SERVER_RESULT_BYTES,
      });
    } catch (error) {
      throw withPublication(error, "unknown");
    }
  }

  async assertCurrent(session, publication = "not_published") {
    try {
      if (session.kind !== "current") {
        throw bridgeError("access_denied", "Historical sessions cannot publish requests.");
      }
      await this.#assertConfiguredSession(session, false);
      return session;
    } catch (error) {
      throw withPublication(error, publication);
    }
  }

  async inspectRequest(session, request, options = {}) {
    const deadline = validateDeadline(options.deadline);
    assertDeadline(deadline, "not_published");
    const validatedRequest = this.#validatedRequestForSession(session, request);
    const filename = this.#requestPath(session, validatedRequest.operationId);
    let read;
    try {
      await this.#assertReadableSession(session, false);
      read = await this.fileSystem.readRegularFile(filename, session.maxRequestBytes, {
        optional: true,
        tooLargeCode: "identity_conflict",
      });
      await this.#assertReadableSession(session, false);
    } catch (error) {
      throw withPublication(error, "unknown");
    }
    if (read === undefined) {
      assertDeadline(deadline, "not_published");
      return { state: "absent" };
    }
    let recorded;
    try {
      recorded = parseProtocolRequest(read.bytes);
    } catch (cause) {
      throw bridgeError("identity_conflict", "The operation ID already has invalid request evidence.", "not_published", cause);
    }
    if (recorded.operationId !== validatedRequest.operationId) {
      throw bridgeError("identity_conflict", "The operation ID already has mismatched request evidence.", "not_published");
    }
    const result = bytesEqual(canonicalRequestBytes(recorded), canonicalRequestBytes(validatedRequest))
      ? { state: "matching", request: recorded }
      : { state: "conflict", request: recorded };
    assertDeadline(deadline, result.state === "matching" ? "published" : "not_published");
    return result;
  }

  async publishRequest(session, request, options = {}) {
    const deadline = validateDeadline(options.deadline);
    assertDeadline(deadline, "not_published");
    const validatedRequest = this.#validatedRequestForSession(session, request);
    const encoded = encoder.encode(JSON.stringify(validatedRequest));
    if (encoded.byteLength > session.maxRequestBytes) {
      throw bridgeError("invalid_input", "The request exceeds the connected bridge byte limit.", "not_published");
    }
    await this.assertCurrent(session, "not_published");
    assertDeadline(deadline, "not_published");
    const prior = await this.inspectRequest(session, validatedRequest, { deadline });
    if (prior.state === "matching") {
      assertDeadline(deadline, "published");
      return "published";
    }
    if (prior.state === "conflict") {
      throw bridgeError("identity_conflict", "The operation ID already identifies different content.", "not_published");
    }

    const target = this.#requestPath(session, validatedRequest.operationId);
    const staging = `${target}.partial.${process.pid}.${randomBytes(12).toString("hex")}`;
    let stageCreated = false;
    let finalLinkAttempted = false;
    try {
      const handle = await open(
        staging,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      stageCreated = true;
      try {
        await handle.writeFile(encoded);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.assertCurrent(session, "not_published");
      assertDeadline(deadline, "not_published");
      try {
        finalLinkAttempted = true;
        await link(staging, target);
        assertDeadline(deadline, "published");
      } catch (cause) {
        if (cause instanceof BridgeAdapterError) throw cause;
        if (cause?.code !== "EEXIST") {
          try {
            const observed = await this.inspectRequest(session, validatedRequest, { deadline });
            if (observed.state === "matching") {
              assertDeadline(deadline, "published");
              return "published";
            }
            if (observed.state === "conflict") {
              throw bridgeError("identity_conflict", "The operation ID already identifies different content.", "not_published");
            }
            throw bridgeError("io_error", "The request was not published.", "not_published", cause);
          } catch (inspectionError) {
            if (inspectionError instanceof BridgeAdapterError && inspectionError.code === "identity_conflict") {
              throw inspectionError;
            }
            if (
              inspectionError instanceof BridgeAdapterError &&
              inspectionError.code === "io_error" &&
              inspectionError.publication === "not_published"
            ) {
              throw inspectionError;
            }
            throw bridgeError("io_error", "Request publication could not be confirmed.", "unknown", cause);
          }
        }
        const observed = await this.inspectRequest(session, validatedRequest, { deadline });
        if (observed.state === "matching") {
          assertDeadline(deadline, "published");
          return "published";
        }
        throw bridgeError("identity_conflict", "The operation ID already identifies different content.", "not_published");
      }
      let stored;
      try {
        stored = await this.fileSystem.readRegularFile(target, session.maxRequestBytes);
      } catch (cause) {
        throw bridgeError("io_error", "Published request readback could not be confirmed.", "published", cause);
      }
      assertDeadline(deadline, "published");
      if (!bytesEqual(stored.bytes, encoded)) {
        throw bridgeError("io_error", "Published request bytes did not match the complete request.", "published");
      }
      return "published";
    } catch (error) {
      if (error instanceof BridgeAdapterError) throw error;
      throw bridgeError(
        "io_error",
        "Request publication could not be confirmed.",
        finalLinkAttempted ? "unknown" : "not_published",
        error,
      );
    } finally {
      if (stageCreated) await unlink(staging).catch(() => {});
    }
  }

  async waitForResult(session, request, options = {}) {
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
      throw new TypeError(`timeoutMs must be an integer from 1 to ${MAX_WAIT_TIMEOUT_MS}`);
    }
    const deadline = validateDeadline(options.deadline) ?? performance.now() + timeoutMs;
    let delay = this.pollIntervalMs;
    while (true) {
      assertDeadline(deadline, "published");
      await this.assertCurrent(session, "published");
      assertDeadline(deadline, "published");
      const requestEvidence = await this.inspectRequest(session, request, { deadline });
      if (requestEvidence.state !== "matching") {
        throw bridgeError("identity_conflict", "Published request evidence no longer matches.", "published");
      }
      assertDeadline(deadline, "published");
      const result = await this.#readResult(session, request.operationId, {
        deadline,
        publication: "published",
      });
      if (result !== undefined) return result;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw bridgeError("wait_expired", "No complete Zotero result arrived before the wait deadline.", "published");
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
      delay = Math.min(Math.ceil(delay * 1.5), 250);
    }
  }

  async readRecordedRequest(session, operationId, options = {}) {
    const deadline = validateDeadline(options.deadline);
    let publication = options.publication ?? "unknown";
    assertDeadline(deadline, publication);
    const target = this.#requestPath(session, operationId);
    let read;
    try {
      await this.#assertReadableSession(session, true);
      read = await this.fileSystem.readRegularFile(target, session.maxRequestBytes, {
        optional: true,
        tooLargeCode: "invalid_result",
      });
      if (read === undefined) {
        await this.#assertReadableSession(session, true);
        assertDeadline(deadline, options.publication ?? "unknown");
        return undefined;
      }
      const request = parseProtocolRequest(read.bytes);
      if (request.operationId !== operationId) {
        throw bridgeError("invalid_result", "Recorded request identity does not match its file.");
      }
      if (
        request.profileId !== undefined &&
        request.profileId !== session.connection.profileId
      ) {
        throw bridgeError("invalid_result", "Recorded request profile does not match its session.");
      }
      await this.#assertReadableSession(session, true);
      publication = "published";
      assertDeadline(deadline, publication);
      return request;
    } catch (error) {
      throw withPublication(error, publication);
    }
  }

  async readRecordedResult(session, operationId, options = {}) {
    return this.#readResult(session, operationId, {
      deadline: validateDeadline(options.deadline),
      publication: options.publication ?? "unknown",
    });
  }

  async #readResult(session, operationId, options) {
    const { deadline, publication } = options;
    assertDeadline(deadline, publication);
    const target = this.#resultPath(session, operationId);
    let read;
    try {
      await this.#assertReadableSession(session, publication !== "published");
      read = await this.fileSystem.readRegularFile(target, session.maxResultBytes, {
        optional: true,
        tooLargeCode: "result_too_large",
      });
      if (read === undefined) {
        await this.#assertReadableSession(session, publication !== "published");
        assertDeadline(deadline, publication);
        return undefined;
      }
      await this.#assertReadableSession(session, publication !== "published");
      assertDeadline(deadline, publication);
      return json(read.bytes, "Zotero result", "invalid_result");
    } catch (error) {
      throw withPublication(error, publication);
    }
  }

  async #assertSessionDirectories(session) {
    await this.fileSystem.canonicalDirectory(session.root, session.rootIdentity);
    const sessionsDirectory = path.dirname(session.sessionDirectory);
    await this.fileSystem.canonicalDirectory(sessionsDirectory, session.directoryIdentities.sessions);
    await this.fileSystem.canonicalDirectory(session.sessionDirectory, session.directoryIdentities.session);
    await this.fileSystem.canonicalDirectory(session.requestDirectory, session.directoryIdentities.requests);
    await this.fileSystem.canonicalDirectory(session.resultDirectory, session.directoryIdentities.results);
  }

  async #openConfiguredSession(allowDisabled, expectedConnection = undefined) {
    const rootIdentity = await this.fileSystem.canonicalDirectory(this.root);
    const descriptorPath = path.join(this.root, DESCRIPTOR_FILENAME);
    const first = await this.fileSystem.readRegularFile(descriptorPath, MAX_DESCRIPTOR_BYTES);
    const paths = validateDescriptor(json(first.bytes, "bridge descriptor"), this.root);
    if (
      expectedConnection !== undefined &&
      (expectedConnection.profileId !== paths.descriptor.profileId ||
        expectedConnection.sessionId !== paths.descriptor.sessionId)
    ) {
      throw bridgeError("connection_changed", "The caller binding does not match the active bridge session.");
    }
    const sessionDirectory = path.dirname(paths.statusPath);
    const sessionsDirectory = path.dirname(sessionDirectory);
    const directoryIdentities = {
      sessions: await this.fileSystem.canonicalDirectory(sessionsDirectory),
      session: await this.fileSystem.canonicalDirectory(sessionDirectory),
      requests: await this.fileSystem.canonicalDirectory(paths.requestDirectory),
      results: await this.fileSystem.canonicalDirectory(paths.resultDirectory),
    };
    for (const directory of [sessionsDirectory, sessionDirectory, paths.requestDirectory, paths.resultDirectory]) {
      if (!within(this.root, directory)) {
        throw bridgeError("access_denied", "A bridge directory escaped the dedicated root.");
      }
    }
    const statusRead = await this.fileSystem.readRegularFile(paths.statusPath, MAX_STATUS_BYTES);
    const status = validateStatus(
      json(statusRead.bytes, "session status"),
      paths.descriptor,
      allowDisabled,
    );
    const second = await this.fileSystem.readRegularFile(descriptorPath, MAX_DESCRIPTOR_BYTES);
    if (!bytesEqual(first.bytes, second.bytes) || first.identity !== second.identity) {
      throw bridgeError("connection_changed", "The bridge descriptor changed during connection validation.");
    }
    await this.fileSystem.canonicalDirectory(this.root, rootIdentity);
    return Object.freeze({
      kind: "current",
      root: this.root,
      rootIdentity,
      descriptorPath,
      descriptorBytes: second.bytes,
      descriptorIdentity: second.identity,
      descriptor: Object.freeze({ ...paths.descriptor }),
      status: Object.freeze({ ...status }),
      statusIdentity: statusRead.identity,
      sessionDirectory,
      requestDirectory: paths.requestDirectory,
      resultDirectory: paths.resultDirectory,
      statusPath: paths.statusPath,
      directoryIdentities: Object.freeze(directoryIdentities),
      connection: Object.freeze({
        profileId: paths.descriptor.profileId,
        sessionId: paths.descriptor.sessionId,
      }),
      maxRequestBytes: Math.min(paths.descriptor.maxRequestBytes, MAX_REQUEST_BYTES),
      maxResultBytes: Math.min(paths.descriptor.maxResultBytes, MAX_SERVER_RESULT_BYTES),
    });
  }

  async #assertConfiguredSession(session, allowDisabled) {
    await this.#assertSessionDirectories(session);
    const first = await this.fileSystem.readRegularFile(session.descriptorPath, MAX_DESCRIPTOR_BYTES);
    if (
      first.identity !== session.descriptorIdentity ||
      !bytesEqual(first.bytes, session.descriptorBytes)
    ) {
      throw bridgeError("connection_changed", "The active bridge descriptor changed.");
    }
    const statusRead = await this.fileSystem.readRegularFile(session.statusPath, MAX_STATUS_BYTES);
    validateStatus(json(statusRead.bytes, "session status"), session.descriptor, allowDisabled);
    if (statusRead.identity !== session.statusIdentity) {
      throw bridgeError("connection_changed", "The active bridge status changed identity.");
    }
    const second = await this.fileSystem.readRegularFile(session.descriptorPath, MAX_DESCRIPTOR_BYTES);
    if (second.identity !== first.identity || !bytesEqual(second.bytes, first.bytes)) {
      throw bridgeError("connection_changed", "The active bridge descriptor changed during the final fence.");
    }
  }

  async #assertHistoricalProfile(profileId) {
    const configured = await this.#openConfiguredSession(true);
    if (configured.connection.profileId !== profileId) {
      throw bridgeError(
        "connection_changed",
        "Historical lookup profile does not match the currently configured bridge profile.",
      );
    }
  }

  async #assertReadableSession(session, historicalRead) {
    if (session.kind === "historical") {
      await this.#assertHistoricalProfile(session.connection.profileId);
      await this.#assertSessionDirectories(session);
      const statusRead = await this.fileSystem.readRegularFile(
        session.statusPath,
        MAX_STATUS_BYTES,
      );
      validateStatus(
        json(statusRead.bytes, "session status"),
        session.connection,
        true,
      );
      return;
    }
    await this.assertCurrent(session, historicalRead ? "unknown" : "not_published");
  }

  #validatedRequestForSession(session, request) {
    let validated;
    try {
      validated = validateProtocolRequest(request);
    } catch (cause) {
      throw bridgeError("invalid_input", "The bridge request is invalid.", "not_published", cause);
    }
    if (
      validated.profileId !== undefined &&
      validated.profileId !== session.connection.profileId
    ) {
      throw bridgeError("connection_changed", "The request profile does not match the bound session.", "not_published");
    }
    return validated;
  }

  #requestPath(session, operationId) {
    return this.#operationPath(session.requestDirectory, operationId, REQUEST_SUFFIX);
  }

  #resultPath(session, operationId) {
    return this.#operationPath(session.resultDirectory, operationId, RESULT_SUFFIX);
  }

  #operationPath(directory, operationId, suffix) {
    if (typeof operationId !== "string" || !OPERATION_ID_PATTERN.test(operationId)) {
      throw bridgeError("access_denied", "The operation identity is unsafe.");
    }
    const target = path.join(directory, `${operationId}${suffix}`);
    if (path.dirname(target) !== directory) {
      throw bridgeError("access_denied", "The operation path escaped its fixed directory.");
    }
    return target;
  }
}
