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

// Called from register.js right after a Razorpay order is created.
// Adds one new row with status "pending".
async function appendRegistrationRow(rowData) {
  // rowData order must match the sheet headers exactly:
  // [Timestamp, Name, Email, Phone, Institution, Category, Amount, PaymentID, Status, ID Proof Link, AI Check Result, AI Check Reason]
  // Add "AI Check Result" and "AI Check Reason" as headers in columns K/L
  // of the sheet if they aren't there yet — this is advisory logging only,
  // it never blocks a registration.
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

// Called from verify.js once Razorpay's signature is confirmed.
// Finds the row whose PaymentID column currently holds the razorpay_order_id
// (written there at insert time), replaces it with the real payment_id,
// and sets Status to "paid".
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

// Called from register.js before creating a Razorpay order.
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

module.exports = { appendRegistrationRow, markRegistrationPaid, isEmailAlreadyRegistered };