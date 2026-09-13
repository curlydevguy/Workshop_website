// POST /api/register
// Body: { fullName, email, phone, institute, category, checkInDate, checkOutDate, amount }
// 1. Recomputes the fee SERVER-SIDE (never trust a client-sent amount).
// 2. Logs a row to the Google Sheet with status "awaiting_payment".
// 3. Returns a simple success response — no payment gateway right now.
//    Payment is via SBI Collect; registrations are collected here and
//    payment is confirmed manually.
//
// Fee model (2 categories only):
//   without_accommodation -> flat ₹3,000
//   with_accommodation    -> ₹3,000 + (nights × ₹700)
//   nights = checkOutDate - checkInDate (both are day-of-month numbers in
//   December 2026; check-in 19–24, check-out 20–25)

const { appendRegistrationRow, isEmailAlreadyRegistered } = require('./sheets');

const BASE_FEE = 3000;
const ACCOMMODATION_PER_NIGHT = 700;
const VALID_CATEGORIES = ['without_accommodation', 'with_accommodation'];
const VALID_CHECKIN_DAYS = [19, 20, 21, 22, 23, 24];
const VALID_CHECKOUT_DAYS = [20, 21, 22, 23, 24, 25];

function computeFee(category, checkInDate, checkOutDate) {
  if (category === 'without_accommodation') {
    return BASE_FEE;
  }
  const inDay = Number(checkInDate);
  const outDay = Number(checkOutDate);
  if (!VALID_CHECKIN_DAYS.includes(inDay) || !VALID_CHECKOUT_DAYS.includes(outDay) || outDay <= inDay) {
    return null;
  }
  const nights = outDay - inDay;
  return BASE_FEE + nights * ACCOMMODATION_PER_NIGHT;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { fullName, email, phone, institute, category, checkInDate, checkOutDate } = req.body || {};

    if (!fullName || !email || !phone || !institute || !category) {
      res.status(400).json({ error: 'Please fill in every field before continuing.' });
      return;
    }

    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Invalid registration category.' });
      return;
    }

    if (category === 'with_accommodation' && (!checkInDate || !checkOutDate)) {
      res.status(400).json({ error: 'Please choose your check-in and check-out dates.' });
      return;
    }

    const amount = computeFee(category, checkInDate, checkOutDate);
    if (amount === null) {
      res.status(400).json({ error: 'Please choose a valid check-in/check-out date range (check-out must be after check-in).' });
      return;
    }

    // One completed (paid) registration per email. Anyone still
    // "awaiting_payment" doesn't count yet, so a genuine retry isn't blocked.
    try {
      const alreadyRegistered = await isEmailAlreadyRegistered(email);
      if (alreadyRegistered) {
        res.status(400).json({ error: 'This email address has already been used for a completed registration. Each participant may register only once.' });
        return;
      }
    } catch (dupCheckErr) {
      // If the duplicate check itself fails (e.g. Sheets hiccup), don't let
      // that silently block every registration — log it and continue.
      console.error('Duplicate email check failed:', dupCheckErr);
    }

    // Log the row as "awaiting_payment" — column H holds the SBI Collect
    // UTR/reference number once the payment-proof step is submitted.
    try {
      await appendRegistrationRow([
        new Date().toISOString(),
        fullName,
        email,
        phone,
        institute,
        category,
        amount,
        '',                 // H — payment reference (SBI Collect UTR), filled in later
        'awaiting_payment', // I
        category === 'with_accommodation' ? `${checkInDate} Dec to ${checkOutDate} Dec 2026` : '', // J — stay dates, if any
      ]);
    } catch (sheetErr) {
      console.error('Sheet insert failed:', sheetErr);
      res.status(500).json({ error: 'Could not save your registration. Please try again in a moment.' });
      return;
    }

    res.status(200).json({ success: true, amount });
  } catch (err) {
    console.error('register.js error:', err);
    res.status(500).json({ error: 'Could not start registration. Please try again in a moment.' });
  }
};
