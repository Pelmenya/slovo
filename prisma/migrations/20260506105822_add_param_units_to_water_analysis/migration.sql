-- Этап 1.B follow-up: добавляем param_units JSONB для downstream валидации/UI.
-- Без units невозможно отличить hardness=5.81 в мг-экв/л от 5.81 в ммоль/л.
-- На пустую таблицу безопасно (data wipe идёт через TRUNCATE перед re-normalize).

ALTER TABLE "water_analysis" ADD COLUMN "param_units" JSONB NOT NULL DEFAULT '{}'::jsonb;
