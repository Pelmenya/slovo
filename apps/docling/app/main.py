"""
Docling parsing service.

Exposes a small HTTP API around Docling for use from NestJS / other services.

Endpoints:
  GET  /health              — liveness probe
  POST /parse               — full document parse (markdown + structured JSON)
  POST /parse/tables        — extract tables only (быстрый путь для бланков)
  POST /parse-rich          — экспериментальный rich parse: OCR fallback +
                              picture classification (диаграмма / фото / схема),
                              extra picture metadata в response.
  POST /render-pages        — PDF → array of page images (PNG/JPEG base64)
                              для Vision-fallback и cross-check над docling-text
"""

from __future__ import annotations

import base64
import logging
import time
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Any, Literal

import fitz  # PyMuPDF — fast native PDF rendering (без поппет/imagemagick)
from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("docling-service")

# Два converter'а на весь процесс — обычный (под water-blank, fast) и rich
# (с OCR + picture_classification для catalog enrichment). Загружаются lazy
# при первом запросе, чтобы /health отвечал сразу.
_converter: DocumentConverter | None = None
_converter_rich: DocumentConverter | None = None
_converter_rich_ocr: DocumentConverter | None = None


def _build_converter() -> DocumentConverter:
    """
    Fast converter — text-based PDF без OCR. Используется в /parse и /parse/tables.

    do_ocr=False — у тебя нативные PDF из Word, OCR только замедлит.
    """
    pipeline_options = PdfPipelineOptions(
        do_ocr=False,
        do_table_structure=True,
        generate_page_images=False,
    )
    pipeline_options.table_structure_options.do_cell_matching = True

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


def _build_converter_rich(with_ocr: bool = False) -> DocumentConverter:
    """
    Rich converter — для catalog enrichment экспериментов.

    do_ocr=with_ocr          — False по умолчанию (rapidocr модели требуют
                               предварительной загрузки с правильными правами).
                               Включай только если PDF действительно scan-only
                               (markdown < 500 chars от обычного /parse).
    do_picture_classification=True — auto-tag (chart / diagram / photo / icon).
    generate_picture_images=True   — embedded picture data, чтобы пробросить в
                                     response для Vision-cross-check.
    """
    pipeline_options = PdfPipelineOptions(
        do_ocr=with_ocr,
        do_table_structure=True,
        do_picture_classification=True,
        generate_picture_images=True,
        images_scale=2.0,
    )
    pipeline_options.table_structure_options.do_cell_matching = True

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _converter
    log.info("Initializing Docling fast converter (loading models)…")
    t0 = time.perf_counter()
    _converter = _build_converter()
    log.info("Fast converter ready in %.2fs", time.perf_counter() - t0)
    log.info("Rich converter — lazy load on first /parse-rich request")
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


class PageImageOut(BaseModel):
    page: int  # 1-based
    width: int
    height: int
    mime: str  # "image/jpeg" | "image/png"
    image_base64: str


class RenderPagesResponse(BaseModel):
    page_count: int
    pages: list[PageImageOut]
    elapsed_ms: int


class PictureOut(BaseModel):
    page: int | None
    classification: str | None  # "chart" / "diagram" / "photo" / "icon" / etc
    confidence: float | None
    bbox: list[float] | None  # [x0, y0, x1, y1] на странице
    caption: str | None
    image_base64: str | None  # PNG, embedded в response (если generate_picture_images=True)
    mime: str = "image/png"


class ParseRichResponse(BaseModel):
    markdown: str
    tables: list[TableOut]
    pictures: list[PictureOut]
    page_count: int
    used_ocr: bool
    elapsed_ms: int


# ────────────────────────── helpers ──────────────────────────


def _converter_or_503() -> DocumentConverter:
    if _converter is None:
        raise HTTPException(status_code=503, detail="Converter not ready yet")
    return _converter


def _converter_rich_or_init(with_ocr: bool = False) -> DocumentConverter:
    """Lazy init для rich converter — модели грузятся только когда нужны."""
    global _converter_rich, _converter_rich_ocr
    if with_ocr:
        if _converter_rich_ocr is None:
            log.info("Lazy-init rich+OCR converter…")
            t0 = time.perf_counter()
            _converter_rich_ocr = _build_converter_rich(with_ocr=True)
            log.info("Rich+OCR converter ready in %.2fs", time.perf_counter() - t0)
        return _converter_rich_ocr
    if _converter_rich is None:
        log.info("Lazy-init rich converter (picture classification, no OCR)…")
        t0 = time.perf_counter()
        _converter_rich = _build_converter_rich(with_ocr=False)
        log.info("Rich converter ready in %.2fs", time.perf_counter() - t0)
    return _converter_rich


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


def _extract_pictures(doc: Any, include_images: bool = True) -> list[PictureOut]:
    """
    Достаёт pictures из DoclingDocument с их classification + embedded image data.

    В Docling 2.74+ pictures лежат в doc.pictures. У каждой может быть:
      - prov (page_no, bbox)
      - annotations (массив, включая PictureClassificationData с predicted_classes)
      - caption_text / captions
      - image (PIL.Image если generate_picture_images=True)
    """
    out: list[PictureOut] = []
    pictures = getattr(doc, "pictures", None) or []

    for pic in pictures:
        # Page + bbox
        page = None
        bbox = None
        prov = getattr(pic, "prov", None) or []
        if prov:
            page = getattr(prov[0], "page_no", None)
            b = getattr(prov[0], "bbox", None)
            if b is not None:
                bbox = [
                    getattr(b, "l", 0),
                    getattr(b, "t", 0),
                    getattr(b, "r", 0),
                    getattr(b, "b", 0),
                ]

        # Classification из annotations
        classification = None
        confidence = None
        annotations = getattr(pic, "annotations", None) or []
        for ann in annotations:
            classes = getattr(ann, "predicted_classes", None)
            if classes and len(classes) > 0:
                top = classes[0]
                classification = getattr(top, "class_name", None) or getattr(top, "label", None)
                confidence = float(getattr(top, "confidence", 0) or 0)
                break

        # Caption (если есть)
        caption = None
        caption_text = getattr(pic, "caption_text", None)
        if callable(caption_text):
            try:
                caption = caption_text(doc)
            except Exception:
                caption = None
        elif caption_text:
            caption = str(caption_text)

        # Embedded image — PIL.Image → base64 PNG
        image_b64 = None
        if include_images:
            try:
                img_ref = getattr(pic, "image", None)
                pil_img = getattr(img_ref, "pil_image", None) if img_ref else None
                if pil_img is not None:
                    buf = BytesIO()
                    pil_img.save(buf, format="PNG", optimize=True)
                    image_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            except Exception as e:
                log.debug("picture image extraction failed: %s", e)

        out.append(
            PictureOut(
                page=page,
                classification=classification,
                confidence=confidence,
                bbox=bbox,
                caption=caption,
                image_base64=image_b64,
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


@app.post("/parse-rich", response_model=ParseRichResponse)
async def parse_rich(
    file: UploadFile = File(...),
    include_picture_images: bool = Form(True),
    with_ocr: bool = Form(False),
) -> ParseRichResponse:
    """
    Эксперимент: rich parse с OCR fallback + picture classification.

    Использует separate converter (_converter_rich) с:
      - do_ocr=True              — справляется со scan-only PDFs
      - do_picture_classification=True — chart / diagram / photo / icon
      - generate_picture_images=True   — embedded image data для Vision

    Trade-off: 3-5× медленнее чем /parse (модели picture classifier + OCR
    добавляют ~10-20 сек на rich PDF), но extra structure для каталога.

    Используй для каталога enrichment, не для bulk water-blank pipeline.
    """
    converter = _converter_rich_or_init(with_ocr=with_ocr)
    data = await file.read()
    _validate_pdf(file, data)

    t0 = time.perf_counter()
    try:
        stream = DocumentStream(name=file.filename or "input.pdf", stream=BytesIO(data))
        result = converter.convert(stream)
    except Exception as e:
        log.exception("Rich conversion failed")
        raise HTTPException(status_code=500, detail=f"Conversion failed: {e}") from e

    doc = result.document
    markdown = doc.export_to_markdown()
    tables = _extract_tables(doc)
    pictures = _extract_pictures(doc, include_images=include_picture_images)
    page_count = len(getattr(doc, "pages", None) or [])

    elapsed = int((time.perf_counter() - t0) * 1000)
    log.info(
        "parse-rich file=%s size=%dB pages=%d tables=%d pictures=%d ocr=%s elapsed_ms=%d",
        file.filename, len(data), page_count, len(tables), len(pictures), with_ocr, elapsed,
    )

    return ParseRichResponse(
        markdown=markdown,
        tables=tables,
        pictures=pictures,
        page_count=page_count,
        used_ocr=with_ocr,
        elapsed_ms=elapsed,
    )


@app.post("/render-pages", response_model=RenderPagesResponse)
async def render_pages(
    file: UploadFile = File(...),
    dpi: int = Form(150),
    fmt: Literal["jpeg", "png"] = Form("jpeg"),
    jpeg_quality: int = Form(85),
    max_pages: int = Form(0),
) -> RenderPagesResponse:
    """
    PDF → массив страниц-картинок (base64). Используется для:
      - Vision-pass над scan-only PDF где docling не извлёк текст.
      - Cross-check диаграмм / схем / цветовых кодировок (docling text-only слепой).
      - Параллельный canonical merge для AI-консультанта по каталогу.

    Параметры:
      dpi          — разрешение рендеринга (150 DPI ≈ 1240×1750 для A4, оптимально
                     для Claude Vision: ≤ 1568px по длинной стороне). 200 для
                     diagrams, 100 для bulk и экономии токенов.
      fmt          — "jpeg" (compactness, ~50KB/стр) или "png" (lossless, ~200KB/стр).
                     Для Vision хватает JPEG q=85.
      jpeg_quality — 1-100, по умолчанию 85. Игнорируется для PNG.
      max_pages    — 0 = все страницы. Лимит для безопасности на гигантских PDF.
    """
    data = await file.read()
    _validate_pdf(file, data)

    if not 50 <= dpi <= 400:
        raise HTTPException(status_code=400, detail="dpi must be 50..400")
    if not 1 <= jpeg_quality <= 100:
        raise HTTPException(status_code=400, detail="jpeg_quality must be 1..100")
    if max_pages < 0:
        raise HTTPException(status_code=400, detail="max_pages must be >= 0")

    t0 = time.perf_counter()
    pages_out: list[PageImageOut] = []

    try:
        with fitz.open(stream=data, filetype="pdf") as pdf:
            page_count = pdf.page_count
            limit = page_count if max_pages == 0 else min(max_pages, page_count)
            # DPI → scale matrix (72 DPI = native). 150 DPI → scale 2.083.
            scale = dpi / 72.0
            matrix = fitz.Matrix(scale, scale)

            for idx in range(limit):
                pix = pdf[idx].get_pixmap(matrix=matrix, alpha=False)
                # PyMuPDF native PNG/JPEG (без PIL middleman — быстрее на larger PDF).
                if fmt == "png":
                    img_bytes = pix.tobytes("png")
                    mime = "image/png"
                else:
                    # PyMuPDF tobytes("jpg") не поддерживает quality control →
                    # идём через PIL для control над качеством сжатия.
                    pil_img = Image.frombytes(
                        "RGB", (pix.width, pix.height), pix.samples
                    )
                    buf = BytesIO()
                    pil_img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
                    img_bytes = buf.getvalue()
                    mime = "image/jpeg"

                pages_out.append(
                    PageImageOut(
                        page=idx + 1,
                        width=pix.width,
                        height=pix.height,
                        mime=mime,
                        image_base64=base64.b64encode(img_bytes).decode("ascii"),
                    )
                )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Render failed")
        raise HTTPException(status_code=500, detail=f"Render failed: {e}") from e

    elapsed = int((time.perf_counter() - t0) * 1000)
    log.info(
        "rendered file=%s pages=%d/%d dpi=%d fmt=%s elapsed_ms=%d",
        file.filename, len(pages_out), page_count, dpi, fmt, elapsed,
    )

    return RenderPagesResponse(
        page_count=page_count,
        pages=pages_out,
        elapsed_ms=elapsed,
    )


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
