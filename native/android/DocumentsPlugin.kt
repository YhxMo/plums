package {{PACKAGE}}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

@InvokeArg
class DocumentSelectArgs {
  var multiple: Boolean = false
}

@InvokeArg
class DocumentReadArgs {
  var uri: String = ""
  var maxBytes: Int = 0
}

/** Session-only content access. No storage permission or persistent URI grant is requested. */
@TauriPlugin
class DocumentsPlugin(private val activity: Activity) : Plugin(activity) {
  private fun response(status: String) = JSObject().apply { put("status", status) }
  private fun rejected(reason: String) = response("rejected").apply { put("reason", reason) }

  @Command
  fun select(invoke: Invoke) {
    val args = invoke.parseArgs(DocumentSelectArgs::class.java)
    activity.runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
          type = "*/*"
          addCategory(Intent.CATEGORY_OPENABLE)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, args.multiple)
        }
        startActivityForResult(invoke, intent, "selected")
      } catch (_: android.content.ActivityNotFoundException) {
        invoke.resolve(rejected("unavailable"))
      } catch (_: SecurityException) {
        invoke.resolve(rejected("denied"))
      } catch (_: Exception) {
        invoke.resolve(response("unknown"))
      }
    }
  }

  @ActivityCallback
  private fun selected(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.resolve(response("cancelled"))
      return
    }
    val data = result.data
    val uris = LinkedHashSet<Uri>()
    data?.data?.let { uris.add(it) }
    val clip = data?.clipData
    if (clip != null) {
      if (clip.itemCount > 8) {
        invoke.resolve(rejected("resource-limit"))
        return
      }
      for (index in 0 until clip.itemCount) uris.add(clip.getItemAt(index).uri)
    }
    if (uris.isEmpty() || uris.size > 8 || uris.any { it.scheme != "content" || it.toString().length > 8192 }) {
      invoke.resolve(rejected("denied"))
      return
    }
    Thread {
      try {
        val documents = JSONArray()
        for (uri in uris) {
          var name = "Selected document"
          activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0)
          }
          name = name.filter { !it.isISOControl() && it != '/' && it != '\\' }.take(160)
          if (name.isBlank()) name = "Selected document"
          documents.put(JSObject().put("uri", uri.toString()).put("name", name))
        }
        invoke.resolve(response("selected").apply { put("documents", documents) })
      } catch (_: SecurityException) {
        invoke.resolve(rejected("denied"))
      } catch (_: Exception) {
        invoke.resolve(rejected("io"))
      }
    }.start()
  }

  @Command
  fun read(invoke: Invoke) {
    val args = invoke.parseArgs(DocumentReadArgs::class.java)
    if (args.maxBytes !in 1..65536 || args.uri.length > 8192 || !args.uri.startsWith("content://")) {
      invoke.resolve(rejected("denied"))
      return
    }
    Thread {
      try {
        val uri = Uri.parse(args.uri)
        val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
          val output = ByteArrayOutputStream()
          val buffer = ByteArray(4096)
          while (output.size() <= args.maxBytes) {
            val amount = input.read(buffer, 0, minOf(buffer.size, args.maxBytes + 1 - output.size()))
            if (amount == -1) break
            if (amount == 0) throw IOException()
            output.write(buffer, 0, amount)
          }
          output.toByteArray()
        } ?: throw IOException()
        if (bytes.size > args.maxBytes) {
          invoke.resolve(rejected("too-large"))
          return@Thread
        }
        val decoder = Charsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
        val text = decoder.decode(ByteBuffer.wrap(bytes)).toString()
        invoke.resolve(response("read").apply { put("text", text); put("bytes", bytes.size) })
      } catch (_: SecurityException) {
        invoke.resolve(rejected("denied"))
      } catch (_: CharacterCodingException) {
        invoke.resolve(rejected("encoding"))
      } catch (_: IOException) {
        invoke.resolve(rejected("io"))
      } catch (_: Exception) {
        invoke.resolve(response("unknown"))
      }
    }.start()
  }
}
