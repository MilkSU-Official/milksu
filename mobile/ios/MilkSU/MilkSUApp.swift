import SwiftUI

/// Minimal MilkSU cloud Coding shell — modern native SwiftUI (TabView + bubbles).
@main
struct MilkSUAppMain: App {
  @StateObject private var auth = MilkSUAccountAuth()

  var body: some Scene {
    WindowGroup {
      Group {
        if auth.isSignedIn {
          RootTabView(auth: auth)
        } else {
          SignInView(auth: auth)
        }
      }
      .tint(MilkSUTheme.ink)
      .task {
        auth.restoreFromKeychain()
        if auth.isSignedIn {
          await auth.refreshProfile()
        }
      }
      .onOpenURL { url in
        Task { try? await auth.handleCallback(url) }
      }
    }
  }
}

enum MilkSUTheme {
  /// Cold canvas aligned with desktop page fill (not OLED black / purple AI look).
  static let canvas = Color(red: 0.957, green: 0.965, blue: 0.973) // #f4f6f8
  static let ink = Color(red: 0.078, green: 0.078, blue: 0.078) // #141414
  static let bubbleUser = Color(red: 0.078, green: 0.078, blue: 0.078)
  static let bubbleAssistant = Color(red: 0.918, green: 0.922, blue: 0.929)
  static let hairline = Color.black.opacity(0.08)
}

// MARK: - Sign in

struct SignInView: View {
  @ObservedObject var auth: MilkSUAccountAuth
  @State private var busy = false

  var body: some View {
    ZStack {
      MilkSUTheme.canvas.ignoresSafeArea()
      VStack(spacing: 0) {
        Spacer(minLength: 48)
        VStack(alignment: .leading, spacing: 12) {
          Text(L10n.appName)
            .font(.system(size: 44, weight: .bold, design: .rounded))
            .foregroundStyle(MilkSUTheme.ink)
          Text(L10n.cloudCoding)
            .font(.title3.weight(.medium))
            .foregroundStyle(.secondary)
          Text(L10n.signInHint)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 28)

        Spacer()

        VStack(spacing: 12) {
          Button {
            busy = true
            Task {
              await auth.startLogin()
              busy = false
            }
          } label: {
            HStack(spacing: 10) {
              Image(systemName: "person.crop.circle.badge.checkmark")
              Text(busy ? "…" : L10n.signInGitHub)
                .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
          }
          .buttonStyle(.borderedProminent)
          .tint(MilkSUTheme.ink)
          .disabled(busy)

          if !auth.errorText.isEmpty {
            Text(auth.errorText)
              .font(.footnote)
              .foregroundStyle(.red)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 36)
      }
    }
  }
}

// MARK: - Tabs (2): Sessions + Account

struct RootTabView: View {
  @ObservedObject var auth: MilkSUAccountAuth

  var body: some View {
    TabView {
      CloudSessionListView(auth: auth)
        .tabItem {
          Label(L10n.sessions, systemImage: "bubble.left.and.bubble.right.fill")
        }
      AccountView(auth: auth)
        .tabItem {
          Label(L10n.account, systemImage: "person.crop.circle.fill")
        }
    }
  }
}

// MARK: - Session list

struct CloudSessionListView: View {
  @ObservedObject var auth: MilkSUAccountAuth
  @State private var sessions: [MilkSUCloudSession] = []
  @State private var errorText = ""
  @State private var busy = false
  @State private var query = ""
  @State private var path = NavigationPath()

  private var filtered: [MilkSUCloudSession] {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !q.isEmpty else { return sessions }
    return sessions.filter {
      $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) || $0.kernel.lowercased().contains(q)
    }
  }

  var body: some View {
    NavigationStack(path: $path) {
      Group {
        if sessions.isEmpty && !busy && errorText.isEmpty {
          ContentUnavailableView(
            L10n.emptySessions,
            systemImage: "cloud",
            description: Text(L10n.emptySessionsHint)
          )
        } else {
          List(filtered) { item in
            NavigationLink(value: item) {
              SessionRow(session: item)
            }
            .listRowBackground(Color.white.opacity(0.72))
          }
          .listStyle(.insetGrouped)
          .scrollContentBackground(.hidden)
          .background(MilkSUTheme.canvas)
        }
      }
      .navigationTitle(L10n.sessions)
      .navigationBarTitleDisplayMode(.large)
      .searchable(text: $query, prompt: L10n.sessions)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            Task { await createSession() }
          } label: {
            Image(systemName: "square.and.pencil")
          }
          .disabled(busy)
          .accessibilityLabel(L10n.newSession)
        }
        ToolbarItem(placement: .topBarLeading) {
          if busy {
            ProgressView()
          }
        }
      }
      .refreshable { await reload() }
      .navigationDestination(for: MilkSUCloudSession.self) { session in
        CloudChatView(auth: auth, session: session)
      }
      .overlay(alignment: .bottom) {
        if !errorText.isEmpty {
          Text(errorText)
            .font(.footnote)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.red.gradient, in: Capsule())
            .padding()
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
      let created = try await client.createSession(kernel: "pi")
      await reload()
      path.append(created)
      errorText = ""
    } catch {
      errorText = String(describing: error)
    }
  }
}

struct SessionRow: View {
  let session: MilkSUCloudSession

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      ZStack {
        Circle()
          .fill(MilkSUTheme.ink.opacity(0.08))
          .frame(width: 40, height: 40)
        Image(systemName: "cloud.fill")
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(MilkSUTheme.ink)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(session.title.isEmpty ? L10n.cloudCoding : session.title)
          .font(.body.weight(.semibold))
          .foregroundStyle(MilkSUTheme.ink)
          .lineLimit(1)
        Text("\(session.kernel.uppercased()) · \(statusLabel(session.status))")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
      StatusChip(status: session.status)
    }
    .padding(.vertical, 4)
  }

  private func statusLabel(_ status: String) -> String {
    switch status {
    case "running": return L10n.statusRunning
    case "migrating": return L10n.statusMigrating
    default: return L10n.statusReady
    }
  }
}

struct StatusChip: View {
  let status: String

  var body: some View {
    Text(label)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(fill, in: Capsule())
      .foregroundStyle(foreground)
  }

  private var label: String {
    switch status {
    case "running": return L10n.statusRunning
    case "migrating": return L10n.statusMigrating
    default: return L10n.statusReady
    }
  }

  private var fill: Color {
    switch status {
    case "running": return Color.blue.opacity(0.12)
    case "migrating": return Color.orange.opacity(0.14)
    default: return Color.green.opacity(0.12)
    }
  }

  private var foreground: Color {
    switch status {
    case "running": return .blue
    case "migrating": return .orange
    default: return .green
    }
  }
}

// MARK: - Account

struct AccountView: View {
  @ObservedObject var auth: MilkSUAccountAuth

  var body: some View {
    NavigationStack {
      List {
        Section {
          HStack(spacing: 14) {
            Image(systemName: "person.crop.circle.fill")
              .font(.system(size: 44))
              .foregroundStyle(MilkSUTheme.ink.opacity(0.85))
            VStack(alignment: .leading, spacing: 4) {
              Text(auth.displayName.isEmpty ? L10n.signedInAs : auth.displayName)
                .font(.headline)
              Text(L10n.cloudCoding)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 6)
        }
        Section {
          Button(role: .destructive) {
            auth.signOut()
          } label: {
            Label(L10n.signOut, systemImage: "rectangle.portrait.and.arrow.right")
          }
        }
        Section {
          Text(L10n.usageDisclaimer)
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .listStyle(.insetGrouped)
      .scrollContentBackground(.hidden)
      .background(MilkSUTheme.canvas)
      .navigationTitle(L10n.account)
      .navigationBarTitleDisplayMode(.large)
      .task { await auth.refreshProfile() }
    }
  }
}

// MARK: - Chat

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
  @FocusState private var composerFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 10) {
            ForEach(messages) { message in
              MessageBubble(message: message)
                .id(message.id)
            }
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
        }
        .background(MilkSUTheme.canvas)
        .onChange(of: messages.count) { _, _ in
          if let last = messages.last {
            withAnimation(.easeOut(duration: 0.2)) {
              proxy.scrollTo(last.id, anchor: .bottom)
            }
          }
        }
        .onChange(of: messages.last?.content) { _, _ in
          if let last = messages.last {
            proxy.scrollTo(last.id, anchor: .bottom)
          }
        }
      }

      Text(L10n.usageDisclaimer)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 4)

      composer
    }
    .navigationTitle(session.title.isEmpty ? L10n.cloudCoding : session.title)
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

  private var composer: some View {
    HStack(alignment: .bottom, spacing: 10) {
      TextField(L10n.messagePlaceholder, text: $draft, axis: .vertical)
        .lineLimit(1...5)
        .focused($composerFocused)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 22, style: .continuous)
            .strokeBorder(MilkSUTheme.hairline, lineWidth: 1)
        )

      Button {
        Task { await send() }
      } label: {
        Image(systemName: "arrow.up.circle.fill")
          .font(.system(size: 34))
          .symbolRenderingMode(.hierarchical)
          .foregroundStyle(canSend ? MilkSUTheme.ink : Color.secondary.opacity(0.35))
      }
      .disabled(!canSend)
      .accessibilityLabel(L10n.send)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.bar)
    .overlay(alignment: .top) {
      if !errorText.isEmpty {
        Text(errorText)
          .font(.caption)
          .foregroundStyle(.red)
          .padding(.bottom, 4)
      }
    }
  }

  private var canSend: Bool {
    !busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
        await MainActor.run { errorText = String(describing: error) }
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
    default:
      break
    }
  }
}

struct MessageBubble: View {
  let message: CloudChatMessage

  private var isUser: Bool { message.role == "user" }

  var body: some View {
    HStack {
      if isUser { Spacer(minLength: 48) }
      VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
        Text(isUser ? L10n.you : L10n.assistant)
          .font(.caption2.weight(.medium))
          .foregroundStyle(.secondary)
        Text(message.content)
          .font(.body)
          .foregroundStyle(isUser ? Color.white : MilkSUTheme.ink)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(
            isUser ? MilkSUTheme.bubbleUser : MilkSUTheme.bubbleAssistant,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
          )
      }
      if !isUser { Spacer(minLength: 48) }
    }
  }
}
