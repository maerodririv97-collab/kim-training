-- Rol profesor con cuenta de acceso propia.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'student', 'teacher'));

-- Cuenta de acceso del profesor (nullable para profesores creados antes de este cambio).
ALTER TABLE teachers ADD COLUMN user_id BIGINT UNIQUE REFERENCES users (id) ON DELETE SET NULL;
