import type { PlanOption } from '../api/types';
import { fmtDate } from '../lib/format';

/** Texto corto de un plan para listas y selects. */
export function planLabel(p: PlanOption): string {
  const imp = p.implements.length ? ` · con ${p.implements.join(', ')}${p.implements_available ? '' : ' (agotado)'}` : '';
  return `${p.name} · ${p.remaining} disp. · vence ${fmtDate(p.ends_on)}${imp}`;
}

/**
 * Selector del plan del que se descuenta la clase. Solo se muestra si hay más de un plan válido;
 * con uno solo no hay nada que elegir.
 */
export function PlanPicker({ options, value, onChange, label = 'Descontar del plan' }: {
  options: PlanOption[];
  value: number;
  onChange: (id: number) => void;
  label?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div className="form-field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((p) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
      </select>
    </div>
  );
}
