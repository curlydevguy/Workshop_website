// POST /api/check-id-proof
// Body: { imageBase64, mimeType }
// Sends the uploaded ID photo to Claude (vision) to check whether it looks
// like a genuine college/institute ID card with a visible name and roll
// number. This is ADVISORY ONLY — nothing here blocks registration. The
// result is just shown to the user as a status hint and logged to the
// sheet (see register.js) so it can be spot-checked manually.
//
// Requires ANTHROPIC_API_KEY as a Vercel environment variable. If it's not
// set, this fails open — everyone can still register, they just won't see
// an automatic check result.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001'; // cheapest vision-capable model — plenty for this

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { imageBase64, mimeType } = req.body || {};

    if (!imageBase64) {
      res.status(400).json({ error: 'No image provided.' });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(200).json({ isValidId: null, reason: 'Automatic ID check is not configured yet.' });
      return;
    }

    // Frontend sends a full data: URL (e.g. "data:image/jpeg;base64,...") —
    // the API only wants the raw base64 payload after the comma.
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const effectiveMime = mimeType || 'image/jpeg';
    const isPdf = effectiveMime === 'application/pdf';

    // PDFs go in as a "document" block, images as an "image" block — same
    // API, different content type.
    const fileBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
      : { type: 'image', source: { type: 'base64', media_type: effectiveMime, data: base64Data } };

    const prompt =
      'Does this image clearly show a college/institute ID card with a visible ' +
      'name and roll number / ID number? Reply with EXACTLY one line, nothing ' +
      'else, in this format: "YES - <very short reason>" or "NO - <very short reason>".';

    const apiRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [fileBlock, { type: 'text', text: prompt }],
          },
        ],
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Anthropic API error:', data);
      // Fail open — a broken check should never block registration.
      res.status(200).json({ isValidId: null, reason: 'Could not run the automatic check right now.' });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    const raw = ((textBlock && textBlock.text) || '').trim();
    const isValidId = /^YES/i.test(raw);
    const reason = raw.replace(/^(YES|NO)\s*-\s*/i, '').trim() || raw || 'No reason given.';

    res.status(200).json({ isValidId, reason });
  } catch (err) {
    console.error('check-id-proof.js error:', err);
    res.status(200).json({ isValidId: null, reason: 'Could not run the automatic check right now.' });
  }
};
