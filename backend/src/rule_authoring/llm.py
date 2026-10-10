"""A small JSON-only chat interface over any OpenAI-compatible endpoint.

Both model roles (drafter and oracle) go through ``ChatModel``, so tests can
swap in ``ScriptedChatModel``, and every failure (network, timeout, refusal,
non-JSON or oversized output) surfaces as one exception type: ``ModelError``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Protocol

MAX_RESPONSE_CHARS = 40_000

Message = dict[str, str]


class ModelError(RuntimeError):
    """The model could not produce a usable JSON answer."""


class ModelFormatError(ModelError):
    """The model answered, but not with one JSON object. Worth telling it and retrying."""

    def __init__(self, message: str, raw: str):
        super().__init__(message)
        self.raw = raw


class ChatModel(Protocol):
    name: str

    def complete_json(self, messages: list[Message]) -> dict[str, Any]:
        """Return the model's reply as a JSON object, or raise ModelError."""


class OpenAIChatModel:
    def __init__(
        self,
        model: str,
        *,
        api_key: str,
        base_url: str | None = None,
        timeout_seconds: float = 90.0,
        max_output_tokens: int = 4000,
    ):
        from openai import OpenAI

        self.name = model
        self.max_output_tokens = max_output_tokens
        self._client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=1)

    def complete_json(self, messages: list[Message]) -> dict[str, Any]:
        try:
            response = self._client.chat.completions.create(
                model=self.name,
                temperature=0,
                max_tokens=self.max_output_tokens,
                response_format={"type": "json_object"},
                messages=messages,
            )
            content = response.choices[0].message.content or ""
        except Exception as error:  # any provider or network failure
            raise ModelError(f"model call failed ({type(error).__name__})") from error
        return parse_json_object(content)


def parse_json_object(content: str) -> dict[str, Any]:
    """Read the model's answer as one JSON object, tolerating common small-model slips.

    Small models often wrap the object in prose or code fences, or stop before
    the last closing brackets. Those are repaired here; anything else raises
    ModelFormatError. A repaired answer is still checked as strictly as any other.
    """
    if len(content) > MAX_RESPONSE_CHARS:
        raise ModelFormatError("the answer is too long", content[:2000])
    start = content.find("{")
    if start < 0:
        raise ModelFormatError("the answer contains no JSON object", content[:2000])
    text = content[start:]
    for candidate in (text, _close_brackets(text)):
        try:
            parsed, _ = json.JSONDecoder().raw_decode(candidate)  # ignores text after the object
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ModelFormatError("the answer is not one valid JSON object", content[:2000])


def _close_brackets(text: str) -> str:
    """Append the closing brackets an answer that stopped early is missing."""
    text = text.rstrip().rstrip("`").rstrip()
    closers = {"{": "}", "[": "]"}
    stack: list[str] = []
    in_string = escaped = False
    for character in text:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
        elif character == '"':
            in_string = True
        elif character in closers:
            stack.append(closers[character])
        elif character in "}]" and stack and stack[-1] == character:
            stack.pop()
    return text + ("" if in_string else "".join(reversed(stack)))


Reply = dict[str, Any] | str | Callable[[list[Message]], dict[str, Any]]


class ScriptedChatModel:
    """Replays prepared replies in order. Used by tests and offline demos.

    A reply can be a dict, raw text (parsed like a real model answer), or a
    function that receives the conversation so far and returns a dict.
    """

    def __init__(self, replies: Iterable[Reply], name: str = "scripted"):
        self.name = name
        self._replies = list(replies)
        self.calls: list[list[Message]] = []

    def complete_json(self, messages: list[Message]) -> dict[str, Any]:
        self.calls.append([dict(message) for message in messages])
        if not self._replies:
            raise ModelError("scripted model has no replies left")
        reply = self._replies.pop(0)
        if isinstance(reply, str):
            return parse_json_object(reply)
        return reply(messages) if callable(reply) else json.loads(json.dumps(reply))


@dataclass(frozen=True)
class AuthoringModels:
    drafter: ChatModel
    oracle: ChatModel


def models_from_environment() -> AuthoringModels | None:
    """Build the drafter and oracle from environment settings, or None if no key is set.

    RULE_DRAFTER_MODEL and RULE_ORACLE_MODEL choose the models (both default to
    OPENAI_MODEL). Using a different model for the oracle is recommended, so
    the two readings of a rule do not share the same blind spots.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    base_url = os.getenv("OPENAI_BASE_URL") or None
    default_model = os.getenv("OPENAI_MODEL") or "gpt-4o-mini"
    drafter_name = os.getenv("RULE_DRAFTER_MODEL") or default_model  # empty means "use the default"
    oracle_name = os.getenv("RULE_ORACLE_MODEL") or drafter_name
    return AuthoringModels(
        drafter=OpenAIChatModel(drafter_name, api_key=api_key, base_url=base_url),
        oracle=OpenAIChatModel(oracle_name, api_key=api_key, base_url=base_url),
    )
