use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct AgentMessage {
    conversation_id: String,
    role: String,
    content: String,
    tool_name: Option<String>,
    done: bool,
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    prompt: String,
) -> Result<(), String> {
    let app_clone = app.clone();
    let conv_id = conversation_id.clone();

    tauri::async_runtime::spawn(async move {
        // TODO: replace with Pi agent subprocess
        // For now, echo back a mock response
        let response = format!("Received: \"{}\"\n\nThis is a mock response. Pi agent integration coming next.", prompt);

        let _ = app_clone.emit("agent-message", AgentMessage {
            conversation_id: conv_id,
            role: "assistant".to_string(),
            content: response,
            tool_name: None,
            done: true,
        });
    });

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![send_message])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
