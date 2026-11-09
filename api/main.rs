//! Punto de entrada de la función de Vercel (y del servidor local de desarrollo).

use tower::ServiceBuilder;
use vercel_runtime::Error;
use vercel_runtime::axum::VercelLayer;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let _ = dotenvy::dotenv();
    let state = kim_training::AppState::from_env().await?;
    let app = kim_training::router(state);
    let service = ServiceBuilder::new().layer(VercelLayer::new()).service(app);
    vercel_runtime::run(service).await
}
