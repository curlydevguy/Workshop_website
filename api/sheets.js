// api/sheets.js
// Connects to Google Sheets using the service account.
// Two functions: one to add a new "pending" row, one to flip a row to "paid".

const { google } = require("googleapis");

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Vercel stores \n as literal text — convert back to a real newline.
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Called from register.js when a new registration is submitted.
// Adds one new row with status "awaiting_payment".
async function appendRegistrationRow(rowData) {
  // rowData order must match the sheet headers exactly:
  // [Timestamp, Name, Email, Phone, Institution, Category, Amount, Payment Reference, Status, ID Proof Link, AI Check Result, AI Check Reason]
  // Add "AI Check Result" and "AI Check Reason" as headers in columns K/L
  // of the sheet if they aren't there yet — this is advisory logging only,
  // it never blocks a registration.
  //
  // One more column is filled in later, once someone completes the SBI
  // Collect payment step and submits proof (see submitPaymentProof below) —
  // add this header in column M if it isn't there yet:
  //   M: Payment Screenshot Link
  // (Columns N/O — Reported Amount / Reported Payment Date — are no longer
  // collected: SBI Collect fixes the payable amount per category, and the
  // date is already visible on the screenshot, so re-typing both was
  // redundant. Leave N/O headers in place or remove them, either is fine —
  // nothing writes to them anymore.)
  // It's left blank here on purpose; appending a 12-value row to an
  // A:L range doesn't touch M, so nothing needs to change in this call.
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Registrations!A:L",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });
}

// ⚠️ CURRENTLY UNUSED — nothing calls this since Razorpay was removed (see
// api/verify.js). Left in place since the SBI Collect verification flow
// will likely reuse this same shape: match a payment reference against
// column H, then flip Status to "paid".
//
// Finds the row whose column H currently holds razorpayOrderId, replaces it
// with the real payment_id, and sets Status to "paid".
async function markRegistrationPaid(razorpayOrderId, razorpayPaymentId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Registrations!A:I",
  });

  const rows = readResult.data.values || [];

  // Column H (PaymentID) is index 7. Row 0 is the header row.
  let matchedRowNumber = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][7] === razorpayOrderId) {
      matchedRowNumber = i + 1; // sheet rows are 1-indexed
      break;
    }
  }

  if (!matchedRowNumber) {
    throw new Error("No matching pending row found for order_id: " + razorpayOrderId);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Registrations!H${matchedRowNumber}:I${matchedRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[razorpayPaymentId, "paid"]],
    },
  });

  // Hand back the row's details so verify.js can send a confirmation email
  // without needing the frontend to resend fullName/category/amount.
  // Row columns: [Timestamp, Name, Email, Phone, Institution, Category, Amount, ...]
  const matchedRow = rows[matchedRowNumber - 1];
  return {
    fullName: matchedRow[1] || "",
    email: matchedRow[2] || "",
    category: matchedRow[5] || "",
    amount: matchedRow[6] || "",
  };
}

// Called from register.js before logging a new registration row.
// Returns true if this email already has a "paid" row — i.e. someone
// already completed a registration with it. Pending (unpaid, abandoned)
// rows don't block a retry, since that would lock someone out just because
// they closed the payment popup once.
async function isEmailAlreadyRegistered(email) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Registrations!C:I", // C=Email, ... I=Status
  });

  const rows = readResult.data.values || [];
  const target = (email || "").trim().toLowerCase();

  // Row 0 is the header row. Within each row, column C is index 0 here
  // (since the range starts at C), and Status (I) is index 6.
  return rows.slice(1).some((row) => {
    const rowEmail = (row[0] || "").trim().toLowerCase();
    const status = (row[6] || "").trim().toLowerCase();
    return rowEmail === target && status === "paid";
  });
}

// Called from api/submit-payment.js once someone pays via SBI Collect and
// comes back to submit their reference number and a screenshot of the
// confirmation. Amount/date aren't collected as separate fields (SBI Collect
// fixes the amount per category, and the date is visible on the screenshot
// itself), so this only fills in the reference + screenshot columns. Finds
// their most recent non-paid row by email, moving Status to
// "awaiting_verification" — a human still does the final check (see the
// Day-0 in-person verification step), this just gets everything they need
// into the sheet in one place.
async function submitPaymentProof(email, { reference, screenshotLink }) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const readResult = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Registrations!A:O",
  });

  const rows = readResult.data.values || [];
  const target = (email || "").trim().toLowerCase();

  // Search from the bottom so a repeat submission (e.g. they fix a typo'd
  // reference number) always lands on their most recent registration row.
  // Column C (index 2) is Email, column I (index 8) is Status.
  let matchedRowNumber = null;
  for (let i = rows.length - 1; i >= 1; i--) {
    const rowEmail = (rows[i][2] || "").trim().toLowerCase();
    const status = (rows[i][8] || "").trim().toLowerCase();
    if (rowEmail === target && status !== "paid") {
      matchedRowNumber = i + 1; // sheet rows are 1-indexed
      break;
    }
  }

  if (!matchedRowNumber) {
    throw new Error("No pending registration found for this email address.");
  }

  // Two separate updates so columns J/K/L (ID Proof Link, AI Check Result,
  // AI Check Reason) are never touched — a single H:M update would overwrite
  // them with blanks since we don't have their current values here.
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Registrations!H${matchedRowNumber}:I${matchedRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[reference, "awaiting_verification"]],
    },
  });

  // Only column M (Payment Screenshot Link) gets filled now — N (Reported
  // Amount) and O (Reported Payment Date) are no longer collected, so they're
  // left as-is. If your sheet still has headers for N/O, they'll just stay
  // permanently blank, which is harmless — remove those headers whenever
  // it's convenient.
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Registrations!M${matchedRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[screenshotLink]],
    },
  });
}

module.exports = { appendRegistrationRow, markRegistrationPaid, isEmailAlreadyRegistered, submitPaymentProof };