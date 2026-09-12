# CareQueue AI

> Pulse-backed triage cockpit that ranks incoming care cases, explains why each patient is rising in the queue, and stores the learning loop in a living state layer instead of a brittle demo database.

## Why it exists

Care teams lose time when intake is scattered across notes, alerts, and ad hoc judgment. CareQueue AI centralizes the queue, scores urgency deterministically, and uses Pulse Evorozen to keep the case state and history alive across sessions.

## What it does

- Ranks patients by vitals, alerts, age, and comorbidity risk.
- Stores queue state and case history in Pulse Evorozen.
- Uses Pulse `chat` for the navigator’s reasoning.
- Uses ElevenLabs-backed voice config for the spoken navigator path.
- Falls back to seeded local data when Pulse is unavailable.

## Core flow

1. Cases are loaded from Pulse via `POST https://pulse.evorozen.com/api/neural`.
2. The app scores and sorts the queue locally.
3. Feedback writes back into Pulse as learning signals and case history.
4. Navigator chat answers are generated through Pulse and attached to the case timeline.

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

- Repo: `https://github.com/Cubiczan/healthguard-ai`
