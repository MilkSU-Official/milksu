package org.milksu.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier.modifier
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
    super.onCreate(savedInstanceState)
    auth = MilkSUAccountAuth(this)
    signedInState.value = auth.isSignedIn()
    handleAuthIntent(intent)
    setContent {
      MaterialTheme {
        val signedIn by signedInState
        MilkSURoot(
          auth = auth,
          signedIn = signedIn,
          onSignedInChange = { signedInState.value = it },
        )
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
      // Surface via Compose state on next recomposition if needed.
    }
  }
}

data class ChatLine(val id: String, val role: String, val content: String)

@Composable
fun MilkSURoot(
  auth: MilkSUAccountAuth,
  signedIn: Boolean,
  onSignedInChange: (Boolean) -> Unit,
) {
  var error by remember { mutableStateOf("") }
  var openSession by remember { mutableStateOf<JSONObject?>(null) }

  if (!signedIn) {
    Column(
      modifier = Modifier.fillMaxSize().padding(24.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text("MilkSU", style = MaterialTheme.typography.headlineMedium)
      Text("Cloud Coding", style = MaterialTheme.typography.titleMedium)
      Button(onClick = {
        try {
          auth.startLogin()
        } catch (ex: Exception) {
          error = ex.message ?: "login failed"
        }
      }) {
        Text("Sign in with GitHub")
      }
      if (error.isNotEmpty()) {
        Text(error, color = MaterialTheme.colorScheme.error)
      }
      Button(onClick = {
        onSignedInChange(auth.isSignedIn())
      }) {
        Text("I finished signing in")
      }
    }
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

  CloudSessionScreen(
    accessToken = auth.accessToken.orEmpty(),
    onSignOut = {
      auth.signOut()
      onSignedInChange(false)
    },
    onOpen = { openSession = it },
  )
}

@Composable
fun CloudSessionScreen(
  accessToken: String,
  onSignOut: () -> Unit,
  onOpen: (JSONObject) -> Unit,
) {
  var sessions by remember { mutableStateOf(listOf<JSONObject>()) }
  var error by remember { mutableStateOf("") }
  val scope = rememberCoroutineScope()
  val client = remember(accessToken) {
    MilkSUCloudAgentClient(accessToken = { accessToken })
  }

  fun reload() {
    scope.launch {
      try {
        sessions = withContext(Dispatchers.IO) { client.listSessions() }
        error = ""
      } catch (ex: Exception) {
        error = ex.message ?: "reload failed"
      }
    }
  }

  LaunchedEffect(accessToken) { reload() }

  Column(
    modifier = Modifier.fillMaxSize().padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Button(onClick = onSignOut) { Text("Sign out") }
    Button(onClick = {
      scope.launch {
        try {
          withContext(Dispatchers.IO) {
            client.createSession(kernel = "pi")
          }
          reload()
        } catch (ex: Exception) {
          error = ex.message ?: "create failed"
        }
      }
    }) { Text("New session") }
    Button(onClick = { reload() }) { Text("Refresh") }
    if (error.isNotEmpty()) {
      Text(error, color = MaterialTheme.colorScheme.error)
    }
    LazyColumn {
      items(sessions, key = { it.optString("id") }) { row ->
        Column(modifier = Modifier.padding(vertical = 8.dp).fillMaxWidth()) {
          Text(row.optString("title").ifBlank { row.optString("id") })
          Text(
            "${row.optString("kernel")} · ${row.optString("status")}",
            style = MaterialTheme.typography.bodySmall,
          )
          TextButton(onClick = { onOpen(row) }) { Text("Open") }
        }
      }
    }
  }
}

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
  val scope = rememberCoroutineScope()
  val listState = rememberLazyListState()
  val client = remember(accessToken) {
    MilkSUCloudAgentClient(accessToken = { accessToken })
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
            val type = event.optString("type")
            val payload = event.optString("json_payload")
            val text = try {
              JSONObject(payload.ifBlank { "{}" }).optString("text")
            } catch (_: Exception) {
              ""
            }
            if (type == "assistant.delta" && text.isNotEmpty()) {
              scope.launch(Dispatchers.Main) {
                val last = messages.lastOrNull()
                if (last?.role == "assistant") {
                  messages[messages.lastIndex] = last.copy(content = last.content + text)
                } else {
                  messages.add(
                    ChatLine(
                      id = id.ifBlank { UUID.randomUUID().toString() },
                      role = "assistant",
                      content = text,
                    ),
                  )
                }
              }
            }
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

  LaunchedEffect(messages.size) {
    if (messages.isNotEmpty()) {
      listState.animateScrollToItem(messages.lastIndex)
    }
  }

  Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
    TextButton(onClick = onBack) { Text("Back") }
    Text(
      session.optString("title").ifBlank { sessionId },
      style = MaterialTheme.typography.titleMedium,
    )
    Text(
      "Estimates from models.dev are for stats only, not a bill.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    LazyColumn(
      state = listState,
      modifier = Modifier.weight(1f).fillMaxWidth(),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      items(messages, key = { it.id }) { line ->
        Column {
          Text(if (line.role == "user") "You" else "MilkSU", style = MaterialTheme.typography.labelSmall)
          Text(line.content)
        }
      }
    }
    if (error.isNotEmpty()) {
      Text(error, color = MaterialTheme.colorScheme.error)
    }
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      OutlinedTextField(
        value = draft,
        onValueChange = { draft = it },
        modifier = Modifier.weight(1f),
        singleLine = false,
        maxLines = 4,
        label = { Text("Message") },
      )
      Button(
        enabled = !busy && draft.trim().isNotEmpty(),
        onClick = {
          val text = draft.trim()
          if (text.isEmpty()) return@Button
          busy = true
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
      ) { Text("Send") }
    }
  }
}
