"""
Docling parsing service.

Exposes a small HTTP API around Docling for use from NestJS / other services.

Endpoints:
  GET  /health              — liveness probe
  POST /parse               — full document parse (markdown + structured JSON)
  POST /parse/tables        — extract tables only (быстрый путь для бланков)
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Any

from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("docling-service")

# Один converter на весь процесс — модели в памяти, не пересоздаём.
# Создаётся в lifespan, чтобы /health отвечал сразу, а тяжёлая инициализация
# ехала в фоне на старте.
_converter: DocumentConverter | None = None


def _build_converter() -> DocumentConverter:
    """
    Собираем converter с настройками под бланки.

    do_ocr=False — у тебя нативные PDF из Word, OCR только замедлит.
    Если когда-нибудь подсунут скан — включишь через env.
    """
    pipeline_options = PdfPipelineOptions(
        do_ocr=False,
        do_table_structure=True,
        generate_page_images=False,
    )
    # TableFormer ACCURATE даёт лучшее качество таблиц.
    # Для FAST — pipeline_options.table_structure_options.mode = "fast"
    pipeline_options.table_structure_options.do_cell_matching = True

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _converter
    log.info("Initializing Docling converter (loading models)…")
    t0 = time.perf_counter()
    _converter = _build_converter()
    log.info("Converter ready in %.2fs", time.perf_counter() - t0)
    yield
    log.info("Shutting down")


app = FastAPI(
    title="Docling Service",
    version="0.1.0",
    description="PDF/DOCX → structured document via IBM Docling",
    lifespan=lifespan,
)


# ────────────────────────── schemas ──────────────────────────


class HealthResponse(BaseModel):
    status: str
    converter_ready: bool


class TableCell(BaseModel):
    row: int
    col: int
    text: str


class TableOut(BaseModel):
    page: int | None = None
    num_rows: int
    num_cols: int
    cells: list[TableCell]
    markdown: str  # для удобства быстрого визуального дебага


class ParseResponse(BaseModel):
    markdown: str
    tables: list[TableOut]
    elapsed_ms: int


class TablesResponse(BaseModel):
    tables: list[TableOut]
    elapsed_ms: int


# ────────────────────────── helpers ──────────────────────────


def _converter_or_503() -> DocumentConverter:
    if _converter is None:
        raise HTTPException(status_code=503, detail="Converter not ready yet")
    return _converter


def _table_to_markdown(rows: int, cols: int, grid: dict[tuple[int, int], str]) -> str:
    """Простой md-rendering таблицы из координатной сетки."""
    if rows == 0 or cols == 0:
        return ""

    lines: list[str] = []
    header = [grid.get((0, c), "").replace("\n", " ").strip() for c in range(cols)]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * cols) + " |")
    for r in range(1, rows):
        row = [grid.get((r, c), "").replace("\n", " ").strip() for c in range(cols)]
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _extract_tables(doc: Any) -> list[TableOut]:
    """
    Достаём все таблицы из DoclingDocument в нормализованный формат.

    Docling API меняется — здесь мы аккуратно ходим по doc.tables,
    но падать на отсутствующих атрибутах не будем.
    """
    out: list[TableOut] = []
    tables = getattr(doc, "tables", None) or []

    for t in tables:
        data = getattr(t, "data", None)
        if data is None:
            continue

        num_rows = getattr(data, "num_rows", 0)
        num_cols = getattr(data, "num_cols", 0)
        table_cells = getattr(data, "table_cells", []) or []

        cells: list[TableCell] = []
        grid: dict[tuple[int, int], str] = {}
        for c in table_cells:
            r_idx = getattr(c, "start_row_offset_idx", None)
            c_idx = getattr(c, "start_col_offset_idx", None)
            text = (getattr(c, "text", "") or "").strip()
            if r_idx is None or c_idx is None:
                continue
            cells.append(TableCell(row=r_idx, col=c_idx, text=text))
            grid[(r_idx, c_idx)] = text

        # Страница, если знаем
        page = None
        prov = getattr(t, "prov", None) or []
        if prov and hasattr(prov[0], "page_no"):
            page = prov[0].page_no

        out.append(
            TableOut(
                page=page,
                num_rows=num_rows,
                num_cols=num_cols,
                cells=cells,
                markdown=_table_to_markdown(num_rows, num_cols, grid),
            )
        )

    return out


def _validate_pdf(file: UploadFile, data: bytes) -> None:
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    # 50 MB hard limit — настраивай под себя
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    ctype = (file.content_type or "").lower()
    name = (file.filename or "").lower()
    if "pdf" not in ctype and not name.endswith(".pdf"):
        # Docling умеет docx/html/pptx — если захочешь, расширь
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content-type: {file.content_type}",
        )


# ────────────────────────── routes ───────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        converter_ready=_converter is not None,
    )


@app.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)) -> ParseResponse:
    """
    Полный парсинг: markdown всего документа + все таблицы.
    Используй, когда нужен и текст шапки, и таблицы параметров.
    """
    converter = _converter_or_503()
    data = await file.read()
    _validate_pdf(file, data)

    t0 = time.perf_counter()
    try:
        stream = DocumentStream(name=file.filename or "input.pdf", stream=BytesIO(data))
        result = converter.convert(stream)
    except Exception as e:
        log.exception("Conversion failed")
        raise HTTPException(status_code=500, detail=f"Conversion failed: {e}") from e

    doc = result.document
    markdown = doc.export_to_markdown()
    tables = _extract_tables(doc)

    elapsed = int((time.perf_counter() - t0) * 1000)
    log.info(
        "parsed file=%s size=%dB tables=%d elapsed_ms=%d",
        file.filename, len(data), len(tables), elapsed,
    )

    return ParseResponse(markdown=markdown, tables=tables, elapsed_ms=elapsed)


@app.post("/parse/tables", response_model=TablesResponse)
async def parse_tables(file: UploadFile = File(...)) -> TablesResponse:
    """
    Быстрый путь: только таблицы, без markdown всего документа.
    Под твой кейс с бланками воды — самое то.
    """
    converter = _converter_or_503()
    data = await file.read()
    _validate_pdf(file, data)

    t0 = time.perf_counter()
    try:
        stream = DocumentStream(name=file.filename or "input.pdf", stream=BytesIO(data))
        result = converter.convert(stream)
    except Exception as e:
        log.exception("Conversion failed")
        raise HTTPException(status_code=500, detail=f"Conversion failed: {e}") from e

    tables = _extract_tables(result.document)
    elapsed = int((time.perf_counter() - t0) * 1000)
    log.info(
        "parsed-tables file=%s tables=%d elapsed_ms=%d",
        file.filename, len(tables), elapsed,
    )

    return TablesResponse(tables=tables, elapsed_ms=elapsed)
