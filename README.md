# PSC Exam Vault

A static, installable web app for practicing Kerala PSC question papers —
multiple syllabuses, timed or untimed practice tests with custom marking
schemes, a question bank for building random exams, per-topic study
tracking, and performance stats. No backend, no build step; all data lives
in your phone's browser storage.

## ⚠️ Keep this in its own repository

This app is separate from PSC Tracker, PSC Question Vault, and PSC Prep
Vault — different name, app ID, and icon. It must live in its **own
GitHub repository**. Mixing files across repos, or an overly broad
`scope` in any of their manifests, can cause one app's install to
silently replace another's. If that ever happens, see the recovery steps
in PSC Question Vault's README.

## What's new here (on top of Prep Vault's features)

- **Syllabuses**: keep multiple exam types (e.g. different posts/cadres)
  separate. Papers, Subjects, Topics, Attempts, and Stats all scope to
  whichever syllabus is currently selected (📚 bar under the top bar).
  Adding a new syllabus never touches your existing "Default" one or its
  papers — new papers you add always land in whichever syllabus is
  currently selected, and you can move a paper between syllabuses anytime.
- **Optional timer**: when starting a practice test, choose "Timer" and
  you'll see a suggested duration (≈0.9 min/question, rounded up), with
  −1/+1 buttons to adjust. The test auto-submits the instant time runs
  out — no leftover state, straight into the results view.
- **Custom marking scheme per syllabus**: set positive marks per correct
  answer and a "deduct N mark(s) per M wrong answers" negative scheme
  (e.g. the standard 1 mark deducted per 3 wrong). Every practice test and
  attempt in that syllabus scores against it.
- **Question Bank tab**: build named banks of questions pulled from your
  existing papers (searchable picker) or imported directly as a JSON,
  then generate random practice exams of any size from a bank.
- **Study tracker per topic**: mark how many times you've studied a
  topic with +1/−1 buttons on its detail page — the count shows
  everywhere that topic appears (Topics tab, inside its subject's topic
  list), scoped per syllabus.
- **Full stats lists**: every subject and every topic now appears in the
  Stats tab's priority ranking (scrollable), not just the top few.
- **Bulk explanations**: add explanations to an already-imported paper's
  questions via a JSON, matched by question number — no need to edit
  each one by hand.
- **Answers-lock toggle**: a lock button on every question listing
  prevents accidental taps from changing a marked correct answer while
  you're just browsing.
- **Formatting-aware text**: question text, options, and explanations now
  preserve line breaks and spacing exactly as typed or pasted.
- **Swipe view improvements**: a scrollable question-number bar lets you
  jump straight to any question instead of stepping through one at a time.
- **Smaller, safer delete-paper button** and better-spaced action icons
  on each question, so accidental taps are much less likely.

## Files in this project

- `index.html`, `style.css`, `app.js`, `taxonomy.js` — the app
- `manifest.json`, `icon.svg`, `sw.js` — PWA install + offline support
- `sample-paper-102-2024-M.json` — example paper to try
- `ai-instructions-for-json.md` — AI prompt to convert a question paper PDF into an import-ready JSON (includes the math-symbol guidance below)
- `ai-instructions-for-answer-keys.md` — AI prompt to convert an answer-key PDF into a JSON you can apply to an already-added paper

## A note on math symbols in JSON

If a question paper has math or scientific notation, ask the AI generating
the JSON to use plain Unicode symbols (÷ × √ ± ≤ ≥ π) or words — not
LaTeX-style backslash commands like `\div` or `\times`. A raw backslash is
a special character in JSON and breaks the file. The app's "Try auto-fix"
button in the Add-paper dialog can usually repair this automatically if it
slips through, but getting it right at generation time is more reliable.

## Hosting it on GitHub Pages (from your Android phone)

1. **Create the repository** — github.com → **+** → **New repository** →
   name it something like `psc-exam-vault` → **Public** → **Create repository**.
2. **Upload the files** — **Add file** → **Upload files** → select every
   file from this project → **Commit changes**.
3. **Turn on GitHub Pages** — repo **Settings** → **Pages** → **Source**:
   **Deploy from a branch** → **Branch**: `main`, folder `/ (root)` → **Save**.
4. **Open it** — after a minute or two, visit
   `https://<your-username>.github.io/psc-exam-vault/`.
5. **Install it** — Chrome **⋮** → **Add to Home screen** → **Install**.

## Updating the app later

Edit a file on github.com (pencil icon → change → **Commit changes**), or
**Add file → Upload files** with the same filename to overwrite it.

## Bringing over your existing data

Open **Data** in the top bar, choose your PSC Question Vault or PSC Prep
Vault backup `.json` file under "Import a backup file", pick which
syllabus its papers should land in (only applies to papers that don't
already specify one), and apply it — merge is usually what you want.
Your papers, answers, explanations, subjects, and topics all carry over.

## Adding question papers

Tap **+ Add**, then upload or paste JSON. Use `ai-instructions-for-json.md`
to have an AI generate it from a PDF.

## New in this update
- **Difficulty (E/M/D = 3/6/9)** on every question and during tests; averages count only marked questions ("n/total marked"). Switch it off/on at the bottom of the Stats tab.
- **Guess marking** in tests, with a Guesswork stats sub-tab (break-even accuracy, marks gained/lost, by subject/topic) and guessed-right/wrong filters in attempt reviews.
- **Sorting** by difficulty (and by time in test reviews) in every question list.
- **Notes**: per-question notes plus a Notes tab linking back to the paper.
- **Topic lists** (named, renamable, built from the syllabus) and **colour labels** for topics.
- **Stats sub-tabs**: Overview, Subjects, Time, Difficulty, Guesswork; "View all topics" list with the same sorts.
- Optional `"difficulty": "E"|"M"|"D"` and `"note": "..."` fields are accepted in question JSON.

## AI features (bring your own key)
Tap **🤖** next to the syllabus button → add presets (OpenRouter, Gemini, Groq, OpenAI, Anthropic, DeepSeek, Mistral, or any OpenAI-compatible URL). Keys are stored only in this browser and are never included in backups. Order presets by priority; with auto-switch on, the app moves to the next preset when one hits its limit or fails.
- **🤖 on a question / "Explain my mistake" in test review:** explain, mnemonic, revision note; save as explanation or note.
- **🧩 Similar questions / topic page "AI practice questions":** generates MCQs, you review them, then they go into the separate **AI questions** section.
- **Stats → Overview → AI tools:** study plan from your weak, slow and guess-heavy topics; memory tricks for wrong answers.
- **Stats → Guesswork → AI guess coach.**
AI output can be wrong — verify facts before relying on it. Model names change; edit them in the preset.

## Update: lists, notes, search, stats accuracy
- **Topics tab:** sort by Frequency / A–Z / **Studied** (filter: not studied, studied, 3+; most/least first) / **Label** (colour chips: tap one to see only that colour, tap more to add) / **📌 My lists** (list names as a scrolling chip bar, tap one to see its topics). Press and hold any topic to add it to a list or give it a label.
- **My note per listing** (paper, subject, topic, bank, flagged, topic list) — one note each, all collected in the Notes tab with a link back. Old per-question notes are kept in the Notes tab.
- **Question bank:** filters (syllabus, subject, topic, paper) and search in the add-questions picker; press and hold a question to read it fully; “✍️ Type a question” to write your own.
- **Search:** choose this syllabus / all / pick syllabuses; “View all as a list” opens results like any listing (practice, sort, swipe).
- **Exam picker:** search exams by name.
- **Auto difficulty:** answered questions with no difficulty are marked Easy (<26s), Medium (26–50s) or Difficult (>50s); you can change it any time and it then stays as you set it. Paused/background time is never counted.
- **Stats:** “Right/Wrong by level” tab; counting basis (first / latest / all attempts — default first attempt, each question counted once); small-sample adjustment and ⚠ low-data marks; delete a single test (Attempts); “Start fresh stats” keeps all other data.

## Study PDFs → AI questions (aipdf.js)

On any listing (topic, subject, exam, bank) tap **📄 Study PDFs → AI questions**.

- **Add PDF** – text is read in the browser with pdf.js (loaded from cdnjs the first time, then cached for offline use). The PDF and its text are stored on the phone (IndexedDB) and are not part of backups.
- **Scanned / old-font pages** are detected automatically. **Read scanned** sends each page image to a vision-capable AI preset (Gemini recommended, works for Malayalam) and stores the transcription. **Pages** lets you view, correct or re-read any page.
- **Style guide** – learned from your own PYQs for the chosen subject/topic (editable, saved per topic). PYQs are used for format only, never for facts.
- **Generate** – the PDF is split into sections; each section is sent separately with strict rules: facts only from the passage, a verbatim `source_quote` for every question.
- **Checks in code** – the quote must be found in the PDF text (exact or ≥90 % close) or the question is dropped; options are shuffled; an optional second AI pass answers each question from the passage alone and flags disagreements.
- **Review** – questions that failed a check are unticked; each shows its page and source line. Saved questions go to the separate AI questions section with the source in the explanation.

Limits: needs internet for the AI calls; scanned-page reading is one AI call per page; AI-read text can contain small errors (check in Pages).

## AI questions are kept separate from PYQs

- **Where they live:** Bank tab → 🤖 AI questions (browse by subject), and a **📚 PYQs | 🤖 AI questions** switch on every subject page, subject "all questions" page and topic page. There is also a 🤖 AI questions button at the top of the Subjects and Topics tabs.
- **Never mixed:** AI questions do not appear in Papers, Subjects/Topics counts and lists, global search, bank pickers, flagged list, wrong-answer queue, mock exams, weak-area banks, the study plan, or duplicate checks.
- **Practice:** the AI questions screen has its own filters (subject, topic, flagged) and its own practice tests. Those tests are saved as AI tests (Attempts tab → 🤖 AI).
- **Stats:** Stats tab → 📚 PYQ stats | 🤖 AI-question stats toggle. Each side uses only its own questions and attempts. The PYQ-only tools (quick practice, plan, review queue, guess coach) are hidden on the AI side.
- **Existing AI questions** you made earlier move to the AI section automatically.

## Flashcards, revision notes and the AI hubs

- **Three content views per topic** – on any topic or subject page switch between **PYQs / 🤖 AI / 🃏 Cards**. They are always separate lists; AI questions and cards never appear among PYQs.
- **Bank tab** has three views: 📦 Banks, 🤖 AI questions and 🃏 Flashcards. For AI questions and flashcards you first see the **subject list**, tap a subject to see its **topics** (by frequency or A–Z, with search and an "All topics" view), then tap a topic to see its questions or cards.
- **Flashcards from a study PDF** – open a topic → 📄 Study PDFs → **🃏 Flashcards**. Pick subject, topic, page range, count and language. Every card carries the exact source line from your PDF (verified in code); cards whose numbers are not in the passage are flagged and left unticked. Study mode: tap to flip, mark ✓ Know / ↻ Again; list mode lets you filter and delete.
- **Revision note from a PDF** – 📄 Study PDFs → **📝 Revision note** (short or detailed). Strictly bullet points from the PDF, bullets with numbers not found in the text are dropped. Edit, then **Save to topic note** (appends to the topic's 📝 My note) or Copy.
- **Stats** – the 📚 PYQ / 🤖 AI toggle on the Stats tab switches every stats screen (overview, subjects, level, time, difficulty, guess, per-subject, all topics) between PYQ data and AI-question data; the two are never mixed.
- Flashcards are included in the JSON backup/restore. PDFs are not.
