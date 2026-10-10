import os
from contextlib import asynccontextmanager
from pathlib import Path
import json
from dotenv import load_dotenv

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from api_app.routes import legacy_router, v1_router
from api_app.rule_routes import router as rule_router
from api_app.security import configured_admin_token
from rule_authoring.drafts import DraftStore
from rule_authoring.llm import AuthoringModels, models_from_environment
from rule_authoring.service import AuthoringError, AuthoringSettings, RuleAuthoringService
from api_app.services import (
    BACKEND_ROOT,
    ApiProblem,
    AuditService,
    ClaimService,
    DatasetService,
    ExplanationService,
    IngestionStore,
    IngestionService,
)
from audit.logger import AuditLogger
from audit.store import AuditStore
from rule_engine.engine_core import config as load_rules_config
from rule_engine.spec_store import default_database


MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024


class RequestBodyTooLarge(Exception):
    pass


class MaxBodySizeMiddleware:
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    response = JSONResponse(
                        {"error": "Request body exceeds the 5 MB limit", "code": "body_too_large"},
                        status_code=413,
                    )
                    await response(scope, receive, send)
                    return
            except ValueError:
                response = JSONResponse(
                    {"error": "Invalid Content-Length header", "code": "invalid_content_length"},
                    status_code=400,
                )
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            response = JSONResponse(
                {"error": "Request body exceeds the 5 MB limit", "code": "body_too_large"},
                status_code=413,
            )
            await response(scope, receive, send)


def create_app(
    backend_root: Path = BACKEND_ROOT,
    audit_log_path: Path | None = None,
    admin_token: str | None = None,
    authoring_models: AuthoringModels | None = None,
    authoring_settings: AuthoringSettings | None = None,
    load_models_from_environment: bool = True,
) -> FastAPI:
    """Build the API. Tests pass their own models and load_models_from_environment=False,
    so they never reach a real model endpoint."""
    backend_root = Path(backend_root)
    load_dotenv(backend_root / ".env.local", override=False)
    load_dotenv(backend_root / ".env", override=False)
    configured_audit_path = audit_log_path or Path(
        os.getenv("CLAIMGUARD_AUDIT_LOG", str(backend_root / "outputs" / "audit_log.jsonl"))
    )
    resolved_audit_path = Path(configured_audit_path)
    # Rule specs and rule drafts share one database. An app built with its own
    # audit log (as tests do) keeps it next to that log, isolated from the real one.
    rules_db = (
        default_database(backend_root)
        if audit_log_path is None
        else str(Path(audit_log_path).with_name("rules.sqlite3"))
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.backend_root = backend_root
        app.state.admin_token = admin_token or configured_admin_token()
        rules_config = load_rules_config(backend_root, rules_db)
        claim_schema = json.loads((backend_root / "schemas" / "claim.schema.json").read_text(encoding="utf-8"))
        audit_store = AuditStore(resolved_audit_path)
        audit_logger = AuditLogger(audit_store)
        claim_service = ClaimService(rules_config, claim_schema, audit_logger)
        app.state.audit_service = AuditService(resolved_audit_path, audit_logger)
        app.state.claim_service = claim_service
        app.state.dataset_service = DatasetService(claim_service, backend_root)
        ingestion_path = (
            backend_root / "outputs" / "ingestion.sqlite3"
            if audit_log_path is None
            else Path(audit_log_path).with_name("ingestion.sqlite3")
        )
        app.state.ingestion_service = IngestionService(
            claim_service, backend_root, IngestionStore(ingestion_path)
        )
        app.state.explanation_service = ExplanationService(rules_config, claim_service, audit_logger)

        def reload_rules() -> None:
            """Make rule and reference-data changes visible without a restart."""
            fresh = load_rules_config(backend_root, rules_db)
            app.state.claim_service.rules_config = fresh
            app.state.explanation_service.rules = {rule["rule_id"]: rule for rule in fresh["rules"]}

        app.state.reload_rules = reload_rules
        app.state.rule_authoring = RuleAuthoringService(
            backend_root=backend_root,
            rules_db=rules_db,
            drafts=DraftStore(Path(rules_db)),
            audit_logger=audit_logger,
            models=authoring_models or (models_from_environment() if load_models_from_environment else None),
            on_rules_changed=reload_rules,
            settings=authoring_settings or AuthoringSettings.from_environment(),
        )
        yield
        app.state.rule_authoring.close()

    app = FastAPI(
        title="ClaimGuard AI API",
        version="1.0.0",
        description="Local API for synthetic claim validation and review workflows.",
        lifespan=lifespan,
    )
    cors_origins = [
        origin.strip()
        for origin in os.getenv(
            "CLAIMGUARD_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8443,http://127.0.0.1:8443",
        ).split(",")
        if origin.strip()
    ]
    app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Request-ID", "X-Actor", "X-Admin-Token"])
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=MAX_REQUEST_BODY_BYTES)

    @app.exception_handler(ApiProblem)
    async def handle_api_problem(request: Request, error: ApiProblem):
        return JSONResponse(
            {"error": error.message, "code": error.code},
            status_code=error.status_code,
        )

    @app.exception_handler(AuthoringError)
    async def handle_authoring_error(request: Request, error: AuthoringError):
        return JSONResponse(
            {"error": error.message, "code": error.code},
            status_code=error.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, error: RequestValidationError):
        details = [
            {"location": item["loc"], "message": item["msg"], "type": item["type"]}
            for item in error.errors()
        ]
        return JSONResponse(
            {"error": "Invalid request", "code": "request_validation_error", "details": details},
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, error: StarletteHTTPException):
        codes = {404: "not_found", 405: "method_not_allowed"}
        if isinstance(error.detail, str):
            message = error.detail
            payload = {"error": message, "code": codes.get(error.status_code, "http_error")}
        else:
            payload = {
                "error": "Request failed",
                "code": codes.get(error.status_code, "http_error"),
                "details": error.detail,
            }
        return JSONResponse(
            payload,
            status_code=error.status_code,
            headers=error.headers,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception):
        return JSONResponse(
            {"error": "Internal server error", "code": "internal_error"},
            status_code=500,
        )

    app.include_router(rule_router)
    app.include_router(v1_router)
    app.include_router(legacy_router)
    return app


app = create_app()