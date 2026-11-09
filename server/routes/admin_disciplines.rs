//! Módulo de disciplinas (modalidades / deportes).

use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::{Admin, AuthUser};
use crate::error::{ApiResult, AppError};
use crate::models::DISCIPLINE_COLORS;
use crate::{AppRouter, AppState};

/// Lista básica para cualquier usuario autenticado (selectores, filtros).
pub fn public_routes() -> AppRouter {
    Router::new().route("/disciplines", get(list_disciplines))
}

pub fn routes() -> AppRouter {
    Router::new()
        .route("/disciplines", get(list_with_stats).post(create_discipline))
        .route("/disciplines/{id}", put(update_discipline).delete(delete_discipline))
}

#[derive(Debug, Serialize, FromRow)]
struct DisciplineRow {
    id: i64,
    name: String,
    color: String,
    description: String,
    active: bool,
}

async fn list_disciplines(State(state): State<AppState>, _: AuthUser) -> ApiResult<Json<Vec<DisciplineRow>>> {
    Ok(Json(
        sqlx::query_as::<_, DisciplineRow>("SELECT id, name, color, description, active FROM disciplines ORDER BY name")
            .fetch_all(&state.db)
            .await?,
    ))
}

#[derive(Debug, Serialize, FromRow)]
struct DisciplineStatsRow {
    id: i64,
    name: String,
    color: String,
    description: String,
    active: bool,
    created_at: DateTime<Utc>,
    teachers: i32,
    students: i32,
    upcoming_classes: i32,
    total_classes: i32,
}

async fn list_with_stats(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Vec<DisciplineStatsRow>>> {
    Ok(Json(
        sqlx::query_as::<_, DisciplineStatsRow>(
            "SELECT d.id, d.name, d.color, d.description, d.active, d.created_at,
                    (SELECT count(*) FROM teacher_disciplines td JOIN teachers t ON t.id = td.teacher_id
                     WHERE td.discipline_id = d.id AND t.active)::int AS teachers,
                    (SELECT count(*) FROM student_disciplines sd JOIN students s ON s.id = sd.student_id
                     JOIN users u ON u.id = s.user_id WHERE sd.discipline_id = d.id AND u.active)::int AS students,
                    (SELECT count(*) FROM classes c WHERE c.discipline_id = d.id AND NOT c.cancelled AND c.starts_at > now())::int AS upcoming_classes,
                    (SELECT count(*) FROM classes c WHERE c.discipline_id = d.id)::int AS total_classes
             FROM disciplines d
             ORDER BY d.active DESC, d.name",
        )
        .fetch_all(&state.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct DisciplineBody {
    name: String,
    color: String,
    #[serde(default)]
    description: String,
    #[serde(default = "yes")]
    active: bool,
}

fn yes() -> bool {
    true
}

fn validate(b: &DisciplineBody) -> ApiResult<()> {
    let name = b.name.trim();
    if name.is_empty() {
        return Err(AppError::bad_request("El nombre es obligatorio"));
    }
    if name.chars().count() > 40 {
        return Err(AppError::bad_request("El nombre no puede superar 40 caracteres"));
    }
    if b.description.chars().count() > 300 {
        return Err(AppError::bad_request("La descripción no puede superar 300 caracteres"));
    }
    if !DISCIPLINE_COLORS.contains(&b.color.as_str()) {
        return Err(AppError::bad_request("Color inválido"));
    }
    Ok(())
}

fn duplicate_name(e: sqlx::Error) -> AppError {
    match AppError::from(e) {
        err if err.code == "duplicate" => AppError::conflict("duplicate", "Ya existe una disciplina con ese nombre"),
        err => err,
    }
}

async fn create_discipline(State(state): State<AppState>, _: Admin, Json(b): Json<DisciplineBody>) -> ApiResult<Json<Value>> {
    validate(&b)?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO disciplines (name, color, description, active) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(b.name.trim())
    .bind(&b.color)
    .bind(b.description.trim())
    .bind(b.active)
    .fetch_one(&state.db)
    .await
    .map_err(duplicate_name)?;
    Ok(Json(json!({ "id": id })))
}

async fn update_discipline(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(b): Json<DisciplineBody>) -> ApiResult<Json<Value>> {
    validate(&b)?;
    let res = sqlx::query("UPDATE disciplines SET name = $2, color = $3, description = $4, active = $5 WHERE id = $1")
        .bind(id)
        .bind(b.name.trim())
        .bind(&b.color)
        .bind(b.description.trim())
        .bind(b.active)
        .execute(&state.db)
        .await
        .map_err(duplicate_name)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("La disciplina no existe"));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Solo se puede eliminar si nunca se programó una clase con ella; si no, se debe desactivar
/// para conservar el historial de reservas y asistencia.
async fn delete_discipline(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let (classes,): (i64,) = sqlx::query_as("SELECT count(*) FROM classes WHERE discipline_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if classes > 0 {
        return Err(AppError::conflict(
            "in_use",
            format!("Esta disciplina tiene {classes} clases registradas. Desactívala en lugar de eliminarla para conservar el historial."),
        ));
    }
    let res = sqlx::query("DELETE FROM disciplines WHERE id = $1").bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("La disciplina no existe"));
    }
    Ok(Json(json!({ "ok": true })))
}
