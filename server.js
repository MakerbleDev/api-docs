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
        <a href="#albums"          class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Albums (Portfolios)</a>
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
        <a href="#media-gallery"   class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Media Gallery</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Impact framework</div>
        <a href="#changes"         class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Changes</a>
        <a href="#versions"        class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Versions</a>
        <a href="#access-logs"     class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Access Logs</a>
        <a href="#audit-trail"     class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Audit Trail</a>
        <a href="#indicators"      class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Indicators</a>
        <a href="#outcomes"        class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Outcomes</a>
        <a href="#library"         class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Library</a>
        <a href="#framework-sets"  class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Framework Sets</a>
        <a href="#checklists"      class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Checklists</a>
        <a href="#add-metric-to"   class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Add Metric To</a>
        <a href="#cohort-trackers" class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Cohort Trackers</a>
        <a href="#workflow-trackers" class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Workflow Trackers</a>
        <a href="#formula-trackers" class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Formula Trackers</a>
        <a href="#filtered-metrics" class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Filtered Metrics</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Events</div>
        <a href="#events"          class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Events</a>
        <a href="#event-formats"   class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Event Formats</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Integrations</div>
        <a href="#webhooks"        class="nav-link"><span class="nav-method method-POST" style="background:rgba(34,181,115,0.15);color:#22b573;border-color:rgba(34,181,115,0.2)">POST</span>Webhooks</a>
        <a href="#seats"           class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Seats</a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Reference data</div>
        <a href="#age-bands"       class="nav-link"><span class="nav-method method-GET" style="background:rgba(74,138,201,0.15);color:#4a8ac9;border-color:rgba(74,138,201,0.2)">GET</span>Age Bands</a>
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
            { code: "200", cls: "response-2xx", desc: "Project record, including <code>default_results_template_id</code>: the Impact Framework its Results Canvas shows by default (<code>null</code> for All metrics), and <code>beneficiary_states</code>: the Contact statuses (e.g. Enrolled, Waiting List) switched on for the Project, as <code>{id, name}</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "404", cls: "response-4xx", desc: "Not found" }
          ])}
          ${endpointCard("GET", "/projects/form", "Get the Create Project form", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation the Project is for" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>project_types</code> (each with its <code>solutions</code>) and the Organisation's <code>project_categories</code>, each with its form <code>fields</code>: <code>standard</code> fields with the <code>parameter</code> that sets them, <code>custom_field</code> questions answered under <code>custom_fields</code> by <code>field_id</code>, and <code>dropdown</code> fields whose choices go under <code>sub_ratios</code> by <code>field_id</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "404", cls: "response-4xx", desc: "Not an Organisation you work in" }
          ], "What the <b>Create Project</b> form offers in an Organisation. Use it before <code>POST /projects</code> to choose a Project Type and Project Category and see which fields the category asks for.")}
          ${endpointCard("POST", "/projects", "Create a Project", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation to create the Project in" },
            { name: "project[name]", type: "string", required: true, desc: "The Project's name" },
            { name: "project[project_type_id]", type: "integer", required: true, desc: "A Project Type from <code>GET /projects/form</code>" },
            { name: "project[project_category_id]", type: "integer", required: false, desc: "One of the Organisation's Project Categories (default: its default category)" },
            { name: "project[solution_group_id]", type: "integer", required: false, desc: "One of the Project Type's solutions" },
            { name: "project[help_statement]", type: "string", required: false, desc: "Short Description" },
            { name: "project[help_description]", type: "string", required: false, desc: "Long Description" },
            { name: "project[location]", type: "string", required: false, desc: "Location" },
            { name: "project[editor_ids]", type: "integer[]", required: false, desc: "Managers (default: you)" },
            { name: "project[reporter_ids]", type: "integer[]", required: false, desc: "Changemakers" },
            { name: "project[observer_ids]", type: "integer[]", required: false, desc: "Analysts" },
            { name: "story_category_ids", type: "integer[]", required: false, desc: "Surveys to add, on top of the Project Category's own" },
            { name: "privacy", type: "string", required: false, desc: "<code>only_charity_colleagues</code>, <code>only_project_colleagues</code>, <code>only_certain_individual</code> (with <code>individual_list</code>), <code>charity_plus_network</code> or <code>everyone</code>" },
            { name: "custom_fields", type: "object", required: false, desc: "Answers to the category's custom questions, keyed by <code>field_id</code>" },
            { name: "sub_ratios", type: "object", required: false, desc: "Choices in the category's dropdowns, keyed by <code>field_id</code>" }
          ], [
            { code: "201", cls: "response-2xx", desc: "The new Project" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You may not create projects in this Organisation (e.g. a Project Reporter)" },
            { code: "404", cls: "response-4xx", desc: "Not an Organisation you work in" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>, e.g. no Project Type, or another Organisation's Project Category" }
          ], "Creates a Project as the <b>Create Project</b> page does, with the same permissions. Any Project Automation the new Project matches is applied. Check with <code>GET /projects</code> that the Organisation doesn't already have the Project before creating it.")}
          ${endpointCard("PATCH", "/projects/{id}", "Edit a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "project[...]", type: "object", required: false, desc: "Any of the fields <code>POST /projects</code> takes" },
            { name: "story_category_ids", type: "integer[]", required: false, desc: "Surveys to add. Never removes or stops a Survey" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Project" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not a Manager of the Project or an Organisation Admin (e.g. a Changemaker)" },
            { code: "404", cls: "response-4xx", desc: "Not found, or in an Organisation you don't work in" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>" }
          ], "Edits a Project's details as the <b>Edit Project</b> page does, with the same permissions. Only what you send changes: a colleague list you send replaces that role's colleagues, and one you leave out is kept.")}
          ${endpointCard("GET", "/projects/{id}/preferences", "Get a Project's Project Preferences", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Project Preferences: Contact Forms and statuses (Waiting List, Enrolled, Alumni, Declined) with their forms and baseline Surveys, editorial control, Events, Cases, Timesheets, default Story privacy and the Mailchimp list" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not a Manager of the Project or an Organisation Admin (e.g. a Changemaker)" },
            { code: "404", cls: "response-4xx", desc: "Not found, or in an Organisation you don't work in" }
          ], "What the Project's <b>Project Preferences</b> page shows.")}
          ${endpointCard("PATCH", "/projects/{id}/preferences", "Change a Project's Project Preferences", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "...", type: "object", required: false, desc: "Any of the settings <code>GET /projects/{id}/preferences</code> returns. A list you send replaces that list; <code>[]</code> empties it" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Project Preferences" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not a Manager of the Project or an Organisation Admin" },
            { code: "404", cls: "response-4xx", desc: "Not found, or in an Organisation you don't work in" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>" }
          ], "Saves what the <b>Project Preferences</b> page saves, with the same permissions. Only the settings you send change. Forms, Case Forms, Event Formats and Surveys must be the Project's Organisation's.")}
          ${endpointCard("GET", "/projects/{id}/targets", "Get a Project's targets", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>year_start_date</code>, the one-off targets on its <code>metrics</code> (Changes and Indicators) and <code>trackers</code>, and its <code>deadlines</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You can't edit this Project's targets" },
            { code: "404", cls: "response-4xx", desc: "Not found, or in an Organisation you don't work in" }
          ], "What the Project's <b>Set Targets</b> page shows.")}
          ${endpointCard("PATCH", "/projects/{id}/targets", "Set a Project's targets", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "year_start_date", type: "string", required: false, desc: "YYYY-MM-DD" },
            { name: "metrics", type: "object[]", required: false, desc: "<code>[{metric_type: Change|Indicator, metric_id, target}]</code>" },
            { name: "trackers", type: "object[]", required: false, desc: "<code>[{tracker_type: CohortTracker|WorkflowTracker|FormulaTracker|FilteredMetric, tracker_id, target}]</code>" },
            { name: "deadlines", type: "object[]", required: false, desc: "<code>[{metric_type, metric_id, date, number}]</code>. Replaces all the Project's deadline targets; <code>[]</code> clears them" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The targets" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You can't edit this Project's targets" },
            { code: "404", cls: "response-4xx", desc: "Not found, or in an Organisation you don't work in" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>, e.g. a metric or tracker that isn't on the Project; nothing is saved" }
          ], "Saves what the <b>Set Targets</b> page saves. Only metrics and trackers already on the Project can be given a target. The same request as <code>PATCH /albums/{id}/targets</code>, without <code>target_type</code>.")}
          ${endpointCard("POST", "/projects/add_colleague.json", "Add users to a Project", true, [], [
            { code: "200", cls: "response-2xx", desc: "Users added successfully" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Grant one or more users a role on a Project. A user can hold Editor, Reporter, and Observer simultaneously. Pass user IDs in <code>role_data[].editor_ids</code>, <code>reporter_ids</code>, or <code>observer_ids</code>.")}
          ${endpointCard("GET", "/project_results", "Get Results Canvas figures for Projects", true, [
            { name: "project_ids", type: "integer[]", required: false, desc: "Projects to include, as <code>project_ids[]=619</code> or a JSON array string. Defaults to every Project you can view" },
            { name: "start_date", type: "string", required: false, desc: "First Story date to include, YYYY-MM-DD. Omit both dates for all time" },
            { name: "end_date", type: "string", required: false, desc: "Last Story date to include, YYYY-MM-DD" },
            { name: "tracker_types", type: "string[]", required: false, desc: "Any of <code>activity</code>, <code>engagement</code>, <code>achievement</code>, <code>choice</code>, <code>numerical</code>, as an array or comma-separated list. Defaults to all" },
            { name: "group_by", type: "string", required: false, desc: "<code>project</code> or <code>month</code>: adds a <code>groups</code> array to each tracker (empty months included)" },
            { name: "template_id", type: "integer", required: false, desc: "Only the trackers in this Impact Framework (Template), as <b>Metrics included</b> shows on the Results Canvas. It must be your own or belong to every requested Project's Organisation. A Project's default is <code>default_results_template_id</code> on <code>GET /projects/{id}</code>" },
            { name: "page", type: "integer", required: false, desc: "Page number (default 1)" },
            { name: "per_page", type: "integer", required: false, desc: "Trackers per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated trackers, plus start_date, end_date and project_ids" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "422", cls: "response-4xx", desc: "Invalid project_ids, date, tracker_types, group_by, per_page or template_id" }
          ], "Returns the figures on each Project's Results Canvas (the Results panel on a Project page), one entry per tracker, for the Projects you can view. Activity and Engagement trackers (Changes) give <code>times_recorded</code> and <code>contacts</code>; Achievement trackers (Binary Indicators) give <code>times_recorded</code> and <code>contacts_achieved</code>; Choice trackers (Scale Indicators) give <code>answers</code> with a count and contacts per Sub Ratio; Numerical trackers (Value Indicators) give <code>total</code> and <code>average_per_contact</code>. <code>times_recorded</code> counts records, not people; <code>contacts</code> counts distinct Contacts tagged. <code>anonymous_count</code> is what was recorded with no Contact tagged. <code>target</code>, <code>target_deadline</code> and <code>percent_of_target</code> appear when the Project has a target.")}
        </div>
      </section>

      <!-- Albums -->
      <section class="section" id="albums">
        <div class="section-eyebrow">Core resource</div>
        <h2 class="section-title">Albums (Portfolios)</h2>
        <div class="section-desc">
          <p>An Album groups Projects so their results can be seen together. Albums are being renamed <strong>Portfolios</strong> on screen; the API keeps the name <code>albums</code>. An Album belongs to an Organisation (<code>owner_type: Charity</code>) or to one user (<code>owner_type: User</code>). Its <strong>managers</strong> can change it; its <strong>Album Analysts</strong> can see its results. Another Organisation's Project can't be added directly: it is invited, and shows in <code>pending_project_ids</code> until its managers accept.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/albums", "List Albums", true, [
            { name: "page", type: "integer", required: false, desc: "Page number (default 1)" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 — return only Albums updated after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Albums" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" }
          ], "The Albums you made, manage or are an Album Analyst of, and the Albums of the Organisations you are an editor of.")}
          ${endpointCard("GET", "/albums/{id}", "Get an Album", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Album: its settings, <code>manager_ids</code>, <code>analyst_ids</code>, <code>project_ids</code> and <code>pending_project_ids</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" }
          ])}
          ${endpointCard("POST", "/albums", "Make an Album", true, [
            { name: "name", type: "string", required: true, desc: "The Album's name" },
            { name: "owner_type", type: "string", required: true, desc: "<code>Charity</code> for an Organisation's Album, <code>User</code> for a personal one" },
            { name: "owner_id", type: "integer", required: false, desc: "The Organisation's ID, when <code>owner_type</code> is <code>Charity</code>. You must be an editor of it" },
            { name: "project_ids", type: "integer[]", required: false, desc: "Projects to put in the Album" }
          ], [
            { code: "201", cls: "response-2xx", desc: "The new Album, with you as its manager" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>, e.g. no name, or an Organisation you aren't an editor of" }
          ], "Makes an Album as the <b>Make an Album</b> form does. Check with <code>GET /albums</code> that the Organisation doesn't already have it first.")}
          ${endpointCard("PATCH", "/albums/{id}", "Change an Album's settings", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "name", type: "string", required: false, desc: "The Album's name" },
            { name: "description", type: "string", required: false, desc: "The Album's description" },
            { name: "owner_type / owner_id", type: "string / integer", required: false, desc: "Move the Album to another of your Organisations, or make it personal" },
            { name: "manager_ids", type: "integer[]", required: false, desc: "Replaces the managers (the Album's maker always stays one)" },
            { name: "analyst_ids", type: "integer[]", required: false, desc: "Replaces the Album Analysts" },
            { name: "automatically_create_survey_progress_board", type: "boolean", required: false, desc: "Give each Survey on the Album's Projects a progress board" },
            { name: "default_results_template_id", type: "integer", required: false, desc: "The Impact Framework the Progress Panel opens on; <code>null</code> for All metrics" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Album" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not one of the Album's managers" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>" }
          ], "Changes what the <b>Edit Album</b> and Album <b>Edit</b> pages change. Only what you send changes. Projects are added and removed with <code>/albums/{id}/projects</code>.")}
          ${endpointCard("POST", "/albums/{id}/projects", "Add Projects to an Album", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "project_ids", type: "integer[]", required: true, desc: "Projects to add" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Album" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not one of the Album's managers" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" }
          ], "Keeps the Projects already in the Album. Another Organisation's Project is invited instead and shows in <code>pending_project_ids</code>.")}
          ${endpointCard("DELETE", "/albums/{id}/projects", "Remove Projects from an Album", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "project_ids", type: "integer[]", required: true, desc: "Projects to take out, in the JSON body" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Album" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not one of the Album's managers" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" }
          ], "The Projects themselves don't change.")}
          ${endpointCard("GET", "/albums/{id}/targets", "Get an Album's targets", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>target_type</code>, <code>year_start_date</code>, and the one-off targets on its <code>metrics</code> (Changes and Indicators) and <code>trackers</code>, and its <code>deadlines</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You can't edit this Album's targets" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" }
          ], "What the Album's <b>Set Targets</b> page shows. With <code>automatic_target</code> the Album adds up its Projects' targets from <code>year_start_date</code>; with <code>manual_target</code> it has its own.")}
          ${endpointCard("PATCH", "/albums/{id}/targets", "Set an Album's targets", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "target_type", type: "string", required: false, desc: "<code>manual_target</code> or <code>automatic_target</code>" },
            { name: "year_start_date", type: "string", required: false, desc: "YYYY-MM-DD" },
            { name: "metrics", type: "object[]", required: false, desc: "<code>[{metric_type: Change|Indicator, metric_id, target}]</code>" },
            { name: "trackers", type: "object[]", required: false, desc: "<code>[{tracker_type: CohortTracker|WorkflowTracker|FormulaTracker|FilteredMetric, tracker_id, target}]</code>" },
            { name: "deadlines", type: "object[]", required: false, desc: "<code>[{metric_type, metric_id, date, number}]</code>. Replaces all the Album's deadline targets; <code>[]</code> clears them" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The targets" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You can't edit this Album's targets" },
            { code: "404", cls: "response-4xx", desc: "Not found, or an Album you can't see" },
            { code: "422", cls: "response-4xx", desc: "<code>{errors: [...]}</code>, e.g. a metric or tracker that isn't on the Album; nothing is saved" }
          ], "Saves what the Album's <b>Set Targets</b> page saves. Only metrics and trackers already on the Album can be given a target. Metric, tracker and deadline targets are only saved while the Album uses manual targets.")}
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
          ], "Opening a Contact this way is recorded in its <strong>Access Log</strong>, the audit trail of who has viewed it, under your name and marked as via the API (or via MCP when the Makerble MCP server sends <code>X-Makerble-Client: makerble-mcp</code>). Views less than 30 minutes apart are counted together. Use <code>GET /beneficiaries</code> when you only need to find or scan Contacts.")}
          ${endpointCard("POST", "/beneficiaries", "Create a Contact", true, [], [
            { code: "200", cls: "response-2xx", desc: "Contact created" },
            { code: "422", cls: "response-4xx", desc: "Validation failed (name and owner_id are required)" }
          ], "Required fields: <code>beneficiary.name</code>, <code>beneficiary.owner_id</code> (User ID of the record owner). Submit custom field values as <code>custom_fields: {\"field_id\": \"value\"}</code>.")}
          ${endpointCard("GET", "/beneficiaries/{beneficiary_id}/summary", "Get the AI summary of a Contact (SummaryMaker)", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>status</code> (ready, stale, pending, failed or empty), <code>new_story_count</code> and the <code>summary</code>: sections Who, Progress and Watch for, each sentence with its sources (<code>bio</code>, <code>story_ids</code>)" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "SummaryMaker is not turned on in this organisation's preferences" },
            { code: "404", cls: "response-4xx", desc: "Contact not found, or you can't view it" }
          ], "The summary shown in the Summary tile on the Contact profile, written by SummaryMaker from the Contact's bio and the Stories you are allowed to see. It never uses a Story you can't see. The organisation must turn on SummaryMaker in its preferences (it is off by default). If <code>status</code> is <code>pending</code>, SummaryMaker is still writing it: call again in a few seconds.")}
          ${endpointCard("POST", "/beneficiaries/{beneficiary_id}/summary", "Update the AI summary of a Contact (SummaryMaker)", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" }
          ], [
            { code: "202", cls: "response-2xx", desc: "Update started; <code>status</code> is <code>pending</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "SummaryMaker is not turned on in this organisation's preferences" },
            { code: "404", cls: "response-4xx", desc: "Contact not found, or you can't view it" }
          ], "Makes a fresh summary from the latest bio and Stories, like the <b>Update summary</b> button. Poll the GET endpoint until <code>status</code> is <code>ready</code>.")}
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
            { name: "project_ids", type: "integer[]", required: false, desc: "Only include these projects (project_ids[]=12&project_ids[]=34, or a JSON array string). Never widens access beyond the projects you can see." },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Join table records: project_id and beneficiary_id (the Contact) for each link" },
            { code: "422", cls: "response-4xx", desc: "project_ids is not an array of integers" }
          ])}
          ${endpointCard("POST", "/project_beneficiaries", "Add existing Contacts to a Project", true, [
            { name: "project_id", in: "body", type: "integer", required: true, desc: "The Project to add the Contacts to" },
            { name: "beneficiary_ids", in: "body", type: "integer[]", required: true, desc: "Contacts of the Project's organisation, at most 200" },
            { name: "beneficiary_state_id", in: "body", type: "integer", required: false, desc: "The Contacts' status in the Project, from <code>beneficiary_states</code> in <code>GET /projects/{id}</code>. Default: Enrolled, or the Project's first status if Enrolled is switched off" }
          ], [
            { code: "201", cls: "response-2xx", desc: "<code>data</code>: one entry per Contact with <code>id</code>, <code>project_id</code>, <code>beneficiary_id</code>, <code>beneficiary_state_id</code> and <code>already_in_project</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "You may not move these Contacts between Projects" },
            { code: "404", cls: "response-4xx", desc: "Project not found, or in an organisation you aren't in" },
            { code: "422", cls: "response-4xx", desc: "Contacts not found in the Project's organisation (<code>beneficiary_ids_not_found</code>), a status not switched on for the Project, a closed Project, no ids, or more than 200" }
          ], "The same as <strong>Assign Contacts to projects</strong> on the Contacts page: each Contact added gets an activity timeline entry and the Project's team is notified. Contacts already in the Project are left as they are (<code>already_in_project: true</code>). Nothing is added if any Contact is refused. Use it before generating survey links with <code>beneficiary_ids</code> for Contacts who aren't in the Survey Campaign's Project yet. Requires an Organisation Editor, Reporter or Observer, or a user who may edit the Contact.")}
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
          ${endpointCard("GET", "/project_story_categories/{id}/survey_waves", "List the Waves of a Survey Campaign", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Survey Campaign (Project Story Category) ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Waves (id, name, priority) in priority order; empty if the Survey Campaign doesn't use Waves" },
            { code: "404", cls: "response-4xx", desc: "Survey Campaign not found" }
          ], "Use a Wave's <code>id</code> as <code>send_survey_wave_id</code> when generating survey links.")}
          ${endpointCard("POST", "/project_story_categories/{id}/survey_links", "Generate personal survey links (without sending)", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Survey Campaign (Project Story Category) ID" },
            { name: "beneficiary_ids", in: "body", type: "integer[]", required: false, desc: "Contacts in the Survey Campaign's Project" },
            { name: "emails", in: "body", type: "string[]", required: false, desc: "Email addresses, matched to an existing Contact of the organisation or creating one. No email is sent." },
            { name: "send_survey_wave_id", in: "body", type: "integer", required: false, desc: "Wave, from the Waves endpoint" },
            { name: "link_expiry", in: "body", type: "string", required: false, desc: "<code>use_once</code> (default) or <code>evergreen</code>" },
            { name: "is_anonymised", in: "body", type: "boolean", required: false, desc: "Default false" }
          ], [
            { code: "201", cls: "response-2xx", desc: "<code>send_survey_id</code> and <code>data</code>: one link per Contact with <code>survey_url</code>, <code>survey_token</code>, <code>link_expiry</code>, <code>expired</code>" },
            { code: "403", cls: "response-4xx", desc: "Not a Project Editor or Organisation Editor" },
            { code: "404", cls: "response-4xx", desc: "Survey Campaign not found" },
            { code: "422", cls: "response-4xx", desc: "Contacts outside the Project (<code>invalid_beneficiary_ids</code>, split into <code>beneficiary_ids_not_in_project</code>: in the organisation but not the Project, add them with <code>POST /project_beneficiaries</code> first; and <code>beneficiary_ids_not_found</code>: not Contacts of the organisation), over 200 recipients, no recipients, or an unavailable Wave" }
          ], "Generates the same personal links as the Send Survey page, but <strong>sends nothing</strong>: share the returned <code>survey_url</code> yourself. At most 200 contacts and email addresses per request. A <code>use_once</code> link stops working after one response; an <code>evergreen</code> link stays active.")}
          ${endpointCard("GET", "/project_story_categories/{id}/survey_links", "List personal survey links", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Survey Campaign (Project Story Category) ID" },
            { name: "beneficiary_id", type: "integer", required: false, desc: "Only this Contact's links" },
            { name: "send_survey_wave_id", type: "integer", required: false, desc: "Only links for this Wave" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (max 200)" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of links" },
            { code: "403", cls: "response-4xx", desc: "Not a Project Editor or Organisation Editor" },
            { code: "404", cls: "response-4xx", desc: "Survey Campaign not found" }
          ], "Use it to reuse a Contact's existing link. A <code>use_once</code> link that has been answered has <code>expired: true</code>.")}
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
          ], "Opening a Story this way is recorded in its <strong>Access Log</strong>, the audit trail of who has viewed it, under your name and marked as via the API (or via MCP when the Makerble MCP server sends <code>X-Makerble-Client: makerble-mcp</code>). Views less than 30 minutes apart are counted together. Use <code>GET /stories</code> when you only need to find or scan Stories.")}
          ${endpointCard("POST", "/stories", "Create a Story", true, [], [
            { code: "200", cls: "response-2xx", desc: "Story created" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], `Creates a Story tagged to zero, one, or multiple Contacts. Required: <code>story.project_id</code>, <code>story.story_category_id</code>, <code>story.story_group: "change_created"</code>, <code>story.story_format: "old"</code>.
          <br/><br/>Use <code>story_indicator_beneficiaries</code> for indicator responses, <code>story_changes</code> for metric totals, and <code>custom_fields</code> for survey text/date/time fields.
          <br/><br/>For binary indicators: include <code>binray_indicator_value: "on"</code> if ticked — omit the record entirely if not ticked. Activity Changes cannot be tagged to individual Contacts.`)}
          ${endpointCard("POST", "/draft_stories", "Save an Answer In Progress (draft Story)", true, [], [
            { code: "201", cls: "response-2xx", desc: "Saved. Returns <code>draft_story_id</code>" },
            { code: "403", cls: "response-4xx", desc: "No permission for this Project or organisation" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], `Saves a partly completed survey response as an <strong>Answer In Progress</strong> (draft Story) for a colleague to review, finish and publish in Makerble. Use it instead of <code>POST /stories</code> when a person should check the response first.
          <br/><br/>Send <code>story.project_id</code>, <code>story.story_category_id</code> and <code>story.text</code>, plus optional <code>story.event_id</code>, <code>beneficiaries</code> (Contact IDs), <code>story_privacy</code> and <code>custom_fields</code>.
          <br/><br/>Allowed for the Project's editors, reporters and observers, the organisation's editors and reporters, and the workers and managers of <code>story.event_id</code> when that Event belongs to the Project. Anyone else gets <code>403</code>, as does a <code>story.charity_id</code> that isn't the Project's organisation.`)}
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

      <!-- Media Gallery -->
      <section class="section" id="media-gallery">
        <div class="section-eyebrow">Surveys &amp; Stories</div>
        <h2 class="section-title">Media Gallery</h2>
        <div class="section-desc">
          <p>Every photo, video, audio file and document attached to Stories and to Contacts' bios in one organisation, in one list. Only files from Stories and Contacts the user is already allowed to view are returned, so two users can see different results for the same organisation.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/media_items", "List Media Gallery files", true, [
            { name: "charity_id", type: "integer", required: true, desc: "Organisation ID" },
            { name: "kind", type: "string", required: false, desc: "<code>photo</code>, <code>video</code>, <code>audio</code> or <code>document</code>" },
            { name: "search", type: "string", required: false, desc: "Matches the start of words in the file name, Story title, Contact name and caption" },
            { name: "source[]", type: "string", required: false, desc: "<code>stories</code> and/or <code>contacts</code> (Contact bios). Default both" },
            { name: "sort", type: "string", required: false, desc: "<code>newest</code> (default) or <code>oldest</code>, by upload date" },
            { name: "story_filters[...]", type: "object", required: false, desc: "Timeline (Story) Filters, e.g. <code>story_filters[project_ids][]</code>, <code>story_filters[story_category_ids][]</code> (Surveys), <code>story_filters[user_ids][]</code> (Authors), <code>story_filters[created_at_from]</code> (<code>YYYY/MM/DD - YYYY/MM/DD</code>)" },
            { name: "contact_filters[...]", type: "object", required: false, desc: "Contact Filters, e.g. <code>contact_filters[group_ids][]</code>, <code>contact_filters[beneficiary_types][]</code> (Contact types), <code>contact_filters[project_ids][]</code>" },
            { name: "page", type: "integer", required: false, desc: "Page number (default 1)" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 — return only files indexed or changed after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of files, plus <code>kind_counts</code> per File type" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "Not a member of that organisation" },
            { code: "404", cls: "response-4xx", desc: "Organisation not found" },
            { code: "422", cls: "response-4xx", desc: "Missing <code>charity_id</code> or unreadable <code>last_synced_datetime</code>" }
          ], `Each item gives <code>kind</code>, <code>file_name</code>, <code>content_type</code>, <code>file_size</code>, <code>caption</code>, <code>source_type</code> (<code>story</code> or <code>contact</code>), <code>source_id</code>, <code>source_title</code> (Story title or Contact name), <code>project_id</code>, <code>project_name</code>, <code>uploaded_at</code> and <code>thumbnail_url</code> (photos only).
          <br/><br/><code>kind_counts</code> gives the number of files of each kind for the same filters, ignoring <code>kind</code>. Filters combine with AND.
          <br/><br/>Story and Contact filters combine as on a Progress Board: Story files must match the Story filters and, if any Contact filter is set, involve a matching Contact. Contact bio files must match the Contact filters; the Story filters' Projects apply through Project membership, and any other Story filter means the Contact must appear in a matching Story.`)}
          ${endpointCard("GET", "/media_items/:id", "Get one Media Gallery file, with a download link", true, [
            { name: "id", type: "integer", required: true, desc: "Media item ID, from the list above" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The file, its <code>field_name</code> and a short-lived <code>download_url</code>" },
            { code: "401", cls: "response-4xx", desc: "Not authenticated" },
            { code: "403", cls: "response-4xx", desc: "The user can't view the file's Story or Contact" },
            { code: "404", cls: "response-4xx", desc: "File not found" }
          ], `Returns the same fields as the list, plus <code>field_name</code> (<code>Profile picture</code>, <code>&lt;field&gt; (file field)</code>, <code>Story attachment</code> or <code>Contact attachment</code>), <code>download_url</code> and <code>download_url_expires_in</code> (seconds).
          <br/><br/>Permissions are checked again on every request. <code>download_url</code> is a signed link that expires quickly, so request the file again for a fresh one rather than storing it.`)}
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

      <!-- Versions -->
      <section class="section" id="versions">
        <div class="section-eyebrow">Audit &amp; compliance</div>
        <h2 class="section-title">Versions</h2>
        <div class="section-desc">
          <p>Versions are the audit trail behind the <strong>Manage Versions</strong> page: every time a Contact or a Story (Survey Response) is created, edited or deleted, a Version records who did it, when, and a full snapshot of the record at that moment. A Story is named <code>[story ID] &lt;survey&gt; in &lt;project&gt; by &lt;user&gt; on &lt;date happened&gt;</code>.</p>
          <p>Visible to Charity Editors (any Contact or Story in their Organisation) and Project Editors (Contacts in at least one of their Projects, and Stories in their Projects that they may read: a Story shared only with specific individuals is hidden unless they are one of them). Anything else returns <code>404</code>. <code>user_name</code> is <code>System</code> when no signed-in user made the change, e.g. a CSV import.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/versions", "List a Contact's or Story's Versions (audit trail)", true, [
            { name: "record_type", type: "string", required: true, desc: "<code>Contact</code> or <code>Story</code> (a Story or Survey Response)" },
            { name: "record_id", type: "integer", required: true, desc: "Contact (Beneficiary) ID or Story ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 — only Versions created after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated Versions, newest first, plus the record's name and whether it has been deleted" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to you" }
          ])}
          ${endpointCard("GET", "/versions/{id}", "Get a single Version with the full record snapshot", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Version ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Version, including full_object — every field as saved at that moment" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to you" }
          ])}
        </div>
      </section>

      <!-- Access Logs -->
      <section class="section" id="access-logs">
        <div class="section-eyebrow">Audit &amp; compliance</div>
        <h2 class="section-title">Access Logs</h2>
        <div class="section-desc">
          <p>Access Logs are the audit trail of <em>views</em>, on the <strong>Access Logs</strong> tab beside Versions on the Manage Versions page: who opened a Contact or Story in Makerble or fetched it through the API, when, and how many times. Views by the same colleague less than 30 minutes apart are one entry with a <code>view_count</code>. Entries older than the Organisation's retention period (3 to 12 months, set on Organisation Preferences) are rolled up into one entry per colleague per month, with <code>monthly_summary: true</code>. <code>source</code> is <code>web</code>, <code>api</code> or <code>mcp</code>.</p>
          <p>Same permissions as Versions. Anything else returns <code>404</code>.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/access_logs", "List who viewed a Contact or Story (Access Logs)", true, [
            { name: "record_type", type: "string", required: true, desc: "<code>Contact</code> or <code>Story</code> (a Story or Survey Response)" },
            { name: "record_id", type: "integer", required: true, desc: "Contact (Beneficiary) ID or Story ID" },
            { name: "from", type: "string", required: false, desc: "YYYY-MM-DD — only entries on or after this date" },
            { name: "to", type: "string", required: false, desc: "YYYY-MM-DD — only entries on or before this date" },
            { name: "user_id", type: "integer", required: false, desc: "Only this colleague's views" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 — only entries last viewed after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated Access Log entries, newest first, plus the record's name and whether it has been deleted" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to you" }
          ])}
        </div>
      </section>

      <!-- Audit Trail -->
      <section class="section" id="audit-trail">
        <div class="section-eyebrow">Audit &amp; compliance</div>
        <h2 class="section-title">Audit Trail</h2>
        <div class="section-desc">
          <p>The Audit Trail is an Organisation's feed of changes (Versions: Created, Edited, Destroyed) and views (Access Logs: Viewed) across all its Contacts and Stories, newest first, as on the <strong>Audit Trail</strong> page (Contacts → More Options → Audit trail). Each entry has an <code>entry_type</code> of <code>version</code> or <code>access_log</code>. Only views within the Organisation's retention period are listed; older views are monthly summaries on <code>GET /access_logs</code>.</p>
          <p>Visible to Charity Editors (everything in their Organisation) and Project Editors (Contacts and Stories in their Projects). Anything else returns <code>404</code>.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/audit_trail", "List an Organisation's latest changes and views", true, [
            { name: "charity_id", type: "integer", required: true, desc: "Organisation (Charity) ID" },
            { name: "actions", type: "string", required: false, desc: "Comma-separated, from <code>created</code>, <code>edited</code>, <code>destroyed</code>, <code>viewed</code> (default all)" },
            { name: "user_id", type: "integer", required: false, desc: "Only this colleague's actions" },
            { name: "record_type", type: "string", required: false, desc: "<code>Contact</code> or <code>Story</code>" },
            { name: "record_id", type: "integer", required: false, desc: "Only this record (needs <code>record_type</code>)" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 — only entries after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated Audit Trail entries, newest first" },
            { code: "404", cls: "response-4xx", desc: "Organisation not found, or you can't audit it" }
          ])}
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
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "include_public_library", type: "boolean", required: false, desc: "Also include Indicators from the public library shared by all organisations (default false)" }
          ], [{ code: "200", cls: "response-2xx", desc: "Paginated list with indicator_type (scale/binary/value). Only Indicators the user can see: their own and their organisations'" }])}
          ${endpointCard("GET", "/indicators/{id}", "Get a single Indicator", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Indicator ID" },
            { name: "include_public_library", type: "boolean", required: false, desc: "Allow a public-library Indicator from another organisation to be returned (default false)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Full Indicator detail including ratio_set_id, default_question" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to the user" }
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
          ${endpointCard("POST", "/metrics/{id}/copy", "Copy a metric (an Output, Outcome or Indicator)", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "ID of the metric to copy" },
            { name: "metric_class", in: "body", type: "string", required: true, desc: "Change (an Output), Indicator or Outcome" }
          ], [
            { code: "201", cls: "response-2xx", desc: "The copy: id, metric_class, name (\"Copy of …\"), owner_type, owner_id, copied_from_id" },
            { code: "403", cls: "response-4xx", desc: "You can't edit the original, so you can't copy it" },
            { code: "404", cls: "response-4xx", desc: "Not found" },
            { code: "422", cls: "response-4xx", desc: "metric_class isn't Change, Indicator or Outcome, or the copy is invalid" }
          ], "The copy keeps the original's owner, settings and survey wording and isn't added to any Project, Survey or Impact Framework. A copied Indicator keeps its Outcomes; a copied Outcome keeps its Indicators.")}
        </div>
      </section>

      <!-- Library -->
      <section class="section" id="library">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Library</h2>
        <div class="section-desc">
          <p>The Library holds the reusable building blocks your organisation can see: Surveys, Metrics, Activity and Attendance trackers, Outcomes, Lists of answer choices, Units, Fields, Contact Forms, Case Forms, Impact Frameworks, Toolkits, Project Types and Ideas. Search it before making something new, so results keep adding up with those recorded against the original.</p>
          <p>Each item has a <code>type</code>: <code>survey</code>, <code>metric</code>, <code>activity_tracker</code>, <code>outcome</code>, <code>list</code>, <code>unit</code>, <code>field</code>, <code>contact_form</code>, <code>case_form</code>, <code>impact_framework</code>, <code>toolkit</code>, <code>project_type</code>, <code>idea</code>. <code>source</code> chooses your organisation's own library (default), the public library shared by every organisation, or both. Items you may not see are never returned; asking for one by id returns <code>404</code>.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/library/search", "Search the library", true, [
            { name: "query", type: "string", required: false, desc: "Words to look for. Every word must match the name or description; Surveys also match on their questions, Lists on their choices and Metrics on their default question" },
            { name: "item_types", type: "string", required: false, desc: "Comma-separated types to search (default every type)" },
            { name: "source", type: "string", required: false, desc: "<code>organisation</code> (default), <code>public</code> or <code>both</code>" },
            { name: "page", type: "integer", required: false, desc: "Page number, applied to each type" },
            { name: "per_page", type: "integer", required: false, desc: "Results per type (default 10, max 200)" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 — only items updated after this" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Matching items with <code>id</code>, <code>type</code>, <code>name</code>, <code>description</code> and <code>owner</code> (<code>your organisation</code>, <code>public library</code> or <code>Makerble</code>); Metrics add <code>metric_type</code> and <code>choices</code>, Lists add <code>choices</code>" },
            { code: "422", cls: "response-4xx", desc: "Unknown <code>item_types</code> value or <code>source</code>" }
          ])}
          ${endpointCard("GET", "/library/{item_type}/{id}", "Get a library item in full", true, [
            { name: "item_type", in: "path", type: "string", required: true, desc: "The item's type, as returned by Search the library" },
            { name: "id", in: "path", type: "integer", required: true, desc: "The item's id" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The item: a Survey's questions in order with the Metric, List or Field behind each; a Metric's type, default question, Unit, List and Outcomes; a List's choices; a form's fields; a framework's stages; a toolkit's contents" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to you" },
            { code: "422", cls: "response-4xx", desc: "Unknown <code>item_type</code>" }
          ])}
          ${endpointCard("GET", "/library/{item_type}/{id}/usage", "See where a library item is used", true, [
            { name: "item_type", in: "path", type: "string", required: true, desc: "The item's type, as returned by Search the library" },
            { name: "id", in: "path", type: "integer", required: true, desc: "The item's id" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>projects</code> you can see and <code>other_projects_count</code>, <code>records_count</code> and <code>last_used_at</code>, <code>contained_in</code> (the Surveys, Forms, Outcomes, Frameworks, Metrics or Toolkits including it), <code>contained_in_count</code> and <code>in_use</code>. Counts only" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not visible to you" },
            { code: "422", cls: "response-4xx", desc: "Unknown <code>item_type</code>" }
          ])}
        </div>
      </section>

      <!-- Framework Sets -->
      <section class="section" id="framework-sets">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Framework Sets</h2>
        <div class="section-desc">
          <p>A Framework Set groups Impact Frameworks (<code>template</code> in the API) into one thing an organisation reports its contribution towards. For example, the 17 SDG Impact Frameworks form the set "UN Sustainable Development Goals"; others are TOMs, a funder's outcomes framework or an organisation's own strategy. Each set names its two levels, e.g. Goal &rsaquo; Target: level 1 is an Impact Framework and level 2 an Outcome inside it.</p>
          <p><code>availability</code> decides who can use a set: <code>platform</code> (every organisation; created by System Access users), <code>network</code> (every organisation in a Network; created by that Network's admins) or <code>charity</code> (one organisation; created by its organisation admins).</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> List the sets an organisation can already use before creating one. To make an organisation's own Indicators count towards a set, link them to its Outcomes with <code>POST /framework_links</code>. A set whose <code>value_source</code> is <code>set_values</code> uses the Financial Value it defines for each Outcome (<code>financial_values</code>) instead of the organisation's own.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/framework_sets", "List the Framework Sets an organisation can use", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID; the user must belong to it" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated live sets available to the organisation, plus drafts the user can edit" },
            { code: "403", cls: "response-4xx", desc: "The user doesn't belong to the Organisation" },
            { code: "404", cls: "response-4xx", desc: "Unknown Organisation" }
          ])}
          ${endpointCard("GET", "/framework_sets/{id}", "Get a Framework Set", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Framework Set ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The set, with <code>frameworks</code> in order and <code>financial_values</code>" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not available to the user" }
          ])}
          ${endpointCard("POST", "/framework_sets", "Create a Framework Set", true, [], [
            { code: "201", cls: "response-2xx", desc: "Framework Set created" },
            { code: "403", cls: "response-4xx", desc: "The user may not create a set with this <code>availability</code>" },
            { code: "404", cls: "response-4xx", desc: "Unknown Organisation" },
            { code: "422", cls: "response-4xx", desc: "Validation failed, e.g. no name or no Impact Frameworks" }
          ], "Body: <code>charity_id</code>, <code>name</code>, <code>availability</code>, <code>network_id</code>, <code>level1_singular</code>, <code>level1_plural</code>, <code>level2_singular</code>, <code>level2_plural</code>, <code>value_source</code>, <code>version_label</code>, <code>supersedes_id</code>, <code>status</code>, <code>frameworks: [{template_id, short_code, colour, text_colour}]</code> in order, and <code>new_frameworks: [name]</code> to create new Impact Frameworks.")}
          ${endpointCard("PATCH", "/framework_sets/{id}", "Update a Framework Set", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Framework Set ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Framework Set updated" },
            { code: "403", cls: "response-4xx", desc: "The user can't edit this set" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not available to the user" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Same body as create; only the fields sent change. <code>frameworks</code> (when sent) replaces the ordered list; <code>financial_values: [{outcome_id, financial_value_id}]</code> replaces the Financial Value chosen for each Outcome.")}
          ${endpointCard("GET", "/framework_sets/{id}/contribution", "Get an organisation's contribution to a Framework Set", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Framework Set ID" },
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID; the user must belong to it" },
            { name: "project_id", type: "integer", required: false, desc: "Only count Stories in this project" },
            { name: "bundle_id", type: "integer", required: false, desc: "Only count Stories in the projects of this Album" },
            { name: "period", type: "string", required: false, desc: "<code>all_time</code> (default), <code>last_12_months</code>, <code>financial_year</code> (from 5 April) or <code>custom</code>" },
            { name: "from", type: "string", required: false, desc: "First day of a custom period (YYYY-MM-DD)" },
            { name: "to", type: "string", required: false, desc: "Last day of a custom period (YYYY-MM-DD)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>summary</code> (frameworks contributed to, Stories, Contacts reached, entries, financial value, each counted once for the whole set) and <code>frameworks</code>, each with the Outcomes it has a contribution to and their Core and Linked indicators" },
            { code: "403", cls: "response-4xx", desc: "The user doesn't belong to the Organisation" },
            { code: "404", cls: "response-4xx", desc: "The set isn't available to the Organisation, or the project or Album isn't the Organisation's" }
          ], "The figures on the Contribution page. A Story counts towards an Outcome when it records a value against a Core indicator inside it, or against one of the Organisation's Linked indicators in a project the link covers. Framework and Outcome figures overlap, so never add them up into a total; use <code>summary</code>.")}
          ${endpointCard("POST", "/framework_sets/{id}/migrate_links", "Copy Linked indicators onto a new version of a Framework Set", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "The new version's Framework Set ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>carried</code> and <code>not_carried</code> links" },
            { code: "403", cls: "response-4xx", desc: "Not an organisation admin, or the set replaces no older version" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not available to the Organisation" }
          ], "Body: <code>charity_id</code>. Copies the Organisation's links from the version this set replaces (<code>supersedes_id</code>) wherever the same Outcome, or one with the same title, is in this version. The old links stay, so past reports don't change.")}
          ${endpointCard("GET", "/framework_links", "List an organisation's Linked indicators", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID; the user must belong to it" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated links with <code>indicator_name</code>, <code>outcome_title</code>, <code>project_ids</code> and <code>all_projects</code>" },
            { code: "403", cls: "response-4xx", desc: "The user doesn't belong to the Organisation" }
          ])}
          ${endpointCard("POST", "/framework_links", "Link an Indicator to an Outcome in a Framework Set", true, [], [
            { code: "201", cls: "response-2xx", desc: "The Linked indicator" },
            { code: "403", cls: "response-4xx", desc: "Not an organisation admin" },
            { code: "422", cls: "response-4xx", desc: "Not one of the organisation's Indicators or projects, an Outcome outside the sets it can use, or already linked" }
          ], "Body: <code>charity_id</code>, <code>indicator_id</code>, <code>outcome_id</code>, <code>project_ids</code> (empty: every project). Linking again with more projects adds them to the existing link.")}
          ${endpointCard("DELETE", "/framework_links/{id}", "Remove a Linked indicator", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Linked indicator ID" },
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Removed" },
            { code: "403", cls: "response-4xx", desc: "Not an organisation admin" },
            { code: "404", cls: "response-4xx", desc: "Not one of the organisation's links" }
          ])}
        </div>
      </section>

      <!-- Checklists -->
      <section class="section" id="checklists">
        <div class="section-eyebrow">Contacts</div>
        <h2 class="section-title">Checklists</h2>
        <div class="section-desc">
          <p>A Checklist is an ordered list of actions an Organisation expects to be done for each Contact, e.g. give them a Role, complete the Alpha Contact Form, invite them to an induction event. Each action's <code>criteria</code> say what counts as done. Projects offer a Checklist to their Contacts by hand (<code>manual</code>) or add it to every Contact automatically (<code>automatic</code>), and each Contact's profile shows which actions are done.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Get the action types and their criteria keys with <code>GET /checklists/action_types</code>, create the Checklist, then offer it in a Project with <code>PATCH /checklists/{id}/projects/{project_id}</code>. Check a Contact's progress, and who is responsible for each action, with <code>GET /beneficiaries/{beneficiary_id}/checklists</code>.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/checklists", "List an Organisation's Checklists", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Checklists with <code>actions_count</code>" },
            { code: "403", cls: "response-4xx", desc: "No role in the Organisation that can see Checklists" }
          ])}
          ${endpointCard("GET", "/checklists/action_types", "List the actions a Checklist can contain", true, [], [
            { code: "200", cls: "response-2xx", desc: "<code>{data: [{action_type, name, criteria_keys, project_scopable}]}</code>; <code>project_scopable</code> types can take <code>only_this_project</code>" }
          ], "Criteria values are strings: IDs, or pairs such as <code>project_states</code> \"&lt;project_id&gt;:&lt;state_id&gt;\", <code>project_event_categories</code> \"&lt;project_id&gt;:&lt;event_category_id&gt;\", <code>relationship_sides</code> \"&lt;category_id&gt;:parent|child\" and <code>survey_waves</code> \"&lt;Survey Campaign id&gt;:&lt;Wave id, or 0&gt;\".")}
          ${endpointCard("GET", "/checklists/owner_options", "List the choices for who is responsible for an action", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{kinds: [{owner_kind, name}], teams: [{id, name}], relationship_sides: [{owner_relationship_side, name}]}</code>" },
            { code: "403", cls: "response-4xx", desc: "No role in the Organisation that can see Checklists" }
          ], "<code>owner_kind</code>: <code>none</code> (nobody in particular), <code>adder</code> (the colleague who added the Checklist, or the Project's Project Managers when a Project added it), <code>user</code> (<code>owner_user_id</code>, from <code>GET /users</code>), <code>team</code> (<code>owner_team_id</code>: anyone in the Team who can see the Contact) or <code>relationship</code> (<code>owner_relationship_side</code> \"&lt;category_id&gt;:parent|child\").")}
          ${endpointCard("GET", "/checklists/{id}", "Get a Checklist", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Checklist ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The Checklist with <code>actions</code> (each with <code>due_within_days</code>, its owner fields and <code>owner_description</code>), <code>projects</code> and <code>contacts_count</code>" },
            { code: "404", cls: "response-4xx", desc: "Not found, or another Organisation's" }
          ])}
          ${endpointCard("POST", "/checklists", "Create a Checklist", true, [], [
            { code: "201", cls: "response-2xx", desc: "The new Checklist" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" },
            { code: "422", cls: "response-4xx", desc: "e.g. an action with every option unticked" }
          ], "Body: <code>charity_id</code>, <code>checklist: {name, description, actions: [{action_type, title, description, criteria, only_this_project, due_within_days, owner_kind, owner_user_id, owner_team_id, owner_relationship_side}]}</code>. The owner fields are optional. <code>only_this_project: true</code> (\"Only count records in this project\") counts only records made in the Project the Checklist was added to the Contact through. <code>due_within_days</code> (\"Due within N days of the checklist being added\", 0 to 3650) gives the action a deadline; leave it out for none.")}
          ${endpointCard("PATCH", "/checklists/{id}", "Update a Checklist", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Checklist ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The updated Checklist" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" }
          ], "Actions with an <code>id</code> change; <code>{id, _destroy: true}</code> removes one; actions without an <code>id</code> are added. <code>due_within_days: null</code> removes an action's deadline.")}
          ${endpointCard("PATCH", "/checklists/{id}/projects/{project_id}", "Set how a Project offers a Checklist", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Checklist ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "mode", type: "string", required: true, desc: "<code>none</code>, <code>manual</code> or <code>automatic</code>" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{project_id, assignment_mode}</code>" },
            { code: "404", cls: "response-4xx", desc: "A Project the user can't edit" }
          ])}
          ${endpointCard("GET", "/beneficiaries/{beneficiary_id}/checklists", "Get a Contact's Checklists", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated: each Checklist with <code>done_count</code>, <code>actions_count</code> and its actions' <code>done</code> and <code>completion</code> (<code>completed_at</code>, <code>completed_by_user_id</code>, <code>completed_by_name</code>, <code>completion_method</code>, <code>proof_type</code>, <code>proof_id</code>, <code>proof_deleted</code>; null until done), <code>due_on</code>, <code>done_late</code> and <code>overdue</code> (when the Checklist gives the action a deadline), owner fields, <code>owner_overridden</code>, <code>owner_description</code>, <code>responsible_user_ids</code> and <code>owner_warning</code>" },
            { code: "404", cls: "response-4xx", desc: "A Contact the user can't see" }
          ])}
          ${endpointCard("PATCH", "/beneficiaries/{beneficiary_id}/checklists/{checklist_id}/actions/{action_id}/owner", "Change who is responsible for an action for one Contact", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" },
            { name: "checklist_id", in: "path", type: "integer", required: true, desc: "Checklist ID" },
            { name: "action_id", in: "path", type: "integer", required: true, desc: "The Checklist action's ID" },
            { name: "owner_kind", type: "string", required: true, desc: "<code>none</code>, <code>adder</code>, <code>user</code>, <code>team</code> or <code>relationship</code>" },
            { name: "owner_user_id", type: "integer", required: false, desc: "For <code>user</code>" },
            { name: "owner_team_id", type: "integer", required: false, desc: "For <code>team</code>" },
            { name: "owner_relationship_side", type: "string", required: false, desc: "For <code>relationship</code>" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{checklist_id, action_id, owner_kind, …, owner_overridden, owner_description, responsible_user_ids, owner_warning}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can see the Contact but not edit it" },
            { code: "422", cls: "response-4xx", desc: "e.g. a Team from another Organisation" }
          ], "For this Contact only; other Contacts keep the Checklist's default.")}
          ${endpointCard("DELETE", "/beneficiaries/{beneficiary_id}/checklists/{checklist_id}/actions/{action_id}/owner", "Go back to the Checklist's own owner for one Contact", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" },
            { name: "checklist_id", in: "path", type: "integer", required: true, desc: "Checklist ID" },
            { name: "action_id", in: "path", type: "integer", required: true, desc: "The Checklist action's ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The action's owner fields, as for the PATCH" },
            { code: "403", cls: "response-4xx", desc: "Can see the Contact but not edit it" }
          ])}
          ${endpointCard("GET", "/beneficiaries/{beneficiary_id}/checklists/available", "List the Checklists that can be added to a Contact", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{data: [{id, name, projects: [{id, name}]}]}</code>: the Projects each can be added through" }
          ])}
          ${endpointCard("POST", "/beneficiaries/{beneficiary_id}/checklists", "Add a Checklist to a Contact", true, [
            { name: "beneficiary_id", in: "path", type: "integer", required: true, desc: "Contact ID" },
            { name: "checklist_id", type: "integer", required: true, desc: "A Checklist from the available list" },
            { name: "project_id", type: "integer", required: false, desc: "The Project to add it through, from its <code>projects</code>; required when there is more than one" }
          ], [
            { code: "201", cls: "response-2xx", desc: "<code>{checklist_id, beneficiary_id, added_by_user_id, project_id, created_at}</code>" },
            { code: "422", cls: "response-4xx", desc: "That Checklist can't be added to this Contact, or no <code>project_id</code> when it can be added through several Projects" }
          ])}
        </div>
      </section>

      <!-- Add Metric To (CP-559) -->
      <section class="section" id="add-metric-to">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Add Metric To</h2>
        <div class="section-desc">
          <p>The Add metric to popup: the places a metric can be added to, and adding or removing it there. A metric is a Change (<code>change</code>), an Outcome (<code>outcome</code>) or an Indicator (<code>indicator</code>). Destinations are Projects (<code>projects</code>), Impact Frameworks (<code>impact_frameworks</code>, the frameworks you created), Surveys (<code>surveys</code>, Story Categories you can edit: the metric becomes the last, optional question; remove questions by editing the Survey) and Collections (<code>collections</code>, your own and your Organisations'). An Indicator is never added to a Project or Impact Framework directly, only through one of its Outcomes, but it can go in a Collection. An Indicator can be added to Outcomes you can edit (<code>outcomes</code>), and an Outcome you can edit can be made the parent of Indicators (<code>indicators</code>); search both with <code>q</code>. <code>removable: false</code> means stories have recorded the Indicator under that Outcome, so it can't be unlinked. A Cohort or Workflow Tracker (<code>cohort_tracker</code>, <code>workflow_tracker</code>) can go to <code>projects</code> and <code>impact_frameworks</code> in the Impact Scorecard <code>column</code> you pass (<code>activities</code>, <code>engagement</code> by default, <code>potential</code>, <code>behaviour</code> or <code>growth</code>); each listed item then has its <code>column</code>. Progress Boards (<code>progress_boards</code>, the boards you created or are a Board Admin of, for a Change or an Indicator) are offered only when you pass <code>project_id</code> or <code>bundle_id</code> (an Album): the card shows that Project's or Album's results. Pass the same one when adding or removing.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> List the destination types with <code>GET /metrics/{metric_type}/{metric_id}/destinations</code>, list the places of one type with <code>GET .../destinations/projects</code> (each has <code>added</code>), then <code>POST</code> or <code>DELETE .../destinations/projects/{target_id}</code>.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/metrics/{metric_type}/{metric_id}/destinations", "List where a metric can be added", true, [
            { name: "metric_type", in: "path", type: "string", required: true, desc: "<code>change</code>, <code>outcome</code> or <code>indicator</code>" },
            { name: "metric_id", in: "path", type: "integer", required: true, desc: "The metric's ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{data: [{key, label}]}</code>, e.g. <code>{key: \"projects\", label: \"Projects\"}</code>" },
            { code: "404", cls: "response-4xx", desc: "A metric you can't see" }
          ])}
          ${endpointCard("GET", "/metrics/{metric_type}/{metric_id}/destinations/{destination}", "List the places a metric can be added to", true, [
            { name: "destination", in: "path", type: "string", required: true, desc: "<code>projects</code>, <code>impact_frameworks</code>, <code>surveys</code>, <code>collections</code>, <code>outcomes</code>, <code>indicators</code> or <code>progress_boards</code>" },
            { name: "project_id", type: "integer", required: false, desc: "For progress_boards: the Project whose results the card shows" },
            { name: "bundle_id", type: "integer", required: false, desc: "For progress_boards: the Album whose results the card shows" },
            { name: "q", type: "string", required: false, desc: "Search by name (outcomes and indicators)" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated places, alphabetically, each with <code>id</code>, <code>name</code>, <code>added</code> and its <code>organisation</code>. For projects: the open Projects whose metrics you can edit" },
            { code: "404", cls: "response-4xx", desc: "A metric you can't see, or a destination it can't go to" }
          ])}
          ${endpointCard("POST", "/metrics/{metric_type}/{metric_id}/destinations/{destination}", "Create a Progress Board with a metric on it", true, [
            { name: "destination", in: "path", type: "string", required: true, desc: "<code>progress_boards</code> (the only destination that supports this)" },
            { name: "project_id", type: "integer", required: false, desc: "The Project whose results the card shows, or" },
            { name: "bundle_id", type: "integer", required: false, desc: "the Album whose results the card shows" }
          ], [
            { code: "201", cls: "response-2xx", desc: "<code>{added: true, data: {id, name}}</code>" },
            { code: "404", cls: "response-4xx", desc: "No Project or Album you can see, or a destination that can't do this" },
            { code: "422", cls: "response-4xx", desc: "<code>{error}</code>: an Album that isn't in an Organisation" }
          ], "Creates a Managed Progress Board named \"&lt;your name&gt;'s Progress Board\" for the Project's Organisation, with the Project on it and the metric as its card. No request body.")}
          ${endpointCard("POST", "/metrics/{metric_type}/{metric_id}/destinations/{destination}/{target_id}", "Add a metric to a Project, Impact Framework or Collection", true, [
            { name: "target_id", in: "path", type: "integer", required: true, desc: "The Project, Impact Framework or Collection ID" },
            { name: "column", type: "string", required: false, desc: "For a Cohort or Workflow Tracker: the Impact Scorecard column (default <code>engagement</code>)" }
          ], [
            { code: "201", cls: "response-2xx", desc: "<code>{added: true}</code>" },
            { code: "422", cls: "response-4xx", desc: "<code>{error}</code>: a Project you can't edit the metrics of, or one that already has the metric" }
          ], "Adds a Change or Outcome as Edit Project Metrics does: in the Impact Scorecard column of its own stage, after the metrics already there, and to the Project's Default Survey. No request body.")}
          ${endpointCard("DELETE", "/metrics/{metric_type}/{metric_id}/destinations/{destination}/{target_id}", "Remove a metric from a Project, Impact Framework or Collection", true, [
            { name: "target_id", in: "path", type: "integer", required: true, desc: "The Project, Impact Framework or Collection ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{added: false}</code>" },
            { code: "422", cls: "response-4xx", desc: "<code>{error}</code>: a Project you can't edit the metrics of, or one without the metric" }
          ])}
        </div>
      </section>

      <!-- Cohort Trackers -->
      <section class="section" id="cohort-trackers">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Cohort Trackers</h2>
        <div class="section-desc">
          <p>A Cohort Tracker is a metric that counts the Contacts in a Project or Album who meet a set of Contact Filter criteria, e.g. "Children attending 75%+". It is placed in an Impact Scorecard column like other metrics and targeted with a number of Contacts to reach. With <code>result_type: percentage</code> it shows the result as a percentage of its <code>denominator</code>: <code>members</code> (Contacts in this Project / Album), <code>enough_data</code> (Contacts with enough data to be judged on every criterion) or <code>filtered</code> (members who also meet <code>denominator_criteria</code>, e.g. "of the girls in this project"), e.g. "84% Children attending 75%+" with "42 of 50 contacts with enough data". Every tracker counts only members of the Project or Album it is placed on: <code>membership</code> is <code>ever_enrolled</code> (anyone whose status History shows them Enrolled at any time) or <code>currently_enrolled</code>.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Check criteria with <code>POST /cohort_trackers/preview</code>, create the tracker, then place it on a Project with <code>POST /cohort_trackers/{id}/projects/{project_id}</code>. Albums pick it up from their Projects.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/cohort_trackers", "List an Organisation's Cohort Trackers", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_sync_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Cohort Trackers" },
            { code: "403", cls: "response-4xx", desc: "No editor or reporter role in the Organisation" }
          ])}
          ${endpointCard("GET", "/cohort_trackers/{id}", "Get a Cohort Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Cohort Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The tracker, with <code>usage</code> and <code>names_projects_or_albums</code>" },
            { code: "404", cls: "response-4xx", desc: "Not found, or another Organisation's" }
          ])}
          ${endpointCard("POST", "/cohort_trackers/preview", "Preview Cohort Tracker criteria", true, [], [
            { code: "200", cls: "response-2xx", desc: "<code>count</code> of matching Contacts and the normalised <code>criteria</code>" },
            { code: "422", cls: "response-4xx", desc: "An unknown <code>membership</code>" }
          ], "Body: <code>charity_id</code>, <code>cohort_tracker: {criteria, membership}</code>. <code>criteria</code> takes any key the Contacts page's Filters sidebar sends. <code>project_ids</code>, <code>bundle_ids</code>, <code>narrow_bundle_ids</code>, <code>projects_states_hash</code>, <code>project_beneficiary_states</code>, <code>project_story_category_ids</code>, <code>attendance_rate</code>, <code>same_day_rate</code> (Same-day rate), <code>distance_travelled</code>, <code>indicator_comparisons</code> and <code>indicator_sub_ratios_hash</code> follow the Project or Album and the reporting period; the other sections (e.g. <code>group_ids</code>, <code>age_from</code>) apply to the Contacts' current details. Keys no filter reads are dropped.")}
          ${endpointCard("POST", "/cohort_trackers", "Create a Cohort Tracker", true, [], [
            { code: "201", cls: "response-2xx", desc: "Cohort Tracker created" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Body: <code>cohort_tracker: {charity_id, name, description, membership, criteria, result_type, denominator, denominator_criteria}</code>. <code>result_type</code> is <code>number</code> (default) or <code>percentage</code>; a percentage's <code>denominator</code> is <code>members</code> (default), <code>enough_data</code> or <code>filtered</code>, which needs <code>denominator_criteria</code> (Contact Filter criteria, the same keys as <code>criteria</code>).")}
          ${endpointCard("PATCH", "/cohort_trackers/{id}", "Update a Cohort Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Cohort Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Cohort Tracker updated" },
            { code: "403", cls: "response-4xx", desc: "Not an Organisation editor or the reporter who created it" },
            { code: "422", cls: "response-4xx", desc: "Validation failed, or a result_type switch that would clear targets without <code>confirm_clear_targets</code>" }
          ], "Only the fields sent change. Changes apply everywhere the tracker is used. Switching <code>result_type</code> clears the tracker's targets on every Project and Album, so while it has targets it is refused unless the body also has <code>confirm_clear_targets: true</code>.")}
          ${endpointCard("DELETE", "/cohort_trackers/{id}", "Delete a Cohort Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Cohort Tracker ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Deleted" },
            { code: "422", cls: "response-4xx", desc: "Still used on a Project, Album or Scorecard Template" }
          ])}
          ${endpointCard("POST", "/cohort_trackers/{id}/projects/{project_id}", "Add a Cohort Tracker to a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Cohort Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "column", type: "string", required: true, desc: "<code>activities</code>, <code>engagement</code>, <code>potential</code>, <code>behaviour</code> or <code>growth</code>" },
            { name: "target", type: "integer", required: false, desc: "One-off target: a number of Contacts to reach" }
          ], [
            { code: "201", cls: "response-2xx", desc: "Placed: <code>{cohort_tracker_id, project_id, column, target}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" },
            { code: "422", cls: "response-4xx", desc: "Unknown column, or already on the Project" }
          ])}
          ${endpointCard("GET", "/cohort_trackers/{id}/projects/{project_id}", "Get a Cohort Tracker's targets on a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Cohort Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{cohort_tracker_id, project_id, column, target, deadlines: [{date, number}]}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" }
          ])}
          ${endpointCard("PATCH", "/cohort_trackers/{id}/projects/{project_id}", "Set a Cohort Tracker's targets on a Project", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target: a number of Contacts to reach (0-100 for a percentage tracker), not a total that adds up across periods" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date: \"YYYY-MM-DD\", number}]</code>, replacing this tracker's deadline targets; <code>[]</code> clears them" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" },
            { code: "422", cls: "response-4xx", desc: "Bad deadlines, a percentage outside 0-100, or neither field sent" }
          ])}
          ${endpointCard("GET", "/cohort_trackers/{id}/albums/{bundle_id}", "Get a Cohort Tracker's targets on an Album", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{cohort_tracker_id, album_id, album_target_type, target, deadlines}</code>" },
            { code: "404", cls: "response-4xx", desc: "The Album has no Project using the tracker" }
          ])}
          ${endpointCard("PATCH", "/cohort_trackers/{id}/albums/{bundle_id}", "Set a Cohort Tracker's targets on an Album", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target for the Album; never the sum of its Projects'" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date, number}]</code>, saved as the Album's manual targets" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Album's targets" }
          ])}
          ${endpointCard("GET", "/cohort_trackers/{id}/projects/{project_id}/results", "Get a Cohort Tracker's result on a Project", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default). Each is worked out afresh: Year to Date is not the sum of the periods" },
            { name: "as_of", type: "date", required: false, desc: "The deadline the window ends on (default: the next Target Deadline, or today)" },
            { name: "cohort", type: "string", required: false, desc: "<code>in</code> (default) lists the cohort; for a percentage, <code>not_in</code> lists the rest of the denominator" },
            { name: "page", type: "integer", required: false, desc: "Page of Contacts" },
            { name: "per_page", type: "integer", required: false, desc: "Contacts per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{count, eligible_count, result_type, denominator, denominator_count, percentage, target, starts_on, ends_on, cohort, page, page_size, page_count, total_count, data: [{id, name, qualifying_value}]}</code>. A Contact you can't read is <code>{restricted: true}</code>. <code>percentage</code> is null for a number, or when nobody is in the denominator" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Project's Results Canvas" },
            { code: "404", cls: "response-4xx", desc: "The tracker isn't on the Project" },
            { code: "422", cls: "response-4xx", desc: "Unknown timeframe or bad date" }
          ])}
          ${endpointCard("GET", "/cohort_trackers/{id}/albums/{bundle_id}/results", "Get a Cohort Tracker's result on an Album", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default)" },
            { name: "as_of", type: "date", required: false, desc: "The deadline the window ends on" },
            { name: "cohort", type: "string", required: false, desc: "<code>in</code> (default) or, for a percentage, <code>not_in</code>" },
            { name: "page", type: "integer", required: false, desc: "Page of Contacts" },
            { name: "per_page", type: "integer", required: false, desc: "Contacts per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "As for a Project. Each Contact counts once across the Album's Projects, so the result is never the sum of the Projects'" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Album" },
            { code: "404", cls: "response-4xx", desc: "No Project in the Album uses the tracker" }
          ])}
          ${endpointCard("DELETE", "/cohort_trackers/{id}/projects/{project_id}", "Remove a Cohort Tracker from a Project", true, [], [
            { code: "204", cls: "response-2xx", desc: "Removed" },
            { code: "404", cls: "response-4xx", desc: "Not on the Project" }
          ])}
        </div>
      </section>

      <!-- Workflow Trackers -->
      <section class="section" id="workflow-trackers">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Workflow Trackers</h2>
        <div class="section-desc">
          <p>A Workflow Tracker is a metric that counts records Makerble's own features create, rather than Contacts tagged in updates. Its <code>source</code> says what it counts: <code>signpostings</code> (Signpostings made from the Project, counted once whether they name the Organisation signposted to, the Person, or both; signpostings saved without a Project aren't counted anywhere), <code>internal_referrals</code> (Contacts in the Project who are added to another of the Organisation's Projects, dated by the Status in Projects history), <code>cases_created</code> (Cases created on the Project), <code>cases_closed</code> (each time one of those Cases is closed) or <code>cases_open</code> (the Cases open at the end of each timeframe; always a snapshot). <code>count_mode</code> is <code>items</code> (each signposting, referral, Case or closing; adds up across periods, except <code>cases_open</code>) or <code>contacts</code> (each Contact once; a snapshot). Confidential Cases are counted, but only listed to people who can see them. It is placed in an Impact Scorecard column like other metrics.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Check the count with <code>POST /workflow_trackers/preview</code>, create the tracker, then place it on a Project with <code>POST /workflow_trackers/{id}/projects/{project_id}</code>. Albums pick it up from their Projects.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/workflow_trackers", "List an Organisation's Workflow Trackers", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Workflow Trackers" },
            { code: "403", cls: "response-4xx", desc: "No editor or reporter role in the Organisation" }
          ])}
          ${endpointCard("GET", "/workflow_trackers/{id}", "Get a Workflow Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Workflow Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The tracker, with <code>usage</code>" },
            { code: "404", cls: "response-4xx", desc: "Not found, or another Organisation's" }
          ])}
          ${endpointCard("POST", "/workflow_trackers/preview", "Preview a Workflow Tracker", true, [], [
            { code: "200", cls: "response-2xx", desc: "<code>results: {period, year_to_date, all_time}</code> on the Project, and the latest <code>records</code> counted that the user may see, with <code>hidden_count</code> for the rest" },
            { code: "404", cls: "response-4xx", desc: "The Project isn't the Organisation's" },
            { code: "422", cls: "response-4xx", desc: "Unknown source or count_mode, or bad settings" }
          ], "Body: <code>charity_id</code>, <code>project_id</code>, <code>workflow_tracker: {source, count_mode, settings}</code>. The Period ends at the Project's next deadline, or today when it has none ahead.")}
          ${endpointCard("POST", "/workflow_trackers", "Create a Workflow Tracker", true, [], [
            { code: "201", cls: "response-2xx", desc: "Workflow Tracker created" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Body: <code>workflow_tracker: {charity_id, name, description, source, count_mode, settings}</code>. For <code>internal_referrals</code>, <code>settings</code> choose which Projects count as a referral: <code>{destinations: \"any\"}</code>, <code>{destinations: \"only\", project_ids: [...]}</code> or <code>{destinations: \"except\", project_ids: [...]}</code> (the default, with none listed). For the Cases sources, <code>settings: {case_form_id: ...}</code> counts only the Cases created with that Case Form; leave it out for any.")}
          ${endpointCard("PATCH", "/workflow_trackers/{id}", "Update a Workflow Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Workflow Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Workflow Tracker updated" },
            { code: "403", cls: "response-4xx", desc: "Not an Organisation editor or the reporter who created it" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Only the fields sent change. Changes apply everywhere the tracker is used.")}
          ${endpointCard("DELETE", "/workflow_trackers/{id}", "Delete a Workflow Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Workflow Tracker ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Deleted" },
            { code: "422", cls: "response-4xx", desc: "Still used on a Project, Album or Scorecard Template" }
          ])}
          ${endpointCard("POST", "/workflow_trackers/{id}/projects/{project_id}", "Add a Workflow Tracker to a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Workflow Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "column", type: "string", required: true, desc: "<code>activities</code>, <code>engagement</code>, <code>potential</code>, <code>behaviour</code> or <code>growth</code>" },
            { name: "target", type: "integer", required: false, desc: "One-off target" }
          ], [
            { code: "201", cls: "response-2xx", desc: "Placed: <code>{workflow_tracker_id, project_id, column, target}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" },
            { code: "422", cls: "response-4xx", desc: "Unknown column, or already on the Project" }
          ])}
          ${endpointCard("GET", "/workflow_trackers/{id}/projects/{project_id}", "Get a Workflow Tracker's targets on a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Workflow Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{workflow_tracker_id, project_id, column, target, deadlines: [{date, number}]}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" }
          ])}
          ${endpointCard("PATCH", "/workflow_trackers/{id}/projects/{project_id}", "Set a Workflow Tracker's targets on a Project", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date: \"YYYY-MM-DD\", number}]</code>, replacing this tracker's deadline targets; <code>[]</code> clears them. A tracker counting items adds them up across deadlines; one counting each Contact once uses each on its own." }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" },
            { code: "422", cls: "response-4xx", desc: "Bad deadlines, or neither field sent" }
          ])}
          ${endpointCard("GET", "/workflow_trackers/{id}/albums/{bundle_id}", "Get a Workflow Tracker's targets on an Album", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{workflow_tracker_id, album_id, album_target_type, target, deadlines}</code>" },
            { code: "404", cls: "response-4xx", desc: "The Album has no Project using the tracker" }
          ])}
          ${endpointCard("PATCH", "/workflow_trackers/{id}/albums/{bundle_id}", "Set a Workflow Tracker's targets on an Album", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target for the Album; never the sum of its Projects'" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date, number}]</code>, saved as the Album's manual targets" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Album's targets" }
          ])}
          ${endpointCard("GET", "/workflow_trackers/{id}/projects/{project_id}/results", "Get a Workflow Tracker's result on a Project", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default). Counting each item adds up across periods; counting each Contact once is a snapshot, worked out for each window on its own" },
            { name: "as_of", type: "date", required: false, desc: "The deadline the window ends on (default: the next Target Deadline, or today)" },
            { name: "page", type: "integer", required: false, desc: "Page of items" },
            { name: "per_page", type: "integer", required: false, desc: "Items per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{number, target, result_kind, as_of, starts_on, ends_on, page, page_size, page_count, total_count, hidden_count, data: [{contact_id, contact_name, detail, project_id, happened_at}]}</code>, newest first. Items you may not see are counted in <code>hidden_count</code>, never listed" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Project's Results Canvas" },
            { code: "404", cls: "response-4xx", desc: "The tracker isn't on the Project" },
            { code: "422", cls: "response-4xx", desc: "Unknown timeframe or bad date" }
          ])}
          ${endpointCard("GET", "/workflow_trackers/{id}/albums/{bundle_id}/results", "Get a Workflow Tracker's result on an Album", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" },
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default)" },
            { name: "as_of", type: "date", required: false, desc: "The deadline the window ends on" },
            { name: "page", type: "integer", required: false, desc: "Page of items" },
            { name: "per_page", type: "integer", required: false, desc: "Items per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "As for a Project. Each item, or each Contact, counts once across the Album's Projects, so the result is never the sum of the Projects'" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Album" },
            { code: "404", cls: "response-4xx", desc: "No Project in the Album uses the tracker" }
          ])}
          ${endpointCard("DELETE", "/workflow_trackers/{id}/projects/{project_id}", "Remove a Workflow Tracker from a Project", true, [], [
            { code: "204", cls: "response-2xx", desc: "Removed" },
            { code: "404", cls: "response-4xx", desc: "Not on the Project" }
          ])}
        </div>
      </section>

      <!-- Formula Trackers -->
      <section class="section" id="formula-trackers">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Formula Trackers</h2>
        <div class="section-desc">
          <p>A Formula Tracker is a metric worked out from the Organisation's other trackers with + − × ÷, numbers and brackets, e.g. Referrals completed = External referrals + Internal referrals, or % of children receiving support = Children supported ÷ Children enrolled × 100. Its <code>expression</code> is the formula as an ordered list of tokens, never free text: <code>{kind: "tracker", type, id}</code>, <code>{kind: "operator", value: "+" | "-" | "*" | "/"}</code>, <code>{kind: "number", value}</code>, <code>{kind: "open"}</code> and <code>{kind: "close"}</code>. × and ÷ are worked out before + and −, brackets first. A tracker token's <code>type</code> is <code>Change</code> (Activity or Engagement tracker), <code>Indicator</code> (Achievement or Numerical tracker; not a Choice tracker), <code>CohortTracker</code>, <code>WorkflowTracker</code>, <code>FilteredMetric</code> or <code>FormulaTracker</code>.</p>
          <p>For each timeframe, each tracker's result is worked out first, then the formula, so a Year to Date percentage is Year to Date numerator ÷ Year to Date denominator. <code>result_kind</code> is <code>additive</code> only when the formula adds and subtracts trackers that add up, with no numbers; otherwise <code>snapshot</code>. Dividing by 0 gives no result. It is placed in an Impact Scorecard column like other metrics.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> List the trackers a formula can use with <code>GET /formula_trackers/operands</code>, check the result with <code>POST /formula_trackers/preview</code>, create the tracker, then place it on a Project with <code>POST /formula_trackers/{id}/projects/{project_id}</code>. Albums pick it up from their Projects.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/formula_trackers", "List an Organisation's Formula Trackers", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of Formula Trackers, each with <code>expression</code>, <code>formula_text</code>, <code>display_format</code>, <code>decimal_places</code>, <code>unit_label</code> and <code>result_kind</code>" },
            { code: "403", cls: "response-4xx", desc: "No editor or reporter role in the Organisation" }
          ])}
          ${endpointCard("GET", "/formula_trackers/operands", "List the trackers a formula can use", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated <code>data: [{type, id, name, type_name, unit, result_kind}]</code>, by name: the <code>type</code> and <code>id</code> to send in a tracker token" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" }
          ])}
          ${endpointCard("GET", "/formula_trackers/{id}", "Get a Formula Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Formula Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The tracker, with <code>usage</code> and <code>warnings</code>" },
            { code: "404", cls: "response-4xx", desc: "Not found, or another Organisation's" }
          ])}
          ${endpointCard("POST", "/formula_trackers/preview", "Preview a Formula Tracker", true, [], [
            { code: "200", cls: "response-2xx", desc: "<code>results: {period, year_to_date, all_time}</code> on the Project (null where it divides by 0), each tracker's own <code>results</code> under <code>trackers</code>, <code>result_kind</code> and <code>warnings</code>" },
            { code: "404", cls: "response-4xx", desc: "The Project isn't the Organisation's" },
            { code: "422", cls: "response-4xx", desc: "The formula has errors: <code>{errors, warnings}</code>" }
          ], "Body: <code>charity_id</code>, <code>project_id</code>, <code>formula_tracker: {expression, display_format}</code>, and <code>formula_tracker_id</code> when editing one. Warnings don't stop it being saved: a tracker used twice is counted twice; a Numerical tracker added to a count; trackers with different units added together; dividing by a tracker that could be 0.")}
          ${endpointCard("POST", "/formula_trackers", "Create a Formula Tracker", true, [], [
            { code: "201", cls: "response-2xx", desc: "Formula Tracker created" },
            { code: "403", cls: "response-4xx", desc: "Not an editor or reporter of the Organisation" },
            { code: "422", cls: "response-4xx", desc: "The formula is empty, starts or ends with an operator, has two operators or values in a row, unmatched or empty brackets, uses another Organisation's tracker, or uses itself" }
          ], "Body: <code>formula_tracker: {charity_id, name, description, expression, display_format, decimal_places, unit_label}</code>. <code>display_format</code> is <code>number</code> (default) or <code>percentage</code>; <code>decimal_places</code> 0 to 3; <code>unit_label</code> e.g. \"h per child\".")}
          ${endpointCard("PATCH", "/formula_trackers/{id}", "Update a Formula Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Formula Tracker ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Formula Tracker updated" },
            { code: "403", cls: "response-4xx", desc: "Not an Organisation editor or the reporter who created it" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Only the fields sent change; <code>expression</code> replaces the whole formula. Changes apply everywhere the tracker is used.")}
          ${endpointCard("DELETE", "/formula_trackers/{id}", "Delete a Formula Tracker", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Formula Tracker ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Deleted" },
            { code: "422", cls: "response-4xx", desc: "Still used on a Project, Album or Scorecard Template" }
          ])}
          ${endpointCard("POST", "/formula_trackers/{id}/projects/{project_id}", "Add a Formula Tracker to a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Formula Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "column", type: "string", required: true, desc: "<code>activities</code>, <code>engagement</code>, <code>potential</code>, <code>behaviour</code> or <code>growth</code>" },
            { name: "target", type: "integer", required: false, desc: "One-off target (a whole percentage, 0 to 100, for a percentage tracker)" }
          ], [
            { code: "201", cls: "response-2xx", desc: "Placed: <code>{formula_tracker_id, project_id, column, target}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" },
            { code: "422", cls: "response-4xx", desc: "Unknown column, or already on the Project" }
          ])}
          ${endpointCard("GET", "/formula_trackers/{id}/projects/{project_id}", "Get a Formula Tracker's targets on a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Formula Tracker ID" },
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{formula_tracker_id, project_id, column, target, deadlines: [{date, number}]}</code>" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" }
          ])}
          ${endpointCard("PATCH", "/formula_trackers/{id}/projects/{project_id}", "Set a Formula Tracker's targets on a Project", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date: \"YYYY-MM-DD\", number}]</code>, replacing this tracker's deadline targets; <code>[]</code> clears them. An additive tracker adds them up across deadlines; a snapshot uses each on its own. A percentage tracker's targets are whole percentages, 0 to 100." }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's targets" },
            { code: "422", cls: "response-4xx", desc: "Bad deadlines, or neither field sent" }
          ])}
          ${endpointCard("GET", "/formula_trackers/{id}/albums/{bundle_id}", "Get a Formula Tracker's targets on an Album", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{formula_tracker_id, album_id, album_target_type, target, deadlines}</code>" },
            { code: "404", cls: "response-4xx", desc: "The Album has no Project using the tracker" }
          ])}
          ${endpointCard("PATCH", "/formula_trackers/{id}/albums/{bundle_id}", "Set a Formula Tracker's targets on an Album", true, [
            { name: "target", type: "integer", required: false, desc: "One-off target for the Album; never the sum of its Projects'" },
            { name: "deadlines", type: "array", required: false, desc: "<code>[{date, number}]</code>, saved as the Album's manual targets" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Targets saved" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Album's targets" }
          ])}
          ${endpointCard("DELETE", "/formula_trackers/{id}/projects/{project_id}", "Remove a Formula Tracker from a Project", true, [], [
            { code: "204", cls: "response-2xx", desc: "Removed" },
            { code: "404", cls: "response-4xx", desc: "Not on the Project" }
          ])}
        </div>
      </section>

      <!-- Filtered Metrics -->
      <section class="section" id="filtered-metrics">
        <div class="section-eyebrow">Impact framework</div>
        <h2 class="section-title">Filtered Metrics</h2>
        <div class="section-desc">
          <p>A filtered version counts a standard metric again for only some responses and Contacts, e.g. "Session attendances — Female, under 21". The metric is a Change (Activity or Engagement tracker) or an Indicator (Choice, Achievement or Numerical tracker) already on the Project. It counts attendances or answers, not Contacts: to count Contacts, use a Cohort Tracker. It has its own row, name, column and targets on the Results Canvas, and Albums show every filtered version on their Projects.</p>
          <p><code>response_criteria</code> filters the responses, as a Progress Board's "Filter responses/stories by" does: <code>story_category_ids</code> (Surveys), <code>wave_ids</code> (Intervals), <code>date_range</code> (Date Happened, <code>"dd/mm/yyyy - dd/mm/yyyy"</code>), <code>label_ids</code> and <code>author_ids</code>. <code>contact_criteria</code> filters the Contacts tagged in them, in the Contact Filters format. Age is worked out at the date of each response; other Bio fields use the Contact's current value; the other sections are judged at the end of each reporting period.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Check the filters with <code>POST /projects/{project_id}/filtered_metrics/preview</code>, then add the filtered version with <code>POST /projects/{project_id}/filtered_metrics</code>. Read its figure with <code>GET .../filtered_metrics/{id}/results</code>.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/projects/{project_id}/filtered_metrics", "List a Project's filtered versions", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of filtered versions" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Project's Results Canvas" }
          ])}
          ${endpointCard("POST", "/projects/{project_id}/filtered_metrics/preview", "Preview a filtered version", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{count, total}</code>: how many of the metric's tagged responses pass the filters, and how many there are" },
            { code: "422", cls: "response-4xx", desc: "The metric isn't on the Project, or a filter can't be applied" }
          ], "Body: <code>filtered_metric: {parent_type, parent_id, response_criteria, contact_criteria}</code>.")}
          ${endpointCard("POST", "/projects/{project_id}/filtered_metrics", "Add a filtered version to a Project", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "Project ID" }
          ], [
            { code: "201", cls: "response-2xx", desc: "Added" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" },
            { code: "422", cls: "response-4xx", desc: "The metric isn't on the Project, or validation failed" }
          ], "Body: <code>filtered_metric: {parent_type: \"Change\"|\"Indicator\", parent_id, display_name, column, response_criteria, contact_criteria}</code>. A Change's version goes after it in its column unless <code>column</code> is given; an Indicator's sits under its Outcome.")}
          ${endpointCard("GET", "/projects/{project_id}/filtered_metrics/{id}", "Get a filtered version", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Filtered version ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The filtered version" },
            { code: "404", cls: "response-4xx", desc: "Not on the Project" }
          ])}
          ${endpointCard("PATCH", "/projects/{project_id}/filtered_metrics/{id}", "Update a filtered version", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Filtered version ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Updated" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ], "Body: <code>filtered_metric: {display_name, response_criteria, contact_criteria}</code>. Criteria sent replace the stored ones.")}
          ${endpointCard("DELETE", "/projects/{project_id}/filtered_metrics/{id}", "Remove a filtered version from a Project", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Filtered version ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Removed; deleted once it is on no other Project or Scorecard Template" },
            { code: "403", cls: "response-4xx", desc: "Can't edit the Project's metrics" }
          ])}
          ${endpointCard("GET", "/projects/{project_id}/filtered_metrics/{id}/results", "Get a filtered version's result on a Project", true, [
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default)" },
            { name: "as_of", type: "string", required: false, desc: "YYYY-MM-DD the timeframe ends; defaults to the next Target Deadline, or today" }
          ], [
            { code: "200", cls: "response-2xx", desc: "<code>{filtered_metric_id, timeframe, start_date, end_date, number, unit}</code>" },
            { code: "422", cls: "response-4xx", desc: "Unknown timeframe or bad date" }
          ])}
          ${endpointCard("GET", "/albums/{bundle_id}/filtered_metrics", "List an Album's filtered versions", true, [
            { name: "bundle_id", in: "path", type: "integer", required: true, desc: "Album ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list: every filtered version on the Album's Projects" },
            { code: "403", cls: "response-4xx", desc: "Can't see the Album" }
          ])}
          ${endpointCard("GET", "/albums/{bundle_id}/filtered_metrics/{id}", "Get a filtered version on an Album", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Filtered version ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The filtered version" },
            { code: "404", cls: "response-4xx", desc: "Not on any of the Album's Projects" }
          ])}
          ${endpointCard("GET", "/albums/{bundle_id}/filtered_metrics/{id}/results", "Get a filtered version's result on an Album", true, [
            { name: "timeframe", type: "string", required: false, desc: "<code>period</code>, <code>year_to_date</code> or <code>all_time</code> (default)" },
            { name: "as_of", type: "string", required: false, desc: "YYYY-MM-DD" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The result across the Album's open Projects" }
          ])}
        </div>
      </section>

      <!-- Events -->
      <section class="section" id="events">
        <div class="section-eyebrow">Events</div>
        <h2 class="section-title">Events</h2>
        <div class="section-desc">
          <p>Events are sessions, classes, appointments and other gatherings run within a project. A recurring series starts with a <strong>master</strong> event, followed by its <strong>subsequent</strong> events. You see the same events as on the Manage Events page: Organisation Admins see every event in their organisation, and other users see the events of the projects they edit and the events they manage or work at.</p>
          <p>An event's details include its Event Format's custom fields and Dropdown answers, its Signup Page and Self Check-in Survey, its capacity settings, and the links guests use to sign up and check themselves in.</p>
          <p>Before creating or editing an event, list the Event Formats you can use in its project, then get the form for the one you choose. The form lists the format's fields and their Dropdown answer choices, the Surveys and Waves available for Self Check-in, the project's Signup Pages, the Guest Statuses a Signup Page can put guests into, and the Event Roles. Both return <code>403</code> unless you can create events in the project (or edit the event): the project must have events turned on, and you must be an Organisation Admin, a Project Manager, or a Project Reporter or Observer chosen as one of its Event Creators.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/events", "List events", true, [
            { name: "charity_id", type: "integer", required: false, desc: "Only this Organisation's events" },
            { name: "project_id", type: "integer", required: false, desc: "Only this project's events" },
            { name: "event_category_id", type: "integer", required: false, desc: "Only events of this Event Format" },
            { name: "event_type", type: "string", required: false, desc: "one-off, master or subsequent" },
            { name: "start_date", type: "string", required: false, desc: "Events starting on or after this date (YYYY-MM-DD)" },
            { name: "end_date", type: "string", required: false, desc: "Events starting on or before this date (YYYY-MM-DD)" },
            { name: "master_event_id", type: "integer", required: false, desc: "Every event in this recurring series" },
            { name: "form_field_filters", type: "object", required: false, desc: "Event Creation Form answers to match, keyed by the filter_keys of GET /event_filter_fields, e.g. form_field_filters[custom_field_12]=archery. Text for a Text or Email Address field, digits for a Telephone field, yes or no for a Tickbox, Attachment or Signature field, &lt;key&gt;_from / &lt;key&gt;_to for a Number, Date (YYYY-MM-DD) or Time (HH:MM) range, and a list of answer choice ids for a Dropdown" },
            { name: "sort", type: "string", required: false, desc: "Sort the whole list by Event Creation Form fields: sort_key values from GET /event_filter_fields, each optionally followed by asc or desc, e.g. custom_field_12 desc. Blank answers come last" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of events, soonest first unless sorted" },
            { code: "404", cls: "response-4xx", desc: "charity_id is an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "An unknown form_field_filters or sort key" }
          ])}
          ${endpointCard("GET", "/event_filter_fields", "List the fields events can be filtered and sorted by", true, [
            { name: "charity_id", type: "integer", required: false, desc: "Only this Organisation's Event Creation Forms" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of the custom fields and Dropdowns on your Event Creation Forms, alphabetically, each with its key, data_type, filter_keys, filter_hint and sort_key" },
            { code: "404", cls: "response-4xx", desc: "charity_id is an organisation you are not in" }
          ])}
          ${endpointCard("GET", "/event_filter_fields/{id}/choices", "List a Dropdown's answer choices for filtering events", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Dropdown (Ratio Set) ID" },
            { name: "query", type: "string", required: false, desc: "Only answer choices whose name contains this" },
            { name: "charity_id", type: "integer", required: false, desc: "Only this Organisation's Event Creation Forms" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of answer choices {id, name}, alphabetically" },
            { code: "404", cls: "response-4xx", desc: "The Dropdown isn't on an Event Creation Form of your organisations" }
          ])}
          ${endpointCard("GET", "/events/{id}", "Get an event", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The event, with its fields, settings, series and links" },
            { code: "403", cls: "response-4xx", desc: "You are in the organisation but may not see this event" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" }
          ])}
          ${endpointCard("GET", "/projects/{id}/event_categories", "List a project's Event Formats", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of the Event Formats you can create events with in the project" },
            { code: "403", cls: "response-4xx", desc: "You can't create events in this project" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" }
          ])}
          ${endpointCard("GET", "/projects/{id}/event_form", "Get the Create or Edit Event form", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Project ID" },
            { name: "event_category_id", type: "integer", required: true, desc: "The Event Format chosen for the event" },
            { name: "event_id", type: "integer", required: false, desc: "The event being edited, for the Edit Event form" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The form's fields and Dropdown choices, Self Check-in Surveys and Waves, Signup Pages, Guest Statuses and Event Roles" },
            { code: "403", cls: "response-4xx", desc: "You can't create events in this project, or edit this event" },
            { code: "404", cls: "response-4xx", desc: "The project or the Event Format isn't available to you" }
          ])}
          ${endpointCard("POST", "/events", "Create an event", true, [
            { name: "project_id", type: "integer", required: true, desc: "The project the event belongs to" },
            { name: "event_category_id", type: "integer", required: true, desc: "One of the project's Event Formats" },
            { name: "name", type: "string", required: true, desc: "Event name" },
            { name: "start_datetime", type: "string", required: true, desc: "ISO 8601; without an offset it is local to timezone" },
            { name: "end_datetime", type: "string", required: true, desc: "ISO 8601, after the start" },
            { name: "timezone", type: "string", required: false, desc: "IANA time zone name; defaults to yours" },
            { name: "custom_fields", type: "object", required: false, desc: "Custom field id => value" },
            { name: "dropdowns", type: "object", required: false, desc: "Dropdown id => answer choice ids" },
            { name: "manager_ids / worker_ids", type: "array", required: false, desc: "Event Managers and Workers; you are the manager by default" },
            { name: "signup_page_id", type: "integer", required: false, desc: "One of the project's active Signup Pages" },
            { name: "self_check_in", type: "object", required: false, desc: "{ project_story_category_id, wave_id }" },
            { name: "capacity / listing", type: "object", required: false, desc: "Guest and worker limits, after-full settings, timesheets; event listing" },
            { name: "recurring_schedule", type: "object", required: false, desc: "{ frequency, interval, days_of_week, days_of_month } for a series" },
            { name: "recurring_end_date", type: "string", required: false, desc: "YYYY-MM-DD; required with recurring_schedule" }
          ], [
            { code: "201", cls: "response-2xx", desc: "The new event; for a series, the master event" },
            { code: "403", cls: "response-4xx", desc: "You can't create events in this project" },
            { code: "404", cls: "response-4xx", desc: "The project belongs to an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "Every problem with the request, as errors" }
          ])}
          ${endpointCard("PATCH", "/events/{id}", "Update an event", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event ID" },
            { name: "(any create field)", type: "", required: false, desc: "Only the fields you give change" },
            { name: "apply_to", type: "string", required: false, desc: "this_event (default) or all_events_in_series, for a master event" },
            { name: "recurring_schedule / recurring_end_date", type: "object / string", required: false, desc: "Master event only: a new schedule or end date for the whole series. Preview it first" },
            { name: "keep_event_ids / delete_event_ids", type: "array", required: false, desc: "With a schedule change: every event that no longer fits, kept or deleted" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The updated event" },
            { code: "403", cls: "response-4xx", desc: "You may not edit this event" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "Every problem with the request, as errors; also a locked field such as the project, or an event that no longer fits and isn't kept or deleted" }
          ])}
          ${endpointCard("POST", "/events/{id}/series_schedule_preview", "Preview a series schedule change", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "The master event (first of the series)" },
            { name: "recurring_schedule", type: "object", required: false, desc: "{ frequency, interval, days_of_week, days_of_month }; leave out to keep it" },
            { name: "recurring_end_date", type: "string", required: false, desc: "YYYY-MM-DD; leave out to keep it" }
          ], [
            { code: "200", cls: "response-2xx", desc: "required_dates (existing or to be created) and no_longer_fitting_events, with has_stories and has_timesheets. Nothing is changed" },
            { code: "403", cls: "response-4xx", desc: "You may not edit this event" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "Not a master event, or a schedule or end date that can't be used" }
          ])}
          ${endpointCard("DELETE", "/events/{id}", "Delete an event", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event ID; a master event deletes its whole series" },
            { name: "delete_option", in: "query", type: "string", required: false, desc: "this_event (default), current_and_upcoming_series_events or all_series_events" }
          ], [
            { code: "200", cls: "response-2xx", desc: "deleted_event_ids" },
            { code: "403", cls: "response-4xx", desc: "You may not delete this event" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "An unknown delete_option" }
          ])}
          ${endpointCard("GET", "/events/{id}/guests", "List an event's guests", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event ID" },
            { name: "search", type: "string", required: false, desc: "Part of a guest's name or Contact ID" },
            { name: "page / per_page", type: "integer", required: false, desc: "Pagination" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated guests (Contacts) with Guest Status and Event Role" },
            { code: "403", cls: "response-4xx", desc: "You may not see this event" }
          ])}
          ${endpointCard("POST", "/events/{id}/guests", "Add guests to an event", true, [
            { name: "contact_ids", type: "array", required: true, desc: "Contacts in the event's project" },
            { name: "guest_status_id", type: "integer", required: false, desc: "One of the Event Format's Guest Statuses; its requirements are checked" },
            { name: "event_role_id", type: "integer", required: false, desc: "One of the Event Format's Event Roles for guests" },
            { name: "apply_to", type: "string", required: false, desc: "this_event (default) or this_and_upcoming_events" }
          ], [
            { code: "201", cls: "response-2xx", desc: "event_id and guests_count" },
            { code: "422", cls: "response-4xx", desc: "Every problem: Contacts outside the project, an unmet requirement, a full event..." }
          ])}
          ${endpointCard("PATCH", "/events/{id}/guests/{contact_id}", "Change a guest's Guest Status or Event Role", true, [
            { name: "guest_status_id", type: "integer", required: false, desc: "New Guest Status; its requirements are checked" },
            { name: "event_role_id", type: "integer | null", required: false, desc: "New Event Role, or null to clear it" }
          ], [
            { code: "200", cls: "response-2xx", desc: "event_id and guests_count" },
            { code: "422", cls: "response-4xx", desc: "Not a guest, an unmet requirement, or a role not on the Event Format" }
          ])}
          ${endpointCard("DELETE", "/events/{id}/guests/{contact_id}", "Remove a guest", true, [
            { name: "apply_to", in: "query", type: "string", required: false, desc: "this_event (default) or this_and_upcoming_events" }
          ], [
            { code: "200", cls: "response-2xx", desc: "event_id and guests_count" },
            { code: "422", cls: "response-4xx", desc: "Not a guest of this event" }
          ])}
          ${endpointCard("GET", "/events/{id}/staff", "List an event's Event Managers and Workers", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event ID" },
            { name: "page / per_page", type: "integer", required: false, desc: "Pagination" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated staff with roles (manager / worker) and Event Role" },
            { code: "403", cls: "response-4xx", desc: "You may not see this event" }
          ])}
          ${endpointCard("POST", "/events/{id}/staff", "Add Event Managers or Workers", true, [
            { name: "user_ids", type: "array", required: true, desc: "Colleagues in the project or organisation" },
            { name: "role", type: "string", required: true, desc: "manager or worker" },
            { name: "event_role_id", type: "integer", required: false, desc: "One of the Event Format's Event Roles for Event Managers and Workers" },
            { name: "apply_to", type: "string", required: false, desc: "this_event (default) or all_events_in_series, for a master event" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The event" },
            { code: "403", cls: "response-4xx", desc: "You may not edit this event" },
            { code: "422", cls: "response-4xx", desc: "Not colleagues, the worker limit, or a role not on the Event Format" }
          ])}
          ${endpointCard("PATCH", "/events/{id}/staff/{user_id}", "Change an Event Manager's or Worker's Event Role", true, [
            { name: "event_role_id", type: "integer | null", required: true, desc: "New Event Role, or null to clear it" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The event" },
            { code: "422", cls: "response-4xx", desc: "Not on the event's staff, or a role not on the Event Format" }
          ])}
          ${endpointCard("DELETE", "/events/{id}/staff/{user_id}", "Remove an Event Manager or Worker", true, [
            { name: "role", in: "query", type: "string", required: false, desc: "manager or worker; both if left out" },
            { name: "apply_to", in: "query", type: "string", required: false, desc: "this_event (default) or all_events_in_series" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The event" },
            { code: "422", cls: "response-4xx", desc: "The last Event Manager, or not on the event's staff" }
          ])}
        </div>
      </section>

      <!-- Event Formats -->
      <section class="section" id="event-formats">
        <div class="section-eyebrow">Events</div>
        <h2 class="section-title">Event Formats</h2>
        <div class="section-desc">
          <p>Event Formats (Event Categories in the API) are the templates an organisation's events are created from, such as Workshops, Classes or Meetings. Only an Organisation Admin can list an organisation's Event Formats or delete one. An Event Format can be deleted only once it has no events and is not added to any project; the list says which ones can be deleted and why not. Default formats can be deleted under the same rules.</p>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/event_categories", "List Event Formats", true, [
            { name: "charity_id", type: "integer", required: false, desc: "Only this Organisation's Event Formats" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list — each with events_count, projects_count, can_delete and delete_blocked_reason" },
            { code: "403", cls: "response-4xx", desc: "Not an Organisation Admin (of charity_id, if given)" }
          ])}
          ${endpointCard("DELETE", "/event_categories/{id}", "Delete an Event Format", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Event Format (Event Category) ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Deleted — returns id and message" },
            { code: "403", cls: "response-4xx", desc: "Not an Organisation Admin of the owning organisation" },
            { code: "404", cls: "response-4xx", desc: "Not found, or belongs to an organisation you are not in" },
            { code: "422", cls: "response-4xx", desc: "Has events or is added to projects — error gives the reason and counts" }
          ])}
        </div>
      </section>

      <!-- Webhooks -->
      <section class="section" id="webhooks">
        <div class="section-eyebrow">Integrations</div>
        <h2 class="section-title">Webhooks</h2>
        <div class="section-desc">
          <p>Instead of polling, an Organisation's admins can register webhook endpoints: HTTPS URLs that Makerble sends a signed JSON <code>POST</code> to when records change. Only the Organisation's admins can manage them, and only once an admin has ticked <strong>Turn on Webhooks</strong> in the Organisation's Settings (Preferences) page; until then these endpoints answer <code>403</code>.</p>
          <p><strong>Events:</strong> <code>contact.created</code>, <code>contact.updated</code> (with <code>changed_fields</code>), <code>story.created</code> (about 30 seconds after the Story is posted, so survey answers are included; drafts are not sent), <code>story.updated</code> (including a draft being published), <code>project.created</code>, <code>project.updated</code> (update events are sent about 10 seconds after the change, so several saves of one change arrive as one event), <code>import.completed</code> (once per finished spreadsheet import; its rows send no events of their own) and <code>webhook.test</code>. The <code>data</code> of a Contact, Story or Project event is the same JSON as <code>GET /beneficiaries/{id}</code>, <code>GET /stories/{id}</code> or <code>GET /projects/{id}</code>, as the record is when the request is sent. A changed dropdown answer on a Contact sends <code>contact.updated</code> with <code>custom_fields.&lt;dropdown title&gt;</code> in <code>changed_fields</code>.</p>
          <p><strong>Removal and membership events:</strong> <code>contact.deleted</code> (<code>id</code>, <code>deleted_at</code>; no personal data), <code>contact.merged</code> (<code>kept_contact_id</code>, <code>merged_contact_ids</code>, <code>merged_at</code>; no <code>contact.deleted</code> is sent for a merged Contact), <code>contact.restored</code> (the full Contact, when a deleted Contact is restored or a merge undone), <code>story.deleted</code> (<code>id</code>, <code>project_id</code>, <code>contact_ids</code>, <code>deleted_at</code>), <code>project.deleted</code> (<code>id</code>, <code>name</code>, <code>deleted_at</code>), and <code>project.contact_added</code> / <code>project.contact_removed</code> (<code>project_id</code>, <code>project_name</code>, <code>contact_id</code>, <code>contact_state</code>). Their <code>data</code> is recorded when the event happens. Webhooks created before these events existed receive them only once an admin ticks them. Once an endpoint has 100 events waiting, further ones are spaced out at 5 a second, so a bulk action on thousands of records may take some minutes to arrive in full.</p>
          <p><strong>Envelope:</strong> <code>{ "id": "evt_…", "event": "contact.updated", "occurred_at": "2026-10-04T09:15:00Z", "charity_id": 123, "changed_fields": ["name"], "data": { … } }</code>. Headers: <code>X-Makerble-Event</code>, <code>X-Makerble-Delivery</code> (the <code>id</code>), <code>User-Agent: Makerble-Webhooks/1</code> and <code>X-Makerble-Signature: t=&lt;unix time&gt;,v1=&lt;signature&gt;</code>.</p>
          <p><strong>Verifying the signature:</strong> <code>v1</code> is the hex HMAC-SHA256 of <code>"&lt;t&gt;.&lt;raw request body&gt;"</code>, keyed with the endpoint's secret (shown once, when the endpoint is created or its secret rotated). Compare in constant time and reject timestamps more than 5 minutes old.</p>
          <p><strong>Retries:</strong> respond with any 2xx within 10 seconds. Anything else, a timeout or a refused connection is retried 8 more times over about 25 hours. Redirects are not followed. After 10 deliveries in a row fail, or 7 days without a success, the endpoint is switched off and the Organisation's admins are emailed. Delivery is at least once and unordered: de-duplicate on <code>id</code>.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Create the endpoint and store the <code>secret</code> it returns, send a test event with <code>POST /webhook_endpoints/{id}/test</code>, then check the result in <code>GET /webhook_endpoints/{id}/deliveries</code>.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/webhook_endpoints", "List an Organisation's webhook endpoints", true, [
            { name: "charity_id", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" },
            { name: "last_synced_datetime", type: "string", required: false, desc: "ISO 8601 incremental sync" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated list of endpoints, without secrets" },
            { code: "403", cls: "response-4xx", desc: "Webhooks are not turned on for this Organisation" },
            { code: "404", cls: "response-4xx", desc: "Not an admin of this Organisation" }
          ])}
          ${endpointCard("POST", "/webhook_endpoints", "Register a webhook endpoint", true, [
            { name: "webhook_endpoint[charity_id]", in: "body", type: "integer", required: true, desc: "The Organisation ID" },
            { name: "webhook_endpoint[url]", in: "body", type: "string", required: true, desc: "HTTPS URL of the receiver" },
            { name: "webhook_endpoint[description]", in: "body", type: "string", required: false, desc: "What it is for" },
            { name: "webhook_endpoint[event_types]", in: "body", type: "array", required: false, desc: "Events to send (default: all)" }
          ], [
            { code: "201", cls: "response-2xx", desc: "Created — includes the secret, shown only this once" },
            { code: "422", cls: "response-4xx", desc: "Invalid URL or events, or the Organisation already has 10 endpoints" }
          ])}
          ${endpointCard("GET", "/webhook_endpoints/{id}", "Get a webhook endpoint", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The endpoint, without its secret" },
            { code: "404", cls: "response-4xx", desc: "Not found, or not an admin of its Organisation" }
          ])}
          ${endpointCard("PATCH", "/webhook_endpoints/{id}", "Change, pause or resume a webhook endpoint", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" },
            { name: "webhook_endpoint[active]", in: "body", type: "boolean", required: false, desc: "false pauses; true resumes and turns back on an endpoint that was switched off" },
            { name: "webhook_endpoint[url] / [description] / [event_types]", in: "body", type: "string", required: false, desc: "Fields to change" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The updated endpoint" },
            { code: "422", cls: "response-4xx", desc: "Validation failed" }
          ])}
          ${endpointCard("DELETE", "/webhook_endpoints/{id}", "Delete a webhook endpoint", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" }
          ], [
            { code: "204", cls: "response-2xx", desc: "Deleted, with its delivery log" }
          ])}
          ${endpointCard("POST", "/webhook_endpoints/{id}/rotate_secret", "Rotate a webhook endpoint's secret", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The endpoint with its new secret, shown only this once" }
          ])}
          ${endpointCard("POST", "/webhook_endpoints/{id}/test", "Send a test event", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" }
          ], [
            { code: "202", cls: "response-2xx", desc: "The queued webhook.test delivery" }
          ])}
          ${endpointCard("GET", "/webhook_endpoints/{id}/deliveries", "List a webhook endpoint's deliveries", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Records per page" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Paginated delivery log, newest first, kept for 30 days" }
          ])}
          ${endpointCard("POST", "/webhook_endpoints/{id}/deliveries/{delivery_id}/replay", "Send a delivery again", true, [
            { name: "id", in: "path", type: "integer", required: true, desc: "Endpoint ID" },
            { name: "delivery_id", in: "path", type: "integer", required: true, desc: "Delivery ID" }
          ], [
            { code: "202", cls: "response-2xx", desc: "Queued again, with the same event id" },
            { code: "404", cls: "response-4xx", desc: "No such delivery for this endpoint" }
          ])}
        </div>
      </section>

      <!-- Seats -->
      <section class="section" id="seats">
        <div class="section-eyebrow">Billing</div>
        <h2 class="section-title">Seats</h2>
        <div class="section-desc">
          <p>Seats per Colleague: which seat each colleague holds on each of an Organisation's current Contracts (what it has bought, e.g. Makerble CRM · Standard), and changing one. This is the <strong>Our Account › Seats</strong> page. On Role-based Pricing seats come in Billing Roles (Organiser, Practitioner, Helper), and a colleague's roles decide the lowest one they need; on Flat Pricing any seat covers any role.</p>
          <p>Each colleague's <code>status</code> is <code>covered</code>, <code>no_seat</code> (a role that needs a seat but no seat), <code>seat_too_low</code> (a seat below what their roles need) or <code>no_seat_needed</code> (they still hold a seat but no longer have a role that needs one). Nobody loses access because of their seat. When a colleague is given a role, Makerble gives them a free seat on the Contract marked <code>default_for_new_colleagues</code>, or records that the Organisation is over its seat count.</p>
          <p>Only the Organisation's admins can read or change seats; anyone else gets <code>404</code>.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> Call <code>GET /organisations/{organisation_id}/seats</code> for the <code>contract_id</code>, the Billing Role ids in each Contract's <code>lines</code> and the colleague's <code>user_id</code>, then <code>PUT</code> the change.</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/organisations/{organisation_id}/seats", "List an Organisation's seats per colleague", true, [
            { name: "organisation_id", in: "path", type: "integer", required: true, desc: "The Organisation (Charity) ID" },
            { name: "page", type: "integer", required: false, desc: "Page number" },
            { name: "per_page", type: "integer", required: false, desc: "Colleagues per page (default 10, max 200)" }
          ], [
            { code: "200", cls: "response-2xx", desc: "contracts (seats bought, assigned and over per Billing Role) and a paginated data list of colleagues with their seats, lowest_seat_allowed and status" },
            { code: "404", cls: "response-4xx", desc: "Not an admin of this Organisation" }
          ])}
          ${endpointCard("PUT", "/organisations/{organisation_id}/seats/{user_id}", "Change a colleague's seat on one Contract", true, [
            { name: "organisation_id", in: "path", type: "integer", required: true, desc: "The Organisation (Charity) ID" },
            { name: "user_id", in: "path", type: "integer", required: true, desc: "The colleague's user ID" },
            { name: "contract_id", in: "body", type: "integer", required: true, desc: "One of the Organisation's current Contracts" },
            { name: "billing_role_id", in: "body", type: "integer", required: false, desc: "Role-based Pricing: the Billing Role to give, or null to take the seat away" },
            { name: "has_seat", in: "body", type: "boolean", required: false, desc: "Flat Pricing: true gives a seat, false takes it away" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The colleague with their seats after the change" },
            { code: "403", cls: "response-4xx", desc: "Makerble Support, who can only look" },
            { code: "404", cls: "response-4xx", desc: "Not an admin of this Organisation, or the Contract, colleague or Billing Role isn't one of its own" },
            { code: "422", cls: "response-4xx", desc: "A billing_role_id on a Flat Pricing Contract" }
          ])}
        </div>
      </section>

      <!-- Age Bands -->
      <section class="section" id="age-bands">
        <div class="section-eyebrow">Demographics</div>
        <h2 class="section-title">Age Bands</h2>
        <div class="section-desc">
          <p>Age bands group Contacts by age, worked out from each Contact's Date of Birth as of today, so a Contact moves band when their birthday passes. Bands are stored as the age each one starts at: <code>[0, 13, 18, 25]</code> means 0–12, 13–17, 18–24 and 25 and over.</p>
          <p>Every Organisation has age bands (by default 0–12, 13–17, 18–24 and 25 and over), set under <strong>Organisation Preferences › Age bands</strong>. An Album (Portfolio) or Project can have its own on its Preferences page, and otherwise uses its Organisation's; <code>source</code> says whose bands are in use. The <strong>Age band</strong> card on the Demographics tab of Manage Contacts uses the same bands.</p>
          <p>Anyone in the Organisation can read age bands and counts. Only the Organisation's admins can change its bands, an Album's managers its bands, and whoever can change Project Preferences a Project's. Another Organisation's records answer <code>404</code>.</p>
        </div>
        <div class="callout callout-tip">
          <span class="callout-icon">✓</span>
          <span><strong>Workflow tip:</strong> To report how many Contacts in a Project are in each age band, call <code>GET /organisations/{organisation_id}/age_band_counts?project_id=…</code>. Bands with fewer Contacts than the Organisation's Minimum Results Threshold come back with <code>contacts: null</code> and are added up under "Below Threshold".</span>
        </div>
        <div class="endpoint-list">
          ${endpointCard("GET", "/organisations/{organisation_id}/age_bands", "Get an Organisation's age bands", true, [
            { name: "organisation_id", in: "path", type: "integer", required: true, desc: "The Organisation (Charity) ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "source, starts (the age each band starts at) and bands (e.g. \"0–12\")" },
            { code: "404", cls: "response-4xx", desc: "Not in this Organisation" }
          ])}
          ${endpointCard("PUT", "/organisations/{organisation_id}/age_bands", "Set an Organisation's age bands", true, [
            { name: "organisation_id", in: "path", type: "integer", required: true, desc: "The Organisation (Charity) ID" },
            { name: "starts", in: "body", type: "integer[]", required: true, desc: "The age each band starts at (0 to 120), in any order; saved sorted and unique" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The age bands after the change" },
            { code: "403", cls: "response-4xx", desc: "Not an admin of this Organisation" },
            { code: "404", cls: "response-4xx", desc: "Not in this Organisation" },
            { code: "422", cls: "response-4xx", desc: "No starting ages" }
          ])}
          ${endpointCard("GET", "/organisations/{organisation_id}/age_band_counts", "Count an Organisation's Contacts by age band", true, [
            { name: "organisation_id", in: "path", type: "integer", required: true, desc: "The Organisation (Charity) ID" },
            { name: "album_id", type: "integer", required: false, desc: "Count only this Album's Contacts, by its age bands" },
            { name: "project_id", type: "integer", required: false, desc: "Count only this Project's Contacts, by its age bands" }
          ], [
            { code: "200", cls: "response-2xx", desc: "source, total_count and data: [{band, contacts}], with \"Under X\" and \"No date of birth\" only when someone is in them" },
            { code: "404", cls: "response-4xx", desc: "Not in this Organisation, or the Album or Project isn't one of its own" }
          ])}
          ${endpointCard("GET", "/albums/{album_id}/age_bands", "Get an Album's age bands", true, [
            { name: "album_id", in: "path", type: "integer", required: true, desc: "The Album's (Bundle's) ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Its own bands (source: album), or its Organisation's (source: organisation)" },
            { code: "404", cls: "response-4xx", desc: "An Album you can't see" }
          ])}
          ${endpointCard("PUT", "/albums/{album_id}/age_bands", "Set an Album's age bands", true, [
            { name: "album_id", in: "path", type: "integer", required: true, desc: "The Album's (Bundle's) ID" },
            { name: "starts", in: "body", type: "integer[]", required: false, desc: "Its own bands: the age each starts at" },
            { name: "use_organisation_bands", in: "body", type: "boolean", required: false, desc: "true removes its own bands so it uses its Organisation's" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The age bands after the change" },
            { code: "403", cls: "response-4xx", desc: "Not one of the Album's managers" },
            { code: "404", cls: "response-4xx", desc: "An Album you can't see" },
            { code: "422", cls: "response-4xx", desc: "No starting ages" }
          ])}
          ${endpointCard("GET", "/projects/{project_id}/age_bands", "Get a Project's age bands", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "The Project's ID" }
          ], [
            { code: "200", cls: "response-2xx", desc: "Its own bands (source: project), or its Organisation's (source: organisation)" },
            { code: "404", cls: "response-4xx", desc: "Another Organisation's Project" }
          ])}
          ${endpointCard("PUT", "/projects/{project_id}/age_bands", "Set a Project's age bands", true, [
            { name: "project_id", in: "path", type: "integer", required: true, desc: "The Project's ID" },
            { name: "starts", in: "body", type: "integer[]", required: false, desc: "Its own bands: the age each starts at" },
            { name: "use_organisation_bands", in: "body", type: "boolean", required: false, desc: "true removes its own bands so it uses its Organisation's" }
          ], [
            { code: "200", cls: "response-2xx", desc: "The age bands after the change" },
            { code: "403", cls: "response-4xx", desc: "Can't change this Project's Preferences" },
            { code: "404", cls: "response-4xx", desc: "Another Organisation's Project" },
            { code: "422", cls: "response-4xx", desc: "No starting ages" }
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
