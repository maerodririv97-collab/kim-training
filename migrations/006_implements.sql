-- Módulo de implementos: equipos que el estudio presta o alquila dentro de las clases (ej. motos de spinning).
-- El cobro va en el precio del plan; `kind` es solo informativo.
CREATE TABLE implements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'loan' CHECK (kind IN ('loan', 'rent')), -- préstamo / alquiler
  quantity    INT NOT NULL CHECK (quantity >= 0),                          -- unidades que tiene el estudio
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX implements_name_lower_key ON implements (lower(name));

-- Disciplinas en cuyas clases se usa el implemento. Sin filas = aplica a todas las disciplinas.
CREATE TABLE implement_disciplines (
  implement_id  BIGINT NOT NULL REFERENCES implements (id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id) ON DELETE CASCADE,
  PRIMARY KEY (implement_id, discipline_id)
);

-- Implementos que incluye cada plan del catálogo.
CREATE TABLE plan_implements (
  plan_id      BIGINT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  implement_id BIGINT NOT NULL REFERENCES implements (id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, implement_id)
);

-- Copia de los implementos del plan al momento de asignarlo (el historial no cambia si se edita el catálogo).
CREATE TABLE student_plan_implements (
  student_plan_id BIGINT NOT NULL REFERENCES student_plans (id) ON DELETE CASCADE,
  implement_id    BIGINT NOT NULL REFERENCES implements (id) ON DELETE CASCADE,
  PRIMARY KEY (student_plan_id, implement_id)
);

-- Unidad apartada por una reserva. Ocupa inventario mientras la reserva esté en un estado que
-- ocupa cupo (booked, attended, noshow); al cancelar se libera sola.
CREATE TABLE booking_implements (
  booking_id   BIGINT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  implement_id BIGINT NOT NULL REFERENCES implements (id) ON DELETE CASCADE,
  PRIMARY KEY (booking_id, implement_id)
);
CREATE INDEX booking_implements_implement_idx ON booking_implements (implement_id);
