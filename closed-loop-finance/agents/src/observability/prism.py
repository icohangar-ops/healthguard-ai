"""PRISMtrace wiring for the Closed Loop Finance agents."""
from __future__ import annotations

import os
from dataclasses import dataclass

from prismtrace import PRISMtrace, PRISMtraceLangGraphHandler
from prismtrace._config import resolve_host


@dataclass(slots=True)
class PrismSession:
    client: PRISMtrace
    handler: PRISMtraceLangGraphHandler
    session_id: str
    agent_name: str = "Closed Loop Finance"
    agent_id: str = "closed-loop-finance"


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def build_prism_session(session_id: str, agent_name: str = "Closed Loop Finance") -> PrismSession | None:
    api_key = _env("PRISMTRACE_API_KEY")
    project_id = _env("PRISMTRACE_PROJECT_ID")
    if not (api_key and project_id):
        return None

    host = resolve_host(_env("PRISMTRACE_HOST"), _env("PRISMTRACE_ENDPOINT"))

    client = PRISMtrace(api_key=api_key, host=host, project_id=project_id)
    handler = PRISMtraceLangGraphHandler(
        api_key=api_key,
        project_id=project_id,
        host=host,
        session_id=session_id,
        agent_name=agent_name,
    )
    return PrismSession(client=client, handler=handler, session_id=session_id, agent_name=agent_name)
