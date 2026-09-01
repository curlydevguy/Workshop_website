// POST /api/send-otp
// Body: { email }
// Generates a 6-digit OTP, emails it via Gmail SMTP, and returns a signed
// "challengeToken" the frontend must send back to /api/verify-otp along
// with whatever code the user typed in.
//
// Accepts any @iitr.ac.in address, including department subdomains like
// @cs.iitr.ac.in, @ma.iitr.ac.in, etc. — covers students, faculty, and
// researchers across all IITR departments.

const { generateOtp, createChallengeToken } = require('./otp');
const { sendOtpEmail } = require('./mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IITR_DOMAIN = 'iitr.ac.in';

function isIitrEmail(email) {
  const domain = email.toLowerCase().split('@')[1] || '';
  return domain === IITR_DOMAIN || domain.endsWith('.' + IITR_DOMAIN);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email } = req.body || {};

    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    if (!isIitrEmail(email)) {
      res.status(400).json({ error: `Only @${IITR_DOMAIN} email addresses (including department subdomains) can be verified for the IIT Roorkee rate.` });
      return;
    }

    const otp = generateOtp();
    const challengeToken = createChallengeToken(email, otp);

    await sendOtpEmail(email, otp);

    res.status(200).json({ sent: true, challengeToken });
  } catch (err) {
    console.error('send-otp.js error:', err);
    res.status(500).json({ error: 'Could not send the verification code. Please try again in a moment.' });
  }
};
