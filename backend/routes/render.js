import express from "express";
import { renderPreview, renderPreviewImageCtrl, finalizeAndCleanup } from "../controllers/renderController.js";

const router = express.Router();

router.post("/:id/preview", renderPreview); // re-render draft MP4, source kept, still editable
router.post("/:id/preview-image", renderPreviewImageCtrl); // fast static JPEG preview of the templated design
router.post("/:id/finalize", finalizeAndCleanup); // final render + delete raw uploads

export default router;
