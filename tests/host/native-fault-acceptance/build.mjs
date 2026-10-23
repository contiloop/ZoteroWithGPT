import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, version as esbuildVersion } from "esbuild";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SOURCE_DIRECTORY, "../../..");
const ZIP_PATH = "/usr/bin/zip";
const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const ARCHIVE_NAME = "r12-native-fault-acceptance-v1.xpi";
const FIXTURE_RELATIVE_PATH = "tests/zotero/fixtures/research-companion.pdf";
const FIXTURE_SHA256 = "c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336";
const FIXTURE_BYTE_LENGTH = 900;
const ARCHIVE_MEMBERS = Object.freeze([
  "BUILD_METADATA.json",
  "README.md",
  "bootstrap.js",
  "diagnostic.js",
  "manifest.json",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runZip(stagingDirectory, outputPath) {
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
  child.stdin.end(`${ARCHIVE_MEMBERS.join("\n")}\n`);
  const [exitCode] = await once(child, "close");
  if (exitCode !== 0) {
    throw new Error(`zip exited ${String(exitCode)}: ${standardError.trim()}`);
  }
}

function assertNoPrivateMaterial(label, text) {
  const forbidden = [
    /\/Users\/[^/\s]+\//u,
    /[A-Za-z]:\\Users\\/u,
    /\.dryforge(?:\/|\\)/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/u,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${label} contains private or credential material`);
  }
}

function assertNarrowBundle(source) {
  assertNoPrivateMaterial("diagnostic.js", source);
  const forbidden = [
    [/(?:^|[^A-Za-z])eval\s*\(/u, "eval"],
    [/new\s+Function\s*\(/u, "Function constructor"],
    [/\bfetch\s*\(/u, "network fetch"],
    [/\bqueryAsync\s*\(/u, "SQL query"],
    [/\bexecuteSQL\s*\(/u, "SQL execution"],
    [/child_process/u, "child process"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) throw new Error(`diagnostic.js unexpectedly contains ${label}`);
  }
  for (const required of [
    "r12-native-fault-parent-item-only-v1",
    "r12-native-fault-disable-during-await-v1",
    "synthetic_fixture_not_network_verified",
    "Controlled R12 fault before native attachment mutation",
  ]) {
    if (!source.includes(required)) throw new Error(`diagnostic.js is missing ${required}`);
  }
}

export async function buildDiagnosticXpi({ outputDirectory } = {}) {
  const destination = path.resolve(
    outputDirectory ?? path.join(PROJECT_ROOT, ".cache", "native-fault-acceptance"),
  );
  const fixture = await readFile(path.join(PROJECT_ROOT, FIXTURE_RELATIVE_PATH));
  if (
    fixture.byteLength !== FIXTURE_BYTE_LENGTH ||
    sha256(fixture) !== FIXTURE_SHA256 ||
    !fixture.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))
  ) {
    throw new Error("The owned controlled PDF fixture changed");
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "r12-native-fault-xpi-"));
  const stagingDirectory = path.join(temporaryDirectory, "package");
  const outputPath = path.join(destination, ARCHIVE_NAME);
  let published = false;
  try {
    await mkdir(stagingDirectory, { recursive: true });
    await copyFile(path.join(SOURCE_DIRECTORY, "bootstrap.js"), path.join(stagingDirectory, "bootstrap.js"));
    await copyFile(path.join(SOURCE_DIRECTORY, "manifest.json"), path.join(stagingDirectory, "manifest.json"));
    await copyFile(path.join(SOURCE_DIRECTORY, "README.md"), path.join(stagingDirectory, "README.md"));

    const result = await build({
      absWorkingDir: PROJECT_ROOT,
      entryPoints: [path.join(SOURCE_DIRECTORY, "entry.ts")],
      outfile: path.join(stagingDirectory, "diagnostic.js"),
      bundle: true,
      charset: "utf8",
      define: {
        __CONTROLLED_PDF_BYTES__: JSON.stringify([...fixture]),
        __CONTROLLED_PDF_FINGERPRINT__: JSON.stringify(`sha256:${FIXTURE_SHA256}`),
        __CONTROLLED_PDF_BYTE_LENGTH__: String(FIXTURE_BYTE_LENGTH),
        __CONTROLLED_PDF_PAGE_COUNT__: "1",
      },
      format: "iife",
      globalName: "R12NativeFaultAcceptance",
      legalComments: "none",
      metafile: true,
      minify: false,
      platform: "browser",
      sourcemap: false,
      target: "firefox140",
      treeShaking: true,
      write: true,
    });
    const externalInputs = Object.keys(result.metafile.inputs).filter((input) =>
      input.replaceAll("\\", "/").includes("/node_modules/"),
    );
    if (externalInputs.length !== 0) {
      throw new Error(`The diagnostic unexpectedly bundles dependencies: ${externalInputs.join(", ")}`);
    }
    const bundle = await readFile(path.join(stagingDirectory, "diagnostic.js"));
    const bundleText = bundle.toString("utf8");
    assertNarrowBundle(bundleText);

    const metadata = {
      artifact: ARCHIVE_NAME,
      diagnostic: "r12-native-fault-acceptance-v1",
      distribution: "temporary_manual_reviewed_host_probe",
      automaticWrites: false,
      inputSurface: "two_fixed_tools_menu_commands",
      networkAccess: false,
      journal: "<Zotero profile>/zotero-ai-r12-native-fault-acceptance-v1/operations-v1.json",
      controlledSources: ["0001.99999v1", "0001.99998v1"],
      operationIds: [
        "r12-native-fault-parent-item-only-v1",
        "r12-native-fault-disable-during-await-v1",
      ],
      fixture: {
        source: FIXTURE_RELATIVE_PATH,
        sha256: FIXTURE_SHA256,
        byteLength: FIXTURE_BYTE_LENGTH,
        pageCount: 1,
      },
      zoteroCompatibility: { minimum: "10.0.6", maximum: "10.0.*" },
      runtimePackages: [],
      recipe: {
        bundler: `esbuild ${esbuildVersion}`,
        format: "iife",
        globalName: "R12NativeFaultAcceptance",
        target: "firefox140",
        archive: "/usr/bin/zip -X with sorted members and fixed UTC timestamps",
      },
    };
    await writeFile(
      path.join(stagingDirectory, "BUILD_METADATA.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    for (const member of ARCHIVE_MEMBERS) {
      const filename = path.join(stagingDirectory, member);
      await chmod(filename, 0o644);
      await utimes(filename, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
      if (member.endsWith(".js") || member.endsWith(".json") || member.endsWith(".md")) {
        assertNoPrivateMaterial(member, await readFile(filename, "utf8"));
      }
    }
    await mkdir(destination, { recursive: true });
    await runZip(stagingDirectory, outputPath);
    const archive = await readFile(outputPath);
    published = true;
    return {
      outputPath,
      sha256: sha256(archive),
      byteLength: archive.byteLength,
      bundleSha256: sha256(bundle),
      members: [...ARCHIVE_MEMBERS],
      fixture: metadata.fixture,
    };
  } finally {
    if (!published) await rm(outputPath, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildDiagnosticXpi({});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
