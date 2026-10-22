import type {
  ArxivPdfStagingPort,
  StagedArxivPdf,
  VerifiedArxivPdf,
} from "../../ports/arxiv.js";
import type {
  NativeArxivStagedFileInstaller,
  NativeArxivSynchronousFileFingerprintPort,
} from "./native-api.js";

const LOCAL_FILE_CONTRACT = "@mozilla.org/file/local;1";
const FILE_INPUT_STREAM_CONTRACT = "@mozilla.org/network/file-input-stream;1";
const CRYPTO_HASH_CONTRACT = "@mozilla.org/security/hash;1";
const STAGE_PREFIX = "stage-";
const STAGE_PATTERN = /^stage-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_STAGED_PDF_BYTES = 64 * 1024 * 1024;

interface GeckoLocalFile {
  path: string;
  initWithPath(path: string): void;
  exists(): boolean;
  isSymlink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
  readonly fileSize: number;
  create(type: number, permissions: number): void;
  remove(recursive: boolean): void;
  copyTo(destinationDirectory: GeckoLocalFile, fileName: string): void;
}

interface GeckoFileInputStream {
  init(file: GeckoLocalFile, ioFlags: number, permissions: number, behaviorFlags: number): void;
  available(): number;
  close(): void;
}

interface GeckoCryptoHash {
  readonly SHA256: number;
  init(algorithm: number): void;
  updateFromStream(stream: GeckoFileInputStream, byteLength: number): void;
  finish(base64: boolean): string;
}

interface GeckoFactory<T> {
  createInstance(iid: unknown): T;
}

export interface GeckoArxivFileEnvironment {
  IOUtils: {
    makeDirectory(
      path: string,
      options: { createAncestors: boolean; ignoreExisting: boolean; permissions: number },
    ): Promise<void>;
    write(
      path: string,
      bytes: Uint8Array,
      options: { mode: "overwrite"; flush: boolean },
    ): Promise<number>;
  };
  PathUtils: { join(...parts: string[]): string };
  Cc: Record<string, GeckoFactory<unknown> | undefined>;
  Ci: {
    nsIFile: { NORMAL_FILE_TYPE: number; DIRECTORY_TYPE: number };
    nsIFileInputStream: unknown;
    nsICryptoHash: unknown;
  };
  profileDirectory: string;
  generateId(): string;
}

export interface GeckoArxivFingerprintEnvironment {
  Cc: Record<string, GeckoFactory<unknown> | undefined>;
  Ci: {
    nsIFile: unknown;
    nsIFileInputStream: unknown;
    nsICryptoHash: unknown;
  };
}

function factory<T>(
  contracts: Record<string, GeckoFactory<unknown> | undefined>,
  name: string,
): GeckoFactory<T> {
  const value = contracts[name];
  if (value === undefined) throw new Error(`Required Gecko contract ${name} is unavailable`);
  return value as GeckoFactory<T>;
}

function localFile(
  environment: {
    Cc: Record<string, GeckoFactory<unknown> | undefined>;
    Ci: { nsIFile: unknown };
  },
  path: string,
): GeckoLocalFile {
  const file = factory<GeckoLocalFile>(environment.Cc, LOCAL_FILE_CONTRACT)
    .createInstance(environment.Ci.nsIFile);
  file.initWithPath(path);
  return file;
}

function isMissingPathError(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "NS_ERROR_FILE_NOT_FOUND" || name === "NotFoundError";
}

function linkState(file: GeckoLocalFile): "missing" | "symlink" | "regular" {
  try {
    return file.isSymlink() ? "symlink" : "regular";
  } catch (error) {
    if (isMissingPathError(error)) return "missing";
    throw error;
  }
}

function assertRegularOwnedFile(file: GeckoLocalFile, description: string): void {
  if (linkState(file) !== "regular" || !file.exists() || !file.isFile()) {
    throw new Error(`${description} is absent, symbolic, or not a regular file`);
  }
}

function assertRegularOwnedDirectory(file: GeckoLocalFile, description: string): void {
  if (linkState(file) !== "regular" || !file.exists() || !file.isDirectory()) {
    throw new Error(`${description} is absent, symbolic, or not a regular directory`);
  }
}

function assertSafeFileName(fileName: string): void {
  if (
    fileName.length === 0 ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    throw new Error("The native arXiv destination filename is unsafe");
  }
}

/**
 * Owns only opaque staged PDFs below the companion profile directory. Recovery
 * may discard them, but never resumes a copy from retained stage evidence.
 */
export class GeckoArxivFileStore
  implements ArxivPdfStagingPort, NativeArxivStagedFileInstaller
{
  readonly #environment: GeckoArxivFileEnvironment;
  readonly #ownerDirectory: string;
  readonly #directory: string;
  readonly #staged = new Map<string, { fingerprint: string; byteLength: number }>();
  readonly #fingerprints: GeckoArxivSynchronousFileFingerprint;

  constructor(environment: GeckoArxivFileEnvironment) {
    factory(environment.Cc, LOCAL_FILE_CONTRACT);
    factory(environment.Cc, FILE_INPUT_STREAM_CONTRACT);
    factory(environment.Cc, CRYPTO_HASH_CONTRACT);
    this.#environment = environment;
    this.#ownerDirectory = environment.PathUtils.join(
      environment.profileDirectory,
      "zotero-ai-research-companion",
    );
    this.#directory = environment.PathUtils.join(
      this.#ownerDirectory,
      "arxiv-staging-v1",
    );
    this.#fingerprints = new GeckoArxivSynchronousFileFingerprint(environment);
  }

  async stage(pdf: VerifiedArxivPdf): Promise<StagedArxivPdf> {
    if (pdf.body.byteLength !== pdf.byteLength) {
      throw new Error("The verified arXiv PDF byte length changed before staging");
    }
    await this.#environment.IOUtils.makeDirectory(this.#ownerDirectory, {
      createAncestors: true,
      ignoreExisting: true,
      permissions: 0o700,
    });
    assertRegularOwnedDirectory(
      localFile(this.#environment, this.#ownerDirectory),
      "The owned companion directory",
    );
    await this.#environment.IOUtils.makeDirectory(this.#directory, {
      createAncestors: false,
      ignoreExisting: true,
      permissions: 0o700,
    });
    assertRegularOwnedDirectory(
      localFile(this.#environment, this.#directory),
      "The owned arXiv staging directory",
    );
    const stagingId = `${STAGE_PREFIX}${this.#environment.generateId().toLowerCase()}`;
    if (!STAGE_PATTERN.test(stagingId)) {
      throw new Error("The arXiv staging identity generator returned an invalid UUID");
    }
    const path = this.#path(stagingId);
    const stagedFile = localFile(this.#environment, path);
    stagedFile.create(this.#environment.Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);
    try {
      const written = await this.#environment.IOUtils.write(
        path,
        Uint8Array.from(pdf.body),
        { mode: "overwrite", flush: true },
      );
      const current = localFile(this.#environment, path);
      assertRegularOwnedFile(current, "The owned arXiv staging file");
      if (written !== pdf.byteLength || current.fileSize !== pdf.byteLength) {
        throw new Error("The owned arXiv staging write was incomplete");
      }
      const fingerprint = this.#fingerprints.fingerprintNow(path, MAX_STAGED_PDF_BYTES);
      if (
        fingerprint === null ||
        fingerprint.byteLength !== pdf.byteLength ||
        fingerprint.fingerprint !== pdf.fingerprint
      ) {
        throw new Error("The owned arXiv staging file does not match the verified PDF bytes");
      }
      this.#staged.set(stagingId, {
        fingerprint: pdf.fingerprint,
        byteLength: pdf.byteLength,
      });
      return {
        stagingId,
        source: { ...pdf.source },
        fingerprint: pdf.fingerprint,
        byteLength: pdf.byteLength,
        pageCount: pdf.pageCount,
      };
    } catch (error) {
      try {
        const current = localFile(this.#environment, path);
        if (current.exists()) current.remove(false);
      } catch {
        // The staging error is authoritative; later owned cleanup can retry.
      }
      throw error;
    }
  }

  async discard(stagingId: string): Promise<void> {
    this.#staged.delete(stagingId);
    const owner = localFile(this.#environment, this.#ownerDirectory);
    const ownerState = linkState(owner);
    if (ownerState === "missing" || !owner.exists()) return;
    assertRegularOwnedDirectory(owner, "The owned companion directory");
    const directory = localFile(this.#environment, this.#directory);
    const directoryState = linkState(directory);
    if (directoryState === "missing" || !directory.exists()) return;
    assertRegularOwnedDirectory(directory, "The owned arXiv staging directory");
    const file = localFile(this.#environment, this.#path(stagingId));
    const state = linkState(file);
    if (state === "missing" || !file.exists()) return;
    if (state === "symlink") {
      throw new Error("Refusing to remove a symbolic arXiv staging entry");
    }
    if (file.isDirectory()) {
      throw new Error("Refusing to remove a directory through an arXiv staging identity");
    }
    file.remove(false);
  }

  async installCreateOnly(
    stagingId: string,
    destinationDirectory: string,
    fileName: string,
    commitValidatedCreate: (createImmediately: () => void) => Promise<void>,
  ): Promise<void> {
    assertSafeFileName(fileName);
    assertRegularOwnedDirectory(
      localFile(this.#environment, this.#ownerDirectory),
      "The owned companion directory",
    );
    assertRegularOwnedDirectory(
      localFile(this.#environment, this.#directory),
      "The owned arXiv staging directory",
    );
    const expected = this.#staged.get(stagingId);
    if (expected === undefined) {
      throw new Error("The owned arXiv staging identity is not active in this process");
    }
    const sourcePath = this.#path(stagingId);
    const preparedSource = localFile(this.#environment, sourcePath);
    assertRegularOwnedFile(preparedSource, "The owned arXiv staging file");
    const preparedFingerprint = this.#fingerprints.fingerprintNow(
      sourcePath,
      MAX_STAGED_PDF_BYTES,
    );
    if (
      preparedFingerprint === null ||
      preparedFingerprint.byteLength !== expected.byteLength ||
      preparedFingerprint.fingerprint !== expected.fingerprint
    ) {
      throw new Error("The owned arXiv staging file changed before installation");
    }
    const preparedDestination = localFile(this.#environment, destinationDirectory);
    const preparedDestinationState = linkState(preparedDestination);
    if (
      preparedDestinationState !== "missing" ||
      preparedDestination.exists()
    ) {
      throw new Error("The native arXiv destination directory already exists");
    }

    let created = false;
    await commitValidatedCreate(() => {
      if (created) throw new Error("The native arXiv create-only closure was invoked twice");
      const source = localFile(this.#environment, sourcePath);
      assertRegularOwnedFile(source, "The owned arXiv staging file");
      const currentFingerprint = this.#fingerprints.fingerprintNow(
        sourcePath,
        MAX_STAGED_PDF_BYTES,
      );
      if (
        currentFingerprint === null ||
        currentFingerprint.byteLength !== expected.byteLength ||
        currentFingerprint.fingerprint !== expected.fingerprint
      ) {
        throw new Error("The owned arXiv staging file changed before its native commit");
      }
      const destination = localFile(this.#environment, destinationDirectory);
      if (linkState(destination) !== "missing" || destination.exists()) {
        throw new Error("The native arXiv destination changed before its native commit");
      }
      destination.create(this.#environment.Ci.nsIFile.DIRECTORY_TYPE, 0o700);
      assertRegularOwnedDirectory(
        destination,
        "The native arXiv destination storage directory",
      );
      const targetPath = this.#environment.PathUtils.join(destinationDirectory, fileName);
      const target = localFile(this.#environment, targetPath);
      const targetState = linkState(target);
      if (targetState === "symlink" || (targetState === "regular" && target.exists())) {
        throw new Error("The native arXiv destination file already exists");
      }
      created = true;
      source.copyTo(destination, fileName);
      const installed = localFile(this.#environment, targetPath);
      if (
        linkState(installed) !== "regular" ||
        !installed.exists() ||
        !installed.isFile() ||
        installed.fileSize !== expected.byteLength
      ) {
        throw new Error("The native arXiv create-only copy did not produce the complete file");
      }
    });
    if (!created) {
      throw new Error("The native arXiv commit callback did not invoke its create-only closure");
    }
  }

  #path(stagingId: string): string {
    if (!STAGE_PATTERN.test(stagingId)) {
      throw new Error("The arXiv staging identity is invalid");
    }
    return this.#environment.PathUtils.join(this.#directory, `${stagingId}.pdf`);
  }
}

/** Synchronous bounded current-byte SHA-256 for the final native commit gate. */
export class GeckoArxivSynchronousFileFingerprint
  implements NativeArxivSynchronousFileFingerprintPort
{
  readonly #environment: GeckoArxivFingerprintEnvironment;

  constructor(environment: GeckoArxivFingerprintEnvironment) {
    factory(environment.Cc, LOCAL_FILE_CONTRACT);
    factory(environment.Cc, FILE_INPUT_STREAM_CONTRACT);
    factory(environment.Cc, CRYPTO_HASH_CONTRACT);
    this.#environment = environment;
  }

  fingerprintNow(
    path: string,
    maximumByteLength: number,
  ): { fingerprint: string; byteLength: number } | null {
    if (!Number.isSafeInteger(maximumByteLength) || maximumByteLength < 0) {
      throw new TypeError("maximumByteLength must be a nonnegative safe integer");
    }
    const file = localFile(this.#environment, path);
    // Gecko can report false for exists() on a dangling symlink. Query the
    // link bit first so null means a path that is proven absent, not unsafe.
    const state = linkState(file);
    if (state === "symlink") {
      throw new Error("The native PDF path is symbolic or not a regular file");
    }
    if (state === "missing" || !file.exists()) return null;
    if (!file.isFile()) {
      throw new Error("The native PDF path is symbolic or not a regular file");
    }
    const byteLength = file.fileSize;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maximumByteLength) {
      throw new Error("The native PDF exceeds its synchronous fingerprint byte limit");
    }
    const stream = factory<GeckoFileInputStream>(
      this.#environment.Cc,
      FILE_INPUT_STREAM_CONTRACT,
    ).createInstance(this.#environment.Ci.nsIFileInputStream);
    const hash = factory<GeckoCryptoHash>(this.#environment.Cc, CRYPTO_HASH_CONTRACT)
      .createInstance(this.#environment.Ci.nsICryptoHash);
    let binary: string;
    stream.init(file, 0x01, 0o400, 0);
    try {
      hash.init(hash.SHA256);
      if (byteLength > 0) hash.updateFromStream(stream, byteLength);
      if (stream.available() !== 0 || file.fileSize !== byteLength) {
        throw new Error("The native PDF changed while it was fingerprinted");
      }
      binary = hash.finish(false);
    } finally {
      stream.close();
    }
    if (binary.length !== 32) {
      throw new Error("The native SHA-256 provider returned an invalid digest length");
    }
    const hex = Array.from(binary, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return { fingerprint: `sha256:${hex}`, byteLength };
  }
}
