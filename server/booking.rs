//! Reglas de negocio de reservas: reservar, lista de espera, cancelar y reprogramar.
//!
//! Orden de bloqueos en todas las transacciones: primero la(s) clase(s) por id ascendente, luego
//! los implementos que aplican a su disciplina (por id) y por último la fila del estudiante.
//! Así se evitan sobrecupos (de clase y de implementos) y bloqueos mutuos.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use sqlx::{FromRow, PgConnection, PgPool};

use crate::error::{ApiResult, AppError};
use crate::models::{CONSUMING_STATUSES, SEAT_STATUSES, class_implements, implement_applies};

/// Horas mínimas de anticipación para cancelar con devolución o reprogramar.
pub const CANCEL_WINDOW_HOURS: i64 = 4;
/// Horas que dura una solicitud en lista de espera antes de vencer.
pub const WAITLIST_HOURS: i64 = 3;

struct LockedClass {
    id: i64,
    discipline_id: i64,
    starts_at: DateTime<Utc>,
    capacity: i32,
    cancelled: bool,
}

async fn lock_class(conn: &mut PgConnection, class_id: i64) -> ApiResult<LockedClass> {
    let row: Option<(i64, i64, DateTime<Utc>, i32, bool)> = sqlx::query_as(
        "SELECT id, discipline_id, starts_at, capacity, cancelled FROM classes WHERE id = $1 FOR UPDATE",
    )
    .bind(class_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (id, discipline_id, starts_at, capacity, cancelled) =
        row.ok_or_else(|| AppError::not_found("La clase no existe"))?;
    Ok(LockedClass { id, discipline_id, starts_at, capacity, cancelled })
}

async fn lock_student(conn: &mut PgConnection, student_id: i64) -> ApiResult<()> {
    sqlx::query("SELECT id FROM students WHERE id = $1 FOR UPDATE")
        .bind(student_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::not_found("El estudiante no existe"))?;
    Ok(())
}

/// Bloquea los implementos activos que aplican a las disciplinas dadas. El inventario es compartido
/// entre clases que se cruzan en el horario, así que se serializa por implemento y no solo por clase.
async fn lock_implements(conn: &mut PgConnection, discipline_ids: &[i64]) -> ApiResult<()> {
    sqlx::query(&format!(
        "SELECT i.id FROM implements i
         WHERE i.active AND EXISTS (SELECT 1 FROM unnest($1::bigint[]) AS d(id) WHERE {})
         ORDER BY i.id FOR UPDATE",
        implement_applies("d.id")
    ))
    .bind(discipline_ids)
    .fetch_all(&mut *conn)
    .await?;
    Ok(())
}

/// Implementos que debe apartar una reserva de `class_id` hecha con el plan `student_plan_id`:
/// los que incluye el plan y aplican a la disciplina de la clase.
/// `Err(nombre)` si alguno ya no tiene unidades libres en ese horario.
async fn implements_for(conn: &mut PgConnection, class_id: i64, student_plan_id: i64) -> ApiResult<Result<Vec<i64>, String>> {
    let included: Vec<(i64,)> =
        sqlx::query_as("SELECT implement_id FROM student_plan_implements WHERE student_plan_id = $1")
            .bind(student_plan_id)
            .fetch_all(&mut *conn)
            .await?;
    if included.is_empty() {
        return Ok(Ok(Vec::new()));
    }
    let mut ids = Vec::new();
    for usage in class_implements(conn, class_id).await? {
        if !included.iter().any(|(id,)| *id == usage.id) {
            continue;
        }
        if usage.available <= 0 {
            return Ok(Err(usage.name));
        }
        ids.push(usage.id);
    }
    Ok(Ok(ids))
}

fn no_implement_error(name: &str) -> AppError {
    AppError::conflict(
        "no_implement",
        format!("No hay unidades de \"{name}\" disponibles para este horario. Elige otro horario o comunícate con el estudio."),
    )
}

async fn attach_implements(conn: &mut PgConnection, booking_id: i64, implement_ids: &[i64]) -> ApiResult<()> {
    if implement_ids.is_empty() {
        return Ok(());
    }
    sqlx::query("INSERT INTO booking_implements (booking_id, implement_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING")
        .bind(booking_id)
        .bind(implement_ids)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn seats_taken(conn: &mut PgConnection, class_id: i64) -> ApiResult<i32> {
    let (n,): (i32,) = sqlx::query_as(&format!(
        "SELECT count(*)::int FROM bookings WHERE class_id = $1 AND status IN {SEAT_STATUSES}"
    ))
    .bind(class_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(n)
}

async fn ensure_discipline_enabled(conn: &mut PgConnection, student_id: i64, discipline_id: i64) -> ApiResult<()> {
    let enabled: Option<(i64,)> =
        sqlx::query_as("SELECT student_id FROM student_disciplines WHERE student_id = $1 AND discipline_id = $2")
            .bind(student_id)
            .bind(discipline_id)
            .fetch_optional(&mut *conn)
            .await?;
    if enabled.is_none() {
        return Err(AppError::forbidden("No tienes habilitada esta disciplina. Comunícate con el administrador."));
    }
    Ok(())
}

async fn ensure_no_active_booking(conn: &mut PgConnection, student_id: i64, class_id: i64) -> ApiResult<()> {
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM bookings WHERE class_id = $1 AND student_id = $2
         AND status IN ('booked','attended','noshow','waitlist') LIMIT 1",
    )
    .bind(class_id)
    .bind(student_id)
    .fetch_optional(&mut *conn)
    .await?;
    match existing.as_ref().map(|(s,)| s.as_str()) {
        None => Ok(()),
        Some("waitlist") => Err(AppError::conflict("already_waitlisted", "Ya estás en la lista de espera de esta clase")),
        Some(_) => Err(AppError::conflict("already_booked", "Ya tienes una reserva en esta clase")),
    }
}

/// Plan vigente para la fecha de la clase con clases disponibles. Con `only` se limita a ese plan;
/// sin él se toma el que vence primero.
async fn find_plan(conn: &mut PgConnection, student_id: i64, class_date: NaiveDate, only: Option<i64>) -> ApiResult<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as(&format!(
        "SELECT sp.id FROM student_plans sp
         WHERE sp.student_id = $1 AND sp.starts_on <= $2 AND sp.ends_on >= $2
           AND ($3::bigint IS NULL OR sp.id = $3)
           AND sp.total_classes > (SELECT count(*) FROM bookings b
                                   WHERE b.student_plan_id = sp.id AND b.status IN {CONSUMING_STATUSES})
         ORDER BY sp.ends_on ASC, sp.id ASC LIMIT 1"
    ))
    .bind(student_id)
    .bind(class_date)
    .bind(only)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Plan con el que se hace la reserva: el elegido (validado) o, si no se eligió, el que vence primero.
async fn pick_plan(conn: &mut PgConnection, student_id: i64, class_date: NaiveDate, chosen: Option<i64>) -> ApiResult<i64> {
    match find_plan(conn, student_id, class_date, chosen).await? {
        Some(id) => Ok(id),
        None if chosen.is_some() => Err(AppError::bad_request(
            "El plan elegido no está vigente para la fecha de la clase o ya no tiene clases disponibles",
        )),
        None => Err(no_plan_error()),
    }
}

/// Plan vigente con el que el estudiante puede tomar una clase.
#[derive(Debug, Serialize, FromRow)]
pub struct PlanOption {
    pub id: i64,
    pub name: String,
    pub remaining: i32,
    pub ends_on: NaiveDate,
    /// Implementos del plan que se apartarían en esta clase.
    pub implements: Vec<String>,
    /// false si alguno de esos implementos ya no tiene unidades libres en el horario.
    #[sqlx(skip)]
    pub implements_available: bool,
}

/// Planes con los que el estudiante puede reservar la clase (en el orden en que se usarían por defecto).
pub async fn plan_options(db: &PgPool, tz: &Tz, student_id: i64, class_id: i64) -> ApiResult<Vec<PlanOption>> {
    let mut conn = db.acquire().await?;
    let (starts_at,): (DateTime<Utc>,) = sqlx::query_as("SELECT starts_at FROM classes WHERE id = $1")
        .bind(class_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::not_found("La clase no existe"))?;
    let mut options = sqlx::query_as::<_, PlanOption>(&format!(
        "SELECT sp.id, sp.name, (sp.total_classes - u.used) AS remaining, sp.ends_on,
                coalesce((SELECT array_agg(i.name ORDER BY i.name) FROM student_plan_implements spi
                          JOIN implements i ON i.id = spi.implement_id
                          WHERE spi.student_plan_id = sp.id AND i.active AND {applies}), '{{}}') AS implements
         FROM classes c
         JOIN student_plans sp ON sp.student_id = $1 AND sp.starts_on <= $3 AND sp.ends_on >= $3
         CROSS JOIN LATERAL (
            SELECT count(*)::int AS used FROM bookings b
            WHERE b.student_plan_id = sp.id AND b.status IN {CONSUMING_STATUSES}
         ) u
         WHERE c.id = $2 AND sp.total_classes > u.used
         ORDER BY sp.ends_on ASC, sp.id ASC",
        applies = implement_applies("c.discipline_id"),
    ))
    .bind(student_id)
    .bind(class_id)
    .bind(starts_at.with_timezone(tz).date_naive())
    .fetch_all(&mut *conn)
    .await?;
    for o in &mut options {
        o.implements_available = implements_for(&mut conn, class_id, o.id).await?.is_ok();
    }
    Ok(options)
}

fn no_plan_error() -> AppError {
    AppError::conflict(
        "no_plan",
        "No tienes un plan vigente con clases disponibles para esa fecha. Comunícate con el estudio para renovarlo.",
    )
}

fn ensure_bookable(class: &LockedClass) -> ApiResult<()> {
    if class.cancelled {
        return Err(AppError::bad_request("Esta clase fue cancelada"));
    }
    if class.starts_at <= Utc::now() {
        return Err(AppError::bad_request("Esta clase ya comenzó o terminó"));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct BookingResult {
    pub booking_id: i64,
    pub status: String,
}

/// Reserva una clase para el estudiante y descuenta 1 clase del plan elegido (o del que vence primero).
pub async fn book(db: &PgPool, tz: &Tz, student_id: i64, class_id: i64, plan_id: Option<i64>) -> ApiResult<BookingResult> {
    let mut tx = db.begin().await?;
    let class = lock_class(&mut tx, class_id).await?;
    lock_implements(&mut tx, &[class.discipline_id]).await?;
    lock_student(&mut tx, student_id).await?;
    ensure_bookable(&class)?;
    ensure_discipline_enabled(&mut tx, student_id, class.discipline_id).await?;
    ensure_no_active_booking(&mut tx, student_id, class.id).await?;
    if seats_taken(&mut tx, class.id).await? >= class.capacity {
        return Err(AppError::conflict("class_full", "La clase ya no tiene cupos disponibles"));
    }
    let plan_id = pick_plan(&mut tx, student_id, class.starts_at.with_timezone(tz).date_naive(), plan_id).await?;
    let implement_ids = implements_for(&mut tx, class.id, plan_id).await?.map_err(|n| no_implement_error(&n))?;
    let (booking_id,): (i64,) = sqlx::query_as(
        "INSERT INTO bookings (class_id, student_id, student_plan_id, status) VALUES ($1, $2, $3, 'booked') RETURNING id",
    )
    .bind(class.id)
    .bind(student_id)
    .bind(plan_id)
    .fetch_one(&mut *tx)
    .await?;
    attach_implements(&mut tx, booking_id, &implement_ids).await?;
    tx.commit().await?;
    Ok(BookingResult { booking_id, status: "booked".into() })
}

#[derive(Serialize)]
pub struct WaitlistResult {
    pub booking_id: i64,
    pub position: i32,
    pub expires_at: DateTime<Utc>,
}

/// Agrega al estudiante a la lista de espera de una clase llena. Si elige plan, se guarda en la
/// solicitud (no consume hasta que se libere el cupo) y es el que se usa al pasar a reservada.
pub async fn join_waitlist(db: &PgPool, tz: &Tz, student_id: i64, class_id: i64, plan_id: Option<i64>) -> ApiResult<WaitlistResult> {
    expire_waitlists(db).await?;
    let mut tx = db.begin().await?;
    let class = lock_class(&mut tx, class_id).await?;
    lock_student(&mut tx, student_id).await?;
    ensure_bookable(&class)?;
    ensure_discipline_enabled(&mut tx, student_id, class.discipline_id).await?;
    ensure_no_active_booking(&mut tx, student_id, class.id).await?;
    if seats_taken(&mut tx, class.id).await? < class.capacity {
        return Err(AppError::conflict("has_seats", "La clase tiene cupos disponibles, puedes reservarla directamente"));
    }
    let chosen = pick_plan(&mut tx, student_id, class.starts_at.with_timezone(tz).date_naive(), plan_id).await?;
    let (booking_id, created_at): (i64, DateTime<Utc>) = sqlx::query_as(
        "INSERT INTO bookings (class_id, student_id, student_plan_id, status) VALUES ($1, $2, $3, 'waitlist') RETURNING id, created_at",
    )
    .bind(class.id)
    .bind(student_id)
    .bind(plan_id.map(|_| chosen))
    .fetch_one(&mut *tx)
    .await?;
    let (position,): (i32,) = sqlx::query_as(
        "SELECT count(*)::int FROM bookings WHERE class_id = $1 AND status = 'waitlist' AND id <= $2",
    )
    .bind(class.id)
    .bind(booking_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let expires_at = (created_at + Duration::hours(WAITLIST_HOURS)).min(class.starts_at);
    Ok(WaitlistResult { booking_id, position, expires_at })
}

#[derive(Serialize)]
pub struct CancelResult {
    pub status: String,
    /// true si la clase se devolvió al plan.
    pub refunded: bool,
}

struct OwnedBooking {
    id: i64,
    class_id: i64,
    status: String,
    student_plan_id: Option<i64>,
}

async fn load_booking(conn: &mut PgConnection, booking_id: i64, student_id: i64) -> ApiResult<OwnedBooking> {
    let row: Option<(i64, i64, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, class_id, status, student_plan_id FROM bookings WHERE id = $1 AND student_id = $2",
    )
    .bind(booking_id)
    .bind(student_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (id, class_id, status, student_plan_id) = row.ok_or_else(|| AppError::not_found("La reserva no existe"))?;
    Ok(OwnedBooking { id, class_id, status, student_plan_id })
}

/// Cancela una reserva o una solicitud de lista de espera.
/// Con al menos 4 horas de anticipación la clase vuelve al plan; después se marca como cancelación tardía.
pub async fn cancel(db: &PgPool, tz: &Tz, student_id: i64, booking_id: i64) -> ApiResult<CancelResult> {
    cancel_with(db, tz, student_id, booking_id, None).await
}

/// Cancelación hecha por el administrador: él decide si la clase vuelve al plan (`refund`),
/// sin importar la ventana de 4 horas. La moto u otros implementos se liberan igual.
pub async fn admin_cancel(db: &PgPool, tz: &Tz, booking_id: i64, refund: bool) -> ApiResult<CancelResult> {
    let (student_id,): (i64,) = sqlx::query_as("SELECT student_id FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("La reserva no existe"))?;
    cancel_with(db, tz, student_id, booking_id, Some(refund)).await
}

/// `refund`: `None` aplica la regla de anticipación del estudiante; `Some` la fija el administrador.
async fn cancel_with(db: &PgPool, tz: &Tz, student_id: i64, booking_id: i64, refund: Option<bool>) -> ApiResult<CancelResult> {
    let mut tx = db.begin().await?;
    let peek = load_booking(&mut tx, booking_id, student_id).await?;
    let class = lock_class(&mut tx, peek.class_id).await?;
    lock_implements(&mut tx, &[class.discipline_id]).await?;
    lock_student(&mut tx, student_id).await?;
    let booking = load_booking(&mut tx, booking_id, student_id).await?;

    let result = match booking.status.as_str() {
        "waitlist" => {
            set_status(&mut tx, booking.id, "cancelled").await?;
            CancelResult { status: "cancelled".into(), refunded: true }
        }
        "booked" => {
            if class.starts_at <= Utc::now() {
                return Err(AppError::bad_request("La clase ya comenzó, no se puede cancelar"));
            }
            let on_time = refund.unwrap_or_else(|| class.starts_at - Utc::now() >= Duration::hours(CANCEL_WINDOW_HOURS));
            let status = if on_time { "cancelled" } else { "late_cancel" };
            set_status(&mut tx, booking.id, status).await?;
            promote_waitlist(&mut tx, tz, class.id, class.capacity).await?;
            CancelResult { status: status.into(), refunded: on_time }
        }
        _ => return Err(AppError::bad_request("Esta reserva ya no se puede cancelar")),
    };
    tx.commit().await?;
    Ok(result)
}

/// Mueve una reserva a otra clase de la misma disciplina (mín. 4 horas antes de la clase original).
pub async fn reschedule(db: &PgPool, tz: &Tz, student_id: i64, booking_id: i64, new_class_id: i64) -> ApiResult<BookingResult> {
    let mut tx = db.begin().await?;
    let peek = load_booking(&mut tx, booking_id, student_id).await?;
    if peek.class_id == new_class_id {
        return Err(AppError::bad_request("Elige un horario diferente al actual"));
    }
    // Bloqueo en orden de id para evitar interbloqueos.
    let (first, second) = if peek.class_id < new_class_id { (peek.class_id, new_class_id) } else { (new_class_id, peek.class_id) };
    let a = lock_class(&mut tx, first).await?;
    let b = lock_class(&mut tx, second).await?;
    let (old_class, new_class) = if a.id == peek.class_id { (a, b) } else { (b, a) };
    lock_implements(&mut tx, &[old_class.discipline_id, new_class.discipline_id]).await?;
    lock_student(&mut tx, student_id).await?;
    let booking = load_booking(&mut tx, booking_id, student_id).await?;

    if booking.status != "booked" {
        return Err(AppError::bad_request("Solo puedes reprogramar reservas activas"));
    }
    if old_class.starts_at - Utc::now() < Duration::hours(CANCEL_WINDOW_HOURS) {
        return Err(AppError::bad_request(format!(
            "Solo puedes reprogramar con al menos {CANCEL_WINDOW_HOURS} horas de anticipación"
        )));
    }
    if new_class.discipline_id != old_class.discipline_id {
        return Err(AppError::bad_request("Solo puedes reprogramar a una clase de la misma disciplina"));
    }
    ensure_bookable(&new_class)?;
    ensure_discipline_enabled(&mut tx, student_id, new_class.discipline_id).await?;
    ensure_no_active_booking(&mut tx, student_id, new_class.id).await?;
    if seats_taken(&mut tx, new_class.id).await? >= new_class.capacity {
        return Err(AppError::conflict("class_full", "El nuevo horario ya no tiene cupos"));
    }

    set_status(&mut tx, booking.id, "cancelled").await?;
    let new_date = new_class.starts_at.with_timezone(tz).date_naive();
    // Se conserva el mismo plan si cubre la nueva fecha; si no, se busca otro vigente.
    let same_plan_ok = match booking.student_plan_id {
        Some(pid) => {
            let ok: Option<(i64,)> =
                sqlx::query_as("SELECT id FROM student_plans WHERE id = $1 AND starts_on <= $2 AND ends_on >= $2")
                    .bind(pid)
                    .bind(new_date)
                    .fetch_optional(&mut *tx)
                    .await?;
            ok.map(|(id,)| id)
        }
        None => None,
    };
    let plan_id = match same_plan_ok {
        Some(id) => id,
        None => pick_plan(&mut tx, student_id, new_date, None).await?,
    };
    // La reserva anterior ya quedó cancelada: su implemento cuenta como libre si los horarios se cruzan.
    let implement_ids = implements_for(&mut tx, new_class.id, plan_id).await?.map_err(|n| no_implement_error(&n))?;
    let (new_id,): (i64,) = sqlx::query_as(
        "INSERT INTO bookings (class_id, student_id, student_plan_id, status, rescheduled_from)
         VALUES ($1, $2, $3, 'booked', $4) RETURNING id",
    )
    .bind(new_class.id)
    .bind(student_id)
    .bind(plan_id)
    .bind(booking.id)
    .fetch_one(&mut *tx)
    .await?;
    attach_implements(&mut tx, new_id, &implement_ids).await?;
    promote_waitlist(&mut tx, tz, old_class.id, old_class.capacity).await?;
    tx.commit().await?;
    Ok(BookingResult { booking_id: new_id, status: "booked".into() })
}

async fn set_status(conn: &mut PgConnection, booking_id: i64, status: &str) -> ApiResult<()> {
    sqlx::query("UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1")
        .bind(booking_id)
        .bind(status)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Si hay cupos libres, pasa a "reservada" a la(s) primera(s) persona(s) de la lista de espera
/// que tengan plan vigente. Quien no tenga plan vence; quien necesite un implemento sin unidades
/// libres sigue en espera y se pasa a la siguiente persona. La clase debe estar bloqueada por el llamador.
pub async fn promote_waitlist(conn: &mut PgConnection, tz: &Tz, class_id: i64, capacity: i32) -> ApiResult<()> {
    let (starts_at, discipline_id): (DateTime<Utc>, i64) =
        sqlx::query_as("SELECT starts_at, discipline_id FROM classes WHERE id = $1")
            .bind(class_id)
            .fetch_one(&mut *conn)
            .await?;
    if starts_at <= Utc::now() {
        return Ok(());
    }
    // Antes que cualquier estudiante, para respetar el orden de bloqueos.
    lock_implements(conn, &[discipline_id]).await?;
    let class_date = starts_at.with_timezone(tz).date_naive();
    let waiting: Vec<(i64, i64, Option<i64>)> = sqlx::query_as(&format!(
        "SELECT id, student_id, student_plan_id FROM bookings
         WHERE class_id = $1 AND status = 'waitlist' AND created_at > now() - interval '{WAITLIST_HOURS} hours'
         ORDER BY created_at, id"
    ))
    .bind(class_id)
    .fetch_all(&mut *conn)
    .await?;
    for (waiting_id, waiting_student, chosen_plan) in waiting {
        if seats_taken(conn, class_id).await? >= capacity {
            return Ok(());
        }
        lock_student(conn, waiting_student).await?;
        // Si eligió plan al entrar a la lista, solo se usa ese (no se cambia a otro sin preguntarle).
        let Some(plan_id) = find_plan(conn, waiting_student, class_date, chosen_plan).await? else {
            set_status(conn, waiting_id, "expired").await?;
            continue;
        };
        let Ok(implement_ids) = implements_for(conn, class_id, plan_id).await? else {
            continue;
        };
        sqlx::query("UPDATE bookings SET status = 'booked', student_plan_id = $2, updated_at = now() WHERE id = $1")
            .bind(waiting_id)
            .bind(plan_id)
            .execute(&mut *conn)
            .await?;
        attach_implements(conn, waiting_id, &implement_ids).await?;
    }
    Ok(())
}

/// Vence las solicitudes de lista de espera con más de 3 horas o de clases que ya empezaron.
/// Se ejecuta de forma perezosa antes de las consultas que muestran listas de espera.
pub async fn expire_waitlists(db: &PgPool) -> ApiResult<()> {
    sqlx::query(&format!(
        "UPDATE bookings b SET status = 'expired', updated_at = now()
         FROM classes c
         WHERE c.id = b.class_id AND b.status = 'waitlist'
           AND (b.created_at <= now() - interval '{WAITLIST_HOURS} hours' OR c.starts_at <= now() OR c.cancelled)"
    ))
    .execute(db)
    .await?;
    Ok(())
}
