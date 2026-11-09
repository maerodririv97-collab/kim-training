-- Esquema base de KIM Solutions - Training (control de clases, profesores, estudiantes y planes)

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'student')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE disciplines (
  id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  -- clave de color de la paleta del diseño: teal, violet, pulse, amber, volt, red, blue, brown
  color  TEXT NOT NULL DEFAULT 'teal',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE teachers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teacher_disciplines (
  teacher_id    BIGINT NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, discipline_id)
);

CREATE TABLE students (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT,
  birth_date   DATE,
  joined_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg    NUMERIC(5, 1),
  height_m     NUMERIC(3, 2),
  level        TEXT,
  restrictions TEXT,
  goal         TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Disciplinas que el administrador habilita a cada estudiante.
CREATE TABLE student_disciplines (
  student_id    BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id) ON DELETE CASCADE,
  enabled_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (student_id, discipline_id)
);

-- Catálogo de planes que ofrece el estudio.
CREATE TABLE plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  total_classes INT NOT NULL CHECK (total_classes > 0),
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price         BIGINT NOT NULL CHECK (price >= 0), -- COP, sin decimales
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Planes asignados a estudiantes (registro manual por el administrador, sin pasarela de pagos).
-- Se guarda una copia de nombre/clases/precio para que el historial no cambie si se edita el catálogo.
CREATE TABLE student_plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  plan_id       BIGINT REFERENCES plans (id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  total_classes INT NOT NULL CHECK (total_classes > 0),
  price         BIGINT NOT NULL CHECK (price >= 0),
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX student_plans_student_idx ON student_plans (student_id, ends_on DESC);

CREATE TABLE classes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id),
  teacher_id    BIGINT NOT NULL REFERENCES teachers (id),
  starts_at     TIMESTAMPTZ NOT NULL,
  duration_min  INT NOT NULL CHECK (duration_min BETWEEN 10 AND 300),
  level         TEXT NOT NULL DEFAULT 'Todos',
  capacity      INT NOT NULL CHECK (capacity > 0),
  location      TEXT NOT NULL,
  cancelled     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX classes_starts_at_idx ON classes (starts_at);

-- Estados de una reserva:
--   booked      reservada (consume 1 clase del plan)
--   attended    asistió (consume)
--   noshow      no asistió (consume)
--   late_cancel cancelada fuera de tiempo (consume, libera el cupo)
--   cancelled   cancelada a tiempo (no consume)
--   waitlist    en lista de espera (no consume hasta que se libere un cupo)
--   expired     lista de espera vencida (no consume)
CREATE TABLE bookings (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id         BIGINT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  student_plan_id  BIGINT REFERENCES student_plans (id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN ('booked','attended','noshow','late_cancel','cancelled','waitlist','expired')),
  rescheduled_from BIGINT REFERENCES bookings (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un estudiante solo puede tener una reserva/lista de espera vigente por clase.
CREATE UNIQUE INDEX bookings_one_active_per_class
  ON bookings (class_id, student_id)
  WHERE status IN ('booked', 'attended', 'noshow', 'waitlist');
CREATE INDEX bookings_student_idx ON bookings (student_id, status);
CREATE INDEX bookings_class_idx ON bookings (class_id, status);

CREATE TABLE promotions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  badge       TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT 'promo-1' CHECK (style IN ('promo-1', 'promo-2', 'promo-3')),
  expires_on  DATE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si una promoción no tiene disciplinas asociadas, aplica a todos los estudiantes.
CREATE TABLE promotion_disciplines (
  promotion_id  BIGINT NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, discipline_id)
);

-- Solicitudes de "olvidé mi contraseña". No hay servicio de correo: el administrador
-- las ve en el panel y restablece la contraseña manualmente.
CREATE TABLE password_reset_requests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
