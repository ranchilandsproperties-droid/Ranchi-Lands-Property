import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import uploadRoutes from "./routes/upload.js";
import renderRoutes from "./routes/render.js";
import brandRoutes from "./routes/brand.js";
import Video from "./models/Video.js";

dotenv.config();

const app = express();

// CLIENT_ORIGIN = your deployed Vercel URL (e.g. https://land-reels.vercel.app).
// Comma-separate multiple origins if you have a preview + prod URL. Falls back
// to "*" for local dev so you don't need to set anything to run it locally.
const allowedOrigins = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim()) : "*";
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Anchored to this file's own directory rather than process.cwd() so static
// serving always points at backend/{outputs,uploads,assets} regardless of
// where/how the process was launched from (see the same fix in
// utils/renderOverlay.js for why cwd-relative paths were unreliable here).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve finished reels + (for preview during editing) raw uploads statically
app.use("/outputs", express.static(path.join(__dirname, "outputs")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Fixed brand assets (logo) — same file used in every render's footer
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.use("/api/videos", uploadRoutes);
app.use("/api/videos", renderRoutes);
app.use("/api/brand", brandRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/land_reels")
  .then(async () => {
    // Background render jobs (see controllers/renderController.js) live only
    // in this process's memory while they run. If the server restarts mid-
    // render (a deploy, a crash, a free-tier sleep/wake cycle), any project
    // left with jobStatus "rendering" would otherwise be stuck that way
    // forever — renderPreview/finalizeAndCleanup both refuse to start a new
    // render while one is already "in progress". Clear those out on boot.
    const stuck = await Video.updateMany(
      { jobStatus: "rendering" },
      { jobStatus: "error", jobError: "Render was interrupted by a server restart — please try again." }
    );
    if (stuck.modifiedCount > 0) {
      console.warn(`Reset ${stuck.modifiedCount} stuck "rendering" job(s) left over from before this restart.`);
    }

    const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

    // Video rendering (node-canvas rasterization + ffmpeg encode) can easily
    // run past Node's default HTTP timeouts on a slow/free-tier instance —
    // requestTimeout defaults to 5 minutes and headersTimeout to 1 minute
    // (Node 18+). Once either fires, Node forcibly ends the request/socket
    // mid-render, which looks to the client exactly like "rendering always
    // disconnects" even though the ffmpeg process itself is still fine.
    // Rendering endpoints (preview/preview-image/finalize) are the only slow
    // ones here and aren't public-facing beyond this app's own frontend, so
    // it's safe to disable these timeouts server-wide rather than tune them
    // per-route.
    server.requestTimeout = 0; // disable Node's overall per-request timeout
    server.headersTimeout = 0; // disable the (shorter) headers-only timeout
    server.keepAliveTimeout = 0; // don't drop idle keep-alive sockets either
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });