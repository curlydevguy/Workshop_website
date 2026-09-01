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
  // [Timestamp, Name, Email, Phone, Institution, Category, Amount, PaymentID, Status, ID Proof Link]
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Registrations!A:J",
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
}

module.exports = { appendRegistrationRow, markRegistrationPaid };