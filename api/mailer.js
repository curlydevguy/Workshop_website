// api/mailer.js
// Sends the OTP email via Gmail SMTP using Nodemailer.
//
// Required env vars (set in Vercel):
//   GMAIL_USER          — the Gmail address sending the OTPs, e.g. aisecure6g.workshop@gmail.com
//   GMAIL_APP_PASSWORD  — a 16-character App Password generated for that account
//                          (Google Account > Security > 2-Step Verification > App Passwords)
//
// Note: this requires 2-Step Verification to be turned on for the Gmail
// account, since that's what unlocks App Passwords in the first place.

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendOtpEmail(toEmail, otp) {
  await transporter.sendMail({
    from: `"AI for Secure 6G Workshop" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Your verification code — AI for Secure 6G Workshop',
    text:
      `Your verification code is: ${otp}\n\n` +
      `This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html:
      `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1a1a1a;">` +
      `<p>Your verification code for the <strong>AI for Secure 6G</strong> workshop registration is:</p>` +
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 16px 0;">${otp}</p>` +
      `<p style="color: #666;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>` +
      `</div>`,
  });
}

module.exports = { sendOtpEmail };
