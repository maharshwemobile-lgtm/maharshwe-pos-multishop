package com.maharpos.next

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException

class ApiClient(private val session: SessionStore) {
    suspend fun login(identity: String, password: String): JSONObject = request(
        "POST", "/api/auth/login", JSONObject().put("username", identity).put("password", password), false
    )

    suspend fun get(path: String): JSONObject = request("GET", path, null, true)
    suspend fun post(path: String, body: JSONObject): JSONObject = request("POST", path, body, true)
    suspend fun patch(path: String, body: JSONObject): JSONObject = request("PATCH", path, body, true)

    private suspend fun request(method: String, path: String, body: JSONObject?, auth: Boolean) = withContext(Dispatchers.IO) {
        val attempts = if (method == "GET" || !auth) 2 else 1
        var lastError: Throwable? = null
        repeat(attempts) { attempt ->
            try { return@withContext requestOnce(method, path, body, auth) }
            catch (error: IOException) {
                lastError = error
                if (attempt + 1 < attempts) Thread.sleep(450L)
            }
        }
        throw lastError ?: IOException("Connection failed")
    }

    private fun requestOnce(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject {
        val connection = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("User-Agent", "MaharPOS-Android/${BuildConfig.VERSION_NAME}")
            setRequestProperty("Accept-Encoding", "identity")
            setRequestProperty("Connection", "close")
            if (auth && session.token.isNotBlank()) setRequestProperty("Authorization", "Bearer ${session.token}")
            if (body != null) doOutput = true
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject().put("message", text) }
            if (code !in 200..299) throw ApiException(code, json.optString("message", "Request failed"))
            return json
        } finally { connection.disconnect() }
    }
}

class ApiException(val status: Int, override val message: String) : Exception(message)
