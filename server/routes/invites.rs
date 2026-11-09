//! Enlaces de invitación: el admin los genera y los estudiantes se registran solos.
//! El registro nunca asigna planes; eso queda a cargo del administrador.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::http::header::SET_COOKIE;
use axum::response::{AppendHeaders, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::auth::{self, Admin};
use crate::error::{ApiResult, AppError};
use crate::time::{parse_date, today};
use crate::{AppRouter, AppState};

pub fn admin_routes() -> AppRouter {
    Router::new()
        .route("/invites", get(list_invites).post(create_invite))
        .route("/invites/{id}/revoke", post(revoke_invite))
}

/// Rutas públicas (sin sesión).
pub fn public_routes() -> AppRouter {
    Router::new()
        .route("/invites/{token}", get(check_invite))
        .route("/invites/{token}/register", post(register))
}

fn new_token() -> String {
    let mut bytes = [0u8; 18];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------- Admin

#[derive(Debug, Serialize, FromRow)]
struct InviteRow {
    id: i64,
    token: String,
    label: String,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    max_uses: Option<i32>,
    uses: i32,
    revoked: bool,
    active: bool,
    disciplines: Value,
    pending_plan: i32,
}

async fn list_invites(State(state): State<AppState>, _: Admin) -> ApiResult<Json<Vec<InviteRow>>> {
    Ok(Json(
        sqlx::query_as::<_, InviteRow>(
            "SELECT i.id, i.token, i.label, i.created_at, i.expires_at, i.max_uses, i.uses, i.revoked,
                    (NOT i.revoked AND i.expires_at > now() AND (i.max_uses IS NULL OR i.uses < i.max_uses)) AS active,
                    coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'color', d.color) ORDER BY d.name)
                              FROM student_invite_disciplines x JOIN disciplines d ON d.id = x.discipline_id
                              WHERE x.invite_id = i.id), '[]'::json) AS disciplines,
                    (SELECT count(*) FROM students s
                     WHERE s.invite_id = i.id AND NOT EXISTS (SELECT 1 FROM student_plans p WHERE p.student_id = s.id))::int AS pending_plan
             FROM student_invites i
             ORDER BY active DESC, i.created_at DESC
             LIMIT 50",
        )
        .fetch_all(&state.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct NewInvite {
    #[serde(default)]
    label: String,
    /// Días de vigencia (1–90).
    expires_days: i64,
    /// Usos máximos; vacío = ilimitado.
    max_uses: Option<i32>,
    #[serde(default)]
    discipline_ids: Vec<i64>,
}

async fn create_invite(State(state): State<AppState>, Admin(me): Admin, Json(b): Json<NewInvite>) -> ApiResult<Json<Value>> {
    if !(1..=90).contains(&b.expires_days) {
        return Err(AppError::bad_request("La vigencia debe estar entre 1 y 90 días"));
    }
    if matches!(b.max_uses, Some(n) if !(1..=1000).contains(&n)) {
        return Err(AppError::bad_request("Los usos deben estar entre 1 y 1000"));
    }
    let token = new_token();
    let mut tx = state.db.begin().await?;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO student_invites (token, label, created_by, expires_at, max_uses)
         VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id",
    )
    .bind(&token)
    .bind(b.label.trim())
    .bind(me.user_id)
    .bind(b.expires_days as i32)
    .bind(b.max_uses)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO student_invite_disciplines (invite_id, discipline_id)
         SELECT $1, d.id FROM disciplines d WHERE d.id = ANY($2::bigint[]) AND d.active",
    )
    .bind(id)
    .bind(&b.discipline_ids)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "id": id, "token": token })))
}

async fn revoke_invite(State(state): State<AppState>, _: Admin, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let res = sqlx::query("UPDATE student_invites SET revoked = TRUE WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("La invitación no existe"));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------- Público

fn invalid_invite() -> AppError {
    AppError::new(
        axum::http::StatusCode::GONE,
        "invite_invalid",
        "Este enlace de invitación ya no es válido. Pide uno nuevo al estudio.",
    )
}

/// Valida el enlace y devuelve lo que necesita la pantalla de registro.
async fn check_invite(State(state): State<AppState>, Path(token): Path<String>) -> ApiResult<Json<Value>> {
    let row: Option<(i64, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, label, expires_at FROM student_invites
         WHERE token = $1 AND NOT revoked AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?;
    let (id, label, expires_at) = row.ok_or_else(invalid_invite)?;
    let disciplines: Vec<(String, String)> = sqlx::query_as(
        "SELECT d.name, d.color FROM student_invite_disciplines x JOIN disciplines d ON d.id = x.discipline_id
         WHERE x.invite_id = $1 ORDER BY d.name",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "label": label,
        "expires_at": expires_at,
        "disciplines": disciplines.into_iter().map(|(name, color)| json!({ "name": name, "color": color })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct RegisterBody {
    name: String,
    email: String,
    password: String,
    phone: Option<String>,
    birth_date: Option<String>,
    goal: Option<String>,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Registro del estudiante con un enlace válido. Crea la cuenta sin plan e inicia sesión.
async fn register(State(state): State<AppState>, Path(token): Path<String>, Json(b): Json<RegisterBody>) -> ApiResult<impl IntoResponse> {
    let name = b.name.trim();
    let email = b.email.trim().to_lowercase();
    if name.chars().count() < 3 {
        return Err(AppError::bad_request("Escribe tu nombre completo"));
    }
    if !email.contains('@') || !email.contains('.') {
        return Err(AppError::bad_request("Escribe un correo válido"));
    }
    auth::validate_new_password(&b.password)?;
    let birth = clean(b.birth_date).as_deref().map(parse_date).transpose()?;
    if let Some(d) = birth {
        if d > today(&state.cfg.tz) - Duration::days(365 * 5) {
            return Err(AppError::bad_request("Revisa tu fecha de nacimiento"));
        }
    }
    let hash = auth::hash_password(&b.password)?;

    let mut tx = state.db.begin().await?;
    // Se consume un uso de forma atómica (evita superar el límite con registros simultáneos).
    let invite: Option<(i64,)> = sqlx::query_as(
        "UPDATE student_invites SET uses = uses + 1
         WHERE token = $1 AND NOT revoked AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)
         RETURNING id",
    )
    .bind(&token)
    .fetch_optional(&mut *tx)
    .await?;
    let (invite_id,) = invite.ok_or_else(invalid_invite)?;

    let (user_id,): (i64,) = sqlx::query_as("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'student') RETURNING id")
        .bind(&email)
        .bind(hash)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match AppError::from(e) {
            err if err.code == "duplicate" => AppError::conflict(
                "duplicate",
                "Ya existe una cuenta con ese correo. Inicia sesión o usa “¿Olvidaste tu contraseña?”.",
            ),
            err => err,
        })?;
    let day = today(&state.cfg.tz);
    let (student_id,): (i64,) = sqlx::query_as(
        "INSERT INTO students (user_id, name, phone, birth_date, goal, joined_on, invite_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(clean(b.phone))
    .bind(birth)
    .bind(clean(b.goal))
    .bind(day)
    .bind(invite_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO student_disciplines (student_id, discipline_id, enabled_on)
         SELECT $1, x.discipline_id, $3 FROM student_invite_disciplines x
         JOIN disciplines d ON d.id = x.discipline_id AND d.active
         WHERE x.invite_id = $2",
    )
    .bind(student_id)
    .bind(invite_id)
    .bind(day)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let cookie = auth::session_cookie(&state, user_id, "student", false)?;
    Ok((
        AppendHeaders([(SET_COOKIE, cookie)]),
        Json(json!({
            "user": { "id": user_id, "email": email, "role": "student", "is_admin": false, "name": name, "initials": crate::models::initials(name) },
            "student_id": student_id,
            "teacher_id": null,
        })),
    ))
}
