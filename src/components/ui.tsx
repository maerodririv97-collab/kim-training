import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BookingStatus, ClassItem } from '../api/types';
import { Icon } from './Icon';

// ---------------------------------------------------------------- Badges

export type BadgeKind = 'open' | 'low' | 'full' | 'wait' | 'booked' | 'done' | 'cancel' | 'noshow';

const BADGES: Record<BadgeKind, [string, string]> = {
  open: ['badge-open', 'Disponible'],
  low: ['badge-low', 'Casi llena'],
  full: ['badge-full', 'Llena'],
  wait: ['badge-wait', 'Lista de espera'],
  booked: ['badge-booked', 'Reservada'],
  done: ['badge-done', 'Completada'],
  cancel: ['badge-cancel', 'Cancelada'],
  noshow: ['badge-noshow', 'No asistida'],
};

export function Badge({ kind, label }: { kind: BadgeKind; label?: string }) {
  const [cls, text] = BADGES[kind];
  return (
    <span className={`badge ${cls}`}>
      <span className="b-dot" />
      {label ?? text}
    </span>
  );
}

export function occStatus(c: Pick<ClassItem, 'booked' | 'capacity'>): 'open' | 'low' | 'full' {
  const ratio = c.booked / c.capacity;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.8) return 'low';
  return 'open';
}

/** Estado visible de una reserva (una reserva pasada sin marcar cuenta como realizada). */
export function bookingBadge(status: BookingStatus, startsAt: string, classCancelled = false): { kind: BadgeKind; label?: string } {
  if (classCancelled) return { kind: 'cancel', label: 'Clase cancelada' };
  switch (status) {
    case 'booked':
      return new Date(startsAt) <= new Date() ? { kind: 'done' } : { kind: 'booked' };
    case 'attended':
      return { kind: 'done' };
    case 'noshow':
      return { kind: 'noshow' };
    case 'waitlist':
      return { kind: 'wait' };
    case 'late_cancel':
      return { kind: 'cancel', label: 'Cancelada tarde' };
    case 'expired':
      return { kind: 'cancel', label: 'Espera vencida' };
    default:
      return { kind: 'cancel' };
  }
}

export function DiscTag({ name, color, upper }: { name: string; color: string; upper?: boolean }) {
  return <span className={`disc-tag tag-c-${color}`}>{upper ? name.toUpperCase() : name}</span>;
}

export const SWATCH: Record<string, string> = {
  teal: 'var(--teal)', violet: 'var(--violet)', pulse: 'var(--pulse)', amber: 'var(--amber)',
  volt: 'var(--volt-dark)', red: '#B5342B', blue: '#2C6899', brown: '#7A5C2E',
};

// ---------------------------------------------------------------- Dial (indicador radial)

export function Dial({ percent, size = 64, stroke = 6, color = '--pulse', label }: { percent: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="dial" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line-soft)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={`var(${color})`} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className="dial-value">
        <span className="num">{Math.round(percent)}%</span>
        {label && <span className="lbl">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Estados

export function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="empty">
      <div className="ic"><Icon name={icon} size={24} /></div>
      <h4>{title}</h4>
      <p>{desc}</p>
    </div>
  );
}

export function Spinner({ dark }: { dark?: boolean }) {
  return <span className={`spinner${dark ? ' dark' : ''}`} />;
}

export function Loading() {
  return (
    <div className="loading-box"><Spinner dark /></div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="ic"><Icon name="x" size={24} /></div>
      <h4>No pudimos cargar la información</h4>
      <p>{error instanceof Error ? error.message : 'Error inesperado'}</p>
      {onRetry && <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Sheet (modal inferior)

interface SheetCtx {
  open: (node: ReactNode) => void;
  close: () => void;
}
const SheetContext = createContext<SheetCtx>({ open: () => {}, close: () => {} });
export const useSheet = () => useContext(SheetContext);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const open = useCallback((node: ReactNode) => setContent(node), []);
  const close = useCallback(() => setContent(null), []);

  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [content, close]);

  return (
    <SheetContext.Provider value={{ open, close }}>
      {children}
      {content && (
        <div className="overlay show" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="sheet" role="dialog" aria-modal="true">
            {content}
          </div>
        </div>
      )}
    </SheetContext.Provider>
  );
}

export function SheetHead({ title }: { title: string }) {
  const { close } = useSheet();
  return (
    <>
      <div className="sheet-handle" />
      <div className="sheet-head">
        <h3>{title}</h3>
        <button className="sheet-close" onClick={close} aria-label="Cerrar"><Icon name="x" size={15} /></button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Toast

type ToastFn = (msg: string, icon?: string) => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ msg: string; icon: string; show: boolean }>({ msg: '', icon: 'check', show: false });
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback<ToastFn>((msg, icon = 'check') => {
    setState({ msg, icon, show: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState((s) => ({ ...s, show: false })), 2800);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`toast${state.show ? ' show' : ''}`} role="status" aria-live="polite">
        <span className="ic"><Icon name={state.icon} size={16} /></span>
        {state.msg}
      </div>
    </ToastContext.Provider>
  );
}
