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
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
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
const DEPENDENCY_INVENTORY_FILE = ".zotero-mcp-node-modules.json";
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

async function rejectSymlinkPathComponents(filename, label, { allowMissing = false } = {}) {
  const root = path.parse(filename).root;
  const segments = filename.slice(root.length).split(path.sep).filter(Boolean);
  let cursor = root;
  let missing = false;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (missing) continue;
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") {
        missing = true;
        continue;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new TypeError(`${label} must not contain a symlink path component`);
    }
  }
}

async function requireExistingDirectory(value, label, { rejectAncestorSymlinks = false } = {}) {
  const filename = requireAbsolutePath(value, label);
  if (rejectAncestorSymlinks) await rejectSymlinkPathComponents(filename, label);
  const info = await lstat(filename);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError(`${label} must be an existing non-symlink directory`);
  }
  const resolved = await realpath(filename);
  if (resolved === os.homedir()) throw new TypeError(`${label} cannot be the home directory`);
  return resolved;
}

async function canonicalPrivateRoot(value, label) {
  const requested = requireAbsolutePath(value, label);
  await rejectSymlinkPathComponents(requested, label, { allowMissing: true });
  let cursor = requested;
  const missing = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new TypeError(`${label} or its nearest existing parent must be a non-symlink directory`);
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
    throw new TypeError(`${label} cannot be a filesystem root or the home directory`);
  }
  return resolved;
}

async function canonicalInstallRoot(value) {
  return canonicalPrivateRoot(value, "installRoot");
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
  await rejectSymlinkPathComponents(filename, "runtime API key reference");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError("runtime API key reference must name a non-symlink file");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new TypeError("runtime API key reference must not be accessible to group or other users");
  }
  return `file:${await realpath(filename)}`;
}

function requireTunnelId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new TypeError("tunnelId must identify one existing tunnel");
  }
  return value;
}

function environmentPath(value, workingDirectory) {
  const cleaned = path.normalize(value.trim());
  return path.isAbsolute(cleaned) ? cleaned : path.resolve(workingDirectory, cleaned);
}

async function pinnedDirectoryExists(filename) {
  try {
    return (await stat(filename)).isDirectory();
  } catch {
    return false;
  }
}

async function resolvePinnedTunnelStateRoot(environment, workingDirectory = process.cwd()) {
  const explicit = environment.TUNNEL_CLIENT_STATE_DIR;
  let candidate;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    candidate = environmentPath(explicit, workingDirectory);
  } else {
    const legacyCandidates = [];
    const codexHome = environment.CODEX_HOME;
    if (typeof codexHome === "string" && codexHome.trim() !== "") {
      legacyCandidates.push(path.join(environmentPath(codexHome, workingDirectory), "tunnel-mcp"));
    }
    const configuredHome = environment.HOME;
    if (typeof configuredHome === "string" && configuredHome.trim() !== "") {
      const home = environmentPath(configuredHome, workingDirectory);
      legacyCandidates.push(
        path.join(home, ".codex", "tunnel-mcp"),
        path.join(home, ".tunnel-client"),
      );
    }
    for (const legacy of legacyCandidates) {
      if (await pinnedDirectoryExists(legacy)) {
        candidate = legacy;
        break;
      }
    }
    if (candidate === undefined) {
      const xdgStateHome = environment.XDG_STATE_HOME;
      if (typeof xdgStateHome === "string" && xdgStateHome.trim() !== "") {
        candidate = path.join(environmentPath(xdgStateHome, workingDirectory), "tunnel-client");
      } else {
        const home = typeof configuredHome === "string" && configuredHome.trim() !== ""
          ? environmentPath(configuredHome, workingDirectory)
          : os.homedir();
        candidate = process.platform === "darwin"
          ? path.join(home, "Library", "Application Support", "tunnel-client")
          : path.join(home, ".local", "state", "tunnel-client");
      }
    }
  }
  return canonicalPrivateRoot(candidate, "tunnel control root");
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function pathIsInside(filename, directory) {
  return filename === directory || filename.startsWith(`${directory}${path.sep}`);
}

function requireSeparatedPrivatePaths({
  installRoot,
  bridgeRoot,
  tunnelStateRoot,
  credentialReference,
  independentNode,
  tunnelClient,
}) {
  if (pathsOverlap(installRoot, bridgeRoot)) {
    throw new TypeError("installRoot and bridgeRoot must be separate directories");
  }
  if (pathsOverlap(installRoot, tunnelStateRoot) || pathsOverlap(bridgeRoot, tunnelStateRoot)) {
    throw new TypeError("installRoot and bridgeRoot must stay outside the tunnel control root");
  }
  const credential = credentialReference.slice("file:".length);
  for (const root of [installRoot, bridgeRoot, tunnelStateRoot]) {
    if (pathIsInside(credential, root)) {
      throw new TypeError("runtime API key reference must stay outside owned data and tunnel control roots");
    }
  }
  for (const executable of [independentNode, tunnelClient]) {
    if (pathIsInside(executable, installRoot) || pathIsInside(executable, bridgeRoot)) {
      throw new TypeError("runtime executables must stay outside owned data roots");
    }
  }
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

async function dependencyInventory(directory, prefix = "") {
  const current = path.join(directory, ...prefix.split("/").filter(Boolean));
  const entries = [];
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const filename = path.join(directory, ...relative.split("/"));
    if (entry.isSymbolicLink()) {
      const target = await readlink(filename);
      const resolvedTarget = path.resolve(path.dirname(filename), target);
      if (
        path.isAbsolute(target) ||
        (resolvedTarget !== directory && !resolvedTarget.startsWith(`${directory}${path.sep}`))
      ) {
        throw new Error(`owned dependencies contain an escaping symlink at ${relative}`);
      }
      entries.push({ path: relative, type: "symlink", target });
    } else if (entry.isDirectory()) {
      entries.push({ path: relative, type: "directory" });
      entries.push(...await dependencyInventory(directory, relative));
    } else if (entry.isFile()) {
      entries.push({ path: relative, type: "file" });
    } else {
      throw new Error(`owned dependencies contain an unsupported entry at ${relative}`);
    }
  }
  return entries;
}

async function writeDependencyInventory(releaseRoot) {
  await writePrivateJson(path.join(releaseRoot, DEPENDENCY_INVENTORY_FILE), {
    schemaVersion: 1,
    owner: OWNER,
    entries: await dependencyInventory(path.join(releaseRoot, "node_modules")),
  });
}

async function validateDependencyInventory(releaseRoot) {
  const inventory = await readOwnedJson(
    path.join(releaseRoot, DEPENDENCY_INVENTORY_FILE),
    "installed dependency inventory",
  );
  if (
    JSON.stringify(Object.keys(inventory).sort()) !==
      JSON.stringify(["entries", "owner", "schemaVersion"]) ||
    inventory.schemaVersion !== 1 ||
    inventory.owner !== OWNER ||
    !Array.isArray(inventory.entries)
  ) {
    throw new Error("installed dependency inventory is not owned by this lifecycle");
  }
  const actual = await dependencyInventory(path.join(releaseRoot, "node_modules"));
  if (JSON.stringify(actual) !== JSON.stringify(inventory.entries)) {
    throw new Error("installed dependency inventory contains an unknown or changed entry");
  }
}

async function validateReleaseLayout(directory, members, prefix = "", { installed = false } = {}) {
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
    if (prefix === "" && installed && relative === DEPENDENCY_INVENTORY_FILE) {
      if (!entry.isFile()) throw new Error("installed dependency inventory must be a regular file");
      continue;
    }
    if (relative === "node_modules") {
      if (!entry.isDirectory()) throw new Error("owned release node_modules must be a directory");
      continue;
    }
    if (entry.isDirectory()) {
      if (!allowedDirectories.has(relative)) {
        throw new Error(`owned release contains an unknown directory at ${relative}`);
      }
      await validateReleaseLayout(directory, members, relative, { installed });
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

async function validateReleaseFiles(root, metadata, { verifyHashes, installed = false }) {
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
  const ignored = new Set(["node_modules"]);
  if (installed) ignored.add(DEPENDENCY_INVENTORY_FILE);
  const actual = await listedFiles(root, "", ignored);
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...members].sort())) {
    throw new Error("server release contains files outside its owned inventory");
  }
  await validateReleaseLayout(root, members, "", { installed });
  if (installed) await validateDependencyInventory(root);
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
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function requireDirectory(filename) {
  const info = await lstat(filename);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe installed runtime path");
}

async function requireFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe installed runtime path");
}

try {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const privateRoot = path.join(root, "private");
  const configFile = path.join(privateRoot, "config.json");
  await requireDirectory(root);
  await requireDirectory(privateRoot);
  await requireFile(configFile);
  const config = JSON.parse(await readFile(configFile, "utf8"));
  if (
    config.owner !== "zotero-study-save-mcp-runtime" ||
    config.installRoot !== root ||
    typeof config.version !== "string" ||
    !/^\\d+\\.\\d+\\.\\d+(?:[.-][0-9A-Za-z.-]+)?$/u.test(config.version) ||
    config.releaseDirectory !== \`releases/\${config.version}\`
  ) {
    throw new Error("installed Zotero MCP configuration is invalid");
  }
  const releasesRoot = path.join(root, "releases");
  const releaseRoot = path.join(releasesRoot, config.version);
  const integrationRoot = path.join(releaseRoot, "integration");
  const packageRoot = path.join(integrationRoot, "zotero-mcp");
  const entry = path.join(packageRoot, "lifecycle.mjs");
  for (const directory of [releasesRoot, releaseRoot, integrationRoot, packageRoot]) {
    await requireDirectory(directory);
  }
  await requireFile(entry);
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

export async function runCommand(executable, args, { env = process.env } = {}) {
  const child = spawn(executable, args, {
    env,
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

function tunnelEnvironment(config, environment = process.env) {
  return { ...environment, TUNNEL_CLIENT_STATE_DIR: config.tunnelStateRoot };
}

async function validateToolchain(config, command, environment = process.env) {
  const commandOptions = { env: tunnelEnvironment(config, environment) };
  const nodeVersion = await command(config.independentNode, ["--version"], commandOptions);
  if (nodeVersion.code !== 0 || !/^v(?:24|25|26)\./u.test(nodeVersion.stdout.trim())) {
    throw new Error("independent Node must report a supported 24–26 version");
  }
  const tunnelVersion = await command(config.tunnelClient, ["--version"], commandOptions);
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
      verbatimSymlinks: true,
    });
    await writeDependencyInventory(temporary);
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
    const members = await validateReleaseFiles(destination, metadata, {
      verifyHashes: false,
      installed: true,
    });
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
    "tunnelStateRoot",
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
  const independentNode = requireAbsolutePath(config.independentNode, `${label} independent Node`);
  const tunnelClient = requireAbsolutePath(config.tunnelClient, `${label} tunnel-client`);
  const tunnelStateRoot = requireAbsolutePath(config.tunnelStateRoot, `${label} tunnel control root`);
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
    config.releaseDirectory !== releaseRelative(version)
  ) {
    throw new Error(`${label} is not an owned route`);
  }
  requireSeparatedPrivatePaths({
    installRoot: root,
    bridgeRoot,
    tunnelStateRoot,
    credentialReference: config.runtimeApiKeyReference,
    independentNode,
    tunnelClient,
  });
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
  await rejectSymlinkPathComponents(path.join(root, CONFIG_FILE), "private runtime config");
  const config = await readOwnedJson(path.join(root, CONFIG_FILE), "private runtime config");
  validateStoredConfig(config, root, "private runtime config");
  if (
    await canonicalPrivateRoot(config.tunnelStateRoot, "configured tunnel control root") !==
      config.tunnelStateRoot
  ) {
    throw new Error("configured tunnel control root is no longer canonical");
  }
  return { root, config };
}

async function requireDirectoryEntry(filename, label) {
  const info = await lstat(filename);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be an owned non-symlink directory`);
  }
}

async function validateTunnelProfileDirectory(privateRoot) {
  const profileRoot = path.join(privateRoot, "tunnel-profiles");
  let info;
  try {
    info = await lstat(profileRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("tunnel profile directory must be an owned non-symlink directory");
  }
  const expectedProfile = `${OWNED_RUNTIME_PROFILE}.yaml`;
  const names = (await readdir(profileRoot)).sort();
  requireExactOrOptionalNames(names, [], [expectedProfile], "tunnel profile directory");
  if (names.includes(expectedProfile)) {
    const profile = await lstat(path.join(profileRoot, expectedProfile));
    if (!profile.isFile() || profile.isSymbolicLink()) {
      throw new Error("owned tunnel profile must be a regular file");
    }
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
    await validateTunnelProfileDirectory(privateRoot);
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
    await validateReleaseFiles(releaseRoot, metadata, { verifyHashes: false, installed: true });
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
  const result = await command(
    config.tunnelClient,
    [...args, ...tunnelBaseArgs(config)],
    { env: tunnelEnvironment(config) },
  );
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
  const environment = dependencies.environment ?? process.env;
  requirePlainObject(environment, "lifecycle environment");
  const runtimePackage = await loadPackage(options.sourceRoot);
  const installRoot = await canonicalInstallRoot(options.installRoot);
  const bridgeRoot = await requireExistingDirectory(options.bridgeRoot, "bridgeRoot", {
    rejectAncestorSymlinks: true,
  });
  const independentNode = await requireExecutable(options.independentNode, "independentNode");
  const tunnelClient = await requireExecutable(options.tunnelClient, "tunnelClient");
  const runtimeApiKeyReference = await requireCredentialReference(options.runtimeApiKeyReference);
  const tunnelStateRoot = await resolvePinnedTunnelStateRoot(environment);
  requireSeparatedPrivatePaths({
    installRoot,
    bridgeRoot,
    tunnelStateRoot,
    credentialReference: runtimeApiKeyReference,
    independentNode,
    tunnelClient,
  });
  const config = {
    schemaVersion: 1,
    owner: OWNER,
    installRoot,
    version: runtimePackage.metadata.version,
    releaseDirectory: releaseRelative(runtimePackage.metadata.version),
    bridgeRoot,
    independentNode,
    tunnelClient,
    tunnelId: requireTunnelId(options.tunnelId),
    tunnelStateRoot,
    runtimeApiKeyReference,
    alias: OWNED_RUNTIME_ALIAS,
    profile: OWNED_RUNTIME_PROFILE,
    controlPlaneBaseUrl: optionalControlPlaneBaseUrl(options.controlPlaneBaseUrl),
    controlPlaneUrlPath: optionalControlPlaneUrlPath(options.controlPlaneUrlPath),
  };
  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }
  await validateToolchain(config, command, environment);

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
  if (await requireExistingDirectory(config.bridgeRoot, "configured bridgeRoot", {
    rejectAncestorSymlinks: true,
  }) !== config.bridgeRoot) {
    throw new Error("configured bridgeRoot is no longer canonical");
  }
  if (await requireCredentialReference(config.runtimeApiKeyReference) !== config.runtimeApiKeyReference) {
    throw new Error("configured runtime API key reference is no longer canonical");
  }
  await validateToolchain(config, command);
  const profileDirectory = path.join(root, PRIVATE_DIRECTORY, "tunnel-profiles");
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await validateTunnelProfileDirectory(path.join(root, PRIVATE_DIRECTORY));
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
  await validateTunnelProfileDirectory(path.join(root, PRIVATE_DIRECTORY));
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
