import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const ZIP_PATH = "/usr/bin/zip";
const UNZIP_PATH = "/usr/bin/unzip";
const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const PORTABLE_MEMBERS = Object.freeze([
  "README.md",
  "plugin.json",
  "skills/zotero/SKILL.md",
  "skills/zotero/agents/openai.yaml",
  "skills/zotero/resources/workflow.md",
]);
const CONFIGURED_MEMBERS = Object.freeze([
  ".app.json",
  ".codex-plugin/plugin.json",
  ...PORTABLE_MEMBERS,
].sort());

const OBSOLETE_SKILL_DIRECTORY = "skills/zotero-study-save";

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
  return value;
}

function requireVersion(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a stable semantic version`);
  }
  return value;
}

function compareVersions(left, right) {
  const a = left.split("+", 1)[0].split(".").map(Number);
  const b = right.split("+", 1)[0].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function requireVerifiedAppId(value) {
  if (
    typeof value !== "string" ||
    !/^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]{7,}$/u.test(value) ||
    /(?:placeholder|example|changeme)/iu.test(value)
  ) {
    throw new TypeError("appId must be a verified app ID discovered from the target account");
  }
  return value;
}

async function readJson(filename, label) {
  let value;
  try {
    value = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    throw new Error(`${label} must be readable valid JSON`, { cause: error });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  if (options.input !== undefined) child.stdin.end(options.input);
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${path.basename(executable)} failed with exit ${String(code)}`);
  return { stdout, stderr };
}

async function archiveMembers(filename) {
  const { stdout } = await run(UNZIP_PATH, ["-Z1", filename]);
  const members = stdout.split(/\r?\n/u).filter(Boolean);
  if (
    members.some(member =>
      member.startsWith("/") ||
      member.endsWith("/") ||
      member.split("/").some(segment => segment === "" || segment === "." || segment === "..")
    ) ||
    new Set(members).size !== members.length
  ) {
    throw new Error("portable plugin archive contains unsafe members");
  }
  return members;
}

function orderedInterface(portable, existing) {
  if (
    portable === null || typeof portable !== "object" || Array.isArray(portable) ||
    existing === null || typeof existing !== "object" || Array.isArray(existing)
  ) {
    throw new TypeError("portable and account plugin interfaces must be objects");
  }
  const prompt = existing.defaultPrompt;
  if (
    !(
      (typeof prompt === "string" && prompt.length > 0) ||
      (Array.isArray(prompt) && prompt.length > 0 && prompt.every(value =>
        typeof value === "string" && value.length > 0))
    )
  ) {
    throw new TypeError("account plugin must supply its existing defaultPrompt value");
  }
  const configured = {};
  for (const key of Object.keys(existing)) {
    configured[key] = existing[key];
  }
  for (const [key, value] of Object.entries(portable)) {
    if (!Object.hasOwn(configured, key)) configured[key] = value;
  }
  return configured;
}

async function existingFiles(root, relative) {
  const absolute = path.join(root, ...relative.split("/"));
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`obsolete account path ${relative} must not be a symlink`);
  if (info.isFile()) return [relative];
  if (!info.isDirectory()) throw new Error(`obsolete account path ${relative} has unsupported type`);
  const files = [];
  for (const entry of (await readdir(absolute, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    files.push(...await existingFiles(root, `${relative}/${entry.name}`));
  }
  return files;
}

function configuredManifest(portable, existing, version) {
  if (
    portable.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" ||
    portable.name !== "zotero-study-save" ||
    existing.name !== portable.name
  ) {
    throw new Error("portable and account manifests must preserve zotero-study-save identity");
  }
  const portableOpenAi = portable.extensions?.["com.openai"];
  const existingOpenAi = existing.extensions?.["com.openai"];
  if (
    portableOpenAi === null || typeof portableOpenAi !== "object" ||
    existingOpenAi === null || typeof existingOpenAi !== "object"
  ) {
    throw new Error("portable and account manifests must declare extensions.com.openai");
  }
  return {
    ...portable,
    version,
    extensions: {
      "com.openai": {
        interface: orderedInterface(portableOpenAi.interface, existingOpenAi.interface),
        apps: "./.app.json",
      },
    },
  };
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function normalize(directory) {
  for (const member of CONFIGURED_MEMBERS) {
    const filename = path.join(directory, ...member.split("/"));
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`configured plugin member ${member} must be a regular file`);
    }
    await chmod(filename, 0o600);
    await utimes(filename, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
}

export async function configurePrivatePlugin({
  portableArchive,
  accountSourceDirectory,
  appId,
  outputPath,
  releaseVersion,
}) {
  const verifiedAppId = requireVerifiedAppId(appId);
  const portablePath = requireAbsolutePath(portableArchive, "portableArchive");
  const accountSource = requireAbsolutePath(accountSourceDirectory, "accountSourceDirectory");
  const output = requireAbsolutePath(outputPath, "outputPath");
  if (output === portablePath) throw new TypeError("private output must be separate from the portable archive");
  const members = await archiveMembers(portablePath);
  if (JSON.stringify(members) !== JSON.stringify(PORTABLE_MEMBERS)) {
    throw new Error("portable plugin archive does not match the unconfigured allowlist");
  }
  const accountInfo = await lstat(accountSource);
  if (!accountInfo.isDirectory() || accountInfo.isSymbolicLink()) {
    throw new TypeError("accountSourceDirectory must be a non-symlink directory");
  }

  const outputDirectory = path.dirname(output);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const temporaryRoot = await mkdtemp(path.join(outputDirectory, ".zotero-private-plugin-"));
  await chmod(temporaryRoot, 0o700);
  const staging = path.join(temporaryRoot, "package");
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    await run(UNZIP_PATH, ["-qq", portablePath, "-d", staging]);
    for (const member of PORTABLE_MEMBERS) {
      const info = await lstat(path.join(staging, ...member.split("/")));
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`portable plugin member ${member} must be a regular file`);
      }
    }
    const portableManifest = await readJson(path.join(staging, "plugin.json"), "portable plugin manifest");
    const accountManifest = await readJson(
      path.join(accountSource, "plugin.json"),
      "account plugin manifest",
    );
    const compatibility = await readJson(
      path.join(accountSource, ".codex-plugin", "plugin.json"),
      "account compatibility manifest",
    );
    const portableVersion = requireVersion(portableManifest.version, "portable plugin version");
    const accountVersion = requireVersion(accountManifest.version, "account plugin version");
    const compatibilityVersion = requireVersion(
      compatibility.version,
      "account compatibility manifest version",
    );
    let currentVersion = compareVersions(accountVersion, portableVersion) >= 0
      ? accountVersion
      : portableVersion;
    if (compareVersions(compatibilityVersion, currentVersion) > 0) {
      currentVersion = compatibilityVersion;
    }
    const configuredVersion = releaseVersion === undefined
      ? currentVersion
      : requireVersion(releaseVersion, "releaseVersion");
    if (
      compareVersions(configuredVersion, portableVersion) < 0 ||
      compareVersions(configuredVersion, accountVersion) < 0 ||
      compareVersions(configuredVersion, compatibilityVersion) < 0
    ) {
      throw new Error("configured version cannot be lower than portable or current account version");
    }
    const manifest = configuredManifest(portableManifest, accountManifest, configuredVersion);
    if (compatibility.name !== portableManifest.name) {
      throw new Error("account compatibility manifest identity does not match zotero-study-save");
    }
    await writeJson(path.join(staging, "plugin.json"), manifest);
    await writeJson(path.join(staging, ".app.json"), {
      apps: { "zotero-mcp": { id: verifiedAppId } },
    });
    await writeJson(path.join(staging, ".codex-plugin", "plugin.json"), {
      ...compatibility,
      version: configuredVersion,
    });
    await normalize(staging);

    const environment = { ...process.env, COPYFILE_DISABLE: "1", LC_ALL: "C", TZ: "UTC" };
    delete environment.ZIPOPT;
    const privateArchive = path.join(temporaryRoot, "configured-private.zip");
    await run(ZIP_PATH, ["-X", "-q", privateArchive, "-@"], {
      cwd: staging,
      env: environment,
      input: `${CONFIGURED_MEMBERS.join("\n")}\n`,
    });
    await chmod(privateArchive, 0o600);
    await rename(privateArchive, output);
    const deletePaths = [
      ...await existingFiles(accountSource, OBSOLETE_SKILL_DIRECTORY),
    ].sort();
    return {
      outputPath: output,
      version: configuredVersion,
      members: [...CONFIGURED_MEMBERS],
      deletePaths,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
