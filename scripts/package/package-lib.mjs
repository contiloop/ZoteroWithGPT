import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, version as esbuildVersion } from "esbuild";

const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const ZIP_PATH = "/usr/bin/zip";
const REQUIRED_COMPATIBILITY = Object.freeze({ minimum: "10.0.6", maximum: "10.0.*" });
const ARCHIVE_PREFIX = "zotero-ai-research-companion";
const PLUGIN_ARCHIVE_PREFIX = "zotero-study-save";
const SERVER_ARCHIVE_PREFIX = "zotero-mcp-server";
const MANUAL_UPDATE_SENTINEL =
  "https://updates.invalid/zotero-ai-research-companion/updates.json";
const ASSET_DIRECTORY = fileURLToPath(new URL("./assets", import.meta.url));
const CLIENT_README_TEMPLATE = path.join(ASSET_DIRECTORY, "client", "README.md");

const STATIC_FILES = Object.freeze([
  ["LICENSE", "LICENSE"],
  ["addon/bootstrap.js", "bootstrap.js"],
  ["addon/manifest.json", "manifest.json"],
  ["THIRD_PARTY_NOTICES", "THIRD_PARTY_NOTICES"],
  ["docs/install.md", "docs/install.md"],
  ["docs/uninstall.md", "docs/uninstall.md"],
  ["docs/troubleshooting.md", "docs/troubleshooting.md"],
  ["docs/protocol/v1.md", "protocol/v1.md"],
]);

const ASSET_FILES = Object.freeze([
  ["protocol/v1-request.schema.json", "protocol/v1-request.schema.json"],
  ["protocol/v1-response.schema.json", "protocol/v1-response.schema.json"],
  ["protocol/examples/connection-status.request.json", "protocol/examples/connection-status.request.json"],
  ["protocol/examples/connection-status.response.json", "protocol/examples/connection-status.response.json"],
  ["protocol/examples/find-local-arxiv.request.json", "protocol/examples/find-local-arxiv.request.json"],
  ["protocol/examples/find-local-arxiv.response.json", "protocol/examples/find-local-arxiv.response.json"],
  ["protocol/examples/read-pdf.request.json", "protocol/examples/read-pdf.request.json"],
  ["protocol/examples/create-annotation.request.json", "protocol/examples/create-annotation.request.json"],
  ["protocol/examples/create-annotation.response.json", "protocol/examples/create-annotation.response.json"],
  ["protocol/examples/create-note.request.json", "protocol/examples/create-note.request.json"],
]);

const PORTABLE_PLUGIN_FILES = Object.freeze([
  ["LICENSE", "LICENSE"],
  ["integration/chatgpt-plugin/plugin.json", "plugin.json"],
  ["integration/chatgpt-plugin/README.md", "README.md"],
  ["integration/chatgpt-plugin/skills/zotero/SKILL.md", "skills/zotero/SKILL.md"],
  ["integration/chatgpt-plugin/skills/zotero/agents/openai.yaml", "skills/zotero/agents/openai.yaml"],
  ["integration/chatgpt-plugin/skills/zotero/resources/workflow.md", "skills/zotero/resources/workflow.md"],
]);
const SERVER_SCHEMA_FILES = Object.freeze([
  "scripts/package/assets/protocol/v1-request.schema.json",
  "scripts/package/assets/protocol/v1-response.schema.json",
]);

const CLIENT_PROJECT_FILES = Object.freeze([
  ["LICENSE", "LICENSE"],
  ["docs/install.md", "docs/install.md"],
  ["docs/uninstall.md", "docs/uninstall.md"],
  ["docs/troubleshooting.md", "docs/troubleshooting.md"],
  ["docs/protocol/v1.md", "protocol/v1.md"],
]);

const DEFAULT_PREFERENCES = [
  'pref("extensions.zotero-ai-research-companion.enabled", false);',
  'pref("extensions.zotero-ai-research-companion.bridgeDirectory", "");',
  "",
].join("\n");

const PRIVATE_OR_DEVELOPMENT_PATTERN =
  /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\|\.dryforge(?:\/|\\)|devplaceholder|developer-owned-native-fixture|ZOTERO_AI_RESEARCH_COMPANION_OWNED_NATIVE_FIXTURE_V1)/u;
const SECRET_PATTERN =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\btunnel[_ -]?key\s*[:=]\s*[^<\s]+)/iu;

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function assertVersion(value, source) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error(`${source} must contain a valid version string`);
  }
  return value;
}

function validateManifest(manifest, version) {
  if (manifest.version !== version) {
    throw new Error(`manifest version ${String(manifest.version)} does not match package version ${version}`);
  }
  const zotero = manifest.applications?.zotero;
  if (zotero?.strict_min_version !== REQUIRED_COMPATIBILITY.minimum) {
    throw new Error(`manifest strict_min_version must be ${REQUIRED_COMPATIBILITY.minimum}`);
  }
  if (zotero?.strict_max_version !== REQUIRED_COMPATIBILITY.maximum) {
    throw new Error(`manifest strict_max_version must be ${REQUIRED_COMPATIBILITY.maximum}`);
  }
  if (typeof zotero?.id !== "string" || zotero.id.length === 0) {
    throw new Error("manifest must declare a Zotero plugin id");
  }
  if ("update_url" in manifest || zotero.update_url !== MANUAL_UPDATE_SENTINEL) {
    throw new Error(
      `manifest must declare the reserved manual-update sentinel ${MANUAL_UPDATE_SENTINEL}`,
    );
  }
}

function validateReleaseText(content, label) {
  if (PRIVATE_OR_DEVELOPMENT_PATTERN.test(content)) {
    throw new Error(`${label} contains a private or development-specific path or marker`);
  }
  if (SECRET_PATTERN.test(content)) {
    throw new Error(`${label} appears to contain a secret`);
  }
}

async function copyText(source, destination, label) {
  const content = await readFile(source, "utf8");
  validateReleaseText(content, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

async function copyAsset(source, destination, label, version) {
  let content = await readFile(path.join(ASSET_DIRECTORY, ...source.split("/")), "utf8");
  if (source === "protocol/examples/connection-status.response.json") {
    const example = JSON.parse(content);
    example.data.pluginVersion = version;
    content = `${JSON.stringify(example, null, 2)}\n`;
  }
  validateReleaseText(content, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

function packageNameFromInput(input) {
  const normalized = input.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u);
  return match?.[1];
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

async function runtimePackages(projectRoot, metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const name = packageNameFromInput(input);
    if (name !== undefined) names.add(name);
  }
  const packages = [];
  for (const directoryName of [...names].sort()) {
    const packageRoot = path.join(projectRoot, "node_modules", ...directoryName.split("/"));
    const metadata = await readJson(path.join(packageRoot, "package.json"));
    const name = typeof metadata.name === "string" ? metadata.name : directoryName;
    const version = assertVersion(metadata.version, `${name}/package.json`);
    const license = typeof metadata.license === "string" ? metadata.license : undefined;
    if (license === undefined || license.trim().length === 0) {
      throw new Error(`Bundled package ${name}@${version} has no declared license`);
    }
    const licenseFiles = (await readdir(packageRoot))
      .filter((filename) => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu.test(filename))
      .sort();
    if (licenseFiles.length === 0) {
      throw new Error(`Bundled package ${name}@${version} has no license text`);
    }
    packages.push({ directoryName, packageRoot, name, version, license, licenseFiles });
  }
  return packages;
}

async function copyRuntimeLicenses(stagingDirectory, packages, notices) {
  const noticedPackages = noticePackageIdentities(notices);
  for (const dependency of packages) {
    const noticeIdentity = `${dependency.name}@${dependency.version}`;
    if (!noticedPackages.has(noticeIdentity)) {
      throw new Error(`THIRD_PARTY_NOTICES does not identify bundled package ${noticeIdentity}`);
    }
    const archiveDirectory = dependency.name.replaceAll("/", "__");
    for (const filename of dependency.licenseFiles) {
      const destination = path.join(
        stagingDirectory,
        "third-party-licenses",
        archiveDirectory,
        filename,
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(dependency.packageRoot, filename), destination);
    }
  }
}

async function allFiles(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await allFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Package staging contains an unsupported entry: ${relative}`);
  }
  return files;
}

async function normalizeArchiveMetadata(stagingDirectory, members) {
  for (const member of members) {
    const filename = path.join(stagingDirectory, ...member.split("/"));
    await chmod(filename, 0o644);
    await utimes(filename, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
}

async function stageClientKit(projectRoot, directory, version) {
  await mkdir(directory, { recursive: true });
  const readmeTemplate = await readFile(CLIENT_README_TEMPLATE, "utf8");
  const readme = readmeTemplate.replaceAll("{{PACKAGE_VERSION}}", version);
  if (readme.includes("{{PACKAGE_VERSION}}")) {
    throw new Error("Client README contains an unresolved package version");
  }
  validateReleaseText(readme, "client README");
  await writeFile(path.join(directory, "README.md"), readme, "utf8");
  for (const [source, destination] of CLIENT_PROJECT_FILES) {
    await copyText(
      path.join(projectRoot, ...source.split("/")),
      path.join(directory, ...destination.split("/")),
      `client kit ${source}`,
    );
  }
  for (const [source, destination] of ASSET_FILES) {
    await copyAsset(
      source,
      path.join(directory, ...destination.split("/")),
      `client kit ${source}`,
      version,
    );
  }
  const members = (await allFiles(directory)).sort();
  await normalizeArchiveMetadata(directory, members);
  return { members, readme };
}

async function stagePortablePlugin(projectRoot, directory, version) {
  const manifest = await readJson(path.join(projectRoot, "integration", "chatgpt-plugin", "plugin.json"));
  if (manifest.version !== version) {
    throw new Error(
      `portable plugin version ${String(manifest.version)} does not match package version ${version}`,
    );
  }
  if (
    Object.keys(manifest.extensions?.["com.openai"] ?? {}).sort().join(",") !== "interface" ||
    Object.hasOwn(manifest.extensions?.["com.openai"] ?? {}, "apps")
  ) {
    throw new Error("portable plugin must be explicitly unconfigured and omit apps");
  }
  await mkdir(directory, { recursive: true });
  for (const [source, destination] of PORTABLE_PLUGIN_FILES) {
    await copyText(
      path.join(projectRoot, ...source.split("/")),
      path.join(directory, ...destination.split("/")),
      `portable plugin ${source}`,
    );
  }
  const members = (await allFiles(directory)).sort();
  await normalizeArchiveMetadata(directory, members);
  return { members };
}

function packageNameFromLockPath(lockPath) {
  const normalized = lockPath.replaceAll("\\", "/");
  return normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u)?.[1];
}

function serverNotices(lock) {
  const entries = [];
  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (lockPath === "") continue;
    const name = packageNameFromLockPath(lockPath);
    if (
      name === undefined ||
      typeof metadata.version !== "string" ||
      typeof metadata.license !== "string" ||
      metadata.license.trim().length === 0
    ) {
      throw new Error(`server lock entry ${lockPath} lacks reviewable name, version, or license`);
    }
    entries.push({
      lockPath,
      name,
      version: metadata.version,
      license: metadata.license,
      source: typeof metadata.resolved === "string" ? metadata.resolved : "npm lockfile",
    });
  }
  entries.sort((left, right) => left.lockPath.localeCompare(right.lockPath, "en"));
  const lines = [
    "ZOTERO MCP SERVER THIRD-PARTY SOFTWARE NOTICES",
    "",
    "This project is licensed under MIT; see LICENSE. The locked",
    "production dependencies below retain their own licenses. `npm ci --omit=dev`",
    "installs their package license files beside the runtime.",
    "",
  ];
  const documented = new Set();
  for (const entry of entries) {
    const identity = `${entry.name}@${entry.version}`;
    if (documented.has(identity)) continue;
    documented.add(identity);
    lines.push(
      `Package: ${identity}`,
      `License: ${entry.license}`,
      `Source: ${entry.source}`,
      "",
    );
  }
  return { content: `${lines.join("\n")}\n`, entries };
}

async function serverSourceMembers(projectRoot) {
  const graph = await build({
    absWorkingDir: projectRoot,
    entryPoints: [
      path.join(projectRoot, "integration", "zotero-mcp", "server.mjs"),
      path.join(projectRoot, "integration", "zotero-mcp", "lifecycle.mjs"),
      path.join(projectRoot, "scripts", "package", "configure-plugin.mjs"),
    ],
    bundle: true,
    format: "esm",
    metafile: true,
    minify: false,
    outdir: path.join(projectRoot, ".cache", "server-package-graph"),
    packages: "external",
    platform: "node",
    sourcemap: false,
    target: "node24",
    treeShaking: true,
    write: false,
  });
  const members = [];
  for (const input of Object.keys(graph.metafile.inputs)) {
    const absolute = path.resolve(projectRoot, input);
    const relative = path.relative(projectRoot, absolute).replaceAll(path.sep, "/");
    if (
      relative.startsWith("../") ||
      relative === ".." ||
      relative.split("/").includes("node_modules")
    ) {
      throw new Error(`server dependency graph escaped the project allowlist: ${input}`);
    }
    members.push(relative);
  }
  return [...new Set(members)].sort();
}

async function stageServerPackage(projectRoot, directory, version) {
  const nestedRoot = path.join(projectRoot, "integration", "zotero-mcp");
  const nestedPackage = await readJson(path.join(nestedRoot, "package.json"));
  const nestedLock = await readJson(path.join(nestedRoot, "package-lock.json"));
  if (
    nestedPackage.version !== version ||
    nestedLock.version !== version ||
    nestedLock.packages?.[""]?.version !== version
  ) {
    throw new Error("MCP package and lock versions must match the release version");
  }
  const expectedDependencies = {
    "@modelcontextprotocol/sdk": "1.32.2",
    dompurify: "3.4.17",
    jsdom: "29.1.1",
  };
  if (JSON.stringify(nestedPackage.dependencies) !== JSON.stringify(expectedDependencies)) {
    throw new Error("MCP runtime dependencies must remain exactly pinned and ordered");
  }
  const distributionPackage = {
    name: nestedPackage.name,
    license: "MIT",
    version,
    private: true,
    type: "module",
    packageManager: "npm@11.4.2",
    engines: nestedPackage.engines,
    bin: {
      "zotero-mcp": "integration/zotero-mcp/server.mjs",
      "zotero-mcp-lifecycle": "integration/zotero-mcp/lifecycle.mjs",
    },
    dependencies: nestedPackage.dependencies,
  };
  const distributionLock = structuredClone(nestedLock);
  distributionLock.packages[""].bin = distributionPackage.bin;
  distributionLock.packages[""].packageManager = distributionPackage.packageManager;
  const graphMembers = await serverSourceMembers(projectRoot);
  const sourceMembers = [...new Set([
    ...graphMembers,
    "LICENSE",
    ...SERVER_SCHEMA_FILES,
    "integration/zotero-mcp/package.json",
  ])].sort();
  await mkdir(directory, { recursive: true });
  for (const member of sourceMembers) {
    await copyText(
      path.join(projectRoot, ...member.split("/")),
      path.join(directory, ...member.split("/")),
      `server package ${member}`,
    );
  }
  const packageContent = `${JSON.stringify(distributionPackage, null, 2)}\n`;
  const lockContent = `${JSON.stringify(distributionLock, null, 2)}\n`;
  validateReleaseText(packageContent, "server package.json");
  validateReleaseText(lockContent, "server package-lock.json");
  await writeFile(path.join(directory, "package.json"), packageContent, "utf8");
  await writeFile(path.join(directory, "package-lock.json"), lockContent, "utf8");
  const notices = serverNotices(distributionLock);
  await writeFile(path.join(directory, "THIRD_PARTY_NOTICES"), notices.content, "utf8");
  const memberNames = [
    ...sourceMembers,
    "package.json",
    "package-lock.json",
    "THIRD_PARTY_NOTICES",
    "SERVER_BUILD_METADATA.json",
  ].sort();
  const memberSha256 = {};
  for (const member of memberNames.filter(name => name !== "SERVER_BUILD_METADATA.json")) {
    memberSha256[member] = createHash("sha256")
      .update(await readFile(path.join(directory, ...member.split("/"))))
      .digest("hex");
  }
  const metadata = {
    schemaVersion: 1,
    owner: "zotero-study-save-mcp-runtime",
    artifact: `${SERVER_ARCHIVE_PREFIX}-${version}.zip`,
    version,
    projectLicense: "MIT",
    runtime: {
      node: ">=24 <27",
      npm: "11.4.2",
      install: "npm ci --omit=dev --ignore-scripts",
    },
    directDependencies: expectedDependencies,
    lockedPackages: notices.entries.map(({ name, version: packageVersion, license }) => ({
      name,
      version: packageVersion,
      license,
    })),
    lockSha256: createHash("sha256").update(lockContent).digest("hex"),
    members: memberNames,
    memberSha256,
    recipe: {
      source: "explicit server, lifecycle, and private-config import graph plus shared schemas and locked manifests",
      archive: "/usr/bin/zip -X with sorted members and fixed UTC timestamps",
    },
  };
  await writeFile(
    path.join(directory, "SERVER_BUILD_METADATA.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  const actualMembers = (await allFiles(directory)).sort();
  if (JSON.stringify(actualMembers) !== JSON.stringify(memberNames)) {
    throw new Error("server staging inventory differs from its fixed metadata allowlist");
  }
  await normalizeArchiveMetadata(directory, actualMembers);
  return { members: actualMembers, metadata };
}

async function runZip(stagingDirectory, outputPath, members) {
  await rm(outputPath, { force: true });
  const environment = { ...process.env, COPYFILE_DISABLE: "1", LC_ALL: "C", TZ: "UTC" };
  delete environment.ZIPOPT;
  const child = spawn(ZIP_PATH, ["-X", "-q", outputPath, "-@"], {
    cwd: stagingDirectory,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let standardError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { standardError += chunk; });
  child.stdin.end(`${members.join("\n")}\n`);
  const [exitCode] = await once(child, "close");
  if (exitCode !== 0) {
    throw new Error(`zip exited ${String(exitCode)}: ${standardError.trim()}`);
  }
}

export async function buildXpi({
  projectRoot,
  outputDirectory = path.join(projectRoot, "artifacts"),
} = {}) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("projectRoot must be an absolute path");
  }
  const packageMetadata = await readJson(path.join(projectRoot, "package.json"));
  const version = assertVersion(packageMetadata.version, "package.json");
  const manifest = await readJson(path.join(projectRoot, "addon", "manifest.json"));
  validateManifest(manifest, version);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "research-companion-xpi-"));
  const stagingDirectory = path.join(temporaryDirectory, "package");
  const clientStagingDirectory = path.join(temporaryDirectory, "client");
  const pluginStagingDirectory = path.join(temporaryDirectory, "plugin");
  const serverStagingDirectory = path.join(temporaryDirectory, "server");
  const outputPath = path.resolve(
    outputDirectory,
    `${ARCHIVE_PREFIX}-${version}.xpi`,
  );
  const clientDirectory = path.resolve(
    outputDirectory,
    `${ARCHIVE_PREFIX}-${version}-client`,
  );
  const pluginPath = path.resolve(
    outputDirectory,
    `${PLUGIN_ARCHIVE_PREFIX}-${version}.zip`,
  );
  const serverPath = path.resolve(
    outputDirectory,
    `${SERVER_ARCHIVE_PREFIX}-${version}.zip`,
  );
  let published = false;

  try {
    await rm(outputPath, { force: true });
    await rm(pluginPath, { force: true });
    await rm(serverPath, { force: true });
    await rm(clientDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
    for (const [source, destination] of STATIC_FILES) {
      await copyText(
        path.join(projectRoot, ...source.split("/")),
        path.join(stagingDirectory, ...destination.split("/")),
        source,
      );
    }
    for (const [source, destination] of ASSET_FILES) {
      await copyAsset(
        source,
        path.join(stagingDirectory, ...destination.split("/")),
        `packaging asset ${source}`,
        version,
      );
    }
    await writeFile(path.join(stagingDirectory, "prefs.js"), DEFAULT_PREFERENCES, "utf8");
    const clientKit = await stageClientKit(projectRoot, clientStagingDirectory, version);
    const portablePlugin = await stagePortablePlugin(
      projectRoot,
      pluginStagingDirectory,
      version,
    );
    const serverPackage = await stageServerPackage(
      projectRoot,
      serverStagingDirectory,
      version,
    );
    await mkdir(path.join(stagingDirectory, "client"), { recursive: true });
    await writeFile(
      path.join(stagingDirectory, "client", "README.md"),
      clientKit.readme,
      "utf8",
    );

    const buildResult = await build({
      absWorkingDir: projectRoot,
      entryPoints: [path.join(projectRoot, "src", "plugin", "entry.ts")],
      outfile: path.join(stagingDirectory, "companion.js"),
      bundle: true,
      charset: "utf8",
      define: { "process.env.NODE_ENV": '"production"' },
      format: "iife",
      globalName: "ResearchCompanion",
      legalComments: "none",
      metafile: true,
      minify: false,
      platform: "browser",
      preserveSymlinks: true,
      sourcemap: false,
      target: "firefox140",
      treeShaking: true,
      write: true,
    });
    const companionSource = await readFile(path.join(stagingDirectory, "companion.js"), "utf8");
    validateReleaseText(companionSource, "companion.js");
    if (!companionSource.includes("ResearchCompanion")) {
      throw new Error("companion bundle does not expose the ResearchCompanion global");
    }

    const packages = await runtimePackages(projectRoot, buildResult.metafile);
    const notices = await readFile(path.join(projectRoot, "THIRD_PARTY_NOTICES"), "utf8");
    await copyRuntimeLicenses(stagingDirectory, packages, notices);
    const buildMetadata = {
      artifact: `${ARCHIVE_PREFIX}-${version}.xpi`,
      clientKit: `${ARCHIVE_PREFIX}-${version}-client`,
      portablePlugin: `${PLUGIN_ARCHIVE_PREFIX}-${version}.zip`,
      mcpServer: `${SERVER_ARCHIVE_PREFIX}-${version}.zip`,
      version,
      projectLicense: "MIT",
      distribution: "manual",
      updatePolicy: {
        service: false,
        manifestSentinel: MANUAL_UPDATE_SENTINEL,
      },
      zoteroCompatibility: REQUIRED_COMPATIBILITY,
      runtimePackages: packages.map(({ name, version: dependencyVersion, license }) => ({
        name,
        version: dependencyVersion,
        license,
      })),
      recipe: {
        bundler: `esbuild ${esbuildVersion}`,
        format: "iife",
        globalName: "ResearchCompanion",
        platform: "browser",
        preserveSymlinks: true,
        target: "firefox140",
        archive: "/usr/bin/zip -X with sorted members and fixed UTC timestamps",
        clientKit: "plain UTF-8 files with the same fixed timestamps",
        portablePlugin: "explicit unconfigured source allowlist",
        mcpServer: "locked production manifest plus explicit local import graph",
      },
    };
    await writeFile(
      path.join(stagingDirectory, "BUILD_METADATA.json"),
      `${JSON.stringify(buildMetadata, null, 2)}\n`,
      "utf8",
    );

    const members = (await allFiles(stagingDirectory)).sort();
    await normalizeArchiveMetadata(stagingDirectory, members);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await runZip(stagingDirectory, outputPath, members);
    await runZip(pluginStagingDirectory, pluginPath, portablePlugin.members);
    await runZip(serverStagingDirectory, serverPath, serverPackage.members);
    await cp(clientStagingDirectory, clientDirectory, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
    });
    published = true;
    return {
      outputPath,
      clientDirectory,
      pluginPath,
      serverPath,
      version,
      members,
      clientMembers: clientKit.members,
      pluginMembers: portablePlugin.members,
      serverMembers: serverPackage.members,
      runtimePackages: buildMetadata.runtimePackages,
    };
  } finally {
    if (!published) {
      await rm(outputPath, { force: true });
      await rm(pluginPath, { force: true });
      await rm(serverPath, { force: true });
      await rm(clientDirectory, { recursive: true, force: true });
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
