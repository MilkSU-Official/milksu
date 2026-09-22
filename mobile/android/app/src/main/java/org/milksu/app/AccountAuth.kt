package org.milksu.app

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import java.security.MessageDigest
import java.security.SecureRandom
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

/**
 * MilkSU account PKCE (same wire as desktop AccountSession → accounts.milksu.org).
 * Uses Chrome Custom Tabs for the authorize step; the app handles milksu://auth/callback.
 */
class MilkSUAccountAuth(private val context: Context) {
  private val prefs = context.getSharedPreferences("milksu.account", Context.MODE_PRIVATE)
  private val apiBase = MilkSUApp.ACCOUNT_API.trimEnd('/')
  private val redirectUri = "milksu://auth/callback"

  var accessToken: String?
    get() = prefs.getString("accessToken", null)
    private set(value) {
      prefs.edit().putString("accessToken", value).apply()
    }

  fun isSignedIn(): Boolean = !accessToken.isNullOrBlank()

  fun signOut() {
    prefs.edit().remove("accessToken").remove("codeVerifier").apply()
  }

  fun startLogin() {
    val verifier = base64Url(randomBytes(48))
    prefs.edit().putString("codeVerifier", verifier).apply()
    val challenge = base64Url(sha256(verifier.toByteArray(Charsets.UTF_8)))
    val authorize = Uri.parse("$apiBase/auth/github/start").buildUpon()
      .appendQueryParameter("return_to", redirectUri)
      .appendQueryParameter("code_challenge", challenge)
      .build()
    CustomTabsIntent.Builder().build().launchUrl(context, authorize)
  }

  fun handleCallback(uri: Uri): Boolean {
    if (uri.scheme != "milksu" || uri.host != "auth" || uri.path != "/callback") return false
    val error = uri.getQueryParameter("error").orEmpty()
    if (error.isNotEmpty()) throw IllegalStateException(error)
    val code = uri.getQueryParameter("code").orEmpty()
    val verifier = prefs.getString("codeVerifier", "").orEmpty()
    if (code.isEmpty() || verifier.isEmpty()) throw IllegalStateException("Missing code")
    val body = JSONObject()
      .put("code", code)
      .put("codeVerifier", verifier)
    val response = postJson("$apiBase/v1/auth/exchange", body, null)
    val token = response.optString("accessToken")
    if (token.isEmpty()) throw IllegalStateException("Incomplete login response")
    accessToken = token
    prefs.edit().remove("codeVerifier").apply()
    return true
  }

  fun accountProfile(): JSONObject? {
    val token = accessToken ?: return null
    return try {
      getJson("$apiBase/v1/account", token).optJSONObject("account")
    } catch (_: Exception) {
      null
    }
  }

  private fun postJson(url: String, body: JSONObject, bearer: String?): JSONObject {
    val connection = (URI.create(url).toURL().openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      setRequestProperty("Content-Type", "application/json")
      if (!bearer.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $bearer")
      doOutput = true
      connectTimeout = 15_000
      readTimeout = 30_000
    }
    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    return read(connection)
  }

  private fun getJson(url: String, bearer: String): JSONObject {
    val connection = (URI.create(url).toURL().openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      setRequestProperty("Authorization", "Bearer $bearer")
      connectTimeout = 15_000
      readTimeout = 30_000
    }
    return read(connection)
  }

  private fun read(connection: HttpURLConnection): JSONObject {
    val status = connection.responseCode
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    val text = stream?.bufferedReader()?.readText().orEmpty()
    val json = if (text.isBlank()) JSONObject() else JSONObject(text)
    if (status !in 200..299) {
      throw IllegalStateException(json.optString("message", "HTTP $status"))
    }
    return json
  }

  companion object {
    private fun randomBytes(n: Int): ByteArray {
      val bytes = ByteArray(n)
      SecureRandom().nextBytes(bytes)
      return bytes
    }

    private fun sha256(input: ByteArray): ByteArray =
      MessageDigest.getInstance("SHA-256").digest(input)

    private fun base64Url(bytes: ByteArray): String =
      Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }
}
