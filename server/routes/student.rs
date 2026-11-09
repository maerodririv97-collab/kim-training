//! Rutas del estudiante (/api/me/*).

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::Student;
use crate::booking::{self, BookingResult, CancelResult, WaitlistResult};
use crate::error::{ApiResult, AppError};
use crate::models::{ClassItem, DisciplineRef, PlanStatus, class_select, current_plan, initials, plan_status_select};
use crate::time::{local_range, parse_date, today};
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/me/overview", get(overview))
        .route("/me/agenda", get(agenda))
        .route("/me/classes/{id}", get(class_detail))
        .route("/me/bookings", get(list_bookings).post(create_booking))
        .route("/me/waitlist", post(join_waitlist))
        .route("/me/bookings/{id}/cancel", post(cancel_booking))
        .route("/me/bookings/{id}/reschedule", post(reschedule_booking))
        .route("/me/bookings/{id}/reschedule-options", get(reschedule_options))
        .route("/me/progress", get(progress))
        .route("/me/profile", get(profile).put(update_profile))
}

async fn enabled_disciplines(state: &AppState, student_id: i64) -> ApiResult<Vec<DisciplineRef>> {
    Ok(sqlx::query_as::<_, DisciplineRef>(
        "SELECT d.id, d.name, d.color FROM student_disciplines sd
         JOIN disciplines d ON d.id = sd.discipline_id
         WHERE sd.student_id = $1 AND d.active ORDER BY d.name",
    )
    .bind(student_id)
    .fetch_all(&state.db)
    .await?)
}

async fn overview(State(state): State<AppState>, me: Student) -> ApiResult<Json<Value>> {
    booking::expire_waitlists(&state.db).await?;
    let tz = &state.cfg.tz;
    let (name,): (String,) = sqlx::query_as("SELECT name FROM students WHERE id = $1")
        .bind(me.student_id)
        .fetch_one(&state.db)
        .await?;
    let upcoming = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE mb.status IN ('booked','waitlist') AND c.starts_at > now() AND NOT c.cancelled
         ORDER BY c.starts_at LIMIT 10",
        class_select()
    ))
    .bind(me.student_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "student": { "id": me.student_id, "name": name, "initials": initials(&name) },
        "today": today(tz),
        "disciplines": enabled_disciplines(&state, me.student_id).await?,
        "plan": current_plan(&state.db, me.student_id, today(tz)).await?,
        "upcoming": upcoming,
    })))
}

#[derive(Deserialize)]
struct RangeQuery {
    from: Option<String>,
    to: Option<String>,
}

/// Clases futuras de las disciplinas habilitadas del estudiante en un rango de fechas locales.
async fn agenda(State(state): State<AppState>, me: Student, Query(q): Query<RangeQuery>) -> ApiResult<Json<Vec<ClassItem>>> {
    booking::expire_waitlists(&state.db).await?;
    let tz = &state.cfg.tz;
    let from = q.from.as_deref().map(parse_date).transpose()?.unwrap_or_else(|| today(tz));
    let to = q.to.as_deref().map(parse_date).transpose()?.unwrap_or(from + Duration::days(13));
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::bad_request("Rango de fechas inválido (máximo 62 días)"));
    }
    let (start, end) = local_range(tz, from, to)?;
    let rows = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.starts_at >= GREATEST($2, now()) AND c.starts_at < $3 AND NOT c.cancelled
           AND c.discipline_id IN (SELECT discipline_id FROM student_disciplines WHERE student_id = $1)
         ORDER BY c.starts_at",
        class_select()
    ))
    .bind(me.student_id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

async fn class_detail(State(state): State<AppState>, me: Student, Path(id): Path<i64>) -> ApiResult<Json<ClassItem>> {
    let row = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.id = $2
           AND c.discipline_id IN (SELECT discipline_id FROM student_disciplines WHERE student_id = $1)",
        class_select()
    ))
    .bind(me.student_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("La clase no existe"))?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, FromRow)]
struct BookingItem {
    booking_id: i64,
    status: String,
    rescheduled: bool,
    class_id: i64,
    discipline: String,
    color: String,
    teacher: String,
    starts_at: DateTime<Utc>,
    duration_min: i32,
    location: String,
    level: String,
    class_cancelled: bool,
}

#[derive(Deserialize)]
struct TabQuery {
    tab: Option<String>,
}

async fn list_bookings(State(state): State<AppState>, me: Student, Query(q): Query<TabQuery>) -> ApiResult<Json<Vec<BookingItem>>> {
    booking::expire_waitlists(&state.db).await?;
    let (filter, order) = match q.tab.as_deref().unwrap_or("proximas") {
        "proximas" => ("b.status IN ('booked','waitlist') AND c.starts_at > now() AND NOT c.cancelled", "c.starts_at ASC"),
        "realizadas" => ("(b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now() AND NOT c.cancelled))", "c.starts_at DESC"),
        "canceladas" => ("(b.status IN ('cancelled','late_cancel') OR (c.cancelled AND b.status <> 'expired'))", "c.starts_at DESC"),
        "noasistidas" => ("b.status = 'noshow'", "c.starts_at DESC"),
        _ => return Err(AppError::bad_request("Pestaña inválida")),
    };
    let rows = sqlx::query_as::<_, BookingItem>(&format!(
        "SELECT b.id AS booking_id, b.status,
                EXISTS (SELECT 1 FROM bookings n WHERE n.rescheduled_from = b.id) AS rescheduled,
                c.id AS class_id, d.name AS discipline, d.color, t.name AS teacher, c.starts_at, c.duration_min,
                c.location, c.level, c.cancelled AS class_cancelled
         FROM bookings b
         JOIN classes c ON c.id = b.class_id
         JOIN disciplines d ON d.id = c.discipline_id
         JOIN teachers t ON t.id = c.teacher_id
         WHERE b.student_id = $1 AND {filter}
           AND c.discipline_id IN (SELECT discipline_id FROM student_disciplines WHERE student_id = $1)
         ORDER BY {order} LIMIT 100"
    ))
    .bind(me.student_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct ClassIdBody {
    class_id: i64,
}

async fn create_booking(State(state): State<AppState>, me: Student, Json(body): Json<ClassIdBody>) -> ApiResult<Json<BookingResult>> {
    Ok(Json(booking::book(&state.db, &state.cfg.tz, me.student_id, body.class_id).await?))
}

async fn join_waitlist(State(state): State<AppState>, me: Student, Json(body): Json<ClassIdBody>) -> ApiResult<Json<WaitlistResult>> {
    Ok(Json(booking::join_waitlist(&state.db, &state.cfg.tz, me.student_id, body.class_id).await?))
}

async fn cancel_booking(State(state): State<AppState>, me: Student, Path(id): Path<i64>) -> ApiResult<Json<CancelResult>> {
    Ok(Json(booking::cancel(&state.db, &state.cfg.tz, me.student_id, id).await?))
}

async fn reschedule_booking(
    State(state): State<AppState>,
    me: Student,
    Path(id): Path<i64>,
    Json(body): Json<ClassIdBody>,
) -> ApiResult<Json<BookingResult>> {
    Ok(Json(booking::reschedule(&state.db, &state.cfg.tz, me.student_id, id, body.class_id).await?))
}

/// Horarios alternativos de la misma disciplina en los próximos 14 días donde el estudiante no tiene reserva.
async fn reschedule_options(State(state): State<AppState>, me: Student, Path(id): Path<i64>) -> ApiResult<Json<Vec<ClassItem>>> {
    let (class_id, discipline_id): (i64, i64) = sqlx::query_as(
        "SELECT c.id, c.discipline_id FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE b.id = $1 AND b.student_id = $2",
    )
    .bind(id)
    .bind(me.student_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("La reserva no existe"))?;
    let rows = sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.discipline_id = $2 AND c.id <> $3 AND NOT c.cancelled
           AND c.starts_at > now() AND c.starts_at < now() + interval '14 days'
           AND mb.id IS NULL
         ORDER BY c.starts_at LIMIT 30",
        class_select()
    ))
    .bind(me.student_id)
    .bind(discipline_id)
    .bind(class_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, FromRow)]
struct DisciplineStat {
    id: i64,
    name: String,
    color: String,
    enabled_on: NaiveDate,
    classes: i32,
    noshow: i32,
    first_class: Option<DateTime<Utc>>,
}

async fn discipline_stats(state: &AppState, student_id: i64) -> ApiResult<Vec<DisciplineStat>> {
    Ok(sqlx::query_as::<_, DisciplineStat>(
        "SELECT d.id, d.name, d.color, sd.enabled_on,
                coalesce(x.classes, 0) AS classes, coalesce(x.noshow, 0) AS noshow, x.first_class
         FROM student_disciplines sd
         JOIN disciplines d ON d.id = sd.discipline_id
         LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))::int AS classes,
                   count(*) FILTER (WHERE b.status = 'noshow')::int AS noshow,
                   min(c.starts_at) FILTER (WHERE b.status IN ('attended','booked') AND c.starts_at <= now()) AS first_class
            FROM bookings b JOIN classes c ON c.id = b.class_id
            WHERE b.student_id = sd.student_id AND c.discipline_id = sd.discipline_id AND NOT c.cancelled
         ) x ON TRUE
         WHERE sd.student_id = $1 AND d.active
         ORDER BY d.name",
    )
    .bind(student_id)
    .fetch_all(&state.db)
    .await?)
}

async fn progress(State(state): State<AppState>, me: Student) -> ApiResult<Json<Value>> {
    let tz_name = &state.cfg.tz_name;
    let (joined_on, goal): (NaiveDate, Option<String>) =
        sqlx::query_as("SELECT joined_on, goal FROM students WHERE id = $1")
            .bind(me.student_id)
            .fetch_one(&state.db)
            .await?;
    let (attended, noshow): (i32, i32) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))::int,
                count(*) FILTER (WHERE b.status = 'noshow')::int
         FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE b.student_id = $1 AND NOT c.cancelled",
    )
    .bind(me.student_id)
    .fetch_one(&state.db)
    .await?;
    let monthly: Vec<(String, i32)> = sqlx::query_as(
        "SELECT to_char(m, 'YYYY-MM') AS month, coalesce(x.n, 0)::int
         FROM generate_series(date_trunc('month', (now() AT TIME ZONE $2)) - interval '11 months',
                              date_trunc('month', (now() AT TIME ZONE $2)), interval '1 month') m
         LEFT JOIN (
            SELECT date_trunc('month', c.starts_at AT TIME ZONE $2) AS mon, count(*) AS n
            FROM bookings b JOIN classes c ON c.id = b.class_id
            WHERE b.student_id = $1 AND NOT c.cancelled
              AND (b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))
            GROUP BY 1
         ) x ON x.mon = m
         ORDER BY m",
    )
    .bind(me.student_id)
    .bind(tz_name)
    .fetch_all(&state.db)
    .await?;
    let today = today(&state.cfg.tz);
    let months_active = ((today - joined_on).num_days() / 30).max(1);
    let disciplines = discipline_stats(&state, me.student_id).await?;
    Ok(Json(json!({
        "attended": attended,
        "noshow": noshow,
        "attendance_pct": pct(attended, attended + noshow),
        "months_active": months_active,
        "disciplines_count": disciplines.len(),
        "monthly": monthly.into_iter().map(|(month, count)| json!({ "month": month, "count": count })).collect::<Vec<_>>(),
        "disciplines": disciplines.iter().map(stat_json).collect::<Vec<_>>(),
        "goal": goal,
    })))
}

fn pct(part: i32, total: i32) -> i32 {
    if total <= 0 { 0 } else { ((part as f64 / total as f64) * 100.0).round() as i32 }
}

fn stat_json(s: &DisciplineStat) -> Value {
    json!({
        "id": s.id, "name": s.name, "color": s.color,
        "classes": s.classes, "attendance_pct": pct(s.classes, s.classes + s.noshow),
        "since": s.first_class.map(|d| d.date_naive()).unwrap_or(s.enabled_on),
    })
}

#[derive(Debug, Serialize, FromRow)]
struct StudentProfileRow {
    name: String,
    email: String,
    phone: Option<String>,
    birth_date: Option<NaiveDate>,
    joined_on: NaiveDate,
    weight_kg: Option<f64>,
    height_m: Option<f64>,
    level: Option<String>,
    restrictions: Option<String>,
    goal: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct PromotionRow {
    id: i64,
    badge: String,
    title: String,
    description: String,
    style: String,
    expires_on: Option<NaiveDate>,
}

async fn profile(State(state): State<AppState>, me: Student) -> ApiResult<Json<Value>> {
    let today = today(&state.cfg.tz);
    let info = sqlx::query_as::<_, StudentProfileRow>(
        "SELECT s.name, u.email, s.phone, s.birth_date, s.joined_on, s.weight_kg::float8 AS weight_kg,
                s.height_m::float8 AS height_m, s.level, s.restrictions, s.goal
         FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
    )
    .bind(me.student_id)
    .fetch_one(&state.db)
    .await?;
    let plans = sqlx::query_as::<_, PlanStatus>(&format!(
        "{} WHERE sp.student_id = $1 ORDER BY sp.starts_on DESC, sp.id DESC LIMIT 24",
        plan_status_select()
    ))
    .bind(me.student_id)
    .fetch_all(&state.db)
    .await?;
    let promotions = sqlx::query_as::<_, PromotionRow>(
        "SELECT p.id, p.badge, p.title, p.description, p.style, p.expires_on FROM promotions p
         WHERE p.active AND (p.expires_on IS NULL OR p.expires_on >= $2)
           AND (NOT EXISTS (SELECT 1 FROM promotion_disciplines pd WHERE pd.promotion_id = p.id)
                OR EXISTS (SELECT 1 FROM promotion_disciplines pd
                           JOIN student_disciplines sd ON sd.discipline_id = pd.discipline_id
                           WHERE pd.promotion_id = p.id AND sd.student_id = $1))
         ORDER BY p.created_at DESC",
    )
    .bind(me.student_id)
    .bind(today)
    .fetch_all(&state.db)
    .await?;
    let disciplines = discipline_stats(&state, me.student_id).await?;
    let plans_json: Vec<Value> = plans
        .iter()
        .map(|p| {
            let status = if p.starts_on > today {
                "Programado"
            } else if p.ends_on >= today {
                "Activo"
            } else {
                "Finalizado"
            };
            json!({ "plan": p, "status": status })
        })
        .collect();
    Ok(Json(json!({
        "initials": initials(&info.name),
        "info": info,
        "plan": current_plan(&state.db, me.student_id, today).await?,
        "plans": plans_json,
        "disciplines": disciplines.iter().map(stat_json).collect::<Vec<_>>(),
        "promotions": promotions,
    })))
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    name: String,
    phone: Option<String>,
    birth_date: Option<String>,
    goal: Option<String>,
    weight_kg: Option<f64>,
    height_m: Option<f64>,
    level: Option<String>,
    restrictions: Option<String>,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// El estudiante actualiza su información personal y física.
/// No puede cambiar correo, estado, disciplinas, planes ni las observaciones internas del estudio.
async fn update_profile(State(state): State<AppState>, me: Student, Json(b): Json<UpdateProfileBody>) -> ApiResult<Json<Value>> {
    let name = b.name.trim();
    if name.chars().count() < 3 {
        return Err(AppError::bad_request("Escribe tu nombre completo"));
    }
    let birth = clean(b.birth_date).as_deref().map(parse_date).transpose()?;
    if let Some(d) = birth {
        if d > today(&state.cfg.tz) - Duration::days(365 * 5) || d.year() < 1900 {
            return Err(AppError::bad_request("Revisa tu fecha de nacimiento"));
        }
    }
    if matches!(b.weight_kg, Some(w) if !(20.0..=300.0).contains(&w)) {
        return Err(AppError::bad_request("El peso debe estar entre 20 y 300 kg"));
    }
    if matches!(b.height_m, Some(h) if !(0.8..=2.5).contains(&h)) {
        return Err(AppError::bad_request("La altura debe estar entre 0.80 y 2.50 m"));
    }
    let level = clean(b.level);
    if let Some(l) = level.as_deref() {
        if !["Principiante", "Intermedio", "Avanzado"].contains(&l) {
            return Err(AppError::bad_request("Nivel inválido"));
        }
    }
    sqlx::query(
        "UPDATE students SET name = $2, phone = $3, birth_date = $4, goal = $5,
                weight_kg = $6, height_m = $7, level = $8, restrictions = $9
         WHERE id = $1",
    )
    .bind(me.student_id)
    .bind(name)
    .bind(clean(b.phone))
    .bind(birth)
    .bind(clean(b.goal))
    .bind(b.weight_kg)
    .bind(b.height_m)
    .bind(level)
    .bind(clean(b.restrictions))
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}
