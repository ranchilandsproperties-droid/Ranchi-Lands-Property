// Fixed brand footer shown on EVERY rendered reel — this is intentionally not
// part of the per-video `design` JSON, so it can't drift between videos and
// isn't user-editable from the design screen. To change the numbers, company
// name, or social handles, edit this file (and redeploy the backend).
export const BRAND = {
  companyName: "ranchi_lands-and_properties",
  email: "ranchilandsandproperties@gmail.com",
  enquiry: {
    call: "+91 74882 70885",
    whatsapp: "+91 85400 23706",
  },
  // social row removed from the rendered footer per request — handles kept
  // here (unused by renderOverlay.js) only in case they're needed elsewhere.
  social: {
    instagram: "@ranchi_lands_and_properties",
    facebook: "Ranchi Lands & Properties",
  },
  logoRelativePath: "/assets/brand-logo.jpg", // served statically, see server.js — now the real Ranchi Properties circular logo
};
