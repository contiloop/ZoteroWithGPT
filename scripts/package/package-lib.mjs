import { spawn } from "node:child_process";
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
const MANUAL_UPDATE_SENTINEL =
  "https://updates.invalid/zotero-ai-research-companion/updates.json";
const ASSET_DIRECTORY = fileURLToPath(new URL("./assets", import.meta.url));
const CLIENT_README_TEMPLATE = path.join(ASSET_DIRECTORY, "client", "README.md");

const STATIC_FILES = Object.freeze([
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
  ["protocol/examples/read-pdf.request.json", "protocol/examples/read-pdf.request.json"],
  ["protocol/examples/create-annotation.request.json", "protocol/examples/create-annotation.request.json"],
  ["protocol/examples/create-annotation.response.json", "protocol/examples/create-annotation.response.json"],
  ["protocol/examples/create-note.request.json", "protocol/examples/create-note.request.json"],
]);

const CLIENT_PROJECT_FILES = Object.freeze([
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
    await copyText(
      path.join(ASSET_DIRECTORY, ...source.split("/")),
      path.join(directory, ...destination.split("/")),
      `client kit ${source}`,
    );
  }
  const members = (await allFiles(directory)).sort();
  await normalizeArchiveMetadata(directory, members);
  return { members, readme };
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
  const outputPath = path.resolve(
    outputDirectory,
    `${ARCHIVE_PREFIX}-${version}.xpi`,
  );
  const clientDirectory = path.resolve(
    outputDirectory,
    `${ARCHIVE_PREFIX}-${version}-client`,
  );
  let published = false;

  try {
    await rm(outputPath, { force: true });
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
      await copyText(
        path.join(ASSET_DIRECTORY, ...source.split("/")),
        path.join(stagingDirectory, ...destination.split("/")),
        `packaging asset ${source}`,
      );
    }
    await writeFile(path.join(stagingDirectory, "prefs.js"), DEFAULT_PREFERENCES, "utf8");
    const clientKit = await stageClientKit(projectRoot, clientStagingDirectory, version);
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
      version,
      projectLicense: null,
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
        target: "firefox140",
        archive: "/usr/bin/zip -X with sorted members and fixed UTC timestamps",
        clientKit: "plain UTF-8 files with the same fixed timestamps",
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
    await cp(clientStagingDirectory, clientDirectory, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
    });
    published = true;
    return {
      outputPath,
      clientDirectory,
      version,
      members,
      clientMembers: clientKit.members,
      runtimePackages: buildMetadata.runtimePackages,
    };
  } finally {
    if (!published) {
      await rm(outputPath, { force: true });
      await rm(clientDirectory, { recursive: true, force: true });
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
