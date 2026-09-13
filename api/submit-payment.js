// POST /api/submit-payment
// Body: { email, reference, screenshotBase64, screenshotFileName }
//
// Called from register.html's payment step, after someone pays via SBI
// Collect and comes back to submit proof. Uploads the screenshot to its own
// dedicated Google Drive folder (separate from ID proofs), then updates
// their row in the Sheet with the reference number and a link to the
// screenshot — moving Status from "awaiting_payment" to
// "awaiting_verification". Amount and date are intentionally NOT collected
// as separate typed fields: SBI Collect fixes the payable amount per
// category (so it's not user-editable at payment time), and the date is
// already visible on the screenshot itself — so both would just be
// redundant re-typing. This is a sanity-check layer, not a bank-verified
// payment: a human still confirms at Day-0 check-in by looking at the actual
// SMS/email receipt on the participant's phone.

const { submitPaymentProof } = require('./sheets');
const { uploadPaymentProof } = require('./drive');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, reference, screenshotBase64, screenshotFileName } = req.body || {};

    if (!email || !reference || !screenshotBase64) {
      res.status(400).json({ error: 'Please fill in every field and upload your payment screenshot.' });
      return;
    }

    // Upload first — if this fails we still want a record of the reference
    // number and amount, so we log the row either way with a blank link.
    let screenshotLink = '';
    try {
      screenshotLink = (await uploadPaymentProof({ base64: screenshotBase64, fileName: screenshotFileName, email })) || '';
    } catch (driveErr) {
      console.error('Payment screenshot upload failed:', driveErr);
    }

    try {
      await submitPaymentProof(email, { reference, screenshotLink });
    } catch (sheetErr) {
      console.error('Payment sheet update failed:', sheetErr);
      res.status(400).json({ error: sheetErr.message || 'Could not save your payment details. Please try again in a moment.' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit-payment.js error:', err);
    res.status(500).json({ error: 'Could not submit your payment proof. Please try again in a moment.' });
  }
};