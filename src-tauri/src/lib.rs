pub mod commands;
pub mod config;
pub mod error;
pub mod storage;
pub mod summarizer;
pub mod tray;
pub mod watchers;

use std::sync::Mutex;

pub struct AppState {
    pub config: config::AmberConfig,
    pub watchers_running: bool,
    pub buffered_events: usize,
    pub last_summarized: Option<String>,
}

impl AppState {
    pub fn new(config: config::AmberConfig) -> Mutex<Self> {
        Mutex::new(Self {
            config,
            watchers_running: false,
            buffered_events: 0,
            last_summarized: None,
        })
    }
}

pub fn run() {
    env_logger::init();

    let config = config::load_or_default().expect("Failed to load config");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new(config))
        .setup(|app| {
            // Ensure storage directories exist
            tauri::async_runtime::block_on(storage::ensure_dirs())
                .expect("Failed to create storage directories");

            // Set up system tray
            tray::setup(app)?;

            // Hide from dock, menu-bar-only app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Spawn background watchers and summarizer scheduler
            let handle = app.handle().clone();
            watchers::run_all(handle.clone());
            summarizer::run_scheduler(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::update_config,
            commands::get_daily_note,
            commands::get_status,
            commands::trigger_summarize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
