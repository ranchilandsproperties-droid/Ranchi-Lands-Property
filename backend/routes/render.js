import express from "express";
import { renderPreview, renderPreviewImageCtrl, finalizeAndCleanup, deleteRawFiles } from "../controllers/renderController.js";

const router = express.Router();

router.post("/:id/preview", renderPreview); // re-render draft MP4, source kept, still editable
router.post("/:id/preview-image", renderPreviewImageCtrl); // fast static JPEG preview of the templated design
router.post("/:id/finalize", finalizeAndCleanup); // final render — raw upload is kept, not auto-deleted
router.delete("/:id/raw", deleteRawFiles); // explicit, user-triggered deletion of the raw uploaded video/audio

export default router;