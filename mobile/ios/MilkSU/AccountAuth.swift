import Foundation
import CryptoKit
import AuthenticationServices

/// MilkSU account PKCE (same wire as desktop AccountSession → accounts.milksu.org).
@MainActor
final class MilkSUAccountAuth: NSObject, ObservableObject {
  @Published private(set) var accessToken: String?
  @Published private(set) var displayName: String = ""
  @Published private(set) var errorText: String = ""

  private var codeVerifier: String?
  private let apiBase = MilkSUCloudConfig.accountAPI
  private let redirectURI = URL(string: "milksu://auth/callback")!

  var isSignedIn: Bool { !(accessToken ?? "").isEmpty }

  func signOut() {
    accessToken = nil
    displayName = ""
    codeVerifier = nil
    errorText = ""
    KeychainStore.delete(key: "account.accessToken")
  }

  func restoreFromKeychain() {
    if let token = KeychainStore.read(key: "account.accessToken"), !token.isEmpty {
      accessToken = token
    }
  }

  func startLogin() async {
    errorText = ""
    let verifier = Self.base64URL(Data((0..<48).map { _ in UInt8.random(in: 0...255) }))
    codeVerifier = verifier
    let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    var components = URLComponents(url: apiBase.appendingPathComponent("auth/github/start"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "return_to", value: redirectURI.absoluteString),
      URLQueryItem(name: "code_challenge", value: challenge),
    ]
    guard let url = components.url else {
      errorText = "Invalid authorize URL"
      return
    }
    // ASWebAuthenticationSession is the mature iOS OAuth pattern (same family as desktop openExternal + callback).
    do {
      let callback = try await Self.presentAuthSession(url: url, callbackURLScheme: "milksu")
      try await handleCallback(callback)
    } catch {
      errorText = String(describing: error)
    }
  }

  func handleCallback(_ url: URL) async throws {
    guard url.scheme == redirectURI.scheme,
          url.host == redirectURI.host,
          url.path == redirectURI.path else {
      throw URLError(.badURL)
    }
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    if let oauthError = items.first(where: { $0.name == "error" })?.value, !oauthError.isEmpty {
      throw NSError(domain: "MilkSUAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: oauthError])
    }
    guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty,
          let verifier = codeVerifier else {
      throw NSError(domain: "MilkSUAuth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing code"])
    }
    var request = URLRequest(url: apiBase.appendingPathComponent("v1/auth/exchange"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "code": code,
      "codeVerifier": verifier,
    ])
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status >= 200 && status < 300 else {
      throw NSError(domain: "MilkSUAuth", code: status, userInfo: [NSLocalizedDescriptionKey: "GitHub login failed"])
    }
    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    let token = String(json["accessToken"] as? String ?? "")
    guard !token.isEmpty else {
      throw NSError(domain: "MilkSUAuth", code: 3, userInfo: [NSLocalizedDescriptionKey: "Incomplete login response"])
    }
    accessToken = token
    KeychainStore.write(key: "account.accessToken", value: token)
    codeVerifier = nil
    await refreshProfile()
  }

  func refreshProfile() async {
    guard let token = accessToken else { return }
    var request = URLRequest(url: apiBase.appendingPathComponent("v1/account"))
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let account = json["account"] as? [String: Any] else { return }
    displayName = String(account["displayName"] as? String ?? account["githubLogin"] as? String ?? "")
  }

  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func presentAuthSession(url: URL, callbackURLScheme: String) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) { callback, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let callback {
          continuation.resume(returning: callback)
        } else {
          continuation.resume(throwing: URLError(.userCancelledAuthentication))
        }
      }
      session.presentationContextProvider = AuthPresentationAnchor.shared
      session.prefersEphemeralWebBrowserSession = false
      if !session.start() {
        continuation.resume(throwing: URLError(.cannotOpenFile))
      }
    }
  }
}

final class AuthPresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
  static let shared = AuthPresentationAnchor()
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    ASPresentationAnchor()
  }
}

enum KeychainStore {
  static func write(key: String, value: String) {
    let data = Data(value.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key,
      kSecValueData as String: data,
    ]
    SecItemDelete(query as CFDictionary)
    SecItemAdd(query as CFDictionary, nil)
  }

  static func read(key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func delete(key: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
