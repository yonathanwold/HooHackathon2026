const validator = require('validator');
const Event = require('../models/Event');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const CACHE_TTL_MS = 15 * 60 * 1000;
const bucketsCache = new Map();

function buildEventPrompt(event, asOfDate) {
  return [
    'You are a newsroom assistant that finds and labels sources for a breaking event.',
    'Use web search to find relevant sources and return ONLY valid JSON.',
    `As-of: ${asOfDate}.`,
    `Event: ${event.title}.`,
    event.description ? `Details: ${event.description}.` : '',
    `Category: ${event.category}. Region: ${event.region}. Timeframe: ${event.timeframe}.`,
    '',
    'Return JSON with this schema:',
    '{"summary":"2-4 sentences on what is confirmed vs disputed","sources":[{"title":"...","uri":"https://...","reliability":"reliable|contested|unreliable|unclear","bias":"left|center|right|unclear","notes":"short rationale","published_at":"YYYY-MM-DD or unknown"}]}',
    'Prefer 5-8 sources. If you cannot find enough, return what you have.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractJsonString(text) {
  if (!text) return null;
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) return fencedMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}

function safeParseJson(text) {
  if (!text) return null;
  const candidate = extractJsonString(text);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    return null;
  }
}

function getBucketsCacheKey(category, region, timeframe) {
  return [category || 'all', region || 'all', timeframe || '30d'].join('||').toLowerCase();
}

function getCachedBuckets(cacheKey) {
  const entry = bucketsCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    bucketsCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedBuckets(cacheKey, value) {
  bucketsCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function buildBucketsPrompt(category, region, timeframe, asOfDate) {
  const categoryLine = category && category !== 'all' ? `Category focus: ${category}.` : 'Category focus: all.';
  const regionLine = region && region !== 'all' ? `Region focus: ${region}.` : 'Region focus: global.';
  const timeLine = timeframe ? `Timeframe: ${timeframe}.` : 'Timeframe: last 7 days.';
  return [
    'You are a newsroom events editor. Use web search to list notable events.',
    'Return ONLY valid JSON.',
    `As-of: ${asOfDate}.`,
    categoryLine,
    regionLine,
    timeLine,
    '',
    'Schema:',
    '{"conflicts":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}],"releases":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}],"cyber":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}],"politics":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}],"business":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}],"science":[{"title":"...","sources":[{"title":"...","uri":"https://..."}]}]}',
    'Provide 2-4 items per bucket if possible.',
  ].join('\n');
}

function normalizeBucketItem(item) {
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  if (!title) return null;
  const sources = Array.isArray(item?.sources)
    ? item.sources
        .map((s) => {
          const uri = typeof s?.uri === 'string' ? s.uri.trim() : '';
          if (!uri || !validator.isURL(uri)) return null;
          return {
            title: typeof s?.title === 'string' && s.title.trim().length ? s.title.trim() : uri,
            uri,
          };
        })
        .filter(Boolean)
    : [];
  return { title, sources };
}

async function runGeminiEventSources(event) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('Missing GEMINI_API_KEY');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const asOfDate = new Date().toISOString().slice(0, 10);

  const body = {
    contents: [
      {
        parts: [{ text: buildEventPrompt(event, asOfDate) }],
      },
    ],
    tools: [{ google_search: {} }],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Gemini API error: ${response.status}`);
    error.code = 'GEMINI_API_ERROR';
    error.detail = text;
    throw error;
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((part) => part.text || '').join('').trim();
  const parsed = safeParseJson(text) || {};

  return {
    summary: parsed.summary || '',
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

function normalizeSource(raw) {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const uri = typeof raw.uri === 'string' ? raw.uri.trim() : '';
  const reliability = ['reliable', 'contested', 'unreliable', 'unclear'].includes(raw.reliability) ? raw.reliability : 'unclear';
  const bias = ['left', 'center', 'right', 'unclear'].includes(raw.bias) ? raw.bias : 'unclear';
  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
  const published_at = typeof raw.published_at === 'string' ? raw.published_at.trim() : 'unknown';

  if (!uri || !validator.isURL(uri)) return null;
  return { title: title || uri, uri, reliability, bias, notes, published_at };
}

exports.getEventDesk = async (req, res) => {
  const events = await Event.find().sort({ createdAt: -1 }).lean();
  const decodeIfEncoded = (value) => {
    if (typeof value !== 'string') return value;
    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return value;
      }
    }
    return value;
  };
  const sanitizedEvents = events.map((event) => ({
    ...event,
    title: decodeIfEncoded(event.title),
    description: decodeIfEncoded(event.description),
    timeframe: decodeIfEncoded(event.timeframe),
  }));
  const openEvents = sanitizedEvents.filter((event) => event.status !== 'resolved');
  const resolvedEvents = sanitizedEvents.filter((event) => event.status === 'resolved');
  res.render('tacitus', {
    title: 'Event Desk',
    siteURL: process.env.BASE_URL,
    events: openEvents,
    resolvedEvents,
    form: {
      title: '',
      description: '',
      category: 'conflict',
      region: 'global',
      timeframe: 'last 30 days',
    },
  });
};

exports.postEvent = async (req, res) => {
  const decodeIfEncoded = (value) => {
    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return value;
      }
    }
    return value;
  };

  let title = validator.trim(req.body.title || '');
  const description = validator.trim(req.body.description || '');
  const category = validator.trim(req.body.category || 'other');
  const region = validator.trim(req.body.region || 'global');
  let timeframe = validator.trim(req.body.timeframe || 'last 30 days');

  title = decodeIfEncoded(title);
  timeframe = decodeIfEncoded(timeframe);

  if (!title) {
    req.flash('errors', { msg: 'Please enter an event title.' });
    const events = await Event.find().sort({ createdAt: -1 }).lean();
    return res.render('tacitus', {
      title: 'Event Desk',
      siteURL: process.env.BASE_URL,
      events,
      form: { title, description, category, region, timeframe },
    });
  }

  const event = await Event.create({
    title,
    description,
    category,
    region,
    timeframe,
  });

  try {
    const results = await runGeminiEventSources(event);
    const sources = results.sources.map(normalizeSource).filter(Boolean);
    event.sources = sources;
    event.source_summary = results.summary;
    event.source_error = undefined;
    event.last_checked_at = new Date();
    await event.save();
  } catch (err) {
    event.source_error = err.message;
    await event.save();
    if (err.code === 'MISSING_API_KEY') {
      req.flash('errors', { msg: 'Missing GEMINI_API_KEY in .env. Add it and restart the server.' });
    } else if (err.code === 'GEMINI_API_ERROR') {
      req.flash('errors', { msg: 'Gemini rate limit or API error. Please try again shortly.' });
    } else {
      req.flash('errors', { msg: 'Unable to pull sources for this event. Please try again.' });
    }
  }

  return res.redirect('/tacitus');
};

exports.refreshEventSources = async (req, res) => {
  const eventId = req.params.id;
  const event = await Event.findById(eventId);
  if (!event) {
    req.flash('errors', { msg: 'Event not found.' });
    return res.redirect('/tacitus');
  }

  if (event.last_checked_at && Date.now() - new Date(event.last_checked_at).getTime() < CACHE_TTL_MS) {
    req.flash('info', { msg: 'Sources were refreshed recently. Please wait a few minutes before refreshing again.' });
    return res.redirect('/tacitus');
  }

  try {
    const results = await runGeminiEventSources(event);
    const sources = results.sources.map(normalizeSource).filter(Boolean);
    event.sources = sources;
    event.source_summary = results.summary;
    event.source_error = undefined;
    event.last_checked_at = new Date();
    await event.save();
  } catch (err) {
    event.source_error = err.message;
    await event.save();
    if (err.code === 'MISSING_API_KEY') {
      req.flash('errors', { msg: 'Missing GEMINI_API_KEY in .env. Add it and restart the server.' });
    } else if (err.code === 'GEMINI_API_ERROR') {
      req.flash('errors', { msg: 'Gemini rate limit or API error. Please try again shortly.' });
    } else {
      req.flash('errors', { msg: 'Unable to refresh sources for this event.' });
    }
  }

  return res.redirect('/tacitus');
};

exports.getEventBuckets = async (req, res) => {
  const category = validator.trim(req.query.category || 'all');
  const region = validator.trim(req.query.region || 'all');
  const timeframe = validator.trim(req.query.timeframe || '7d');
  const cacheKey = getBucketsCacheKey(category, region, timeframe);
  const cached = getCachedBuckets(cacheKey);
  if (cached) {
    return res.json({ ok: true, cached: true, data: cached });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'Missing GEMINI_API_KEY' });
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const asOfDate = new Date().toISOString().slice(0, 10);
    const body = {
      contents: [{ parts: [{ text: buildBucketsPrompt(category, region, timeframe, asOfDate) }] }],
      tools: [{ google_search: {} }],
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ ok: false, error: 'Gemini API error', detail: text });
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((part) => part.text || '').join('').trim();
    const parsed = safeParseJson(text) || {};

    const payload = {
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.map(normalizeBucketItem).filter(Boolean) : [],
      releases: Array.isArray(parsed.releases) ? parsed.releases.map(normalizeBucketItem).filter(Boolean) : [],
      cyber: Array.isArray(parsed.cyber) ? parsed.cyber.map(normalizeBucketItem).filter(Boolean) : [],
      politics: Array.isArray(parsed.politics) ? parsed.politics.map(normalizeBucketItem).filter(Boolean) : [],
      business: Array.isArray(parsed.business) ? parsed.business.map(normalizeBucketItem).filter(Boolean) : [],
      science: Array.isArray(parsed.science) ? parsed.science.map(normalizeBucketItem).filter(Boolean) : [],
    };

    setCachedBuckets(cacheKey, payload);
    return res.json({ ok: true, cached: false, data: payload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Unable to load event buckets.' });
  }
};

exports.deleteEvent = async (req, res) => {
  const eventId = req.params.id;
  await Event.findByIdAndDelete(eventId);
  req.flash('info', { msg: 'Event removed.' });
  return res.redirect('/tacitus');
};

exports.resolveEvent = async (req, res) => {
  const eventId = req.params.id;
  await Event.findByIdAndUpdate(eventId, { status: 'resolved' });
  req.flash('info', { msg: 'Event moved to archive.' });
  return res.redirect('/tacitus');
};

exports.reopenEvent = async (req, res) => {
  const eventId = req.params.id;
  await Event.findByIdAndUpdate(eventId, { status: 'open' });
  req.flash('info', { msg: 'Event reopened.' });
  return res.redirect('/tacitus');
};
