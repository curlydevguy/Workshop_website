// api/otp.js
// Stateless OTP token helpers — no database, no Sheet writes needed.
//
// Flow:
//   1. send-otp generates a 6-digit code, emails it, and hands the browser a
//      signed "challenge token" that PROVES the code exists but does NOT
//      contain the code itself (only an HMAC commitment to it) — so nobody
//      can read the OTP out of devtools/localStorage.
//   2. verify-otp takes the code the user typed + the challenge token,
//      recomputes the commitment, and checks it matches. If so, it issues a
//      "verified token" — signed proof that this email was confirmed.
//   3. register.js checks the verified token before trusting the email,
//      instead of re-doing any OTP logic itself.
//
// All tokens are HMAC-SHA256 signed with OTP_SECRET (set this in your
// Vercel env vars — a long random string, not reused anywhere else).

const crypto = require('crypto');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;      // 10 minutes to enter the code
const VERIFIED_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes to finish registering after verifying

function hmac(payload) {
  return crypto.createHmac('sha256', process.env.OTP_SECRET).update(payload).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateOtp() {
  // 6-digit numeric code, zero-padded.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// ---- Challenge token: "a code was issued for this email, expiring at X" ----
// Deliberately does NOT contain the plaintext OTP — only a commitment (HMAC)
// to it — so the token is safe to hand to the browser.
function createChallengeToken(email, otp) {
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const commitment = hmac(`${email.toLowerCase()}:${otp}:${expiresAt}`);
  return Buffer.from(`${email.toLowerCase()}:${expiresAt}:${commitment}`).toString('base64');
}

// Checks a user-entered OTP against a challenge token. Returns { email } on
// success, or null if wrong/expired/tampered.
function verifyChallengeToken(token, enteredOtp) {
  try {
    const [email, expiresAtStr, commitment] = Buffer.from(token, 'base64').toString('utf8').split(':');
    const expiresAt = Number(expiresAtStr);
    if (!email || !expiresAt || !commitment) return null;
    if (Date.now() > expiresAt) return null;

    const expectedCommitment = hmac(`${email}:${enteredOtp}:${expiresAt}`);
    if (!timingSafeEqual(expectedCommitment, commitment)) return null;

    return { email };
  } catch {
    return null;
  }
}

// ---- Verified token: "this email was confirmed, expiring at X" ----
// Carried from verify-otp to register.js so register.js can trust the email
// without re-checking anything about the OTP.
function createVerifiedToken(email) {
  const expiresAt = Date.now() + VERIFIED_TOKEN_TTL_MS;
  const payload = `verified:${email.toLowerCase()}:${expiresAt}`;
  const signature = hmac(payload);
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

function readVerifiedToken(token) {
  try {
    const [tag, email, expiresAtStr, signature] = Buffer.from(token, 'base64').toString('utf8').split(':');
    const expiresAt = Number(expiresAtStr);
    if (tag !== 'verified' || !email || !expiresAt || !signature) return null;
    if (Date.now() > expiresAt) return null;

    const expectedSignature = hmac(`${tag}:${email}:${expiresAt}`);
    if (!timingSafeEqual(expectedSignature, signature)) return null;

    return { email };
  } catch {
    return null;
  }
}

module.exports = {
  generateOtp,
  createChallengeToken,
  verifyChallengeToken,
  createVerifiedToken,
  readVerifiedToken,
};
