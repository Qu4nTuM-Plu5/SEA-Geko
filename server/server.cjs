/*
  Nexus AI - minimal fullstack server (no external deps)
  - Serves the Vite build (dist/) in production
  - Provides /api/* endpoints that route to multiple LLM providers with fallback

  Env:
    PORT=8787

    GEMINI_API_KEY=
    GEMINI_MODELS=gemini-3-flash-preview,gemini-1.5-flash,gemini-1.5-pro

    OPENAI_API_KEY=
    OPENAI_MODELS=gpt-4o-mini,gpt-4.1-mini

    ANTHROPIC_API_KEY=
    ANTHROPIC_MODELS=claude-3-5-sonnet-latest,claude-3-5-haiku-latest

    OPENROUTER_API_KEY=
    OPENROUTER_MODELS=google/gemini-2.0-flash-001,openai/gpt-4o-mini,anthropic/claude-3.5-sonnet

    AI_PROVIDER_CANDIDATES=gemini,openrouter,openai,anthropic

    YOUTUBE_API_KEY=  (optional)
*/

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env from project root for local development (Windows-friendly)
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
} catch {
  // dotenv optional
}

const PORT = Number(process.env.PORT || 8787);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE_DIR = path.join(__dirname, '.cache');
const APP_DATA_DIR = path.join(__dirname, '.data');
const APP_DB_PATH = path.join(APP_DATA_DIR, 'app-db.json');
const MEM_CACHE = new Map();
let DISK_CACHE_ENABLED = true;
const MODULE_VIDEO_REGISTRY = new Map();
const VIDEO_REGISTRY_TTL_MS = 12 * 60 * 60 * 1000;

try {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  DISK_CACHE_ENABLED = false;
}

function defaultAppDb() {
  return {
    profiles: [],
    pretests: [],
    posttests: [],
    confidence: [],
    events: [],
    publicPosts: [],
    reactions: [],
    comments: [],
    reports: [],
    cohorts: [],
    cohortMembers: [],
  };
}

function loadAppDb() {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    if (!fs.existsSync(APP_DB_PATH)) {
      const initial = defaultAppDb();
      fs.writeFileSync(APP_DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(APP_DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultAppDb(), ...(parsed || {}) };
  } catch {
    return defaultAppDb();
  }
}

function saveAppDb(db) {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(APP_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch {
    // ignore persistence errors
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ------------------------ utils ------------------------

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(data);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

function cacheGet(key, ttlMs) {
  if (!DISK_CACHE_ENABLED) {
    const entry = MEM_CACHE.get(key);
    if (!entry) return null;
    if (ttlMs && Date.now() - entry.at > ttlMs) {
      MEM_CACHE.delete(key);
      return null;
    }
    return entry.value;
  }
  try {
    const p = cachePath(key);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    if (ttlMs && Date.now() - stat.mtimeMs > ttlMs) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  if (!DISK_CACHE_ENABLED) {
    MEM_CACHE.set(key, { at: Date.now(), value });
    return;
  }
  try {
    fs.writeFileSync(cachePath(key), JSON.stringify(value), 'utf8');
  } catch {
    // ignore
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeProfileContext(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const connectivityLevel = ['offline_first', 'low_bandwidth', 'normal'].includes(String(p.connectivityLevel))
    ? String(p.connectivityLevel)
    : 'normal';
  const userSegment = ['youth', 'educator', 'displaced', 'community_org'].includes(String(p.userSegment))
    ? String(p.userSegment)
    : 'youth';
  const preferredLanguage = String(p.preferredLanguage || 'en').toLowerCase();
  return {
    userSegment,
    connectivityLevel,
    preferredLanguage,
    learningGoal: String(p.learningGoal || ''),
    region: String(p.region || 'ASEAN'),
    lowBandwidthMode: !!p.lowBandwidthMode || connectivityLevel !== 'normal',
  };
}

function profileRulesText(profileContext = {}) {
  const p = normalizeProfileContext(profileContext);
  const lines = [
    `- Audience segment: ${p.userSegment}`,
    `- Connectivity level: ${p.connectivityLevel}`,
    `- Output language code: ${p.preferredLanguage}`,
    `- Region: ${p.region}`,
  ];

  if (p.userSegment === 'educator') {
    lines.push('- Add short facilitation tips and practical classroom/community guidance.');
  }
  if (p.userSegment === 'community_org') {
    lines.push('- Include practical checkpoints and community-facing action items.');
  }
  if (p.userSegment === 'displaced') {
    lines.push('- Keep trauma-aware, clear, and low-friction language; avoid heavy assumptions about stable internet access.');
  }
  if (p.lowBandwidthMode) {
    lines.push('- Prefer text-first explanations and lightweight activities. Minimize video dependency.');
  }

  return lines.join('\n');
}

function safePercent(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

const PROGRAMMING_TOPIC_PATTERN = /\b(python|javascript|typescript|java|c\+\+|c#|ruby|php|swift|kotlin|golang|go|rust|sql|html|css|react|node|node\.js|django|flask|spring|programming|coding|developer|software|frontend|backend|fullstack|web app|mobile app|algorithm|data structure|devops|api|database|computer science|cybersecurity|machine learning|deep learning|artificial intelligence)\b/i;

function isProgrammingTopic(...texts) {
  return texts.some((text) => PROGRAMMING_TOPIC_PATTERN.test(String(text || '').toLowerCase()));
}

function moduleVideoKey(courseTitle, moduleTitle) {
  return `${String(courseTitle || '').trim().toLowerCase()}::${String(moduleTitle || '').trim().toLowerCase()}`;
}

function getUsedVideoIds(key) {
  const now = Date.now();
  for (const [k, entry] of MODULE_VIDEO_REGISTRY.entries()) {
    if (!entry || (now - Number(entry.at || 0)) > VIDEO_REGISTRY_TTL_MS) {
      MODULE_VIDEO_REGISTRY.delete(k);
    }
  }
  const entry = MODULE_VIDEO_REGISTRY.get(key);
  if (!entry || !Array.isArray(entry.ids)) return [];
  return entry.ids;
}

function rememberVideoIdForModule(key, id) {
  const clean = normalizeYoutubeVideoId(id);
  if (!clean) return;
  const entry = MODULE_VIDEO_REGISTRY.get(key);
  const ids = entry && Array.isArray(entry.ids) ? entry.ids.slice() : [];
  if (!ids.includes(clean)) ids.push(clean);
  MODULE_VIDEO_REGISTRY.set(key, { ids: ids.slice(-20), at: Date.now() });
}

function isRetriableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

function extractJson(text) {
  if (!text) throw new Error('Empty model response');
  try {
    return JSON.parse(text);
  } catch {
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
    if (start === -1) throw new Error('Model did not return JSON');

    const endObj = text.lastIndexOf('}');
    const endArr = text.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (end <= start) throw new Error('Invalid JSON boundaries');

    const slice = text.slice(start, end + 1);
    return JSON.parse(slice);
  }
}

function normalizeLessonPlan(raw, topicContext = '') {
  const programmingTrack = isProgrammingTopic(topicContext);
  const defaults = programmingTrack
    ? [
        { title: 'Introduction', type: 'TEXT' },
        { title: 'Core Concepts', type: 'ACCORDION' },
        { title: 'Flashcards', type: 'FLIP_CARD' },
        { title: 'Deep Dive Video', type: 'VIDEO' },
        { title: 'Practice Challenge', type: 'CODE_BUILDER' },
        { title: 'Applied Challenge', type: 'DRAG_FILL' },
        { title: 'Final Module Assessment', type: 'QUIZ' },
      ]
    : [
        { title: 'Introduction', type: 'TEXT' },
        { title: 'Core Concepts', type: 'ACCORDION' },
        { title: 'Flashcards', type: 'FLIP_CARD' },
        { title: 'Deep Dive Video', type: 'VIDEO' },
        { title: 'Concept Breakdown', type: 'ACCORDION' },
        { title: 'Applied Challenge', type: 'DRAG_FILL' },
        { title: 'Final Module Assessment', type: 'QUIZ' },
      ];

  const arr = Array.isArray(raw) ? raw.slice(0, 7) : [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const r = arr[i] || {};
    const forcedType = i === 0
      ? 'TEXT'
      : i === 2
      ? 'FLIP_CARD'
      : i === 3
      ? 'VIDEO'
      : i === 4
      ? (programmingTrack ? 'CODE_BUILDER' : 'ACCORDION')
      : i === 5
      ? 'DRAG_FILL'
      : i === 6
      ? 'QUIZ'
      : null;
    const requestedType = forcedType || r.type || defaults[i].type;
    const type = !programmingTrack && String(requestedType).toUpperCase() === 'CODE_BUILDER'
      ? 'DRAG_FILL'
      : requestedType;
    const title = r.title || defaults[i].title;
    const id = r.id || `step-${i + 1}`;
    out.push({ id, title, type });
  }
  return out;
}

function normalizeYoutubeVideoId(candidate) {
  const raw = String(candidate || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(raw)) return '';
  const lower = raw.toLowerCase();
  if (lower === 'video_id') return '';
  if (lower.includes('example') || lower.includes('sample') || lower.includes('placeholder')) return '';
  if (/^[-_x]{6,}$/i.test(raw)) return '';
  return raw;
}

function extractYoutubeVideoId(input) {
  if (!input) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  const direct = normalizeYoutubeVideoId(raw);
  if (direct) return direct;
  try {
    const u = new URL(raw);
    if (u.hostname.includes('youtu.be')) return normalizeYoutubeVideoId(u.pathname.replace('/', '').slice(0, 11));
    const watchId = u.searchParams.get('v');
    if (watchId) return normalizeYoutubeVideoId(String(watchId).split(/[?&#]/)[0].slice(0, 11));
    const parts = u.pathname.split('/').filter(Boolean);
    const pivot = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v');
    if (pivot !== -1 && parts[pivot + 1]) return normalizeYoutubeVideoId(parts[pivot + 1].slice(0, 11));
  } catch {
    return '';
  }
  return '';
}

function parseCorrectAnswers(raw, blankCount) {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean).slice(0, blankCount);
  }
  const text = String(raw || '').trim();
  if (!text) return [];
  const pieces = text.split(/[,\n;|]/g).map((v) => v.trim()).filter(Boolean);
  if (blankCount <= 1) return pieces.length ? [pieces[0]] : [];
  return pieces.slice(0, blankCount);
}

function isPlaceholderToken(token) {
  const t = String(token || '').trim().toLowerCase();
  return (
    !t ||
    /^answer\s*\d+$/.test(t) ||
    /^blank\s*\d+$/.test(t) ||
    /^option\s*[a-z0-9]+$/.test(t) ||
    /^[a-d]$/.test(t)
  );
}

function extractMeaningfulTokens(text, limit = 10) {
  const stopWords = new Set([
    'the', 'and', 'with', 'from', 'that', 'this', 'your', 'into', 'about', 'using',
    'each', 'left', 'right', 'blank', 'blanks', 'step', 'lesson', 'module', 'course',
    'is', 'are', 'to', 'for', 'of', 'in', 'on', 'a', 'an', 'by', 'or', 'as', 'be'
  ]);
  const words = String(text || '')
    .replace(/[_`*#()[\]{}<>.,;:!?/\\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && /[a-z]/i.test(w))
    .filter((w) => !stopWords.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return Array.from(new Set(words)).slice(0, limit);
}

function limitTemplateBlanks(template, keep, fillFrom) {
  let seen = 0;
  return String(template || '').replace(/___/g, () => {
    seen += 1;
    if (seen <= keep) return '___';
    const replacement = fillFrom[seen - 1] || fillFrom[fillFrom.length - 1] || 'term';
    return replacement;
  });
}

function normalizeTemplateBlanks(template) {
  const raw = String(template || '').trim();
  if (!raw) return '';
  const numberedBlankCount = (raw.match(/__+\s*\d+\s*__+/g) || []).length;
  const explicitTripleCount = (raw.match(/___/g) || []).length;
  let out = raw
    .replace(/__+\s*\d+\s*__+/g, '___')
    .replace(/\[\s*blank\s*\d+\s*\]/gi, '___')
    .replace(/\(\s*blank\s*\d+\s*\)/gi, '___')
    .replace(/\{\{\s*blank\s*\d+\s*\}\}/gi, '___')
    .replace(/_{4,}/g, '___');

  if (numberedBlankCount >= 2 && explicitTripleCount === 1 && /\s___\s*$/.test(out)) {
    out = out.replace(/\s*___\s*$/, '');
  }
  return out;
}

function countTemplateBlanks(template) {
  return (String(template || '').match(/___/g) || []).length;
}

function isPlaceholderQuizQuestion(question) {
  const q = String(question || '').trim().toLowerCase();
  return (
    !q ||
    /^quick\s*check\s*:?\s*which\s*statement\s*is\s*true\??$/.test(q) ||
    /^question\s*\d*$/.test(q)
  );
}

function isPlaceholderQuizOption(option) {
  const o = String(option || '').trim().toLowerCase();
  return !o || /^[a-d]$/.test(o) || /^option\s*[a-d0-9]+$/.test(o);
}

function normalizeFlashcardKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#()[\]{}<>.,;:!?/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFlashcardKeysFromReference(referenceContext) {
  const keys = new Set();
  const text = String(referenceContext || '');
  if (!text) return keys;

  for (const line of text.split('\n')) {
    if (!/flashcard/i.test(line)) continue;
    const section = line.includes(':') ? line.split(':').slice(1).join(':') : line;
    const parts = section.split(';');
    for (const part of parts) {
      const front = String(part || '').split(':')[0].trim();
      const key = normalizeFlashcardKey(front);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function buildFallbackFlashcards(topic, seenKeys, count = 4) {
  const topicName = String(topic || '').replace(/^flashcards\s*:?\s*/i, '').trim() || 'This topic';
  const candidates = [
    { front: `${topicName} Overview`, back: `A concise summary of ${topicName} and why it matters.` },
    { front: `${topicName} Key Concept`, back: `The main principle learners should remember for ${topicName}.` },
    { front: `${topicName} Practical Use`, back: `A real scenario where ${topicName} is applied.` },
    { front: `${topicName} Common Pitfall`, back: `A frequent mistake in ${topicName} and how to avoid it.` },
    { front: `${topicName} Quick Recall`, back: `A short memory cue to revise ${topicName}.` },
  ];

  const out = [];
  for (const card of candidates) {
    if (out.length >= count) break;
    const key = normalizeFlashcardKey(card.front);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(card);
  }

  let cursor = 1;
  while (out.length < count) {
    const front = `${topicName} Insight ${cursor}`;
    const back = `A focused takeaway (${cursor}) that reinforces ${topicName}.`;
    const key = normalizeFlashcardKey(front);
    cursor += 1;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({ front, back });
  }

  return out;
}

function sanitizeFlashcards(cards, topicHint, blockedKeys = new Set()) {
  const used = new Set(blockedKeys);
  const out = [];

  for (const card of Array.isArray(cards) ? cards : []) {
    if (out.length >= 6) break;
    const front = String(card?.front || '').trim().slice(0, 80);
    const back = String(card?.back || '').trim();
    if (!front || !back) continue;
    const frontKey = normalizeFlashcardKey(front);
    const pairKey = `${frontKey}::${normalizeFlashcardKey(back).slice(0, 120)}`;
    if (!frontKey || used.has(frontKey) || used.has(pairKey)) continue;

    used.add(frontKey);
    used.add(pairKey);
    out.push({
      front,
      back,
      icon: card?.icon,
      imageUrl: /^https?:\/\//i.test(String(card?.imageUrl || '')) ? card.imageUrl : '',
      cardType: card?.cardType,
    });
  }

  if (out.length < 4) {
    const fillers = buildFallbackFlashcards(topicHint, used, 4 - out.length);
    out.push(...fillers);
  }

  return out.slice(0, 6);
}

function validateStepContent(type, obj) {
  const safe = (v, d) => (v === undefined || v === null ? d : v);

  const base = {
    type,
    title: safe(obj?.title, ''),
    lessonText: safe(obj?.lessonText, ''),
    data: safe(obj?.data, {}),
  };

  if (type === 'TEXT') {
    base.data = { content: safe(obj?.data?.content, safe(obj?.data?.contentText, '')) };
  }

  if (type === 'FLIP_CARD') {
    const cards = Array.isArray(obj?.data?.cards) ? obj.data.cards : [];
    base.data = {
      cards: sanitizeFlashcards(cards, safe(obj?.title, 'Flashcards'))
    };
    if (!base.data.cards.length) {
      base.data.cards = [
        { front: 'Key Term', back: 'A short definition for this module concept.' },
        { front: 'Why it matters', back: 'A practical reason this concept is important.' },
        { front: 'Common mistake', back: 'A typical beginner mistake and how to avoid it.' },
        { front: 'Mini example', back: 'A tiny example that shows correct usage.' },
      ];
    }
  }

  if (type === 'QUIZ') {
    const qs = Array.isArray(obj?.data?.questions) ? obj.data.questions : [];
    const cleanedQuestions = qs.slice(0, 6).map((q) => {
      const question = String(safe(q.question || q.statement || q.prompt, '')).trim();
      let options = Array.isArray(q.options)
        ? q.options.map((v) => String(v).trim()).filter(Boolean)
        : [];
      if (!options.length && Array.isArray(q.choices)) {
        options = q.choices.map((v) => String(v).trim()).filter(Boolean);
      }
      options = Array.from(new Set(options));
      if (options.length < 2) return null;

      const placeholderQuestion = isPlaceholderQuizQuestion(question);
      const placeholderOptions = options.every((opt) => isPlaceholderQuizOption(opt));
      if (placeholderQuestion && placeholderOptions) return null;
      if (!question || placeholderQuestion) return null;

      if (options.length > 4) options = options.slice(0, 4);
      if (options.length < 4) {
        for (const fallback of [
          'It aligns with the lesson concepts.',
          'It conflicts with the module content.',
          'It is outside this lesson scope.',
          'It ignores the provided context.',
        ]) {
          if (options.length >= 4) break;
          if (!options.includes(fallback)) options.push(fallback);
        }
      }

      let correctAnswer = 0;
      const n = Number.parseInt(String(safe(q.correctAnswer, '0')), 10);
      if (Number.isFinite(n)) {
        correctAnswer = n;
      } else {
        const letter = String(safe(q.correctOption, '') || safe(q.correctAnswer, '')).trim().toUpperCase();
        if (/^[A-D]$/.test(letter)) {
          correctAnswer = letter.charCodeAt(0) - 65;
        } else if (String(safe(q.correctAnswer, '')).trim()) {
          const byText = options.findIndex((opt) => opt.toLowerCase() === String(q.correctAnswer).trim().toLowerCase());
          if (byText >= 0) correctAnswer = byText;
        }
      }
      correctAnswer = Math.min(Math.max(correctAnswer, 0), options.length - 1);

      const explanation = String(safe(q.explanation, '')).trim()
        || `Review the lesson context to confirm why "${options[correctAnswer]}" is the best answer.`;

      return {
        question,
        options,
        correctAnswer,
        explanation,
      };
    }).filter(Boolean);

    base.data = {
      questions: cleanedQuestions.length
        ? cleanedQuestions
        : [
            {
              question: `Which statement best reflects the core idea in ${safe(base.title, 'this lesson')}?`,
              options: [
                'It should align with concepts taught in this module.',
                'It should ignore the lesson content completely.',
                'It is unrelated to this course topic.',
                'It must come from outside the module context.',
              ],
              correctAnswer: 0,
              explanation: 'The correct choice is the one grounded in the module content.',
            },
          ],
    };
  }

  if (type === 'ACCORDION') {
    const items = Array.isArray(obj?.data?.items) ? obj.data.items : [];
    base.data = { items: items.slice(0, 6).map((it) => ({ title: String(safe(it.title, '')), content: String(safe(it.content, '')) })) };
    if (!base.data.items.length) {
      base.data.items = [
        { title: 'What it is', content: 'A concise definition.' },
        { title: 'How it works', content: 'A concise explanation.' },
        { title: 'When to use', content: 'A practical guideline.' },
      ];
    }
  }

  if (type === 'VIDEO') {
    const id = extractYoutubeVideoId(safe(obj?.data?.videoWebUrl, '')) || extractYoutubeVideoId(safe(obj?.data?.videoUrl, ''));
    const normalizedVideoUrl = id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    const normalizedWebUrl = id ? `https://www.youtube.com/watch?v=${id}` : '';
    base.data = {
      videoUrl: normalizedVideoUrl,
      videoWebUrl: normalizedWebUrl,
      videoTitle: safe(obj?.data?.videoTitle, base.title || 'Video'),
      content: safe(obj?.data?.content, ''),
    };
  }

  if (type === 'DRAG_FILL') {
    const challenges = Array.isArray(obj?.data?.challenges) ? obj.data.challenges : [];
    const outChallenges = challenges.slice(0, 6).map((ch) => {
      const rawTemplate = String(safe(ch?.codeTemplate || ch?.statement || ch?.prompt, '')).trim();
      const normalizedTemplate = normalizeTemplateBlanks(rawTemplate);
      const templateWithBlanks = countTemplateBlanks(normalizedTemplate) > 0
        ? normalizedTemplate
        : `${normalizedTemplate || rawTemplate || 'Complete the statement:'} ___`.trim();
      const initialBlankCount = Math.max(1, Math.min(4, countTemplateBlanks(templateWithBlanks)));
      const contextTokens = extractMeaningfulTokens(
        `${templateWithBlanks} ${safe(ch?.instruction, '')} ${safe(ch?.explanation, '')} ${base.title} ${base.lessonText}`
      );

      let options = Array.isArray(ch?.options)
        ? ch.options.map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (!options.length && Array.isArray(ch?.choices)) {
        options = ch.choices.map((o) => String(o).trim()).filter(Boolean);
      }
      options = options.filter((opt) => !isPlaceholderToken(opt));
      if (!options.length) options = contextTokens.slice(0, 6);

      let answers = parseCorrectAnswers(ch?.correctAnswer, initialBlankCount).filter((ans) => !isPlaceholderToken(ans));
      if (!answers.length) {
        const directAnswer = String(safe(ch?.answer, '')).trim();
        if (directAnswer && !isPlaceholderToken(directAnswer)) answers = [directAnswer];
      }

      while (answers.length < initialBlankCount) {
        const fallback = options.find((opt) => !answers.includes(opt)) || '';
        if (!fallback) break;
        answers.push(fallback);
      }
      answers = answers.filter((ans) => !isPlaceholderToken(ans));
      if (!answers.length) answers = (options.length ? options : contextTokens).slice(0, 2);

      const blankCount = Math.max(1, Math.min(4, Math.max(initialBlankCount, Math.min(answers.length || 1, 4))));
      const codeTemplate = limitTemplateBlanks(templateWithBlanks, blankCount, answers);
      answers = answers.slice(0, blankCount);
      for (const ans of answers) {
        if (ans && !options.includes(ans)) options.unshift(ans);
      }
      if (!options.length) {
        options = ['Concept', 'Application', 'Principle', 'Practice'];
      }
      options = Array.from(new Set(options.filter((opt) => !isPlaceholderToken(opt)))).slice(0, 12);
      if (options.length < Math.max(3, blankCount)) {
        for (const token of contextTokens) {
          if (options.length >= Math.max(blankCount + 1, 4)) break;
          if (!options.includes(token)) options.push(token);
        }
      }
      if (options.length < Math.max(blankCount + 1, 4)) {
        for (const fallback of ['Concept', 'Application', 'Principle', 'Practice', 'Review']) {
          if (options.length >= Math.max(blankCount + 1, 4)) break;
          if (!options.includes(fallback)) options.push(fallback);
        }
      }
      if (answers.length < blankCount) {
        for (const option of options) {
          if (answers.length >= blankCount) break;
          if (!answers.includes(option)) answers.push(option);
        }
      }

      return {
        instruction: String(safe(ch?.instruction, 'Fill each blank from left to right using terms from the previous lesson content.')),
        codeTemplate,
        options,
        correctAnswer: answers.join(', '),
        explanation: String(safe(ch?.explanation, 'Compare your selections with the taught concepts and the expected answer order.')),
      };
    });

    base.data = {
      challenges: outChallenges.length ? outChallenges : [
        {
          instruction: 'Fill each blank from left to right using the lesson concepts.',
          codeTemplate: 'A key concept is ___, and a practical application is ___.',
          options: ['Core principle', 'Practical example', 'Random guess', 'Unrelated term'],
          correctAnswer: 'Core principle, Practical example',
          explanation: 'Use concept-first reasoning, then choose the application that matches the lesson.',
        }
      ]
    };
  }

  if (type === 'CODE_BUILDER') {
    const cb = obj?.data?.codeBuilder || {};
    const linesRaw = Array.isArray(cb?.lines) ? cb.lines : [];

    let lines = linesRaw.slice(0, 8).map((ln) => {
      let content = String(safe(ln?.content, '')).slice(0, 240);
      let correctValue = String(safe(ln?.correctValue, '')).slice(0, 120);
      if (correctValue.includes(',') || correctValue.includes('\n') || correctValue.includes(';') || correctValue.includes('|')) {
        correctValue = correctValue.split(/[,\n;|]/g).map((v) => String(v).trim()).filter(Boolean)[0] || '';
      }

      // Ensure there is a single placeholder "___"
      if (!content.includes('___')) {
        if (correctValue && content.includes(correctValue)) {
          content = content.replace(correctValue, '___');
        } else {
          content = `${content} ___`.trim();
        }
      }

      // Keep only ONE placeholder
      const first = content.indexOf('___');
      if (first !== -1) {
        const before = content.slice(0, first + 3);
        const after = content.slice(first + 3).replace(/___/g, '');
        content = before + after;
      }

      // If model forgot correctValue, derive a stable fallback from short options later.
      return { content, correctValue };
    });

    // Remove consecutive duplicate lines (common model glitch)
    const deduped = [];
    let lastSig = '';
    for (const l of lines) {
      const sig = `${l.content}::${l.correctValue}`;
      if (sig && sig === lastSig) continue;
      deduped.push(l);
      lastSig = sig;
    }
    lines = deduped.slice(0, 6);

    // Ensure options include correct values
    let options = Array.isArray(cb?.options)
      ? cb.options
        .map((s) => String(s).trim())
        .filter((s) => s && s.length <= 80 && !s.includes('\n') && !s.includes('```'))
        .slice(0, 16)
      : [];

    const shortOptionFallback = options.find((o) => o.length <= 40) || 'pass';
    lines = lines.map((l) => ({
      ...l,
      correctValue: (String(l.correctValue || '').split(/[,\n;|]/g).map((v) => String(v).trim()).filter(Boolean)[0] || shortOptionFallback)
    }));

    const corrects = lines.map((l) => l.correctValue).filter(Boolean);
    for (const c of corrects) {
      if (!options.includes(c)) options.unshift(c);
    }
    options = Array.from(new Set(options)).slice(0, 16);

    if (options.length < Math.max(4, corrects.length)) {
      const fallbacks = ['0', '1', '2', '"Hello, World!"', 'True', 'False', 'None', '10'];
      for (const f of fallbacks) {
        if (options.length >= 8) break;
        if (!options.includes(f)) options.push(f);
      }
    }

    base.data = {
      codeBuilder: {
        avatarInstruction: String(safe(cb?.avatarInstruction, 'Fill in the blanks to complete the code.')),
        title: String(safe(cb?.title, base.title || 'Interactive Coding')),
        goal: String(safe(cb?.goal, 'Complete the code by choosing the correct pieces.')),
        expectedOutput: String(safe(cb?.expectedOutput, '')),
        lines: lines.length ? lines : [{ content: 'print(___)', correctValue: '"Hello, World!"' }],
        options,
      }
    };
  }

  if (type === 'HOTSPOT') {
    base.data = { image: safe(obj?.data?.image, ''), points: Array.isArray(obj?.data?.points) ? obj.data.points.slice(0, 6) : [] };
  }

  if (type === 'CAROUSEL') {
    base.data = { slides: Array.isArray(obj?.data?.slides) ? obj.data.slides.slice(0, 6) : [] };
  }

  if (type === 'LEARNING_CARD') {
    base.data = { learningCards: Array.isArray(obj?.data?.learningCards) ? obj.data.learningCards.slice(0, 6) : [] };
  }

  return base;
}

async function fetchJson(url, options = {}, timeoutMs = 45000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || 'fetch failed'), json: null };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------ provider calls ------------------------

function envList(name, fallback = []) {
  const v = (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
  return v.length ? v : fallback;
}

function providerCandidates() {
  return envList('AI_PROVIDER_CANDIDATES', ['gemini', 'openrouter', 'openai', 'anthropic']);
}

function providerAvailable(provider) {
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  if (provider === 'openrouter') return !!process.env.OPENROUTER_API_KEY;
  return false;
}

function modelCandidatesFor(provider) {
  if (provider === 'gemini') return envList('GEMINI_MODELS', ['gemini-3-flash-preview','gemini-1.5-flash','gemini-1.5-pro']);
  if (provider === 'openai') return envList('OPENAI_MODELS', ['gpt-4o-mini']);
  if (provider === 'anthropic') return envList('ANTHROPIC_MODELS', ['claude-3-5-sonnet-latest']);
  if (provider === 'openrouter') return envList('OPENROUTER_MODELS', ['openai/gpt-4o-mini']);
  return [];
}

async function callGemini(prompt, model) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, topP: 0.95, maxOutputTokens: 2048 },
  };
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const msg = (r.json?.error?.message) || r.text || 'Gemini error';
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  const text = r.json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return text;
}

async function callOpenAI(prompt, model) {
  const key = process.env.OPENAI_API_KEY;
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a precise educator. Follow instructions exactly.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
  };
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!r.ok) {
    const msg = r.json?.error?.message || r.text || 'OpenAI error';
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r.json?.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model,
    max_tokens: 2048,
    temperature: 0.4,
    messages: [{ role: 'user', content: prompt }]
  };
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const msg = r.json?.error?.message || r.text || 'Anthropic error';
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  const parts = r.json?.content;
  if (Array.isArray(parts)) {
    return parts.map(p => p.text || '').join('');
  }
  return '';
}

async function callOpenRouter(prompt, model) {
  const key = process.env.OPENROUTER_API_KEY;
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a precise educator. Follow instructions exactly.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
  };
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!r.ok) {
    const msg = r.json?.error?.message || r.text || 'OpenRouter error';
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r.json?.choices?.[0]?.message?.content || '';
}

async function callProvider(provider, prompt, model) {
  if (provider === 'gemini') return callGemini(prompt, model);
  if (provider === 'openai') return callOpenAI(prompt, model);
  if (provider === 'anthropic') return callAnthropic(prompt, model);
  if (provider === 'openrouter') return callOpenRouter(prompt, model);
  throw new Error(`Unknown provider: ${provider}`);
}

// circuit breaker per provider
const breaker = new Map(); // provider -> { fails, openUntil }

function breakerState(provider) {
  const s = breaker.get(provider) || { fails: 0, openUntil: 0 };
  breaker.set(provider, s);
  return s;
}

async function routeText(router, prompt, cacheKey, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const cached = cacheGet(cacheKey, ttlMs);
  if (cached?.text) return cached.text;

  const mode = router?.mode || 'auto';
  const provider = (router?.provider || 'auto').toLowerCase();
  const manualModel = router?.model || 'auto';
  const clientCandidates = Array.isArray(router?.modelCandidates) ? router.modelCandidates : null;

  const tryProviders = [];
  if (mode === 'manual' && provider !== 'auto') {
    tryProviders.push(provider);
  } else {
    for (const p of providerCandidates()) {
      if (providerAvailable(p)) tryProviders.push(p);
    }
  }

  if (!tryProviders.length) {
    throw new Error('No AI providers are configured. Add at least one API key (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY).');
  }

  let lastErr = null;
  let backoff = 1500;

  for (let attempt = 0; attempt < 10; attempt++) {
    const p = tryProviders[attempt % tryProviders.length];
    const br = breakerState(p);
    if (Date.now() < br.openUntil) {
      continue;
    }

    const models = clientCandidates && p === 'gemini' ? clientCandidates : modelCandidatesFor(p);
    const canUseManual = (manualModel && manualModel !== 'auto') && (
      (mode === 'manual' && provider !== 'auto') ||
      (p === 'gemini' && String(manualModel).startsWith('gemini')) ||
      (p === 'openai' && String(manualModel).startsWith('gpt')) ||
      (p === 'anthropic' && String(manualModel).startsWith('claude')) ||
      (p === 'openrouter' && String(manualModel).includes('/'))
    );
    const chosenModel = canUseManual ? manualModel : (models[attempt % Math.max(models.length, 1)] || models[0] || 'gpt-4o-mini');

    try {
      const text = await callProvider(p, prompt, chosenModel);
      cacheSet(cacheKey, { text, provider: p, model: chosenModel, at: Date.now() });
      br.fails = 0;
      br.openUntil = 0;
      return text;
    } catch (e) {
      lastErr = e;
      const status = e.status || 0;

      br.fails += 1;
      if (br.fails >= 3 && isRetriableStatus(status)) {
        br.openUntil = Date.now() + 60_000;
      }

      if (isRetriableStatus(status)) {
        await sleep(Math.min(backoff, 15_000));
        backoff *= 2;
        continue;
      }

      continue;
    }
  }

  throw lastErr || new Error('AI request failed');
}

// ------------------------ YouTube helper (optional) ------------------------

function parseIsoDurationSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const m = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return 0;
  const h = Number.parseInt(m[1] || '0', 10);
  const min = Number.parseInt(m[2] || '0', 10);
  const sec = Number.parseInt(m[3] || '0', 10);
  return (h * 3600) + (min * 60) + sec;
}

function buildVideoQueryTokens(query) {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'module', 'lesson', 'step',
    'tutorial', 'course', 'video', 'youtube', 'guide', 'intro', 'basics'
  ]);
  return Array.from(new Set(
    String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
      .filter((w) => !stop.has(w))
  )).slice(0, 8);
}

function computeTextRelevanceScore(text, tokens) {
  if (!Array.isArray(tokens) || !tokens.length) return 0;
  const hay = String(text || '').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function isLikelyYouTubeShort(title, durationSeconds = 0) {
  const t = String(title || '').toLowerCase();
  if (/#shorts?\b/.test(t) || /\bshorts?\b/.test(t)) return true;
  return durationSeconds > 0 && durationSeconds <= 180;
}

async function youtubeSearchEmbed(query, excludeIds = []) {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return null;
    const queryTokens = buildVideoQueryTokens(query);

    // 1) Search a few candidates
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '8');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('safeSearch', 'strict');
    searchUrl.searchParams.set('key', key);

    const s = await fetchJson(searchUrl.toString(), { method: 'GET' }, 12000);
    if (!s.ok) return null;

    const excluded = new Set((excludeIds || []).map((v) => normalizeYoutubeVideoId(v)).filter(Boolean));
    const ids = (s.json?.items || [])
      .map((it) => it?.id?.videoId)
      .map((id) => normalizeYoutubeVideoId(id))
      .filter((id) => !!id && !excluded.has(id));

    if (!ids.length) return null;

    // 2) Filter for embeddable/public videos (reduces iframe playback errors)
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set('part', 'snippet,status,contentDetails');
    videosUrl.searchParams.set('id', ids.join(','));
    videosUrl.searchParams.set('key', key);

    const v = await fetchJson(videosUrl.toString(), { method: 'GET' }, 12000);
    if (!v.ok) return null;

    const items = Array.isArray(v.json?.items) ? v.json.items : [];
    const embeddable = items.filter((it) => {
      const st = it?.status;
      if (!st?.embeddable) return false;
      if (st?.privacyStatus !== 'public') return false;

      const rr = it?.contentDetails?.regionRestriction;
      if (Array.isArray(rr?.blocked) && rr.blocked.includes('US')) return false;
      if (Array.isArray(rr?.allowed) && rr.allowed.length && !rr.allowed.includes('US')) return false;

      return true;
    });

    const ranked = embeddable
      .map((it) => {
        const id = normalizeYoutubeVideoId(it?.id);
        const title = String(it?.snippet?.title || '').trim();
        const description = String(it?.snippet?.description || '').trim();
        const durationSeconds = parseIsoDurationSeconds(it?.contentDetails?.duration);
        const relevance = computeTextRelevanceScore(`${title} ${description}`, queryTokens);
        const short = isLikelyYouTubeShort(title, durationSeconds);
        return { id, title, relevance, short, durationSeconds };
      })
      .filter((it) => !!it.id)
      .filter((it) => queryTokens.length === 0 || it.relevance > 0)
      .sort((a, b) => {
        if (a.short !== b.short) return a.short ? 1 : -1;
        if (a.relevance !== b.relevance) return b.relevance - a.relevance;
        return b.durationSeconds - a.durationSeconds;
      });

    for (const it of ranked) {
      const id = it?.id;
      if (!id) continue;
      const web = `https://www.youtube.com/watch?v=${id}`;
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(web)}`;
      const oe = await fetchJson(oembed, { method: 'GET' }, 8000);
      if (!oe.ok) continue;

      return {
        videoUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        videoWebUrl: web,
        videoTitle: it?.title || 'Video',
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function youtubeSearchEmbedNoKey(query, excludeIds = []) {
  try {
    const queryTokens = buildVideoQueryTokens(query);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const r = await fetchJson(searchUrl, {
      method: 'GET',
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
    }, 12000);
    if (!r.ok || !r.text) return null;

    const excluded = new Set((excludeIds || []).map((v) => normalizeYoutubeVideoId(v)).filter(Boolean));
    const ids = [];
    const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    let m;
    while ((m = re.exec(r.text)) !== null) {
      const id = normalizeYoutubeVideoId(m[1]);
      if (id && !excluded.has(id) && !ids.includes(id)) ids.push(id);
      if (ids.length >= 12) break;
    }
    if (!ids.length) return null;

    const candidates = [];
    for (const id of ids) {
      const web = `https://www.youtube.com/watch?v=${id}`;
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(web)}`;
      const oe = await fetchJson(oembed, { method: 'GET' }, 8000);
      if (!oe.ok) continue;
      const title = String(oe.json?.title || 'Video').trim();
      const relevance = computeTextRelevanceScore(title, queryTokens);
      if (queryTokens.length && relevance <= 0) continue;
      candidates.push({
        id,
        title,
        relevance,
        short: isLikelyYouTubeShort(title, 0),
      });
    }

    candidates.sort((a, b) => {
      if (a.short !== b.short) return a.short ? 1 : -1;
      return b.relevance - a.relevance;
    });

    const best = candidates[0];
    if (best) {
      return {
        videoUrl: `https://www.youtube-nocookie.com/embed/${best.id}`,
        videoWebUrl: `https://www.youtube.com/watch?v=${best.id}`,
        videoTitle: best.title || 'Video',
      };
    }

    return null;
  } catch {
    return null;
  }
}

function curatedVideo(topicText) {
  const t = String(topicText || '').toLowerCase();

  if (t.includes('data structure') || t.includes('algorithm') || t.includes('dsa') || t.includes('graph') || t.includes('tree') || t.includes('stack') || t.includes('queue') || t.includes('array')) {
    return { videoUrl: 'https://www.youtube-nocookie.com/embed/8hly31xKli0', videoWebUrl: 'https://www.youtube.com/watch?v=8hly31xKli0', videoTitle: 'Data Structures & Algorithms (Full Course)' };
  }

  if (t.includes('python')) {
    return { videoUrl: 'https://www.youtube-nocookie.com/embed/rfscVS0vtbw', videoWebUrl: 'https://www.youtube.com/watch?v=rfscVS0vtbw', videoTitle: 'Python Programming (Full Course)' };
  }

  return null;
}

// ------------------------ prompt builders ------------------------

function promptAssessment(topic, profileContext = {}) {
  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON (no markdown, no extra text).\n\nTask: Generate 3-4 short assessment questions to understand a learner's current level and goals for: ${topic}.\n\nProfile constraints:\n${profileRules}\n\nJSON format: an array of objects with: id (string), question (string), type ('text' or 'choice'), options (optional array of strings).`;
}

function promptCourseOutline(topic, answers, profileContext = {}) {
  const context = Object.entries(answers || {}).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON.\n\nCreate a professional 4-module course outline for: ${topic}.\nUse the learner context below.\n\n${context}\n\nProfile constraints:\n${profileRules}\n\nJSON format:\n{\n  "title": string,\n  "description": string,\n  "modules": [{"id": string, "title": string, "description": string}]\n}`;
}

function promptLessonPlan(courseTitle, moduleTitle, moduleDesc, profileContext = {}) {
  const normalizedProfile = normalizeProfileContext(profileContext);
  const programmingTrack = isProgrammingTopic(courseTitle, moduleTitle, moduleDesc);
  const lowBandwidth = normalizedProfile.lowBandwidthMode;
  const step5Type = programmingTrack && !lowBandwidth ? 'CODE_BUILDER' : 'ACCORDION';
  const step5Rule = programmingTrack
    ? (lowBandwidth
      ? '- Step5 ACCORDION or LEARNING_CARD (low bandwidth mode, no heavy coding mini-game)'
      : '- Step5 CODE_BUILDER (only for programming/software topics)')
    : '- Step5 ACCORDION or LEARNING_CARD (concept clarification, no coding game)';
  const domainRule = programmingTrack
    ? (lowBandwidth
      ? '- Keep exercises lightweight and text-first because of low bandwidth constraints.'
      : '- Keep coding practice tied to the concepts taught in this module.')
    : '- Do NOT include CODE_BUILDER for non-programming topics.';
  const profileRules = profileRulesText(profileContext);

  return `Return ONLY valid JSON (array).\n\nPlan a 7-step lesson for module: "${moduleTitle}" (${moduleDesc}) in course: "${courseTitle}".\n\nProfile constraints:\n${profileRules}\n\nRules:\n- Step1 TEXT (teaching first, not quiz)\n- Step3 FLIP_CARD\n- Step4 VIDEO (exactly 1 video per module unless low bandwidth mode suggests text-first alternatives)\n${step5Rule}\n- Step6 DRAG_FILL (applied challenge)\n- Step7 QUIZ (exactly 4 questions later when generating content)\n${domainRule}\n- Prefer interactive Cisco/Duolingo style types: ACCORDION, HOTSPOT, CAROUSEL, LEARNING_CARD, DRAG_FILL${programmingTrack && !lowBandwidth ? ', CODE_BUILDER' : ''}\n\nArray item format: {"id": string, "title": string, "type": "TEXT"|"VIDEO"|"FLIP_CARD"|"QUIZ"|"CODE_BUILDER"|"LEARNING_CARD"|"DRAG_FILL"|"ACCORDION"|"HOTSPOT"|"CAROUSEL"}\n\nImportant:\n- Every step title must be specific (avoid generic titles like "Lesson 1" or "Practice").\n- Step titles should clearly describe the exact skill/concept being learned.`;
}

function promptStepContent(courseTitle, moduleTitle, stepTitle, type, referenceContext = '', profileContext = {}) {
  const normalizedProfile = normalizeProfileContext(profileContext);
  const programmingTrack = isProgrammingTopic(courseTitle, moduleTitle, stepTitle);
  const lowBandwidth = normalizedProfile.lowBandwidthMode;
  const flashcardRule = String(type || '').toUpperCase() === 'FLIP_CARD'
    ? '- For FLIP_CARD: do not repeat fronts/backs from earlier flashcards listed in reference context.\n'
    : '';
  const referenceBlock = referenceContext
    ? `\nReference context from earlier generated lesson content (must be reused in this step):\n${referenceContext}\n`
    : '\nReference context from earlier generated lesson content:\n- Not available yet. Use module and step titles directly and keep the challenge coherent.\n';

  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON (no markdown, no explanations outside JSON).\n\nGenerate lesson content for:\nCourse: ${courseTitle}\nModule: ${moduleTitle}\nStep: ${stepTitle}\nType: ${type}\n${referenceBlock}\nProfile constraints:\n${profileRules}\nGlobal rules:\n- Include lessonText: 1 concise sentence intro.\n- Keep content scannable: bullets, short sentences.\n- Use specific, meaningful titles and terms from this module.\n- Never generate random or unrelated tasks.\n- Make every quiz/challenge item traceable to concepts already taught in TEXT/VIDEO/learning cards.\n- Keep content localized to output language code ${normalizedProfile.preferredLanguage}.\n\nType-specific formats:\nTEXT => {type,title,lessonText,data:{content:string (markdown)}}\nACCORDION => data:{items:[{title,content}]} (3 items)\nFLIP_CARD => data:{cards:[{front,back,icon?,imageUrl?}]} (4 cards)\nVIDEO => data:{videoUrl (embed), videoTitle, content (short summary + bullets), videoWebUrl?}\nQUIZ => data:{questions:[{question,options[4],correctAnswer(0-3),explanation}]} (4 questions)\nCODE_BUILDER => data:{codeBuilder:{avatarInstruction,lines:[{content,correctValue}],options:[string]}}\nDRAG_FILL => data:{challenges:[{instruction,codeTemplate,options,correctAnswer,explanation}]}\nHOTSPOT => data:{image,points:[{title,content,icon}]}\nCAROUSEL => data:{slides:[{title,content,imagePrompt,imageUrl}] }\nLEARNING_CARD => data:{learningCards:[{title,content,layout}]}\n\nExtra rules:\n- Use exact topic terms from module and step titles in all generated items.\n- If VIDEO: use an EMBEDDABLE URL format https://www.youtube-nocookie.com/embed/<real_11_char_video_id>. Never output placeholders like VIDEO_ID.\n- For VIDEO: pick a topic-related YouTube result, and prefer regular videos over Shorts when both are relevant.\n- For FLIP_CARD: each card front must be unique and clearly tied to this step title.\n- For DRAG_FILL: instruction must clearly state what learner should do, where to get clues, and how to fill blanks in order.\n- For DRAG_FILL: each challenge must use 2-4 blanks maximum.\n- For DRAG_FILL: options must be meaningful domain terms; never output placeholders like answer1, answer2, A, B, C, D.\n- For DRAG_FILL: if codeTemplate has N blanks, correctAnswer must have exactly N comma-separated answers in the same order.\n- For QUIZ/DRAG_FILL: each question/challenge must include terms from the reference context, module title, or video summary.\n${lowBandwidth ? '- Low bandwidth mode is active: minimize media-heavy dependencies and provide text-first alternatives.\n' : ''}${flashcardRule}${programmingTrack ? '- For CODE_BUILDER: each line.content must contain exactly one ___ and correctValue must match one option exactly.\n- For CODE_BUILDER: correctValue must be a SINGLE value (no commas, no multiple answers).\n- For CODE_BUILDER: options must be short code tokens/expressions only (no full sentences, no questions).' : '- This is not a programming topic. Avoid code syntax and use plain-language, topic-relevant activities.'}`;
}

function promptTutorAsk(contentJson, question) {
  return `Answer in markdown. Keep it short (<=120 words) and clear.\n\nLesson Content (JSON):\n${JSON.stringify(contentJson)}\n\nUser question: ${question}`;
}

function promptTutorEdit(contentJson, editPrompt) {
  return `Return ONLY valid JSON (no markdown).\n\nYou are an expert educator. Modify the content according to: ${editPrompt}\n\nCURRENT JSON:\n${JSON.stringify(contentJson)}\n\nRules:\n- Keep the EXACT same structure and type.\n- Do not remove required fields.\n- Output the updated JSON only.`;
}

function promptTutorEditRepair(contentJson, editPrompt, badOutput) {
  const snippet = String(badOutput || '').slice(0, 2000);
  return `Return ONLY valid JSON (no markdown).

The previous output was NOT valid JSON. Fix it.

Edit request:
${editPrompt}

CURRENT JSON:
${JSON.stringify(contentJson)}

INVALID OUTPUT (snippet):
${snippet}

Rules:
- Output ONLY JSON.
- Keep the EXACT same structure and type.
- Do not remove required fields.`;
}

function fallbackStepContent(type, stepTitle, moduleTitle, yt) {
  const programmingTrack = isProgrammingTopic(moduleTitle, stepTitle);
  if (type === 'VIDEO') {
    const safeVideo = yt || curatedVideo(`${moduleTitle} ${stepTitle}`);
    if (!safeVideo) {
      return validateStepContent('TEXT', {
        type: 'TEXT',
        title: stepTitle,
        lessonText: 'We could not fetch a reliable video right now, so here is a quick summary.',
        data: {
          content: '- Review the key points for this step.\n- Retry generation to fetch a topic-specific video.\n- Use a different model/provider if needed.',
        }
      });
    }
    return validateStepContent('VIDEO', {
      type: 'VIDEO',
      title: stepTitle,
      lessonText: 'Watch this short lesson, then summarize the key takeaways.',
      data: {
        videoUrl: safeVideo.videoUrl,
        videoWebUrl: safeVideo.videoWebUrl,
        videoTitle: safeVideo.videoTitle,
        content: '- Focus on the main idea.\n- Note 2 practical examples.\n- Rewatch difficult parts.',
      }
    });
  }

  if (type === 'CODE_BUILDER') {
    if (!programmingTrack) {
      return validateStepContent('DRAG_FILL', {
        type: 'DRAG_FILL',
        title: stepTitle,
        lessonText: 'Apply what you just learned by filling each blank in order.',
        data: {
          challenges: [
            {
              instruction: `Use ideas from "${moduleTitle}" to complete each blank from left to right.`,
              codeTemplate: `In ${moduleTitle}, a core best practice is ___ and a common example is ___.`,
              options: ['clear communication', 'structured practice', 'random guessing', 'skipping feedback'],
              correctAnswer: 'clear communication, structured practice',
              explanation: 'These answers reinforce the core concepts and practical routine from the lesson.'
            }
          ]
        }
      });
    }

    return validateStepContent('CODE_BUILDER', {
      type: 'CODE_BUILDER',
      title: stepTitle,
      lessonText: 'Complete each blank with the best matching code token.',
      data: {
        codeBuilder: {
          avatarInstruction: 'Fill each blank with the correct option.',
          lines: [
            { content: 'def greet(name):', correctValue: '' },
            { content: '    return ___', correctValue: '"Hello, " + name' },
            { content: 'print(greet(___))', correctValue: '"Nexus"' },
          ],
          options: ['"Hello, " + name', '"Nexus"', '42', 'None']
        }
      }
    });
  }

  if (type === 'DRAG_FILL') {
    return validateStepContent('DRAG_FILL', {
      type: 'DRAG_FILL',
      title: stepTitle,
      lessonText: 'Apply the concept by filling each blank from left to right.',
      data: {
        challenges: [
          {
            instruction: `Complete the blanks in order using what you learned in "${moduleTitle}".`,
            codeTemplate: `A key idea in ${moduleTitle} is ___, and one practical application is ___.`,
            options: ['consistent practice', 'real-world examples', 'irrelevant facts', 'guessing'],
            correctAnswer: 'consistent practice, real-world examples',
            explanation: 'Strong learning steps connect core ideas to practical examples instead of random answers.'
          }
        ]
      }
    });
  }

  return validateStepContent('TEXT', {
    type: 'TEXT',
    title: stepTitle,
    lessonText: 'We generated a fallback lesson because the AI provider is currently unavailable.',
    data: {
      content: '- Retry generation in a moment.\n- Switch AI provider/model if needed.\n- Continue with available steps.'
    }
  });
}

// ------------------------ API handlers ------------------------

async function handleApi(req, res, pathname) {
  const requestUrl = new URL(req.url || pathname || '/api/config', 'http://localhost');
  const query = requestUrl.searchParams;
  const db = loadAppDb();

  if (req.method === 'GET' && pathname === '/api/config') {
    const providers = ['gemini','openai','anthropic','openrouter'].map(p => ({
      id: p,
      available: providerAvailable(p),
      defaultModels: modelCandidatesFor(p)
    }));
    return sendJson(res, 200, {
      providers,
      providerCandidates: providerCandidates().filter(providerAvailable),
    });
  }

  if (req.method === 'GET' && pathname === '/api/profile/me') {
    const accountId = String(query.get('accountId') || '').trim();
    const profile = db.profiles.find((p) => p.id === accountId) || null;
    return sendJson(res, 200, { ok: true, data: profile });
  }

  if (req.method === 'GET' && pathname === '/api/impact/summary') {
    const accountId = String(query.get('accountId') || '').trim();
    const courseId = String(query.get('courseId') || '').trim();
    const pretests = db.pretests.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const posttests = db.posttests.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const conf = db.confidence.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const events = db.events.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));

    const avg = (arr) => arr.length ? (arr.reduce((acc, n) => acc + Number(n || 0), 0) / arr.length) : 0;
    const preAvg = avg(pretests.map((x) => safePercent(x.scorePct)));
    const postAvg = avg(posttests.map((x) => safePercent(x.scorePct)));

    const preConf = avg(conf.filter((x) => x.phase === 'pre').map((x) => Number(x.score || 0)));
    const postConf = avg(conf.filter((x) => x.phase === 'post').map((x) => Number(x.score || 0)));

    const started = events.filter((e) => e.type === 'course_started').length;
    const completed = events.filter((e) => e.type === 'course_completed').length;
    const completionRate = started ? Math.round((completed / started) * 100) : 0;

    const activeDays = new Set(events.filter((e) => e.type === 'daily_active').map((e) => String(e.date || '').slice(0, 10))).size;
    const usersReached = new Set(events.map((e) => e.accountId)).size;

    const startsByCourse = new Map();
    for (const e of events) {
      if (e.type !== 'course_started') continue;
      const courseKey = String(e.courseId || '');
      const at = Date.parse(String(e.date || ''));
      if (!Number.isFinite(at)) continue;
      const prev = startsByCourse.get(courseKey);
      if (prev === undefined || at < prev) startsByCourse.set(courseKey, at);
    }
    let completionSamples = 0;
    let completionMinutesTotal = 0;
    for (const e of events) {
      if (e.type !== 'course_completed') continue;
      const courseKey = String(e.courseId || '');
      const startAt = startsByCourse.get(courseKey);
      const doneAt = Date.parse(String(e.date || ''));
      if (!Number.isFinite(startAt) || !Number.isFinite(doneAt) || doneAt < startAt) continue;
      completionSamples += 1;
      completionMinutesTotal += Math.round((doneAt - startAt) / 60000);
    }
    const avgTimeToCompletionMins = completionSamples ? Math.round(completionMinutesTotal / completionSamples) : 0;

    const dashboard = {
      usersReached,
      skillGainPp: Math.round((postAvg - preAvg) * 10) / 10,
      confidenceGain: Math.round((postConf - preConf) * 10) / 10,
      completionRate,
      avgTimeToCompletionMins,
      d7Retention: activeDays >= 7 ? 1 : (activeDays > 0 ? Math.round((activeDays / 7) * 100) / 100 : 0),
    };
    return sendJson(res, 200, { ok: true, data: dashboard });
  }

  if (req.method === 'GET' && pathname === '/api/public/feed') {
    const feed = db.publicPosts.filter((p) => p.visibility === 'public').sort((a, b) => {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return sendJson(res, 200, { ok: true, data: feed });
  }

  const publicCommentsMatch = pathname.match(/^\/api\/public\/([^/]+)\/comments$/);
  if (req.method === 'GET' && publicCommentsMatch) {
    const postId = decodeURIComponent(publicCommentsMatch[1]);
    const comments = db.comments
      .filter((c) => c.postId === postId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 20);
    return sendJson(res, 200, { ok: true, data: comments });
  }

  if (req.method === 'GET' && pathname === '/api/courses/my') {
    const ownedPosts = db.publicPosts.filter((p) => p.ownerId === String(query.get('accountId') || '').trim());
    return sendJson(res, 200, { ok: true, data: ownedPosts });
  }

  const cohortDashboardMatch = pathname.match(/^\/api\/cohorts\/([^/]+)\/dashboard$/);
  if (req.method === 'GET' && cohortDashboardMatch) {
    const cohortId = decodeURIComponent(cohortDashboardMatch[1]);
    const cohort = db.cohorts.find((c) => c.id === cohortId) || null;
    const members = db.cohortMembers.filter((m) => m.cohortId === cohortId);
    const courseEvents = db.events.filter((e) => e.courseId === cohort?.courseId);
    return sendJson(res, 200, {
      ok: true,
      data: {
        cohort,
        memberCount: members.length,
        completionCount: courseEvents.filter((e) => e.type === 'course_completed').length,
        lessonCompletions: courseEvents.filter((e) => e.type === 'lesson_completed').length,
      }
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const router = body?.router || {};
  const accountId = String(body?.accountId || '').trim() || `local-${sha256(String(req.headers['user-agent'] || 'ua')).slice(0, 12)}`;
  const profileContext = normalizeProfileContext(body?.profileContext || {});

  try {
    if (pathname === '/api/profile/upsert') {
      const incoming = normalizeProfileContext(body?.profile || {});
      const existing = db.profiles.find((p) => p.id === accountId);
      const next = {
        id: accountId,
        email: String(body?.profile?.email || existing?.email || ''),
        userSegment: incoming.userSegment,
        connectivityLevel: incoming.connectivityLevel,
        learningGoal: incoming.learningGoal || '',
        preferredLanguage: incoming.preferredLanguage || 'en',
        region: incoming.region || 'ASEAN',
        discoverySource: String(body?.profile?.discoverySource || existing?.discoverySource || 'social_media'),
        deviceClass: String(body?.profile?.deviceClass || existing?.deviceClass || 'unknown'),
        lowBandwidthMode: !!incoming.lowBandwidthMode,
        updatedAt: nowIso(),
        createdAt: existing?.createdAt || nowIso(),
      };
      const idx = db.profiles.findIndex((p) => p.id === accountId);
      if (idx === -1) db.profiles.push(next);
      else db.profiles[idx] = next;
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: next });
    }

    if (pathname === '/api/impact/pretest') {
      db.pretests.push({
        id: `pre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        accountId,
        courseId: String(body?.courseId || '').trim(),
        scorePct: safePercent(body?.scorePct),
        createdAt: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    if (pathname === '/api/impact/posttest') {
      db.posttests.push({
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        accountId,
        courseId: String(body?.courseId || '').trim(),
        scorePct: safePercent(body?.scorePct),
        createdAt: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    if (pathname === '/api/impact/confidence') {
      const phase = String(body?.phase || 'pre').toLowerCase() === 'post' ? 'post' : 'pre';
      const score = Math.max(1, Math.min(5, Number(body?.score || 1)));
      db.confidence.push({
        id: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        accountId,
        courseId: String(body?.courseId || '').trim(),
        phase,
        score,
        createdAt: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    if (pathname === '/api/impact/event') {
      const type = String(body?.type || '').trim();
      const allowed = new Set(['course_started', 'lesson_started', 'lesson_completed', 'quiz_submitted', 'course_completed', 'daily_active']);
      if (!allowed.has(type)) return sendJson(res, 400, { error: 'invalid event type' });
      db.events.push({
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        accountId,
        courseId: String(body?.courseId || '').trim(),
        type,
        payload: body?.payload && typeof body.payload === 'object' ? body.payload : {},
        date: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    const publishMatch = pathname.match(/^\/api\/courses\/([^/]+)\/publish$/);
    if (publishMatch) {
      const courseId = decodeURIComponent(publishMatch[1]);
      const visibility = String(body?.visibility || 'private') === 'public' ? 'public' : 'private';
      const course = body?.course && typeof body.course === 'object' ? body.course : {};
      const existingIdx = db.publicPosts.findIndex((p) => p.ownerId === accountId && p.courseId === courseId);
      const existingPost = existingIdx === -1 ? null : db.publicPosts[existingIdx];
      const next = {
        id: existingPost?.id || `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        courseId,
        ownerId: accountId,
        title: String(course?.title || existingPost?.title || courseId),
        description: String(course?.description || existingPost?.description || ''),
        snapshot: course && typeof course === 'object' ? course : (existingPost?.snapshot || null),
        language: String(profileContext.preferredLanguage || existingPost?.language || 'en'),
        segment: String(profileContext.userSegment || existingPost?.segment || 'youth'),
        visibility,
        moderationStatus: visibility === 'public'
          ? (existingPost?.moderationStatus === 'hidden' ? 'hidden' : 'under_review')
          : 'clean',
        reactions: Number(existingPost?.reactions || 0),
        comments: Number(existingPost?.comments || 0),
        saves: Number(existingPost?.saves || 0),
        createdAt: existingPost?.createdAt || nowIso(),
      };
      if (existingIdx === -1) db.publicPosts.push(next);
      else db.publicPosts[existingIdx] = next;
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: { id: next.id, visibility: next.visibility, moderationStatus: next.moderationStatus } });
    }

    const reactMatch = pathname.match(/^\/api\/public\/([^/]+)\/react$/);
    if (reactMatch) {
      const postId = decodeURIComponent(reactMatch[1]);
      const post = db.publicPosts.find((p) => p.id === postId);
      if (!post) return sendJson(res, 404, { error: 'post not found' });
      db.reactions.push({
        id: `rea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        postId,
        accountId,
        reaction: String(body?.reaction || 'like'),
        createdAt: nowIso(),
      });
      post.reactions = Math.max(0, Number(post.reactions || 0) + 1);
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    const commentMatch = pathname.match(/^\/api\/public\/([^/]+)\/comment$/);
    if (commentMatch) {
      const postId = decodeURIComponent(commentMatch[1]);
      const post = db.publicPosts.find((p) => p.id === postId);
      if (!post) return sendJson(res, 404, { error: 'post not found' });
      const text = String(body?.comment || '').trim();
      if (!text) return sendJson(res, 400, { error: 'comment required' });
      db.comments.push({
        id: `com-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        postId,
        accountId,
        text: text.slice(0, 500),
        createdAt: nowIso(),
      });
      post.comments = Math.max(0, Number(post.comments || 0) + 1);
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    const reportMatch = pathname.match(/^\/api\/courses\/([^/]+)\/report$/);
    if (reportMatch) {
      const courseId = decodeURIComponent(reportMatch[1]);
      const reason = String(body?.reason || '').trim() || 'Not specified';
      db.reports.push({
        id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        courseId,
        accountId,
        reason: reason.slice(0, 500),
        createdAt: nowIso(),
      });
      const related = db.publicPosts.filter((p) => p.courseId === courseId);
      if (related.length >= 1) {
        for (const p of related) {
          const totalReports = db.reports.filter((r) => r.courseId === p.courseId).length;
          if (totalReports >= 3) p.moderationStatus = 'flagged';
          if (totalReports >= 5) p.moderationStatus = 'hidden';
        }
      }
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: true });
    }

    if (pathname === '/api/cohorts') {
      const name = String(body?.name || '').trim();
      const courseId = String(body?.courseId || '').trim();
      if (!name || !courseId) return sendJson(res, 400, { error: 'name and courseId required' });
      const cohort = {
        id: `coh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.slice(0, 120),
        ownerId: accountId,
        courseId,
        createdAt: nowIso(),
      };
      db.cohorts.push(cohort);
      db.cohortMembers.push({
        id: `cohmem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cohortId: cohort.id,
        accountId,
        role: 'owner',
        createdAt: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: cohort });
    }

    const joinMatch = pathname.match(/^\/api\/cohorts\/([^/]+)\/join$/);
    if (joinMatch) {
      const cohortId = decodeURIComponent(joinMatch[1]);
      const exists = db.cohortMembers.find((m) => m.cohortId === cohortId && m.accountId === accountId);
      if (!exists) {
        db.cohortMembers.push({
          id: `cohmem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cohortId,
          accountId,
          role: 'member',
          createdAt: nowIso(),
        });
        saveAppDb(db);
      }
      return sendJson(res, 200, { ok: true, data: true });
    }

    if (pathname === '/api/progress/sync') {
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item.type || '').trim();
        if (!type) continue;
        db.events.push({
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          accountId,
          courseId: String(item.courseId || ''),
          type,
          payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
          date: item.createdAt || nowIso(),
        });
      }
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: { merged: items.length } });
    }

    if (pathname === '/api/generate/assessment') {
      const topic = String(body?.topic || '').trim();
      if (!topic) return sendJson(res, 400, { error: 'topic required' });
      const prompt = promptAssessment(topic, profileContext);
      const key = sha256(`assessment|${topic}|${JSON.stringify(router)}`);
      const text = await routeText(router, prompt, key);
      const json = extractJson(text);
      return sendJson(res, 200, { ok: true, data: json });
    }

    if (pathname === '/api/generate/course-outline') {
      const topic = String(body?.topic || '').trim();
      const answers = body?.answers || {};
      if (!topic) return sendJson(res, 400, { error: 'topic required' });
      const prompt = promptCourseOutline(topic, answers, profileContext);
      const key = sha256(`outline|${topic}|${JSON.stringify(answers)}|${JSON.stringify(router)}`);
      const text = await routeText(router, prompt, key);
      const json = extractJson(text);
      return sendJson(res, 200, { ok: true, data: json });
    }

    if (pathname === '/api/generate/module-lesson-plan') {
      const courseTitle = String(body?.courseTitle || '').trim();
      const moduleTitle = String(body?.moduleTitle || '').trim();
      const moduleDesc = String(body?.moduleDesc || '').trim();
      if (!courseTitle || !moduleTitle) return sendJson(res, 400, { error: 'courseTitle and moduleTitle required' });

      const prompt = promptLessonPlan(courseTitle, moduleTitle, moduleDesc, profileContext);
      const key = sha256(`lessonplan|${courseTitle}|${moduleTitle}|${moduleDesc}|${JSON.stringify(router)}`);
      const text = await routeText(router, prompt, key);
      const json = normalizeLessonPlan(extractJson(text), `${courseTitle} ${moduleTitle} ${moduleDesc}`);
      return sendJson(res, 200, { ok: true, data: json });
    }

    if (pathname === '/api/generate/step-content') {
      const courseTitle = String(body?.courseTitle || '').trim();
      const moduleTitle = String(body?.moduleTitle || '').trim();
      const stepTitle = String(body?.stepTitle || '').trim();
      const type = String(body?.type || '').trim();
      const referenceContext = String(body?.referenceContext || '').trim().slice(0, 2000);
      if (!courseTitle || !moduleTitle || !stepTitle || !type) {
        return sendJson(res, 400, { error: 'courseTitle, moduleTitle, stepTitle, type required' });
      }
      const effectiveType = (!isProgrammingTopic(courseTitle, moduleTitle, stepTitle) && type === 'CODE_BUILDER')
        ? 'DRAG_FILL'
        : type;
      const profileLowBandwidth = !!profileContext.lowBandwidthMode || profileContext.connectivityLevel !== 'normal';
      const finalType = profileLowBandwidth && effectiveType === 'VIDEO' ? 'TEXT' : effectiveType;

      let yt = null;
      let videoRegistryKey = '';
      if (finalType === 'VIDEO') {
        videoRegistryKey = moduleVideoKey(courseTitle, moduleTitle);
        const usedIds = getUsedVideoIds(videoRegistryKey);
        const ytSearch = await youtubeSearchEmbed(`${courseTitle} ${moduleTitle} ${stepTitle} tutorial`, usedIds);
        const ytNoKey = ytSearch ? null : await youtubeSearchEmbedNoKey(`${courseTitle} ${moduleTitle} ${stepTitle} tutorial`, usedIds);
        const ytCurated = (ytSearch || ytNoKey) ? null : curatedVideo(`${courseTitle} ${moduleTitle} ${stepTitle}`);
        yt = ytSearch || ytNoKey || ytCurated || null;
      }

      const prompt = promptStepContent(courseTitle, moduleTitle, stepTitle, finalType, referenceContext, profileContext);
      const key = sha256(`step|${courseTitle}|${moduleTitle}|${stepTitle}|${finalType}|${referenceContext}|${JSON.stringify(router)}`);
      let json = null;
      try {
        const text = await routeText(router, prompt, key);
        json = extractJson(text);
      } catch (err) {
        const fallback = fallbackStepContent(finalType, stepTitle, moduleTitle, yt);
        return sendJson(res, 200, { ok: true, data: fallback, warning: 'Using fallback content because generation failed.' });
      }

      if (finalType === 'VIDEO' && yt) {
        json = json || {};
        json.data = json.data || {};
        // Prefer trusted search/curated video to avoid topic mismatches and embed failures.
        json.data.videoUrl = yt.videoUrl;
        json.data.videoWebUrl = yt.videoWebUrl;
        if (!json.data.videoTitle || String(json.data.videoTitle).trim().toLowerCase() === 'video') {
          json.data.videoTitle = yt.videoTitle;
        }
      }

      let validated = validateStepContent(finalType, json);
      if (finalType === 'FLIP_CARD') {
        const blockedKeys = extractFlashcardKeysFromReference(referenceContext);
        validated = validateStepContent(finalType, {
          ...validated,
          data: {
            ...(validated?.data || {}),
            cards: sanitizeFlashcards(validated?.data?.cards, `${moduleTitle} ${stepTitle}`, blockedKeys),
          },
        });
      }

      if (finalType === 'VIDEO') {
        const validId = extractYoutubeVideoId(validated?.data?.videoUrl) || extractYoutubeVideoId(validated?.data?.videoWebUrl);
        if (!validId) {
          const rescue = yt || await youtubeSearchEmbedNoKey(`${courseTitle} ${moduleTitle} ${stepTitle} tutorial`, getUsedVideoIds(videoRegistryKey)) || curatedVideo(`${courseTitle} ${moduleTitle} ${stepTitle}`);
          if (rescue) {
            validated = validateStepContent(effectiveType, {
              ...validated,
              data: {
                ...(validated?.data || {}),
                videoUrl: rescue.videoUrl,
                videoWebUrl: rescue.videoWebUrl,
                videoTitle: validated?.data?.videoTitle || rescue.videoTitle,
              }
            });
          }
        }
        const finalVideoId = extractYoutubeVideoId(validated?.data?.videoUrl) || extractYoutubeVideoId(validated?.data?.videoWebUrl);
        if (videoRegistryKey && finalVideoId) {
          rememberVideoIdForModule(videoRegistryKey, finalVideoId);
        }
      }
      return sendJson(res, 200, { ok: true, data: validated });
    }

    if (pathname === '/api/tutor/ask') {
      const content = body?.content;
      const question = String(body?.question || '').trim();
      if (!content || !question) return sendJson(res, 400, { error: 'content and question required' });
      const prompt = promptTutorAsk(content, question);
      const key = sha256(`ask|${JSON.stringify(content)}|${question}|${JSON.stringify(router)}`);
      const text = await routeText(router, prompt, key, 24 * 60 * 60 * 1000);
      return sendJson(res, 200, { ok: true, data: text });
    }

    if (pathname === '/api/tutor/edit') {
      const content = body?.content;
      const editPrompt = String(body?.editPrompt || '').trim();
      if (!content || !editPrompt) return sendJson(res, 400, { error: 'content and editPrompt required' });

      const key = sha256(`edit|${JSON.stringify(content)}|${editPrompt}|${JSON.stringify(router)}`);
      const prompt = promptTutorEdit(content, editPrompt);
      const text = await routeText(router, prompt, key, 24 * 60 * 60 * 1000);

      let json;
      try {
        json = extractJson(text);
      } catch (err) {
        const repairPrompt = promptTutorEditRepair(content, editPrompt, text);
        const repairKey = sha256(`edit_repair|${key}`);
        const text2 = await routeText(router, repairPrompt, repairKey, 5 * 60 * 1000);

        try {
          json = extractJson(text2);
        } catch {
          const t = String(content?.type || '').toUpperCase();
          if (t === 'TEXT') {
            const patched = {
              ...content,
              data: { ...(content.data || {}), content: String(text2 || text || '').trim() }
            };
            const validated = validateStepContent('TEXT', patched);
            return sendJson(res, 200, { ok: true, data: validated, warning: 'AI returned non-JSON; applied best-effort text edit.' });
          }

          return sendJson(res, 400, { error: 'AI returned invalid JSON. Try rephrasing your edit request.' });
        }
      }

      const validated = validateStepContent(String(content.type || ''), json);
      return sendJson(res, 200, { ok: true, data: validated });
    }

    return sendJson(res, 404, { error: 'Unknown endpoint' });

  } catch (e) {
    const status = e.status && Number.isFinite(e.status) ? e.status : 500;
    return sendJson(res, status, { error: e.message || 'Server error' });
  }
}

// ------------------------ static file serving ------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function tryServeStatic(res, pathname) {
  if (!fs.existsSync(DIST)) return false;
  let p = pathname === '/' ? '/index.html' : pathname;
  p = p.split('?')[0];
  const filePath = path.join(DIST, p);
  if (!filePath.startsWith(DIST)) return false;

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct, 'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  const indexPath = path.join(DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    fs.createReadStream(indexPath).pipe(res);
    return true;
  }

  return false;
}

// ------------------------ server ------------------------

function routeNameToPath(name) {
  if (name === 'config') return '/api/config';
  if (name === 'generate-assessment') return '/api/generate/assessment';
  if (name === 'generate-course-outline') return '/api/generate/course-outline';
  if (name === 'generate-module-lesson-plan') return '/api/generate/module-lesson-plan';
  if (name === 'generate-step-content') return '/api/generate/step-content';
  if (name === 'tutor-ask') return '/api/tutor/ask';
  if (name === 'tutor-edit') return '/api/tutor/edit';
  return null;
}

function handleNamedRoute(name, req, res) {
  const pathname = routeNameToPath(name);
  if (!pathname) return sendJson(res, 404, { error: 'Unknown endpoint' });
  return handleApi(req, res, pathname);
}

module.exports = {
  handleApi,
  handleNamedRoute,
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = u.pathname;

    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.end();

    if (pathname.startsWith('/api/')) {
      return handleApi(req, res, pathname);
    }

    if (tryServeStatic(res, pathname)) return;

    sendText(res, 200, 'Nexus AI server is running. Build the frontend (npm run build) to serve the UI from this server.');

  } catch (e) {
    sendJson(res, 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Nexus AI server listening on http://localhost:${PORT}`);
    console.log('Configured providers:', providerCandidates().filter(providerAvailable).join(', ') || '(none)');
  });
}
