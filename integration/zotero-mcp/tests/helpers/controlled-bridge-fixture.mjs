import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FIXTURE_PROFILE_ID = "profile-A";
export const FIXTURE_SESSION_ID = "0123456789abcdef0123456789abcdef";

export const ACTIVE_OPERATIONS = [
  "connection_status",
  "find_local_arxiv",
  "search_papers",
  "read_pdf",
  "list_annotations",
  "list_notes",
  "read_note",
  "resolve_anchor",
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "verify_annotation",
];

export function connectionFor(fixture) {
  return {
    profileId: fixture.profileId,
    sessionId: fixture.sessionId,
  };
}

export async function createControlledBridgeFixture(t, options = {}) {
  // This is an isolated protocol fixture. It never opens a Zotero profile or
  // invokes the native companion.
  const createdRoot = await mkdtemp(path.join(os.tmpdir(), "zotero-mcp-controlled-"));
  const root = await realpath(createdRoot);
  const profileId = options.profileId ?? FIXTURE_PROFILE_ID;
  const sessionId = options.sessionId ?? FIXTURE_SESSION_ID;
  const sessionDirectory = path.join(root, "sessions", sessionId);
  const requestDirectory = path.join(sessionDirectory, "requests");
  const resultDirectory = path.join(sessionDirectory, "results");
  const statusPath = path.join(sessionDirectory, "status-v1.json");
  await mkdir(requestDirectory, { recursive: true });
  await mkdir(resultDirectory);

  const descriptor = {
    bridgeVersion: 1,
    protocolVersion: 1,
    profileId,
    sessionId,
    requestDirectory: `sessions/${sessionId}/requests`,
    resultDirectory: `sessions/${sessionId}/results`,
    statusFile: `sessions/${sessionId}/status-v1.json`,
    requestSuffix: ".request.json",
    resultSuffix: ".result.json",
    maxRequestBytes: options.maxRequestBytes ?? 1_048_576,
    maxResultBytes: options.maxResultBytes ?? 8_388_608,
    maxRequestsPerScan: 100,
  };
  const status = {
    bridgeVersion: 1,
    protocolVersion: 1,
    sessionId,
    profileId,
    enabled: options.enabled ?? true,
  };
  await writeFile(statusPath, JSON.stringify(status), { flag: "wx" });
  await writeFile(path.join(root, "bridge-v1.json"), JSON.stringify(descriptor), { flag: "wx" });

  const fixture = {
    root,
    profileId,
    sessionId,
    sessionDirectory,
    requestDirectory,
    resultDirectory,
    statusPath,
    descriptor,
    status,
  };
  t.after(async () => rm(root, { recursive: true, force: true }));
  return fixture;
}

export function succeeded(request, data, verification = undefined) {
  const write = [
    "create_annotation",
    "update_annotation",
    "create_note",
    "update_note",
  ].includes(request.operation);
  return {
    protocolVersion: 1,
    operationId: request.operationId,
    state: "succeeded",
    data,
    error: null,
    verification: verification ?? {
      storage: write ? "confirmed" : "not_applicable",
      viewer: write ? "not_checked" : "not_applicable",
    },
  };
}

export function connectionStatusData(fixture, operations = ACTIVE_OPERATIONS) {
  return {
    protocolVersion: 1,
    pluginVersion: "0.4.0-controlled-fixture",
    zoteroVersion: "10.0.6-controlled-fixture",
    profile: { id: fixture.profileId, name: "Controlled fixture" },
    enabled: true,
    capabilities: {
      operations,
      annotationTypes: ["highlight", "note"],
      annotationColors: ["#ffd400", "#2ea8e5"],
      maxRequestBytes: 1_048_576,
      maxTextBytes: 524_288,
    },
    transport: {
      kind: "custom",
      description: "Controlled local protocol fixture",
    },
  };
}

export function defaultNativeResponse(fixture, request, operations = ACTIVE_OPERATIONS) {
  switch (request.operation) {
    case "connection_status":
      return succeeded(request, connectionStatusData(fixture, operations));
    case "find_local_arxiv":
      return succeeded(request, {
        source: { arxivId: "2401.01234", version: 2 },
        matches: [],
        truncated: false,
      });
    case "search_papers":
      return succeeded(request, { matches: [] });
    case "read_pdf":
      return succeeded(request, {
        attachmentFingerprint: "sha256:fixture",
        attachmentRevision: "rev:pdf-fixture",
        pages: [],
      });
    case "list_annotations":
      return succeeded(request, { annotations: [] });
    case "list_notes":
      return succeeded(request, { notes: [] });
    case "read_note":
      return succeeded(request, {
        parentItemKey: request.payload.itemKey,
        noteKey: request.payload.noteKey,
        revision: "rev:9",
        content: "Existing body",
        deepLink: `zotero://select/library/items/${request.payload.noteKey}`,
      });
    case "resolve_anchor":
      return succeeded(request, {
        status: "unresolved",
        reason: "Controlled fixture has no page",
        candidates: [],
      });
    case "verify_annotation":
      return succeeded(request, {
        annotationKey: request.payload.annotationKey,
        storageEvidence: { confirmed: false, description: "Controlled fixture" },
        viewerEvidence: { confirmed: false, description: "Controlled fixture" },
      });
    default:
      throw new Error(`Controlled fixture needs an explicit ${request.operation} response`);
  }
}

export async function startControlledNativeResponder(t, fixture, handler) {
  let stopped = false;
  const handled = new Set();
  const observed = [];
  const running = (async () => {
    while (!stopped) {
      let names;
      try {
        names = await readdir(fixture.requestDirectory);
      } catch (error) {
        if (error?.code === "ENOENT") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          continue;
        }
        throw error;
      }
      for (const name of names.sort()) {
        if (!name.endsWith(".request.json") || handled.has(name)) continue;
        handled.add(name);
        const request = JSON.parse(await readFile(path.join(fixture.requestDirectory, name), "utf8"));
        observed.push(request);
        const response = await handler(request, observed);
        if (response === undefined) continue;
        const resultName = `${request.operationId}.result.json`;
        const target = path.join(fixture.resultDirectory, resultName);
        const staging = `${target}.controlled.${process.pid}.${handled.size}.partial`;
        await writeFile(
          staging,
          typeof response === "string" ? response : JSON.stringify(response),
          { flag: "wx" },
        );
        try {
          await link(staging, target);
        } finally {
          await unlink(staging).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  const stop = async () => {
    stopped = true;
    await running;
  };
  t.after(stop);
  return { observed, stop };
}
