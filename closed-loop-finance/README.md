<div align="center">

# Closed Loop Finance

**A reusable, AI-native finance operating template and a stateful 4-agent reference implementation that automates the closed-loop month-end review.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-green.svg)](https://python.org)
[![LangGraph](https://img.shields.io/badge/Orchestration-LangGraph-purple.svg)](https://github.com/langchain-ai/langgraph)
[![Vertex AI](https://img.shields.io/badge/Cloud-GCP%20Vertex%20AI-blue.svg)](https://cloud.google.com/vertex-ai)

</div>

---

## The Problem

Most CFOs run an **open loop**: a decision is made, executed, and rarely measured against its own assumptions. Variance analysis is written once, read once, archived forever. Institutional knowledge lives in one person's head. Every layer of the org chart adds latency and loses signal.

| Open Loop (status quo) | Closed Loop (this repo) |
|---|---|
| Senior controller carries 80% of institutional knowledge in their head | Decisions live in a structured Notion DB the LLM can query |
| Variance commentary is written, read once, archived | Variance becomes a decision row that next month's run retrieves |
| Each layer of the org chart adds latency and loses signal | Four agents replace translation; humans approve, don't transcribe |
| Audit trail is reconstructed from emails | Every run writes an immutable, hash-stamped audit note |

Velocity in finance = velocity of information flow. Removing every layer of human routing is a direct speed gain — without losing control, because the human still gates every external write.

---

## What This Is

Two layers, one repository:

```
closed-loop-finance/
  (template)  folder structure + Drive artifacts the CFO operates from
  agents/     a code-native 4-agent reference build that automates the loop
```

- **CFO who wants the methodology now** → use the template + Claude Cowork instructions in `00 Claude Setup/`.
- **Eng team standing up an agentic finance build** → start in `agents/` and point it at any well-structured Drive folder.

Both layers share the same source of truth: the file system here, plus a Notion Decision Log you create once.

---

## Architecture Overview

<p align="center">
  <img src="assets/architecture-overview.png" alt="System Architecture" width="900">
</p>

### The 4-Agent Pipeline

<p align="center">
  <img src="assets/agent-flow.png" alt="Agent Pipeline" width="900">
</p>

The LangGraph `StateGraph` orchestrates four non-overlapping agents through a deterministic pipeline:

```
START -> evidence -> analyst -> memory_retrieve -> cfo_brief
                                                      |
                                              interrupt_before
                                                      |
                                            human approval (CLI / UI)
                                                      |
                                                      v
                                              memory_write -> END
```

### End-to-End Data Flow

<p align="center">
  <img src="assets/data-flow-pipeline.png" alt="Data Flow Pipeline" width="900">
</p>

| # | Agent | Job | LLM? | Tools |
|---|---|---|---|---|
| 1 | **Evidence** | Load every file under the period folder, parse, hash, return typed `Evidence` | No (deterministic) | drive loader |
| 2 | **Analyst** | Variance / cut-off / cash / inventory analysis. Splits **facts vs. assumptions** | Gemini 2.5 Pro | pandas, JSON schema |
| 3 | **Memory** | Retrieve prior decisions (Notion + Vector Search) before the brief; write decisions back **only after human approval** | Gemini 2.5 Flash | Notion API, Vertex Vector Search |
| 4 | **CFO Brief** | Synthesize close memo + 3 board messages + proposed Notion rows; write memo + audit note | Gemini 2.5 Pro | file writer |

---

## Shared State & Session Persistence

<p align="center">
  <img src="assets/state-schema.png" alt="GraphState Schema" width="800">
</p>

Every node reads from and writes to a single `GraphState` TypedDict. LangGraph merges partial updates and persists the full state per `thread_id`:

```python
class GraphState(TypedDict, total=False):
    period: str
    repo_root: str
    evidence: Evidence
    findings: Findings
    prior_decisions: list[PriorDecision]
    cfo_brief: CFOBrief
    human_approved: bool
    approver: str
    notion_rows_written: list[str]
    messages: Annotated[list, add_messages]
    errors: list[str]
```

**Session continuity:** `thread_id = close-<YYYY-MM>`. Re-running with the same thread resumes from the last checkpoint — even days later, even by a different operator. Cross-period continuity is achieved through the Memory Agent retrieving prior decisions from Notion + Vector Search.

---

## The 8-Step Closed Loop

<p align="center">
  <img src="assets/closed-loop-infographic.png" alt="The 8-Step Closed Loop" width="500">
</p>

Every review — whether run by a human in Claude Cowork or by the agent crew — moves through this loop:

1. **Read source evidence** — Load period files from Drive
2. **Identify the finance signal** — Detect performance issues and anomalies
3. **Separate facts from assumptions** — Pandas computes; LLM reasons
4. **Identify the decision required** — Flag what needs human judgment
5. **Capture in structured form** — Write to Notion Decision Log
6. **Compare future outcomes** — Next cycle retrieves prior decisions
7. **Turn variance into lessons** — Feedback becomes input
8. **Recommend improvements** — Close the loop with actionable output

This is not narrative. It is structural. The Memory Agent on cycle N+1 retrieves what the Memory Agent wrote on cycle N. **That is the feedback signal the next brief is built on.**

---

## Trust, Auditability & Security

<p align="center">
  <img src="assets/trust-model.png" alt="Trust & Security Model" width="900">
</p>

| Layer | Mechanism |
|---|---|
| **Evidence** | SHA-256 hash for every file; no LLM in the loading path |
| **Analysis** | Pandas computes numbers deterministically; LLM reasons over grounded summaries only |
| **Validation** | JSON-schema-checked LLM output; typed `Findings` and `CFOBrief` objects |
| **Human gate** | `interrupt_before=["memory_write"]` — no external write without explicit `y` |
| **Audit** | Immutable note in `07 Audit Trail/` listing inputs, agents, outputs, decisions |
| **Memory** | Notion DB is append-only by convention; corrections are new rows referencing prior `notion_id` |
| **Observability** | PRISMtrace on BlockConvey for LangGraph spans and LLM calls |

---

## Technology Stack

<p align="center">
  <img src="assets/tech-stack.png" alt="Technology Stack" width="900">
</p>

| Component | Choice | Why |
|---|---|---|
| Cloud platform | **GCP Vertex AI** | Native Gemini access, Vector Search, Cloud SQL for state |
| Reasoning model | `gemini-2.5-pro` | Long-context for whole close packs, strong reasoning |
| Fast model | `gemini-2.5-flash` | Cheap deterministic tasks |
| Embeddings | `text-embedding-005` | Vertex-native, low latency |
| Vector store | **Vertex AI Vector Search** | Sub-100ms retrieval, same trust boundary as LLM |
| Orchestrator | **LangGraph** | First-class state, checkpointing, interrupts, observability |
| State persistence | `SqliteSaver` (dev) → `PostgresSaver` on Cloud SQL (prod) | Resume runs across days/operators |
| Structured memory | **Notion** Decision Log DB | Human-legible, filterable, audit-friendly |
| File parsing | Pandas, openpyxl, pypdf | Deterministic numerical inputs to the Analyst |

An Azure AI Foundry adapter (GPT + Azure AI Search) is documented in `agents/docs/03-deploy-azure.md`.

---

## Live Demo

<p align="center">
  <img src="assets/terminal-demo.png" alt="Terminal Demo" width="800">
</p>

The CLI streams each node's trace, **pauses at the human approval gate** to show proposed Notion decision rows + 3 board messages, then on `y` writes to Notion and seals the audit note. Re-running with the same period **resumes the checkpoint**.

---

## Quickstart — Path A: Claude Cowork only (no code)

For CFOs and finance leaders who want the methodology without standing up the agent stack.

1. **Clone** the repo to a folder you sync with Google Drive (Drive Desktop works fine).
   ```bash
   git clone https://github.com/icohangar-ops/closed-loop-finance.git
   ```
2. **Open `00 Claude Setup/project-instructions.md`** and replace the `[Company Name]` and `[NOTION_PAGE_URL]` tokens.
3. **Create the Notion page + Decision Log database** following `00 Claude Setup/notion-setup.md`. Import `05 Decisions Log/Decision Log.csv` as the seed.
4. **Install the Closed Loop Finance skill pack** in Claude Cowork. The four base skills (`brain`, `memory`, `audit`, `board-prep`) live in `skills/` as stubs you can extend.
5. **Open Claude Cowork on the desktop**, create a new project, point it at this folder as a local folder, paste the project instructions, and connect Notion via Settings -> Connectors.
6. **Drop a close pack** into `03 Monthly Close/YYYY-MM Month Close/` and prompt:
   ```
   Run the closed-loop close review: produce the CFO close summary,
   identify open issues and follow-ups, propose Notion Decision Log
   entries (do not write yet), and write the audit note.
   ```

---

## Quickstart — Path B: Multi-agent build (Vertex AI)

For teams who want the loop automated end-to-end.

```bash
cd agents
cp .env.example .env       # fill in GCP_PROJECT_ID, NOTION_TOKEN, NOTION_DECISION_DB_ID
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# (one-time) Index the Drive corpus into Vertex Vector Search
python scripts/index_corpus.py --root ..

# Run the closed-loop graph for a period
python -m src.run --period "2026-03 March Close"
```

Detailed deployment lives in [`agents/docs/`](./agents/docs/):

- [`01-architecture.md`](./agents/docs/01-architecture.md) — diagrams, state schema, trust model
- [`02-deploy-gcp.md`](./agents/docs/02-deploy-gcp.md) — APIs, service account, indexes, Cloud SQL
- [`03-deploy-azure.md`](./agents/docs/03-deploy-azure.md) — swap to GPT + Azure AI Search
- [`04-demo-script.md`](./agents/docs/04-demo-script.md) — 15-minute live walkthrough with timing
- [`05-runbook.md`](./agents/docs/05-runbook.md) — monthly ops, failure modes, rotations
- [`06-criteria-mapping.md`](./agents/docs/06-criteria-mapping.md) — file-by-file proof for reviewers

---

## Repo Map

```
closed-loop-finance/
├── README.md                            <- you are here
├── LICENSE                              <- MIT
├── assets/                              <- diagrams and visual assets
│   ├── architecture-overview.png
│   ├── agent-flow.png
│   ├── state-schema.png
│   ├── data-flow-pipeline.png
│   ├── closed-loop-infographic.png
│   ├── trust-model.png
│   ├── tech-stack.png
│   ├── terminal-demo.png
│   └── closed-loop-cycle.png
│
├── 00 Claude Setup/                     <- Cowork project instructions, Notion setup
│   ├── project-instructions.md
│   ├── notion-setup.md
│   └── connector-checklist.md
│
├── 01 Company Context/                  <- charter, KPIs, cap-table pointer
├── 02 Board Meetings/                   <- per-meeting subfolders
├── 03 Monthly Close/                    <- one subfolder per close (YYYY-MM Month Close)
│   └── 2026-03 March Close/             <- 9 stub files (CSV + MD)
│
├── 04 FP&A/                             <- forecast, scenarios, KPI dashboard
├── 05 Decisions Log/
│   └── Decision Log.csv                 <- Notion import (5 cols + 3 seed rows)
│
├── 06 Finance Processes/                <- close SOP, controls matrix
├── 07 Audit Trail/                      <- auto-generated by Claude / agents
├── 99 Archive/
│
├── skills/                              <- Closed Loop Finance skill pack stubs
│   ├── closed-loop-brain/SKILL.md
│   ├── closed-loop-memory/SKILL.md
│   ├── closed-loop-audit/SKILL.md
│   └── closed-loop-board-prep/SKILL.md
│
└── agents/                              <- multi-agent reference build
    ├── README.md
    ├── requirements.txt
    ├── .env.example
    ├── config/agents.yaml
    ├── docs/                            <- 6 docs: arch, deploy GCP, deploy Azure, demo, runbook, criteria
    ├── scripts/{index_corpus,eval}.py
    ├── tests/                           <- pandas tools, 5 passing
    └── src/
        ├── run.py                       <- CLI entry
        ├── orchestrator/graph.py        <- LangGraph StateGraph
        ├── agents/{evidence,analyst,memory,cfo_brief,_llm}.py
        ├── tools/{drive_loader,pandas_tool,notion_client,vector_store,file_writer}.py
        ├── memory/checkpointer.py
        └── state/schema.py              <- typed state across nodes
```

---

## What Goes Where

| Layer | Tool | Stores | Does NOT store |
|---|---|---|---|
| Evidence | Google Drive (this repo) | Spreadsheets, close packs, board decks, contracts, raw exports | Structured decisions |
| Memory | Notion Decision Log | Who decided what, when, why, with what trigger to revisit | Financial source-of-truth, sensitive raw figures |
| Operator | Claude Cowork / agent crew | Reads both, writes outputs back to Drive, writes decisions to Notion only on approval | Side-channel state |

> **Sensitive data note:** Keep raw figures in Drive (or your ERP). Notion stores **decisions**, not statements. Reference Drive paths from Notion entries rather than copying numbers.

---

## Multi-Agent Build — Criteria Coverage

| Criterion | Implementation | Where |
|---|---|---|
| 3+ collaborating agents (4 preferred) | **4 agents**, non-overlapping roles | `agents/src/agents/{evidence,analyst,memory,cfo_brief}.py` |
| Built on Azure AI Foundry **or** GCP Vertex AI | **Vertex AI primary**, Foundry adapter documented | `agents/src/agents/_llm.py`; `agents/docs/03-deploy-azure.md` |
| Orchestration framework | **LangGraph** `StateGraph` with conditional edges + `interrupt_before` | `agents/src/orchestrator/graph.py` |
| Session state management | `SqliteSaver` checkpointer keyed by `thread_id = close-<YYYY-MM>`; resumes across runs, days, operators | `agents/src/memory/checkpointer.py` |
| Persistent context / memory (RAG) | **Two layers**: Vertex AI Vector Search + Notion Decision Log | `agents/src/tools/{vector_store,notion_client}.py` |
| End-to-end agentic workflow | Drive ingest -> analysis -> memory recall -> CFO brief -> human approval -> Notion write -> audit note | `agents/src/run.py` |

---

## Cost Notes (per close run, agent crew)

- Analyst: 1 Gemini 2.5 Pro call (long-context over the close pack)
- CFO Brief: 1 Gemini 2.5 Pro call
- Memory: ~2 Flash calls (keyword extraction + retrieval shaping)
- Embeddings: amortized — re-index only on corpus change, not per run
- Vector Search: per-query + per-index-hour; one small index covers the entire repo
- State: SqliteSaver is free locally; Cloud SQL `db-f1-micro` is sufficient for prod

Typical end-to-end run cost is in the **low cents to low dollars** range at current Vertex pricing. The dominant factor is the Pro context window if your close pack is large.

---

## Roadmap

- [ ] Replace SqliteSaver with PostgresSaver on Cloud SQL for multi-operator state
- [ ] Add a forecast agent that reads `04 FP&A/` and runs scenario sensitivity before the CFO Brief
- [ ] LangSmith traces wired by default
- [ ] Slack notifier on memo + audit note write
- [ ] Read-only Notion mirror to a Postgres view for BI tooling

---

## Provenance & Credits

The methodology — Drive as evidence, Notion as structured memory, Claude Cowork as operator, Skills as apps, the eight-step loop — is from the *AI CFO Office* essay ["How to build a Closed Loop finance function as a CFO with Claude"](https://substack.com/@aicfooffice) by [@aicfooffice](https://substack.com/@aicfooffice). The 4-agent reference build, the LangGraph orchestrator, and the Vertex AI integration in `agents/` are the contribution of this repo.

---

## License

MIT. See [`LICENSE`](./LICENSE).

---

## CHP Governance

This repository is hardened with the [Consensus Hardening Protocol (CHP)](https://codeberg.org/cubiczan/consensus-hardening-protocol), Cubiczan's decision-governance layer for multi-agent AI systems.

### Protocol Layers
- **R0 Gate**: All decisions must pass Solvable, Scoped, Valid, Worth_it checks
- **Foundation Disclosure**: 1-3 weakest assumptions, 1-2 invalidation conditions, 1 key vulnerability
- **Adversarial Layer**: Mandatory devil's advocate at Phase 0 and Round 3
- **State Machine**: EXPLORING → PROVISIONAL → PROVISIONAL_LOCK → LOCKED
- **Third-Party Validation**: Independent CONFIRM/REJECT before lock

### Domain Configuration
- **Category**: Finance (CFO Accuracy)
- **Foundation Threshold**: 100
- **CFO Accuracy Guard**: Enabled

### Compliance Artifacts
| File | Purpose |
|------|---------|
| `.chp/STATE_MACHINE.md` | Decision state transitions |
| `.chp/R0_CONFIG.yaml` | Domain-calibrated thresholds |
| `.chp/ADVERSARIAL_PROMPTS.md` | Standardized challenge templates |
| `.chp/CHP_COMPLIANCE.md` | Compliance tracking & audit trail |

### CHP Version
cognitive-mesh-orchestrator 0.1.0 | [Protocol Docs](https://codeberg.org/cubiczan/consensus-hardening-protocol)
