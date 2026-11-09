//! Administración de profesores y estudiantes (/api/admin/*).

use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::{self, Admin};
use crate::error::{ApiResult, AppError};
use crate::models::{PlanStatus, current_plan, initials, plan_status_select};
use crate::time::{parse_date, today};
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/teachers", get(list_teachers).post(create_teacher))
        .route("/teachers/{id}", put(update_teacher))
        .route("/students", get(list_students).post(create_student))
        .route("/students/{id}", get(get_student).put(update_student))
        .route("/students/{id}/disciplines", put(set_student_disciplines))
        .route("/students/{id}/plans", post(assign_plan))
        .route("/students/{id}/password", post(reset_password))
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------- Profesores

#[derive(Debug, Serialize, FromRow)]
struct TeacherRow {
    id: i64,
    name: String,
    email: Option<String>,
    phone: Option<String>,
    active: bool,
    has_login: bool,
    is_admin: bool,
    disciplines: Value,
    classes_week: i32,
    students_30d: i32,
    occupancy_30d: i32,
}

async fn list_teachers(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Value>> {
    let rows = sqlx::query_as::<_, TeacherRow>(
        "SELECT t.id, t.name, coalesce(u.email, t.email) AS email, t.phone, t.active, (t.user_id IS NOT NULL) AS has_login, coalesce(u.is_admin, FALSE) AS is_admin,
                coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'color', d.color) ORDER BY d.name)
                          FROM teacher_disciplines td JOIN disciplines d ON d.id = td.discipline_id
                          WHERE td.teacher_id = t.id), '[]'::json) AS disciplines,
                (SELECT count(*) FROM classes c WHERE c.teacher_id = t.id AND NOT c.cancelled
                   AND c.starts_at >= now() AND c.starts_at < now() + interval '7 days')::int AS classes_week,
                (SELECT count(DISTINCT b.student_id) FROM bookings b JOIN classes c ON c.id = b.class_id
                   WHERE c.teacher_id = t.id AND c.starts_at >= now() - interval '30 days' AND c.starts_at < now()
                     AND b.status IN ('booked','attended','noshow'))::int AS students_30d,
                coalesce((SELECT round(100.0 * sum(x.taken) / nullif(sum(x.capacity), 0))
                          FROM (SELECT c.capacity,
                                       (SELECT count(*) FROM bookings b WHERE b.class_id = c.id
                                          AND b.status IN ('booked','attended','noshow')) AS taken
                                FROM classes c WHERE c.teacher_id = t.id AND NOT c.cancelled
                                  AND c.starts_at >= now() - interval '30 days' AND c.starts_at < now()) x), 0)::int AS occupancy_30d
         FROM teachers t LEFT JOIN users u ON u.id = t.user_id
         ORDER BY t.active DESC, t.name",
    )
    .fetch_all(&state.db)
    .await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|t| {
            let mut v = serde_json::to_value(&t).unwrap_or_default();
            v["initials"] = json!(initials(&t.name));
            v
        })
        .collect();
    Ok(Json(json!(out)))
}

#[derive(Deserialize)]
struct TeacherBody {
    name: String,
    /// Correo de acceso (usuario de login).
    email: String,
    /// Obligatoria al crear; al editar, vacía = no cambiar.
    #[serde(default)]
    password: String,
    phone: Option<String>,
    #[serde(default = "yes")]
    active: bool,
    /// También tiene acceso al panel de administración.
    #[serde(default)]
    is_admin: bool,
    #[serde(default)]
    discipline_ids: Vec<i64>,
}

fn validate_teacher(body: &TeacherBody) -> ApiResult<String> {
    if body.name.trim().is_empty() {
        return Err(AppError::bad_request("El nombre es obligatorio"));
    }
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::bad_request("El correo de acceso es obligatorio"));
    }
    Ok(email)
}

fn duplicate_email(e: sqlx::Error) -> AppError {
    match AppError::from(e) {
        err if err.code == "duplicate" => AppError::conflict("duplicate", "Ya existe una cuenta con ese correo"),
        err => err,
    }
}

fn yes() -> bool {
    true
}

async fn save_teacher_disciplines(tx: &mut sqlx::PgConnection, id: i64, ids: &[i64]) -> ApiResult<()> {
    sqlx::query("DELETE FROM teacher_disciplines WHERE teacher_id = $1").bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO teacher_disciplines (teacher_id, discipline_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn create_teacher(State(state): State<AppState>, _: Admin, Json(body): Json<TeacherBody>) -> ApiResult<Json<Value>> {
    let email = validate_teacher(&body)?;
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_password(&body.password)?;
    let mut tx = state.db.begin().await?;
    let (user_id,): (i64,) = sqlx::query_as(
        "INSERT INTO users (email, password_hash, role, active, is_admin) VALUES ($1, $2, 'teacher', $3, $4) RETURNING id",
    )
    .bind(&email)
    .bind(hash)
    .bind(body.active)
    .bind(body.is_admin)
    .fetch_one(&mut *tx)
    .await
    .map_err(duplicate_email)?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO teachers (name, email, phone, active, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(body.name.trim())
    .bind(&email)
    .bind(clean(body.phone))
    .bind(body.active)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    save_teacher_disciplines(&mut tx, id, &body.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

async fn update_teacher(State(state): State<AppState>, Admin(me): Admin, Path(id): Path<i64>, Json(body): Json<TeacherBody>) -> ApiResult<Json<Value>> {
    let email = validate_teacher(&body)?;
    let new_password = (!body.password.is_empty()).then_some(body.password.as_str());
    if let Some(p) = new_password {
        auth::validate_new_password(p)?;
    }
    let mut tx = state.db.begin().await?;
    let (user_id,): (Option<i64>,) = sqlx::query_as("SELECT user_id FROM teachers WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("El profesor no existe"))?;

    if user_id == Some(me.user_id) && (!body.is_admin || !body.active) {
        return Err(AppError::bad_request(
            "No puedes quitarte el permiso de administrador ni desactivar tu propia cuenta",
        ));
    }
    let user_id = match user_id {
        Some(uid) => {
            sqlx::query("UPDATE users SET email = $2, active = $3, is_admin = $4 WHERE id = $1")
                .bind(uid)
                .bind(&email)
                .bind(body.active)
                .bind(body.is_admin)
                .execute(&mut *tx)
                .await
                .map_err(duplicate_email)?;
            if let Some(p) = new_password {
                sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
                    .bind(uid)
                    .bind(auth::hash_password(p)?)
                    .execute(&mut *tx)
                    .await?;
            }
            uid
        }
        // Profesor sin cuenta (creado antes del rol profesor): se crea al asignarle contraseña.
        None => {
            let p = new_password.ok_or_else(|| AppError::bad_request("Asigna una contraseña para crear su acceso"))?;
            let (uid,): (i64,) = sqlx::query_as(
                "INSERT INTO users (email, password_hash, role, active, is_admin) VALUES ($1, $2, 'teacher', $3, $4) RETURNING id",
            )
            .bind(&email)
            .bind(auth::hash_password(p)?)
            .bind(body.active)
            .bind(body.is_admin)
            .fetch_one(&mut *tx)
            .await
            .map_err(duplicate_email)?;
            uid
        }
    };
    sqlx::query("UPDATE teachers SET name = $2, email = $3, phone = $4, active = $5, user_id = $6 WHERE id = $1")
        .bind(id)
        .bind(body.name.trim())
        .bind(&email)
        .bind(clean(body.phone))
        .bind(body.active)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    save_teacher_disciplines(&mut tx, id, &body.discipline_ids).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------- Estudiantes

#[derive(Debug, Serialize, FromRow)]
struct StudentListRow {
    id: i64,
    name: String,
    email: String,
    active: bool,
    disciplines: Value,
    plan_name: Option<String>,
    remaining: Option<i32>,
    plan_ends_on: Option<NaiveDate>,
    attended: i32,
    noshow: i32,
    last_attended_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct StudentQuery {
    q: Option<String>,
}

async fn list_students(State(state): State<AppState>, _: Admin, Query(q): Query<StudentQuery>) -> ApiResult<Json<Value>> {
    let day = today(&state.cfg.tz);
    let search = clean(q.q).map(|s| format!("%{}%", s.to_lowercase()));
    let rows = sqlx::query_as::<_, StudentListRow>(
        "SELECT s.id, s.name, u.email, u.active,
                coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'color', d.color) ORDER BY d.name)
                          FROM student_disciplines sd JOIN disciplines d ON d.id = sd.discipline_id
                          WHERE sd.student_id = s.id), '[]'::json) AS disciplines,
                sp.name AS plan_name,
                (sp.total_classes - (SELECT count(*) FROM bookings b WHERE b.student_plan_id = sp.id
                   AND b.status IN ('booked','attended','noshow','late_cancel')))::int AS remaining,
                sp.ends_on AS plan_ends_on,
                coalesce(st.attended, 0) AS attended, coalesce(st.noshow, 0) AS noshow, st.last_attended_at
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN LATERAL (
            SELECT * FROM student_plans p WHERE p.student_id = s.id AND p.starts_on <= $1 AND p.ends_on >= $1
            ORDER BY p.ends_on DESC LIMIT 1
         ) sp ON TRUE
         LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))::int AS attended,
                   count(*) FILTER (WHERE b.status = 'noshow')::int AS noshow,
                   max(c.starts_at) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now())) AS last_attended_at
            FROM bookings b JOIN classes c ON c.id = b.class_id
            WHERE b.student_id = s.id AND NOT c.cancelled
         ) st ON TRUE
         WHERE ($2::text IS NULL OR lower(s.name) LIKE $2 OR lower(u.email) LIKE $2)
         ORDER BY u.active DESC, s.name",
    )
    .bind(day)
    .bind(search)
    .fetch_all(&state.db)
    .await?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|s| {
            let total = s.attended + s.noshow;
            let mut v = serde_json::to_value(&s).unwrap_or_default();
            v["initials"] = json!(initials(&s.name));
            v["attendance_pct"] = json!(if total > 0 { (s.attended as f64 / total as f64 * 100.0).round() as i32 } else { 0 });
            v
        })
        .collect();
    Ok(Json(json!(out)))
}

#[derive(Deserialize)]
struct NewStudentBody {
    name: String,
    email: String,
    password: String,
    phone: Option<String>,
    goal: Option<String>,
    #[serde(default)]
    discipline_ids: Vec<i64>,
    plan_id: Option<i64>,
}

async fn create_student(State(state): State<AppState>, _: Admin, Json(body): Json<NewStudentBody>) -> ApiResult<Json<Value>> {
    let email = body.email.trim().to_lowercase();
    if body.name.trim().is_empty() || !email.contains('@') {
        return Err(AppError::bad_request("Nombre y correo válido son obligatorios"));
    }
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_password(&body.password)?;
    let mut tx = state.db.begin().await?;
    let (user_id,): (i64,) = sqlx::query_as("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'student') RETURNING id")
        .bind(&email)
        .bind(hash)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match AppError::from(e) {
            err if err.code == "duplicate" => AppError::conflict("duplicate", "Ya existe una cuenta con ese correo"),
            err => err,
        })?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO students (user_id, name, phone, goal, joined_on) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(user_id)
    .bind(body.name.trim())
    .bind(clean(body.phone))
    .bind(clean(body.goal))
    .bind(today(&state.cfg.tz))
    .fetch_one(&mut *tx)
    .await?;
    save_student_disciplines(&mut tx, id, &body.discipline_ids, today(&state.cfg.tz)).await?;
    if let Some(plan_id) = body.plan_id {
        insert_plan(&mut tx, id, plan_id, today(&state.cfg.tz)).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Debug, Serialize, FromRow)]
struct StudentDetailRow {
    id: i64,
    user_id: i64,
    name: String,
    email: String,
    active: bool,
    phone: Option<String>,
    birth_date: Option<NaiveDate>,
    joined_on: NaiveDate,
    weight_kg: Option<f64>,
    height_m: Option<f64>,
    level: Option<String>,
    restrictions: Option<String>,
    goal: Option<String>,
    notes: Option<String>,
    discipline_ids: Vec<i64>,
    attended: i32,
    noshow: i32,
    last_attended_at: Option<DateTime<Utc>>,
    reset_pending: bool,
}

async fn get_student(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let day = today(&state.cfg.tz);
    let s = sqlx::query_as::<_, StudentDetailRow>(
        "SELECT s.id, s.user_id, s.name, u.email, u.active, s.phone, s.birth_date, s.joined_on,
                s.weight_kg::float8 AS weight_kg, s.height_m::float8 AS height_m, s.level, s.restrictions, s.goal, s.notes,
                coalesce((SELECT array_agg(sd.discipline_id) FROM student_disciplines sd WHERE sd.student_id = s.id), '{}') AS discipline_ids,
                coalesce(st.attended, 0) AS attended, coalesce(st.noshow, 0) AS noshow, st.last_attended_at,
                EXISTS (SELECT 1 FROM password_reset_requests r WHERE r.user_id = u.id AND r.resolved_at IS NULL) AS reset_pending
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now()))::int AS attended,
                   count(*) FILTER (WHERE b.status = 'noshow')::int AS noshow,
                   max(c.starts_at) FILTER (WHERE b.status = 'attended' OR (b.status = 'booked' AND c.starts_at <= now())) AS last_attended_at
            FROM bookings b JOIN classes c ON c.id = b.class_id
            WHERE b.student_id = s.id AND NOT c.cancelled
         ) st ON TRUE
         WHERE s.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    let plans = sqlx::query_as::<_, PlanStatus>(&format!(
        "{} WHERE sp.student_id = $1 ORDER BY sp.starts_on DESC, sp.id DESC LIMIT 12",
        plan_status_select()
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let total = s.attended + s.noshow;
    Ok(Json(json!({
        "student": s,
        "initials": initials(&s.name),
        "attendance_pct": if total > 0 { (s.attended as f64 / total as f64 * 100.0).round() as i32 } else { 0 },
        "plan": current_plan(&state.db, id, day).await?,
        "plans": plans,
    })))
}

#[derive(Deserialize)]
struct UpdateStudentBody {
    name: String,
    email: String,
    active: bool,
    phone: Option<String>,
    birth_date: Option<String>,
    weight_kg: Option<f64>,
    height_m: Option<f64>,
    level: Option<String>,
    restrictions: Option<String>,
    goal: Option<String>,
    notes: Option<String>,
}

async fn update_student(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<UpdateStudentBody>) -> ApiResult<Json<Value>> {
    let email = body.email.trim().to_lowercase();
    if body.name.trim().is_empty() || !email.contains('@') {
        return Err(AppError::bad_request("Nombre y correo válido son obligatorios"));
    }
    let birth = clean(body.birth_date).as_deref().map(parse_date).transpose()?;
    let mut tx = state.db.begin().await?;
    let (user_id,): (i64,) = sqlx::query_as(
        "UPDATE students SET name = $2, phone = $3, birth_date = $4, weight_kg = $5, height_m = $6,
                level = $7, restrictions = $8, goal = $9, notes = $10
         WHERE id = $1 RETURNING user_id",
    )
    .bind(id)
    .bind(body.name.trim())
    .bind(clean(body.phone))
    .bind(birth)
    .bind(body.weight_kg)
    .bind(body.height_m)
    .bind(clean(body.level))
    .bind(clean(body.restrictions))
    .bind(clean(body.goal))
    .bind(clean(body.notes))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    sqlx::query("UPDATE users SET email = $2, active = $3 WHERE id = $1")
        .bind(user_id)
        .bind(&email)
        .bind(body.active)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn save_student_disciplines(tx: &mut sqlx::PgConnection, id: i64, ids: &[i64], day: NaiveDate) -> ApiResult<()> {
    // Se conserva la fecha de habilitación de las disciplinas que ya tenía.
    sqlx::query("DELETE FROM student_disciplines WHERE student_id = $1 AND NOT (discipline_id = ANY($2::bigint[]))")
        .bind(id)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO student_disciplines (student_id, discipline_id, enabled_on)
         SELECT $1, unnest($2::bigint[]), $3 ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(ids)
    .bind(day)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct DisciplinesBody {
    discipline_ids: Vec<i64>,
}

async fn set_student_disciplines(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<DisciplinesBody>) -> ApiResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM students WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    save_student_disciplines(&mut tx, id, &body.discipline_ids, today(&state.cfg.tz)).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn insert_plan(tx: &mut sqlx::PgConnection, student_id: i64, plan_id: i64, starts_on: NaiveDate) -> ApiResult<i64> {
    let (name, total, days, price, active): (String, i32, i32, i64, bool) =
        sqlx::query_as("SELECT name, total_classes, duration_days, price, active FROM plans WHERE id = $1")
            .bind(plan_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::not_found("El plan no existe"))?;
    if !active {
        return Err(AppError::bad_request("El plan no está activo"));
    }
    let ends_on = starts_on + Duration::days(days as i64 - 1);
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO student_plans (student_id, plan_id, name, total_classes, price, starts_on, ends_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(student_id)
    .bind(plan_id)
    .bind(name)
    .bind(total)
    .bind(price)
    .bind(starts_on)
    .bind(ends_on)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO student_plan_implements (student_plan_id, implement_id)
         SELECT $1, implement_id FROM plan_implements WHERE plan_id = $2",
    )
    .bind(id)
    .bind(plan_id)
    .execute(&mut *tx)
    .await?;
    Ok(id)
}

#[derive(Deserialize)]
struct AssignPlanBody {
    plan_id: i64,
    starts_on: Option<String>,
}

/// Registra un plan comprado por el estudiante (el pago se gestiona fuera de la plataforma).
async fn assign_plan(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<AssignPlanBody>) -> ApiResult<Json<Value>> {
    let starts_on = match body.starts_on.as_deref() {
        Some(d) if !d.is_empty() => parse_date(d)?,
        _ => today(&state.cfg.tz),
    };
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM students WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    let plan_id = insert_plan(&mut tx, id, body.plan_id, starts_on).await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": plan_id })))
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

/// Restablece la contraseña y marca como resueltas las solicitudes pendientes.
async fn reset_password(State(state): State<AppState>, _: Admin, Path(id): Path<i64>, Json(body): Json<PasswordBody>) -> ApiResult<Json<Value>> {
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_password(&body.password)?;
    let mut tx = state.db.begin().await?;
    let (user_id,): (i64,) = sqlx::query_as(
        "UPDATE users SET password_hash = $2 WHERE id = (SELECT user_id FROM students WHERE id = $1) RETURNING id",
    )
    .bind(id)
    .bind(hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    sqlx::query("UPDATE password_reset_requests SET resolved_at = now() WHERE user_id = $1 AND resolved_at IS NULL")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}
