use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AmberError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmberConfig {
    pub sources: SourcesConfig,
    pub summarizer: SummarizerConfig,
    pub schedule: ScheduleConfig,
    pub storage: StorageConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourcesConfig {
    pub git: GitSourceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSourceConfig {
    pub watch_paths: Vec<String>,
    pub scan_depth: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizerConfig {
    pub provider: String,
    pub model: String,
    pub api_base: String,
    pub api_key_env: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleConfig {
    pub ingest_minutes: u32,
    pub daily_hour: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub base_dir: String,
}

impl Default for AmberConfig {
    fn default() -> Self {
        Self {
            sources: SourcesConfig {
                git: GitSourceConfig {
                    watch_paths: vec!["~/src".to_string()],
                    scan_depth: 3,
                    enabled: true,
                },
            },
            summarizer: SummarizerConfig {
                provider: "openai-compatible".to_string(),
                model: "gpt-4o-mini".to_string(),
                api_base: "https://api.openai.com/v1".to_string(),
                api_key_env: "OPENAI_API_KEY".to_string(),
            },
            schedule: ScheduleConfig {
                ingest_minutes: 15,
                daily_hour: 22,
            },
            storage: StorageConfig {
                base_dir: "~/.amber".to_string(),
            },
        }
    }
}

fn config_path() -> Result<PathBuf, AmberError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AmberError::Config("Cannot find home directory".into()))?;
    Ok(home.join(".amber").join("config.yaml"))
}

pub fn load_or_default() -> Result<AmberConfig, AmberError> {
    let path = config_path()?;
    if path.exists() {
        let contents = std::fs::read_to_string(&path)?;
        let config: AmberConfig = serde_yaml::from_str(&contents)?;
        Ok(config)
    } else {
        let config = AmberConfig::default();
        config.save()?;
        Ok(config)
    }
}

impl AmberConfig {
    pub fn save(&self) -> Result<(), AmberError> {
        let path = config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let yaml = serde_yaml::to_string(self)?;
        std::fs::write(path, yaml)?;
        Ok(())
    }
}
