(() => {
 if (window.__finalAsmrInstalled) return;
 window.__finalAsmrInstalled = true;
 const cancelledTasks = new Set();
 const startedTasks = new Set();
 const assertRunning = id => { if (cancelledTasks.has(id)) throw new Error("JOB_CANCELLED"); };
 const visible = e => !!e && e.isConnected && e.getClientRects().length > 0;
 const sleep = ms => new Promise(r => setTimeout(r, ms));
 const emit = (event,status,message="") => chrome.runtime.sendMessage({type:"FLOW_TASK_EVENT",event,status,message});
 const sameProject = (a,b) => { try { return new URL(a).pathname === new URL(b).pathname; } catch { return false; } };
 function promptField() {
   const selectors = ["div.ProseMirror[contenteditable='true']","flow-rich-text-editor [contenteditable='true']","[contenteditable='true'][role='textbox']","textarea","[role='textbox']"];
   for (const selector of selectors) {
     const candidates = [...document.querySelectorAll(selector)].filter(visible).filter(e => !e.disabled && e.getAttribute("aria-disabled") !== "true");
     if (candidates.length === 1) return candidates[0];
     if (candidates.length > 1) return null;
   }
   return null;
 }
 function buttons() { return [...document.querySelectorAll("button,[role=button]")].filter(visible); }
 const label = e => [e.getAttribute("aria-label"),e.getAttribute("data-testid"),e.title,e.innerText,e.textContent].filter(Boolean).join(" ").trim().toLowerCase();
 async function waitFor(task, predicate, timeout, message) {
   const end = Date.now() + timeout;
   while (Date.now() < end) {
     assertRunning(task.id);
     if (!sameProject(location.href,task.projectUrl)) throw Error("Project URL changed or does not match assigned account.");
     const result = predicate();
     if (result) return result;
     await sleep(500);
   }
   throw Error(message);
 }
 async function waitForPage(task) {
   await waitFor(task, () => {
     const body = (document.body?.innerText || "").toLowerCase();
     if (body.includes("404") || body.includes("page not found")) throw Error("Flow project returned a 404 page.");
     return promptField();
   }, 180000, "Flow editor did not become ready within 3 minutes.");
 }
 function insertText(el,text) {
   el.focus();
   if (el.isContentEditable) {
     const range = document.createRange(); range.selectNodeContents(el);
     const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
     document.execCommand("delete"); document.execCommand("insertText",false,text);
   } else {
     const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto,"value").set.call(el,text);
   }
   el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
   el.dispatchEvent(new Event("change",{bubbles:true}));
 }
 async function waitForGenerate(task) {
   return waitFor(task, () => {
     const matches = buttons().filter(e => /^(generate|generate video|create video|start generation)$/.test(label(e)) || /generate video|start generation/.test(label(e)));
     return matches.length === 1 && !matches[0].disabled && matches[0].getAttribute("aria-disabled") !== "true" ? matches[0] : null;
   }, 60000, "Generate button did not become uniquely available within 60 seconds.");
 }
 function menuItems() {
   return [...document.querySelectorAll("button,[role=button],[role=menuitem],[role=option]")].filter(visible);
 }
 function exactActionMatches(pattern) {
   return menuItems().filter(e => pattern.test(label(e)) && !e.disabled && e.getAttribute("aria-disabled") !== "true");
 }
 async function clickUniqueAction(pattern,timeout,message) {
   const el = await waitFor({id:window.__finalAsmrTaskId,projectUrl:location.href},() => {
     const matches = exactActionMatches(pattern);
     return matches.length === 1 ? matches[0] : null;
   },timeout,message);
   el.click();
   return el;
 }
 async function waitAndClickDownload(task,before) {
   // Flow's documented route: generated clip > More (⋮) > Download > choose 720p video.
   const more = await waitFor(task,() => {
     const matches = buttons().filter(e => /\bmore\b|\bmore options\b|\bopen menu\b/.test(label(e)) && !e.disabled && e.getAttribute("aria-disabled") !== "true");
     return matches.length === 1 ? matches[0] : null;
   },15*60*1000,"The generated clip's More menu did not become uniquely available.");
   assertRunning(task.id);
   more.click();
   const download = await waitFor(task,() => {
     const matches = exactActionMatches(/\bdownload\b/);
     return matches.length === 1 ? matches[0] : null;
   },15000,"Flow's Download menu item did not appear after opening More.");
   assertRunning(task.id);
   download.click();
   const quality = await waitFor(task,() => {
     const matches = menuItems().filter(e => {
       const text = label(e).replace(/\\s+/g," ").trim();
       const enabled = !e.disabled && e.getAttribute("aria-disabled") !== "true";
       // 720p is the guide's original-video export; never choose the 270p GIF or an upscale.
       return enabled && /\\b720\\s*p\\b/.test(text) && !/gif|270\\s*p|1080\\s*p|4k|upscale/.test(text);
     });
     return matches.length === 1 ? matches[0] : null;
   },15000,"Flow did not expose one unambiguous 720p video export option.");
   assertRunning(task.id);
   quality.click();
   emit("DOWNLOAD_CLICKED","downloading","Account "+task.profileId+": selected Flow's 720p original-video export.");
   return quality;
 }
 async function run(task) {
   if (!task?.id || startedTasks.has(task.id)) return;
   startedTasks.add(task.id);
   window.__finalAsmrTaskId = task.id;
   try {
     if (!sameProject(location.href,task.projectUrl)) throw Error("Wrong project tab for this account.");
     await waitForPage(task);
     assertRunning(task.id);
     const field = promptField();
     if (!field) throw Error("Prompt input is ambiguous; refusing to type into the wrong field.");
     insertText(field,task.prompt);
     await waitFor(task,() => {
       const value = (field.value ?? field.innerText ?? field.textContent ?? "").trim();
       return value === task.prompt.trim();
     },10000,"Prompt insertion could not be verified.");
     const beforeDownloads = new Map(buttons().filter(e => /download/.test(label(e))).map(e => [e,(e.disabled || e.getAttribute("aria-disabled") === "true") ? "disabled" : "enabled"]));
     const generate = await waitForGenerate(task);
     assertRunning(task.id);
     generate.click();
     emit("PROMPT_SUBMITTED","submitted","Account "+task.profileId+": prompt verified and Generate clicked.");
     await waitAndClickDownload(task,beforeDownloads);
     assertRunning(task.id);
   } catch (e) {
     if (e.message !== "JOB_CANCELLED") emit("FLOW_AUTOMATION_BLOCKED","error",e.message || String(e));
   } finally {
     if (window.__finalAsmrTaskId === task.id) window.__finalAsmrTaskId = null;
   }
 }
 chrome.runtime.onMessage.addListener(m => {
   if (m?.type === "RUN_ASSIGNED_TASK" && m.task) run(m.task);
   if (m?.type === "CANCEL_ASSIGNED_TASK" && m.taskId) cancelledTasks.add(m.taskId);
 });
 if (/\/project\/[A-Za-z0-9-]{12,}/.test(location.pathname)) chrome.runtime.sendMessage({type:"FLOW_PROJECT_READY"});
})();