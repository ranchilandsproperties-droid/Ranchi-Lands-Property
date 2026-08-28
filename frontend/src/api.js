import axios from "axios";

// In local dev this is empty, so requests hit "/api" and Vite's proxy (see
// vite.config.js) forwards to http://localhost:5000. In production (Vercel),
// set VITE_API_BASE_URL to your Render backend URL, e.g.
// https://land-reels-backend.onrender.com — Vercel doesn't proxy API calls,
// so the frontend needs the full backend origin.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({ baseURL: `${API_BASE}/api` });

export const createProject = (formData, onUploadProgress) =>
  api
    .post("/videos", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onUploadProgress
        ? (evt) => {
            if (evt.total) onUploadProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        : undefined,
    })
    .then((r) => r.data);

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

// renderPreview/finalizeProject above both just START a background render
// job and return right away (see backend/controllers/renderController.js —
// full video renders are too slow to hold one HTTP request open for on a
// slow/free-tier host). This polls GET /api/videos/:id until the project's
// jobStatus leaves "rendering", then resolves with the final project doc.
// Throws if the job ends in "error", with the backend's jobError as the message.
export function pollUntilRenderDone(id, { intervalMs = 2500, timeoutMs = 20 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const project = await getProject(id);
        if (project.jobStatus === "rendering") {
          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error("Render is taking much longer than expected — check back later."));
            return;
          }
          setTimeout(tick, intervalMs);
          return;
        }
        if (project.jobStatus === "error") {
          reject(new Error(project.jobError || "Render failed"));
          return;
        }
        resolve(project);
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}

// Explicit cleanup — deletes the raw uploaded video/audio from the server.
// Never called automatically; only from a user-pressed "Delete source video" button.
export const deleteRawVideo = (id) => api.delete(`/videos/${id}/raw`).then((r) => r.data);

// Fixed footer config (company name, enquiry numbers, social handles, logo) —
// same for every video, read-only from the frontend's point of view.
export const getBrand = () => api.get(`/brand`).then((r) => r.data);

// Helper to build a full URL to an asset the backend serves statically
// (/uploads/... or /outputs/...) — needed because in production these live on
// a different origin (Render) than the app itself (Vercel).
export const assetUrl = (relativePath) => `${API_BASE}${relativePath}`;

export default api;