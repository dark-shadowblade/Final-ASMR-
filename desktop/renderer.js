const $ = id => document.getElementById(id);
let projects = {};
let prompts = [];
let activePage = "create";
function nav(page) {
  activePage = page;
  $("createPage").hidden = page !== "create";
  $("accountsPage").hidden = page !== "accounts";
  document.querySelectorAll("[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page));
}
document.querySelectorAll("[data-page]").forEach(el => el.addEventListener("click", () => nav(el.dataset.page)));
function status(message, bad = false) { $("status").textContent = message; $("status").style.color = bad ? "#ff8585" : "#b6c4da"; }
function renderPrompts() {
  $("promptList").replaceChildren();
  prompts.forEach((value, index) => {
    const wrap = document.createElement("label"); wrap.className = "prompt-card";
    const title = document.createElement("span"); title.textContent = "PROMPT 0" + (index + 1) + " · ACCOUNT 0" + (index + 1);
    const area = document.createElement("textarea"); area.rows = 5; area.value = value; area.dataset.index = index;
    area.addEventListener("input", () => prompts[index] = area.value);
    wrap.append(title, area); $("promptList").append(wrap);
  });
}
function renderAccounts() {
  $("accountList").replaceChildren();
  for (let i = 1; i <= 5; i++) {
    const card = document.createElement("label"); card.className = "account-card";
    const title = document.createElement("strong"); title.textContent = "ACCOUNT 0" + i;
    const input = document.createElement("input"); input.type = "url"; input.placeholder = "https://flow.google.com/project/…"; input.value = projects[i] || ""; input.dataset.account = i;
    input.addEventListener("input", () => projects[i] = input.value);
    card.append(title, input); $("accountList").append(card);
  }
}
async function save() {
  const result = await window.finalAsmr.saveConfig({ projects, prompts });
  if (!result.ok) { status(result.error, true); return false; }
  status("Prompts and five project links saved."); return true;
}
$("save").addEventListener("click", save);
$("saveAccounts").addEventListener("click", save);
$("generate").addEventListener("click", async () => {
  $("generate").disabled = true; status("Saving configuration and opening five Flow browsers…");
  try {
    if (!await save()) return;
    const result = await window.finalAsmr.generateVideo();
    if (!result.ok) { status(result.error, true); return; }
    status("Job " + result.jobId + " queued. Each account will receive its assigned prompt.");
  } catch (e) { status(e.message || String(e), true); }
  finally { $("generate").disabled = false; }
});
$("openBrowsers").addEventListener("click", async () => {
  $("openBrowsers").disabled = true; status("Opening five separate Chrome profiles…");
  try {
    const r = await window.finalAsmr.launchFive();
    if (!r.ok) status(r.error, true);
    else status(r.results.filter(x => x.status !== "error").length + "/5 browser profiles opened or already running.");
  } catch (e) { status(e.message || String(e), true); }
  finally { $("openBrowsers").disabled = false; }
});
window.finalAsmr.onBrowserProgress(item => {
  const el = $("browser" + item.id); if (el) el.textContent = item.status === "error" ? "Failed" : item.status === "already-open" ? "Already open" : "Ready";
});
window.finalAsmr.onWorkerEvent(event => status("Account " + event.profileId + ": " + (event.message || event.type || event.status)));
(async () => {
  const saved = await window.finalAsmr.getState();
  projects = saved.projects || {};
  prompts = saved.prompts?.length === 5 ? saved.prompts : [
    "A ripe mango is sliced slowly with a polished chef's knife on a clean wooden board, crisp close-up ASMR, juicy texture, natural studio lighting, no music, no text.",
    "A glossy red apple is cut into precise thin slices, macro camera, delicate crunching sounds, clean composition, realistic fruit texture, no music, no text.",
    "A fresh green kiwi is sliced in half and into neat rounds, detailed macro shot, soft natural light, satisfying wet cutting sounds, no music, no text.",
    "A chilled watermelon is cut into clean cubes, vivid red flesh and sparkling juice, close-up ASMR, slow deliberate knife movement, no music, no text.",
    "A dragon fruit is sliced open and cut into elegant pieces, bright magenta skin and speckled white interior, macro cinematic ASMR, no music, no text."
  ];
  renderPrompts(); renderAccounts();
  $("bridgeToken").textContent = saved.bridgeToken;
  $("bridgeUrl").textContent = saved.bridgeUrl;
})();
