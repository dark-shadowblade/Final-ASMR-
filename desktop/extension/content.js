(() => {
 if(window.__finalAsmrInstalled)return;window.__finalAsmrInstalled=true;
 const visible=e=>!!e&&e.isConnected&&e.getClientRects().length>0;
 const emit=(event,status,message="")=>chrome.runtime.sendMessage({type:"FLOW_TASK_EVENT",event,status,message});
 const sameProject=(a,b)=>{try{return new URL(a).pathname===new URL(b).pathname;}catch{return false;}};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function promptField(){const selectors=["div.ProseMirror[contenteditable='true']","flow-rich-text-editor [contenteditable='true']","[contenteditable='true'][role='textbox']","textarea","[role='textbox']"];for(const s of selectors){const a=[...document.querySelectorAll(s)].filter(visible);if(a.length===1)return a[0];if(a.length>1)return null;}return null;}
 function buttons(){return[...document.querySelectorAll("button,[role=button],[role=combobox]")].filter(visible);}
 function exactOption(expected){return[...document.querySelectorAll('[role="option"],[role="menuitem"],button,[role=button]')].filter(visible).filter(e=>(e.innerText||e.textContent||"").trim().toLowerCase()===String(expected).toLowerCase());}
 async function waitForPage(task){const end=Date.now()+90000;while(Date.now()<end){if(!sameProject(location.href,task.projectUrl))throw Error("Project URL changed or does not match assigned account.");if(document.body.innerText.toLowerCase().includes("404"))throw Error("Flow project returned a 404 page.");if(promptField())return;await sleep(1000);}throw Error("Flow editor did not become ready within 90 seconds.");}
 async function chooseSetting(kind,expected,regex){let control=null;for(let n=0;n<25;n++){const found=buttons().filter(e=>regex.test([e.getAttribute("aria-label"),e.title,e.innerText,e.textContent].join(" ")));if(found.length===1){control=found[0];break;}await sleep(500);}if(!control)throw Error("Cannot uniquely identify "+kind+" setting control.");control.click();await sleep(450);let opts=exactOption(expected);if(opts.length!==1)throw Error("Could not find one exact "+kind+" option: "+expected);opts[0].click();await sleep(600);const selected=buttons().map(e=>[e.getAttribute("aria-label"),e.innerText,e.textContent].join(" ")).join(" ").toLowerCase();if(!selected.includes(String(expected).toLowerCase()))throw Error("Could not verify "+kind+" selection: "+expected);}
 function insertText(el,text){el.focus();if(el.isContentEditable){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("delete");document.execCommand("insertText",false,text);}else{const p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,text);}el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));el.dispatchEvent(new Event("change",{bubbles:true}));}
 async function run(task){try{if(!sameProject(location.href,task.projectUrl))throw Error("Wrong project tab for this account.");await waitForPage(task);
 // Each account receives its own prompt; all accounts use this shared settings object.
 await chooseSetting("model",task.settings.model,/model|veo/i);
 await chooseSetting("resolution",task.settings.resolution,/resolution|quality|720p|1080p/i);
 await chooseSetting("duration",task.settings.durationSeconds+" seconds",/duration|seconds|8s/i);
 await chooseSetting("aspect ratio",task.settings.aspectRatio,/aspect|ratio|portrait|landscape/i);
 const field=promptField();if(!field)throw Error("Prompt input is not uniquely identifiable.");insertText(field,task.prompt);await sleep(300);
 const actual=(field.value||field.innerText||field.textContent||"").trim();if(actual!==task.prompt.trim())throw Error("Prompt insertion verification failed.");
 const gen=buttons().filter(e=>/start generation|generate|create video|arrow_forward/i.test([e.getAttribute("aria-label"),e.title,e.innerText,e.textContent].join(" ")));
 if(gen.length!==1||gen[0].disabled||gen[0].getAttribute("aria-disabled")==="true")throw Error("Generate button is missing, disabled, or ambiguous.");
 gen[0].click();emit("PROMPT_SUBMITTED","submitted","Account "+task.profileId+": settings verified, its own prompt inserted and Generate clicked.");task.prompt="";
 }catch(e){emit("FLOW_AUTOMATION_BLOCKED","error",e.message||String(e));}}
 chrome.runtime.onMessage.addListener(m=>{if(m?.type==="RUN_ASSIGNED_TASK"&&m.task)run(m.task);});
 if(/\/project\/[A-Za-z0-9-]{12,}/.test(location.pathname))chrome.runtime.sendMessage({type:"FLOW_PROJECT_READY"});
})();
