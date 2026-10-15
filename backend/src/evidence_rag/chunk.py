"""Page-aware chunking. Passages never cross a page boundary, carry character
offsets into their page text, and have ids that depend only on their content
position, so re-chunking the same document gives the same ids."""
import hashlib
import re

from evidence_rag.models import Passage

CHUNK_WORDS = 150
OVERLAP_WORDS = 25
_WORD = re.compile(r"\S+")


def passage_id(document_id: str, page: int | None, start: int, end: int) -> str:
    digest = hashlib.sha256(f"{document_id}:{page}:{start}:{end}".encode("utf-8")).hexdigest()
    return f"psg-{digest[:16]}"


def chunk_page(
    document_id: str,
    attachment_id: str,
    filename: str,
    page: int | None,
    text: str,
    source: str = "pdf",
    chunk_words: int = CHUNK_WORDS,
    overlap: int = OVERLAP_WORDS,
) -> list[Passage]:
    words = list(_WORD.finditer(text))
    if not words:
        return []
    step = max(1, chunk_words - overlap)
    passages = []
    position = 0
    while True:
        window = words[position:position + chunk_words]
        start, end = window[0].start(), window[-1].end()
        passages.append(Passage(
            passage_id=passage_id(document_id, page, start, end),
            document_id=document_id,
            attachment_id=attachment_id,
            filename=filename,
            page=page,
            start=start,
            end=end,
            text=text[start:end],
            source=source,
        ))
        if position + chunk_words >= len(words):
            break
        position += step
    return passages


def chunk_pages(document_id: str, attachment_id: str, filename: str, pages: list[str]) -> list[Passage]:
    passages: list[Passage] = []
    for number, text in enumerate(pages, start=1):
        passages.extend(chunk_page(document_id, attachment_id, filename, number, text))
    return passages
