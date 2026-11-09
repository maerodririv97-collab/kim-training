# KIM Solutions - Training — control de clases y entrenamientos

Web app para gestionar clases deportivas, profesores, estudiantes, planes y reservas.
Diseño basado en `fitclass-prototype.html`.

- **Frontend:** React 19 + Vite + TypeScript (`src/`)
- **Backend:** Rust (Axum) como función serverless de Vercel (`api/main.rs` + `server/`)
- **Base de datos:** PostgreSQL (Neon en producción, Docker en local). Migraciones SQL en `migrations/`
- **Auth:** JWT en cookie httpOnly y contraseñas con Argon2. Roles `admin` y `student`

## Desarrollo local

Requisitos: Node 20+, Rust 1.85+ y Docker.

```bash
cp .env.example .env        # ajusta JWT_SECRET
npm install
npm run db:up               # Postgres en Docker (puerto 5432)
npm run db:migrate
ADMIN_EMAIL="tu@correo.com" ADMIN_PASSWORD="..." npm run db:create-admin

# Opcionales
npm run db:seed             # datos de demostración (usa -- --force para reiniciar)
npm run db:reset -- --yes   # BORRA todos los datos (deja las tablas)

npm run dev:api             # API Rust en http://127.0.0.1:3000
npm run dev                 # Front en http://localhost:5173 (proxy /api → 3000)
```

Si cargas el seed de demostración, sus cuentas usan la contraseña `demo1234` (`admin@kimsolutions.com`, `maria.lopez@kimsolutions.com`).

## Despliegue en Vercel (desde Git)

1. Importa el repositorio en Vercel. El framework se detecta como Vite y `vercel.json` ya define el build y las rutas.
2. En **Storage → Neon**, crea o conecta una base. La integración agrega `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
3. En **Settings → Environment Variables** agrega:
   - `JWT_SECRET`: mínimo 32 caracteres (`openssl rand -hex 32`)
   - `STUDIO_TZ`: opcional, por defecto `America/Bogota`
4. Haz push. Cada deploy ejecuta `npm run vercel-build`, que **aplica las migraciones pendientes** y compila el front. La función Rust `api/main.rs` atiende todo `/api/*`.
5. Crea el administrador una sola vez apuntando a Neon (la contraseña no se guarda en el repo):
   `DATABASE_URL="<url de neon>" ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run db:create-admin`
   Desde el panel se configura todo lo demás: disciplinas, profesores, planes, clases y estudiantes.

> El runtime de Rust de Vercel está en beta. Tras el primer deploy, verifica `https://<tu-app>/api/health` → `{"ok":true,"db":true}`.

## Reglas de negocio

| Regla | Valor |
|---|---|
| Reservar | Requiere tener la disciplina habilitada, un plan vigente con clases disponibles y cupo. Descuenta 1 clase |
| Cancelar | Con ≥ 4 h de anticipación la clase se devuelve al plan. Si se cancela más tarde no se devuelve, pero el cupo se libera |
| Reprogramar | Solo con ≥ 4 h de anticipación y a una clase de la misma disciplina |
| Lista de espera | Si se libera un cupo se reserva automáticamente al primero de la lista. La solicitud vence a las 3 h |
| Asistencia | El admin marca "Asistió" o "No asistió". Una reserva pasada sin marcar cuenta como realizada |
| Pagos | No hay pasarela: el admin registra el plan comprado en el perfil del estudiante |
| Olvidé mi contraseña | Queda como alerta en el dashboard y el admin asigna una contraseña temporal |

## Estructura

```
api/main.rs            entrada de la función Vercel / servidor local
server/                lógica del API (auth, booking, rutas)
migrations/            SQL versionado (se aplica con scripts/migrate.mjs)
scripts/seed.mjs       datos de demostración
src/                   app React (pages/student, pages/admin)
```
