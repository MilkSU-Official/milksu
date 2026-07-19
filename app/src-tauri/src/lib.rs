mod settings;
mod storage;

use serde::Deserialize;
use settings::AppSettings;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use storage::StoredConversation;
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
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
    #[serde(rename = "toolName")]
    tool_name: Option<String>,
}

struct BridgeProcess {
    stdin: std::process::ChildStdin,
}

struct AppState {
    bridge: Arc<Mutex<Option<BridgeProcess>>>,
    active_sessions: Arc<Mutex<HashSet<String>>>,
    settings: Mutex<AppSettings>,
}

fn find_project_root() -> String {
    let executable = std::env::current_exe().unwrap_or_default();
    let mut directory = executable
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();

    for _ in 0..10 {
        if directory.join("bridge.js").exists() {
            return directory.to_string_lossy().to_string();
        }
        if let Some(parent) = directory.parent() {
            directory = parent.to_path_buf();
        } else {
            break;
        }
    }

    std::env::var("MILKSU_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    })
}

fn ensure_bridge(state: &AppState, app: &tauri::AppHandle) -> Result<(), String> {
    let mut guard = state.bridge.lock().map_err(|error| error.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let project_root = find_project_root();
    let bridge_path = format!("{}/bridge.js", project_root);
    let settings = state.settings.lock().map_err(|error| error.to_string())?;

    let mut command = Command::new("node");
    command
        .arg(&bridge_path)
        .current_dir(&project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    for (name, provider) in &settings.providers {
        if !provider.enabled || provider.api_key.is_empty() {
            continue;
        }
        let environment_key = match name.as_str() {
            "anthropic" => "ANTHROPIC_API_KEY",
            "openai" => "OPENAI_API_KEY",
            "deepseek" => "DEEPSEEK_API_KEY",
            "google" => "GEMINI_API_KEY",
            "mistral" => "MISTRAL_API_KEY",
            "groq" => "GROQ_API_KEY",
            _ => continue,
        };
        command.env(environment_key, &provider.api_key);
        if let Some(url) = &provider.base_url {
            if !url.is_empty() {
                command.env(format!("{}_BASE_URL", name.to_uppercase()), url);
            }
        }
    }

    if let Some(relay) = &settings.relay {
        if relay.enabled && !relay.key.is_empty() {
            command.env("MILKSU_RELAY_ENABLED", "1");
            command.env("MILKSU_RELAY_KEY", &relay.key);
            if !relay.url.is_empty() {
                command.env("MILKSU_RELAY_URL", &relay.url);
            }
        }
    }
    drop(settings);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn bridge: {error}"))?;
    let stdin = child.stdin.take().ok_or("Failed to capture bridge stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture bridge stdout")?;

    state
        .active_sessions
        .lock()
        .map_err(|error| error.to_string())?
        .clear();

    let app_handle = app.clone();
    let bridge_reference = state.bridge.clone();
    let active_sessions_reference = state.active_sessions.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<BridgeEvent>(&line) else {
                continue;
            };
            let conversation_id = event.id.unwrap_or_default();

            let message = match event.event_type.as_str() {
                "text_delta" => event.delta.map(|content| AgentMessage {
                    conversation_id,
                    role: "assistant_delta".to_string(),
                    content,
                    tool_name: None,
                    done: false,
                }),
                "message_done" => Some(AgentMessage {
                    conversation_id,
                    role: "assistant".to_string(),
                    content: event.content.unwrap_or_default(),
                    tool_name: None,
                    done: true,
                }),
                "tool_call_start" => Some(AgentMessage {
                    conversation_id,
                    role: "tool".to_string(),
                    content: String::new(),
                    tool_name: event.tool_name,
                    done: false,
                }),
                "tool_call_end" => Some(AgentMessage {
                    conversation_id,
                    role: "tool".to_string(),
                    content: event.content.unwrap_or_default(),
                    tool_name: event.tool_name,
                    done: true,
                }),
                "error" => Some(AgentMessage {
                    conversation_id,
                    role: "assistant".to_string(),
                    content: format!("Error: {}", event.error.unwrap_or_default()),
                    tool_name: None,
                    done: true,
                }),
                _ => None,
            };

            if let Some(message) = message {
                let _ = app_handle.emit("agent-message", message);
            }
        }

        if let Ok(mut bridge) = bridge_reference.lock() {
            *bridge = None;
        }
        if let Ok(mut sessions) = active_sessions_reference.lock() {
            sessions.clear();
        }
        let _ = app_handle.emit("bridge-error", "Bridge process exited");
    });

    *guard = Some(BridgeProcess { stdin });
    Ok(())
}

fn write_bridge_command(
    bridge: &mut BridgeProcess,
    command: serde_json::Value,
) -> Result<(), String> {
    let line = serde_json::to_string(&command)
        .map_err(|error| format!("Failed to serialize bridge command: {error}"))?;
    bridge
        .stdin
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|error| format!("Failed to write to bridge: {error}"))?;
    bridge
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush bridge stdin: {error}"))
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    prompt: String,
) -> Result<(), String> {
    ensure_bridge(&state, &app)?;

    let settings = state.settings.lock().map_err(|error| error.to_string())?;
    let model = settings.active_model.clone();
    let provider = settings.active_provider.clone();
    drop(settings);

    let mut bridge_guard = state.bridge.lock().map_err(|error| error.to_string())?;
    let bridge = bridge_guard.as_mut().ok_or("Bridge not initialized")?;
    let mut active_sessions = state
        .active_sessions
        .lock()
        .map_err(|error| error.to_string())?;

    if !active_sessions.contains(&conversation_id) {
        write_bridge_command(
            bridge,
            serde_json::json!({
                "action": "create_session",
                "conversationId": conversation_id.clone(),
                "model": model,
                "provider": provider,
            }),
        )?;
        active_sessions.insert(conversation_id.clone());
    }

    write_bridge_command(
        bridge,
        serde_json::json!({
            "action": "send_message",
            "conversationId": conversation_id,
            "prompt": prompt,
        }),
    )
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_settings_cmd(
    state: tauri::State<'_, AppState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    settings::save_settings(&new_settings)?;
    let mut settings = state.settings.lock().map_err(|error| error.to_string())?;
    *settings = new_settings;
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
async fn delete_conversation(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    if let (Ok(mut bridge_guard), Ok(mut sessions)) =
        (state.bridge.lock(), state.active_sessions.lock())
    {
        if sessions.remove(&id) {
            if let Some(bridge) = bridge_guard.as_mut() {
                let _ = write_bridge_command(
                    bridge,
                    serde_json::json!({
                        "action": "destroy_session",
                        "conversationId": id.clone(),
                    }),
                );
            }
        }
    }
    storage::delete_conversation(&id)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState {
                bridge: Arc::new(Mutex::new(None)),
                active_sessions: Arc::new(Mutex::new(HashSet::new())),
                settings: Mutex::new(settings::load_settings()),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
