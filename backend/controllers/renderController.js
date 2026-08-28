import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import Video from "../models/Video.js";
import { buildOverlayPng, buildBadgeOnlyPng, buildTaglineOnlyPng, TAGLINE_TARGET_Y } from "../utils/renderOverlay.js";
import { renderReel, renderPreviewImage } from "../utils/ffmpegRender.js";

const TEMP_DIR = path.resolve("temp");
const OUTPUT_DIR = path.resolve("outputs");
for (const d of [TEMP_DIR, OUTPUT_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// Land-type badge reveal point, as a fraction of the clip's total duration.
// Kept as one constant so preview and finalize renders always agree.
const BADGE_REVEAL_RATIO = 0.25;

async function runRender(doc, quality) {
  const overlayPath = path.join(TEMP_DIR, `overlay-${doc._id}-${uuid()}.png`);
  const badgeOverlayPath = path.join(TEMP_DIR, `overlay-badge-${doc._id}-${uuid()}.png`);
  const taglineOverlayPath = path.join(TEMP_DIR, `overlay-tagline-${doc._id}-${uuid()}.png`);
  // Main overlay excludes the badge AND the tagline — both are timed in
  // separately below (badge: reveals partway through; tagline: animated
  // slide in/hold/out) so they can't just be baked in as static pixels.
  const [, , taglineMeta] = await Promise.all([
    buildOverlayPng(doc, overlayPath, { includeBadge: false, includeTagline: false }),
    buildBadgeOnlyPng(doc, badgeOverlayPath),
    buildTaglineOnlyPng(taglineOverlayPath),
  ]);

  const outPath = path.join(OUTPUT_DIR, `reel-${doc._id}-${uuid()}.mp4`);
  await renderReel({
    rawVideoPath: doc.rawVideoPath,
    rawAudioPath: doc.rawAudioPath,
    overlayPngPath: overlayPath,
    badgeOverlayPngPath: badgeOverlayPath,
    badgeRevealRatio: BADGE_REVEAL_RATIO,
    taglineOverlayPngPath: taglineOverlayPath,
    taglineWidth: taglineMeta.width,
    taglineHeight: taglineMeta.height,
    taglineTargetY: TAGLINE_TARGET_Y,
    outPath,
    quality,
  });

  fs.unlink(overlayPath, () => {}); // overlay PNGs are scratch files either way
  fs.unlink(badgeOverlayPath, () => {});
  fs.unlink(taglineOverlayPath, () => {});
  return outPath;
}

// Draft/preview render — raw source files are KEPT so the design stays editable.
export async function renderPreview(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!doc.rawVideoPath || !fs.existsSync(doc.rawVideoPath)) {
      return res.status(400).json({ error: "Raw video no longer on server (project already finalized)." });
    }

    const quality = req.body?.quality || "standard"; // previews default to the fast tier
    const outPath = await runRender(doc, quality);

    // replace any previous preview file
    if (doc.previewOutputPath && fs.existsSync(doc.previewOutputPath)) {
      fs.unlink(doc.previewOutputPath, () => {});
    }
    doc.previewOutputPath = outPath;
    doc.status = "rendered";
    await doc.save();

    res.json({ message: "Preview rendered", previewUrl: `/outputs/${path.basename(outPath)}`, video: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Render failed", details: err.message });
  }
}

// Fast static-image preview of the generated template — a single JPEG frame
// showing exactly how the frame/text/badge/footer/optional extras will sit
// over the footage, without waiting for a full MP4 render. Raw source files
// are kept either way (this never touches finalize's cleanup step).
export async function renderPreviewImageCtrl(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!doc.rawVideoPath || !fs.existsSync(doc.rawVideoPath)) {
      return res.status(400).json({ error: "Raw video no longer on server (project already finalized)." });
    }

    const overlayPath = path.join(TEMP_DIR, `overlay-${doc._id}-${uuid()}.png`);
    await buildOverlayPng(doc, overlayPath);

    const outPath = path.join(OUTPUT_DIR, `preview-${doc._id}-${uuid()}.jpg`);
    try {
      await renderPreviewImage({ rawVideoPath: doc.rawVideoPath, overlayPngPath: overlayPath, outPath, atSeconds: 1 });
    } catch {
      // clip shorter than 1s (or seek otherwise failed) — retry from the very first frame
      await renderPreviewImage({ rawVideoPath: doc.rawVideoPath, overlayPngPath: overlayPath, outPath, atSeconds: 0 });
    }
    fs.unlink(overlayPath, () => {});

    if (doc.previewImagePath && fs.existsSync(doc.previewImagePath)) {
      fs.unlink(doc.previewImagePath, () => {});
    }
    doc.previewImagePath = outPath;
    await doc.save();

    res.json({ message: "Preview image generated", previewImageUrl: `/outputs/${path.basename(outPath)}`, video: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Preview image generation failed", details: err.message });
  }
}

// Final export — renders once more from the latest design, THEN deletes the
// raw uploaded video/audio from the server, per the requirement that source
// files must not linger after the job is done. Only the finished reel + the
// design JSON remain, so the record and the output stay recoverable/re-downloadable
// even though the raw upload is gone.
export async function finalizeAndCleanup(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!doc.rawVideoPath || !fs.existsSync(doc.rawVideoPath)) {
      return res.status(400).json({ error: "Already finalized." });
    }

    const quality = req.body?.quality || "high";
    const outPath = await runRender(doc, quality);
    doc.finalOutputPath = outPath;
    doc.lastExportQuality = quality;

    // ---- cleanup: delete raw uploaded video & audio from the server ----
    const toDelete = [doc.rawVideoPath, doc.rawAudioPath].filter(Boolean);
    for (const p of toDelete) {
      fs.unlink(p, (err) => {
        if (err) console.warn("Could not delete", p, err.message);
      });
    }
    doc.rawVideoPath = null;
    doc.rawAudioPath = null;
    doc.status = "finalized";
    await doc.save();

    res.json({
      message: "Finalized. Raw uploaded video/audio deleted from server.",
      finalUrl: `/outputs/${path.basename(outPath)}`,
      video: doc,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Finalize failed", details: err.message });
  }
}
