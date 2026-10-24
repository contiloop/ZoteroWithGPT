import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OWNED_RUNTIME_ALIAS = "zotero-study-save-mcp";
export const OWNED_RUNTIME_PROFILE = "zotero-study-save-mcp";

const OWNER = "zotero-study-save-mcp-runtime";
const OWNER_FILE = ".zotero-mcp-owner.json";
const PRIVATE_DIRECTORY = "private";
const CONFIG_FILE = path.join(PRIVATE_DIRECTORY, "config.json");
const ROLLBACK_FILE = path.join(PRIVATE_DIRECTORY, "rollback.json");
const STABLE_LAUNCHER = path.join("bin", "zotero-mcp-lifecycle.mjs");
const TUNNEL_CLIENT_REVISION = "0f870e50a973fa820d4c409000059e181e8d242b";
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const RUNTIME_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u;

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a nonempty absolute path`);
  }
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
  if (value === path.parse(value).root) {
    throw new TypeError(`${label} cannot be a filesystem root`);
  }
  return value;
}

async function requireExistingDirectory(value, label) {
  const filename = requireAbsolutePath(value, label);
  const info = await lstat(filename);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError(`${label} must be an existing non-symlink directory`);
  }
  const resolved = await realpath(filename);
  if (resolved === os.homedir()) throw new TypeError(`${label} cannot be the home directory`);
  return resolved;
}

async function canonicalInstallRoot(value) {
  const requested = requireAbsolutePath(value, "installRoot");
  let cursor = requested;
  const missing = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new TypeError("installRoot or its nearest existing parent must be a non-symlink directory");
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
  const resolved = path.join(await realpath(cursor), ...missing);
  if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
    throw new TypeError("installRoot cannot be a filesystem root or the home directory");
  }
  return resolved;
}

async function requireExecutable(value, label) {
  const filename = requireAbsolutePath(value, label);
  const resolved = await realpath(filename);
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0) {
    throw new TypeError(`${label} must resolve to an executable regular file`);
  }
  return resolved;
}

async function requireCredentialReference(value) {
  if (typeof value !== "string" || !value.startsWith("file:")) {
    throw new TypeError("runtimeApiKeyReference must be a protected file: reference");
  }
  const filename = requireAbsolutePath(value.slice("file:".length), "runtime API key reference");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError("runtime API key reference must name a non-symlink file");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new TypeError("runtime API key reference must not be accessible to group or other users");
  }
  return `file:${filename}`;
}

function requireTunnelId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new TypeError("tunnelId must identify one existing tunnel");
  }
  return value;
}

function requireRuntimeVersion(value, label) {
  if (typeof value !== "string" || !RUNTIME_VERSION_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a safe version identifier`);
  }
  return value;
}

function optionalControlPlaneBaseUrl(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError("controlPlaneBaseUrl must be an HTTPS URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("controlPlaneBaseUrl must be an uncredentialed HTTPS URL");
  }
  return parsed.href.replace(/\/$/u, "");
}

function optionalControlPlaneUrlPath(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(value)) {
    throw new TypeError("controlPlaneUrlPath must be one absolute URL path");
  }
  return value;
}

async function readJson(filename, label = filename) {
  let value;
  try {
    value = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not readable valid JSON`, { cause: error });
  }
  return requirePlainObject(value, label);
}

async function readOwnedJson(filename, label) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be an owned regular file`);
  }
  return readJson(filename, label);
}

async function sha256(filename) {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

async function listedFiles(directory, prefix = "", ignoredTopLevel = new Set()) {
  const current = path.join(directory, ...prefix.split("/").filter(Boolean));
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (prefix === "" && ignoredTopLevel.has(entry.name)) continue;
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`owned runtime contains a symlink at ${relative}`);
    if (entry.isDirectory()) files.push(...await listedFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`owned runtime contains an unsupported entry at ${relative}`);
  }
  return files;
}

async function validateReleaseLayout(directory, members, prefix = "") {
  const allowedFiles = new Set(members);
  const allowedDirectories = new Set();
  for (const member of members) {
    let parent = path.posix.dirname(member);
    while (parent !== ".") {
      allowedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const current = path.join(directory, ...prefix.split("/").filter(Boolean));
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`owned release contains a symlink at ${relative}`);
    if (relative === "node_modules") {
      if (!entry.isDirectory()) throw new Error("owned release node_modules must be a directory");
      continue;
    }
    if (entry.isDirectory()) {
      if (!allowedDirectories.has(relative)) {
        throw new Error(`owned release contains an unknown directory at ${relative}`);
      }
      await validateReleaseLayout(directory, members, relative);
    } else if (!entry.isFile() || !allowedFiles.has(relative)) {
      throw new Error(`owned release contains an unknown entry at ${relative}`);
    }
  }
}

function validatePackageMetadata(metadata) {
  if (
    metadata.schemaVersion !== 1 ||
    metadata.owner !== OWNER ||
    typeof metadata.version !== "string" ||
    !RUNTIME_VERSION_PATTERN.test(metadata.version) ||
    !Array.isArray(metadata.members) ||
    metadata.memberSha256 === null ||
    typeof metadata.memberSha256 !== "object" ||
    Array.isArray(metadata.memberSha256)
  ) {
    throw new Error("server build metadata is not an owned versioned runtime inventory");
  }
  const members = [...metadata.members];
  if (
    members.length === 0 ||
    new Set(members).size !== members.length ||
    JSON.stringify(members) !== JSON.stringify([...members].sort()) ||
    !members.includes("SERVER_BUILD_METADATA.json") ||
    !members.includes("integration/zotero-mcp/server.mjs") ||
    !members.includes("integration/zotero-mcp/lifecycle.mjs") ||
    !members.includes("package-lock.json") ||
    !members.includes("package.json")
  ) {
    throw new Error("server build metadata has an invalid member inventory");
  }
  const hashed = members.filter(member => member !== "SERVER_BUILD_METADATA.json");
  if (JSON.stringify(Object.keys(metadata.memberSha256)) !== JSON.stringify(hashed)) {
    throw new Error("server build metadata has an invalid member hash inventory");
  }
  return members;
}

async function validateReleaseFiles(root, metadata, { verifyHashes }) {
  const members = validatePackageMetadata(metadata);
  for (const member of members) {
    if (
      typeof member !== "string" ||
      member.startsWith("/") ||
      member.split("/").some(segment => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("server build metadata contains an unsafe member");
    }
    const info = await lstat(path.join(root, ...member.split("/")));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`server package member ${member} is not a regular file`);
    }
    if (verifyHashes && member !== "SERVER_BUILD_METADATA.json") {
      if (await sha256(path.join(root, ...member.split("/"))) !== metadata.memberSha256[member]) {
        throw new Error(`server package member ${member} does not match its release hash`);
      }
    }
  }
  const actual = await listedFiles(root, "", new Set(["node_modules"]));
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...members].sort())) {
    throw new Error("server release contains files outside its owned inventory");
  }
  await validateReleaseLayout(root, members);
  return members;
}

async function writePrivateJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.new-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

const STABLE_LAUNCHER_SOURCE = `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const config = JSON.parse(await readFile(path.join(root, "private", "config.json"), "utf8"));
  if (config.owner !== "zotero-study-save-mcp-runtime" || typeof config.releaseDirectory !== "string") {
    throw new Error("installed Zotero MCP configuration is invalid");
  }
  const entry = path.join(root, ...config.releaseDirectory.split("/"), "integration", "zotero-mcp", "lifecycle.mjs");
  const lifecycle = await import(pathToFileURL(entry).href);
  await lifecycle.main(process.argv.slice(2));
} catch {
  process.stderr.write("Zotero MCP lifecycle failed safely; no private configuration was printed.\\n");
  process.exitCode = 1;
}
`;

async function writeStableLauncher(root) {
  const filename = path.join(root, STABLE_LAUNCHER);
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.new-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, STABLE_LAUNCHER_SOURCE, { mode: 0o700, flag: "wx" });
    await chmod(temporary, 0o700);
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
  return filename;
}

export async function runCommand(executable, args) {
  const child = spawn(executable, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let overflow = false;
  for (const [stream, append] of [
    [child.stdout, chunk => { stdout += chunk; }],
    [child.stderr, chunk => { stderr += chunk; }],
  ]) {
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        overflow = true;
        child.kill("SIGTERM");
        return;
      }
      append(chunk);
    });
  }
  const [code] = await once(child, "close");
  return { code: overflow ? 1 : code ?? 1, stdout, stderr };
}

async function validateToolchain(config, command) {
  const nodeVersion = await command(config.independentNode, ["--version"]);
  if (nodeVersion.code !== 0 || !/^v(?:24|25|26)\./u.test(nodeVersion.stdout.trim())) {
    throw new Error("independent Node must report a supported 24–26 version");
  }
  const tunnelVersion = await command(config.tunnelClient, ["--version"]);
  if (
    tunnelVersion.code !== 0 ||
    !tunnelVersion.stdout.trim().startsWith(`0.0.14+${TUNNEL_CLIENT_REVISION}`)
  ) {
    throw new Error("tunnel-client must be the reviewed 0.0.14 runtime build");
  }
}

async function validateStoredExecutable(filename, label) {
  const resolved = await requireExecutable(filename, label);
  if (resolved !== filename) throw new Error(`${label} is no longer the canonical executable target`);
}

async function validateStoredToolchainPaths(config) {
  await validateStoredExecutable(config.independentNode, "configured independent Node");
  await validateStoredExecutable(config.tunnelClient, "configured tunnel-client");
}

async function loadPackage(sourceRoot) {
  const root = await requireExistingDirectory(sourceRoot, "sourceRoot");
  const metadata = await readOwnedJson(
    path.join(root, "SERVER_BUILD_METADATA.json"),
    "server build metadata",
  );
  const members = await validateReleaseFiles(root, metadata, { verifyHashes: true });
  const nodeModules = path.join(root, "node_modules");
  const nodeModulesInfo = await lstat(nodeModules);
  if (!nodeModulesInfo.isDirectory() || nodeModulesInfo.isSymbolicLink()) {
    throw new Error("server package dependencies are not installed; run locked npm ci first");
  }
  return { root, metadata, members, nodeModules };
}

async function stageRelease(runtimePackage, destination) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(parent, ".installing-"));
  try {
    for (const member of runtimePackage.members) {
      const source = path.join(runtimePackage.root, ...member.split("/"));
      const target = path.join(temporary, ...member.split("/"));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await cp(source, target, { errorOnExist: true, preserveTimestamps: true });
    }
    await cp(runtimePackage.nodeModules, path.join(temporary, "node_modules"), {
      recursive: true,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    return temporary;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function replaceRelease(runtimePackage, destination) {
  let existing = false;
  try {
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("installed release path is not an owned directory");
    }
    const metadata = await readOwnedJson(
      path.join(destination, "SERVER_BUILD_METADATA.json"),
      "installed server build metadata",
    );
    const members = await validateReleaseFiles(destination, metadata, { verifyHashes: false });
    if (
      metadata.owner !== runtimePackage.metadata.owner ||
      metadata.version !== runtimePackage.metadata.version ||
      JSON.stringify(members) !== JSON.stringify(runtimePackage.members)
    ) {
      throw new Error("installed release inventory differs from the owned package");
    }
    const nodeModules = await lstat(path.join(destination, "node_modules"));
    if (!nodeModules.isDirectory() || nodeModules.isSymbolicLink()) {
      throw new Error("installed release node_modules is not an owned directory");
    }
    existing = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const staged = await stageRelease(runtimePackage, destination);
  if (!existing) {
    try {
      await rename(staged, destination);
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
    return;
  }
  const backup = `${destination}.replaced-${process.pid}-${Date.now()}`;
  await rename(destination, backup);
  try {
    await rename(staged, destination);
  } catch (error) {
    await rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  await rm(backup, { recursive: true, force: false });
}

function validateStoredConfig(config, root, label) {
  const requiredKeys = [
    "alias",
    "bridgeRoot",
    "independentNode",
    "installRoot",
    "owner",
    "profile",
    "releaseDirectory",
    "runtimeApiKeyReference",
    "schemaVersion",
    "tunnelClient",
    "tunnelId",
    "version",
  ];
  const optionalKeys = ["controlPlaneBaseUrl", "controlPlaneUrlPath"];
  const actualKeys = Object.keys(config).sort();
  const expectedKeys = [
    ...requiredKeys,
    ...optionalKeys.filter(key => Object.hasOwn(config, key)),
  ].sort();
  const version = requireRuntimeVersion(config.version, `${label} version`);
  const bridgeRoot = requireAbsolutePath(config.bridgeRoot, `${label} bridgeRoot`);
  requireAbsolutePath(config.independentNode, `${label} independent Node`);
  requireAbsolutePath(config.tunnelClient, `${label} tunnel-client`);
  if (
    typeof config.runtimeApiKeyReference !== "string" ||
    !config.runtimeApiKeyReference.startsWith("file:")
  ) {
    throw new Error(`${label} lacks a protected credential reference`);
  }
  requireAbsolutePath(
    config.runtimeApiKeyReference.slice("file:".length),
    `${label} runtime API key reference`,
  );
  requireTunnelId(config.tunnelId);
  if (
    (config.controlPlaneBaseUrl !== undefined &&
      optionalControlPlaneBaseUrl(config.controlPlaneBaseUrl) !== config.controlPlaneBaseUrl) ||
    (config.controlPlaneUrlPath !== undefined &&
      optionalControlPlaneUrlPath(config.controlPlaneUrlPath) !== config.controlPlaneUrlPath)
  ) {
    throw new Error(`${label} has a noncanonical control-plane route`);
  }
  if (
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    config.schemaVersion !== 1 ||
    config.owner !== OWNER ||
    config.installRoot !== root ||
    config.alias !== OWNED_RUNTIME_ALIAS ||
    config.profile !== OWNED_RUNTIME_PROFILE ||
    config.releaseDirectory !== releaseRelative(version) ||
    bridgeRoot === root ||
    bridgeRoot.startsWith(`${root}${path.sep}`) ||
    root.startsWith(`${bridgeRoot}${path.sep}`)
  ) {
    throw new Error(`${label} is not an owned route`);
  }
  return config;
}

async function loadOwnedState(installRoot) {
  const root = await canonicalInstallRoot(installRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("installRoot must be an owned non-symlink directory");
  }
  const marker = await readOwnedJson(path.join(root, OWNER_FILE), "runtime ownership marker");
  if (
    JSON.stringify(Object.keys(marker).sort()) !==
      JSON.stringify(["installRoot", "owner", "schemaVersion"]) ||
    marker.schemaVersion !== 1 ||
    marker.owner !== OWNER ||
    marker.installRoot !== root
  ) {
    throw new Error("installRoot is not owned by this lifecycle");
  }
  const config = await readOwnedJson(path.join(root, CONFIG_FILE), "private runtime config");
  validateStoredConfig(config, root, "private runtime config");
  return { root, config };
}

async function requireDirectoryEntry(filename, label) {
  const info = await lstat(filename);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be an owned non-symlink directory`);
  }
}

function requireExactOrOptionalNames(actual, required, optional, label) {
  const known = new Set([...required, ...optional]);
  const unknown = actual.find(name => !known.has(name));
  const missing = required.find(name => !actual.includes(name));
  if (unknown !== undefined || missing !== undefined) {
    throw new Error(`${label} contains an unknown entry or lacks an owned entry`);
  }
}

async function validateOwnedTree(root, config) {
  const rootNames = (await readdir(root)).sort();
  requireExactOrOptionalNames(
    rootNames,
    [OWNER_FILE, "bin", PRIVATE_DIRECTORY, "releases"],
    [],
    "installRoot",
  );
  await requireDirectoryEntry(path.join(root, "bin"), "runtime bin directory");
  const binNames = (await readdir(path.join(root, "bin"))).sort();
  requireExactOrOptionalNames(binNames, [path.basename(STABLE_LAUNCHER)], [], "runtime bin directory");
  const launcherInfo = await lstat(path.join(root, STABLE_LAUNCHER));
  if (!launcherInfo.isFile() || launcherInfo.isSymbolicLink()) {
    throw new Error("stable lifecycle launcher must be an owned regular file");
  }

  const privateRoot = path.join(root, PRIVATE_DIRECTORY);
  await requireDirectoryEntry(privateRoot, "private runtime directory");
  const privateNames = (await readdir(privateRoot)).sort();
  requireExactOrOptionalNames(
    privateNames,
    [path.basename(CONFIG_FILE)],
    [path.basename(ROLLBACK_FILE), "tunnel-profiles"],
    "private runtime directory",
  );
  if (privateNames.includes(path.basename(ROLLBACK_FILE))) {
    const rollback = await readOwnedJson(path.join(root, ROLLBACK_FILE), "runtime rollback state");
    if (
      JSON.stringify(Object.keys(rollback).sort()) !==
        JSON.stringify(["config", "owner", "schemaVersion"]) ||
      rollback.schemaVersion !== 1 ||
      rollback.owner !== OWNER
    ) {
      throw new Error("runtime rollback state is not owned by this lifecycle");
    }
    validateStoredConfig(
      requirePlainObject(rollback.config, "runtime rollback config"),
      root,
      "runtime rollback config",
    );
  }
  if (privateNames.includes("tunnel-profiles")) {
    await requireDirectoryEntry(path.join(privateRoot, "tunnel-profiles"), "tunnel profile directory");
  }

  const releasesRoot = path.join(root, "releases");
  await requireDirectoryEntry(releasesRoot, "runtime releases directory");
  const releases = (await readdir(releasesRoot)).sort();
  if (releases.length === 0 || !releases.includes(config.version)) {
    throw new Error("runtime releases directory lacks the configured release");
  }
  for (const version of releases) {
    const releaseRoot = path.join(releasesRoot, version);
    await requireDirectoryEntry(releaseRoot, `runtime release ${version}`);
    const metadata = await readOwnedJson(
      path.join(releaseRoot, "SERVER_BUILD_METADATA.json"),
      `runtime release ${version} metadata`,
    );
    if (metadata.version !== version || metadata.owner !== OWNER) {
      throw new Error(`runtime release ${version} has mismatched ownership metadata`);
    }
    await validateReleaseFiles(releaseRoot, metadata, { verifyHashes: false });
    await requireDirectoryEntry(path.join(releaseRoot, "node_modules"), `runtime release ${version} dependencies`);
  }
}

function releaseRelative(version) {
  return `releases/${version}`;
}

function commandQuote(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError("MCP command arguments must be nonempty strings");
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function mcpCommand(root, config) {
  const server = path.join(root, ...config.releaseDirectory.split("/"), "integration", "zotero-mcp", "server.mjs");
  return [
    "/usr/bin/env",
    `ZOTERO_MCP_BRIDGE_ROOT=${config.bridgeRoot}`,
    config.independentNode,
    server,
  ].map(commandQuote).join(" ");
}

function tunnelBaseArgs(config) {
  const args = [];
  if (config.controlPlaneBaseUrl !== undefined) {
    args.push("--control-plane-base-url", config.controlPlaneBaseUrl);
  }
  if (config.controlPlaneUrlPath !== undefined) {
    args.push("--control-plane-url-path", config.controlPlaneUrlPath);
  }
  return args;
}

function safeStatus(config, payload) {
  return {
    alias: OWNED_RUNTIME_ALIAS,
    processRunning: payload.process_running === true,
    healthy: payload.healthy === true,
    ready: payload.ready === true,
    version: config.version,
  };
}

async function invokeTunnel(config, args, command, action) {
  const result = await command(config.tunnelClient, [...args, ...tunnelBaseArgs(config)]);
  if (result.code !== 0) {
    throw new Error(`owned tunnel runtime ${action} failed (exit ${String(result.code)})`);
  }
  return result;
}

async function readTunnelStatus(config, command) {
  const result = await invokeTunnel(
    config,
    ["runtimes", "status", OWNED_RUNTIME_ALIAS, "--json"],
    command,
    "status",
  );
  let payload;
  try {
    payload = requirePlainObject(JSON.parse(result.stdout), "tunnel status");
  } catch {
    throw new Error("owned tunnel runtime status returned invalid JSON");
  }
  return safeStatus(config, payload);
}

export async function installRuntime(options, dependencies = {}) {
  requirePlainObject(options, "install options");
  const command = dependencies.runCommand ?? runCommand;
  const runtimePackage = await loadPackage(options.sourceRoot);
  const installRoot = await canonicalInstallRoot(options.installRoot);
  const bridgeRoot = await requireExistingDirectory(options.bridgeRoot, "bridgeRoot");
  if (
    bridgeRoot === installRoot ||
    bridgeRoot.startsWith(`${installRoot}${path.sep}`) ||
    installRoot.startsWith(`${bridgeRoot}${path.sep}`)
  ) {
    throw new TypeError("installRoot and bridgeRoot must be separate directories");
  }
  const config = {
    schemaVersion: 1,
    owner: OWNER,
    installRoot,
    version: runtimePackage.metadata.version,
    releaseDirectory: releaseRelative(runtimePackage.metadata.version),
    bridgeRoot,
    independentNode: await requireExecutable(options.independentNode, "independentNode"),
    tunnelClient: await requireExecutable(options.tunnelClient, "tunnelClient"),
    tunnelId: requireTunnelId(options.tunnelId),
    runtimeApiKeyReference: await requireCredentialReference(options.runtimeApiKeyReference),
    alias: OWNED_RUNTIME_ALIAS,
    profile: OWNED_RUNTIME_PROFILE,
    controlPlaneBaseUrl: optionalControlPlaneBaseUrl(options.controlPlaneBaseUrl),
    controlPlaneUrlPath: optionalControlPlaneUrlPath(options.controlPlaneUrlPath),
  };
  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }
  await validateToolchain(config, command);

  let previous;
  let installRootExists = false;
  try {
    const info = await lstat(installRoot);
    installRootExists = true;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("existing installRoot is not a non-symlink directory");
    }
    previous = await loadOwnedState(installRoot);
    await validateOwnedTree(previous.root, previous.config);
  } catch (error) {
    if (error?.code !== "ENOENT" || installRootExists) {
      throw new Error("existing installRoot is not an intact owned runtime", { cause: error });
    }
  }
  if (previous === undefined) {
    const parent = path.dirname(installRoot);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryRoot = await mkdtemp(path.join(parent, ".zotero-mcp-installing-"));
    try {
      await chmod(temporaryRoot, 0o700);
      await writePrivateJson(path.join(temporaryRoot, OWNER_FILE), {
        schemaVersion: 1,
        owner: OWNER,
        installRoot,
      });
      await replaceRelease(
        runtimePackage,
        path.join(temporaryRoot, ...config.releaseDirectory.split("/")),
      );
      await writePrivateJson(path.join(temporaryRoot, CONFIG_FILE), config);
      await writeStableLauncher(temporaryRoot);
      await rename(temporaryRoot, installRoot);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    return {
      alias: OWNED_RUNTIME_ALIAS,
      controller: STABLE_LAUNCHER,
      version: config.version,
      started: false,
    };
  }
  await chmod(installRoot, 0o700);
  const destination = path.join(installRoot, ...config.releaseDirectory.split("/"));
  await replaceRelease(runtimePackage, destination);
  if (previous !== undefined && JSON.stringify(previous.config) !== JSON.stringify(config)) {
    await writePrivateJson(path.join(installRoot, ROLLBACK_FILE), {
      schemaVersion: 1,
      owner: OWNER,
      config: previous.config,
    });
  }
  await writePrivateJson(path.join(installRoot, CONFIG_FILE), config);
  await writeStableLauncher(installRoot);
  return { alias: OWNED_RUNTIME_ALIAS, controller: STABLE_LAUNCHER, version: config.version, started: false };
}

export async function startRuntime(options, dependencies = {}) {
  const command = dependencies.runCommand ?? runCommand;
  const { root, config } = await loadOwnedState(options.installRoot);
  await validateStoredToolchainPaths(config);
  if (await requireExistingDirectory(config.bridgeRoot, "configured bridgeRoot") !== config.bridgeRoot) {
    throw new Error("configured bridgeRoot is no longer canonical");
  }
  if (await requireCredentialReference(config.runtimeApiKeyReference) !== config.runtimeApiKeyReference) {
    throw new Error("configured runtime API key reference is no longer canonical");
  }
  await validateToolchain(config, command);
  const profileDirectory = path.join(root, PRIVATE_DIRECTORY, "tunnel-profiles");
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await invokeTunnel(config, [
    "runtimes",
    "connect",
    "--alias",
    OWNED_RUNTIME_ALIAS,
    "--profile",
    OWNED_RUNTIME_PROFILE,
    "--profile-dir",
    profileDirectory,
    "--tunnel-id",
    config.tunnelId,
    "--mcp-command",
    mcpCommand(root, config),
    "--runtime-api-key",
    config.runtimeApiKeyReference,
    "--json",
  ], command, "connect");
  const status = await readTunnelStatus(config, command);
  if (!status.processRunning || !status.healthy || !status.ready) {
    throw new Error("owned tunnel runtime did not become process-running, healthy, and ready");
  }
  return status;
}

export async function statusRuntime(options, dependencies = {}) {
  const command = dependencies.runCommand ?? runCommand;
  const { config } = await loadOwnedState(options.installRoot);
  await validateStoredExecutable(config.tunnelClient, "configured tunnel-client");
  return readTunnelStatus(config, command);
}

export async function stopRuntime(options, dependencies = {}) {
  const command = dependencies.runCommand ?? runCommand;
  const { config } = await loadOwnedState(options.installRoot);
  await validateStoredExecutable(config.tunnelClient, "configured tunnel-client");
  await invokeTunnel(
    config,
    ["runtimes", "stop", OWNED_RUNTIME_ALIAS, "--json"],
    command,
    "stop",
  );
  return { alias: OWNED_RUNTIME_ALIAS, stopped: true };
}

export async function removeRuntime(options, dependencies = {}) {
  const command = dependencies.runCommand ?? runCommand;
  const { root, config } = await loadOwnedState(options.installRoot);
  await validateOwnedTree(root, config);
  await validateStoredExecutable(config.tunnelClient, "configured tunnel-client");
  await invokeTunnel(
    config,
    ["runtimes", "stop", OWNED_RUNTIME_ALIAS, "--json"],
    command,
    "stop",
  );
  await invokeTunnel(
    config,
    ["runtimes", "rm", OWNED_RUNTIME_ALIAS, "--json"],
    command,
    "remove metadata",
  );
  await validateOwnedTree(root, config);
  await rm(root, { recursive: true, force: false });
  return { alias: OWNED_RUNTIME_ALIAS, removed: true };
}

export async function rollbackRuntime(options, dependencies = {}) {
  const command = dependencies.runCommand ?? runCommand;
  const { root, config } = await loadOwnedState(options.installRoot);
  await validateOwnedTree(root, config);
  await validateStoredExecutable(config.tunnelClient, "configured tunnel-client");
  const rollback = await readOwnedJson(path.join(root, ROLLBACK_FILE), "runtime rollback state");
  if (
    JSON.stringify(Object.keys(rollback).sort()) !== JSON.stringify(["config", "owner", "schemaVersion"]) ||
    rollback.schemaVersion !== 1 ||
    rollback.owner !== OWNER
  ) {
    throw new Error("runtime rollback state is not owned by this lifecycle");
  }
  const restored = validateStoredConfig(
    requirePlainObject(rollback.config, "runtime rollback config"),
    root,
    "runtime rollback config",
  );
  await requireDirectoryEntry(
    path.join(root, ...restored.releaseDirectory.split("/")),
    "rollback release",
  );
  await invokeTunnel(
    config,
    ["runtimes", "stop", OWNED_RUNTIME_ALIAS, "--json"],
    command,
    "stop before rollback",
  );
  await writePrivateJson(path.join(root, ROLLBACK_FILE), {
    schemaVersion: 1,
    owner: OWNER,
    config,
  });
  await writePrivateJson(path.join(root, CONFIG_FILE), restored);
  return { alias: OWNED_RUNTIME_ALIAS, version: restored.version, started: false };
}
