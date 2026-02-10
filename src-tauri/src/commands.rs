use serde::Serialize;
use tauri::Emitter;

use crate::config::AmberConfig;
use crate::error::AmberError;
use crate::storage;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AppStatus {
    pub watchers_running: bool,
    pub buffered_events: usize,
    pub last_summarized: Option<String>,
}

#[tauri::command]
pub fn get_config() -> Result<AmberConfig, AmberError> {
    crate::config::load_or_default()
}

#[tauri::command]
pub fn update_config(config: AmberConfig) -> Result<(), AmberError> {
    config.save()
}

#[tauri::command]
pub async fn get_daily_note(date: String) -> Result<Option<String>, AmberError> {
    storage::read_daily_note(&date).await
}

#[tauri::command]
pub fn get_status(
    state: tauri::State<'_, std::sync::Mutex<AppState>>,
) -> Result<AppStatus, AmberError> {
    let state = state
        .lock()
        .map_err(|e| AmberError::Config(format!("Lock error: {}", e)))?;
    Ok(AppStatus {
        watchers_running: state.watchers_running,
        buffered_events: state.buffered_events,
        last_summarized: state.last_summarized.clone(),
    })
}

#[tauri::command]
pub fn trigger_summarize(app: tauri::AppHandle) -> Result<(), AmberError> {
    app.emit("trigger-summarize", ())
        .map_err(|e| AmberError::Config(format!("Emit error: {}", e)))?;
    Ok(())
}
