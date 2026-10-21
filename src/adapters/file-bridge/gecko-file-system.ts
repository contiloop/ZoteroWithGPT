import { FileBridgeConfigurationError, FileBridgeSecurityError } from "./errors.js";
import type {
  FileBridgeEntryInfo,
  FileBridgeFileSystem,
  GeckoFileBridgeGlobals,
  GeckoNsIFileLike,
} from "./types.js";

const LOCAL_FILE_CONTRACT = "@mozilla.org/file/local;1";

/** Gecko 140 implementation. It contains no Node imports or end-user daemon. */
export class GeckoFileBridgeFileSystem implements FileBridgeFileSystem {
  readonly #globals: GeckoFileBridgeGlobals;

  constructor(globals: GeckoFileBridgeGlobals) {
    this.#globals = globals;
  }

  isAbsolute(path: string): boolean {
    return this.#globals.PathUtils.isAbsolute(path);
  }

  join(...parts: string[]): string {
    return this.#globals.PathUtils.join(...parts);
  }

  filename(path: string): string {
    return this.#globals.PathUtils.filename(path);
  }

  parent(path: string): string | null {
    return this.#globals.PathUtils.parent(path);
  }

  async canonicalizeExisting(path: string): Promise<string> {
    return this.#globals.PathUtils.normalize(path);
  }

  async inspect(path: string): Promise<FileBridgeEntryInfo | undefined> {
    const file = this.#file(path);
    try {
      // nsIFile.exists() follows the target on Unix, so check the link itself
      // first to catch dangling links as well as links with live targets.
      if (file.isSymlink()) return { kind: "symlink", size: 0 };
    } catch (error) {
      const name =
        error !== null && typeof error === "object" && "name" in error
          ? (error as { name?: unknown }).name
          : undefined;
      if (name !== "NS_ERROR_FILE_NOT_FOUND" && name !== "NotFoundError") throw error;
      return undefined;
    }
    if (!file.exists()) return undefined;
    if (file.isFile()) return { kind: "file", size: file.fileSize };
    if (file.isDirectory()) return { kind: "directory", size: 0 };
    return { kind: "other", size: 0 };
  }

  async createDirectory(path: string, options: { exclusive: boolean }): Promise<void> {
    await this.#globals.IOUtils.makeDirectory(path, {
      createAncestors: !options.exclusive,
      ignoreExisting: !options.exclusive,
      permissions: 0o700,
    });
  }

  async list(path: string): Promise<readonly string[]> {
    return this.#globals.IOUtils.getChildren(path);
  }

  async readBounded(path: string, byteLimit: number): Promise<Uint8Array> {
    const bytes = await this.#globals.IOUtils.read(path, { maxBytes: byteLimit });
    if (bytes.byteLength > byteLimit) {
      throw new FileBridgeSecurityError("Gecko IOUtils exceeded the requested read bound");
    }
    return bytes;
  }

  async atomicWrite(path: string, bytes: Uint8Array, temporaryPath: string): Promise<void> {
    const written = await this.#globals.IOUtils.write(path, bytes, {
      tmpPath: temporaryPath,
      mode: "overwrite",
      flush: true,
    });
    if (written !== bytes.byteLength) {
      throw new Error(`Atomic write reported ${written} of ${bytes.byteLength} bytes`);
    }
  }

  #file(path: string): GeckoNsIFileLike {
    const factory = this.#globals.Cc[LOCAL_FILE_CONTRACT];
    if (factory === undefined) {
      throw new FileBridgeConfigurationError(
        `Gecko file contract ${LOCAL_FILE_CONTRACT} is unavailable`,
      );
    }
    const file = factory.createInstance(this.#globals.Ci.nsIFile);
    file.initWithPath(path);
    return file;
  }
}
