// POST /api/register
// Body: { fullName, email, phone, institute, category, checkInDate, checkOutDate }
// 1. Recomputes fee SERVER-SIDE (never trust client-sent amounts).
// 2. Normalizes email (lowercase + trim) for consistent lookup.
// 3. Appends row to Google Sheet with status "awaiting_payment".
// 4. Returns { success: true, amount, email }.

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

    const cleanName = (fullName || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanInstitute = (institute || '').trim();

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanInstitute || !category) {
      res.status(400).json({ error: 'Please fill in every field before continuing.' });
      return;
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Invalid registration category selected.' });
      return;
    }

    if (category === 'with_accommodation' && (!checkInDate || !checkOutDate)) {
      res.status(400).json({ error: 'Please select your check-in and check-out dates.' });
      return;
    }

    const amount = computeFee(category, checkInDate, checkOutDate);
    if (amount === null) {
      res.status(400).json({ error: 'Please choose a valid check-in/check-out date range (check-out must be after check-in).' });
      return;
    }

    // Duplicate check: one completed (paid) registration per email.
    // Unpaid registrations still "awaiting_payment" do not block a retry.
    try {
      const alreadyRegistered = await isEmailAlreadyRegistered(cleanEmail);
      if (alreadyRegistered) {
        res.status(400).json({ error: 'This email address has already been used for a completed registration. Each participant may register only once.' });
        return;
      }
    } catch (dupCheckErr) {
      console.error('[register.js] Duplicate email check failed:', dupCheckErr);
      // Non-blocking for Sheets read glitch
    }

    const timestamp = new Date().toISOString();
    const stayDates = category === 'with_accommodation' ? `${checkInDate} Dec to ${checkOutDate} Dec 2026` : '';

    console.log(`[register.js] Creating registration row: ${cleanEmail} (${category}, ₹${amount})`);

    await appendRegistrationRow([
      timestamp,
      cleanName,
      cleanEmail,
      cleanPhone,
      cleanInstitute,
      category,
      amount,
      '',                 // H: Payment Reference (filled in Step 3)
      'awaiting_payment', // I: Status
      stayDates,          // J: Stay dates
    ]);

    res.status(200).json({ success: true, amount, email: cleanEmail });
  } catch (err) {
    console.error('[register.js] Error handling registration:', err);
    res.status(500).json({ error: 'Could not save your registration. Please try again in a moment.' });
  }
};
