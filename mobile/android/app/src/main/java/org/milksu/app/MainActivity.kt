package org.milksu.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

class MilkSUApplication : Application()

class MainActivity : ComponentActivity() {
  private lateinit var auth: MilkSUAccountAuth
  private val signedInState = mutableStateOf(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    auth = MilkSUAccountAuth(this)
    signedInState.value = auth.isSignedIn()
    handleAuthIntent(intent)
    setContent {
      MilkSUTheme {
        val signedIn by signedInState
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          MilkSURoot(
            auth = auth,
            signedIn = signedIn,
            onSignedInChange = { signedInState.value = it },
          )
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleAuthIntent(intent)
    signedInState.value = auth.isSignedIn()
  }

  private fun handleAuthIntent(intent: Intent?) {
    val data: Uri = intent?.data ?: return
    try {
      auth.handleCallback(data)
      signedInState.value = auth.isSignedIn()
    } catch (_: Exception) {
      // Shown on next composition via error paths if needed.
    }
  }
}

private enum class RootTab { Sessions, Account }

data class ChatLine(val id: String, val role: String, val content: String)

@Composable
fun MilkSURoot(
  auth: MilkSUAccountAuth,
  signedIn: Boolean,
  onSignedInChange: (Boolean) -> Unit,
) {
  var error by remember { mutableStateOf("") }
  var openSession by remember { mutableStateOf<JSONObject?>(null) }
  var tab by remember { mutableStateOf(RootTab.Sessions) }
  var displayName by remember { mutableStateOf("") }

  LaunchedEffect(signedIn) {
    if (signedIn) {
      displayName = withContext(Dispatchers.IO) {
        auth.accountProfile()?.optString("displayName")
          ?.ifBlank { auth.accountProfile()?.optString("githubLogin").orEmpty() }
          .orEmpty()
      }
    }
  }

  if (!signedIn) {
    SignInScreen(
      error = error,
      onSignIn = {
        try {
          auth.startLogin()
        } catch (ex: Exception) {
          error = ex.message ?: "login failed"
        }
      },
      onFinished = { onSignedInChange(auth.isSignedIn()) },
    )
    return
  }

  openSession?.let { session ->
    CloudChatScreen(
      accessToken = auth.accessToken.orEmpty(),
      session = session,
      onBack = { openSession = null },
    )
    return
  }

  Scaffold(
    bottomBar = {
      NavigationBar {
        NavigationBarItem(
          selected = tab == RootTab.Sessions,
          onClick = { tab = RootTab.Sessions },
          icon = { Icon(Icons.Filled.Forum, contentDescription = null) },
          label = { Text(L10n.sessions) },
        )
        NavigationBarItem(
          selected = tab == RootTab.Account,
          onClick = { tab = RootTab.Account },
          icon = { Icon(Icons.Filled.Person, contentDescription = null) },
          label = { Text(L10n.account) },
        )
      }
    },
  ) { padding ->
    when (tab) {
      RootTab.Sessions -> CloudSessionScreen(
        accessToken = auth.accessToken.orEmpty(),
        contentPadding = padding,
        onOpen = { openSession = it },
      )
      RootTab.Account -> AccountScreen(
        displayName = displayName,
        contentPadding = padding,
        onSignOut = {
          auth.signOut()
          onSignedInChange(false)
        },
      )
    }
  }
}

@Composable
private fun SignInScreen(
  error: String,
  onSignIn: () -> Unit,
  onFinished: () -> Unit,
) {
  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(MaterialTheme.colorScheme.background)
      .padding(horizontal = 28.dp)
      .navigationBarsPadding(),
    verticalArrangement = Arrangement.SpaceBetween,
  ) {
    Column(modifier = Modifier.padding(top = 72.dp)) {
      Text(
        L10n.appName,
        style = MaterialTheme.typography.displaySmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
      )
      Spacer(Modifier = Modifier.height(8.dp))
      Text(
        L10n.cloudCoding,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(modifier = Modifier.height(12.dp))
      Text(
        L10n.signInHint,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    Column(
      modifier = Modifier.padding(bottom = 36.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Button(
        onClick = onSignIn,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
          containerColor = MaterialTheme.colorScheme.primary,
          contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
      ) {
        Text(L10n.signInGitHub, fontWeight = FontWeight.SemiBold)
      }
      TextButton(onClick = onFinished, modifier = Modifier.fillMaxWidth()) {
        Text(L10n.finishedSignIn)
      }
      if (error.isNotEmpty()) {
        Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CloudSessionScreen(
  accessToken: String,
  contentPadding: PaddingValues,
  onOpen: (JSONObject) -> Unit,
) {
  var sessions by remember { mutableStateOf(listOf<JSONObject>()) }
  var error by remember { mutableStateOf("") }
  var refreshing by remember { mutableStateOf(false) }
  var creating by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val client = remember(accessToken) {
    MilkSUCloudAgentClient(accessToken = { accessToken })
  }

  fun reload() {
    scope.launch {
      refreshing = true
      try {
        sessions = withContext(Dispatchers.IO) { client.listSessions() }
        error = ""
      } catch (ex: Exception) {
        error = ex.message ?: "reload failed"
      } finally {
        refreshing = false
      }
    }
  }

  LaunchedEffect(accessToken) { reload() }

  Scaffold(
    modifier = Modifier.padding(contentPadding),
    topBar = {
      LargeTopAppBar(
        title = { Text(L10n.sessions, fontWeight = FontWeight.Bold) },
        actions = {
          IconButton(onClick = { reload() }) {
            Icon(Icons.Filled.Refresh, contentDescription = L10n.refresh)
          }
        },
        colors = TopAppBarDefaults.largeTopAppBarColors(
          containerColor = MaterialTheme.colorScheme.background,
        ),
      )
    },
    floatingActionButton = {
      FloatingActionButton(
        onClick = {
          if (creating) return@FloatingActionButton
          creating = true
          scope.launch {
            try {
              val created = withContext(Dispatchers.IO) { client.createSession(kernel = "pi") }
              reload()
              onOpen(created)
              error = ""
            } catch (ex: Exception) {
              error = ex.message ?: "create failed"
            } finally {
              creating = false
            }
          }
        },
        containerColor = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
      ) {
        if (creating) {
          CircularProgressIndicator(
            modifier = Modifier.size(22.dp),
            color = MaterialTheme.colorScheme.onPrimary,
            strokeWidth = 2.dp,
          )
        } else {
          Icon(Icons.Filled.Add, contentDescription = L10n.newSession)
        }
      }
    },
  ) { inner ->
    PullToRefreshBox(
      isRefreshing = refreshing,
      onRefresh = { reload() },
      modifier = Modifier.padding(inner).fillMaxSize(),
    ) {
      when {
        sessions.isEmpty() && !refreshing && error.isEmpty() -> {
          Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
          ) {
            Icon(
              Icons.Filled.Cloud,
              contentDescription = null,
              modifier = Modifier.size(48.dp),
              tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(L10n.emptySessions, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
              L10n.emptySessionsHint,
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        else -> {
          LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
          ) {
            if (error.isNotEmpty()) {
              item {
                Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
              }
            }
            items(sessions, key = { it.optString("id") }) { row ->
              SessionCard(row = row, onOpen = { onOpen(row) })
            }
          }
        }
      }
    }
  }
}

@Composable
private fun SessionCard(row: JSONObject, onOpen: () -> Unit) {
  val status = row.optString("status")
  Surface(
    modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surface,
    tonalElevation = 1.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      modifier = Modifier.padding(16.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Box(
        modifier = Modifier
          .size(44.dp)
          .clip(CircleShape)
          .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(
          Icons.Filled.Cloud,
          contentDescription = null,
          tint = MaterialTheme.colorScheme.primary,
        )
      }
      Column(modifier = Modifier.weight(1f)) {
        Text(
          row.optString("title").ifBlank { L10n.cloudCoding },
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
        )
        Text(
          "${row.optString("kernel").uppercase()} · ${statusLabel(status)}",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      StatusChip(status = status)
    }
  }
}

@Composable
private fun StatusChip(status: String) {
  val (label, container, content) = when (status) {
    "running" -> Triple(L10n.statusRunning, Color(0x1A2563EB), Color(0xFF2563EB))
    "migrating" -> Triple(L10n.statusMigrating, Color(0x24EA580C), Color(0xFFEA580C))
    else -> Triple(L10n.statusReady, Color(0x1A16A34A), Color(0xFF16A34A))
  }
  AssistChip(
    onClick = {},
    enabled = false,
    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
    colors = AssistChipDefaults.assistChipColors(
      disabledContainerColor = container,
      disabledLabelColor = content,
    ),
    border = null,
  )
}

private fun statusLabel(status: String): String = when (status) {
  "running" -> L10n.statusRunning
  "migrating" -> L10n.statusMigrating
  else -> L10n.statusReady
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
  displayName: String,
  contentPadding: PaddingValues,
  onSignOut: () -> Unit,
) {
  Scaffold(
    modifier = Modifier.padding(contentPadding),
    topBar = {
      LargeTopAppBar(
        title = { Text(L10n.account, fontWeight = FontWeight.Bold) },
        colors = TopAppBarDefaults.largeTopAppBarColors(
          containerColor = MaterialTheme.colorScheme.background,
        ),
      )
    },
  ) { inner ->
    Column(
      modifier = Modifier
        .padding(inner)
        .padding(horizontal = 20.dp)
        .fillMaxSize(),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
      ) {
        Row(
          modifier = Modifier.padding(20.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
          Box(
            modifier = Modifier
              .size(56.dp)
              .clip(CircleShape)
              .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center,
          ) {
            Icon(Icons.Filled.Person, contentDescription = null, modifier = Modifier.size(28.dp))
          }
          Column {
            Text(
              displayName.ifBlank { L10n.signedInAs },
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.SemiBold,
            )
            Text(
              L10n.cloudCoding,
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
      Text(
        L10n.usageDisclaimer,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(modifier = Modifier.weight(1f))
      Button(
        onClick = onSignOut,
        modifier = Modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
          containerColor = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
        ),
      ) {
        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null)
        Spacer(modifier = Modifier.size(8.dp))
        Text(L10n.signOut)
      }
      Spacer(modifier = Modifier.height(12.dp))
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CloudChatScreen(
  accessToken: String,
  session: JSONObject,
  onBack: () -> Unit,
) {
  val sessionId = session.optString("id")
  val messages = remember { mutableStateListOf<ChatLine>() }
  var draft by remember { mutableStateOf("") }
  var error by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var afterEventId by remember { mutableStateOf("") }
  var navTitle by remember { mutableStateOf(session.optString("title")) }
  val scope = rememberCoroutineScope()
  val listState = rememberLazyListState()
  val client = remember(accessToken) {
    MilkSUCloudAgentClient(accessToken = { accessToken })
  }
  val dark = isSystemInDarkTheme()
  val assistantBubble = if (dark) MilkSUColors.BubbleAssistantDark else MilkSUColors.BubbleAssistant

  fun applyEvent(event: JSONObject) {
    val id = event.optString("id").ifBlank { UUID.randomUUID().toString() }
    val type = event.optString("type")
    val payload = event.optString("json_payload")
    val parsed = try {
      JSONObject(payload.ifBlank { "{}" })
    } catch (_: Exception) {
      JSONObject()
    }
    val text = parsed.optString("text")
    when (type) {
      "assistant.thinking_delta" -> {
        if (text.isEmpty()) return
        val last = messages.lastOrNull()
        if (last?.role == "thinking") {
          messages[messages.lastIndex] = last.copy(content = text)
        } else {
          messages.add(ChatLine(id = id, role = "thinking", content = text))
        }
      }
      "assistant.delta" -> {
        messages.removeAll { it.role == "thinking" }
        if (text.isEmpty()) return
        val last = messages.lastOrNull()
        if (last?.role == "assistant") {
          messages[messages.lastIndex] = last.copy(content = last.content + text)
        } else {
          messages.add(ChatLine(id = id, role = "assistant", content = text))
        }
      }
      "turn.settled" -> {
        messages.removeAll { it.role == "thinking" || it.role == "usage" }
        val usage = parsed.optJSONObject("usage") ?: return
        val input = usage.optInt("input_tokens")
        val output = usage.optInt("output_tokens")
        val sandbox = usage.optInt("sandbox_seconds")
        val parts = buildList {
          add("in $input")
          add("out $output")
          if (sandbox > 0) add("sandbox ${sandbox}s")
        }
        messages.add(
          ChatLine(
            id = id,
            role = "usage",
            content = "${L10n.usageLine}：${parts.joinToString(" · ")}",
          ),
        )
      }
    }
  }

  LaunchedEffect(sessionId, accessToken) {
    try {
      val detail = withContext(Dispatchers.IO) { client.getSession(sessionId) }
      val title = detail.optString("title")
      if (title.isNotBlank()) navTitle = title
      val raw = detail.optString("transcript_json")
      if (raw.isNotBlank()) {
        val arr = org.json.JSONArray(raw)
        val hydrated = buildList {
          for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            val role = row.optString("role")
            val content = row.optString("content")
            if ((role == "user" || role == "assistant") && content.isNotBlank()) {
              add(ChatLine(id = UUID.randomUUID().toString(), role = role, content = content))
            }
          }
        }
        if (hydrated.isNotEmpty()) {
          messages.clear()
          messages.addAll(hydrated)
        }
      }
    } catch (_: Exception) {
      // Empty canvas; live Subscribe still works.
    }
  }

  DisposableEffect(sessionId, accessToken) {
    var cursor = afterEventId
    val job: Job = scope.launch(Dispatchers.IO) {
      while (isActive) {
        try {
          client.subscribe(sessionId, cursor) { event ->
            val id = event.optString("id")
            if (id.isNotEmpty()) {
              cursor = id
              scope.launch(Dispatchers.Main) { afterEventId = id }
            }
            scope.launch(Dispatchers.Main) { applyEvent(event) }
          }
        } catch (ex: Exception) {
          if (!isActive) return@launch
          scope.launch(Dispatchers.Main) {
            error = ex.message ?: "subscribe failed"
          }
          delay(750)
          continue
        }
        if (!isActive) return@launch
        delay(100)
      }
    }
    onDispose { job.cancel() }
  }

  LaunchedEffect(messages.size, messages.lastOrNull()?.content) {
    if (messages.isNotEmpty()) {
      listState.animateScrollToItem(messages.lastIndex)
    }
  }

  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Text(
            navTitle.ifBlank { L10n.cloudCoding },
            maxLines = 1,
            fontWeight = FontWeight.SemiBold,
          )
        },
        navigationIcon = {
          IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = L10n.back)
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = MaterialTheme.colorScheme.background,
        ),
      )
    },
  ) { padding ->
    Column(
      modifier = Modifier
        .padding(padding)
        .fillMaxSize()
        .imePadding(),
    ) {
      LazyColumn(
        state = listState,
        modifier = Modifier.weight(1f).fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        items(messages, key = { it.id }) { line ->
          MessageBubble(
            line = line,
            assistantBubble = assistantBubble,
          )
        }
      }
      Text(
        L10n.usageDisclaimer,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
      )
      if (error.isNotEmpty()) {
        Text(
          error,
          color = MaterialTheme.colorScheme.error,
          style = MaterialTheme.typography.bodySmall,
          modifier = Modifier.padding(horizontal = 20.dp),
        )
      }
      ComposerBar(
        draft = draft,
        onDraftChange = { draft = it },
        busy = busy,
        onSend = {
          val text = draft.trim()
          if (text.isEmpty()) return@ComposerBar
          busy = true
          messages.removeAll { it.role == "thinking" || it.role == "usage" }
          messages.add(ChatLine(id = UUID.randomUUID().toString(), role = "user", content = text))
          draft = ""
          scope.launch {
            try {
              withContext(Dispatchers.IO) { client.sendTurn(sessionId, text) }
              error = ""
            } catch (ex: Exception) {
              error = ex.message ?: "send failed"
            } finally {
              busy = false
            }
          }
        },
      )
    }
  }
}

@Composable
private fun MessageBubble(line: ChatLine, assistantBubble: Color) {
  if (line.role == "thinking" || line.role == "usage") {
    Text(
      if (line.role == "thinking") "${L10n.thinking} · ${line.content}" else line.content,
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
    )
    return
  }
  val isUser = line.role == "user"
  Row(
    modifier = Modifier.fillMaxWidth(),
    horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
  ) {
    Column(
      modifier = Modifier.widthIn(max = 320.dp),
      horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
      Text(
        if (isUser) L10n.you else L10n.assistant,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(modifier = Modifier.height(4.dp))
      Surface(
        shape = RoundedCornerShape(18.dp),
        color = if (isUser) MilkSUColors.BubbleUser else assistantBubble,
        contentColor = if (isUser) Color.White else MaterialTheme.colorScheme.onSurface,
      ) {
        Text(
          line.content,
          modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
          style = MaterialTheme.typography.bodyLarge,
        )
      }
    }
  }
}

@Composable
private fun ComposerBar(
  draft: String,
  onDraftChange: (String) -> Unit,
  busy: Boolean,
  onSend: () -> Unit,
) {
  val canSend = !busy && draft.trim().isNotEmpty()
  Surface(
    tonalElevation = 2.dp,
    color = MaterialTheme.colorScheme.surface,
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .navigationBarsPadding()
        .padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.Bottom,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      OutlinedTextField(
        value = draft,
        onValueChange = onDraftChange,
        modifier = Modifier.weight(1f),
        placeholder = { Text(L10n.messagePlaceholder) },
        maxLines = 5,
        shape = RoundedCornerShape(22.dp),
        colors = OutlinedTextFieldDefaults.colors(
          focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
          unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
          focusedBorderColor = MaterialTheme.colorScheme.outline,
          unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
        ),
      )
      FilledIconButton(
        onClick = onSend,
        enabled = canSend,
        colors = IconButtonDefaults.filledIconButtonColors(
          containerColor = MaterialTheme.colorScheme.primary,
          contentColor = MaterialTheme.colorScheme.onPrimary,
          disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
          disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
      ) {
        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = L10n.send)
      }
    }
  }
}
