use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

use crate::error::AmberError;

fn amber_dir() -> Result<PathBuf, AmberError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AmberError::Storage("Cannot find home directory".into()))?;
    Ok(home.join(".amber"))
}

pub async fn ensure_dirs() -> Result<(), AmberError> {
    let base = amber_dir()?;
    tokio::fs::create_dir_all(base.join("daily")).await?;
    tokio::fs::create_dir_all(base.join("staging")).await?;
    Ok(())
}

pub async fn read_daily_note(date: &str) -> Result<Option<String>, AmberError> {
    let path = amber_dir()?.join("daily").join(format!("{}.md", date));
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AmberError::Io(e)),
    }
}

pub async fn write_daily_note(date: &str, content: &str) -> Result<(), AmberError> {
    let path = amber_dir()?.join("daily").join(format!("{}.md", date));
    tokio::fs::write(&path, content).await?;
    Ok(())
}

pub async fn append_staging_event(date: &str, event: &str) -> Result<(), AmberError> {
    let path = amber_dir()?.join("staging").join(format!("{}.jsonl", date));
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await?;
    file.write_all(format!("{}\n", event).as_bytes()).await?;
    Ok(())
}

pub async fn read_staging_events(date: &str) -> Result<Vec<String>, AmberError> {
    let path = amber_dir()?.join("staging").join(format!("{}.jsonl", date));
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(content
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(AmberError::Io(e)),
    }
}

pub async fn clear_staging(date: &str) -> Result<(), AmberError> {
    let path = amber_dir()?.join("staging").join(format!("{}.jsonl", date));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AmberError::Io(e)),
    }
}
