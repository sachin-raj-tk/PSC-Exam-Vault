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
