import {
  SETTINGS_PREFERENCE_NAMES,
  type ResearchCompanionSettingsOptions,
  type SettingsConnectionStatus,
  type SettingsDialogAction,
  type SettingsSnapshot,
  type SettingsWindowLike,
} from "./types.js";

const DIALOG_TITLE = "Research Companion";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The connection could not be changed. See Zotero's error log for details.";
}

function optionalDirectory(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function enabledPreference(value: unknown): boolean {
  return value === true;
}

function statusLabel(state: SettingsConnectionStatus["state"]): string {
  switch (state) {
    case "disabled": return "Disabled";
    case "connecting": return "Connecting";
    case "ready": return "Ready";
    case "error": return "Error";
  }
}

function diagnosticsFor(
  selectedDirectory: string | undefined,
  status: SettingsConnectionStatus,
): string[] {
  return [
    `State: ${statusLabel(status.state)}`,
    `Directory: ${selectedDirectory ?? "Not selected"}`,
    ...(status.sessionId === undefined ? [] : [`Session: ${status.sessionId}`]),
    ...(status.detail === undefined ? [] : [`Detail: ${status.detail}`]),
    "Protocol: v1 local request/result files",
  ];
}

/**
 * Settings use only injected host and connection boundaries. The controller
 * does not import the file bridge, operation core, or Zotero native adapter.
 */
export class ResearchCompanionSettings {
  readonly #host: ResearchCompanionSettingsOptions["host"];
  readonly #runtime: ResearchCompanionSettingsOptions["runtime"];
  readonly #windowCleanup = new Map<SettingsWindowLike, () => void>();
  #initialized = false;
  #status: SettingsConnectionStatus;

  constructor(options: ResearchCompanionSettingsOptions) {
    this.#host = options.host;
    this.#runtime = options.runtime;
    this.#status = options.runtime.getConnectionStatus();
  }

  /** Restores the persisted desired state without requiring a main window. */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    const directory = this.#selectedDirectory();
    if (this.#enabled() && directory !== undefined) {
      await this.#start(directory, undefined);
      return;
    }

    if (this.#enabled()) {
      this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, false);
      this.#status = {
        state: "error",
        detail: "Choose a dedicated directory before enabling the connection",
      };
    }
    try {
      await this.#runtime.stopConnection();
      if (this.#status.state !== "error") {
        this.#status = { state: "disabled", detail: "Connection disabled" };
      }
    } catch (error) {
      this.#status = { state: "error", detail: errorMessage(error) };
    }
  }

  onMainWindowLoad(window: SettingsWindowLike): void {
    if (this.#windowCleanup.has(window)) return;
    const cleanup = this.#host.addToolsMenu(window, async () => {
      await this.openSettings(window);
    });
    this.#windowCleanup.set(window, cleanup);
  }

  onMainWindowUnload(window: SettingsWindowLike): void {
    const cleanup = this.#windowCleanup.get(window);
    if (cleanup === undefined) return;
    this.#windowCleanup.delete(window);
    cleanup();
  }

  async openSettings(window: SettingsWindowLike): Promise<void> {
    for (;;) {
      const action = await this.#host.promptAction(window, this.snapshot());
      if (action === "close") return;
      await this.#perform(action, window);
    }
  }

  snapshot(): SettingsSnapshot {
    const selectedDirectory = this.#selectedDirectory();
    return {
      enabled: this.#enabled(),
      ...(selectedDirectory === undefined ? {} : { selectedDirectory }),
      status: { ...this.#status },
      diagnostics: diagnosticsFor(selectedDirectory, this.#status),
    };
  }

  /** Removes adapter-owned UI and closes the connection without erasing setup. */
  async shutdown(): Promise<void> {
    try {
      await this.#runtime.stopConnection();
      this.#status = { state: "disabled", detail: "Connection stopped" };
    } catch (error) {
      this.#status = { state: "error", detail: errorMessage(error) };
    }
    const cleanups = [...this.#windowCleanup.values()];
    this.#windowCleanup.clear();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // Closed windows must not prevent cleanup of other adapter-owned menus.
      }
    }
    this.#initialized = false;
  }

  async #perform(action: SettingsDialogAction, window: SettingsWindowLike): Promise<void> {
    switch (action) {
      case "choose_directory":
        await this.#chooseDirectory(window);
        return;
      case "enable": {
        const directory = this.#selectedDirectory();
        if (directory === undefined) {
          const detail = "Choose a dedicated directory before enabling the connection";
          this.#status = {
            state: "error",
            detail,
          };
          this.#host.showError(window, DIALOG_TITLE, detail);
          return;
        }
        await this.#start(directory, window);
        return;
      }
      case "disable":
        await this.#stop(window, "Connection disabled");
        return;
      case "reconnect":
        await this.#reconnect(window);
        return;
      case "close":
        return;
    }
  }

  async #chooseDirectory(window: SettingsWindowLike): Promise<void> {
    try {
      const chosen = await this.#host.chooseDirectory(window, this.#selectedDirectory());
      if (chosen === undefined) return;
      const normalized = await this.#host.normalizeDirectory(chosen);
      if (normalized.trim().length === 0) throw new Error("The selected directory is empty");
      this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.bridgeDirectory, normalized);
    } catch (error) {
      const detail = errorMessage(error);
      this.#status = { state: "error", detail };
      this.#host.showError(window, DIALOG_TITLE, detail);
    }
  }

  async #start(directory: string, window: SettingsWindowLike | undefined): Promise<void> {
    this.#status = { state: "connecting", directory, detail: "Starting a fresh session" };
    try {
      const status = await this.#runtime.startConnection(directory);
      if (status.state !== "ready") {
        throw new Error(status.detail ?? "The connection did not become ready");
      }
      this.#status = { ...status, directory };
      if (!this.#enabled()) {
        this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, true);
      }
    } catch (error) {
      this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, false);
      try {
        await this.#runtime.stopConnection();
      } catch {
        // The runtime boundary is required to close its access gate before it awaits cleanup.
      }
      this.#status = { state: "error", directory, detail: errorMessage(error) };
      if (window !== undefined) {
        this.#host.showError(window, DIALOG_TITLE, this.#status.detail ?? "Connection failed");
      }
    }
  }

  async #stop(window: SettingsWindowLike, detail: string): Promise<void> {
    this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, false);
    try {
      await this.#runtime.stopConnection();
      const directory = this.#selectedDirectory();
      this.#status = {
        state: "disabled",
        ...(directory === undefined ? {} : { directory }),
        detail,
      };
    } catch (error) {
      const directory = this.#selectedDirectory();
      this.#status = {
        state: "error",
        ...(directory === undefined ? {} : { directory }),
        detail: errorMessage(error),
      };
      this.#host.showError(window, DIALOG_TITLE, this.#status.detail ?? "Connection stop failed");
    }
  }

  async #reconnect(window: SettingsWindowLike): Promise<void> {
    const directory = this.#selectedDirectory();
    if (directory === undefined) {
      const detail = "Choose a dedicated directory before reconnecting";
      this.#status = {
        state: "error",
        detail,
      };
      this.#host.showError(window, DIALOG_TITLE, detail);
      return;
    }
    this.#host.setPreference(SETTINGS_PREFERENCE_NAMES.enabled, false);
    try {
      await this.#runtime.stopConnection();
    } catch (error) {
      this.#status = { state: "error", directory, detail: errorMessage(error) };
      this.#host.showError(window, DIALOG_TITLE, this.#status.detail ?? "Reconnect failed");
      return;
    }
    await this.#start(directory, window);
  }

  #enabled(): boolean {
    return enabledPreference(this.#host.getPreference(SETTINGS_PREFERENCE_NAMES.enabled));
  }

  #selectedDirectory(): string | undefined {
    return optionalDirectory(
      this.#host.getPreference(SETTINGS_PREFERENCE_NAMES.bridgeDirectory),
    );
  }
}
