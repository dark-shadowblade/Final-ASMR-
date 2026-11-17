(() => {
 if (window.__finalAsmrInstalled) return;
 window.__finalAsmrInstalled = true;
 const cancelledTasks = new Set();
 const startedTasks = new Set();
 const assertRunning = id => { if (cancelledTasks.has(id)) throw new Error("JOB_CANCELLED"); };
 const visible = e => !!e && e.isConnected && e.getClientRects().length > 0;
 const sleep = ms => new Promise(r => setTimeout(r, ms));
 const emit = (event,status,message="") => chrome.runtime.sendMessage({type:"FLOW_TASK_EVENT",event,status,message});
 const projectPath = value => { try { return new URL(value).pathname.replace(/\/+$/,""); } catch { return ""; } };
 const sameProject = (a,b) => !!projectPath(a) && projectPath(a) === projectPath(b);
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
   return [...document.querySelectorAll("button,[role=button],[role=menuitem],[role=option],[role=menuitemradio],[tabindex]:not([tabindex='-1'])")].filter(visible);
 }
 function qualityOptionMatches() {
   // Flow's export menu labels the video choice "720p / Original size";
   // the 270p choice is an Animated GIF and must never be clicked.
   const candidates=[...document.querySelectorAll("body *")].filter(e=>{
     if(!visible(e)||e.children.length>3)return false;
     const text=normalizedText(e.innerText||e.textContent);
     return text.length<=100&&/\b720\s*p\b/i.test(text)&&/original\s*size/i.test(text)&&!/gif|270\s*p|1080\s*p|4k|upscale/i.test(text);
   });
   const targets=new Set();
   for(const e of candidates){
     const target=e.closest("button,[role=button],[role=menuitem],[role=option],[role=menuitemradio],[tabindex]:not([tabindex='-1'])")||e;
     if(visible(target)&&!target.disabled&&target.getAttribute("aria-disabled")!=="true")targets.add(target);
   }
   // Keep only the outer actionable target for each matching label.
   return [...targets].filter(t=>![...targets].some(other=>other!==t&&other.contains(t)));
 }
 function exactActionMatches(pattern) {
   return menuItems().filter(e => pattern.test(label(e)) && !e.disabled && e.getAttribute("aria-disabled") !== "true");
 }
 function normalizedText(value) { return String(value||"").replace(/\s+/g," ").trim(); }
 function cardStableKeys(card) {
   const keys = [];
   for (const attr of ["data-asset-id","data-id","data-video-id","data-generation-id"]) {
     const value = card.getAttribute(attr);
     if (value) keys.push(attr+":"+value);
   }
   for (const media of card.querySelectorAll("video,video source")) {
     const url = media.currentSrc || media.src || media.getAttribute("src");
     if (url) keys.push("media:"+url);
   }
   return keys;
 }
 function promptCardCandidates(prompt) {
   const wanted=normalizedText(prompt);
   const matches=[];
   const textNodes=[];
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
     const node=walker.currentNode;
     if(normalizedText(node.nodeValue)===wanted) textNodes.push(node);
   }
   for(const node of textNodes){
     let el=node.parentElement;
     for(let depth=0;el&&depth<9;depth++,el=el.parentElement){
       if(!visible(el)) continue;
       const text=normalizedText(el.innerText||el.textContent);
       if(text.length>wanted.length+1800) continue;
       const hasMore=[...el.querySelectorAll("button,[role=button]")].some(x=>visible(x)&&/\bmore\b|\bmore options\b/.test(label(x)));
       const hasMedia=!!el.querySelector("video,video source,[data-testid*=video],[aria-label*=video i]");
       if(hasMore&&(hasMedia||/\bvideo\b/i.test(text))){
         matches.push(el);
         break;
       }
     }
   }
   return [...new Set(matches)];
 }
 function captureExistingCards(prompt) {
   const cards = promptCardCandidates(prompt);
   return {
     nodes: new WeakSet(cards),
     stableKeys: new Set(cards.flatMap(cardStableKeys))
   };
 }
 function isNewPromptCard(card, baseline) {
   // DOM identity prevents a pre-existing card from becoming "new" just because
   // Flow updates its status text, thumbnail, or menu labels.
   if (baseline.nodes.has(card)) return false;
   // Stable asset/media IDs also protect against Flow re-rendering an old card
   // into a replacement DOM node after Generate is clicked.
   const keys = cardStableKeys(card);
   if (keys.some(key => baseline.stableKeys.has(key))) return false;
   return true;
 }
 function cardMoreButton(card) {
   const found=[...card.querySelectorAll("button,[role=button]")].filter(e=>visible(e)&&/\bmore\b|\bmore options\b/.test(label(e))&&!e.disabled&&e.getAttribute("aria-disabled")!=="true");
   return found.length===1?found[0]:null;
 }
 async function waitAndClickDownload(task,baseline) {
   // Only act on a new Flow tile carrying this exact prompt. Existing matching tiles are excluded.
   const card=await waitFor(task,()=>{
     const candidates=promptCardCandidates(task.prompt).filter(c=>isNewPromptCard(c,baseline));
     if(candidates.length!==1)return null;
     const media=candidates[0].querySelector("video");
     const more=cardMoreButton(candidates[0]);
     if(!media||media.readyState<2||!more)return null;
     const cardText=normalizedText(candidates[0].innerText||candidates[0].textContent);
     if(/\b(generating|queued|processing|creating|in progress)\b/i.test(cardText))return null;
     return candidates[0];
   },15*60*1000,"Could not identify exactly one newly generated, completed video card matching this prompt. No download was attempted.");
   assertRunning(task.id);
   const more=cardMoreButton(card);
   if(!more)throw Error("The identified new video card does not have one unambiguous More button.");
   more.click();
   const download=await waitFor(task,()=>{
     const matches=exactActionMatches(/\bdownload\b/);
     return matches.length===1?matches[0]:null;
   },15000,"Flow's Download menu item was not uniquely available.");
   assertRunning(task.id);
   download.click();
   const quality=await waitFor(task,()=>{
     const matches=qualityOptionMatches();
     return matches.length===1?matches[0]:null;
   },15000,"Flow did not expose exactly one clickable 720p Original size video export option (the 270p Animated GIF is intentionally ignored).");
   assertRunning(task.id);
   quality.click();
   emit("DOWNLOAD_CLICKED","downloading","Account "+task.profileId+": selected 720p from the new video card matching the submitted prompt.");
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
     const baseline = captureExistingCards(task.prompt);
     const generate = await waitForGenerate(task);
     assertRunning(task.id);
     generate.click();
     emit("PROMPT_SUBMITTED","submitted","Account "+task.profileId+": prompt verified and Generate clicked.");
     await waitAndClickDownload(task,baseline);
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