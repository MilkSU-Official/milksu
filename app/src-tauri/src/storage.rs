use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none", alias = "tool_name")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    #[serde(alias = "created_at")]
    pub created_at: u64,
    pub messages: Vec<StoredMessage>,
}

fn conversations_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.milksu.app")
        .join("conversations");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn list_conversations() -> Vec<StoredConversation> {
    let dir = conversations_dir();
    let mut convs = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(conv) = serde_json::from_str::<StoredConversation>(&content) {
                        convs.push(conv);
                    }
                }
            }
        }
    }

    convs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    convs
}

pub fn save_conversation(conv: &StoredConversation) -> Result<(), String> {
    let dir = conversations_dir();
    let path = dir.join(format!("{}.json", conv.id));
    let json = serde_json::to_string_pretty(conv)
        .map_err(|e| format!("Failed to serialize conversation: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write conversation: {}", e))?;
    Ok(())
}

pub fn delete_conversation(id: &str) -> Result<(), String> {
    let path = conversations_dir().join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete conversation: {}", e))?;
    }
    Ok(())
}
