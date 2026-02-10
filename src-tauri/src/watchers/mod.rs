pub mod git;

use async_trait::async_trait;
use log::{error, info};
use serde::{Deserialize, Serialize};

use crate::error::AmberError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    pub source: String,
    pub timestamp: String,
    pub kind: EventKind,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventKind {
    Commit,
}

#[async_trait]
pub trait Watcher: Send {
    async fn start(&mut self, tx: tokio::sync::mpsc::Sender<RawEvent>) -> Result<(), AmberError>;
    fn stop(&mut self);
}

pub fn run_all(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = &app_handle; // keep handle alive for future use

        let config = match crate::config::load_or_default() {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to load config for watchers: {}", e);
                return;
            }
        };

        let (tx, mut rx) = tokio::sync::mpsc::channel::<RawEvent>(100);

        if config.sources.git.enabled {
            let mut git_watcher = git::GitWatcher::new(config.sources.git.clone());
            if let Err(e) = git_watcher.start(tx.clone()).await {
                error!("Failed to start git watcher: {}", e);
            } else {
                info!("Git watcher started");
            }
            // Leak the watcher to keep it alive for the process lifetime.
            // The debouncer and its file watches are dropped if GitWatcher is dropped.
            std::mem::forget(git_watcher);
        }

        // Drop our copy so rx closes when all watchers drop their senders
        drop(tx);

        // Receive loop: serialize events and append to staging JSONL
        while let Some(event) = rx.recv().await {
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();
            match serde_json::to_string(&event) {
                Ok(json) => {
                    if let Err(e) = crate::storage::append_staging_event(&date, &json).await {
                        error!("Failed to append staging event: {}", e);
                    }
                }
                Err(e) => {
                    error!("Failed to serialize event: {}", e);
                }
            }
        }
    });
}
