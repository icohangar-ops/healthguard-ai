# Closed Loop Finance — Multi-Agent System

A stateful, orchestrated multi-agent system that automates the closed-loop month-end review.

## Criteria coverage

| Requirement | Implementation |
|---|---|
| ≥ 3 collaborating agents (4 preferred) | **4 agents**: Evidence, Analyst, Memory, CFO Brief |
| Built on Azure AI Foundry **or** GCP Vertex AI | **Vertex AI** (Gemini 2.5 Pro/Flash) — Azure adapter included |
| Orchestration framework | **LangGraph** `StateGraph` with conditional edges + human-in-the-loop |
| Session state management | LangGraph **checkpointer** (SQLite local → Cloud SQL / Firestore prod) |
| Persistent context / memory (RAG) | **Vertex AI Vector Search** over Drive + Notion Decision Log as structured memory |
| End-to-end agentic workflow | Drive ingest → analyze → memory check → CFO brief → human approval → Notion write → audit note |
| LLM observability | **PRISMtrace** on BlockConvey for LangGraph + model-call traces |

## Architecture diagram (logical)

```
        ┌───────────────────────────────────────────────────────────────┐
        │                    LangGraph StateGraph                       │
        │                                                               │
  user ─►│ (1) Evidence ──► (2) Analyst ◄──► (3) Memory ──► (4) CFO    │── memo
        │       │                │                  │           Brief   │── audit
        │       ▼                ▼                  ▼            │      │── Notion
        │   Drive loader    Pandas + Gemini    Vertex Vector    │      │   row
        │                                       Search +        │      │
        │                                       Notion API      │      │
        │                                                       ▼      │
        │                          ◄────────── Human approval gate ────│
        │                                                              │
        │              Checkpointer (SQLite/Cloud SQL)                 │
        └──────────────────────────────────────────────────────────────┘
```

## Agents

1. **Evidence Agent** — Loads `03 Monthly Close/<period>/` files, parses CSV/XLSX/PDF, hashes for audit, returns a typed `Evidence` object.
2. **Analyst Agent** — Runs Pandas-backed variance/cut-off/cash/inventory analysis. Returns `Findings { facts, likely_causes, open_questions, follow_ups }`.
3. **Memory Agent** — RAG over Vertex Vector Search (chunked Drive corpus) + Notion API queries. Returns prior-decision context AND drafts new decision rows. Writes only after human approval.
4. **CFO Brief Agent** — Synthesizes the management memo + 3 board messages. Writes outputs to `03 Monthly Close/<period>/` and the audit note to `07 Audit Trail/`.

## Quick start

```bash
cd agents
cp .env.example .env             # fill in GCP project, Notion token, paths
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. Index Drive into Vertex Vector Search (one-time per major content change)
python scripts/index_corpus.py --root ../

# 2. Run the closed-loop graph for March 2026
python -m src.run --period "2026-03 March Close"

# 3. View the run trace
langgraph dev    # opens local UI on :2024
```

## PRISMtrace

Set these environment variables to enable tracing:

- `PRISMTRACE_API_KEY`
- `PRISMTRACE_PROJECT_ID`
- `PRISMTRACE_HOST` (optional; defaults to BlockConvey)

When configured, the CLI attaches the PRISM LangGraph callback and flushes the trace on exit.

## Files

```
agents/
├── README.md                   ← this file
├── docs/                       ← architecture, demo script, runbook
├── config/                     ← model + agent configs
├── scripts/                    ← index_corpus.py, eval.py
├── src/
│   ├── run.py                  ← CLI entry
│   ├── orchestrator/graph.py   ← LangGraph StateGraph
│   ├── agents/                 ← evidence, analyst, memory, cfo_brief
│   ├── tools/                  ← drive_loader, notion_client, vector_store, pandas_tool
│   ├── memory/checkpointer.py  ← session state persistence
│   └── state/schema.py         ← typed state across nodes
└── tests/
```
