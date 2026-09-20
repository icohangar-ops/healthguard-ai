# CareQueue AI

> Pulse-backed triage cockpit that ranks incoming care cases, explains why each patient is rising in the queue, and stores the queue, case history, and learning loop in Pulse Evorozen instead of a brittle demo database.

## Why it exists

Care teams lose time when intake is scattered across notes, alerts, and ad hoc judgment. CareQueue AI centralizes the queue, scores urgency deterministically, and uses Pulse Evorozen to keep the case state and history alive across sessions.

## What it does

- Ranks patients by vitals, alerts, age, and comorbidity risk.
- Uses Pulse Evorozen as the living state layer for triage cases, history, and feedback.
- Creates and reads Pulse tables for `triage_cases`, `case_history`, and `learning_signals`.
- Uses Pulse `chat` for the navigator’s reasoning.
- Uses ElevenLabs-backed voice config for the spoken navigator path.
- Falls back to seeded local data when Pulse is unavailable.

## Core flow

1. Cases are loaded from Pulse via `POST https://pulse.evorozen.com/api/neural`.
2. The app scores and sorts the queue locally.
3. Feedback writes back into Pulse as learning signals and case history entries.
4. Navigator chat answers are generated through Pulse and attached to the case timeline.

## Pulse Evorozen

Pulse is the shared state layer for this repo.

- `create_schema` bootstraps the triage tables the first time the app runs.
- `select_data` loads the live queue, memory, and case history.
- `insert_data` records triage feedback and new timeline events.
- `chat` powers the navigator reasoning path against the current case context.

If Pulse is unavailable, the app falls back to local seeded cases so the demo still works.

## Screens

- Queue: ranked care cases with scores, tiers, and next steps.
- Case detail: vitals, reasoning, and full history timeline.
- Navigator: assistant response for the selected case.
- Pulse memory: recent pattern counts and outcome signals.

## Tech stack

- Next.js 16
- TypeScript
- Tailwind CSS
- Pulse Evorozen for living state
- ElevenLabs / Agora voice configuration

## Run locally

```bash
bun install
bun run dev
```

## Submission assets

- Logo / thumbnail: `docs/thumbnail.png`
- Demo video: `docs/carequeue-demo.mp4` (generate locally, upload to YouTube, paste the link into BUIDL)

## GitHub

- Repo: `https://github.com/icohangar-ops/carequeue-ai`

## Propagation decisions

Decisions from the portfolio propagation matrix (SecOps/Gov wave C), recorded
per the adopt-or-reverse contract. Revisit triggers are binding: when the
condition appears in this repo, re-evaluate the row.

### Row 31 — typed claim lifecycle: REVERSED

A governed claim lifecycle (typed claims, four-eyes review, human locks,
lock-gated exports) requires a review step with an actual reviewer on the
other side. Current state of this repo: claim-shaped strings exist only as
Agora consult-token plumbing (`src/app/api/consult/token/route.ts`,
`src/lib/agora/config.ts`); there is no typed claim object, no review queue,
no second operator, and no export gate. Adding the lifecycle would produce
review ceremony with nobody assigned to review.

**Revisit trigger:** a claims-review workflow (human reviewer role or an
automated review step consuming claim output) becomes part of the product
flow. At that point adopt the canonical lifecycle rather than a local one —
see the erp-control-plane implementation for the reference shape.
