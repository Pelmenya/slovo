# slovo-postgres — pgvector base + PostGIS + extra Postgres extensions для water-analysis
#
# Источник базы: pgvector/pgvector:0.8.2-pg18-trixie (Debian Trixie + Postgres 18 + pgvector 0.8.2).
# Доустанавливаем PostGIS 3.x и activate cube/earthdistance (доступны в pg-contrib).
#
# Решения:
# - PostGIS установлен на инфра-уровне для Этапа 3 water-analysis (UX «найди в радиусе»),
#   и для будущих spatial-фич (полигоны районов МО, тепловая карта).
# - cube + earthdistance — отдельный путь радиального поиска без PostGIS overhead,
#   доступны через `CREATE EXTENSION` (уже в pg-contrib базового образа).
# - pgvector 0.8.2 сохранён (используется в catalog/knowledge embeddings, ADR-002).
#
# Образ растёт с ~80 MB → ~250 MB (PostGIS + GEOS + GDAL + PROJ).

FROM pgvector/pgvector:0.8.2-pg18-trixie

# Установка PostGIS 3.x для Postgres 18.
# В Debian Trixie postgresql-18-postgis-3 пакет тащит за собой:
#   - libgeos-c1t64 (геометрия)
#   - libproj25 (projections)
#   - libgdal35 (raster) — opt
ARG POSTGIS_VERSION=3
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        "postgresql-18-postgis-${POSTGIS_VERSION}" \
        "postgresql-18-postgis-${POSTGIS_VERSION}-scripts" \
    && rm -rf /var/lib/apt/lists/*

# Smoke check: проверяем что PostGIS присутствует на этапе build (не runtime).
# Будет видно в build log если что-то пошло не так.
RUN ls -la /usr/share/postgresql/18/extension/postgis*.control || \
    (echo "FATAL: PostGIS not found after install" && exit 1)
