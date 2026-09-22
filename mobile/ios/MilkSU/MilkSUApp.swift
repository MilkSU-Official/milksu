import SwiftUI

/// Minimal MilkSU cloud Coding shell (phase 1: PKCE + session list + Subscribe chat).
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
      List(sessions) { item in
        NavigationLink(value: item) {
          VStack(alignment: .leading, spacing: 4) {
            Text(item.title.isEmpty ? item.id : item.title)
            Text("\(item.kernel) · \(item.status)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }
      .navigationDestination(for: MilkSUCloudSession.self) { session in
        CloudChatView(auth: auth, session: session)
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

struct CloudChatMessage: Identifiable {
  let id: String
  let role: String
  var content: String
}

struct CloudChatView: View {
  @ObservedObject var auth: MilkSUAccountAuth
  let session: MilkSUCloudSession

  @State private var messages: [CloudChatMessage] = []
  @State private var draft = ""
  @State private var errorText = ""
  @State private var busy = false
  @State private var afterEventId = ""
  @State private var subscribeTask: Task<Void, Never>?

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(messages) { message in
              VStack(alignment: .leading, spacing: 4) {
                Text(message.role == "user" ? "You" : "MilkSU")
                  .font(.caption)
                  .foregroundStyle(.secondary)
                Text(message.content)
                  .frame(maxWidth: .infinity, alignment: .leading)
              }
              .id(message.id)
            }
          }
          .padding(16)
        }
        .onChange(of: messages.count) { _, _ in
          if let last = messages.last {
            proxy.scrollTo(last.id, anchor: .bottom)
          }
        }
      }
      Text("Estimates from models.dev are for stats only, not a bill.")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
      HStack(spacing: 8) {
        TextField("Message", text: $draft, axis: .vertical)
          .lineLimit(1...4)
          .textFieldStyle(.roundedBorder)
        Button("Send") { Task { await send() } }
          .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      .padding(16)
      if !errorText.isEmpty {
        Text(errorText)
          .foregroundStyle(.red)
          .padding(.horizontal, 16)
          .padding(.bottom, 8)
      }
    }
    .navigationTitle(session.title.isEmpty ? "Chat" : session.title)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      subscribeTask?.cancel()
      subscribeTask = Task { await runSubscribeLoop() }
    }
    .onDisappear {
      subscribeTask?.cancel()
      subscribeTask = nil
    }
  }

  private var client: MilkSUCloudAgentClient {
    MilkSUCloudAgentClient(accessToken: { auth.accessToken })
  }

  private func send() async {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    busy = true
    defer { busy = false }
    messages.append(CloudChatMessage(id: UUID().uuidString, role: "user", content: text))
    draft = ""
    do {
      _ = try await client.sendTurn(sessionId: session.id, text: text)
      errorText = ""
    } catch {
      errorText = String(describing: error)
    }
  }

  private func runSubscribeLoop() async {
    while !Task.isCancelled {
      do {
        try await client.subscribe(sessionId: session.id, afterEventId: afterEventId) { event in
          Task { @MainActor in
            if !event.id.isEmpty { afterEventId = event.id }
            apply(event: event)
          }
        }
      } catch is CancellationError {
        return
      } catch {
        if Task.isCancelled { return }
        await MainActor.run {
          errorText = String(describing: error)
        }
        try? await Task.sleep(nanoseconds: 750_000_000)
        continue
      }
      if Task.isCancelled { return }
      try? await Task.sleep(nanoseconds: 100_000_000)
    }
  }

  @MainActor
  private func apply(event: MilkSUCloudSessionEvent) {
    switch event.type {
    case "assistant.delta":
      let text = event.text
      guard !text.isEmpty else { return }
      if let last = messages.last, last.role == "assistant" {
        messages[messages.count - 1].content += text
      } else {
        messages.append(CloudChatMessage(id: event.id, role: "assistant", content: text))
      }
    case "assistant.settled", "assistant.completed":
      break
    case "session.snapshot":
      break
    default:
      break
    }
  }
}
