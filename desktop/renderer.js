const button = document.getElementById("launch");
const status = document.getElementById("status");
const setState = (id, label, color) => {
  const el = document.getElementById("s" + id);
  el.innerHTML = '<i class="dot" style="background:' + color + '"></i>' + label;
};
button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Launching five isolated Chrome profiles…";
  const result = await window.finalAsmr.launchFive();
  button.disabled = false;
  if (!result.ok) {
    status.textContent = result.error;
    return;
  }
  for (const item of result.results) {
    setState(item.id, item.status === "already-open" ? "Already open" : "Launched", "#31c48d");
  }
  const launched = result.results.filter(x => x.status === "launched").length;
  status.textContent = launched + " new browser(s) launched; " + (5 - launched) + " already open.";
});
window.finalAsmr.onLaunchError(({id, message}) => {
  setState(id, "Error", "#f87171");
  status.textContent = "Browser " + id + ": " + message;
});
window.finalAsmr.getProfileRoot().then(p => {
  document.getElementById("path").textContent = "Profile storage: " + p;
});
