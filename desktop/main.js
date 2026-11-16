const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const FLOW_URL = "https://flow.google.com/";
const MAX_PROFILES = 5;
const STARTUP_TIMEOUT_MS = 25000;
const children = new Map();
let mainWindow;

function findChrome() {
  const bases = [
    process.env.PROGRAMW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  const candidates = [...new Set(bases.map(base =>
    path.join(base, "Google", "Chrome", "Application", "chrome.exe")
  ))];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function getJson(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("Chrome debugging endpoint returned HTTP " + response.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Chrome debugging endpoint returned invalid JSON")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Chrome debugging endpoint timed out")));
    request.on("error", reject);
  });
}

async function waitForChrome(port, child) {
  const endpoint = "http://127.0.0.1:" + port + "/json/version";
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError = "Chrome debugging endpoint did not become ready.";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error("Chrome exited during startup (exit code " + child.exitCode + ").");
    }
    try {
      const version = await getJson(endpoint);
      if (!version.webSocketDebuggerUrl) throw new Error("Chrome responded without a debugger WebSocket URL.");
      const pages = await getJson("http://127.0.0.1:" + port + "/json/list");
      if (!Array.isArray(pages)) throw new Error("Chrome page list was not available.");
      return { version, pages };
    } catch (error) {
      lastError = error.message;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  throw new Error("Chrome did not become ready within " + (STARTUP_TIMEOUT_MS / 1000) + " seconds. " + lastError);
}

function sendLaunchError(id, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("launch-error", { id, message });
  }
}

async function launchProfile(id, chrome, root) {
  const profileDir = path.join(root, "account-" + String(id).padStart(2, "0"));
  const port = 9300 + id;
  fs.mkdirSync(profileDir, { recursive: true });

  // The app may have been restarted while Chrome remained open. Probe the
  // assigned port quickly; never spend the full startup timeout on an absent port.
  try {
    const version = await getJson("http://127.0.0.1:" + port + "/json/version", 500);
    if (version.webSocketDebuggerUrl) {
      const pages = await getJson("http://127.0.0.1:" + port + "/json/list", 500);
      if (Array.isArray(pages)) return { id, status: "already-open", port, profileDir };
    }
  } catch {
    // No responsive Chrome endpoint on this profile's assigned port; start it.
  }
  children.delete(id);

  let child;
  try {
    child = spawn(chrome, [
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profileDir,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      FLOW_URL
    ], { detached: false, stdio: "ignore", windowsHide: false });
    children.set(id, child);

    const spawnError = new Promise((_, reject) => {
      child.once("error", error => reject(new Error("Could not start Chrome: " + error.message)));
    });
    const ready = waitForChrome(port, child);
    await Promise.race([ready, spawnError]);
    return { id, status: "opened", port, profileDir };
  } catch (error) {
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill(); } catch {}
    }
    children.delete(id);
    const message = error.message || String(error);
    sendLaunchError(id, message);
    return { id, status: "error", port, profileDir, error: message };
  }
}

async function launchFive() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Google Chrome was not found. Checked Program Files and Local AppData. Install desktop Google Chrome first.");
  const root = path.join(app.getPath("userData"), "browser-profiles");
  fs.mkdirSync(root, { recursive: true });
  const results = [];
  // Match the reference implementation: start one isolated profile, verify its
  // remote-debugging endpoint and browser pages, then proceed to the next.
  for (let id = 1; id <= MAX_PROFILES; id++) {
    results.push(await launchProfile(id, chrome, root));
  }
  return { results, profileRoot: root, chromePath: chrome };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760, height: 540, minWidth: 620, minHeight: 460,
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
ipcMain.handle("launch-five", async () => {
  try { return { ok: true, ...await launchFive() }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("get-profile-root", () => path.join(app.getPath("userData"), "browser-profiles"));
app.whenReady().then(createWindow);
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
