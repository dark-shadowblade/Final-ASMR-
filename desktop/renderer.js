const button = document.getElementById("launch");
const status = document.getElementById("status");
const setState = (id, label, color) => {
  const el = document.getElementById("s" + id);
  el.innerHTML = '<i class="dot" style="background:' + color + '"></i>' + label;
};
button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Starting and verifying each Chrome profile…";
  try {
    const result = await window.finalAsmr.launchFive();
    if (!result.ok) {
      status.textContent = "Launch failed: " + result.error;
      return;
    }
    let opened = 0, existing = 0, failed = 0;
    for (const item of result.results) {
      if (item.status === "opened") { opened++; setState(item.id, "Verified", "#31c48d"); }
      else if (item.status === "already-open") { existing++; setState(item.id, "Already open", "#31c48d"); }
      else { failed++; setState(item.id, "Failed", "#f87171"); }
    }
    status.textContent = opened + " opened and verified; " + existing + " already open; " + failed + " failed.";
    const errors = result.results.filter(x => x.status === "error")
      .map(x => "Profile " + x.id + ": " + x.error).join(" | ");
    if (errors) status.textContent += " " + errors;
  } catch (error) {
    status.textContent = "Unexpected launch error: " + (error.message || String(error));
  } finally {
    button.disabled = false;
  }
});
window.finalAsmr.onLaunchError(({id, message}) => {
  setState(id, "Failed", "#f87171");
  status.textContent = "Profile " + id + " failed: " + message;
});
window.finalAsmr.getProfileRoot().then(p => {
  document.getElementById("path").textContent = "Profile storage: " + p;
});
