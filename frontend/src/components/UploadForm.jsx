import React, { useState } from "react";
import { createProject } from "../api.js";

const LAND_TYPES = ["Residential Plot", "Commercial Land", "Agricultural Land", "Industrial Land", "Farmhouse Land", "Other"];
// Selectable area units — "Cent" and "Decimal" are the same measure (common in
// South-Indian land listings) but both are offered since either name is used.
const AREA_UNITS = [
  { id: "cent", label: "Cent" },
  { id: "decimal", label: "Decimal" },
  { id: "sqft", label: "Sq. ft" },
  { id: "sqm", label: "Sq. m" },
  { id: "sqyd", label: "Sq. yd" },
  { id: "acre", label: "Acre" },
  { id: "hectare", label: "Hectare" },
  { id: "bigha", label: "Bigha" },
  { id: "katha", label: "Katha" },
];

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2b2f3a",
  background: "#181b22",
  color: "#f1f1f1",
  marginBottom: 14,
};
const labelStyle = { fontSize: 13, color: "#9aa0aa", marginBottom: 6, display: "block" };

export default function UploadForm({ onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    landType: LAND_TYPES[0],
    areaValue: "",
    areaUnit: "cent",
    price: "",
    location: "",
    contactNumber: "",
    ownerOrAgentName: "",
    additionalText: "",
  });
  const [videoFile, setVideoFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [additionalImageFile, setAdditionalImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Named explicitly (video vs. audio) rather than a generic "uploading your
  // file" — the two are easy to mix up when only one of the two file inputs
  // was actually filled in, and the audio track especially is easy to forget
  // was attached at all.
  const uploadLabel = audioFile ? "Uploading video + audio" : "Uploading video";
  const totalUploadMb = ((videoFile?.size || 0) + (audioFile?.size || 0)) / (1024 * 1024);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!videoFile) return setError("Please attach the raw land video.");
    if (!form.title || !form.areaValue || !form.location) return setError("Title, area and location are required.");

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append("video", videoFile);
    if (audioFile) fd.append("audio", audioFile);
    if (additionalImageFile) fd.append("additionalImage", additionalImageFile);

    try {
      setLoading(true);
      setUploadPercent(0);
      const doc = await createProject(fd, (evt) => {
        if (!evt.total) return;
        setUploadPercent(Math.round((evt.loaded / evt.total) * 100));
      });
      onCreated(doc);
    } catch (err) {
      setError(err?.response?.data?.error || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>1. Upload & land details</h2>

      <label style={labelStyle}>Listing title</label>
      <input style={inputStyle} value={form.title} onChange={set("title")} placeholder="2 Acre Riverside Plot, Kochi" />

      <label style={labelStyle}>Description (optional)</label>
      <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.description} onChange={set("description")} />

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Type of land</label>
          <select style={inputStyle} value={form.landType} onChange={set("landType")}>
            {LAND_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Area</label>
          <input style={inputStyle} type="number" value={form.areaValue} onChange={set("areaValue")} placeholder="e.g. 4500" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Unit</label>
          <select style={inputStyle} value={form.areaUnit} onChange={set("areaUnit")}>
            {AREA_UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label style={labelStyle}>Price (optional, shown as-is e.g. "₹45 Lakh")</label>
      <input style={inputStyle} value={form.price} onChange={set("price")} />

      <label style={labelStyle}>Location</label>
      <input style={inputStyle} value={form.location} onChange={set("location")} placeholder="Vazhakkala, Kochi" />

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Contact number (optional)</label>
          <input style={inputStyle} value={form.contactNumber} onChange={set("contactNumber")} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Owner / agent name (optional)</label>
          <input style={inputStyle} value={form.ownerOrAgentName} onChange={set("ownerOrAgentName")} />
        </div>
      </div>

      <label style={labelStyle}>Additional text (optional — extra line shown bottom-right of the frame)</label>
      <input
        style={inputStyle}
        value={form.additionalText}
        onChange={set("additionalText")}
        placeholder="e.g. Clear title, road access — used only if filled in"
      />

      <label style={labelStyle}>Raw video (required)</label>
      <input style={inputStyle} type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files[0])} />

      <label style={labelStyle}>Background audio / voiceover (optional — replaces original clip audio)</label>
      <input style={inputStyle} type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files[0])} />

      <label style={labelStyle}>Additional image (optional — small inset shown bottom-left of the frame, e.g. a floor plan)</label>
      <input style={inputStyle} type="file" accept="image/*" onChange={(e) => setAdditionalImageFile(e.target.files[0])} />

      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

      <button
        type="submit"
        disabled={loading}
        style={{ padding: "12px 20px", borderRadius: 8, border: "none", background: "#D4AF37", color: "#111", fontWeight: 700, cursor: "pointer" }}
      >
        {loading ? `${uploadLabel}… ${uploadPercent}%` : "Upload & start designing →"}
      </button>

      {loading && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 8, borderRadius: 4, background: "#181b22", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${uploadPercent}%`,
                background: "#D4AF37",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: "#9aa0aa", marginTop: 6 }}>
            {uploadLabel} ({totalUploadMb.toFixed(1)} MB) — {uploadPercent}%
          </p>
        </div>
      )}
    </form>
  );
}