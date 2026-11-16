chrome.storage.local.get(["profileId","bridgeToken","enabled"], v => { document.getElementById("profile").value = v.profileId || ""; document.getElementById("token").value = v.bridgeToken || ""; document.getElementById("enabled").checked = v.enabled === true; });
document.getElementById("save").addEventListener("click", async () => {
 const profileId = Number(document.getElementById("profile").value), bridgeToken = document.getElementById("token").value.trim(), enabled = document.getElementById("enabled").checked;
 if (!Number.isInteger(profileId) || profileId < 1 || profileId > 5 || !bridgeToken) { document.getElementById("status").textContent = "Enter account 1–5 and the desktop bridge token."; return; }
 await chrome.storage.local.set({ profileId, bridgeToken, enabled });
 chrome.alarms.create("final-asmr-poll", { periodInMinutes: 0.5 });
 document.getElementById("status").textContent = "Saved for Account " + profileId + ".";
});