// api/drive.js
// Uploads registrant files (college ID proofs, payment screenshots) to
// Google Drive and returns a shareable link that gets logged alongside
// their row in the sheet.
//
// IMPORTANT: this does NOT call the Google Drive API directly with the
// service account anymore. Service accounts have zero storage quota of
// their own — on a Workspace account you'd route around that with a
// Shared Drive, but on a personal Gmail account Shared Drives aren't
// available at all. So instead this posts the file to a small Google Apps
// Script web app that runs "as" the real personal Gmail account (which DOES
// have quota) and creates the file on its behalf. See /apps-script/Code.gs
// (or wherever you saved it) for that script's source.
//
// Requires:
//   APPS_SCRIPT_URL     — the deployed web app URL (ends in /exec)
//   APPS_SCRIPT_SECRET  — shared secret, must match the SECRET constant
//                         inside the Apps Script itself
//   GOOGLE_DRIVE_ID_FOLDER_ID       — folder for college ID proof uploads
//   GOOGLE_DRIVE_PAYMENT_FOLDER_ID  — folder for payment screenshot uploads
// Both folders must be shared with the Apps Script's owning Gmail account
// (they already are, since that account owns them) — no extra sharing step
// needed beyond what you did for the old service-account setup.
//
// Backwards compatibility: if the new folder-specific env vars aren't set,
// this falls back to the old single GOOGLE_DRIVE_FOLDER_ID for both types,
// so nothing breaks if you haven't updated Vercel env vars yet.

// dataUrl looks like "data:image/jpeg;base64,/9j/4AAQ..." — split off the header.
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Invalid file data received.");
  return { mimeType: match[1] };
}

// Shared upload helper — takes a base64 data URL plus a human-readable name
// prefix and a target folderId, posts it to the Apps Script proxy, and
// returns a viewable link (or null if no folder id / script URL could be
// resolved, so callers can still let the rest of the flow — registration,
// payment proof — go through without blocking on Drive storage).
async function uploadFile({ base64, fileName, namePrefix, folderId }) {
  if (!folderId) {
    console.warn("No Drive folder id configured — skipping file upload.");
    return null;
  }

  if (!process.env.APPS_SCRIPT_URL || !process.env.APPS_SCRIPT_SECRET) {
    console.warn("Apps Script proxy not configured — skipping file upload.");
    return null;
  }

  // Just validates the data URL shape early with a clear error message —
  // the Apps Script does the actual mimeType/base64 parsing on its end.
  parseDataUrl(base64);

  const safeName = (namePrefix || "upload").replace(/[^\w\s-]/g, "").trim();
  const ext = (fileName || "").includes(".") ? fileName.split(".").pop() : "";
  const finalName = `${safeName}${ext ? "." + ext : ""}`;

  const res = await fetch(process.env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: process.env.APPS_SCRIPT_SECRET,
      folderId,
      base64,
      fileName: finalName,
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error("Apps Script upload failed: " + data.error);
  }

  return data.url;
}

// Uploads the ID proof to the dedicated ID-proof folder and returns a
// viewable link. Falls back to the legacy shared folder if the new
// ID-specific env var isn't set.
async function uploadIdProof({ base64, fileName, fullName }) {
  const folderId = process.env.GOOGLE_DRIVE_ID_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
  return uploadFile({ base64, fileName, namePrefix: `${fullName || "registrant"} - ID Proof`, folderId });
}

// Uploads a payment confirmation screenshot (SBI Collect receipt) to the
// dedicated payment-proof folder and returns a viewable link. Called from
// api/submit-payment.js once someone completes payment and comes back to
// submit proof. Falls back to the legacy shared folder if the new
// payment-specific env var isn't set.
async function uploadPaymentProof({ base64, fileName, email }) {
  const folderId = process.env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
  return uploadFile({ base64, fileName, namePrefix: `${email || "registrant"} - Payment Proof`, folderId });
}

module.exports = { uploadFile, uploadIdProof, uploadPaymentProof };