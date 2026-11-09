// Carga datos de demostración: disciplinas, profesores, estudiantes, planes, ~6 meses de clases
// con historial de asistencia, reservas futuras y promociones.
//
//   npm run db:seed            → solo si la base está vacía
//   npm run db:seed -- --force → BORRA todos los datos y vuelve a sembrar
import 'dotenv/config';
import pg from 'pg';
import { hash } from '@node-rs/argon2';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL no está definida');
  process.exit(1);
}
const TZ = process.env.STUDIO_TZ || 'America/Bogota';
const PASSWORD = process.env.SEED_PASSWORD || 'demo1234';
const force = process.argv.includes('--force');

// PRNG determinista para que el seed sea reproducible.
let seed = 20260818;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const DISCIPLINES = [
  ['Pilates', 'teal'], ['Yoga', 'violet'], ['Boxeo', 'pulse'], ['Spinning', 'amber'],
  ['Funcional', 'volt'], ['HIIT', 'red'], ['Stretching', 'blue'], ['Fuerza', 'brown'],
];
const TEACHERS = [
  ['Laura Martínez', ['Pilates', 'Stretching']],
  ['Carlos Restrepo', ['Yoga']],
  ['Andrés Osorio', ['Boxeo', 'Funcional']],
  ['Mariana Zuluaga', ['Spinning', 'HIIT']],
  ['Felipe Cadavid', ['Fuerza', 'Funcional']],
];
// [días ISO (1=lun), hora, disciplina, profesor, duración, nivel, cupos, ubicación]
const SCHEDULE = [
  [[1, 2, 4], '18:00', 'Pilates', 'Laura Martínez', 60, 'Intermedio', 10, 'Studio 1'],
  [[6], '09:00', 'Pilates', 'Laura Martínez', 60, 'Todos', 10, 'Studio 1'],
  [[2, 4], '19:15', 'Yoga', 'Carlos Restrepo', 50, 'Todos', 14, 'Studio 2'],
  [[1, 3], '07:00', 'Yoga', 'Carlos Restrepo', 50, 'Principiante', 14, 'Studio 2'],
  [[6], '08:00', 'Yoga', 'Carlos Restrepo', 60, 'Todos', 14, 'Studio 2'],
  [[1, 3, 5], '07:00', 'Boxeo', 'Andrés Osorio', 45, 'Avanzado', 12, 'Ring Norte'],
  [[1, 3, 5], '18:30', 'Spinning', 'Mariana Zuluaga', 45, 'Intermedio', 16, 'Sala Bici'],
  [[2, 4], '06:30', 'Funcional', 'Andrés Osorio', 50, 'Todos', 14, 'Studio 3'],
  [[6], '10:00', 'Funcional', 'Felipe Cadavid', 50, 'Todos', 14, 'Studio 3'],
  [[2, 4], '12:00', 'HIIT', 'Mariana Zuluaga', 30, 'Avanzado', 12, 'Studio 3'],
  [[3, 5], '17:00', 'Stretching', 'Laura Martínez', 40, 'Todos', 16, 'Studio 1'],
  [[1, 3, 5], '19:00', 'Fuerza', 'Felipe Cadavid', 55, 'Intermedio', 10, 'Sala Pesas'],
  [[7], '09:00', 'Yoga', 'Carlos Restrepo', 60, 'Todos', 14, 'Studio 2'],
  [[7], '10:30', 'Stretching', 'Laura Martínez', 40, 'Todos', 16, 'Studio 1'],
  [[7], '17:00', 'Spinning', 'Mariana Zuluaga', 45, 'Todos', 16, 'Sala Bici'],
];
const PLANS = [
  ['Plan 8 clases', 8, 30, 130000],
  ['Plan 12 clases', 12, 30, 180000],
  ['Plan Unlimited', 30, 30, 320000],
  ['Plan combinado Pilates + Yoga', 40, 30, 390000],
];
// Estudiantes principales del prototipo.
const MAIN_STUDENTS = [
  { email: 'maria.lopez@kimsolutions.com', name: 'María López', disc: ['Pilates', 'Yoga'], plan: 'Plan Unlimited', goal: 'Ganar fuerza', months: 10, rate: 0.75, phone: '+57 300 123 4567', birth: '1997-03-14', weight: 61, height: 1.65, level: 'Intermedio' },
  { email: 'carlos.inactivo@kimsolutions.com', name: 'Carlos Pérez', disc: ['Boxeo', 'Funcional'], plan: 'Plan 12 clases', goal: 'Mejorar flexibilidad', months: 5, rate: 0.45, active: false },
  { email: 'andrea.gomez@kimsolutions.com', name: 'Andrea Gómez', disc: ['Pilates', 'Spinning', 'HIIT'], plan: 'Plan Unlimited', goal: 'Bajar % de grasa', months: 12, rate: 0.8 },
  { email: 'julian.toro@kimsolutions.com', name: 'Julián Toro', disc: ['Fuerza', 'Funcional'], plan: 'Plan 8 clases', goal: 'Resistencia', months: 4, rate: 0.35 },
  { email: 'sara.velez@kimsolutions.com', name: 'Sara Vélez', disc: ['Yoga', 'Stretching', 'Pilates'], plan: 'Plan Unlimited', goal: 'Movilidad', months: 12, rate: 0.9 },
];
const FIRST = ['Valentina', 'Santiago', 'Camila', 'Mateo', 'Isabella', 'Samuel', 'Daniela', 'Sebastián', 'Mariana', 'Tomás', 'Luciana', 'Nicolás', 'Gabriela', 'Alejandro', 'Paula', 'Juan', 'Natalia', 'David', 'Laura', 'Esteban'];
const LAST = ['Restrepo', 'Gaviria', 'Arango', 'Mejía', 'Ochoa', 'Correa', 'Henao', 'Londoño', 'Jaramillo', 'Montoya', 'Ríos', 'Salazar', 'Cardona', 'Botero', 'Uribe', 'Zapata', 'Giraldo', 'Muñoz', 'Quintero', 'Echeverri'];
const GOALS = ['Ganar fuerza', 'Mejorar flexibilidad', 'Bajar % de grasa', 'Resistencia', 'Movilidad', 'Reducir estrés'];

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
const isoDow = (dateStr) => ((new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.');

const client = new pg.Client({ connectionString: url });
await client.connect();

async function insertMany(table, cols, rows, returning = 'id') {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    const res = await client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')} RETURNING ${returning}`,
      params,
    );
    out.push(...res.rows);
  }
  return out;
}

try {
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM users');
  if (n > 0 && !force) {
    console.log('La base ya tiene datos. Usa `npm run db:seed -- --force` para borrar y volver a sembrar.');
    process.exit(0);
  }

  await client.query('BEGIN');
  await client.query(`TRUNCATE users, disciplines, teachers, plans, classes, promotions, implements RESTART IDENTITY CASCADE`);

  const { rows: [{ today, now_local }] } = await client.query(
    `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS today,
            to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS now_local`,
    [TZ],
  );
  const passwordHash = await hash(PASSWORD);

  // --- Catálogos
  const discRows = await insertMany('disciplines', ['name', 'color'], DISCIPLINES, 'id, name');
  const discId = Object.fromEntries(discRows.map((r) => [r.name, r.id]));

  const teacherRows = await insertMany(
    'teachers', ['name', 'email'],
    TEACHERS.map(([name]) => [name, `${slug(name)}@kimsolutions.com`]), 'id, name',
  );
  const teacherId = Object.fromEntries(teacherRows.map((r) => [r.name, r.id]));
  await insertMany('teacher_disciplines', ['teacher_id', 'discipline_id'],
    TEACHERS.flatMap(([name, specs]) => specs.map((d) => [teacherId[name], discId[d]])), 'teacher_id');

  const planRows = await insertMany('plans', ['name', 'total_classes', 'duration_days', 'price'], PLANS, 'id, name, total_classes, price');
  const planByName = Object.fromEntries(planRows.map((r) => [r.name, r]));

  // --- Usuarios
  await insertMany('users', ['email', 'password_hash', 'role'], [['admin@kimsolutions.com', passwordHash, 'admin']]);
  // Cuentas de acceso de los profesores
  const teacherUsers = await insertMany('users', ['email', 'password_hash', 'role'],
    TEACHERS.map(([name]) => [`${slug(name)}@kimsolutions.com`, passwordHash, 'teacher']), 'id, email');
  for (const u of teacherUsers) {
    await client.query('UPDATE teachers SET user_id = $1 WHERE email = $2', [u.id, u.email]);
  }

  const students = [...MAIN_STUDENTS];
  const usedEmails = new Set(students.map((s) => s.email));
  while (students.length < 90) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `${slug(name)}@correo.com`;
    if (usedEmails.has(email)) continue;
    usedEmails.add(email);
    const disc = [...new Set([pick(DISCIPLINES)[0], pick(DISCIPLINES)[0]])].slice(0, 1 + Math.floor(rand() * 2));
    students.push({
      email, name, disc,
      plan: pick(['Plan 8 clases', 'Plan 12 clases', 'Plan 12 clases', 'Plan Unlimited']),
      goal: pick(GOALS), months: 1 + Math.floor(rand() * 11), rate: 0.3 + rand() * 0.5,
      phone: `+57 3${Math.floor(10 + rand() * 89)} ${Math.floor(100 + rand() * 899)} ${Math.floor(1000 + rand() * 8999)}`,
    });
  }

  const userRows = await insertMany('users', ['email', 'password_hash', 'role', 'active'],
    students.map((s) => [s.email, passwordHash, 'student', s.active !== false]), 'id, email');
  const userIdByEmail = Object.fromEntries(userRows.map((r) => [r.email, r.id]));

  const studentRows = await insertMany('students',
    ['user_id', 'name', 'phone', 'birth_date', 'joined_on', 'weight_kg', 'height_m', 'level', 'goal'],
    students.map((s) => [
      userIdByEmail[s.email], s.name, s.phone ?? null, s.birth ?? null,
      addDays(today, -s.months * 30 - 5), s.weight ?? null, s.height ?? null, s.level ?? null, s.goal,
    ]), 'id');
  students.forEach((s, i) => { s.id = studentRows[i].id; s.joined = addDays(today, -s.months * 30 - 5); });

  await insertMany('student_disciplines', ['student_id', 'discipline_id', 'enabled_on'],
    students.flatMap((s) => s.disc.map((d, j) => [s.id, discId[d], addDays(s.joined, j * 25)])), 'student_id');

  // --- Planes: periodos consecutivos de 30 días; el último cubre hoy (excepto el inactivo).
  const studentPlans = []; // {student, id, start, end, total, used}
  const spInsert = [];
  for (const s of students) {
    const plan = planByName[s.plan];
    const periods = Math.max(1, Math.min(s.months, 6));
    for (let p = periods - 1; p >= 0; p--) {
      const start = addDays(today, -p * 30 - 12);
      const end = addDays(start, 29);
      if (s.active === false && p === 0) continue; // cuenta inactiva: sin plan vigente
      const catalog = p === 0 ? plan : planByName[pick(Object.keys(planByName))];
      spInsert.push({ s, catalog, start, end });
    }
  }
  const spRows = await insertMany('student_plans',
    ['student_id', 'plan_id', 'name', 'total_classes', 'price', 'starts_on', 'ends_on', 'created_at'],
    spInsert.map(({ s, catalog, start, end }) => [s.id, catalog.id, catalog.name, catalog.total_classes, catalog.price, start, end, `${start}T10:00:00Z`]),
    'id');
  spInsert.forEach((sp, i) => studentPlans.push({ studentId: sp.s.id, id: spRows[i].id, start: sp.start, end: sp.end, total: sp.catalog.total_classes, used: 0 }));
  const planFor = (studentId, date) => studentPlans.find((p) => p.studentId === studentId && p.start <= date && date <= p.end);

  // --- Clases: 180 días atrás y 21 días adelante.
  const classSpecs = [];
  for (let day = -180; day <= 21; day++) {
    const date = addDays(today, day);
    const dow = isoDow(date);
    for (const [days, time, disc, teacher, dur, level, cap, loc] of SCHEDULE) {
      if (!days.includes(dow)) continue;
      classSpecs.push({ date, time, disc, teacher, dur, level, cap, loc, local: `${date}T${time}` });
    }
  }
  const classRows = [];
  for (let i = 0; i < classSpecs.length; i += 1000) {
    const chunk = classSpecs.slice(i, i + 1000);
    const res = await client.query(
      `INSERT INTO classes (discipline_id, teacher_id, starts_at, duration_min, level, capacity, location, created_at)
       SELECT x.discipline_id, x.teacher_id, (x.local::timestamp AT TIME ZONE $2), x.dur, x.level, x.cap, x.loc,
              (x.local::timestamp AT TIME ZONE $2) - interval '20 days'
       FROM json_to_recordset($1) AS x(discipline_id bigint, teacher_id bigint, local text, dur int, level text, cap int, loc text)
       RETURNING id`,
      [JSON.stringify(chunk.map((c) => ({
        discipline_id: discId[c.disc], teacher_id: teacherId[c.teacher], local: c.local,
        dur: c.dur, level: c.level, cap: c.cap, loc: c.loc,
      }))), TZ],
    );
    classRows.push(...res.rows);
  }
  classSpecs.forEach((c, i) => { c.id = classRows[i].id; });

  // --- Reservas
  const bookings = [];
  const maria = students[0];
  let mariaNextPilates = null;
  for (const c of classSpecs) {
    const isPast = c.local < now_local;
    const candidates = students.filter((s) => s.disc.includes(c.disc) && s.joined <= c.date && (isPast || s.active !== false));
    const target = Math.round(c.cap * (0.45 + rand() * 0.6));
    let booked = 0;
    const order = candidates.map((s) => [s, rand()]).sort((a, b) => a[1] - b[1]).map(([s]) => s);
    for (const s of order) {
      let forceMaria = false;
      if (!isPast && s === maria && c.disc === 'Pilates' && !mariaNextPilates) { forceMaria = true; mariaNextPilates = c; }
      if (!forceMaria && rand() > s.rate) continue;
      if (!isPast && s === maria && !forceMaria) continue; // María: solo una reserva futura (la del prototipo)
      const plan = planFor(s.id, c.date);
      if (!plan || plan.used >= plan.total) continue;
      if (booked >= c.cap || booked >= target) {
        if (!isPast && booked >= c.cap && rand() < 0.3) {
          bookings.push([c.id, s.id, null, 'waitlist', new Date(Date.now() - 30 * 60000).toISOString(), new Date().toISOString()]);
        }
        continue;
      }
      let status = 'booked';
      if (isPast) {
        const r = rand();
        status = r < 0.86 ? 'attended' : r < 0.93 ? 'noshow' : r < 0.97 ? 'cancelled' : 'late_cancel';
      }
      if (status !== 'cancelled') { plan.used++; }
      if (status === 'booked' || status === 'attended' || status === 'noshow') booked++;
      const created = addDays(c.date, -1 - Math.floor(rand() * 5));
      // Las cancelaciones se registran el día anterior a la clase; el resto, al crear la reserva.
      const updated = status === 'cancelled' || status === 'late_cancel' ? `${addDays(c.date, -1)}T20:00:00Z` : `${created}T15:00:00Z`;
      bookings.push([c.id, s.id, plan.id, status, `${created}T15:00:00Z`, updated]);
    }
  }
  await insertMany('bookings', ['class_id', 'student_id', 'student_plan_id', 'status', 'created_at', 'updated_at'], bookings);

  // --- Promociones
  const promoRows = await insertMany('promotions', ['badge', 'title', 'description', 'style', 'expires_on'], [
    ['20% OFF', 'Plan mensual de Pilates', 'Válido para nuevas inscripciones y renovaciones.', 'promo-1', addDays(today, 20)],
    ['2x1', 'Primera clase de Yoga', 'Trae a un acompañante a tu primera sesión.', 'promo-2', addDays(today, 12)],
    ['NUEVO', 'Plan combinado Pilates + Yoga', '40 clases mensuales entre ambas disciplinas.', 'promo-3', null],
    ['15% OFF', 'Plan mensual de Boxeo', 'Aplica para renovación de plan.', 'promo-1', addDays(today, 25)],
    ['NUEVO', 'Plan Spinning + HIIT', 'Combo de alta intensidad, 24 clases mensuales.', 'promo-2', null],
  ], 'id');
  const promoDisc = [['Pilates'], ['Yoga'], ['Pilates', 'Yoga'], ['Boxeo'], ['Spinning', 'HIIT']];
  await insertMany('promotion_disciplines', ['promotion_id', 'discipline_id'],
    promoDisc.flatMap((ds, i) => ds.map((d) => [promoRows[i].id, discId[d]])), 'promotion_id');

  await client.query('COMMIT');
  console.log(`Seed listo: ${students.length} estudiantes, ${classSpecs.length} clases, ${bookings.length} reservas.`);
  console.log(`Cuentas: admin@kimsolutions.com · maria.lopez@kimsolutions.com · carlos.inactivo@kimsolutions.com (inactiva) — contraseña: ${PASSWORD}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
