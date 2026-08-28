import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";

import uploadRoutes from "./routes/upload.js";
import renderRoutes from "./routes/render.js";
import brandRoutes from "./routes/brand.js";

dotenv.config();

const app = express();

// CLIENT_ORIGIN = your deployed Vercel URL (e.g. https://land-reels.vercel.app).
// Comma-separate multiple origins if you have a preview + prod URL. Falls back
// to "*" for local dev so you don't need to set anything to run it locally.
const allowedOrigins = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim()) : "*";
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Serve finished reels + (for preview during editing) raw uploads statically
app.use("/outputs", express.static(path.resolve("outputs")));
app.use("/uploads", express.static(path.resolve("uploads")));
// Fixed brand assets (logo) — same file used in every render's footer
app.use("/assets", express.static(path.resolve("assets")));

app.use("/api/videos", uploadRoutes);
app.use("/api/videos", renderRoutes);
app.use("/api/brand", brandRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/land_reels")
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
