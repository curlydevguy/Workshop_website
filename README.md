# AI for Secure 6G: Foundations of FL, XAI, and LLMs — Website

Modern, high-performance static website for the SPARC-sponsored Indo-International Workshop at IIT Roorkee (20–24 December 2026). Deployed on Vercel with Google Sheets service account integration for registrations, SBI Collect for payments, and Google Drive upload proxy for payment receipts.

## Architecture

```
index.html, details.html, register.html, schedule.html, contact.html, payment-guide.html, poster.html
css/base.css          — Core styles with CSS variables and responsive layout
js/main.js            — Smooth scrolling, intersection observers, instant prefetching
js/include.js         — Navigation setup and responsive mobile drawer
js/registration.js    — Registration flow: fee calculation, state persistence, payment proof submission
api/register.js       — Serverless endpoint: validates and writes participant row to Google Sheets
api/submit-payment.js — Serverless endpoint: uploads receipt to Google Drive & updates Sheet with UTR
api/sheets.js         — Google Sheets service account API helper with dynamic column header detection
api/drive.js          — Google Apps Script proxy helper for uploading payment screenshots to Drive
vercel.json           — Clean URLs, trailing slash handling, and asset caching headers
server.js             — Local development server with clean URL support and mock API endpoints
```

## Setup & Environment Variables

Configure these environment variables in your Vercel Project Settings:

1. **Google Sheets Service Account**:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: The service account email (e.g. `service-account@project.iam.gserviceaccount.com`).
   - `GOOGLE_PRIVATE_KEY`: The RSA private key from your service account JSON credentials (`-----BEGIN PRIVATE KEY...`).
   - `GOOGLE_SHEET_ID`: The ID of your Google Sheet (from its URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`).

2. **Google Apps Script Upload Proxy**:
   - `APPS_SCRIPT_URL`: Deployed Apps Script Web App URL ending in `/exec`.
   - `APPS_SCRIPT_SECRET`: Shared secret string matching the constant in Apps Script.
   - `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`: Google Drive folder ID where payment screenshots are stored.

## Google Sheet Headers

The `Registrations` sheet headers (Row 1):
`Timestamp | Name | Email | Phone | Institution | Category | Amount | Payment Reference | Status | Stay Dates | Notes | AI Check | Payment Screenshot Link`

`api/sheets.js` dynamically inspects row 1 headers to match columns automatically (`email`, `status`, `reference`, `screenshot`), with robust fallbacks.

## Running Locally

```bash
node server.js
```
Opens the site at `http://localhost:3000/` with clean URLs and mock registration/payment endpoints.
