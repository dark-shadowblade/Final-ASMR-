(() => {
  if (window.__finalAsmrInstalled) return;
  window.__finalAsmrInstalled = true;
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;
  const emit = (event, status, message = "") => chrome.runtime.sendMessage({ type: "FLOW_TASK_EVENT", event, status, message });
  const sameProject = (a, b) => { try { return new URL(a).pathname === new URL(b).pathname; } catch { return false; } };
  function promptField() {
    const selectors = ["div.ProseMirror[contenteditable='true']", "flow-rich-text-editor [contenteditable='true']", "[contenteditable='true'][role='textbox']", "textarea", "[role='textbox']"];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].filter(visible);
      if (found.length === 1) return found[0];
      if (found.length > 1) return null;
    }
    return null;
  }
  function labelledButton(regex) {
    const found = [...document.querySelectorAll("button,[role=button]")].filter(visible).filter(el => regex.test([el.getAttribute("aria-label"), el.title, el.innerText, el.textContent].join(" ").toLowerCase()));
    return found.length === 1 ? found[0] : null;
  }
  function insertText(el, text) {
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.execCommand("delete"); document.execCommand("insertText", false, text);
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function chooseSetting(kind, expected) {
    const labels = { model: /model|veo/i, resolution: /resolution|quality|720p|1080p/i, duration: /duration|seconds|8s/i, aspectRatio: /aspect|ratio|portrait|landscape/i };
    const controls = [...document.querySelectorAll("button,[role=button],[role=combobox]")].filter(visible)
      .filter(el => labels[kind].test([el.getAttribute("aria-label"), el.innerText, el.textContent].join(" ")));
    if (controls.length !== 1) throw new Error("Cannot uniquely identify Flow " + kind + " control.");
    controls[0].click();
    await new Promise(r => setTimeout(r, 350));
    const options = [...document.querySelectorAll('[role="option"],[role="menuitem"],button,[role=button]')].filter(visible)
      .filter(el => (el.innerText || el.textContent || "").trim().toLowerCase() === String(expected).toLowerCase());
    if (options.length !== 1) throw new Error("Flow does not expose one exact " + kind + " option: " + expected);
    options[0].click();
    await new Promise(r => setTimeout(r, 250));
    const selected = [...document.querySelectorAll('[aria-selected="true"],[aria-pressed="true"],[aria-checked="true"],[data-state="on"],button,[role=combobox]')].filter(visible)
      .map(el => [el.getAttribute("aria-label"), el.innerText, el.textContent].join(" ").toLowerCase()).join(" ");
    if (!selected.includes(String(expected).toLowerCase())) throw new Error("Could not verify selected " + kind + ": " + expected);
  }
  async function run(task) {
    if (!sameProject(location.href, task.projectUrl)) return emit("PROJECT_MISMATCH", "error", "This tab is not the assigned Flow project.");
    if (document.body.innerText.toLowerCase().includes("sign in")) return emit("SIGN_IN_REQUIRED", "error", "Google sign-in is required in this profile.");
    try {
      await chooseSetting("model", task.settings.model);
      await chooseSetting("resolution", task.settings.resolution);
      await chooseSetting("duration", task.settings.durationSeconds + " seconds");
      await chooseSetting("aspectRatio", task.settings.aspectRatio);
      const field = promptField();
      const generate = labelledButton(/start generation|generate|create video|arrow_forward/i);
      if (!field || !generate || generate.disabled || generate.getAttribute("aria-disabled") === "true") throw new Error("Prompt field or Generate button could not be uniquely verified.");
      insertText(field, task.prompt);
      const value = (field.value || field.innerText || field.textContent || "").trim();
      if (value !== task.prompt.trim()) throw new Error("Prompt insertion could not be verified.");
      generate.click();
      emit("PROMPT_SUBMITTED", "submitted", "Prompt accepted for submission; waiting for Flow generation.");
      // The task prompt is not retained in extension storage after submission.
      task.prompt = "";
    } catch (error) {
      emit("FLOW_AUTOMATION_BLOCKED", "error", error.message || String(error));
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "RUN_ASSIGNED_TASK" && message.task) run(message.task);
  });
  if (/\/project\/[A-Za-z0-9-]{12,}/.test(location.pathname)) {
    chrome.runtime.sendMessage({ type: "FLOW_PROJECT_READY" });
  }
})();