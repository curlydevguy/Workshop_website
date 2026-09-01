// POST /api/verify-otp
// Body: { email, otp, challengeToken }
// Checks the user-entered code against the challenge token from send-otp.
// On success, returns a signed "verifiedToken" that register.js will trust
// as proof this email was actually confirmed.

const { verifyChallengeToken, createVerifiedToken } = require('./otp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, otp, challengeToken } = req.body || {};

    if (!email || !otp || !challengeToken) {
      res.status(400).json({ error: 'Missing verification details. Please request a new code.' });
      return;
    }

    const result = verifyChallengeToken(challengeToken, otp);

    if (!result || result.email !== email.toLowerCase()) {
      res.status(400).json({
        verified: false,
        error: 'That code is incorrect or has expired. Please request a new one.',
      });
      return;
    }

    const verifiedToken = createVerifiedToken(email);
    res.status(200).json({ verified: true, verifiedToken });
  } catch (err) {
    console.error('verify-otp.js error:', err);
    res.status(500).json({ error: 'Could not verify the code. Please try again.' });
  }
};
