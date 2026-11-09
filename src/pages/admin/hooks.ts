import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Discipline, Implement, Plan, StudentRow, Teacher } from '../../api/types';
import { useSheet, useToast } from '../../components/ui';

export const useDisciplines = () =>
  useQuery({ queryKey: ['disciplines'], queryFn: () => api.get<Discipline[]>('/disciplines'), staleTime: 60_000 });

export const useTeachers = () =>
  useQuery({ queryKey: ['teachers'], queryFn: () => api.get<Teacher[]>('/admin/teachers'), staleTime: 30_000 });

export const usePlans = () =>
  useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/admin/plans'), staleTime: 30_000 });

export const useImplements = () =>
  useQuery({ queryKey: ['implements'], queryFn: () => api.get<Implement[]>('/admin/implements'), staleTime: 30_000 });

export const useStudents = (q = '') =>
  useQuery({ queryKey: ['students', q], queryFn: () => api.get<StudentRow[]>(`/admin/students${q ? `?q=${encodeURIComponent(q)}` : ''}`) });

/** Tras una mutación: refresca todo, cierra el sheet (opcional) y muestra un toast. */
export function useDone() {
  const qc = useQueryClient();
  const { close } = useSheet();
  const toast = useToast();
  return (msg: string, opts: { keepOpen?: boolean; icon?: string } = {}) => {
    qc.invalidateQueries();
    if (!opts.keepOpen) close();
    toast(msg, opts.icon);
  };
}

export const LEVELS = ['Todos', 'Principiante', 'Intermedio', 'Avanzado'];
export const COLORS = ['teal', 'violet', 'pulse', 'amber', 'volt', 'red', 'blue', 'brown'];
