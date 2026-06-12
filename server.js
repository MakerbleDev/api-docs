/**
 * server.js — Makerble API Documentation Server
 *
 * Routes:
 *   GET /              → Scalar API docs UI (Makerble-branded, three-column layout)
 *   GET /openapi.yaml  → Raw OpenAPI 3.0 spec (for Scalar, external tools, etc.)
 *   ALL /mock/*        → Prism mock server proxy (safe sandbox for developers)
 *   GET /health        → Health check
 *
 * The Prism mock server is spawned as a child process on startup.
 */

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT       = process.env.PORT || 3000;
const PRISM_PORT = process.env.PRISM_PORT || 4010;
const SPEC_PATH  = join(__dirname, "public", "openapi.yaml");

// ─── Spawn Prism mock server ──────────────────────────────────────────────────

let prismProcess = null;

function startPrism() {
  const prismBin = join(__dirname, "node_modules", ".bin", "prism");
  if (!existsSync(prismBin)) {
    console.warn("Prism not found — mock server disabled");
    return;
  }

  prismProcess = spawn(prismBin, [
    "mock",
    SPEC_PATH,
    "--port", String(PRISM_PORT),
    "--host", "127.0.0.1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  prismProcess.stdout.on("data", (d) => {
    const line = d.toString().trim();
    if (line.includes("listening")) console.log(`[Prism] ${line}`);
  });
  prismProcess.stderr.on("data", (d) => {
    const line = d.toString().trim();
    // Only surface actual errors, not verbose per-request logs
    if (line.includes("error") || line.includes("Error")) console.error(`[Prism] ${line}`);
  });
  prismProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[Prism] exited with code ${code}`);
  });

  console.log(`[Prism] Mock server starting on port ${PRISM_PORT}…`);
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", mock: `http://localhost:${PRISM_PORT}` });
});

// Raw spec — served with permissive CORS so Scalar CDN can fetch it
app.get("/openapi.yaml", (_req, res) => {
  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(SPEC_PATH);
});

// Mock proxy — strip /mock prefix, forward to Prism
app.use("/mock", createProxyMiddleware({
  target: `http://127.0.0.1:${PRISM_PORT}`,
  changeOrigin: true,
  pathRewrite: { "^/mock": "" },
  on: {
    error: (_err, _req, res) => {
      res.status(503).json({
        error: "Mock server unavailable. It may still be starting up — try again in a moment.",
      });
    },
  },
}));

// Docs UI — served from root
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildDocsPage());
});

// ─── Docs page builder ────────────────────────────────────────────────────────

function buildDocsPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Makerble API Reference</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ── Reset ─────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Makerble token system ──────────────────────
       Primary blue   #4a8ac9  — links, active states, method badges (GET)
       Deep navy      #1d3448  — sidebar bg, code panels
       Green          #22b573  — POST badges, success
       Pink           #ea409d  — logo accent
       Red            #ff3f45  — DELETE badges
       Orange         #ff771b  — PATCH/PUT badges
       Purple         #ab3897  — headers, section labels
       Surface        #f7f9fc  — page background
       Code dark      #111d27  — code panel bg
    ──────────────────────────────────────────────── */

    :root {
      --brand-blue:    #4a8ac9;
      --brand-navy:    #1d3448;
      --brand-navy-2:  #243d54;   /* slightly lighter for hover states */
      --brand-green:   #22b573;
      --brand-pink:    #ea409d;
      --brand-red:     #ff3f45;
      --brand-orange:  #ff771b;
      --brand-purple:  #ab3897;
      --brand-violet:  #7e6cb0;
      --surface:       #f7f9fc;
      --surface-2:     #eef1f6;
      --code-bg:       #111d27;
      --code-bg-2:     #0d1820;
      --text-primary:  #1a2535;
      --text-secondary: #4a5568;
      --text-muted:    #718096;
      --text-light:    #a0aec0;
      --border:        #e2e8f0;
      --border-dark:   #2d4a65;
      --nav-text:      rgba(255,255,255,0.7);
      --nav-text-active: #ffffff;
      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
      --sidebar-w: 260px;
      --content-max: 720px;
      --panel-w: 380px;
      --radius: 6px;
      --radius-lg: 10px;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--font-sans);
      background: var(--surface);
      color: var(--text-primary);
      line-height: 1.6;
      font-size: 15px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Layout shell ───────────────────────────── */

    .layout {
      display: grid;
      grid-template-columns: var(--sidebar-w) 1fr var(--panel-w);
      grid-template-rows: auto 1fr;
      min-height: 100vh;
    }

    /* ── Top bar (spans all columns) ─────────────── */

    .topbar {
      grid-column: 1 / -1;
      background: var(--brand-navy);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 56px;
      border-bottom: 1px solid var(--border-dark);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }

    .topbar-logo {
      width: 30px;
      height: 30px;
    }

    .topbar-name {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.02em;
    }

    .topbar-name span {
      color: var(--brand-pink);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .topbar-badge {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--brand-blue);
      background: rgba(74, 138, 201, 0.15);
      border: 1px solid rgba(74, 138, 201, 0.3);
      border-radius: 20px;
      padding: 3px 10px;
    }

    .topbar-link {
      font-size: 13px;
      color: var(--nav-text);
      text-decoration: none;
      transition: color 0.15s;
    }
    .topbar-link:hover { color: var(--nav-text-active); }

    .mock-btn {
      font-size: 12px;
      font-weight: 600;
      color: var(--brand-green);
      background: rgba(34, 181, 115, 0.12);
      border: 1px solid rgba(34, 181, 115, 0.3);
      border-radius: 20px;
      padding: 4px 12px;
      text-decoration: none;
      transition: background 0.15s;
      cursor: pointer;
    }
    .mock-btn:hover { background: rgba(34, 181, 115, 0.2); }

    /* ── Sidebar ─────────────────────────────────── */

    .sidebar {
      background: var(--brand-navy);
      position: sticky;
      top: 56px;
      height: calc(100vh - 56px);
      overflow-y: auto;
      padding: 20px 0 40px;
      scrollbar-width: thin;
      scrollbar-color: var(--border-dark) transparent;
    }

    .sidebar::-webkit-scrollbar { width: 4px; }
    .sidebar::-webkit-scrollbar-track { background: transparent; }
    .sidebar::-webkit-scrollbar-thumb { background: var(--border-dark); border-radius: 2px; }

    .nav-section {
      margin-bottom: 2px;
    }

    .nav-section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.35);
      padding: 16px 20px 6px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 20px;
      font-size: 13px;
      color: var(--nav-text);
      text-decoration: none;
      transition: background 0.1s, color 0.1s;
      border-left: 2px solid transparent;
    }

    .nav-link:hover {
      background: rgba(255,255,255,0.06);
      color: var(--nav-text-active);
    }

    .nav-link.active {
      background: rgba(74, 138, 201, 0.15);
      color: var(--nav-text-active);
      border-left-color: var(--brand-blue);
    }

    .nav-method {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      border-radius: 3px;
      padding: 1px 5px;
      flex-shrink: 0;
    }

    /* ── Main content column ─────────────────────── */

    .content {
      padding: 40px 48px 80px;
      min-width: 0;
      max-width: calc(var(--content-max) + 96px);
    }

    /* ── Right panel (code column) ───────────────── */

    .panel {
      background: var(--code-bg);
      position: sticky;
      top: 56px;
      height: calc(100vh - 56px);
      overflow-y: auto;
      padding: 0;
      border-left: 1px solid rgba(255,255,255,0.05);
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    .panel::-webkit-scrollbar { width: 4px; }
    .panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }

    .panel-intro {
      padding: 28px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .panel-intro h3 {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.35);
      margin-bottom: 12px;
    }

    .code-block {
      background: var(--code-bg-2);
      border-radius: var(--radius);
      padding: 14px 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.7;
      color: #c9d8e8;
      overflow-x: auto;
      margin-bottom: 12px;
      border: 1px solid rgba(255,255,255,0.06);
    }

    .code-block .cm { color: #6a8fa8; }   /* comments */
    .code-block .k  { color: var(--brand-blue); }   /* keywords */
    .code-block .s  { color: #8fcf8e; }   /* strings */
    .code-block .n  { color: #f0c97a; }   /* numbers */
    .code-block .kw { color: var(--brand-pink); }  /* special keywords */

    .panel-mock-note {
      margin: 0 24px 20px;
      padding: 10px 12px;
      background: rgba(34, 181, 115, 0.08);
      border: 1px solid rgba(34, 181, 115, 0.2);
      border-radius: var(--radius);
      font-size: 12px;
      color: rgba(255,255,255,0.6);
      line-height: 1.5;
    }

    .panel-mock-note strong { color: var(--brand-green); }

    /* ── Content typography ──────────────────────── */

    .section {
      margin-bottom: 64px;
      padding-bottom: 64px;
      border-bottom: 1px solid var(--border);
    }

    .section:last-child {
      border-bottom: none;
    }

    .section-eyebrow {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--brand-purple);
      margin-bottom: 8px;
    }

    .section-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--text-primary);
      margin-bottom: 16px;
      line-height: 1.25;
    }

    .section-desc {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.7;
      max-width: 600px;
    }

    .section-desc p { margin-bottom: 12px; }
    .section-desc p:last-child { margin-bottom: 0; }

    .section-desc code {
      font-family: var(--font-mono);
      font-size: 13px;
      background: var(--surface-2);
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--brand-blue);
      border: 1px solid var(--border);
    }

    /* ── Endpoint cards ──────────────────────────── */

    .endpoint-list {
      margin-top: 28px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .endpoint-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: #fff;
      transition: box-shadow 0.15s;
    }

    .endpoint-card:hover {
      box-shadow: 0 2px 12px rgba(0,0,0,0.07);
    }

    .endpoint-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px 20px;
      cursor: pointer;
      user-select: none;
    }

    .method-badge {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      border-radius: 5px;
      padding: 3px 8px;
      flex-shrink: 0;
      margin-top: 1px;
      font-family: var(--font-mono);
    }

    .method-GET    { background: rgba(74,138,201,0.12);  color: #2e72b8; border: 1px solid rgba(74,138,201,0.25); }
    .method-POST   { background: rgba(34,181,115,0.12);  color: #1a9068; border: 1px solid rgba(34,181,115,0.25); }
    .method-DELETE { background: rgba(255,63,69,0.1);    color: #c92d33; border: 1px solid rgba(255,63,69,0.2); }
    .method-PATCH  { background: rgba(255,119,27,0.1);   color: #d4610d; border: 1px solid rgba(255,119,27,0.2); }
    .method-PUT    { background: rgba(255,172,36,0.12);  color: #a86b00; border: 1px solid rgba(255,172,36,0.25); }

    .endpoint-path {
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--text-primary);
      font-weight: 500;
    }

    .endpoint-summary {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .endpoint-body {
      display: none;
      padding: 0 20px 20px;
      border-top: 1px solid var(--border);
    }

    .endpoint-body.open { display: block; }

    .endpoint-desc {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.7;
      padding: 14px 0 4px;
    }

    .endpoint-desc code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--surface-2);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--brand-blue);
    }

    .endpoint-desc table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 13px;
    }

    .endpoint-desc th {
      text-align: left;
      font-weight: 600;
      color: var(--text-primary);
      padding: 6px 10px;
      background: var(--surface-2);
      border: 1px solid var(--border);
    }

    .endpoint-desc td {
      padding: 6px 10px;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      vertical-align: top;
    }

    .endpoint-desc td code {
      background: var(--surface-2);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11px;
    }

    .endpoint-desc strong { color: var(--text-primary); }

    .endpoint-desc blockquote {
      border-left: 3px solid var(--brand-blue);
      padding: 8px 14px;
      margin: 10px 0;
      background: rgba(74,138,201,0.05);
      border-radius: 0 var(--radius) var(--radius) 0;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .params-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 14px;
    }

    .params-table th {
      text-align: left;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 0 10px 6px 0;
      border-bottom: 1px solid var(--border);
    }

    .params-table td {
      padding: 8px 10px 8px 0;
      border-bottom: 1px solid var(--surface-2);
      vertical-align: top;
    }

    .param-name {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--brand-blue);
      font-weight: 500;
    }

    .param-type {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .param-required {
      font-size: 10px;
      font-weight: 600;
      color: var(--brand-red);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .param-desc { color: var(--text-secondary); }

    .subsection-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 18px 0 8px;
    }

    /* ── Info tables ────────────────────────────── */

    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin: 20px 0;
    }

    .info-table th {
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      padding: 8px 12px 8px 0;
      border-bottom: 2px solid var(--border);
    }

    .info-table td {
      padding: 9px 12px 9px 0;
      border-bottom: 1px solid var(--surface-2);
      color: var(--text-secondary);
      vertical-align: top;
    }

    .info-table td:first-child {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--brand-blue);
      white-space: nowrap;
    }

    /* ── Auth pill ──────────────────────────────── */

    .auth-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(171, 56, 151, 0.08);
      border: 1px solid rgba(171, 56, 151, 0.2);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--brand-purple);
      margin-bottom: 20px;
    }

    .auth-pill svg { width: 13px; height: 13px; }

    /* ── Callout boxes ──────────────────────────── */

    .callout {
      padding: 12px 16px;
      border-radius: var(--radius);
      font-size: 14px;
      margin: 16px 0;
      display: flex;
      gap: 10px;
      line-height: 1.55;
    }

    .callout-info    { background: rgba(74,138,201,0.08); border: 1px solid rgba(74,138,201,0.2); color: #1e4a7a; }
    .callout-tip     { background: rgba(34,181,115,0.08); border: 1px solid rgba(34,181,115,0.2); color: #0e5535; }
    .callout-warning { background: rgba(255,172,36,0.08); border: 1px solid rgba(255,172,36,0.25); color: #7a4a00; }

    .callout-icon { flex-shrink: 0; font-size: 16px; }

    /* ── Mock banner ────────────────────────────── */

    .mock-banner {
      background: linear-gradient(135deg, rgba(34,181,115,0.08) 0%, rgba(74,138,201,0.08) 100%);
      border: 1px solid rgba(34,181,115,0.25);
      border-radius: var(--radius-lg);
      padding: 20px 24px;
      margin-bottom: 32px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .mock-banner-icon {
      width: 40px;
      height: 40px;
      background: rgba(34,181,115,0.12);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 20px;
    }

    .mock-banner h3 {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 4px;
    }

    .mock-banner p {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin-bottom: 8px;
    }

    .mock-url {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(255,255,255,0.7);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 5px 10px;
      color: var(--brand-blue);
      display: inline-block;
    }

    /* ── Responses ──────────────────────────────── */

    .response-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid var(--surface-2);
      font-size: 13px;
    }

    .response-code {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .response-2xx { background: rgba(34,181,115,0.1);  color: #1a9068; }
    .response-4xx { background: rgba(255,63,69,0.1);   color: #c92d33; }
    .response-5xx { background: rgba(255,119,27,0.1);  color: #d4610d; }

    .response-desc { color: var(--text-secondary); }

    /* ── Intro hero ─────────────────────────────── */

    .intro-hero {
      margin-bottom: 40px;
    }

    .version-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--brand-blue);
      border: 1px solid rgba(74,138,201,0.25);
      border-radius: 20px;
      padding: 3px 10px;
      margin-bottom: 16px;
    }

    .intro-hero h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.04em;
      color: var(--text-primary);
      line-height: 1.2;
      margin-bottom: 14px;
    }

    .intro-hero h1 span { color: var(--brand-blue); }

    .intro-hero p {
      font-size: 16px;
      color: var(--text-secondary);
      line-height: 1.7;
      max-width: 560px;
    }

    .quick-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 20px;
    }

    .quick-link {
      font-size: 13px;
      font-weight: 500;
      color: var(--brand-blue);
      text-decoration: none;
      padding: 6px 14px;
      border: 1px solid rgba(74,138,201,0.25);
      border-radius: 20px;
      background: rgba(74,138,201,0.05);
      transition: background 0.15s, border-color 0.15s;
    }

    .quick-link:hover {
      background: rgba(74,138,201,0.12);
      border-color: rgba(74,138,201,0.4);
    }

    /* ── Responsive ─────────────────────────────── */

    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: var(--sidebar-w) 1fr;
        grid-template-rows: auto 1fr;
      }
      .panel { display: none; }
    }

    @media (max-width: 760px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .content { padding: 24px 20px 60px; }
    }
  </style>
</head>
<body>
  <div class="layout">

    <!-- Top bar -->
    <header class="topbar">
      <a href="/" class="topbar-brand">
        <!-- Makerble wordmark as SVG — M in brand blue + "makerble" -->
        <svg class="topbar-logo" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="30" height="30" rx="7" fill="#4a8ac9"/>
          <path d="M6 22V10l6 7 6-7v12M21 10v12" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="topbar-name">maker<span>ble</span></span>
      </a>
      <div class="topbar-right">
        <span class="topbar-badge">API v2</span>
        <a href="/openapi.yaml" class="topbar-link" target="_blank">OpenAPI spec ↗</a>
        <a href="/mock" class="mock-btn" id="mockBtnTop">⬡ Try mock API</a>
        <a href="https://discover.makerble.com" class="topbar-link" target="_blank">Makerble.com ↗</a>
      </div>
    </header>

    <!-- Left sidebar navigation -->
    <nav class="sidebar" id="sidebar">
      <div class="nav-section">
        <div class="nav-section-label">Getting started</div>
        <a href="#introduction"    class="nav-link active">Introduction</a>
        <a href="#authentication"  class="nav-link">Authentication</a>
        <a href="#pagination"      class="nav-link">Pagination</a>
        <a href="#terminology"     class="nav-link">Terminology</a>
        <a href="#mock-server"     class="nav-link">Mock server</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Core resources</div>
        <a href="#organisations"   class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Organisations</a>
        <a href="#projects"        class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Projects</a>
        <a href="#users"           class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Users</a>
        <a href="#contacts"        class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Contacts</a>
        <a href="#contact-forms"   class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Contact Bio Forms</a>
        <a href="#cases"           class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Cases</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Surveys &amp; stories</div>
        <a href="#surveys"         class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Surveys</a>
        <a href="#stories"         class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Stories</a>
        <a href="#story-metrics"   class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Story Metrics</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Impact framework</div>
        <a href="#changes"         class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Changes</a>
        <a href="#indicators"      class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Indicators</a>
        <a href="#outcomes"        class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Outcomes</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Reference data</div>
        <a href="#ratio-sets"      class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Ratio Sets</a>
        <a href="#case-forms"      class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Case Forms</a>
      </div>
    </nav>

    <!-- Main content -->
    <main class="content">

      <!-- Introduction -->
      <section class="section" id="introduction">
        <div class="intro-hero">
          <div class="version-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            API Reference v2.0.0
          </div>
          <h1>Makerble <span>API</span></h1>
          <p>The Makerble API gives you programmatic access to your CRM and impact measurement data — contacts, projects, surveys, cases, outcomes, and more.</p>
          <div class="quick-links">
            <a href="#authentication" class="quick-link">→ Authentication</a>
            <a href="#mock-server" class="quick-link">→ Try the mock server</a>
            <a href="#contacts" class="quick-link">→ Create a contact</a>
            <a href="#stories" class="quick-link">→ Post a story</a>
            <a href="/openapi.yaml" class="quick-link" target="_blank">↓ Download spec</a>
          </div>
        </div>

        <table class="info-table">
          <thead><tr><th>Property</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Base URL</td><td><code style="font-family:var(--font-mono);font-size:13px;background:var(--surface-2);padding:2px 6px;border-radius:4px;color:var(--brand-blue);border:1px solid var(--border)">https://makerble.com/api/v2</code></td></tr>
            <tr><td>Staging URL</td><td><code style="font-family:var(--font-mono);font-size:13px;background:var(--surface-2);padding:2px 6px;border-radius:4px;color:var(--brand-blue);border:1px solid var(--border)">https://staging.makerble.com/api/v2</code></td></tr>
            <tr><td>Mock URL</td><td><code style="font-family:var(--font-mono);font-size:13px;background:var(--surface-2);padding:2px 6px;border-radius:4px;color:#1a9068;border:1px solid var(--border)">${"{{HOST}}"}/mock</code></td></tr>
            <tr><td>Protocol</td><td>HTTPS · JSON · REST</td></tr>
            <tr><td>Auth</td><td>Token-based headers — <code style="font-family:var(--font-mono);font-size:12px;background:var(--surface-2);padding:1px 5px;border-radius:3px;color:var(--brand-blue)">X-User-Email</code> + <code style="font-family:var(--font-mono);font-size:12px;background:var(--surface-2);padding:1px 5px;border-radius:3px;color:var(--brand-blue)">X-User-Token</code></td></tr>
            <tr><td>Spec</td><td><a href="/openapi.yaml" style="color:var(--brand-blue)">openapi.yaml</a> · OpenAPI 3.0.3</td></tr>
          </tbody>
        </table>
      </section>

      <!-- Authentication -->
      <section class="section" id="authentication">
        <div class="section-eyebrow">Security</div>
        <h2 class="section-title">Authentication</h2>
        <div class="section-desc">
          <p>Obtain a token by calling <code>POST /users/sign_in</code>. Tokens are long-lived and do not expire — each user has one fixed token.</p>
          <p>Pass both headers on every authenticated request:</p>
        </div>

        <table class="info-table" style="margin-top:20px">
          <thead><tr><th>Header</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>X-User-Email</td><td>Your Makerble account email address</td></tr>
            <tr><td>X-User-Token</td><td>Your authentication token from <code>POST /users/sign_in</code></td></tr>
          </tbody>
        </table>

        <div class="callout callout-info" style="margin-top:20px">
          <span class="callout-icon">ℹ</span>
          <span><strong>Multi-user integrations:</strong> If you need activity attributed to specific users, authenticate separately per user. A single Organisation Admin token is fine when attribution to a single admin is acceptable.</span>
        </div>

        <div class="endpoint-list">
          <div class="endpoint-card">
            <div class="endpoint-header" onclick="toggle(this)">
              <span class="method-badge method-POST">POST</span>
              <div>
                <div class="endpoint-path">/users/sign_in</div>
                <div class="endpoint-summary">Authenticate — obtain a token</div>
              </div>
            </div>
            <div class="endpoint-body">
              <div class="endpoint-desc">
                <p>Submit your email and password to receive your authentication token. Use this token in the <code>X-User-Token</code> header on all subsequent requests.</p>
              </div>
              <div class="subsection-label">Request body (form-urlencoded)</div>
              <table class="params-table">
                <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
                <tbody>
                  <tr>
                    <td><span class="param-name">user[email]</span></td>
                    <td><span class="param-type">string</span></td>
                    <td><span class="param-required">required</span></td>
                    <td class="param-desc">Your Makerble email address</td>
                  </tr>
                  <tr>
                    <td><span class="param-name">user[password]</span></td>
                    <td><span class="param-type">string</span></td>
                    <td><span class="param-required">required</span></td>
                    <td class="param-desc">Your Makerble password</td>
                  </tr>
                </tbody>
              </table>
              <div class="subsection-label">Responses</div>
              <div class="response-row"><span class="response-code response-2xx">200</span><span class="response-desc">Returns <code>user_id</code>, <code>email</code>, and <code>authentication_token</code></span></div>
              <div class="response-row"><span class="response-code response-4xx">401</span><span class="response-desc">Invalid credentials</span></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Pagination -->
      <section class="section" id="pagination">
        <div class="section-eyebrow">Reference</div>
        <h2 class="section-title">Pagination</h2>
        <div class="section-desc">
          <p>All list endpoints support cursor-free offset pagination. The maximum <code>per_page</code> is 200.</p>
        </div>
        <table class="info-table" style="margin-top:20px">
          <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Max</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>page</td><td>integer</td><td>1</td><td>—</td><td>Page number</td></tr>
            <tr><td>per_page</td><td>integer</td><td>10</td><td>200</td><td>Records per page</td></tr>
            <tr><td>last_sync_datetime</td><td>string</td><td>—</td><td>—</td><td>ISO 8601 datetime — return only records updated after this value. Useful for incremental sync.</td></tr>
          </tbody>
        </table>
        <div class="callout callout-tip" style="margin-top:20px">
          <span class="callout-icon">✓</span>
          <span>All paginated responses wrap results in: <code>{ page, page_size, page_count, total_count, data: [] }</code></span>
        </div>
      </section>

      <!-- Terminology -->
      <section class="section" id="terminology">
        <div class="section-eyebrow">Reference</div>
        <h2 class="section-title">Terminology</h2>
        <div class="section-desc">
          <p>Makerble uses different terms in the front-end UI and the API. The API uses the back-end terms listed below.</p>
        </div>
        <table class="info-table" style="margin-top:20px">
          <thead><tr><th>Front-end (UI)</th><th>API (back-end)</th></tr></thead>
          <tbody>
            <tr><td>Organisation</td><td>Charity</td></tr>
            <tr><td>Contact</td><td>Beneficiary</td></tr>
            <tr><td>Contact Bio Form</td><td>Beneficiary Category</td></tr>
            <tr><td>Survey</td><td>Story Category</td></tr>
            <tr><td>Survey Campaign</td><td>Project Story Category</td></tr>
            <tr><td>Survey Response / Timeline Update</td><td>Story</td></tr>
            <tr><td>Activity / Engagement tracker</td><td>Change (stage: activity / participation)</td></tr>
            <tr><td>Achievement / Choice / Numerical tracker</td><td>Indicator (type: binary / scale / value)</td></tr>
            <tr><td>Dropdown / List field</td><td>Ratio Set</td></tr>
            <tr><td>Answer Choice</td><td>Sub Ratio</td></tr>
            <tr><td>Case Form</td><td>Custom Field Category</td></tr>
          </tbody>
        </table>
      </section>

      <!-- Mock server -->
      <section class="section" id="mock-server">
        <div class="section-eyebrow">Developer tools</div>
        <h2 class="section-title">Mock server</h2>
        <div class="section-desc">
          <p>A Prism-powered mock server is running alongside these docs. It reads the OpenAPI spec and returns realistic example responses — safe to call without touching any real Makerble data.</p>
        </div>

        <div class="mock-banner">
          <div class="mock-banner-icon">⬡</div>
          <div>
            <h3>Mock server is live</h3>
            <p>Use this base URL in place of <code>https://makerble.com/api/v2</code> for safe testing:</p>
            <code class="mock-url" id="mockUrl">/mock</code>
          </div>
        </div>

        <div class="callout callout-info">
          <span class="callout-icon">ℹ</span>
          <span>The mock server enforces authentication headers. Pass any non-empty values for <code>X-User-Email</code> and <code>X-User-Token</code> to receive 200 responses rather than 401s.</span>
        </div>

        <div class="subsection-label">Example curl request to the mock</div>
        <pre class="code-block"><span class="k">curl</span> <span class="s">${"{{HOST}}"}/mock/beneficiary_types</span> \
  <span class="cm">-H</span> <span class="s">"X-User-Email: test@example.com"</span> \
  <span class="cm">-H</span> <span class="s">"X-User-Token: mock-token"</span></pre>
      </section>

      <!-- Organisations -->
      <section class="section" id="organisations">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Organisations</h2>
        <div class="section-desc">
          <p>Organisations (called Charities in the API) are the top-level entity. Each Organisation owns one or more Projects, and all data ultimately belongs to an Organisation.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/charities/{id}", "Get a single Organisation", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Organisation ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Charity record with id, name, timestamps" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
        </div>
      </section>

      <!-- Projects -->
      <section class="section" id="projects">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Projects</h2>
        <div class="section-desc">
          <p>Every Story and Case on Makerble belongs to a Project. A Project belongs to a single Organisation. Users hold one of three roles per Project: <strong>Editor</strong> (Manager), <strong>Reporter</strong> (Changemaker), or <strong>Observer</strong> (Analyst).</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/projects", "List all Projects", true, [
            { name: "page", type: "integer", required: false, desc: "Page number (default 1)" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 — return only records updated after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Projects" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" }
          ])}
          ${endpointCard("GET", "/projects/{id}", "Get a single Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Project record" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("POST", "/projects/add_colleague.json", "Add users to a Project", true, [], [
            { code: "200", cls: "response-2xx", desc: "Users added successfully" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Grant one or more users a role on a Project. A user can hold Editor, Reporter, and Observer simultaneously. Pass user IDs in <code>role_data[].editor_ids</code>, <code>reporter_ids</code>, or <code>observer_ids</code>.")}
        </div>
      </section>

      <!-- Users -->
      <section class="section" id="users">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Users</h2>
        <div class="section-desc">
          <p>Platform users with login credentials. Creating users requires a separate API Key — request one at <a href="mailto:api-key-request@makerble.com" style="color:var(--brand-blue)">api-key-request@makerble.com</a>.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/users", "List all Users", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Users" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" }
          ])}
          ${endpointCard("GET", "/users/{id}", "Get a single User", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "User ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "User record" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("POST", "/users", "Create a new User", false, [], [
            { code: "200", cls: "response-2xx", desc: "User created — returns id and email" },
            { code: "422", cls: "response-4xx", desc: "Validation failed (check password requirements)" }
          ], "Requires an <code>auth_code</code> API Key. Password must be 8+ chars with at least one number, special character, and capital letter.")}
        </div>
      </section>

      <!-- Contacts (Beneficiaries) -->
      <section class="section" id="contacts">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Contacts</h2>
        <div class="section-desc">
          <p>Contacts (Beneficiaries in the API) are the people your organisation works with. Each Contact belongs to an Organisation and can be enrolled in multiple Projects. Custom fields are defined per Contact Bio Form.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Call <code>GET /beneficiary_types</code> to get the <code>beneficiary_type_id</code> (1=Person, 2=Object, 3=Organisation, 4=Animal) and <code>GET /custom_fields</code> to discover custom field IDs before creating a Contact.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/beneficiaries", "List all Contacts", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "charity_id", type: "integer", required: false, desc: "Filter to Contacts in this Organisation" },
            { name: "project_id", type: "integer", required: false, desc: "Filter to Contacts enrolled in this Project" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Contacts including custom fields" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" }
          ])}
          ${endpointCard("GET", "/beneficiaries/{id}", "Get a single Contact", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Contact ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Full Contact profile with all custom fields" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("POST", "/beneficiaries", "Create a Contact", true, [], [
            { code: "200", cls: "response-2xx", desc: "Contact created" },
            { code: "422", cls: "response-4xx", desc: "Validation failed (name and owner_id are required)" }
          ], "Required fields: <code>beneficiary.name</code>, <code>beneficiary.owner_id</code> (User ID of the record owner). Submit custom field values as <code>custom_fields: {\"field_id\": \"value\"}</code>.")}
          ${endpointCard("GET", "/beneficiaries/impact_box_data", "Get Impact Box data (Progress Trackers per Contact)", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Aggregated metric progress per Contact" }
          ], "Returns the data shown in the Progress Trackers box on a Contact Profile — total impact progress attributed to each Contact across all Changes and Indicators.")}
          ${endpointCard("GET", "/beneficiary_types", "List Contact Types", true, [], [
            { code: "200", cls: "response-2xx", desc: "Person (1), Object (2), Organisation (3), Animal (4)" }
          ])}
          ${endpointCard("GET", "/project_beneficiaries", "List Project–Contact associations", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Join table records" }
          ])}
        </div>
      </section>

      <!-- Contact Bio Forms -->
      <section class="section" id="contact-forms">
        <div class="section-eyebrow">Schema</div>
        <h2 class="section-title">Contact Bio Forms</h2>
        <div class="section-desc">
          <p>Contact Bio Forms (Beneficiary Categories in the API) define the custom fields available when creating or editing a Contact. Use these endpoints to discover field IDs before calling <code>POST /beneficiaries</code>.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/beneficiary_categories", "List all Contact Bio Forms", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list of forms" }])}
          ${endpointCard("GET", "/beneficiary_categories/{id}", "Get a single Contact Bio Form", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Form ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Form schema" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("GET", "/custom_fields", "List custom field definitions", true, [
            { name: "beneficiary_category_ids[]", type: "integer", required: false, desc: "Filter by Contact Bio Form ID (repeat for multiple)" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Field definitions with IDs, names, and types" }])}
        </div>
      </section>

      <!-- Cases -->
      <section class="section" id="cases">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Cases</h2>
        <div class="section-desc">
          <p>Cases are structured records for a specific Contact within a Project. Each Case has a Case Owner (creator) and optional Case Workers. Case fields are defined by a Case Form (Custom Field Category).</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Call <code>GET /custom_field_categories</code> to discover field definition IDs before creating a Case.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/cases", "List all Cases", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list of Cases" }])}
          ${endpointCard("POST", "/cases", "Create a Case", true, [], [
            { code: "200", cls: "response-2xx", desc: "Case created" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Required: <code>project_id</code>, <code>beneficiary_id</code>. Submit case form values in <code>custom_field_categories_definition: {field_definition_id: value}</code>.")}
          ${endpointCard("GET", "/custom_field_categories", "List Case Forms (field schemas)", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Case Form schemas with field definition IDs" }])}
          ${endpointCard("GET", "/projects_beneficiaries_cases", "List Project–Contact–Case associations", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Join table records" }])}
        </div>
      </section>

      <!-- Surveys -->
      <section class="section" id="surveys">
        <div class="section-eyebrow">Surveys &amp; Stories</div>
        <h2 class="section-title">Surveys</h2>
        <div class="section-desc">
          <p>Surveys (Story Categories in the API) are the form templates used to create Stories. A Survey must be deployed as a Survey Campaign (Project Story Category) before Stories can be created with it in a Project.</p>
        </div>
        <div class="callout callout-warning">
          <span class="callout-icon">⚠</span>
          <span><strong>Always call <code>GET /story_categories/:id</code> before posting a Story.</strong> It returns the survey's fields, Indicator IDs, Outcome IDs, and valid Sub Ratio IDs — all of which are required in the Story payload.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/story_categories", "List all Surveys", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list of Surveys" }])}
          ${endpointCard("GET", "/story_categories/{id}", "Get a Survey with full field detail", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Survey ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Survey with current_fields, scale_indicator_choices, and verdict_data" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ], "Returns all questions in order (<code>current_fields</code>), the choice type (single/multiple) for each Scale Indicator (<code>scale_indicator_choices</code>), and scoring bands (<code>verdict_data</code>).")}
          ${endpointCard("GET", "/story_categories/{id}/verdicts", "Get verdict scores for a Survey Campaign", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Survey ID" },
            { name: "project_id", type: "integer", required: true, desc: "Project the Survey Campaign belongs to" },
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Total points per Contact per submission, grouped by beneficiary" }])}
          ${endpointCard("GET", "/project_story_categories", "List Survey Campaigns", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Surveys deployed to specific Projects" }])}
        </div>
      </section>

      <!-- Stories -->
      <section class="section" id="stories">
        <div class="section-eyebrow">Surveys &amp; Stories</div>
        <h2 class="section-title">Stories</h2>
        <div class="section-desc">
          <p>Stories are the primary content format on Makerble — they capture text, media, and progress towards Changes and Indicators, and can be tagged to Contacts. Every Story belongs to a Project and is created using a Survey.</p>
          <p><strong>Story timestamps:</strong> <code>actual_created_at</code> = Date Posted (database time) · <code>created_at</code> = Date Happened (user-selected, can be backdated) · <code>updated_at</code> = Date Edited.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/stories", "List all Stories", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list of Stories with custom fields and beneficiary IDs" }])}
          ${endpointCard("GET", "/stories/{id}", "Get a single Story", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Story ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Full Story with custom_fields, case_ids, story_indicator_beneficiaries, story_changes, verdict_scores" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("POST", "/stories", "Create a Story", true, [], [
            { code: "200", cls: "response-2xx", desc: "Story created" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], `Creates a Story tagged to zero, one, or multiple Contacts. Required: <code>story.project_id</code>, <code>story.story_category_id</code>, <code>story.story_group: "change_created"</code>, <code>story.story_format: "old"</code>.
          <br/><br/>Use <code>story_indicator_beneficiaries</code> for indicator responses, <code>story_changes</code> for metric totals, and <code>custom_fields</code> for survey text/date/time fields.
          <br/><br/>For binary indicators: include <code>binray_indicator_value: "on"</code> if ticked — omit the record entirely if not ticked. Activity Changes cannot be tagged to individual Contacts.`)}
          ${endpointCard("GET", "/stories/story_category_response", "Get Stories with full survey response detail", true, [
            { name: "story_category_id", type: "integer", required: false, desc: "Filter by Survey" },
            { name: "project_ids[]", type: "integer", required: false, desc: "Filter by Project ID (repeat for multiple)" },
            { name: "start_date", type: "string", required: false, desc: "YYYY-MM-DD — stories on or after this date" },
            { name: "end_date", type: "string", required: false, desc: "YYYY-MM-DD — stories on or before this date" }
          ], [{ code: "200", cls: "response-2xx", desc: "Stories enriched with named Indicators, Changes, and Custom Field values — ideal for reporting" }])}
          ${endpointCard("GET", "/stories/{id}/attachments", "Get attachments for a Story", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Story ID" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated media attachments" }])}
        </div>
      </section>

      <!-- Story Metrics -->
      <section class="section" id="story-metrics">
        <div class="section-eyebrow">Surveys &amp; Stories</div>
        <h2 class="section-title">Story Metrics</h2>
        <div class="section-desc">
          <p>Sub-resources that record per-story metric progress. Filter by <code>story_id</code> on any of these endpoints to get all metric data for a specific Story.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/story_changes", "List Story Changes", true, [
            { name: "story_id", type: "integer", required: false, desc: "Filter to a specific Story" },
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Per-story metric totals for Activity and Participation Changes" }])}
          ${endpointCard("GET", "/story_change_beneficiaries", "List Story Change Beneficiaries", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Per-Contact Participation Change records" }], "Only applies to Participation type Changes (not Activity).")}
          ${endpointCard("GET", "/story_indicators", "List Story Indicators", true, [
            { name: "story_id", type: "integer", required: false, desc: "Filter to a specific Story" },
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Total indicator progress logged per Story" }])}
          ${endpointCard("GET", "/story_indicator_beneficiaries", "List Story Indicator Beneficiaries", true, [
            { name: "story_id", type: "integer", required: false, desc: "Filter to a specific Story" },
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Per-Contact indicator responses — one record per Contact per Indicator per Story" }])}
          ${endpointCard("GET", "/story_beneficiaries", "List Story Beneficiaries", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Direct Contact-to-Story tagging records" }])}
        </div>
      </section>

      <!-- Changes -->
      <section class="section" id="changes">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Changes</h2>
        <div class="section-desc">
          <p>Changes are custom KPIs (Activity and Participation trackers). They appear in Progress Panel columns 1 and 2. Activity Changes are numerical metrics; Participation Changes track attendance and can tag individual Contacts.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/changes", "List all Changes", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list of Changes with stage (activity/participation)" }])}
        </div>
      </section>

      <!-- Indicators -->
      <section class="section" id="indicators">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Indicators</h2>
        <div class="section-desc">
          <p>Indicators are linked to Outcomes and appear in Progress Panel columns 3–5. Three types: <strong>Scale</strong> (multiple-choice using a Ratio Set), <strong>Binary</strong> (tickbox), <strong>Value</strong> (numerical).</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/indicators", "List all Indicators", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list with indicator_type (scale/binary/value)" }])}
          ${endpointCard("GET", "/indicators/{id}", "Get a single Indicator", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Indicator ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Full Indicator detail including ratio_set_id, default_question" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("GET", "/scale_indicator_choices", "Get Scale Indicator choices", true, [
            { name: "story_category_id", type: "integer", required: false, desc: "Filter by Survey" },
            { name: "indicator_id", type: "integer", required: false, desc: "Filter by Indicator" }
          ], [{ code: "200", cls: "response-2xx", desc: "Choice type (single_choice/multiple_choice) per Scale Indicator" }])}
          ${endpointCard("GET", "/outcome_indicators", "List Outcome–Indicator pairings", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Join table — use to find outcome_id for story indicator responses" }])}
        </div>
      </section>

      <!-- Outcomes -->
      <section class="section" id="outcomes">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Outcomes</h2>
        <div class="section-desc">
          <p>Outcomes are the top-level impact categories. Progress is tracked via Indicators, not Outcomes directly. Each Outcome has a stage (short/medium/long-term) that determines which Progress Panel column its Indicators appear in.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/outcomes", "List all Outcomes", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list with title, icon, stage (short_term/medium_term/long_term)" }])}
          ${endpointCard("GET", "/outcomes/{id}", "Get a single Outcome", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Outcome ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Outcome record" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
        </div>
      </section>

      <!-- Ratio Sets -->
      <section class="section" id="ratio-sets">
        <div class="section-eyebrow">Reference data</div>
        <h2 class="section-title">Ratio Sets &amp; Sub Ratios</h2>
        <div class="section-desc">
          <p>Ratio Sets are reusable dropdown/list field definitions. Sub Ratios are the individual answer choices within a Ratio Set. Sub Ratio IDs are required when submitting Scale Indicator responses in a Story.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/ratio_sets", "List all Ratio Sets", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list — type: identity (Contact Bio Forms) or progress (Scale Indicators)" }])}
          ${endpointCard("GET", "/sub_ratios", "List Sub Ratios (Answer Choices)", true, [
            { name: "ratio_set_ids[]", type: "integer", required: false, desc: "Filter by Ratio Set ID (repeat for multiple)" },
            { name: "page", type: "integer", required: false, desc: "Page number" }
          ], [{ code: "200", cls: "response-2xx", desc: "Answer choices with priority, default_criteria, and default_points for verdict scoring" }])}
          ${endpointCard("GET", "/sub_ratios/{id}", "Get a single Sub Ratio", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Sub Ratio ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Sub Ratio record" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("GET", "/ratio_set_choiceables", "List Ratio Set selection rules", true, [
            { name: "beneficiary_category_ids[]", type: "integer", required: false, desc: "Filter by Contact Bio Form ID" }
          ], [{ code: "200", cls: "response-2xx", desc: "Single/limited_multiple/unlimited_multiple choice rules per Ratio Set" }])}
        </div>
      </section>

      <!-- Case Forms -->
      <section class="section" id="case-forms">
        <div class="section-eyebrow">Reference data</div>
        <h2 class="section-title">Case Forms</h2>
        <div class="section-desc">
          <p>Case Forms (Custom Field Categories in the API) define the structured fields available on a Case. Each form contains Custom Field Definitions — the reusable fields — and Custom Field Category Definitions — the record created when a field is added to a form.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/custom_field_categories", "List all Case Forms", true, [
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [{ code: "200", cls: "response-2xx", desc: "Case Form schemas with field definition IDs and types" }])}
        </div>
      </section>

    </main>

    <!-- Right code panel -->
    <aside class="panel" id="codePanel">
      <div class="panel-intro">
        <h3>Base URL</h3>
        <div class="code-block"><span class="s">https://makerble.com/api/v2</span></div>
        <h3>Authentication headers</h3>
        <div class="code-block"><span class="k">X-User-Email</span><span class="cm">: your@email.com</span>
<span class="k">X-User-Token</span><span class="cm">: your_token</span></div>
        <h3>Example request</h3>
        <div class="code-block"><span class="kw">curl</span> \\
  <span class="cm">https://makerble.com/api/v2/projects</span> \\
  <span class="cm">-H</span> <span class="s">"X-User-Email: you@org.com"</span> \\
  <span class="cm">-H</span> <span class="s">"X-User-Token: your_token"</span></div>
        <h3>Paginated response</h3>
        <div class="code-block">{
  <span class="k">"page"</span>: <span class="n">1</span>,
  <span class="k">"page_size"</span>: <span class="n">10</span>,
  <span class="k">"page_count"</span>: <span class="n">42</span>,
  <span class="k">"total_count"</span>: <span class="n">418</span>,
  <span class="k">"data"</span>: [ ... ]
}</div>
      </div>
      <div class="panel-mock-note">
        <strong>Mock server</strong> — test without real data:<br/>
        <code id="panelMockUrl" style="font-size:11px;font-family:var(--font-mono);color:#8fcf8e">/mock</code>
      </div>
      <div style="padding: 0 24px">
        <h3 style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:12px">Creating a Story</h3>
        <div class="code-block" style="font-size:11px">{
  <span class="k">"story"</span>: {
    <span class="k">"story_group"</span>: <span class="s">"change_created"</span>,
    <span class="k">"story_format"</span>: <span class="s">"old"</span>,
    <span class="k">"project_id"</span>: <span class="n">572</span>,
    <span class="k">"story_category_id"</span>: <span class="n">327</span>,
    <span class="k">"text"</span>: <span class="s">"Session notes…"</span>,
    <span class="k">"created_at"</span>: <span class="s">"2024-06-01"</span>
  },
  <span class="k">"beneficiary_ids"</span>: [<span class="n">160498</span>],
  <span class="k">"story_changes"</span>: [{
    <span class="k">"change_id"</span>: <span class="n">199</span>,
    <span class="k">"number"</span>: <span class="n">1</span>
  }],
  <span class="k">"story_indicator_beneficiaries"</span>: [{
    <span class="k">"indicator_id"</span>: <span class="n">243</span>,
    <span class="k">"indicator_type"</span>: <span class="s">"scale"</span>,
    <span class="k">"outcome_id"</span>: <span class="n">145</span>,
    <span class="k">"sub_ratio_id"</span>: <span class="n">54</span>,
    <span class="k">"beneficiary_id"</span>: <span class="n">160498</span>
  }]
}</div>
      </div>
    </aside>

  </div>

  <script>
    // ── Set absolute URLs ──────────────────────────────────────────────
    const host = window.location.origin;
    document.getElementById('mockUrl').textContent = host + '/mock';
    document.getElementById('panelMockUrl').textContent = host + '/mock';
    document.getElementById('mockBtnTop').href = host + '/mock';

    // ── Toggle endpoint cards ──────────────────────────────────────────
    function toggle(header) {
      const body = header.nextElementSibling;
      body.classList.toggle('open');
    }

    // ── Highlight active nav link on scroll ───────────────────────────
    const sections = document.querySelectorAll('.section');
    const navLinks = document.querySelectorAll('.nav-link');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(s => observer.observe(s));
  </script>
</body>
</html>`;
}

// ── Endpoint card template ────────────────────────────────────────────────────

function endpointCard(method, path, summary, requiresAuth, params = [], responses = [], extraDesc = "") {
  const badgeCls = `method-${method}`;
  const paramsHtml = params.length ? `
    <div class="subsection-label">Parameters</div>
    <table class="params-table">
      <thead><tr><th>Name</th><th>Type</th><th></th><th>Description</th></tr></thead>
      <tbody>
        ${params.map(p => `<tr>
          <td><span class="param-name">${p.name}</span><br/><span style="font-size:10px;color:#999">${p.in || "query"}</span></td>
          <td><span class="param-type">${p.type || "string"}</span></td>
          <td>${p.required ? '<span class="param-required">required</span>' : ''}</td>
          <td class="param-desc">${p.desc || ""}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : "";

  const responsesHtml = responses.length ? `
    <div class="subsection-label">Responses</div>
    ${responses.map(r => `<div class="response-row"><span class="response-code ${r.cls}">${r.code}</span><span class="response-desc">${r.desc}</span></div>`).join("")}` : "";

  const authHtml = requiresAuth ? `<div class="auth-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Requires authentication</div>` : "";

  return `
    <div class="endpoint-card">
      <div class="endpoint-header" onclick="toggle(this)">
        <span class="method-badge ${badgeCls}">${method}</span>
        <div>
          <div class="endpoint-path">${path}</div>
          <div class="endpoint-summary">${summary}</div>
        </div>
      </div>
      <div class="endpoint-body">
        ${authHtml}
        ${extraDesc ? `<div class="endpoint-desc">${extraDesc}</div>` : ""}
        ${paramsHtml}
        ${responsesHtml}
      </div>
    </div>`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

startPrism();

app.listen(PORT, () => {
  console.log(`\nMakerble API Docs running on http://localhost:${PORT}`);
  console.log(`  Docs:  http://localhost:${PORT}/`);
  console.log(`  Spec:  http://localhost:${PORT}/openapi.yaml`);
  console.log(`  Mock:  http://localhost:${PORT}/mock\n`);
});

export default app;
