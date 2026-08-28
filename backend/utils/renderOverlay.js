import { createCanvas, loadImage, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { BRAND } from "../config/brand.js";

// Reels canvas size
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

// Fixed brand footer strip height — shared with drawAdditionalImage() below so
// the optional bottom-left inset always sits flush just above the footer.
const FOOTER_STRIP_H = 150;

// Optional strip directly above the footer, used only when a listing has an
// "additional text" note set — see drawAdditionalTextStrip() below.
const ADDITIONAL_TEXT_STRIP_H = 64;

const ASSETS_DIR = path.resolve("assets");
const LOGO_PATH = path.join(ASSETS_DIR, "brand-logo.jpg");

async function loadBrandLogo() {
  if (!fs.existsSync(LOGO_PATH)) return null;
  try {
    return await loadImage(LOGO_PATH);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Palette — a small, consistent set of premium gold/black tones reused across
// every decorative element (badge, backdrops, footer, ornaments) so the whole
// frame reads as one cohesive "brand kit" instead of ad-hoc colors per piece.
// ---------------------------------------------------------------------------
const PALETTE = {
  goldLight: "#F5E7B2",
  gold: "#D4AF37",
  goldDeep: "#9C7A1E",
  ink: "#0B0B0C",
  panelDark: "rgba(6,6,8,0.62)",
  panelDarker: "rgba(4,4,5,0.85)",
};

// ---------------------------------------------------------------------------
// Top-of-frame Sanskrit tagline ("उद्यमेन हि सिध्यन्ति कार्याणि न मनोरथैः।" —
// "Tasks are accomplished by effort, not by mere wishing").
// ---------------------------------------------------------------------------
const TAGLINE_TEXT = "उद्यमेन हि सिध्यन्ति कार्याणि न मनोरथैः।";
const DEVANAGARI_FONT_PATH = path.join(ASSETS_DIR, "fonts", "NotoSansDevanagari-Bold.ttf");
const DEVANAGARI_FONT_FAMILY = "Noto Sans Devanagari";
let devanagariFontRegistered = false;

function ensureDevanagariFont() {
  if (devanagariFontRegistered) return;
  devanagariFontRegistered = true;
  if (fs.existsSync(DEVANAGARI_FONT_PATH)) {
    try {
      registerFont(DEVANAGARI_FONT_PATH, { family: DEVANAGARI_FONT_FAMILY, weight: "bold" });
    } catch {
      // fall through to system font
    }
  }
}

const TAGLINE_FONT_SIZE = 26;
const TAGLINE_PAD_X = 20;
const TAGLINE_PAD_Y = 10;

function measureTagline(ctx) {
  ensureDevanagariFont();
  ctx.font = `normal ${TAGLINE_FONT_SIZE}px "${DEVANAGARI_FONT_FAMILY}", sans-serif`;
  const textWidth = ctx.measureText(TAGLINE_TEXT).width;
  const panelW = Math.min(Math.ceil(textWidth + TAGLINE_PAD_X * 2), CANVAS_W - 80);
  const panelH = Math.ceil(TAGLINE_FONT_SIZE + TAGLINE_PAD_Y * 2);
  return { panelW, panelH };
}

// Now with a soft gold glow behind the glyphs (double-pass blur-ish shadow)
// instead of flat black text, so it reads as a lit engraving rather than
// plain print — still no background panel/border, per the original brief.
function paintTaglineBanner(ctx, x, y, panelW, panelH) {
  ctx.save();
  ctx.font = `normal ${TAGLINE_FONT_SIZE}px "${DEVANAGARI_FONT_FAMILY}", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = x + panelW / 2;
  const cy = y + panelH / 2 + 2;

  // soft ambient glow pass
  ctx.shadowColor = "rgba(212,175,55,0.65)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(TAGLINE_TEXT, cx, cy);

  // crisp top pass for legibility
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0B0B0C";
  ctx.fillText(TAGLINE_TEXT, cx, cy);
  ctx.restore();
}

// Nudged down from 34 -> 66 so it clears the frame's double border stroke
// and corner ornament instead of sitting right on top of it.
export const TAGLINE_TARGET_Y = 66;
// Nudged right from 44 -> 60 so it starts just inside the corner ornament
// instead of overlapping it.
const TAGLINE_MIN_X = 60;

export function taglineX(panelW) {
  return TAGLINE_MIN_X;
}

function drawTaglineStatic(ctx) {
  const { panelW, panelH } = measureTagline(ctx);
  const x = taglineX(panelW);
  paintTaglineBanner(ctx, x, TAGLINE_TARGET_Y, panelW, panelH);
}

export async function buildTaglineOnlyPng(outPath) {
  const measureCanvas = createCanvas(10, 10);
  const { panelW, panelH } = measureTagline(measureCanvas.getContext("2d"));

  const canvas = createCanvas(panelW, panelH);
  const ctx = canvas.getContext("2d");
  paintTaglineBanner(ctx, 0, 0, panelW, panelH);

  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return { path: outPath, width: panelW, height: panelH };
}

/**
 * Turns a video's `design` JSON + its metadata into a transparent 1080x1920 PNG,
 * PLUS the fixed brand elements. FFmpeg later overlays this PNG on top of the
 * (letterboxed) video.
 */
export async function buildOverlayPng(videoDoc, outPath, { includeBadge = true, includeTagline = true } = {}) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");
  const { design, title, price, areaValue, areaUnit, location, landType, additionalText, additionalImagePath } = videoDoc;

  const logoImg = await loadBrandLogo();

  // 1. Subtle full-frame scrim so white text stays readable over any footage
  if (design.backgroundOverlay && design.backgroundOverlay !== "none") {
    ctx.fillStyle = design.backgroundOverlay;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // 1b. Cinematic vignette — soft darkening toward all four edges/corners so
  // the frame reads as graded footage rather than a flat filter, and text
  // near the top/bottom automatically gets a touch more contrast to sit on.
  drawVignette(ctx);

  // 2. Decorative frame border + corner flourishes
  drawFrame(ctx, design.frameStyle, design.accentColor);
  if (design.frameStyle !== "none") {
    drawCornerOrnaments(ctx, design.accentColor || PALETTE.gold);
  }

  // 2b. Sanskrit tagline banner, top-left.
  if (includeTagline) {
    drawTaglineStatic(ctx);
  }

  // 3. Land-type badge (top-left)
  if (includeBadge) {
    drawBadge(ctx, landType, design.accentColor);
  }

  // 3b. Brand logo watermark on the main frame (top-right)
  drawWatermarkLogo(ctx, logoImg);

  // 4. User-placed text elements
  const fieldValue = {
    title,
    price: price ? `₹ ${price}` : "",
    area: `${areaValue} ${areaUnit}`,
    location,
    landType,
    additionalText: additionalText || "",
  };

  for (const el of design.elements || []) {
    const text = el.field && fieldValue[el.field] !== undefined ? fieldValue[el.field] : el.text || "";
    if (!text) continue;
    drawText(ctx, text, el);
  }

  // 4b. Optional supplementary strip, full-width, directly above the footer
  const additionalStripH = drawAdditionalTextStrip(ctx, additionalText);

  // 4c. Optional small supplementary image, bottom-left of the frame
  await drawAdditionalImage(ctx, additionalImagePath, additionalStripH);

  // 5. Fixed brand footer
  drawFooter(ctx, logoImg);

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

export async function buildBadgeOnlyPng(videoDoc, outPath) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");
  drawBadge(ctx, videoDoc.landType, videoDoc.design?.accentColor);
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

// ---------------------------------------------------------------------------
// Vignette — four soft radial-ish darkening passes in the corners plus a
// gentle top/bottom gradient, purely additive on top of whatever footage or
// scrim is already there. Cheap (a handful of gradient fills), but reads as
// a real color-grade rather than a flat rgba() overlay.
// ---------------------------------------------------------------------------
function drawVignette(ctx) {
  ctx.save();
  const grad = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, Math.min(CANVAS_W, CANVAS_H) * 0.35,
    CANVAS_W / 2, CANVAS_H / 2, Math.max(CANVAS_W, CANVAS_H) * 0.72
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // extra lift at the very bottom (behind footer / detail stack) so text
  // there always has a dark floor to sit on regardless of footage brightness
  const bottomGrad = ctx.createLinearGradient(0, CANVAS_H * 0.62, 0, CANVAS_H);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  bottomGrad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, CANVAS_H * 0.62, CANVAS_W, CANVAS_H * 0.38);
  ctx.restore();
}

// Small gold corner brackets just inside the frame margin — a classic
// "premium certificate" cue that reinforces the border without adding weight.
function drawCornerOrnaments(ctx, accent) {
  ctx.save();
  const inset = 52;
  const len = 46;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const corners = [
    [inset, inset, 1, 1],
    [CANVAS_W - inset, inset, -1, 1],
    [inset, CANVAS_H - inset, 1, -1],
    [CANVAS_W - inset, CANVAS_H - inset, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + len * dy);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len * dx, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWatermarkLogo(ctx, logoImg) {
  if (!logoImg) return;
  const r = 68;
  const margin = 28;
  const cx = CANVAS_W - margin - 20 - r;
  const cy = margin + 34 + r;

  ctx.save();
  // soft gold halo behind the mark
  ctx.shadowColor = "rgba(212,175,55,0.55)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.001)"; // near-invisible fill, only there to catch the shadow
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.94;
  drawLogoImage(ctx, logoImg, cx, cy, r);
  ctx.restore();
}

function drawFrame(ctx, style, accent) {
  ctx.save();
  const margin = 28;
  switch (style) {
    case "gold-border": {
      const outerGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
      outerGrad.addColorStop(0, PALETTE.goldLight);
      outerGrad.addColorStop(0.5, accent || PALETTE.gold);
      outerGrad.addColorStop(1, PALETTE.goldDeep);
      ctx.strokeStyle = outerGrad;
      ctx.lineWidth = 10;
      ctx.strokeRect(margin, margin, CANVAS_W - margin * 2, CANVAS_H - margin * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(margin + 16, margin + 16, CANVAS_W - (margin + 16) * 2, CANVAS_H - (margin + 16) * 2);
      break;
    }
    case "minimal-white":
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 6;
      ctx.strokeRect(margin, margin, CANVAS_W - margin * 2, CANVAS_H - margin * 2);
      break;
    case "glass": {
      const glassGrad = ctx.createLinearGradient(0, CANVAS_H - 420, 0, CANVAS_H);
      glassGrad.addColorStop(0, "rgba(255,255,255,0)");
      glassGrad.addColorStop(1, "rgba(255,255,255,0.12)");
      ctx.fillStyle = glassGrad;
      ctx.fillRect(0, CANVAS_H - 420, CANVAS_W, 420);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, CANVAS_H - 420, CANVAS_W - 1, 419);
      break;
    }
    case "none":
    default:
      break;
  }
  ctx.restore();
}

function drawBadge(ctx, landType, accent) {
  if (!landType) return;
  ctx.save();
  const label = landType.toUpperCase();
  const accentColor = accent || PALETTE.gold;
  const badgeH = 64;
  const iconR = 15;
  const iconPad = 10;
  const paddingLeft = 16 + iconR * 2 + iconPad;
  const paddingRight = 30;
  ctx.font = "bold 36px sans-serif";
  const textWidth = ctx.measureText(label).width;
  const badgeW = textWidth + paddingLeft + paddingRight;
  const x = 60;
  const y = 172;
  const cy = y + badgeH / 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundRectPath(ctx, x, y, badgeW, badgeH, 32);
  const badgeGrad = ctx.createLinearGradient(x, y, x, y + badgeH);
  badgeGrad.addColorStop(0, PALETTE.goldLight);
  badgeGrad.addColorStop(0.35, accentColor);
  badgeGrad.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.restore();

  // glossy highlight on the top half — a soft white sheen for a lacquered feel
  ctx.save();
  roundRectPath(ctx, x, y, badgeW, badgeH, 32);
  ctx.clip();
  const sheen = ctx.createLinearGradient(x, y, x, y + badgeH * 0.55);
  sheen.addColorStop(0, "rgba(255,255,255,0.55)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, badgeW, badgeH * 0.55);
  ctx.restore();

  // hairline border for definition against bright footage
  ctx.save();
  roundRectPath(ctx, x, y, badgeW, badgeH, 32);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const iconCx = x + 16 + iconR;
  ctx.beginPath();
  ctx.arc(iconCx, cy, iconR, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(17,17,17,0.88)";
  ctx.fill();
  drawPinGlyph(ctx, iconCx, cy, iconR * 0.58, accentColor);

  ctx.fillStyle = "#111111";
  ctx.textBaseline = "middle";
  drawLetterSpacedText(ctx, label, x + paddingLeft, cy + 2, 1.1);
  ctx.restore();
}

const ADDITIONAL_IMAGE_SIZE = 220;
async function drawAdditionalImage(ctx, additionalImagePath, additionalStripH = 0) {
  if (!additionalImagePath || !fs.existsSync(additionalImagePath)) return;

  let img;
  try {
    img = await loadImage(additionalImagePath);
  } catch {
    return;
  }

  const size = ADDITIONAL_IMAGE_SIZE;
  const margin = 32;
  const x = margin;
  const y = CANVAS_H - FOOTER_STRIP_H - additionalStripH - margin - size;
  const radius = 18;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  roundRectPath(ctx, x - 6, y - 6, size + 12, size + 12, radius + 4);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.clip();
  const scale = Math.max(size / img.width, size / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  ctx.drawImage(img, x + (size - drawW) / 2, y + (size - drawH) / 2, drawW, drawH);

  // subtle inner gradient at the bottom for a "framed photo" finish
  const innerGrad = ctx.createLinearGradient(0, y + size * 0.6, 0, y + size);
  innerGrad.addColorStop(0, "rgba(0,0,0,0)");
  innerGrad.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = innerGrad;
  ctx.fillRect(x, y + size * 0.6, size, size * 0.4);
  ctx.restore();

  ctx.save();
  const borderGrad = ctx.createLinearGradient(x, y, x + size, y + size);
  borderGrad.addColorStop(0, PALETTE.goldLight);
  borderGrad.addColorStop(1, PALETTE.goldDeep);
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2.5;
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.stroke();
  ctx.restore();
}

function drawPinGlyph(ctx, cx, cy, r, color) {
  ctx.save();
  const headCy = cy - r * 0.32;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 1.05);
  ctx.lineTo(cx - r * 0.58, headCy + r * 0.28);
  ctx.lineTo(cx + r * 0.58, headCy + r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headCy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headCy, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#111111";
  ctx.fill();
  ctx.restore();
}

// Manual letter-spacing helper — canvas has no native letter-spacing, so this
// walks the string and advances by each glyph's measured width plus a fixed
// gap. Used for badge/label text where a little air between letters reads
// more "designed" than the default cramped set.
function drawLetterSpacedText(ctx, text, x, y, spacing) {
  let curX = x;
  for (const ch of text) {
    ctx.fillText(ch, curX, y);
    curX += ctx.measureText(ch).width + spacing;
  }
}

// Rounded backdrop panel — now a subtle top-to-bottom gradient (not flat
// black) with a thin gold top edge, so every text field reads as a small
// glass/lacquer chip rather than a plain dark rectangle.
function drawTextBackdrop(ctx, x, y, blockWidth, blockHeight, align) {
  const padX = 22;
  const padY = 13;
  let panelX;
  if (align === "right") panelX = x - blockWidth - padX;
  else if (align === "center") panelX = x - blockWidth / 2 - padX;
  else panelX = x - padX;

  const panelY = y - padY;
  const panelW = blockWidth + padX * 2;
  const panelH = blockHeight + padY * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  roundRectPath(ctx, panelX, panelY, panelW, panelH, 16);
  const grad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
  grad.addColorStop(0, "rgba(20,18,10,0.62)");
  grad.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, panelX, panelY, panelW, panelH, 16);
  ctx.strokeStyle = "rgba(212,175,55,0.55)";
  ctx.lineWidth = 1.25;
  ctx.stroke();
  // thin brighter top edge highlight for a lit-glass feel
  ctx.beginPath();
  ctx.moveTo(panelX + 16, panelY + 1);
  ctx.lineTo(panelX + panelW - 16, panelY + 1);
  ctx.strokeStyle = "rgba(245,231,178,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, text, el) {
  ctx.save();
  const x = (el.x / 100) * CANVAS_W;
  const y = (el.y / 100) * CANVAS_H;
  const size = el.fontSize || 48;
  const weight = el.bold ? "bold" : "normal";
  const align = el.align || "left";
  ctx.font = `${weight} ${size}px ${el.fontFamily || "sans-serif"}`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";

  const isLocation = el.field === "location";
  const isTitle = el.field === "title";
  const pinR = isLocation ? size * 0.34 : 0;
  const pinGap = isLocation ? size * 0.42 : 0;
  const reserved = isLocation ? pinR * 2 + pinGap : 0;
  const pinColor = el.pinColor || el.color || PALETTE.gold;

  const lineHeight = size * 1.25;
  const lines = wrapLines(ctx, text, CANVAS_W - 120 - reserved);
  let blockWidth = 0;
  for (const line of lines) blockWidth = Math.max(blockWidth, ctx.measureText(line).width);
  blockWidth += reserved;
  const blockHeight = lines.length * lineHeight;

  if (el.background !== false) {
    drawTextBackdrop(ctx, x, y, blockWidth, blockHeight, align);
  }

  // Title gets a small vertical gold accent bar to its left — a lightweight
  // "premium listing" cue that also visually separates it from the fields
  // below it.
  if (isTitle && align === "left") {
    ctx.save();
    const barGrad = ctx.createLinearGradient(0, y, 0, y + blockHeight);
    barGrad.addColorStop(0, PALETTE.goldLight);
    barGrad.addColorStop(1, PALETTE.goldDeep);
    ctx.fillStyle = barGrad;
    roundRectPath(ctx, x - 20 - 6, y - 6, 5, blockHeight + 12, 3);
    ctx.fill();
    ctx.restore();
  }

  let textX = x;
  if (isLocation) {
    const pinCy = y + lineHeight / 2;
    if (align === "right") {
      const pinCx = x - blockWidth + pinR;
      drawPinGlyph(ctx, pinCx, pinCy, pinR, pinColor);
      textX = x - reserved;
    } else if (align === "center") {
      const pinCx = x - blockWidth / 2 + pinR;
      drawPinGlyph(ctx, pinCx, pinCy, pinR, pinColor);
      textX = x + reserved / 2;
    } else {
      const pinCx = x + pinR;
      drawPinGlyph(ctx, pinCx, pinCy, pinR, pinColor);
      textX = x + reserved;
    }
  }

  const baseColor = el.color || "#FFFFFF";
  const useGradient = el.bold;
  let textFill = baseColor;
  if (useGradient) {
    const gradTop = y;
    const gradBottom = y + blockHeight;
    const grad = ctx.createLinearGradient(0, gradTop, 0, gradBottom || gradTop + 1);
    grad.addColorStop(0, "#FFFFFF");
    grad.addColorStop(0.45, baseColor);
    grad.addColorStop(1, el.pinColor || PALETTE.gold);
    textFill = grad;
  }

  let curY = y;
  for (const line of lines) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = textFill;
    ctx.fillText(line, textX, curY);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.strokeStyle = useGradient ? "rgba(212,175,55,0.55)" : "rgba(0,0,0,0.55)";
    ctx.strokeText(line, textX, curY);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = textFill;
    ctx.fillText(line, textX, curY);
    ctx.restore();

    curY += lineHeight;
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line !== "") {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = test;
    }
  }
  lines.push(line.trim());
  return lines;
}

// Optional "additional text" strip, full width, sitting directly above the
// fixed footer strip — now with a gradient background, a gold hairline top
// edge, and a small info-dot glyph before the note so it reads as an
// intentional call-out rather than a stray line of text.
function drawAdditionalTextStrip(ctx, additionalText) {
  const text = (additionalText || "").trim();
  if (!text) return 0;

  const stripH = ADDITIONAL_TEXT_STRIP_H;
  const y0 = CANVAS_H - FOOTER_STRIP_H - stripH;

  ctx.save();
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + stripH);
  grad.addColorStop(0, "rgba(10,9,6,0.88)");
  grad.addColorStop(1, "rgba(3,3,3,0.8)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y0, CANVAS_W, stripH);
  ctx.strokeStyle = "rgba(212,175,55,0.6)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(CANVAS_W, y0);
  ctx.stroke();

  ctx.font = "600 26px sans-serif";
  const maxWidth = CANVAS_W - 100;
  const lines = wrapLines(ctx, text, maxWidth).slice(0, 2);
  const lineHeight = 30;
  const blockHeight = lines.length * lineHeight;
  let curY = y0 + (stripH - blockHeight) / 2 + lineHeight / 2;

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of lines) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.fillText(line, CANVAS_W / 2, curY);
    ctx.restore();
    curY += lineHeight;
  }
  ctx.restore();
  return stripH;
}

// Fixed brand footer — gradient background (not flat), a soft glowing top
// edge, and slightly glossier icon badges.
function drawFooter(ctx, logoImg) {
  const stripH = FOOTER_STRIP_H;
  const y0 = CANVAS_H - stripH;
  const padX = 26;

  ctx.save();
  const bgGrad = ctx.createLinearGradient(0, y0, 0, CANVAS_H);
  bgGrad.addColorStop(0, "rgba(14,12,7,0.95)");
  bgGrad.addColorStop(1, "rgba(2,2,2,0.97)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, y0, CANVAS_W, stripH);

  ctx.shadowColor = "rgba(212,175,55,0.6)";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "rgba(212,175,55,0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(CANVAS_W, y0);
  ctx.stroke();
  ctx.restore();

  const row1Y = y0 + stripH * 0.32;
  const row2Y = y0 + stripH * 0.74;

  const logoR = 26;
  const logoCx = padX + logoR;
  drawLogoImage(ctx, logoImg, logoCx, row1Y, logoR);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND.companyName, logoCx + logoR + 12, row1Y + 1);

  drawMailRow(ctx, CANVAS_W - padX, row1Y, BRAND.email);
  drawContactRowLeft(ctx, padX, row2Y, "call", BRAND.enquiry.call);
  drawContactRow(ctx, CANVAS_W - padX, row2Y, "whatsapp", BRAND.enquiry.whatsapp);
}

function drawLogoImage(ctx, logoImg, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  if (logoImg) {
    ctx.clip();
    ctx.drawImage(logoImg, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.restore();
    const initial = (BRAND.companyName || "?").trim().charAt(0).toUpperCase();
    ctx.fillStyle = "#111111";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, cx, cy + 1);
  }
  const ringGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ringGrad.addColorStop(0, PALETTE.goldLight);
  ringGrad.addColorStop(1, PALETTE.goldDeep);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Icon comes first (left), then the address — right-aligned to `rightX`,
// same layout rule as drawContactRow below. Font bumped up slightly
// (20px -> 22px) alongside the phone-number rows so all three contact
// lines read as one consistent, easily-legible size on a phone screen.
function drawMailRow(ctx, rightX, y, email) {
  const r = 15;
  const gap = 10;

  ctx.font = "600 22px sans-serif";
  const textWidth = ctx.measureText(email).width;
  const textStartX = rightX - textWidth;
  const iconCx = textStartX - gap - r;

  drawMailGlyph(ctx, iconCx, y, r);

  ctx.fillStyle = "#E8E8E8";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(email, rightX, y + 1);
}

// Phone numbers are the most important thing to read at a glance on a small
// phone screen, so these get the biggest bump: 27px -> 34px, bold, with a
// slightly larger icon chip (r: 15 -> 17) to stay in proportion.
function drawContactRow(ctx, rightX, y, type, number) {
  const r = 17;
  const gap = 10;

  ctx.font = "700 34px sans-serif";
  const numWidth = ctx.measureText(number).width;
  const numStartX = rightX - numWidth;
  const iconCx = numStartX - gap - r;

  drawIconBadge(ctx, iconCx, y, r, type);

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(number, rightX, y + 1);
}

// Mirror of drawContactRow: icon then number, left-aligned starting at
// `leftX` so the row's left edge stays consistent. Used for the footer's
// left-corner (call) number — same enlarged 34px size as the WhatsApp row.
function drawContactRowLeft(ctx, leftX, y, type, number) {
  const r = 17;
  const gap = 10;

  const iconCx = leftX + r;
  drawIconBadge(ctx, iconCx, y, r, type);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 34px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(number, iconCx + r + gap, y + 1);
}

// Icon badges now get a small glossy top highlight, same lacquered treatment
// as the land-type badge, so all "chip" style elements match.
function drawIconBadge(ctx, cx, cy, r, type) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = type === "whatsapp" ? "#25D366" : PALETTE.gold;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createLinearGradient(cx, cy - r, cx, cy);
  sheen.addColorStop(0, "rgba(255,255,255,0.5)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - r, cy - r, r * 2, r);
  ctx.restore();

  if (type === "call") {
    drawPhoneGlyph(ctx, cx, cy, r * 0.62, "#111111");
  } else {
    drawChatBubbleGlyph(ctx, cx, cy, r * 0.66);
  }
}

function drawPhoneGlyph(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = color;
  roundRectPath(ctx, -s * 0.26, -s * 0.85, s * 0.52, s * 1.7, s * 0.26);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 0.9, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, s * 0.9, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawChatBubbleGlyph(ctx, cx, cy, s) {
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  roundRectPath(ctx, cx - s, cy - s * 0.9, s * 2, s * 1.6, s * 0.75);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy + s * 0.55);
  ctx.lineTo(cx - s * 0.55, cy + s * 1.05);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawPhoneGlyph(ctx, cx, cy - s * 0.05, s * 0.5, "#25D366");
}

function drawMailGlyph(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.gold;
  ctx.fill();
  ctx.restore();

  ctx.save();
  const w = r * 1.3;
  const h = r * 0.95;
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, r * 0.2);
  ctx.fillStyle = "#111111";
  ctx.fill();

  ctx.strokeStyle = PALETTE.gold;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + r * 0.12, cy - h / 2 + r * 0.12);
  ctx.lineTo(cx, cy + h * 0.06);
  ctx.lineTo(cx + w / 2 - r * 0.12, cy - h / 2 + r * 0.12);
  ctx.stroke();
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
