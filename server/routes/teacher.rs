//! Rutas del profesor (/api/teacher/*): sus clases y toma de asistencia.

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::Duration;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::TeacherUser;
use crate::booking;
use crate::error::{ApiResult, AppError};
use crate::models::{ClassItem, class_select, initials};
use crate::time::{local_range, parse_date, today};
use crate::{AppRouter, AppState};

use super::admin_classes::{StatusBody, load_attendees, update_attendance};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/teacher/overview", get(overview))
        .route("/teacher/classes", get(list_classes))
        .route("/teacher/classes/{id}/attendees", get(attendees))
        .route("/teacher/bookings/{id}/status", put(set_status))
}

async fn classes_between(state: &AppState, teacher_id: i64, from: chrono::NaiveDate, to: chrono::NaiveDate) -> ApiResult<Vec<ClassItem>> {
    let (start, end) = local_range(&state.cfg.tz, from, to)?;
    Ok(sqlx::query_as::<_, ClassItem>(&format!(
        "{} WHERE c.teacher_id = $2 AND c.starts_at >= $3 AND c.starts_at < $4 ORDER BY c.starts_at",
        class_select()
    ))
    .bind(None::<i64>)
    .bind(teacher_id)
    .bind(start)
    .bind(end)
    .fetch_all(&state.db)
    .await?)
}

async fn overview(State(state): State<AppState>, me: TeacherUser) -> ApiResult<Json<Value>> {
    booking::expire_waitlists(&state.db).await?;
    let day = today(&state.cfg.tz);
    let (name,): (String,) = sqlx::query_as("SELECT name FROM teachers WHERE id = $1")
        .bind(me.teacher_id)
        .fetch_one(&state.db)
        .await?;
    let disciplines: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT d.id, d.name, d.color FROM teacher_disciplines td JOIN disciplines d ON d.id = td.discipline_id
         WHERE td.teacher_id = $1 ORDER BY d.name",
    )
    .bind(me.teacher_id)
    .fetch_all(&state.db)
    .await?;
    let today_classes = classes_between(&state, me.teacher_id, day, day).await?;
    let week = classes_between(&state, me.teacher_id, day + Duration::days(1), day + Duration::days(7)).await?;
    // Clases ya dictadas (últimos 7 días) que aún tienen reservas sin marcar.
    let (pending_attendance,): (i64,) = sqlx::query_as(
        "SELECT count(DISTINCT c.id) FROM classes c JOIN bookings b ON b.class_id = c.id
         WHERE c.teacher_id = $1 AND NOT c.cancelled AND b.status = 'booked'
           AND c.starts_at <= now() AND c.starts_at >= now() - interval '7 days'",
    )
    .bind(me.teacher_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({
        "teacher": { "id": me.teacher_id, "name": name, "initials": initials(&name) },
        "today": day,
        "disciplines": disciplines.into_iter().map(|(id, name, color)| json!({ "id": id, "name": name, "color": color })).collect::<Vec<_>>(),
        "today_classes": today_classes,
        "week_classes": week,
        "pending_attendance": pending_attendance,
    })))
}

#[derive(Deserialize)]
struct RangeQuery {
    from: Option<String>,
    to: Option<String>,
}

async fn list_classes(State(state): State<AppState>, me: TeacherUser, Query(q): Query<RangeQuery>) -> ApiResult<Json<Vec<ClassItem>>> {
    booking::expire_waitlists(&state.db).await?;
    let tz = &state.cfg.tz;
    let from = q.from.as_deref().map(parse_date).transpose()?.unwrap_or_else(|| today(tz));
    let to = q.to.as_deref().map(parse_date).transpose()?.unwrap_or(from + Duration::days(6));
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::bad_request("Rango de fechas inválido (máximo 62 días)"));
    }
    Ok(Json(classes_between(&state, me.teacher_id, from, to).await?))
}

async fn attendees(State(state): State<AppState>, me: TeacherUser, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    Ok(Json(load_attendees(&state, id, Some(me.teacher_id)).await?))
}

async fn set_status(State(state): State<AppState>, me: TeacherUser, Path(id): Path<i64>, Json(body): Json<StatusBody>) -> ApiResult<Json<Value>> {
    update_attendance(&state, id, &body, Some(me.teacher_id)).await?;
    Ok(Json(json!({ "ok": true })))
}
