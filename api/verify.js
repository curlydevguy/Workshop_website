// POST /api/verify
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, email }
// Verifies the HMAC signature Razorpay sends back, then flips the matching
// row (matched by razorpay_order_id) to "paid" in the Google Sheet.

const crypto = require('crypto');
const { markRegistrationPaid } = require('./sheets');
const { sendConfirmationEmail } = require('./mailer');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ error: 'Missing payment details.' });
      return;
    }

    // Razorpay's documented way to confirm a payment is genuine: HMAC-SHA256
    // of "order_id|payment_id" signed with your key secret should match the
    // signature it sent back to the browser.
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    const isValid = expectedSignature === razorpay_signature;

    if (!isValid) {
      res.status(400).json({ verified: false, error: 'Payment signature could not be verified.' });
      return;
    }

    // Signature checks out — mark the row paid in the Sheet.
    let registrationDetails = null;
    try {
      registrationDetails = await markRegistrationPaid(razorpay_order_id, razorpay_payment_id);
    } catch (sheetErr) {
      // The payment is genuinely verified at this point — don't fail 
      // person's registration over a Sheet hiccup, just log it for follow-up.
      console.error('Sheet update failed:', sheetErr);
    }

    // Send the confirmation email now that payment is actually verified.
    // This never blocks or fails the response — a bounced/slow email
    // shouldn't turn a successful payment into an error for the user.
    if (registrationDetails && registrationDetails.email) {
      try {
        await sendConfirmationEmail(registrationDetails.email, {
          fullName: registrationDetails.fullName,
          category: registrationDetails.category,
          amount: registrationDetails.amount,
          paymentId: razorpay_payment_id,
        });
      } catch (mailErr) {
        console.error('Confirmation email failed:', mailErr);
      }
    }

    res.status(200).json({ verified: true });
  } catch (err) {
    console.error('verify.js error:', err);
    res.status(500).json({ error: 'Could not verify payment. Please contact support with your payment reference.' });
  }
};