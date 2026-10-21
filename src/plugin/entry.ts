import { openProductionConnection, type ProductionConnectionEnvironment } from "./connection.js";
import { SafeMarkdownRenderer } from "../adapters/rendering/index.js";
import { ZoteroReaderRenderingAdapter, type ZoteroReaderHostLike } from "../adapters/reader/index.js";
import {
  ResearchCompanionSettings, createZoteroSettingsHost,
  type ZoteroSettingsEnvironment, type SettingsConnectionStatus,
} from "../adapters/settings/index.js";
import { OwnedStartupLifecycle, SerializedConnectionLifecycle } from "./lifecycle.js";

type ChromeWindow = Window & typeof globalThis;
type ProductionConnection = Awaited<ReturnType<typeof openProductionConnection>>;

declare const Zotero: ProductionConnectionEnvironment["Zotero"] &
  ZoteroReaderHostLike & ZoteroSettingsEnvironment["Zotero"] & {
    getMainWindow(): ChromeWindow | null;
    getMainWindows(): ChromeWindow[];
    launchURL(url: string): void;
  };
declare const IOUtils: ProductionConnectionEnvironment["IOUtils"];
declare const PathUtils: ProductionConnectionEnvironment["PathUtils"];
declare const Cc: ProductionConnectionEnvironment["Cc"];
declare const Ci: ProductionConnectionEnvironment["Ci"];
declare const Cu: { cloneInto<T>(value: T, target: object): T };
declare const ChromeUtils: ZoteroSettingsEnvironment["ChromeUtils"];
declare const Services: ZoteroSettingsEnvironment["Services"];

let settings: ResearchCompanionSettings | undefined;
let status: SettingsConnectionStatus = { state: "disabled" };
let pluginVersion = "";
let running = false;
let statusRevision = 0;

function reportError(error: unknown): void {
  // Do not log request content, document text, credentials, or native records.
  Zotero.logError?.(new Error(error instanceof Error ? error.message : "Research Companion encountered an error"));
}

const previewLifecycle = new OwnedStartupLifecycle<ChromeWindow, ZoteroReaderRenderingAdapter>(
  window => new ZoteroReaderRenderingAdapter({
    host: Zotero,
    renderer: new SafeMarkdownRenderer({ window }),
    openLink: url => Zotero.launchURL(url),
    onError: reportError,
  }),
);

const connectionLifecycle = new SerializedConnectionLifecycle<string, ProductionConnection>(
  directory => openProductionConnection({
    Zotero, IOUtils, PathUtils, Cc, Ci, crypto,
    cloneInto: (value, target) => Cu.cloneInto(value, target), reportError,
  }, pluginVersion, directory, {
    verifyVisiblePreview: request =>
      previewLifecycle.resource?.verifyVisiblePreview(request) ?? Promise.resolve(false),
  }),
);

async function attachReader(window: ChromeWindow): Promise<void> {
  if (!running || window.closed) return;
  try {
    await previewLifecycle.attach(window);
  } catch (error) {
    reportError(error);
    // Native comments remain usable if formatted rendering is unavailable.
  }
}

async function stopConnection(): Promise<void> {
  ++statusRevision;
  status = { state: "disabled" };
  await connectionLifecycle.stop();
}

function readyStatus(
  directory: string,
  connection: ProductionConnection,
): SettingsConnectionStatus {
  return {
    state: "ready",
    directory,
    sessionId: connection.subscription.readiness.sessionId,
    detail: "Connected to the selected local Zotero profile. New requests use the active session descriptor.",
  };
}

async function statusAfterSupersededStart(): Promise<SettingsConnectionStatus> {
  await connectionLifecycle.whenSettled();
  const active = connectionLifecycle.active;
  if (active !== undefined && status.state === "connecting" && status.directory !== undefined) {
    return readyStatus(status.directory, active);
  }
  return status;
}

async function startConnection(directory: string): Promise<SettingsConnectionStatus> {
  const revision = ++statusRevision;
  status = { state: "connecting", directory };
  try {
    const result = await connectionLifecycle.start(directory);
    if (revision !== statusRevision || result.state === "superseded") {
      return statusAfterSupersededStart();
    }
    status = readyStatus(directory, result.connection);
    return status;
  } catch (error) {
    if (revision !== statusRevision) return statusAfterSupersededStart();
    status = { state: "error", directory,
      detail: error instanceof Error ? error.message : "Could not enable the local connection" };
    throw error;
  }
}

export async function start({ version }: { version: string }): Promise<void> {
  if (running) return;
  running = true;
  pluginVersion = version;
  const candidate = new ResearchCompanionSettings({
    host: createZoteroSettingsHost({ Zotero, ChromeUtils, Services, PathUtils }),
    runtime: { startConnection, stopConnection, getConnectionStatus: () => status },
  });
  settings = candidate;
  const window = Zotero.getMainWindow();
  if (window) await attachReader(window);
  if (!running || settings !== candidate) return;
  for (const mainWindow of Zotero.getMainWindows()) candidate.onMainWindowLoad(mainWindow);
  await candidate.initialize();
}

export function onMainWindowLoad(window: ChromeWindow): void {
  if (!running) return;
  settings?.onMainWindowLoad(window);
  void attachReader(window);
}

export function onMainWindowUnload(window: ChromeWindow): void {
  settings?.onMainWindowUnload(window);
  if (!previewLifecycle.detach(window)) return;
  const replacement = Zotero.getMainWindows().find(candidate => candidate !== window && !candidate.closed);
  if (replacement) void attachReader(replacement);
}

export async function stop(): Promise<void> {
  running = false;
  previewLifecycle.stop();
  const activeSettings = settings;
  settings = undefined;
  try { await activeSettings?.shutdown(); }
  finally {
    await stopConnection();
    previewLifecycle.stop();
  }
}
