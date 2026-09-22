import SwiftUI

/// Minimal MilkSU cloud Coding shell (phase 1: sign-in + session list).
/// Full Connect-Swift stubs replace MilkSUCloudAgentClient when buf generate lands.
@main
struct MilkSUAppMain: App {
  @StateObject private var session = MilkSUAccountSession()

  var body: some Scene {
    WindowGroup {
      Group {
        if session.isSignedIn {
          CloudSessionListView(session: session)
        } else {
          SignInView(session: session)
        }
      }
      .preferredColorScheme(.light)
    }
  }
}

@MainActor
final class MilkSUAccountSession: ObservableObject {
  @Published var accessToken: String?
  @Published var displayName: String = ""

  var isSignedIn: Bool { !(accessToken ?? "").isEmpty }

  func signInWithStoredToken(_ token: String, displayName: String) {
    // Product path: PKCE against accounts.milksu.org; Keychain-backed.
    self.accessToken = token
    self.displayName = displayName
  }

  func signOut() {
    accessToken = nil
    displayName = ""
  }
}

struct SignInView: View {
  @ObservedObject var session: MilkSUAccountSession
  @State private var tokenDraft = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("MilkSU")
        .font(.largeTitle.bold())
      Text("Cloud Coding")
        .font(.title3)
        .foregroundStyle(.secondary)
      TextField("Access token (dev)", text: $tokenDraft)
        .textFieldStyle(.roundedBorder)
      Button("Continue") {
        let token = tokenDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        session.signInWithStoredToken(token, displayName: "Developer")
      }
      .buttonStyle(.borderedProminent)
      Spacer()
    }
    .padding(24)
  }
}

struct CloudSessionListView: View {
  @ObservedObject var session: MilkSUAccountSession
  @State private var sessions: [MilkSUCloudSession] = []
  @State private var errorText = ""
  @State private var busy = false

  var body: some View {
    NavigationStack {
      List(sessions, id: \.id) { item in
        VStack(alignment: .leading, spacing: 4) {
          Text(item.title.isEmpty ? item.id : item.title)
          Text("\(item.kernel) · \(item.status)")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Cloud")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("New") { Task { await createSession() } }
            .disabled(busy)
        }
        ToolbarItem(placement: .topBarLeading) {
          Button("Sign out") { session.signOut() }
        }
      }
      .overlay {
        if !errorText.isEmpty {
          Text(errorText).foregroundStyle(.red).padding()
        }
      }
      .task { await reload() }
    }
  }

  private var client: MilkSUCloudAgentClient {
    MilkSUCloudAgentClient(accessToken: { session.accessToken })
  }

  private func reload() async {
    busy = true
    defer { busy = false }
    do {
      sessions = try await client.listSessions()
      errorText = ""
    } catch {
      errorText = String(describing: error)
    }
  }

  private func createSession() async {
    busy = true
    defer { busy = false }
    do {
      _ = try await client.createSession(kernel: "pi")
      await reload()
    } catch {
      errorText = String(describing: error)
    }
  }
}
