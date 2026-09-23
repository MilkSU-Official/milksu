package org.milksu.app

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/**
 * MilkSU Android cloud client.
 * Prefer Connect-Kotlin stubs generated from cloud/agent/proto when available;
 * this hand-rolled Connect-JSON client matches the Worker wire format
 * (unary JSON + Subscribe application/connect+json envelopes).
 */
object MilkSUApp {
  const val ACCOUNT_API = "https://accounts.milksu.org"
  const val CLOUD_AGENT_API = "https://agent.milksu.org"
  const val SERVICE = "milksu.cloud.v1.CloudSessionService"
  const val FLAG_END_STREAM = 0x02
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

  fun createSession(kernel: String = "pi", model: String = "", title: String = ""): JSONObject {
    return call(
      "CreateSession",
      JSONObject()
        .put("kernel", kernel)
        .put("model", model)
        .put("title", title)
        .put("credential_id", ""),
    )
  }

  fun getSession(sessionId: String): JSONObject {
    return call(
      "GetSession",
      JSONObject().put("session_id", sessionId),
    )
  }

  fun sendTurn(sessionId: String, text: String): String {
    val body = call(
      "SendTurn",
      JSONObject()
        .put("session_id", sessionId)
        .put("text", text)
        .put("attachment_ids", JSONArray()),
    )
    return body.optString("turn_id")
  }

  /**
   * Server-stream Subscribe until EndStream.
   * Caller reconnects with [afterEventId] after the Worker long-poll window.
   */
  fun subscribe(
    sessionId: String,
    afterEventId: String = "",
    onEvent: (JSONObject) -> Unit,
  ) {
    val token = accessToken()?.trim().orEmpty()
    if (token.isEmpty()) {
      throw IllegalStateException("Cloud Agent requires a signed-in MilkSU account")
    }
    val url = URI.create("$baseUrl/${MilkSUApp.SERVICE}/Subscribe").toURL()
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Connect-Protocol-Version", "1")
      setRequestProperty("Authorization", "Bearer $token")
      doOutput = true
      connectTimeout = 15_000
      readTimeout = 60_000
    }
    val requestBody = JSONObject()
      .put("session_id", sessionId)
      .put("after_event_id", afterEventId)
      .toString()
      .toByteArray(Charsets.UTF_8)
    connection.outputStream.use { it.write(requestBody) }
    val status = connection.responseCode
    if (status !in 200..299) {
      val err = connection.errorStream?.bufferedReader()?.readText().orEmpty()
      val json = if (err.isBlank()) JSONObject() else JSONObject(err)
      throw IllegalStateException(json.optString("message", "Subscribe failed ($status)"))
    }
    val input = connection.inputStream
    val pending = ByteArrayOutputStream()
    val buf = ByteArray(4096)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      pending.write(buf, 0, n)
      var bytes = pending.toByteArray()
      while (true) {
        val decoded = takeEnvelope(bytes) ?: break
        bytes = decoded.rest
        if (decoded.endStream) {
          pending.reset()
          pending.write(bytes)
          return
        }
        if (decoded.json.length() > 0) {
          onEvent(decoded.json)
        }
      }
      pending.reset()
      pending.write(bytes)
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

  private data class Envelope(val json: JSONObject, val endStream: Boolean, val rest: ByteArray)

  private fun takeEnvelope(buffer: ByteArray): Envelope? {
    if (buffer.size < 5) return null
    val flags = buffer[0].toInt() and 0xff
    val length = ((buffer[1].toInt() and 0xff) shl 24) or
      ((buffer[2].toInt() and 0xff) shl 16) or
      ((buffer[3].toInt() and 0xff) shl 8) or
      (buffer[4].toInt() and 0xff)
    if (buffer.size < 5 + length) return null
    val payload = buffer.copyOfRange(5, 5 + length)
    val rest = buffer.copyOfRange(5 + length, buffer.size)
    val text = payload.toString(Charsets.UTF_8)
    val json = if (text.isBlank()) JSONObject() else JSONObject(text)
    return Envelope(json, (flags and MilkSUApp.FLAG_END_STREAM) != 0, rest)
  }
}
