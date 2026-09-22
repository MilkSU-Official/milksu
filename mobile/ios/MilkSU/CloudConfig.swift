import Foundation

/// MilkSU iOS cloud client config + Connect-JSON helper.
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
  case stream
}

struct MilkSUCloudSession: Decodable, Identifiable, Hashable {
  let id: String
  let title: String
  let kernel: String
  let model: String
  let status: String
}

struct MilkSUCloudSessionEvent: Identifiable {
  let id: String
  let type: String
  let sessionId: String
  let turnId: String
  let timestampMs: Int64
  let jsonPayload: String

  var text: String {
    guard let data = jsonPayload.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let text = obj["text"] as? String else { return "" }
    return text
  }
}

/// Connect enveloped-message flags (https://connectrpc.com/docs/protocol/).
private let connectFlagEndStream: UInt8 = 0x02

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

  @discardableResult
  func sendTurn(sessionId: String, text: String) async throws -> String {
    let body = try await call(method: "SendTurn", body: [
      "session_id": sessionId,
      "text": text,
      "attachment_ids": [] as [String],
    ]) as [String: Any]
    return String(body["turn_id"] as? String ?? "")
  }

  /// Server-stream Subscribe. Calls onEvent for each SessionEvent until EndStream.
  /// Caller should reconnect with the last event id (Worker long-poll window).
  func subscribe(
    sessionId: String,
    afterEventId: String = "",
    onEvent: @escaping (MilkSUCloudSessionEvent) -> Void
  ) async throws {
    guard let token = await accessToken(), !token.isEmpty else {
      throw MilkSUCloudAgentError.notSignedIn
    }
    var request = URLRequest(url: baseURL.appendingPathComponent("\(MilkSUCloudConfig.service)/Subscribe"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("1", forHTTPHeaderField: "Connect-Protocol-Version")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "session_id": sessionId,
      "after_event_id": afterEventId,
    ])
    request.timeoutInterval = 60
    let (bytes, response) = try await session.bytes(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status >= 200 && status < 300 else {
      throw MilkSUCloudAgentError.http(status: status, message: "Subscribe failed")
    }
    var pending = Data()
    for try await byte in bytes {
      pending.append(byte)
      while true {
        guard let (envelope, rest) = Self.takeEnvelope(from: pending) else { break }
        pending = rest
        if envelope.endStream { return }
        if let event = Self.parseEvent(envelope.json) {
          onEvent(event)
        }
      }
    }
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

  private static func takeEnvelope(from buffer: Data) -> (envelope: (flags: UInt8, json: [String: Any], endStream: Bool), rest: Data)? {
    guard buffer.count >= 5 else { return nil }
    let flags = buffer[0]
    let length = Int(buffer[1]) << 24 | Int(buffer[2]) << 16 | Int(buffer[3]) << 8 | Int(buffer[4])
    guard buffer.count >= 5 + length else { return nil }
    let payload = buffer.subdata(in: 5..<(5 + length))
    let rest = buffer.subdata(in: (5 + length)..<buffer.count)
    var json: [String: Any] = [:]
    if let obj = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] {
      json = obj
    }
    return ((flags, json, (flags & connectFlagEndStream) != 0), rest)
  }

  private static func parseEvent(_ json: [String: Any]) -> MilkSUCloudSessionEvent? {
    let id = String(json["id"] as? String ?? "")
    let type = String(json["type"] as? String ?? "")
    if id.isEmpty && type.isEmpty { return nil }
    return MilkSUCloudSessionEvent(
      id: id.isEmpty ? UUID().uuidString : id,
      type: type,
      sessionId: String(json["session_id"] as? String ?? ""),
      turnId: String(json["turn_id"] as? String ?? ""),
      timestampMs: (json["timestamp_ms"] as? NSNumber)?.int64Value ?? 0,
      jsonPayload: String(json["json_payload"] as? String ?? "{}")
    )
  }
}
