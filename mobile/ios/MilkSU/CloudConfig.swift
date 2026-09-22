import Foundation

/// MilkSU iOS cloud client config + Connect-JSON unary helper.
/// Prefer generated Connect-Swift stubs from cloud/agent/proto when buf generate lands;
/// until then this mirrors the desktop Connect-JSON wire (same as cloud/agent Worker).

enum MilkSUCloudConfig {
  static let accountAPI = URL(string: "https://accounts.milksu.org")!
  static let cloudAgentAPI = URL(string: "https://agent.milksu.org")!
  static let service = "milksu.cloud.v1.CloudSessionService"
}

enum MilkSUCloudAgentError: Error {
  case notSignedIn
  case http(status: Int, message: String)
  case decode
}

struct MilkSUCloudSession: Decodable {
  let id: String
  let title: String
  let kernel: String
  let model: String
  let status: String
}

final class MilkSUCloudAgentClient {
  private let baseURL: URL
  private let accessToken: () async -> String?
  private let session: URLSession

  init(
    baseURL: URL = MilkSUCloudConfig.cloudAgentAPI,
    accessToken: @escaping () async -> String?,
    session: URLSession = .shared
  ) {
    self.baseURL = baseURL
    self.accessToken = accessToken
    self.session = session
  }

  func listSessions() async throws -> [MilkSUCloudSession] {
    let body = try await call(method: "ListSessions", body: [:]) as [String: Any]
    guard let rows = body["sessions"] as? [[String: Any]] else { return [] }
    let data = try JSONSerialization.data(withJSONObject: rows)
    return try JSONDecoder().decode([MilkSUCloudSession].self, from: data)
  }

  func createSession(kernel: String = "pi", model: String = "", title: String = "") async throws -> MilkSUCloudSession {
    let body = try await call(method: "CreateSession", body: [
      "kernel": kernel,
      "model": model,
      "title": title,
      "credential_id": "",
    ]) as [String: Any]
    let data = try JSONSerialization.data(withJSONObject: body)
    return try JSONDecoder().decode(MilkSUCloudSession.self, from: data)
  }

  func migrateCopy(sourceSessionId: String, transcriptJSON: String) async throws -> String {
    let body = try await call(method: "MigrateCopy", body: [
      "source_session_id": sourceSessionId,
      "direction": "local_to_cloud",
      "transcript_json": transcriptJSON,
    ]) as [String: Any]
    guard body["ok"] as? Bool == true,
          let target = body["target_session_id"] as? String,
          !target.isEmpty else {
      throw MilkSUCloudAgentError.http(status: 400, message: String(describing: body["error"] ?? "migrate copy failed"))
    }
    return target
  }

  @discardableResult
  func migrateFinalize(sourceSessionId: String, targetSessionId: String) async throws -> Bool {
    let body = try await call(method: "MigrateFinalize", body: [
      "source_session_id": sourceSessionId,
      "target_session_id": targetSessionId,
      "direction": "local_to_cloud",
    ]) as [String: Any]
    return body["ok"] as? Bool == true
  }

  private func call(method: String, body: [String: Any]) async throws -> Any {
    guard let token = await accessToken(), !token.isEmpty else {
      throw MilkSUCloudAgentError.notSignedIn
    }
    var request = URLRequest(url: baseURL.appendingPathComponent("\(MilkSUCloudConfig.service)/\(method)"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("1", forHTTPHeaderField: "Connect-Protocol-Version")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    let json = try JSONSerialization.jsonObject(with: data)
    if status < 200 || status >= 300 {
      let message = (json as? [String: Any])?["message"] as? String ?? "Cloud Agent \(method) failed"
      throw MilkSUCloudAgentError.http(status: status, message: message)
    }
    return json
  }
}
