// POST /api/submit-payment
// Body: { email, reference, screenshotBase64, screenshotFileName }
//
// Called from register.html's payment confirmation step, after someone pays via SBI
// Collect and comes back to submit proof. Uploads the screenshot to Google Drive,
// then updates their row in Google Sheets with the reference number and screenshot link,
// transitioning Status from "awaiting_payment" to "awaiting_verification".

const { submitPaymentProof } = require('./sheets');
const { uploadPaymentProof } = require('./drive');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, reference, screenshotBase64, screenshotFileName } = req.body || {};

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanRef = (reference || '').trim();

    if (!cleanEmail) {
      res.status(400).json({ error: 'Please provide the email address you used during registration.' });
      return;
    }

    if (!cleanRef) {
      res.status(400).json({ error: 'Please enter your SBI Collect reference / UTR number.' });
      return;
    }

    if (!screenshotBase64) {
      res.status(400).json({ error: 'Please upload your payment confirmation screenshot.' });
      return;
    }

    console.log(`[submit-payment.js] Processing payment proof for: ${cleanEmail}, Ref: ${cleanRef}`);

    // Upload screenshot to Drive (best effort — if Drive is unavailable, still save the reference in Sheets)
    let screenshotLink = '';
    try {
      screenshotLink = (await uploadPaymentProof({
        base64: screenshotBase64,
        fileName: screenshotFileName,
        email: cleanEmail,
      })) || '';
    } catch (driveErr) {
      console.error('[submit-payment.js] Screenshot upload error (proceeding with sheet update):', driveErr);
    }

    try {
      await submitPaymentProof(cleanEmail, { reference: cleanRef, screenshotLink });
    } catch (sheetErr) {
      console.error('[submit-payment.js] Sheet update error:', sheetErr);
      res.status(400).json({ error: sheetErr.message || 'Could not update payment details. Please try again.' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[submit-payment.js] Unexpected error:', err);
    res.status(500).json({ error: 'Could not submit your payment proof. Please try again in a moment.' });
  }
};
