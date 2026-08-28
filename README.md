# Land Reels Studio (MERN)

Upload a raw land video (+ optional audio), fill in land details, design a branded
Instagram-Reels (1080×1920, 9:16) promo frame over it with editable text/badges,
render it with FFmpeg at your choice of quality, and — once you finalize — the
raw uploaded video/audio is deleted from the server, leaving only the design
JSON + finished MP4.

## How it works

**1. Upload (`POST /api/videos`)**
Multipart form: `video` (required), `audio` (optional voiceover/music),
`additionalImage` (optional small inset image), plus land fields — `title`,
`landType` (Residential Plot / Commercial Land / Agricultural Land /
Industrial Land / Farmhouse Land / Other), `areaValue` + `areaUnit` (selectable:
Cent, Decimal, Sq. ft, Sq. m, Sq. yd, Acre, Hectare, Bigha, Katha), `price`,
`location`, `contactNumber`, `ownerOrAgentName`, `additionalText` (optional
extra line). A `Video` document is created in MongoDB with a default design
(gold border frame + title/location/area/price/optional-text placeholders),
status `designing`.

**Optional extras (`PATCH /api/videos/:id/extras`)**
`additionalText` (a free-form line shown bottom-right of the frame, above the
footer) and `additionalImage` (a small inset image shown bottom-left of the
frame, e.g. a floor plan) can be set at upload time or edited/added/removed
later from the design screen — both are entirely optional and are only drawn
onto the frame when actually supplied.

**2. Design editor (frontend)**
A 9:16 live preview shows the **full raw video, uncropped** (`object-fit:
contain`) with draggable text overlays (percentage-positioned so they map 1:1
to the 1080×1920 backend canvas). You can pick a frame style (gold border /
minimal white / glass panel / none), an accent color, and per-element font
size/color/weight. `PATCH /api/videos/:id/design` persists the JSON — it stays
editable indefinitely as long as the raw video hasn't been finalized.

**3. Render pipeline — no cropping** (`utils/renderOverlay.js` + `utils/ffmpegRender.js`)
- `node-canvas` rasterizes the `design` JSON into a transparent 1080×1920 PNG
  (frame border, wrapped/styled text, footer). The land-type badge is
  rasterized separately (`buildBadgeOnlyPng`) — see the timed reveal below.
- `fluent-ffmpeg` fits the **entire** original video inside the 1080×1920
  canvas without cutting off any portion of it (`scale=...:force_original_
  aspect_ratio=decrease`). Any empty space (top/bottom or sides, depending on
  the source aspect ratio) is filled with **plain black**, then the design PNG
  is composited on top.
- **Timed land-type badge reveal**: the badge (e.g. "RESIDENTIAL PLOT") stays
  hidden for the first 20% of the clip's duration, then fades in and stays
  visible for the rest. `renderReel()` probes the clip's duration with
  `ffprobe`, computes `duration * 0.2`, and composites the badge-only PNG on
  top with an ffmpeg `overlay=...:enable='gte(t,<seconds>)'` time gate. The
  ratio is set once, in `controllers/renderController.js` →
  `BADGE_REVEAL_RATIO`. The "Preview as image" static snapshot always shows
  the badge (it's a one-shot design reference, not a real playback), and the
  design-editor's live preview shows it too, labeled "appears at 20% mark".
- If audio was uploaded it replaces the clip's original audio track; otherwise
  the original audio is kept.

**4. Export quality**
Both the preview render and the final export let you pick a quality tier
(`backend/utils/ffmpegRender.js` → `QUALITY_PRESETS`):
| Tier | CRF | Preset | Max bitrate | Use for |
|---|---|---|---|---|
| `standard` | 26 | veryfast | 2.5 Mbps | quick drafts |
| `high` (default for final export) | 20 | medium | 6 Mbps | posting to Instagram |
| `ultra` | 15 | slow | 12 Mbps | max detail, larger file/slower render |

Resolution is fixed at 1080×1920 (Reels' native size) for all tiers — quality
only changes compression, not how much of the frame is shown.

- `POST /api/videos/:id/preview-image` grabs a single frame, composites it
  with the current design, and returns a static JPEG — an instant "what will
  this look like" snapshot of the generated template, without waiting for a
  full video encode.
- `POST /api/videos/:id/preview { quality }` renders a draft MP4 — raw files
  are **kept** so you can keep editing and re-render.
- `POST /api/videos/:id/finalize { quality }` renders once more from the
  latest design at the chosen quality, then **deletes** `rawVideoPath` /
  `rawAudioPath` from disk and clears those fields in Mongo. Only the finished
  reel (`outputs/reel-*.mp4`) and the design record remain.

## Deploying — Render (backend) + Vercel (frontend), free tiers

### Database
Render's free tier has no managed MongoDB, so use **MongoDB Atlas' free (M0)
cluster** and grab its connection string for `MONGO_URI`.

### Backend → Render
Render's plain Node runtime doesn't include FFmpeg or the Cairo/Pango libs
`node-canvas` needs, so this ships a **Dockerfile** (Render's free tier
supports Docker web services) that installs both.

1. Push this repo to GitHub.
2. On Render: New → Web Service → connect the repo → set **Root Directory** to
   `backend` → Render will detect `Dockerfile` (or use `render.yaml` as a
   Blueprint — included in `backend/render.yaml`).
3. Set env vars in the Render dashboard:
   - `MONGO_URI` — your Atlas connection string
   - `CLIENT_ORIGIN` — your Vercel URL, e.g. `https://land-reels.vercel.app`
   - `PORT` — `10000` (matches the Dockerfile's `EXPOSE`)
4. Deploy. Note: the free tier's disk is **ephemeral** — files in
   `uploads/`/`outputs/` don't survive a redeploy or a spin-down/spin-up
   cycle, and the service sleeps after inactivity (first request after
   sleeping will be slow). That's fine for this app's flow since `finalize()`
   already deletes the raw upload once you're done, but download your
   finalized reels rather than relying on the server to keep them around.

### Frontend → Vercel
1. On Vercel: New Project → same repo → set **Root Directory** to `frontend`.
   Framework preset: Vite.
2. Set env var `VITE_API_BASE_URL` to your Render backend URL, e.g.
   `https://land-reels-backend.onrender.com` (no trailing slash).
3. Deploy. The app calls `${VITE_API_BASE_URL}/api/...` and also loads
   uploaded/rendered media from `${VITE_API_BASE_URL}/uploads/...` and
   `/outputs/...` (see `frontend/src/api.js` → `assetUrl`), since Vercel
   doesn't proxy to an external backend the way the local Vite dev server
   does.

## Local development

### Prerequisites
- Node.js 18+
- MongoDB running locally (or an Atlas URI)
- **FFmpeg installed and on PATH** (`ffmpeg -version` should work). If it's
  installed elsewhere, set `FFMPEG_PATH` / `FFPROBE_PATH` in `backend/.env`.
- `node-canvas` needs system libs (Cairo/Pango). On Ubuntu/Debian:
  `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`

### Backend
```bash
cd backend
cp .env.example .env      # edit MONGO_URI / ffmpeg paths if needed
npm install
npm run dev                # http://localhost:5000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :5000 locally)
```

Open http://localhost:5173, fill the upload form, then design and render.

## Notes / next steps you may want to add
- Auth (right now any client can hit the API) — add JWT/session middleware
  before deploying publicly.
- A job queue (BullMQ) if renders should run in the background instead of
  blocking the request for large videos — worth it once you're past Render's
  free-tier request timeout for very long clips.
- More design element types (logo image upload, QR code to the listing).
