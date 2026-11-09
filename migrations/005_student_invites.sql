-- Enlaces de invitación para que los estudiantes se registren solos (sin plan: lo asigna el admin).
CREATE TABLE student_invites (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses   INT CHECK (max_uses IS NULL OR max_uses > 0),
  uses       INT NOT NULL DEFAULT 0,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE
);

-- Disciplinas que quedan habilitadas automáticamente a quien se registre con el enlace.
CREATE TABLE student_invite_disciplines (
  invite_id     BIGINT NOT NULL REFERENCES student_invites (id) ON DELETE CASCADE,
  discipline_id BIGINT NOT NULL REFERENCES disciplines (id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, discipline_id)
);

-- Qué enlace usó cada estudiante (para el seguimiento del admin).
ALTER TABLE students ADD COLUMN invite_id BIGINT REFERENCES student_invites (id) ON DELETE SET NULL;
