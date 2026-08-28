import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { CANVAS_W, CANVAS_H, taglineX } from "./renderOverlay.js";

if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

// Export quality presets. Resolution stays fixed at Reels' native 1080x1920 for
// every tier (that's what Instagram actually serves) — quality controls encode
// effort/CRF/bitrate ceiling, i.e. how much detail/compression artifacting you get.
export const QUALITY_PRESETS = {
  standard: { crf: 26, preset: "veryfast", maxrate: "2500k", bufsize: "5000k", label: "Standard (fast, smaller file)" },
  high: { crf: 20, preset: "medium", maxrate: "6000k", bufsize: "12000k", label: "High (recommended for posting)" },
  ultra: { crf: 15, preset: "slow", maxrate: "12000k", bufsize: "24000k", label: "Ultra (best detail, slower render, larger file)" },
};

/**
 * compressRawUpload
 *  - Re-encodes a just-uploaded raw video down to a reasonable storage size
 *    BEFORE it's ever saved as `rawVideoPath` on the doc. Phone/drone
 *    footage routinely comes in at 15-40 Mbps and well above 1920px on a
 *    side — none of which is needed here, since the final export is always
 *    fit into a fixed 1080x1920 canvas anyway.
 *  - Caps resolution at 1920px on the longer side (never upscales — the
 *    scale filter is a no-op if the source is already smaller) and
 *    re-encodes at a moderate CRF, which typically shrinks phone-recorded
 *    clips by 70-90% with no visible quality loss at the sizes this app
 *    actually displays them at.
 *  - Smaller raw files also mean every later preview/finalize render has
 *    less data to decode and hold in memory, which lowers the chance of an
 *    OOM-triggered crash (and the restart-wiped-disk data loss that follows
 *    one) on memory-constrained hosts — though it doesn't by itself protect
 *    against a redeploy or planned restart, which still needs persistent/
 *    external storage (see the note in the render pipeline).
 *  - Resolves with `outPath` on success. Callers should treat failure as
 *    non-fatal and fall back to keeping the original upload — a corrupt or
 *    unusual source shouldn't block the upload outright.
 */
export function compressRawUpload(inputPath, outPath) {
  return new Promise((resolve, reject) => {
    let stderrTail = "";
    ffmpeg(inputPath)
      .videoFilters("scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease")
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
      ])
      .on("start", (cmd) => console.log("Upload compression FFmpeg started:", cmd))
      .on("stderr", (line) => {
        stderrTail = (stderrTail + "\n" + line).slice(-2000);
      })
      .on("error", (err) => {
        if (stderrTail.trim()) console.error("[compress stderr]", stderrTail.trim());
        reject(err);
      })
      .on("end", () => resolve(outPath))
      .save(outPath);
  });
}

// Probes a video file's duration (seconds) via ffprobe. Resolves to 0 on any
// failure rather than rejecting — worst case the badge just shows from the
// start instead of blocking the whole render over a probe hiccup. Now always
// called from renderReel (previously only when a badge/tagline was present)
// since progress reporting needs it too regardless of which overlays are on.
function getVideoDurationSeconds(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      const duration = !err && parseFloat(data?.format?.duration);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });
  });
}

// Turns an ffmpeg timemark ("00:01:23.45") into seconds. Returns 0 on anything
// unparseable rather than throwing — progress reporting is best-effort.
function timemarkToSeconds(timemark) {
  if (!timemark) return 0;
  const parts = String(timemark).split(":");
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts.map(parseFloat);
  if (![h, m, s].every(Number.isFinite)) return 0;
  return h * 3600 + m * 60 + s;
}

// Post-render safety net: confirms the file ffmpeg just produced actually has
// a usable audio track. This exists because a silently-dropped `-map`/filter
// mismatch (wrong input index, a typo'd filter label, etc.) previously could
// still exit ffmpeg with code 0 and a "finished" file that plays back with no
// sound at all — nothing upstream would have caught that. When the caller
// explicitly supplied a replacement audio track we treat a missing/empty
// audio stream as a hard failure; when audio was only carried through
// optionally from the original clip (which may have had none to begin with)
// we just warn, since "no audio" can be entirely legitimate there.
function verifyRenderedAudio(outPath, { required }) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(outPath, (err, data) => {
      if (err) {
        // Can't even probe the file we just wrote — treat that as a failure
        // regardless of whether audio was required, since something's wrong.
        return reject(new Error(`Post-render verification failed: could not probe output (${err.message})`));
      }
      const audioStream = (data?.streams || []).find((s) => s.codec_type === "audio");
      const audioDuration = parseFloat(audioStream?.duration ?? data?.format?.duration);
      const hasUsableAudio = !!audioStream && (!Number.isFinite(audioDuration) || audioDuration > 0);

      if (!hasUsableAudio && required) {
        return reject(
          new Error(
            "Post-render verification failed: the rendered file has no usable audio track even though a replacement audio file was supplied."
          )
        );
      }
      if (!hasUsableAudio) {
        console.warn(`[render] output ${outPath} has no audio stream (source clip likely had none) — continuing.`);
      }
      resolve();
    });
  });
}

/**
 * renderReel
 *  - Fits the ENTIRE raw video into the 1080x1920 Reels canvas without cropping
 *    any portion of it: the clip is scaled to fit inside the frame, and any
 *    empty top/bottom (or side) space is filled with plain black — no blur/zoom
 *    fill — so the letterboxed area reads as a clean black bar.
 *  - Overlays the rasterized design PNG (frame border, text, land-type badge,
 *    footer, etc.) on top — all visible from the very first frame.
 *  - If audio was uploaded, replaces the clip's original audio with it (loudness-
 *    normalized in the SAME filter_complex graph as the video, not a bolted-on
 *    `-af`); else keeps the original audio untouched, if any.
 *  - `quality` selects one of QUALITY_PRESETS to control encode CRF/bitrate.
 *  - `onProgress`, if given, is called with `{ percent, seconds }` as ffmpeg
 *    reports progress (percent is 0-99 while encoding; caller is responsible
 *    for treating completion itself as 100).
 *
 * Returns a Promise that resolves with outPath when done.
 */
export async function renderReel({
  rawVideoPath,
  rawAudioPath,
  overlayPngPath,
  taglineOverlayPngPath,
  taglineWidth,
  taglineHeight,
  taglineTargetY,
  taglineSlideSeconds = 0.9,
  outPath,
  quality = "high",
  onProgress,
}) {
  const q = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

  // Always probed now (previously only when a badge/tagline was present) —
  // progress reporting below needs the total duration regardless of which
  // overlays are active, and the cost of one extra ffprobe is negligible.
  const duration = await getVideoDurationSeconds(rawVideoPath);

  let tagline = null;
  if (taglineOverlayPngPath) {
    // Clamp so slide-in/slide-out never overlap on a very short clip.
    const slide = Math.min(taglineSlideSeconds, Math.max(duration / 3, 0.3));
    const holdEnd = Math.max(slide, duration - slide);
    tagline = {
      x: taglineX(taglineWidth),
      y: taglineTargetY,
      h: taglineHeight,
      slideIn: slide,
      holdEnd,
      duration,
    };
  }

  return new Promise((resolve, reject) => {
    const command = ffmpeg(rawVideoPath).input(overlayPngPath);
    if (taglineOverlayPngPath) command.input(taglineOverlayPngPath);

    const filterGraph = buildFrameFilter({ tagline });

    let outputOptions = [
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-preset",
      q.preset,
      "-crf",
      String(q.crf),
      "-maxrate",
      q.maxrate,
      "-bufsize",
      q.bufsize,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ];

    if (rawAudioPath) {
      // Browser/phone-recorded WAV files very often ship with a broken or
      // "streaming" header — the RIFF/data chunk declares a size of 0 (or
      // some other wrong value) because the recorder didn't know the final
      // length up front. ffmpeg's WAV demuxer trusts that declared size by
      // default, so it can end up reading almost none of the actual audio —
      // which then shows up downstream as "the render finished but there's
      // no sound", not as an ffmpeg error, since nothing actually failed.
      // `-ignore_length 1` tells the WAV demuxer to read to the real end of
      // the file instead of trusting the (possibly bogus) header value. Only
      // meaningful for .wav specifically — it isn't a recognized option for
      // other demuxers, so it's gated on the extension rather than applied
      // unconditionally (which would hard-error on an mp3/m4a/webm upload).
      const isWav = path.extname(rawAudioPath).toLowerCase() === ".wav";
      command.input(rawAudioPath);
      if (isWav) command.inputOptions(["-ignore_length", "1"]);
      // input index shifts by one for the tagline overlay, if also present
      const audioInputIdx = 2 + (taglineOverlayPngPath ? 1 : 0);
      // loudnorm now lives IN the filter_complex graph (as its own independent
      // filtergraph node, [aout]) instead of a separate top-level `-af` flag.
      // Mixing `-filter_complex` (video) with `-af` (audio) on the same command
      // works most of the time, but the two options are applied by ffmpeg at
      // different stages and it's easy for them to silently disagree about
      // which audio input they're each looking at once more inputs get added
      // (the tagline shifts indices). Putting both graphs in one
      // filter_complex removes that ambiguity entirely — everything downstream
      // just maps named output pads ([vout]/[aout]).
      // -shortest trims to the shorter of video/audio so it never runs past the clip.
      //
      // dynaudnorm (not loudnorm) for the level-matching pass: loudnorm's
      // single-pass "dynamic" mode needs several seconds of lookahead to
      // measure true loudness before it can apply meaningful gain, so on the
      // short voiceover clips typically uploaded here it was barely raising
      // the level at all — the track technically existed in the output but
      // was effectively inaudible. dynaudnorm normalizes frame-by-frame with
      // no such warm-up requirement, so quiet phone/browser recordings
      // reliably come up to an audible level even on a few-second clip.
      // alimiter afterward is a hard ceiling so the boosted signal can never clip.
      filterGraph.push(`[${audioInputIdx}:a:0]dynaudnorm=f=150:g=15:m=15,alimiter=limit=0.95[aout]`);
      outputOptions = outputOptions.concat(["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    } else {
      // Original clip audio is optional (`0:a:0?` — some raw uploads have no
      // audio track at all), so an unconditional filter here would error out
      // on those with "no audio stream to filter". Passed straight through
      // rather than through the filter graph since there's nothing to do to it.
      outputOptions = outputOptions.concat(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k"]);
    }

    // fluent-ffmpeg's "error" event only carries the top-level spawn/exit
    // error (usually just "ffmpeg exited with code 1"), not ffmpeg's own
    // stderr explanation of WHY — which is the part that actually says
    // things like "No such filter" or "Invalid argument". Without it, every
    // real failure looked identical from the job's jobError field, making a
    // genuine bug indistinguishable from "nothing happened". Buffered here
    // (capped) and appended to the rejection below.
    let stderrTail = "";
    command.on("stderr", (line) => {
      stderrTail = (stderrTail + "\n" + line).slice(-4000);
    });

    command
      .complexFilter(filterGraph)
      .outputOptions(outputOptions)
      .on("start", (cmd) => console.log("FFmpeg started:", cmd))
      .on("progress", (progress) => {
        if (!onProgress) return;
        const seconds = timemarkToSeconds(progress.timemark);
        // Capped at 99 — "done" is only ever declared once the audio
        // verification safety net below has passed, not the moment ffmpeg's
        // own progress events tick over 100%.
        const percent = duration > 0 ? Math.min(99, Math.round((seconds / duration) * 100)) : undefined;
        onProgress({ percent, seconds });
      })
      .on("error", (err) => {
        // Full tail goes to the server console for debugging; only a shorter
        // slice rides along in the rejection, since that message ends up
        // verbatim in jobError and gets shown to the user via alert().
        if (stderrTail.trim()) console.error("[ffmpeg stderr]", stderrTail.trim());
        const shortDetail = stderrTail.trim().slice(-500);
        reject(shortDetail ? new Error(`${err.message}\n${shortDetail}`) : err);
      })
      .on("end", async () => {
        try {
          await verifyRenderedAudio(outPath, { required: !!rawAudioPath });
          resolve(outPath);
        } catch (verifyErr) {
          reject(verifyErr);
        }
      })
      .save(outPath);
  });
}

// Shared filter graph: fit the full source frame inside the 1080x1920 canvas
// (no cropping) over a plain black background, then composite the design PNG
// (which now includes the land-type badge, baked in and visible from the
// first frame — same as the title/area/price/location text) on top.
// `overlay=...:shortest=1` on the black-fill step matters because the
// `color` source is otherwise infinite — shortest=1 makes the composited
// stream end when the actual video (the shorter of the two) ends.
//
// When `tagline` is given, its banner PNG is composited last with an animated
// `y` expression: it drops in from just above the frame during [0, slideIn],
// holds at its resting y for [slideIn, holdEnd], then rises back out during
// [holdEnd, duration]. `x` stays fixed (horizontally centered) throughout.
//
// Returns a mutable array of filtergraph strings — renderReel above may push
// an additional (independent) audio filtergraph node onto it before passing
// the whole thing to a single `.complexFilter()` call.
function buildFrameFilter({ tagline = null } = {}) {
  const steps = [
    `color=c=black:s=${CANVAS_W}x${CANVAS_H}[bgblack]`,
    `[0:v]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=decrease[fg]`,
    `[bgblack][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[base]`,
  ];

  let lastLabel = "base";
  let nextInput = 1;

  steps.push(`[${lastLabel}][${nextInput}:v]overlay=0:0:format=auto[withMain]`);
  lastLabel = "withMain";
  nextInput += 1;

  if (tagline) {
    const { x, y, h, slideIn, holdEnd, duration } = tagline;
    const offscreenY = -h - 4;
    // Piecewise-linear y: offscreen -> resting (slide in), hold, resting -> offscreen (slide out)
    const yExpr =
      `if(lt(t,${slideIn}),${offscreenY}+(${y}-${offscreenY})*(t/${slideIn}),` +
      `if(lt(t,${holdEnd}),${y},` +
      `if(lt(t,${duration}),${y}+(${offscreenY}-${y})*((t-${holdEnd})/(${Math.max(duration - holdEnd, 0.001)})),${offscreenY})))`;
    steps.push(`[${lastLabel}][${nextInput}:v]overlay=x=${x}:y='${yExpr}':format=auto[vout]`);
  } else {
    // rename final label to [vout] when no tagline layer changed it above
    steps[steps.length - 1] = steps[steps.length - 1].replace(`[${lastLabel}]`, "[vout]");
  }

  return steps;
}

/**
 * renderPreviewImage
 *  - Grabs a single frame from the raw video, fits it into the same 1080x1920
 *    black-filled canvas used for the real export, and composites the design
 *    PNG on top — producing a fast static JPEG "what will this look like"
 *    preview without encoding a full video.
 *  - `atSeconds` picks which moment of the clip to snapshot; falls back to the
 *    very first frame if the clip is shorter than that.
 */
export function renderPreviewImage({ rawVideoPath, overlayPngPath, outPath, atSeconds = 1 }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(rawVideoPath).inputOptions(atSeconds > 0 ? ["-ss", String(atSeconds)] : []).input(overlayPngPath);

    command
      .complexFilter(buildFrameFilter())
      .outputOptions(["-map", "[vout]", "-frames:v", "1", "-q:v", "2"])
      .on("start", (cmd) => console.log("Preview image FFmpeg started:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve(outPath))
      .save(outPath);
  });
}