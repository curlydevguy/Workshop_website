# AI for Secure 6G: Foundations of FL, XAI, and LLMs — Website

Static site (Vercel) + Razorpay for payments + Google Sheets as the registration
database. This README is the setup order — follow it top to bottom.

## What's in here

```
index.html, details.html, register.html, schedule.html, contact.html, header.html
css/base.css              — all styling
js/main.js                — footer year, scroll reveals
js/include.js              — injects header.html into every page, mobile nav
js/registration.js         — register.html: fee calc + Razorpay checkout flow
api/register.js            — serverless fn: creates Razorpay order + pending Sheet row
api/verify.js               — serverless fn: verifies payment, marks Sheet row paid
google-apps-script/Code.gs  — paste into Apps Script; turns the Sheet into an API
package.json                — the one dependency (razorpay) for the serverless fns
.env.example                — env vars you need to set in Vercel
```

## 1. Google Sheet

1. Create a new Google Sheet. Rename a tab (or the default one) to `Registrations`.
2. In row 1, add these column headers, in this exact order:
   `id | fullName | email | phone | institute | category | amount | payment_status | razorpay_order_id | razorpay_payment_id | created_at`
3. Extensions → Apps Script. Delete the placeholder code, paste in
   `google-apps-script/Code.gs`.
4. Deploy → New deployment → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the deployment URL — that's your `APPS_SCRIPT_URL`.

## 2. Razorpay

1. Sign up at razorpay.com, grab your **test mode** Key ID and Key Secret first
   (Settings → API Keys) — switch to live keys only once you've tested end to end.

## 3. Fees

The fee per category lives in **two places** and must match:
- `api/register.js` → the `FEES` object (this is what's actually charged — never trust the browser)
- `register.html` → the `data-fee="..."` attribute on each `<option>` (this is just for the on-page display)

Current placeholder amounts: IITR student ₹500, other institute ₹1000, industry ₹2000.
`details.html`'s fee table mirrors these — update all three together if you change pricing.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo, then import it in Vercel (or run `vercel` from
   this folder with the Vercel CLI).
2. In the Vercel project → Settings → Environment Variables, add the three variables
   from `.env.example`:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `APPS_SCRIPT_URL`
3. Deploy. `api/register.js` and `api/verify.js` are picked up automatically as
   serverless functions at `/api/register` and `/api/verify`.

## 5. Test the flow

1. Open `/register.html`, fill the form, pick a category — the fee should appear.
2. Submit → Razorpay checkout opens. Use a
   [Razorpay test card](https://razorpay.com/docs/payments/payments/test-card-upi-details/)
   to pay.
3. Check the Google Sheet — you should see a row go from `pending` to `paid`, with
   the payment ID filled in.
4. Only once that works end-to-end, swap the test keys for live keys in Vercel.

## College ID proof upload

`register.html` now requires a photo/PDF of the registrant's college ID card
(roll number visible) before they can pay. It's uploaded to Google Drive via
the same service account already used for Sheets, and the resulting link is
logged in a new **ID Proof Link** column (column J) next to each row.

Setup:
1. Create a Drive folder for ID proofs, share it with your
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor**.
2. Copy the folder ID from its URL and add it in Vercel as
   `GOOGLE_DRIVE_FOLDER_ID`.
3. In the Sheet, add a header for column J: `id_proof_link`.

If this env var isn't set, registration still works — the upload is just
skipped and a warning is logged.

## Content still to fill in

The template still has a few `[bracketed placeholders]` for things only you know:
workshop dates, convener name(s) and contact details, department name, third
speaker bio, and the campus map image on `contact.html`. Search each page for `[`
to find them.
