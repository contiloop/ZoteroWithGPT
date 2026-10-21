export interface AsyncClosable {
  close(): Promise<void>;
}

export type ConnectionStartResult<Connection> =
  | { state: "active"; connection: Connection }
  | { state: "superseded" };

/**
 * Owns one asynchronously-created connection. Lifecycle changes are ordered so
 * two factories never run concurrently, while closing an installed connection
 * starts synchronously to revoke its authority before cleanup is awaited.
 */
export class SerializedConnectionLifecycle<Input, Connection extends AsyncClosable & object> {
  readonly #open: (input: Input) => Promise<Connection>;
  readonly #closing = new WeakMap<Connection, Promise<void>>();
  #active: Connection | undefined;
  #cleanupFailure: { error: unknown } | undefined;
  #revision = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(open: (input: Input) => Promise<Connection>) {
    this.#open = open;
  }

  get active(): Connection | undefined {
    return this.#active;
  }

  start(input: Input): Promise<ConnectionStartResult<Connection>> {
    const revision = ++this.#revision;
    const previous = this.#active;
    this.#active = undefined;
    const previousClose = previous === undefined ? undefined : this.#closeNow(previous);

    const operation = this.#tail.then(async (): Promise<ConnectionStartResult<Connection>> => {
      this.#assertCleanupConfirmed();
      await this.#waitForClose(previousClose);
      if (revision !== this.#revision) return { state: "superseded" };

      const candidate = await this.#open(input);
      if (revision !== this.#revision) {
        await this.#waitForClose(this.#closeNow(candidate));
        return { state: "superseded" };
      }

      this.#active = candidate;
      return { state: "active", connection: candidate };
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  stop(): Promise<void> {
    ++this.#revision;
    const active = this.#active;
    this.#active = undefined;
    const close = active === undefined ? undefined : this.#closeNow(active);
    const operation = this.#tail.then(async () => {
      this.#assertCleanupConfirmed();
      await this.#waitForClose(close);
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Waits until the most recently requested lifecycle change has settled. */
  async whenSettled(): Promise<void> {
    for (;;) {
      const revision = this.#revision;
      const tail = this.#tail;
      await tail;
      if (revision === this.#revision && tail === this.#tail) {
        // Let callers of the completed start publish their derived status.
        await Promise.resolve();
        return;
      }
    }
  }

  #closeNow(connection: Connection): Promise<void> {
    const existing = this.#closing.get(connection);
    if (existing !== undefined) return existing;

    let close: Promise<void>;
    try {
      close = Promise.resolve(connection.close());
    } catch (error) {
      close = Promise.reject(error);
    }
    this.#closing.set(connection, close);
    return close;
  }

  async #waitForClose(close: Promise<void> | undefined): Promise<void> {
    try {
      await close;
    } catch (error) {
      this.#cleanupFailure ??= { error };
      throw error;
    }
  }

  #assertCleanupConfirmed(): void {
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure.error;
  }
}

export interface StartableResource {
  start(): Promise<void>;
  stop(): void;
}

/** Keeps cleanup tied to the candidate that actually started or failed. */
export class OwnedStartupLifecycle<Owner, Resource extends StartableResource & object> {
  readonly #create: (owner: Owner) => Resource;
  readonly #stopped = new WeakSet<Resource>();
  #current: { owner: Owner; resource: Resource } | undefined;

  constructor(create: (owner: Owner) => Resource) {
    this.#create = create;
  }

  get resource(): Resource | undefined {
    return this.#current?.resource;
  }

  async attach(owner: Owner): Promise<boolean> {
    if (this.#current !== undefined) return this.#current.owner === owner;

    const candidate = this.#create(owner);
    this.#current = { owner, resource: candidate };
    try {
      await candidate.start();
      return this.#current?.resource === candidate;
    } catch (error) {
      this.#stop(candidate);
      if (this.#current?.resource === candidate) this.#current = undefined;
      throw error;
    }
  }

  detach(owner: Owner): boolean {
    if (this.#current?.owner !== owner) return false;
    const { resource } = this.#current;
    this.#current = undefined;
    this.#stop(resource);
    return true;
  }

  stop(): void {
    const current = this.#current;
    this.#current = undefined;
    if (current !== undefined) this.#stop(current.resource);
  }

  #stop(resource: Resource): void {
    if (this.#stopped.has(resource)) return;
    this.#stopped.add(resource);
    resource.stop();
  }
}

export interface PluginTeardownOptions {
  stopConnection(): Promise<void>;
  stopPreview(): void;
  shutdownSettings(): Promise<void>;
  reportError(error: unknown): void;
}

type CleanupResult =
  | { state: "fulfilled" }
  | { state: "rejected"; error: unknown };

function observeCleanup(cleanup: Promise<void>): Promise<CleanupResult> {
  return cleanup.then<CleanupResult, CleanupResult>(
    () => ({ state: "fulfilled" }),
    error => ({ state: "rejected", error }),
  );
}

/** Revokes native authority first, then attempts every optional cleanup. */
export async function teardownPluginResources(options: PluginTeardownOptions): Promise<void> {
  const errors: unknown[] = [];
  const record = (error: unknown): void => {
    if (!errors.some(existing => Object.is(existing, error))) errors.push(error);
    try {
      options.reportError(error);
    } catch (reportingError) {
      if (!errors.some(existing => Object.is(existing, reportingError))) {
        errors.push(reportingError);
      }
    }
  };

  let connectionStop: Promise<CleanupResult>;
  try {
    // Calling this before UI cleanup synchronously closes the live access gate.
    connectionStop = observeCleanup(options.stopConnection());
  } catch (error) {
    connectionStop = Promise.resolve({ state: "rejected", error });
  }

  try {
    options.stopPreview();
  } catch (error) {
    record(error);
  }

  try {
    await options.shutdownSettings();
  } catch (error) {
    record(error);
  }

  const connectionResult = await connectionStop;
  if (connectionResult.state === "rejected") record(connectionResult.error);

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Research Companion cleanup failed");
  }
}
