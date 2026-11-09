//! Implementos que el estudio presta o alquila dentro de las clases (ej. motos de spinning).
//!
//! Un implemento tiene una cantidad de unidades compartida entre todas las clases que se cruzan
//! en el horario. Los planes que lo incluyen apartan una unidad en cada reserva (ver `booking.rs`).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::Admin;
use crate::error::{ApiResult, AppError};
use crate::models::{SEAT_STATUSES, implement_applies, implement_used_sql};
use crate::time::{local_range, parse_date, today};
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/implements", get(list_implements).post(create_implement))
        .route("/implements/{id}", put(update_implement).delete(delete_implement))
        .route("/implements/{id}/schedule", get(schedule))
}

const KINDS: [&str; 2] = ["loan", "rent"];
/// Días hacia adelante para el pico de uso que se muestra en el listado.
const PEAK_DAYS: i64 = 7;

fn yes() -> bool {
    true
}

#[derive(Debug, Serialize, FromRow)]
struct ImplementRow {
    id: i64,
    name: String,
    description: String,
    kind: String,
    quantity: i32,
    active: bool,
    created_at: DateTime<Utc>,
    /// Disciplinas donde se usa (vacío = todas).
    discipline_ids: Vec<i64>,
    /// Planes del catálogo que lo incluyen.
    plan_ids: Vec<i64>,
    /// Estudiantes con un plan vigente hoy que lo incluye.
    active_students: i32,
    /// Unidades apartadas en clases futuras (suma de todas las clases).
    upcoming_reserved: i32,
    /// Máximo de unidades ocupadas a la vez en un horario de los próximos días.
    peak_used: i32,
}

async fn list_implements(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Vec<ImplementRow>>> {
    let rows = sqlx::query_as::<_, ImplementRow>(&format!(
        "SELECT i.id, i.name, i.description, i.kind, i.quantity, i.active, i.created_at,
                coalesce((SELECT array_agg(x.discipline_id ORDER BY x.discipline_id) FROM implement_disciplines x
                          WHERE x.implement_id = i.id), '{{}}') AS discipline_ids,
                coalesce((SELECT array_agg(pi.plan_id ORDER BY pi.plan_id) FROM plan_implements pi
                          WHERE pi.implement_id = i.id), '{{}}') AS plan_ids,
                (SELECT count(DISTINCT sp.student_id) FROM student_plans sp
                 JOIN student_plan_implements spi ON spi.student_plan_id = sp.id
                 WHERE spi.implement_id = i.id AND CURRENT_DATE BETWEEN sp.starts_on AND sp.ends_on)::int AS active_students,
                (SELECT count(*) FROM booking_implements bi
                 JOIN bookings b ON b.id = bi.booking_id AND b.status IN {SEAT_STATUSES}
                 JOIN classes c ON c.id = b.class_id AND NOT c.cancelled
                 WHERE bi.implement_id = i.id AND c.starts_at > now())::int AS upcoming_reserved,
                coalesce((SELECT max({used}) FROM classes c
                          WHERE NOT c.cancelled AND c.starts_at > now() AND c.starts_at < now() + interval '{PEAK_DAYS} days'
                            AND {applies}), 0)::int AS peak_used
         FROM implements i
         ORDER BY i.active DESC, lower(i.name)",
        used = implement_used_sql(),
        applies = implement_applies("c.discipline_id"),
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct ImplementBody {
    name: String,
    #[serde(default)]
    description: String,
    kind: String,
    quantity: i32,
    #[serde(default = "yes")]
    active: bool,
    #[serde(default)]
    discipline_ids: Vec<i64>,
}

fn validate(b: &ImplementBody) -> ApiResult<()> {
    let name = b.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::bad_request("El nombre es obligatorio (máximo 60 caracteres)"));
    }
    if b.description.trim().chars().count() > 300 {
        return Err(AppError::bad_request("La descripción admite máximo 300 caracteres"));
    }
    if !KINDS.contains(&b.kind.as_str()) {
        return Err(AppError::bad_request("El tipo debe ser préstamo o alquiler"));
    }
    if !(0..=1000).contains(&b.quantity) {
        return Err(AppError::bad_request("La cantidad debe estar entre 0 y 1000"));
    }
    Ok(())
}

fn duplicate_name(e: AppError) -> AppError {
    if e.code == "duplicate" { AppError::conflict("duplicate", "Ya existe un implemento con ese nombre") } else { e }
}

async fn save_disciplines(tx: &mut sqlx::PgConnection, id: i64, ids: &[i64]) -> ApiResult<()> {
    sqlx::query("DELETE FROM implement_disciplines WHERE implement_id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO implement_disciplines (implement_id, discipline_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn create_implement(State(state): State<AppState>, _: Admin, Json(b): Json<ImplementBody>) -> ApiResult<Json<Value>> {
    validate(&b)?;
    let mut tx = state.db.begin().await?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO implements (name, description, kind, quantity, active) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(b.name.trim())
    .bind(b.description.trim())
    .bind(&b.kind)
    .bind(b.quantity)
    .bind(b.active)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| duplicate_name(e.into()))?;
    save_disciplines(&mut tx, id, &b.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

/// Si se reduce la cantidad por debajo de lo ya apartado, las reservas existentes se respetan
/// y solo se bloquean reservas nuevas hasta que se liberen unidades.
async fn update_implement(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(b): Json<ImplementBody>) -> ApiResult<Json<Value>> {
    validate(&b)?;
    let mut tx = state.db.begin().await?;
    // El UPDATE bloquea la fila igual que una reserva en curso, así que no cambia el inventario a mitad de una.
    let res = sqlx::query(
        "UPDATE implements SET name = $2, description = $3, kind = $4, quantity = $5, active = $6 WHERE id = $1",
    )
    .bind(id)
    .bind(b.name.trim())
    .bind(b.description.trim())
    .bind(&b.kind)
    .bind(b.quantity)
    .bind(b.active)
    .execute(&mut *tx)
    .await
    .map_err(|e| duplicate_name(e.into()))?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("El implemento no existe"));
    }
    save_disciplines(&mut tx, id, &b.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

/// Solo se elimina si nunca se ha asignado; si tiene historial, se debe desactivar.
async fn delete_implement(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let (used,): (bool,) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM booking_implements WHERE implement_id = $1)
             OR EXISTS (SELECT 1 FROM student_plan_implements WHERE implement_id = $1)",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if used {
        return Err(AppError::conflict(
            "in_use",
            "Este implemento ya se asignó a estudiantes o reservas. Desactívalo para conservar el historial.",
        ));
    }
    let res = sqlx::query("DELETE FROM implements WHERE id = $1").bind(id).execute(&mut *tx).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("El implemento no existe"));
    }
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ScheduleQuery {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct ScheduleRow {
    class_id: i64,
    discipline: String,
    color: String,
    teacher: String,
    starts_at: DateTime<Utc>,
    duration_min: i32,
    location: String,
    capacity: i32,
    booked: i32,
    /// Unidades apartadas en esta clase.
    in_class: i32,
    /// Unidades ocupadas en el horario (esta clase y las que se cruzan con ella).
    used: i32,
    available: i32,
}

/// Disponibilidad del implemento clase por clase en un rango de fechas (por defecto, los próximos 7 días).
async fn schedule(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Query(q): Query<ScheduleQuery>) -> ApiResult<Json<Value>> {
    let tz = &state.cfg.tz;
    let from = q.from.as_deref().map(parse_date).transpose()?.unwrap_or_else(|| today(tz));
    let to = q.to.as_deref().map(parse_date).transpose()?.unwrap_or(from + Duration::days(6));
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::bad_request("Rango de fechas inválido (máximo 62 días)"));
    }
    let (start, end) = local_range(tz, from, to)?;
    let (name, quantity, active): (String, i32, bool) =
        sqlx::query_as("SELECT name, quantity, active FROM implements WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("El implemento no existe"))?;
    let classes = sqlx::query_as::<_, ScheduleRow>(&format!(
        "SELECT c.id AS class_id, d.name AS discipline, d.color, t.name AS teacher, c.starts_at, c.duration_min,
                c.location, c.capacity,
                (SELECT count(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN {SEAT_STATUSES})::int AS booked,
                (SELECT count(*) FROM booking_implements bi JOIN bookings b ON b.id = bi.booking_id
                 WHERE bi.implement_id = i.id AND b.class_id = c.id AND b.status IN {SEAT_STATUSES})::int AS in_class,
                u.used, greatest(i.quantity - u.used, 0) AS available
         FROM implements i
         JOIN classes c ON NOT c.cancelled AND c.starts_at >= $2 AND c.starts_at < $3
         JOIN disciplines d ON d.id = c.discipline_id
         JOIN teachers t ON t.id = c.teacher_id
         CROSS JOIN LATERAL (SELECT {used} AS used) u
         WHERE i.id = $1 AND {applies}
         ORDER BY c.starts_at",
        used = implement_used_sql(),
        applies = implement_applies("c.discipline_id"),
    ))
    .bind(id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "implement": { "id": id, "name": name, "quantity": quantity, "active": active },
        "from": from,
        "to": to,
        "classes": classes,
    })))
}
