import type { Me } from '../api/types';

export type Area = 'admin' | 'teacher' | 'student';

/** Áreas de la app a las que puede entrar el usuario (un profesor con permiso de admin tiene dos). */
export function areasFor(me: Me): Area[] {
  const areas: Area[] = [];
  if (me.user.role === 'admin' || me.user.is_admin) areas.push('admin');
  if (me.user.role === 'teacher' && me.teacher_id) areas.push('teacher');
  if (me.user.role === 'student') areas.push('student');
  return areas;
}

export const AREA_HOME: Record<Area, string> = { admin: '/admin', teacher: '/profesor', student: '/inicio' };

/** Página de inicio del usuario (la primera área disponible; el admin tiene prioridad). */
export const homeFor = (me: Me): string => AREA_HOME[areasFor(me)[0] ?? 'student'];
