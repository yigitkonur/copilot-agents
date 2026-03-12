#!/usr/bin/env node

// Patches @github/copilot-sdk to fix extensionless ESM imports that fail on Node >= 22.
// The SDK's session.js imports "vscode-jsonrpc/node" without the .js extension,
// which breaks under strict ESM resolution. This script adds the missing extension.
// Remove this once the upstream SDK ships the fix.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const targets = [
  {
    file: "node_modules/@github/copilot-sdk/dist/session.js",
    from: `from "vscode-jsonrpc/node"`,
    to: `from "vscode-jsonrpc/node.js"`,
  },
];

for (const { file, from, to } of targets) {
  const filePath = resolve(root, file);
  try {
    let content = readFileSync(filePath, "utf8");
    if (content.includes(to)) continue; // already patched
    if (!content.includes(from)) continue; // nothing to patch

    content = content.replaceAll(from, to);
    writeFileSync(filePath, content, "utf8");
    console.log(`[postinstall] patched: ${file}`);
  } catch (err) {
    if (err.code === "ENOENT") continue; // dependency not installed yet
    throw err;
  }
}
