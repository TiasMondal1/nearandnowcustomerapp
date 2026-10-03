#!/usr/bin/env node
/**
 * Regenerates the flag table in docs/DEV_MODE.md from the live registry in lib/devFlags.ts
 * so the documentation cannot drift from the code.
 *
 * How it works: the TypeScript source is transpiled in memory (no build step) and evaluated with the
 * runtime imports stubbed (AsyncStorage, react, appExtra, logSilentFailure are only used inside
 * functions, never at module scope), then `DEV_FLAGS` + `DEV_FLAG_AREA_ORDER` are read directly.
 *
 * Usage (from the project root):
 *   node scripts/gen-dev-flags-doc.js            # rewrite the table between the markers in docs/DEV_MODE.md
 *   node scripts/gen-dev-flags-doc.js --check    # exit 1 if the doc is out of date (CI-friendly)
 *   node scripts/gen-dev-flags-doc.js --stdout   # print the table only
 *
 * Requires only `typescript` (already a devDependency). Never touches lib/devFlags.ts.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const rootDir = path.resolve(__dirname, "..");
const registryPath = path.join(rootDir, "lib", "devFlags.ts");
const docPath = path.join(rootDir, "docs", "DEV_MODE.md");
const START = "<!-- dev-flags:start -->";
const END = "<!-- dev-flags:end -->";

function loadRegistry() {
  const source = fs.readFileSync(registryPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: registryPath,
  });
  const stubs = {
    "@react-native-async-storage/async-storage": { default: {} },
    react: { useSyncExternalStore: () => undefined },
    "./appExtra": { getAppExtra: () => ({}) },
    "./logSilentFailure": { logSilentFailure: () => undefined },
  };
  const m = new Module(registryPath, null);
  m.filename = registryPath;
  m.paths = Module._nodeModulePaths(path.dirname(registryPath));
  m.require = (id) => {
    if (id in stubs) return stubs[id];
    throw new Error(`gen-dev-flags-doc: unexpected import "${id}" in lib/devFlags.ts — add a stub`);
  };
  m._compile(outputText, registryPath);
  const { DEV_FLAGS, DEV_FLAG_AREA_ORDER } = m.exports;
  if (!DEV_FLAGS || !DEV_FLAG_AREA_ORDER) throw new Error("gen-dev-flags-doc: DEV_FLAGS / DEV_FLAG_AREA_ORDER not exported");
  return { DEV_FLAGS, DEV_FLAG_AREA_ORDER };
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

function describeType(def) {
  if (def.type === "number") {
    const parts = [`number ${def.min}–${def.max}`];
    if (def.step != null) parts.push(`step ${def.step}`);
    return parts.join(", ");
  }
  if (def.type === "enum") return `enum: ${def.values.join(" / ")}`;
  if (def.type === "string") return def.placeholder ? `string (e.g. \`${def.placeholder}\`)` : "string";
  return "bool";
}

function formatDefault(def) {
  if (def.type === "string") return def.default === "" ? "`''`" : `\`${def.default}\``;
  return `\`${String(def.default)}\``;
}

function buildTable({ DEV_FLAGS, DEV_FLAG_AREA_ORDER }) {
  const names = Object.keys(DEV_FLAGS);
  const areaRank = new Map(DEV_FLAG_AREA_ORDER.map((a, i) => [a, i]));
  const sorted = names
    .map((name, idx) => ({ name, idx, def: DEV_FLAGS[name] }))
    .sort((a, b) => (areaRank.get(a.def.area) ?? 999) - (areaRank.get(b.def.area) ?? 999) || a.idx - b.idx);

  const counts = { bool: 0, number: 0, enum: 0, string: 0 };
  let simulates = 0;
  let masters = 0;
  for (const { name, def } of sorted) {
    counts[def.type] += 1;
    if (def.simulates) simulates += 1;
    if (name.endsWith("_inhibit_Feature")) masters += 1;
  }

  const lines = [];
  lines.push(
    `_Generated from \`lib/devFlags.ts\` by \`scripts/gen-dev-flags-doc.js\` — do not edit by hand. ` +
      `${names.length} flags: ${counts.bool} bool · ${counts.number} number · ${counts.enum} enum · ${counts.string} string; ` +
      `${masters} codename masters; ${simulates} marked \`simulates\` (they light the amber stripe)._`,
  );
  lines.push("");
  lines.push("| Name | Type | Default | Area | Label | Help |");
  lines.push("|---|---|---|---|---|---|");
  for (const { name, def } of sorted) {
    const marks = [def.simulates ? "simulates" : null, def.restart ? "restart" : null].filter(Boolean);
    const help = marks.length ? `${def.help} _(${marks.join(", ")})_` : def.help;
    lines.push(
      `| \`${name}\` | ${cell(describeType(def))} | ${formatDefault(def)} | ${def.area} | ${cell(def.label)} | ${cell(help)} |`,
    );
  }
  return lines.join("\n");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const table = buildTable(loadRegistry());

  if (args.has("--stdout")) {
    process.stdout.write(table + "\n");
    return;
  }

  if (!fs.existsSync(docPath)) {
    console.error(`gen-dev-flags-doc: ${path.relative(rootDir, docPath)} does not exist; create it with the markers\n  ${START}\n  ${END}`);
    process.exit(1);
  }
  const doc = fs.readFileSync(docPath, "utf8");
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error(`gen-dev-flags-doc: markers ${START} … ${END} not found in docs/DEV_MODE.md`);
    process.exit(1);
  }
  const next = doc.slice(0, start + START.length) + "\n" + table + "\n" + doc.slice(end);

  if (args.has("--check")) {
    if (next !== doc) {
      console.error("gen-dev-flags-doc: docs/DEV_MODE.md is out of date — run `npm run docs:dev-flags`");
      process.exit(1);
    }
    console.log("gen-dev-flags-doc: docs/DEV_MODE.md is up to date");
    return;
  }

  fs.writeFileSync(docPath, next, "utf8");
  console.log(`gen-dev-flags-doc: wrote ${path.relative(rootDir, docPath)}`);
}

main();
