package com.kinema.app

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.Process
import android.os.SystemClock
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import org.json.JSONObject

@InvokeArg
class PreviewOpenArgs {
  /** A path on this device, or the address of a film on a share (stream.rs). */
  lateinit var source: String
  /** Width of the pictures, in pixels. */
  var width: Int = 320
}

@InvokeArg
class PreviewFrameArgs {
  /** The session `previewOpen` answered with. */
  var id: Long = 0
  var atMs: Long = 0
  /** Where the JPEG goes. */
  lateinit var out: String
}

/**
 * Seek preview pictures on Android (`seek_preview.rs`, which calls this from
 * Rust alone; one request at a time, the newest live one first, as on the
 * desktop). The film's own player is never touched.
 *
 * Decoded with a **software** decoder only, picked by what Android lists
 * (`isSoftwareOnly`, or the system's own `OMX.google.` / `c2.android.` names
 * before Android 10): a TV box may have a single video decoder, and Android
 * takes it from the app behind (GOTCHAS, "A TV box may have one video
 * decoder"). A file no software decoder takes at its size gets no pictures,
 * and the film plays as before. That is also why `MediaMetadataRetriever` is
 * not used: it picks the hardware decoder itself.
 *
 * The keyframe at or before the point, about 320 px wide. The colours are
 * converted here from the decoder's YUV, so an HDR film (PQ or HLG) is mapped
 * to ordinary colours rather than shown washed out, on every Android version
 * alike. One thread, at background priority.
 */
@InvokeArg
class PreviewCloseArgs {
  var id: Long = 0
}

@TauriPlugin
class PreviewPlugin(activity: Activity) : Plugin(activity) {
  private val worker = Executors.newSingleThreadExecutor { r ->
    Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
      r.run()
    }, "skrin-seek-preview")
  }
  private var session: Session? = null
  /**
   * Which open this session is: the worker of the file before may close its
   * handle after the next file's opened, and must not close that one.
   */
  private var sessionId = 0L

  @Command
  fun previewOpen(invoke: Invoke) {
    val args = invoke.parseArgs(PreviewOpenArgs::class.java)
    worker.execute {
      session?.close()
      session = null
      try {
        val s = Session.open(args.source, args.width)
        session = s
        sessionId++
        invoke.resolve(JSObject().apply {
          put("id", sessionId)
          put("duration", s.durationUs?.let { it / 1_000_000.0 } ?: JSONObject.NULL)
          put("decoder", s.decoder)
          put("transfer", s.colour.transferName())
        })
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun previewFrame(invoke: Invoke) {
    val args = invoke.parseArgs(PreviewFrameArgs::class.java)
    worker.execute {
      val s = session?.takeIf { args.id == sessionId }
      if (s == null) {
        invoke.reject("no file open for pictures")
        return@execute
      }
      try {
        s.frame(args.atMs * 1000, File(args.out))
        invoke.resolve()
      } catch (e: Exception) {
        // A decoder that failed once is not trusted with the next picture.
        s.close()
        session = null
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun previewClose(invoke: Invoke) {
    val args = invoke.parseArgs(PreviewCloseArgs::class.java)
    worker.execute {
      if (args.id == sessionId) {
        session?.close()
        session = null
      }
      invoke.resolve()
    }
  }
}

/** How the file's colours are stored, from its track (MediaFormat's numbers). */
private class Colour(val standard: Int, val range: Int, val transfer: Int) {
  fun transferName() = when (transfer) {
    MediaFormat.COLOR_TRANSFER_ST2084 -> "pq"
    MediaFormat.COLOR_TRANSFER_HLG -> "hlg"
    else -> "sdr"
  }
}

private class Session(
  private val extractor: MediaExtractor,
  private val codec: MediaCodec,
  private val width: Int,
  val colour: Colour,
  val durationUs: Long?,
  val decoder: String,
) {
  companion object {
    /** Longest one picture may take before it is given up. */
    private const val FRAME_WAIT_MS = 8000L

    fun open(source: String, width: Int): Session {
      val extractor = MediaExtractor()
      try {
        if (source.startsWith("http://") || source.startsWith("https://")) {
          extractor.setDataSource(source, emptyMap())
        } else {
          extractor.setDataSource(source)
        }
        val track = (0 until extractor.trackCount).firstOrNull {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
        } ?: throw IllegalStateException("no video track")
        val format = extractor.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val w = format.getInteger(MediaFormat.KEY_WIDTH)
        val h = format.getInteger(MediaFormat.KEY_HEIGHT)
        // The profile, where the file says it (HEVC Main10 is not every software decoder's).
        val profile = if (format.containsKey(MediaFormat.KEY_PROFILE)) format.getInteger(MediaFormat.KEY_PROFILE) else null
        val name = softwareDecoder(mime, w, h, profile)
          ?: throw IllegalStateException("no software decoder for $mime (profile ${profile ?: "unknown"}) at ${w}x$h")
        val colour = Colour(
          intOr(format, MediaFormat.KEY_COLOR_STANDARD, if (h >= 720) MediaFormat.COLOR_STANDARD_BT709 else MediaFormat.COLOR_STANDARD_BT601_PAL),
          intOr(format, MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED),
          intOr(format, MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO),
        )
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else null
        extractor.selectTrack(track)
        val codec = MediaCodec.createByCodecName(name)
        try {
          format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
          // Not real time: the film being watched comes first.
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) format.setInteger(MediaFormat.KEY_PRIORITY, 1)
          codec.configure(format, null, null, 0)
          codec.start()
        } catch (e: Exception) {
          codec.release()
          throw e
        }
        return Session(extractor, codec, width, colour, durationUs, name)
      } catch (e: Exception) {
        extractor.release()
        throw e
      }
    }

    private fun intOr(f: MediaFormat, key: String, or: Int) =
      if (f.containsKey(key)) f.getInteger(key).takeIf { it > 0 } ?: or else or

    /** A decoder that is software by Android's own word, and takes this size and profile. */
    private fun softwareDecoder(mime: String, w: Int, h: Int, profile: Int?): String? =
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
        !info.isEncoder &&
          info.supportedTypes.any { it.equals(mime, ignoreCase = true) } &&
          software(info) &&
          info.getCapabilitiesForType(mime).let { caps ->
            (caps.videoCapabilities?.isSizeSupported(w, h) ?: false) &&
              (profile == null || caps.profileLevels.isEmpty() ||
                caps.profileLevels.any { it.profile == profile || it.profile == base(mime, profile) })
          }
      }?.name

    /**
     * The profile an HDR one is decoded as: "Profile 2 HDR" or "Main 10 HDR10"
     * is the same picture with HDR signalled beside it, and a decoder that
     * lists only the plain one decodes it (the colours are converted here).
     */
    private fun base(mime: String, profile: Int): Int = when (mime) {
      MediaFormat.MIMETYPE_VIDEO_VP9 -> when (profile) {
        MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR, MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus ->
          MediaCodecInfo.CodecProfileLevel.VP9Profile2
        MediaCodecInfo.CodecProfileLevel.VP9Profile3HDR, MediaCodecInfo.CodecProfileLevel.VP9Profile3HDR10Plus ->
          MediaCodecInfo.CodecProfileLevel.VP9Profile3
        else -> profile
      }
      MediaFormat.MIMETYPE_VIDEO_HEVC -> when (profile) {
        MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10, MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus ->
          MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
        else -> profile
      }
      MediaFormat.MIMETYPE_VIDEO_AV1 -> when (profile) {
        MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10, MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus ->
          MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10
        else -> profile
      }
      else -> profile
    }

    private fun software(info: MediaCodecInfo): Boolean =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.isSoftwareOnly && !info.isAlias
      else info.name.startsWith("OMX.google.") || info.name.startsWith("c2.android.")
  }

  /** The keyframe at or before `atUs`, as a JPEG at `out`. */
  fun frame(atUs: Long, out: File) {
    codec.flush()
    extractor.seekTo(atUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    val until = SystemClock.elapsedRealtime() + FRAME_WAIT_MS
    var ended = false
    var fed = 0
    val info = MediaCodec.BufferInfo()
    while (SystemClock.elapsedRealtime() < until) {
      if (!ended) {
        val input = codec.dequeueInputBuffer(5_000)
        if (input >= 0) {
          val buffer = codec.getInputBuffer(input)!!
          val size = extractor.readSampleData(buffer, 0)
          // A decoder that holds frames back (B-frames) gives the first after
          // a few more; past a few seconds' worth, the rest is let go.
          if (size < 0 || fed >= 300) {
            codec.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            ended = true
          } else {
            codec.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
            extractor.advance()
            fed++
          }
        }
      }
      val output = codec.dequeueOutputBuffer(info, 5_000)
      if (output < 0) continue
      val image = if (info.size > 0) codec.getOutputImage(output) else null
      if (image == null) {
        codec.releaseOutputBuffer(output, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        continue
      }
      val bitmap = try {
        picture(image)
      } finally {
        image.close()
        codec.releaseOutputBuffer(output, false)
      }
      val part = File(out.path + ".tmp")
      FileOutputStream(part).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 70, it) }
      bitmap.recycle()
      if (!part.renameTo(out)) throw IllegalStateException("could not keep the picture")
      return
    }
    throw IllegalStateException("no picture at ${atUs / 1000} ms")
  }

  /** The decoded picture, scaled to [width] and converted to ordinary (SDR) colours. */
  private fun picture(image: Image): Bitmap {
    val crop = image.cropRect
    val outW = minOf(width, crop.width())
    val outH = maxOf(2, (outW.toLong() * crop.height() / crop.width()).toInt() and 1.inv())
    // 10-bit pictures (P010) keep each sample in the top 10 bits of 16.
    val deep = Build.VERSION.SDK_INT >= 33 && image.format == ImageFormat.YCBCR_P010
    val planes = image.planes
    val y = planes[0]; val u = planes[1]; val v = planes[2]
    val yb = y.buffer; val ub = u.buffer; val vb = v.buffer
    fun sample(b: java.nio.ByteBuffer, rowStride: Int, pixelStride: Int, px: Int, py: Int): Float {
      val at = py * rowStride + px * pixelStride
      return if (deep) {
        val word = (b.get(at).toInt() and 0xff) or ((b.get(at + 1).toInt() and 0xff) shl 8)
        (word ushr 6) / 1024f
      } else {
        (b.get(at).toInt() and 0xff) / 256f
      }
    }
    val (kr, kb) = when (colour.standard) {
      MediaFormat.COLOR_STANDARD_BT2020 -> 0.2627f to 0.0593f
      MediaFormat.COLOR_STANDARD_BT709 -> 0.2126f to 0.0722f
      else -> 0.299f to 0.114f
    }
    val kg = 1f - kr - kb
    val full = colour.range == MediaFormat.COLOR_RANGE_FULL
    val tone = Tone.of(colour)
    val pixels = IntArray(outW * outH)
    val rgb = FloatArray(3)
    for (oy in 0 until outH) {
      val sy = crop.top + ((oy * 2 + 1) * crop.height()) / (outH * 2)
      for (ox in 0 until outW) {
        val sx = crop.left + ((ox * 2 + 1) * crop.width()) / (outW * 2)
        var luma = sample(yb, y.rowStride, y.pixelStride, sx, sy)
        var cb = sample(ub, u.rowStride, u.pixelStride, sx / 2, sy / 2) - 0.5f
        var cr = sample(vb, v.rowStride, v.pixelStride, sx / 2, sy / 2) - 0.5f
        if (!full) {
          luma = (luma - 0.0625f) / 0.85547f
          cb /= 0.875f
          cr /= 0.875f
        }
        val r = luma + 2f * (1f - kr) * cr
        val b = luma + 2f * (1f - kb) * cb
        val g = (luma - kr * r - kb * b) / kg
        rgb[0] = r; rgb[1] = g; rgb[2] = b
        tone?.apply(rgb)
        pixels[oy * outW + ox] = (0xff shl 24) or (byte(rgb[0]) shl 16) or (byte(rgb[1]) shl 8) or byte(rgb[2])
      }
    }
    return Bitmap.createBitmap(pixels, outW, outH, Bitmap.Config.ARGB_8888)
  }

  private fun byte(x: Float) = (x.coerceIn(0f, 1f) * 255f + 0.5f).toInt()

  fun close() {
    try { codec.stop() } catch (_: Exception) {}
    codec.release()
    extractor.release()
  }
}

/**
 * HDR to ordinary colours, for a small picture: the signal to light (PQ, or
 * HLG at 1000 nits), a soft curve that keeps 203 nits as white and brings
 * 1000 down to it, BT.2020's colours into BT.709's, and the usual gamma.
 */
private class Tone(private val hlg: Boolean) {
  companion object {
    fun of(c: Colour): Tone? = when (c.transfer) {
      MediaFormat.COLOR_TRANSFER_ST2084 -> Tone(false)
      MediaFormat.COLOR_TRANSFER_HLG -> Tone(true)
      else -> null
    }
    private const val WHITE = 203f
    private const val PEAK = 1000f
  }

  private fun pq(e: Float): Float {
    val p = Math.pow(e.coerceIn(0f, 1f).toDouble(), 1.0 / 78.84375)
    val n = maxOf(p - 0.8359375, 0.0) / (18.8515625 - 18.6875 * p)
    return (10000.0 * Math.pow(n, 1.0 / 0.1593017578125)).toFloat()
  }

  private fun hlgScene(e: Float): Float {
    val x = e.coerceIn(0f, 1f)
    return if (x <= 0.5f) x * x / 3f
    else ((Math.exp((x - 0.55991073) / 0.17883277) + 0.28466892) / 12.0).toFloat()
  }

  fun apply(rgb: FloatArray) {
    var r: Float; var g: Float; var b: Float
    if (hlg) {
      r = hlgScene(rgb[0]); g = hlgScene(rgb[1]); b = hlgScene(rgb[2])
      val ys = 0.2627f * r + 0.6780f * g + 0.0593f * b
      val ootf = PEAK * Math.pow(maxOf(ys, 1e-6f).toDouble(), 0.2).toFloat()
      r *= ootf; g *= ootf; b *= ootf
    } else {
      r = pq(rgb[0]); g = pq(rgb[1]); b = pq(rgb[2])
    }
    // Light relative to white, then the curve on brightness alone.
    r /= WHITE; g /= WHITE; b /= WHITE
    val l = 0.2627f * r + 0.6780f * g + 0.0593f * b
    if (l > 0f) {
      val w = PEAK / WHITE
      val mapped = l * (1f + l / (w * w)) / (1f + l)
      val k = mapped / l
      r *= k; g *= k; b *= k
    }
    val r709 = 1.6605f * r - 0.5876f * g - 0.0728f * b
    val g709 = -0.1246f * r + 1.1329f * g - 0.0083f * b
    val b709 = -0.0182f * r - 0.1006f * g + 1.1187f * b
    rgb[0] = gamma(r709); rgb[1] = gamma(g709); rgb[2] = gamma(b709)
  }

  private fun gamma(x: Float) = Math.pow(x.coerceIn(0f, 1f).toDouble(), 1.0 / 2.2).toFloat()
}
