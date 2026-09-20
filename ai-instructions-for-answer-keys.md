# Instructions for an AI generating an answer-key JSON for PSC Prep Vault

Use this when a question paper is **already added** in the app and you
just want to apply its official answer key, without regenerating the
whole paper. Give an AI the answer-key PDF along with the prompt below
(paste everything inside the fenced block).

Apply the result inside the app via the paper's **"Add answer key"**
button (on that paper's detail screen).

## Answer key schema

```json
{
  "paper_id": "kpsc-102-2024-m",
  "answers": [
    { "question_number": 1, "correct_option": "C" },
    { "question_number": 2, "correct_option": "A" },
    { "question_number": 11, "correct_option": "X" }
  ]
}
```

- `paper_id` is optional — if given, the app uses it only as a sanity
  check and warns (without blocking) if it doesn't match the paper you're
  applying it to.
- `question_number` must match the paper's original printed question
  number (the same number the question had in the actual paper). This is
  how the app matches each answer to the right question.
- `correct_option` is `"A"`, `"B"`, `"C"`, or `"D"` (case-insensitive), or
  `"X"` / `"DELETED"` for a question the PSC deleted.

## Prompt for an AI generating this from an answer-key PDF

```
You will convert a PSC provisional/final answer key PDF into a JSON file
matching this exact schema:

{
  "paper_id": "<optional — the question paper's id, if you know it, else omit>",
  "answers": [
    { "question_number": <integer, the printed question number>,
      "correct_option": "<A, B, C, or D, or X/DELETED if the question was deleted>" }
  ]
}

Rules:
1. Extract every question number and its answer, in order.
2. If the answer key has multiple "question booklet alphacodes" (e.g. A,
   B, C, D — different shuffled versions of the same exam), use ONLY the
   column for the alphacode that matches the question paper already added
   in the app (usually alphacode A, unless told otherwise). Ignore the
   other alphacode columns entirely.
3. Where the key marks a question as deleted (often shown as "X" or a
   note saying the question was deleted/dropped), set "correct_option" to
   "X" for that question number — do not guess a letter for it.
4. Do not include questions that aren't listed in the answer key.
5. Give the output as a downloadable JSON file (not just pasted text in
   the chat) — create and share an actual .json file containing only the
   raw JSON above, with no explanation, commentary, or markdown code
   fences inside the file itself.
```
