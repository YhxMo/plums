package {{PACKAGE}}

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class AppearanceArgs {
  var dark: Boolean = false
}

@TauriPlugin
class AppearancePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun apply(invoke: Invoke) {
    val args = invoke.parseArgs(AppearanceArgs::class.java)
    activity.runOnUiThread {
      val content = activity.findViewById<View>(android.R.id.content)
      val color = Color.parseColor(if (args.dark) "#1c1917" else "#fafafa")
      content.setBackgroundColor(color)
      activity.window.decorView.setBackgroundColor(color)
      WindowCompat.getInsetsController(activity.window, content).apply {
        isAppearanceLightStatusBars = !args.dark
        isAppearanceLightNavigationBars = !args.dark
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        activity.window.isNavigationBarContrastEnforced = false
      }
      invoke.resolve()
    }
  }
}
