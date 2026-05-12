# syntax=docker/dockerfile:1.7

# ============================================================
# Stage 1: builder — ставим зависимости и предзагружаем модели
# ============================================================
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/models

# Минимальные системные зависимости.
# libgl1 нужен для opencv, остальное — компиляция нативных колёс.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .

# Ставим CPU-версию torch отдельным шагом — она огромная,
# индексу нужен особый source. Если будешь использовать GPU,
# убери --index-url у torch и собирай на nvidia-base.
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.5.1 torchvision==0.20.1

RUN pip install --no-cache-dir -r requirements.txt

# Предзагрузка моделей Docling — критично!
# Без этого первый запрос будет качать ~500MB с HuggingFace.
RUN python -c "from docling.utils.model_downloader import download_models; download_models()"

# ============================================================
# Stage 2: runtime — финальный тонкий имадж
# ============================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/models \
    OMP_NUM_THREADS=4

# Только runtime-зависимости, без build-essential
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -d /home/app -m app

# Копируем установленные пакеты и модели из builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /opt/models /opt/models

WORKDIR /app
COPY app/ /app/

RUN chown -R app:app /app /opt/models
USER app

EXPOSE 8000

# Health-check для оркестратора (k8s / docker swarm / compose)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
