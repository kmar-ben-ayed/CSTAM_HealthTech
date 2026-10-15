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


RULE_ID_PATTERN = r"^R\d{3,}$"


class ExplanationRequest(StrictModel):
    claim: dict[str, Any]
    rule_id: str = Field(pattern=RULE_ID_PATTERN, max_length=32)
    provider: Literal["mock", "openai"] = "openai"


class ReviewDecisionRequest(StrictModel):
    claim_id: str = Field(min_length=1, max_length=128)
    rule_id: str = Field(pattern=RULE_ID_PATTERN, max_length=32)
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


class ClaimDecisionRequest(StrictModel):
    """A reviewer's decision on a whole claim. "reopen" withdraws the previous one."""

    decision: Literal["approve", "reject", "reopen"]
    actor: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=2000)
    created_at: datetime

    @field_validator("actor", "reason")
    @classmethod
    def reject_whitespace_only(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ExampleClaim(StrictModel):
    """A claim (in the claim format) and the outcome the author expects the rule to give it."""

    claim: dict[str, Any]
    expected_status: Literal["PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE"]


class RuleDraftRequest(StrictModel):
    """A rule in English. Leave rule_id empty for a new rule; give it to revise an existing one."""

    rule_id: str | None = Field(default=None, pattern=RULE_ID_PATTERN, max_length=32)
    title: str = Field(min_length=3, max_length=120)
    severity: Literal["low", "medium", "high"]
    logic: str = Field(min_length=10, max_length=2000)
    corrective_action: str = Field(min_length=3, max_length=500)
    # Optional: claims with the outcome the rule must give them, shown to the drafter from the start.
    examples: list[ExampleClaim] = Field(default_factory=list, max_length=10)

    @field_validator("title", "logic", "corrective_action")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class DraftAnswerRequest(StrictModel):
    question_id: str = Field(min_length=1, max_length=32)
    answer: str = Field(min_length=1, max_length=1000)


class CaseVerdict(StrictModel):
    case_id: str = Field(min_length=1, max_length=64)
    expected_status: Literal["PASS", "FAIL", "UNABLE_TO_ASSESS", "NOT_APPLICABLE"]


class DraftCorrectionsRequest(StrictModel):
    """The author's verdicts on a draft's generated test claims."""

    corrections: list[CaseVerdict] = Field(min_length=1, max_length=100)


class DraftExamplesRequest(StrictModel):
    """Example claims answering a stuck drafter's request."""

    examples: list[ExampleClaim] = Field(min_length=1, max_length=10)


class AuditVerificationResponse(BaseModel):
    valid: bool
    first_broken_index: int | None


class ApiErrorResponse(BaseModel):
    error: str
    code: str