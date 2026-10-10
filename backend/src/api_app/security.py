"""Protection for endpoints that change how claims are evaluated.

Rule and reference-data changes take effect immediately, so they require a
shared admin token. If no token is configured on the server, those endpoints
are disabled (fail closed) rather than open to anyone who can reach the API.

This is a minimal Phase 1 safeguard, not user authentication: everyone who
holds the token is "an admin". The acting person's name comes from X-Actor.
"""

import hmac
import os

from fastapi import Header, HTTPException, Request

ADMIN_TOKEN_ENV = "CLAIMGUARD_ADMIN_TOKEN"
MIN_TOKEN_LENGTH = 16
MAX_ACTOR_LENGTH = 128


def configured_admin_token() -> str | None:
    token = os.getenv(ADMIN_TOKEN_ENV, "").strip()
    return token if len(token) >= MIN_TOKEN_LENGTH else None


def require_admin(request: Request, x_admin_token: str | None = Header(default=None)) -> None:
    expected = request.app.state.admin_token
    if not expected:
        raise HTTPException(
            status_code=503,
            detail=f"Admin changes are disabled: set {ADMIN_TOKEN_ENV} (at least {MIN_TOKEN_LENGTH} characters) on the server.",
        )
    if x_admin_token is None or not hmac.compare_digest(x_admin_token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="A valid X-Admin-Token header is required.")


def acting_admin(x_actor: str | None = Header(default=None)) -> str:
    """The name recorded in the audit log for an admin action."""
    if x_actor is None:
        return "admin"
    actor = x_actor.strip()
    if not actor or len(actor) > MAX_ACTOR_LENGTH:
        raise HTTPException(
            status_code=422,
            detail={"errors": [f"X-Actor must be 1 to {MAX_ACTOR_LENGTH} characters."]},
        )
    return actor
