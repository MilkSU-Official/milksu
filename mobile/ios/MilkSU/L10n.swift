import Foundation

/// Product UI strings: Chinese + English, keyed by system language (default zh).
enum L10n {
  private static var zh: Bool {
    Locale.preferredLanguages.first?.hasPrefix("zh") ?? true
  }

  static func t(_ zhHans: String, _ en: String) -> String { zh ? zhHans : en }

  static var appName: String { "MilkSU" }
  static var cloudCoding: String { t("云端 Coding", "Cloud Coding") }
  static var signInGitHub: String { t("使用 GitHub 登录", "Sign in with GitHub") }
  static var signInHint: String { t("登录后手机与电脑共用同一账户的云会话。", "After sign-in, phone and desktop share the same cloud sessions.") }
  static var sessions: String { t("会话", "Sessions") }
  static var account: String { t("我的", "Account") }
  static var newSession: String { t("新对话", "New chat") }
  static var signOut: String { t("退出登录", "Sign out") }
  static var messagePlaceholder: String { t("发给云 Agent", "Message the cloud agent") }
  static var send: String { t("发送", "Send") }
  static var emptySessions: String { t("还没有云会话", "No cloud sessions yet") }
  static var emptySessionsHint: String { t("点右上角开一个，手机和桌面会同步。", "Start one from the toolbar; phone and desktop stay in sync.") }
  static var usageDisclaimer: String { t("根据 models.dev 估算，方便统计，不是账单", "Estimates from models.dev are for stats only, not a bill") }
  static var you: String { t("你", "You") }
  static var assistant: String { "MilkSU" }
  static var thinking: String { t("思考中", "Thinking") }
  static var usageLine: String { t("本回合用量（估算）", "Turn usage (estimate)") }
  static var signedInAs: String { t("已登录", "Signed in") }
  static var kernelPi: String { "Pi" }
  static var refresh: String { t("刷新", "Refresh") }
  static var back: String { t("返回", "Back") }
  static var statusReady: String { t("就绪", "Ready") }
  static var statusRunning: String { t("运行中", "Running") }
  static var statusMigrating: String { t("迁移中", "Migrating") }
}
