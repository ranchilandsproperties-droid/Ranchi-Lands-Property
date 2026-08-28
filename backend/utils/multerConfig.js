import multer from "multer";
import path from "path";
import { v4 as uuid } from "uuid";
import fs from "fs";

const UPLOAD_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uuid()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === "video" && !file.mimetype.startsWith("video/")) {
    return cb(new Error("Video field must be a video file"));
  }
  if (file.fieldname === "audio" && !file.mimetype.startsWith("audio/")) {
    return cb(new Error("Audio field must be an audio file"));
  }
  // Optional small supplementary image (bottom-left overlay) — only used when supplied.
  if (file.fieldname === "additionalImage" && !file.mimetype.startsWith("image/")) {
    return cb(new Error("Additional image field must be an image file"));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB cap, raw land walkthrough videos can be large
});

export { UPLOAD_DIR };
