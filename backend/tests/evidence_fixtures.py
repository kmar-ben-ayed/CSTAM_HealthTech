"""Tiny dependency-free PDF builder for the evidence tests (reportlab is dev-only)."""
import base64
import io


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[str]) -> bytes:
    """One text page per string; each line of a string becomes a line on the page.
    An empty string makes a page with no text layer (like a scanned image)."""
    objects: list[bytes] = []
    page_ids = []
    font_id = 3
    next_id = 4
    contents = []
    for text in pages:
        lines = text.split("\n") if text else []
        ops = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td"]
        for line in lines:
            ops.append(f"({_escape(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        contents.append((next_id, next_id + 1, stream))
        page_ids.append(next_id)
        next_id += 2

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    numbered: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode(),
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for page_id, content_id, stream in contents:
        numbered[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode()
        numbered[content_id] = f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(numbered):
        offsets[number] = out.tell()
        out.write(f"{number} 0 obj\n".encode() + numbered[number] + b"\nendobj\n")
    xref = out.tell()
    count = max(numbered) + 1
    out.write(f"xref\n0 {count}\n0000000000 65535 f \n".encode())
    for number in range(1, count):
        out.write(f"{offsets[number]:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def encrypted_pdf(text: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(make_pdf([text]))))
    writer.encrypt("secret")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
