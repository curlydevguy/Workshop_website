// api/drive.js
// Uploads payment confirmation screenshots to Google Drive via Google Apps Script proxy.
//
// Requires:
//   APPS_SCRIPT_URL                — deployed web app URL (ends in /exec)
//   APPS_SCRIPT_SECRET             — shared secret matching the Apps Script SECRET constant
//   GOOGLE_DRIVE_PAYMENT_FOLDER_ID — folder for payment screenshot uploads (or GOOGLE_DRIVE_FOLDER_ID)

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Invalid file data received.");
  return { mimeType: match[1] };
}

async function uploadFile({ base64, fileName, namePrefix, folderId }) {
  const cleanFolderId = (folderId || "").trim().replace(/^["']|["']$/g, "");
  const cleanUrl = (process.env.APPS_SCRIPT_URL || "").trim().replace(/^["']|["']$/g, "");
  const cleanSecret = (process.env.APPS_SCRIPT_SECRET || "").trim().replace(/^["']|["']$/g, "");

  if (!cleanFolderId) {
    console.warn("[drive.js] No Drive folder ID configured — skipping file upload.");
    return null;
  }

  if (!cleanUrl || !cleanSecret) {
    console.warn("[drive.js] Apps Script proxy URL or SECRET not configured — skipping file upload.");
    return null;
  }

  // Validate data URL structure
  parseDataUrl(base64);

  const safeName = (namePrefix || "upload").replace(/[^\w\s-]/g, "").trim();
  const ext = (fileName || "").includes(".") ? fileName.split(".").pop() : "";
  const finalName = `${safeName}${ext ? "." + ext : ""}`;

  console.log(`[drive.js] Posting file upload to Apps Script: "${finalName}"`);

  const res = await fetch(cleanUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "follow",
    body: JSON.stringify({
      secret: cleanSecret,
      folderId: cleanFolderId,
      base64,
      fileName: finalName,
    }),
  });

  const rawText = await res.text();

  if (!res.ok) {
    console.error(
      `[drive.js] Apps Script proxy returned HTTP ${res.status}. Body preview:`,
      rawText.slice(0, 300)
    );
    throw new Error(`Apps Script upload failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    console.error(
      "[drive.js] Apps Script proxy returned non-JSON content. Body preview:",
      rawText.slice(0, 300)
    );
    throw new Error(
      "Apps Script upload failed: response was not valid JSON (see server logs)"
    );
  }

  if (data.error) {
    throw new Error("Apps Script upload failed: " + data.error);
  }

  console.log(`[drive.js] Screenshot uploaded successfully: ${data.url}`);
  return data.url;
}

// Uploads payment confirmation screenshot (SBI Collect receipt)
async function uploadPaymentProof({ base64, fileName, email }) {
  const folderId = process.env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
  return uploadFile({
    base64,
    fileName,
    namePrefix: `${email || "registrant"} - Payment Proof`,
    folderId,
  });
}

module.exports = { uploadFile, uploadPaymentProof };
