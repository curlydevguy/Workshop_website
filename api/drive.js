// api/drive.js
// Uploads registrant files (college ID proofs, payment screenshots) to
// Google Drive using the same service account already used for Sheets, and
// returns a shareable link that gets logged alongside their row in the sheet.
//
// ID proofs and payment screenshots are kept in two SEPARATE Drive folders
// to stay organized. Requires two env vars beyond the existing Sheets setup:
//   GOOGLE_DRIVE_ID_FOLDER_ID       — folder for college ID proof uploads
//   GOOGLE_DRIVE_PAYMENT_FOLDER_ID  — folder for payment screenshot uploads
// Both folders must be shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor.
//
// Backwards compatibility: if the new folder-specific env vars aren't set,
// this falls back to the old single GOOGLE_DRIVE_FOLDER_ID for both types,
// so nothing breaks if you haven't updated Vercel env vars yet.

const { google } = require("googleapis");
const { Readable } = require("stream");

function getDriveAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

// dataUrl looks like "data:image/jpeg;base64,/9j/4AAQ..." — split off the header.
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Invalid file data received.");
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

// Shared upload helper — takes a base64 data URL plus a human-readable name
// prefix and a target folderId, drops the file into that folder, and returns
// a viewable link (or null if no folder id could be resolved, so callers can
// still let the rest of the flow — registration, payment proof — go through
// without blocking on Drive storage).
async function uploadFile({ base64, fileName, namePrefix, folderId }) {
  if (!folderId) {
    console.warn("No Drive folder id configured — skipping file upload.");
    return null;
  }

  const { mimeType, buffer } = parseDataUrl(base64);
  const auth = getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const safeName = (namePrefix || "upload").replace(/[^\w\s-]/g, "").trim();
  const ext = (fileName || "").includes(".") ? fileName.split(".").pop() : "";

  const file = await drive.files.create({
    requestBody: {
      name: `${safeName}${ext ? "." + ext : ""}`,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, webViewLink",
  });

  // Make it viewable by anyone with the link so the row in the sheet is useful
  // to whoever reviews registrations, without needing Drive access granted per-person.
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: "reader", type: "anyone" },
  });

  return file.data.webViewLink;
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