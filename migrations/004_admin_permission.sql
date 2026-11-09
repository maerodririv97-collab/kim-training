-- Permiso de administrador independiente del rol: un profesor puede tener también acceso al panel admin.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE role = 'admin';
