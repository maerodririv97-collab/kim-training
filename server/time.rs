use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

use crate::error::{ApiResult, AppError};

pub fn today(tz: &Tz) -> NaiveDate {
    Utc::now().with_timezone(tz).date_naive()
}

/// Convierte fecha + hora locales del estudio a UTC.
pub fn local_to_utc(tz: &Tz, date: NaiveDate, time: NaiveTime) -> ApiResult<DateTime<Utc>> {
    tz.from_local_datetime(&NaiveDateTime::new(date, time))
        .earliest()
        .map(|dt| dt.with_timezone(&Utc))
        .ok_or_else(|| AppError::bad_request("Fecha u hora inválida para la zona horaria del estudio"))
}

/// Rango UTC [inicio del día `from`, inicio del día siguiente a `to`) en hora local.
pub fn local_range(tz: &Tz, from: NaiveDate, to: NaiveDate) -> ApiResult<(DateTime<Utc>, DateTime<Utc>)> {
    let start = local_to_utc(tz, from, NaiveTime::MIN)?;
    let end = local_to_utc(tz, to + Duration::days(1), NaiveTime::MIN)?;
    Ok((start, end))
}

pub fn parse_date(s: &str) -> ApiResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::bad_request("Fecha inválida (formato AAAA-MM-DD)"))
}

pub fn parse_time(s: &str) -> ApiResult<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").map_err(|_| AppError::bad_request("Hora inválida (formato HH:MM)"))
}
