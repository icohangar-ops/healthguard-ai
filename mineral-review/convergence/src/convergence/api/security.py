"""Security dependencies for Convergence API."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

# API key header scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_api_key() -> Optional[str]:
    """Get the configured API key from environment."""
    return os.getenv("CONVERGENCE_API_KEY")


async def verify_api_key(api_key: Optional[str] = Security(api_key_header)) -> str:
    """
    Verify the API key from the request header.

    Raises HTTPException with 401 status if authentication fails.
    Returns the validated API key if successful.
    """
    configured_key = get_api_key()

    # If no API key is configured, deny access with clear error message
    if not configured_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API authentication is not configured on the server",
        )

    # If no API key provided in request
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key. Provide X-API-Key header.",
        )

    # Verify the API key matches
    if api_key != configured_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    return api_key
