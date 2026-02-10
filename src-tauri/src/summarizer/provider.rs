use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AmberError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, messages: Vec<Message>) -> Result<String, AmberError>;
}

pub struct OpenAICompatibleProvider {
    pub api_base: String,
    pub model: String,
    pub api_key_env: String,
}

#[async_trait]
impl LlmProvider for OpenAICompatibleProvider {
    async fn complete(&self, messages: Vec<Message>) -> Result<String, AmberError> {
        let api_key = std::env::var(&self.api_key_env).map_err(|_| {
            AmberError::Provider(format!("Missing env var: {}", self.api_key_env))
        })?;

        let client = reqwest::Client::new();
        let url = format!("{}/chat/completions", self.api_base);

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
        });

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| AmberError::Provider(format!("Request failed: {}", e)))?;

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AmberError::Provider(format!("Failed to parse response: {}", e)))?;

        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| AmberError::Provider("No content in response".into()))
    }
}
