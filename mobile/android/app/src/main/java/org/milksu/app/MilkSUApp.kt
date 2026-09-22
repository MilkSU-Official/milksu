package org.milksu.app

import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONObject

/**
 * MilkSU Android cloud client.
 * Prefer Connect-Kotlin stubs generated from cloud/agent/proto when available;
 * this hand-rolled Connect-JSON unary client matches the Worker wire format.
 */
object MilkSUApp {
  const val ACCOUNT_API = "https://accounts.milksu.org"
  const val CLOUD_AGENT_API = "https://agent.milksu.org"
  const val SERVICE = "milksu.cloud.v1.CloudSessionService"
}

class MilkSUCloudAgentClient(
  private val baseUrl: String = MilkSUApp.CLOUD_AGENT_API,
  private val accessToken: () -> String?,
) {
  fun listSessions(): List<JSONObject> {
    val body = call("ListSessions", JSONObject())
    val sessions = body.optJSONArray("sessions") ?: return emptyList()
    return buildList {
      for (i in 0 until sessions.length()) {
        add(sessions.getJSONObject(i))
      }
    }
  }

  fun migrateCopy(sourceSessionId: String, transcriptJson: String): String {
    val body = call(
      "MigrateCopy",
      JSONObject()
        .put("source_session_id", sourceSessionId)
        .put("direction", "local_to_cloud")
        .put("transcript_json", transcriptJson),
    )
    if (!body.optBoolean("ok") || body.optString("target_session_id").isEmpty()) {
      throw IllegalStateException(body.optString("error", "migrate copy failed"))
    }
    return body.getString("target_session_id")
  }

  fun migrateFinalize(sourceSessionId: String, targetSessionId: String): Boolean {
    val body = call(
      "MigrateFinalize",
      JSONObject()
        .put("source_session_id", sourceSessionId)
        .put("target_session_id", targetSessionId)
        .put("direction", "local_to_cloud"),
    )
    return body.optBoolean("ok")
  }

  private fun call(method: String, body: JSONObject): JSONObject {
    val token = accessToken()?.trim().orEmpty()
    if (token.isEmpty()) {
      throw IllegalStateException("Cloud Agent requires a signed-in MilkSU account")
    }
    val url = URI.create("$baseUrl/${MilkSUApp.SERVICE}/$method").toURL()
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Connect-Protocol-Version", "1")
      setRequestProperty("Authorization", "Bearer $token")
      doOutput = true
      connectTimeout = 15_000
      readTimeout = 30_000
    }
    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    val status = connection.responseCode
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    val text = stream?.bufferedReader()?.readText().orEmpty()
    val json = if (text.isBlank()) JSONObject() else JSONObject(text)
    if (status !in 200..299) {
      throw IllegalStateException(json.optString("message", "Cloud Agent $method failed ($status)"))
    }
    return json
  }
}
