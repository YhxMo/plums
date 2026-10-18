package {{PACKAGE}}

import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val callback = object : OnBackPressedCallback(true) {
      private var pending = false

      override fun handleOnBackPressed() {
        if (pending) return
        if (ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
          WindowInsetsControllerCompat(window, webView).hide(WindowInsetsCompat.Type.ime())
          return
        }
        pending = true
        webView.evaluateJavascript(
          "window.dispatchEvent(new Event('plums:back', {cancelable:true}))"
        ) { result ->
          pending = false
          if (isFinishing || isDestroyed) return@evaluateJavascript
          if (result == "true") {
            isEnabled = false
            try { onBackPressedDispatcher.onBackPressed() }
            finally { isEnabled = true }
          } else if (result != "false") {
            Log.w("PlumsBack", "WebView did not return a navigation result")
          }
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, callback)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safeArea = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
