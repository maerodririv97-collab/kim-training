import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { AREA_HOME, type Area, areasFor } from '../lib/roles';
import { Icon } from './Icon';

export const STUDENT_NAV = [
  { to: '/inicio', label: 'Inicio', icon: 'home' },
  { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/mis-clases', label: 'Mis clases', icon: 'clock' },
  { to: '/progreso', label: 'Progreso', icon: 'chart' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
];

export const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: 'home' },
  { to: '/admin/calendario', label: 'Calendario', icon: 'calendar' },
  { to: '/admin/disciplinas', label: 'Disciplinas', icon: 'bolt' },
  { to: '/admin/profesores', label: 'Profesores', icon: 'users' },
  { to: '/admin/estudiantes', label: 'Estudiantes', icon: 'user' },
  { to: '/admin/reportes', label: 'Reportes', icon: 'chart' },
  { to: '/admin/implementos', label: 'Implementos', icon: 'box' },
  { to: '/admin/catalogo', label: 'Planes y promos', icon: 'tag' },
];

export const TEACHER_NAV = [
  { to: '/profesor', label: 'Hoy', icon: 'home' },
  { to: '/profesor/clases', label: 'Mis clases', icon: 'calendar' },
];

const ROLE_LABEL: Record<Area, string | null> = { admin: 'Administrador', teacher: 'Profesor', student: null };

export function Layout({ role }: { role: Area }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const areas = me ? areasFor(me) : [];
  const nav = role === 'admin' ? ADMIN_NAV : role === 'teacher' ? TEACHER_NAV : STUDENT_NAV;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div id="app">
      <div className="topbar">
        <div className="brand"><img className="brand-logo" src="/logo-kim.png" alt="KIM Solutions" /><span className="brand-sub">Training</span></div>
        <div className="user-chip">
          {areas.length > 1 ? (
            <div className="role-switch" role="tablist" aria-label="Cambiar de vista">
              {areas.map((a) => (
                <button key={a} role="tab" aria-selected={a === role} className={a === role ? 'active' : ''} onClick={() => navigate(AREA_HOME[a])}>
                  {ROLE_LABEL[a]}
                </button>
              ))}
            </div>
          ) : ROLE_LABEL[role] && <span className="role-pill">{ROLE_LABEL[role]}</span>}
          <span className="name">{me?.user.name}</span>
          <button className="icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={onLogout}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>

      <div className="shell">
        <aside className="sidebar">
          <nav>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/admin' || n.to === '/profesor'} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main>
          <div className="page" key={pathname}>
            <Outlet />
          </div>
        </main>
      </div>

      <div className="bottom-nav">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/admin' || n.to === '/profesor'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={20} />
            {n.label.split(' ')[0]}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
