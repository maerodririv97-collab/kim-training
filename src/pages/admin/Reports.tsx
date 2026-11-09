import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Reports } from '../../api/types';
import { DiscTag, EmptyState, ErrorState, Loading, SWATCH } from '../../components/ui';
import { initialsOf, monthInitial, monthShort } from './reportUtils';

const TABS = [['disciplina', 'Por disciplina'], ['profesor', 'Por profesor'], ['estudiante', 'Por estudiante'], ['clase', 'Por clase']] as const;
const PERIODS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '12 meses']] as const;
const WEEKDAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function Bars({ values, labels, gradient, height = 90 }: { values: number[]; labels: string[]; gradient?: string; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="bar" title={`${labels[i]}: ${v}`}
          style={{ height: `${Math.max(2, (v / max) * (height - 8))}px`, background: gradient, opacity: v ? 1 : 0.25 }}>
          <span>{monthInitial(labels[i])}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminReports() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('disciplina');
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports', days],
    queryFn: () => api.get<Reports>(`/admin/reports?days=${days}`),
  });

  return (
    <>
      <div className="greet">
        <h1>Reportes</h1>
        <div className="view-toggle">
          {PERIODS.map(([d, label]) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{label}</button>)}
        </div>
      </div>
      <div className="chip-row">
        {TABS.map(([id, label]) => <button key={id} className={`chip${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {isLoading ? <Loading /> : error || !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <>
          {tab === 'disciplina' && (
            <>
              <div className="section-title"><h3>Ocupación por disciplina</h3><span className="eyebrow">Clases dictadas en el periodo</span></div>
              <div className="card pad-l">
                {data.by_discipline.filter((d) => d.classes).length ? data.by_discipline.filter((d) => d.classes).map((d) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 90, fontSize: 12.5, fontWeight: 700 }}>{d.name}</div>
                    <div className="bar-track" style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--line-soft)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${d.occupancy_pct}%`, background: SWATCH[d.color], borderRadius: 99 }} />
                    </div>
                    <div style={{ width: 92, fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right' }}>{d.occupancy_pct}% · {d.classes} cl.</div>
                  </div>
                )) : <EmptyState icon="chart" title="Sin datos" desc="No hubo clases en el periodo seleccionado." />}
              </div>
            </>
          )}

          {tab === 'profesor' && (
            <>
              <div className="section-title"><h3>Resumen por profesor</h3></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Profesor</th><th>Clases</th><th>Estudiantes atendidos</th><th>Ocupación promedio</th></tr></thead>
                  <tbody>{data.by_teacher.map((t) => (
                    <tr key={t.id}>
                      <td><div className="mini-row"><div className="mini-av">{initialsOf(t.name)}</div>{t.name}</div></td>
                      <td className="mono">{t.classes}</td><td className="mono">{t.students}</td><td className="mono">{t.occupancy_pct}%</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'estudiante' && (
            <>
              <div className="section-title"><h3>Asistencia por estudiante</h3></div>
              {data.by_student.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Estudiante</th><th>Asistidas</th><th>No asistidas</th><th>Canceladas</th><th>Asistencia</th></tr></thead>
                    <tbody>{data.by_student.map((s) => (
                      <tr key={s.id}>
                        <td><div className="mini-row"><div className="mini-av">{initialsOf(s.name)}</div>{s.name}</div></td>
                        <td className="mono">{s.attended}</td><td className="mono">{s.noshow}</td><td className="mono">{s.cancelled}</td><td className="mono">{s.attendance_pct}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <EmptyState icon="user" title="Sin datos" desc="No hubo reservas en el periodo seleccionado." />}
            </>
          )}

          {tab === 'clase' && (
            <>
              <div className="section-title"><h3>Ocupación por horario</h3><span className="eyebrow">Agrupado por día, hora y profesor</span></div>
              {data.by_slot.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Horario</th><th>Clase</th><th>Profesor</th><th>Sesiones</th><th>Prom. asistentes</th><th>Ocupación</th></tr></thead>
                    <tbody>{data.by_slot.map((s, i) => (
                      <tr key={i}>
                        <td className="mono">{WEEKDAYS[s.weekday]} {s.time}</td>
                        <td><DiscTag name={s.discipline} color={s.color} /></td>
                        <td>{s.teacher}</td><td className="mono">{s.classes}</td><td className="mono">{s.avg_taken}</td><td className="mono">{s.occupancy_pct}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <EmptyState icon="calendar" title="Sin datos" desc="No hubo clases en el periodo seleccionado." />}
            </>
          )}

          <div className="grid-2" style={{ marginTop: 20 }}>
            <div className="card pad-l" style={{ paddingBottom: 34 }}>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>Cancelaciones vs. reprogramaciones</h3>
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                Últimos 12 meses · {data.monthly.reduce((a, m) => a + m.cancellations, 0)} cancelaciones · {data.monthly.reduce((a, m) => a + m.reschedules, 0)} reprogramaciones
              </p>
              <Bars values={data.monthly.map((m) => m.cancellations + m.reschedules)} labels={data.monthly.map((m) => m.month)} gradient="linear-gradient(180deg,var(--teal),var(--violet))" />
            </div>
            <div className="card pad-l" style={{ paddingBottom: 34 }}>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>Nuevos estudiantes por mes</h3>
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                {monthShort(data.monthly[0].month)} → {monthShort(data.monthly[data.monthly.length - 1].month)} · {data.monthly.reduce((a, m) => a + m.new_students, 0)} en total
              </p>
              <Bars values={data.monthly.map((m) => m.new_students)} labels={data.monthly.map((m) => m.month)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
