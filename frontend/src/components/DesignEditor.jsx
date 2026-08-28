import React, { useEffect, useRef, useState } from "react";
import {
  updateDesign,
  updateExtras,
  renderPreview,
  renderPreviewImage,
  finalizeProject,
  deleteRawVideo,
  pollUntilRenderDone,
  assetUrl,
  getBrand,
} from "../api.js";

const FRAME_STYLES = [
  { id: "gold-border", label: "Gold Border" },
  { id: "minimal-white", label: "Minimal White" },
  { id: "glass", label: "Glass Panel" },
  { id: "none", label: "No Frame" },
];

// Preview-frame pixel heights for the fixed footer / optional additional-text
// strip, scaled down from the backend's 1080-wide canvas (FOOTER_STRIP_H=150,
// ADDITIONAL_TEXT_STRIP_H=64 in backend/utils/renderOverlay.js) to this
// component's 320px-wide preview frame, so the two always stay in sync.
const FOOTER_PREVIEW_H = 44;
const ADDITIONAL_TEXT_PREVIEW_H = 19;
// Gap kept clear below the footer, matching FOOTER_BOTTOM_MARGIN=60 in
// backend/utils/renderOverlay.js (scaled the same way as the two heights
// above) — keeps the footer stack up off the very bottom edge instead of
// sitting flush against it.
const FOOTER_BOTTOM_MARGIN_PREVIEW = 18;

const QUALITY_OPTIONS = [
  { id: "standard", label: "Standard", hint: "fast, smaller file" },
  { id: "high", label: "High", hint: "recommended for posting" },
  { id: "ultra", label: "Ultra", hint: "best detail, slower render" },
];

const FIELD_PREVIEW = (project) => ({
  title: project.title,
  price: project.price ? `₹ ${project.price}` : "",
  area: `${project.areaValue} ${project.areaUnit}`,
  location: project.location,
  locationDescriptive: project.locationDescriptive,
  landType: project.landType,
  additionalText: project.additionalText || "",
});

export default function DesignEditor({ project: initialProject, onBack }) {
  const [project, setProject] = useState(initialProject);
  const [design, setDesign] = useState(initialProject.design);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deletingRaw, setDeletingRaw] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [finalUrl, setFinalUrl] = useState(null);
  const [previewQuality, setPreviewQuality] = useState("standard");
  const [finalQuality, setFinalQuality] = useState("high");
  const frameRef = useRef(null);
  const dragState = useRef(null);
  const [brand, setBrand] = useState(null);

  // ---- optional extras: additional text (bottom-right) + additional image (bottom-left) ----
  const [additionalText, setAdditionalText] = useState(initialProject.additionalText || "");
  const [additionalImageFile, setAdditionalImageFile] = useState(null);
  const [savingExtras, setSavingExtras] = useState(false);

  // ---- static image preview of the generated template ----
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [previewImageLoading, setPreviewImageLoading] = useState(false);

  // Live progress (0-100) for whichever background job is currently running —
  // shared across preview render / preview image / finalize since only one of
  // the three can be "rendering" for a given project at once (the backend
  // rejects a second job with 409 while one is in flight). Driven by
  // `jobProgress` on the polled project doc (see api.js's pollUntilRenderDone
  // onTick), which in turn comes from ffmpeg's own progress events for the two
  // video jobs, or jumps straight to 100 on completion for preview-image.
  const [renderProgress, setRenderProgress] = useState(0);

  useEffect(() => {
    getBrand().then(setBrand).catch(() => {});
  }, []);

  const values = FIELD_PREVIEW(project);
  const selected = design.elements.find((e) => e.id === selectedId);

  function updateElement(id, patch) {
    setDesign((d) => ({ ...d, elements: d.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) }));
  }

  // ---- drag to reposition text (percent-based, matches backend 1080x1920 canvas) ----
  function onPointerDown(e, id) {
    setSelectedId(id);
    dragState.current = { id, startX: e.clientX, startY: e.clientY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }
  function onPointerMove(e) {
    if (!dragState.current || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const xPct = Math.min(95, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.min(95, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    updateElement(dragState.current.id, { x: xPct, y: yPct });
  }
  function onPointerUp() {
    dragState.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  async function persistDesign() {
    setSaving(true);
    try {
      const updated = await updateDesign(project._id, design);
      setProject(updated);
    } finally {
      setSaving(false);
    }
  }

  // The backend now renders in the background (see api.js's
  // pollUntilRenderDone) rather than holding one HTTP request open for the
  // whole encode — this turns a project's absolute on-disk output path
  // (e.g. "/app/outputs/reel-xyz.mp4") back into the "/outputs/<file>" URL
  // the frontend needs to actually load it.
  function outputsUrl(absPath) {
    if (!absPath) return null;
    const filename = absPath.split(/[\\/]/).pop();
    return assetUrl(`/outputs/${filename}`) + `?t=${Date.now()}`;
  }

  async function handlePreview() {
    await persistDesign();
    setRendering(true);
    setRenderProgress(0);
    try {
      await renderPreview(project._id, previewQuality); // starts the background job
      const finished = await pollUntilRenderDone(project._id, {
        onTick: (p) => setRenderProgress(p.jobProgress || 0),
      });
      setProject(finished);
      setPreviewUrl(outputsUrl(finished.previewOutputPath));
    } catch (err) {
      alert(err?.response?.data?.error || err.message || "Render failed");
    } finally {
      setRendering(false);
    }
  }

  // Both fields stay optional — save whatever's been filled in, leave the rest untouched.
  async function handleSaveExtras() {
    setSavingExtras(true);
    try {
      const fd = new FormData();
      fd.append("additionalText", additionalText);
      if (additionalImageFile) fd.append("additionalImage", additionalImageFile);
      const updated = await updateExtras(project._id, fd);
      setProject(updated);
      setAdditionalImageFile(null);
    } catch (err) {
      alert(err?.response?.data?.error || "Saving extras failed");
    } finally {
      setSavingExtras(false);
    }
  }

  async function handleRemoveAdditionalImage() {
    setSavingExtras(true);
    try {
      const fd = new FormData();
      fd.append("removeAdditionalImage", "true");
      const updated = await updateExtras(project._id, fd);
      setProject(updated);
    } finally {
      setSavingExtras(false);
    }
  }

  // Fast static JPEG snapshot of the generated template — lets you check the
  // frame/text/badge/footer/optional extras without waiting for a full MP4 render.
  // Now a background job like the two video renders (see
  // renderController.js's renderPreviewImageCtrl) — starts it and polls
  // rather than waiting on one long response.
  async function handlePreviewImage() {
    await persistDesign();
    setPreviewImageLoading(true);
    try {
      await renderPreviewImage(project._id); // starts the background job
      const finished = await pollUntilRenderDone(project._id);
      setProject(finished);
      setPreviewImageUrl(outputsUrl(finished.previewImagePath));
    } catch (err) {
      alert(err?.response?.data?.error || err.message || "Preview image generation failed");
    } finally {
      setPreviewImageLoading(false);
    }
  }

  async function handleFinalize() {
    await persistDesign();
    setFinalizing(true);
    setRenderProgress(0);
    try {
      await finalizeProject(project._id, finalQuality); // starts the background job
      const finished = await pollUntilRenderDone(project._id, {
        onTick: (p) => setRenderProgress(p.jobProgress || 0),
      });
      setProject(finished);
      setFinalUrl(outputsUrl(finished.finalOutputPath));
    } catch (err) {
      alert(err?.response?.data?.error || err.message || "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  }

  // Explicit, user-triggered cleanup — only runs when the button below is
  // pressed. The raw video/audio is never deleted automatically; the user
  // should download and confirm the export first.
  async function handleDeleteRawVideo() {
    const ok = window.confirm(
      "Delete the raw uploaded video/audio from the server? Make sure you've downloaded the final export first — this can't be undone."
    );
    if (!ok) return;
    setDeletingRaw(true);
    try {
      const res = await deleteRawVideo(project._id);
      setProject(res.video);
    } catch (err) {
      alert(err?.response?.data?.error || "Delete failed");
    } finally {
      setDeletingRaw(false);
    }
  }

  const frameStyleCss = {
    "gold-border": { border: "6px solid #D4AF37", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.4)" },
    "minimal-white": { border: "4px solid #fff" },
    glass: {},
    none: {},
  }[design.frameStyle];

  // Full video preview uses object-fit: contain so nothing is cropped — matches
  // the actual render, which fits the whole clip into the frame over a plain
  // black background rather than cutting off any portion of it.
  const rawVideoUrl = project.rawVideoPath ? assetUrl(`/uploads/${project.rawVideoPath.split(/[\\/]/).pop()}`) : null;
  // Optional small supplementary image, bottom-left — only present if uploaded.
  const additionalImageUrl = project.additionalImagePath
    ? assetUrl(`/uploads/${project.additionalImagePath.split(/[\\/]/).pop()}`)
    : null;

  return (
    <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ---- live editable preview, 9:16 Reels frame ---- */}
      <div>
        <button onClick={onBack} style={backBtn}>← Back to upload</button>
        <div
          ref={frameRef}
          style={{
            position: "relative",
            width: 320,
            height: (320 * 1920) / 1080,
            background: "#000",
            overflow: "hidden",
            borderRadius: 10,
            ...frameStyleCss,
          }}
        >
          {rawVideoUrl && (
            <video
              src={rawVideoUrl}
              muted
              loop
              autoPlay
              playsInline
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain", // shows the FULL video, no cropping — matches the export
                filter: "brightness(0.97)",
              }}
            />
          )}

          <div style={{ position: "absolute", inset: 0, background: design.backgroundOverlay, pointerEvents: "none" }} />

          {design.frameStyle === "glass" && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "22%", background: "rgba(255,255,255,0.08)", backdropFilter: "blur(4px)", pointerEvents: "none" }} />
          )}

          {/* Sanskrit tagline — fixed, not editable here. Mirrors
              backend/utils/renderOverlay.js's tagline: pinned to the
              top-left corner, and slides in/out in the actual video export
              (this preview just shows it held in place). Plain text, no
              background panel, normal weight, black. */}
          <div style={{ position: "absolute", top: 9, left: 14, right: 0, pointerEvents: "none" }}>
            <div
              style={{
                maxWidth: "78%",
                padding: "3px 6px",
                color: "#000000",
                fontWeight: 400,
                fontSize: 7,
                textAlign: "left",
                whiteSpace: "nowrap",
              }}
            >
              उद्यमेन हि सिध्यन्ति कार्याणि न मनोरथैः।
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 16,
              top: 51,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px 6px 10px",
              borderRadius: 20,
              background: `linear-gradient(135deg, ${design.accentColor}, #b8912a)`,
              boxShadow: "0 3px 8px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
              color: "#111",
              fontWeight: 700,
              fontSize: 11,
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 15,
                height: 15,
                borderRadius: "50%",
                background: "rgba(17,17,17,0.18)",
              }}
            >
              <i className="fa-solid fa-map-location-dot" style={{ fontSize: 8.5, color: "#111" }} />
            </span>
            {project.landType}
          </div>
          {design.elements.map((el) => {
            const isLocation = el.field === "location" || el.field === "locationDescriptive";
            const isArea = el.field === "area";
            const isPrice = el.field === "price";
            const hasIcon = isLocation || isArea || isPrice;
            const text = values[el.field] ?? el.text;
            if (!text) return null;

            const iconClass = isLocation
              ? "fa-solid fa-location-dot"
              : isArea
              ? "fa-solid fa-ruler-combined"
              : "fa-solid fa-indian-rupee-sign";
            const chipColor = el.pinColor || el.color || "#D4AF37";
            const textColor = el.color || "#FFFFFF";
            // Bold fields (title/price, etc.) get the same premium gold-sheen
            // treatment as the actual video export (see drawText() in
            // backend/utils/renderOverlay.js) — a white-to-gold gradient
            // clipped to the text, plus a crisp outline stroke — instead of a
            // flat fill, so this editor preview matches what gets burned in.
            const gradientTextStyle = el.bold
              ? {
                  backgroundImage: `linear-gradient(180deg, #FFFFFF 0%, ${textColor} 45%, ${el.pinColor || "#D4AF37"} 100%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitTextStroke: "0.4px rgba(212,175,55,0.55)",
                }
              : { color: textColor, WebkitTextStroke: "0.3px rgba(0,0,0,0.4)" };

            return (
              <div
                key={el.id}
                onPointerDown={(e) => onPointerDown(e, el.id)}
                style={{
                  position: "absolute",
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  display: hasIcon ? "flex" : "block",
                  alignItems: hasIcon ? "center" : undefined,
                  gap: hasIcon ? el.fontSize / 11 : undefined,
                  ...gradientTextStyle,
                  fontWeight: el.bold ? 700 : 400,
                  fontSize: el.fontSize / 5, // scale 1080-canvas font size down to 320px preview
                  letterSpacing: el.bold ? "0.4px" : "normal",
                  cursor: "grab",
                  textShadow: "0 2px 8px rgba(0,0,0,0.75), 0 0 14px rgba(0,0,0,0.35)",
                  outline: selectedId === el.id ? "1px dashed #fff" : "none",
                  maxWidth: "80%",
                  userSelect: "none",
                }}
              >
                {/* Proper, attractive icon per field type (Font Awesome, via
                    CSS in index.html) — a small drop-shadowed glyph in a
                    subtle gradient circle chip, in the field's own color
                    (el.pinColor, falling back to el.color). Location mirrors
                    the pin glyph the backend draws next to every "location"
                    field; area/price are new, preview-only touches. */}
                {hasIcon && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      width: el.fontSize / 5.6,
                      height: el.fontSize / 5.6,
                      borderRadius: "50%",
                      background: `radial-gradient(circle at 35% 30%, ${chipColor}, ${chipColor}cc 70%, ${chipColor}88)`,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.55)",
                    }}
                  >
                    <i className={iconClass} style={{ color: "#111", fontSize: el.fontSize / 10 }} />
                  </span>
                )}
                <span>{text}</span>
              </div>
            );
          })}

          {/* Optional small supplementary image, bottom-left, above the footer
              (and above the additional-text strip, when that's present too).
              Purely optional — only rendered when one has actually been uploaded. */}
          {additionalImageUrl && (
            <div
              style={{
                position: "absolute",
                left: 9,
                bottom: FOOTER_PREVIEW_H + FOOTER_BOTTOM_MARGIN_PREVIEW + (project.additionalText ? ADDITIONAL_TEXT_PREVIEW_H : 0) + 6,
                width: 65,
                height: 65,
                borderRadius: 5,
                overflow: "hidden",
                border: "1px solid #D4AF37",
                boxShadow: "0 0 0 4px rgba(0,0,0,0.55)",
              }}
            >
              <img src={additionalImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          )}

          {/* Optional "additional text" strip — full width, directly above the
              footer, ALWAYS horizontally centered (not draggable, fixed
              position) so it's a reliable "add text here later" spot. Only
              takes up space when the listing has additionalText set;
              mirrors drawAdditionalTextStrip() in
              backend/utils/renderOverlay.js. */}
          {project.additionalText && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: FOOTER_PREVIEW_H + FOOTER_BOTTOM_MARGIN_PREVIEW,
                height: ADDITIONAL_TEXT_PREVIEW_H,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "0 10px",
                background: "rgba(3,3,3,0.78)",
                borderTop: "1px solid rgba(212,175,55,0.55)",
              }}
            >
              <span style={{ color: "#fff", fontSize: 6, fontWeight: 500, lineHeight: 1.25 }}>{project.additionalText}</span>
            </div>
          )}

          {/* Fixed footer — identical on every video, not editable here.
              Mirrors backend/utils/renderOverlay.js drawFooter() so the
              preview matches what actually gets burned into the export.
              Row 1 (full width): logo + name on the left, email on the right.
              Row 2 (full width): call number pinned to the left corner,
              WhatsApp number pinned to the right corner. */}
          {brand && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: FOOTER_BOTTOM_MARGIN_PREVIEW, height: FOOTER_PREVIEW_H }}>
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-around",
                  padding: "5px 8px",
                  background: "rgba(8,8,8,0.92)",
                  borderTop: "1px solid rgba(212,175,55,0.7)",
                }}
              >
                {/* row 1: logo + name (left), email (right) */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <img
                      src={assetUrl(brand.logoRelativePath)}
                      alt=""
                      style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid #D4AF37", objectFit: "cover", flexShrink: 0 }}
                    />
                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {brand.companyName}
                    </span>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#e8e8e8", fontWeight: 600, fontSize: 6.5, whiteSpace: "nowrap" }}>
                    <IconBadge type="mail" size={9} />
                    {brand.email}
                  </span>
                </div>

                {/* row 2: call (left corner), whatsapp (right corner) — larger,
                    more legible mobile-number text than before */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <IconBadge type="call" size={11} />
                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 8.5 }}>{brand.enquiry.call}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <IconBadge type="whatsapp" size={11} />
                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 8.5 }}>{brand.enquiry.whatsapp}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- controls ---- */}
      <div style={{ flex: 1, minWidth: 300 }}>
        <h2 style={{ marginTop: 0 }}>2. Design the frame</h2>

        <label style={label}>Frame style</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {FRAME_STYLES.map((f) => (
            <button
              key={f.id}
              onClick={() => setDesign((d) => ({ ...d, frameStyle: f.id }))}
              style={{
                ...pillBtn,
                background: design.frameStyle === f.id ? "#D4AF37" : "#181b22",
                color: design.frameStyle === f.id ? "#111" : "#f1f1f1",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label style={label}>Accent color</label>
        <input type="color" value={design.accentColor} onChange={(e) => setDesign((d) => ({ ...d, accentColor: e.target.value }))} style={{ marginBottom: 16 }} />

        {selected && (
          <div style={{ border: "1px solid #2b2f3a", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <p style={{ margin: "0 0 8px", fontWeight: 700 }}>Editing: {selected.field}</p>
            <label style={label}>Font size</label>
            <input
              type="range"
              min="24"
              max="90"
              value={selected.fontSize}
              onChange={(e) => updateElement(selected.id, { fontSize: Number(e.target.value) })}
            />
            <label style={label}>Color</label>
            <input type="color" value={selected.color} onChange={(e) => updateElement(selected.id, { color: e.target.value })} />
            <label style={{ ...label, marginTop: 10 }}>
              <input type="checkbox" checked={selected.bold} onChange={(e) => updateElement(selected.id, { bold: e.target.checked })} /> Bold
            </label>
          </div>
        )}

        <button onClick={persistDesign} disabled={saving} style={{ ...secondaryBtn, marginBottom: 20 }}>
          {saving ? "Saving…" : "Save design"}
        </button>

        {/* ---- optional extras: additional text + additional image, both fully optional ---- */}
        <div style={{ border: "1px solid #2b2f3a", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700 }}>Optional extras</p>

          <label style={label}>Additional text (shown in a strip just above the footer, if filled in)</label>
          <input
            style={{ ...inputStyle }}
            value={additionalText}
            onChange={(e) => setAdditionalText(e.target.value)}
            placeholder="Leave blank to skip"
          />

          <label style={label}>Additional image (small inset, bottom-left of frame)</label>
          <input
            style={{ ...inputStyle }}
            type="file"
            accept="image/*"
            onChange={(e) => setAdditionalImageFile(e.target.files[0])}
          />
          {project.additionalImagePath && (
            <button onClick={handleRemoveAdditionalImage} disabled={savingExtras} style={{ ...pillBtn, marginBottom: 10 }}>
              Remove current image
            </button>
          )}

          <button onClick={handleSaveExtras} disabled={savingExtras} style={secondaryBtn}>
            {savingExtras ? "Saving…" : "Save extras"}
          </button>
        </div>

        {/* ---- preview render ---- */}
        <div style={{ border: "1px solid #2b2f3a", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700 }}>Preview render</p>
          <QualityPicker value={previewQuality} onChange={setPreviewQuality} />
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={handlePreview} disabled={rendering} style={secondaryBtn}>
              {rendering ? "Rendering…" : "Render preview (MP4)"}
            </button>
            <button onClick={handlePreviewImage} disabled={previewImageLoading} style={secondaryBtn}>
              {previewImageLoading ? "Generating…" : "Preview as image (fast)"}
            </button>
          </div>
          {rendering && <RenderProgressBar percent={renderProgress} />}
          {previewImageUrl && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 12, color: "#9aa0aa", margin: "0 0 6px" }}>Static preview of the generated template:</p>
              <img src={previewImageUrl} style={{ width: 260, borderRadius: 8, display: "block" }} />
            </div>
          )}
          {previewUrl && (
            <div style={{ marginTop: 14 }}>
              <video src={previewUrl} controls style={{ width: 260, borderRadius: 8 }} />
            </div>
          )}
        </div>

        {/* ---- final export ---- */}
        <div style={{ border: "1px solid #7a2b2b", borderRadius: 10, padding: 14 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700 }}>Final export</p>
          <QualityPicker value={finalQuality} onChange={setFinalQuality} />
          <button onClick={handleFinalize} disabled={finalizing} style={{ ...secondaryBtn, marginTop: 10 }}>
            {finalizing ? "Finalizing…" : "Finalize & export"}
          </button>
          {finalizing && <RenderProgressBar percent={renderProgress} />}
          {finalUrl && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontWeight: 700, color: "#7CFC9A" }}>✅ Final export ready</p>
              <video src={finalUrl} controls style={{ width: 260, borderRadius: 8 }} />
              <div>
                <a href={finalUrl} download style={{ color: "#D4AF37" }}>
                  Download for Instagram Reels
                </a>
              </div>
            </div>
          )}

          {/* Raw video/audio is kept on the server until the user deletes it
              themselves — this button is the only thing that ever removes it. */}
          {project.rawVideoPath ? (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #2b2f3a" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#9aa0aa" }}>
                Raw uploaded video/audio is still on the server. Once you've downloaded the export
                and are done, you can delete it to free up space.
              </p>
              <button onClick={handleDeleteRawVideo} disabled={deletingRaw} style={dangerBtn}>
                {deletingRaw ? "Deleting…" : "Delete source video"}
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 16, fontSize: 13, color: "#9aa0aa" }}>
              Raw uploaded video/audio has been deleted from the server.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Small circular icon badge using proper webfont icons (Font Awesome, loaded
// via CSS in index.html) instead of hand-drawn SVG paths — mirrors the same
// three channels (call / WhatsApp / mail) burned into the actual export by
// drawIconBadge/drawPhoneGlyph/drawChatBubbleGlyph/drawMailGlyph in
// backend/utils/renderOverlay.js, so each still reads as a distinct channel.
// A subtle glossy radial-gradient + drop shadow gives each chip some depth
// instead of sitting flat.
function IconBadge({ type, size = 8 }) {
  const base = type === "whatsapp" ? "#25D366" : "#D4AF37";
  const baseDark = type === "whatsapp" ? "#1da851" : "#b8912a";
  const glyphColor = type === "whatsapp" ? "#fff" : "#111";
  const iconClass =
    type === "whatsapp" ? "fa-brands fa-whatsapp" : type === "mail" ? "fa-solid fa-envelope" : "fa-solid fa-phone-volume";
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 32% 28%, ${base}, ${base} 55%, ${baseDark})`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <i className={iconClass} style={{ fontSize: size * 0.55, color: glyphColor, lineHeight: 1 }} />
    </span>
  );
}

function QualityPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {QUALITY_OPTIONS.map((q) => (
        <button
          key={q.id}
          onClick={() => onChange(q.id)}
          title={q.hint}
          style={{
            ...pillBtn,
            background: value === q.id ? "#D4AF37" : "#181b22",
            color: value === q.id ? "#111" : "#f1f1f1",
          }}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

// Shared progress display for preview render / finalize — both feed it the
// same `jobProgress` field polled off the project doc (see handlePreview /
// handleFinalize's onTick above). Percent is 0 until ffmpeg reports its first
// progress event, which for a short clip can take a moment — the caption
// covers that gap instead of showing a misleadingly stuck "0%".
function RenderProgressBar({ percent }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 8, borderRadius: 4, background: "#181b22", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(percent, 3)}%`,
            background: "#D4AF37",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <p style={{ fontSize: 12, color: "#9aa0aa", marginTop: 6 }}>
        {percent > 0 ? `Rendering — ${percent}%` : "Rendering — starting…"} (runs in the background; feel free to leave this open)
      </p>
    </div>
  );
}

const label = { fontSize: 12, color: "#9aa0aa", display: "block", marginBottom: 6, marginTop: 10 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #2b2f3a",
  background: "#181b22",
  color: "#f1f1f1",
  marginBottom: 10,
};
const backBtn = { background: "none", border: "none", color: "#9aa0aa", cursor: "pointer", marginBottom: 10, padding: 0 };
const pillBtn = { border: "1px solid #2b2f3a", borderRadius: 20, padding: "6px 14px", cursor: "pointer", fontSize: 13 };
const secondaryBtn = { padding: "10px 16px", borderRadius: 8, border: "1px solid #2b2f3a", background: "#181b22", color: "#f1f1f1", cursor: "pointer" };
const dangerBtn = { ...secondaryBtn, border: "1px solid #7a2b2b", background: "#2a1414", color: "#ff9b9b" };