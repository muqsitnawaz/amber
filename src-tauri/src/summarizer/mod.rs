pub mod daily;
pub mod provider;

use chrono::{Local, Timelike};
use log::{error, info};
use tauri::Listener;

use crate::config::AmberConfig;
use crate::error::AmberError;
use crate::storage;

pub fn run_scheduler(app_handle: tauri::AppHandle) {
    // Bridge the Tauri event to a tokio channel for the async scheduler loop
    let (manual_tx, mut manual_rx) = tokio::sync::mpsc::unbounded_channel::<()>();

    app_handle.listen("trigger-summarize", move |_| {
        let _ = manual_tx.send(());
    });

    tauri::async_runtime::spawn(async move {
        let config = match crate::config::load_or_default() {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to load config for scheduler: {}", e);
                return;
            }
        };

        let ingest_secs = (config.schedule.ingest_minutes as u64).max(1) * 60;
        let mut ingest_timer = tokio::time::interval(std::time::Duration::from_secs(ingest_secs));
        let mut check_timer =
            tokio::time::interval(std::time::Duration::from_secs(60));

        let mut last_daily_date = String::new();

        loop {
            tokio::select! {
                _ = ingest_timer.tick() => {
                    // Ingest tick - staging writes happen in the watcher receive loop,
                    // so this is a no-op placeholder for future buffer flushing.
                    info!("Ingest timer tick");
                }
                _ = check_timer.tick() => {
                    let now = Local::now();
                    let today = now.format("%Y-%m-%d").to_string();
                    if now.hour() == config.schedule.daily_hour && last_daily_date != today {
                        info!("Daily summarization triggered for {}", today);
                        last_daily_date.clone_from(&today);
                        if let Err(e) = summarize_day(&today, &config).await {
                            error!("Summarization failed: {}", e);
                        }
                    }
                }
                _ = manual_rx.recv() => {
                    let today = Local::now().format("%Y-%m-%d").to_string();
                    info!("Manual summarization triggered for {}", today);
                    if let Err(e) = summarize_day(&today, &config).await {
                        error!("Manual summarization failed: {}", e);
                    }
                }
            }
        }
    });
}

pub async fn summarize_day(date: &str, config: &AmberConfig) -> Result<(), AmberError> {
    let events = storage::read_staging_events(date).await?;
    if events.is_empty() {
        info!("No events to summarize for {}", date);
        return Ok(());
    }

    let note = daily::DailySummarizer::generate(date, events, &config.summarizer).await?;
    storage::write_daily_note(date, &note).await?;
    storage::clear_staging(date).await?;

    info!("Daily note written for {}", date);
    Ok(())
}
