use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use uuid::Uuid;

// -- Data Model --

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Engagement {
    pub id: String,
    pub name: String,
    pub scope: Vec<String>,
    pub status: EngagementStatus,
    pub created: String,
    pub updated: String,
    pub conversation_ids: Vec<String>,
    pub targets: Vec<Target>,
    pub credentials: Vec<Credential>,
    pub attack_paths: Vec<AttackPath>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngagementStatus {
    Active,
    Completed,
    Archived,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Target {
    pub id: String,
    #[serde(rename = "type")]
    pub target_type: TargetType,
    pub value: String,
    pub authorized: bool,
    pub hosts: Vec<Host>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetType {
    Host,
    Domain,
    Subnet,
    Url,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Host {
    pub ip: String,
    pub hostnames: Vec<String>,
    pub os: Option<String>,
    pub status: String,
    pub last_seen: Option<String>,
    pub services: Vec<Service>,
    pub vulnerabilities: Vec<Vulnerability>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Service {
    pub port: u16,
    pub protocol: String,
    pub state: String,
    pub service: String,
    pub version: Option<String>,
    pub banner: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vulnerability {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub proof: Option<String>,
    pub exploitable: bool,
    pub remediation: Option<String>,
    pub references: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Credential {
    pub id: String,
    pub username: String,
    pub secret: String,
    #[serde(rename = "type")]
    pub cred_type: String,
    pub source: String,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttackPath {
    pub id: String,
    pub name: String,
    pub impact: String,
    pub steps: Vec<AttackStep>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttackStep {
    pub order: u32,
    pub action: String,
    pub target: String,
    pub tool: String,
    pub result: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub timestamp: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub action: String,
    pub tool: String,
    pub target: String,
    pub result: String,
    pub conversation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngagementSummary {
    pub id: String,
    pub name: String,
    pub status: EngagementStatus,
    pub updated: String,
    pub host_count: usize,
    pub vuln_count: usize,
    pub cred_count: usize,
}

// -- Storage --

fn engagements_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.milksu.app")
        .join("engagements");
    fs::create_dir_all(&dir).ok();
    dir
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

// -- Tauri Commands --
// Each function below is a skeleton. Codex should implement the body.

#[tauri::command]
pub async fn create_engagement(name: String, scope: Vec<String>) -> Result<Engagement, String> {
    let engagement = Engagement {
        id: Uuid::new_v4().to_string(),
        name,
        scope,
        status: EngagementStatus::Active,
        created: now_iso(),
        updated: now_iso(),
        conversation_ids: Vec::new(),
        targets: Vec::new(),
        credentials: Vec::new(),
        attack_paths: Vec::new(),
        notes: Vec::new(),
    };

    let path = engagements_dir().join(format!("{}.json", engagement.id));
    let json =
        serde_json::to_string_pretty(&engagement).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Write error: {e}"))?;

    Ok(engagement)
}

#[tauri::command]
pub async fn get_engagement(id: String) -> Result<Engagement, String> {
    let path = engagements_dir().join(format!("{id}.json"));
    let data = fs::read_to_string(&path).map_err(|e| format!("Read error: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Parse error: {e}"))
}

#[tauri::command]
pub async fn update_engagement(engagement: Engagement) -> Result<(), String> {
    let path = engagements_dir().join(format!("{}.json", engagement.id));
    let json =
        serde_json::to_string_pretty(&engagement).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Write error: {e}"))
}

#[tauri::command]
pub async fn list_engagements() -> Result<Vec<EngagementSummary>, String> {
    let dir = engagements_dir();
    let mut summaries = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir error: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(eng) = serde_json::from_str::<Engagement>(&content) {
                    let vuln_count: usize = eng
                        .targets
                        .iter()
                        .flat_map(|t| &t.hosts)
                        .map(|h| h.vulnerabilities.len())
                        .sum();
                    let host_count: usize = eng.targets.iter().map(|t| t.hosts.len()).sum();

                    summaries.push(EngagementSummary {
                        id: eng.id,
                        name: eng.name,
                        status: eng.status,
                        updated: eng.updated,
                        host_count,
                        vuln_count,
                        cred_count: eng.credentials.len(),
                    });
                }
            }
        }
    }

    summaries.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(summaries)
}

#[tauri::command]
pub async fn delete_engagement(id: String) -> Result<(), String> {
    let path = engagements_dir().join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {e}"))?;
    }
    let timeline_path = engagements_dir().join(format!("{id}.timeline.jsonl"));
    if timeline_path.exists() {
        fs::remove_file(&timeline_path).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn append_timeline_entry(
    engagement_id: String,
    entry: TimelineEntry,
) -> Result<(), String> {
    let path = engagements_dir().join(format!("{engagement_id}.timeline.jsonl"));
    let line = serde_json::to_string(&entry).map_err(|e| format!("Serialize error: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Open error: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Write error: {e}"))
}

#[tauri::command]
pub async fn merge_hosts(engagement_id: String, hosts: Vec<Host>) -> Result<(), String> {
    let mut eng = get_engagement(engagement_id).await?;

    for new_host in hosts {
        let existing = eng
            .targets
            .iter_mut()
            .flat_map(|t| t.hosts.iter_mut())
            .find(|h| h.ip == new_host.ip);

        if let Some(existing) = existing {
            for svc in &new_host.services {
                if !existing
                    .services
                    .iter()
                    .any(|s| s.port == svc.port && s.protocol == svc.protocol)
                {
                    existing.services.push(svc.clone());
                }
            }
            for vuln in &new_host.vulnerabilities {
                if !existing.vulnerabilities.iter().any(|v| v.id == vuln.id) {
                    existing.vulnerabilities.push(vuln.clone());
                }
            }
            if new_host.os.is_some() {
                existing.os = new_host.os.clone();
            }
        } else {
            if eng.targets.is_empty() {
                eng.targets.push(Target {
                    id: Uuid::new_v4().to_string(),
                    target_type: TargetType::Subnet,
                    value: "discovered".to_string(),
                    authorized: true,
                    hosts: Vec::new(),
                });
            }
            eng.targets[0].hosts.push(new_host);
        }
    }

    eng.updated = now_iso();
    update_engagement(eng).await
}
