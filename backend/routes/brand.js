import express from "express";
import { BRAND } from "../config/brand.js";

const router = express.Router();

// Single source of truth for the footer, so the design-editor preview shows
// exactly what every rendered video will have — this is read-only from the
// API (not editable per-video); change backend/config/brand.js to update it.
router.get("/", (req, res) => {
  res.json(BRAND);
});

export default router;
