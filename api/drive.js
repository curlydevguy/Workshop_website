// api/drive.js
// Uploads a registrant's college ID proof to a Google Drive folder using the
// same service account already used for Sheets, and returns a shareable link
// that gets logged alongside their row in the sheet.
//
// Requires one extra env var beyond the existing Sheets setup:
//   GOOGLE_DRIVE_FOLDER_ID  — the Drive folder the service account can write into
// The folder must be shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor.

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

// Uploads the ID proof and returns a viewable link (or null if not configured,
// so registration can still proceed without blocking on ID proof storage).
async function uploadIdProof({ base64, fileName, fullName }) {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.warn("GOOGLE_DRIVE_FOLDER_ID not set — skipping ID proof upload.");
    return null;
  }

  const { mimeType, buffer } = parseDataUrl(base64);
  const auth = getDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const safeName = (fullName || "registrant").replace(/[^\w\s-]/g, "").trim();
  const ext = (fileName || "").includes(".") ? fileName.split(".").pop() : "";

  const file = await drive.files.create({
    requestBody: {
      name: `${safeName} - ID Proof${ext ? "." + ext : ""}`,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
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

module.exports = { uploadIdProof };
