use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AmberError {
    #[error("Config error: {0}")]
    Config(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Watcher error: {0}")]
    Watcher(String),
    #[error("Provider error: {0}")]
    Provider(String),
    #[error("JSON error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for AmberError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
