"""PDF to per-page text. pypdf reads text layers; OCR is an optional fallback for
pages without one. One page failing never fails the whole document."""
import io
import logging
import shutil
from dataclasses import dataclass, field

from evidence_rag.sanitize import clean_text

MIN_PAGE_CHARS = 20

logging.getLogger("pypdf").setLevel(logging.ERROR)


class ExtractionError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class ExtractionResult:
    pages: list[str]
    method: str  # text | ocr | mixed | none
    warnings: list[str] = field(default_factory=list)


def _ocr_page(data: bytes, page_index: int) -> str | None:
    """Return OCR text for one page, or None when no OCR engine is available."""
    try:
        import pytesseract  # type: ignore
    except ImportError:
        return None
    if not shutil.which("tesseract") and not getattr(pytesseract.pytesseract, "tesseract_cmd", "").endswith(".exe"):
        return None
    image = None
    try:
        import fitz  # type: ignore  # pymupdf

        with fitz.open(stream=data, filetype="pdf") as pdf:
            pixmap = pdf[page_index].get_pixmap(dpi=200)
            from PIL import Image

            image = Image.open(io.BytesIO(pixmap.tobytes("png")))
    except ImportError:
        try:
            from pdf2image import convert_from_bytes  # type: ignore

            images = convert_from_bytes(data, dpi=200, first_page=page_index + 1, last_page=page_index + 1)
            image = images[0] if images else None
        except Exception:
            return None
    except Exception:
        return None
    if image is None:
        return None
    try:
        return pytesseract.image_to_string(image)
    except Exception:
        return None


def extract_pdf(data: bytes, *, max_pages: int, max_chars: int) -> ExtractionResult:
    from pypdf import PdfReader

    if not data.startswith(b"%PDF-"):
        raise ExtractionError("invalid_document", "The file is not a PDF")
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        encrypted = reader.is_encrypted
    except Exception as error:
        raise ExtractionError("invalid_document", "The PDF could not be read") from error
    if encrypted:
        raise ExtractionError("invalid_document", "Encrypted PDFs are not supported")
    try:
        page_count = len(reader.pages)
    except Exception as error:
        raise ExtractionError("invalid_document", "The PDF page tree could not be read") from error
    if page_count == 0:
        raise ExtractionError("invalid_document", "The PDF has no pages")
    if page_count > max_pages:
        raise ExtractionError("document_too_large", f"The PDF has more than {max_pages} pages")

    pages: list[str] = []
    warnings: list[str] = []
    used_text = used_ocr = False
    ocr_missing = False
    for index in range(page_count):
        try:
            text = reader.pages[index].extract_text() or ""
        except Exception:
            text = ""
            warnings.append(f"page_{index + 1}_extract_failed")
        text = clean_text(text)
        if len(text) < MIN_PAGE_CHARS:
            ocr_text = None if ocr_missing else _ocr_page(data, index)
            if ocr_text is None:
                ocr_missing = True
            elif len(clean_text(ocr_text)) >= len(text):
                text = clean_text(ocr_text)
                used_ocr = True
                if len(text) < MIN_PAGE_CHARS:
                    warnings.append("ocr_low_confidence")
        elif text:
            used_text = True
        pages.append(text)

    if ocr_missing:
        warnings.insert(0, "ocr_unavailable")
    if sum(len(page) for page in pages) > max_chars:
        raise ExtractionError("document_too_large", f"The PDF contains more than {max_chars} characters of text")
    method = "mixed" if used_text and used_ocr else "ocr" if used_ocr else "text" if used_text else "none"
    if method == "none":
        warnings.append("no_text_extracted")
    return ExtractionResult(pages=pages, method=method, warnings=sorted(set(warnings), key=warnings.index))
