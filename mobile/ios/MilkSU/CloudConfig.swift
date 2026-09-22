import Foundation

/// Placeholder for the MilkSU iOS cloud client.
/// Generate Connect-Swift clients from cloud/agent/proto/cloud_session.proto.
enum MilkSUCloudConfig {
  static let accountAPI = URL(string: "https://accounts.milksu.org")!
  static let cloudAgentAPI = URL(string: "https://agent.milksu.org")!
}
