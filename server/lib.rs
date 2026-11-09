//! API de KIM Solutions - Training: control de clases, reservas, profesores, estudiantes y planes.

pub mod auth;
pub mod booking;
pub mod error;
pub mod models;
pub mod routes;
pub mod time;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use chrono_tz::Tz;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

pub use routes::router;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cfg: Arc<Config>,
}

pub struct Config {
    pub jwt_secret: String,
    pub tz: Tz,
    pub tz_name: String,
    /// Cookies con `Secure` (en Vercel siempre hay HTTPS).
    pub secure_cookies: bool,
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

impl AppState {
    pub async fn from_env() -> Result<Self, BoxError> {
        let url = std::env::var("DATABASE_URL").map_err(|_| "Falta la variable DATABASE_URL")?;
        let jwt_secret = std::env::var("JWT_SECRET").map_err(|_| "Falta la variable JWT_SECRET")?;
        if jwt_secret.len() < 32 {
            return Err("JWT_SECRET debe tener al menos 32 caracteres".into());
        }
        let tz_name = std::env::var("STUDIO_TZ").unwrap_or_else(|_| "America/Bogota".to_string());
        let tz: Tz = tz_name.parse().map_err(|_| format!("STUDIO_TZ inválida: {tz_name}"))?;

        // Conexión perezosa: la función arranca aunque la base tarde en despertar (Neon escala a cero).
        let db = PgPoolOptions::new()
            .max_connections(5)
            .min_connections(0)
            .acquire_timeout(Duration::from_secs(10))
            .idle_timeout(Duration::from_secs(60))
            .connect_lazy(&url)?;

        Ok(Self {
            db,
            cfg: Arc::new(Config {
                jwt_secret,
                tz,
                tz_name,
                secure_cookies: std::env::var("VERCEL").is_ok(),
            }),
        })
    }
}

pub type AppRouter = Router<AppState>;
