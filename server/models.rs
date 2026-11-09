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
    /// Nombres de los implementos que incluye el plan (ej. "Moto").
    pub implements: Vec<String>,
}

/// SELECT de planes asignados con su consumo (`sp` = student_plans).
pub fn plan_status_select() -> String {
    format!(
        "SELECT sp.id, sp.name, sp.total_classes,
                u.used, (sp.total_classes - u.used) AS remaining,
                sp.price, sp.starts_on, sp.ends_on,
                coalesce((SELECT array_agg(i.name ORDER BY i.name) FROM student_plan_implements spi
                          JOIN implements i ON i.id = spi.implement_id
                          WHERE spi.student_plan_id = sp.id), '{{}}') AS implements
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

/// Condición SQL: el implemento `i` aplica a la disciplina `discipline_expr`
/// (si no tiene disciplinas asociadas, aplica a todas).
pub fn implement_applies(discipline_expr: &str) -> String {
    format!(
        "(NOT EXISTS (SELECT 1 FROM implement_disciplines x WHERE x.implement_id = i.id)
                       OR EXISTS (SELECT 1 FROM implement_disciplines x WHERE x.implement_id = i.id AND x.discipline_id = {discipline_expr}))"
    )
}

/// Uso de un implemento en el horario de una clase.
#[derive(Debug, Serialize, FromRow)]
pub struct ImplementUsage {
    pub id: i64,
    pub name: String,
    pub quantity: i32,
    /// Unidades apartadas en todas las clases que se cruzan con este horario (incluida esta).
    pub used: i32,
    /// Unidades apartadas en esta clase.
    pub in_class: i32,
    pub available: i32,
}

/// Subconsulta: unidades del implemento `i` apartadas en clases no canceladas que se cruzan con la clase `c`.
/// Es conservadora: cuenta todas las reservas cuyo horario se solapa con el de `c`.
pub fn implement_used_sql() -> String {
    format!(
        "(SELECT count(*) FROM booking_implements bi
          JOIN bookings b ON b.id = bi.booking_id AND b.status IN {SEAT_STATUSES}
          JOIN classes o ON o.id = b.class_id AND NOT o.cancelled
          WHERE bi.implement_id = i.id
            AND o.starts_at < c.starts_at + make_interval(mins => c.duration_min)
            AND c.starts_at < o.starts_at + make_interval(mins => o.duration_min))::int"
    )
}

/// Implementos que aplican a la clase `$1` con su uso en ese horario.
pub async fn class_implements(conn: &mut sqlx::PgConnection, class_id: i64) -> Result<Vec<ImplementUsage>, sqlx::Error> {
    sqlx::query_as::<_, ImplementUsage>(&format!(
        "SELECT i.id, i.name, i.quantity, u.used,
                (SELECT count(*) FROM booking_implements bi JOIN bookings b ON b.id = bi.booking_id
                 WHERE bi.implement_id = i.id AND b.class_id = c.id AND b.status IN {SEAT_STATUSES})::int AS in_class,
                greatest(i.quantity - u.used, 0) AS available
         FROM classes c
         JOIN implements i ON i.active AND {}
         CROSS JOIN LATERAL (SELECT {} AS used) u
         WHERE c.id = $1
         ORDER BY i.name",
        implement_applies("c.discipline_id"),
        implement_used_sql()
    ))
    .bind(class_id)
    .fetch_all(conn)
    .await
}

/// Iniciales para el avatar ("María López" → "ML").
pub fn initials(name: &str) -> String {
    name.split_whitespace().filter_map(|w| w.chars().next()).take(2).collect::<String>().to_uppercase()
}

pub const DISCIPLINE_COLORS: [&str; 8] = ["teal", "violet", "pulse", "amber", "volt", "red", "blue", "brown"];
pub const LEVELS: [&str; 4] = ["Todos", "Principiante", "Intermedio", "Avanzado"];
