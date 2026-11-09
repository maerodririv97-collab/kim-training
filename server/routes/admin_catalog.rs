//! Catálogos: planes y promociones.

use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::Admin;
use crate::error::{ApiResult, AppError};
use crate::time::parse_date;
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/plans", get(list_plans).post(create_plan))
        .route("/plans/{id}", put(update_plan))
        .route("/promotions", get(list_promotions).post(create_promotion))
        .route("/promotions/{id}", put(update_promotion))
        .route("/password-resets/{id}/dismiss", post(dismiss_reset))
}

fn yes() -> bool {
    true
}

#[derive(Debug, Serialize, FromRow)]
struct PlanRow {
    id: i64,
    name: String,
    total_classes: i32,
    duration_days: i32,
    price: i64,
    active: bool,
    active_students: i32,
    implement_ids: Vec<i64>,
}

async fn list_plans(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Vec<PlanRow>>> {
    Ok(Json(
        sqlx::query_as::<_, PlanRow>(
            "SELECT p.id, p.name, p.total_classes, p.duration_days, p.price, p.active,
                    (SELECT count(DISTINCT sp.student_id) FROM student_plans sp
                     WHERE sp.plan_id = p.id AND CURRENT_DATE BETWEEN sp.starts_on AND sp.ends_on)::int AS active_students,
                    coalesce((SELECT array_agg(pi.implement_id ORDER BY pi.implement_id) FROM plan_implements pi
                              WHERE pi.plan_id = p.id), '{}') AS implement_ids
             FROM plans p ORDER BY p.active DESC, p.price",
        )
        .fetch_all(&state.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct PlanBody {
    name: String,
    total_classes: i32,
    duration_days: i32,
    price: i64,
    #[serde(default = "yes")]
    active: bool,
    /// Implementos incluidos en el plan: cada reserva hecha con él aparta una unidad.
    #[serde(default)]
    implement_ids: Vec<i64>,
}

async fn save_plan_implements(tx: &mut sqlx::PgConnection, id: i64, ids: &[i64]) -> ApiResult<()> {
    sqlx::query("DELETE FROM plan_implements WHERE plan_id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO plan_implements (plan_id, implement_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

fn validate_plan(b: &PlanBody) -> ApiResult<()> {
    if b.name.trim().is_empty() {
        return Err(AppError::bad_request("El nombre es obligatorio"));
    }
    if !(1..=500).contains(&b.total_classes) || !(1..=730).contains(&b.duration_days) || b.price < 0 {
        return Err(AppError::bad_request("Revisa clases (1-500), duración (1-730 días) y precio"));
    }
    Ok(())
}

async fn create_plan(State(state): State<AppState>, _: Admin, Json(b): Json<PlanBody>) -> ApiResult<Json<Value>> {
    validate_plan(&b)?;
    let mut tx = state.db.begin().await?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO plans (name, total_classes, duration_days, price, active) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(b.name.trim())
    .bind(b.total_classes)
    .bind(b.duration_days)
    .bind(b.price)
    .bind(b.active)
    .fetch_one(&mut *tx)
    .await?;
    save_plan_implements(&mut tx, id, &b.implement_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

async fn update_plan(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(b): Json<PlanBody>) -> ApiResult<Json<Value>> {
    validate_plan(&b)?;
    let mut tx = state.db.begin().await?;
    let res = sqlx::query("UPDATE plans SET name = $2, total_classes = $3, duration_days = $4, price = $5, active = $6 WHERE id = $1")
        .bind(id)
        .bind(b.name.trim())
        .bind(b.total_classes)
        .bind(b.duration_days)
        .bind(b.price)
        .bind(b.active)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("El plan no existe"));
    }
    // Solo afecta asignaciones futuras: los planes ya asignados conservan su copia de implementos.
    save_plan_implements(&mut tx, id, &b.implement_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Serialize, FromRow)]
struct PromotionRow {
    id: i64,
    badge: String,
    title: String,
    description: String,
    style: String,
    expires_on: Option<NaiveDate>,
    active: bool,
    discipline_ids: Vec<i64>,
}

async fn list_promotions(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Vec<PromotionRow>>> {
    Ok(Json(
        sqlx::query_as::<_, PromotionRow>(
            "SELECT p.id, p.badge, p.title, p.description, p.style, p.expires_on, p.active,
                    coalesce((SELECT array_agg(pd.discipline_id) FROM promotion_disciplines pd WHERE pd.promotion_id = p.id), '{}') AS discipline_ids
             FROM promotions p ORDER BY p.active DESC, p.created_at DESC",
        )
        .fetch_all(&state.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct PromotionBody {
    badge: String,
    title: String,
    #[serde(default)]
    description: String,
    style: String,
    expires_on: Option<String>,
    #[serde(default = "yes")]
    active: bool,
    #[serde(default)]
    discipline_ids: Vec<i64>,
}

fn validate_promotion(b: &PromotionBody) -> ApiResult<Option<NaiveDate>> {
    if b.badge.trim().is_empty() || b.title.trim().is_empty() {
        return Err(AppError::bad_request("Etiqueta y título son obligatorios"));
    }
    if !["promo-1", "promo-2", "promo-3"].contains(&b.style.as_str()) {
        return Err(AppError::bad_request("Estilo inválido"));
    }
    b.expires_on.as_deref().filter(|d| !d.is_empty()).map(parse_date).transpose()
}

async fn save_promotion_disciplines(tx: &mut sqlx::PgConnection, id: i64, ids: &[i64]) -> ApiResult<()> {
    sqlx::query("DELETE FROM promotion_disciplines WHERE promotion_id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO promotion_disciplines (promotion_id, discipline_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn create_promotion(State(state): State<AppState>, _: Admin, Json(b): Json<PromotionBody>) -> ApiResult<Json<Value>> {
    let expires = validate_promotion(&b)?;
    let mut tx = state.db.begin().await?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO promotions (badge, title, description, style, expires_on, active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(b.badge.trim())
    .bind(b.title.trim())
    .bind(b.description.trim())
    .bind(&b.style)
    .bind(expires)
    .bind(b.active)
    .fetch_one(&mut *tx)
    .await?;
    save_promotion_disciplines(&mut tx, id, &b.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

async fn update_promotion(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(b): Json<PromotionBody>) -> ApiResult<Json<Value>> {
    let expires = validate_promotion(&b)?;
    let mut tx = state.db.begin().await?;
    let res = sqlx::query(
        "UPDATE promotions SET badge = $2, title = $3, description = $4, style = $5, expires_on = $6, active = $7 WHERE id = $1",
    )
    .bind(id)
    .bind(b.badge.trim())
    .bind(b.title.trim())
    .bind(b.description.trim())
    .bind(&b.style)
    .bind(expires)
    .bind(b.active)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("La promoción no existe"));
    }
    save_promotion_disciplines(&mut tx, id, &b.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn dismiss_reset(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    sqlx::query("UPDATE password_reset_requests SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
