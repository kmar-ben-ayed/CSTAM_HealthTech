"""A small JSON-only chat interface over any OpenAI-compatible endpoint.

Both model roles (drafter and oracle) go through ``ChatModel``, so tests can
swap in ``ScriptedChatModel``, and every failure (network, timeout, refusal,
non-JSON or oversized output) surfaces as one exception type: ``ModelError``.
"""

from __future__ import annotations

import copy
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Protocol

MAX_RESPONSE_CHARS = 40_000
# Reasoning models think before answering, and the thinking counts against the output
# budget; an answer cut off empty is retried with twice the budget, up to this.
MAX_OUTPUT_TOKENS = 32_000
# The first budget. A retry starts the answer over, so a budget the thinking fills is lost time:
# at 8000, 2 of 13 calls in speed2 were cut off, 173 of 556 seconds of model time. A budget is
# only a limit, so a larger one costs nothing when the answer is short.
FIRST_OUTPUT_TOKENS = 16_000
# Seconds to wait before retrying after a rate limit (limits are usually per minute).
RATE_LIMIT_WAITS = (15, 30, 60)

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
        timeout_seconds: float = 180.0,
        max_output_tokens: int = FIRST_OUTPUT_TOKENS,
        temperature: float = 0.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        from openai import OpenAI

        self.name = model
        self.max_output_tokens = max_output_tokens
        self.temperature = temperature
        self._sleep = sleep
        # What the last call on this thread cost, for the drafting log: R010's calls took over
        # five minutes each (speed1), and the log could not say whether that was thinking,
        # a repeat with twice the budget, or a slow provider.
        self._calls = threading.local()
        # Brief 5xx answers and dropped connections are retried by the client itself.
        self._client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=2)  # with timeout_seconds: a stalled call gives up after ~9 minutes, not ~15

    def with_temperature(self, temperature: float) -> "OpenAIChatModel":
        """The same model and connection, sampling at another temperature (for independent drafts)."""
        variant = copy.copy(self)
        variant.temperature = temperature
        return variant

    def complete_json(self, messages: list[Message]) -> dict[str, Any]:
        """One answer as a JSON object. Two provider behaviours are absorbed here:

        - a rate limit (429) counted per minute: the call waits and tries again
          (RATE_LIMIT_WAITS) instead of failing after a few seconds;
        - a reasoning model that spent its whole output budget thinking returns an
          empty answer cut off at the limit: the call is repeated with twice the
          budget, up to MAX_OUTPUT_TOKENS.
        """
        from openai import RateLimitError

        budget = self.max_output_tokens
        waits = list(RATE_LIMIT_WAITS)
        attempts: list[dict[str, Any]] = []
        self._calls.last = attempts
        while True:
            started = time.monotonic()
            try:
                response = self._client.chat.completions.create(
                    model=self.name,
                    temperature=self.temperature,
                    max_tokens=budget,
                    response_format={"type": "json_object"},
                    messages=messages,
                )
            except RateLimitError as error:
                if not waits:
                    raise ModelError(f"model call failed ({type(error).__name__})") from error
                self._sleep(waits.pop(0))
                continue
            except Exception as error:  # any other provider or network failure
                raise ModelError(f"model call failed ({type(error).__name__})") from error
            choice = response.choices[0]
            content = choice.message.content or ""
            attempts.append(_attempt(response, budget, time.monotonic() - started))
            if not content.strip() and choice.finish_reason == "length":
                if budget < MAX_OUTPUT_TOKENS:
                    budget = min(budget * 2, MAX_OUTPUT_TOKENS)
                    continue
                raise ModelFormatError(f"the model used its whole output budget ({budget} tokens) before "
                                       "answering: think less and reply with the JSON object", "")
            return parse_json_object(content)


def _attempt(response: Any, budget: int, seconds: float) -> dict[str, Any]:
    """One request of a call: its budget, why it ended, and the tokens it used (thinking included)."""
    usage = getattr(response, "usage", None)
    details = getattr(usage, "completion_tokens_details", None)
    return {
        "max_tokens": budget,
        "finish_reason": response.choices[0].finish_reason,
        "seconds": round(seconds, 1),
        "prompt_tokens": getattr(usage, "prompt_tokens", None),
        "completion_tokens": getattr(usage, "completion_tokens", None),
        "reasoning_tokens": getattr(details, "reasoning_tokens", None),
    }


def last_call(model: Any) -> list[dict[str, Any]] | None:
    """The requests of the model's last call on this thread, if it records them."""
    calls = getattr(model, "_calls", None)
    return getattr(calls, "last", None) if calls is not None else None


def parse_json_object(content: str) -> dict[str, Any]:
    """Read the model's answer as one JSON object, tolerating common small-model slips.

    Small models often wrap the object in prose or code fences, stop before the
    last closing brackets, or write JavaScript/Python-flavoured JSON (comments,
    trailing commas, single or curly quotes, True/False/None). Those are repaired
    here; anything else raises ModelFormatError with the parser's own message, so
    the model can fix the exact spot. A repaired answer is still checked as
    strictly as any other.
    """
    if len(content) > MAX_RESPONSE_CHARS:
        raise ModelFormatError("the answer is too long", content[:MAX_RESPONSE_CHARS])
    start = content.find("{")
    if start < 0:
        raise ModelFormatError("the answer contains no JSON object", content)
    text = content[start:]
    loosened = _loosen(text)
    first_error: json.JSONDecodeError | None = None
    for candidate in (text, _close_brackets(text), loosened, _close_brackets(loosened)):
        try:
            parsed, _ = json.JSONDecoder().raw_decode(candidate)  # ignores text after the object
        except json.JSONDecodeError as error:
            first_error = first_error or error
            continue
        if isinstance(parsed, dict):
            return parsed
    detail = f" ({first_error.msg} at line {first_error.lineno} column {first_error.colno})" if first_error else ""
    raise ModelFormatError(f"the answer is not one valid JSON object{detail}", content)


_PYTHON_LITERALS = {"True": "true", "False": "false", "None": "null"}
# Opening quote -> closing quote: straight double, curly double, single.
_QUOTES = {'"': '"', "“": "”", "'": "'"}


def _loosen(text: str) -> str:
    """Rewrite near-JSON into JSON: drop comments and trailing commas, turn single
    and curly quotes into double quotes, and Python literals into JSON ones, and
    close a list the answer forgot to close before the next key or closing brace.
    Text inside strings is never changed."""
    out: list[str] = []
    stack: list[str] = []  # the open containers, "{" or "["
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        if char in _QUOTES:  # a string: copy it as a JSON string
            if _is_key(text, i, _QUOTES[char]):
                _key_inside_list(out, stack)
            closer = _QUOTES[char]
            i += 1
            chars: list[str] = []
            while i < n and text[i] != closer:
                if text[i] == "\\" and i + 1 < n:
                    # \' is not a JSON escape; inside a string it is just the apostrophe.
                    chars.append("'" if text[i + 1] == "'" else text[i:i + 2])
                    i += 2
                    continue
                chars.append('\\"' if text[i] == '"' and closer != '"' else text[i])
                i += 1
            out.append('"' + "".join(chars) + '"')
            i += 1
        elif text.startswith("//", i) or char == "#":
            while i < n and text[i] != "\n":
                i += 1
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
        elif char == ",":
            j = i + 1
            while j < n and text[j].isspace():
                j += 1
            if j < n and text[j] in "}]":
                i += 1  # trailing comma
            else:
                out.append(char)
                i += 1
        elif char.isalpha():
            j = i
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            word = text[i:j]
            k = j
            while k < n and text[k].isspace():
                k += 1
            if k < n and text[k] == ":" and word not in _PYTHON_LITERALS:
                _key_inside_list(out, stack)
                out.append(f'"{word}"')  # an unquoted key
            else:
                out.append(_PYTHON_LITERALS.get(word, word))
            i = j
        elif char in "{[":
            stack.append(char)
            out.append(char)
            i += 1
        elif char == "}":
            _close_open_lists(out, stack)  # a list left open inside this object
            if stack:
                stack.pop()
            out.append(char)
            i += 1
        elif char == "]":
            while stack and stack[-1] == "{":  # an object left open inside this list
                stack.pop()
                out.append("}")
            if stack:
                stack.pop()
            out.append(char)
            i += 1
        else:
            out.append(char)
            i += 1
    return "".join(out)


def _is_key(text: str, start: int, closer: str) -> bool:
    """Whether the string starting at `start` is followed by a colon (an object key)."""
    end = text.find(closer, start + 1)
    while end > 0 and text[end - 1] == "\\":
        end = text.find(closer, end + 1)
    if end < 0:
        return False
    rest = text[end + 1:].lstrip()
    return rest.startswith(":")


def _key_inside_list(out: list[str], stack: list[str]) -> None:
    """An object key where a list is open. Right after "[" it is an object written
    without its braces (["path": "$x"] for [{"path": "$x"}]): open the object, and
    the "]" that follows closes it. After list items, the list itself was left open
    before the next key of the enclosing object: close it."""
    if not stack or stack[-1] != "[":
        return
    if "".join(out).rstrip().endswith("["):
        out.append("{")
        stack.append("{")
    else:
        _close_open_lists(out, stack)


def _close_open_lists(out: list[str], stack: list[str]) -> None:
    """Close the lists left open where an object key or brace appears; a comma that
    ended the list stays after the inserted brackets."""
    if not stack or stack[-1] != "[":
        return
    closers = ""
    while stack and stack[-1] == "[":
        stack.pop()
        closers += "]"
    written = "".join(out).rstrip()
    comma = written.endswith(",")
    if comma:
        written = written[:-1].rstrip()
    out[:] = [written + closers + (", " if comma else "")]


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

    def with_temperature(self, temperature: float) -> "ScriptedChatModel":
        return self  # replays the same script whatever the temperature

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
