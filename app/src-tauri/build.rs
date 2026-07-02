fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "send_message",
            "get_settings",
            "save_settings_cmd",
            "list_conversations",
            "save_conversation",
            "delete_conversation",
            "create_engagement",
            "get_engagement",
            "update_engagement",
            "list_engagements",
            "delete_engagement",
            "append_timeline_entry",
            "merge_hosts",
        ]),
    ))
    .expect("failed to run tauri build script")
}
