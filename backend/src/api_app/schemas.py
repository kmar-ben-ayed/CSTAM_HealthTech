from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClaimRequest(StrictModel):
    claim: dict[str, Any]


class ClaimsBatchRequest(StrictModel):
    claims: list[dict[str, Any]] = Field(min_length=1, max_length=100)


class TextIngestRequest(StrictModel):
    text: str = Field(min_length=1)


class FhirValidateRequest(StrictModel):
    bundle: dict[str, Any] | list[Any] | None = None
    text: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_one_input(self):
        if (self.bundle is None) == (self.text is None):
            raise ValueError("Provide exactly one of 'bundle' or 'text'")
        return self


class FhirIngestRequest(TextIngestRequest):
    sidecar_split: Literal["development", "validation", "stress"] | None = None


class CsvIngestRequest(StrictModel):
    files: dict[str, str]


class ExplanationRequest(StrictModel):
    claim: dict[str, Any]
    rule_id: str = Field(pattern=r"^R0(?:0[1-9]|1[0-5])$")
    provider: Literal["mock", "openai"] = "mock"


class ReviewDecisionRequest(StrictModel):
    claim_id: str = Field(min_length=1, max_length=128)
    rule_id: str = Field(pattern=r"^R0(?:0[1-9]|1[0-5])$")
    action: Literal[
        "confirm_issue",
        "dismiss_with_reason",
        "request_information",
        "mark_corrected_for_recheck",
    ]
    actor: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=2000)
    created_at: datetime
    original_status: Literal[
        "PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE", "NOT_IMPLEMENTED"
    ]

    @field_validator("actor", "reason")
    @classmethod
    def reject_whitespace_only(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class AuditVerificationResponse(BaseModel):
    valid: bool
    first_broken_index: int | None


class ApiErrorResponse(BaseModel):
    error: str
    code: str