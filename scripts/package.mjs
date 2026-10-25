#!/usr/bin/env node
import {
  mkdtemp,
  mkdir,
  readdir,
  lstat,
  copyFile,
  chmod,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const project = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("-")) {
  console.error("Usage: pnpm package [output.tar.gz]");
  process.exit(1);
}
const output = path.resolve(args[0] ?? path.join(project, "dist/majorpodo.tar.gz"));
const temporary = await mkdtemp(path.join(tmpdir(), "majorpodo-package-"));
const stage = path.join(temporary, "majorpodo");
// Use an allowlist: never traverse local configuration, media, data or snapshots.
const roots = [
  ".github",
  "renovate.json",
  "services/http",
  "services/scanner",
  "services/postgresql",
  "packages/configuration",
  "tests",
  "scripts",
  "docs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vitest.config.mts",
  "docker-compose.yml",
  ".dockerignore",
  ".gitignore",
  ".nvmrc",
  "run.sh",
  "README.md",
  "SETUP.md",
  "LICENSE",
];
const excluded = new Set(["node_modules", "build", ".DS_Store"]);
const copy = async (relative) => {
  const source = path.join(project, relative);
  const target = path.join(stage, relative);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing to package symlink: ${relative}`);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of (await readdir(source)).sort()) {
      if (!excluded.has(name) && !name.endsWith(".bak")) await copy(path.join(relative, name));
    }
  } else if (info.isFile()) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    // In particular, preserve the executable bit on run.sh.
    await chmod(target, info.mode & 0o777);
  } else {
    throw new Error(`Unsupported package entry: ${relative}`);
  }
};
let archive;
try {
  await mkdir(stage);
  for (const root of roots) await copy(root);
  await copy("configuration/sample.yml");
  await copy("configuration/postgres-password.example");
  await copyFile(
    path.join(stage, "configuration/sample.yml"),
    path.join(stage, "configuration/default.yml"),
  );
  await writeFile(path.join(stage, "configuration/postgres-user"), "majorpodo-postgres\n");
  await writeFile(path.join(stage, "configuration/postgres-database"), "majorpodo\n");
  await mkdir(path.dirname(output), { recursive: true });
  // Keep the temporary archive beside the destination so the final rename is atomic.
  archive = path.join(
    await mkdtemp(path.join(path.dirname(output), ".majorpodo-package-")),
    "release.tar.gz",
  );
  const result = spawnSync("tar", ["-czf", archive, "-C", temporary, "majorpodo"], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed (${result.status})`);
  await rename(archive, output);
  console.log(`Created ${output}`);
  console.log("Deploy instructions: docs/packaging.md (also included in the archive).");
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (archive) await rm(path.dirname(archive), { recursive: true, force: true });
}
