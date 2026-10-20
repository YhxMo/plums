package {{PACKAGE}}

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.net.Proxy
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

/** Room for a public model catalog; matches Rust. */
private const val MAX_RESPONSE = 16 * 1024 * 1024

@InvokeArg
class NetworkReadArgs {
  var id: String = ""
  var url: String = ""
}

@InvokeArg
class NetworkCancelArgs {
  var id: String = ""
}

/** `network.read`: a GET of a public HTTPS resource, with no credentials, cookies, proxy or redirects. Rust checks the URL first. */
@TauriPlugin
class NetworkPlugin(private val activity: Activity) : Plugin(activity) {
  private val active = ConcurrentHashMap<String, HttpsURLConnection>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  private val watchdog = Executors.newSingleThreadScheduledExecutor()

  @Command
  fun read(invoke: Invoke) {
    val args = invoke.parseArgs(NetworkReadArgs::class.java)
    fun fail(status: String, code: String) = invoke.resolve(JSObject().apply { put("status", status); put("code", code) })
    val url = try { URL(args.url) } catch (_: Exception) { null }
    if (args.id.isEmpty() || args.id.length > 64 || url == null || url.protocol != "https" ||
      url.userInfo != null || url.ref != null || (url.port != -1 && url.port != 443)) {
      fail("not-dispatched", "invalid-request"); return
    }
    Thread {
      var dispatched = false
      val timedOut = AtomicBoolean(false)
      var connection: HttpsURLConnection? = null
      try {
        // Gzip is decompressed transparently; the cap counts decompressed bytes.
        val open = (url.openConnection(Proxy.NO_PROXY) as HttpsURLConnection).apply {
          instanceFollowRedirects = false
          useCaches = false
          connectTimeout = 10_000
          readTimeout = 60_000
          requestMethod = "GET"
        }
        connection = open
        active[args.id] = open
        if (cancelled.remove(args.id)) { fail("not-dispatched", "cancelled"); return@Thread }
        val deadline = watchdog.schedule(Runnable { timedOut.set(true); open.disconnect() }, 60, TimeUnit.SECONDS)
        try {
          open.connect()
          // A cancel that came before the socket existed could not disconnect it.
          if (cancelled.remove(args.id)) { fail("not-dispatched", "cancelled"); return@Thread }
          dispatched = true
          val status = open.responseCode
          if (status in 300..399) { fail("unknown", "redirect"); return@Thread }
          val output = ByteArrayOutputStream()
          (if (status >= 400) open.errorStream else open.inputStream)?.use { stream ->
            val buffer = ByteArray(8192)
            while (true) {
              val read = stream.read(buffer)
              if (read < 0) break
              if (output.size() + read > MAX_RESPONSE) { fail("unknown", "response-too-large"); return@Thread }
              output.write(buffer, 0, read)
            }
          }
          val text = try {
            Charsets.UTF_8.newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(output.toByteArray())).toString()
          } catch (_: Exception) { fail("unknown", "response-encoding"); return@Thread }
          invoke.resolve(JSObject().apply { put("status", "ok"); put("httpStatus", status); put("body", text) })
        } finally { deadline.cancel(false) }
      } catch (_: Exception) {
        val code = when { timedOut.get() -> "timeout"; cancelled.remove(args.id) -> "cancelled"; else -> "transport" }
        fail(if (dispatched) "unknown" else "not-dispatched", code)
      } finally {
        active.remove(args.id)
        connection?.disconnect()
      }
    }.start()
  }

  @Command
  fun cancel(invoke: Invoke) {
    val args = invoke.parseArgs(NetworkCancelArgs::class.java)
    // Remembered so a read that has not opened yet never sends.
    if (cancelled.size > 64) cancelled.clear()
    cancelled.add(args.id)
    active[args.id]?.disconnect()
    invoke.resolve(JSObject().apply { put("status", "cancelled") })
  }
}
