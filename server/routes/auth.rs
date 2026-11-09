use axum::extract::State;
use axum::http::header::SET_COOKIE;
use axum::response::{AppendHeaders, IntoResponse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{self, AuthUser};
use crate::error::{ApiResult, AppError};
use crate::models::initials;
use crate::{AppRouter, AppState};

pub fn routes() -> AppRouter {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/forgot", post(forgot))
        .route("/auth/change-password", post(change_password))
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
    #[serde(default)]
    remember: bool,
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> ApiResult<impl IntoResponse> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err(AppError::bad_request("Correo y contraseña son obligatorios"));
    }
    let row: Option<(i64, String, String, bool)> =
        sqlx::query_as("SELECT id, password_hash, role, active FROM users WHERE lower(email) = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;

    let Some((user_id, _, role, active)) = row.filter(|(_, hash, _, _)| auth::verify_password(&body.password, hash))
    else {
        return Err(AppError::unauthorized("El correo o la contraseña no son correctos."));
    };
    if !active {
        return Err(AppError::new(
            axum::http::StatusCode::FORBIDDEN,
            "inactive",
            "Tu cuenta no está activa. Comunícate con el administrador.",
        ));
    }
    let cookie = auth::session_cookie(&state, user_id, &role, body.remember)?;
    let profile = load_me(&state, user_id).await?;
    Ok((AppendHeaders([(SET_COOKIE, cookie)]), Json(profile)))
}

async fn logout(State(state): State<AppState>) -> impl IntoResponse {
    (AppendHeaders([(SET_COOKIE, auth::clear_cookie(&state))]), Json(json!({ "ok": true })))
}

async fn me(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(load_me(&state, user.user_id).await?))
}

async fn load_me(state: &AppState, user_id: i64) -> ApiResult<Value> {
    let (email, role, is_admin, student, teacher): (String, String, bool, Option<(i64, String)>, Option<(i64, String)>) = {
        let row: (String, String, bool, Option<i64>, Option<String>, Option<i64>, Option<String>) = sqlx::query_as(
            "SELECT u.email, u.role, (u.role = 'admin' OR u.is_admin), s.id, s.name, t.id, t.name FROM users u
             LEFT JOIN students s ON s.user_id = u.id
             LEFT JOIN teachers t ON t.user_id = u.id
             WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        (row.0, row.1, row.2, row.3.zip(row.4), row.5.zip(row.6))
    };
    let name = student
        .as_ref()
        .or(teacher.as_ref())
        .map(|(_, n)| n.clone())
        .unwrap_or_else(|| "Administrador".to_string());
    Ok(json!({
        "user": { "id": user_id, "email": email, "role": role, "is_admin": is_admin, "name": name, "initials": initials(&name) },
        "student_id": student.map(|(id, _)| id),
        "teacher_id": teacher.map(|(id, _)| id),
    }))
}

#[derive(Deserialize)]
struct ForgotBody {
    email: String,
}

/// No hay servicio de correo: se registra la solicitud para que el administrador la vea en el panel.
/// Siempre responde lo mismo para no revelar qué correos existen.
async fn forgot(State(state): State<AppState>, Json(body): Json<ForgotBody>) -> ApiResult<Json<Value>> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() {
        return Err(AppError::bad_request("El correo es obligatorio"));
    }
    sqlx::query(
        "INSERT INTO password_reset_requests (user_id)
         SELECT u.id FROM users u
         WHERE lower(u.email) = $1
           AND NOT EXISTS (SELECT 1 FROM password_reset_requests r WHERE r.user_id = u.id AND r.resolved_at IS NULL)",
    )
    .bind(&email)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ChangePasswordBody {
    current_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<ChangePasswordBody>,
) -> ApiResult<Json<Value>> {
    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_one(&state.db)
        .await?;
    if !auth::verify_password(&body.current_password, &hash) {
        return Err(AppError::bad_request("La contraseña actual no es correcta"));
    }
    auth::validate_new_password(&body.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(user.user_id)
        .bind(auth::hash_password(&body.new_password)?)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
