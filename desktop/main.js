const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const FLOW_URL = "https://flow.google.com/";
const MAX_PROFILES = 5;
const children = new Map();

function findChrome() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function launchFive() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Google Chrome was not found. Install Google Chrome and try again.");
  const root = path.join(app.getPath("userData"), "browser-profiles");
  fs.mkdirSync(root, { recursive: true });
  const results = [];
  for (let id = 1; id <= MAX_PROFILES; id++) {
    const profileDir = path.join(root, `account-${String(id).padStart(2, "0")}`);
    fs.mkdirSync(profileDir, { recursive: true });
    const existing = children.get(id);
    if (existing && existing.exitCode === null && !existing.killed) {
      results.push({ id, status: "already-open" });
      continue;
    }
    const port = 9300 + id;
    const child = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      FLOW_URL
    ], { detached: false, stdio: "ignore", windowsHide: false });
    child.on("error", err => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("launch-error", { id, message: err.message });
      }
    });
    children.set(id, child);
    results.push({ id, status: "launched", profileDir, port });
  }
  return { results, profileRoot: root };
}

let mainWindow;
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
  try { return { ok: true, ...launchFive() }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("get-profile-root", () => path.join(app.getPath("userData"), "browser-profiles"));
app.whenReady().then(createWindow);
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
