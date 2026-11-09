// Crea (o actualiza la contraseña de) un usuario administrador.
// Las credenciales se pasan por variables de entorno para que nunca queden en el repositorio:
//
//   ADMIN_EMAIL="correo@dominio.com" ADMIN_PASSWORD="..." npm run db:create-admin
//
// Para producción, antepone DATABASE_URL="<url de Neon>".
import 'dotenv/config';
import pg from 'pg';
import { hash } from '@node-rs/argon2';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

if (!url) {
  console.error('DATABASE_URL no está definida');
  process.exit(1);
}
if (!email.includes('@') || password.length < 8) {
  console.error('Define ADMIN_EMAIL (correo válido) y ADMIN_PASSWORD (mínimo 8 caracteres).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const passwordHash = await hash(password);
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, role, active) VALUES ($1, $2, 'admin', TRUE)
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = TRUE
     RETURNING id, (xmax = 0) AS created`,
    [email, passwordHash],
  );
  console.log(`${rows[0].created ? 'Administrador creado' : 'Administrador actualizado'}: ${email}`);
} finally {
  await client.end();
}
