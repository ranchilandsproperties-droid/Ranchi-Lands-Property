import mongoose from "mongoose";

/*
 * One document = one "land promo reel" project.
 *
 * Lifecycle:
 *  uploaded -> designing (user edits overlay/frame) -> rendered (preview mp4 made,
 *  raw source files still kept so design can change) -> finalized (final export
 *  made; raw uploaded video/audio is still KEPT on the server at this point).
 *  The raw video/audio is only removed when the user explicitly deletes it
 *  (DELETE /api/videos/:id/raw), typically after downloading the final export.
 */
const VideoSchema = new mongoose.Schema(
  {
    // ---- listing details captured at upload time ----
    title: { type: String, required: true },
    description: { type: String, default: "" },
    landType: {
      type: String,
      enum: ["Residential Plot", "Commercial Land", "Agricultural Land", "Industrial Land", "Farmhouse Land", "Other"],
      required: true,
    },
    areaValue: { type: Number, required: true }, // numeric area
    // Selectable area unit — "cent" and "decimal" are the same measure (common
    // in Kerala/South-Indian land listings) but both are offered since sellers
    // refer to them by either name; "sqm" added alongside sqft for completeness.
    areaUnit: {
      type: String,
      enum: ["cent", "decimal", "sqft", "sqm", "sqyd", "acre", "hectare", "bigha", "katha"],
      default: "cent",
    },
    price: { type: String, default: "" }, // kept as string to allow "On Request", "₹45 Lakh", etc.
    // Split into two distinct location fields:
    //  - location: SHORT, main-highlighted location (e.g. "Vazhakkala, Kochi"),
    //    rendered bold/large at the top of the frame just under the land-type badge.
    //  - locationDescriptive: longer DESCRIPTIVE location text (nearby landmarks,
    //    pincode, road access, etc.), rendered in the lower detail stack
    //    alongside area/price.
    location: { type: String, required: true },
    locationDescriptive: { type: String, required: true },
    contactNumber: { type: String, default: "" },
    ownerOrAgentName: { type: String, default: "" },

    // ---- optional extras (both fully optional — used only when the listing needs them) ----
    additionalText: { type: String, default: "" }, // free-form extra line, shown bottom-right of the frame
    additionalImagePath: { type: String, default: null }, // small supplementary image, shown bottom-left of the frame

    // ---- file bookkeeping ----
    rawVideoPath: { type: String, default: null }, // deleted only when the user explicitly requests it (DELETE .../raw)
    rawAudioPath: { type: String, default: null }, // optional track; same manual-delete-only rule
    previewOutputPath: { type: String, default: null }, // draft render, can be re-rendered
    previewImagePath: { type: String, default: null }, // static image snapshot of the templated design
    finalOutputPath: { type: String, default: null }, // last finalized export
    lastExportQuality: { type: String, enum: ["standard", "high", "ultra"], default: "high" },

    // ---- editable design (canvas-style overlay definition) ----
    // Frontend's design editor reads/writes this JSON. Backend just persists it
    // and rasterizes it to a PNG overlay at render time.
    design: {
      frameStyle: { type: String, default: "gold-border" }, // gold-border, minimal-white, glass, none
      accentColor: { type: String, default: "#D4AF37" },
      backgroundOverlay: { type: String, default: "rgba(0,0,0,0.25)" },
      elements: [
        {
          id: String,
          type: { type: String, enum: ["text", "badge", "logo"], default: "text" },
          field: String, // maps to title/price/area/location/landType/custom
          text: String, // resolved/custom text
          x: Number, // percentage 0-100 of 1080x1920 canvas
          y: Number,
          fontSize: Number,
          fontFamily: { type: String, default: "sans-serif" },
          color: { type: String, default: "#FFFFFF" },
          bold: { type: Boolean, default: true },
          align: { type: String, default: "left" },
        },
      ],
    },

    status: {
      type: String,
      enum: ["uploaded", "designing", "rendered", "finalized"],
      default: "uploaded",
    },

    // ---- background render job tracking ----
    // Rendering (node-canvas rasterization + ffmpeg encode) can take longer
    // than a single HTTP request should be held open for, especially on a
    // slow/free-tier host — so preview/finalize renders now run in the
    // background and the request returns immediately once the job is
    // queued. The frontend polls GET /api/videos/:id and watches these
    // fields instead of waiting on one long response.
    jobStatus: { type: String, enum: ["idle", "rendering", "done", "error"], default: "idle" },
    jobKind: { type: String, enum: [null, "preview", "finalize", "preview-image"], default: null },
    jobError: { type: String, default: null },
    // 0-100. Only meaningful while jobStatus === "rendering"; driven by ffmpeg's
    // own progress events for video jobs (see utils/ffmpegRender.js's onProgress),
    // left at 0 for preview-image jobs since those are a single-frame grab with
    // nothing to meaningfully report progress on.
    jobProgress: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Video", VideoSchema);