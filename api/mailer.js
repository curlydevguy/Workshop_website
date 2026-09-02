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

// Sent from verify.js, only after a payment has actually been confirmed
// (never from register.js, since that just creates the order — the person
// may still abandon the Razorpay popup at that point).
//
// details: { fullName, category, amount, paymentId }
async function sendConfirmationEmail(toEmail, details) {
  const { fullName, category, amount, paymentId } = details || {};

  const categoryLabels = {
    iitr_student: 'IIT Roorkee Student',
    other_student: 'Student (Other Institute)',
    industry: 'Industry / Professional',
  };
  const categoryLabel = categoryLabels[category] || category || '';

  await transporter.sendMail({
    from: `"AI for Secure 6G Workshop" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Registration Confirmed — AI for Secure 6G Workshop',
    text:
      `Hi ${fullName || 'there'},\n\n` +
      `Your registration for the AI for Secure 6G Workshop is confirmed.\n\n` +
      `Category: ${categoryLabel}\n` +
      `Amount paid: ₹${amount}\n` +
      `Payment ID: ${paymentId}\n\n` +
      `We'll send any further updates about the workshop to this email address, ` +
      `so please keep an eye on this inbox (and check spam, just in case).\n\n` +
      `See you at the workshop!`,
    html:
      `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #1a1a1a;">` +
      `<p>Hi ${fullName || 'there'},</p>` +
      `<p>Your registration for the <strong>AI for Secure 6G Workshop</strong> is confirmed.</p>` +
      `<table style="margin: 16px 0; border-collapse: collapse;">` +
      `<tr><td style="padding: 4px 12px 4px 0; color: #666;">Category</td><td style="padding: 4px 0;">${categoryLabel}</td></tr>` +
      `<tr><td style="padding: 4px 12px 4px 0; color: #666;">Amount paid</td><td style="padding: 4px 0;">₹${amount}</td></tr>` +
      `<tr><td style="padding: 4px 12px 4px 0; color: #666;">Payment ID</td><td style="padding: 4px 0;">${paymentId}</td></tr>` +
      `</table>` +
      `<p style="color: #666;">We'll send any further updates about the workshop to this email address, ` +
      `so please keep an eye on this inbox (and check spam, just in case).</p>` +
      `<p>See you at the workshop!</p>` +
      `</div>`,
  });
}

module.exports = { sendOtpEmail, sendConfirmationEmail };
