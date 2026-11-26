package com.kinema.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ApkArgs {
  lateinit var path: String
}

/**
 * The Android half of the update button (`updates.rs`): the APK Rust has
 * downloaded and checked goes to Android's own installer, where the user
 * confirms. Nothing is installed silently. Called from Rust alone.
 *
 * Android 8 and later ask once that Skrin may install apps: when that is not
 * allowed yet, the system's screen for it opens instead (where the system has
 * one) and the answer says so; the user presses Update again after allowing.
 */
@TauriPlugin
class UpdatePlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun installApk(invoke: Invoke) {
    val args = invoke.parseArgs(ApkArgs::class.java)
    activity.runOnUiThread {
      try {
        val pm = activity.packageManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
          val ask = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + activity.packageName)
          )
          if (ask.resolveActivity(pm) != null) {
            activity.startActivity(ask)
            invoke.resolve(JSObject().put("state", "permission"))
            return@runOnUiThread
          }
          // No such screen on this device: Android's installer says itself
          // what is needed.
        }
        val uri = FileProvider.getUriForFile(
          activity,
          activity.packageName + ".fileprovider",
          File(args.path)
        )
        val install = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(install)
        invoke.resolve(JSObject().put("state", "opened"))
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }
}
