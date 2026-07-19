fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "send_message",
            "get_settings",
            "save_settings_cmd",
            "list_conversations",
            "save_conversation",
            "delete_conversation",
        ]),
    ))
    .expect("failed to run tauri build script")
}
