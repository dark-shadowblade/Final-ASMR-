const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("finalAsmr", {
  launchFive: () => ipcRenderer.invoke("launch-five"),
  getProfileRoot: () => ipcRenderer.invoke("get-profile-root"),
  onLaunchError: (callback) => ipcRenderer.on("launch-error", (_event, data) => callback(data))
});
