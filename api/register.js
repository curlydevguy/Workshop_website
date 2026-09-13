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
    return null; // invalid dates
  }
  const nights = outDay - inDay;
  return BASE_FEE + (nights * ACCOMMODATION_PER_NIGHT);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      fullName,
      email,
      phone,
      institute,
      category,
      checkInDate,
      checkOutDate,
    } = req.body || {};

    if (!fullName || !email || !phone || !institute || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const amount = computeFee(category, checkInDate, checkOutDate);
    if (amount === null) {
      return res.status(400).json({ error: 'Invalid check-in/check-out dates for accommodation' });
    }

    // Check for duplicate
    try {
      const alreadyRegistered = await isEmailAlreadyRegistered(email);
      if (alreadyRegistered) {
        return res.status(409).json({ error: 'This email is already registered' });
      }
    } catch (checkErr) {
      console.warn('Duplicate check failed, continuing anyway:', checkErr);
    }

    // Append to Sheet (non-blocking for response, but log any failure)
    try {
      const regId = 'REG-' + Date.now().toString(36).toUpperCase();
      await appendRegistrationRow([
        new Date().toISOString(),
        regId,
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
    }

    // Return the verified amount so the frontend knows what to instruct
    // the user to pay on SBI Collect
    return res.status(200).json({
      success: true,
      amount,
      message: 'Registration recorded. Please complete payment via SBI Collect to confirm your seat.',
    });
  } catch (err) {
    console.error('Register API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
