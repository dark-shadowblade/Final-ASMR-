(() => {
 if(window.__finalAsmrInstalled)return;window.__finalAsmrInstalled=true;
 const cancelledTasks=new Set();
 const assertRunning=id=>{if(cancelledTasks.has(id))throw new Error("JOB_CANCELLED");};
 const visible=e=>!!e&&e.isConnected&&e.getClientRects().length>0;
 const emit=(event,status,message="")=>chrome.runtime.sendMessage({type:"FLOW_TASK_EVENT",event,status,message});
 const sameProject=(a,b)=>{try{return new URL(a).pathname===new URL(b).pathname;}catch{return false;}};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function promptField(){const selectors=["div.ProseMirror[contenteditable='true']","flow-rich-text-editor [contenteditable='true']","[contenteditable='true'][role='textbox']","textarea","[role='textbox']"];for(const s of selectors){const a=[...document.querySelectorAll(s)].filter(visible);if(a.length===1)return a[0];if(a.length>1)return null;}return null;}
 function buttons(){return[...document.querySelectorAll("button,[role=button],[role=combobox]")].filter(visible);}
 function exactOption(expected){return[...document.querySelectorAll('[role="option"],[role="menuitem"],button,[role=button]')].filter(visible).filter(e=>(e.innerText||e.textContent||"").trim().toLowerCase()===String(expected).toLowerCase());}
 async function waitForPage(task){const end=Date.now()+90000;while(Date.now()<end){assertRunning(task.id);if(!sameProject(location.href,task.projectUrl))throw Error("Project URL changed or does not match assigned account.");if(document.body.innerText.toLowerCase().includes("404"))throw Error("Flow project returned a 404 page.");if(promptField())return;await sleep(1000);}throw Error("Flow editor did not become ready within 90 seconds.");}
 async function waitAndClickDownload(before){const end=Date.now()+10*60*1000;while(Date.now()<end){assertRunning(window.__finalAsmrTaskId);const found=buttons().filter(e=>!before.has(e)&&/download/i.test([e.getAttribute("aria-label"),e.title,e.innerText,e.textContent].join(" "))&&!e.disabled&&e.getAttribute("aria-disabled")!=="true");if(found.length===1){found[0].click();return;}await sleep(1500);}throw Error("A new generated-video download control did not appear within 10 minutes.");}
 function insertText(el,text){el.focus();if(el.isContentEditable){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("delete");document.execCommand("insertText",false,text);}else{const p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,text);}el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));el.dispatchEvent(new Event("change",{bubbles:true}));}
 async function run(task){try{cancelledTasks.delete(task.id);window.__finalAsmrTaskId=task.id;if(!sameProject(location.href,task.projectUrl))throw Error("Wrong project tab for this account.");await waitForPage(task);
 // Video settings remain preconfigured in Flow; this worker handles only prompt submission and download.
 const field=promptField();if(!field)throw Error("Prompt input is not uniquely identifiable.");insertText(field,task.prompt);await sleep(300);
 const actual=(field.value||field.innerText||field.textContent||"").trim();if(actual!==task.prompt.trim())throw Error("Prompt insertion verification failed.");
 const beforeDownloads=new Set(buttons().filter(e=>/download/i.test([e.getAttribute("aria-label"),e.title,e.innerText,e.textContent].join(" "))));
 const gen=buttons().filter(e=>/start generation|generate|create video|arrow_forward/i.test([e.getAttribute("aria-label"),e.title,e.innerText,e.textContent].join(" ")));
 if(gen.length!==1||gen[0].disabled||gen[0].getAttribute("aria-disabled")==="true")throw Error("Generate button is missing, disabled, or ambiguous.");
 gen[0].click();emit("PROMPT_SUBMITTED","submitted","Account "+task.profileId+": its own prompt was inserted and Generate clicked.");task.prompt="";await waitAndClickDownload(beforeDownloads);
 }catch(e){if(e.message!=="JOB_CANCELLED")emit("FLOW_AUTOMATION_BLOCKED","error",e.message||String(e));}finally{if(window.__finalAsmrTaskId===task.id)window.__finalAsmrTaskId=null;}}
 chrome.runtime.onMessage.addListener(m=>{if(m?.type==="RUN_ASSIGNED_TASK"&&m.task)run(m.task);if(m?.type==="CANCEL_ASSIGNED_TASK"&&m.taskId)cancelledTasks.add(m.taskId);});
 if(/\/project\/[A-Za-z0-9-]{12,}/.test(location.pathname))chrome.runtime.sendMessage({type:"FLOW_PROJECT_READY"});
})();
