# Docling Service

Тонкая FastAPI-обёртка вокруг IBM Docling для парсинга PDF (и не только) в структурированный JSON. Делалось под кейс с бланками анализа воды, но универсально для нативных PDF/DOCX с таблицами.

## Что внутри

- **Python 3.12** + Docling 2.74
- **FastAPI** + **uvicorn**
- **TableFormer** (Docling ML-модель для распознавания таблиц)
- Два варианта сборки:
  - **CPU** (`Dockerfile`, image `slovo/docling-service:0.1.0`, ~2GB) — dev / fallback
  - **GPU** (`Dockerfile.gpu`, image `slovo/docling-service:0.1.0-gpu`, ~6.4GB, torch cu121) — prod-bench / batch ETL. На full 15504 PDF: 93 мин на RTX 4070 Ti Super (6c × OMP=2).
- Модели предзагружены на этапе билда → первый запрос не тормозит

## Эндпоинты

| Метод | Путь            | Что делает                                           |
| ----- | --------------- | ---------------------------------------------------- |
| GET   | `/health`       | Liveness probe                                       |
| POST  | `/parse`        | Полный парс: markdown + все таблицы                  |
| POST  | `/parse/tables` | Только таблицы (быстрее, под бланки воды самое то)   |
| GET   | `/docs`         | Swagger UI (FastAPI auto-generated)                  |

## Быстрый старт

```bash
# Билд (первый раз ~10 минут, качаются torch + ML-модели)
docker compose build

# Запуск
docker compose up -d

# Проверка
curl http://localhost:8000/health
```

## Использование

```bash
# Полный парс
curl -X POST http://localhost:8000/parse \
  -F "file=@blank_voda.pdf" | jq

# Только таблицы
curl -X POST http://localhost:8000/parse/tables \
  -F "file=@blank_voda.pdf" | jq
```

Ответ `/parse/tables`:

```json
{
  "tables": [
    {
      "page": 1,
      "num_rows": 12,
      "num_cols": 5,
      "cells": [
        {"row": 0, "col": 0, "text": "Параметр"},
        {"row": 0, "col": 1, "text": "Метод"},
        {"row": 1, "col": 0, "text": "pH"},
        {"row": 1, "col": 1, "text": "ГОСТ 26449.1-85"}
      ],
      "markdown": "| Параметр | Метод | ... |\n| --- | --- | ... |\n| pH | ГОСТ 26449.1-85 | ... |"
    }
  ],
  "elapsed_ms": 850
}
```

## Использование из NestJS

```typescript
import FormData from 'form-data';
import axios from 'axios';
import { readFileSync } from 'fs';

const form = new FormData();
form.append('file', readFileSync('blank.pdf'), 'blank.pdf');

const { data } = await axios.post(
  'http://docling:8000/parse/tables',
  form,
  { headers: form.getHeaders(), timeout: 30_000 },
);

// data.tables — массив таблиц с ячейками
```

## Размер образа и ресурсы

- Размер образа: ~2.5–3 GB (большая часть — torch CPU + ML-модели Docling)
- RAM на runtime: 1–2 GB на типичный бланк, до 4 GB на сложные PDF
- CPU: каждое преобразование однопоточное-плюс, но эффективно использует 4–8 ядер на TableFormer

## Настройки

| ENV               | Default | Описание                            |
| ----------------- | ------- | ----------------------------------- |
| `OMP_NUM_THREADS` | 4 (single-container) / 2 (multi-container bench) | Кол-во потоков для torch/numpy. Sweet spot для bench-парка из 4-6 контейнеров — `OMP=2` (см. bench-compose файлы). |
| `HF_HOME`         | `/opt/models` | Кеш HuggingFace моделей       |
| `DOCLING_ARTIFACTS_PATH` | `/opt/models/docling` | Кеш Docling   |

## Известные ограничения

- OCR выключен по умолчанию (`do_ocr=False`). Для сканов включи в `main.py` →
  `PdfPipelineOptions(do_ocr=True)` и добавь в requirements `easyocr` или
  `rapidocr-onnxruntime`. Размер образа вырастет на ~500 MB.
- Лимит файла: 50 MB. Меняется в `_validate_pdf` в `main.py`.
- Один воркер uvicorn — Docling и так нагружает CPU. Для масштабирования
  поднимай N контейнеров за nginx/traefik, а не worker'ов в одном процессе.

## Что дальше

- Добавить `/parse/native-or-fallback` — детектор: если PDF без текстового
  слоя, возвращать 422 → NestJS уходит на Haiku vision pipeline.
- Подключить Redis для кеширования по SHA256 файла (одинаковые бланки
  парсятся повторно бесплатно).
- Метрики через `prometheus-fastapi-instrumentator`.
