export type Role = 'admin' | 'student' | 'teacher';

export interface Me {
  user: { id: number; email: string; role: Role; is_admin: boolean; name: string; initials: string };
  student_id: number | null;
  teacher_id: number | null;
}

export interface DisciplineRef {
  id: number;
  name: string;
  color: string;
}

export interface Discipline extends DisciplineRef {
  description: string;
  active: boolean;
}

export interface AdminDiscipline extends Discipline {
  created_at: string;
  teachers: number;
  students: number;
  upcoming_classes: number;
  total_classes: number;
}

export type BookingStatus = 'booked' | 'attended' | 'noshow' | 'late_cancel' | 'cancelled' | 'waitlist' | 'expired';

export interface ClassItem {
  id: number;
  discipline_id: number;
  discipline: string;
  color: string;
  teacher_id: number;
  teacher: string;
  starts_at: string;
  duration_min: number;
  level: string;
  capacity: number;
  location: string;
  cancelled: boolean;
  booked: number;
  waitlist: number;
  my_booking_id: number | null;
  my_status: BookingStatus | null;
}

export interface PlanStatus {
  id: number;
  name: string;
  total_classes: number;
  used: number;
  remaining: number;
  price: number;
  starts_on: string;
  ends_on: string;
}

export interface Overview {
  student: { id: number; name: string; initials: string };
  today: string;
  disciplines: DisciplineRef[];
  plan: PlanStatus | null;
  upcoming: ClassItem[];
}

export interface BookingItem {
  booking_id: number;
  status: BookingStatus;
  rescheduled: boolean;
  class_id: number;
  discipline: string;
  color: string;
  teacher: string;
  starts_at: string;
  duration_min: number;
  location: string;
  level: string;
  class_cancelled: boolean;
}

export interface DisciplineStat extends DisciplineRef {
  classes: number;
  attendance_pct: number;
  since: string;
}

export interface Progress {
  attended: number;
  noshow: number;
  attendance_pct: number;
  months_active: number;
  disciplines_count: number;
  monthly: { month: string; count: number }[];
  disciplines: DisciplineStat[];
  goal: string | null;
}

export interface Promotion {
  id: number;
  badge: string;
  title: string;
  description: string;
  style: 'promo-1' | 'promo-2' | 'promo-3';
  expires_on: string | null;
}

export interface StudentProfile {
  initials: string;
  info: {
    name: string;
    email: string;
    phone: string | null;
    birth_date: string | null;
    joined_on: string;
    weight_kg: number | null;
    height_m: number | null;
    level: string | null;
    restrictions: string | null;
    goal: string | null;
  };
  plan: PlanStatus | null;
  plans: { plan: PlanStatus; status: 'Activo' | 'Programado' | 'Finalizado' }[];
  disciplines: DisciplineStat[];
  promotions: Promotion[];
}

export interface BookingResult {
  booking_id: number;
  status: string;
}
export interface WaitlistResult {
  booking_id: number;
  position: number;
  expires_at: string;
}
export interface CancelResult {
  status: 'cancelled' | 'late_cancel';
  refunded: boolean;
}

// ---------- Admin

export interface Dashboard {
  date: string;
  kpis: {
    classes_today: number;
    bookings_today: number;
    bookings_delta_pct: number | null;
    occupancy_pct: number;
    waitlist: number;
    cancellations_today: number;
    revenue_today: number;
  };
  classes: ClassItem[];
  alerts: {
    soon: ClassItem[];
    password_resets: { id: number; user_id: number; email: string; student_id: number | null; name: string | null; created_at: string }[];
    low_plans: { student_id: number; name: string; plan: string; remaining: number; ends_on: string }[];
    without_plan: { student_id: number; name: string; joined_on: string; invited: boolean }[];
  };
}

export interface Attendee {
  booking_id: number;
  student_id: number;
  name: string;
  initials: string;
  email: string;
  status: BookingStatus;
  plan_name: string | null;
  created_at: string;
}

export interface Teacher {
  id: number;
  name: string;
  initials: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  has_login: boolean;
  is_admin: boolean;
  disciplines: DisciplineRef[];
  classes_week: number;
  students_30d: number;
  occupancy_30d: number;
}

export interface StudentRow {
  id: number;
  name: string;
  initials: string;
  email: string;
  active: boolean;
  disciplines: DisciplineRef[];
  plan_name: string | null;
  remaining: number | null;
  plan_ends_on: string | null;
  attended: number;
  noshow: number;
  attendance_pct: number;
  last_attended_at: string | null;
}

export interface StudentDetail {
  student: {
    id: number;
    user_id: number;
    name: string;
    email: string;
    active: boolean;
    phone: string | null;
    birth_date: string | null;
    joined_on: string;
    weight_kg: number | null;
    height_m: number | null;
    level: string | null;
    restrictions: string | null;
    goal: string | null;
    notes: string | null;
    discipline_ids: number[];
    attended: number;
    noshow: number;
    last_attended_at: string | null;
    reset_pending: boolean;
  };
  initials: string;
  attendance_pct: number;
  plan: PlanStatus | null;
  plans: PlanStatus[];
}

export interface Plan {
  id: number;
  name: string;
  total_classes: number;
  duration_days: number;
  price: number;
  active: boolean;
  active_students: number;
}

export interface AdminPromotion extends Promotion {
  active: boolean;
  discipline_ids: number[];
}

export interface Reports {
  days: number;
  by_discipline: { name: string; color: string; classes: number; taken: number; capacity: number; occupancy_pct: number }[];
  by_teacher: { id: number; name: string; classes: number; students: number; occupancy_pct: number }[];
  by_student: { id: number; name: string; attended: number; noshow: number; cancelled: number; attendance_pct: number }[];
  by_slot: { discipline: string; color: string; teacher: string; weekday: number; time: string; classes: number; avg_taken: number; occupancy_pct: number }[];
  monthly: { month: string; cancellations: number; reschedules: number; new_students: number }[];
}

export interface TeacherOverview {
  teacher: { id: number; name: string; initials: string };
  today: string;
  disciplines: DisciplineRef[];
  today_classes: ClassItem[];
  week_classes: ClassItem[];
  pending_attendance: number;
}

export interface Invite {
  id: number;
  token: string;
  label: string;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  revoked: boolean;
  active: boolean;
  disciplines: DisciplineRef[];
  pending_plan: number;
}

export interface InviteInfo {
  label: string;
  expires_at: string;
  disciplines: { name: string; color: string }[];
}
