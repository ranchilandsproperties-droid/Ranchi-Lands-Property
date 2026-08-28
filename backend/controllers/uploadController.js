import fs from "fs";
import path from "path";
import Video from "../models/Video.js";
import { compressRawUpload } from "../utils/ffmpegRender.js";

const DEFAULT_ELEMENTS = [
  // A prominent, bold, icon-led SHORT location line at the TOP of the frame,
  // directly under the land-type badge (badge sits at canvas y:172-236px,
  // i.e. ~9-12.3% of the 1920-tall canvas) — a second, larger/bolder
  // placement for at-a-glance framing. Field: "location" (short, main
  // highlighted location, e.g. "Vazhakkala, Kochi").
  // x:5.6% (~60px) lines up with the badge's left edge.
  { id: "el-location-top", type: "text", field: "location", x: 5.6, y: 13, fontSize: 46, color: "#FFFFFF", pinColor: "#D4AF37", bold: true, align: "left", background: false },
  { id: "el-title", type: "text", field: "title", x: 8, y: 65, fontSize: 64, color: "#FFFFFF", bold: true, align: "left" },
  // DESCRIPTIVE location line, shown together with the title/area/price
  // detail stack. Field: "locationDescriptive" (longer text — nearby
  // landmarks, pincode, road access, etc.). Nudged up (was y:80/85/90) so
  // the stack clears the additional-text strip + footer (which together
  // occupy the bottom ~11% of the frame) even when a listing has
  // additional text set — see the price note below.
  { id: "el-location", type: "text", field: "locationDescriptive", x: 8, y: 73, fontSize: 38, color: "#F1F1F1", bold: false, align: "left" },
  { id: "el-area", type: "text", field: "area", x: 8, y: 78.5, fontSize: 38, color: "#F1F1F1", bold: false, align: "left" },
  // Price stays at this fixed spot (x:8, y:84) always — it is OPTIONAL, not
  // repositioned: fieldValue.price below resolves to "" when no price is
  // set, and the render loop's "if (!text) continue" simply skips drawing
  // it — the position itself never changes based on whether a price exists.
  // Moved up from y:90 to y:84 so it no longer collides with the optional
  // additional-text strip + fixed footer at the bottom of the frame.
  { id: "el-price", type: "text", field: "price", x: 8, y: 84, fontSize: 46, color: "#D4AF37", bold: true, align: "left" },
  // NOTE: additionalText is no longer a draggable element here — it now
  // renders in its own fixed, full-width strip directly above the footer
  // (see drawAdditionalTextStrip in backend/utils/renderOverlay.js), only
  // taking up space when a listing actually has one set.
];

export async function createVideoProject(req, res) {
  try {
    const {
      title,
      description,
      landType,
      areaValue,
      areaUnit,
      price,
      location,
      locationDescriptive,
      contactNumber,
      ownerOrAgentName,
      additionalText,
    } = req.body;

    if (!req.files?.video?.[0]) {
      return res.status(400).json({ error: "A raw video file is required." });
    }
    if (!title || !landType || !areaValue || !location || !locationDescriptive) {
      return res.status(400).json({ error: "title, landType, areaValue, location and locationDescriptive are required." });
    }

    const videoFile = req.files.video[0];
    const audioFile = req.files.audio?.[0] || null;
    const additionalImageFile = req.files.additionalImage?.[0] || null; // optional, used only when supplied

    const doc = await Video.create({
      title,
      description,
      landType,
      areaValue,
      areaUnit: areaUnit || "cent",
      price,
      location,
      locationDescriptive,
      contactNumber,
      ownerOrAgentName,
      additionalText: additionalText || "",
      additionalImagePath: additionalImageFile ? additionalImageFile.path : null,
      rawVideoPath: videoFile.path,
      rawAudioPath: audioFile ? audioFile.path : null,
      status: "designing",
      design: { frameStyle: "gold-border", accentColor: "#D4AF37", backgroundOverlay: "rgba(0,0,0,0.25)", elements: DEFAULT_ELEMENTS },
    });

    res.status(201).json(doc);

    // Compress the raw upload AFTER responding — never block the upload
    // request on it. ffmpeg compression can easily take longer than a
    // browser/proxy request timeout allows for a multi-minute clip, which is
    // exactly what was causing the upload to show "failed" right after
    // reaching 100% (the file was there; the request just never got its
    // response back in time). Runs fire-and-forget here, same background
    // pattern as the preview/finalize render jobs — see compressRawUploadJob
    // below for what happens once it finishes.
    compressRawUploadJob(doc._id, videoFile.path);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
}

// Fire-and-forget background compression for a just-created project's raw
// video. Non-fatal end to end: if compression fails for any reason (corrupt
// source, unsupported codec, etc.) the project just keeps its original,
// uncompressed rawVideoPath — nothing here can fail the upload itself, since
// it only ever runs after the 201 response has already been sent.
async function compressRawUploadJob(docId, originalPath) {
  const compressedPath = path.join(
    path.dirname(originalPath),
    `${path.basename(originalPath, path.extname(originalPath))}-compressed.mp4`
  );
  try {
    await compressRawUpload(originalPath, compressedPath);

    // The project may have moved on while compression was running (raw video
    // deleted via "Delete source video", or the project deleted outright) —
    // re-check before swapping the path in so we don't resurrect a stale
    // reference or leave an orphaned compressed file with nothing pointing at it.
    const doc = await Video.findById(docId);
    if (!doc || doc.rawVideoPath !== originalPath) {
      fs.unlink(compressedPath, () => {});
      return;
    }

    doc.rawVideoPath = compressedPath;
    await doc.save();
    fs.unlink(originalPath, () => {}); // drop the larger original now that the compressed copy is live
  } catch (err) {
    console.warn(`Raw video compression failed for ${docId}, keeping original upload:`, err.message);
    fs.unlink(compressedPath, () => {}); // clean up any partial output ffmpeg may have left behind
  }
}

// Optional extras — additionalText and/or additionalImage — editable at any point
// before finalize, independent of the design JSON. Both stay fully optional:
// omit either field in the request to leave it unchanged, or send an empty
// additionalText / removeAdditionalImage=true to clear them.
export async function updateExtras(req, res) {
  const doc = await Video.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (doc.status === "finalized") {
    return res.status(400).json({ error: "This project was already finalized; its raw video was removed from the server." });
  }

  if (typeof req.body.additionalText === "string") {
    doc.additionalText = req.body.additionalText;
  }

  const newImage = req.files?.additionalImage?.[0] || null;
  if (newImage) {
    if (doc.additionalImagePath && fs.existsSync(doc.additionalImagePath)) {
      fs.unlink(doc.additionalImagePath, () => {});
    }
    doc.additionalImagePath = newImage.path;
  } else if (req.body.removeAdditionalImage === "true") {
    if (doc.additionalImagePath && fs.existsSync(doc.additionalImagePath)) {
      fs.unlink(doc.additionalImagePath, () => {});
    }
    doc.additionalImagePath = null;
  }

  await doc.save();
  res.json(doc);
}

export async function getVideoProject(req, res) {
  const doc = await Video.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json(doc);
}

export async function listVideoProjects(req, res) {
  const docs = await Video.find().sort({ createdAt: -1 }).select("-design.elements");
  res.json(docs);
}

// Design is fully editable up until finalize — this just persists the JSON.
export async function updateDesign(req, res) {
  const doc = await Video.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (doc.status === "finalized") {
    return res.status(400).json({ error: "This project was already finalized; its raw video was removed from the server." });
  }
  doc.design = { ...doc.design.toObject(), ...req.body.design };
  doc.status = "designing";
  await doc.save();
  res.json(doc);
}