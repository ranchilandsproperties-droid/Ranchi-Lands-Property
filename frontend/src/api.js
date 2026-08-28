import axios from "axios";

// In local dev this is empty, so requests hit "/api" and Vite's proxy (see
// vite.config.js) forwards to http://localhost:5000. In production (Vercel),
// set VITE_API_BASE_URL to your Render backend URL, e.g.
// https://land-reels-backend.onrender.com — Vercel doesn't proxy API calls,
// so the frontend needs the full backend origin.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({ baseURL: `${API_BASE}/api` });

export const createProject = (formData) =>
  api.post("/videos", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);

export const getProject = (id) => api.get(`/videos/${id}`).then((r) => r.data);

export const updateDesign = (id, design) => api.patch(`/videos/${id}/design`, { design }).then((r) => r.data);

// Optional extras — additionalText and/or a replacement additionalImage. Pass a
// FormData when updating the image (multipart), otherwise a plain JSON body works.
export const updateExtras = (id, formData) =>
  api.patch(`/videos/${id}/extras`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);

export const renderPreview = (id, quality) => api.post(`/videos/${id}/preview`, { quality }).then((r) => r.data);

// Fast static-image preview of the generated template (JPEG), no full video encode.
export const renderPreviewImage = (id) => api.post(`/videos/${id}/preview-image`).then((r) => r.data);

export const finalizeProject = (id, quality) => api.post(`/videos/${id}/finalize`, { quality }).then((r) => r.data);

// Fixed footer config (company name, enquiry numbers, social handles, logo) —
// same for every video, read-only from the frontend's point of view.
export const getBrand = () => api.get(`/brand`).then((r) => r.data);

// Helper to build a full URL to an asset the backend serves statically
// (/uploads/... or /outputs/...) — needed because in production these live on
// a different origin (Render) than the app itself (Vercel).
export const assetUrl = (relativePath) => `${API_BASE}${relativePath}`;

export default api;
