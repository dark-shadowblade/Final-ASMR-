const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const FLOW_URL = "https://flow.google.com/";
const MAX_PROFILES = 5;
const STARTUP_TIMEOUT_MS = 25000;
const children = new Map();
let mainWindow;
let bridgeServer;
let bridgeToken = "";
let state = { projects: {}, prompts: ["", "", "", "", ""], settings: { model: "Veo 3.1 Lite", resolution: "720p", durationSeconds: 8, aspectRatio: "9:16" }, tasks: [], events: [] };
let launching = false;

function dataFile() { return path.join(app.getPath("userData"), "final-asmr-state.json"); }
function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile(), "utf8"));
    state = { ...state, ...saved, projects: saved.projects || {}, prompts: saved.prompts || ["", "", "", "", ""], settings: { ...state.settings, ...(saved.settings || {}) }, tasks: saved.tasks || [], events: saved.events || [] };
  } catch {}
}
function saveState() { fs.writeFileSync(dataFile(), JSON.stringify(state, null, 2), "utf8"); }
function findChrome() {
  const bases = [process.env.PROGRAMW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  return [...new Set(bases.map(base => path.join(base, "Google", "Chrome", "Application", "chrome.exe")))].find(fs.existsSync) || null;
}
function getJson(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", c => body += c);
      res.on("end", () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("HTTP " + res.statusCode)); try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out"))); req.on("error", reject);
  });
}
async function waitForChrome(port, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS; let last = "Endpoint not ready";
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error("Chrome exited during startup.");
    try {
      const v = await getJson("http://127.0.0.1:" + port + "/json/version");
      const pages = await getJson("http://127.0.0.1:" + port + "/json/list");
      if (v.webSocketDebuggerUrl && Array.isArray(pages)) return true;
    } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error("Chrome did not become ready: " + last);
}
function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
async function launchProfile(id, chrome, root) {
  const profileDir = path.join(root, "account-" + String(id).padStart(2, "0"));
  const port = 9300 + id; fs.mkdirSync(profileDir, { recursive: true });
  const projectUrl = state.projects[id] || FLOW_URL;
  try {
    const v = await getJson("http://127.0.0.1:" + port + "/json/version", 450);
    if (v.webSocketDebuggerUrl) return { id, status: "already-open", port };
  } catch {}
  let child;
  try {
    const extensionPath = path.join(__dirname, "extension");
    child = spawn(chrome, ["--remote-debugging-port=" + port, "--user-data-dir=" + profileDir, "--load-extension=" + extensionPath, "--no-first-run", "--no-default-browser-check", "--new-window", projectUrl], { detached: false, stdio: "ignore", windowsHide: false });
    children.set(id, child);
    const failed = new Promise((_, reject) => child.once("error", e => reject(e)));
    await Promise.race([waitForChrome(port, child), failed]);
    return { id, status: "opened", port };
  } catch (e) {
    if (child && child.exitCode === null && child.signalCode === null) try { child.kill(); } catch {}
    children.delete(id); return { id, status: "error", error: e.message };
  }
}
async function launchFive() {
  if (launching) return { ok: false, error: "Browsers are already launching." };
  launching = true;
  try {
    const chrome = findChrome();
    if (!chrome) throw new Error("Google Chrome was not found. Install desktop Google Chrome first.");
    const root = path.join(app.getPath("userData"), "browser-profiles");
    fs.mkdirSync(root, { recursive: true });
    const results = [];
    for (let id = 1; id <= 5; id++) { const result = await launchProfile(id, chrome, root); results.push(result); send("browser-progress", result); }
    return { ok: true, results, profileRoot: root };
  } finally { launching = false; }
}
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Final-ASMR-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
  res.end(body);
}
function startBridge() {
  bridgeToken = state.bridgeToken || crypto.randomBytes(32).toString("hex");
  state.bridgeToken = bridgeToken;
  saveState();
  bridgeServer = http.createServer((req, res) => {
    if (req.method === "OPTIONS") return sendJson(res, 200, {});
    if (req.headers["x-final-asmr-token"] !== bridgeToken) return sendJson(res, 401, { error: "UNAUTHORIZED" });
    const url = new URL(req.url, "http://127.0.0.1:8765");
    if (req.method === "GET" && url.pathname === "/worker/next") {
      const profile = Number(url.searchParams.get("profile"));
      if (!Number.isInteger(profile) || profile < 1 || profile > 5) return sendJson(res, 400, { error: "INVALID_PROFILE" });
      const task = state.tasks.find(t => t.profileId === profile && t.status === "queued");
      if (!task) return sendJson(res, 200, { task: null });
      task.status = "assigned"; task.assignedAt = new Date().toISOString(); saveState();
      return sendJson(res, 200, { task });
    }
    if (req.method === "POST" && url.pathname === "/worker/event") {
      let raw = ""; req.on("data", chunk => { raw += chunk; if (raw.length > 100000) req.destroy(); });
      req.on("end", () => {
        try {
          const event = JSON.parse(raw);
          const task = state.tasks.find(t => t.id === event.taskId && t.profileId === Number(event.profileId));
          if (task) { task.status = event.status || task.status; task.lastEvent = event.type || "update"; task.message = event.message || ""; task.updatedAt = new Date().toISOString(); }
          state.events.push({ ...event, receivedAt: new Date().toISOString() }); state.events = state.events.slice(-500); saveState();
          send("worker-event", event); sendJson(res, 200, { ok: true });
        } catch { sendJson(res, 400, { error: "INVALID_EVENT" }); }
      });
      return;
    }
    return sendJson(res, 404, { error: "NOT_FOUND" });
  });
  bridgeServer.listen(8765, "127.0.0.1");
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1050, height: 760, minWidth: 850, minHeight: 650, backgroundColor: "#0b1020", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
ipcMain.handle("launch-five", async () => { try { return await launchFive(); } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("get-state", () => ({ ...state, bridgeToken, bridgeUrl: "http://127.0.0.1:8765" }));
ipcMain.handle("save-config", (_e, value) => {
  if (!value || !Array.isArray(value.prompts) || value.prompts.length !== 5) return { ok: false, error: "Exactly five prompts are required." };
  const projects = {};
  for (let id = 1; id <= 5; id++) {
    const link = String(value.projects?.[id] || "").trim();
    if (link) {
      let u; try { u = new URL(link); } catch { return { ok: false, error: "Account " + id + " has an invalid project URL." }; }
      if (u.protocol !== "https:" || u.hostname !== "flow.google.com" || !/^\/project\/[A-Za-z0-9-]{12,}\/?$/.test(u.pathname)) return { ok: false, error: "Account " + id + " must use a Google Flow project URL." };
      projects[id] = link;
    }
  }
  state.projects = projects; state.prompts = value.prompts.map(x => String(x || "").trim());
  state.settings = { model: "Veo 3.1 Lite", resolution: "720p", durationSeconds: 8, aspectRatio: "9:16" };
  saveState(); return { ok: true };
});
ipcMain.handle("generate-video", async () => {
  if (state.tasks.some(t => ["queued", "assigned", "generating"].includes(t.status))) return { ok: false, error: "A generation job is already active." };
  for (let id = 1; id <= 5; id++) if (!state.projects[id]) return { ok: false, error: "Save the Google Flow project URL for Account " + id + " first." };
  if (state.prompts.some(p => !p)) return { ok: false, error: "All five prompts must contain text." };
  const launched = await launchFive();
  if (!launched.ok) return launched;
  const jobId = crypto.randomUUID();
  state.tasks = state.tasks.filter(t => !["queued", "assigned", "generating"].includes(t.status));
  for (let id = 1; id <= 5; id++) state.tasks.push({ id: crypto.randomUUID(), jobId, clipId: "clip-" + id, profileId: id, projectUrl: state.projects[id], prompt: state.prompts[id - 1], settings: state.settings, status: "queued", createdAt: new Date().toISOString() });
  saveState(); return { ok: true, jobId, browsers: launched.results };
});
app.whenReady().then(() => { loadState(); startBridge(); createWindow(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { if (bridgeServer) bridgeServer.close(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
