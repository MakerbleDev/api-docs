/**
 * check-site.mjs — guards the docs site against accidental regressions.
 *
 * Boots server.js and checks that the routes and Makerble branding are intact.
 * Run with `npm run check`; CI runs it on every pull request.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;
const failures = [];
const fail = (msg) => failures.push(msg);

// ─── Static checks ───────────────────────────────────────────────────────────

for (const f of ["assets/makerble-logo.png", "assets/favicon.png", "openapi.yaml"]) {
  if (!existsSync(join(root, f))) fail(`${f} is missing`);
}

const vercel = readFileSync(join(root, "vercel.json"), "utf8");
for (const f of ["assets/**", "openapi.yaml"]) {
  if (!vercel.includes(f)) fail(`vercel.json no longer bundles "${f}" (includeFiles)`);
}

// ─── Runtime checks ──────────────────────────────────────────────────────────

const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PRISM_PORT: "4999" },
  stdio: "ignore",
});

async function get(path) {
  for (let i = 0; i < 30; i++) {
    try { return await fetch(`http://localhost:${PORT}${path}`); }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`server never answered ${path}`);
}

try {
  const page = await get("/");
  const html = await page.text();
  if (page.status !== 200) fail(`/ returned ${page.status}`);

  const brand = {
    "Makerble logo":     "/assets/makerble-logo.png",
    "favicon link":      'rel="icon"',
    "Quicksand font":    "family=Quicksand",
    "navy text #2d3e58": "#2d3e58",
    "purple accent #ac3898": "#ac3898",
  };
  for (const [name, marker] of Object.entries(brand)) {
    if (!html.includes(marker)) fail(`docs page lost the ${name} (looked for "${marker}")`);
  }

  for (const [path, type] of [
    ["/openapi.yaml", "yaml"],
    ["/favicon.png", "png"],
    ["/favicon.ico", "png"],
    ["/assets/makerble-logo.png", "png"],
  ]) {
    const res = await get(path);
    const ct = res.headers.get("content-type") || "";
    if (res.status !== 200 || !ct.includes(type)) fail(`${path} returned ${res.status} ${ct}`);
  }
} catch (e) {
  fail(e.message);
} finally {
  server.kill();
}

if (failures.length) {
  console.error("Site check failed:\n" + failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.error("\nSee CLAUDE.md — design and server changes must not ride along with docs PRs.");
  process.exit(1);
}
console.log("Site check passed: routes, spec, logo, favicon and branding are intact.");
