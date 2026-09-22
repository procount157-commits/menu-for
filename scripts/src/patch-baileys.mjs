/**
 * Patches @whiskeysockets/baileys to use Arabic locale instead of en/US.
 * Run this after every `pnpm install`:
 *   node scripts/src/patch-baileys.mjs
 *
 * What it changes in validate-connection.js:
 *   localeLanguageIso6391: 'en'  →  'ar'
 *   device: 'Desktop'            →  'iPhone'
 */
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const baileysPkg = require.resolve("@whiskeysockets/baileys/package.json");
const baileysRoot = dirname(baileysPkg);
const target = resolve(baileysRoot, "lib/Utils/validate-connection.js");

let src = readFileSync(target, "utf8");
let changed = 0;

const replacements = [
  [/localeLanguageIso6391:\s*'en'/g,  "localeLanguageIso6391: 'ar'"],
  [/device:\s*'Desktop'/g,            "device: 'iPhone'"],
];

for (const [from, to] of replacements) {
  const next = src.replace(from, to);
  if (next !== src) { src = next; changed++; }
}

if (changed > 0) {
  writeFileSync(target, src, "utf8");
  console.log(`✓ Baileys patched (${changed} replacement${changed > 1 ? "s" : ""}) → ar / iPhone`);
} else {
  console.log("ℹ Baileys already patched — no changes needed");
}
