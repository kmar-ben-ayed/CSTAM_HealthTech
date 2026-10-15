"""Ranking. The lexical retriever (BM25 plus exact identifier and date boosts) is
the offline baseline. The embedding retriever is an optional re-ranker that
falls back to lexical on any error."""
import math
import os
import re
from collections import Counter
from typing import Callable, Protocol

from evidence_rag.models import Passage, QueryTerms, ScoredPassage

TOP_K = 5
K1 = 1.5
B = 0.75
IDENTIFIER_BOOST = 8.0
DATE_BOOST = 4.0
WORD_WEIGHT = 1.0
NUMBER_WEIGHT = 0.5
HINT_WEIGHT = 0.3
MIN_WORD_MATCHES = 2

_TOKEN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def exact_pattern(term: str) -> re.Pattern:
    """Verbatim match with boundaries, so AUTH-1 does not match inside AUTH-12."""
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9]|-[A-Za-z0-9])")


def word_pattern(term: str) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])" + re.escape(term.lower()) + r"(?![a-z0-9])", re.IGNORECASE)


class Retriever(Protocol):
    name: str

    def rank(self, terms: QueryTerms, passages: list[Passage], top_k: int = TOP_K) -> list[ScoredPassage]:
        ...


class LexicalRetriever:
    name = "lexical"

    def score_all(self, terms: QueryTerms, passages: list[Passage]) -> list[ScoredPassage]:
        weighted = (
            [(word, WORD_WEIGHT, "words") for word in terms.words]
            + [(number.lower(), NUMBER_WEIGHT, "numbers") for number in terms.numbers if _TOKEN.fullmatch(number.lower())]
            + [(hint, HINT_WEIGHT, "hints") for hint in terms.hints]
        )
        documents = [Counter(tokenize(passage.text)) for passage in passages]
        n = len(passages)
        average = (sum(sum(doc.values()) for doc in documents) / n) if n else 0.0
        frequency = Counter(token for doc in documents for token in doc)
        identifiers = [(term, exact_pattern(term)) for term in terms.identifiers]
        dates = [(term, exact_pattern(term)) for term in terms.dates]

        scored = []
        for passage, doc in zip(passages, documents):
            length = sum(doc.values()) or 1
            bm25 = 0.0
            matched = {"identifiers": [], "dates": [], "words": [], "hints": []}
            for token, weight, kind in weighted:
                tf = doc.get(token, 0)
                if not tf:
                    continue
                idf = math.log(1 + (n - frequency[token] + 0.5) / (frequency[token] + 0.5))
                bm25 += weight * idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * length / (average or 1)))
                matched["hints" if kind == "hints" else "words"].append(token)
            matched["identifiers"] = [term for term, pattern in identifiers if pattern.search(passage.text)]
            matched["dates"] = [term for term, pattern in dates if pattern.search(passage.text)]
            score = bm25 + IDENTIFIER_BOOST * len(matched["identifiers"]) + DATE_BOOST * len(matched["dates"])
            scored.append(ScoredPassage(passage=passage, score=round(score, 4), matched=matched))
        return scored

    @staticmethod
    def relevant(item: ScoredPassage) -> bool:
        """Weak hints alone (rule title words) never make a passage relevant."""
        return bool(
            item.matched["identifiers"]
            or item.matched["dates"]
            or len(set(item.matched["words"])) >= MIN_WORD_MATCHES
        )

    def rank(self, terms: QueryTerms, passages: list[Passage], top_k: int = TOP_K) -> list[ScoredPassage]:
        scored = [item for item in self.score_all(terms, passages) if item.score > 0 and self.relevant(item)]
        scored.sort(key=lambda item: (-item.score, item.passage.passage_id))
        return scored[:top_k]


Embedder = Callable[[list[str]], list[list[float]]]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class EmbeddingRetriever:
    """Re-ranks lexical candidates with embedding similarity. Any failure falls
    back to the lexical ranking, so retrieval never depends on the network."""

    name = "embedding"
    SIMILARITY_WEIGHT = 5.0
    MIN_SIMILARITY = 0.5

    def __init__(self, embed: Embedder, lexical: LexicalRetriever | None = None):
        self.embed = embed
        self.lexical = lexical or LexicalRetriever()
        self.last_fallback = False

    def rank(self, terms: QueryTerms, passages: list[Passage], top_k: int = TOP_K) -> list[ScoredPassage]:
        self.last_fallback = False
        try:
            if not passages:
                return []
            query = " ".join(terms.identifiers + terms.dates + terms.words + terms.hints)
            vectors = self.embed([query] + [passage.text[:2000] for passage in passages])
            if len(vectors) != len(passages) + 1:
                raise ValueError("embedding count mismatch")
            scored = self.lexical.score_all(terms, passages)
            kept = []
            for item, vector in zip(scored, vectors[1:]):
                similarity = _cosine(vectors[0], vector)
                if self.lexical.relevant(item) or similarity >= self.MIN_SIMILARITY:
                    item.score = round(item.score + self.SIMILARITY_WEIGHT * similarity, 4)
                    if item.score > 0:
                        kept.append(item)
            kept.sort(key=lambda item: (-item.score, item.passage.passage_id))
            return kept[:top_k]
        except Exception:
            self.last_fallback = True
            return self.lexical.rank(terms, passages, top_k)


def openai_embedder() -> Embedder:
    from openai import OpenAI

    client = OpenAI(base_url=os.environ.get("OPENAI_BASE_URL") or None, timeout=10.0, max_retries=0)
    model = os.environ.get("EVIDENCE_EMBEDDING_MODEL", "text-embedding-3-small")

    def embed(texts: list[str]) -> list[list[float]]:
        response = client.embeddings.create(model=model, input=texts)
        return [item.embedding for item in response.data]

    return embed


def retriever_from_environment() -> LexicalRetriever | EmbeddingRetriever:
    if os.environ.get("EVIDENCE_EMBEDDINGS", "").strip().lower() == "true" and os.environ.get("OPENAI_API_KEY"):
        try:
            return EmbeddingRetriever(openai_embedder())
        except Exception:
            return LexicalRetriever()
    return LexicalRetriever()
