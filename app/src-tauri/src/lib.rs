mod engagement;
mod settings;
mod storage;

use serde::{Deserialize, Serialize};
use settings::AppSettings;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use storage::StoredConversation;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct AgentMessage {
    conversation_id: String,
    role: String,
    content: String,
    tool_name: Option<String>,
    done: bool,
}

#[derive(Deserialize)]
struct BridgeEvent {
    #[serde(rename = "type")]
    event_type: String,
    id: Option<String>,
    delta: Option<String>,
    content: Option<String>,
    error: Option<String>,
    #[allow(dead_code)]
    reason: Option<String>,
    #[serde(rename = "toolName")]
    tool_name: Option<String>,
}

struct BridgeProcess {
    stdin: std::process::ChildStdin,
}

struct AppState {
    bridge: Mutex<Option<BridgeProcess>>,
    settings: Mutex<AppSettings>,
}

fn find_project_root() -> String {
    let exe = std::env::current_exe().unwrap_or_default();
    let mut dir = exe
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();

    for _ in 0..10 {
        if dir.join("bridge.js").exists() {
            return dir.to_string_lossy().to_string();
        }
        if let Some(parent) = dir.parent() {
            dir = parent.to_path_buf();
        } else {
            break;
        }
    }

    std::env::var("MILKSU_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    })
}

fn ensure_bridge(state: &AppState, app: &tauri::AppHandle) -> Result<(), String> {
    let mut guard = state.bridge.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let project_root = find_project_root();
    let bridge_path = format!("{}/bridge.js", project_root);

    let s = state.settings.lock().map_err(|e| e.to_string())?;
    let mut cmd = Command::new("node");
    cmd.arg(&bridge_path)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (name, provider) in &s.providers {
        if !provider.enabled || provider.api_key.is_empty() {
            continue;
        }
        let env_key = match name.as_str() {
            "anthropic" => "ANTHROPIC_API_KEY",
            "openai" => "OPENAI_API_KEY",
            "deepseek" => "DEEPSEEK_API_KEY",
            "google" => "GEMINI_API_KEY",
            "mistral" => "MISTRAL_API_KEY",
            "groq" => "GROQ_API_KEY",
            _ => continue,
        };
        cmd.env(env_key, &provider.api_key);
        if let Some(ref url) = provider.base_url {
            if !url.is_empty() {
                let url_key = format!("{}_BASE_URL", name.to_uppercase());
                cmd.env(&url_key, url);
            }
        }
    }
    drop(s);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn bridge: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture bridge stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture bridge stdout")?;

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            let event: BridgeEvent = match serde_json::from_str(&line) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let conv_id = event.id.clone().unwrap_or_default();

            match event.event_type.as_str() {
                "ready" => {
                    let _ = app_clone.emit("bridge-status", "ready");
                }
                "text_delta" => {
                    if let Some(delta) = event.delta {
                        let _ = app_clone.emit(
                            "agent-message",
                            AgentMessage {
                                conversation_id: conv_id,
                                role: "assistant_delta".to_string(),
                                content: delta,
                                tool_name: None,
                                done: false,
                            },
                        );
                    }
                }
                "message_done" => {
                    let _ = app_clone.emit(
                        "agent-message",
                        AgentMessage {
                            conversation_id: conv_id,
                            role: "assistant".to_string(),
                            content: event.content.unwrap_or_default(),
                            tool_name: None,
                            done: true,
                        },
                    );
                }
                "tool_call_start" => {
                    let _ = app_clone.emit(
                        "agent-message",
                        AgentMessage {
                            conversation_id: conv_id,
                            role: "tool".to_string(),
                            content: String::new(),
                            tool_name: event.tool_name,
                            done: false,
                        },
                    );
                }
                "tool_call_end" => {
                    let _ = app_clone.emit(
                        "agent-message",
                        AgentMessage {
                            conversation_id: conv_id,
                            role: "tool".to_string(),
                            content: event.content.unwrap_or_default(),
                            tool_name: event.tool_name,
                            done: true,
                        },
                    );
                }
                "error" => {
                    let _ = app_clone.emit(
                        "agent-message",
                        AgentMessage {
                            conversation_id: conv_id,
                            role: "assistant".to_string(),
                            content: format!("Error: {}", event.error.unwrap_or_default()),
                            tool_name: None,
                            done: true,
                        },
                    );
                }
                _ => {}
            }
        }
    });

    *guard = Some(BridgeProcess { stdin });
    Ok(())
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    prompt: String,
) -> Result<(), String> {
    ensure_bridge(&state, &app)?;

    let s = state.settings.lock().map_err(|e| e.to_string())?;
    let model = s.active_model.clone();
    let provider = s.active_provider.clone();
    drop(s);

    let mut guard = state.bridge.lock().map_err(|e| e.to_string())?;
    let bridge = guard.as_mut().ok_or("Bridge not initialized")?;

    let msg = serde_json::json!({
        "type": "prompt",
        "id": conversation_id,
        "text": prompt,
        "model": model,
        "provider": provider,
    });

    bridge
        .stdin
        .write_all(format!("{}\n", msg).as_bytes())
        .map_err(|e| format!("Failed to write to bridge: {}", e))?;
    bridge
        .stdin
        .flush()
        .map_err(|e| format!("Failed to flush bridge stdin: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
async fn save_settings_cmd(
    state: tauri::State<'_, AppState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    settings::save_settings(&new_settings)?;
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = new_settings;
    Ok(())
}

#[tauri::command]
async fn list_conversations() -> Result<Vec<StoredConversation>, String> {
    Ok(storage::list_conversations())
}

#[tauri::command]
async fn save_conversation(conversation: StoredConversation) -> Result<(), String> {
    storage::save_conversation(&conversation)
}

#[tauri::command]
async fn delete_conversation(id: String) -> Result<(), String> {
    storage::delete_conversation(&id)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let s = settings::load_settings();
            app.manage(AppState {
                bridge: Mutex::new(None),
                settings: Mutex::new(s),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_message,
            get_settings,
            save_settings_cmd,
            list_conversations,
            save_conversation,
            delete_conversation,
            engagement::create_engagement,
            engagement::get_engagement,
            engagement::update_engagement,
            engagement::list_engagements,
            engagement::delete_engagement,
            engagement::append_timeline_entry,
            engagement::merge_hosts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
