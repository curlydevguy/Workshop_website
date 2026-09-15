// api/sheets.js
// Connects to Google Sheets using the service account.
// Handles appending new registration rows and updating rows with payment proof.

const { google } = require("googleapis");

function getAuth() {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim().replace(/^["']|["']$/g, "");
  let privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
  // Vercel stores \n as literal text — convert back to real newlines
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    console.error("[sheets.js] Missing service account credentials:", {
      hasEmail: Boolean(email),
      hasPrivateKey: Boolean(privateKey),
    });
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSpreadsheetId() {
  return (process.env.GOOGLE_SHEET_ID || "").trim().replace(/^["']|["']$/g, "");
}

// Convert zero-indexed column number to Sheet column letter (0->A, 7->H, 8->I, 12->M)
function colToLetter(colIdx) {
  let temp, letter = '';
  let col = colIdx + 1;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}

// Called from register.js when a new registration is submitted.
// Adds one new row with status "awaiting_payment".
async function appendRegistrationRow(rowData) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  console.log(`[sheets.js] Appending registration row for email: "${rowData[2]}", category: "${rowData[5]}", amount: "${rowData[6]}"`);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Registrations!A:L",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[sheets.js] Row appended successfully. Updated range: ${response.data.updates ? response.data.updates.updatedRange : 'N/A'}`);
}

// Called from register.js before logging a new registration row.
// Returns true only if this email already has a "paid" or "confirmed" row.
// Pending (unpaid, awaiting_payment) rows do NOT block a retry.
async function isEmailAlreadyRegistered(email) {
  const target = (email || "").trim().toLowerCase();
  if (!target) return false;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Registrations!A:O",
  });

  const rows = readResult.data.values || [];
  if (!rows || rows.length <= 1) return false;

  // Header inspection
  const headerRow = (rows[0] || []).map(h => (h || "").toString().trim().toLowerCase());
  let emailCol = headerRow.findIndex(h => h.includes("email"));
  if (emailCol === -1) emailCol = 2; // Default column C

  let statusCol = headerRow.findIndex(h => h.includes("status"));
  if (statusCol === -1) statusCol = 8; // Default column I

  return rows.slice(1).some((row) => {
    const rowEmail = (row[emailCol] || row[2] || "").toString().trim().toLowerCase();
    const status = (row[statusCol] || row[8] || row[7] || "").toString().trim().toLowerCase();
    return rowEmail === target && (status === "paid" || status === "confirmed");
  });
}

// Called from api/submit-payment.js once someone pays via SBI Collect and
// comes back to submit their reference number and confirmation screenshot.
// Searches from the bottom for their most recent pending registration.
async function submitPaymentProof(email, { reference, screenshotLink }) {
  const target = (email || "").trim().toLowerCase();
  const cleanRef = (reference || "").trim();

  if (!target) {
    throw new Error("Missing email address.");
  }
  if (!cleanRef) {
    throw new Error("Missing payment reference number.");
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  console.log(`[submitPaymentProof] Fetching sheet rows to match email: "${target}"`);

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Registrations!A:O",
  });

  const rows = readResult.data.values || [];
  if (!rows || rows.length <= 1) {
    console.error(`[submitPaymentProof] Sheet is empty or only has headers. Total rows: ${rows ? rows.length : 0}`);
    throw new Error("No registrations found. Please complete Step 1 (Participant details) before submitting payment proof.");
  }

  // Detect column indices dynamically from headers in row 0
  const headerRow = (rows[0] || []).map(h => (h || "").toString().trim().toLowerCase());

  let emailCol = headerRow.findIndex(h => h.includes("email"));
  if (emailCol === -1) emailCol = 2; // Column C

  let statusCol = headerRow.findIndex(h => h.includes("status"));
  if (statusCol === -1) statusCol = 8; // Column I

  let refCol = headerRow.findIndex(h => h.includes("ref") || h.includes("utr") || h.includes("order_id"));
  if (refCol === -1) refCol = 7; // Column H

  let screenshotCol = headerRow.findIndex(h => h.includes("screenshot") || h.includes("proof") || h.includes("drive"));
  if (screenshotCol === -1) screenshotCol = 12; // Column M

  console.log(`[submitPaymentProof] Headers detected -> email: col ${colToLetter(emailCol)} (${emailCol}), status: col ${colToLetter(statusCol)} (${statusCol}), ref: col ${colToLetter(refCol)} (${refCol}), screenshot: col ${colToLetter(screenshotCol)} (${screenshotCol}). Total sheet rows: ${rows.length}`);

  let matchedRowNumber = null;
  let alreadyPaid = false;

  // Search from bottom up so the latest registration row is matched
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i] || [];
    const rowEmail = (row[emailCol] || row[2] || "").toString().trim().toLowerCase();

    if (rowEmail === target) {
      const status = (row[statusCol] || row[8] || row[7] || "").toString().trim().toLowerCase();
      if (status === "paid" || status === "confirmed") {
        alreadyPaid = true;
      } else {
        matchedRowNumber = i + 1; // 1-indexed row number for Sheets API
        break;
      }
    }
  }

  if (!matchedRowNumber) {
    if (alreadyPaid) {
      console.warn(`[submitPaymentProof] Email "${target}" already has a paid registration.`);
      throw new Error("This registration has already been verified and marked as paid. If you need assistance, please contact the organizers.");
    }
    console.warn(`[submitPaymentProof] No pending row found for email "${target}". Total rows searched: ${rows.length - 1}`);
    throw new Error(`No pending registration found for "${target}". Please ensure you completed Step 1 with this exact email address.`);
  }

  const refColLetter = colToLetter(refCol);
  const statusColLetter = colToLetter(statusCol);
  const screenshotColLetter = colToLetter(screenshotCol);

  console.log(`[submitPaymentProof] Match found on row ${matchedRowNumber}. Writing ref to ${refColLetter}, status to ${statusColLetter}, screenshot to ${screenshotColLetter}`);

  // Update Reference and Status
  if (statusCol === refCol + 1) {
    // Adjacent columns (e.g. H and I)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Registrations!${refColLetter}${matchedRowNumber}:${statusColLetter}${matchedRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[cleanRef, "awaiting_verification"]],
      },
    });
  } else {
    // Non-adjacent columns
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Registrations!${refColLetter}${matchedRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[cleanRef]],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Registrations!${statusColLetter}${matchedRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["awaiting_verification"]],
      },
    });
  }

  // Update screenshot link if provided
  if (screenshotLink) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Registrations!${screenshotColLetter}${matchedRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[screenshotLink]],
      },
    });
  }

  console.log(`[submitPaymentProof] Successfully updated row ${matchedRowNumber} for email "${target}"`);
}

module.exports = {
  appendRegistrationRow,
  isEmailAlreadyRegistered,
  submitPaymentProof,
};
