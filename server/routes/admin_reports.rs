//! Reportes del administrador (/api/admin/reports).

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::Admin;
use crate::error::{ApiResult, AppError};
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new().route("/reports", get(reports))
}

#[derive(Deserialize)]
struct ReportQuery {
    days: Option<i32>,
}

#[derive(Serialize, FromRow)]
struct DisciplineReport {
    name: String,
    color: String,
    classes: i32,
    taken: i32,
    capacity: i32,
    occupancy_pct: i32,
}

#[derive(Serialize, FromRow)]
struct TeacherReport {
    id: i64,
    name: String,
    classes: i32,
    students: i32,
    occupancy_pct: i32,
}

#[derive(Serialize, FromRow)]
struct StudentReport {
    id: i64,
    name: String,
    attended: i32,
    noshow: i32,
    cancelled: i32,
    attendance_pct: i32,
}

#[derive(Serialize, FromRow)]
struct SlotReport {
    discipline: String,
    color: String,
    teacher: String,
    weekday: i32,
    time: String,
    classes: i32,
    avg_taken: f64,
    occupancy_pct: i32,
}

#[derive(Serialize, FromRow)]
struct MonthReport {
    month: String,
    cancellations: i32,
    reschedules: i32,
    new_students: i32,
}

/// Clases pasadas (no canceladas) del periodo con su ocupación. `$1` = días, `$2` = zona horaria.
const PERIOD_CLASSES: &str = "
    WITH pc AS (
        SELECT c.*, (SELECT count(*) FROM bookings b WHERE b.class_id = c.id
                       AND b.status IN ('booked','attended','noshow'))::int AS taken
        FROM classes c
        WHERE NOT c.cancelled AND c.starts_at < now() AND c.starts_at >= now() - make_interval(days => $1)
    )";

async fn reports(State(state): State<AppState>, _: Admin, Query(q): Query<ReportQuery>) -> ApiResult<Json<Value>> {
    let days = q.days.unwrap_or(30);
    if !(1..=365).contains(&days) {
        return Err(AppError::bad_request("El periodo debe estar entre 1 y 365 días"));
    }
    let tz = &state.cfg.tz_name;

    let by_discipline = sqlx::query_as::<_, DisciplineReport>(&format!(
        "{PERIOD_CLASSES}
         SELECT d.name, d.color, count(pc.id)::int AS classes, coalesce(sum(pc.taken), 0)::int AS taken,
                coalesce(sum(pc.capacity), 0)::int AS capacity,
                coalesce(round(100.0 * sum(pc.taken) / nullif(sum(pc.capacity), 0)), 0)::int AS occupancy_pct
         FROM disciplines d LEFT JOIN pc ON pc.discipline_id = d.id
         WHERE d.active OR pc.id IS NOT NULL
         GROUP BY d.id ORDER BY occupancy_pct DESC, d.name"
    ))
    .bind(days)
    .fetch_all(&state.db)
    .await?;

    let by_teacher = sqlx::query_as::<_, TeacherReport>(&format!(
        "{PERIOD_CLASSES}
         SELECT t.id, t.name, count(DISTINCT pc.id)::int AS classes,
                (SELECT count(DISTINCT b.student_id) FROM bookings b JOIN pc p2 ON p2.id = b.class_id
                 WHERE p2.teacher_id = t.id AND b.status IN ('booked','attended','noshow'))::int AS students,
                coalesce(round(100.0 * sum(pc.taken) / nullif(sum(pc.capacity), 0)), 0)::int AS occupancy_pct
         FROM teachers t LEFT JOIN pc ON pc.teacher_id = t.id
         GROUP BY t.id ORDER BY classes DESC, t.name"
    ))
    .bind(days)
    .fetch_all(&state.db)
    .await?;

    let by_student = sqlx::query_as::<_, StudentReport>(
        "SELECT s.id, s.name,
                count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))::int AS attended,
                count(*) FILTER (WHERE b.status = 'noshow')::int AS noshow,
                count(*) FILTER (WHERE b.status IN ('cancelled','late_cancel'))::int AS cancelled,
                coalesce(round(100.0 * count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))
                     / nullif(count(*) FILTER (WHERE b.status IN ('attended','noshow') OR (b.status = 'booked' AND c.starts_at <= now())), 0)), 0)::int AS attendance_pct
         FROM students s
         JOIN bookings b ON b.student_id = s.id
         JOIN classes c ON c.id = b.class_id
         WHERE NOT c.cancelled AND c.starts_at < now() AND c.starts_at >= now() - make_interval(days => $1)
         GROUP BY s.id ORDER BY attended DESC, s.name LIMIT 100",
    )
    .bind(days)
    .fetch_all(&state.db)
    .await?;

    let by_slot = sqlx::query_as::<_, SlotReport>(&format!(
        "{PERIOD_CLASSES}
         SELECT d.name AS discipline, d.color, t.name AS teacher,
                extract(isodow FROM pc.starts_at AT TIME ZONE $2)::int AS weekday,
                to_char(pc.starts_at AT TIME ZONE $2, 'HH24:MI') AS time,
                count(*)::int AS classes, round(avg(pc.taken), 1)::float8 AS avg_taken,
                coalesce(round(100.0 * sum(pc.taken) / nullif(sum(pc.capacity), 0)), 0)::int AS occupancy_pct
         FROM pc JOIN disciplines d ON d.id = pc.discipline_id JOIN teachers t ON t.id = pc.teacher_id
         GROUP BY d.name, d.color, t.name, weekday, time
         ORDER BY weekday, time"
    ))
    .bind(days)
    .bind(tz)
    .fetch_all(&state.db)
    .await?;

    let monthly = sqlx::query_as::<_, MonthReport>(
        "SELECT to_char(m, 'YYYY-MM') AS month,
                (SELECT count(*) FROM bookings b
                 WHERE b.status IN ('cancelled','late_cancel')
                   AND date_trunc('month', b.updated_at AT TIME ZONE $1) = m
                   AND NOT EXISTS (SELECT 1 FROM bookings n WHERE n.rescheduled_from = b.id))::int AS cancellations,
                (SELECT count(*) FROM bookings b
                 WHERE b.rescheduled_from IS NOT NULL AND date_trunc('month', b.created_at AT TIME ZONE $1) = m)::int AS reschedules,
                (SELECT count(*) FROM students s WHERE date_trunc('month', s.joined_on::timestamp) = m)::int AS new_students
         FROM generate_series(date_trunc('month', now() AT TIME ZONE $1) - interval '11 months',
                              date_trunc('month', now() AT TIME ZONE $1), interval '1 month') m
         ORDER BY m",
    )
    .bind(tz)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "days": days,
        "by_discipline": by_discipline,
        "by_teacher": by_teacher,
        "by_student": by_student,
        "by_slot": by_slot,
        "monthly": monthly,
    })))
}
