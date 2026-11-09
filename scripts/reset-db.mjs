// BORRA todos los datos (usuarios, disciplinas, profesores, estudiantes, planes, clases, reservas,
// promociones, implementos). Conserva la estructura de tablas y el registro de migraciones.
//
//   npm run db:reset -- --yes
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL no está definida');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error('Esto borra TODOS los datos. Confirma con: npm run db:reset -- --yes');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const host = new URL(url).host;
  await client.query(
    `TRUNCATE users, disciplines, teachers, plans, classes, promotions, password_reset_requests, implements
     RESTART IDENTITY CASCADE`,
  );
  console.log(`Datos borrados en ${host}. Crea el administrador con: npm run db:create-admin`);
} finally {
  await client.end();
}
