// api/drive.js
// Uploads payment confirmation screenshots to Google Drive.
// Supports two paths:
// 1. Google Apps Script web app proxy (via APPS_SCRIPT_URL & APPS_SCRIPT_SECRET)
// 2. Direct Google Drive API v3 using the Google Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY)

const stream = require("stream");

function cleanDriveFolderId(input) {
  if (!input) return "";
  const cleaned = input.trim().replace(/^["']|["']$/g, "");
  const match = cleaned.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return cleaned;
}

function getFolderId() {
  const raw =
    process.env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID ||
    process.env.GOOGLE_DRIVE_FOLDER_ID ||
    process.env.PAYMENT_FOLDER_ID ||
    process.env.DRIVE_FOLDER_ID ||
    "";
  return cleanDriveFolderId(raw);
}

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Invalid file data received (empty or not a string).");
  }

  const clean = dataUrl.trim();
  const commaIdx = clean.indexOf(",");

  if (commaIdx === -1) {
    // Pure base64 string
    const sanitized = clean.replace(/\s+/g, "");
    return {
      mimeType: "image/jpeg",
      base64Data: sanitized,
      buffer: Buffer.from(sanitized, "base64"),
    };
  }

  const header = clean.slice(0, commaIdx);
  const rawBase64 = clean.slice(commaIdx + 1).replace(/\s+/g, "");
  const mimeMatch = header.match(/data:([^;]+)/i);
  const mimeType = mimeMatch ? mimeMatch[1].trim().toLowerCase() : "image/jpeg";
  const buffer = Buffer.from(rawBase64, "base64");

  return { mimeType, base64Data: rawBase64, buffer };
}

function extractDriveUrl(data) {
  if (!data) return null;
  if (typeof data === "string") {
    if (data.startsWith("http")) return data.trim();
    return null;
  }

  const candidate =
    data.url ||
    data.fileUrl ||
    data.link ||
    data.webViewLink ||
    data.viewLink ||
    data.downloadUrl ||
    (data.file && (data.file.url || data.file.webViewLink || data.file.id)) ||
    (data.data && (data.data.url || data.data.webViewLink || data.data.id));

  if (typeof candidate === "string" && candidate.startsWith("http")) {
    return candidate.trim();
  }

  const idCandidate = data.id || data.fileId || (data.file && data.file.id) || (data.data && data.data.id);
  if (idCandidate && typeof idCandidate === "string") {
    return `https://drive.google.com/file/d/${idCandidate.trim()}/view?usp=drivesdk`;
  }

  return null;
}

function getServiceAccountDriveAuth() {
  let googleapis;
  try {
    googleapis = require("googleapis");
  } catch (e) {
    console.warn("[drive.js] googleapis module not found in runtime environment.");
    return null;
  }
  const { google } = googleapis;

  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim().replace(/^["']|["']$/g, "");
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!email || !privateKey) return null;

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: privateKey,
    },
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

async function uploadDirectToDrive({ buffer, mimeType, fileName, folderId }) {
  let googleapis;
  try {
    googleapis = require("googleapis");
  } catch (e) {
    throw new Error("googleapis package not available for Direct Drive API.");
  }
  const { google } = googleapis;

  const auth = getServiceAccountDriveAuth();
  if (!auth) {
    throw new Error("No Google Service Account credentials available for Direct Drive API.");
  }

  console.log(`[drive.js] Uploading directly to Google Drive v3 via Service Account: "${fileName}"`);
  const drive = google.drive({ version: "v3", auth });

  const fileMetadata = { name: fileName };
  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);

  let file;
  try {
    file = await drive.files.create({
      resource: fileMetadata,
      media: {
        mimeType: mimeType || "application/octet-stream",
        body: bufferStream,
      },
      fields: "id, webViewLink, webContentLink",
    });
  } catch (err) {
    // If folder was invalid or not shared with service account, fallback to service account root drive
    if (folderId && err.message && (err.message.includes("File not found") || err.message.includes("permission") || err.message.includes("404"))) {
      console.warn(`[drive.js] Upload into folder "${folderId}" failed (${err.message}). Retrying upload to root...`);
      const retryStream = new stream.PassThrough();
      retryStream.end(buffer);
      file = await drive.files.create({
        resource: { name: fileName },
        media: {
          mimeType: mimeType || "application/octet-stream",
          body: retryStream,
        },
        fields: "id, webViewLink, webContentLink",
      });
    } else {
      throw err;
    }
  }

  const fileId = file.data && file.data.id;
  const webViewLink = (file.data && file.data.webViewLink) || (fileId ? `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk` : null);

  // Set file permissions so organizers can view the proof link
  if (fileId) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (permErr) {
      console.warn("[drive.js] Could not set public view permission on Drive file:", permErr.message);
    }
  }

  return webViewLink;
}

async function uploadFile({ base64, fileName, namePrefix, folderId }) {
  const cleanFolderId = cleanDriveFolderId(folderId || getFolderId());
  const cleanUrl = (process.env.APPS_SCRIPT_URL || "").trim().replace(/^["']|["']$/g, "");
  const cleanSecret = (process.env.APPS_SCRIPT_SECRET || "").trim().replace(/^["']|["']$/g, "");

  // 1. Parse & validate file data
  const { mimeType, base64Data, buffer } = parseDataUrl(base64);

  const safeName = (namePrefix || "upload").replace(/[^\w\s-]/g, "").trim();
  const ext = (fileName || "").includes(".") ? fileName.split(".").pop().toLowerCase() : (mimeType.includes("pdf") ? "pdf" : "jpg");
  const finalName = `${safeName}${ext ? "." + ext : ""}`;

  let lastError = null;

  // 2. Try Apps Script proxy if URL and secret are present
  if (cleanUrl && cleanSecret) {
    try {
      console.log(`[drive.js] Posting file upload to Apps Script: "${finalName}"`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const res = await fetch(cleanUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "follow",
        signal: controller.signal,
        body: JSON.stringify({
          secret: cleanSecret,
          folderId: cleanFolderId,
          base64: base64Data,
          dataUrl: base64,
          rawBase64: base64Data,
          mimeType,
          fileName: finalName,
          filename: finalName,
          name: finalName,
        }),
      });
      clearTimeout(timeout);

      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`Apps Script HTTP ${res.status}: ${rawText.slice(0, 200)}`);
      }

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        throw new Error(`Apps Script returned non-JSON response: ${rawText.slice(0, 200)}`);
      }

      if (data.error) {
        throw new Error(`Apps Script error: ${data.error}`);
      }

      const driveUrl = extractDriveUrl(data);
      if (driveUrl) {
        console.log(`[drive.js] Screenshot uploaded via Apps Script successfully: ${driveUrl}`);
        return driveUrl;
      }
      throw new Error(`No file link returned in Apps Script response: ${JSON.stringify(data).slice(0, 200)}`);
    } catch (appsScriptErr) {
      console.warn(`[drive.js] Apps Script upload failed (${appsScriptErr.message}). Attempting Service Account fallback...`);
      lastError = appsScriptErr;
    }
  } else {
    console.log("[drive.js] Apps Script not configured, using Service Account Drive API directly.");
  }

  // 3. Fallback: Upload directly using Google Service Account Drive API
  try {
    const directUrl = await uploadDirectToDrive({
      buffer,
      mimeType,
      fileName: finalName,
      folderId: cleanFolderId,
    });
    if (directUrl) {
      console.log(`[drive.js] Screenshot uploaded directly via Google Drive API successfully: ${directUrl}`);
      return directUrl;
    }
  } catch (directErr) {
    console.error("[drive.js] Direct Drive API upload failed:", directErr.message);
    lastError = directErr;
  }

  // If both failed, throw informative error
  throw new Error(`Could not upload screenshot to Drive: ${lastError ? lastError.message : "No upload method succeeded"}`);
}

// Uploads payment confirmation screenshot (SBI Collect receipt)
async function uploadPaymentProof({ base64, fileName, email }) {
  const folderId = getFolderId();
  return uploadFile({
    base64,
    fileName,
    namePrefix: `${email || "registrant"} - Payment Proof`,
    folderId,
  });
}

module.exports = {
  uploadFile,
  uploadPaymentProof,
  parseDataUrl,
  extractDriveUrl,
  cleanDriveFolderId,
};
