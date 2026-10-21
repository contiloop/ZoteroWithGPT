export const SETTINGS_PREFERENCE_NAMES = Object.freeze({
  enabled: "extensions.zotero-ai-research-companion.enabled",
  bridgeDirectory: "extensions.zotero-ai-research-companion.bridgeDirectory",
});

export type SettingsConnectionState = "disabled" | "connecting" | "ready" | "error";

export interface SettingsConnectionStatus {
  state: SettingsConnectionState;
  directory?: string;
  sessionId?: string;
  detail?: string;
}

export interface SettingsRuntimeCallbacks {
  /** Starts a newly allocated bridge session for the selected directory. */
  startConnection(directory: string): Promise<SettingsConnectionStatus>;
  /** Closes the live access gate before completing asynchronous cleanup. */
  stopConnection(): Promise<void>;
  getConnectionStatus(): SettingsConnectionStatus;
}

export type SettingsDialogAction =
  | "choose_directory"
  | "enable"
  | "disable"
  | "reconnect"
  | "close";

export interface SettingsSnapshot {
  enabled: boolean;
  selectedDirectory?: string;
  status: SettingsConnectionStatus;
  diagnostics: string[];
}

export interface SettingsWindowLike {
  readonly document?: unknown;
}

export interface SettingsHostPort {
  getPreference(name: string): unknown;
  setPreference(name: string, value: boolean | string): void;
  normalizeDirectory(directory: string): string | Promise<string>;
  chooseDirectory(
    window: SettingsWindowLike,
    currentDirectory?: string,
  ): Promise<string | undefined>;
  addToolsMenu(
    window: SettingsWindowLike,
    openSettings: () => void | Promise<void>,
  ): () => void;
  promptAction(
    window: SettingsWindowLike,
    snapshot: SettingsSnapshot,
  ): Promise<SettingsDialogAction>;
  showError(window: SettingsWindowLike, title: string, message: string): void;
}

export interface ResearchCompanionSettingsOptions {
  host: SettingsHostPort;
  runtime: SettingsRuntimeCallbacks;
}
