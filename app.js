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
  if(!Array.isArray(parsed.topicLists)) parsed.topicLists = [];
  if(!parsed.topicLabels || typeof parsed.topicLabels !== "object") parsed.topicLabels = {};
  if(!parsed.listingNotes || typeof parsed.listingNotes !== "object") parsed.listingNotes = {};
  if(!parsed.studyProgress || typeof parsed.studyProgress !== "object") parsed.studyProgress = {};
  migrateStudyProgress(parsed.studyProgress);
  if(!parsed.dailyActivity || typeof parsed.dailyActivity !== "object") parsed.dailyActivity = {};
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
function migrateStudyProgress(sp){
  // Legacy schema stored a plain number per key; upgrade to {count, lastStudiedAt, nextReviewAt}
  Object.keys(sp).forEach(k=>{
    if(typeof sp[k] === "number"){
      const count = sp[k];
      sp[k] = { count, lastStudiedAt: null, nextReviewAt: null };
    }
  });
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

/* ---- Study-progress tracker with spaced repetition (per syllabus, per subject+topic) ---- */
const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 14, 30, 60];
function studyProgressKey(subject, topic){
  return `${getCurrentSyllabusId()}::${subject}|||${topic}`;
}
function getStudyInfo(subject, topic){
  const raw = DATA.studyProgress && DATA.studyProgress[studyProgressKey(subject,topic)];
  const info = raw ? Object.assign({count:0,lastStudiedAt:null,nextReviewAt:null}, raw) : {count:0,lastStudiedAt:null,nextReviewAt:null};
  info.isDue = info.nextReviewAt !== null && Date.now() >= info.nextReviewAt;
  return info;
}
function getStudyCount(subject, topic){ return getStudyInfo(subject, topic).count; }
function incrementStudyCount(subject, topic){
  if(!DATA.studyProgress) DATA.studyProgress = {};
  const k = studyProgressKey(subject,topic);
  const cur = DATA.studyProgress[k] || {count:0,lastStudiedAt:null,nextReviewAt:null};
  cur.count = (cur.count||0) + 1;
  cur.lastStudiedAt = Date.now();
  const interval = REVIEW_INTERVALS_DAYS[Math.min(cur.count-1, REVIEW_INTERVALS_DAYS.length-1)];
  cur.nextReviewAt = cur.lastStudiedAt + interval*86400000;
  DATA.studyProgress[k] = cur;
  saveData(DATA);
  recordActivity();
}
function decrementStudyCount(subject, topic){
  if(!DATA.studyProgress) DATA.studyProgress = {};
  const k = studyProgressKey(subject,topic);
  const cur = DATA.studyProgress[k] || {count:0,lastStudiedAt:null,nextReviewAt:null};
  cur.count = Math.max(0, (cur.count||0) - 1);
  if(cur.count===0){
    cur.lastStudiedAt = null; cur.nextReviewAt = null;
  } else if(cur.lastStudiedAt){
    const interval = REVIEW_INTERVALS_DAYS[Math.min(cur.count-1, REVIEW_INTERVALS_DAYS.length-1)];
    cur.nextReviewAt = cur.lastStudiedAt + interval*86400000;
  }
  DATA.studyProgress[k] = cur;
  saveData(DATA);
}
function dueForReviewList(){
  const cur = getCurrentSyllabusId();
  const prefix = cur + "::";
  const out = [];
  Object.keys(DATA.studyProgress||{}).forEach(k=>{
    if(!k.startsWith(prefix)) return;
    const rest = k.slice(prefix.length);
    const sep = rest.indexOf("|||");
    if(sep<0) return;
    const subject = rest.slice(0,sep), topic = rest.slice(sep+3);
    const info = getStudyInfo(subject, topic);
    if(info.isDue) out.push({ subject, topic, info });
  });
  out.sort((a,b)=> (a.info.nextReviewAt||0) - (b.info.nextReviewAt||0));
  return out;
}
function countTopicAttempts(subject, topic){
  const key = `${subject}|||${topic}`;
  const cur = getCurrentSyllabusId();
  return (DATA.attempts||[]).filter(a=> a.type==="topic" && a.scopeKey===key && a.syllabus_id===cur).length;
}

/* ---- Daily activity streak ---- */
function todayKey(){ return new Date().toISOString().slice(0,10); }
function recordActivity(){
  if(!DATA.dailyActivity) DATA.dailyActivity = {};
  const k = todayKey();
  DATA.dailyActivity[k] = (DATA.dailyActivity[k]||0) + 1;
  saveData(DATA);
}
function computeStreak(){
  if(!DATA.dailyActivity) return { streak:0, today:0 };
  let streak = 0;
  const d = new Date();
  for(;;){
    const k = d.toISOString().slice(0,10);
    if((DATA.dailyActivity[k]||0) > 0){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return { streak, today: DATA.dailyActivity[todayKey()]||0 };
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

function getAllSubjects(){
  // Union of the curated taxonomy AND whatever subject strings actually
  // exist on real questions (e.g. from a JSON import) — a subject can end
  // up on a question without ever going through addCustomSubject, and it
  // must still be selectable/findable everywhere, or renaming/reassigning
  // can silently "lose" it.
  const set = new Set(Object.keys(TAXONOMY_STATE));
  allQuestions().forEach(q=>{ if(q.subject) set.add(q.subject); });
  return Array.from(set);
}
function getTopicsForSubject(subject){
  const set = new Set(TAXONOMY_STATE[subject] || [FALLBACK_TOPIC]);
  allQuestions().forEach(q=>{ if(q.subject===subject && q.topic) set.add(q.topic); });
  set.add(FALLBACK_TOPIC);
  return Array.from(set);
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

/* ================= Difficulty marking ================= */
const DIFFICULTY_ENABLED_KEY = "psev_difficulty_enabled";
const DIFFICULTY_POINTS = { E:3, M:6, D:9 };
const DIFFICULTY_LABELS = { E:"Easy", M:"Medium", D:"Difficult" };
function isDifficultyMarkingEnabled(){ return localStorage.getItem(DIFFICULTY_ENABLED_KEY) !== "0"; }
function setDifficultyMarkingEnabled(v){ localStorage.setItem(DIFFICULTY_ENABLED_KEY, v ? "1" : "0"); }
function setDifficulty(paperId, qid, level){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return null;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return null;
  q.difficulty = (q.difficulty===level) ? undefined : level;
  q.difficulty_manual = true;      // a manual choice (even clearing) always beats auto-marking
  delete q.difficulty_auto;
  saveData(DATA);
  return q.difficulty;
}
/* Auto-difficulty from time taken: >50s = Difficult, 26-50s = Medium, <26s = Easy.
   Only applied to answered questions that have no difficulty yet and were never set by hand. */
function autoDifficultyFromMs(ms){
  const sec = ms/1000;
  return sec>50 ? "D" : sec>=26 ? "M" : "E";
}
function maybeAutoDifficulty(screen, q){
  if(!q || !isDifficultyMarkingEnabled()) return;
  const key = `${q._paperId}::${q.id}`;
  if(!screen.answers || screen.answers[key]===undefined) return;
  const ms = (screen.timeSpent||{})[key];
  if(!ms || ms<=0) return;
  const real = aiFindQuestionSafe(q._paperId, q.id);
  if(!real || real.difficulty || real.difficulty_manual) return;
  real.difficulty = autoDifficultyFromMs(ms);
  real.difficulty_auto = true;
  saveData(DATA);
}
function aiFindQuestionSafe(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  return paper ? (paper.questions||[]).find(x=>String(x.id)===String(qid)) : null;
}
function diffSuffix(questions){
  if(!isDifficultyMarkingEnabled()) return "";
  const a = avgDifficulty(questions);
  return a ? ` · avg diff ${a.avg}/9` : "";
}
function avgDifficulty(questions){
  const marked = questions.filter(q=>q.difficulty && DIFFICULTY_POINTS[q.difficulty]);
  if(marked.length===0) return null;
  const sum = marked.reduce((s,q)=> s+DIFFICULTY_POINTS[q.difficulty], 0);
  return { avg: Math.round((sum/marked.length)*10)/10, count: marked.length, total: questions.length };
}

/* ================= Notes ================= */
function setNote(paperId, qid, text){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  q.note = text.trim();
  saveData(DATA);
}
function collectNotedQuestions(){
  return allQuestions().filter(q=>q.note && q.note.trim());
}

/* ================= Generic question-list sort (item 4: difficulty; item 3: time) ================= */
const DIFFICULTY_ORDER = { E:1, M:2, D:3 };
function sortQuestions(questions, sortMode, timeByKey){
  if(!sortMode || sortMode==="none") return questions;
  const arr = questions.slice();
  const diffRank = q => q.difficulty ? DIFFICULTY_ORDER[q.difficulty] : 0;
  const timeOf = q => (timeByKey && timeByKey[`${q._paperId}::${q.id}`]) || 0;
  if(sortMode==="diff-asc") arr.sort((a,b)=> diffRank(a)-diffRank(b));
  else if(sortMode==="diff-desc") arr.sort((a,b)=> diffRank(b)-diffRank(a));
  else if(sortMode==="time-asc") arr.sort((a,b)=> timeOf(a)-timeOf(b));
  else if(sortMode==="time-desc") arr.sort((a,b)=> timeOf(b)-timeOf(a));
  return arr;
}
function sortControlHtml(currentSort, includeTime){
  const opts = [
    ["none","Original order"],
    ["diff-asc","Difficulty: Easy → Hard"],
    ["diff-desc","Difficulty: Hard → Easy"]
  ];
  if(includeTime){
    opts.push(["time-desc","Time: Slowest first"], ["time-asc","Time: Fastest first"]);
  }
  return `<select id="qSortSelect" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:var(--ink-bg-raised);color:var(--text-on-ink);margin:8px 0;">
    ${opts.map(([v,l])=>`<option value="${v}" ${currentSort===v?"selected":""}>${l}</option>`).join("")}
  </select>`;
}

/* ================= Topic lists (priority collections) ================= */
function findTopicList(id){ return (DATA.topicLists||[]).find(l=>l.id===id); }
function addTopicToList(listId, subject, topic){
  const list = findTopicList(listId);
  if(!list) return;
  if(!list.items.some(it=>it.subject===subject && it.topic===topic)){
    list.items.push({ subject, topic });
    saveData(DATA);
  }
}
function removeTopicFromList(listId, subject, topic){
  const list = findTopicList(listId);
  if(!list) return;
  list.items = list.items.filter(it=> !(it.subject===subject && it.topic===topic));
  saveData(DATA);
}

/* ================= Topic labels (color-coded) ================= */
const TOPIC_LABEL_PALETTE = [
  { name:"Red", color:"#b14b4b" }, { name:"Gold", color:"#c9932b" },
  { name:"Green", color:"#3e7a4f" }, { name:"Blue", color:"#3f5c8a" },
  { name:"Purple", color:"#7a4a9e" }, { name:"Teal", color:"#2f6f5e" }
];
function topicLabelKey(subject, topic){ return `${subject}|||${topic}`; }
function getTopicLabel(subject, topic){
  return (DATA.topicLabels||{})[topicLabelKey(subject,topic)] || null;
}
function setTopicLabel(subject, topic, label){
  if(!DATA.topicLabels) DATA.topicLabels = {};
  const key = topicLabelKey(subject,topic);
  if(!label){ delete DATA.topicLabels[key]; }
  else{ DATA.topicLabels[key] = label; }
  saveData(DATA);
}
function labelPillHtml(subject, topic){
  const lbl = getTopicLabel(subject, topic);
  if(!lbl) return "";
  return `<span class="pill" style="background:${lbl.color}33;color:${lbl.color};border-color:${lbl.color};">${escapeHtml(lbl.name)}</span>`;
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
/* Rich text: escapes HTML first (safe), then applies limited markdown
   (**highlight**, *italic*) and leaves $...$ / $$...$$ math delimiters
   intact for KaTeX to typeset afterwards. white-space:pre-wrap in CSS
   preserves line breaks and spacing exactly as typed/pasted. */
function renderRichText(str){
  let s = escapeHtml(str);
  s = s.replace(/\*\*(.+?)\*\*/g, '<mark class="hltext">$1</mark>');
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return s;
}
function typesetMath(container){
  if(window.renderMathInElement){
    try{
      window.renderMathInElement(container, {
        delimiters: [
          {left:"$$", right:"$$", display:true},
          {left:"$", right:"$", display:false}
        ],
        throwOnError: false
      });
    }catch(e){ /* KaTeX not ready or bad input — fail silently, plain text still shows */ }
  }
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
document.getElementById("btnSearch").addEventListener("click", openGlobalSearchModal);
document.getElementById("btnSearch").addEventListener("click", openGlobalSearchModal);

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
    case "stats-subject": renderStatsSubject(screen.subject); break;
    case "stats-all-topics": renderStatsAllTopics(); break;
    case "flagged-list": renderFlaggedList(); break;
    case "search-results": renderSearchResults(screen); break;
    case "notes": renderNotesRoot(); break;
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
  updateTopbarVisibility();
  typesetMath(mainEl);
}
const QUESTION_LIST_SCREENS = new Set(["paper-detail","subject-all","topic-detail","bank-detail","practice","attempt-review","flagged-list","search-results"]);
function updateTopbarVisibility(){
  const screen = currentScreen();
  const isRoot = navStack.length===1;
  const inActiveTest = screen.type==="practice" && !screen.submitted;
  const btnData = document.getElementById("btnData");
  const btnAdd = document.getElementById("btnAdd");
  const btnViewMode = document.getElementById("btnViewMode");
  const btnSearch = document.getElementById("btnSearch");
  const tabs = document.getElementById("tabs");
  const syllabusBar = document.querySelector(".syllabus-bar");
  if(btnData) btnData.style.display = isRoot ? "" : "none";
  if(btnAdd) btnAdd.style.display = isRoot ? "" : "none";
  if(btnSearch) btnSearch.style.display = isRoot ? "" : "none";
  if(btnViewMode) btnViewMode.style.display = (QUESTION_LIST_SCREENS.has(screen.type) && !inActiveTest) ? "" : "none";
  // While an exam is actively being taken, hide navigation that could distract
  // or lead someone away from the test (syllabus switch, tab bar).
  if(tabs) tabs.style.display = inActiveTest ? "none" : "";
  if(syllabusBar) syllabusBar.style.display = inActiveTest ? "none" : "";
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
        sub: (p.post_name ? p.post_name : p.id) + diffSuffix(p.questions||[]),
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
        sub: `${Math.max(getTopicsForSubject(s).length - 1, 0)} topics defined` + diffSuffix(visibleQuestions().filter(q=>q.subject===s)),
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

/* ---- Long-press helper (opens its action ~150ms after release so the lift-click can't hit the new modal) ---- */
function bindLongPress(selector, handler){
  document.querySelectorAll(selector).forEach(el=>{
    let timer=null, sx=0, sy=0, armed=false;
    const start=(x,y)=>{
      sx=x; sy=y; armed=false; clearTimeout(timer);
      timer=setTimeout(()=>{ timer=null; armed=true; el._lp=true; el.classList.add("lp-armed"); if(navigator.vibrate){ try{ navigator.vibrate(15); }catch(e){} } }, 480);
    };
    const cancel=()=>{ clearTimeout(timer); timer=null; armed=false; el.classList.remove("lp-armed"); };
    const release=()=>{
      clearTimeout(timer); timer=null;
      el.classList.remove("lp-armed");
      if(armed){ armed=false; setTimeout(()=>{ el._lp=false; }, 400); setTimeout(()=>handler(el), 150); }
    };
    el.addEventListener("touchstart", e=>{ const t=e.touches[0]; start(t.clientX,t.clientY); }, {passive:true});
    el.addEventListener("touchmove", e=>{ const t=e.touches[0]; if(Math.abs(t.clientX-sx)>10||Math.abs(t.clientY-sy)>10) cancel(); }, {passive:true});
    el.addEventListener("touchend", release); el.addEventListener("touchcancel", cancel);
    el.addEventListener("mousedown", e=>start(e.clientX,e.clientY));
    el.addEventListener("mouseup", release); el.addEventListener("mouseleave", cancel);
    el.addEventListener("contextmenu", e=>e.preventDefault());
    el.addEventListener("click", e=>{ if(el._lp){ e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  });
}

/* ---- Topic quick actions (long-press): add to list / add label ---- */
function openTopicActionsModal(subject, topic, removeFromListId){
  const lbl = getTopicLabel(subject, topic);
  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
    <h3>${escapeHtml(topic)}</h3>
    <div class="meta" style="margin-bottom:12px;">${escapeHtml(subject)}</div>
    <div class="ai-grid" style="grid-template-columns:1fr;">
      <button class="iconbtn" id="taList" style="justify-content:center;">📌 Add to a topic list</button>
      <button class="iconbtn" id="taLabel" style="justify-content:center;">🏷️ ${lbl?"Change label ("+escapeHtml(lbl.name)+")":"Add a label"}</button>
      ${removeFromListId ? `<button class="iconbtn bad" id="taRemove" style="justify-content:center;">✕ Remove from this list</button>` : ""}
      <button class="iconbtn" id="taOpen" style="justify-content:center;">Open topic</button>
    </div>
    <div class="row-btns"><button class="iconbtn" id="taClose" style="flex:1;justify-content:center;">Cancel</button></div>
  </div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("taClose").addEventListener("click", closeModal);
  document.getElementById("taList").addEventListener("click", ()=> openAddToListModal(subject, topic));
  document.getElementById("taLabel").addEventListener("click", ()=> openTopicLabelModal(subject, topic));
  document.getElementById("taOpen").addEventListener("click", ()=>{ closeModal(); pushScreen({ type:"topic-detail", subject, topic }); });
  const rm = document.getElementById("taRemove");
  if(rm) rm.addEventListener("click", ()=>{ removeTopicFromList(removeFromListId, subject, topic); closeModal(); render(); toast("Removed from list"); });
}
function openAddToListModal(subject, topic){
  function draw(){
    const lists = DATA.topicLists||[];
    modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
      <h3>Add to which list?</h3>
      <div class="meta" style="margin-bottom:10px;">${escapeHtml(topic)} · ${escapeHtml(subject)}</div>
      <div style="max-height:44vh;overflow-y:auto;">
      ${lists.map(l=>{ const inIt = l.items.some(it=>it.subject===subject && it.topic===topic);
        return `<button type="button" class="check-item ${inIt?"checked":""}" data-lid="${escapeHtml(l.id)}"><span style="flex:1;"><div>${escapeHtml(l.name)}</div><div class="ci-sub">${l.items.length} topic${l.items.length===1?"":"s"}</div></span><span>${inIt?"✓ Added":"+"}</span></button>`; }).join("") || `<div class="meta">No lists yet — create one below.</div>`}
      </div>
      <div class="field" style="margin-top:12px;"><input class="ai-input" id="newListName" placeholder="New list name…"><button class="iconbtn" id="newListAdd" style="width:100%;justify-content:center;margin-top:6px;">+ Create list and add</button></div>
      <div class="row-btns"><button class="iconbtn primary" id="alDone" style="flex:1;justify-content:center;">Done</button></div>
    </div></div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop"){ closeModal(); render(); } });
    document.getElementById("alDone").addEventListener("click", ()=>{ closeModal(); render(); });
    document.querySelectorAll("[data-lid]").forEach(b=> b.addEventListener("click", ()=>{
      const l = findTopicList(b.dataset.lid); if(!l) return;
      if(l.items.some(it=>it.subject===subject && it.topic===topic)) removeTopicFromList(l.id, subject, topic);
      else addTopicToList(l.id, subject, topic);
      draw();
    }));
    document.getElementById("newListAdd").addEventListener("click", ()=>{
      const name = document.getElementById("newListName").value.trim(); if(!name) return;
      const list = { id: slugify(name)+"-"+Date.now().toString(36), name, items: [] };
      DATA.topicLists.push(list); saveData(DATA);
      addTopicToList(list.id, subject, topic); draw();
    });
  }
  draw();
}

/* ---- Per-listing notes (one note per listing) ---- */
function listingInfo(screen){
  if(!screen) return null;
  switch(screen.type){
    case "paper-detail": { const p = DATA.papers.find(x=>x.id===screen.paperId); return { key:"paper:"+screen.paperId, label:"Exam: "+(p?p.name:screen.paperId), nav:{ type:"paper-detail", paperId:screen.paperId } }; }
    case "subject-topics": case "subject-all": return { key:"subject:"+screen.subject, label:"Subject: "+screen.subject, nav:{ type:"subject-topics", subject:screen.subject } };
    case "topic-detail": return { key:"topic:"+screen.subject+"|||"+screen.topic, label:"Topic: "+screen.topic+" ("+screen.subject+")", nav:{ type:"topic-detail", subject:screen.subject, topic:screen.topic } };
    case "bank-detail": { const b=(DATA.banks||[]).find(x=>x.id===screen.bankId); return { key:"bank:"+screen.bankId, label:"Bank: "+(b?b.name:screen.bankId), nav:{ type:"bank-detail", bankId:screen.bankId } }; }
    case "flagged-list": return { key:"flagged", label:"Flagged questions", nav:{ type:"flagged-list" } };
    case "topics": if(screen.topicListSort==="lists" && screen.activeListId){ const l=findTopicList(screen.activeListId); if(l) return { key:"list:"+l.id, label:"Topic list: "+l.name, nav:{ type:"topics", topicListSort:"lists", activeListId:l.id } }; } return null;
    default: return null;
  }
}
function getListingNote(key){ const n = (DATA.listingNotes||{})[key]; return n && n.text ? n : null; }
function saveListingNote(info, text){
  if(!DATA.listingNotes) DATA.listingNotes = {};
  if(!text.trim()){ delete DATA.listingNotes[info.key]; }
  else DATA.listingNotes[info.key] = { text: text.trim(), label: info.label, nav: info.nav||null, updatedAt: Date.now() };
  saveData(DATA);
}
function appendToListingNote(text){
  const info = listingInfo(currentScreen()) || { key:"misc:ai", label:"AI notes & tricks", nav:null };
  const cur = getListingNote(info.key);
  saveListingNote(info, (cur?cur.text+"\n\n":"")+text);
  return info;
}
function listingNoteBlockHtml(screen){
  const info = listingInfo(screen); if(!info) return "";
  const n = getListingNote(info.key);
  return `<div class="listing-note-wrap"><button class="iconbtn ${n?"has-note":""}" data-listing-note="1" style="width:100%;justify-content:center;">📝 My note${n?" ✓":""} for this listing</button>
    ${n?`<div class="listing-note">${renderRichText(n.text)}</div>`:""}</div>`;
}
function openListingNoteModal(info){
  const n = getListingNote(info.key);
  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
    <h3>My note</h3><div class="meta" style="margin-bottom:8px;">${escapeHtml(info.label)}</div>
    <div class="field"><textarea id="lnText" class="prose" placeholder="Anything you want to remember about this listing…" style="min-height:160px;">${escapeHtml(n?n.text:"")}</textarea></div>
    <div class="row-btns"><button class="iconbtn" id="lnCancel" style="flex:1;justify-content:center;">Cancel</button>
      <button class="iconbtn primary" id="lnSave" style="flex:1;justify-content:center;">Save</button></div>
  </div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("lnCancel").addEventListener("click", closeModal);
  const ta = document.getElementById("lnText"); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  document.getElementById("lnSave").addEventListener("click", ()=>{ saveListingNote(info, ta.value); closeModal(); render(); toast(ta.value.trim()?"Note saved":"Note removed"); });
}
document.addEventListener("click", (e)=>{
  const b = e.target.closest("[data-listing-note]"); if(!b) return;
  const info = listingInfo(currentScreen()); if(info) openListingNoteModal(info);
});

/* ================= Topics list (global within syllabus) ================= */
const TOPIC_SORTS = [["freq","Frequency"],["az","A–Z"],["studied","Studied"],["label","Label"],["lists","📌 My lists"]];
function topicRowHtml(e, idx, extraInner){
  const studied = e.studied;
  const attempts = countTopicAttempts(e.subject, e.topic);
  const bits = [e.subject];
  if(studied) bits.push(`📖 ${studied}×`);
  if(attempts) bits.push(`📝 ${attempts} test${attempts===1?"":"s"}`);
  const dsx = diffSuffix(visibleQuestions().filter(q=>q.subject===e.subject && (q.topic||FALLBACK_TOPIC)===e.topic)); if(dsx) bits.push(dsx.replace(' · ',''));
  return rowHtml({
    num: String(idx+1).padStart(2,"0"), title: e.topic, sub: bits.join(" · "), count: `${e.count} q`,
    dataAttr: `data-subject="${escapeHtml(e.subject)}" data-topic="${escapeHtml(e.topic)}" data-lp="1"`
  }).replace('<div class="row" ','<div class="row lp-target" ').replace('<div class="count">', `${labelPillHtml(e.subject,e.topic)}<div class="count">${extraInner||""}`);
}
function chipBarHtml(chips){
  return `<div class="chip-bar" id="chipBar">${chips.map(c=>`<button type="button" class="chip ${c.active?"active":""}" data-chip="${escapeHtml(c.id)}" ${c.color?`style="--chip:${c.color};"`:""}>${c.color?`<span class="chip-dot" style="background:${c.color};"></span>`:""}${escapeHtml(c.label)}${c.count!==undefined?` <span class="chip-n">${c.count}</span>`:""}</button>`).join("")}</div>`;
}
function renderTopicsList(){
  const screen = currentScreen();
  const searchTerm = getSearch();
  const sortMode = screen.topicListSort || "freq";
  const qs = visibleQuestions();
  const counts = {};
  qs.forEach(q=>{ const key = `${q.subject}|||${q.topic||FALLBACK_TOPIC}`; counts[key] = (counts[key]||0) + 1; });
  let entries = Object.entries(counts).map(([key,count])=>{
    const [subject, topic] = key.split("|||");
    const lbl = getTopicLabel(subject, topic);
    return { subject, topic, count, label: lbl ? lbl.name : null, studied: getStudyCount(subject, topic) };
  });

  let html = "";
  if(entries.length===0 && sortMode!=="lists"){
    mainEl.innerHTML = emptyState("No topics yet", "Import a question paper into this syllabus to see topics here, ranked by how often they occur.");
    return;
  }
  html += `<input class="search" id="searchBox" placeholder="Search topics…" value="${escapeHtml(searchTerm)}">`;
  html += `<div class="segmented scrolly" id="topicSortSeg">${TOPIC_SORTS.map(([k,l])=>`<button data-s="${k}" class="${sortMode===k?'active':''}">${l}</button>`).join("")}</div>`;
  const matchSearch = e=> !searchTerm || e.topic.toLowerCase().includes(searchTerm.toLowerCase()) || e.subject.toLowerCase().includes(searchTerm.toLowerCase());

  let rowsHtml = "";
  let afterBind = ()=>{};

  if(sortMode==="lists"){
    const lists = DATA.topicLists||[];
    if(!screen.activeListId || !findTopicList(screen.activeListId)) screen.activeListId = lists[0] ? lists[0].id : null;
    html += chipBarHtml(lists.map(l=>({id:l.id,label:l.name,count:l.items.length,active:l.id===screen.activeListId})).concat([{id:"__new",label:"＋ New list"}]));
    const list = findTopicList(screen.activeListId);
    if(!list){
      rowsHtml = emptyState("No topic lists yet", "Tap “＋ New list” above, or long-press any topic in the other tabs and choose “Add to a topic list”.");
    } else {
      html += `<div style="display:flex;gap:8px;margin:8px 0;">
        <button class="iconbtn" id="renameListBtn" style="flex:1;justify-content:center;">Rename</button>
        <button class="iconbtn" id="addTopicsBtn" style="flex:1;justify-content:center;">+ Add topics</button>
        <button class="iconbtn bad" id="deleteListBtn">🗑</button></div>`;
      html += listingNoteBlockHtml(screen);
      const items = list.items.map(it=>({ subject:it.subject, topic:it.topic, count:counts[`${it.subject}|||${it.topic}`]||0, studied:getStudyCount(it.subject,it.topic) })).filter(matchSearch);
      rowsHtml = items.length ? items.map((e,i)=> topicRowHtml(e,i,`<button class="actbtn danger" data-remove-item="${escapeHtml(e.subject+"|||"+e.topic)}" title="Remove from list" style="margin-right:6px;">✕</button>`)).join("") : emptyState(list.items.length?"No matches":"This list is empty", list.items.length?"":"Use “+ Add topics”, or long-press a topic anywhere and choose “Add to a topic list”.");
      afterBind = ()=>{
        document.getElementById("renameListBtn").addEventListener("click", ()=>{ const name = prompt("Rename list", list.name); if(name && name.trim()){ list.name = name.trim(); saveData(DATA); render(); } });
        document.getElementById("deleteListBtn").addEventListener("click", ()=>{ if(confirm(`Delete the list "${list.name}"? Topics and questions are not affected.`)){ DATA.topicLists = DATA.topicLists.filter(l=>l.id!==list.id); screen.activeListId = null; saveData(DATA); render(); } });
        document.getElementById("addTopicsBtn").addEventListener("click", ()=> openTopicListPickerModal(list.id));
        document.querySelectorAll("[data-remove-item]").forEach(btn=> btn.addEventListener("click", (ev)=>{ ev.stopPropagation(); const [s,t] = btn.dataset.removeItem.split("|||"); removeTopicFromList(list.id,s,t); render(); }));
      };
    }
    mainEl.innerHTML = html + `<div id="listWrap">${rowsHtml}</div>`;
    document.querySelectorAll("#chipBar .chip").forEach(c=> c.addEventListener("click", ()=>{
      if(c.dataset.chip==="__new"){
        const name = prompt("Name this topic list");
        if(name && name.trim()){ const l = { id: slugify(name)+"-"+Date.now().toString(36), name:name.trim(), items:[] }; DATA.topicLists.push(l); saveData(DATA); screen.activeListId = l.id; render(); }
      } else { screen.activeListId = c.dataset.chip; render(); }
    }));
    afterBind();
  } else {
    if(sortMode==="az") entries.sort((a,b)=> a.topic.localeCompare(b.topic));
    else if(sortMode==="studied"){
      const dir = screen.studiedDir || "desc", filt = screen.studiedFilter || "all";
      html += `<div class="segmented scrolly" id="studiedFilterSeg">${[["all","All"],["0","Not studied"],["1","Studied"],["3","3+ times"]].map(([k,l])=>`<button data-f="${k}" class="${filt===k?'active':''}">${l}</button>`).join("")}</div>
        <div class="segmented" id="studiedDirSeg"><button data-d="desc" class="${dir==='desc'?'active':''}">Most studied first</button><button data-d="asc" class="${dir==='asc'?'active':''}">Least studied first</button></div>`;
      if(filt==="0") entries = entries.filter(e=>e.studied===0);
      else if(filt==="1") entries = entries.filter(e=>e.studied>=1);
      else if(filt==="3") entries = entries.filter(e=>e.studied>=3);
      entries.sort((a,b)=> (dir==="desc"? b.studied-a.studied : a.studied-b.studied) || b.count-a.count || a.topic.localeCompare(b.topic));
    }
    else if(sortMode==="label"){
      const sel = screen.labelSel || null;                 // null = all labels included
      const none = "__none__";
      const lblCounts = {}; entries.forEach(e=>{ const k=e.label||none; lblCounts[k]=(lblCounts[k]||0)+1; });
      const chips = [{id:"__all",label:"All",count:entries.length,active:!sel}]
        .concat(TOPIC_LABEL_PALETTE.map(p=>({id:p.name,label:p.name,color:p.color,count:lblCounts[p.name]||0,active:!!sel && sel.includes(p.name)})))
        .concat([{id:none,label:"No label",count:lblCounts[none]||0,active:!!sel && sel.includes(none)}]);
      html += chipBarHtml(chips);
      html += `<div class="chart-note" style="margin:2px 0 6px;">Tap a colour to see only that colour; tap more colours to add them, tap again to drop one. “All” resets.</div>`;
      if(sel) entries = entries.filter(e=> sel.includes(e.label||none));
      const order = n=> { const i = TOPIC_LABEL_PALETTE.findIndex(p=>p.name===n); return i<0? 99 : i; };
      entries.sort((a,b)=> order(a.label)-order(b.label) || b.count-a.count || a.topic.localeCompare(b.topic));
    }
    else entries.sort((a,b)=> b.count - a.count || a.topic.localeCompare(b.topic));
    const shown = entries.filter(matchSearch);
    html += `<div class="chart-note" style="margin:2px 0;">Tip: press and hold a topic to add it to a list or give it a label.</div>`;
    mainEl.innerHTML = html + `<div id="listWrap">${shown.length ? shown.map((e,i)=>topicRowHtml(e,i)).join("") : emptyState("Nothing matches","")}</div>`;
    document.querySelectorAll("#studiedFilterSeg button").forEach(b=> b.addEventListener("click", ()=>{ screen.studiedFilter = b.dataset.f; render(); }));
    document.querySelectorAll("#studiedDirSeg button").forEach(b=> b.addEventListener("click", ()=>{ screen.studiedDir = b.dataset.d; render(); }));
    document.querySelectorAll("#chipBar .chip").forEach(c=> c.addEventListener("click", ()=>{
      const id = c.dataset.chip, cur = screen.labelSel;
      if(id==="__all"){ screen.labelSel = null; }
      else if(!cur){ screen.labelSel = [id]; }
      else if(cur.includes(id)){ const n = cur.filter(x=>x!==id); screen.labelSel = n.length ? n : null; }
      else { screen.labelSel = cur.concat([id]); }
      render();
    }));
  }
  document.querySelectorAll("#topicSortSeg button").forEach(btn=> btn.addEventListener("click", ()=>{ screen.topicListSort = btn.dataset.s; render(); }));
  document.querySelectorAll("#listWrap .row[data-topic]").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject: row.dataset.subject, topic: row.dataset.topic }));
  });
  const fromList = (sortMode==="lists") ? screen.activeListId : null;
  bindLongPress("#listWrap .row[data-lp]", el=> openTopicActionsModal(el.dataset.subject, el.dataset.topic, fromList));
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
  html += listingNoteBlockHtml(screen);

  if(entries.length===0){
    html += emptyState("No questions tagged with this subject yet", "");
  } else {
    html += `<input class="search" id="searchBox" placeholder="Search topics…" value="${escapeHtml(searchTerm)}">`;
    html += `<div id="listWrap">`;
    entries
      .filter(e=>e.topic.toLowerCase().includes(searchTerm.toLowerCase()))
      .forEach((e, idx)=>{
        const studied = getStudyCount(subject, e.topic);
        const attempts = countTopicAttempts(subject, e.topic);
        const bits = [];
        if(studied) bits.push(`📖 ${studied}×`);
        if(attempts) bits.push(`📝 ${attempts} test${attempts===1?"":"s"}`);
        html += rowHtml({
          num: String(idx+1).padStart(2,"0"),
          title: e.topic,
          sub: (bits.length ? bits.join(" · ") : subject) + diffSuffix(visibleQuestions().filter(q=>q.subject===subject && (q.topic||FALLBACK_TOPIC)===e.topic)),
          count: `${e.count} q`,
          dataAttr: `data-topic="${escapeHtml(e.topic)}" data-lp="1"`
        }).replace('<div class="row" ','<div class="row lp-target" ').replace('<div class="count">', `${labelPillHtml(subject,e.topic)}<div class="count">`);
      });
    html += `</div>`;
  }

  mainEl.innerHTML = html;
  bindLongPress("#listWrap .row[data-lp]", el=> openTopicActionsModal(subject, el.dataset.topic, null));
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
    html += `<div class="swipe-touch-area" id="swipeArea">${slipFn(questions[idx], idx+1)}</div>`;
    return html;
  }
  return questions.map((q,i)=>slipFn(q,i+1)).join("");
}
function bindSwipeNav(questions, screen){
  if(getViewMode()!=="swipe") return;
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

  // Fixed, non-scrolling Prev/Next bar at the bottom of the screen
  const idx = screen.qIndex||0;
  const navBar = document.createElement("div");
  navBar.className = "bottomnav";
  navBar.innerHTML = `<div class="bottomnav-inner" style="justify-content:center;align-items:center;gap:14px;">
    <button class="iconbtn swipe-nav-btn" id="swipePrevFixed" ${idx<=0?"disabled":""}>‹ Prev</button>
    <div class="progress">${idx+1} of ${questions.length}</div>
    <button class="iconbtn swipe-nav-btn" id="swipeNextFixed" ${idx>=questions.length-1?"disabled":""}>Next ›</button>
  </div>`;
  document.body.appendChild(navBar);
  document.getElementById("swipePrevFixed").addEventListener("click", ()=>{ if((screen.qIndex||0)>0){ screen.qIndex=(screen.qIndex||0)-1; render(); } });
  document.getElementById("swipeNextFixed").addEventListener("click", ()=>{ if((screen.qIndex||0) < questions.length-1){ screen.qIndex=(screen.qIndex||0)+1; render(); } });
}

/* ================= View-mode question-list screen (paper/subject-all/topic/bank) ================= */
function renderQuestionListScreen({ backLabel, onBack, title, meta, questions, actionsHtml, bindActions, allowPractice, practiceInfo }){
  const screen = currentScreen();
  const hideAnswers = !!screen.hideAnswers;
  const showExplanations = !!screen.showExplanations;
  const locked = screen.answersLocked !== false; // default true (locked)
  const hasExplanations = questions.some(q=> q.explanation && q.explanation.trim());
  const qSort = screen.qSort || "none";

  const diffStat = avgDifficulty(questions);
  const fullMeta = meta + (diffStat ? ` · avg difficulty ${diffStat.avg}/9 (${diffStat.count}/${diffStat.total} marked)` : "");

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ ${escapeHtml(backLabel)}</div>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">${escapeHtml(fullMeta)}</div>
    </div>
  </div>`;

  if(actionsHtml) html += actionsHtml;
  html += listingNoteBlockHtml(screen);

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
  if(questions.length>1) html += sortControlHtml(qSort, false);

  const sortedQuestions = sortQuestions(questions, qSort);
  if(sortedQuestions.length===0){
    html += emptyState("No questions here", "");
  } else {
    html += renderQuestionsListHtml(sortedQuestions, screen, (q, idx)=> questionSlipHtml(q, idx, hideAnswers, showExplanations, locked));
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.getElementById("toggleAnswersBtn").addEventListener("click", ()=>{ screen.hideAnswers = !hideAnswers; render(); });
  document.getElementById("toggleLockBtn").addEventListener("click", ()=>{ screen.answersLocked = !locked; render(); });
  const explBtn = document.getElementById("toggleExplBtn");
  if(explBtn) explBtn.addEventListener("click", ()=>{ screen.showExplanations = !showExplanations; render(); });
  const sortSel = document.getElementById("qSortSelect");
  if(sortSel) sortSel.addEventListener("change", ()=>{ screen.qSort = sortSel.value; render(); });
  const practiceBtn = document.getElementById("startPracticeBtn");
  if(practiceBtn){
    practiceBtn.addEventListener("click", ()=> openStartTestModal(practiceInfo.sourceType, practiceInfo.scopeKey, practiceInfo.scopeLabel, questions, practiceInfo.syllabusId||getCurrentSyllabusId()));
  }
  if(bindActions) bindActions();
  if(sortedQuestions.length>0){
    bindSlipInteractions(sortedQuestions);
    bindSwipeNav(sortedQuestions, screen);
  }
}

/* ================= Paper detail ================= */
function renderPaperDetail(paperId){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper){ popScreen(); return; }
  const screen = currentScreen();
  const allQs = (paper.questions||[]).map(q=>Object.assign({}, q, {
    _paperId: paper.id, _paperName: paper.name, _postName: paper.post_name||""
  }));
  const fSubject = screen.paperFilterSubject || null;
  const fTopic = screen.paperFilterTopic || null;
  const questions = allQs.filter(q=> (!fSubject || q.subject===fSubject) && (!fTopic || (q.topic||FALLBACK_TOPIC)===fTopic));
  const syllabusName = getSyllabusById(paper.syllabus_id||"default").name;
  const filterLabel = fTopic ? `Filtered: ${fSubject} — ${fTopic}` : fSubject ? `Filtered: ${fSubject}` : "Filter by subject/topic";

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
    <div style="display:flex;gap:8px;margin:0 0 4px;">
      <button class="iconbtn ${(fSubject||fTopic)?"primary":""}" id="paperSubjTopicFilterBtn" style="flex:1;justify-content:center;">${escapeHtml(filterLabel)}</button>
      ${(fSubject||fTopic) ? `<button class="iconbtn" id="clearPaperFilterBtn">Clear</button>` : ""}
    </div>
    <div style="display:flex;justify-content:flex-end;margin:4px 0 4px;">
      <button class="iconbtn" id="deletePaperBtn" style="border-color:var(--maroon);color:#f0a3ab;font-size:0.76rem;padding:5px 12px;">🗑 Delete paper</button>
    </div>`;

  renderQuestionListScreen({
    backLabel: "Back to Papers",
    onBack: popScreen,
    title: paper.name,
    meta: `${questions.length} of ${allQs.length} question${allQs.length===1?"":"s"} · Paper ID: ${paper.id}${paper.post_name ? " · "+paper.post_name : ""}`,
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
      document.getElementById("paperSubjTopicFilterBtn").addEventListener("click", ()=> openPaperSubjectTopicFilterModal(allQs, screen));
      const clearBtn = document.getElementById("clearPaperFilterBtn");
      if(clearBtn) clearBtn.addEventListener("click", ()=>{ screen.paperFilterSubject=null; screen.paperFilterTopic=null; render(); });
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

function openPaperSubjectTopicFilterModal(allQs, screen){
  const subjects = Array.from(new Set(allQs.map(q=>q.subject))).sort((a,b)=>a.localeCompare(b));
  let chosenSubject = screen.paperFilterSubject || null;

  function topicsForChosen(){
    if(!chosenSubject) return [];
    return Array.from(new Set(allQs.filter(q=>q.subject===chosenSubject).map(q=>q.topic||FALLBACK_TOPIC))).sort((a,b)=>a.localeCompare(b));
  }

  function draw(){
    const topics = topicsForChosen();
    modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Filter this paper</h3>
        <div class="field">
          <label>Subject</label>
          <select id="pfSubject">
            <option value="">All subjects</option>
            ${subjects.map(s=>`<option value="${escapeHtml(s)}" ${chosenSubject===s?"selected":""}>${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
        ${chosenSubject ? `<div class="field">
          <label>Topic</label>
          <select id="pfTopic">
            <option value="">All topics in ${escapeHtml(chosenSubject)}</option>
            ${topics.map(t=>`<option value="${escapeHtml(t)}" ${screen.paperFilterTopic===t?"selected":""}>${escapeHtml(t)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="row-btns">
          <button class="iconbtn" id="cancelPf" style="flex:1;justify-content:center;">Cancel</button>
          <button class="iconbtn primary" id="applyPf" style="flex:1;justify-content:center;">Apply</button>
        </div>
      </div>
    </div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
    document.getElementById("cancelPf").addEventListener("click", closeModal);
    document.getElementById("pfSubject").addEventListener("change", (e)=>{ chosenSubject = e.target.value || null; draw(); });
    document.getElementById("applyPf").addEventListener("click", ()=>{
      screen.paperFilterSubject = chosenSubject;
      const topicSel = document.getElementById("pfTopic");
      screen.paperFilterTopic = (chosenSubject && topicSel && topicSel.value) ? topicSel.value : null;
      closeModal();
      render();
    });
  }
  draw();
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
  const attemptCount = countTopicAttempts(subject, topic);
  const currentLabel = getTopicLabel(subject, topic);
  const actionsHtml = `<div class="stepper left" id="studyStepper">
    <span class="study-label">📖 Studied</span>
    <button id="studyMinus" ${studyCount<=0?"disabled":""}>−1</button>
    <div class="val">${studyCount}×</div>
    <button id="studyPlus">+1</button>
  </div>
  <div style="display:flex;gap:8px;margin:8px 0 4px;">
    <button class="iconbtn" id="viewTopicAttemptsBtn" style="flex:1;justify-content:center;" ${attemptCount===0?"disabled":""}>📝 ${attemptCount} test${attemptCount===1?"":"s"} attempted from this topic</button>
  </div>
  <div style="display:flex;gap:8px;margin:12px 0 4px;">
    <button class="iconbtn" id="renameTopicBtn" style="flex:1;justify-content:center;">Rename topic</button>
    <button class="iconbtn" id="copyListBtn" style="flex:1;justify-content:center;">Copy list</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn" id="filterPapersBtn" style="flex:1;justify-content:center;">${filterLabel}</button>
    <button class="iconbtn" id="labelTopicBtn" style="flex:1;justify-content:center;">${currentLabel ? `🏷️ ${escapeHtml(currentLabel.name)}` : "🏷️ Add label"}</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn" data-ai="gen-topic" data-subject="${escapeHtml(subject)}" data-topic="${escapeHtml(topic)}" style="flex:1;justify-content:center;">🤖 AI practice questions</button>
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
      const viewAttemptsBtn = document.getElementById("viewTopicAttemptsBtn");
      if(attemptCount>0){
        viewAttemptsBtn.addEventListener("click", ()=> pushScreen({ type:"attempts-for-scope", groupBy:"topic", scopeKey:`${subject}|||${topic}`, scopeLabel:`${subject} — ${topic}` }));
      }
      document.getElementById("renameTopicBtn").addEventListener("click", ()=> openRenameTopicModal(subject, topic));
      document.getElementById("copyListBtn").addEventListener("click", ()=> copyQuestionsToClipboard(questions, `${subject} — ${topic}`));
      document.getElementById("labelTopicBtn").addEventListener("click", ()=> openTopicLabelModal(subject, topic));
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
  const flagged = !!q.flagged;
  const diffEnabled = isDifficultyMarkingEnabled();

  const opts = (q.options||[]).map((opt, i)=>{
    const isCorrect = !isDeleted && q.correct_answer_index !== null && q.correct_answer_index !== undefined && Number(q.correct_answer_index) === i;
    const showCorrect = isCorrect && !hideAnswers;
    const disabled = isDeleted || hideAnswers || locked;
    return `<li class="${showCorrect?"correct":""}">
      <button type="button" class="optlabel-btn ${showCorrect?"correct":""}" data-idx="${i}" ${disabled?"disabled":""}>${letterFor(i)}</button>
      <span class="opttext">${renderRichText(opt)}</span>
    </li>`;
  }).join("");

  let hint = "Tap a letter (A, B, C, D) to mark it correct — tap again to clear";
  if(isDeleted) hint = "";
  else if(locked) hint = "Answers locked — tap \"🔒 Answers locked\" above to unlock editing";
  else if(hideAnswers) hint = "Answers hidden — tap \"Show answers\" above to reveal and edit";

  let expl = "";
  if(showExplanations && q.explanation && q.explanation.trim()){
    expl = `<div class="explanation-block"><div class="exp-label">Explanation</div>${renderRichText(q.explanation)}</div>`;
  }

  const diffRow = diffEnabled ? `<div class="diff-row">
    <span class="diff-label">Difficulty${q.difficulty_auto?" (auto — tap to change)":""}:</span>
    ${["E","M","D"].map(lv=>`<button type="button" class="diff-btn diff-${lv} ${q.difficulty===lv?"active":""}" data-action="set-difficulty" data-level="${lv}">${lv}</button>`).join("")}
  </div>` : "";

  return `<div class="slip ${isDeleted?"slip-deleted":""}" data-qid="${escapeHtml(q._paperId)}::${escapeHtml(q.id)}">
    <div class="slip-head">
      <div class="qno">Q${idx}${originalNum?` <span class="qno-orig">(Paper Q${escapeHtml(originalNum)})</span>`:""}</div>
      <div class="pills">
        ${q._postName ? `<span class="pill post">${escapeHtml(q._postName)}</span>` : ""}
        <span class="pill paper">${escapeHtml(q._paperName)}</span>
        <span class="pill subject" data-action="edit-subject">${escapeHtml(q.subject||"Unclassified")} ✎</span>
        <span class="pill topic" data-action="edit-topic">${escapeHtml(q.topic||FALLBACK_TOPIC)} ✎</span>
        ${labelPillHtml(q.subject, q.topic||FALLBACK_TOPIC)}
      </div>
    </div>
    <div class="actions-row">
      <div class="grp">
        <button class="actbtn ${flagged?"flagged":""}" data-action="toggle-flag" title="Flag for review">${flagged?"⭐":"☆"}</button>
        <button class="actbtn" data-action="copy-question" title="Copy this question">📋</button>
        <button class="actbtn" data-action="edit-question" title="Edit question">📝</button>
        <button class="actbtn" data-ai="q" data-paper="${escapeHtml(q._paperId)}" data-qid="${escapeHtml(q.id)}" title="AI help">🤖</button>
      </div>
      <div class="grp">
        <button class="actbtn danger" data-action="toggle-deleted" title="Toggle deleted-by-PSC status">${isDeleted?"↺":"🚫"}</button>
        <button class="actbtn danger" data-action="delete-question" title="Delete question">🗑</button>
      </div>
    </div>
    ${diffRow}
    ${isDeleted ? `<div class="deleted-banner">Deleted question (per official PSC answer key)</div>` : ""}
    <div class="qtext">${renderRichText(q.question_text)}</div>
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
  document.querySelectorAll('.actbtn[data-action="toggle-flag"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const nowFlagged = toggleFlag(paperId, qid);
      render();
      toast(nowFlagged ? "Flagged for review" : "Flag removed");
    });
  });
  document.querySelectorAll('.diff-btn[data-action="set-difficulty"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      setDifficulty(paperId, qid, btn.dataset.level);
      render();
    });
  });
  document.querySelectorAll('.actbtn[data-action="edit-note"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      openNoteModal(paperId, qid);
    });
  });
  document.querySelectorAll('.actbtn[data-action="toggle-flag"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      const nowFlagged = toggleFlag(paperId, qid);
      render();
      toast(nowFlagged ? "Flagged for review" : "Flag removed");
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
function toggleFlag(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return false;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return false;
  q.flagged = !q.flagged;
  saveData(DATA);
  return q.flagged;
}
function collectFlaggedQuestions(){
  return visibleQuestions().filter(q=>q.flagged);
}

/* ================= Note modal ================= */
function openNoteModal(paperId, qid){
  const paper = DATA.papers.find(p=>p.id===paperId);
  if(!paper) return;
  const q = (paper.questions||[]).find(qq=>String(qq.id)===qid);
  if(!q) return;
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>My notes</h3>
      <div class="meta" style="margin-bottom:8px;">${escapeHtml(q._paperName || paper.name)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}</div>
      <div class="field">
        <textarea id="noteText" class="prose" placeholder="Your thoughts, mnemonics, why you got it wrong…" style="min-height:140px;">${escapeHtml(q.note||"")}</textarea>
      </div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelNote" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="saveNote" style="flex:1;justify-content:center;">Save</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelNote").addEventListener("click", closeModal);
  const ta = document.getElementById("noteText");
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  document.getElementById("saveNote").addEventListener("click", ()=>{
    setNote(paperId, qid, ta.value);
    closeModal();
    render();
    toast("Note saved");
  });
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
  let paperTerm = "";
  const visiblePapers = ()=>{ const t = paperTerm.trim().toLowerCase(); return t ? papersInScope.filter(p=> p.name.toLowerCase().includes(t) || (p.post_name||"").toLowerCase().includes(t)) : papersInScope; };

  function listHtml(){
    const vis = visiblePapers();
    if(!vis.length) return `<div class="meta" style="padding:8px 2px;">No exam matches “${escapeHtml(paperTerm)}”.</div>`;
    return vis.map(p=>{
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
      <input class="search" id="paperSearch" placeholder="Search exams by name or post…" autocomplete="off">
      <div class="row-btns" style="margin-top:0;margin-bottom:10px;">
        <button class="iconbtn" id="selectAllBtn" style="flex:1;justify-content:center;">Select all${""} shown</button>
        <button class="iconbtn" id="selectNoneBtn" style="flex:1;justify-content:center;">Select none shown</button>
      </div>
      <div id="paperCheckList" style="max-height:36vh;overflow-y:auto;">${listHtml()}</div>
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
  document.getElementById("paperSearch").addEventListener("input", e=>{
    paperTerm = e.target.value;
    document.getElementById("paperCheckList").innerHTML = listHtml();
    rebindChecks();
  });
  document.getElementById("selectAllBtn").addEventListener("click", ()=>{
    visiblePapers().forEach(p=>selected.add(p.id));
    document.getElementById("paperCheckList").innerHTML = listHtml();
    rebindChecks();
  });
  document.getElementById("selectNoneBtn").addEventListener("click", ()=>{
    visiblePapers().forEach(p=>selected.delete(p.id));
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

function practiceSlipHtml(q, idx, selectedIndex, guessed){
  const originalNum = questionOriginalNumber(q);
  const diffEnabled = isDifficultyMarkingEnabled();
  const opts = (q.options||[]).map((opt,i)=>{
    const isSelected = selectedIndex!==null && selectedIndex!==undefined && Number(selectedIndex)===i;
    return `<li class="${isSelected?"selected":""}" data-idx="${i}">
      <span class="optlabel-btn">${letterFor(i)}</span>
      <span class="opttext">${renderRichText(opt)}</span>
    </li>`;
  }).join("");
  const diffRow = diffEnabled ? `<div class="diff-row">
    <span class="diff-label">Difficulty${q.difficulty_auto?" (auto — tap to change)":""}:</span>
    ${["E","M","D"].map(lv=>`<button type="button" class="diff-btn diff-${lv} ${q.difficulty===lv?"active":""}" data-action="set-difficulty" data-level="${lv}">${lv}</button>`).join("")}
  </div>` : "";
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
    ${diffRow}
    <div class="qtext">${renderRichText(q.question_text)}</div>
    <ul class="options practice">${opts}</ul>
    <button type="button" class="guess-btn ${guessed?"active":""}" data-action="toggle-guess">🤔 ${guessed?"Marked as a guess — tap to unmark":"Mark as a guess"}</button>
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
  document.querySelectorAll('.diff-btn[data-action="set-difficulty"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const [paperId, qid] = slip.dataset.qid.split("::");
      setDifficulty(paperId, qid, btn.dataset.level);
      render();
    });
  });
  document.querySelectorAll('.guess-btn[data-action="toggle-guess"]').forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const slip = e.target.closest(".slip");
      const key = slip.dataset.qid;
      if(!screen.guesses) screen.guesses = {};
      screen.guesses[key] = !screen.guesses[key];
      if(!screen.guesses[key]) delete screen.guesses[key];
      render();
    });
  });
}

function computeAttemptResults(questionRefs, answers, guesses){
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
      selectedIndex, correctIndex: isGraded?Number(correctIndex):null, isCorrect, isGraded,
      guessed: !!(guesses && guesses[key]), difficulty: q.difficulty || null
    });
  });
  return { answerRecords, correctCount, wrongCount, unansweredCount, totalCount: answerRecords.length };
}

function submitPracticeTest(screen, autoSubmitted){
  const idxMap = buildQuestionIndex();
  const orderedQuestions = screen.questionRefs.map(ref=> idxMap[`${ref.paperId}::${ref.qid}`]).filter(Boolean);
  flushCurrentQuestionTime(screen, orderedQuestions);
  orderedQuestions.forEach(q=> maybeAutoDifficulty(screen, q));

  const results = computeAttemptResults(screen.questionRefs, screen.answers, screen.guesses);
  if(screen.timeSpent){
    results.answerRecords.forEach(rec=>{
      const key = `${rec.paperId}::${rec.qid}`;
      if(screen.timeSpent[key]) rec.timeMs = screen.timeSpent[key];
    });
  }
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
  recordActivity();
  screen.submitted = true;
  screen.results = results;
  screen.netScore = netScore;
  screen.marking = marking;
  screen.attemptId = attempt.id;
  screen.qIndex = 0;
  screen.reviewFilter = "all";
  render();
  toast(autoSubmitted
    ? `Time's up — submitted: ${results.correctCount} correct, ${results.wrongCount} wrong`
    : `Submitted: ${results.correctCount} correct, ${results.wrongCount} wrong`);
}
function flushCurrentQuestionTime(screen, questions){
  if(screen._qStartedAt===undefined) return;
  const i = screen._lastIndex!==undefined ? screen._lastIndex : (screen.qIndex||0);
  const q = questions[i];
  if(!q) return;
  const key = `${q._paperId}::${q.id}`;
  if(!screen.timeSpent) screen.timeSpent = {};
  screen.timeSpent[key] = (screen.timeSpent[key]||0) + (Date.now() - screen._qStartedAt);
  screen._qStartedAt = Date.now();
}

function togglePause(screen){
  if(!screen.timerEndAt) return;
  if(screen.paused){
    const pausedDuration = Date.now() - screen.pausedAt;
    screen.timerEndAt += pausedDuration;
    screen.paused = false;
    screen.pausedAt = null;
  } else {
    // stop the per-question stopwatch so paused time is never counted
    const idxMap = buildQuestionIndex();
    const qs = screen.questionRefs.map(ref=> idxMap[`${ref.paperId}::${ref.qid}`]).filter(Boolean);
    flushCurrentQuestionTime(screen, qs);
    screen._qStartedAt = undefined;
    screen.paused = true;
    screen.pausedAt = Date.now();
  }
  render();
}
/* Also stop per-question timing while the app is in the background */
document.addEventListener("visibilitychange", ()=>{
  const sc = (typeof currentScreen==="function") ? currentScreen() : null;
  if(!sc || sc.type!=="practice" || sc.submitted) return;
  if(document.hidden){
    if(sc._qStartedAt!==undefined && !sc.paused){
      const idxMap = buildQuestionIndex();
      const qs = sc.questionRefs.map(ref=> idxMap[`${ref.paperId}::${ref.qid}`]).filter(Boolean);
      flushCurrentQuestionTime(sc, qs);
      sc._qStartedAt = undefined; sc._bg = true;
    }
  } else if(sc._bg){
    sc._bg = false;
    if(!sc.paused){ sc._qStartedAt = Date.now(); sc._lastIndex = sc.qIndex||0; }
  }
});

function startPracticeTimerTick(screen){
  function tick(){
    const el = document.getElementById("timerNum");
    const bar = document.getElementById("testToolbar");
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
  const idxMap = buildQuestionIndex();
  const questions = screen.questionRefs.map(ref=> idxMap[`${ref.paperId}::${ref.qid}`]).filter(Boolean);

  if(!screen.submitted){
    const answeredCount = Object.keys(screen.answers).length;

    // Per-question timing bookkeeping (best-effort, meaningful mainly in swipe view)
    const nowTs = Date.now();
    if(!screen.paused){
      if(screen._qStartedAt===undefined){ screen._qStartedAt = nowTs; screen._lastIndex = screen.qIndex||0; }
      else if(screen._lastIndex !== (screen.qIndex||0)){
        const leftIdx = screen._lastIndex;
        flushCurrentQuestionTime(screen, questions);
        maybeAutoDifficulty(screen, questions[leftIdx]);
        screen._lastIndex = screen.qIndex||0;
      }
    }

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

    html += `<div class="test-toolbar ${screen.paused?"paused":""}" id="testToolbar">
      <div class="test-toolbar-left">
        ${screen.timerEndAt ? `<button class="iconbtn" id="pauseBtn" title="${screen.paused?"Resume":"Pause"}">${screen.paused?"▶":"⏸"}</button><span class="timer-num" id="timerNum">${screen.paused?"PAUSED":"--:--"}</span>`
          : `<span class="progress">Answered ${answeredCount} of ${questions.length}</span>`}
      </div>
      <button class="iconbtn primary" id="submitTestBtn">Submit</button>
    </div>`;

    html += renderQuestionsListHtml(questions, screen, (q,i)=> practiceSlipHtml(q, i, screen.answers[`${q._paperId}::${q.id}`], screen.guesses && screen.guesses[`${q._paperId}::${q.id}`]), (q)=> screen.answers[`${q._paperId}::${q.id}`]!==undefined);
    mainEl.innerHTML = html;
    document.getElementById("backBtn").addEventListener("click", ()=>{
      if(answeredCount>0 && !confirm("Exit without submitting? Your answers won't be saved.")) return;
      popScreen();
    });
    bindSwipeNav(questions, screen);
    bindPracticeInteractions(screen);
    const pauseBtn = document.getElementById("pauseBtn");
    if(pauseBtn) pauseBtn.addEventListener("click", ()=> togglePause(screen));
    if(screen.timerEndAt && !screen.paused) startPracticeTimerTick(screen);
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
          screen._qStartedAt = undefined; screen._lastIndex = undefined; screen.timeSpent = {};
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
    return `<li class="${cls}"><span class="optlabel-btn ${cls}">${letterFor(i)}</span><span class="opttext">${renderRichText(opt)}</span></li>`;
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
    expl = `<div class="explanation-block"><div class="exp-label">Explanation</div>${renderRichText(q.explanation)}</div>`;
  }

  const timeBadge = (rec.timeMs && rec.timeMs>0) ? `<span class="pill time-pill">⏱ ${formatDuration(rec.timeMs)}</span>` : "";
  const guessBadge = rec.guessed ? `<span class="pill guess-pill">🤔 Guessed</span>` : "";
  const diffVal = rec.difficulty || q.difficulty;
  const diffBadge = diffVal ? `<span class="pill diff-pill diff-${diffVal}">${diffVal}</span>` : "";

  const slipClass = isGraded ? (rec.selectedIndex===null ? "" : (rec.isCorrect?"slip-correct":"slip-wrong")) : "";

  return `<div class="slip ${slipClass}">
    <div class="slip-head">
      <div class="qno">Q${idx}${originalNum?` <span class="qno-orig">(Paper Q${escapeHtml(originalNum)})</span>`:""}</div>
      <div class="pills">
        ${diffBadge}
        ${guessBadge}
        ${timeBadge}
        ${q._postName ? `<span class="pill post">${escapeHtml(q._postName)}</span>` : ""}
        <span class="pill paper">${escapeHtml(q._paperName)}</span>
        <span class="pill subject">${escapeHtml(q.subject||"Unclassified")}</span>
        <span class="pill topic">${escapeHtml(q.topic||FALLBACK_TOPIC)}</span>
      </div>
    </div>
    ${banner}
    <div class="qtext">${renderRichText(q.question_text)}</div>
    <ul class="options">${opts}</ul>
    ${expl}
    <button type="button" class="ai-inline-btn" data-ai="q" data-paper="${escapeHtml(q._paperId)}" data-qid="${escapeHtml(q.id)}" data-sel="${rec.selectedIndex===null||rec.selectedIndex===undefined?"none":rec.selectedIndex}">🤖 ${isGraded && rec.selectedIndex!==null && !rec.isCorrect ? "Explain my mistake" : "AI help"}</button>
  </div>`;
}
function formatDuration(ms){
  const totalSec = Math.round(ms/1000);
  if(totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec/60), s = totalSec%60;
  return `${m}m ${s}s`;
}

function renderResultsReview({ backLabel, onBack, title, meta, answerRecords, counts, netScore, marking, screen, extraActionsHtml, bindExtra }){
  const idxMap = buildQuestionIndex();
  const resolved = answerRecords.map(rec=>({ rec, q: idxMap[`${rec.paperId}::${rec.qid}`] })).filter(x=>x.q);
  const filter = screen.reviewFilter || "all";
  const guessFilter = screen.guessFilter || "all";
  const qSort = screen.qSort || "none";

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ ${escapeHtml(backLabel)}</div>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">${escapeHtml(meta)}</div>
    </div>
  </div>`;

  html += `<div class="summary-banner">
    <button type="button" class="summary-stat clickable ${filter==='correct'?'active':''}" data-filter="correct"><div class="num good">${counts.correctCount}</div><div class="label">Correct</div></button>
    <button type="button" class="summary-stat clickable ${filter==='wrong'?'active':''}" data-filter="wrong"><div class="num bad">${counts.wrongCount}</div><div class="label">Wrong</div></button>
    <button type="button" class="summary-stat clickable ${filter==='unanswered'?'active':''}" data-filter="unanswered"><div class="num neutral">${counts.unansweredCount}</div><div class="label">Unanswered</div></button>
    <div class="summary-stat"><div class="num neutral">${counts.totalCount}</div><div class="label">Total</div></div>
    ${netScore!==undefined && netScore!==null ? `<div class="summary-stat"><div class="num" style="color:var(--gold);">${netScore}</div><div class="label">Score${marking?` (+${marking.positive}/−${marking.negNum}÷${marking.negDen})`:""}</div></div>` : ""}
  </div>`;
  if(filter!=="all"){
    html += `<div style="margin:-4px 0 10px;"><button class="iconbtn" id="clearFilterBtn">Showing "${filter}" only — tap to show all</button></div>`;
  }

  const hasGuesses = resolved.some(x=>x.rec.guessed);
  if(hasGuesses){
    html += `<div class="segmented" id="guessSeg" style="margin-bottom:8px;">
      <button data-g="all" class="${guessFilter==='all'?'active':''}">All</button>
      <button data-g="guessed-right" class="${guessFilter==='guessed-right'?'active':''}">Guessed right</button>
      <button data-g="guessed-wrong" class="${guessFilter==='guessed-wrong'?'active':''}">Guessed wrong</button>
    </div>`;
  }

  const hasTiming = resolved.some(x=> x.rec.timeMs && x.rec.timeMs>0);
  const hasExplanations = resolved.some(x=> x.q.explanation && x.q.explanation.trim());
  let actionsHtml = extraActionsHtml || "";
  if(hasExplanations){
    actionsHtml += `<div style="display:flex;gap:8px;margin:8px 0 4px;">
      <button class="iconbtn" id="toggleExplBtn" style="flex:1;justify-content:center;">${screen.showExplanations?"Hide explanations":"Show explanations"}</button>
    </div>`;
  }
  if(actionsHtml) html += actionsHtml;
  html += sortControlHtml(qSort, hasTiming);
  if(hasTiming){
    html += `<div class="meta" style="margin:0 0 8px;">⏱ Time-per-question is shown on each card below (tracked in swipe view).</div>`;
  }

  let filteredResolved = resolved;
  if(filter==="correct") filteredResolved = filteredResolved.filter(x=> x.rec.isGraded && x.rec.isCorrect);
  else if(filter==="wrong") filteredResolved = filteredResolved.filter(x=> x.rec.isGraded && !x.rec.isCorrect && x.rec.selectedIndex!==null);
  else if(filter==="unanswered") filteredResolved = filteredResolved.filter(x=> x.rec.isGraded && x.rec.selectedIndex===null);
  if(guessFilter==="guessed-right") filteredResolved = filteredResolved.filter(x=> x.rec.guessed && x.rec.isCorrect);
  else if(guessFilter==="guessed-wrong") filteredResolved = filteredResolved.filter(x=> x.rec.guessed && x.rec.isGraded && !x.rec.isCorrect);

  const timeByKey = {};
  filteredResolved.forEach(x=>{ if(x.rec.timeMs) timeByKey[`${x.q._paperId}::${x.q.id}`] = x.rec.timeMs; });
  let questions = filteredResolved.map(x=>x.q);
  questions = sortQuestions(questions, qSort, timeByKey);
  const recMap = {};
  filteredResolved.forEach(x=>{ recMap[`${x.q._paperId}::${x.q.id}`] = x.rec; });

  if(questions.length===0){
    html += emptyState("No questions to show", (filter!=="all"||guessFilter!=="all") ? "No questions match these filters." : "The questions in this attempt may have been deleted since.");
  } else {
    html += renderQuestionsListHtml(questions, screen, (q,i)=> reviewSlipHtml(q, i, recMap[`${q._paperId}::${q.id}`], !!screen.showExplanations));
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.querySelectorAll(".summary-stat[data-filter]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const f = btn.dataset.filter;
      screen.reviewFilter = (screen.reviewFilter===f) ? "all" : f;
      screen.qIndex = 0;
      render();
    });
  });
  const clearBtn = document.getElementById("clearFilterBtn");
  if(clearBtn) clearBtn.addEventListener("click", ()=>{ screen.reviewFilter="all"; screen.qIndex=0; render(); });
  document.querySelectorAll("#guessSeg button").forEach(btn=>{
    btn.addEventListener("click", ()=>{ screen.guessFilter = btn.dataset.g; screen.qIndex=0; render(); });
  });
  const sortSel = document.getElementById("qSortSelect");
  if(sortSel) sortSel.addEventListener("change", ()=>{ screen.qSort = sortSel.value; screen.qIndex=0; render(); });
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
    <button class="iconbtn" id="typeQuestionBtn" style="flex:1;justify-content:center;">✍️ Type a question</button>
  </div>
  <div style="display:flex;gap:8px;margin:0 0 4px;">
    <button class="iconbtn primary" id="randomExamBtn" style="flex:1;justify-content:center;">Create random exam</button>
  </div>`;
  html += listingNoteBlockHtml(screen);
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
  document.getElementById("typeQuestionBtn").addEventListener("click", ()=> openTypeQuestionModal(bankId));
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


/* ---- Full-question preview popup (used on long-press in pickers and search) ---- */
function openQuestionPreview(q){
  const ci = q.correct_answer_index;
  const hasKey = ci!==null && ci!==undefined && Number(ci)!==DELETED_SENTINEL;
  const ov = document.createElement("div");
  ov.className = "preview-overlay";
  ov.innerHTML = `<div class="preview-card">
    <div class="preview-meta">${escapeHtml(q._paperName||"")} · ${escapeHtml(q.subject||"")} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}${q.difficulty?` · ${DIFFICULTY_LABELS[q.difficulty]}`:""}</div>
    <div class="qtext" style="margin:8px 0;">${renderRichText(q.question_text)}</div>
    <ul class="options" style="list-style:none;padding:0;margin:0;">${(q.options||[]).map((o,i)=>`<li style="display:flex;gap:8px;padding:5px 0;${hasKey&&Number(ci)===i?"color:var(--good);font-weight:600;":""}"><b>${letterFor(i)}</b><span>${renderRichText(o)}</span></li>`).join("")}</ul>
    ${hasKey?"":`<div class="chart-note">${Number(ci)===DELETED_SENTINEL?"Deleted by PSC.":"No marked answer."}</div>`}
    ${q.explanation&&q.explanation.trim()?`<div class="explanation-block" style="margin-top:8px;"><div class="exp-label">Explanation</div>${renderRichText(q.explanation)}</div>`:""}
    <button class="iconbtn primary" style="width:100%;justify-content:center;margin-top:12px;" id="pvClose">Close</button>
  </div>`;
  document.body.appendChild(ov);
  const close = ()=> ov.remove();
  ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
  ov.querySelector("#pvClose").addEventListener("click", close);
  typesetMath(ov);
}

/* ---- Shared question-filter widgets (subject / topic / paper selects) ---- */
function optionsHtml(values, current, allLabel){
  return `<option value="">${allLabel}</option>` + values.map(v=>`<option value="${escapeHtml(v.value)}" ${current===v.value?"selected":""}>${escapeHtml(v.label)}</option>`).join("");
}
function distinctFilterOptions(pool, f){
  const subjects = Array.from(new Set(pool.map(q=>q.subject))).sort().map(v=>({value:v,label:v}));
  const topics = Array.from(new Set(pool.filter(q=>!f.subject||q.subject===f.subject).map(q=>q.topic||FALLBACK_TOPIC))).sort().map(v=>({value:v,label:v}));
  const papersMap = {};
  pool.filter(q=> (!f.subject||q.subject===f.subject) && (!f.topic||(q.topic||FALLBACK_TOPIC)===f.topic)).forEach(q=>{ papersMap[q._paperId]=q._paperName; });
  const papers = Object.entries(papersMap).sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>({value:id,label:name}));
  return { subjects, topics, papers };
}
function applyQuestionFilters(pool, f){
  const t = (f.term||"").toLowerCase();
  return pool.filter(q=>
    (!f.subject || q.subject===f.subject) &&
    (!f.topic || (q.topic||FALLBACK_TOPIC)===f.topic) &&
    (!f.paper || q._paperId===f.paper) &&
    (!t || q.question_text.toLowerCase().includes(t) || (q.options||[]).some(o=>String(o).toLowerCase().includes(t)) || q.subject.toLowerCase().includes(t) || (q.topic||"").toLowerCase().includes(t) || q._paperName.toLowerCase().includes(t)));
}

/* ================= Question picker for banks (filters + long-press preview) ================= */
function openQuestionPickerModal(bankId){
  const bank = DATA.banks.find(b=>b.id===bankId);
  if(!bank) return;
  const existingKeys = new Set(bank.questionRefs.map(r=>`${r.paperId}::${r.qid}`));
  const cur = getCurrentSyllabusId();
  const f = { term:"", subject:"", topic:"", paper:"", scope:"current" };
  const picked = new Set();
  const LIMIT = 200;
  const basePool = ()=> allQuestions().filter(q=> !existingKeys.has(`${q._paperId}::${q.id}`) && (f.scope==="all" || q._syllabusId===cur));
  let shown = [];

  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal tall">
    <h3>Add questions to “${escapeHtml(bank.name)}”</h3>
    <input class="search" id="pickerSearch" placeholder="Search question text, options…" value="">
    <div class="filter-grid">
      <select class="ai-input" id="fScope"><option value="current">This syllabus</option><option value="all">All syllabuses</option></select>
      <select class="ai-input" id="fSubject"></select>
      <select class="ai-input" id="fTopic"></select>
      <select class="ai-input" id="fPaper"></select>
    </div>
    <div class="meta" id="pickerCount" style="margin:6px 0;"></div>
    <div style="display:flex;gap:8px;margin-bottom:6px;">
      <button class="iconbtn" id="selShown" style="flex:1;justify-content:center;">Select all shown</button>
      <button class="iconbtn" id="selClear" style="flex:1;justify-content:center;">Clear selection</button>
    </div>
    <div class="chart-note" style="margin:0 0 6px;">Tip: press and hold a question to read it in full.</div>
    <div class="scroll-area" id="pickerList"></div>
    <div class="row-btns">
      <button class="iconbtn" id="cancelPicker" style="flex:1;justify-content:center;">Cancel</button>
      <button class="iconbtn primary" id="addPicked" style="flex:1;justify-content:center;">Add selected</button>
    </div>
  </div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelPicker").addEventListener("click", closeModal);

  function refreshSelects(){
    const pool = basePool();
    const o = distinctFilterOptions(pool, f);
    if(f.subject && !o.subjects.some(x=>x.value===f.subject)) { f.subject=""; }
    if(f.topic && !o.topics.some(x=>x.value===f.topic)) { f.topic=""; }
    if(f.paper && !o.papers.some(x=>x.value===f.paper)) { f.paper=""; }
    document.getElementById("fSubject").innerHTML = optionsHtml(o.subjects, f.subject, "All subjects");
    document.getElementById("fTopic").innerHTML = optionsHtml(o.topics, f.topic, "All topics");
    document.getElementById("fPaper").innerHTML = optionsHtml(o.papers, f.paper, "All question papers");
  }
  function updateList(){
    const matches = applyQuestionFilters(basePool(), f);
    shown = matches.slice(0, LIMIT);
    document.getElementById("pickerCount").textContent = `${picked.size} selected · ${matches.length} match${matches.length===1?"":"es"}${matches.length>LIMIT?` (showing first ${LIMIT} — narrow the filters)`:""}`;
    document.getElementById("pickerList").innerHTML = shown.map(q=>{
      const key = `${q._paperId}::${q.id}`, checked = picked.has(key);
      return `<button type="button" class="check-item lp-target ${checked?"checked":""}" data-qkey="${escapeHtml(key)}">
        <span class="box">${checked?"✓":""}</span>
        <span style="flex:1;min-width:0;">
          <div class="clamp2">${escapeHtml(q.question_text)}</div>
          <div class="ci-sub">${escapeHtml(q._paperName)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}${q.difficulty?` · ${q.difficulty}`:""}</div>
        </span></button>`;
    }).join("") || `<div class="meta">No matching questions.</div>`;
    const byKey = {}; shown.forEach(q=> byKey[`${q._paperId}::${q.id}`] = q);
    document.querySelectorAll("#pickerList [data-qkey]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const key = btn.dataset.qkey;
        if(picked.has(key)) picked.delete(key); else picked.add(key);
        btn.classList.toggle("checked"); btn.querySelector(".box").textContent = picked.has(key)?"✓":"";
        const total = applyQuestionFilters(basePool(), f).length;
        document.getElementById("pickerCount").textContent = `${picked.size} selected · ${total} match${total===1?"":"es"}`;
      });
    });
    bindLongPress("#pickerList [data-qkey]", el=>{ const q = byKey[el.dataset.qkey]; if(q) openQuestionPreview(q); });
  }
  refreshSelects(); updateList();
  let tmr = null;
  document.getElementById("pickerSearch").addEventListener("input", e=>{ f.term = e.target.value; clearTimeout(tmr); tmr = setTimeout(updateList, 120); });
  document.getElementById("fScope").addEventListener("change", e=>{ f.scope=e.target.value; f.subject=f.topic=f.paper=""; refreshSelects(); updateList(); });
  document.getElementById("fSubject").addEventListener("change", e=>{ f.subject=e.target.value; f.topic=""; f.paper=""; refreshSelects(); updateList(); });
  document.getElementById("fTopic").addEventListener("change", e=>{ f.topic=e.target.value; f.paper=""; refreshSelects(); updateList(); });
  document.getElementById("fPaper").addEventListener("change", e=>{ f.paper=e.target.value; updateList(); });
  document.getElementById("selShown").addEventListener("click", ()=>{ applyQuestionFilters(basePool(), f).forEach(q=> picked.add(`${q._paperId}::${q.id}`)); updateList(); });
  document.getElementById("selClear").addEventListener("click", ()=>{ picked.clear(); updateList(); });
  document.getElementById("addPicked").addEventListener("click", ()=>{
    if(!picked.size){ toast("Select some questions first"); return; }
    picked.forEach(key=>{ const [paperId, qid] = key.split("::"); bank.questionRefs.push({ paperId, qid }); });
    saveData(DATA); const n = picked.size; closeModal(); render(); toast(`Added ${n} question${n===1?"":"s"} to bank`);
  });
}

/* ================= Type a question into a bank ================= */
function openTypeQuestionModal(bankId){
  const bank = DATA.banks.find(b=>b.id===bankId); if(!bank) return;
  const subjects = getAllSubjects().sort();
  let subject = subjects.includes("General Knowledge") ? "General Knowledge" : (subjects[0]||"");
  let nOpts = 4;
  function draw(keep){
    const v = keep || {};
    const topics = subject ? getTopicsForSubject(subject) : [FALLBACK_TOPIC];
    modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal tall">
      <h3>✍️ Type a question</h3>
      <div class="scroll-area">
        <div class="field"><label>Question</label><textarea id="tqText" class="prose" style="min-height:90px;" placeholder="Type the question. **bold**, *italic* and $math$ work.">${escapeHtml(v.text||"")}</textarea></div>
        ${Array.from({length:nOpts}).map((_,i)=>`<div class="field" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <label style="margin:0;display:flex;align-items:center;gap:6px;min-width:64px;"><input type="radio" name="tqCorrect" value="${i}" ${String(v.correct)===String(i)?"checked":""}> ${letterFor(i)}</label>
          <input class="ai-input tqOpt" data-i="${i}" placeholder="Option ${letterFor(i)}" value="${escapeHtml((v.opts||[])[i]||"")}"></div>`).join("")}
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          ${nOpts<6?`<button class="iconbtn" id="tqMore" style="flex:1;justify-content:center;">+ Option</button>`:""}
          ${nOpts>2?`<button class="iconbtn" id="tqLess" style="flex:1;justify-content:center;">− Option</button>`:""}
          <button class="iconbtn" id="tqNoKey" style="flex:1;justify-content:center;">No answer</button>
        </div>
        <div class="chart-note">Select the radio next to the correct option (or leave none selected if you don't know yet).</div>
        <div class="field"><label>Explanation (optional)</label><textarea id="tqExpl" class="prose" style="min-height:70px;">${escapeHtml(v.expl||"")}</textarea></div>
        <div class="field"><label>Subject</label><select class="ai-input" id="tqSubject">${subjects.map(s=>`<option ${s===subject?"selected":""}>${escapeHtml(s)}</option>`).join("")}</select></div>
        <div class="field"><label>Topic</label><select class="ai-input" id="tqTopic">${topics.map(t=>`<option ${t===v.topic?"selected":""}>${escapeHtml(t)}</option>`).join("")}</select></div>
        <div class="field"><label>Store question</label><select class="ai-input" id="tqStore"><option value="bank" ${v.store!=="pool"?"selected":""}>In this bank only</option><option value="pool" ${v.store==="pool"?"selected":""}>In this bank AND my syllabus pool (shows under Subjects / Topics)</option></select></div>
      </div>
      <div class="row-btns"><button class="iconbtn" id="tqCancel" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="tqSave" style="flex:1;justify-content:center;">Add to bank</button></div>
    </div></div>`;
    const snap = ()=>({ text:document.getElementById("tqText").value, expl:document.getElementById("tqExpl").value, topic:document.getElementById("tqTopic").value, store:document.getElementById("tqStore").value,
      opts:Array.from(document.querySelectorAll(".tqOpt")).map(i=>i.value), correct:(document.querySelector('input[name="tqCorrect"]:checked')||{}).value });
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
    document.getElementById("tqCancel").addEventListener("click", closeModal);
    const m=document.getElementById("tqMore"), l=document.getElementById("tqLess");
    if(m) m.addEventListener("click", ()=>{ const s=snap(); nOpts++; draw(s); });
    if(l) l.addEventListener("click", ()=>{ const s=snap(); nOpts--; if(String(s.correct)>=String(nOpts)) s.correct=undefined; draw(s); });
    document.getElementById("tqNoKey").addEventListener("click", ()=>{ document.querySelectorAll('input[name="tqCorrect"]').forEach(r=>r.checked=false); });
    document.getElementById("tqSubject").addEventListener("change", e=>{ const s=snap(); subject=e.target.value; s.topic=""; draw(s); });
    document.getElementById("tqSave").addEventListener("click", ()=>{
      const s = snap();
      const text = s.text.trim();
      const opts = s.opts.map(o=>o.trim());
      const filled = opts.filter(o=>o);
      if(!text){ toast("Type the question first"); return; }
      if(filled.length<2){ toast("Add at least two options"); return; }
      // keep option positions compact but preserve which one is correct
      let correct = null;
      const compact = [];
      opts.forEach((o,i)=>{ if(o){ if(String(s.correct)===String(i)) correct = compact.length; compact.push(o); } });
      if(s.correct!==undefined && correct===null){ toast("The option marked correct is empty"); return; }
      const toPool = s.store==="pool";
      const cur = getCurrentSyllabusId();
      const pid = toPool ? "typed-"+cur : "typed-bank-"+bank.id;
      let paper = DATA.papers.find(p=>p.id===pid);
      if(!paper){
        paper = toPool ? { id:pid, name:"My typed questions", post_name:"", syllabus_id:cur, questions:[] }
                       : { id:pid, name:"Typed: "+bank.name, post_name:"", syllabus_id:"__bank_only__", is_bank_only:true, questions:[] };
        DATA.papers.push(paper);
      }
      const n = (paper.questions||[]).length + 1;
      const q = { id:"t"+Date.now().toString(36)+n, original_number:"T-"+n, question_text:text, options:compact, correct_answer_index:correct,
        subject, topic: s.topic||FALLBACK_TOPIC };
      if(s.expl.trim()) q.explanation = s.expl.trim();
      paper.questions.push(q);
      bank.questionRefs.push({ paperId:pid, qid:String(q.id) });
      saveData(DATA); closeModal(); render(); toast("Question added to bank");
    });
  }
  draw();
}

/* ================= Global search (scope-aware) + results as a full listing ================= */
const SEARCH_SCOPE_KEY = "psev_search_scope";
function getSearchScope(){
  try{ const o = JSON.parse(localStorage.getItem(SEARCH_SCOPE_KEY)||"null"); if(o && (o.mode==="current"||o.mode==="all"||o.mode==="pick")) return { mode:o.mode, ids:Array.isArray(o.ids)?o.ids:[] }; }catch(e){}
  return { mode:"current", ids:[] };
}
function setSearchScope(sc){ try{ localStorage.setItem(SEARCH_SCOPE_KEY, JSON.stringify(sc)); }catch(e){} }
function searchScopeLabel(sc){
  if(sc.mode==="current") return `current syllabus (${getSyllabusById(getCurrentSyllabusId()).name})`;
  if(sc.mode==="all") return "all syllabuses";
  const names = sc.ids.map(id=>{ const s=DATA.syllabuses.find(x=>x.id===id); return s?s.name:null; }).filter(Boolean);
  return names.length ? names.join(", ") : "no syllabus selected";
}
function searchPool(sc){
  const cur = getCurrentSyllabusId();
  return allQuestions().filter(q=>{
    if(q._syllabusId==="__bank_only__") return false;
    if(sc.mode==="all") return true;
    if(sc.mode==="pick") return sc.ids.includes(q._syllabusId);
    return q._syllabusId===cur;
  });
}
function searchQuestions(term, sc){
  if(!term || !term.trim()) return [];
  return applyQuestionFilters(searchPool(sc), { term });
}
function renderSearchResults(screen){
  const sc = screen.scope || getSearchScope();
  const questions = searchQuestions(screen.term, sc);
  renderQuestionListScreen({
    backLabel: "Back",
    onBack: popScreen,
    title: `Search: “${screen.term}”`,
    meta: `${questions.length} result${questions.length===1?"":"s"} in ${searchScopeLabel(sc)}`,
    questions,
    allowPractice: true,
    practiceInfo: { sourceType:"search", scopeKey:"search:"+screen.term, scopeLabel:"Search: "+screen.term, syllabusId: getCurrentSyllabusId() }
  });
}
function openGlobalSearchModal(){
  let term = "";
  let sc = getSearchScope();
  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal tall">
    <h3>Search questions</h3>
    <input class="search" id="globalSearchInput" placeholder="Search text, options, subject, topic, paper…" value="">
    <div class="segmented" id="scopeSeg"><button data-m="current">This syllabus</button><button data-m="all">All</button><button data-m="pick">Choose…</button></div>
    <div id="scopePick"></div>
    <div class="meta" id="searchInfo" style="margin:6px 0;"></div>
    <div id="searchViewAll"></div>
    <div class="scroll-area" id="globalSearchResults"></div>
    <div class="row-btns"><button class="iconbtn" id="closeSearch" style="width:100%;justify-content:center;">Close</button></div>
  </div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeSearch").addEventListener("click", closeModal);
  function drawScope(){
    document.querySelectorAll("#scopeSeg button").forEach(b=> b.classList.toggle("active", b.dataset.m===sc.mode));
    const pick = document.getElementById("scopePick");
    pick.innerHTML = sc.mode==="pick" ? `<div class="chip-bar" style="position:static;">${DATA.syllabuses.map(s=>`<button type="button" class="chip ${sc.ids.includes(s.id)?"active":""}" data-sid="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`).join("")}</div>` : "";
    pick.querySelectorAll("[data-sid]").forEach(b=> b.addEventListener("click", ()=>{
      sc.ids = sc.ids.includes(b.dataset.sid) ? sc.ids.filter(x=>x!==b.dataset.sid) : sc.ids.concat([b.dataset.sid]);
      setSearchScope(sc); drawScope(); drawResults();
    }));
  }
  function drawResults(){
    const list = searchQuestions(term, sc);
    const shown = list.slice(0,80);
    document.getElementById("searchInfo").textContent = term.trim() ? `${list.length} match${list.length===1?"":"es"} in ${searchScopeLabel(sc)}${list.length>80?" (preview shows 80)":""}` : `Searching ${searchScopeLabel(sc)}`;
    document.getElementById("searchViewAll").innerHTML = list.length ? `<button class="iconbtn primary" id="viewAllResults" style="width:100%;justify-content:center;margin-bottom:6px;">📋 View all ${list.length} as a list (practice, sort, swipe…)</button><div class="chart-note" style="margin:0 0 6px;">Press and hold a result to read it in full.</div>` : "";
    const byKey = {}; shown.forEach(q=> byKey[`${q._paperId}::${q.id}`]=q);
    document.getElementById("globalSearchResults").innerHTML = shown.map(q=>`<button type="button" class="check-item lp-target" data-qkey="${escapeHtml(q._paperId+"::"+q.id)}">
      <span style="flex:1;min-width:0;"><div class="clamp2">${escapeHtml(q.question_text)}</div>
      <div class="ci-sub">${escapeHtml(q._paperName)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}</div></span></button>`).join("");
    const va = document.getElementById("viewAllResults");
    if(va) va.addEventListener("click", ()=>{ closeModal(); pushScreen({ type:"search-results", term, scope:{ mode:sc.mode, ids:sc.ids.slice() } }); });
    document.querySelectorAll("#globalSearchResults [data-qkey]").forEach(btn=> btn.addEventListener("click", ()=>{
      const q = byKey[btn.dataset.qkey]; if(!q) return;
      closeModal(); resetToTab("papers"); pushScreen({ type:"paper-detail", paperId:q._paperId });
    }));
    bindLongPress("#globalSearchResults [data-qkey]", el=>{ const q = byKey[el.dataset.qkey]; if(q) openQuestionPreview(q); });
  }
  document.querySelectorAll("#scopeSeg button").forEach(b=> b.addEventListener("click", ()=>{ sc.mode=b.dataset.m; setSearchScope(sc); drawScope(); drawResults(); }));
  let tmr=null;
  document.getElementById("globalSearchInput").addEventListener("input", e=>{ term=e.target.value; clearTimeout(tmr); tmr=setTimeout(drawResults,120); });
  drawScope(); drawResults();
  setTimeout(()=>{ const i=document.getElementById("globalSearchInput"); if(i) i.focus(); }, 50);
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
  const sortMode = screen.attemptsSort || "recent";
  const searchTerm = getSearch();
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
    let rows = Object.values(groups).map(g=>{
      g.attempts.sort((x,y)=> new Date(y.timestamp)-new Date(x.timestamp));
      const latest = g.attempts[0];
      const avgPct = Math.round(100 * g.attempts.reduce((s,a)=> s + (a.totalCount? a.correctCount/a.totalCount : 0), 0) / g.attempts.length);
      return { g, latest, avgPct };
    });

    if(searchTerm){
      rows = rows.filter(r=> r.g.scopeLabel.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    html += `<input class="search" id="searchBox" placeholder="Search by ${grouping}…" value="${escapeHtml(searchTerm)}">`;
    html += `<div class="segmented" id="sortSeg" style="margin-top:8px;">
      <button data-s="recent" class="${sortMode==='recent'?'active':''}">Most recent</button>
      <button data-s="az" class="${sortMode==='az'?'active':''}">A–Z</button>
      <button data-s="best" class="${sortMode==='best'?'active':''}">Best score</button>
      <button data-s="worst" class="${sortMode==='worst'?'active':''}">Worst score</button>
    </div>`;

    if(sortMode==="az") rows.sort((a,b)=> a.g.scopeLabel.localeCompare(b.g.scopeLabel));
    else if(sortMode==="best") rows.sort((a,b)=> b.avgPct - a.avgPct);
    else if(sortMode==="worst") rows.sort((a,b)=> a.avgPct - b.avgPct);
    else rows.sort((a,b)=> new Date(b.latest.timestamp) - new Date(a.latest.timestamp));

    if(rows.length===0){
      html += emptyState("No matches", `Nothing found for "${searchTerm}".`);
    } else {
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
    }
    mainEl.innerHTML = html;
    document.querySelectorAll("#listWrap .row").forEach(row=>{
      row.addEventListener("click", ()=> pushScreen({ type:"attempts-for-scope", groupBy: grouping, scopeKey: row.dataset.scopeKey, scopeLabel: row.dataset.scopeLabel }));
    });
    document.querySelectorAll("#sortSeg button").forEach(btn=>{
      btn.addEventListener("click", ()=>{ screen.attemptsSort = btn.dataset.s; render(); });
    });
    bindSearchInput(renderAttemptsRoot);
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
      }).replace('<div class="count">', `<button class="delbtn" data-del-attempt="${escapeHtml(a.id)}" title="Delete this test">🗑</button><div class="count">`);
    });
    html += `</div>`;
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"attempt-review", attemptId: row.dataset.attemptId }));
  });
  document.querySelectorAll("[data-del-attempt]").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      if(!confirm("Delete this test attempt? Its results will be removed from Attempts and Stats.")) return;
      deleteAttemptById(btn.dataset.delAttempt); render(); toast("Test deleted");
    });
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
    screen,
    extraActionsHtml: `<div style="display:flex;gap:8px;margin:12px 0 4px;"><button class="iconbtn bad" id="delAttemptBtn" style="flex:1;justify-content:center;">🗑 Delete this test</button></div>`,
    bindExtra: ()=>{
      document.getElementById("delAttemptBtn").addEventListener("click", ()=>{
        if(!confirm("Delete this test attempt? Its results will be removed from Attempts and Stats.")) return;
        deleteAttemptById(attemptId); popScreen(); toast("Test deleted");
      });
    }
  });
}

/* ================= Stats tab ================= */
/* ---- Stats foundations: reset baseline, counting basis, sample-size smoothing ---- */
const STATS_BASIS_KEY = "psev_stats_basis";
function getStatsBasis(){ const v = localStorage.getItem(STATS_BASIS_KEY); return (v==="latest"||v==="all") ? v : "first"; }
function setStatsBasis(v){ localStorage.setItem(STATS_BASIS_KEY, v); }
function getStatsResetAt(){ return Number(DATA.statsResetAt)||0; }
function statsAttempts(){
  const cur = getCurrentSyllabusId(), base = getStatsResetAt();
  return (DATA.attempts||[]).filter(a=> (a.type==="bank" || a.syllabus_id===cur) && new Date(a.timestamp).getTime()>=base);
}
const isAnsweredGraded = r=> !!r.isGraded && r.selectedIndex!==null && r.selectedIndex!==undefined;
const hasTimeRec = r=> r.timeMs>0;
/* One record per question for "first"/"latest"; every record for "all". */
function pickByBasis(recs, pred){
  const basis = getStatsBasis();
  const ok = recs.filter(pred);
  if(basis==="all") return ok;
  const m = new Map();
  ok.forEach(r=>{ const k = r.paperId+"::"+r.qid; if(basis==="first"){ if(!m.has(k)) m.set(k,r); } else m.set(k,r); });
  return Array.from(m.values());
}
/* Shrinks small samples toward the overall accuracy so 1/1 never outranks 40/50. */
const STATS_SHRINK_K = 5, STATS_LOW_N = 5;
function adjustedAcc(correct, total, prior){
  return (correct + STATS_SHRINK_K*prior) / (total + STATS_SHRINK_K);
}
function attachAdjusted(map){
  let c=0,t=0; Object.values(map).forEach(a=>{ c+=a.correct; t+=a.total; });
  const prior = t? c/t : 0.5;
  Object.values(map).forEach(a=>{ a.adj = adjustedAcc(a.correct, a.total, prior); a.low = a.total < STATS_LOW_N; });
  return map;
}
function computeAccuracyBySubject(){
  const bySubj = {};
  pickByBasis(collectAttemptRecords(), isAnsweredGraded).forEach(rec=>{
    if(!bySubj[rec.subject]) bySubj[rec.subject] = {correct:0,total:0};
    bySubj[rec.subject].total++;
    if(rec.isCorrect) bySubj[rec.subject].correct++;
  });
  return attachAdjusted(bySubj);
}
function computeAccuracyByTopic(){
  const byTopic = {};
  pickByBasis(collectAttemptRecords(), isAnsweredGraded).forEach(rec=>{
    const key = `${rec.subject}|||${rec.topic}`;
    if(!byTopic[key]) byTopic[key] = {subject:rec.subject, topic:rec.topic, correct:0,total:0};
    byTopic[key].total++;
    if(rec.isCorrect) byTopic[key].correct++;
  });
  return attachAdjusted(byTopic);
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
    const accuracy = practiced ? acc.adj : null;
    const priority = (freq/maxSubjCount) * (practiced ? (1-accuracy) : 1);
    return { level:"subject", label: subject, freq, practiced, accuracy, priority };
  });
  const topicItems = Object.keys(topicCounts).map(key=>{
    const [subject, topic] = key.split("|||");
    const freq = topicCounts[key];
    const acc = topicAcc[key];
    const practiced = !!acc && acc.total>0;
    const accuracy = practiced ? acc.adj : null;
    const priority = (freq/maxTopicCount) * (practiced ? (1-accuracy) : 1);
    return { level:"topic", label: topic, sublabel: subject, freq, practiced, accuracy, priority };
  });
  return {
    subjectItems: subjectItems.sort((a,b)=>b.priority-a.priority),
    topicItems: topicItems.sort((a,b)=>b.priority-a.priority)
  };
}
function computeTimeStats(){
  const bySubject = {}, byTopic = {};
  pickByBasis(collectAttemptRecords(), hasTimeRec).forEach(rec=>{
    if(!bySubject[rec.subject]) bySubject[rec.subject] = {totalMs:0,count:0};
    bySubject[rec.subject].totalMs += rec.timeMs; bySubject[rec.subject].count++;
    const key = `${rec.subject}|||${rec.topic}`;
    if(!byTopic[key]) byTopic[key] = {subject:rec.subject, topic:rec.topic, totalMs:0, count:0};
    byTopic[key].totalMs += rec.timeMs; byTopic[key].count++;
  });
  return { bySubject, byTopic };
}
function timeStatsBlockHtml(title, entries){
  if(entries.length===0) return "";
  const maxMs = Math.max(...entries.map(e=>e.avgMs), 1);
  let html = `<div class="chart-block"><div class="chart-title">${escapeHtml(title)}</div><div style="max-height:280px;overflow-y:auto;">`;
  entries.forEach(e=>{
    const pct = Math.round(100*e.avgMs/maxMs);
    html += `<div class="bar-row">
      <div class="bar-label">${escapeHtml(e.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--gold);"></div></div>
      <div class="bar-val">${formatDuration(e.avgMs)}</div>
    </div>`;
  });
  html += `</div></div>`;
  return html;
}

/* ---- Wrong-answers queue: latest attempt per question, only if still wrong/unanswered ---- */
function collectWrongQuestions(){
  const cur = getCurrentSyllabusId();
  const latestByKey = {};
  (DATA.attempts||[]).filter(a=> a.type==="bank" || a.syllabus_id===cur).forEach(a=>{
    const ts = new Date(a.timestamp).getTime();
    a.answers.forEach(rec=>{
      if(!rec.isGraded) return;
      const key = `${rec.paperId}::${rec.qid}`;
      if(!latestByKey[key] || latestByKey[key].ts < ts) latestByKey[key] = { ts, rec };
    });
  });
  const idxMap = buildQuestionIndex();
  const out = [];
  Object.values(latestByKey).forEach(({rec})=>{
    if(rec.isCorrect) return;
    const q = idxMap[`${rec.paperId}::${rec.qid}`];
    if(q) out.push(q);
  });
  return out;
}

function priorityBadgeHtml(item){
  if(!item.practiced) return `<span class="pr-badge untried">Not yet practiced</span>`;
  if(item.accuracy<0.5) return `<span class="pr-badge weak">${Math.round(item.accuracy*100)}% accuracy</span>`;
  return `<span class="pr-badge ok">${Math.round(item.accuracy*100)}% accuracy</span>`;
}
function accColor(practiced, pct){
  if(!practiced) return "var(--text-dim-on-ink)";
  return pct>=70 ? "var(--good)" : pct>=40 ? "var(--gold)" : "var(--bad)";
}

function bindStatsQuickActions(){
  const wrongBtn = document.getElementById("practiceWrongBtn");
  if(wrongBtn && !wrongBtn.disabled){
    wrongBtn.addEventListener("click", ()=>{
      const qs = collectWrongQuestions();
      openStartTestModal("wrong-review", "wrong-review", "Wrong-answer review", qs, getCurrentSyllabusId());
    });
  }
  const flagBtn = document.getElementById("reviewFlaggedBtn");
  if(flagBtn && !flagBtn.disabled) flagBtn.addEventListener("click", ()=> pushScreen({ type:"flagged-list" }));
  const weakBtn = document.getElementById("weakBankBtn");
  if(weakBtn) weakBtn.addEventListener("click", openWeakAreaBankModal);
  const mockBtn = document.getElementById("mockExamBtn");
  if(mockBtn) mockBtn.addEventListener("click", openMockExamModal);
}

/* ================= Stats (sub-tabbed) ================= */
const STATS_TABS = [
  ["overview","Overview"],["subjects","Subjects"],["bylevel","Right/Wrong by level"],["time","Time"],["difficulty","Difficulty"],["guess","Guesswork"]
];
function collectAttemptRecords(){
  const idx = buildQuestionIndex();
  const out = [];
  statsAttempts().slice().sort((a,b)=> new Date(a.timestamp)-new Date(b.timestamp)).forEach(a=>{
    (a.answers||[]).forEach(rec=>{
      const q = idx[`${rec.paperId}::${rec.qid}`];
      out.push(Object.assign({}, rec, { ts: new Date(a.timestamp).getTime(), attemptId:a.id, difficulty: rec.difficulty || (q && q.difficulty) || null }));
    });
  });
  return out;
}
function aggregateBy(recs, keyFn){
  const m = {};
  recs.forEach(r=>{ const k = keyFn(r); (m[k] = m[k] || []).push(r); });
  return m;
}
function currentMarking(){
  const m = getSyllabusById(getCurrentSyllabusId()).marking || DEFAULT_MARKING;
  const pos = Number(m.positive)||1, pen = (Number(m.negNum)||0)/(Number(m.negDen)||1);
  return { pos, pen, breakEven: (pos+pen)>0 ? pen/(pos+pen) : 0 };
}
function diffBadgeSmall(avg){
  if(!avg) return "";
  const lvl = avg.avg<=4 ? "E" : avg.avg<=7 ? "M" : "D";
  return `<span class="pill diff-pill diff-${lvl}">${avg.avg}/9</span>`;
}
function statsTabBarHtml(active){
  return `<div class="segmented stats-subtabs" id="statsTabSeg">${STATS_TABS.map(([k,l])=>`<button data-t="${k}" class="${active===k?"active":""}">${l}</button>`).join("")}</div>`;
}
function barRowsHtml(entries, colorFn, valFn){
  if(!entries.length) return `<div class="chart-note">No data yet.</div>`;
  return entries.map(e=>`<div class="bar-row">
      <div class="bar-label">${escapeHtml(e.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,Math.min(100,e.pct))}%;background:${colorFn(e)};"></div></div>
      <div class="bar-val">${valFn(e)}</div></div>`).join("");
}

function statsOverviewHtml(attempts){
  const totalAttempts = attempts.length;
  const basisRecs = pickByBasis(collectAttemptRecords(), isAnsweredGraded);
  const totalGraded = basisRecs.length, totalCorrect = basisRecs.filter(r=>r.isCorrect).length;
  const overallPct = totalGraded? Math.round(100*totalCorrect/totalGraded) : null;
  const { streak, today } = computeStreak();
  const wrongQs = collectWrongQuestions();
  const flaggedQs = collectFlaggedQuestions();
  let html = `<div class="stat-cards">
    <div class="stat-card"><div class="num">${totalAttempts}</div><div class="label">Tests taken</div></div>
    <div class="stat-card"><div class="num">${overallPct===null?"—":overallPct+"%"}</div><div class="label">Accuracy</div></div>
    <div class="stat-card"><div class="num">🔥${streak}</div><div class="label">Day streak</div></div>
    <div class="stat-card"><div class="num">${today}</div><div class="label">Today</div></div>
  </div>`;
  html += `<div class="chart-block">
    <div class="chart-title">Quick practice</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button class="iconbtn ${wrongQs.length?"primary":""}" id="practiceWrongBtn" style="flex:1;justify-content:center;" ${wrongQs.length===0?"disabled":""}>❌ Wrong (${wrongQs.length})</button>
      <button class="iconbtn" id="reviewFlaggedBtn" style="flex:1;justify-content:center;" ${flaggedQs.length===0?"disabled":""}>⭐ Flagged (${flaggedQs.length})</button>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="iconbtn" id="weakBankBtn" style="flex:1;justify-content:center;">📦 Bank from weak areas</button>
      <button class="iconbtn" id="mockExamBtn" style="flex:1;justify-content:center;">🎯 Mock exam</button>
    </div>
  </div>`;
  html += `<div class="chart-block"><div class="chart-title">🤖 AI tools</div>
    <div style="display:flex;gap:8px;">
      <button class="iconbtn" data-ai="plan" style="flex:1;justify-content:center;">🗓️ Study plan</button>
      <button class="iconbtn" data-ai="wrong-mnemonics" style="flex:1;justify-content:center;">🧠 Tricks for wrong</button>
    </div></div>`;
  const due = dueForReviewList();
  if(due.length>0){
    html += `<div class="chart-block"><div class="chart-title">Due for review (${due.length})</div>
      <div class="chart-note">Based on a spaced-repetition schedule from when you last marked each topic studied.</div>
      <div style="max-height:240px;overflow-y:auto;">`;
    due.slice(0,40).forEach(d=>{
      const daysOverdue = Math.floor((Date.now()-d.info.nextReviewAt)/86400000);
      html += `<button type="button" class="priority-row" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;" data-due-subject="${escapeHtml(d.subject)}" data-due-topic="${escapeHtml(d.topic)}">
        <div class="pr-main"><div class="pr-title">${escapeHtml(d.topic)}</div><div class="pr-sub">${escapeHtml(d.subject)} · studied ${d.info.count}×</div></div>
        <span class="pr-badge weak">${daysOverdue<=0?"due today":daysOverdue+"d overdue"}</span></button>`;
    });
    html += `</div></div>`;
  }
  if(totalAttempts===0){
    html += emptyState("No practice tests yet", "Start one from any paper, subject, or topic listing to see your stats here.");
    return html;
  }
  const recent = [...attempts].sort((a,b)=> new Date(a.timestamp)-new Date(b.timestamp)).slice(-10);
  html += `<div class="chart-block"><div class="chart-title">Recent test scores</div>`;
  recent.forEach(a=>{
    const pct = a.totalCount? Math.round(100*a.correctCount/a.totalCount):0;
    const color = pct>=70? "var(--good)" : pct>=40? "var(--gold)" : "var(--bad)";
    html += `<div class="bar-row"><div class="bar-label">${escapeHtml(new Date(a.timestamp).toLocaleDateString())}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div><div class="bar-val">${pct}%</div></div>`;
  });
  return html + `</div>`;
}

function statsSubjectsHtml(screen){
  const sortMode = screen.statsSort || "weak";
  const subjAccMap = computeAccuracyBySubject();
  const subjCounts = computeQuestionCountsBySubject();
  const qs = visibleQuestions();
  let subjRows = Object.keys(subjCounts).map(s=>{
    const acc = subjAccMap[s];
    const practiced = !!acc && acc.total>0;
    return { subject:s, freq:subjCounts[s], practiced, pct: practiced? Math.round(100*acc.correct/acc.total):null,
      answered: practiced?acc.total:0, adj: practiced?acc.adj:null, low: practiced&&acc.low, diff: avgDifficulty(qs.filter(q=>q.subject===s)) };
  });
  if(sortMode==="strong") subjRows.sort((a,b)=> (b.adj===null?-1:b.adj) - (a.adj===null?-1:a.adj));
  else if(sortMode==="most") subjRows.sort((a,b)=> b.freq-a.freq);
  else if(sortMode==="hard") subjRows.sort((a,b)=> (b.diff?b.diff.avg:0)-(a.diff?a.diff.avg:0));
  else subjRows.sort((a,b)=> (a.adj===null?-1:a.adj) - (b.adj===null?-1:b.adj));
  let html = `<div class="chart-block">
    <div class="chart-title">Subject performance — tap to see its topics</div>
    <button class="iconbtn" id="allTopicsBtn" style="width:100%;justify-content:center;margin:6px 0 10px;">📋 View all topics of all subjects</button>
    <div class="segmented" id="statsSortSeg">
      <button data-s="weak" class="${sortMode==='weak'?'active':''}">Weakest</button>
      <button data-s="strong" class="${sortMode==='strong'?'active':''}">Strongest</button>
      <button data-s="most" class="${sortMode==='most'?'active':''}">Most</button>
      <button data-s="hard" class="${sortMode==='hard'?'active':''}">Hardest</button>
    </div><div style="margin-top:8px;">`;
  subjRows.forEach((r,idx)=>{
    html += `<div class="priority-row" style="cursor:pointer;" data-stats-subject="${escapeHtml(r.subject)}">
      <div class="pr-rank">${idx+1}</div>
      <div class="pr-main"><div class="pr-title">${escapeHtml(r.subject)}</div><div class="pr-sub">${r.freq} q in bank${r.practiced?` · ${r.answered} answered${r.low?" ⚠ low data":""}`:""} ${diffBadgeSmall(r.diff)}</div></div>
      <span class="pr-badge" style="background:none;color:${accColor(r.practiced,r.pct)};font-weight:600;">${r.practiced? r.pct+"%":"Not tried"}</span></div>`;
  });
  return html + `</div></div>`;
}

function statsTimeHtml(recs){
  const timed = recs.filter(r=> r.timeMs>0);
  if(!timed.length) return `<div class="chart-note" style="margin:14px 2px;">Time stats appear once you take a test in swipe view (timing isn't tracked in scroll view).</div>`;
  const avgOf = arr => arr.reduce((s,r)=>s+r.timeMs,0)/arr.length;
  let html = `<div class="stat-cards">
    <div class="stat-card"><div class="num">${formatDuration(avgOf(timed))}</div><div class="label">Avg / question</div></div>
    <div class="stat-card"><div class="num">${timed.length}</div><div class="label">Timed answers</div></div></div>`;
  const byDiff = aggregateBy(timed.filter(r=>r.difficulty), r=>r.difficulty);
  const diffEntries = ["E","M","D"].filter(d=>byDiff[d]).map(d=>({label:`${DIFFICULTY_LABELS[d]} (${byDiff[d].length})`, avg:avgOf(byDiff[d])}));
  const mx = Math.max(1,...diffEntries.map(e=>e.avg));
  html += `<div class="chart-block"><div class="chart-title">Avg time by difficulty</div>${barRowsHtml(diffEntries.map(e=>({label:e.label,pct:100*e.avg/mx,avg:e.avg})), ()=>"var(--gold)", e=>formatDuration(e.avg))}</div>`;
  const bySubj = aggregateBy(timed, r=>r.subject);
  const subjEntries = Object.entries(bySubj).map(([s,a])=>({label:s,avg:avgOf(a)})).sort((a,b)=>b.avg-a.avg);
  const mxs = Math.max(1,...subjEntries.map(e=>e.avg));
  html += `<div class="chart-block"><div class="chart-title">Avg time by subject (slowest first)</div><div style="max-height:300px;overflow-y:auto;">${barRowsHtml(subjEntries.map(e=>Object.assign(e,{pct:100*e.avg/mxs})), ()=>"var(--gold)", e=>formatDuration(e.avg))}</div></div>`;
  const byTopic = aggregateBy(timed, r=>`${r.subject}|||${r.topic}`);
  const topicEntries = Object.entries(byTopic).map(([k,a])=>({label:`${k.split("|||")[1]} (${k.split("|||")[0]})`,avg:avgOf(a)})).sort((a,b)=>b.avg-a.avg);
  const mxt = Math.max(1,...topicEntries.map(e=>e.avg));
  html += `<div class="chart-block"><div class="chart-title">Avg time by topic (slowest first)</div><div style="max-height:360px;overflow-y:auto;">${barRowsHtml(topicEntries.map(e=>Object.assign(e,{pct:100*e.avg/mxt})), ()=>"var(--gold)", e=>formatDuration(e.avg))}</div></div>`;
  // time per difficulty, subject-wise and topic-wise
  const cell = (arr,d)=>{ const x=(arr||[]).filter(r=>r.difficulty===d); return x.length? formatDuration(avgOf(x)) : "—"; };
  const tbl = (groups, labelFn)=>`<div style="max-height:320px;overflow:auto;"><table class="diff-table"><tr><th>&nbsp;</th><th>Easy</th><th>Med</th><th>Hard</th></tr>${
    Object.entries(groups).map(([k,a])=>`<tr><td>${escapeHtml(labelFn(k))}</td><td>${cell(a,"E")}</td><td>${cell(a,"M")}</td><td>${cell(a,"D")}</td></tr>`).join("")}</table></div>`;
  html += `<div class="chart-block"><div class="chart-title">Avg time by difficulty — subject-wise</div>${tbl(bySubj,k=>k)}</div>`;
  html += `<div class="chart-block"><div class="chart-title">Avg time by difficulty — topic-wise</div>${tbl(byTopic,k=>k.split("|||")[1]+" · "+k.split("|||")[0])}</div>`;
  return html;
}

function statsDifficultyHtml(recs){
  if(!isDifficultyMarkingEnabled()) return `<div class="chart-note" style="margin:14px 2px;">Difficulty marking is switched off. Turn it on from ⚙️ below to mark and analyse question difficulty.</div>`;
  const qs = visibleQuestions();
  const overall = avgDifficulty(qs);
  let html = `<div class="chart-note">Easy = 3, Medium = 6, Difficult = 9. Averages count only questions you have marked, shown as “n/total marked”.</div>`;
  html += `<div class="stat-cards">
    <div class="stat-card"><div class="num">${overall?overall.avg:"—"}</div><div class="label">Avg difficulty /9</div></div>
    <div class="stat-card"><div class="num">${overall?overall.count:0}/${qs.length}</div><div class="label">Marked</div></div></div>`;
  const dist = {E:0,M:0,D:0}; qs.forEach(q=>{ if(dist[q.difficulty]!==undefined) dist[q.difficulty]++; });
  const dmax = Math.max(1,dist.E,dist.M,dist.D);
  html += `<div class="chart-block"><div class="chart-title">Questions by difficulty</div>${barRowsHtml(["E","M","D"].map(d=>({label:DIFFICULTY_LABELS[d],pct:100*dist[d]/dmax,n:dist[d],d})), e=>e.d==="E"?"var(--good)":e.d==="M"?"var(--gold)":"var(--bad)", e=>e.n)}</div>`;
  const graded = recs.filter(r=>r.isGraded && r.difficulty);
  const accE = ["E","M","D"].map(d=>{ const a=graded.filter(r=>r.difficulty===d); return {label:`${DIFFICULTY_LABELS[d]} (${a.length})`, pct: a.length? 100*a.filter(r=>r.isCorrect).length/a.length:0, n:a.length, d}; });
  html += `<div class="chart-block"><div class="chart-title">Your accuracy by difficulty</div>${graded.length? barRowsHtml(accE, e=>e.d==="E"?"var(--good)":e.d==="M"?"var(--gold)":"var(--bad)", e=>e.n?Math.round(e.pct)+"%":"—") : `<div class="chart-note">Take tests on marked questions to see this.</div>`}</div>`;
  const rowsFor = (keyFn, labelFn)=>{
    const g = aggregateBy(qs.filter(q=>q.difficulty), keyFn);
    const tot = aggregateBy(qs, keyFn);
    return Object.keys(g).map(k=>{ const a=avgDifficulty(tot[k]); return {label:labelFn(k)+` (${a.count}/${a.total})`, pct:100*a.avg/9, avg:a.avg}; }).sort((a,b)=>b.avg-a.avg);
  };
  const col = e=> e.avg<=4?"var(--good)":e.avg<=7?"var(--gold)":"var(--bad)";
  html += `<div class="chart-block"><div class="chart-title">Avg difficulty by subject</div>${barRowsHtml(rowsFor(q=>q.subject,k=>k),col,e=>e.avg)}</div>`;
  html += `<div class="chart-block"><div class="chart-title">Avg difficulty by topic</div><div style="max-height:360px;overflow-y:auto;">${barRowsHtml(rowsFor(q=>`${q.subject}|||${q.topic||FALLBACK_TOPIC}`,k=>k.split("|||")[1]+" · "+k.split("|||")[0]),col,e=>e.avg)}</div></div>`;
  const byPaper = aggregateBy(qs.filter(q=>q.difficulty), q=>q._paperId);
  const totPaper = aggregateBy(qs, q=>q._paperId);
  const paperRows = Object.keys(byPaper).map(k=>{ const a=avgDifficulty(totPaper[k]); const nm=(DATA.papers.find(p=>p.id===k)||{}).name||k; return {label:`${nm} (${a.count}/${a.total})`,pct:100*a.avg/9,avg:a.avg}; }).sort((a,b)=>b.avg-a.avg);
  html += `<div class="chart-block"><div class="chart-title">Avg difficulty by exam</div>${barRowsHtml(paperRows,col,e=>e.avg)}</div>`;
  return html;
}

function guessSummary(arr, mk){
  const g = arr.filter(r=>r.guessed && r.isGraded && r.selectedIndex!==null && r.selectedIndex!==undefined);
  const right = g.filter(r=>r.isCorrect).length, wrong = g.length-right;
  const net = right*mk.pos - wrong*mk.pen;
  return { n:g.length, right, wrong, net: Math.round(net*100)/100, acc: g.length? right/g.length : null };
}
function statsGuessHtml(recs, screen){
  const mk = currentMarking();
  const all = guessSummary(recs, mk);
  let html = `<button class="iconbtn" data-ai="guess-coach" style="width:100%;justify-content:center;margin-bottom:10px;">🎓 AI guess coach</button><div class="chart-block"><div class="chart-title">How guessing pays off</div>
    <div class="chart-note">Marking: +${mk.pos} right, −${Math.round(mk.pen*100)/100} wrong. Break-even accuracy = penalty ÷ (mark + penalty) = <b>${Math.round(mk.breakEven*1000)/10}%</b>. Guess only when your chance of being right is above this; below it, guessing loses marks on average.</div></div>`;
  if(!all.n) return html + `<div class="chart-note" style="margin:14px 2px;">Tap “🤔 Guess” on a question during a test to start collecting guess data.</div>`;
  const marks = r=> (r>0?"+":"")+r;
  const verdict = all.acc>=mk.breakEven ? "👍 Your guesses are paying off" : "⚠️ Your guesses are costing marks";
  html += `<div class="stat-cards">
    <div class="stat-card"><div class="num">${all.n}</div><div class="label">Guessed</div></div>
    <div class="stat-card"><div class="num">${Math.round(all.acc*100)}%</div><div class="label">Guess accuracy</div></div>
    <div class="stat-card"><div class="num" style="color:${all.net>=0?"var(--good)":"var(--bad)"}">${marks(all.net)}</div><div class="label">Net marks</div></div>
    <div class="stat-card"><div class="num">${all.right}✓ ${all.wrong}✗</div><div class="label">Right / wrong</div></div></div>
    <div class="chart-note" style="margin:0 2px 10px;">${verdict} (break-even ${Math.round(mk.breakEven*100)}%). Marks gained: +${Math.round(all.right*mk.pos*100)/100}, lost: −${Math.round(all.wrong*mk.pen*100)/100}.</div>`;
  const mode = screen.guessScope || "subject", sort = screen.guessSort || "net-asc";
  const groups = aggregateBy(recs.filter(r=>r.guessed), r=> mode==="subject"? r.subject : `${r.subject}|||${r.topic}`);
  let rows = Object.entries(groups).map(([k,a])=>{ const s=guessSummary(a,mk); return Object.assign(s,{label: mode==="subject"?k:k.split("|||")[1]+" · "+k.split("|||")[0]}); }).filter(s=>s.n>0);
  if(sort==="net-asc") rows.sort((a,b)=>a.net-b.net); else if(sort==="net-desc") rows.sort((a,b)=>b.net-a.net); else rows.sort((a,b)=>b.n-a.n);
  html += `<div class="segmented" id="guessScopeSeg"><button data-g="subject" class="${mode==='subject'?'active':''}">By subject</button><button data-g="topic" class="${mode==='topic'?'active':''}">By topic</button></div>
    <div class="segmented" id="guessSortSeg" style="margin-top:6px;"><button data-g="net-asc" class="${sort==='net-asc'?'active':''}">Most lost</button><button data-g="net-desc" class="${sort==='net-desc'?'active':''}">Most gained</button><button data-g="count" class="${sort==='count'?'active':''}">Most guesses</button></div>
    <div style="margin-top:8px;max-height:420px;overflow-y:auto;">`;
  rows.forEach((r,i)=>{
    html += `<div class="priority-row"><div class="pr-rank">${i+1}</div>
      <div class="pr-main"><div class="pr-title">${escapeHtml(r.label)}</div><div class="pr-sub">${r.n} guessed · ${r.right}✓ ${r.wrong}✗ · ${Math.round(r.acc*100)}% ${r.acc>=mk.breakEven?"(above":"(below"} break-even)</div></div>
      <span class="pr-badge" style="background:none;color:${r.net>=0?"var(--good)":"var(--bad)"};font-weight:600;">${marks(r.net)}</span></div>`;
  });
  return html + `</div>`;
}

function pctOf(a,b){ return b? Math.round(100*a/b) : null; }
function levelCounts(arr){
  const r = arr.filter(x=>x.isCorrect).length;
  return { right:r, wrong:arr.length-r, total:arr.length };
}
function statsByLevelHtml(recs){
  if(!isDifficultyMarkingEnabled()) return `<div class="chart-note" style="margin:14px 2px;">Difficulty marking is switched off. Turn it on from ⚙️ below to analyse results by difficulty.</div>`;
  if(!recs.length) return `<div class="chart-note" style="margin:14px 2px;">No answered questions yet in this stats window. Take a test to see this.</div>`;
  const levels = [["E","Easy"],["M","Medium"],["D","Difficult"],[null,"Not marked"]];
  const grp = aggregateBy(recs, r=> r.difficulty || "U");
  let html = `<div class="chart-note">Counted on the “${getStatsBasis()==="first"?"first attempt":getStatsBasis()==="latest"?"latest attempt":"every attempt"}” basis · only answered questions are included.</div>
    <div class="chart-block"><div class="chart-title">Right vs wrong by difficulty</div>
    <table class="diff-table"><tr><th>Level</th><th>Right</th><th>Wrong</th><th>Right %</th><th>Wrong %</th></tr>`;
  let tR=0,tW=0;
  levels.forEach(([k,label])=>{
    const c = levelCounts(grp[k||"U"]||[]); tR+=c.right; tW+=c.wrong;
    if(!c.total && !k) return;
    html += `<tr><td>${label}${c.total?` <span class="ai-sub">(${c.total})</span>`:""}</td><td style="color:var(--good)">${c.right}</td><td style="color:var(--bad)">${c.wrong}</td><td>${c.total?pctOf(c.right,c.total)+"%":"—"}</td><td>${c.total?pctOf(c.wrong,c.total)+"%":"—"}</td></tr>`;
  });
  html += `<tr><td><b>All</b></td><td><b>${tR}</b></td><td><b>${tW}</b></td><td><b>${pctOf(tR,tR+tW)}%</b></td><td><b>${pctOf(tW,tR+tW)}%</b></td></tr></table></div>`;
  const cell = (arr,d)=>{ const x=(arr||[]).filter(r=>r.difficulty===d); if(!x.length) return "—"; const c=levelCounts(x); return `${c.right}/${c.wrong}<br><span class="ai-sub">${pctOf(c.right,c.total)}%</span>`; };
  const tbl = (groups,labelFn)=>`<div style="max-height:340px;overflow:auto;"><table class="diff-table"><tr><th>&nbsp;</th><th>Easy<br><span class="ai-sub">R/W</span></th><th>Med<br><span class="ai-sub">R/W</span></th><th>Hard<br><span class="ai-sub">R/W</span></th></tr>${
    Object.entries(groups).sort((a,b)=>b[1].length-a[1].length).map(([k,a])=>`<tr><td>${escapeHtml(labelFn(k))}</td><td>${cell(a,"E")}</td><td>${cell(a,"M")}</td><td>${cell(a,"D")}</td></tr>`).join("")}</table></div>`;
  html += `<div class="chart-block"><div class="chart-title">By subject (right/wrong · right %)</div>${tbl(aggregateBy(recs,r=>r.subject),k=>k)}</div>`;
  html += `<div class="chart-block"><div class="chart-title">By topic (right/wrong · right %)</div>${tbl(aggregateBy(recs,r=>`${r.subject}|||${r.topic}`),k=>k.split("|||")[1]+" · "+k.split("|||")[0])}</div>`;
  return html;
}

function statsBasisBlockHtml(){
  const b = getStatsBasis();
  const since = getStatsResetAt() ? `Counting tests since ${new Date(getStatsResetAt()).toLocaleDateString()}. ` : "";
  return `<div class="chart-block" style="margin:10px 0;">
    <div class="chart-title" style="font-size:0.85rem;">How questions are counted</div>
    <div class="segmented" id="basisSeg">
      <button data-b="first" class="${b==='first'?'active':''}">First attempt</button>
      <button data-b="latest" class="${b==='latest'?'active':''}">Latest attempt</button>
      <button data-b="all" class="${b==='all'?'active':''}">All attempts</button>
    </div>
    <div class="chart-note">${since}Tests have different sizes, and the same question can appear in many tests. <b>First attempt</b> (recommended) counts each question once — your cold knowledge — so topic, subject, exam and custom tests all weigh the same and repeated practice can’t inflate or deflate %. Only answered questions count. Rankings use a small-sample adjustment, and ⚠ marks topics with fewer than ${STATS_LOW_N} answers.</div>
  </div>`;
}
function openResetStatsModal(){
  modalRoot.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
    <h3>Start fresh stats</h3>
    <div class="chart-note">Your papers, questions, notes, labels, topic lists, banks and study counts are never touched.</div>
    <div class="field"><button class="iconbtn primary" id="resetKeep" style="width:100%;justify-content:center;">Reset stats — keep test history</button>
      <div class="chart-note">Stats start from zero now. Old tests stay in the Attempts tab and can be deleted one by one.</div></div>
    <div class="field"><button class="iconbtn bad" id="resetDel" style="width:100%;justify-content:center;">Reset stats AND delete all test history</button>
      <div class="chart-note">Permanently removes every saved test attempt. Also clears the wrong-answer queue.</div></div>
    <div class="row-btns"><button class="iconbtn" id="resetCancel" style="flex:1;justify-content:center;">Cancel</button></div>
  </div></div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("resetCancel").addEventListener("click", closeModal);
  document.getElementById("resetKeep").addEventListener("click", ()=>{
    if(!confirm("Reset stats from now on? Test history is kept.")) return;
    DATA.statsResetAt = Date.now(); saveData(DATA); closeModal(); render(); toast("Stats reset");
  });
  document.getElementById("resetDel").addEventListener("click", ()=>{
    if(!confirm("Delete ALL test attempts permanently? This can't be undone.")) return;
    DATA.attempts = []; DATA.statsResetAt = Date.now(); saveData(DATA); closeModal(); render(); toast("Stats and test history deleted");
  });
}
function deleteAttemptById(id){
  DATA.attempts = (DATA.attempts||[]).filter(a=>a.id!==id);
  saveData(DATA);
}

function renderStatsScreen(){
  const screen = currentScreen();
  const cur = getCurrentSyllabusId();
  const tab = screen.statsTab || "overview";
  const attempts = statsAttempts();
  const allRecs = collectAttemptRecords();
  const answeredRecs = pickByBasis(allRecs, isAnsweredGraded);
  let html = `<div class="detail-head"><div style="width:100%"><h2>Performance</h2><div class="meta">${escapeHtml(getSyllabusById(cur).name)} syllabus</div></div></div>`;
  html += statsTabBarHtml(tab);
  html += statsBasisBlockHtml();
  if(tab==="overview") html += statsOverviewHtml(attempts);
  else if(tab==="subjects") html += statsSubjectsHtml(screen);
  else if(tab==="bylevel") html += statsByLevelHtml(answeredRecs);
  else if(tab==="time") html += statsTimeHtml(pickByBasis(allRecs, hasTimeRec));
  else if(tab==="difficulty") html += statsDifficultyHtml(answeredRecs);
  else if(tab==="guess") html += statsGuessHtml(pickByBasis(allRecs, r=>r.guessed && isAnsweredGraded(r)), screen);
  const on = isDifficultyMarkingEnabled();
  html += `<div class="chart-block" style="margin-top:18px;"><label class="switch-row"><input type="checkbox" id="diffSwitch" ${on?"checked":""}> ⚙️ Allow difficulty marking (E / M / D) on questions</label></div>
    <button class="iconbtn bad" id="resetStatsBtn" style="width:100%;justify-content:center;margin-top:10px;">🧹 Start fresh stats…</button>`;
  mainEl.innerHTML = html;
  document.querySelectorAll("#basisSeg button").forEach(b=> b.addEventListener("click", ()=>{ setStatsBasis(b.dataset.b); render(); }));
  document.getElementById("resetStatsBtn").addEventListener("click", openResetStatsModal);
  document.querySelectorAll("#statsTabSeg button").forEach(b=> b.addEventListener("click", ()=>{ screen.statsTab = b.dataset.t; render(); }));
  document.getElementById("diffSwitch").addEventListener("change", e=>{ setDifficultyMarkingEnabled(e.target.checked); toast(e.target.checked?"Difficulty marking on":"Difficulty marking off"); render(); });
  if(tab==="overview"){
    bindStatsQuickActions();
    document.querySelectorAll("[data-due-subject]").forEach(btn=>{
      btn.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject: btn.dataset.dueSubject, topic: btn.dataset.dueTopic }));
    });
  }
  if(tab==="subjects"){
    document.querySelectorAll("#statsSortSeg button").forEach(btn=> btn.addEventListener("click", ()=>{ screen.statsSort = btn.dataset.s; render(); }));
    document.querySelectorAll("[data-stats-subject]").forEach(row=> row.addEventListener("click", ()=> pushScreen({ type:"stats-subject", subject: row.dataset.statsSubject })));
    document.getElementById("allTopicsBtn").addEventListener("click", ()=> pushScreen({ type:"stats-all-topics" }));
  }
  if(tab==="guess"){
    const gs = document.getElementById("guessScopeSeg"), gt = document.getElementById("guessSortSeg");
    if(gs) gs.querySelectorAll("button").forEach(b=> b.addEventListener("click", ()=>{ screen.guessScope=b.dataset.g; render(); }));
    if(gt) gt.querySelectorAll("button").forEach(b=> b.addEventListener("click", ()=>{ screen.guessSort=b.dataset.g; render(); }));
  }
}

function renderStatsAllTopics(){
  const screen = currentScreen();
  const sortMode = screen.statsSortAll || "weak";
  const topicAccMap = computeAccuracyByTopic();
  const topicCounts = computeQuestionCountsByTopic();
  const qs = visibleQuestions();
  let rows = Object.keys(topicCounts).map(k=>{
    const [subject, topic] = k.split("|||");
    const acc = topicAccMap[k];
    const practiced = !!acc && acc.total>0;
    return { subject, topic, freq: topicCounts[k], practiced, pct: practiced? Math.round(100*acc.correct/acc.total):null,
      adj: practiced?acc.adj:null, n: practiced?acc.total:0, low: practiced&&acc.low, diff: avgDifficulty(qs.filter(q=>q.subject===subject && (q.topic||FALLBACK_TOPIC)===topic)) };
  });
  if(sortMode==="strong") rows.sort((a,b)=> (b.adj===null?-1:b.adj)-(a.adj===null?-1:a.adj));
  else if(sortMode==="most") rows.sort((a,b)=> b.freq-a.freq);
  else if(sortMode==="hard") rows.sort((a,b)=> (b.diff?b.diff.avg:0)-(a.diff?a.diff.avg:0));
  else if(sortMode==="az") rows.sort((a,b)=> a.topic.localeCompare(b.topic));
  else rows.sort((a,b)=> (a.adj===null?-1:a.adj)-(b.adj===null?-1:b.adj));
  let html = `<div class="detail-head"><div style="width:100%"><div class="backrow" id="backBtn">‹ Back to Stats</div>
    <h2>All topics</h2><div class="meta">${rows.length} topics across all subjects</div></div></div>
    <div class="segmented" id="allSortSeg">
      <button data-s="weak" class="${sortMode==='weak'?'active':''}">Weakest</button>
      <button data-s="strong" class="${sortMode==='strong'?'active':''}">Strongest</button>
      <button data-s="most" class="${sortMode==='most'?'active':''}">Most</button>
      <button data-s="hard" class="${sortMode==='hard'?'active':''}">Hardest</button>
      <button data-s="az" class="${sortMode==='az'?'active':''}">A–Z</button></div><div style="margin-top:8px;">`;
  rows.forEach((r,idx)=>{
    html += `<div class="priority-row" style="cursor:pointer;" data-subj="${escapeHtml(r.subject)}" data-topic="${escapeHtml(r.topic)}">
      <div class="pr-rank">${idx+1}</div>
      <div class="pr-main"><div class="pr-title">${escapeHtml(r.topic)} ${labelPillHtml(r.subject,r.topic)}</div><div class="pr-sub">${escapeHtml(r.subject)} · ${r.freq} q${r.practiced?` · ${r.n} answered${r.low?" ⚠":""}`:""} ${diffBadgeSmall(r.diff)}</div></div>
      <span class="pr-badge" style="background:none;color:${accColor(r.practiced,r.pct)};font-weight:600;">${r.practiced? r.pct+"%":"Not tried"}</span></div>`;
  });
  mainEl.innerHTML = html + `</div>`;
  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.querySelectorAll("#allSortSeg button").forEach(b=> b.addEventListener("click", ()=>{ screen.statsSortAll=b.dataset.s; render(); }));
  document.querySelectorAll("[data-topic]").forEach(row=> row.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject:row.dataset.subj, topic:row.dataset.topic })));
}

function renderStatsSubject(subject){
  const screen = currentScreen();
  const sortMode = screen.statsSort2 || "weak";
  const topicAccMap = computeAccuracyByTopic();
  const topicCounts = computeQuestionCountsByTopic();
  let rows = Object.keys(topicCounts).filter(k=>k.startsWith(subject+"|||")).map(k=>{
    const topic = k.slice(subject.length+3);
    const acc = topicAccMap[k];
    const practiced = !!acc && acc.total>0;
    const pct = practiced ? Math.round(100*acc.correct/acc.total) : null;
    return { topic, freq: topicCounts[k], practiced, pct, adj: practiced?acc.adj:null, n: practiced?acc.total:0, low: practiced&&acc.low, studied: getStudyCount(subject,topic), attemptCount: countTopicAttempts(subject,topic) };
  });

  if(sortMode==="strong") rows.sort((a,b)=> (b.adj===null?-1:b.adj)-(a.adj===null?-1:a.adj));
  else if(sortMode==="most") rows.sort((a,b)=> b.freq-a.freq);
  else rows.sort((a,b)=> (a.adj===null?-1:a.adj)-(b.adj===null?-1:b.adj));

  let html = `<div class="detail-head">
    <div style="width:100%">
      <div class="backrow" id="backBtn">‹ Back to Stats</div>
      <h2>${escapeHtml(subject)}</h2>
      <div class="meta">${rows.length} topic${rows.length===1?"":"s"} in this subject</div>
    </div>
  </div>`;
  html += `<div class="segmented" id="statsSortSeg2">
    <button data-s="weak" class="${sortMode==='weak'?'active':''}">Weakest first</button>
    <button data-s="strong" class="${sortMode==='strong'?'active':''}">Strongest first</button>
    <button data-s="most" class="${sortMode==='most'?'active':''}">Most in bank</button>
  </div>`;

  if(rows.length===0){
    html += emptyState("No topics here", "");
  } else {
    html += `<div style="margin-top:8px;">`;
    rows.forEach((r,idx)=>{
      const pctLabel = r.practiced ? r.pct+"%" : "Not tried";
      const bits = [`${r.freq} q`];
      if(r.practiced) bits.push(`${r.n} answered${r.low?" ⚠":""}`);
      if(r.studied) bits.push(`📖 ${r.studied}×`);
      if(r.attemptCount) bits.push(`📝 ${r.attemptCount}`);
      html += `<div class="priority-row" style="cursor:pointer;" data-stats-topic="${escapeHtml(r.topic)}">
        <div class="pr-rank">${idx+1}</div>
        <div class="pr-main"><div class="pr-title">${escapeHtml(r.topic)}</div><div class="pr-sub">${bits.join(" · ")}</div></div>
        <span class="pr-badge" style="background:none;color:${accColor(r.practiced,r.pct)};font-weight:600;">${pctLabel}</span>
      </div>`;
    });
    html += `</div>`;
  }

  mainEl.innerHTML = html;
  document.getElementById("backBtn").addEventListener("click", popScreen);
  document.querySelectorAll("#statsSortSeg2 button").forEach(btn=>{
    btn.addEventListener("click", ()=>{ screen.statsSort2 = btn.dataset.s; render(); });
  });
  document.querySelectorAll("[data-stats-topic]").forEach(row=>{
    row.addEventListener("click", ()=> pushScreen({ type:"topic-detail", subject, topic: row.dataset.statsTopic }));
  });
}

function renderFlaggedList(){
  const questions = collectFlaggedQuestions();
  renderQuestionListScreen({
    backLabel: "Back to Stats",
    onBack: popScreen,
    title: "Flagged questions",
    meta: `${questions.length} question${questions.length===1?"":"s"}`,
    questions,
    allowPractice: true,
    practiceInfo: { sourceType:"flagged", scopeKey:"flagged", scopeLabel:"Flagged questions", syllabusId: getCurrentSyllabusId() }
  });
}

/* ================= Notes tab ================= */
function renderNotesRoot(){
  const searchTerm = getSearch().toLowerCase();
  const notes = Object.entries(DATA.listingNotes||{}).map(([key,n])=>Object.assign({key},n))
    .filter(n=> n.text && (!searchTerm || n.text.toLowerCase().includes(searchTerm) || (n.label||"").toLowerCase().includes(searchTerm)))
    .sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
  const legacyAll = collectNotedQuestions().filter(q=>(q._syllabusId||"default")===getCurrentSyllabusId());
  const legacy = searchTerm ? legacyAll.filter(q=> q.note.toLowerCase().includes(searchTerm) || q.question_text.toLowerCase().includes(searchTerm)) : legacyAll;

  if(Object.keys(DATA.listingNotes||{}).length===0 && legacyAll.length===0){
    mainEl.innerHTML = emptyState("No notes yet", "Open any paper, subject, topic, bank or topic list and tap “📝 My note” — each listing has one note, and they all show up here with a link back.");
    return;
  }
  let html = `<input class="search" id="searchBox" placeholder="Search notes…" value="${escapeHtml(getSearch())}">`;
  html += `<div id="listWrap">`;
  notes.forEach((n, idx)=>{
    html += `<div class="row" data-note-key="${escapeHtml(n.key)}">
      <div class="num">${String(idx+1).padStart(2,"0")}</div>
      <div class="main">
        <div class="title">${escapeHtml(n.label||n.key)}</div>
        <div class="sub" style="white-space:pre-wrap;">${escapeHtml(n.text.slice(0,140))}${n.text.length>140?"…":""}</div>
      </div>
      <button class="actbtn" data-edit-note="${escapeHtml(n.key)}" title="Edit note">✎</button>
      <div class="count">${n.nav?"→":""}</div>
    </div>`;
  });
  html += `</div>`;
  if(legacy.length){
    html += `<div class="chart-title" style="margin:18px 0 6px;">Older per-question notes (${legacy.length})</div><div class="chart-note">Notes are now kept per listing. These older question notes are preserved here.</div><div id="legacyWrap">`;
    legacy.forEach((q, idx)=>{
      html += `<div class="row" data-paper-id="${escapeHtml(q._paperId)}">
        <div class="num">${String(idx+1).padStart(2,"0")}</div>
        <div class="main"><div class="title">${escapeHtml(q.note.slice(0,70))}${q.note.length>70?"…":""}</div>
        <div class="sub">${escapeHtml(q._paperName)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.topic||FALLBACK_TOPIC)}</div></div>
        <div class="count">→</div></div>`;
    });
    html += `</div>`;
  }
  mainEl.innerHTML = html;
  const byKey = k => (DATA.listingNotes||{})[k];
  document.querySelectorAll("#listWrap .row").forEach(row=>{
    row.addEventListener("click", ()=>{
      const n = byKey(row.dataset.noteKey);
      if(n && n.nav) pushScreen(Object.assign({}, n.nav));
      else if(n) openListingNoteModal({ key:row.dataset.noteKey, label:n.label, nav:n.nav });
    });
  });
  document.querySelectorAll("[data-edit-note]").forEach(b=> b.addEventListener("click", (e)=>{
    e.stopPropagation(); const n = byKey(b.dataset.editNote); if(n) openListingNoteModal({ key:b.dataset.editNote, label:n.label, nav:n.nav });
  }));
  document.querySelectorAll("#legacyWrap .row").forEach(row=> row.addEventListener("click", ()=> pushScreen({ type:"paper-detail", paperId: row.dataset.paperId })));
  bindSearchInput(renderNotesRoot);
}

/* ================= Topic priority lists ================= */


function openTopicListPickerModal(listId){
  const qs = visibleQuestions();
  const counts = {};
  qs.forEach(q=>{ const k=`${q.subject}|||${q.topic||FALLBACK_TOPIC}`; counts[k]=(counts[k]||0)+1; });
  const all = Object.keys(counts).map(k=>{ const [subject,topic]=k.split("|||"); return {subject,topic,count:counts[k]}; })
    .sort((a,b)=> a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  const list = findTopicList(listId);
  const already = new Set(list.items.map(it=>`${it.subject}|||${it.topic}`));
  let term = "";

  function filtered(){
    const t = term.toLowerCase();
    return all.filter(x=> !already.has(`${x.subject}|||${x.topic}`) && (!t || x.topic.toLowerCase().includes(t) || x.subject.toLowerCase().includes(t)));
  }
  function draw(){
    modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Add topics to "${escapeHtml(list.name)}"</h3>
        <input class="search" id="tlpSearch" placeholder="Search topics or subjects…" value="${escapeHtml(term)}">
        <div style="max-height:46vh;overflow-y:auto;margin-top:8px;">
          ${filtered().map(x=>`<button type="button" class="check-item" data-subject="${escapeHtml(x.subject)}" data-topic="${escapeHtml(x.topic)}">
            <span style="flex:1;"><div>${escapeHtml(x.topic)}</div><div class="ci-sub">${escapeHtml(x.subject)} · ${x.count} q</div></span>
          </button>`).join("") || `<div class="meta">No more topics match.</div>`}
        </div>
        <div class="row-btns"><button class="iconbtn" id="closeTlp" style="width:100%;justify-content:center;">Done</button></div>
      </div>
    </div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop"){ closeModal(); render(); } });
    document.getElementById("closeTlp").addEventListener("click", ()=>{ closeModal(); render(); });
    document.getElementById("tlpSearch").addEventListener("input",(e)=>{
      const pos = e.target.selectionStart;
      term = e.target.value; draw();
      const nb = document.getElementById("tlpSearch");
      if(nb){ nb.focus(); nb.setSelectionRange(pos,pos); }
    });
    document.querySelectorAll("[data-subject][data-topic]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        addTopicToList(listId, btn.dataset.subject, btn.dataset.topic);
        already.add(`${btn.dataset.subject}|||${btn.dataset.topic}`);
        draw();
      });
    });
  }
  draw();
}

/* ================= Topic label modal ================= */
function openTopicLabelModal(subject, topic){
  const current = getTopicLabel(subject, topic);
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Label this topic</h3>
      <div class="meta" style="margin-bottom:10px;">${escapeHtml(subject)} — ${escapeHtml(topic)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        ${TOPIC_LABEL_PALETTE.map(p=>`<button type="button" class="label-swatch ${current&&current.name===p.name?"selected":""}" data-name="${escapeHtml(p.name)}" data-color="${p.color}" style="background:${p.color};"></button>`).join("")}
      </div>
      <div class="row-btns">
        ${current ? `<button class="iconbtn" id="clearLabelBtn" style="flex:1;justify-content:center;">Remove label</button>` : ""}
        <button class="iconbtn" id="closeLabelModal" style="flex:1;justify-content:center;">Close</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("closeLabelModal").addEventListener("click", closeModal);
  const clearBtn = document.getElementById("clearLabelBtn");
  if(clearBtn) clearBtn.addEventListener("click", ()=>{ setTopicLabel(subject, topic, null); closeModal(); render(); toast("Label removed"); });
  document.querySelectorAll(".label-swatch").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setTopicLabel(subject, topic, { name: btn.dataset.name, color: btn.dataset.color });
      closeModal();
      render();
      toast(`Labeled "${btn.dataset.name}"`);
    });
  });
}

/* ---- Build a practice bank from the current priority (weak-area) list ---- */
function openWeakAreaBankModal(){
  modalRoot.innerHTML = `
  <div class="modal-backdrop" id="backdrop">
    <div class="modal">
      <h3>Build a bank from weak areas</h3>
      <div class="field"><label>How many topics to pull from (ranked by priority)</label><input type="number" id="weakTopN" min="1" max="30" value="8"></div>
      <div class="field"><label>Max questions per topic</label><input type="number" id="weakPerArea" min="1" max="50" value="10"></div>
      <div class="row-btns">
        <button class="iconbtn" id="cancelWeak" style="flex:1;justify-content:center;">Cancel</button>
        <button class="iconbtn primary" id="confirmWeak" style="flex:1;justify-content:center;">Create bank</button>
      </div>
    </div>
  </div>`;
  document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
  document.getElementById("cancelWeak").addEventListener("click", closeModal);
  document.getElementById("confirmWeak").addEventListener("click", ()=>{
    const topN = Math.max(1, parseInt(document.getElementById("weakTopN").value,10)||8);
    const perArea = Math.max(1, parseInt(document.getElementById("weakPerArea").value,10)||10);
    const { topicItems } = computePriorityList();
    const chosen = topicItems.slice(0, topN);
    const qs = visibleQuestions();
    const refs = [];
    const seen = new Set();
    chosen.forEach(item=>{
      const pool = qs.filter(q=> q.subject===item.sublabel && (q.topic||FALLBACK_TOPIC)===item.label
        && q.correct_answer_index!==null && q.correct_answer_index!==undefined && Number(q.correct_answer_index)!==DELETED_SENTINEL);
      sampleRandom(pool, perArea).forEach(q=>{
        const key = `${q._paperId}::${q.id}`;
        if(!seen.has(key)){ seen.add(key); refs.push({ paperId:q._paperId, qid:String(q.id) }); }
      });
    });
    if(refs.length===0){ alert("No gradable questions found in your top weak areas yet."); return; }
    const name = `Weak areas – ${new Date().toLocaleDateString()}`;
    const bank = { id: slugify(name), name, questionRefs: refs };
    DATA.banks.push(bank);
    saveData(DATA);
    closeModal();
    pushScreen({ type:"bank" });
    pushScreen({ type:"bank-detail", bankId: bank.id });
    toast(`Created bank with ${refs.length} question(s)`);
  });
}

/* ---- Mock exam: weighted random sampling by subject ---- */
function distributeProportionally(items, target){
  const totalFreq = items.reduce((s,i)=>s+i.freq, 0) || 1;
  const cappedTarget = Math.min(target, totalFreq);
  const raw = items.map(i=>({ key:i.key, freq:i.freq, exact: Math.min(i.freq, cappedTarget*i.freq/totalFreq) }));
  const floors = raw.map(r=>({ key:r.key, freq:r.freq, floor: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let allocated = floors.reduce((s,f)=>s+f.floor, 0);
  let remaining = cappedTarget - allocated;
  const result = {};
  floors.forEach(f=>{ result[f.key] = f.floor; });
  floors.sort((a,b)=> b.rem - a.rem);
  for(let i=0; i<floors.length && remaining>0; i++){
    if(result[floors[i].key] < floors[i].freq){ result[floors[i].key]++; remaining--; }
  }
  return result;
}
function openMockExamModal(){
  const qs = visibleQuestions().filter(q=> q.correct_answer_index!==null && q.correct_answer_index!==undefined && Number(q.correct_answer_index)!==DELETED_SENTINEL);
  const bySubject = {};
  qs.forEach(q=>{ if(!bySubject[q.subject]) bySubject[q.subject]=[]; bySubject[q.subject].push(q); });
  const subjects = Object.keys(bySubject).sort((a,b)=>a.localeCompare(b));
  if(subjects.length===0){ alert("No gradable questions in this syllabus yet."); return; }
  let counts = {}; subjects.forEach(s=> counts[s] = 0);

  function draw(){
    const total = Object.values(counts).reduce((a,b)=>a+b,0);
    modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Create mock exam</h3>
        <div class="meta" style="margin-bottom:10px;">Auto-distribute a target total proportionally to each subject's share of your question bank, or set counts manually.</div>
        <div class="field" style="display:flex;gap:8px;align-items:flex-end;">
          <div style="flex:1;"><label>Target total</label><input type="number" id="mockTarget" min="1" value="50"></div>
          <button class="iconbtn" id="autoDistBtn">Auto-distribute</button>
        </div>
        <div class="divider">— per-subject counts —</div>
        <div id="mockSubjList" style="max-height:38vh;overflow-y:auto;">
          ${subjects.map(s=>`<div class="marking-row" style="justify-content:space-between;">
            <span style="flex:1;">${escapeHtml(s)} <span class="meta">(${bySubject[s].length} available)</span></span>
            <input type="number" class="mockCountInput" data-subject="${escapeHtml(s)}" min="0" max="${bySubject[s].length}" value="${counts[s]}" style="width:64px;">
          </div>`).join("")}
        </div>
        <div class="meta" style="margin:8px 0;">Total selected: <strong id="mockTotalLabel">${total}</strong></div>
        <div class="row-btns">
          <button class="iconbtn" id="cancelMock" style="flex:1;justify-content:center;">Cancel</button>
          <button class="iconbtn primary" id="confirmMock" style="flex:1;justify-content:center;">Continue</button>
        </div>
      </div>
    </div>`;
    document.getElementById("backdrop").addEventListener("click",(e)=>{ if(e.target.id==="backdrop") closeModal(); });
    document.getElementById("cancelMock").addEventListener("click", closeModal);
    document.querySelectorAll(".mockCountInput").forEach(inp=>{
      inp.addEventListener("input", ()=>{
        counts[inp.dataset.subject] = Math.max(0, Math.min(bySubject[inp.dataset.subject].length, parseInt(inp.value,10)||0));
        const lbl = document.getElementById("mockTotalLabel");
        if(lbl) lbl.textContent = Object.values(counts).reduce((a,b)=>a+b,0);
      });
    });
    document.getElementById("autoDistBtn").addEventListener("click", ()=>{
      const target = Math.max(1, parseInt(document.getElementById("mockTarget").value,10)||50);
      counts = distributeProportionally(subjects.map(s=>({key:s, freq:bySubject[s].length})), target);
      draw();
    });
    document.getElementById("confirmMock").addEventListener("click", ()=>{
      const chosen = [];
      subjects.forEach(s=>{ sampleRandom(bySubject[s], counts[s]||0).forEach(q=> chosen.push(q)); });
      if(chosen.length===0){ alert("Set at least one question count first."); return; }
      closeModal();
      openStartTestModal("mock", "mock-exam", `Mock Exam (${chosen.length}q)`, chosen, getCurrentSyllabusId());
    });
  }
  draw();
}

/* ---- Global search across every syllabus and paper ---- */

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
      <div class="meta" style="margin-bottom:8px;">Changes this one question only. To rename a topic everywhere it's used, open that topic's page and use "Rename topic" instead.</div>
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
      <div class="meta" style="margin-bottom:8px;">Changes this one question only. To rename a subject everywhere it's used, open that subject's page and use "Rename subject" instead.</div>
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
  const dupes = findDuplicateQuestions(parsed.questions, parsed.paper.id);
  if(dupes.length>0){
    const preview = dupes.slice(0,4).map(d=> `• "${d.text.slice(0,50)}${d.text.length>50?"…":""}" — also in ${d.paperName}`).join("\n");
    const msg = `${dupes.length} question(s) in this paper look like they already exist in other papers:\n\n${preview}${dupes.length>4?`\n…and ${dupes.length-4} more`:""}\n\nThis is common when papers repeat questions across years — add anyway?`;
    if(!confirm(msg)) return;
  }

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
function normalizeQuestionText(t){
  return String(t||"").toLowerCase().replace(/[^a-z0-9\u0d00-\u0d7f]+/g," ").trim();
}
function findDuplicateQuestions(newQuestions, excludePaperId){
  const existingMap = {};
  DATA.papers.forEach(p=>{
    if(p.id===excludePaperId) return;
    (p.questions||[]).forEach(q=>{
      const norm = normalizeQuestionText(q.question_text);
      if(norm.length<10) return; // too short to be a meaningful match
      if(!existingMap[norm]) existingMap[norm] = p.name;
    });
  });
  const out = [];
  (newQuestions||[]).forEach(q=>{
    const norm = normalizeQuestionText(q.question_text);
    if(norm.length<10) return;
    if(existingMap[norm]) out.push({ text: q.question_text, paperName: existingMap[norm] });
  });
  return out;
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
        paperTemplates: Array.isArray(pendingImportData.paperTemplates) ? pendingImportData.paperTemplates : (DATA.paperTemplates||[]),
        topicLists: Array.isArray(pendingImportData.topicLists) ? pendingImportData.topicLists : (DATA.topicLists||[]),
        topicLabels: (pendingImportData.topicLabels && typeof pendingImportData.topicLabels==="object") ? pendingImportData.topicLabels : (DATA.topicLabels||{}),
        studyProgress: (pendingImportData.studyProgress && typeof pendingImportData.studyProgress==="object") ? pendingImportData.studyProgress : (DATA.studyProgress||{}),
        dailyActivity: (pendingImportData.dailyActivity && typeof pendingImportData.dailyActivity==="object") ? pendingImportData.dailyActivity : (DATA.dailyActivity||{}),
        listingNotes: (pendingImportData.listingNotes && typeof pendingImportData.listingNotes==="object") ? pendingImportData.listingNotes : (DATA.listingNotes||{}),
        statsResetAt: pendingImportData.statsResetAt || DATA.statsResetAt || 0
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
      DATA = {
        papers: Object.values(byId), attempts, banks: DATA.banks||[], syllabuses: DATA.syllabuses, paperTemplates: DATA.paperTemplates||[],
        topicLists: DATA.topicLists||[], topicLabels: DATA.topicLabels||{}, studyProgress: DATA.studyProgress||{}, dailyActivity: DATA.dailyActivity||{},
        listingNotes: Object.assign({}, DATA.listingNotes||{}, pendingImportData.listingNotes||{}), statsResetAt: DATA.statsResetAt||0
      };
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
  if(!Array.isArray(parsed.topicLists)) parsed.topicLists = [];
  if(!parsed.topicLabels || typeof parsed.topicLabels !== "object") parsed.topicLabels = {};
  if(!parsed.listingNotes || typeof parsed.listingNotes !== "object") parsed.listingNotes = {};
  if(!parsed.studyProgress || typeof parsed.studyProgress !== "object") parsed.studyProgress = {};
  migrateStudyProgress(parsed.studyProgress);
  if(!parsed.dailyActivity || typeof parsed.dailyActivity !== "object") parsed.dailyActivity = {};
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
