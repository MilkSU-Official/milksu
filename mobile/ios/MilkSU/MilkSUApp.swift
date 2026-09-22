import SwiftUI

/// Minimal MilkSU cloud Coding shell (phase 1: PKCE sign-in + session list).
@main
struct MilkSUAppMain: App {
  @StateObject private var auth = MilkSUAccountAuth()

  var body: some Scene {
    WindowGroup {
      Group {
        if auth.isSignedIn {
          CloudSessionListView(auth: auth)
        } else {
          SignInView(auth: auth)
        }
      }
      .preferredColorScheme(.light)
      .task { auth.restoreFromKeychain() }
      .onOpenURL { url in
        Task {
          try? await auth.handleCallback(url)
        }
      }
    }
  }
}

struct SignInView: View {
  @ObservedObject var auth: MilkSUAccountAuth

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("MilkSU")
        .font(.largeTitle.bold())
      Text("Cloud Coding")
        .font(.title3)
        .foregroundStyle(.secondary)
      Button("Sign in with GitHub") {
        Task { await auth.startLogin() }
      }
      .buttonStyle(.borderedProminent)
      if !auth.errorText.isEmpty {
        Text(auth.errorText)
          .foregroundStyle(.red)
      }
      Spacer()
    }
    .padding(24)
  }
}

struct CloudSessionListView: View {
  @ObservedObject var auth: MilkSUAccountAuth
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
      .navigationTitle(auth.displayName.isEmpty ? "Cloud" : auth.displayName)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("New") { Task { await createSession() } }
            .disabled(busy)
        }
        ToolbarItem(placement: .topBarLeading) {
          Button("Sign out") { auth.signOut() }
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
    MilkSUCloudAgentClient(accessToken: { auth.accessToken })
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
