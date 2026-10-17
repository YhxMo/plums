package {{PACKAGE}}

import android.app.Activity
import android.app.AlertDialog
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.text.InputFilter
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.util.AtomicFile
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class CredentialArgs {
  var reference: String = ""
  var description: String = ""
}

@InvokeArg
class CredentialPromptArgs {
  var title: String = ""
  var description: String = ""
  var input: String? = null
}

/** Native input and app-owned vault only. No request method and no raw-key response. */
@TauriPlugin
class CredentialsPlugin(private val activity: Activity) : Plugin(activity) {
  private fun response(status: String) = JSObject().apply { put("status", status) }
  private fun valid(reference: String): Boolean = try {
    UUID.fromString(reference).toString() == reference
  } catch (_: Exception) { false }
  private fun alias(reference: String) = "${activity.packageName}.credentials.v1.$reference"
  private fun file(reference: String) = File(File(activity.noBackupFilesDir, "credentials"), "$reference.json")
  private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun keyValid(bytes: ByteArray) = bytes.isNotEmpty() && bytes.size <= 4096 && bytes.all { it.toInt() in 33..126 }
  private fun aad(reference: String) = alias(reference).toByteArray(Charsets.UTF_8)

  @Command
  fun store(invoke: Invoke) {
    val args = invoke.parseArgs(CredentialArgs::class.java)
    if (!valid(args.reference) || args.description.length > 6000) {
      invoke.resolve(response("rejected"))
      return
    }
    activity.runOnUiThread {
      val input = EditText(activity).apply {
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        filters = arrayOf(InputFilter.LengthFilter(4096))
        hint = "API Key"
        isSingleLine = true
        transformationMethod = PasswordTransformationMethod.getInstance()
        isSaveEnabled = false
        if (Build.VERSION.SDK_INT >= 26) importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
      }
      val complete = AtomicBoolean(false)
      val hadSecureFlag = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      fun finish(status: String) {
        if (complete.compareAndSet(false, true)) invoke.resolve(response(status))
      }
      try {
        val dialog = AlertDialog.Builder(activity)
          .setTitle("录入 API Key")
          .setMessage(args.description)
          .setView(input)
          .setNegativeButton("取消") { _, _ -> finish("cancelled") }
          .setPositiveButton("保存") { _, _ ->
            val bytes = input.text.toString().toByteArray(Charsets.UTF_8)
            input.text.clear()
            if (!keyValid(bytes)) {
              bytes.fill(0)
              finish("rejected")
            } else {
              // The dismissal callback must not report cancellation while storage is in flight.
              complete.set(true)
              Thread {
                var status = "unknown"
                try {
                  val vault = store()
                  val path = file(args.reference)
                  if (path.exists() || vault.containsAlias(alias(args.reference))) throw IllegalStateException()
                  val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                  generator.init(KeyGenParameterSpec.Builder(alias(args.reference), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build())
                  val key = generator.generateKey()
                  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                  cipher.init(Cipher.ENCRYPT_MODE, key)
                  cipher.updateAAD(aad(args.reference))
                  val ciphertext = cipher.doFinal(bytes)
                  val document = JSONObject()
                    .put("schema", 1)
                    .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                    .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                    .toString().toByteArray(Charsets.UTF_8)
                  if (!path.parentFile!!.isDirectory && !path.parentFile!!.mkdirs()) throw IllegalStateException()
                  val atomic = AtomicFile(path)
                  val output = atomic.startWrite()
                  try {
                    output.write(document)
                    atomic.finishWrite(output)
                  } catch (error: Exception) {
                    atomic.failWrite(output)
                    throw error
                  }
                  status = "stored"
                } catch (_: Exception) {
                  // Key creation or ciphertext commit may have happened; Rust retains pending metadata.
                } finally {
                  bytes.fill(0)
                  invoke.resolve(response(status))
                }
              }.start()
            }
          }
          .create()
        dialog.setOnCancelListener { finish("cancelled") }
        dialog.setOnDismissListener {
          input.text.clear()
          if (!hadSecureFlag) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
          finish("cancelled")
        }
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        dialog.show()
        input.requestFocus()
      } catch (error: Exception) {
        input.text.clear()
        if (!hadSecureFlag) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        Log.w("PlumsCredentials", "credential prompt failed: ${error.javaClass.simpleName}")
        finish("unavailable")
      }
    }
  }

  @Command
  fun inspect(invoke: Invoke) {
    val args = invoke.parseArgs(CredentialArgs::class.java)
    if (!valid(args.reference)) { invoke.resolve(response("unknown")); return }
    Thread {
      var status = "unknown"
      try {
        val vault = store()
        val path = file(args.reference)
        val hasKey = vault.containsAlias(alias(args.reference))
        if (!path.exists() && !hasKey) status = "missing"
        else {
          if (!hasKey || !path.isFile || path.length() > 12000) throw IllegalStateException()
          val document = JSONObject(AtomicFile(path).openRead().use { it.readBytes().toString(Charsets.UTF_8) })
          if (document.getInt("schema") != 1) throw IllegalStateException()
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          val key = vault.getKey(alias(args.reference), null) as SecretKey
          val iv = Base64.decode(document.getString("iv"), Base64.NO_WRAP)
          if (iv.size != 12) throw IllegalStateException()
          cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
          cipher.updateAAD(aad(args.reference))
          val bytes = cipher.doFinal(Base64.decode(document.getString("ciphertext"), Base64.NO_WRAP))
          try { if (!keyValid(bytes)) throw IllegalStateException(); status = "present" } finally { bytes.fill(0) }
        }
      } catch (_: Exception) {}
      invoke.resolve(response(status))
    }.start()
  }

  @Command
  fun remove(invoke: Invoke) {
    val args = invoke.parseArgs(CredentialArgs::class.java)
    if (!valid(args.reference)) { invoke.resolve(response("unknown")); return }
    Thread {
      var status = "unknown"
      try {
        val path = file(args.reference)
        AtomicFile(path).delete()
        val vault = store()
        vault.deleteEntry(alias(args.reference))
        if (path.exists() || File(path.path + ".bak").exists() || vault.containsAlias(alias(args.reference))) throw IllegalStateException()
        status = "removed"
      } catch (_: Exception) {}
      invoke.resolve(response(status))
    }.start()
  }

  @Command
  fun prompt(invoke: Invoke) {
    val args = invoke.parseArgs(CredentialPromptArgs::class.java)
    if (args.title.length > 80 || args.description.length > 6000 || (args.input?.length ?: 0) > 512) {
      invoke.resolve(response("unknown")); return
    }
    activity.runOnUiThread {
      val complete = AtomicBoolean(false)
      fun finish(result: JSObject) { if (complete.compareAndSet(false, true)) invoke.resolve(result) }
      try {
        val input = args.input?.let { value ->
          EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.LengthFilter(512))
            isSingleLine = true
            setText(value)
            hint = "留空直连，或 http://127.0.0.1:7890"
          }
        }
        val builder = AlertDialog.Builder(activity)
          .setTitle(args.title)
          .setMessage(args.description)
          .setNegativeButton("取消") { _, _ -> finish(response("cancelled")) }
          .setPositiveButton("确认") { _, _ -> finish(response("confirmed").apply { put("value", input?.text?.toString() ?: "") }) }
        if (input != null) builder.setView(input)
        val dialog = builder.create()
        dialog.setOnCancelListener { finish(response("cancelled")) }
        dialog.setOnDismissListener { finish(response("cancelled")) }
        dialog.show()
      } catch (_: Exception) { finish(response("unavailable")) }
    }
  }
}
