import ffmpeg from "fluent-ffmpeg";
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

// Probes a video file's duration (seconds) via ffprobe. Resolves to 0 on any
// failure rather than rejecting — worst case the badge just shows from the
// start instead of blocking the whole render over a probe hiccup.
function getVideoDurationSeconds(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      const duration = !err && parseFloat(data?.format?.duration);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });
  });
}

/**
 * renderReel
 *  - Fits the ENTIRE raw video into the 1080x1920 Reels canvas without cropping
 *    any portion of it: the clip is scaled to fit inside the frame, and any
 *    empty top/bottom (or side) space is filled with plain black — no blur/zoom
 *    fill — so the letterboxed area reads as a clean black bar.
 *  - Overlays the rasterized design PNG (frame border, text, footer, etc.) on top.
 *  - If `badgeOverlayPngPath` is supplied (a transparent PNG containing just the
 *    land-type badge), it's composited in separately with an ffmpeg `enable=`
 *    time gate so the badge only appears once the clip has played through
 *    `badgeRevealRatio` of its total length (default 25%), rather than being
 *    visible from the first frame.
 *  - If audio was uploaded, replaces the clip's original audio with it; else
 *    keeps the original audio.
 *  - `quality` selects one of QUALITY_PRESETS to control encode CRF/bitrate.
 *
 * Returns a Promise that resolves with outPath when done.
 */
export async function renderReel({
  rawVideoPath,
  rawAudioPath,
  overlayPngPath,
  badgeOverlayPngPath,
  badgeRevealRatio = 0.25,
  taglineOverlayPngPath,
  taglineWidth,
  taglineHeight,
  taglineTargetY,
  taglineSlideSeconds = 0.9,
  outPath,
  quality = "high",
}) {
  const q = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

  // Both the badge reveal point and the tagline's slide-in/hold/slide-out
  // timing are fractions/offsets of the clip's total length, so probe it
  // once up front and reuse it for whichever of the two is present.
  let duration = 0;
  if (badgeOverlayPngPath || taglineOverlayPngPath) {
    duration = await getVideoDurationSeconds(rawVideoPath);
  }

  let revealAt = 0;
  if (badgeOverlayPngPath) {
    revealAt = +(duration * badgeRevealRatio).toFixed(2); // 0 if duration couldn't be probed
  }

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
    if (badgeOverlayPngPath) command.input(badgeOverlayPngPath);
    if (taglineOverlayPngPath) command.input(taglineOverlayPngPath);

    const videoFilter = buildFrameFilter({ badge: !!badgeOverlayPngPath, revealAt, tagline });

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
      command.input(rawAudioPath);
      // input index shifts by one for each of the badge/tagline overlays that are also present
      const audioInputIdx = 2 + (badgeOverlayPngPath ? 1 : 0) + (taglineOverlayPngPath ? 1 : 0);
      // -shortest trims to the shorter of video/audio so it never runs past the clip.
      // loudnorm brings the uploaded track up to a consistent, Reels-friendly
      // loudness (-14 LUFS, the level Instagram/Spotify etc. normalize to)
      // with a -1dBTP true-peak ceiling so it can't clip — previously there
      // was no gain/normalization at all, so a quietly-recorded voiceover or
      // music track played back noticeably quieter than the source file.
      outputOptions = outputOptions.concat([
        "-map",
        `${audioInputIdx}:a:0`,
        "-af",
        "loudnorm=I=-14:TP=-1:LRA=11",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
      ]);
    } else {
      // Original clip audio is optional (`0:a:0?` — some raw uploads have no
      // audio track at all), so an unconditional `-af` here would error out
      // on those with "no audio stream to filter". Left as-is; the loudness
      // fix above covers the case the user actually reported (an uploaded
      // voiceover/music track playing back too quiet).
      outputOptions = outputOptions.concat(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k"]);
    }

    command
      .complexFilter(videoFilter)
      .outputOptions(outputOptions)
      .on("start", (cmd) => console.log("FFmpeg started:", cmd))
      .on("error", (err) => reject(err))
      .on("end", () => resolve(outPath))
      .save(outPath);
  });
}

// Shared filter graph: fit the full source frame inside the 1080x1920 canvas
// (no cropping) over a plain black background, then composite the design PNG
// on top. `overlay=...:shortest=1` on the black-fill step matters because the
// `color` source is otherwise infinite — shortest=1 makes the composited
// stream end when the actual video (the shorter of the two) ends.
//
// When `badge` is true, the badge-only PNG is composited on top with
// `enable='gte(t,revealAt)'`, so it stays invisible until output timestamp
// `t` reaches `revealAt` seconds, then stays visible for the rest of the clip.
//
// When `tagline` is given, its banner PNG is composited last with an animated
// `y` expression: it drops in from just above the frame during [0, slideIn],
// holds at its resting y for [slideIn, holdEnd], then rises back out during
// [holdEnd, duration]. `x` stays fixed (horizontally centered) throughout.
function buildFrameFilter({ badge = false, revealAt = 0, tagline = null } = {}) {
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

  if (badge) {
    const label = tagline ? "withBadge" : "vout";
    steps.push(`[${lastLabel}][${nextInput}:v]overlay=0:0:enable='gte(t,${revealAt})'[${label}]`);
    lastLabel = label;
    nextInput += 1;
  }

  if (tagline) {
    const { x, y, h, slideIn, holdEnd, duration } = tagline;
    const offscreenY = -h - 4;
    // Piecewise-linear y: offscreen -> resting (slide in), hold, resting -> offscreen (slide out)
    const yExpr =
      `if(lt(t,${slideIn}),${offscreenY}+(${y}-${offscreenY})*(t/${slideIn}),` +
      `if(lt(t,${holdEnd}),${y},` +
      `if(lt(t,${duration}),${y}+(${offscreenY}-${y})*((t-${holdEnd})/(${Math.max(duration - holdEnd, 0.001)})),${offscreenY})))`;
    steps.push(`[${lastLabel}][${nextInput}:v]overlay=x=${x}:y='${yExpr}':format=auto[vout]`);
  } else if (lastLabel !== "vout") {
    // rename final label to [vout] when neither extra layer changed it above
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