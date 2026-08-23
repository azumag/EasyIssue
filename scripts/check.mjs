import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const ignoredDirectories = new Set([".git", "node_modules"]);
const JavaScriptExtensions = new Set([".js", ".mjs"]);
const jsonFiles = [
  "package.json",
  "wrangler.jsonc",
  "public/manifest.webmanifest",
  "extension/chrome/manifest.json"
];

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJavaScriptFiles(path)));
    else if (JavaScriptExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const file of jsonFiles) JSON.parse(await readFile(new URL(file, rootUrl), "utf8"));

for (const file of await collectJavaScriptFiles(rootPath)) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  console.log(`checked ${relative(rootPath, file)}`);
}
