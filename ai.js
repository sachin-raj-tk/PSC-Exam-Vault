/* =====================================================================
   AI integration — model-agnostic, bring-your-own-key.
   Presets live ONLY in this browser (localStorage), never in backups/exports.
   Two wire formats: "openai" (OpenAI-compatible chat/completions) and "anthropic".
   ===================================================================== */
const AI_STORE_KEY = "psev_ai_v1";
const AI_TEMPLATES = [
  { key:"openrouter", label:"OpenRouter (many models, some free)", format:"openai", baseUrl:"https://openrouter.ai/api/v1", model:"", hint:"Pick any model id from openrouter.ai/models (free ones end in :free)." },
  { key:"gemini", label:"Google Gemini", format:"openai", baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai", model:"gemini-flash-latest", hint:"Key from aistudio.google.com. If you get a 404, enter a current model name (e.g. gemini-3.8-flash)." },
  { key:"groq", label:"Groq", format:"openai", baseUrl:"https://api.groq.com/openai/v1", model:"llama-3.3-70b-versatile", hint:"Key from console.groq.com. Check their model list for current names." },
  { key:"openai", label:"OpenAI", format:"openai", baseUrl:"https://api.openai.com/v1", model:"gpt-4o-mini", hint:"Key from platform.openai.com." },
  { key:"anthropic", label:"Anthropic (Claude)", format:"anthropic", baseUrl:"https://api.anthropic.com", model:"claude-haiku-4-5-20251001", hint:"Key from console.anthropic.com." },
  { key:"deepseek", label:"DeepSeek", format:"openai", baseUrl:"https://api.deepseek.com/v1", model:"deepseek-chat", hint:"Key from platform.deepseek.com." },
  { key:"mistral", label:"Mistral", format:"openai", baseUrl:"https://api.mistral.ai/v1", model:"mistral-small-latest", hint:"Key from console.mistral.ai." },
  { key:"custom", label:"Custom (any OpenAI-compatible URL)", format:"openai", baseUrl:"", model:"", hint:"Base URL up to /v1 — the app adds /chat/completions." }
];
const AI_LANGS = [["en","English"],["ml","Malayalam"],["both","English + Malayalam"]];

function aiLoad(){
  try{
    const o = JSON.parse(localStorage.getItem(AI_STORE_KEY)||"null");
    if(o && Array.isArray(o.presets)) return Object.assign({ activeId:null, fallback:true, lang:"en" }, o);
  }catch(e){}
  return { presets:[], activeId:null, fallback:true, lang:"en" };
}
function aiSave(st){ try{ localStorage.setItem(AI_STORE_KEY, JSON.stringify(st)); }catch(e){} }
function aiActivePreset(st){ st = st||aiLoad(); return st.presets.find(p=>p.id===st.activeId) || st.presets[0] || null; }
function aiUid(){ return "ai"+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36); }
function aiUpdateBtnLabel(){
  const el = document.getElementById("aiBtnLabel"); if(!el) return;
  const p = aiActivePreset();
  el.textContent = p ? p.name : "not set up";
}

/* ---------- low-level request ---------- */
async function aiRequest(preset, system, user, maxTokens){
  if(!preset.apiKey) throw Object.assign(new Error("No API key"), {status:401});
  if(!preset.model) throw Object.assign(new Error("No model name set"), {status:400});
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), 90000);
  let url, headers, body;
  const base = (preset.baseUrl||"").replace(/\/+$/,"");
  if(preset.format==="anthropic"){
    url = base + "/v1/messages";
    headers = { "content-type":"application/json", "x-api-key":preset.apiKey, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" };
    body = { model:preset.model, max_tokens:maxTokens||2500, system, messages:[{role:"user",content:user}] };
  } else {
    url = base + "/chat/completions";
    headers = { "content-type":"application/json", "authorization":"Bearer "+preset.apiKey };
    body = { model:preset.model, max_tokens:maxTokens||2500, temperature:0.4, messages:[{role:"system",content:system},{role:"user",content:user}] };
    if(/openrouter\.ai/i.test(base)) body.reasoning = { exclude:true };
  }
  let res;
  try{
    res = await fetch(url, { method:"POST", headers, body:JSON.stringify(body), signal:ctrl.signal });
  }catch(e){
    clearTimeout(timer);
    throw Object.assign(new Error(e.name==="AbortError" ? "Timed out" : "Network/CORS error — this provider may block browser calls"), {status:0});
  }
  clearTimeout(timer);
  let data = null, raw = "";
  try{ raw = await res.text(); data = JSON.parse(raw); }catch(e){}
  if(!res.ok){
    const msg = (data && (data.error && (data.error.message||data.error) || data.message)) || raw.slice(0,200) || ("HTTP "+res.status);
    const m = typeof msg==="string" ? msg : JSON.stringify(msg);
    const limit = res.status===429 || res.status===402 || res.status===529 || /quota|rate.?limit|exhaust|billing|credit|overload/i.test(m);
    const busy = !limit && (res.status===500 || res.status===502 || res.status===503 || res.status===504 || /high demand|unavailable|try again later|temporar/i.test(m));
    throw Object.assign(new Error(m.slice(0,240)), {status:res.status, limit, busy});
  }
  let text = "";
  if(preset.format==="anthropic") text = ((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n"));
  else text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  if(Array.isArray(text)) text = text.map(t=>t.text||"").join("\n");
  if(!String(text).trim()){
    /* reasoning models can spend the whole token budget on thinking and return nothing: retry once with a bigger budget */
    if(!aiRequest._retry && (maxTokens||2500) < 6000){
      aiRequest._retry = true;
      try{ return await aiRequest(preset, system, user, Math.min(8000, Math.max(1500, (maxTokens||2500)*4))); }
      finally{ aiRequest._retry = false; }
    }
    const fr = data && data.choices && data.choices[0] && data.choices[0].finish_reason;
    throw Object.assign(new Error("Empty reply from model" + (fr ? " (finish: "+fr+")" : "") + " — it may be a reasoning model; try another model"), {status:0});
  }
  return String(text).trim();
}

/* ---------- ask with automatic preset fallback ---------- */
async function aiAsk(system, user, maxTokens){
  let st = aiLoad();
  if(!st.presets.length) throw Object.assign(new Error("NO_PRESET"), {noPreset:true});
  const start = Math.max(0, st.presets.findIndex(p=>p.id===st.activeId));
  let order = st.presets.map((_,i)=> st.presets[(start+i)%st.presets.length]);
  if(!st.fallback) order = [order[0]];
  else {
    const fresh = order.filter(p=> !p.limitHitAt || Date.now()-p.limitHitAt > 3600000);
    if(fresh.length) order = fresh.concat(order.filter(p=>!fresh.includes(p)));
  }
  const errors = [];
  for(const p of order){
    try{
      let text;
      try{ text = await aiRequest(p, system, user, maxTokens); }
      catch(e1){
        /* provider briefly overloaded (503 etc.): wait a few seconds and retry once before moving on */
        if(e1 && e1.busy){ await new Promise(r=>setTimeout(r,3500)); text = await aiRequest(p, system, user, maxTokens); }
        else throw e1;
      }
      st = aiLoad();
      const live = st.presets.find(x=>x.id===p.id);
      if(live){ live.uses = (live.uses||0)+1; live.lastUsedAt = Date.now(); delete live.limitHitAt; }
      const switched = st.activeId !== p.id;
      st.activeId = p.id; aiSave(st); aiUpdateBtnLabel();
      if(switched) toast("Switched to preset: "+p.name);
      return text;
    }catch(e){
      errors.push(`${p.name}: ${e.message}`);
      if(e.limit){
        const s2 = aiLoad(); const live = s2.presets.find(x=>x.id===p.id);
        if(live){ live.limitHitAt = Date.now(); aiSave(s2); }
      }
    }
  }
  throw new Error(errors.join("\n"));
}

function aiLangInstruction(){
  const l = aiLoad().lang;
  if(l==="ml") return "Write your answer in Malayalam (keep proper nouns, dates and technical terms accurate; English terms in brackets where helpful).";
  if(l==="both") return "Write the answer in English first, then a Malayalam version under a line saying 'മലയാളം:'.";
  return "Write in clear, simple English.";
}
const AI_STYLE = "Formatting rules: plain text only. Use '-' for bullet points. No markdown headings, tables or code fences. You may wrap key facts in **double asterisks**. Use $...$ only for real maths. Be concise and exam-focused.";
function aiSystem(extra){
  return "You are an expert tutor for Kerala PSC (Public Service Commission) competitive exams, helping a student revise. Be accurate; if you are unsure of a fact, say so instead of guessing. "+AI_STYLE+" "+(extra||"");
}

/* ---------- shared UI bits ---------- */
function aiNeedSetup(){
  toast("Set up an AI preset first");
  openAISettings();
}
function aiModal(inner){
  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">${inner}</div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
}
function aiResultHtml(text){
  return `<div class="ai-result">${renderRichText(text)}</div>`;
}
function aiShowLoading(el, msg){ el.innerHTML = `<div class="ai-loading">⏳ ${escapeHtml(msg||"Thinking…")}</div>`; }
function aiShowError(el, e){
  if(e && e.noPreset){ el.innerHTML = `<div class="status err">No AI preset yet. <button class="iconbtn" id="aiGoSetup">Open settings</button></div>`;
    const b=document.getElementById("aiGoSetup"); if(b) b.addEventListener("click", openAISettings); return; }
  el.innerHTML = `<div class="status err" style="white-space:pre-wrap;">${escapeHtml(e.message||String(e))}</div>
    <div class="chart-note">If this keeps failing, check the preset in AI settings (key, model name, base URL).</div>`;
}
function aiFindQuestion(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return null;
  return (paper.questions||[]).find(qq=>String(qq.id)===String(qid)) || null;
}
function aiQuestionBlock(q, selIdx){
  const opts = (q.options||[]).map((o,i)=>`${letterFor(i)}) ${o}`).join("\n");
  const ci = q.correct_answer_index;
  let correct;
  if(ci===null || ci===undefined) correct = "Correct answer: NOT marked in the app (work it out and say how confident you are).";
  else if(Number(ci)===DELETED_SENTINEL) correct = "Official status: this question was DELETED by PSC (no valid answer).";
  else correct = `Correct answer: ${letterFor(Number(ci))}) ${(q.options||[])[Number(ci)]}`;
  let chosen = "";
  if(selIdx!==undefined && selIdx!==null && selIdx!=="" && !isNaN(Number(selIdx))) chosen = `\nStudent chose: ${letterFor(Number(selIdx))}) ${(q.options||[])[Number(selIdx)]}`;
  else if(selIdx==="none") chosen = "\nStudent left it unanswered.";
  return `Subject: ${q.subject||"?"} | Topic: ${q.topic||"?"}\nQuestion: ${q.question_text}\nOptions:\n${opts}\n${correct}${chosen}`;
}
function aiCopy(text){
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>toast("Copied"),()=>toast("Copy failed"));
  else toast("Copy not supported here");
}
function aiResultActions(kind){
  return `<div class="row-btns" style="flex-wrap:wrap;">
    <button class="iconbtn" id="aiCopyBtn" style="flex:1;justify-content:center;">📋 Copy</button>
    ${kind==="q" ? `<button class="iconbtn" id="aiSaveExpl" style="flex:1;justify-content:center;">Save as explanation</button>
    <button class="iconbtn" id="aiSaveNote" style="flex:1;justify-content:center;">Add to listing note</button>` : ""}
  </div>`;
}

/* ================= Settings ================= */
function openAISettings(editId){
  const st = aiLoad();
  if(editId){ return openAIPresetForm(editId); }
  const rows = st.presets.map((p,i)=>{
    const limited = p.limitHitAt && Date.now()-p.limitHitAt < 3600000;
    const mins = limited ? Math.max(1, 60-Math.floor((Date.now()-p.limitHitAt)/60000)) : 0;
    return `<div class="ai-preset ${p.id===st.activeId?"active":""}">
      <label class="ai-radio"><input type="radio" name="aiActive" value="${p.id}" ${p.id===st.activeId?"checked":""}>
        <span><b>${escapeHtml(p.name)}</b><br><span class="ai-sub">${escapeHtml(p.model||"(no model)")} · ${p.format==="anthropic"?"Anthropic":"OpenAI-style"} · ${p.uses||0} calls${limited?` · <span style="color:var(--bad)">limit hit, retry in ~${mins}m</span>`:""}</span></span></label>
      <div class="ai-preset-btns">
        <button class="iconbtn" data-up="${p.id}" ${i===0?"disabled":""}>↑</button>
        <button class="iconbtn" data-down="${p.id}" ${i===st.presets.length-1?"disabled":""}>↓</button>
        <button class="iconbtn" data-edit="${p.id}">✎</button>
      </div></div>`;
  }).join("");
  aiModal(`
    <h3>🤖 AI settings</h3>
    <div class="chart-note">Your keys stay on this phone only (never included in backups). Add several presets and switch when a free limit is hit.</div>
    ${rows || `<div class="chart-note" style="margin:12px 0;">No presets yet — add one below.</div>`}
    <div class="field" style="margin-top:12px;">
      <label>Add a preset</label>
      <select id="aiTplSel" class="ai-input">${AI_TEMPLATES.map(t=>`<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("")}</select>
      <button class="iconbtn primary" id="aiAddBtn" style="width:100%;justify-content:center;margin-top:8px;">+ Add preset</button>
    </div>
    <label class="switch-row" style="margin:12px 0;"><input type="checkbox" id="aiFallback" ${st.fallback?"checked":""}> Auto-switch to the next preset when one hits its limit or fails (list order = priority)</label>
    <div class="field"><label>AI answer language</label>
      <select id="aiLang" class="ai-input">${AI_LANGS.map(([v,l])=>`<option value="${v}" ${st.lang===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="row-btns"><button class="iconbtn" id="aiCloseBtn" style="flex:1;justify-content:center;">Close</button></div>`);
  document.querySelectorAll('input[name="aiActive"]').forEach(r=> r.addEventListener("change", ()=>{ const s=aiLoad(); s.activeId=r.value; aiSave(s); aiUpdateBtnLabel(); openAISettings(); }));
  const move = (id,d)=>{ const s=aiLoad(); const i=s.presets.findIndex(p=>p.id===id); const j=i+d; if(j<0||j>=s.presets.length) return; const t=s.presets[i]; s.presets[i]=s.presets[j]; s.presets[j]=t; aiSave(s); openAISettings(); };
  document.querySelectorAll("[data-up]").forEach(b=> b.addEventListener("click", ()=>move(b.dataset.up,-1)));
  document.querySelectorAll("[data-down]").forEach(b=> b.addEventListener("click", ()=>move(b.dataset.down,1)));
  document.querySelectorAll("[data-edit]").forEach(b=> b.addEventListener("click", ()=>openAIPresetForm(b.dataset.edit)));
  document.getElementById("aiAddBtn").addEventListener("click", ()=>{
    const t = AI_TEMPLATES.find(x=>x.key===document.getElementById("aiTplSel").value);
    const s = aiLoad();
    const p = { id:aiUid(), name:t.key==="custom"?"My preset":t.label.split(" (")[0], format:t.format, baseUrl:t.baseUrl, model:t.model, apiKey:"", uses:0, hint:t.hint };
    s.presets.push(p); if(!s.activeId) s.activeId = p.id; aiSave(s); aiUpdateBtnLabel();
    openAIPresetForm(p.id);
  });
  document.getElementById("aiFallback").addEventListener("change", e=>{ const s=aiLoad(); s.fallback=e.target.checked; aiSave(s); });
  document.getElementById("aiLang").addEventListener("change", e=>{ const s=aiLoad(); s.lang=e.target.value; aiSave(s); });
  document.getElementById("aiCloseBtn").addEventListener("click", closeModal);
}
function openAIPresetForm(id){
  const st = aiLoad();
  const p = st.presets.find(x=>x.id===id);
  if(!p) return openAISettings();
  aiModal(`
    <h3>Edit preset</h3>
    ${p.hint?`<div class="chart-note">${escapeHtml(p.hint)}</div>`:""}
    <div class="field"><label>Preset name</label><input class="ai-input" id="aiName" value="${escapeHtml(p.name)}"></div>
    <div class="field"><label>Format</label>
      <select class="ai-input" id="aiFormat"><option value="openai" ${p.format==="openai"?"selected":""}>OpenAI-compatible</option><option value="anthropic" ${p.format==="anthropic"?"selected":""}>Anthropic</option></select></div>
    <div class="field"><label>Base URL</label><input class="ai-input" id="aiBase" value="${escapeHtml(p.baseUrl||"")}" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label>Model name</label><input class="ai-input" id="aiModel" value="${escapeHtml(p.model||"")}" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label>API key</label>
      <div style="display:flex;gap:6px;"><input class="ai-input" id="aiKeyField" type="password" value="${escapeHtml(p.apiKey||"")}" autocapitalize="off" spellcheck="false" autocomplete="off"><button class="iconbtn" id="aiShowKey">👁</button></div></div>
    <div id="aiTestOut"></div>
    <div class="row-btns" style="flex-wrap:wrap;">
      <button class="iconbtn" id="aiTestBtn" style="flex:1;justify-content:center;">Test</button>
      <button class="iconbtn primary" id="aiSavePreset" style="flex:1;justify-content:center;">Save</button>
    </div>
    <div class="row-btns">
      <button class="iconbtn" id="aiBackBtn" style="flex:1;justify-content:center;">‹ Back</button>
      <button class="iconbtn bad" id="aiDelPreset" style="flex:1;justify-content:center;">Delete</button>
    </div>`);
  const read = ()=>({ name:document.getElementById("aiName").value.trim()||"Preset", format:document.getElementById("aiFormat").value, baseUrl:document.getElementById("aiBase").value.trim(), model:document.getElementById("aiModel").value.trim(), apiKey:document.getElementById("aiKeyField").value.trim() });
  document.getElementById("aiShowKey").addEventListener("click", ()=>{ const f=document.getElementById("aiKeyField"); f.type = f.type==="password"?"text":"password"; });
  const save = ()=>{ const s=aiLoad(); const q=s.presets.find(x=>x.id===id); if(!q) return; Object.assign(q, read()); aiSave(s); aiUpdateBtnLabel(); };
  document.getElementById("aiSavePreset").addEventListener("click", ()=>{ save(); toast("Preset saved"); openAISettings(); });
  document.getElementById("aiBackBtn").addEventListener("click", openAISettings);
  document.getElementById("aiDelPreset").addEventListener("click", ()=>{
    if(!confirm("Delete this preset?")) return;
    const s=aiLoad(); s.presets = s.presets.filter(x=>x.id!==id); if(s.activeId===id) s.activeId = s.presets[0]?s.presets[0].id:null; aiSave(s); aiUpdateBtnLabel(); openAISettings();
  });
  document.getElementById("aiTestBtn").addEventListener("click", async ()=>{
    const out = document.getElementById("aiTestOut"); aiShowLoading(out,"Testing…");
    try{
      const r = await aiRequest(Object.assign({}, p, read()), "You are a connection tester.", "Reply with the single word OK.", 300);
      out.innerHTML = `<div class="status ok">✅ Works — model replied: ${escapeHtml(r.slice(0,60))}</div>`;
    }catch(e){ out.innerHTML = `<div class="status err" style="white-space:pre-wrap;">❌ ${escapeHtml(e.message)}${e.status?` (HTTP ${e.status})`:""}</div>`; }
  });
}

/* ================= Per-question AI menu (explain / mnemonic / note / similar) ================= */
function openAIQuestionModal(paperId, qid, selIdx){
  const q = aiFindQuestion(paperId, qid);
  if(!q) return;
  const snippet = q.question_text.length>140 ? q.question_text.slice(0,140)+"…" : q.question_text;
  aiModal(`
    <h3>🤖 AI help</h3>
    <div class="meta" style="margin-bottom:8px;">${escapeHtml(q.subject||"")} · ${escapeHtml(q.topic||"")}</div>
    <div class="ai-qsnippet">${renderRichText(snippet)}</div>
    <div class="ai-grid">
      <button class="iconbtn" data-mode="explain">🔍 ${selIdx!==undefined && selIdx!==null && selIdx!=="" ? "Explain my mistake" : "Explain"}</button>
      <button class="iconbtn" data-mode="mnemonic">🧠 Mnemonic</button>
      <button class="iconbtn" data-mode="note">📝 Revision note</button>
      <button class="iconbtn" data-mode="similar">🧩 Similar questions</button>
    </div>
    <div id="aiOut"></div>
    <div class="chart-note">AI can be wrong — verify dates, names and current-affairs facts before trusting.</div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Close</button></div>`);
  typesetMath(document.querySelector(".ai-qsnippet"));
  document.getElementById("aiClose").addEventListener("click", closeModal);
  const out = document.getElementById("aiOut");
  let lastText = "";
  const hasSel = selIdx!==undefined && selIdx!==null && selIdx!=="";
  const prompts = {
    explain: ()=> [aiSystem(aiLangInstruction()),
      aiQuestionBlock(q, hasSel?selIdx:undefined)+"\n\nTask: "+(hasSel && Number(selIdx)!==Number(q.correct_answer_index)
        ? "Explain why the student's choice is wrong, why the correct answer is right, and give one short tip to avoid this mistake next time."
        : "Explain why the correct answer is right and why each other option is wrong, briefly.")],
    mnemonic: ()=> [aiSystem(aiLangInstruction()),
      aiQuestionBlock(q)+"\n\nTask: Give 1-2 catchy, memorable mnemonics or memory tricks (rhymes, acronyms, associations) for the key fact(s) tested here. Keep each to one or two lines."],
    note: ()=> [aiSystem(aiLangInstruction()),
      aiQuestionBlock(q)+"\n\nTask: Write a compact revision note (4-6 bullet points) on the topic behind this question — the key facts a student must remember for similar questions. Only include facts you are confident about."]
  };
  document.querySelectorAll("[data-mode]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const mode = btn.dataset.mode;
      if(mode==="similar"){ closeModal(); return openAIGenerateModal(q.subject, q.topic||FALLBACK_TOPIC, [q]); }
      aiShowLoading(out);
      try{
        const [sys,usr] = prompts[mode]();
        lastText = await aiAsk(sys, usr);
        out.innerHTML = aiResultHtml(lastText) + aiResultActions("q");
        typesetMath(out);
        document.getElementById("aiCopyBtn").addEventListener("click", ()=>aiCopy(lastText));
        document.getElementById("aiSaveExpl").addEventListener("click", ()=>{
          const fresh = aiFindQuestion(paperId, qid); if(!fresh) return;
          if(fresh.explanation && fresh.explanation.trim() && !confirm("Replace the existing explanation? (Cancel to keep it)")) return;
          fresh.explanation = lastText; saveData(DATA); toast("Saved as explanation"); render();
        });
        document.getElementById("aiSaveNote").addEventListener("click", ()=>{
          const info = appendToListingNote(`🤖 ${snippet.slice(0,80)}\n${lastText}`);
          toast("Added to the note of: "+info.label); render();
        });
      }catch(e){ aiShowError(out, e); }
    });
  });
}

/* ================= Question generator ================= */
function aiParseJsonLoose(text){
  let t = text.replace(/```(?:json)?/gi,"").trim();
  const a = t.search(/[\[{]/); if(a<0) throw new Error("No JSON in reply");
  const open = t[a], close = open==="["?"]":"}";
  const b = t.lastIndexOf(close); if(b<=a) throw new Error("Incomplete JSON in reply");
  t = t.slice(a,b+1);
  try{ return JSON.parse(t); }
  catch(e){ return JSON.parse(t.replace(/\\(?!["\\\/bfnrtu])/g,"\\\\")); }
}
function openAIGenerateModal(subject, topic, seedQs){
  const defaultLang = subject==="Malayalam" ? "ml" : "en";
  aiModal(`
    <h3>🧩 AI practice questions</h3>
    <div class="meta" style="margin-bottom:8px;">${escapeHtml(subject)} · ${escapeHtml(topic)}${seedQs&&seedQs.length===1?" · similar to the selected question":""}</div>
    <div class="field"><label>How many questions</label>
      <select class="ai-input" id="genCount"><option>5</option><option selected>8</option><option>10</option><option>15</option></select></div>
    <div class="field"><label>Question language</label>
      <select class="ai-input" id="genLang"><option value="en" ${defaultLang==="en"?"selected":""}>English</option><option value="ml" ${defaultLang==="ml"?"selected":""}>Malayalam</option></select></div>
    <div class="field"><label>Difficulty</label>
      <select class="ai-input" id="genDiff"><option value="mixed">Mixed</option><option value="E">Easy</option><option value="M">Medium</option><option value="D">Difficult</option></select></div>
    <div id="aiOut"></div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Close</button>
      <button class="iconbtn primary" id="genGo" style="flex:1;justify-content:center;">Generate</button></div>`);
  document.getElementById("aiClose").addEventListener("click", closeModal);
  document.getElementById("genGo").addEventListener("click", async ()=>{
    const n = Number(document.getElementById("genCount").value);
    const lang = document.getElementById("genLang").value;
    const diff = document.getElementById("genDiff").value;
    const out = document.getElementById("aiOut"); aiShowLoading(out, "Generating questions…");
    let seeds = seedQs;
    if(!seeds || !seeds.length){
      seeds = visibleQuestions().filter(q=>q.subject===subject && (q.topic||FALLBACK_TOPIC)===topic && !q.ai_generated).slice(0,5);
    }
    const seedTxt = seeds.map((q,i)=>`Example ${i+1}:\n${q.question_text}\n`+(q.options||[]).map((o,j)=>`${letterFor(j)}) ${o}`).join("\n")).join("\n\n");
    const sys = "You write multiple-choice questions for Kerala PSC exams in the style of past papers. Accuracy matters more than cleverness: every question must have exactly one unambiguously correct option you are certain about. Output ONLY a JSON array, no commentary.";
    const usr = `Subject: ${subject}\nTopic: ${topic}\nWrite ${n} NEW multiple-choice questions on this topic in the style of the examples below (do not copy them). Language: ${lang==="ml"?"Malayalam":"English"}. Difficulty: ${diff==="mixed"?"a mix of easy, medium and difficult":({E:"easy",M:"medium",D:"difficult"})[diff]}. 4 options each.\n\nReturn a JSON array where each item is: {"question_text": "...", "options": ["...","...","...","..."], "correct_answer_index": 0-3, "explanation": "1-3 sentence explanation", "difficulty": "E" | "M" | "D"}\n\n${seedTxt?("Style examples:\n"+seedTxt):"(No examples available — use typical PSC style.)"}`;
    try{
      const text = await aiAsk(sys, usr, 4000);
      let arr = aiParseJsonLoose(text);
      if(!Array.isArray(arr)) arr = arr.questions || [];
      const good = arr.filter(x=> x && typeof x.question_text==="string" && Array.isArray(x.options) && x.options.length>=2 && Number.isInteger(Number(x.correct_answer_index)) && Number(x.correct_answer_index)>=0 && Number(x.correct_answer_index)<x.options.length)
        .map(x=>({ question_text:x.question_text.trim(), options:x.options.map(o=>String(o)), correct_answer_index:Number(x.correct_answer_index), explanation:String(x.explanation||""), difficulty: ["E","M","D"].includes(x.difficulty)?x.difficulty:undefined }));
      if(!good.length) throw new Error("The model's reply had no usable questions. Try again or switch preset.");
      openAIGeneratedReview(subject, topic, good);
    }catch(e){ aiShowError(out, e); }
  });
}
function openAIGeneratedReview(subject, topic, items){
  const rows = items.map((x,i)=>`<div class="ai-genq">
    <label class="switch-row"><input type="checkbox" class="gsel" data-i="${i}" checked> <b>Q${i+1}</b></label>
    <div class="qtext">${renderRichText(x.question_text)}</div>
    <ul class="options" style="list-style:none;padding:0;margin:4px 0;">${x.options.map((o,j)=>`<li style="${j===x.correct_answer_index?"color:#8fe3a8;font-weight:600;":""}">${letterFor(j)}) ${renderRichText(o)}</li>`).join("")}</ul>
    ${x.explanation?`<div class="chart-note">${renderRichText(x.explanation)}</div>`:""}</div>`).join("");
  aiModal(`
    <h3>Review generated questions</h3>
    <div class="chart-note">AI-written — check the highlighted answers before relying on them. Untick any you don't want.</div>
    <div style="max-height:52vh;overflow-y:auto;">${rows}</div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Discard</button>
      <button class="iconbtn primary" id="genAdd" style="flex:1;justify-content:center;">Add to "AI Practice"</button></div>`);
  typesetMath(modalRoot);
  document.getElementById("aiClose").addEventListener("click", closeModal);
  document.getElementById("genAdd").addEventListener("click", ()=>{
    const picked = Array.from(document.querySelectorAll(".gsel")).filter(c=>c.checked).map(c=>items[Number(c.dataset.i)]);
    if(!picked.length){ toast("Nothing selected"); return; }
    const cur = getCurrentSyllabusId();
    const pid = "ai-practice-"+cur;
    let paper = DATA.papers.find(p=>p.id===pid);
    if(!paper){ paper = { id:pid, name:"AI Practice Questions", post_name:"AI-generated", syllabus_id:cur, questions:[] }; DATA.papers.push(paper); }
    let next = (paper.questions||[]).length;
    picked.forEach(x=>{
      next++;
      const q = { id:"ai"+Date.now().toString(36)+next, question_text:x.question_text, options:x.options, correct_answer_index:x.correct_answer_index,
        subject, topic, explanation:x.explanation, ai_generated:true, original_number:"AI-"+next };
      if(x.difficulty) q.difficulty = x.difficulty;
      paper.questions.push(q);
    });
    saveData(DATA); closeModal(); render();
    toast(`${picked.length} question${picked.length===1?"":"s"} added to “AI Practice Questions”`);
  });
}

/* ================= Stats-level AI: study plan, wrong-answer mnemonics, guess coach ================= */
function aiStatsSummary(){
  const items = computePriorityList().topicItems;
  const weak = items.filter(i=>i.practiced && i.accuracy<0.6).slice(0,10).map(i=>`${i.sublabel} › ${i.label}: ${Math.round(i.accuracy*100)}% accuracy, ${i.freq} questions in bank`);
  const untried = items.filter(i=>!i.practiced).slice(0,10).map(i=>`${i.sublabel} › ${i.label}: ${i.freq} questions, not practised`);
  const ts = computeTimeStats();
  const slow = Object.values(ts.byTopic).filter(v=>v.count>=2).map(v=>({l:`${v.subject} › ${v.topic}`, a:v.totalMs/v.count/1000})).sort((a,b)=>b.a-a.a).slice(0,6).map(x=>`${x.l}: ${Math.round(x.a)}s per question`);
  const mk = currentMarking();
  const recs = collectAttemptRecords();
  const gTopics = Object.entries(aggregateBy(recs.filter(r=>r.guessed), r=>`${r.subject} › ${r.topic}`)).map(([k,a])=>({k, s:guessSummary(a,mk)})).filter(x=>x.s.n>0 && x.s.net<0).sort((a,b)=>a.s.net-b.s.net).slice(0,6).map(x=>`${x.k}: guessed ${x.s.n}, ${x.s.right} right, net ${x.s.net} marks`);
  const due = dueForReviewList().slice(0,8).map(d=>`${d.subject} › ${d.topic}`);
  return { weak, untried, slow, gTopics, due, mk };
}
function openAIPlanModal(){
  aiModal(`
    <h3>🗓️ AI study plan</h3>
    <div class="chart-note">Built from your accuracy, time, guessing and spaced-review data in this syllabus.</div>
    <div class="field"><label>Plan length</label><select class="ai-input" id="planDays"><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option></select></div>
    <div class="field"><label>Study hours per day</label><select class="ai-input" id="planHrs"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>6</option></select></div>
    <div id="aiOut"></div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Close</button>
      <button class="iconbtn primary" id="planGo" style="flex:1;justify-content:center;">Create plan</button></div>`);
  document.getElementById("aiClose").addEventListener("click", closeModal);
  const out = document.getElementById("aiOut");
  const last = aiLoadLastPlan();
  if(last){ out.innerHTML = `<div class="chart-note">Last plan (${escapeHtml(new Date(last.at).toLocaleDateString())}):</div>`+aiResultHtml(last.text)+`<div class="row-btns"><button class="iconbtn" id="aiCopyBtn" style="flex:1;justify-content:center;">📋 Copy</button></div>`; document.getElementById("aiCopyBtn").addEventListener("click", ()=>aiCopy(last.text)); }
  document.getElementById("planGo").addEventListener("click", async ()=>{
    const s = aiStatsSummary();
    const days = document.getElementById("planDays").value, hrs = document.getElementById("planHrs").value;
    if(!s.weak.length && !s.untried.length){ out.innerHTML = `<div class="status err">Not enough data yet — take a few tests first.</div>`; return; }
    aiShowLoading(out, "Planning…");
    const usr = `Create a ${days}-day study plan for a Kerala PSC aspirant with ${hrs} study hours per day.\n\nWeak topics:\n${s.weak.join("\n")||"none yet"}\n\nHigh-frequency topics not yet practised:\n${s.untried.join("\n")||"none"}\n\nSlowest topics:\n${s.slow.join("\n")||"no timing data"}\n\nTopics where guessing loses marks (marking: +${s.mk.pos} / -${Math.round(s.mk.pen*100)/100}):\n${s.gTopics.join("\n")||"none"}\n\nDue for spaced revision:\n${s.due.join("\n")||"none"}\n\nRules: each day lists 3-5 specific topics with what to do (read, practise N questions, revise), a time split, and one short goal. Put the weakest and highest-frequency topics first, schedule revision of due topics, and end with a day for a mixed mock test. Use only the topics given.`;
    try{
      const text = await aiAsk(aiSystem(aiLangInstruction()), usr, 3500);
      try{ localStorage.setItem("psev_ai_lastplan", JSON.stringify({at:Date.now(), text})); }catch(e){}
      out.innerHTML = aiResultHtml(text)+`<div class="row-btns"><button class="iconbtn" id="aiCopyBtn" style="flex:1;justify-content:center;">📋 Copy</button></div>`;
      document.getElementById("aiCopyBtn").addEventListener("click", ()=>aiCopy(text));
    }catch(e){ aiShowError(out, e); }
  });
}
function aiLoadLastPlan(){ try{ return JSON.parse(localStorage.getItem("psev_ai_lastplan")||"null"); }catch(e){ return null; } }

function openAIWrongMnemonicsModal(){
  const wrong = collectWrongQuestions().slice(0,60);
  if(!wrong.length){ toast("No wrong answers to work with yet"); return; }
  aiModal(`
    <h3>🧠 Memory tricks for my wrong answers</h3>
    <div class="chart-note">${wrong.length} question${wrong.length===1?"":"s"} currently wrong. The AI makes a one-line fact + mnemonic for each batch; you can save them to each question's note.</div>
    <div class="field"><label>How many questions</label><select class="ai-input" id="wmCount"><option>5</option><option selected>8</option><option>12</option></select></div>
    <div id="aiOut"></div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Close</button>
      <button class="iconbtn primary" id="wmGo" style="flex:1;justify-content:center;">Generate</button></div>`);
  document.getElementById("aiClose").addEventListener("click", closeModal);
  const out = document.getElementById("aiOut");
  document.getElementById("wmGo").addEventListener("click", async ()=>{
    const n = Number(document.getElementById("wmCount").value);
    const batch = wrong.sort(()=>Math.random()-0.5).slice(0,n);
    aiShowLoading(out, "Creating memory tricks…");
    const usr = batch.map((q,i)=>`#${i+1}\n${aiQuestionBlock(q)}`).join("\n\n") + `\n\nFor each numbered question, return JSON array items: {"n": number, "fact": "the one key fact to remember (1 line)", "mnemonic": "a catchy memory trick (1-2 lines)"}. Only use facts you are sure of; if unsure set mnemonic to "". ${aiLangInstruction()} Output ONLY the JSON array.`;
    try{
      const text = await aiAsk(aiSystem(), usr, 3500);
      const arr = aiParseJsonLoose(text);
      if(!Array.isArray(arr)||!arr.length) throw new Error("No usable reply — try again.");
      const rows = arr.filter(x=>batch[Number(x.n)-1]).map(x=>({ q:batch[Number(x.n)-1], fact:String(x.fact||""), mn:String(x.mnemonic||"") }));
      out.innerHTML = rows.map((r,i)=>`<div class="ai-genq"><div class="qtext">${renderRichText(r.q.question_text.slice(0,120))}</div>
        <div><b>Fact:</b> ${renderRichText(r.fact)}</div>${r.mn?`<div><b>Trick:</b> ${renderRichText(r.mn)}</div>`:""}
        <button class="iconbtn" data-save="${i}" style="margin-top:6px;">Save to notes</button></div>`).join("")
        + `<div class="row-btns"><button class="iconbtn primary" id="wmSaveAll" style="flex:1;justify-content:center;">Save all to notes</button></div>`;
      typesetMath(out);
      const saveOne = r=>{ const add = `🧠 ${r.q.subject} › ${r.q.topic||""}: ${r.fact}${r.mn?"\n"+r.mn:""}`; const info = { key:"misc:ai", label:"AI notes & tricks", nav:null }; const cur = getListingNote(info.key); if(cur && cur.text.includes(add)) return; saveListingNote(info, (cur?cur.text+"\n\n":"")+add); };
      out.querySelectorAll("[data-save]").forEach(b=> b.addEventListener("click", ()=>{ saveOne(rows[Number(b.dataset.save)]); saveData(DATA); b.textContent="Saved ✓"; b.disabled=true; }));
      document.getElementById("wmSaveAll").addEventListener("click", ()=>{ rows.forEach(saveOne); saveData(DATA); toast("Saved to Notes tab → AI notes & tricks"); render(); });
    }catch(e){ aiShowError(out, e); }
  });
}

function openAIGuessCoachModal(){
  const mk = currentMarking();
  const recs = collectAttemptRecords();
  const all = guessSummary(recs, mk);
  if(!all.n){ toast("Mark some guesses in a test first"); return; }
  aiModal(`
    <h3>🎓 AI guess coach</h3>
    <div class="chart-note">Break-even accuracy ${Math.round(mk.breakEven*100)}% · your guesses: ${all.right}✓ ${all.wrong}✗ · net ${all.net} marks.</div>
    <div id="aiOut"></div>
    <div class="row-btns"><button class="iconbtn" id="aiClose" style="flex:1;justify-content:center;">Close</button>
      <button class="iconbtn primary" id="gcGo" style="flex:1;justify-content:center;">Get advice</button></div>`);
  document.getElementById("aiClose").addEventListener("click", closeModal);
  const out = document.getElementById("aiOut");
  document.getElementById("gcGo").addEventListener("click", async ()=>{
    aiShowLoading(out, "Analysing your guesses…");
    const idx = buildQuestionIndex();
    const byTopic = Object.entries(aggregateBy(recs.filter(r=>r.guessed), r=>`${r.subject} › ${r.topic}`)).map(([k,a])=>({k,s:guessSummary(a,mk)})).filter(x=>x.s.n>0).sort((a,b)=>a.s.net-b.s.net).slice(0,12)
      .map(x=>`${x.k}: guessed ${x.s.n}, right ${x.s.right}, wrong ${x.s.wrong}, net ${x.s.net}`);
    const byDiff = ["E","M","D"].map(d=>{ const g=recs.filter(r=>r.guessed&&r.isGraded&&r.selectedIndex!==null&&r.difficulty===d); return g.length?`${DIFFICULTY_LABELS[d]}: ${g.filter(r=>r.isCorrect).length}/${g.length} right`:null; }).filter(Boolean);
    const wrongGuesses = recs.filter(r=>r.guessed&&r.isGraded&&r.selectedIndex!==null&&!r.isCorrect).slice(-8).map(r=>{ const q=idx[`${r.paperId}::${r.qid}`]; return q?`- [${q.subject} › ${q.topic}] ${q.question_text.slice(0,110)}`:null; }).filter(Boolean);
    const usr = `A Kerala PSC aspirant's exam has marking +${mk.pos} per correct and -${Math.round(mk.pen*100)/100} per wrong answer (break-even accuracy ${Math.round(mk.breakEven*100)}%). Their guessing record:\nOverall: ${all.n} guesses, ${all.right} right, ${all.wrong} wrong, net ${all.net} marks, accuracy ${Math.round(all.acc*100)}%.\n\nBy topic (worst first):\n${byTopic.join("\n")}\n\nBy difficulty:\n${byDiff.join("\n")||"n/a"}\n\nRecent wrong guesses:\n${wrongGuesses.join("\n")||"none"}\n\nGive a short coaching summary: (1) is guessing helping or hurting overall, (2) the topics where they should skip rather than guess and the ones where guessing is fine, (3) a simple elimination-based rule of thumb for when to guess (e.g. how many options to eliminate first, using the break-even figure), (4) 3 concrete tips. Use the numbers; do not invent data.`;
    try{
      const text = await aiAsk(aiSystem(aiLangInstruction()), usr, 2000);
      out.innerHTML = aiResultHtml(text)+`<div class="row-btns"><button class="iconbtn" id="aiCopyBtn" style="flex:1;justify-content:center;">📋 Copy</button></div>`;
      document.getElementById("aiCopyBtn").addEventListener("click", ()=>aiCopy(text));
    }catch(e){ aiShowError(out, e); }
  });
}

/* ================= Wiring (event delegation so re-rendered buttons just work) ================= */
document.addEventListener("click", (e)=>{
  const el = e.target.closest("[data-ai]");
  if(!el) return;
  e.stopPropagation();
  const act = el.dataset.ai;
  if(act==="q"){
    if(!aiLoad().presets.length) return aiNeedSetup();
    openAIQuestionModal(el.dataset.paper, el.dataset.qid, el.dataset.sel);
  } else if(act==="gen-topic"){
    if(!aiLoad().presets.length) return aiNeedSetup();
    openAIGenerateModal(el.dataset.subject, el.dataset.topic, null);
  } else if(act==="plan"){
    if(!aiLoad().presets.length) return aiNeedSetup();
    openAIPlanModal();
  } else if(act==="wrong-mnemonics"){
    if(!aiLoad().presets.length) return aiNeedSetup();
    openAIWrongMnemonicsModal();
  } else if(act==="guess-coach"){
    if(!aiLoad().presets.length) return aiNeedSetup();
    openAIGuessCoachModal();
  }
}, true);
document.getElementById("aiBtn").addEventListener("click", ()=>openAISettings());
aiUpdateBtnLabel();
