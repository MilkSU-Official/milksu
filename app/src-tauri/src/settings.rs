use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_provider")]
    pub active_provider: String,
    #[serde(default = "default_model")]
    pub active_model: String,
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
}

fn default_provider() -> String {
    "deepseek".to_string()
}

fn default_model() -> String {
    "deepseek-chat".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_provider: default_provider(),
            active_model: default_model(),
            providers: HashMap::new(),
        }
    }
}

fn settings_path() -> PathBuf {
    let home = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join("com.milksu.app");
    fs::create_dir_all(&dir).ok();
    dir.join("settings.json")
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    Ok(())
}
