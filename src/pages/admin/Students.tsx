import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Loading, useSheet } from '../../components/ui';
import { useStudents } from './hooks';
import { InvitesSheet } from './Invites';
import { NewStudentSheet, StudentSheet } from './StudentSheets';

export function AdminStudents() {
  const { open } = useSheet();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const { data, isLoading, error, refetch } = useStudents(q);

  return (
    <>
      <div className="greet">
        <h1>Estudiantes</h1>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => open(<InvitesSheet />)}><Icon name="users" size={15} /> Invitar estudiantes</button>
          <button className="btn btn-primary" onClick={() => open(<NewStudentSheet />)}><Icon name="plus" size={15} /> Nuevo estudiante</button>
        </div>
      </div>
      <input className="search-input" placeholder="Buscar por nombre o correo…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 14 }} />
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Estudiante</th><th>Plan</th><th>Disciplinas habilitadas</th><th>Disponibles</th><th>Asistencia</th><th></th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.6 }}>
                  <td>
                    <div className="mini-row">
                      <div className="mini-av">{s.initials}</div>
                      <div>
                        <div>{s.name}</div>
                        {!s.active && <Badge kind="cancel" label="Inactivo" />}
                      </div>
                    </div>
                  </td>
                  <td>{s.plan_name ?? <span className="muted">Sin plan vigente</span>}</td>
                  <td>
                    {s.disciplines.length
                      ? s.disciplines.map((d) => <span key={d.id} style={{ margin: 1, display: 'inline-block' }}><DiscTag name={d.name} color={d.color} /></span>)
                      : <span style={{ color: 'var(--muted)', fontSize: 12 }}>Ninguna</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{s.remaining ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{s.attendance_pct}%</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => open(<StudentSheet studentId={s.id} />)}>Gestionar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon="user" title="Sin resultados" desc={q ? 'Ningún estudiante coincide con la búsqueda.' : 'Crea el primer estudiante.'} />}
    </>
  );
}
