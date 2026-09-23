package org.milksu.app

import java.util.Locale

/** Product UI strings: Chinese + English (system locale; default zh). */
object L10n {
  private val zh: Boolean
    get() = Locale.getDefault().language.startsWith("zh")

  fun t(zhHans: String, en: String): String = if (zh) zhHans else en

  val appName get() = "MilkSU"
  val cloudCoding get() = t("云端 Coding", "Cloud Coding")
  val signInGitHub get() = t("使用 GitHub 登录", "Sign in with GitHub")
  val signInHint get() = t(
    "登录后手机与电脑共用同一账户的云会话。",
    "After sign-in, phone and desktop share the same cloud sessions.",
  )
  val finishedSignIn get() = t("我已完成登录", "I finished signing in")
  val sessions get() = t("会话", "Sessions")
  val account get() = t("我的", "Account")
  val newSession get() = t("新对话", "New chat")
  val signOut get() = t("退出登录", "Sign out")
  val messagePlaceholder get() = t("发给云 Agent", "Message the cloud agent")
  val send get() = t("发送", "Send")
  val emptySessions get() = t("还没有云会话", "No cloud sessions yet")
  val emptySessionsHint get() = t(
    "点右下角开一个，手机和桌面会同步。",
    "Tap the button below to start one; phone and desktop stay in sync.",
  )
  val usageDisclaimer get() = t(
    "根据 models.dev 估算，方便统计，不是账单",
    "Estimates from models.dev are for stats only, not a bill",
  )
  val you get() = t("你", "You")
  val assistant get() = "MilkSU"
  val signedInAs get() = t("已登录", "Signed in")
  val refresh get() = t("刷新", "Refresh")
  val back get() = t("返回", "Back")
  val statusReady get() = t("就绪", "Ready")
  val statusRunning get() = t("运行中", "Running")
  val statusMigrating get() = t("迁移中", "Migrating")
}
