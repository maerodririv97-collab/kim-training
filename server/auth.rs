//! Sesión con JWT en cookie httpOnly, hash de contraseñas con Argon2 y extractores por rol.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::header::COOKIE;
use axum::http::request::Parts;
use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::{ApiResult, AppError};

pub const COOKIE_NAME: &str = "kim_session";
const SHORT_SESSION_SECS: i64 = 60 * 60 * 12; // 12 h
const LONG_SESSION_SECS: i64 = 60 * 60 * 24 * 30; // 30 días ("Recordarme")

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: i64,
    role: String,
    exp: i64,
}

pub fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| AppError::internal("No se pudo procesar la contraseña"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

pub fn validate_new_password(password: &str) -> ApiResult<()> {
    if password.chars().count() < 8 {
        return Err(AppError::bad_request("La contraseña debe tener al menos 8 caracteres"));
    }
    Ok(())
}

/// Crea el token y devuelve el valor del header `Set-Cookie`.
pub fn session_cookie(state: &AppState, user_id: i64, role: &str, remember: bool) -> ApiResult<String> {
    let ttl = if remember { LONG_SESSION_SECS } else { SHORT_SESSION_SECS };
    let claims = Claims { sub: user_id, role: role.to_string(), exp: Utc::now().timestamp() + ttl };
    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(state.cfg.jwt_secret.as_bytes()))
        .map_err(|_| AppError::internal("No se pudo crear la sesión"))?;
    // Sin "Recordarme" la cookie es de sesión (se borra al cerrar el navegador).
    let max_age = if remember { format!("; Max-Age={ttl}") } else { String::new() };
    Ok(format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax{}{max_age}",
        if state.cfg.secure_cookies { "; Secure" } else { "" }
    ))
}

pub fn clear_cookie(state: &AppState) -> String {
    format!(
        "{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        if state.cfg.secure_cookies { "; Secure" } else { "" }
    )
}

fn token_from_parts(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|pair| {
            let (k, v) = pair.trim().split_once('=')?;
            (k == COOKIE_NAME && !v.is_empty()).then(|| v.to_string())
        })
}

/// Usuario autenticado y activo (cualquier rol).
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: i64,
    pub role: String,
    pub student_id: Option<i64>,
    pub teacher_id: Option<i64>,
    /// Acceso al panel de administración (rol admin o profesor con permiso de administrador).
    pub is_admin: bool,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_from_parts(parts).ok_or_else(|| AppError::unauthorized("Inicia sesión para continuar"))?;
        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(state.cfg.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::unauthorized("Tu sesión expiró, inicia sesión de nuevo"))?;

        // Se valida contra la base en cada petición para que desactivar una cuenta tenga efecto inmediato.
        let row: Option<(String, bool, Option<i64>, Option<i64>, bool)> = sqlx::query_as(
            "SELECT u.role, u.active, s.id, t.id, (u.role = 'admin' OR u.is_admin) FROM users u
             LEFT JOIN students s ON s.user_id = u.id
             LEFT JOIN teachers t ON t.user_id = u.id
             WHERE u.id = $1",
        )
        .bind(data.claims.sub)
        .fetch_optional(&state.db)
        .await?;

        match row {
            Some((role, true, student_id, teacher_id, is_admin)) => {
                Ok(AuthUser { user_id: data.claims.sub, role, student_id, teacher_id, is_admin })
            }
            Some((_, false, _, _, _)) => Err(AppError::forbidden("Tu cuenta no está activa. Comunícate con el administrador.")),
            None => Err(AppError::unauthorized("Inicia sesión para continuar")),
        }
    }
}

/// Requiere rol administrador.
pub struct Admin(pub AuthUser);

impl FromRequestParts<AppState> for Admin {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(AppError::forbidden("Solo el administrador puede hacer esto"));
        }
        Ok(Admin(user))
    }
}

/// Requiere rol estudiante; expone el id del estudiante.
pub struct Student {
    pub user_id: i64,
    pub student_id: i64,
}

impl FromRequestParts<AppState> for Student {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        match (user.role.as_str(), user.student_id) {
            ("student", Some(student_id)) => Ok(Student { user_id: user.user_id, student_id }),
            _ => Err(AppError::forbidden("Esta sección es solo para estudiantes")),
        }
    }
}

/// Requiere rol profesor; expone el id del profesor.
pub struct TeacherUser {
    pub teacher_id: i64,
}

impl FromRequestParts<AppState> for TeacherUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        match (user.role.as_str(), user.teacher_id) {
            ("teacher", Some(teacher_id)) => Ok(TeacherUser { teacher_id }),
            _ => Err(AppError::forbidden("Esta sección es solo para profesores")),
        }
    }
}
