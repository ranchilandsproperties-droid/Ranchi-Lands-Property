import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import Video from "../models/Video.js";
import { buildOverlayPng, buildBadgeOnlyPng, buildTaglineOnlyPng, TAGLINE_TARGET_Y } from "../utils/renderOverlay.js";
import { renderReel, renderPreviewImage } from "../utils/ffmpegRender.js";

// Anchored to this file's directory rather than process.cwd() — same
// cwd-independence fix as utils/renderOverlay.js and server.js.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, "..", "temp");
const OUTPUT_DIR = path.join(__dirname, "..", "outputs");
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

// Runs the actual render OFF the request/response cycle and records the
// result on the document once it's done. This is what lets renderPreview /
// finalizeAndCleanup below respond immediately instead of holding the HTTP
// connection open for the whole encode — video rendering (node-canvas +
// ffmpeg) routinely takes longer than a proxy's or Node's own default
// request timeout allows, which is exactly what was causing renders to
// "always disconnect" before finishing even though ffmpeg itself was fine.
async function runRenderJob(docId, kind, quality) {
  try {
    const doc = await Video.findById(docId);
    if (!doc) return; // project was deleted mid-render; nothing to update

    const outPath = await runRender(doc, quality);

    if (kind === "preview") {
      if (doc.previewOutputPath && fs.existsSync(doc.previewOutputPath) && doc.previewOutputPath !== outPath) {
        fs.unlink(doc.previewOutputPath, () => {});
      }
      await Video.findByIdAndUpdate(docId, {
        previewOutputPath: outPath,
        status: "rendered",
        jobStatus: "done",
        jobError: null,
      });
    } else {
      await Video.findByIdAndUpdate(docId, {
        finalOutputPath: outPath,
        lastExportQuality: quality,
        status: "finalized",
        jobStatus: "done",
        jobError: null,
      });
    }
  } catch (err) {
    console.error(`[render:${kind}] failed for ${docId}:`, err);
    await Video.findByIdAndUpdate(docId, {
      jobStatus: "error",
      jobError: err.message || "Render failed",
    }).catch(() => {});
  }
}

// Draft/preview render — raw source files are KEPT so the design stays
// editable. Starts the render in the background and returns right away;
// poll GET /api/videos/:id and watch `jobStatus` ("rendering" -> "done" or
// "error") to know when previewOutputPath is ready.
export async function renderPreview(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!doc.rawVideoPath || !fs.existsSync(doc.rawVideoPath)) {
      return res.status(400).json({ error: "Raw video no longer on server." });
    }
    if (doc.jobStatus === "rendering") {
      return res.status(409).json({ error: "A render is already in progress for this project." });
    }

    const quality = req.body?.quality || "standard"; // previews default to the fast tier
    doc.jobStatus = "rendering";
    doc.jobKind = "preview";
    doc.jobError = null;
    await doc.save();

    runRenderJob(doc._id, "preview", quality); // fire-and-forget on purpose

    res.status(202).json({ message: "Preview render started", video: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start render", details: err.message });
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

// Final export — renders once more from the latest design. The raw uploaded
// video/audio is intentionally KEPT on the server after this — the user may
// still want to re-render, and shouldn't lose the source the moment export
// finishes. Cleanup is a separate, explicit step (see deleteRawFiles below),
// triggered only when the user presses "Delete source video" themselves
// (e.g. after downloading and confirming the export looks right).
// Same background-job pattern as renderPreview above — starts the render and
// returns immediately; poll GET /api/videos/:id for jobStatus/finalOutputPath.
export async function finalizeAndCleanup(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    if (!doc.rawVideoPath || !fs.existsSync(doc.rawVideoPath)) {
      return res.status(400).json({ error: "Raw video no longer on server (already deleted)." });
    }
    if (doc.jobStatus === "rendering") {
      return res.status(409).json({ error: "A render is already in progress for this project." });
    }

    const quality = req.body?.quality || "high";
    doc.jobStatus = "rendering";
    doc.jobKind = "finalize";
    doc.jobError = null;
    await doc.save();

    runRenderJob(doc._id, "finalize", quality); // fire-and-forget on purpose

    res.status(202).json({ message: "Final export started", video: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start final export", details: err.message });
  }
}

// Explicit, user-triggered cleanup — deletes the raw uploaded video/audio
// from disk and clears those fields in Mongo. Only the finished reel(s) and
// the design record remain afterward. Called from a dedicated "Delete source
// video" button on the frontend; never invoked automatically.
export async function deleteRawFiles(req, res) {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const toDelete = [doc.rawVideoPath, doc.rawAudioPath].filter(Boolean);
    if (toDelete.length === 0) {
      return res.status(400).json({ error: "No raw video/audio on server to delete." });
    }

    for (const p of toDelete) {
      fs.unlink(p, (err) => {
        if (err) console.warn("Could not delete", p, err.message);
      });
    }
    doc.rawVideoPath = null;
    doc.rawAudioPath = null;
    await doc.save();

    res.json({ message: "Raw uploaded video/audio deleted from server.", video: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed", details: err.message });
  }
}