use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use log::{error, info, warn};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};

use crate::config::GitSourceConfig;
use crate::error::AmberError;
use crate::watchers::{EventKind, RawEvent, Watcher};

pub struct GitWatcher {
    config: GitSourceConfig,
    running: Arc<AtomicBool>,
    // Hold the debouncer so file watches stay active
    _debouncer: Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>,
}

impl GitWatcher {
    pub fn new(config: GitSourceConfig) -> Self {
        Self {
            config,
            running: Arc::new(AtomicBool::new(false)),
            _debouncer: None,
        }
    }
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

fn discover_repos(config: &GitSourceConfig) -> Result<Vec<PathBuf>, AmberError> {
    let mut repos = Vec::new();
    for watch_path in &config.watch_paths {
        let expanded = expand_tilde(watch_path);
        if expanded.is_dir() {
            walk_for_repos(&expanded, config.scan_depth, &mut repos)?;
        }
    }
    Ok(repos)
}

fn walk_for_repos(dir: &Path, depth: u32, repos: &mut Vec<PathBuf>) -> Result<(), AmberError> {
    if depth == 0 {
        return Ok(());
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name == "node_modules" || name == "target" || name == ".git" {
            continue;
        }
        if path.join(".git").is_dir() {
            repos.push(path.clone());
        }
        walk_for_repos(&path, depth - 1, repos)?;
    }
    Ok(())
}

fn repo_from_event_path(path: &Path, known_repos: &[PathBuf]) -> Option<PathBuf> {
    for repo in known_repos {
        if path.starts_with(repo) {
            return Some(repo.clone());
        }
    }
    None
}

async fn get_recent_commits(
    repo: &Path,
) -> Result<Vec<(String, String, String, String)>, AmberError> {
    let output = tokio::process::Command::new("git")
        .args(["log", "--format=%H|%s|%an|%ai", "-20"])
        .current_dir(repo)
        .output()
        .await
        .map_err(|e| AmberError::Watcher(format!("Failed to run git log: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() == 4 {
                Some((
                    parts[0].to_string(),
                    parts[1].to_string(),
                    parts[2].to_string(),
                    parts[3].to_string(),
                ))
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

#[async_trait]
impl Watcher for GitWatcher {
    async fn start(
        &mut self,
        tx: tokio::sync::mpsc::Sender<RawEvent>,
    ) -> Result<(), AmberError> {
        self.running.store(true, Ordering::SeqCst);

        let repos = discover_repos(&self.config)?;
        if repos.is_empty() {
            warn!("No git repos found under watch paths");
            return Ok(());
        }

        info!("Discovered {} git repos", repos.len());

        // Bridge notify's sync callbacks to tokio via an unbounded channel
        let (debounce_tx, mut debounce_rx) =
            tokio::sync::mpsc::unbounded_channel::<DebounceEventResult>();

        let mut debouncer =
            new_debouncer(Duration::from_secs(2), move |result: DebounceEventResult| {
                let _ = debounce_tx.send(result);
            })
            .map_err(|e| AmberError::Watcher(format!("Failed to create debouncer: {}", e)))?;

        // Watch .git/refs/heads/ for each discovered repo
        for repo in &repos {
            let refs_path = repo.join(".git").join("refs").join("heads");
            if refs_path.exists() {
                if let Err(e) = debouncer.watcher().watch(&refs_path, RecursiveMode::Recursive) {
                    warn!("Failed to watch {}: {}", refs_path.display(), e);
                }
            }
        }

        self._debouncer = Some(debouncer);

        let running = self.running.clone();
        let repos_clone = repos;

        tauri::async_runtime::spawn(async move {
            let mut last_seen: HashMap<PathBuf, String> = HashMap::new();

            while running.load(Ordering::SeqCst) {
                match debounce_rx.recv().await {
                    Some(Ok(events)) => {
                        // Deduplicate repos from this batch of events
                        let mut changed_repos = Vec::new();
                        for event in &events {
                            if let Some(repo) =
                                repo_from_event_path(&event.path, &repos_clone)
                            {
                                if !changed_repos.contains(&repo) {
                                    changed_repos.push(repo);
                                }
                            }
                        }

                        for repo in changed_repos {
                            match get_recent_commits(&repo).await {
                                Ok(commits) => {
                                    let last = last_seen.get(&repo).cloned();
                                    for (hash, subject, author, date) in &commits {
                                        // Stop at the last known commit
                                        if let Some(ref last_hash) = last {
                                            if hash == last_hash {
                                                break;
                                            }
                                        }
                                        let raw_event = RawEvent {
                                            source: "git".to_string(),
                                            timestamp: date.clone(),
                                            kind: EventKind::Commit,
                                            data: serde_json::json!({
                                                "repo": repo.display().to_string(),
                                                "hash": hash,
                                                "subject": subject,
                                                "author": author,
                                            }),
                                        };
                                        if tx.send(raw_event).await.is_err() {
                                            return;
                                        }
                                    }
                                    if let Some((hash, _, _, _)) = commits.first() {
                                        last_seen.insert(repo.clone(), hash.clone());
                                    }
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to get commits for {}: {}",
                                        repo.display(),
                                        e
                                    );
                                }
                            }
                        }
                    }
                    Some(Err(err)) => {
                        error!("Debouncer error: {:?}", err);
                    }
                    None => break,
                }
            }
        });

        Ok(())
    }

    fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self._debouncer = None;
    }
}
