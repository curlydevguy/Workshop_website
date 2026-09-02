// POST /api/register
// Body: { fullName, email, phone, institute, category }
// 1. Looks up the fee for the category SERVER-SIDE (never trust a client-sent amount).
// 2. Creates a Razorpay order for that amount.
// 3. Logs a "pending" row to the Google Sheet.
// 4. Returns the order details the frontend needs to open Razorpay checkout.

const Razorpay = require('razorpay');
const { appendRegistrationRow, isEmailAlreadyRegistered } = require('./sheets');
const { uploadIdProof } = require('./drive');
const { readVerifiedToken } = require('./otp');

// Keep this in sync with the <option data-fee="..."> values in register.html
// and the fee table on details.html.
const FEES = {
  iitr_student: 500,
  other_student: 1000,
  industry: 2000,
};

const IITR_DOMAIN = 'iitr.ac.in';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { fullName, email, phone, institute, category, idProofBase64, idProofFileName, verifiedToken } = req.body || {};

    if (!fullName || !email || !phone || !institute || !category) {
      res.status(400).json({ error: 'Please fill in every field before continuing.' });
      return;
    }

    if (!idProofBase64) {
      res.status(400).json({ error: 'Please upload a photo of your college ID card showing your roll number.' });
      return;
    }

    // One completed registration per email. Pending/abandoned attempts
    // don't count, so someone who closed the payment popup can still retry.
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

    // Only the IITR-student discount tier needs a verified email — other
    // categories are self-declared, same as before this feature existed.
    let finalCategory = category;

    if (category === 'iitr_student') {
      const verified = verifiedToken ? readVerifiedToken(verifiedToken) : null;
      if (!verified || verified.email !== email.toLowerCase()) {
        res.status(400).json({ error: 'Please verify your @iitr.ac.in email address before completing registration.' });
        return;
      }

      // Accept the main domain and any department subdomain, same as
      // send-otp.js — this must stay in sync with that check or a verified
      // subdomain email (e.g. @cs.iitr.ac.in) would pass OTP verification
      // but get rejected here.
      const emailDomain = verified.email.split('@')[1] || '';
      if (emailDomain !== IITR_DOMAIN && !emailDomain.endsWith('.' + IITR_DOMAIN)) {
        res.status(400).json({
          error: `The IIT Roorkee Student rate requires a verified @${IITR_DOMAIN} email address. Please verify with your institute email, or choose a different category.`,
        });
        return;
      }

      finalCategory = 'iitr_student';
    }

    const amount = FEES[finalCategory];
    if (!amount) {
      res.status(400).json({ error: 'Invalid registration category.' });
      return;
    }

    // Razorpay wants the amount in the smallest currency unit (paise for INR).
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      // Order IDs are already unique, so this doubles as our sheet row key.
      notes: { fullName, email, phone, institute, category: finalCategory },
    });

    // Upload the ID proof to Drive before logging the row, so the sheet can
    // include a link to it. If this fails, we still let the person pay — we'd
    // rather chase down a missing ID proof manually than block a payment.
    let idProofLink = '';
    try {
      idProofLink = (await uploadIdProof({ base64: idProofBase64, fileName: idProofFileName, fullName })) || '';
    } catch (driveErr) {
      console.error('ID proof upload failed:', driveErr);
    }

    // Log a pending row. If this fails we still let the person pay — we'd
    // rather reconcile a missing sheet row manually than block a payment.
    try {
      await appendRegistrationRow([
        new Date().toISOString(),
        fullName,
        email,
        phone,
        institute,
        finalCategory,
        amount,
        order.id,      // PaymentID column temporarily holds the order_id
        'pending',
        idProofLink,
      ]);
    } catch (sheetErr) {
      console.error('Sheet insert failed:', sheetErr);
    }

    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('register.js error:', err);
    res.status(500).json({ error: 'Could not start registration. Please try again in a moment.' });
  }
};