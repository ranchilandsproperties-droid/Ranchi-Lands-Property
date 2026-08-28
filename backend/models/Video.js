import mongoose from "mongoose";

/*
 * One document = one "land promo reel" project.
 *
 * Lifecycle:
 *  uploaded -> designing (user edits overlay/frame) -> rendered (preview mp4 made,
 *  raw source files still kept so design can change) -> finalized (final export made,
 *  raw uploaded video/audio DELETED from server per requirement, only the
 *  rendered output + design JSON remain for record/re-download).
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
    location: { type: String, required: true },
    contactNumber: { type: String, default: "" },
    ownerOrAgentName: { type: String, default: "" },

    // ---- optional extras (both fully optional — used only when the listing needs them) ----
    additionalText: { type: String, default: "" }, // free-form extra line, shown bottom-right of the frame
    additionalImagePath: { type: String, default: null }, // small supplementary image, shown bottom-left of the frame

    // ---- file bookkeeping ----
    rawVideoPath: { type: String, default: null }, // deleted at finalize time
    rawAudioPath: { type: String, default: null }, // deleted at finalize time (optional track)
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
  },
  { timestamps: true }
);

export default mongoose.model("Video", VideoSchema);
