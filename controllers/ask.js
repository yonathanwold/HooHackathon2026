const validator = require('validator');

const DEFAULT_MODEL = 'gemini-2.5-flash';

function buildAskPrompt(prompt) {
  return [
    'You are Tacitus, a credibility analyst for casual journalists.',
    'Answer in 2-4 complete sentences. Do not cut off mid-sentence.',
    'Include: (1) credibility or contradiction signal, (2) brief rationale, (3) one concrete next step.',
    'Keep it neutral and avoid sensational language.',
    '',
    `User question: ${prompt}`,
  ].join('\n');
}

function normalizeReply(text) {
  if (!text) return text;
  const trimmed = text.trim();
  const lastPunct = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
  if (lastPunct >= 0 && lastPunct < trimmed.length - 1) {
    return trimmed.slice(0, lastPunct + 1).trim();
  }
  if (!/[.!?]$/.test(trimmed)) return `${trimmed}.`;
  return trimmed;
}

exports.postAsk = async (req, res) => {
  const prompt = validator.trim(req.body.prompt || '');
  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'Prompt is required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Missing GEMINI_API_KEY.' });
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildAskPrompt(prompt) }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 520,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ ok: false, error: text || 'Gemini error.' });
    }

    const data = await response.json();
    const replyRaw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const reply = normalizeReply(replyRaw || '');
    if (!reply) {
      return res.status(502).json({ ok: false, error: 'No response from Gemini.' });
    }

    return res.json({ ok: true, reply });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Unable to reach Gemini.' });
  }
};
