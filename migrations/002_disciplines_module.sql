-- Módulo de disciplinas / modalidades: descripción y fecha de creación.
ALTER TABLE disciplines ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE disciplines ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX disciplines_name_lower_key ON disciplines (lower(name));
