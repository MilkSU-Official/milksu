package org.milksu.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MilkSUApplication : Application()

class MainActivity : ComponentActivity() {
  private lateinit var auth: MilkSUAccountAuth

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    auth = MilkSUAccountAuth(this)
    handleAuthIntent(intent)
    setContent {
      MaterialTheme {
        MilkSURoot(auth)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleAuthIntent(intent)
  }

  private fun handleAuthIntent(intent: Intent?) {
    val data: Uri = intent?.data ?: return
    try {
      auth.handleCallback(data)
    } catch (_: Exception) {
      // Surface via Compose state on next recomposition if needed.
    }
  }
}

@Composable
fun MilkSURoot(auth: MilkSUAccountAuth) {
  var signedIn by remember { mutableStateOf(auth.isSignedIn()) }
  var error by remember { mutableStateOf("") }
  val context = LocalContext.current

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
        signedIn = auth.isSignedIn()
      }) {
        Text("I finished signing in")
      }
    }
    return
  }

  CloudSessionScreen(
    accessToken = auth.accessToken.orEmpty(),
    onSignOut = {
      auth.signOut()
      signedIn = false
    },
  )
}

@Composable
fun CloudSessionScreen(accessToken: String, onSignOut: () -> Unit) {
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
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
          Text(row.optString("title").ifBlank { row.optString("id") })
          Text(
            "${row.optString("kernel")} · ${row.optString("status")}",
            style = MaterialTheme.typography.bodySmall,
          )
        }
      }
    }
  }
}
