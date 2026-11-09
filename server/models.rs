//! Estructuras compartidas y fragmentos SQL reutilizados por varias rutas.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

/// Estados de reserva que ocupan un cupo en la clase.
pub const SEAT_STATUSES: &str = "('booked','attended','noshow')";
/// Estados de reserva que consumen una clase del plan.
pub const CONSUMING_STATUSES: &str = "('booked','attended','noshow','late_cancel')";

/// Clase con conteo de cupos. `my_*` solo se llena en las consultas del estudiante.
#[derive(Debug, Serialize, FromRow)]
pub struct ClassItem {
    pub id: i64,
    pub discipline_id: i64,
    pub discipline: String,
    pub color: String,
    pub teacher_id: i64,
    pub teacher: String,
    pub starts_at: DateTime<Utc>,
    pub duration_min: i32,
    pub level: String,
    pub capacity: i32,
    pub location: String,
    pub cancelled: bool,
    pub booked: i32,
    pub waitlist: i32,
    pub my_booking_id: Option<i64>,
    pub my_status: Option<String>,
}

/// SELECT base de clases. `$1` es el id del estudiante (o NULL) para calcular `my_*`.
pub fn class_select() -> String {
    format!(
        "SELECT c.id, c.discipline_id, d.name AS discipline, d.color, c.teacher_id, t.name AS teacher,
                c.starts_at, c.duration_min, c.level, c.capacity, c.location, c.cancelled,
                (SELECT count(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN {SEAT_STATUSES})::int AS booked,
                (SELECT count(*) FROM bookings b WHERE b.class_id = c.id AND b.status = 'waitlist')::int AS waitlist,
                mb.id AS my_booking_id, mb.status AS my_status
         FROM classes c
         JOIN disciplines d ON d.id = c.discipline_id
         JOIN teachers t ON t.id = c.teacher_id
         LEFT JOIN LATERAL (
            SELECT b.id, b.status FROM bookings b
            WHERE b.class_id = c.id AND b.student_id = $1 AND b.status IN ('booked','attended','noshow','waitlist')
            LIMIT 1
         ) mb ON TRUE"
    )
}

#[derive(Debug, Serialize, FromRow)]
pub struct DisciplineRef {
    pub id: i64,
    pub name: String,
    pub color: String,
}

/// Plan vigente de un estudiante con su consumo.
#[derive(Debug, Serialize, FromRow)]
pub struct PlanStatus {
    pub id: i64,
    pub name: String,
    pub total_classes: i32,
    pub used: i32,
    pub remaining: i32,
    pub price: i64,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
}

/// SELECT de planes asignados con su consumo (`sp` = student_plans).
pub fn plan_status_select() -> String {
    format!(
        "SELECT sp.id, sp.name, sp.total_classes,
                u.used, (sp.total_classes - u.used) AS remaining,
                sp.price, sp.starts_on, sp.ends_on
         FROM student_plans sp
         CROSS JOIN LATERAL (
            SELECT count(*)::int AS used FROM bookings b
            WHERE b.student_plan_id = sp.id AND b.status IN {CONSUMING_STATUSES}
         ) u"
    )
}

/// Plan vigente hoy (el que vence más tarde si hay varios superpuestos).
pub async fn current_plan(db: &sqlx::PgPool, student_id: i64, today: NaiveDate) -> Result<Option<PlanStatus>, sqlx::Error> {
    sqlx::query_as::<_, PlanStatus>(&format!(
        "{} WHERE sp.student_id = $1 AND sp.starts_on <= $2 AND sp.ends_on >= $2
         ORDER BY sp.ends_on DESC, sp.id DESC LIMIT 1",
        plan_status_select()
    ))
    .bind(student_id)
    .bind(today)
    .fetch_optional(db)
    .await
}

/// Iniciales para el avatar ("María López" → "ML").
pub fn initials(name: &str) -> String {
    name.split_whitespace().filter_map(|w| w.chars().next()).take(2).collect::<String>().to_uppercase()
}

pub const DISCIPLINE_COLORS: [&str; 8] = ["teal", "violet", "pulse", "amber", "volt", "red", "blue", "brown"];
pub const LEVELS: [&str; 4] = ["Todos", "Principiante", "Intermedio", "Avanzado"];
