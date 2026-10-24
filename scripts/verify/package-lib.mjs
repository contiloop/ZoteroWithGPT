import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const UNZIP_PATH = "/usr/bin/unzip";
const ARCHIVE_PREFIX = "zotero-ai-research-companion";
const PLUGIN_ARCHIVE_PREFIX = "zotero-study-save";
const SERVER_ARCHIVE_PREFIX = "zotero-mcp-server";
const MANUAL_UPDATE_SENTINEL =
  "https://updates.invalid/zotero-ai-research-companion/updates.json";
const REQUIRED_MEMBERS = Object.freeze([
  "bootstrap.js",
  "BUILD_METADATA.json",
  "client/README.md",
  "companion.js",
  "docs/install.md",
  "docs/troubleshooting.md",
  "docs/uninstall.md",
  "manifest.json",
  "prefs.js",
  "protocol/examples/connection-status.request.json",
  "protocol/examples/connection-status.response.json",
  "protocol/examples/create-annotation.request.json",
  "protocol/examples/create-annotation.response.json",
  "protocol/examples/create-note.request.json",
  "protocol/examples/find-local-arxiv.request.json",
  "protocol/examples/find-local-arxiv.response.json",
  "protocol/examples/read-pdf.request.json",
  "protocol/v1-request.schema.json",
  "protocol/v1-response.schema.json",
  "protocol/v1.md",
  "THIRD_PARTY_NOTICES",
]);
const REQUIRED_CLIENT_MEMBERS = Object.freeze([
  "README.md",
  "docs/install.md",
  "docs/troubleshooting.md",
  "docs/uninstall.md",
  "protocol/examples/connection-status.request.json",
  "protocol/examples/connection-status.response.json",
  "protocol/examples/create-annotation.request.json",
  "protocol/examples/create-annotation.response.json",
  "protocol/examples/create-note.request.json",
  "protocol/examples/find-local-arxiv.request.json",
  "protocol/examples/find-local-arxiv.response.json",
  "protocol/examples/read-pdf.request.json",
  "protocol/v1-request.schema.json",
  "protocol/v1-response.schema.json",
  "protocol/v1.md",
]);
const OPERATIONS = new Set([
  "connection_status",
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
  "inspect_arxiv",
  "ensure_arxiv_pdf",
  "find_local_arxiv",
]);
const MUTATIONS = new Set([
  "create_annotation",
  "update_annotation",
  "create_note",
  "update_note",
  "ensure_arxiv_pdf",
]);
const PRIVATE_OR_DEVELOPMENT_PATTERN =
  /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|\.dryforge(?:\/|\\)|devplaceholder|developer-owned-native-fixture|ZOTERO_AI_RESEARCH_COMPANION_OWNED_NATIVE_FIXTURE_V1)/u;
const SECRET_PATTERN =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\btunnel[_ -]?key\s*[:=]\s*[^<\s]+)/iu;
const ACCOUNT_APP_ID_PATTERN =
  /\b(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]{7,}\b/u;
const PORTABLE_PLUGIN_MEMBERS = Object.freeze([
  "README.md",
  "plugin.json",
  "skills/zotero-study-save/SKILL.md",
  "skills/zotero-study-save/agents/openai.yaml",
  "skills/zotero-study-save/resources/workflow.md",
]);
const EXPECTED_SERVER_DEPENDENCIES = Object.freeze({
  "@modelcontextprotocol/sdk": "1.32.2",
  dompurify: "3.4.17",
  jsdom: "29.1.1",
});
const EXPECTED_MCP_TOOLS = Object.freeze([
  "zotero_connection_status",
  "zotero_find_local_arxiv",
  "zotero_search_papers",
  "zotero_read_pdf",
  "zotero_list_annotations",
  "zotero_list_notes",
  "zotero_read_note",
  "zotero_resolve_anchor",
  "zotero_create_annotation",
  "zotero_update_annotation",
  "zotero_create_note",
  "zotero_update_note",
  "zotero_verify_annotation",
  "zotero_get_operation_result",
]);

async function run(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let standardOutput = "";
  let standardError = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { standardOutput += chunk; });
  child.stderr.on("data", (chunk) => { standardError += chunk; });
  const [exitCode] = await once(child, "close");
  if (exitCode !== 0) {
    throw new Error(`${path.basename(command)} exited ${String(exitCode)}: ${standardError.trim()}`);
  }
  return standardOutput;
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Package contains an unsupported filesystem entry: ${relative}`);
  }
  return files.sort();
}

function validateMemberNames(members) {
  const seen = new Set();
  for (const member of members) {
    if (
      member.length === 0 ||
      member.startsWith("/") ||
      member.includes("\\") ||
      member.split("/").includes("..")
    ) {
      throw new Error(`XPI contains an unsafe member name: ${member}`);
    }
    if (seen.has(member)) throw new Error(`XPI contains duplicate member ${member}`);
    seen.add(member);
  }
  for (const required of REQUIRED_MEMBERS) {
    if (!seen.has(required)) throw new Error(`XPI is missing ${required}`);
  }
  const expectedProtocolMembers = REQUIRED_MEMBERS
    .filter((member) => member.startsWith("protocol/"))
    .sort();
  const actualProtocolMembers = members
    .filter((member) => member.startsWith("protocol/"))
    .sort();
  if (JSON.stringify(actualProtocolMembers) !== JSON.stringify(expectedProtocolMembers)) {
    throw new Error("XPI protocol resources do not match the exact release allowlist");
  }
  const unwanted = members.find((member) =>
    member.endsWith(".map") || member.endsWith(".ts") || member.startsWith("src/"));
  if (unwanted !== undefined) throw new Error(`XPI contains development source ${unwanted}`);
}

function validateText(content, member) {
  if (PRIVATE_OR_DEVELOPMENT_PATTERN.test(content)) {
    throw new Error(`${member} contains a private or development-specific path or marker`);
  }
  if (SECRET_PATTERN.test(content)) throw new Error(`${member} appears to contain a secret`);
  if (ACCOUNT_APP_ID_PATTERN.test(content)) {
    throw new Error(`${member} contains a private account app id`);
  }
}

function validateExample(value, filename) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename} must contain a JSON object`);
  }
  if (value.protocolVersion !== 1) throw new Error(`${filename} must use protocolVersion 1`);
  if (
    typeof value.operationId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.operationId)
  ) {
    throw new Error(`${filename} has an invalid operationId`);
  }
  if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) {
    throw new Error(`${filename} has an unsupported operation`);
  }
  if (value.operation !== "connection_status" && typeof value.profileId !== "string") {
    throw new Error(`${filename} must identify a profile`);
  }
  if (MUTATIONS.has(value.operation)) {
    if (
      value.authorization === null ||
      typeof value.authorization !== "object" ||
      !["explicit_request", "approved_proposal"].includes(value.authorization.kind) ||
      typeof value.authorization.scope !== "string" ||
      value.authorization.scope.trim().length === 0
    ) {
      throw new Error(`${filename} lacks mutation authorization metadata`);
    }
  } else if ("authorization" in value) {
    throw new Error(`${filename} adds authorization to a read operation`);
  }
  if (value.payload === null || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    throw new Error(`${filename} must contain an object payload`);
  }
}

function validateResponseExample(value, filename) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename} must contain a JSON object`);
  }
  if (value.protocolVersion !== 1) throw new Error(`${filename} must use protocolVersion 1`);
  if (
    typeof value.operationId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.operationId)
  ) {
    throw new Error(`${filename} has an invalid operationId`);
  }
  if (!["queued", "running", "succeeded", "rejected", "failed", "indeterminate"].includes(value.state)) {
    throw new Error(`${filename} has an invalid operation state`);
  }
  if (value.verification === null || typeof value.verification !== "object") {
    throw new Error(`${filename} lacks verification evidence`);
  }
}

export function createProtocolSchemaValidators(requestSchema, responseSchema) {
  // The authored schemas intentionally apply unevaluatedProperties to a
  // oneOf-composed root without a redundant root type declaration.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
  });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "x-maxUtf8Bytes",
    type: "string",
    schemaType: "number",
    validate: (maximum, value) => Buffer.byteLength(value, "utf8") <= maximum,
  });
  return {
    request: ajv.compile(requestSchema),
    response: ajv.compile(responseSchema),
  };
}

function requireSchemaValid(validate, value, filename) {
  if (!validate(value)) {
    throw new Error(`${filename} fails its Draft 2020-12 schema: ${JSON.stringify(validate.errors)}`);
  }
}

function validateBootstrap(source) {
  for (const name of [
    "startup",
    "shutdown",
    "install",
    "uninstall",
    "onMainWindowLoad",
    "onMainWindowUnload",
  ]) {
    if (!new RegExp(`\\bfunction\\s+${name}\\b`, "u").test(source)) {
      throw new Error(`bootstrap.js does not declare ${name}`);
    }
  }
  if (!source.includes("companion.js") || !source.includes("ResearchCompanion")) {
    throw new Error("bootstrap.js does not load the ResearchCompanion entry bundle");
  }
}

function validateBundle(source) {
  if (!source.includes("ResearchCompanion")) {
    throw new Error("companion.js does not expose ResearchCompanion");
  }
  if (
    /(?:\bfrom\s*|\brequire\s*\(\s*)["'](?:node:|fs["'/]|path["'/]|child_process["'])/u.test(source)
  ) {
    throw new Error("companion.js contains a Node.js runtime import");
  }
}

function validateManifest(manifest, expectedVersion) {
  if (manifest.version !== expectedVersion) {
    throw new Error(`manifest version ${String(manifest.version)} does not match ${expectedVersion}`);
  }
  const zotero = manifest.applications?.zotero;
  if (zotero?.strict_min_version !== "10.0.6" || zotero?.strict_max_version !== "10.0.*") {
    throw new Error("manifest must target Zotero 10.0.6 through 10.0.*");
  }
  if ("update_url" in manifest || zotero?.update_url !== MANUAL_UPDATE_SENTINEL) {
    throw new Error(
      `manifest must declare the reserved manual-update sentinel ${MANUAL_UPDATE_SENTINEL}`,
    );
  }
}

function noticePackageIdentities(notices) {
  const identities = new Set();
  for (const line of notices.split(/\r?\n/u)) {
    if (!line.startsWith("Package:")) continue;
    const match = line.match(/^Package: ([^\s]+@[^\s]+)$/u);
    if (match === null) throw new Error(`Invalid THIRD_PARTY_NOTICES package identity: ${line}`);
    if (identities.has(match[1])) {
      throw new Error(`Duplicate THIRD_PARTY_NOTICES package identity: ${match[1]}`);
    }
    identities.add(match[1]);
  }
  return identities;
}

function validateThirdParty(metadata, notices, members) {
  if (metadata.projectLicense !== null) {
    throw new Error("BUILD_METADATA.json invents a project license");
  }
  if (metadata.distribution !== "manual") {
    throw new Error("BUILD_METADATA.json must identify manual distribution");
  }
  if (
    metadata.updatePolicy?.service !== false ||
    metadata.updatePolicy?.manifestSentinel !== MANUAL_UPDATE_SENTINEL
  ) {
    throw new Error("BUILD_METADATA.json must identify the reserved no-service update sentinel");
  }
  if (metadata.recipe?.preserveSymlinks !== true) {
    throw new Error("BUILD_METADATA.json must preserve dependency symlink paths");
  }
  if (!Array.isArray(metadata.runtimePackages)) {
    throw new Error("BUILD_METADATA.json lacks runtimePackages");
  }
  if (metadata.runtimePackages.some((dependency) =>
    dependency?.name === "ajv" || dependency?.name === "ajv-formats")) {
    throw new Error("The development-only protocol schema validator was bundled into the XPI");
  }
  const noticedPackages = noticePackageIdentities(notices);
  for (const dependency of metadata.runtimePackages) {
    if (
      typeof dependency.name !== "string" ||
      typeof dependency.version !== "string" ||
      typeof dependency.license !== "string"
    ) {
      throw new Error("BUILD_METADATA.json contains invalid runtime package metadata");
    }
    const noticeIdentity = `${dependency.name}@${dependency.version}`;
    if (!noticedPackages.has(noticeIdentity)) {
      throw new Error(`THIRD_PARTY_NOTICES omits ${noticeIdentity}`);
    }
    const licensePrefix = `third-party-licenses/${dependency.name.replaceAll("/", "__")}/`;
    if (!members.some((member) => member.startsWith(licensePrefix))) {
      throw new Error(`XPI omits the license text for ${dependency.name} ${dependency.version}`);
    }
  }
}

async function validateClientKit(clientDirectory, extractedXpi, version) {
  let info;
  try {
    info = await stat(clientDirectory);
  } catch {
    throw new Error(`Release is missing client sidecar ${path.basename(clientDirectory)}`);
  }
  if (!info.isDirectory()) throw new Error("Client sidecar path is not a directory");
  const members = await listFiles(clientDirectory);
  if (JSON.stringify(members) !== JSON.stringify([...REQUIRED_CLIENT_MEMBERS].sort())) {
    throw new Error("Client sidecar does not contain the exact documented release files");
  }
  for (const member of members) {
    const content = await readFile(path.join(clientDirectory, ...member.split("/")), "utf8");
    validateText(content, `client sidecar ${member}`);
    const xpiMember = member === "README.md" ? "client/README.md" : member;
    const packaged = await readFile(path.join(extractedXpi, ...xpiMember.split("/")), "utf8");
    if (content !== packaged) {
      throw new Error(`Client sidecar ${member} differs from the XPI`);
    }
  }
  const readme = await readFile(path.join(clientDirectory, "README.md"), "utf8");
  if (
    !readme.includes(`Package version: \`${version}\``) ||
    !readme.includes("protocol/v1.md") ||
    readme.includes("{{PACKAGE_VERSION}}")
  ) {
    throw new Error("Client sidecar README lacks its version or protocol reference");
  }
  return members;
}

async function validatePortablePlugin(pluginPath, version) {
  if (path.basename(pluginPath) !== `${PLUGIN_ARCHIVE_PREFIX}-${version}.zip`) {
    throw new Error("Portable plugin filename does not match its release version");
  }
  const listed = (await run(UNZIP_PATH, ["-Z1", pluginPath]))
    .split(/\r?\n/u)
    .filter((member) => member.length > 0);
  if (JSON.stringify(listed) !== JSON.stringify(PORTABLE_PLUGIN_MEMBERS)) {
    throw new Error("Portable plugin does not contain its exact documented allowlist");
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "study-save-plugin-verify-"));
  try {
    await run(UNZIP_PATH, ["-qq", pluginPath, "-d", temporaryDirectory]);
    const extracted = await listFiles(temporaryDirectory);
    if (JSON.stringify(extracted) !== JSON.stringify(PORTABLE_PLUGIN_MEMBERS)) {
      throw new Error("Extracted portable plugin members do not match its central directory");
    }
    for (const member of extracted) {
      validateText(await readFile(path.join(temporaryDirectory, ...member.split("/")), "utf8"),
        `portable plugin ${member}`);
    }
    const manifest = JSON.parse(await readFile(path.join(temporaryDirectory, "plugin.json"), "utf8"));
    if (manifest.name !== "zotero-study-save" || manifest.version !== version) {
      throw new Error("Portable plugin identity or version does not match the release");
    }
    if (
      Object.keys(manifest.extensions ?? {}).join(",") !== "com.openai" ||
      Object.keys(manifest.extensions?.["com.openai"] ?? {}).join(",") !== "interface" ||
      Object.hasOwn(manifest.extensions?.["com.openai"] ?? {}, "apps")
    ) {
      throw new Error("Portable plugin must be explicitly unconfigured and omit apps");
    }
    return extracted;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function validateServerPackage(serverPath, version) {
  if (path.basename(serverPath) !== `${SERVER_ARCHIVE_PREFIX}-${version}.zip`) {
    throw new Error("MCP server filename does not match its release version");
  }
  const listed = (await run(UNZIP_PATH, ["-Z1", serverPath]))
    .split(/\r?\n/u)
    .filter(Boolean);
  const seen = new Set();
  for (const member of listed) {
    if (
      member.startsWith("/") ||
      member.includes("\\") ||
      member.split("/").some(segment => segment === "" || segment === "." || segment === "..") ||
      seen.has(member)
    ) {
      throw new Error(`MCP server archive contains unsafe or duplicate member ${member}`);
    }
    seen.add(member);
    if (
      member.includes("/tests/") ||
      member.startsWith("tests/") ||
      member.includes("node_modules/") ||
      member.includes("/.cache/") ||
      member.startsWith(".cache/") ||
      member.endsWith(".map")
    ) {
      throw new Error(`MCP server archive contains non-runtime member ${member}`);
    }
  }
  for (const required of [
    "SERVER_BUILD_METADATA.json",
    "THIRD_PARTY_NOTICES",
    "package.json",
    "package-lock.json",
    "integration/zotero-mcp/server.mjs",
    "integration/zotero-mcp/lifecycle.mjs",
    "scripts/package/configure-plugin.mjs",
    "scripts/package/configure-plugin-lib.mjs",
    "scripts/package/assets/protocol/v1-request.schema.json",
    "scripts/package/assets/protocol/v1-response.schema.json",
  ]) {
    if (!seen.has(required)) throw new Error(`MCP server archive is missing ${required}`);
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "zotero-mcp-server-verify-"));
  try {
    await run(UNZIP_PATH, ["-qq", serverPath, "-d", temporaryDirectory]);
    const extracted = await listFiles(temporaryDirectory);
    if (!sameJson(extracted, [...listed].sort())) {
      throw new Error("Extracted MCP server members do not match its central directory");
    }
    for (const member of extracted) {
      validateText(
        await readFile(path.join(temporaryDirectory, ...member.split("/")), "utf8"),
        `MCP server ${member}`,
      );
    }
    const metadata = JSON.parse(await readFile(
      path.join(temporaryDirectory, "SERVER_BUILD_METADATA.json"),
      "utf8",
    ));
    if (
      metadata.schemaVersion !== 1 ||
      metadata.owner !== "zotero-study-save-mcp-runtime" ||
      metadata.version !== version ||
      metadata.projectLicense !== null ||
      metadata.artifact !== path.basename(serverPath) ||
      !sameJson(metadata.members, extracted)
    ) {
      throw new Error("MCP server build metadata does not describe the exact archive");
    }
    const hashedMembers = extracted.filter(member => member !== "SERVER_BUILD_METADATA.json");
    if (!sameJson(Object.keys(metadata.memberSha256 ?? {}), hashedMembers)) {
      throw new Error("MCP server build metadata lacks the exact member hash inventory");
    }
    for (const member of hashedMembers) {
      const digest = createHash("sha256")
        .update(await readFile(path.join(temporaryDirectory, ...member.split("/"))))
        .digest("hex");
      if (metadata.memberSha256[member] !== digest) {
        throw new Error(`MCP server member hash differs for ${member}`);
      }
    }
    if (
      metadata.runtime?.node !== ">=24 <27" ||
      metadata.runtime?.npm !== "11.4.2" ||
      metadata.runtime?.install !== "npm ci --omit=dev --ignore-scripts" ||
      !sameJson(metadata.directDependencies, EXPECTED_SERVER_DEPENDENCIES)
    ) {
      throw new Error("MCP server runtime requirements or direct dependencies changed");
    }
    const packageMetadata = JSON.parse(await readFile(
      path.join(temporaryDirectory, "package.json"),
      "utf8",
    ));
    const lockText = await readFile(path.join(temporaryDirectory, "package-lock.json"), "utf8");
    const lock = JSON.parse(lockText);
    if (
      packageMetadata.version !== version ||
      packageMetadata.packageManager !== "npm@11.4.2" ||
      packageMetadata.engines?.node !== ">=24 <27" ||
      !sameJson(packageMetadata.dependencies, EXPECTED_SERVER_DEPENDENCIES) ||
      packageMetadata.bin?.["zotero-mcp"] !== "integration/zotero-mcp/server.mjs" ||
      packageMetadata.bin?.["zotero-mcp-lifecycle"] !== "integration/zotero-mcp/lifecycle.mjs" ||
      lock.version !== version ||
      lock.packages?.[""]?.version !== version ||
      !sameJson(lock.packages?.[""]?.dependencies, EXPECTED_SERVER_DEPENDENCIES)
    ) {
      throw new Error("MCP server package and production lock are not release-aligned");
    }
    const lockHash = createHash("sha256").update(lockText).digest("hex");
    if (metadata.lockSha256 !== lockHash) {
      throw new Error("MCP server lock hash does not match its build metadata");
    }
    const lockedPackages = Object.entries(lock.packages ?? {})
      .filter(([lockPath]) => lockPath !== "")
      .map(([lockPath, dependency]) => ({
        name: lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u)?.[1],
        version: dependency.version,
        license: dependency.license,
      }));
    if (
      lockedPackages.some(entry =>
        typeof entry.name !== "string" ||
        typeof entry.version !== "string" ||
        typeof entry.license !== "string" ||
        entry.license.length === 0) ||
      !sameJson(metadata.lockedPackages, lockedPackages)
    ) {
      throw new Error("MCP server locked dependency license inventory is incomplete");
    }
    const noticeIdentities = noticePackageIdentities(
      await readFile(path.join(temporaryDirectory, "THIRD_PARTY_NOTICES"), "utf8"),
    );
    for (const dependency of lockedPackages) {
      if (!noticeIdentities.has(`${dependency.name}@${dependency.version}`)) {
        throw new Error(`MCP server notices omit ${dependency.name}@${dependency.version}`);
      }
    }
    return extracted;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const RELOCATED_SMOKE_SOURCE = `
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const expected = ${JSON.stringify(EXPECTED_MCP_TOOLS)};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["integration/zotero-mcp/server.mjs"],
  cwd: process.cwd(),
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ZOTERO_MCP_BRIDGE_ROOT: process.env.ZOTERO_MCP_SMOKE_BRIDGE_ROOT,
  },
  stderr: "pipe",
  maxBufferSize: 10 * 1024 * 1024,
});
let stderr = "";
transport.stderr?.setEncoding("utf8");
transport.stderr?.on("data", chunk => { stderr += chunk; });
const client = new Client({ name: "relocated-package-smoke", version: "1.0.0" });
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("smoke timeout")), 20000));
try {
  const listed = await Promise.race([
    (async () => { await client.connect(transport); return client.listTools(); })(),
    timeout,
  ]);
  const names = listed.tools.map(tool => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("tool inventory mismatch");
  await client.close();
  if (stderr !== "") throw new Error("server wrote to stderr");
  process.stdout.write(JSON.stringify({ initialized: true, tools: names.length }));
} catch (error) {
  await client.close().catch(() => {});
  throw error;
}
`;

export async function verifyRelocatedServer(serverPath, {
  npmExecutable = "npm",
  nodeExecutable = process.execPath,
} = {}) {
  const archive = path.resolve(serverPath);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "zotero-mcp-relocated-"));
  const packageRoot = path.join(temporaryDirectory, "relocated package");
  const bridgeRoot = path.join(temporaryDirectory, "empty bridge");
  try {
    await run(UNZIP_PATH, ["-qq", archive, "-d", packageRoot]);
    const npmVersion = (await run(npmExecutable, ["--version"])).trim();
    if (npmVersion !== "11.4.2") throw new Error("relocated verification requires npm 11.4.2");
    const nodeVersion = (await run(nodeExecutable, ["--version"])).trim();
    if (!/^v(?:24|25|26)\./u.test(nodeVersion)) {
      throw new Error("relocated verification requires Node.js 24–26");
    }
    await run(npmExecutable, ["ci", "--omit=dev", "--ignore-scripts"], { cwd: packageRoot });
    await mkdir(bridgeRoot, { recursive: true });
    const output = await run(nodeExecutable, ["--input-type=module", "--eval", RELOCATED_SMOKE_SOURCE], {
      cwd: packageRoot,
      env: { ...process.env, ZOTERO_MCP_SMOKE_BRIDGE_ROOT: bridgeRoot },
    });
    const result = JSON.parse(output);
    if (result.initialized !== true || result.tools !== EXPECTED_MCP_TOOLS.length) {
      throw new Error("relocated MCP smoke did not initialize all tools");
    }
    return result;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function verifyXpi(xpiPath, { expectedProjectRoot } = {}) {
  const archive = path.resolve(xpiPath);
  if (!(await stat(archive)).isFile()) throw new Error("XPI path is not a file");
  const listed = (await run(UNZIP_PATH, ["-Z1", archive]))
    .split(/\r?\n/u)
    .filter((member) => member.length > 0);
  validateMemberNames(listed);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "research-companion-verify-"));
  try {
    await run(UNZIP_PATH, ["-qq", archive, "-d", temporaryDirectory]);
    const extracted = await listFiles(temporaryDirectory);
    if (JSON.stringify(extracted) !== JSON.stringify([...listed].sort())) {
      throw new Error("Extracted XPI members do not match its central directory");
    }
    for (const member of extracted) {
      const content = await readFile(path.join(temporaryDirectory, ...member.split("/")), "utf8");
      validateText(content, member);
    }

    const metadata = JSON.parse(await readFile(
      path.join(temporaryDirectory, "BUILD_METADATA.json"),
      "utf8",
    ));
    const version = metadata.version;
    if (typeof version !== "string") throw new Error("BUILD_METADATA.json lacks a version");
    if (path.basename(archive) !== `${ARCHIVE_PREFIX}-${version}.xpi`) {
      throw new Error("XPI filename does not match BUILD_METADATA.json version");
    }
    const expectedClientName = `${ARCHIVE_PREFIX}-${version}-client`;
    if (metadata.clientKit !== expectedClientName) {
      throw new Error("BUILD_METADATA.json does not identify the matching client sidecar");
    }
    if (expectedProjectRoot !== undefined) {
      const project = JSON.parse(await readFile(path.join(expectedProjectRoot, "package.json"), "utf8"));
      if (project.version !== version) throw new Error("XPI version does not match package.json");
    }

    const manifest = JSON.parse(await readFile(path.join(temporaryDirectory, "manifest.json"), "utf8"));
    validateManifest(manifest, version);
    validateBootstrap(await readFile(path.join(temporaryDirectory, "bootstrap.js"), "utf8"));
    validateBundle(await readFile(path.join(temporaryDirectory, "companion.js"), "utf8"));
    const schema = JSON.parse(await readFile(
      path.join(temporaryDirectory, "protocol", "v1-request.schema.json"),
      "utf8",
    ));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || !Array.isArray(schema.oneOf)) {
      throw new Error("protocol/v1-request.schema.json is not the expected draft-2020-12 request schema");
    }
    const responseSchema = JSON.parse(await readFile(
      path.join(temporaryDirectory, "protocol", "v1-response.schema.json"),
      "utf8",
    ));
    if (responseSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error("protocol/v1-response.schema.json is not a draft-2020-12 schema");
    }
    const validators = createProtocolSchemaValidators(schema, responseSchema);
    for (const member of extracted.filter((name) => name.endsWith(".request.json"))) {
      const example = JSON.parse(
        await readFile(path.join(temporaryDirectory, ...member.split("/")), "utf8"),
      );
      requireSchemaValid(validators.request, example, member);
      validateExample(example, member);
    }
    for (const member of extracted.filter((name) => name.endsWith(".response.json"))) {
      const example = JSON.parse(
        await readFile(path.join(temporaryDirectory, ...member.split("/")), "utf8"),
      );
      requireSchemaValid(validators.response, example, member);
      validateResponseExample(example, member);
      if (member === "protocol/examples/connection-status.response.json") {
        if (example.data?.pluginVersion !== version) {
          throw new Error("connection-status response example version does not match the release");
        }
        if (JSON.stringify(example.data?.capabilities?.operations) !== JSON.stringify([...OPERATIONS].filter(name => name !== "inspect_arxiv" && name !== "ensure_arxiv_pdf"))) {
          throw new Error("connection-status response example does not advertise all operations exactly");
        }
      }
    }
    const notices = await readFile(path.join(temporaryDirectory, "THIRD_PARTY_NOTICES"), "utf8");
    validateThirdParty(metadata, notices, extracted);
    const clientDirectory = path.join(path.dirname(archive), expectedClientName);
    const clientMembers = await validateClientKit(clientDirectory, temporaryDirectory, version);
    const expectedPluginName = `${PLUGIN_ARCHIVE_PREFIX}-${version}.zip`;
    if (metadata.portablePlugin !== expectedPluginName) {
      throw new Error("BUILD_METADATA.json does not identify the matching portable plugin");
    }
    const pluginPath = path.join(path.dirname(archive), expectedPluginName);
    const pluginMembers = await validatePortablePlugin(pluginPath, version);
    const expectedServerName = `${SERVER_ARCHIVE_PREFIX}-${version}.zip`;
    if (metadata.mcpServer !== expectedServerName) {
      throw new Error("BUILD_METADATA.json does not identify the matching MCP server");
    }
    const serverPath = path.join(path.dirname(archive), expectedServerName);
    const serverMembers = await validateServerPackage(serverPath, version);
    return {
      version,
      members: extracted,
      clientDirectory,
      clientMembers,
      pluginPath,
      pluginMembers,
      serverPath,
      serverMembers,
      zoteroCompatibility: {
        minimum: manifest.applications.zotero.strict_min_version,
        maximum: manifest.applications.zotero.strict_max_version,
      },
      updateURL: manifest.applications.zotero.update_url,
      runtimePackages: metadata.runtimePackages,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
