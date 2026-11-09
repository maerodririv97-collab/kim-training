// Todas las fechas se muestran en la zona horaria del estudio, sin importar dónde esté el navegador.
export const TZ: string = import.meta.env.VITE_STUDIO_TZ || 'America/Bogota';
const LOCALE = 'es-CO';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(/\./g, '').replace(/,/g, '');

const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const wdShort = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'short' });
const wdLong = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'long' });
const monShort = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'short' });
const monLong = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'long' });

/** "18:00" */
export function fmtTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** Fecha local del estudio "YYYY-MM-DD" de un instante ISO. */
export function dateKey(iso: string | Date): string {
  return keyFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function todayKey(): string {
  return dateKey(new Date());
}

const keyToDate = (key: string) => new Date(`${key}T12:00:00Z`);

export function addDays(key: string, n: number): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de la fecha dada. */
export function weekStart(key: string): string {
  const dow = (keyToDate(key).getUTCDay() + 6) % 7;
  return addDays(key, -dow);
}

/** "Mar 18 ago" */
export function fmtDayShort(key: string): string {
  const d = keyToDate(key);
  return `${cap(clean(wdShort.format(d)))} ${d.getUTCDate()} ${clean(monShort.format(d))}`;
}

/** "Mar" */
export function fmtWeekday(key: string): string {
  return cap(clean(wdShort.format(keyToDate(key))));
}

export function dayNum(key: string): number {
  return keyToDate(key).getUTCDate();
}

/** "Hoy", "Mañana" o "Jue 20 ago" */
export function fmtRelativeDay(key: string): string {
  const t = todayKey();
  if (key === t) return 'Hoy';
  if (key === addDays(t, 1)) return 'Mañana';
  return fmtDayShort(key);
}

/** "martes 18 de agosto" */
export function fmtLongDate(key: string): string {
  const d = keyToDate(key);
  return `${wdLong.format(d)} ${d.getUTCDate()} de ${monLong.format(d)}`;
}

/** "15 sept 2026" */
export function fmtDate(key: string | null | undefined): string {
  if (!key) return '—';
  const d = keyToDate(key.slice(0, 10));
  return `${d.getUTCDate()} ${clean(monShort.format(d))} ${d.getUTCFullYear()}`;
}

/** "enero 2026" */
export function fmtMonthYear(key: string): string {
  const d = keyToDate(key.slice(0, 10));
  return `${monLong.format(d)} ${d.getUTCFullYear()}`;
}

/** Inicial del mes de "YYYY-MM" → "E" */
export function monthInitial(ym: string): string {
  return cap(monShort.format(keyToDate(`${ym}-01`))).charAt(0);
}

export function monthShort(ym: string): string {
  return cap(clean(monShort.format(keyToDate(`${ym}-01`))));
}

/** Instante ISO con fecha relativa: "Hace 2 días", "Hoy"... */
export function fmtAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.round((keyToDate(todayKey()).getTime() - keyToDate(dateKey(iso)).getTime()) / 86400000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export function fmtMoney(n: number): string {
  return money.format(n).replace(/\s/g, '');
}
export function fmtMoneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return fmtMoney(n);
}

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

export function age(birth: string | null): string {
  if (!birth) return '—';
  const [y, m, d] = birth.split('-').map(Number);
  const [ty, tm, td] = todayKey().split('-').map(Number);
  let a = ty - y;
  if (tm < m || (tm === m && td < d)) a--;
  return `${a} años`;
}

export function firstName(name: string): string {
  return name.split(' ')[0];
}
