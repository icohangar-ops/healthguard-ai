"""CLI entry: run the Closed Loop Finance graph for a given period."""
from __future__ import annotations

import json
import os
from pathlib import Path

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .memory.checkpointer import thread_id_for
from .orchestrator.graph import build_graph
from .observability.prism import build_prism_session

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def run(
    period: str = typer.Option(None, help="e.g. '2026-03 March Close'"),
    repo_root: str = typer.Option(None, help="Path to the closed-loop-finance repo root."),
    auto_approve: bool = typer.Option(
        False, help="Skip the human gate and write decisions automatically (demo only)."
    ),
):
    """Execute the closed-loop run for `period`."""
    load_dotenv()
    period = period or os.environ.get("DEFAULT_PERIOD", "2026-03 March Close")
    repo_root = repo_root or os.environ.get("REPO_ROOT", "..")
    repo_root = str(Path(repo_root).resolve())
    thread = thread_id_for(period)
    prism = build_prism_session(session_id=thread, agent_name="Closed Loop Finance")

    console.print(Panel.fit(
        f"[bold]Closed Loop Finance run[/bold]\n"
        f"period      : {period}\n"
        f"repo_root   : {repo_root}\n"
        f"thread_id   : {thread}\n"
        f"auto_approve: {auto_approve}\n"
        f"prism       : {'on' if prism else 'off'}",
        title="config",
    ))

    graph = build_graph()
    config = {"configurable": {"thread_id": thread}}
    if prism:
        config["callbacks"] = [prism.handler]

    inputs = {"period": period, "repo_root": repo_root}

    try:
        console.rule("[cyan]Phase 1 — evidence → analyst → memory → cfo_brief")
        state = None
        for state in graph.stream(inputs, config=config, stream_mode="values"):
            _print_node_trace(state)

        # Pause before memory_write — show the proposal, ask for approval
        snapshot = graph.get_state(config)
        pending = snapshot.next  # tuple of node names paused before
        if not pending:
            console.print("[green]Run complete (no pause).[/green]")
            return

        brief = (state or {}).get("cfo_brief", {})
        _print_proposal(brief)

        approved = auto_approve
        if not approved:
            ans = typer.prompt("Approve writing these decisions to Notion? (y/N)", default="N")
            approved = ans.strip().lower() in {"y", "yes"}

        graph.update_state(config, {"human_approved": approved, "approver": os.environ.get("USER", "operator")})

        console.rule("[cyan]Phase 2 — memory_write")
        for state in graph.stream(None, config=config, stream_mode="values"):
            _print_node_trace(state)

        console.print(Panel.fit(
            f"[bold green]Done[/bold green]\n"
            f"memo: {brief.get('memo_path','-')}\n"
            f"audit: {brief.get('audit_note_path','-')}\n"
            f"notion rows written: {len((state or {}).get('notion_rows_written', []))}",
            title="result",
        ))
    finally:
        if prism:
            prism.client.flush()


def _print_node_trace(state: dict) -> None:
    msgs = state.get("messages") or []
    if not msgs:
        return
    last = msgs[-1]
    name = getattr(last, "name", None) or last.__class__.__name__
    content = getattr(last, "content", "")
    console.print(f"[bold]{name}[/bold]: {content}")


def _print_proposal(brief: dict) -> None:
    console.rule("[yellow]Proposed Notion decisions (human gate)")
    rows = brief.get("proposed_decisions", [])
    if not rows:
        console.print("[dim]No decisions proposed.[/dim]")
        return
    table = Table(show_lines=True)
    for col in ["Decision", "Date", "Category", "Owner", "Decision Made"]:
        table.add_column(col, overflow="fold")
    for d in rows:
        table.add_row(
            d.get("decision", ""),
            d.get("decision_date", ""),
            d.get("category", ""),
            d.get("owner", ""),
            d.get("decision_made", ""),
        )
    console.print(table)
    msgs = brief.get("three_messages", [])
    console.rule("[yellow]Three board messages")
    console.print(json.dumps(msgs, indent=2))


if __name__ == "__main__":
    app()
