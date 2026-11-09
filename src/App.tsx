import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { type Area, areasFor, homeFor } from './lib/roles';
import { TeacherClasses } from './pages/teacher/Classes';
import { TeacherHome } from './pages/teacher/Home';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { AdminCalendar } from './pages/admin/Calendar';
import { AdminCatalog } from './pages/admin/Catalog';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminDisciplines } from './pages/admin/Disciplines';
import { AdminReports } from './pages/admin/Reports';
import { AdminStudents } from './pages/admin/Students';
import { AdminTeachers } from './pages/admin/Teachers';
import { StudentAgenda } from './pages/student/Agenda';
import { StudentHome } from './pages/student/Home';
import { StudentMyClasses } from './pages/student/MyClasses';
import { StudentProfilePage } from './pages/student/Profile';
import { StudentProgress } from './pages/student/Progress';

function RequireRole({ role, children }: { role: Area; children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loading /></div>;
  if (!me) return <Navigate to="/login" replace />;
  if (!areasFor(me).includes(role)) return <Navigate to={homeFor(me)} replace />;
  return <>{children}</>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loading /></div>;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(me)} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro/:token" element={<RegisterPage />} />
      <Route element={<RequireRole role="student"><Layout role="student" /></RequireRole>}>
        <Route path="/inicio" element={<StudentHome />} />
        <Route path="/agenda" element={<StudentAgenda />} />
        <Route path="/mis-clases" element={<StudentMyClasses />} />
        <Route path="/progreso" element={<StudentProgress />} />
        <Route path="/perfil" element={<StudentProfilePage />} />
      </Route>
      <Route path="/admin" element={<RequireRole role="admin"><Layout role="admin" /></RequireRole>}>
        <Route index element={<AdminDashboard />} />
        <Route path="calendario" element={<AdminCalendar />} />
        <Route path="disciplinas" element={<AdminDisciplines />} />
        <Route path="profesores" element={<AdminTeachers />} />
        <Route path="estudiantes" element={<AdminStudents />} />
        <Route path="reportes" element={<AdminReports />} />
        <Route path="catalogo" element={<AdminCatalog />} />
      </Route>
      <Route path="/profesor" element={<RequireRole role="teacher"><Layout role="teacher" /></RequireRole>}>
        <Route index element={<TeacherHome />} />
        <Route path="clases" element={<TeacherClasses />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
