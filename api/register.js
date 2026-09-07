// POST /api/register
// Body: { fullName, email, phone, institute, category }
// 1. Looks up the fee for the category SERVER-SIDE (never trust a client-sent amount).
// 2. Logs a row to the Google Sheet with status "awaiting_payment".
// 3. Returns a simple success response — no payment gateway right now.
//    Payment is being moved to SBI Collect; that reconciliation flow will
//    be wired up separately once the SBI Collect setup is finalized. Until
//    then, registrations are collected here and payment is handled manually.

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { fullName, email, phone, institute, category, idProofBase64, idProofFileName, verifiedToken, idProofAiCheckResult, idProofAiCheckReason } = req.body || {};

    if (!fullName || !email || !phone || !category) {
      res.status(400).json({ error: 'Please fill in every field before continuing.' });
      return;
    }

    // Institute/Organization is only collected (and required) for the
    // manual, non-IITR categories — the IITR path knows the institute
    // implicitly and never shows that field.
    if (category !== 'iitr_student' && !institute) {
      res.status(400).json({ error: 'Please enter your institute or organization.' });
      return;
    }

    // ID proof is only ever asked of the IITR-student rate on the frontend
    // — so it should only ever be required here too. Requiring it
    // unconditionally was blocking every non-IITR registration.
    if (category === 'iitr_student' && !idProofBase64) {
      res.status(400).json({ error: 'Please upload a photo of your college ID card showing your roll number.' });
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

    // Upload the ID proof to Drive before logging the row, so the sheet can
    // include a link to it. If this fails, we still let the registration go
    // through — we'd rather chase down a missing ID proof manually.
    let idProofLink = '';
    try {
      idProofLink = (await uploadIdProof({ base64: idProofBase64, fileName: idProofFileName, fullName })) || '';
    } catch (driveErr) {
      console.error('ID proof upload failed:', driveErr);
    }

    // Log the row as "awaiting_payment" — column H (previously the Razorpay
    // order/payment ID) is blank for now and will hold the SBI Collect
    // UTR/reference number once that flow is wired up.
    try {
      await appendRegistrationRow([
        new Date().toISOString(),
        fullName,
        email,
        phone,
        institute,
        finalCategory,
        amount,
        '',                 // H — payment reference (SBI Collect UTR), filled in later
        'awaiting_payment', // I
        idProofLink,
        idProofAiCheckResult || 'not_checked', // K — advisory only, never blocks
        idProofAiCheckReason || '',            // L
      ]);
    } catch (sheetErr) {
      console.error('Sheet insert failed:', sheetErr);
      res.status(500).json({ error: 'Could not save your registration. Please try again in a moment.' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('register.js error:', err);
    res.status(500).json({ error: 'Could not start registration. Please try again in a moment.' });
  }
};