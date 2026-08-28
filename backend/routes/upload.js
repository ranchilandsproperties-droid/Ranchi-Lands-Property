import express from "express";
import { upload } from "../utils/multerConfig.js";
import {
  createVideoProject,
  getVideoProject,
  listVideoProjects,
  updateDesign,
  updateExtras,
} from "../controllers/uploadController.js";

const router = express.Router();

router.post(
  "/",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "additionalImage", maxCount: 1 }, // optional small overlay image, used only when supplied
  ]),
  createVideoProject
);

router.get("/", listVideoProjects);
router.get("/:id", getVideoProject);
router.patch("/:id/design", updateDesign);

// Optional extras (additional text / additional image), editable independently
// of the design JSON and at any point up until finalize.
router.patch("/:id/extras", upload.fields([{ name: "additionalImage", maxCount: 1 }]), updateExtras);

export default router;
