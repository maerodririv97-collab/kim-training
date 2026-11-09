mod admin_catalog;
mod admin_classes;
mod admin_disciplines;
mod admin_implements;
mod admin_people;
mod admin_reports;
mod auth;
mod invites;
mod student;
mod teacher;

use axum::Router;
use axum::http::{HeaderValue, header};
use axum::response::IntoResponse;
use axum::routing::get;
use serde_json::json;

use crate::AppState;
use crate::error::AppError;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .merge(auth::routes())
        .merge(student::routes())
        .merge(teacher::routes())
        .nest(
            "/admin",
            Router::new()
                .merge(admin_classes::routes())
                .merge(admin_people::routes())
                .merge(admin_catalog::routes())
                .merge(admin_disciplines::routes())
                .merge(admin_implements::routes())
                .merge(invites::admin_routes())
                .merge(admin_reports::routes()),
        )
        .merge(admin_disciplines::public_routes())
        .merge(invites::public_routes())
        .fallback(|| async { AppError::not_found("Ruta no encontrada") });

    Router::new()
        .nest("/api", api)
        .layer(axum::middleware::map_response(no_store))
        .with_state(state)
}

async fn health(axum::extract::State(state): axum::extract::State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    axum::Json(json!({ "ok": true, "db": db_ok }))
}

/// Las respuestas de la API dependen del usuario: nunca se cachean en el CDN.
async fn no_store(mut res: axum::response::Response) -> axum::response::Response {
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}
