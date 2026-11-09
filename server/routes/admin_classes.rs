//! Administración de clases, asistentes y dashboard (/api/admin/*).

use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::Admin;
use crate::booking::{self, BookingResult};
use crate::error::{ApiResult, AppError};
use crate::models::{ClassItem, LEVELS, SEAT_STATUSES, class_implements, class_select, initials};
use crate::time::{local_range, local_to_utc, parse_date, parse_time, today};
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/dashboard", get(dashboard))
        .route("/classes", get(list_classes).post(create_class))
        .route("/classes/{id}", put(update_class))
        .route("/classes/{id}/cancel", post(cancel_class))
        .route("/classes/{id}/duplicate", post(duplicate_class))
        .route("/classes/{id}/attendees", get(attendees).post(add_attendee))
        .route("/classes/{id}/plan-options", get(plan_options))
        .route("/bookings/{id}/status", put(set_booking_status))
        .route("/bookings/{id}/cancel", post(cancel_booking))
}

#[derive(Deserialize)]
struct ClassQuery {
    from: Option<String>,
    to: Option<String>,
    teacher_id: Option<i64>,
}

async fn list_classes(State(state): State<AppState>, _: Admin, Query(q): Query<ClassQuery>) -> ApiResult<Json<Vec<ClassItem>>> {
    booking::expire_waitlists(&state.db).await?;
    let tz = &state.cfg.tz;
    let from = q.from.as_deref().map(parse_date).transpose()?.unwrap_or_else(|| today(tz));
    let to = q.to.as_deref().map(parse_date).transpose()?.unwrap_or(from + Duration::days(6));
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::bad_request("Rango de fechas inválido (máximo 62 días)"));
    }
    let (start, end) = local_range(tz, from, to)?;
    let rows = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.starts_at >= $2 AND c.starts_at < $3 AND ($4::bigint IS NULL OR c.teacher_id = $4)
         ORDER BY c.starts_at",
        class_select()
    ))
    .bind(None::<i64>)
    .bind(start)
    .bind(end)
    .bind(q.teacher_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct ClassBody {
    discipline_id: i64,
    teacher_id: i64,
    date: String,
    time: String,
    duration_min: i32,
    capacity: i32,
    level: String,
    location: String,
    /// Semanas adicionales en que se repite la clase (0 = no repetir).
    #[serde(default)]
    repeat_weeks: i32,
}

fn validate_class(body: &ClassBody) -> ApiResult<()> {
    if !(10..=300).contains(&body.duration_min) {
        return Err(AppError::bad_request("La duración debe estar entre 10 y 300 minutos"));
    }
    if !(1..=200).contains(&body.capacity) {
        return Err(AppError::bad_request("Los cupos deben estar entre 1 y 200"));
    }
    if !LEVELS.contains(&body.level.as_str()) {
        return Err(AppError::bad_request("Nivel inválido"));
    }
    if body.location.trim().is_empty() {
        return Err(AppError::bad_request("La ubicación es obligatoria"));
    }
    if !(0..=26).contains(&body.repeat_weeks) {
        return Err(AppError::bad_request("La repetición debe ser entre 0 y 26 semanas"));
    }
    Ok(())
}

async fn create_class(State(state): State<AppState>, _: Admin, Json(body): Json<ClassBody>) -> ApiResult<Json<Value>> {
    validate_class(&body)?;
    let date = parse_date(&body.date)?;
    let time = parse_time(&body.time)?;
    let first = local_to_utc(&state.cfg.tz, date, time)?;
    if first <= Utc::now() {
        return Err(AppError::bad_request("La clase debe programarse en el futuro"));
    }
    let mut tx = state.db.begin().await?;
    let mut ids = Vec::new();
    for week in 0..=body.repeat_weeks {
        let starts_at = local_to_utc(&state.cfg.tz, date + Duration::weeks(week as i64), time)?;
        let (id,): (i64,) = sqlx::query_as(
            "INSERT INTO classes (discipline_id, teacher_id, starts_at, duration_min, level, capacity, location)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        )
        .bind(body.discipline_id)
        .bind(body.teacher_id)
        .bind(starts_at)
        .bind(body.duration_min)
        .bind(&body.level)
        .bind(body.capacity)
        .bind(body.location.trim())
        .fetch_one(&mut *tx)
        .await?;
        ids.push(id);
    }
    tx.commit().await?;
    Ok(Json(json!({ "ids": ids })))
}

async fn update_class(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<ClassBody>) -> ApiResult<Json<Value>> {
    validate_class(&body)?;
    let starts_at = local_to_utc(&state.cfg.tz, parse_date(&body.date)?, parse_time(&body.time)?)?;
    let mut tx = state.db.begin().await?;
    let (capacity_before,): (i32,) = sqlx::query_as("SELECT capacity FROM classes WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("La clase no existe"))?;
    let (taken,): (i32,) = sqlx::query_as(&format!(
        "SELECT count(*)::int FROM bookings WHERE class_id = $1 AND status IN {SEAT_STATUSES}"
    ))
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if body.capacity < taken {
        return Err(AppError::bad_request(format!("Ya hay {taken} reservas; los cupos no pueden ser menos que eso")));
    }
    sqlx::query(
        "UPDATE classes SET discipline_id = $2, teacher_id = $3, starts_at = $4, duration_min = $5,
                level = $6, capacity = $7, location = $8 WHERE id = $1",
    )
    .bind(id)
    .bind(body.discipline_id)
    .bind(body.teacher_id)
    .bind(starts_at)
    .bind(body.duration_min)
    .bind(&body.level)
    .bind(body.capacity)
    .bind(body.location.trim())
    .execute(&mut *tx)
    .await?;
    if body.capacity > capacity_before {
        booking::promote_waitlist(&mut tx, &state.cfg.tz, id, body.capacity).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

/// Cancela la clase: las reservas se devuelven a los planes y la lista de espera vence.
async fn cancel_class(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query("UPDATE classes SET cancelled = TRUE WHERE id = $1 AND NOT cancelled")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::bad_request("La clase no existe o ya estaba cancelada"));
    }
    let affected = sqlx::query(
        "UPDATE bookings SET status = CASE WHEN status = 'waitlist' THEN 'expired' ELSE 'cancelled' END, updated_at = now()
         WHERE class_id = $1 AND status IN ('booked','waitlist')",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "bookings_released": affected.rows_affected() })))
}

#[derive(Deserialize)]
struct DuplicateBody {
    /// Nueva fecha (AAAA-MM-DD). Por defecto, una semana después.
    date: Option<String>,
}

async fn duplicate_class(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<DuplicateBody>) -> ApiResult<Json<Value>> {
    let tz = &state.cfg.tz;
    let (starts_at,): (DateTime<Utc>,) = sqlx::query_as("SELECT starts_at FROM classes WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("La clase no existe"))?;
    let local = starts_at.with_timezone(tz);
    let date = match body.date.as_deref() {
        Some(d) => parse_date(d)?,
        None => local.date_naive() + Duration::weeks(1),
    };
    let new_start = local_to_utc(tz, date, local.time())?;
    if new_start <= Utc::now() {
        return Err(AppError::bad_request("La nueva fecha debe ser futura"));
    }
    let (new_id,): (i64,) = sqlx::query_as(
        "INSERT INTO classes (discipline_id, teacher_id, starts_at, duration_min, level, capacity, location)
         SELECT discipline_id, teacher_id, $2, duration_min, level, capacity, location FROM classes WHERE id = $1
         RETURNING id",
    )
    .bind(id)
    .bind(new_start)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "id": new_id, "date": date })))
}

#[derive(Debug, Serialize, FromRow)]
struct Attendee {
    booking_id: i64,
    student_id: i64,
    name: String,
    email: String,
    status: String,
    plan_name: Option<String>,
    created_at: DateTime<Utc>,
    /// Implementos apartados por la reserva (ej. "Moto").
    implements: Vec<String>,
}

async fn attendees(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    Ok(Json(load_attendees(&state, id, None).await?))
}

/// Clase con su lista de asistentes. Con `teacher_id` solo permite clases de ese profesor.
pub(crate) async fn load_attendees(state: &AppState, id: i64, teacher_id: Option<i64>) -> ApiResult<Value> {
    booking::expire_waitlists(&state.db).await?;
    let class = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.id = $2 AND ($3::bigint IS NULL OR c.teacher_id = $3)",
        class_select()
    ))
    .bind(None::<i64>)
    .bind(id)
    .bind(teacher_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("La clase no existe"))?;
    let rows = sqlx::query_as::<_, Attendee>(
        "SELECT b.id AS booking_id, s.id AS student_id, s.name, u.email, b.status, sp.name AS plan_name, b.created_at,
                coalesce((SELECT array_agg(i.name ORDER BY i.name) FROM booking_implements bi
                          JOIN implements i ON i.id = bi.implement_id
                          WHERE bi.booking_id = b.id AND b.status IN ('booked','attended','noshow')), '{}') AS implements
         FROM bookings b
         JOIN students s ON s.id = b.student_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN student_plans sp ON sp.id = b.student_plan_id
         WHERE b.class_id = $1 AND b.status IN ('booked','attended','noshow','waitlist','late_cancel')
         ORDER BY CASE b.status WHEN 'waitlist' THEN 1 WHEN 'late_cancel' THEN 2 ELSE 0 END, s.name",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let attendees: Vec<Value> = rows
        .into_iter()
        .map(|a| {
            let mut v = serde_json::to_value(&a).unwrap_or_default();
            v["initials"] = json!(initials(&a.name));
            v
        })
        .collect();
    let mut conn = state.db.acquire().await?;
    let implements = class_implements(&mut conn, id).await?;
    Ok(json!({ "class": class, "attendees": attendees, "implements": implements }))
}

#[derive(Deserialize)]
struct AddAttendeeBody {
    student_id: i64,
    /// Plan del que se descuenta la clase (si el estudiante tiene varios vigentes).
    plan_id: Option<i64>,
}

/// Reserva hecha por el administrador en nombre del estudiante (mismas reglas de cupo y plan).
async fn add_attendee(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<AddAttendeeBody>) -> ApiResult<Json<BookingResult>> {
    Ok(Json(booking::book(&state.db, &state.cfg.tz, body.student_id, id, body.plan_id).await?))
}

#[derive(Deserialize)]
struct PlanOptionsQuery {
    student_id: i64,
}

/// Planes vigentes del estudiante con los que se puede tomar la clase.
async fn plan_options(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Query(q): Query<PlanOptionsQuery>) -> ApiResult<Json<Vec<booking::PlanOption>>> {
    Ok(Json(booking::plan_options(&state.db, &state.cfg.tz, q.student_id, id).await?))
}

#[derive(Deserialize)]
struct AdminCancelBody {
    /// true: la clase vuelve al plan del estudiante; false: se cuenta como cancelación tardía.
    #[serde(default = "refund_default")]
    refund: bool,
}

fn refund_default() -> bool {
    true
}

/// El administrador cancela una reserva o una solicitud de lista de espera (antes de que empiece la clase).
async fn cancel_booking(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<AdminCancelBody>) -> ApiResult<Json<booking::CancelResult>> {
    Ok(Json(booking::admin_cancel(&state.db, &state.cfg.tz, id, body.refund).await?))
}

#[derive(Deserialize)]
pub(crate) struct StatusBody {
    status: String,
}

async fn set_booking_status(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<StatusBody>) -> ApiResult<Json<Value>> {
    update_attendance(&state, id, &body, None).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Toma de asistencia: marca una reserva como asistida, no asistida o la regresa a reservada.
/// Solo en clases que ya comenzaron y no fueron canceladas. Con `teacher_id`, solo en sus clases.
pub(crate) async fn update_attendance(state: &AppState, booking_id: i64, body: &StatusBody, teacher_id: Option<i64>) -> ApiResult<()> {
    if !["attended", "noshow", "booked"].contains(&body.status.as_str()) {
        return Err(AppError::bad_request("Estado inválido"));
    }
    let class: Option<(DateTime<Utc>, bool)> = sqlx::query_as(
        "SELECT c.starts_at, c.cancelled FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE b.id = $1 AND ($2::bigint IS NULL OR c.teacher_id = $2)",
    )
    .bind(booking_id)
    .bind(teacher_id)
    .fetch_optional(&state.db)
    .await?;
    let (starts_at, cancelled) = class.ok_or_else(|| AppError::not_found("La reserva no existe"))?;
    if cancelled {
        return Err(AppError::bad_request("La clase fue cancelada"));
    }
    if starts_at > Utc::now() {
        return Err(AppError::bad_request("La asistencia se puede marcar cuando la clase haya comenzado"));
    }
    let updated = sqlx::query(
        "UPDATE bookings SET status = $2, updated_at = now()
         WHERE id = $1 AND status IN ('booked','attended','noshow')",
    )
    .bind(booking_id)
    .bind(&body.status)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::bad_request("Solo se puede marcar asistencia en reservas activas"));
    }
    Ok(())
}

async fn dashboard(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Value>> {
    booking::expire_waitlists(&state.db).await?;
    let tz = &state.cfg.tz;
    let day: NaiveDate = today(tz);
    let (start, end) = local_range(tz, day, day)?;
    let (prev_start, prev_end) = local_range(tz, day - Duration::days(7), day - Duration::days(7))?;

    let classes = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.starts_at >= $2 AND c.starts_at < $3 ORDER BY c.starts_at",
        class_select()
    ))
    .bind(None::<i64>)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?;
    let active: Vec<&ClassItem> = classes.iter().filter(|c| !c.cancelled).collect();
    let bookings_today: i32 = active.iter().map(|c| c.booked).sum();
    let capacity_today: i32 = active.iter().map(|c| c.capacity).sum();

    let (bookings_prev,): (i32,) = sqlx::query_as(&format!(
        "SELECT count(*)::int FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE c.starts_at >= $1 AND c.starts_at < $2 AND NOT c.cancelled AND b.status IN {SEAT_STATUSES}"
    ))
    .bind(prev_start)
    .bind(prev_end)
    .fetch_one(&state.db)
    .await?;
    let (waitlist,): (i32,) = sqlx::query_as(
        "SELECT count(*)::int FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE b.status = 'waitlist' AND c.starts_at > now()",
    )
    .fetch_one(&state.db)
    .await?;
    let (cancellations,): (i32,) = sqlx::query_as(
        "SELECT count(*)::int FROM bookings b
         WHERE b.status IN ('cancelled','late_cancel') AND b.updated_at >= $1 AND b.updated_at < $2
           AND NOT EXISTS (SELECT 1 FROM bookings n WHERE n.rescheduled_from = b.id)",
    )
    .bind(start)
    .bind(end)
    .fetch_one(&state.db)
    .await?;
    let (revenue,): (i64,) = sqlx::query_as(
        "SELECT coalesce(sum(price), 0)::bigint FROM student_plans WHERE created_at >= $1 AND created_at < $2",
    )
    .bind(start)
    .bind(end)
    .fetch_one(&state.db)
    .await?;

    // Alertas
    let soon = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.starts_at > now() AND c.starts_at <= now() + interval '2 hours' AND NOT c.cancelled ORDER BY c.starts_at",
        class_select()
    ))
    .bind(None::<i64>)
    .fetch_all(&state.db)
    .await?;
    let resets: Vec<(i64, i64, String, Option<i64>, Option<String>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT r.id, u.id, u.email, s.id, s.name, r.created_at
         FROM password_reset_requests r JOIN users u ON u.id = r.user_id
         LEFT JOIN students s ON s.user_id = u.id
         WHERE r.resolved_at IS NULL ORDER BY r.created_at",
    )
    .fetch_all(&state.db)
    .await?;
    let low_plans: Vec<(i64, String, String, i32, NaiveDate)> = sqlx::query_as(&format!(
        "SELECT s.id, s.name, sp.name, (sp.total_classes - u.used)::int AS remaining, sp.ends_on
         FROM students s
         JOIN users us ON us.id = s.user_id AND us.active
         JOIN LATERAL (
            SELECT * FROM student_plans p WHERE p.student_id = s.id AND p.starts_on <= $1 AND p.ends_on >= $1
            ORDER BY p.ends_on DESC LIMIT 1
         ) sp ON TRUE
         CROSS JOIN LATERAL (
            SELECT count(*)::int AS used FROM bookings b
            WHERE b.student_plan_id = sp.id AND b.status IN {}
         ) u
         WHERE (sp.total_classes - u.used) <= 2 OR sp.ends_on <= $1 + 5
         ORDER BY sp.ends_on LIMIT 20",
        crate::models::CONSUMING_STATUSES
    ))
    .bind(day)
    .fetch_all(&state.db)
    .await?;

    // Estudiantes activos que nunca han tenido plan (p. ej. registrados con enlace de invitación).
    let without_plan: Vec<(i64, String, NaiveDate, bool)> = sqlx::query_as(
        "SELECT s.id, s.name, s.joined_on, (s.invite_id IS NOT NULL) FROM students s
         JOIN users u ON u.id = s.user_id AND u.active
         WHERE NOT EXISTS (SELECT 1 FROM student_plans p WHERE p.student_id = s.id)
         ORDER BY s.created_at DESC LIMIT 20",
    )
    .fetch_all(&state.db)
    .await?;

    let delta_pct = if bookings_prev > 0 {
        Some((((bookings_today - bookings_prev) as f64 / bookings_prev as f64) * 100.0).round() as i32)
    } else {
        None
    };

    Ok(Json(json!({
        "date": day,
        "kpis": {
            "classes_today": active.len(),
            "bookings_today": bookings_today,
            "bookings_delta_pct": delta_pct,
            "occupancy_pct": if capacity_today > 0 { (bookings_today as f64 / capacity_today as f64 * 100.0).round() as i32 } else { 0 },
            "waitlist": waitlist,
            "cancellations_today": cancellations,
            "revenue_today": revenue,
        },
        "classes": classes,
        "alerts": {
            "soon": soon,
            "password_resets": resets.into_iter().map(|(id, user_id, email, student_id, name, created_at)| json!({
                "id": id, "user_id": user_id, "email": email, "student_id": student_id, "name": name, "created_at": created_at,
            })).collect::<Vec<_>>(),
            "without_plan": without_plan.into_iter().map(|(student_id, name, joined_on, invited)| json!({
                "student_id": student_id, "name": name, "joined_on": joined_on, "invited": invited,
            })).collect::<Vec<_>>(),
            "low_plans": low_plans.into_iter().map(|(student_id, name, plan, remaining, ends_on)| json!({
                "student_id": student_id, "name": name, "plan": plan, "remaining": remaining, "ends_on": ends_on,
            })).collect::<Vec<_>>(),
        },
    })))
}
