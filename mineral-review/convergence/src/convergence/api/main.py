"""Convergence FastAPI application."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from convergence.api.routes.workstreams import router as workstreams_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Convergence",
        description=(
            "Post-Merger Integration Intelligence Platform - CHP-governed multi-agent Convergence\n\n"
            "## Authentication\n\n"
            "Decision endpoints require API key authentication. "
            "Include the `X-API-Key` header with your requests to access decision data."
        ),
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(workstreams_router)
    return app


app = create_app()


def main():
    import uvicorn
    uvicorn.run("convergence.api.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
