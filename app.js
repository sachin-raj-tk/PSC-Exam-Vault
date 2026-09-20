/* ================= Storage & migration ================= */
const STORAGE_KEY = "psev_data_v1";
const DEFAULT_MARKING = { positive: 1, negNum: 1, negDen: 3 };

function loadData(){
  let parsed;
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : {};
  }catch(e){
    console.error("Failed to load data", e);
    parsed = {};
  }
  if(!Array.isArray(parsed.papers)) parsed.papers = [];
  if(!Array.isArray(parsed.attempts)) parsed.attempts = [];
  if(!Array.isArray(parsed.banks)) parsed.banks = [];
  if(!Array.isArray(parsed.paperTemplates)) parsed.paperTemplates = [];
  if(!Array.isArray(parsed.syllabuses) || parsed.syllabuses.length===0){
    parsed.syllabuses = [{ id:"default", name:"Default", marking: Object.assign({}, DEFAULT_MARKING) }];
  }
  parsed.syllabuses.forEach(s=>{ if(!s.marking) s.marking = Object.assign({}, DEFAULT_MARKING); });
  const syllabusIds = new Set(parsed.syllabuses.map(s=>s.id));
  parsed.papers.forEach(p=>{
    if(!p.syllabus_id) p.syllabus_id = "default";
    if(!syllabusIds.has(p.syllabus_id)){
      parsed.syllabuses.push({ id:p.syllabus_id, name:p.syllabus_id, marking: Object.assign({}, DEFAULT_MARKING) });
      syllabusIds.add(p.syllabus_id);
    }
  });
  parsed.attempts.forEach(a=>{ if(!a.syllabus_id) a.syllabus_id = "default"; });
  return parsed;
}
function saveData(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
let DATA = loadData();

function slugify(s){
  const base = String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  return (base || "item") + "-" + Date.now().toString(36).slice(-4);
}

/* ================= Syllabuses ================= */
const SYLLABUS_KEY = "psev_current_syllabus_id";
function getCurrentSyllabusId(){
  let id = localStorage.getItem(SYLLABUS_KEY) || "default";
  if(!DATA.syllabuses.some(s=>s.id===id)) id = DATA.syllabuses[0] ? DATA.syllabuses[0].id : "default";
  return id;
}
function setCurrentSyllabusId(id){ localStorage.setItem(SYLLABUS_KEY, id); }
function getSyllabusById(id){ return DATA.syllabuses.find(s=>s.id===id) || DATA.syllabuses[0]; }
function updateSyllabusBtnLabel(){
  const el = document.getElementById("syllabusBtnLabel");
  if(el) el.textContent = getSyllabusById(getCurrentSyllabusId()).name;
}
function computeNetScore(correctCount, wrongCount, marking){
  const pos = Number(marking.positive)||0;
  const negNum = Number(marking.negNum)||0;
  const negDen = Number(marking.negDen)||1;
  const deduction = negDen>0 ? wrongCount * (negNum/negDen) : 0;
  return Math.round((correctCount*pos - deduction) * 100) / 100;
}

/* ---- Study-progress tracker (per syllabus, per subject+topic) ---- */
function studyProgressKey(subject, topic){
  return `${getCurrentSyllabusId()}::${subject}|||${topic}`;
}
function getStudyCount(subject, topic){
  return (DATA.studyProgress && DATA.studyProgress[studyProgressKey(subject,topic)]) || 0;
}
function incrementStudyCount(subject, topic){
  if(!DATA.studyProgress) DATA.studyProgress = {};
  const k = studyProgressKey(subject,topic);
  DATA.studyProgress[k] = (DATA.studyProgress[k]||0) + 1;
  saveData(DATA);
}
function decrementStudyCount(subject, topic){
  if(!DATA.studyProgress) DATA.studyProgress = {};
  const k = studyProgressKey(subject,topic);
  DATA.studyProgress[k] = Math.max(0, (DATA.studyProgress[k]||0) - 1);
  saveData(DATA);
}

/* ================= Taxonomy state (mutable — supports renaming) ================= */
const TAXONOMY_STATE_KEY = "psev_taxonomy_state_v1";
function loadTaxonomyState(){
  try{
    const raw = localStorage.getItem(TAXONOMY_STATE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ /* fall through and rebuild */ }
  const initial = {};
  SUBJECTS.forEach(s=>{ initial[s] = TAXONOMY[s].concat([FALLBACK_TOPIC]); });
  saveTaxonomyState(initial);
  return initial;
}
function saveTaxonomyState(obj){
  localStorage.setItem(TAXONOMY_STATE_KEY, JSON.stringify(obj));
}
let TAXONOMY_STATE = loadTaxonomyState();

function getAllSubjects(){ return Object.keys(TAXONOMY_STATE); }
function getTopicsForSubject(subject){
  return TAXONOMY_STATE[subject] ? TAXONOMY_STATE[subject].slice() : [FALLBACK_TOPIC];
}
function addCustomTopic(subject, topic){
  topic = topic.trim();
  if(!topic) return false;
  if(!TAXONOMY_STATE[subject]) TAXONOMY_STATE[subject] = [FALLBACK_TOPIC];
  const list = TAXONOMY_STATE[subject];
  if(list.some(t=>t.toLowerCase()===topic.toLowerCase())) return false;
  const otherIdx = list.indexOf(FALLBACK_TOPIC);
  if(otherIdx>=0) list.splice(otherIdx,0,topic);
  else list.push(topic);
  saveTaxonomyState(TAXONOMY_STATE);
  return true;
}
function addCustomSubject(subject){
  subject = subject.trim();
  if(!subject) return false;
  if(getAllSubjects().some(s=>s.toLowerCase()===subject.toLowerCase())) return false;
  TAXONOMY_STATE[subject] = [FALLBACK_TOPIC];
  saveTaxonomyState(TAXONOMY_STATE);
  return true;
}
function renameSubjectEverywhere(oldName, newNameRaw){
  const newName = newNameRaw.trim();
  if(!newName || newName === oldName) return false;
  const existingKey = getAllSubjects().find(s=> s!==oldName && s.toLowerCase()===newName.toLowerCase());
  const targetName = existingKey || newName;
  if(existingKey){
    const merged = TAXONOMY_STATE[existingKey].slice();
    (TAXONOMY_STATE[oldName]||[]).forEach(t=>{ if(!merged.includes(t)) merged.push(t); });
    TAXONOMY_STATE[existingKey] = merged;
  } else {
    TAXONOMY_STATE[newName] = TAXONOMY_STATE[oldName] || [FALLBACK_TOPIC];
  }
  delete TAXONOMY_STATE[oldName];
  saveTaxonomyState(TAXONOMY_STATE);
  let count = 0;
  DATA.papers.forEach(p=>{
    (p.questions||[]).forEach(q=>{ if(q.subject === oldName){ q.subject = targetName; count++; } });
  });
  saveData(DATA);
  return { targetName, count };
}
function renameTopicEverywhere(subject, oldTopic, newTopicRaw){
  const newTopic = newTopicRaw.trim();
  if(!newTopic || newTopic === oldTopic) return false;
  if(oldTopic === FALLBACK_TOPIC){
    return { error: `"${FALLBACK_TOPIC}" is the built-in fallback topic and can't be renamed.` };
  }
  if(!TAXONOMY_STATE[subject]) TAXONOMY_STATE[subject] = [FALLBACK_TOPIC];
  const list = TAXONOMY_STATE[subject];
  const existingIdx = list.findIndex(t=> t!==oldTopic && t.toLowerCase()===newTopic.toLowerCase());
  const targetTopic = existingIdx>=0 ? list[existingIdx] : newTopic;
  const oldIdx = list.indexOf(oldTopic);
  if(existingIdx>=0){ if(oldIdx>=0) list.splice(oldIdx,1); }
  else if(oldIdx>=0){ list[oldIdx] = targetTopic; }
  else{ list.push(targetTopic); }
  saveTaxonomyState(TAXONOMY_STATE);
  let count = 0;
  DATA.papers.forEach(p=>{
    (p.questions||[]).forEach(q=>{
      if(q.subject === subject && (q.topic||FALLBACK_TOPIC) === oldTopic){ q.topic = targetTopic; count++; }
    });
  });
  saveData(DATA);
  return { targetTopic, count };
}

/* ================= View mode (scroll vs swipe) ================= */
const VIEW_MODE_KEY = "psev_view_mode";
function getViewMode(){ return localStorage.getItem(VIEW_MODE_KEY) || "scroll"; }
function setViewMode(v){ localStorage.setItem(VIEW_MODE_KEY, v); }
function updateViewModeBtn(){
  const btn = document.getElementById("btnViewMode");
  if(btn) btn.textContent = getViewMode()==="scroll" ? "Scroll" : "Swipe";
}

/* ================= Navigation (stack based) ================= */
let navStack = [{ type: "papers" }];
function currentScreen(){ return navStack[navStack.length-1]; }
function pushScreen(screen){ navStack.push(screen); render(); }
function popScreen(){ if(navStack.length>1) navStack.pop(); render(); }
function resetToTab(tab){ navStack = [{ type: tab }]; render(); }
function getSearch(){ return currentScreen().search || ""; }
function setSearch(v){ currentScreen().search = v; }

/* ================= Helpers ================= */
const DELETED_SENTINEL = 5;

function allQuestions(){
  const out = [];
  DATA.papers.forEach(p=>{
    (p.questions||[]).forEach(q=>{
      out.push(Object.assign({}, q, { _paperId: p.id, _paperName: p.name, _postName: p.post_name||"", _syllabusId: p.syllabus_id||"default" }));
    });
  });
  return out;
}
function visibleQuestions(){
  const cur = getCurrentSyllabusId();
  const allowed = new Set(DATA.papers.filter(p=>(p.syllabus_id||"default")===cur).map(p=>p.id));
  return allQuestions().filter(q=> allowed.has(q._paperId));
}
function buildQuestionIndex(){
  const idx = {};
  allQuestions().forEach(q=>{ idx[`${q._paperId}::${q.id}`] = q; });
  return idx;
}
function questionOriginalNumber(q){
  if(q.original_number !== undefined && q.original_number !== null && q.original_number !== ""){
    return String(q.original_number);
  }
  const m = String(q.id||"").match(/(\d+)/);
  return m ? m[1] : null;
}
function letterFor(i){ return String.fromCharCode(65+i); }
function escapeHtml(str){
  return String(str==null?"":str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
function toast(msg){
  const t = document.createElement("div");
  t.className="toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2200);
}
function filterQuestionsByIncluded(questions, includedPapers){
  if(!includedPapers) return questions;
  return questions.filter(q=> includedPapers.includes(q._paperId));
}
function sampleRandom(arr, n){
  const copy = arr.slice();
  for(let i=copy.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const tmp = copy[i]; copy[i]=copy[j]; copy[j]=tmp;
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/* ---- Copy helpers ---- */
function formatQuestionText(q, idx){
  const isDeleted = Number(q.correct_answer_index) === DELETED_SENTINEL;
  const originalNum = questionOriginalNumber(q);
  let text = `Q${idx}${originalNum?` (Paper Q${originalNum})`:""}. ${q.question_text}\n`;
  (q.options||[]).forEach((opt,i)=>{
    const mark = (!isDeleted && q.correct_answer_index !== null && q.correct_answer_index !== undefined && Number(q.correct_answer_index)===i) ? " (correct)" : "";
    text += `   ${letterFor(i)}) ${opt}${mark}\n`;
  });
  if(isDeleted) text += `   [DELETED QUESTION — per official PSC answer key]\n`;
  if(q.explanation && q.explanation.trim()) text += `   Explanation: ${q.explanation.trim()}\n`;
  text += `   [Paper: ${q._paperName}${q._postName?" | Post: "+q._postName:""} | Subject: ${q.subject} | Topic: ${q.topic||FALLBACK_TOPIC}]\n`;
  return text;
}
function doCopy(text){
  const done = () => toast("Copied to clipboard");
  const fail = () => fallbackCopy(text);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else { fallbackCopy(text); }
}
function fallbackCopy(text){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position="fixed"; ta.style.opacity="0";
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand("copy"); toast("Copied to clipboard"); }
  catch(e){ toast("Copy failed — select and copy manually"); }
  ta.remove();
}
function copyQuestionsToClipboard(questions, label){
  let text = `${label} — ${questions.length} question(s)\n\n`;
  questions.forEach((q, idx)=>{ text += formatQuestionText(q, idx+1) + "\n"; });
  doCopy(text);
}
function copySingleQuestion(q){ doCopy(formatQuestionText(q, 1)); }

/* ================= Shell ================= */
const mainEl = document.getElementById("main");
const modalRoot = document.getElementById("modalRoot");
let timerIntervalId = null;

document.getElementById("tabs").addEventListener("click", (e)=>{
  const btn = e.target.closest(".tab");
  if(!btn) return;
  resetToTab(btn.dataset.tab);
});
document.getElementById("btnAdd").addEventListener("click", openAddModal);
document.getElementById("btnData").addEventListener("click", openDataModal);
document.getElementById("btnViewMode").addEventListener("click", ()=>{
  const next = getViewMode()==="scroll" ? "swipe" : "scroll";
  setViewMode(next);
  updateViewModeBtn();
  toast(`Switched to ${next} view`);
  render();
});
document.getElementById("syllabusBtn").addEventListener("click", openSyllabusModal);

function render(){
  if(timerIntervalId){ clearInterval(timerIntervalId); timerIntervalId = null; }
  document.querySelectorAll(".bottomnav").forEach(el=>el.remove());
  updateTabHighlight();
  updateViewModeBtn();
  updateSyllabusBtnLabel();
  const screen = currentScreen();
  switch(screen.type){
    case "papers": renderPapersList(); break;
    case "subjects": renderSubjectsList(); break;
    case "topics": renderTopicsList(); break;
    case "bank": renderBankRoot(); break;
    case "attempts": renderAttemptsRoot(); break;
    case "stats": renderStatsScreen(); break;
    case "paper-detail": renderPaperDetail(screen.paperId); break;
    case "subject-topics": renderSubjectTopicsList(screen.subject); break;
    case "subject-all": renderSubjectAllQuestions(screen.subject); break;
    case "topic-detail": renderTopicDetail(screen.subject, screen.topic); break;
    case "bank-detail": renderBankDetail(screen.bankId); break;
    case "practice": renderPracticeScreen(screen); break;
    case "attempts-for-scope": renderAttemptsForScope(screen.groupBy, screen.scopeKey, screen.scopeLabel); break;
    case "attempt-review": renderAttemptReviewScreen(screen.attemptId); break;
    default: renderPapersList();
  }
}
function updateTabHighlight(){
  const rootType = navStack[0] ? navStack[0].type : "papers";
  document.querySelectorAll(".tab").forEach(t=> t.classList.toggle("active", t.dataset.tab===rootType));
}
function bindSearchInput(rerenderFn){
  const box = document.getElementById("searchBox");
  if(!box) return;
  box.addEventListener("input", (e)=>{
    const pos = e.target.selectionStart;
    setSearch(e.target.value);
    rerenderFn();
    const nb = document.getElementById("searchBox");
    if(nb){ nb.focus(); nb.setSelectionRange(pos,pos); }
  });
}
function rowHtml({num, title, sub, count, dataAttr}){
  return `<div class="row" ${dataAttr}>
    <div class="num">${num}</div>
    <div class="main">
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
    </div>
    <div class="count">${escapeHtml(count)}</div>
  </div>`;
}
function emptyState(title, body){
  return `<div class="empty"><div class="headline">${escapeHtml(title)}</div><div>${escapeHtml(body)}</div></div>`;
}

/* ================= Papers list (current syllabus only) ================= */
function renderPapersList(){
  const searchTerm = getSearch();
  const cur = getCurrentSyllabusId();
  const papers = DATA.papers.filter(p=>(p.syllabus_id||"default")===cur).sort((a,b)=> a.name.localeCompare(b.name));
  if(papers.length === 0){
    mainEl.innerHTML = emptyState("No papers in this syllabus yet", "Tap “+ Add” to import a question paper JSON, or switch syllabus above.");
    return;
  }
  let html = `<input class="search" id="searchBox" placeholder="Search papers…" value="${escapeHtml(searchTerm)}">`;
  html += `<div id="listWrap">`;
  papers
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .forEach((p, idx)=>{
      const count = (p.questions||[]).length;
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: p.name,
        sub: p.post_name ? p.post_name : p.id,
        count: `${count} q`,
        dataAttr: `data-paper-id="${escapeHtml(p.id)}"`
      });
    });
  html += `</div>`;
  mainEl.innerHTML = html;
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"paper-detail", paperId: row.dataset.paperId }));
  });
  bindSearchInput(renderPapersList);
}

/* ================= Subjects list ================= */
function renderSubjectsList(){
  const searchTerm = getSearch();
  const qs = visibleQuestions();
  const counts = {};
  qs.forEach(q=>{ counts[q.subject] = (counts[q.subject]||0) + 1; });
  const subjects = Object.keys(counts).sort((a,b)=>a.localeCompare(b));
  if(subjects.length===0){
    mainEl.innerHTML = emptyState("No subjects yet", "Import a question paper into this syllabus to see subjects here.");
    return;
  }
  let html = `<input class="search" id="searchBox" placeholder="Search subjects…" value="${escapeHtml(searchTerm)}">`;
  html += `<div id="listWrap">`;
  subjects
    .filter(s=>s.toLowerCase().includes(searchTerm.toLowerCase()))
    .forEach((s, idx)=>{
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: s,
        sub: `${Math.max(getTopicsForSubject(s).length - 1, 0)} topics defined`,
        count: `${counts[s]} q`,
        dataAttr: `data-subject="${escapeHtml(s)}"`
      });
    });
  html += `</div>`;
  mainEl.innerHTML = html;
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"subject-topics", subject: row.dataset.subject }));
  });
  bindSearchInput(renderSubjectsList);
}

/* ================= Topics list (global within syllabus, sorted by frequency) ================= */
function renderTopicsList(){
  const searchTerm = getSearch();
  const qs = visibleQuestions();
  const counts = {};
  qs.forEach(q=>{
    const key = `${q.subject}|||${q.topic||FALLBACK_TOPIC}`;
    counts[key] = (counts[key]||0) + 1;
  });
  let entries = Object.entries(counts).map(([key,count])=>{
    const [subject, topic] = key.split("|||");
    return { subject, topic, count };
  });
  entries.sort((a,b)=> b.count - a.count || a.topic.localeCompare(b.topic));

  if(entries.length===0){
    mainEl.innerHTML = emptyState("No topics yet", "Import a question paper into this syllabus to see topics here, ranked by how often they occur.");
    return;
  }
  let html = `<input class="search" id="searchBox" placeholder="Search topics…" value="${escapeHtml(searchTerm)}">`;
  html += `<div id="listWrap">`;
  entries
    .filter(e=>e.topic.toLowerCase().includes(searchTerm.toLowerCase()) || e.subject.toLowerCase().includes(searchTerm.toLowerCase()))
    .forEach((e, idx)=>{
      const studied = getStudyCount(e.subject, e.topic);
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: e.topic,
        sub: `${e.subject}${studied?` · 📖 studied ${studied}×`:""}`,
        count: `${e.count} q`,
        dataAttr: `data-subject="${escapeHtml(e.subject)}" data-topic="${escapeHtml(e.topic)}"`
      });
    });
  html += `</div>`;
  mainEl.innerHTML = html;
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject: row.dataset.subject, topic: row.dataset.topic }));
  });
  bindSearchInput(renderTopicsList);
}

/* ================= Subject → topics-within-subject list ================= */
function renderSubjectTopicsList(subject){
  const screen = currentScreen();
  const included = screen.includedPapers;
  const searchTerm = getSearch();
  const allQs = visibleQuestions().filter(q=>q.subject===subject);
  const qs = filterQuestionsByIncluded(allQs, included);

  const papersMap = {};
  allQs.forEach(q=>{
    if(!papersMap[q._paperId]) papersMap[q._paperId] = { id:q._paperId, name:q._paperName, post_name:q._postName, count:0 };
    papersMap[q._paperId].count++;
  });
  const papersList = Object.values(papersMap).sort((a,b)=>a.name.localeCompare(b.name));
  const filterLabel = included ? `Exams: ${included.length}/${papersList.length} included` : `Exams: all ${papersList.length} included`;

  const counts = {};
  qs.forEach(q=>{ const t=q.topic||FALLBACK_TOPIC; counts[t]=(counts[t]||0)+1; });
  let entries = Object.entries(counts).map(([topic,count])=>({topic,count}));
  entries.sort((a,b)=> b.count-a.count || a.topic.localeCompare(b.topic));

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ Back to Subjects</div>
      <h2>${escapeHtml(subject)}</h2>
      <div class="meta">${qs.length} question${qs.length===1?"":"s"} · ${entries.length} topic${entries.length===1?"":"s"} in use</div>
    </div>
  </div>`;

  html += `<div style="display:flex;gap:8px;margin:12px 0 4px;">
    <button class="iconbtn" id="renameSubjectBtn" style="flex:1;justify-content:center;">Rename subject</button>
    <button class="iconbtn primary" id="viewAllBtn" style="flex:1;justify-content:center;">View all questions</button>
  </div>`;
  html += `<div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn" id="filterPapersBtn" style="flex:1;justify-content:center;">${filterLabel}</button>
  </div>`;

  if(entries.length===0){
    html += emptyState("No questions tagged with this subject yet", "");
  } else {
    html += `<input class="search" id="searchBox" placeholder="Search topics…" value="${escapeHtml(searchTerm)}">`;
    html += `<div id="listWrap">`;
    entries
      .filter(e=>e.topic.toLowerCase().includes(searchTerm.toLowerCase()))
      .forEach((e, idx)=>{
        const studied = getStudyCount(subject, e.topic);
        html += rowHtml({
          num: String(idx+1).padStart(2,"0"),
          title: e.topic,
          sub: studied ? `📖 studied ${studied}×` : subject,
          count: `${e.count} q`,
          dataAttr: `data-topic="${escapeHtml(e.topic)}"`
        });
      });
    html += `</div>`;
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.getElementById("renameSubjectBtn").addEventListener("click", ()=> openRenameSubjectModal(subject));
  document.getElementById("viewAllBtn").addEventListener("click", ()=> pushScreen({ type:"subject-all", subject, includedPapers: screen.includedPapers }));
  document.getElementById("filterPapersBtn").addEventListener("click", ()=>{
    openPaperFilterModal(included, papersList, `subject:${subject}`, (newSelected)=>{
      screen.includedPapers = (newSelected.length===papersList.length) ? undefined : newSelected;
      render();
    });
  });
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject, topic: row.dataset.topic, includedPapers: screen.includedPapers }));
  });
  bindSearchInput(()=>renderSubjectTopicsList(subject));
}

/* ================= Unified question list rendering (scroll / swipe) ================= */
function renderQuestionsListHtml(questions, screen, slipFn, isAnsweredFn){
  if(getViewMode()==="swipe"){
    const idx = Math.min(Math.max(screen.qIndex||0,0), questions.length-1);
    screen.qIndex = idx;
    let numBar = `<div class="qnum-bar" id="qnumBar">`;
    questions.forEach((q,i)=>{
      const answered = isAnsweredFn ? isAnsweredFn(q) : false;
      numBar += `<button type="button" class="qnum-btn ${i===idx?"current":""} ${answered?"answered":""}" data-qnum="${i}">${i+1}</button>`;
    });
    numBar += `</div>`;
    let html = numBar;
    html += `<div class="swipe-nav">
      <button class="iconbtn" id="swipePrev" ${idx<=0?"disabled":""}>‹ Prev</button>
      <div class="progress">${idx+1} of ${questions.length}</div>
      <button class="iconbtn" id="swipeNext" ${idx>=questions.length-1?"disabled":""}>Next ›</button>
    </div>`;
    html += `<div class="swipe-touch-area" id="swipeArea">${slipFn(questions[idx], idx+1)}</div>`;
    return html;
  }
  return questions.map((q,i)=>slipFn(q,i+1)).join("");
}
function bindSwipeNav(questions, screen){
  if(getViewMode()!=="swipe") return;
  const prevBtn = document.getElementById("swipePrev");
  const nextBtn = document.getElementById("swipeNext");
  if(prevBtn) prevBtn.addEventListener("click", ()=>{ if((screen.qIndex||0)>0){ screen.qIndex=(screen.qIndex||0)-1; render(); } });
  if(nextBtn) nextBtn.addEventListener("click", ()=>{ if((screen.qIndex||0) < questions.length-1){ screen.qIndex=(screen.qIndex||0)+1; render(); } });
  document.querySelectorAll(".qnum-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{ screen.qIndex = Number(btn.dataset.qnum); render(); });
  });
  const bar = document.getElementById("qnumBar");
  if(bar){
    const current = bar.querySelector(".qnum-btn.current");
    if(current) current.scrollIntoView({ inline:"center", block:"nearest" });
  }
  const area = document.getElementById("swipeArea");
  if(area){
    let startX=null, startY=null;
    area.addEventListener("touchstart", e=>{ startX=e.touches[0].clientX; startY=e.touches[0].clientY; }, {passive:true});
    area.addEventListener("touchend", e=>{
      if(startX===null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX=null;
      if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.5){
        if(dx<0 && (screen.qIndex||0) < questions.length-1){ screen.qIndex=(screen.qIndex||0)+1; render(); }
        else if(dx>0 && (screen.qIndex||0)>0){ screen.qIndex=(screen.qIndex||0)-1; render(); }
      }
    }, {passive:true});
  }
}

/* ================= View-mode question-list screen (paper/subject-all/topic/bank) ================= */
function renderQuestionListScreen({ backLabel, onBack, title, meta, questions, actionsHtml, bindActions, allowPractice, practiceInfo }){
  const screen = currentScreen();
  const hideAnswers = !!screen.hideAnswers;
  const showExplanations = !!screen.showExplanations;
  const locked = screen.answersLocked !== false; // default true (locked)
  const hasExplanations = questions.some(q=> q.explanation && q.explanation.trim());

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ ${escapeHtml(backLabel)}</div>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">${escapeHtml(meta)}</div>
    </div>
  </div>`;

  if(actionsHtml) html += actionsHtml;

  if(allowPractice && questions.length>0){
    html += `<div style="display:flex;gap:8px;margin:8px 0 4px;">
      <button class="iconbtn primary" id="startPracticeBtn" style="flex:1;justify-content:center;">Start practice test</button>
    </div>`;
  }

  html += `<div style="display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap;">
    <button class="iconbtn" id="toggleAnswersBtn" style="flex:1;justify-content:center;">${hideAnswers ? "Show answers" : "Hide answers"}</button>
    ${hasExplanations ? `<button class="iconbtn" id="toggleExplBtn" style="flex:1;justify-content:center;">${showExplanations?"Hide explanations":"Show explanations"}</button>` : ""}
    <button class="iconbtn ${locked?"":"good"}" id="toggleLockBtn" style="flex:1;justify-content:center;">${locked?"🔒 Answers locked":"🔓 Answers unlocked"}</button>
  </div>`;

  if(questions.length===0){
    html += emptyState("No questions here", "");
  } else {
    html += renderQuestionsListHtml(questions, screen, (q, idx)=> questionSlipHtml(q, idx, hideAnswers, showExplanations, locked));
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.getElementById("toggleAnswersBtn").addEventListener("click", ()=>{ screen.hideAnswers = !hideAnswers; render(); });
  document.getElementById("toggleLockBtn").addEventListener("click", ()=>{ screen.answersLocked = !locked; render(); });
  const explBtn = document.getElementById("toggleExplBtn");
  if(explBtn) explBtn.addEventListener("click", ()=>{ screen.showExplanations = !showExplanations; render(); });
  const practiceBtn = document.getElementById("startPracticeBtn");
  if(practiceBtn){
    practiceBtn.addEventListener("click", ()=> openStartTestModal(practiceInfo.sourceType, practiceInfo.scopeKey, practiceInfo.scopeLabel, questions, practiceInfo.syllabusId||getCurrentSyllabusId()));
  }
  if(bindActions) bindActions();
  if(questions.length>0){
    bindSlipInteractions(questions);
    bindSwipeNav(questions, screen);
  }
}

/* ================= Paper detail ================= */
function renderPaperDetail(paperId){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper){ popScreen(); return; }
  const questions = (paper.questions||[]).map(q=>Object.assign({}, q, {
    _paperId: paper.id, _paperName: paper.name, _postName: paper.post_name||""
  }));
  const syllabusName = getSyllabusById(paper.syllabus_id||"default").name;

  const actionsHtml = `
    <div style="display:flex;gap:8px;margin:12px 0 4px;">
      <button class="iconbtn" id="renamePaperBtn" style="flex:1;justify-content:center;">Rename paper</button>
      <button class="iconbtn" id="editPostNameBtn" style="flex:1;justify-content:center;">Edit post name</button>
    </div>
    <div style="display:flex;gap:8px;margin:0 0 4px;">
      <button class="iconbtn" id="addAnswerKeyBtn" style="flex:1;justify-content:center;">Add answer key</button>
      <button class="iconbtn" id="addExplanationsBtn" style="flex:1;justify-content:center;">Add explanations</button>
    </div>
    <div style="display:flex;gap:8px;margin:0 0 4px;">
      <button class="iconbtn" id="moveSyllabusBtn" style="flex:1;justify-content:center;">Syllabus: ${escapeHtml(syllabusName)}</button>
    </div>
    <div style="display:flex;justify-content:flex-end;margin:4px 0 4px;">
      <button class="iconbtn" id="deletePaperBtn" style="border-color:var(--maroon);color:#f0a3ab;font-size:0.76rem;padding:5px 12px;">🗑 Delete paper</button>
    </div>`;

  renderQuestionListScreen({
    backLabel: "Back to Papers",
    onBack: popScreen,
    title: paper.name,
    meta: `${questions.length} question${questions.length===1?"":"s"} · Paper ID: ${paper.id}${paper.post_name ? " · "+paper.post_name : ""}`,
    questions,
    actionsHtml,
    allowPractice: true,
    practiceInfo: { sourceType:"paper", scopeKey: paper.id, scopeLabel: paper.name, syllabusId: paper.syllabus_id||"default" },
    bindActions: ()=>{
      document.getElementById("renamePaperBtn").addEventListener("click", ()=> openRenamePaperModal(paper.id, paper.name));
      document.getElementById("editPostNameBtn").addEventListener("click", ()=> openEditPostNameModal(paper.id, paper.post_name||""));
      document.getElementById("addAnswerKeyBtn").addEventListener("click", ()=> openAddAnswerKeyModal(paper.id));
      document.getElementById("addExplanationsBtn").addEventListener("click", ()=> openAddExplanationsModal(paper.id));
      document.getElementById("moveSyllabusBtn").addEventListener("click", ()=> openMoveSyllabusModal(paper.id));
      document.getElementById("deletePaperBtn").addEventListener("click", ()=>{
        if(confirm(`Delete "${paper.name}" and all its questions? This can't be undone.`)){
          DATA.papers = DATA.papers.filter(p=>p.id!==paper.id);
          saveData(DATA);
          toast("Paper deleted");
          resetToTab("papers");
        }
      });
    }
  });
}

/* ================= Subject → all questions (flat) ================= */
function renderSubjectAllQuestions(subject){
  const screen = currentScreen();
  const included = screen.includedPapers;
  const allQs = visibleQuestions().filter(q=>q.subject===subject);
  const questions = filterQuestionsByIncluded(allQs, included);

  const papersMap = {};
  allQs.forEach(q=>{
    if(!papersMap[q._paperId]) papersMap[q._paperId] = { id:q._paperId, name:q._paperName, post_name:q._postName, count:0 };
    papersMap[q._paperId].count++;
  });
  const papersList = Object.values(papersMap).sort((a,b)=>a.name.localeCompare(b.name));
  const filterLabel = included ? `Exams: ${included.length}/${papersList.length}` : `Exams: all`;

  const actionsHtml = `<div style="display:flex;gap:8px;margin:12px 0 4px;">
    <button class="iconbtn" id="filterPapersBtn" style="flex:1;justify-content:center;">${filterLabel}</button>
    <button class="iconbtn" id="copyListBtn" style="flex:1;justify-content:center;">Copy list</button>
  </div>`;

  renderQuestionListScreen({
    backLabel: `Back to ${subject}`,
    onBack: popScreen,
    title: `${subject} — all questions`,
    meta: `${questions.length} question${questions.length===1?"":"s"} · every topic`,
    questions,
    actionsHtml,
    allowPractice: true,
    practiceInfo: { sourceType:"subject", scopeKey: subject, scopeLabel: `${subject} — all questions`, syllabusId: getCurrentSyllabusId() },
    bindActions: ()=>{
      document.getElementById("filterPapersBtn").addEventListener("click", ()=>{
        openPaperFilterModal(included, papersList, `subject:${subject}`, (newSelected)=>{
          screen.includedPapers = (newSelected.length===papersList.length) ? undefined : newSelected;
          render();
        });
      });
      document.getElementById("copyListBtn").addEventListener("click", ()=> copyQuestionsToClipboard(questions, `${subject} — all questions`));
    }
  });
}

/* ================= Topic detail ================= */
function renderTopicDetail(subject, topic){
  const screen = currentScreen();
  const included = screen.includedPapers;
  const allQs = visibleQuestions().filter(q=>q.subject===subject && (q.topic||FALLBACK_TOPIC)===topic);
  const questions = filterQuestionsByIncluded(allQs, included);

  const papersMap = {};
  allQs.forEach(q=>{
    if(!papersMap[q._paperId]) papersMap[q._paperId] = { id:q._paperId, name:q._paperName, post_name:q._postName, count:0 };
    papersMap[q._paperId].count++;
  });
  const papersList = Object.values(papersMap).sort((a,b)=>a.name.localeCompare(b.name));
  const filterLabel = included ? `Exams: ${included.length}/${papersList.length}` : `Exams: all`;

  const prev = navStack[navStack.length-2];
  let backLabel = "Back";
  if(prev){
    if(prev.type==="topics") backLabel = "Back to Topics";
    else if(prev.type==="subject-topics") backLabel = `Back to ${prev.subject}`;
  }

  const studyCount = getStudyCount(subject, topic);
  const actionsHtml = `<div class="stepper left" id="studyStepper">
    <span class="study-label">📖 Studied</span>
    <button id="studyMinus" ${studyCount<=0?"disabled":""}>−1</button>
    <div class="val">${studyCount}×</div>
    <button id="studyPlus">+1</button>
  </div>
  <div style="display:flex;gap:8px;margin:12px 0 4px;">
    <button class="iconbtn" id="renameTopicBtn" style="flex:1;justify-content:center;">Rename topic</button>
    <button class="iconbtn" id="copyListBtn" style="flex:1;justify-content:center;">Copy list</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn" id="filterPapersBtn" style="flex:1;justify-content:center;">${filterLabel}</button>
  </div>`;

  renderQuestionListScreen({
    backLabel,
    onBack: popScreen,
    title: topic,
    meta: `${subject} · ${questions.length} question${questions.length===1?"":"s"}`,
    questions,
    actionsHtml,
    allowPractice: true,
    practiceInfo: { sourceType:"topic", scopeKey:`${subject}|||${topic}`, scopeLabel:`${subject} — ${topic}`, syllabusId: getCurrentSyllabusId() },
    bindActions: ()=>{
      document.getElementById("studyMinus").addEventListener("click", ()=>{ decrementStudyCount(subject, topic); render(); });
      document.getElementById("studyPlus").addEventListener("click", ()=>{ incrementStudyCount(subject, topic); render(); });
      document.getElementById("renameTopicBtn").addEventListener("click", ()=> openRenameTopicModal(subject, topic));
      document.getElementById("copyListBtn").addEventListener("click", ()=> copyQuestionsToClipboard(questions, `${subject} — ${topic}`));
      document.getElementById("filterPapersBtn").addEventListener("click", ()=>{
        openPaperFilterModal(included, papersList, `topic:${subject}|||${topic}`, (newSelected)=>{
          screen.includedPapers = (newSelected.length===papersList.length) ? undefined : newSelected;
          render();
        });
      });
    }
  });
}

/* ================= Question slip (view mode) ================= */
function questionSlipHtml(q, idx, hideAnswers, showExplanations, locked){
  const isDeleted = Number(q.correct_answer_index) === DELETED_SENTINEL;
  const originalNum = questionOriginalNumber(q);

  const opts = (q.options||[]).map((opt, i)=>{
    const isCorrect = !isDeleted && q.correct_answer_index !== null && q.correct_answer_index !== undefined && Number(q.correct_answer_index) === i;
    const showCorrect = isCorrect && !hideAnswers;
    const disabled = isDeleted || hideAnswers || locked;
    return `<li class="${showCorrect?"correct":""}">
      <button type="button" class="optlabel-btn ${showCorrect?"correct":""}" data-idx="${i}" ${disabled?"disabled":""}>${letterFor(i)}</button>
      <span class="opttext">${escapeHtml(opt)}</span>
    </li>`;
  }).join("");

  let hint = "Tap a letter (A, B, C, D) to mark it correct — tap again to clear";
  if(isDeleted) hint = "";
  else if(locked) hint = "Answers locked — tap \"🔒 Answers locked\" above to unlock editing";
  else if(hideAnswers) hint = "Answers hidden — tap \"Show answers\" above to reveal and edit";

  let expl = "";
  if(showExplanations && q.explanation && q.explanation.trim()){
    expl = `<div class="explanation-block"><div class="exp-label">Explanation</div>${escapeHtml(q.explanation)}</div>`;
  }

  return `<div class="slip ${isDeleted?"slip-deleted":""}" data-qid="${escapeHtml(q._paperId)}::${escapeHtml(q.id)}">
    <div class="slip-head">
      <div class="qno">Q${idx}${originalNum?` <span class="qno-orig">(Paper Q${escapeHtml(originalNum)})</span>`:""}</div>
      <div class="pills">
        ${q._postName ? `<span class="pill post">${escapeHtml(q._postName)}</span>` : ""}
        <span class="pill paper">${escapeHtml(q._paperName)}</span>
        <span class="pill subject" data-action="edit-subject">${escapeHtml(q.subject||"Unclassified")} ✎</span>
        <span class="pill topic" data-action="edit-topic">${escapeHtml(q.topic||FALLBACK_TOPIC)} ✎</span>
      </div>
    </div>
    <div class="actions-row">
      <div class="grp">
        <button class="actbtn" data-action="copy-question" title="Copy this question">📋</button>
        <button class="actbtn" data-action="edit-question" title="Edit question">📝</button>
      </div>
      <div class="grp">
        <button class="actbtn danger" data-action="toggle-deleted" title="Toggle deleted-by-PSC status">${isDeleted?"↺":"🚫"}</button>
        <button class="actbtn danger" data-action="delete-question" title="Delete question">🗑</button>
      </div>
    </div>
    ${isDeleted ? `<div class="deleted-banner">Deleted question (per official PSC answer key)</div>` : ""}
    <div class="qtext">${escapeHtml(q.question_text)}</div>
    <ul class="options">${opts}</ul>
    ${expl}
    ${hint ? `<div class="opthint">${hint}</div>` : ""}
  </div>`;
}

function bindSlipInteractions(questions){
  document.querySelectorAll('.pill.topic[data-action="edit-topic"]').forEach(pill=>{
    pill.addEventListener("click", (e)=>{
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const q = questions.find(qq=> qq._paperId===paperId && String(qq.id)===qid);
      openTopicEditor(paperId, qid, q.subject, q.topic||FALLBACK_TOPIC);
    });
  });
  document.querySelectorAll('.pill.subject[data-action="edit-subject"]').forEach(pill=>{
    pill.addEventListener("click", (e)=>{
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const q = questions.find(qq=> qq._paperId===paperId && String(qq.id)===qid);
      openSubjectEditor(paperId, qid, q.subject);
    });
  });
  document.querySelectorAll('.actbtn[data-action="delete-question"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      if(confirm("Delete this question? This can't be undone.")){
        deleteQuestion(paperId, qid);
        render();
        toast("Question deleted");
      }
    });
  });
  document.querySelectorAll('.actbtn[data-action="toggle-deleted"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const q = questions.find(qq=> qq._paperId===paperId && String(qq.id)===qid);
      const alreadyDeleted = Number(q.correct_answer_index) === DELETED_SENTINEL;
      const hasRealAnswer = !alreadyDeleted && q.correct_answer_index !== null && q.correct_answer_index !== undefined;
      if(!alreadyDeleted && hasRealAnswer){
        if(!confirm("This question already has a marked correct answer. Mark it as deleted-by-PSC anyway? This will clear the marked answer.")) return;
      }
      const nowDeleted = toggleDeletedStatus(paperId, qid);
      render();
      toast(nowDeleted ? "Marked as a deleted question" : "Deletion status cleared");
    });
  });
  document.querySelectorAll('.actbtn[data-action="copy-question"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const q = questions.find(qq=> qq._paperId===paperId && String(qq.id)===qid);
      copySingleQuestion(q);
    });
  });
  document.querySelectorAll('.actbtn[data-action="edit-question"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      openEditQuestionModal(paperId, qid);
    });
  });
  document.querySelectorAll('.slip .optlabel-btn').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      if(btn.disabled) return;
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const idx = Number(btn.dataset.idx);
      setCorrectAnswer(paperId, qid, idx);
      render();
    });
  });
}

/* ================= Data mutation helpers ================= */
function setCorrectAnswer(paperId, qid, idx){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  const already = (q.correct_answer_index !== null && q.correct_answer_index !== undefined && Number(q.correct_answer_index) === idx);
  q.correct_answer_index = already ? null : idx;
  saveData(DATA);
  toast(already ? "Correct answer cleared" : "Marked as correct answer");
}
function toggleDeletedStatus(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return false;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return false;
  const isDeleted = Number(q.correct_answer_index) === DELETED_SENTINEL;
  q.correct_answer_index = isDeleted ? null : DELETED_SENTINEL;
  saveData(DATA);
  return !isDeleted;
}
function deleteQuestion(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  paper.questions = (paper.questions||[]).filter(qq=>String(qq.id)!==qid);
  saveData(DATA);
}

/* ================= Edit question modal ================= */
function openEditQuestionModal(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  const optsHtml = (q.options||[]).map((opt,i)=>`
    <div class="field">
      <label>Option ${letterFor(i)}</label>
      <textarea class="prose opt-prose editOpt" data-idx="${i}">${escapeHtml(opt)}</textarea>
    </div>`).join("");

  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Edit question</h3>
      <div class="field">
        <label>Question text</label>
        <textarea id="editQText" class="prose">${escapeHtml(q.question_text)}</textarea>
      </div>
      ${optsHtml}
      <div class="field">
        <label>Explanation (optional)</label>
        <textarea id="editExpl" class="prose" placeholder="Why this answer is correct…">${escapeHtml(q.explanation||"")}</textarea>
      </div>
      <div id="editQStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelEditQ" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="saveEditQ" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelEditQ").addEventListener("click", closeModal);
  document.getElementById("saveEditQ").addEventListener("click", ()=>{
    const newText = document.getElementById("editQText").value.trim();
    const statusEl = document.getElementById("editQStatus");
    if(!newText){ setStatus(statusEl,"err","Question text can't be empty."); return; }
    const newOpts = Array.from(document.querySelectorAll(".editOpt")).map(inp=>inp.value.trim());
    if(newOpts.some(o=>!o)){ setStatus(statusEl,"err","Options can't be empty."); return; }
    q.question_text = newText;
    q.options = newOpts;
    q.explanation = document.getElementById("editExpl").value.trim();
    saveData(DATA);
    closeModal();
    render();
    toast("Question updated");
  });
}

/* ================= Paper filter modal (with templates) ================= */
function openPaperFilterModal(currentIncluded, papersInScope, scopeTag, onApply){
  let selected = currentIncluded ? new Set(currentIncluded) : new Set(papersInScope.map(p=>p.id));

  function listHtml(){
    return papersInScope.map(p=>{
      const checked = selected.has(p.id);
      return `<button type="button" class="check-item ${checked?"checked":""}" data-paper-id="${escapeHtml(p.id)}">
        <span class="box">${checked?"✓":""}</span>
        <span style="flex:1;">
          <div>${escapeHtml(p.name)}</div>
          <div class="ci-sub">${p.post_name?escapeHtml(p.post_name)+" · ":""}${p.count} question${p.count===1?"":"s"}</div>
        </span>
      </button>`;
    }).join("");
  }
  const templates = DATA.paperTemplates.filter(t=> t.syllabus_id===getCurrentSyllabusId());
  function templatesHtml(){
    if(templates.length===0) return `<div class="meta">No saved templates yet for this syllabus.</div>`;
    return templates.map(t=> `<div class="template-row">
      <div><div class="tpl-name">${escapeHtml(t.name)}</div><div class="tpl-sub">${t.paperIds.length} paper(s)</div></div>
      <div style="display:flex;gap:6px;">
        <button class="iconbtn" data-apply-tpl="${escapeHtml(t.id)}">Apply</button>
        <button class="iconbtn bad" data-del-tpl="${escapeHtml(t.id)}">✕</button>
      </div>
    </div>`).join("");
  }

  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Choose exams to include</h3>
      <div class="meta" style="margin-bottom:10px;">Only affects this listing — untick an exam to exclude its questions.</div>
      <div class="row-btns" style="margin-top:0;margin-bottom:10px;">
        <button class="iconbtn" id="selectAllBtn" style="flex:1;justify-content:center;">Select all</button>
        <button class="iconbtn" id="selectNoneBtn" style="flex:1;justify-content:center;">Select none</button>
      </div>
      <div id="paperCheckList">${listHtml()}</div>
      <div class="divider">— saved templates —</div>
      <div id="templateList">${templatesHtml()}</div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end;margin-top:10px;">
        <div style="flex:1;">
          <label>Save current selection as a template</label>
          <input type="text" id="tplNameInput" placeholder="e.g. Last 3 exams">
        </div>
        <button class="iconbtn" id="saveTplBtn">Save</button>
      </div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelFilter" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="applyFilter" style="flex:1;justify-content:center;">Apply</button>
      </div>
    </div>
  </div>`;

  function rebindChecks(){
    document.querySelectorAll(".check-item").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.paperId;
        if(selected.has(id)) selected.delete(id); else selected.add(id);
        document.getElementById("paperCheckList").innerHTML = listHtml();
        rebindChecks();
      });
    });
  }
  function rebindTemplates(){
    document.querySelectorAll("[data-apply-tpl]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const tpl = templates.find(t=>t.id===btn.dataset.applyTpl);
        if(!tpl) return;
        selected = new Set(tpl.paperIds.filter(id=> papersInScope.some(p=>p.id===id)));
        document.getElementById("paperCheckList").innerHTML = listHtml();
        rebindChecks();
        toast(`Applied "${tpl.name}"`);
      });
    });
    document.querySelectorAll("[data-del-tpl]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        DATA.paperTemplates = DATA.paperTemplates.filter(t=>t.id!==btn.dataset.delTpl);
        saveData(DATA);
        const idx = templates.findIndex(t=>t.id===btn.dataset.delTpl);
        if(idx>=0) templates.splice(idx,1);
        document.getElementById("templateList").innerHTML = templatesHtml();
        rebindTemplates();
      });
    });
  }
  rebindChecks();
  rebindTemplates();

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelFilter").addEventListener("click", closeModal);
  document.getElementById("selectAllBtn").addEventListener("click", ()=>{
    papersInScope.forEach(p=>selected.add(p.id));
    document.getElementById("paperCheckList").innerHTML = listHtml();
    rebindChecks();
  });
  document.getElementById("selectNoneBtn").addEventListener("click", ()=>{
    selected.clear();
    document.getElementById("paperCheckList").innerHTML = listHtml();
    rebindChecks();
  });
  document.getElementById("saveTplBtn").addEventListener("click", ()=>{
    const name = document.getElementById("tplNameInput").value.trim();
    if(!name){ toast("Type a template name first"); return; }
    const tpl = { id: slugify(name), name, syllabus_id: getCurrentSyllabusId(), paperIds: Array.from(selected) };
    DATA.paperTemplates.push(tpl);
    saveData(DATA);
    templates.push(tpl);
    document.getElementById("templateList").innerHTML = templatesHtml();
    rebindTemplates();
    document.getElementById("tplNameInput").value = "";
    toast("Template saved");
  });
  document.getElementById("applyFilter").addEventListener("click", ()=>{
    closeModal();
    onApply(Array.from(selected));
  });
}

/* ================= Syllabus modals ================= */
function openSyllabusModal(){
  renderSyllabusModal();
}
function renderSyllabusModal(){
  const current = getCurrentSyllabusId();
  const rows = DATA.syllabuses.map(s=>{
    const paperCount = DATA.papers.filter(p=>(p.syllabus_id||"default")===s.id).length;
    const isSel = s.id===current;
    return `<div class="template-row">
      <button type="button" class="taxo-item ${isSel?"selected":""}" data-select-syl="${escapeHtml(s.id)}" style="flex:1;margin-bottom:0;">
        ${escapeHtml(s.name)}${isSel?" ✓":""}<div class="tpl-sub">${paperCount} paper${paperCount===1?"":"s"} · +${s.marking.positive} / -${s.marking.negNum}÷${s.marking.negDen}</div>
      </button>
      <div style="display:flex;gap:6px;margin-left:8px;">
        <button class="iconbtn" data-edit-syl="${escapeHtml(s.id)}">✎</button>
        ${s.id!=="default" ? `<button class="iconbtn bad" data-del-syl="${escapeHtml(s.id)}">🗑</button>` : ""}
      </div>
    </div>`;
  }).join("");

  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Choose syllabus / exam type</h3>
      <div class="meta" style="margin-bottom:10px;">Papers, subjects, topics, attempts, and stats all filter to the selected syllabus. Adding a new one never affects existing data.</div>
      <div id="sylList">${rows}</div>
      <div class="divider">— add a new syllabus —</div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
        <div style="flex:1;">
          <label>New syllabus name</label>
          <input type="text" id="newSylName" placeholder="e.g. Degree Level Prelims 2026">
        </div>
        <button class="iconbtn primary" id="addSylBtn">Add</button>
      </div>
      <div id="sylModalStatus"></div>
      <div class="row-btns"><button class="iconbtn" id="closeSylModal" style="width:100%;justify-content:center;">Close</button></div>
    </div>
  </div>`;

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeSylModal").addEventListener("click", ()=>{ closeModal(); render(); });

  document.querySelectorAll("[data-select-syl]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setCurrentSyllabusId(btn.dataset.selectSyl);
      closeModal();
      resetToTab("papers");
    });
  });
  document.querySelectorAll("[data-edit-syl]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditSyllabusModal(btn.dataset.editSyl));
  });
  document.querySelectorAll("[data-del-syl]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const s = DATA.syllabuses.find(x=>x.id===btn.dataset.delSyl);
      if(!s) return;
      const count = DATA.papers.filter(p=>p.syllabus_id===s.id).length;
      const msg = count>0
        ? `Delete "${s.name}"? Its ${count} paper(s) will be moved to Default, not deleted.`
        : `Delete "${s.name}"?`;
      if(!confirm(msg)) return;
      DATA.papers.forEach(p=>{ if(p.syllabus_id===s.id) p.syllabus_id="default"; });
      DATA.syllabuses = DATA.syllabuses.filter(x=>x.id!==s.id);
      if(getCurrentSyllabusId()===s.id) setCurrentSyllabusId("default");
      saveData(DATA);
      renderSyllabusModal();
      toast("Syllabus deleted");
    });
  });
  document.getElementById("addSylBtn").addEventListener("click", ()=>{
    const name = document.getElementById("newSylName").value.trim();
    const statusEl = document.getElementById("sylModalStatus");
    if(!name){ setStatus(statusEl,"err","Type a name first."); return; }
    DATA.syllabuses.push({ id: slugify(name), name, marking: Object.assign({}, DEFAULT_MARKING) });
    saveData(DATA);
    renderSyllabusModal();
  });
}

function openEditSyllabusModal(syllabusId){
  const s = DATA.syllabuses.find(x=>x.id===syllabusId);
  if(!s) return;
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Edit syllabus</h3>
      <div class="field">
        <label>Name</label>
        <input type="text" id="sylNameInput" value="${escapeHtml(s.name)}">
      </div>
      <div class="field">
        <label>Marking scheme</label>
        <div class="marking-row">
          <span>Correct answer:</span>
          <input type="number" id="markPos" value="${s.marking.positive}" step="0.25" min="0"> mark(s)
        </div>
        <div class="marking-row">
          <span>Deduct</span>
          <input type="number" id="markNegNum" value="${s.marking.negNum}" step="1" min="0">
          <span>mark(s) per</span>
          <input type="number" id="markNegDen" value="${s.marking.negDen}" step="1" min="1">
          <span>wrong answers</span>
        </div>
        <div class="meta">e.g. 1 mark per 3 wrong = deduct exactly ⅓ per wrong answer.</div>
      </div>
      <div id="sylEditStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelSylEdit" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="saveSylEdit" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelSylEdit").addEventListener("click", renderSyllabusModal);
  document.getElementById("saveSylEdit").addEventListener("click", ()=>{
    const name = document.getElementById("sylNameInput").value.trim();
    const statusEl = document.getElementById("sylEditStatus");
    if(!name){ setStatus(statusEl,"err","Name can't be empty."); return; }
    s.name = name;
    s.marking = {
      positive: parseFloat(document.getElementById("markPos").value) || 0,
      negNum: parseFloat(document.getElementById("markNegNum").value) || 0,
      negDen: parseFloat(document.getElementById("markNegDen").value) || 1
    };
    saveData(DATA);
    renderSyllabusModal();
    toast("Syllabus updated");
  });
}

function openMoveSyllabusModal(paperId){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const rows = DATA.syllabuses.map(s=>{
    const isSel = (paper.syllabus_id||"default")===s.id;
    return `<button type="button" class="taxo-item ${isSel?"selected":""}" data-syl="${escapeHtml(s.id)}">${escapeHtml(s.name)}${isSel?" ✓":""}</button>`;
  }).join("");
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Move to syllabus</h3>
      <div class="meta" style="margin-bottom:10px;">Moves "${escapeHtml(paper.name)}" to a different syllabus. Its questions, answers, and stats history are unaffected.</div>
      <div>${rows}</div>
      <div class="row-btns"><button class="iconbtn" id="closeMoveSyl" style="width:100%;justify-content:center;">Cancel</button></div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeMoveSyl").addEventListener("click", closeModal);
  document.querySelectorAll("[data-syl]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      paper.syllabus_id = btn.dataset.syl;
      saveData(DATA);
      closeModal();
      resetToTab("papers");
      toast("Paper moved");
    });
  });
}

/* ================= Practice mode (with optional timer) ================= */
function openStartTestModal(sourceType, scopeKey, scopeLabel, questions, syllabusId){
  const gradable = questions.filter(q=> q.correct_answer_index!==null && q.correct_answer_index!==undefined && Number(q.correct_answer_index)!==DELETED_SENTINEL);
  const skipped = questions.length - gradable.length;
  if(gradable.length===0){
    alert("None of the questions in this list have a marked correct answer yet, so a practice test can't be scored. Mark some correct answers first, or add an answer key.");
    return;
  }
  const suggested = Math.max(1, Math.ceil(gradable.length * 0.9));
  let useTimer = false;
  let minutes = suggested;

  function draw(){
    modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Start practice test</h3>
        <div class="meta" style="margin-bottom:10px;">${gradable.length} question${gradable.length===1?"":"s"}${skipped?` · ${skipped} skipped (no marked answer)`:""}</div>
        <div class="segmented" id="timerSeg">
          <button data-t="no" class="${!useTimer?"active":""}">No timer</button>
          <button data-t="yes" class="${useTimer?"active":""}">Timer</button>
        </div>
        ${useTimer ? `
        <div class="stepper">
          <button id="minusMin">−1</button>
          <div class="val">${minutes} min</div>
          <button id="plusMin">+1</button>
        </div>
        <div class="meta" style="text-align:center;margin-bottom:6px;">Suggested: ${suggested} min (≈0.9 min/question, rounded up)</div>
        <div class="meta" style="text-align:center;">Auto-submits the moment time runs out.</div>
        ` : ""}
        <div class="row-btns">
          <button class="iconbtn" id="cancelStart" style="flex:1;justify-content:center;">Cancel</button>
          <button class="iconbtn primary" id="confirmStart" style="flex:1;justify-content:center;">Start test</button>
        </div>
      </div>
    </div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
    document.getElementById("cancelStart").addEventListener("click", closeModal);
    document.querySelectorAll("#timerSeg button").forEach(btn=>{
      btn.addEventListener("click", ()=>{ useTimer = btn.dataset.t==="yes"; draw(); });
    });
    const minusBtn = document.getElementById("minusMin");
    const plusBtn = document.getElementById("plusMin");
    if(minusBtn) minusBtn.addEventListener("click", ()=>{ minutes = Math.max(1, minutes-1); draw(); });
    if(plusBtn) plusBtn.addEventListener("click", ()=>{ minutes = minutes+1; draw(); });
    document.getElementById("confirmStart").addEventListener("click", ()=>{
      closeModal();
      const questionRefs = gradable.map(q=>({paperId:q._paperId, qid:String(q.id)}));
      pushScreen({
        type:"practice", sourceType, scopeKey, scopeLabel, syllabusId: syllabusId||"default",
        questionRefs, answers:{}, submitted:false, qIndex:0, skippedCount: skipped,
        timerMinutes: useTimer ? minutes : null,
        timerEndAt: useTimer ? (Date.now() + minutes*60000) : null
      });
    });
  }
  draw();
}

function practiceSlipHtml(q, idx, selectedIndex){
  const originalNum = questionOriginalNumber(q);
  const opts = (q.options||[]).map((opt,i)=>{
    const isSelected = selectedIndex!==null && selectedIndex!==undefined && Number(selectedIndex)===i;
    return `<li class="${isSelected?"selected":""}" data-idx="${i}">
      <span class="optlabel-btn">${letterFor(i)}</span>
      <span class="opttext">${escapeHtml(opt)}</span>
    </li>`;
  }).join("");
  return `<div class="slip" data-qid="${escapeHtml(q._paperId)}::${escapeHtml(q.id)}">
    <div class="slip-head">
      <div class="qno">Q${idx}${originalNum?` <span class="qno-orig">(Paper Q${escapeHtml(originalNum)})</span>`:""}</div>
      <div class="pills">
        ${q._postName ? `<span class="pill post">${escapeHtml(q._postName)}</span>` : ""}
        <span class="pill paper">${escapeHtml(q._paperName)}</span>
        <span class="pill subject">${escapeHtml(q.subject||"Unclassified")}</span>
        <span class="pill topic">${escapeHtml(q.topic||FALLBACK_TOPIC)}</span>
      </div>
    </div>
    <div class="qtext">${escapeHtml(q.question_text)}</div>
    <ul class="options practice">${opts}</ul>
  </div>`;
}
function bindPracticeInteractions(screen){
  document.querySelectorAll(".options.practice li").forEach(li=>{
    li.addEventListener("click", ()=>{
      const slip = li.closest(".slip");
      const key = slip.dataset.qid;
      const idx = Number(li.dataset.idx);
      if(screen.answers[key]===idx){ delete screen.answers[key]; }
      else{ screen.answers[key]=idx; }
      render();
    });
  });
}

function computeAttemptResults(questionRefs, answers){
  const idx = buildQuestionIndex();
  let correctCount=0, wrongCount=0, unansweredCount=0;
  const answerRecords = [];
  questionRefs.forEach(ref=>{
    const key = `${ref.paperId}::${ref.qid}`;
    const q = idx[key];
    if(!q) return;
    const correctIndex = q.correct_answer_index;
    const isGraded = correctIndex!==null && correctIndex!==undefined && Number(correctIndex)!==DELETED_SENTINEL;
    const selectedIndex = (answers[key]===undefined) ? null : answers[key];
    let isCorrect = false;
    if(isGraded){
      if(selectedIndex===null) unansweredCount++;
      else if(Number(selectedIndex)===Number(correctIndex)){ isCorrect=true; correctCount++; }
      else{ wrongCount++; }
    }
    answerRecords.push({
      paperId: ref.paperId, qid: ref.qid, subject: q.subject, topic: q.topic||FALLBACK_TOPIC,
      selectedIndex, correctIndex: isGraded?Number(correctIndex):null, isCorrect, isGraded
    });
  });
  return { answerRecords, correctCount, wrongCount, unansweredCount, totalCount: answerRecords.length };
}

function submitPracticeTest(screen, autoSubmitted){
  const results = computeAttemptResults(screen.questionRefs, screen.answers);
  const marking = getSyllabusById(screen.syllabusId||"default").marking;
  const netScore = computeNetScore(results.correctCount, results.wrongCount, marking);
  const attempt = {
    id: "a" + Date.now() + Math.random().toString(36).slice(2,7),
    type: screen.sourceType,
    scopeKey: screen.scopeKey,
    scopeLabel: screen.scopeLabel,
    syllabus_id: screen.syllabusId||"default",
    timestamp: new Date().toISOString(),
    answers: results.answerRecords,
    correctCount: results.correctCount,
    wrongCount: results.wrongCount,
    unansweredCount: results.unansweredCount,
    totalCount: results.totalCount,
    netScore,
    marking,
    timerMinutes: screen.timerMinutes || null,
    autoSubmitted: !!autoSubmitted
  };
  if(!DATA.attempts) DATA.attempts = [];
  DATA.attempts.push(attempt);
  saveData(DATA);
  screen.submitted = true;
  screen.results = results;
  screen.netScore = netScore;
  screen.marking = marking;
  screen.attemptId = attempt.id;
  screen.qIndex = 0;
  render();
  toast(autoSubmitted
    ? `Time's up — submitted: ${results.correctCount} correct, ${results.wrongCount} wrong`
    : `Submitted: ${results.correctCount} correct, ${results.wrongCount} wrong`);
}

function startPracticeTimerTick(screen){
  function tick(){
    const el = document.getElementById("timerNum");
    const bar = document.getElementById("timerBar");
    if(!el || !bar) return;
    const remainingMs = screen.timerEndAt - Date.now();
    if(remainingMs<=0){
      el.textContent = "00:00";
      if(timerIntervalId){ clearInterval(timerIntervalId); timerIntervalId=null; }
      submitPracticeTest(screen, true);
      return;
    }
    const totalSec = Math.ceil(remainingMs/1000);
    const m = Math.floor(totalSec/60);
    const s = totalSec%60;
    el.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    bar.classList.toggle("low", totalSec<=60);
  }
  tick();
  timerIntervalId = setInterval(tick, 1000);
}

function renderPracticeScreen(screen){
  const idx = buildQuestionIndex();
  const questions = screen.questionRefs.map(ref=> idx[`${ref.paperId}::${ref.qid}`]).filter(Boolean);

  if(!screen.submitted){
    const answeredCount = Object.keys(screen.answers).length;
    let html = `<div class="detail-head">
      <div style="width:100%">
        <div class="backrow" id="backBtn">‹ Exit practice test</div>
        <h2>Practice: ${escapeHtml(screen.scopeLabel)}</h2>
        <div class="meta">${questions.length} question${questions.length===1?"":"s"}${screen.skippedCount?` · ${screen.skippedCount} skipped (no marked answer)`:""}${screen.timerEndAt?"":" · no timer"}</div>
      </div>
    </div>`;

    if(questions.length===0){
      html += emptyState("No questions available", "");
      mainEl.innerHTML = html;
      document.getElementById("backBtn").addEventListener("click", popScreen);
      return;
    }

    if(screen.timerEndAt){
      html += `<div class="timer-bar" id="timerBar"><span>⏱</span><span class="timer-num" id="timerNum">--:--</span></div>`;
    }

    html += renderQuestionsListHtml(questions, screen, (q,i)=> practiceSlipHtml(q, i, screen.answers[`${q._paperId}::${q.id}`]), (q)=> screen.answers[`${q._paperId}::${q.id}`]!==undefined);
    mainEl.innerHTML = html;
    document.getElementById("backBtn").addEventListener("click", ()=>{
      if(answeredCount>0 && !confirm("Exit without submitting? Your answers won't be saved.")) return;
      popScreen();
    });
    bindSwipeNav(questions, screen);
    bindPracticeInteractions(screen);
    if(screen.timerEndAt) startPracticeTimerTick(screen);

    const bar = document.createElement("div");
    bar.className = "bottomnav";
    bar.innerHTML = `<div class="bottomnav-inner">
      <div class="progress">Answered ${answeredCount} of ${questions.length}</div>
      <button class="iconbtn primary" id="submitTestBtn">Submit test</button>
    </div>`;
    document.body.appendChild(bar);
    document.getElementById("submitTestBtn").addEventListener("click", ()=>{
      if(answeredCount < questions.length && !confirm(`You've answered ${answeredCount} of ${questions.length}. Submit anyway?`)) return;
      submitPracticeTest(screen, false);
    });
  } else {
    renderResultsReview({
      backLabel: "Back",
      onBack: popScreen,
      title: `Practice results: ${screen.scopeLabel}`,
      meta: screen.timerMinutes ? `Timed · ${screen.timerMinutes} min${screen.results && screen.results.autoSubmitted?" · auto-submitted":""}` : "No timer · practice mode",
      answerRecords: screen.results.answerRecords,
      counts: screen.results,
      netScore: screen.netScore,
      marking: screen.marking,
      screen,
      extraActionsHtml: `<div style="display:flex;gap:8px;margin:12px 0 4px;">
        <button class="iconbtn" id="retakeBtn" style="flex:1;justify-content:center;">Retake test</button>
      </div>`,
      bindExtra: ()=>{
        document.getElementById("retakeBtn").addEventListener("click", ()=>{
          screen.answers = {}; screen.submitted = false; screen.results = null; screen.qIndex = 0;
          render();
        });
      }
    });
  }
}

/* ================= Results review (shared by practice results & attempt history) ================= */
function reviewSlipHtml(q, idx, rec, showExplanations){
  const originalNum = questionOriginalNumber(q);
  const isGraded = rec.isGraded;
  const opts = (q.options||[]).map((opt,i)=>{
    const isCorrectOpt = isGraded && Number(rec.correctIndex)===i;
    const isSelectedWrong = isGraded && rec.selectedIndex!==null && Number(rec.selectedIndex)===i && !rec.isCorrect;
    let cls = "";
    if(isCorrectOpt) cls="correct"; else if(isSelectedWrong) cls="wrong-pick";
    return `<li class="${cls}"><span class="optlabel-btn ${cls}">${letterFor(i)}</span><span class="opttext">${escapeHtml(opt)}</span></li>`;
  }).join("");

  let banner;
  if(!isGraded){
    banner = `<div class="result-banner neutral">Not graded (no marked answer at the time)</div>`;
  } else if(rec.selectedIndex===null){
    banner = `<div class="result-banner neutral">Unanswered — correct answer highlighted below</div>`;
  } else if(rec.isCorrect){
    banner = `<div class="result-banner good">Correct</div>`;
  } else {
    banner = `<div class="result-banner bad">Incorrect — your answer marked red, correct answer in green</div>`;
  }

  let expl = "";
  if(showExplanations && q.explanation && q.explanation.trim()){
    expl = `<div class="explanation-block"><div class="exp-label">Explanation</div>${escapeHtml(q.explanation)}</div>`;
  }

  const slipClass = isGraded ? (rec.selectedIndex===null ? "" : (rec.isCorrect?"slip-correct":"slip-wrong")) : "";

  return `<div class="slip ${slipClass}">
    <div class="slip-head">
      <div class="qno">Q${idx}${originalNum?` <span class="qno-orig">(Paper Q${escapeHtml(originalNum)})</span>`:""}</div>
      <div class="pills">
        ${q._postName ? `<span class="pill post">${escapeHtml(q._postName)}</span>` : ""}
        <span class="pill paper">${escapeHtml(q._paperName)}</span>
        <span class="pill subject">${escapeHtml(q.subject||"Unclassified")}</span>
        <span class="pill topic">${escapeHtml(q.topic||FALLBACK_TOPIC)}</span>
      </div>
    </div>
    ${banner}
    <div class="qtext">${escapeHtml(q.question_text)}</div>
    <ul class="options">${opts}</ul>
    ${expl}
  </div>`;
}

function renderResultsReview({ backLabel, onBack, title, meta, answerRecords, counts, netScore, marking, screen, extraActionsHtml, bindExtra }){
  const idxMap = buildQuestionIndex();
  const resolved = answerRecords.map(rec=>({ rec, q: idxMap[`${rec.paperId}::${rec.qid}`] })).filter(x=>x.q);

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ ${escapeHtml(backLabel)}</div>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">${escapeHtml(meta)}</div>
    </div>
  </div>`;

  html += `<div class="summary-banner">
    <div class="summary-stat"><div class="num good">${counts.correctCount}</div><div class="label">Correct</div></div>
    <div class="summary-stat"><div class="num bad">${counts.wrongCount}</div><div class="label">Wrong</div></div>
    <div class="summary-stat"><div class="num neutral">${counts.unansweredCount}</div><div class="label">Unanswered</div></div>
    <div class="summary-stat"><div class="num neutral">${counts.totalCount}</div><div class="label">Total</div></div>
    ${netScore!==undefined && netScore!==null ? `<div class="summary-stat"><div class="num" style="color:var(--gold);">${netScore}</div><div class="label">Score${marking?` (+${marking.positive}/−${marking.negNum}÷${marking.negDen})`:""}</div></div>` : ""}
  </div>`;

  const hasExplanations = resolved.some(x=> x.q.explanation && x.q.explanation.trim());
  let actionsHtml = extraActionsHtml || "";
  if(hasExplanations){
    actionsHtml += `<div style="display:flex;gap:8px;margin:8px 0 4px;">
      <button class="iconbtn" id="toggleExplBtn" style="flex:1;justify-content:center;">${screen.showExplanations?"Hide explanations":"Show explanations"}</button>
    </div>`;
  }
  if(actionsHtml) html += actionsHtml;

  const questions = resolved.map(x=>x.q);
  const recMap = {};
  resolved.forEach(x=>{ recMap[`${x.q._paperId}::${x.q.id}`] = x.rec; });

  if(questions.length===0){
    html += emptyState("No questions to show", "The questions in this attempt may have been deleted since.");
  } else {
    html += renderQuestionsListHtml(questions, screen, (q,i)=> reviewSlipHtml(q, i, recMap[`${q._paperId}::${q.id}`], !!screen.showExplanations));
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", onBack);
  const explBtn = document.getElementById("toggleExplBtn");
  if(explBtn) explBtn.addEventListener("click", ()=>{ screen.showExplanations = !screen.showExplanations; render(); });
  if(bindExtra) bindExtra();
  if(questions.length>0) bindSwipeNav(questions, screen);
}

/* ================= Question Bank ================= */
function renderBankRoot(){
  const banks = DATA.banks;
  let html = `<div style="display:flex;gap:8px;margin-bottom:10px;">
    <button class="iconbtn primary" id="newBankBtn" style="flex:1;justify-content:center;">+ New bank</button>
  </div>`;
  if(banks.length===0){
    html += emptyState("No question banks yet", "Create one, then add questions from your existing papers or import a JSON of new ones, and generate random practice exams from it.");
  } else {
    html += `<div id="listWrap">`;
    banks.forEach((b, idx)=>{
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: b.name,
        sub: `${b.questionRefs.length} question${b.questionRefs.length===1?"":"s"}`,
        count: "→",
        dataAttr: `data-bank-id="${escapeHtml(b.id)}"`
      });
    });
    html += `</div>`;
  }
  mainEl.innerHTML = html;
  document.getElementById("newBankBtn").addEventListener("click", openNewBankModal);
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"bank-detail", bankId: row.dataset.bankId }));
  });
}
function openNewBankModal(){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>New question bank</h3>
      <div class="field"><label>Name</label><input type="text" id="bankNameInput" placeholder="e.g. Weak topics mix"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelBank" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="saveBank" style="flex:1;justify-content:center;">Create</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelBank").addEventListener("click", closeModal);
  document.getElementById("saveBank").addEventListener("click", ()=>{
    const name = document.getElementById("bankNameInput").value.trim();
    if(!name) return;
    const bank = { id: slugify(name), name, questionRefs: [] };
    DATA.banks.push(bank);
    saveData(DATA);
    closeModal();
    pushScreen({ type:"bank-detail", bankId: bank.id });
  });
}

function renderBankDetail(bankId){
  const bank = DATA.banks.find(b=>b.id===bankId);
  if(!bank){ popScreen(); return; }
  const screen = currentScreen();
  const idxMap = buildQuestionIndex();
  const questions = bank.questionRefs.map(ref=> idxMap[`${ref.paperId}::${ref.qid}`]).filter(Boolean);
  const hideAnswers = !!screen.hideAnswers;
  const showExplanations = !!screen.showExplanations;
  const locked = screen.answersLocked !== false;

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ Back to Bank</div>
      <h2>${escapeHtml(bank.name)}</h2>
      <div class="meta">${questions.length} question${questions.length===1?"":"s"}</div>
    </div>
  </div>`;
  html += `<div style="display:flex;gap:8px;margin:12px 0 4px;">
    <button class="iconbtn" id="renameBankBtn" style="flex:1;justify-content:center;">Rename</button>
    <button class="iconbtn" id="deleteBankBtn" style="flex:1;justify-content:center;border-color:var(--maroon);color:#f0a3ab;">Delete bank</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn" id="addFromPoolBtn" style="flex:1;justify-content:center;">+ Add existing questions</button>
    <button class="iconbtn" id="importToBankBtn" style="flex:1;justify-content:center;">+ Import JSON</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn primary" id="randomExamBtn" style="flex:1;justify-content:center;">Create random exam</button>
  </div>`;
  html += `<div style="display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap;">
    <button class="iconbtn" id="toggleAnswersBtn" style="flex:1;justify-content:center;">${hideAnswers ? "Show answers" : "Hide answers"}</button>
    <button class="iconbtn ${locked?"":"good"}" id="toggleLockBtn" style="flex:1;justify-content:center;">${locked?"🔒 Answers locked":"🔓 Answers unlocked"}</button>
  </div>`;

  if(questions.length===0){
    html += emptyState("No questions in this bank yet", "");
    mainEl.innerHTML = html;
  } else {
    html += renderQuestionsListHtml(questions, screen, (q, idx)=> {
      return `<div class="template-row" style="margin-bottom:-8px;">
        <span></span>
        <button class="actbtn bank-remove" data-remove-ref="${escapeHtml(q._paperId)}::${escapeHtml(q.id)}">Remove from bank ✕</button>
      </div>` + questionSlipHtml(q, idx, hideAnswers, showExplanations, locked);
    });
    mainEl.innerHTML = html;
  }

  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.getElementById("renameBankBtn").addEventListener("click", ()=>{
    const name = prompt("Rename bank", bank.name);
    if(name && name.trim()){ bank.name = name.trim(); saveData(DATA); render(); }
  });
  document.getElementById("deleteBankBtn").addEventListener("click", ()=>{
    if(confirm(`Delete bank "${bank.name}"? The underlying questions are not affected.`)){
      DATA.banks = DATA.banks.filter(b=>b.id!==bankId);
      saveData(DATA);
      resetToTab("bank");
    }
  });
  document.getElementById("addFromPoolBtn").addEventListener("click", ()=> openQuestionPickerModal(bankId));
  document.getElementById("importToBankBtn").addEventListener("click", ()=> openImportToBankModal(bankId));
  document.getElementById("randomExamBtn").addEventListener("click", ()=> openRandomExamModal(bank));
  const toggleAnswersBtn = document.getElementById("toggleAnswersBtn");
  if(toggleAnswersBtn) toggleAnswersBtn.addEventListener("click", ()=>{ screen.hideAnswers=!hideAnswers; render(); });
  const toggleLockBtn = document.getElementById("toggleLockBtn");
  if(toggleLockBtn) toggleLockBtn.addEventListener("click", ()=>{ screen.answersLocked=!locked; render(); });
  document.querySelectorAll("[data-remove-ref]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const key = btn.dataset.removeRef;
      bank.questionRefs = bank.questionRefs.filter(r=>`${r.paperId}::${r.qid}`!==key);
      saveData(DATA);
      render();
      toast("Removed from bank");
    });
  });
  if(questions.length>0){
    bindSlipInteractions(questions);
    bindSwipeNav(questions, screen);
  }
}

function openQuestionPickerModal(bankId){
  const bank = DATA.banks.find(b=>b.id===bankId);
  if(!bank) return;
  const existingKeys = new Set(bank.questionRefs.map(r=>`${r.paperId}::${r.qid}`));
  const all = allQuestions();
  let term = "";
  let picked = new Set();

  function filtered(){
    const t = term.toLowerCase();
    return all.filter(q=> !existingKeys.has(`${q._paperId}::${q.id}`) &&
      (!t || q.question_text.toLowerCase().includes(t) || q.subject.toLowerCase().includes(t) || (q.topic||"").toLowerCase().includes(t) || q._paperName.toLowerCase().includes(t)));
  }
  function listHtml(){
    return filtered().slice(0,150).map(q=>{
      const key = `${q._paperId}::${q.id}`;
      const checked = picked.has(key);
      return `<button type="button" class="check-item ${checked?"checked":""}" data-qkey="${escapeHtml(key)}">
        <span class="box">${checked?"✓":""}</span>
        <span style="flex:1;">
          <div style="font-size:0.82rem;">${escapeHtml(q.question_text.slice(0,90))}${q.question_text.length>90?"…":""}</div>
          <div class="ci-sub">${escapeHtml(q._paperName)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}</div>
        </span>
      </button>`;
    }).join("") || `<div class="meta">No matching questions.</div>`;
  }

  function draw(){
    modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Add questions to "${escapeHtml(bank.name)}"</h3>
        <input class="search" id="pickerSearch" placeholder="Search question text, paper, subject, topic…" value="${escapeHtml(term)}">
        <div class="meta" style="margin:6px 0;">${picked.size} selected · showing up to 150 matches</div>
        <div id="pickerList" style="max-height:46vh;overflow-y:auto;">${listHtml()}</div>
        <div class="row-btns">
          <button class="iconbtn" id="cancelPicker" style="flex:1;justify-content:center;">Cancel</button>
          <button class="iconbtn primary" id="addPicked" style="flex:1;justify-content:center;">Add selected</button>
        </div>
      </div>
    </div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
    document.getElementById("cancelPicker").addEventListener("click", closeModal);
    document.getElementById("pickerSearch").addEventListener("input", (e)=>{
      const pos = e.target.selectionStart;
      term = e.target.value; draw();
      const nb = document.getElementById("pickerSearch");
      if(nb){ nb.focus(); nb.setSelectionRange(pos,pos); }
    });
    document.querySelectorAll("[data-qkey]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const key = btn.dataset.qkey;
        if(picked.has(key)) picked.delete(key); else picked.add(key);
        document.getElementById("pickerList").innerHTML = listHtml();
        document.querySelectorAll("[data-qkey]").forEach(b2=>{
          b2.addEventListener("click", arguments.callee);
        });
        draw();
      });
    });
    document.getElementById("addPicked").addEventListener("click", ()=>{
      picked.forEach(key=>{
        const [paperId, qid] = key.split("::");
        bank.questionRefs.push({ paperId, qid });
      });
      saveData(DATA);
      closeModal();
      render();
      toast(`Added ${picked.size} question(s) to bank`);
    });
  }
  draw();
}

function openImportToBankModal(bankId){
  const bank = DATA.banks.find(b=>b.id===bankId);
  if(!bank) return;
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Import questions into "${escapeHtml(bank.name)}"</h3>
      <div class="field">
        <label>Upload a JSON file</label>
        <label class="filebtn" for="bankFileInput">Tap to choose a .json file</label>
        <input type="file" id="bankFileInput" accept="application/json,.json" style="display:none">
      </div>
      <div class="divider">— or paste JSON below —</div>
      <div class="field">
        <label>Paste JSON (same format as a question paper)</label>
        <textarea id="bankPasteArea" placeholder='{"paper":{"id":"...","name":"..."},"questions":[...]}'></textarea>
      </div>
      <div class="meta" style="margin-bottom:6px;">This creates a hidden internal "paper" to hold these questions and adds them all to this bank. It won't show up in your Papers tab or count toward any syllabus.</div>
      <div id="bankImportStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelBankImport">Cancel</button>
        <button class="iconbtn primary" id="confirmBankImport">Import</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelBankImport").addEventListener("click", closeModal);
  document.getElementById("bankFileInput").addEventListener("change", (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById("bankPasteArea").value = reader.result; };
    reader.readAsText(file);
  });
  document.getElementById("confirmBankImport").addEventListener("click", ()=>{
    const raw = document.getElementById("bankPasteArea").value.trim();
    const statusEl = document.getElementById("bankImportStatus");
    if(!raw){ setStatus(statusEl,"err","Paste or upload a JSON file first."); return; }
    let parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ renderJsonErrorHelp(statusEl, raw, e, "bankPasteArea"); return; }
    const errs = validatePaperJson(parsed);
    if(errs.length){ setStatus(statusEl,"err","Problems found:\n"+errs.join("\n")); return; }

    const paperObj = {
      id: parsed.paper.id || slugify("bank-src-"+bank.name),
      name: parsed.paper.name,
      post_name: parsed.paper.post_name || "",
      syllabus_id: "__bank_only__",
      is_bank_only: true,
      questions: parsed.questions
    };
    const existingIdx = DATA.papers.findIndex(p=>p.id===paperObj.id);
    if(existingIdx>=0){ DATA.papers[existingIdx] = paperObj; } else { DATA.papers.push(paperObj); }
    parsed.questions.forEach(q=>{ bank.questionRefs.push({ paperId: paperObj.id, qid: String(q.id) }); });
    saveData(DATA);
    closeModal();
    render();
    toast(`Imported ${parsed.questions.length} question(s) into bank`);
  });
}

function openRandomExamModal(bank){
  if(bank.questionRefs.length===0){ alert("This bank is empty — add some questions first."); return; }
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Create random exam</h3>
      <div class="field">
        <label>How many questions (bank has ${bank.questionRefs.length})</label>
        <input type="number" id="randomCount" min="1" max="${bank.questionRefs.length}" value="${Math.min(50, bank.questionRefs.length)}">
      </div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelRandom" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmRandom" style="flex:1;justify-content:center;">Continue</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelRandom").addEventListener("click", closeModal);
  document.getElementById("confirmRandom").addEventListener("click", ()=>{
    const n = Math.max(1, Math.min(bank.questionRefs.length, parseInt(document.getElementById("randomCount").value,10) || bank.questionRefs.length));
    closeModal();
    const idxMap = buildQuestionIndex();
    const pool = bank.questionRefs.map(r=> idxMap[`${r.paperId}::${r.qid}`]).filter(Boolean);
    const chosen = sampleRandom(pool, n);
    openStartTestModal("bank", bank.id, `${bank.name} (random ${n})`, chosen, "default");
  });
}

/* ================= Attempts tab ================= */
function renderAttemptsRoot(){
  const screen = currentScreen();
  const grouping = screen.grouping || "paper";
  const cur = getCurrentSyllabusId();
  const attempts = (DATA.attempts||[]).filter(a=> a.type===grouping && (grouping==="bank" || a.syllabus_id===cur));

  let html = `<div class="segmented" id="groupSeg">
    <button data-g="paper" class="${grouping==='paper'?'active':''}">Paper</button>
    <button data-g="subject" class="${grouping==='subject'?'active':''}">Subject</button>
    <button data-g="topic" class="${grouping==='topic'?'active':''}">Topic</button>
    <button data-g="bank" class="${grouping==='bank'?'active':''}">Bank</button>
  </div>`;

  if(attempts.length===0){
    html += emptyState("No attempts yet", grouping==="bank" ? "Create a random exam from a question bank to see attempts here." : `Start a practice test from a ${grouping} listing to see your history here.`);
    mainEl.innerHTML = html;
  } else {
    const groups = {};
    attempts.forEach(a=>{
      if(!groups[a.scopeKey]) groups[a.scopeKey] = { scopeKey:a.scopeKey, scopeLabel:a.scopeLabel, attempts:[] };
      groups[a.scopeKey].attempts.push(a);
    });
    const rows = Object.values(groups).map(g=>{
      g.attempts.sort((x,y)=> new Date(y.timestamp)-new Date(x.timestamp));
      const latest = g.attempts[0];
      const avgPct = Math.round(100 * g.attempts.reduce((s,a)=> s + (a.totalCount? a.correctCount/a.totalCount : 0), 0) / g.attempts.length);
      return { g, latest, avgPct };
    }).sort((a,b)=> new Date(b.latest.timestamp) - new Date(a.latest.timestamp));

    html += `<div id="listWrap">`;
    rows.forEach((r, idx)=>{
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: r.g.scopeLabel,
        sub: `${r.g.attempts.length} attempt${r.g.attempts.length===1?"":"s"} · avg ${r.avgPct}% correct`,
        count: (r.latest.netScore!==undefined && r.latest.netScore!==null) ? `${r.latest.netScore} pts` : `${r.latest.correctCount}/${r.latest.totalCount}`,
        dataAttr: `data-scope-key="${escapeHtml(r.g.scopeKey)}" data-scope-label="${escapeHtml(r.g.scopeLabel)}"`
      });
    });
    html += `</div>`;
    mainEl.innerHTML = html;
    document.querySelectorAll("#listWrap .row").forEach(row=>{
      row.addEventListener("click", ()=> pushScreen({ type:"attempts-for-scope", groupBy: grouping, scopeKey: row.dataset.scopeKey, scopeLabel: row.dataset.scopeLabel }));
    });
  }

  document.querySelectorAll("#groupSeg button").forEach(btn=>{
    btn.addEventListener("click", ()=>{ screen.grouping = btn.dataset.g; render(); });
  });
}

function renderAttemptsForScope(groupBy, scopeKey, scopeLabel){
  const attempts = (DATA.attempts||[]).filter(a=>a.type===groupBy && a.scopeKey===scopeKey)
    .sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp));

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ Back to Attempts</div>
      <h2>${escapeHtml(scopeLabel)}</h2>
      <div class="meta">${attempts.length} attempt${attempts.length===1?"":"s"}</div>
    </div>
  </div>`;

  if(attempts.length===0){
    html += emptyState("No attempts here", "");
  } else {
    html += `<div id="listWrap">`;
    attempts.forEach((a, idx)=>{
      const pct = a.totalCount? Math.round(100*a.correctCount/a.totalCount) : 0;
      const scoreLabel = (a.netScore!==undefined && a.netScore!==null) ? `${a.netScore} pts` : `${pct}%`;
      html += rowHtml({
        num: String(idx+1).padStart(2,"0"),
        title: new Date(a.timestamp).toLocaleString(),
        sub: `${a.correctCount} correct · ${a.wrongCount} wrong · ${a.unansweredCount} unanswered${a.timerMinutes?` · timed ${a.timerMinutes}m${a.autoSubmitted?" (auto)":""}`:""}`,
        count: scoreLabel,
        dataAttr: `data-attempt-id="${escapeHtml(a.id)}"`
      });
    });
    html += `</div>`;
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"attempt-review", attemptId: row.dataset.attemptId }));
  });
}

function renderAttemptReviewScreen(attemptId){
  const attempt = (DATA.attempts||[]).find(a=>a.id===attemptId);
  if(!attempt){ popScreen(); return; }
  const screen = currentScreen();
  const prev = navStack[navStack.length-2];
  renderResultsReview({
    backLabel: (prev && prev.type==="attempts-for-scope") ? `Back to ${prev.scopeLabel}` : "Back",
    onBack: popScreen,
    title: attempt.scopeLabel,
    meta: `${new Date(attempt.timestamp).toLocaleString()} · ${attempt.type} attempt${attempt.timerMinutes?` · timed ${attempt.timerMinutes}m${attempt.autoSubmitted?" (auto-submitted)":""}`:""}`,
    answerRecords: attempt.answers,
    counts: attempt,
    netScore: attempt.netScore,
    marking: attempt.marking,
    screen
  });
}

/* ================= Stats tab ================= */
function computeAccuracyBySubject(){
  const cur = getCurrentSyllabusId();
  const bySubj = {};
  (DATA.attempts||[]).forEach(a=>{
    if(a.type!=="bank" && a.syllabus_id!==cur) return;
    a.answers.forEach(rec=>{
      if(!rec.isGraded) return;
      if(!bySubj[rec.subject]) bySubj[rec.subject] = {correct:0,total:0};
      bySubj[rec.subject].total++;
      if(rec.isCorrect) bySubj[rec.subject].correct++;
    });
  });
  return bySubj;
}
function computeAccuracyByTopic(){
  const cur = getCurrentSyllabusId();
  const byTopic = {};
  (DATA.attempts||[]).forEach(a=>{
    if(a.type!=="bank" && a.syllabus_id!==cur) return;
    a.answers.forEach(rec=>{
      if(!rec.isGraded) return;
      const key = `${rec.subject}|||${rec.topic}`;
      if(!byTopic[key]) byTopic[key] = {subject:rec.subject, topic:rec.topic, correct:0,total:0};
      byTopic[key].total++;
      if(rec.isCorrect) byTopic[key].correct++;
    });
  });
  return byTopic;
}
function computeQuestionCountsBySubject(){
  const counts = {};
  visibleQuestions().forEach(q=>{ counts[q.subject]=(counts[q.subject]||0)+1; });
  return counts;
}
function computeQuestionCountsByTopic(){
  const counts = {};
  visibleQuestions().forEach(q=>{ const key=`${q.subject}|||${q.topic||FALLBACK_TOPIC}`; counts[key]=(counts[key]||0)+1; });
  return counts;
}
function computePriorityList(){
  const subjCounts = computeQuestionCountsBySubject();
  const subjAcc = computeAccuracyBySubject();
  const topicCounts = computeQuestionCountsByTopic();
  const topicAcc = computeAccuracyByTopic();

  const maxSubjCount = Math.max(1, ...Object.values(subjCounts));
  const maxTopicCount = Math.max(1, ...Object.values(topicCounts));

  const subjectItems = Object.keys(subjCounts).map(subject=>{
    const freq = subjCounts[subject];
    const acc = subjAcc[subject];
    const practiced = !!acc && acc.total>0;
    const accuracy = practiced ? acc.correct/acc.total : null;
    const priority = (freq/maxSubjCount) * (practiced ? (1-accuracy) : 1);
    return { level:"subject", label: subject, freq, practiced, accuracy, priority };
  });
  const topicItems = Object.keys(topicCounts).map(key=>{
    const [subject, topic] = key.split("|||");
    const freq = topicCounts[key];
    const acc = topicAcc[key];
    const practiced = !!acc && acc.total>0;
    const accuracy = practiced ? acc.correct/acc.total : null;
    const priority = (freq/maxTopicCount) * (practiced ? (1-accuracy) : 1);
    return { level:"topic", label: topic, sublabel: subject, freq, practiced, accuracy, priority };
  });
  return {
    subjectItems: subjectItems.sort((a,b)=>b.priority-a.priority),
    topicItems: topicItems.sort((a,b)=>b.priority-a.priority)
  };
}
function priorityBadgeHtml(item){
  if(!item.practiced) return `<span class="pr-badge untried">Not yet practiced</span>`;
  if(item.accuracy<0.5) return `<span class="pr-badge weak">${Math.round(item.accuracy*100)}% accuracy</span>`;
  return `<span class="pr-badge ok">${Math.round(item.accuracy*100)}% accuracy</span>`;
}

function renderStatsScreen(){
  const cur = getCurrentSyllabusId();
  const attempts = (DATA.attempts||[]).filter(a=> a.type==="bank" || a.syllabus_id===cur);
  const totalAttempts = attempts.length;
  let totalGraded=0, totalCorrect=0;
  attempts.forEach(a=>{ a.answers.forEach(r=>{ if(r.isGraded){ totalGraded++; if(r.isCorrect) totalCorrect++; } }); });
  const overallPct = totalGraded? Math.round(100*totalCorrect/totalGraded) : null;

  let html = `<div class="detail-head"><div style="width:100%"><h2>Performance</h2><div class="meta">${escapeHtml(getSyllabusById(cur).name)} syllabus</div></div></div>`;

  html += `<div class="stat-cards">
    <div class="stat-card"><div class="num">${totalAttempts}</div><div class="label">Tests taken</div></div>
    <div class="stat-card"><div class="num">${totalGraded}</div><div class="label">Questions answered</div></div>
    <div class="stat-card"><div class="num">${overallPct===null?"—":overallPct+"%"}</div><div class="label">Overall accuracy</div></div>
  </div>`;

  if(totalAttempts===0){
    html += emptyState("No practice tests yet", "Start one from any paper, subject, or topic listing to see your stats here.");
    mainEl.innerHTML = html;
    return;
  }

  const recent = [...attempts].sort((a,b)=> new Date(a.timestamp)-new Date(b.timestamp)).slice(-10);
  html += `<div class="chart-block"><div class="chart-title">Recent test scores</div>`;
  recent.forEach(a=>{
    const pct = a.totalCount? Math.round(100*a.correctCount/a.totalCount):0;
    const color = pct>=70? "var(--good)" : pct>=40? "var(--gold)" : "var(--bad)";
    html += `<div class="bar-row">
      <div class="bar-label">${escapeHtml(new Date(a.timestamp).toLocaleDateString())}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
      <div class="bar-val">${pct}%</div>
    </div>`;
  });
  html += `</div>`;

  const subjAcc = computeAccuracyBySubject();
  const subjRows = Object.entries(subjAcc).map(([s,v])=>({subject:s, pct: v.total? Math.round(100*v.correct/v.total):0}))
    .sort((a,b)=>a.pct-b.pct);
  if(subjRows.length){
    html += `<div class="chart-block"><div class="chart-title">Accuracy by subject (weakest first)</div><div style="max-height:280px;overflow-y:auto;">`;
    subjRows.forEach(r=>{
      const color = r.pct>=70? "var(--good)" : r.pct>=40? "var(--gold)" : "var(--bad)";
      html += `<div class="bar-row">
        <div class="bar-label">${escapeHtml(r.subject)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%;background:${color};"></div></div>
        <div class="bar-val">${r.pct}%</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  const { subjectItems, topicItems } = computePriorityList();

  html += `<div class="chart-block">
    <div class="chart-title">Priority study areas — every subject & topic</div>
    <div class="chart-note">Ranked by how often each appears in your question bank, weighted against how much you're struggling with it (or haven't tried it yet). A simple heuristic, not a guarantee.</div>`;

  html += `<div style="margin-top:10px;"><div class="taxo-group-title">By subject (${subjectItems.length})</div>
    <div style="max-height:360px;overflow-y:auto;">`;
  subjectItems.forEach((item, idx)=>{
    html += `<div class="priority-row">
      <div class="pr-rank">${idx+1}</div>
      <div class="pr-main"><div class="pr-title">${escapeHtml(item.label)}</div><div class="pr-sub">${item.freq} question${item.freq===1?"":"s"} in your bank</div></div>
      ${priorityBadgeHtml(item)}
    </div>`;
  });
  html += `</div></div>`;

  html += `<div style="margin-top:14px;"><div class="taxo-group-title">By topic (${topicItems.length})</div>
    <div style="max-height:420px;overflow-y:auto;">`;
  topicItems.forEach((item, idx)=>{
    html += `<div class="priority-row">
      <div class="pr-rank">${idx+1}</div>
      <div class="pr-main"><div class="pr-title">${escapeHtml(item.label)}</div><div class="pr-sub">${escapeHtml(item.sublabel)} · ${item.freq} question${item.freq===1?"":"s"}</div></div>
      ${priorityBadgeHtml(item)}
    </div>`;
  });
  html += `</div></div></div>`;

  mainEl.innerHTML = html;
}

/* ================= Topic reassignment modal ================= */
function openTopicEditor(paperId, qid, currentSubject, currentTopic){
  renderTopicModal(paperId, qid, currentSubject, currentTopic, "");
}
function renderTopicModal(paperId, qid, currentSubject, currentTopic, searchTerm){
  const subjects = getAllSubjects();
  const ordered = [currentSubject, ...subjects.filter(s=>s!==currentSubject).sort((a,b)=>a.localeCompare(b))];
  const term = searchTerm.trim().toLowerCase();

  let groupsHtml = "";
  ordered.forEach(subject=>{
    const topics = getTopicsForSubject(subject);
    const filtered = term ? topics.filter(t=> t.toLowerCase().includes(term) || subject.toLowerCase().includes(term)) : topics;
    if(filtered.length===0) return;
    groupsHtml += `<div class="taxo-group">
      <div class="taxo-group-title">${escapeHtml(subject)}</div>
      ${filtered.map(t=>{
        const isSel = subject===currentSubject && t===currentTopic;
        return `<button type="button" class="taxo-item ${isSel?"selected":""}" data-subject="${escapeHtml(subject)}" data-topic="${escapeHtml(t)}">${escapeHtml(t)}${isSel?" ✓":""}</button>`;
      }).join("")}
    </div>`;
  });
  if(!groupsHtml){
    groupsHtml = `<div class="empty" style="padding:20px 6px;">No topics match "${escapeHtml(searchTerm)}".</div>`;
  }

  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Reassign topic</h3>
      <input class="search" id="topicSearch" placeholder="Search topics or subjects…" value="${escapeHtml(searchTerm)}">
      <div id="topicGroups" style="max-height:42vh;overflow-y:auto;margin:10px 0;">${groupsHtml}</div>
      <div class="divider">— or add a new topic —</div>
      <div class="field">
        <label>Subject</label>
        <select id="newTopicSubject">
          ${getAllSubjects().sort((a,b)=>a.localeCompare(b)).map(s=>`<option value="${escapeHtml(s)}" ${s===currentSubject?"selected":""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
        <div style="flex:1;">
          <label>New topic name</label>
          <input type="text" id="newTopicName" placeholder="e.g. Something specific">
        </div>
        <button class="iconbtn primary" id="addTopicBtn">Add</button>
      </div>
      <div id="topicModalStatus"></div>
      <div class="row-btns"><button class="iconbtn" id="closeTopicModal" style="width:100%;justify-content:center;">Close</button></div>
    </div>
  </div>`;

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeTopicModal").addEventListener("click", closeModal);
  document.getElementById("topicSearch").addEventListener("input", (e)=>{
    const pos = e.target.selectionStart;
    renderTopicModal(paperId, qid, currentSubject, currentTopic, e.target.value);
    const nb = document.getElementById("topicSearch");
    if(nb){ nb.focus(); nb.setSelectionRange(pos,pos); }
  });
  document.querySelectorAll(".taxo-item").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      updateQuestionSubjectAndTopic(paperId, qid, btn.dataset.subject, btn.dataset.topic);
      closeModal();
      render();
      toast("Topic updated");
    });
  });
  document.getElementById("addTopicBtn").addEventListener("click", ()=>{
    const subject = document.getElementById("newTopicSubject").value;
    const name = document.getElementById("newTopicName").value;
    const statusEl = document.getElementById("topicModalStatus");
    if(!name.trim()){ setStatus(statusEl,"err","Type a topic name first."); return; }
    const added = addCustomTopic(subject, name);
    if(!added){ setStatus(statusEl,"err",`"${name.trim()}" already exists under ${subject}.`); return; }
    updateQuestionSubjectAndTopic(paperId, qid, subject, name.trim());
    closeModal();
    render();
    toast("New topic added & assigned");
  });
}

/* ================= Subject reassignment modal ================= */
function openSubjectEditor(paperId, qid, currentSubject){
  renderSubjectModal(paperId, qid, currentSubject, "");
}
function renderSubjectModal(paperId, qid, currentSubject, searchTerm){
  const subjects = getAllSubjects().sort((a,b)=>a.localeCompare(b));
  const term = searchTerm.trim().toLowerCase();
  const filtered = term ? subjects.filter(s=>s.toLowerCase().includes(term)) : subjects;

  let listHtml = filtered.map(s=>{
    const isSel = s===currentSubject;
    return `<button type="button" class="taxo-item ${isSel?"selected":""}" data-subject="${escapeHtml(s)}">${escapeHtml(s)}${isSel?" ✓":""}</button>`;
  }).join("");
  if(!listHtml){
    listHtml = `<div class="empty" style="padding:20px 6px;">No subjects match "${escapeHtml(searchTerm)}".</div>`;
  }

  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Reassign subject</h3>
      <input class="search" id="subjectSearch" placeholder="Search subjects…" value="${escapeHtml(searchTerm)}">
      <div id="subjectList" style="max-height:42vh;overflow-y:auto;margin:10px 0;">${listHtml}</div>
      <div class="divider">— or add a new subject —</div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
        <div style="flex:1;">
          <label>New subject name</label>
          <input type="text" id="newSubjectName" placeholder="e.g. Environmental Science">
        </div>
        <button class="iconbtn primary" id="addSubjectBtn">Add</button>
      </div>
      <div id="subjectModalStatus"></div>
      <div class="row-btns"><button class="iconbtn" id="closeSubjectModal" style="width:100%;justify-content:center;">Close</button></div>
    </div>
  </div>`;

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeSubjectModal").addEventListener("click", closeModal);
  document.getElementById("subjectSearch").addEventListener("input", (e)=>{
    const pos = e.target.selectionStart;
    renderSubjectModal(paperId, qid, currentSubject, e.target.value);
    const nb = document.getElementById("subjectSearch");
    if(nb){ nb.focus(); nb.setSelectionRange(pos,pos); }
  });
  document.querySelectorAll(".taxo-item").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      updateQuestionSubject(paperId, qid, btn.dataset.subject);
      closeModal();
      render();
      toast("Subject updated");
    });
  });
  document.getElementById("addSubjectBtn").addEventListener("click", ()=>{
    const name = document.getElementById("newSubjectName").value;
    const statusEl = document.getElementById("subjectModalStatus");
    if(!name.trim()){ setStatus(statusEl,"err","Type a subject name first."); return; }
    const added = addCustomSubject(name);
    if(!added){ setStatus(statusEl,"err",`"${name.trim()}" already exists.`); return; }
    updateQuestionSubject(paperId, qid, name.trim());
    closeModal();
    render();
    toast("New subject added & assigned");
  });
}

function updateQuestionSubjectAndTopic(paperId, qid, subject, topic){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  q.subject = subject; q.topic = topic;
  saveData(DATA);
}
function updateQuestionSubject(paperId, qid, subject){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  q.subject = subject;
  const topics = getTopicsForSubject(subject);
  if(!topics.includes(q.topic)) q.topic = FALLBACK_TOPIC;
  saveData(DATA);
}

/* ================= Rename modals (paper / post name / subject / topic) ================= */
function openRenamePaperModal(paperId, currentName){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Rename paper</h3>
      <div class="field"><label>Paper name</label><input type="text" id="renameInput" value="${escapeHtml(currentName)}"></div>
      <div id="renameStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelRename" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmRename" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelRename").addEventListener("click", closeModal);
  const input = document.getElementById("renameInput");
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  document.getElementById("confirmRename").addEventListener("click", ()=>{
    const val = input.value.trim();
    const statusEl = document.getElementById("renameStatus");
    if(!val){ setStatus(statusEl,"err","Name can't be empty."); return; }
    const paper = DATA.papers.find(p=>p.id===paperId);
    if(paper){ paper.name = val; saveData(DATA); }
    closeModal(); render(); toast("Paper renamed");
  });
}
function openEditPostNameModal(paperId, currentPostName){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Edit post name</h3>
      <div class="field"><label>Post / exam name</label><input type="text" id="postNameInput" value="${escapeHtml(currentPostName||"")}" placeholder="e.g. Secretariat Assistant"></div>
      <div class="meta" style="margin-bottom:6px;">Shown on every question from this paper, across all listings. Leave blank to remove it.</div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelPostName" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmPostName" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelPostName").addEventListener("click", closeModal);
  const input = document.getElementById("postNameInput");
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  document.getElementById("confirmPostName").addEventListener("click", ()=>{
    const paper = DATA.papers.find(p=>p.id===paperId);
    if(paper){ paper.post_name = input.value.trim(); saveData(DATA); }
    closeModal(); render(); toast("Post name updated");
  });
}
function openRenameSubjectModal(oldName){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Rename subject</h3>
      <div class="field"><label>Subject name</label><input type="text" id="renameSubjectInput" value="${escapeHtml(oldName)}"></div>
      <div class="meta" style="margin-bottom:6px;">This updates every question currently tagged "${escapeHtml(oldName)}". If the new name matches an existing subject, they'll be merged.</div>
      <div id="renameSubjectStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelRenameSubject" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmRenameSubject" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelRenameSubject").addEventListener("click", closeModal);
  const input = document.getElementById("renameSubjectInput");
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  document.getElementById("confirmRenameSubject").addEventListener("click", ()=>{
    const val = input.value;
    const statusEl = document.getElementById("renameSubjectStatus");
    const result = renameSubjectEverywhere(oldName, val);
    if(!result){ setStatus(statusEl,"err","Type a different, non-empty name."); return; }
    closeModal();
    toast(`Renamed to "${result.targetName}" — updated ${result.count} question${result.count===1?"":"s"}`);
    popScreen();
  });
}
function openRenameTopicModal(subject, oldTopic){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Rename topic</h3>
      <div class="meta" style="margin-bottom:10px;">Under ${escapeHtml(subject)}</div>
      <div class="field"><label>Topic name</label><input type="text" id="renameTopicInput" value="${escapeHtml(oldTopic)}"></div>
      <div class="meta" style="margin-bottom:6px;">This updates every question currently tagged "${escapeHtml(oldTopic)}" under this subject. If the new name matches an existing topic here, they'll be merged.</div>
      <div id="renameTopicStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelRenameTopic" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmRenameTopic" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelRenameTopic").addEventListener("click", closeModal);
  const input = document.getElementById("renameTopicInput");
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  document.getElementById("confirmRenameTopic").addEventListener("click", ()=>{
    const val = input.value;
    const statusEl = document.getElementById("renameTopicStatus");
    const result = renameTopicEverywhere(subject, oldTopic, val);
    if(!result){ setStatus(statusEl,"err","Type a different, non-empty name."); return; }
    if(result.error){ setStatus(statusEl,"err",result.error); return; }
    closeModal();
    toast(`Renamed to "${result.targetTopic}" — updated ${result.count} question${result.count===1?"":"s"}`);
    popScreen();
  });
}

/* ================= Add paper modal ================= */
function openAddModal(){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Add question paper</h3>
      <div class="meta" style="margin-bottom:10px;">Will be added to your current syllabus: <strong>${escapeHtml(getSyllabusById(getCurrentSyllabusId()).name)}</strong>.</div>
      <div class="field">
        <label>Upload a JSON file</label>
        <label class="filebtn" for="fileInput">Tap to choose a .json file</label>
        <input type="file" id="fileInput" accept="application/json,.json" style="display:none">
      </div>
      <div class="divider">— or paste JSON below —</div>
      <div class="field">
        <label>Paste paper JSON</label>
        <textarea id="pasteArea" placeholder='{"paper":{"id":"...","name":"..."},"questions":[...]}'></textarea>
      </div>
      <details class="tips">
        <summary>Common JSON errors & how to fix them</summary>
        <ul>
          <li><strong>Trailing comma</strong> — a comma right before a <code>}</code> or <code>]</code>. Remove it, or tap "Try auto-fix" below.</li>
          <li><strong>Smart/curly quotes</strong> — AI chat apps often turn <code>"</code> into <code>“ ”</code>. These break JSON; auto-fix converts them back.</li>
          <li><strong>Code fences</strong> — if the AI wrapped the output in triple backticks (json ... ), remove those lines (auto-fix strips them too).</li>
          <li><strong>Math symbols with backslashes</strong> — LaTeX-style notation like <code>\\div</code> or <code>\\times</code> breaks JSON, since backslash is a special character. Auto-fix escapes stray backslashes, but it's more reliable to ask the AI for plain symbols (÷ × √ ±) instead of LaTeX commands.</li>
          <li><strong>Truncated output</strong> — if the paper is long, the AI may cut off mid-way. Check that the text ends with <code>]}</code>. If not, ask the AI to continue from where it stopped, or regenerate in smaller batches.</li>
          <li><strong>Unescaped quotes inside question text</strong> — a stray <code>"</code> inside a question or option breaks the surrounding string. Ask the AI to escape internal quotes as <code>\\"</code>, or edit manually.</li>
          <li><strong>Missing comma between questions</strong> — every object in the "questions" array needs a comma after its closing <code>}</code>, except the last one.</li>
        </ul>
      </details>
      <div id="addStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelAdd">Cancel</button>
        <button class="iconbtn primary" id="confirmAdd">Add paper</button>
      </div>
    </div>
  </div>`;

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelAdd").addEventListener("click", closeModal);
  document.getElementById("fileInput").addEventListener("change", (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById("pasteArea").value = reader.result; };
    reader.readAsText(file);
  });
  document.getElementById("confirmAdd").addEventListener("click", ()=> attemptAddPaper());
}

function attemptAddPaper(){
  const textarea = document.getElementById("pasteArea");
  const raw = textarea.value.trim();
  const statusEl = document.getElementById("addStatus");
  if(!raw){ setStatus(statusEl,"err","Paste or upload a JSON file first."); return; }

  let parsed;
  try{ parsed = JSON.parse(raw); }
  catch(e){ renderJsonErrorHelp(statusEl, raw, e, "pasteArea"); return; }

  const errs = validatePaperJson(parsed);
  if(errs.length){ setStatus(statusEl,"err","Problems found:\n"+errs.join("\n")); return; }

  const existingIdx = DATA.papers.findIndex(p=>p.id===parsed.paper.id);
  const carriedPostName = existingIdx>=0 ? (DATA.papers[existingIdx].post_name||"") : "";
  const carriedSyllabus = existingIdx>=0 ? (DATA.papers[existingIdx].syllabus_id||"default") : getCurrentSyllabusId();
  const paperObj = {
    id: parsed.paper.id,
    name: parsed.paper.name,
    post_name: (parsed.paper.post_name && String(parsed.paper.post_name).trim()) || carriedPostName,
    syllabus_id: carriedSyllabus,
    questions: parsed.questions
  };
  if(existingIdx>=0){ DATA.papers[existingIdx] = paperObj; }
  else{ DATA.papers.push(paperObj); }
  saveData(DATA);
  closeModal();
  resetToTab("papers");
  toast(existingIdx>=0 ? "Paper updated" : "Paper added");
}

function validatePaperJson(parsed){
  const errs = [];
  if(!parsed.paper || typeof parsed.paper !== "object") errs.push("- Missing \"paper\" object");
  else{
    if(!parsed.paper.id) errs.push("- Missing paper.id");
    if(!parsed.paper.name) errs.push("- Missing paper.name");
  }
  if(!Array.isArray(parsed.questions)) errs.push("- Missing \"questions\" array");
  else{
    parsed.questions.forEach((q,i)=>{
      if(!q.id) errs.push(`- Question ${i+1}: missing id`);
      if(!q.question_text) errs.push(`- Question ${i+1}: missing question_text`);
      if(!Array.isArray(q.options)) errs.push(`- Question ${i+1}: missing options array`);
      if(!q.subject) errs.push(`- Question ${i+1}: missing subject`);
    });
  }
  return errs;
}
function setStatus(el, kind, msg){
  el.innerHTML = `<div class="status ${kind}">${escapeHtml(msg)}</div>`;
}

/* ---- JSON diagnostics & auto-fix (reused by Add-paper, Bank-import, Answer-key, Explanations modals) ---- */
function renderJsonErrorHelp(statusEl, raw, err, textareaId){
  const diag = diagnoseJsonError(raw, err);
  let html = `<div class="status err">That's not valid JSON: ${escapeHtml(err.message)}</div>`;
  if(diag.snippet){
    html += `<div class="status err" style="font-family:monospace;white-space:pre-wrap;margin-top:8px;">${escapeHtml(diag.snippet)}</div>`;
  }
  statusEl.innerHTML = html;
  const fixBtn = document.createElement("button");
  fixBtn.className = "iconbtn primary";
  fixBtn.style.width = "100%"; fixBtn.style.justifyContent = "center"; fixBtn.style.marginTop = "10px";
  fixBtn.textContent = "Try auto-fix";
  fixBtn.addEventListener("click", ()=> runAutoFix(statusEl, textareaId));
  statusEl.appendChild(fixBtn);
}
function runAutoFix(statusEl, textareaId){
  const textarea = document.getElementById(textareaId);
  const { fixed, notes } = tryAutoFix(textarea.value);
  textarea.value = fixed;
  try{
    JSON.parse(fixed);
    setStatus(statusEl, "ok",
      (notes.length ? "Fixed: " + notes.join("; ") + ". " : "") +
      "The JSON now parses — review it below, then tap the action button again.");
  }catch(e2){
    let html = `<div class="status err">${notes.length ? "Applied: " + notes.join("; ") + ", but it's still not valid.\n\n" : "Couldn't automatically fix this one.\n\n"}${escapeHtml(e2.message)}</div>`;
    const diag = diagnoseJsonError(fixed, e2);
    if(diag.snippet){
      html += `<div class="status err" style="font-family:monospace;white-space:pre-wrap;margin-top:8px;">${escapeHtml(diag.snippet)}</div>`;
    }
    statusEl.innerHTML = html;
  }
}
function diagnoseJsonError(raw, err){
  const msg = err.message || String(err);
  const posMatch = msg.match(/position (\d+)/i);
  let snippet = "";
  if(posMatch){
    const position = parseInt(posMatch[1], 10);
    const start = Math.max(0, position - 50);
    const end = Math.min(raw.length, position + 50);
    const before = raw.slice(start, position).replace(/\n/g, "⏎");
    const after = raw.slice(position, end).replace(/\n/g, "⏎");
    snippet = `Near: …${before} ▶HERE◀ ${after}…`;
  }
  return { snippet };
}
function tryAutoFix(raw){
  let fixed = raw.trim();
  const notes = [];
  const fenceMatch = fixed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if(fenceMatch){ fixed = fenceMatch[1]; notes.push("removed markdown code fences"); }
  if(fixed.charCodeAt(0) === 0xFEFF){ fixed = fixed.slice(1); notes.push("removed a byte-order mark"); }
  const smartMap = { "\u201c":'"', "\u201d":'"', "\u2018":"'", "\u2019":"'", "\u2013":"-", "\u2014":"-" };
  let sawSmart = false;
  fixed = fixed.replace(/[\u201c\u201d\u2018\u2019\u2013\u2014]/g, ch=>{ sawSmart = true; return smartMap[ch]; });
  if(sawSmart) notes.push("converted smart quotes/dashes to plain ASCII");
  const beforeTrailing = fixed;
  fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
  if(fixed !== beforeTrailing) notes.push("removed trailing commas");
  // Escape stray backslashes that aren't part of a valid JSON escape sequence
  // (common with AI-generated LaTeX-style math like \div, \times, \sqrt)
  const beforeBackslash = fixed;
  fixed = fixed.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
  if(fixed !== beforeBackslash) notes.push("escaped stray backslashes (e.g. from math notation like \\div)");
  return { fixed, notes };
}

/* ================= Add answer key modal ================= */
function openAddAnswerKeyModal(paperId){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Add answer key</h3>
      <div class="field">
        <label>Upload a JSON file</label>
        <label class="filebtn" for="keyFileInput">Tap to choose a .json file</label>
        <input type="file" id="keyFileInput" accept="application/json,.json" style="display:none">
      </div>
      <div class="divider">— or paste JSON below —</div>
      <div class="field">
        <label>Paste answer key JSON</label>
        <textarea id="keyPasteArea" placeholder='{"answers":[{"question_number":1,"correct_option":"C"}, ...]}'></textarea>
      </div>
      <div class="meta" style="margin-bottom:6px;">Matches each answer to a question by its original paper question number. Use "X" or "DELETED" for questions the PSC deleted.</div>
      <div id="keyStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelKey" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmKey" style="flex:1;justify-content:center;">Apply answer key</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelKey").addEventListener("click", ()=>{ closeModal(); render(); });
  document.getElementById("keyFileInput").addEventListener("change", (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById("keyPasteArea").value = reader.result; };
    reader.readAsText(file);
  });
  document.getElementById("confirmKey").addEventListener("click", ()=>{
    const raw = document.getElementById("keyPasteArea").value.trim();
    const statusEl = document.getElementById("keyStatus");
    if(!raw){ setStatus(statusEl,"err","Paste or upload a JSON file first."); return; }
    let parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ renderJsonErrorHelp(statusEl, raw, e, "keyPasteArea"); return; }
    if(!Array.isArray(parsed.answers)){ setStatus(statusEl,"err",'Missing "answers" array.'); return; }
    if(parsed.paper_id && parsed.paper_id !== paperId){
      if(!confirm(`This answer key says paper_id "${parsed.paper_id}", but you're applying it to a different paper. Continue anyway?`)) return;
    }
    const result = applyAnswerKey(paperId, parsed);
    if(!result){ setStatus(statusEl,"err","Couldn't find that paper."); return; }
    let msg = `Applied ${result.applied} of ${result.total} answer(s).`;
    if(result.unmatched.length) msg += ` ${result.unmatched.length} question number(s) not found in this paper: ${result.unmatched.slice(0,12).join(", ")}${result.unmatched.length>12?"…":""}.`;
    if(result.unrecognized.length) msg += ` ${result.unrecognized.length} unrecognized value(s): ${result.unrecognized.slice(0,12).join(", ")}${result.unrecognized.length>12?"…":""}.`;
    setStatus(statusEl, (result.unmatched.length||result.unrecognized.length) ? "err" : "ok", msg);
    if(result.applied>0){ toast(`Answer key applied: ${result.applied} question(s) updated`); render(); }
  });
}
function applyAnswerKey(paperId, parsed){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return null;
  const byNumber = {};
  (paper.questions||[]).forEach(q=>{
    const num = questionOriginalNumber(q);
    if(num !== null) byNumber[num] = q;
  });
  let applied = 0;
  const unmatched = [];
  const unrecognized = [];
  (parsed.answers||[]).forEach(a=>{
    const num = String(a.question_number).trim();
    const q = byNumber[num];
    if(!q){ unmatched.push(num); return; }
    const raw = String(a.correct_option||"").trim().toUpperCase();
    let idx = null;
    if(["A","B","C","D"].includes(raw)) idx = ["A","B","C","D"].indexOf(raw);
    else if(raw === "X" || raw === "DELETED" || raw === "DEL") idx = DELETED_SENTINEL;
    if(idx === null){ unrecognized.push(`${num}:${a.correct_option}`); return; }
    q.correct_answer_index = idx;
    applied++;
  });
  saveData(DATA);
  return { applied, unmatched, unrecognized, total: (parsed.answers||[]).length };
}

/* ================= Add explanations modal (bulk, for an already-added paper) ================= */
function openAddExplanationsModal(paperId){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Add explanations</h3>
      <div class="field">
        <label>Upload a JSON file</label>
        <label class="filebtn" for="explFileInput">Tap to choose a .json file</label>
        <input type="file" id="explFileInput" accept="application/json,.json" style="display:none">
      </div>
      <div class="divider">— or paste JSON below —</div>
      <div class="field">
        <label>Paste explanations JSON</label>
        <textarea id="explPasteArea" placeholder='{"explanations":[{"question_number":1,"explanation":"..."}, ...]}'></textarea>
      </div>
      <div class="meta" style="margin-bottom:6px;">Matches each explanation to a question by its original paper question number, same as an answer key. This overwrites any existing explanation on a matched question.</div>
      <div id="explStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelExpl" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmExpl" style="flex:1;justify-content:center;">Apply explanations</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelExpl").addEventListener("click", ()=>{ closeModal(); render(); });
  document.getElementById("explFileInput").addEventListener("change", (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById("explPasteArea").value = reader.result; };
    reader.readAsText(file);
  });
  document.getElementById("confirmExpl").addEventListener("click", ()=>{
    const raw = document.getElementById("explPasteArea").value.trim();
    const statusEl = document.getElementById("explStatus");
    if(!raw){ setStatus(statusEl,"err","Paste or upload a JSON file first."); return; }
    let parsed;
    try{ parsed = JSON.parse(raw); }
    catch(e){ renderJsonErrorHelp(statusEl, raw, e, "explPasteArea"); return; }
    if(!Array.isArray(parsed.explanations)){ setStatus(statusEl,"err",'Missing "explanations" array.'); return; }
    const result = applyExplanations(paperId, parsed);
    if(!result){ setStatus(statusEl,"err","Couldn't find that paper."); return; }
    let msg = `Applied ${result.applied} of ${result.total} explanation(s).`;
    if(result.unmatched.length) msg += ` ${result.unmatched.length} question number(s) not found: ${result.unmatched.slice(0,12).join(", ")}${result.unmatched.length>12?"…":""}.`;
    setStatus(statusEl, result.unmatched.length ? "err" : "ok", msg);
    if(result.applied>0){ toast(`Explanations applied: ${result.applied} question(s) updated`); render(); }
  });
}
function applyExplanations(paperId, parsed){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return null;
  const byNumber = {};
  (paper.questions||[]).forEach(q=>{
    const num = questionOriginalNumber(q);
    if(num !== null) byNumber[num] = q;
  });
  let applied = 0;
  const unmatched = [];
  (parsed.explanations||[]).forEach(e=>{
    const num = String(e.question_number).trim();
    const q = byNumber[num];
    if(!q){ unmatched.push(num); return; }
    q.explanation = String(e.explanation||"").trim();
    applied++;
  });
  saveData(DATA);
  return { applied, unmatched, total: (parsed.explanations||[]).length };
}

/* ================= Data (export/import) modal ================= */
function openDataModal(){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Backup & restore</h3>
      <div class="field">
        <label>Export everything in this app to a file</label>
        <button class="iconbtn primary" id="exportBtn" style="width:100%;justify-content:center;">Export full backup (.json)</button>
      </div>
      <div class="divider">— or restore from a backup —</div>
      <div class="field">
        <label>Import a backup file</label>
        <label class="filebtn" for="restoreInput">Tap to choose a backup .json file (also works with a PSC Question Vault or Prep Vault export)</label>
        <input type="file" id="restoreInput" accept="application/json,.json" style="display:none">
      </div>
      <div id="importOptions" style="display:none;">
        <div class="field">
          <label>How should this be applied?</label>
          <select id="importMode">
            <option value="merge">Merge with existing papers (same-ID papers get overwritten)</option>
            <option value="replace">Replace all papers with this backup</option>
          </select>
        </div>
        <div class="field">
          <label>Import papers into which syllabus?</label>
          <select id="importSyllabus">
            ${DATA.syllabuses.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")}
          </select>
          <div class="meta">Only used for papers that don't already specify a syllabus.</div>
        </div>
        <button class="iconbtn primary" id="applyImport" style="width:100%;justify-content:center;">Apply</button>
      </div>
      <div id="dataStatus"></div>
      <div class="row-btns">
        <button class="iconbtn" id="closeData" style="width:100%;justify-content:center;">Close</button>
      </div>
    </div>
  </div>`;

  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeData").addEventListener("click", closeModal);
  document.getElementById("exportBtn").addEventListener("click", exportBackup);

  let pendingImportData = null;
  document.getElementById("restoreInput").addEventListener("change", (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    const statusEl = document.getElementById("dataStatus");
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        if(!Array.isArray(parsed.papers)) throw new Error('Backup file must contain a "papers" array');
        pendingImportData = parsed;
        document.getElementById("importOptions").style.display = "block";
        const attemptNote = Array.isArray(parsed.attempts) ? `, ${parsed.attempts.length} attempt(s)` : "";
        setStatus(statusEl, "ok", `Loaded backup with ${parsed.papers.length} paper(s)${attemptNote}. Choose how to apply it below.`);
      }catch(err){
        setStatus(statusEl, "err", "Couldn't read that file: "+err.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("applyImport").addEventListener("click", ()=>{
    if(!pendingImportData) return;
    const mode = document.getElementById("importMode").value;
    const fallbackSyllabus = document.getElementById("importSyllabus").value;
    const importedAttempts = Array.isArray(pendingImportData.attempts) ? pendingImportData.attempts : null;
    const importedPapers = pendingImportData.papers.map(p=> Object.assign({}, p, { syllabus_id: p.syllabus_id || fallbackSyllabus }));

    if(mode==="replace"){
      DATA = {
        papers: importedPapers,
        attempts: importedAttempts !== null ? importedAttempts : (DATA.attempts||[]),
        banks: Array.isArray(pendingImportData.banks) ? pendingImportData.banks : (DATA.banks||[]),
        syllabuses: Array.isArray(pendingImportData.syllabuses) && pendingImportData.syllabuses.length ? pendingImportData.syllabuses : DATA.syllabuses,
        paperTemplates: Array.isArray(pendingImportData.paperTemplates) ? pendingImportData.paperTemplates : (DATA.paperTemplates||[])
      };
    } else {
      const byId = {};
      DATA.papers.forEach(p=>byId[p.id]=p);
      importedPapers.forEach(p=>byId[p.id]=p);

      let attempts = DATA.attempts||[];
      if(importedAttempts !== null){
        const byAttemptId = {};
        attempts.forEach(a=>byAttemptId[a.id]=a);
        importedAttempts.forEach(a=>byAttemptId[a.id]=a);
        attempts = Object.values(byAttemptId);
      }
      DATA = { papers: Object.values(byId), attempts, banks: DATA.banks||[], syllabuses: DATA.syllabuses, paperTemplates: DATA.paperTemplates||[] };
    }
    DATA = loadDataFromObject(DATA);
    saveData(DATA);
    closeModal();
    resetToTab("papers");
    toast("Data imported");
  });
}
function loadDataFromObject(parsed){
  if(!Array.isArray(parsed.papers)) parsed.papers = [];
  if(!Array.isArray(parsed.attempts)) parsed.attempts = [];
  if(!Array.isArray(parsed.banks)) parsed.banks = [];
  if(!Array.isArray(parsed.paperTemplates)) parsed.paperTemplates = [];
  if(!parsed.studyProgress || typeof parsed.studyProgress !== "object") parsed.studyProgress = {};
  if(!Array.isArray(parsed.syllabuses) || parsed.syllabuses.length===0){
    parsed.syllabuses = [{ id:"default", name:"Default", marking: Object.assign({}, DEFAULT_MARKING) }];
  }
  parsed.syllabuses.forEach(s=>{ if(!s.marking) s.marking = Object.assign({}, DEFAULT_MARKING); });
  const syllabusIds = new Set(parsed.syllabuses.map(s=>s.id));
  parsed.papers.forEach(p=>{
    if(!p.syllabus_id) p.syllabus_id = "default";
    if(!syllabusIds.has(p.syllabus_id)){
      parsed.syllabuses.push({ id:p.syllabus_id, name:p.syllabus_id, marking: Object.assign({}, DEFAULT_MARKING) });
      syllabusIds.add(p.syllabus_id);
    }
  });
  parsed.attempts.forEach(a=>{ if(!a.syllabus_id) a.syllabus_id = "default"; });
  return parsed;
}

function exportBackup(){
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `psc-exam-vault-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}

function closeModal(){ modalRoot.innerHTML = ""; }

/* ================= Init ================= */
updateViewModeBtn();
updateSyllabusBtnLabel();
render();

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
