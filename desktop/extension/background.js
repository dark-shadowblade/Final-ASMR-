const ALARM = "final-asmr-poll";
let busy = false;
async function cfg() {
  const v = await chrome.storage.local.get(["profileId", "bridgeToken", "enabled"]);
  return { profileId: Number(v.profileId || 0), bridgeToken: v.bridgeToken || "", enabled: v.enabled === true };
}
async function call(path, options = {}) {
  const c = await cfg();
  const response = await fetch("http://127.0.0.1:8765" + path, {
    ...options, headers: { "Content-Type": "application/json", "X-Final-ASMR-Token": c.bridgeToken, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error("Desktop bridge HTTP " + response.status);
  return response.json();
}
async function report(task, type, status, message = "") {
  try { await call("/worker/event", { method: "POST", body: JSON.stringify({ taskId: task.id, profileId: task.profileId, type, status, message }) }); } catch {}
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const c = await cfg();
    if (!c.enabled || !c.bridgeToken || c.profileId < 1 || c.profileId > 5) return;
    const saved = await chrome.storage.local.get("activeTask");
    if (saved.activeTask) return;
    const result = await call("/worker/next?profile=" + c.profileId);
    if (!result.task) return;
    const task = result.task;
    if (task.profileId !== c.profileId || !/^https:\/\/flow\.google\.com\/project\/[A-Za-z0-9-]{12,}\/?$/.test(task.projectUrl)) {
      await report(task, "TASK_REJECTED", "error", "Profile or project URL mismatch."); return;
    }
    await chrome.storage.local.set({ activeTask: task });
    const tabs = await chrome.tabs.query({ url: "https://flow.google.com/project/*" });
    const tab = tabs.find(t => t.url && t.url.includes(new URL(task.projectUrl).pathname));
    const opened = tab
      ? await chrome.tabs.update(tab.id, { url: task.projectUrl, active: true })
      : await chrome.tabs.create({ url: task.projectUrl, active: true });
    await chrome.storage.local.set({ activeTabId: opened.id });
    await report(task, "PROJECT_OPENING", "assigned", "Opening assigned Flow project.");
  } catch (error) {
    await chrome.storage.local.set({ workerError: String(error.message || error) });
  } finally { busy = false; }
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); poll(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); poll(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) poll(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FLOW_PROJECT_READY") {
    (async () => {
      const saved = await chrome.storage.local.get(["activeTask", "activeTabId"]);
      const task = saved.activeTask;
      if (!task || sender.tab?.id !== saved.activeTabId || new URL(sender.tab.url).pathname !== new URL(task.projectUrl).pathname) return;
      await chrome.tabs.sendMessage(sender.tab.id, { type: "RUN_ASSIGNED_TASK", task });
      sendResponse({ ok: true });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (message?.type === "FLOW_TASK_EVENT") {
    (async () => {
      const saved = await chrome.storage.local.get("activeTask");
      const task = saved.activeTask;
      if (!task) return;
      await report(task, message.event, message.status || "generating", message.message || "");
      if (["submitted", "completed", "error"].includes(message.status)) await chrome.storage.local.remove(["activeTask", "activeTabId"]);
      sendResponse({ ok: true });
      if (message.status === "submitted") poll();
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
