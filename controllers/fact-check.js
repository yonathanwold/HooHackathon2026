const validator = require('validator');
const cheerio = require('cheerio');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEFRAME = 'last 12 months';
const CACHE_TTL_MS = 15 * 60 * 1000;
const factCheckCache = new Map();

function getCacheKey(author, focus, timeframe, seedSources, articleSource, articleDate, publicationName, articleText) {
  const sources = Array.isArray(seedSources) ? seedSources.join('\n') : '';
  return [author, focus, timeframe, sources, articleSource, articleDate, publicationName, articleText]
    .join('||')
    .toLowerCase();
}

function getCachedResult(cacheKey) {
  const entry = factCheckCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    factCheckCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedResult(cacheKey, value) {
  factCheckCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function buildPrompt(author, focus, timeframe, asOfDate, seedSources, articleSource, articleDate, publicationName, articleText) {
  const focusLine = focus ? `Focus: ${focus}` : 'Focus: general reliability and consistency.';
  const timeframeLine = `Timeframe: ${timeframe || DEFAULT_TIMEFRAME}.`;
  const recencyLine = `As-of: ${asOfDate}.`;
  const sourceLine =
    seedSources && seedSources.length ? `Seed sources: ${seedSources.join(' ')}` : 'Use web search; cite sources.';
  const articleMeta = [
    `SOURCE: ${articleSource || 'unknown'}`,
    `DATE: ${articleDate || 'unknown'}`,
    `PUBLICATION: ${publicationName || 'unknown'}`,
  ].join('\n');
  return [
    'Fact-check the author: contradictions + reliability. Use recent sources; include citations. If sources are sparse, say so in freshness_notes.',
    '',
    'You are an expert literary and media analyst. When given an article, your job is NOT to summarize the surface content — your job is to decode the AUTHOR\'S INTENT.',
    'Follow this analysis framework precisely:',
    '1. AUTHORIAL STANCE: identify agree/disagree/critique/praise/neutral; include 1–2 quoted lines; provide one-sentence stance.',
    '2. TONE & FRAMING: emotional tone; framing; list loaded language.',
    '3. BIAS DETECTION: ideological/cultural/institutional bias; missing voices; fairness to counterarguments.',
    '4. WHAT THE AUTHOR WANTS YOU TO BELIEVE: core argument; persuasion methods; call to action.',
    '5. WHAT THE AUTHOR LEAVES OUT: missing facts; vague sourcing; skeptical questions.',
    '6. FINAL VERDICT: 3–5 sentences on stance, bias/agenda, and trust vs verify.',
    '',
    'Use this fixed credibility score formula (do not change it):',
    'Score = clamp(50 + 15*SourceReliability + 12*EvidenceDiversity + 10*Transparency + 8*Consistency + 5*Recency - 12*ContradictionPenalty - 8*BiasRisk, 0, 100)',
    'Each sub-score is normalized to -1..+1, except penalties (0..1).',
    'Use these exact mappings:',
    'SourceReliability: reliable=+1, contested=-0.3, unclear=0, unreliable=-1 (average across sources).',
    'EvidenceDiversity: 1 source=-0.6, 2 sources=-0.2, 3-4 sources=+0.3, 5+ sources=+0.8.',
    'Transparency: no citations=-0.6, some citations=+0.2, clear citations + reasoning=+0.8.',
    'Consistency: major conflicts=-0.7, mixed/unclear=-0.1, mostly aligned=+0.5, strong alignment=+0.9.',
    'Recency: stale (>12 months)=-0.5, mixed=0, recent (<3 months)=+0.5, very recent (<30 days)=+0.8.',
    'ContradictionPenalty: none=0, minor=0.3, multiple=0.7, severe=1.0.',
    'BiasRisk: unclear=0.1, mild lean=0.3, strong lean with one-sided sourcing=0.8.',
    'Round reliability_score to the nearest whole number.',
    'Keyword rules: Do NOT treat proper nouns (people, places, organizations) as ideology keywords. Only include ideological terms when used in a political/ideological context (e.g., "progressive policy", "conservative platform"). If context is ambiguous, leave it out or place it in general keywords instead of left/center/right.',
    'Context rule: Only include a term in left/center/right keywords when the author’s stance aligns with or endorses that idea. If the author is criticizing, distancing, or quoting opponents, do NOT classify it as a leaning keyword.',
    '',
    `Author: ${author}.`,
    focusLine,
    timeframeLine,
    recencyLine,
    sourceLine,
    '',
    'Analyze the following article using the framework above:',
    articleMeta,
    '',
    'ARTICLE:',
    articleText || 'No article text provided. Explain what is missing and proceed with available sources.',
    '',
    'Return ONLY valid JSON with this schema (minify if possible):',
    '{"as_of":"YYYY-MM-DD","summary":"2-4 sentences","reliability_score":0,"reliability_notes":"...","freshness_notes":"...","leaning":"left|center|right|unclear","leaning_notes":"...","ideology_signals":{"dominant":"left|center|right|unclear","keywords":["..."],"keywords_by_leaning":{"left":["..."],"center":["..."],"right":["..."]},"tone":"...","past_bias":"...","model_crossref":"...","confidence":0},"intent_analysis":{"stance":"agree|disagree|critique|praise|neutral","stance_statement":"The author ...","stance_quotes":["...","..."],"tone":"...","framing":"...","loaded_language":["..."],"bias":"...","missing_voices":"...","counterarguments":"...","author_goal":"...","persuasion_methods":["facts","emotion","authority","anecdote"],"call_to_action":"...","omissions":"...","skeptical_questions":["..."],"final_verdict":"3-5 sentences"},"contradictions":[{"topic":"...","statement_a":"...","statement_b":"...","dates":"...","sources":["https://..."]}],"notable_consistency":[{"topic":"...","summary":"...","dates":"...","sources":["https://..."]}]}',
    'If no contradictions, return an empty array.',
  ].join('\n');
}

function collectParsedSources(parsed) {
  if (!parsed) return [];
  const urls = new Set();
  const sections = [];
  if (Array.isArray(parsed.contradictions)) sections.push(...parsed.contradictions);
  if (Array.isArray(parsed.notable_consistency)) sections.push(...parsed.notable_consistency);
  sections.forEach((item) => {
    if (item && Array.isArray(item.sources)) {
      item.sources.forEach((source) => {
        if (typeof source === 'string' && validator.isURL(source)) {
          urls.add(source);
        }
      });
    }
  });
  return Array.from(urls).map((uri) => ({
    title: uri,
    uri,
  }));
}

function normalizeSourceUrl(uri, title, fallbackQuery) {
  if (!uri) return null;
  const isRedirect = uri.includes('vertexaisearch.cloud.google.com/grounding-api-redirect');
  if (!isRedirect) return uri;
  const query = title || fallbackQuery || 'news source';
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function fetchArticleText(url) {
  if (!url || !validator.isURL(url)) return '';
  const response = await fetch(url, { headers: { 'User-Agent': 'Tacitus/1.0 (+https://localhost)' } });
  if (!response.ok) return '';
  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, header, footer, nav, aside').remove();
  const main = $('article').first().text() || $('main').first().text() || $('body').text();
  return main.replace(/\s+/g, ' ').trim().slice(0, 12000);
}

function sanitizeIdeologySignals(ideologySignals) {
  if (!ideologySignals || typeof ideologySignals !== 'object') return ideologySignals;
  const stripProperNouns = (list) =>
    Array.isArray(list)
      ? list.filter((item) => {
          if (typeof item !== 'string') return false;
          const trimmed = item.trim();
          if (!trimmed) return false;
          // Drop likely proper nouns: capitalized words or multi-word names.
          const words = trimmed.split(/\s+/);
          if (words.length > 1 && words.every((w) => /^[A-Z][a-z]/.test(w))) return false;
          if (/^[A-Z][a-z]+$/.test(trimmed)) return false;
          return true;
        })
      : [];

  const keywords = stripProperNouns(ideologySignals.keywords);
  const byLeaning = ideologySignals.keywords_by_leaning || {};
  const left = stripProperNouns(byLeaning.left);
  const center = stripProperNouns(byLeaning.center);
  const right = stripProperNouns(byLeaning.right);

  return {
    ...ideologySignals,
    keywords,
    keywords_by_leaning: {
      left,
      center,
      right,
    },
  };
}

function extractJsonString(text) {
  if (!text) return null;
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }
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

async function runGeminiFactCheck(author, focus, timeframe, seedSources, articleSource, articleDate, publicationName, articleText) {
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
        parts: [{ text: buildPrompt(author, focus, timeframe, asOfDate, seedSources, articleSource, articleDate, publicationName, articleText) }],
      },
    ],
    tools: [
      {
        google_search: {},
      },
    ],
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
  const parsed = safeParseJson(text);
  const grounding = candidate?.groundingMetadata || {};
  const fallbackQuery = `${author} ${focus || 'coverage'} ${timeframe || DEFAULT_TIMEFRAME}`;
  const groundingSources =
    grounding?.groundingChunks
      ?.map((chunk, index) => {
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title || uri;
        const normalizedUri = normalizeSourceUrl(uri, title, fallbackQuery);
        if (!normalizedUri || !validator.isURL(normalizedUri)) return null;
        return {
          index: index + 1,
          title,
          uri: normalizedUri,
        };
      })
      .filter(Boolean) || [];
  const parsedSources = collectParsedSources(parsed)
    .map((source) => {
      const normalizedUri = normalizeSourceUrl(source.uri, source.title, fallbackQuery);
      if (!normalizedUri || !validator.isURL(normalizedUri)) return null;
      return { ...source, uri: normalizedUri };
    })
    .filter(Boolean);
  const sources = groundingSources.length ? groundingSources : parsedSources;

  return {
    rawText: text,
    parsed,
    sources,
    webSearchQueries: grounding?.webSearchQueries || [],
    seedSources,
  };
}

/**
 * GET /fact-check
 */
exports.getFactCheck = (req, res) => {
  res.render('fact-check', {
    title: 'Author Fact Check',
    form: {
      author: '',
      focus: '',
      timeframe: DEFAULT_TIMEFRAME,
      seedSources: '',
      articleSource: '',
      articleDate: '',
      publicationName: '',
      articleText: '',
    },
    results: null,
  });
};

/**
 * POST /fact-check
 */
exports.postFactCheck = async (req, res, next) => {
  const author = validator.trim(req.body.author || '');
  const focus = validator.trim(req.body.focus || '');
  const timeframe = validator.trim(req.body.timeframe || DEFAULT_TIMEFRAME);
  const seedSourcesRaw = validator.trim(req.body.seedSources || '');
  const articleSource = validator.trim(req.body.articleSource || '');
  const articleDate = validator.trim(req.body.articleDate || '');
  const publicationName = validator.trim(req.body.publicationName || '');
  let articleText = validator.trim(req.body.articleText || '');
  const seedSources = seedSourcesRaw
    .split(/\s+/)
    .map((source) => source.trim())
    .filter((source) => validator.isURL(source));

  if (!author) {
    req.flash('errors', { msg: 'Please enter the author you want to fact-check.' });
    return res.render('fact-check', {
      title: 'Author Fact Check',
      form: { author, focus, timeframe, seedSources: seedSourcesRaw, articleSource, articleDate, publicationName, articleText },
      results: null,
    });
  }

  try {
    if (!articleText && articleSource) {
      articleText = await fetchArticleText(articleSource);
      if (!articleText) {
        req.flash('errors', { msg: 'Unable to fetch article text. Using web sources only.' });
      }
    }

    const cacheKey = getCacheKey(author, focus, timeframe, seedSources, articleSource, articleDate, publicationName, articleText);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      const results = JSON.parse(JSON.stringify(cached));
      if (results?.parsed) {
        const note = `Cached result (last updated ${new Date(results.cached_at).toISOString()}).`;
        results.parsed.freshness_notes = results.parsed.freshness_notes
          ? `${results.parsed.freshness_notes} ${note}`
          : note;
      }
      return res.render('fact-check', {
        title: 'Author Fact Check',
        form: { author, focus, timeframe, seedSources: seedSourcesRaw, articleSource, articleDate, publicationName, articleText },
        results,
      });
    }

    const results = await runGeminiFactCheck(author, focus, timeframe, seedSources, articleSource, articleDate, publicationName, articleText);
    if (results?.parsed?.ideology_signals) {
      results.parsed.ideology_signals = sanitizeIdeologySignals(results.parsed.ideology_signals);
    }
    results.cached_at = new Date().toISOString();
    setCachedResult(cacheKey, results);
    return res.render('fact-check', {
      title: 'Author Fact Check',
      form: { author, focus, timeframe, seedSources: seedSourcesRaw, articleSource, articleDate, publicationName, articleText },
      results,
    });
  } catch (err) {
    console.error('Fact check error:', err);
    if (err.code === 'MISSING_API_KEY') {
      req.flash('errors', { msg: 'Missing GEMINI_API_KEY in .env. Add it and restart the server.' });
    } else {
      req.flash('errors', { msg: 'Something went wrong while running the fact check. Please try again.' });
    }
    return res.render('fact-check', {
      title: 'Author Fact Check',
      form: { author, focus, timeframe, seedSources: seedSourcesRaw, articleSource, articleDate, publicationName, articleText },
      results: null,
      errorMessage: err.message,
      errorDetail: process.env.NODE_ENV === 'production' ? null : err.detail,
    });
  }
};
