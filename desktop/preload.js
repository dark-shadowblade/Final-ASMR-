const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("finalAsmr", {
  launchFive: () => ipcRenderer.invoke("launch-five"),
  getState: () => ipcRenderer.invoke("get-state"),
  saveConfig: value => ipcRenderer.invoke("save-config", value),
  generateVideo: () => ipcRenderer.invoke("generate-video"),
  onBrowserProgress: callback => ipcRenderer.on("browser-progress", (_event, data) => callback(data)),
  onWorkerEvent: callback => ipcRenderer.on("worker-event", (_event, data) => callback(data))
});
