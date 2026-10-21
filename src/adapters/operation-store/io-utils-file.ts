import type { AtomicTextFile } from "./durable-operation-store.js";

export interface IOUtilsTextApi {
  exists(path: string): Promise<boolean>;
  makeDirectory(path: string, options?: { ignoreExisting?: boolean }): Promise<void>;
  readUTF8(path: string): Promise<string>;
  writeUTF8(path: string, text: string, options?: { tmpPath?: string }): Promise<unknown>;
}

export interface PathUtilsApi {
  join(...parts: string[]): string;
  parent(path: string): string;
}

export class IOUtilsAtomicTextFile implements AtomicTextFile {
  readonly #io: IOUtilsTextApi;
  readonly #paths: PathUtilsApi;
  readonly #path: string;

  constructor(io: IOUtilsTextApi, paths: PathUtilsApi, path: string) {
    this.#io = io;
    this.#paths = paths;
    this.#path = path;
  }

  async readText(): Promise<string | undefined> {
    if (!(await this.#io.exists(this.#path))) return undefined;
    return this.#io.readUTF8(this.#path);
  }

  async writeTextAtomic(text: string): Promise<void> {
    const directory = this.#paths.parent(this.#path);
    await this.#io.makeDirectory(directory, { ignoreExisting: true });
    await this.#io.writeUTF8(this.#path, text, { tmpPath: `${this.#path}.tmp` });
  }
}

export function recommendedOperationStorePath(profileDirectory: string, paths: PathUtilsApi): string {
  return paths.join(
    profileDirectory,
    "zotero-ai-research-companion",
    "operations-v1.json",
  );
}
