# Agora telehealth layer

HealthGuard's navigator was text-only: a patient typed symptoms and read back
markdown. That fails the people this product is aimed at — someone at midnight
with a feverish child, an elderly patient with tremor, anyone who reads slowly
or not at all in the interface language. This layer adds the two things that
gap needs: **a navigator you can talk to**, and **a real clinician you can
escalate to**.

## What was added

| Capability | Agora product | Entry point |
|---|---|---|
| Patient ↔ clinician video consult | Video SDK for Web | `src/hooks/use-agora-consult.ts`, `src/components/consult/ConsultRoom.tsx` |
| Spoken navigator (ASR → LLM → TTS) | Conversational AI Engine | `src/lib/agora/navigator.ts` |
| Live captions | Real-Time Speech-to-Text | `src/lib/agora/transcription.ts` |
| Visit record | Cloud Recording | `src/lib/agora/recording.ts` |

## The PHI gate — read this first

Agora is a third party. Two of the four capabilities above hand it content, not
just packets:

- The **Conversational AI Engine** performs ASR on what the patient says.
- **Cloud Recording** and **persisted transcripts** write consult content to
  storage.

Handing identifiable patient data to a vendor without a **Business Associate
Agreement** is a HIPAA violation, and a BAA with Agora is an enterprise
arrangement — *the free console tier does not include one*. Verify your own
contract terms; nothing in this repo grants them.

So the gate is code, not a note in a README. `src/lib/agora/config.ts` resolves
a **posture** from the environment and every PHI-bearing path asserts against
it:

```text
AGORA_PHI_POSTURE=baa-signed
AGORA_BAA_REFERENCE=<your executed contract reference>
```

Both are required. A posture claim with no named agreement degrades to
`transport-only` rather than unlocking anything — an operator asserting a BAA
has to be able to name it.

### What each posture allows

| | `transport-only` (default) | `baa-signed` | `baa-signed` + `HEALTHGUARD_LLM_PHI_POSTURE=attested` |
|---|---|---|---|
| Video/voice consult | yes | yes | yes |
| Voice navigator runs | yes | yes | yes |
| Patient record in navigator prompt | **no** | **no** | yes |
| Cloud recording | **no** | yes | yes |
| Stored transcript | **no** | yes | yes |
| Live captions (transient) | yes | yes | yes |

The default is deliberately *useful*, not crippled. An un-personalised
navigator that says "tell me what's going on" and routes chest pain to
emergency services is most of the value, and carries no PHI we put there.
What transport-only forbids is us seeding the model with a patient's chart and
us asking Agora to store the audio. Chart-aware prompting also needs a separate
attestation for the LLM hop (`HEALTHGUARD_LLM_PHI_POSTURE=attested`) — an Agora
BAA does not cover Gemini / `z-ai-web-dev-sdk`.

Misconfiguration degrades rather than crashes: a typo in `AGORA_PHI_POSTURE`
takes the *PHI* features offline, never the consult itself. Taking video
consults down because of an env typo would be its own kind of harm.

`src/lib/agora/config.test.ts` covers every way to get this wrong.

## How the voice navigator works

The interesting decision: Agora does **not** get its own model.

```text
patient speech
   ↓  Agora ASR
Conversational AI Engine
   ↓  llm.url  →  POST /api/consult/navigator/llm/chat/completions   (this app)
                     ├─ resolve opaque session id → patient (server-side)
                     ├─ PHI gate decides whether to inject the chart
                     └─ same clinical prompt as the typed chat
   ↓  Agora TTS
spoken reply
```

Agora's engine calls back into an OpenAI-compatible endpoint we host. Two
things fall out of that:

1. **One brain, one set of safety rules.** `src/lib/clinical-prompt.ts` holds
   the never-diagnose rules once; the typed chat route and the voice navigator
   both import them. A second copy is a second thing to forget to update.
2. **The PHI gate is enforceable.** Agora only ever carries an opaque session
   id. Patient identity is resolved inside this app, behind the gate — no
   patient identifier transits Agora's control plane at all.

The spoken prompt is a genuine variant, not a copy. TTS reading markdown says
"asterisk asterisk"; a frightened caller cannot skim a bulleted list. So
`VOICE_SYSTEM_PROMPT` forbids markdown, caps turns at ~60 words, and hoists
emergency routing above everything else — red-flag symptoms get "hang up and
call emergency services" *before* any follow-up question.

Because Agora calls us, `HEALTHGUARD_PUBLIC_URL` must be internet-reachable.
It is read from an env var rather than the request's Host header on purpose: a
rebind on that header would redirect Agora's callback to an attacker.
`AGORA_LLM_BRIDGE_KEY` guards the endpoint and is compared in constant time;
unset means the bridge rejects everything.

## API surface

Patient-facing consult routes sit behind the existing `requirePatientAuth`
bearer guard (`PATIENT_API_TOKEN`). That token is a **service credential**, the
same one `/api/patients` and `/api/chat` already use — it authenticates the
caller as this deployment, not as a specific patient or clinician. There is no
per-user session layer to bind a channel to.

The LLM callback is the exception: Agora authenticates with
`AGORA_LLM_BRIDGE_KEY`, compared in constant time. Unset means the bridge
rejects everything.

| Route | Method | Purpose |
|---|---|---|
| `/api/consult/token` | POST | Mint an RTC token, open a session, report capabilities |
| `/api/consult/navigator` | POST / DELETE | Start / stop the voice navigator |
| `/api/consult/transcript` | POST / DELETE | Start / stop live captions |
| `/api/consult/record` | POST / DELETE | Start / stop the visit recording |
| `/api/consult/navigator/llm/chat/completions` | POST | Agora's LLM callback (bridge key auth) |

`/api/consult/token` returns the capability set, so the UI renders honestly —
a disabled "Record visit" button that explains *why* beats one that 403s at the
moment a clinician needs it.

## Design notes

**Reserved bot uids.** The navigator, transcriber, and recorder join as fixed
uids (`1000001`–`1000003`). Human uids are hashed into the range *above*
`1000100`, so a human can never collide with a bot, and REST calls can
reference bots without a lookup. The UI filters bots out of the participant
grid — a caption bot rendered as an empty video tile looks like a crash.

**Roles are enforced in the token.** An `observer` (say, an attending
supervising a resident) gets a SUBSCRIBER token. A tampered client still
cannot publish, because the privilege was never in the credential.

**Channel names are validated before they reach a URL.** They are built from a
consult id and later interpolated into REST paths, so `consultChannel()`
rejects anything that could smuggle a path segment.

**Sessions are in-memory and deliberately not persisted.** A consult is minutes
long; not writing the patient↔channel mapping to disk means a stolen database
file does not reveal who was on which call. This is a **single-instance** store.
A second replica will 404 follow-up navigator/transcript/record calls, and a
process restart mid-consult leaves Agora agents running until their idle
timeout (60s navigator, 120s STT/recording). Do not put this behind more than
one replica without sticky routing on `sessionId` or a shared store. Redis is
the planned follow-up; it is not in this PR.

**Human uids include per-join entropy** so two people with the same display
name in the same role do not kick each other off the channel. Token renewal
sends the existing `sessionId` and `uid` so it cannot open a new room.

**Agora POSTs are not retried.** `acquire` / `join` / `start` are not
idempotent; a retry would orphan a second agent. `safeFetch` is called with
`maxAttempts: 1`.

**Recording uses `individual` mode.** Separate per-participant tracks beat a
composited grid for a clinical record: easier to review, and a per-speaker
transcript later needs no diarisation guesswork.

**Outbound calls reuse the repo's hardening.** Every Agora REST call goes
through the vendored `safeFetch` with an SSRF allowlist pinned to
`api.agora.io`, per-attempt timeouts, and backoff on 429/5xx.

## Environment

Note that `.env*` is gitignored in this repo, so `.env.example` is not tracked —
this table is the canonical reference.

| Variable | Required for | Notes |
|---|---|---|
| `AGORA_APP_ID` | consults | From the Agora console |
| `AGORA_APP_CERTIFICATE` | consults | Enable the certificate on the project first |
| `AGORA_REST_KEY` | navigator, captions, recording | RESTful API customer ID |
| `AGORA_REST_SECRET` | navigator, captions, recording | RESTful API secret |
| `AGORA_PHI_POSTURE` | PHI features | `baa-signed` unlocks recording/stored transcripts; anything else is transport-only |
| `AGORA_BAA_REFERENCE` | PHI features | Your executed Agora contract reference. Required alongside the posture |
| `HEALTHGUARD_LLM_PHI_POSTURE` | chart in navigator prompt | `attested` required in addition to the Agora BAA. An Agora BAA does not cover the LLM |
| `HEALTHGUARD_PUBLIC_URL` | navigator | Absolute `https` origin Agora calls back into |
| `AGORA_LLM_BRIDGE_KEY` | navigator | Shared secret for the LLM callback. Unset = reject everything |
| `AGORA_ASR_VENDOR` | navigator | Defaults to `ares` |
| `AGORA_TTS_VENDOR` | navigator | Your chosen TTS provider |
| `AGORA_TTS_PARAMS` | navigator | JSON, passed to Agora verbatim |
| `AGORA_NAVIGATOR_MODEL` | navigator | Label only; the bridge decides the real model |
| `AGORA_STORAGE_VENDOR` | recording, stored transcripts | Agora's numeric vendor enum |
| `AGORA_STORAGE_REGION` | recording, stored transcripts | Agora's numeric region enum |
| `AGORA_STORAGE_BUCKET` | recording, stored transcripts | |
| `AGORA_STORAGE_ACCESS_KEY` | recording, stored transcripts | |
| `AGORA_STORAGE_SECRET_KEY` | recording, stored transcripts | |

## Setup

1. Create a project in the [Agora console](https://console.agora.io/), enable
   the App Certificate, and copy the App ID + certificate.
2. Generate a RESTful API customer ID/secret for the server-side features.
3. Set the transport variables from the table above. Start with transport-only.
4. Configure `AGORA_TTS_VENDOR` / `AGORA_TTS_PARAMS` for your chosen TTS
   provider; params are passed to Agora verbatim.
5. Expose the app at `HEALTHGUARD_PUBLIC_URL` (must be `https`) and set
   `AGORA_LLM_BRIDGE_KEY`.
6. Only after a BAA is executed: set `AGORA_PHI_POSTURE` and
   `AGORA_BAA_REFERENCE`, plus `AGORA_STORAGE_VENDOR`, `AGORA_STORAGE_REGION`,
   `AGORA_STORAGE_BUCKET`, `AGORA_STORAGE_ACCESS_KEY`, and
   `AGORA_STORAGE_SECRET_KEY`.
7. Chart-aware voice prompting additionally requires
   `HEALTHGUARD_LLM_PHI_POSTURE=attested` for the LLM provider. Do not set this
   because you signed an Agora BAA.

## Not done

- **No BAA is claimed or implied here.** The gate defaults to off; unlocking it
  is a contractual decision for whoever operates the deployment.
- Caption *rendering* in the UI is not wired. Agora publishes transcription
  results into the channel as data-stream messages, which need the vendor
  protobuf schema to decode; the task lifecycle is implemented, the on-screen
  subtitle track is not.
- Recording files land in your bucket; nothing indexes them back onto the
  `Patient` record yet.
