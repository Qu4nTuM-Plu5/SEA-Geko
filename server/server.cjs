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

    MISTRAL_API_KEY=
    MISTRAL_API_KEYS=key1,key2,key3
    MISTRAL_MODELS=mistral-small-latest,ministral-8b-latest

    OLLAMA_API_BASE=http://127.0.0.1:11434
    OLLAMA_API_KEY=
    OLLAMA_MODELS=llama3.2:3b

    OPENROUTER_API_KEY=
    OPENROUTER_API_KEYS=key1,key2,key3,key4
    OPENROUTER_MODELS=openai/gpt-4o-mini,openai/gpt-4.1-mini,google/gemini-2.0-flash-001,deepseek/deepseek-chat

    AI_PROVIDER_CANDIDATES=openrouter,ollama,gemini,openai,anthropic

    YOUTUBE_API_KEY=  (optional)
*/

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env from project root for local development (Windows-friendly)
try {
  const runtimeEnv = {
    PORT: process.env.PORT,
    VITE_API_PORT: process.env.VITE_API_PORT,
  };
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  // Apply server/.env overrides, but do not erase non-empty root values with blank strings.
  const serverEnvPath = path.join(__dirname, '.env');
  if (fs.existsSync(serverEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(serverEnvPath));
    for (const [key, value] of Object.entries(parsed)) {
      const next = String(value ?? '').trim();
      if (!next) continue;
      process.env[key] = next;
    }
  }
  // Keep runtime-provided ports (e.g. scripts/dev-local.cjs) from being overwritten by dotenv files.
  if (String(runtimeEnv.PORT || '').trim()) process.env.PORT = String(runtimeEnv.PORT);
  if (String(runtimeEnv.VITE_API_PORT || '').trim()) process.env.VITE_API_PORT = String(runtimeEnv.VITE_API_PORT);
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
const AI_STRICT_GENERATION = !/^(0|false|no|off)$/i.test(String(process.env.AI_STRICT_GENERATION || '1').trim());
const AI_GENERATION_CACHE_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.AI_GENERATION_CACHE_ENABLED || '0').trim());
const AI_DISABLE_LOCAL_FALLBACK_CONTENT = !/^(0|false|no|off)$/i.test(String(process.env.AI_DISABLE_LOCAL_FALLBACK_CONTENT || '1').trim());
const INTERVIEW_GENERATION_DEBUG_ENABLED = (
  /^(1|true|yes|on)$/i.test(String(process.env.INTERVIEW_GENERATION_DEBUG || '').trim())
  && /^(1|true|yes|on)$/i.test(String(process.env.INTERVIEW_GENERATION_DEBUG_ALLOW || '').trim())
);
const MODULE_VIDEO_REGISTRY = new Map();
const VIDEO_REGISTRY_TTL_MS = 12 * 60 * 60 * 1000;
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_DISABLE_EMAIL_VERIFICATION = (() => {
  const raw = String(process.env.SUPABASE_DISABLE_EMAIL_VERIFICATION || process.env.AUTH_DISABLE_EMAIL_VERIFICATION || '').trim();
  if (!raw) return process.env.NODE_ENV !== 'production';
  return /^(1|true|yes|on)$/i.test(raw);
})();
const SUPABASE_AUTH_BASE = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '';
const SUPABASE_REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : '';

try {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  DISK_CACHE_ENABLED = false;
}

function defaultAppDb() {
  return {
    profiles: [],
    cvProfiles: [],
    pretests: [],
    posttests: [],
    confidence: [],
    events: [],
    publicPosts: [],
    reactions: [],
    comments: [],
    saves: [],
    reports: [],
    cohorts: [],
    cohortMembers: [],
    follows: [],
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

function interviewDebugLog(event, payload = {}) {
  if (!INTERVIEW_GENERATION_DEBUG_ENABLED) return;
  try {
    console.log(`[interview-debug] ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[interview-debug] ${event}`);
  }
}

function normalizeReactionType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'down' || raw === 'dislike' || raw === 'thumb_down' || raw === 'thumbs_down') return 'down';
  return 'up';
}

function normalizeCommentForDedup(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function buildCompletionTrend(events = []) {
  const sorted = (Array.isArray(events) ? events : [])
    .filter((row) => row && String(row.date || '').trim())
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const byDay = new Map();
  for (const row of sorted) {
    const day = String(row.date || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row);
  }

  const started = new Set();
  const completed = new Set();
  const trend = [];

  for (const [day, rows] of byDay.entries()) {
    for (const row of rows) {
      const eventType = String(row.type || '').trim();
      const userId = String(row.userId || '').trim();
      if (!userId) continue;
      if (eventType === 'course_started') started.add(userId);
      if (eventType === 'course_completed') completed.add(userId);
    }
    const learnerCount = started.size;
    const completionRate = learnerCount > 0
      ? Math.round((completed.size / learnerCount) * 1000) / 10
      : 0;
    trend.push({
      date: day,
      completionRate,
    });
  }

  const learners = started.size;
  const completedLearners = completed.size;
  const averageCompletionRate = learners > 0
    ? Math.round((completedLearners / learners) * 1000) / 10
    : 0;

  return {
    trend,
    learners,
    completedLearners,
    averageCompletionRate,
  };
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

function boolFromUnknown(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function aiRequestPolicy(router = {}) {
  const strictAi = AI_DISABLE_LOCAL_FALLBACK_CONTENT ? true : boolFromUnknown(router?.strictAi, AI_STRICT_GENERATION);
  const noCacheDefault = AI_DISABLE_LOCAL_FALLBACK_CONTENT ? true : !AI_GENERATION_CACHE_ENABLED;
  const noCache = boolFromUnknown(router?.noCache, noCacheDefault);
  return { strictAi, noCache };
}

function isInterviewValidationFailure(errLike = null) {
  const status = Number(errLike?.status || 0);
  const lower = String(errLike?.message || '').toLowerCase();
  if (status === 422) return true;
  return (
    lower.includes('failed validation')
    || lower.includes('invalid interview response')
    || lower.includes('localized interview output failed language gate')
    || lower.includes('language gate')
  );
}

function isModelUnavailableFailure(errLike = null) {
  const status = Number(errLike?.status || 0);
  const lower = String(errLike?.message || '').toLowerCase();
  if (status === 404) return true;
  return (
    lower.includes('selected ai model is unavailable')
    || lower.includes('model is unavailable')
    || lower.includes('model unavailable')
    || lower.includes('model not found')
    || lower.includes('unknown model')
    || lower.includes('not a valid model')
  );
}

function classifyAiFailure(err, context = 'AI generation failed') {
  const statusRaw = Number(err?.status || 0);
  const status = Number.isFinite(statusRaw) && statusRaw > 0 ? statusRaw : 503;
  const msg = String(err?.message || '').trim();
  const lower = msg.toLowerCase();

  if (lower.includes('no ai providers')) {
    return {
      status: 503,
      error: 'No AI providers are configured. Add a valid OpenRouter/Mistral/Ollama/Gemini/OpenAI/Anthropic credential.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status,
      error: 'AI provider rejected credentials. Verify the API key and account permissions.',
    };
  }
  if (status === 402 || lower.includes('requires more credits') || lower.includes('fewer max_tokens') || lower.includes('insufficient credits')) {
    return {
      status: 402,
      error: 'Generation exceeded token/credit budget on provider account. Reduce token limits or top up credits.',
    };
  }
  if (status === 404) {
    return {
      status,
      error: 'Selected AI model is unavailable. Switch to another model or provider.',
    };
  }
  if (status === 429) {
    return {
      status,
      error: 'AI provider rate limit reached. Retry shortly or switch provider/model.',
    };
  }
  if (isInterviewValidationFailure(err)) {
    return {
      status: 503,
      error: 'AI interview response failed validation. Retry or switch mode/provider.',
    };
  }
  if (isTimeoutOrAbortMessage(lower) || status === 408 || status === 503 || status === 504) {
    return {
      status: 503,
      error: 'AI provider timed out before completing interview generation. Retry or switch provider/model.',
    };
  }

  return {
    status: status === 0 ? 503 : status,
    error: msg ? `${context}: ${msg}` : context,
  };
}

function isTimeoutOrAbortMessage(message = '') {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('aborted')
    || lower.includes('aborterror')
    || lower.includes('operation was aborted')
  );
}

const SUPPORTED_LOCALE_CODES = new Set(['en', 'my', 'id', 'ms', 'th', 'vi', 'tl', 'km', 'lo']);

function normalizeLocaleCode(value, fallback = 'en') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (SUPPORTED_LOCALE_CODES.has(raw)) return raw;

  // Handle standard locale tags first (e.g. ms-MY, vi-VN, tl-PH)
  // so region tokens do not get misclassified as language codes.
  const localeLike = raw.replace(/[_/]+/g, '-').trim();
  const primary = localeLike.split('-').map((token) => token.trim()).filter(Boolean)[0] || '';
  if (SUPPORTED_LOCALE_CODES.has(primary)) return primary;

  const cleaned = raw.replace(/[_/]+/g, '-').replace(/[^a-z-]+/g, ' ').trim();
  const tokens = cleaned
    .split(/\s+/)
    .flatMap((token) => token.split('-'))
    .map((token) => token.trim())
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const hasToken = (...candidates) => candidates.some((candidate) => tokenSet.has(candidate));
  const hasText = (...candidates) => candidates.some((candidate) => cleaned.includes(candidate));

  if (hasToken('th') || hasText('thai')) return 'th';
  if (hasToken('my') || hasText('myanmar', 'burmese')) return 'my';
  if (hasToken('id') || hasText('indonesian', 'bahasa indonesia')) return 'id';
  if (hasToken('ms') || hasText('malay', 'bahasa melayu')) return 'ms';
  if (hasToken('vi') || hasText('vietnamese', 'tieng viet')) return 'vi';
  if (hasToken('tl', 'fil', 'ph') || hasText('filipino', 'tagalog')) return 'tl';
  if (hasToken('km', 'kh') || hasText('khmer')) return 'km';
  if (hasToken('lo', 'la') || hasText('lao')) return 'lo';
  if (hasToken('en', 'us', 'gb') || hasText('english')) return 'en';

  const short = tokens.find((token) => token.length === 2 && SUPPORTED_LOCALE_CODES.has(token));
  return short || fallback;
}

function normalizeProfileContext(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const connectivityLevel = ['offline_first', 'low_bandwidth', 'normal'].includes(String(p.connectivityLevel))
    ? String(p.connectivityLevel)
    : 'normal';
  const userSegment = ['youth', 'educator', 'displaced', 'community_org'].includes(String(p.userSegment))
    ? String(p.userSegment)
    : 'youth';
  const preferredLanguage = normalizeLocaleCode(p.preferredLanguage, 'en');
  return {
    userSegment,
    connectivityLevel,
    preferredLanguage,
    learningGoal: String(p.learningGoal || ''),
    region: String(p.region || 'ASEAN'),
    lowBandwidthMode: !!p.lowBandwidthMode,
  };
}

function normalizeProfessionalVisibility(value) {
  return String(value || '').toLowerCase() === 'public' ? 'public' : 'private';
}

function localeDisplayName(locale) {
  const map = {
    en: 'English',
    my: 'Burmese (Myanmar)',
    id: 'Indonesian',
    ms: 'Malay',
    th: 'Thai',
    vi: 'Vietnamese',
    tl: 'Filipino',
    km: 'Khmer',
    lo: 'Lao',
  };
  return map[normalizeLocaleCode(locale, 'en')] || 'English';
}

function profileRulesText(profileContext = {}) {
  const p = normalizeProfileContext(profileContext);
  const lines = [
    `- Audience segment: ${p.userSegment}`,
    `- Connectivity level: ${p.connectivityLevel}`,
    `- Output language code: ${p.preferredLanguage} (${localeDisplayName(p.preferredLanguage)})`,
    `- CRITICAL: All learner-facing text MUST be in ${localeDisplayName(p.preferredLanguage)} only.`,
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
  if (p.lowBandwidthMode || p.connectivityLevel === 'offline_first') {
    lines.push('- Prefer text-first explanations and lightweight activities. Minimize video dependency.');
  }

  return lines.join('\n');
}

function truncateText(value, max = 8000) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeStringArray(input, limit = 12) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (!out.includes(value)) out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeCvTextFragment(value, max = 240) {
  const clipped = truncateText(value || '', Math.max(40, max * 2));
  if (!clipped) return '';
  return clipped
    .replace(/[â€¢â—â–ªâ—¦]/g, ' ')
    .replace(/\b(?:-?\d{4,}\s+){1,}-?\d{2,}\b/g, ' ')
    .replace(/\b0\s+0\b/g, ' ')
    .replace(/^(?:about me|profile|summary|email address|address)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const CV_SECTION_HEADING_RE = /\b(?:personal information|about me|education(?: and training)?|work experience|language skills|digital skills|hobbies and interests|email address|job applied for|position|replace with)\b/i;
const CV_TEMPLATE_NOTICE_RE = /\b(?:dear job seeker|how to make a good resume|skills to put on a resume|resume objective examples|basic resume templates|modern resume templates|creative resume templates|professional resume templates|copyright|azurius|my-resume-templates|contact@my-resume-templates\.com|nota importante|union europea|uniÃ³n europea)\b/i;

function isLikelyCvNoise(value) {
  const text = normalizeCvTextFragment(value || '', 400);
  if (!text) return true;
  if (/^(?:-?\d+\s*){2,}$/.test(text)) return true;
  if (/^[\W_]+$/u.test(text)) return true;
  if (CV_SECTION_HEADING_RE.test(text)) return true;
  if (CV_TEMPLATE_NOTICE_RE.test(text)) return true;
  if (/\breplace with\b/i.test(text)) return true;
  const hasLetter = /\p{L}/u.test(text);
  const digitCount = (text.match(/\d/g) || []).length;
  const weirdCharCount = (text.match(/[^\x20-\x7e]/g) || []).length;
  const asciiWordCount = (text.match(/[A-Za-z]{2,}/g) || []).length;
  if (!hasLetter && digitCount >= 3) return true;
  if (digitCount >= 8 && !/\b(?:20\d{2}|19\d{2}|c[12])\b/i.test(text)) return true;
  if (/\b(?:modeles?-de-cv|azurius)\b/i.test(text)) return true;
  if (/@/.test(text) && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text)) return true;
  if (weirdCharCount >= 6 && asciiWordCount <= 1) return true;
  if (weirdCharCount > Math.max(8, Math.floor(text.length * 0.2)) && !/@/.test(text)) return true;
  return false;
}

function normalizeCvStringArray(input, limit = 12, maxItemLen = 120) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const value = normalizeCvTextFragment(raw, maxItemLen);
    if (!value || isLikelyCvNoise(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeCvParsedProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const normalizeExperience = (value) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const role = normalizeCvTextFragment(item.role || '', 140);
      const organization = normalizeCvTextFragment(item.organization || '', 140);
      const period = normalizeCvTextFragment(item.period || '', 100);
      const highlights = normalizeCvStringArray(item.highlights, 4, 220);
      if (!role && !organization && !highlights.length) continue;
      out.push({
        role,
        organization,
        period,
        highlights,
      });
      if (out.length >= 8) break;
    }
    return out;
  };
  const normalizeEducation = (value) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const program = normalizeCvTextFragment(item.program || '', 140);
      const institution = normalizeCvTextFragment(item.institution || '', 140);
      const period = normalizeCvTextFragment(item.period || '', 100);
      if (!program && !institution) continue;
      out.push({
        program,
        institution,
        period,
      });
      if (out.length >= 8) break;
    }
    return out;
  };
  const summary = normalizeCvTextFragment(src.summary || '', 1400);
  const profileImageDataUrl = (() => {
    const image = truncateText(src.profileImageDataUrl || '', 5_000_000);
    if (!image) return '';
    if (!/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,[a-z0-9+/=\r\n]+$/i.test(image)) return '';
    return image;
  })();
  return {
    fullName: normalizeCvTextFragment(src.fullName || '', 120),
    headline: normalizeCvTextFragment(src.headline || '', 220),
    summary: isLikelyCvNoise(summary) ? '' : summary,
    location: normalizeCvTextFragment(src.location || '', 120),
    email: normalizeCvTextFragment(src.email || '', 160),
    phone: normalizeCvTextFragment(src.phone || '', 80),
    profileImageDataUrl,
    skills: normalizeCvStringArray(src.skills, 20, 120),
    languages: normalizeCvStringArray(src.languages, 12, 80),
    experience: normalizeExperience(src.experience),
    education: normalizeEducation(src.education),
    certifications: normalizeCvStringArray(src.certifications, 12, 140),
  };
}

function mergeCvParsedProfiles(primary, fallback) {
  const p = normalizeCvParsedProfile(primary || {});
  const f = normalizeCvParsedProfile(fallback || {});
  return normalizeCvParsedProfile({
    fullName: p.fullName || f.fullName || '',
    headline: p.headline || f.headline || '',
    summary: p.summary || f.summary || '',
    location: p.location || f.location || '',
    email: p.email || f.email || '',
    phone: p.phone || f.phone || '',
    profileImageDataUrl: p.profileImageDataUrl || f.profileImageDataUrl || '',
    skills: p.skills.length ? p.skills : f.skills,
    languages: p.languages.length ? p.languages : f.languages,
    experience: p.experience.length ? p.experience : f.experience,
    education: p.education.length ? p.education : f.education,
    certifications: p.certifications.length ? p.certifications : f.certifications,
  });
}

function deriveDisplayName(ownerId, email = '', cvParsed = null) {
  const parsed = cvParsed && typeof cvParsed === 'object' ? cvParsed : null;
  const fullName = normalizeCvTextFragment(parsed?.fullName || '', 120);
  if (fullName) return fullName;
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail.includes('@')) {
    const namePart = cleanEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
    if (namePart) {
      return namePart.replace(/\b\w/g, (s) => s.toUpperCase()).slice(0, 120);
    }
  }
  const id = String(ownerId || '').trim();
  if (!id) return 'Creator';
  return `Creator ${id.slice(0, 8)}`;
}

function normalizeCvLines(raw) {
  return String(raw || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeCvTextFragment(line, 280))
    .filter(Boolean)
    .filter((line) => !/^(?:-?\d+\s*){3,}$/.test(line))
    .filter((line) => !CV_TEMPLATE_NOTICE_RE.test(line));
}

function classifyCvSectionHeading(line) {
  const normalized = String(line || '')
    .toLowerCase()
    .replace(/[^a-z():\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  const squashed = normalized.replace(/\s+/g, '');
  if (squashed === 'aboutme' || squashed === 'profile' || squashed === 'summary' || squashed === 'objective' || squashed === 'professionalsummary') return 'summary';
  if (
    squashed === 'experience'
    || squashed === 'workexperience'
    || squashed === 'professionalexperience'
    || squashed === 'employmenthistory'
    || squashed === 'selfprojectsandexperiences'
    || squashed === 'projectsandexperiences'
    || squashed === 'projectexperience'
    || squashed === 'competitionexperiences'
    || squashed === 'businessprojects'
    || squashed === 'projects'
  ) return 'experience';
  if (squashed === 'educationandtraining' || squashed === 'education' || squashed === 'education&certifications' || squashed === 'educationcertifications') return 'education';
  if (squashed === 'certification' || squashed === 'certifications' || squashed === 'licenses' || squashed === 'licences') return 'certifications';
  if (squashed === 'references' || squashed === 'reference') return 'references';
  if (squashed === 'contact' || squashed === 'contacts' || squashed === 'contactinformation') return 'contact';
  if (squashed === 'languageskills' || squashed === 'languages') return 'languages';
  if (
    squashed === 'digitalskills'
    || squashed === 'coreskills'
    || squashed === 'technicalskills'
    || squashed === 'skills'
    || squashed === 'skillhighlights'
    || squashed === 'programmingskills'
    || squashed === 'programminglanguages'
    || squashed === 'techstack'
  ) return 'skills';
  if (/^(about me|profile|summary|objective)\s*:?\s*$/.test(normalized)) return 'summary';
  if (/^(experience|work experience|professional experience|employment history|self projects and experiences?|projects and experiences?|project experience|competition experiences?|business projects?)\s*:?\s*$/.test(normalized)) return 'experience';
  if (/^(education and training|education|education certifications?|education & certifications?)\s*:?\s*$/.test(normalized)) return 'education';
  if (/^(certifications?|licenses?)\s*:?\s*$/.test(normalized)) return 'certifications';
  if (/^(references?)\s*:?\s*$/.test(normalized)) return 'references';
  if (/^(contact|contact information)\s*:?\s*$/.test(normalized)) return 'contact';
  if (/^(language skills|languages?)\s*:?\s*$/.test(normalized)) return 'languages';
  if (/^(digital skills|core skills|technical skills|skills|skill highlights?|programming skills|programming languages?|tech stack)\s*:?\s*$/.test(normalized)) return 'skills';
  return null;
}

function splitCvSections(lines) {
  const sections = {
    header: [],
    summary: [],
    experience: [],
    education: [],
    certifications: [],
    languages: [],
    skills: [],
    references: [],
    contact: [],
    other: [],
  };
  let active = 'header';

  for (const line of lines) {
    const headingType = classifyCvSectionHeading(line);
    if (headingType) {
      active = headingType;
      continue;
    }

    const summaryInline = line.match(/^(?:about me|profile|summary|objective)\s*:\s*(.+)$/i);
    if (summaryInline?.[1]) {
      active = 'summary';
      sections.summary.push(summaryInline[1].trim());
      continue;
    }

    if (/^(?:mother tongue\(s\)|other language\(s\))\s*:/i.test(line)) {
      active = 'languages';
      sections.languages.push(line);
      continue;
    }

    if (/^(?:digital skills|core skills|technical skills)\s*:/i.test(line)) {
      active = 'skills';
      const tail = line.replace(/^(?:digital skills|core skills|technical skills)\s*:\s*/i, '').trim();
      if (tail) sections.skills.push(tail);
      continue;
    }
    if (/^(?:skill highlights?)\s*:/i.test(line)) {
      active = 'skills';
      const tail = line.replace(/^(?:skill highlights?)\s*:\s*/i, '').trim();
      if (tail) sections.skills.push(tail);
      continue;
    }
    if (/^(?:programming skills|programming languages?|tech stack)\s*:/i.test(line)) {
      active = 'skills';
      const tail = line.replace(/^(?:programming skills|programming languages?|tech stack)\s*:\s*/i, '').trim();
      if (tail) sections.skills.push(tail);
      continue;
    }
    if (/^(?:certifications?|licenses?)\s*:/i.test(line)) {
      active = 'certifications';
      const tail = line.replace(/^(?:certifications?|licenses?)\s*:\s*/i, '').trim();
      if (tail) sections.certifications.push(tail);
      continue;
    }
    if (/^(?:references?)\s*:/i.test(line)) {
      active = 'references';
      const tail = line.replace(/^(?:references?)\s*:\s*/i, '').trim();
      if (tail) sections.references.push(tail);
      continue;
    }
    if (/^(?:phone|mobile|tel|e-?mail|email|linkedin|contact|address|location)\s*:/i.test(line)) {
      active = 'contact';
      sections.contact.push(line);
      continue;
    }

    if (sections[active]) sections[active].push(line);
    else sections.other.push(line);
  }

  return sections;
}

function splitRoleOrganization(line) {
  const clean = normalizeCvTextFragment(line, 180);
  if (!clean || isLikelyCvNoise(clean)) return { role: '', organization: '' };
  if (CV_SECTION_HEADING_RE.test(clean)) return { role: '', organization: '' };
  const parts = clean.split(/\s+[-\u2013]\s+/);
  if (parts.length >= 2) {
    return {
      role: normalizeCvTextFragment(parts[0], 120),
      organization: normalizeCvTextFragment(parts.slice(1).join(' - '), 140),
    };
  }
  const words = clean.split(/\s+/g).filter(Boolean);
  if (words.length > 8) return { role: '', organization: '' };
  if (/[.!?]$/.test(clean) && words.length >= 2) return { role: '', organization: '' };
  if (!/[A-Za-z]/.test(clean)) return { role: '', organization: '' };
  return { role: normalizeCvTextFragment(clean, 120), organization: '' };
}

function isCvPeriodLine(line) {
  const text = normalizeCvTextFragment(line, 160).toLowerCase();
  if (!text) return false;
  if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(text) && /\b(?:present|\d{1,2}\/\d{1,2}\/\d{4})\b/.test(text)) return true;
  if (/\b20\d{2}\b/.test(text) && /\b(?:present|20\d{2})\b/.test(text)) return true;
  return false;
}

function parseCvExperienceSection(lines) {
  const out = [];
  let pendingPeriod = '';
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.role || current.organization || (current.highlights && current.highlights.length)) {
      out.push({
        role: normalizeCvTextFragment(current.role || '', 140),
        organization: normalizeCvTextFragment(current.organization || '', 140),
        period: normalizeCvTextFragment(current.period || '', 100),
        highlights: normalizeCvStringArray(current.highlights || [], 5, 220),
      });
    }
    current = null;
  };

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeCvTextFragment(rawLine, 220);
    if (!line || isLikelyCvNoise(line) || CV_TEMPLATE_NOTICE_RE.test(line)) continue;
    if (isCvPeriodLine(line)) {
      pendingPeriod = line;
      continue;
    }
    if (/^[\u2022\u25CF\u25AA\u25E6-]\s*/.test(rawLine || '')) {
      if (!current) current = { role: '', organization: '', period: pendingPeriod, highlights: [] };
      current.highlights.push(line.replace(/^[\u2022\u25CF\u25AA\u25E6-]\s*/, ''));
      continue;
    }

    const roleOrg = splitRoleOrganization(line);
    if (roleOrg.role || roleOrg.organization) {
      if (current) pushCurrent();
      current = {
        role: roleOrg.role,
        organization: roleOrg.organization,
        period: pendingPeriod,
        highlights: [],
      };
      pendingPeriod = '';
      continue;
    }

    if (current) current.highlights.push(line);
  }

  pushCurrent();
  return out.slice(0, 8);
}

function parseCvEducationSection(lines) {
  const out = [];
  let pendingPeriod = '';
  let pendingProgram = '';

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeCvTextFragment(rawLine, 180);
    if (!line || isLikelyCvNoise(line) || CV_TEMPLATE_NOTICE_RE.test(line)) continue;
    if (/^(?:references?|phone|mobile|tel|email|e-?mail|linkedin|contact|languages?|skills?)\b/i.test(line)) continue;
    if (/^(?:programming languages?|technical skills?|skill highlights?)\s*:/i.test(line)) continue;
    if (
      /\b(?:senior|junior|developer|engineer|specializing|experienced|project manager)\b/i.test(line)
      && !/\b(?:university|college|institute|bachelor|master|phd|degree|diploma|certificate)\b/i.test(line)
    ) {
      continue;
    }
    if (isCvPeriodLine(line)) {
      pendingPeriod = line;
      continue;
    }
    const parts = line.split(/\s+[-\u2013]\s+/);
    if (parts.length >= 2) {
      out.push({
        program: normalizeCvTextFragment(parts[0], 140),
        institution: normalizeCvTextFragment(parts.slice(1).join(' - '), 140),
        period: normalizeCvTextFragment(pendingPeriod, 100),
      });
      pendingProgram = '';
      pendingPeriod = '';
      continue;
    }
    if (!pendingProgram) {
      pendingProgram = line;
      continue;
    }
    out.push({
      program: normalizeCvTextFragment(pendingProgram, 140),
      institution: normalizeCvTextFragment(line, 140),
      period: normalizeCvTextFragment(pendingPeriod, 100),
    });
    pendingProgram = '';
    pendingPeriod = '';
  }

  return out
    .filter((item) => item.program || item.institution)
    .slice(0, 8);
}

const CV_LANGUAGE_TERMS = new Set([
  'english', 'spanish', 'chinese', 'mandarin', 'french', 'german', 'italian', 'portuguese', 'russian',
  'japanese', 'korean', 'arabic', 'hindi', 'bengali', 'burmese', 'myanmar', 'thai', 'vietnamese', 'khmer',
  'lao', 'filipino', 'tagalog', 'indonesian', 'malay', 'urdu', 'turkish', 'dutch', 'swedish', 'norwegian',
  'danish', 'finnish', 'polish', 'ukrainian', 'czech', 'greek',
]);

function isLikelyLanguageLabel(value) {
  const line = normalizeCvTextFragment(value, 120).toLowerCase();
  if (!line) return false;
  if (/\b(?:experience|education|reference|skills?|certification|phone|email|linkedin|developer)\b/i.test(line)) return false;
  if (/\b(?:a1|a2|b1|b2|c1|c2|native|fluent|intermediate|beginner)\b/i.test(line)) return true;
  const core = line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-â€“:,]/g, ' ')
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, 3);
  return core.some((token) => CV_LANGUAGE_TERMS.has(token));
}

function parseCvLanguagesSection(lines, raw) {
  const found = [];
  const lowerRaw = String(raw || '').toLowerCase();
  const mother = lowerRaw.match(/mother tongue\(s\)\s*:\s*([^\n\r]+)/i);
  if (mother?.[1]) {
    found.push(`${normalizeCvTextFragment(mother[1], 80)} (mother tongue)`);
  }
  const other = lowerRaw.match(/other language\(s\)\s*:\s*([^\n\r]+)/i);
  if (other?.[1]) {
    const values = normalizeCvTextFragment(other[1], 120)
      .split(/[,/|;]/g)
      .map((x) => normalizeCvTextFragment(x, 60))
      .filter(Boolean);
    for (const lang of values) found.push(lang);
  }

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeCvTextFragment(rawLine, 180);
    if (!line || isLikelyCvNoise(line)) continue;
    if (/^(?:understanding|speaking|writing|mother tongue\(s\)|other language\(s\))[:\s]/i.test(line)) continue;
    if (/^(?:references?|phone|mobile|tel|email|e-?mail|linkedin|contact|experience|education|skills?)\b/i.test(line)) continue;
    const m = line.match(/^([A-Za-z][A-Za-z\s-]{1,30})\s*(?:[-â€“:]\s*)?(A1|A2|B1|B2|C1|C2)\b/i);
    if (m) {
      found.push(`${normalizeCvTextFragment(m[1], 60)} (${String(m[2] || '').toUpperCase()})`);
      continue;
    }
    if (isLikelyLanguageLabel(line)) {
      found.push(normalizeCvTextFragment(line, 70));
      continue;
    }
    const listed = line
      .split(/[|/,;]+/g)
      .map((x) => normalizeCvTextFragment(x, 60))
      .filter((x) => isLikelyLanguageLabel(x));
    if (listed.length) {
      found.push(...listed);
    }
  }

  return normalizeCvStringArray(found, 12, 90);
}

function parseCvDigitalSkills(lines) {
  const tokens = [];
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeCvTextFragment(rawLine, 260);
    if (!line || isLikelyCvNoise(line)) continue;
    if (/^(?:references?|phone|mobile|tel|email|e-?mail|linkedin|contact|languages?)\b/i.test(line)) continue;
    const body = line.replace(/^(?:programming languages?|technical skills?|skill highlights?|skills?)\s*:\s*/i, '');
    const parts = body
      .split(/[|/,;]+/g)
      .map((x) => normalizeCvTextFragment(x, 100))
      .filter(Boolean)
      .filter((x) => !CV_SECTION_HEADING_RE.test(x))
      .filter((x) => !/@/.test(x));
    tokens.push(...parts);
  }
  return normalizeCvStringArray(tokens, 20, 110);
}

function parseCvCertificationSection(lines) {
  const out = [];
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeCvTextFragment(rawLine, 220);
    if (!line || isLikelyCvNoise(line)) continue;
    if (/^(?:references?|phone|mobile|tel|email|e-?mail|linkedin|contact|languages?)\b/i.test(line)) continue;
    if (/^(?:programming languages?|technical skills?|skill highlights?)\s*:/i.test(line)) continue;
    const cleaned = line.replace(/^[\u2022\u25CF\u25AA\u25E6-]\s*/, '');
    if (!cleaned) continue;
    if (/\b(?:certification|certificate|certified|license|passport|exam)\b/i.test(cleaned)) {
      out.push(cleaned);
    }
  }
  return normalizeCvStringArray(out, 12, 140);
}

function extractBasicCvProfile(text) {
  const raw = String(text || '');
  const lines = normalizeCvLines(raw);
  const sections = splitCvSections(lines);
  const fullName = (() => {
    const blockedNameLine = /\b(?:resume|curriculum|vitae|canva|template|modern minimalist)\b/i;
    const contactLine = /^(?:-+\s*)?(?:phone|mobile|tel|email|e-?mail|linkedin|contact|address|location)\s*:?\s*/i;
    const isNameCandidate = (line) => {
      if (line.length < 3 || line.length > 80) return false;
      if (line.includes('@') || /\d/.test(line)) return false;
      if (CV_SECTION_HEADING_RE.test(line)) return false;
      if (blockedNameLine.test(line)) return false;
      if (contactLine.test(line)) return false;
      if (/^(?:education|skills?|languages?|contact|experience|projects?|references?)$/i.test(line)) return false;
      const words = line.split(/\s+/g).filter(Boolean);
      return words.length >= 2 && words.length <= 5 && words.every((w) => /^[A-Za-z][A-Za-z'-]{1,}$/.test(w));
    };
    const candidates = [
      ...(sections.header || []).slice(0, 80),
      ...lines.slice(0, 260),
    ];
    for (const line of candidates) {
      if (!isNameCandidate(line)) continue;
      return line;
    }
    return '';
  })();
  const summaryMatch = raw.match(/(?:profile|summary|about me)\s*:?\s*([^\n]{20,800})/i);
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneLineMatch = lines.find((line) => /^(?:phone|mobile|tel)\s*:/i.test(line));
  const phoneMatch = (phoneLineMatch && phoneLineMatch.match(/\+?\d[\d\s().-]{6,}\d/)) || raw.match(/\+?\d[\d\s().-]{6,}\d/);
  const addressLine = lines.find((line) => /^(?:address|location)\s*:/i.test(line))
    || lines.find((line) => /\b[a-z]{2,}\s*,\s*[a-z]{2,}\b/i.test(line))
    || '';
  const summary = (() => {
    const sectionSummary = normalizeCvTextFragment((sections.summary || []).slice(0, 6).join(' '), 600);
    if (sectionSummary && !isLikelyCvNoise(sectionSummary)) return sectionSummary;
    return summaryMatch ? normalizeCvTextFragment(summaryMatch[1], 600) : '';
  })();
  let experience = parseCvExperienceSection(sections.experience || []);
  if (!experience.length) {
    const inferredExperience = [
      ...(sections.experience || []),
      ...(sections.other || []).filter((line) =>
        /\b(?:project|experience|intern|developer|engineer|challenge|competition|platform|scanner|bot)\b/i.test(line)
      ),
    ];
    experience = parseCvExperienceSection(inferredExperience);
  }
  let education = parseCvEducationSection(sections.education || []);
  if (!education.length) {
    const inferredEducation = [
      ...(sections.education || []),
      ...(sections.certifications || []).filter((line) => /\b(?:university|college|institute|bachelor|master|undergraduate|degree|training|school)\b/i.test(line)),
      ...(sections.other || []).filter((line) =>
        /\b(?:university|college|institute|bachelor|undergraduate|degree|training|school)\b/i.test(line)
      ),
    ];
    education = parseCvEducationSection(inferredEducation);
  }
  const languages = parseCvLanguagesSection([
    ...(sections.languages || []),
    ...(sections.other || []).filter((line) => /\b(?:a1|a2|b1|b2|c1|c2|native|fluent|intermediate|beginner)\b/i.test(String(line || ''))),
  ], raw);
  let skillCandidates = parseCvDigitalSkills(sections.skills || []);
  skillCandidates = normalizeCvStringArray([
    ...skillCandidates,
    ...(sections.certifications || [])
      .filter((line) => /^(?:programming languages?|technical skills?|skill highlights?)\s*:/i.test(String(line || '')))
      .flatMap((line) => String(line || '').split(/[|/,;]+/g)),
  ], 20, 110);
  if (!skillCandidates.length) {
    skillCandidates = normalizeCvStringArray(
      lines
        .filter((line) => /\b(?:office|word|excel|powerpoint|photoshop|wordpress|outlook|email marketing|google drive|google docs|figma|canva|illustrator|react|next|python|java|javascript|typescript|node|c\+\+|c#|js|telegram bot|cybersecurity|web development|gmail scanner)\b/i.test(line))
        .flatMap((line) => line.split(/[|/,;]+/g))
        .map((x) => normalizeCvTextFragment(x, 90)),
      20,
      90
    );
  }
  const certifications = parseCvCertificationSection([
    ...(sections.certifications || []),
    ...(sections.education || []).filter((line) => /\b(?:certification|certificate|certified|license|passport|exam)\b/i.test(String(line || ''))),
    ...(sections.other || []).filter((line) => /\b(?:certification|certificate|certified|license|passport|exam)\b/i.test(String(line || ''))),
  ]);

  return normalizeCvParsedProfile({
    fullName,
    headline: experience[0]?.role || '',
    summary,
    location: addressLine ? addressLine.replace(/^(?:address|location)\s*:\s*/i, '') : '',
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneMatch ? phoneMatch[0] : '',
    skills: skillCandidates,
    languages,
    experience,
    education,
    certifications,
    profileImageDataUrl: '',
  });
}

function analyzeCvHeuristics(text, declaredFormat, fileName, mimeType) {
  const clean = String(text || '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\u0000/g, '')
    .trim();
  const parsedProfile = extractBasicCvProfile(clean);
  const lower = clean.toLowerCase();
  const lowerFileName = String(fileName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  const words = clean.split(/\s+/g).filter(Boolean);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(clean);
  const hasPhone = /\+?\d[\d\s().-]{6,}\d/.test(clean);
  const sectionGroups = [
    { id: 'experience', terms: ['work experience', 'professional experience', 'employment', 'work history', 'experience'] },
    { id: 'education', terms: ['education and training', 'education', 'academic background', 'qualification', 'studies'] },
    { id: 'skills', terms: ['digital skills', 'technical skills', 'core skills', 'skills', 'competencies'] },
    { id: 'summary', terms: ['profile', 'professional summary', 'summary', 'about me', 'objective'] },
  ];
  const europassKeywords = [
    'europass',
    'curriculum vitae',
    'personal information',
    'work experience',
    'education and training',
    'language skills',
  ];
  const coreSectionsHit = sectionGroups.filter((section) => section.terms.some((term) => lower.includes(term)));
  const sectionHits = coreSectionsHit.length;
  const europassHits = europassKeywords.filter((k) => lower.includes(k)).length;
  const looksLikeResumeFile = /(cv|curriculum|resume|europass)/i.test(lowerFileName)
    || /(wordprocessingml\.document|msword|rtf|pdf)/i.test(lowerMime);
  const alphaChars = (clean.match(/[a-z]/gi) || []).length;
  const nonAlphaChars = Math.max(0, clean.length - alphaChars);
  const noiseRatio = clean.length ? (nonAlphaChars / clean.length) : 1;
  const imageLike = /^image\//i.test(String(mimeType || '').trim());
  const templateMarkerTerms = [
    'dear job seeker',
    'how to make a good resume',
    'skills to put on a resume',
    'resume objective examples',
    'basic resume templates',
    'modern resume templates',
    'creative resume templates',
    'professional resume templates',
    'copyright',
    'my-resume-templates',
    'azurius',
    'nota importante',
    'union europea',
    'uniÃ³n europea',
  ];
  const templateMarkerHits = templateMarkerTerms.filter((term) => lower.includes(term)).length;
  const placeholderHits = (clean.match(/\b(?:replace with|state e-mail address|state personal website|job applied for)\b/gi) || []).length;
  const hasParsedExperience = Array.isArray(parsedProfile.experience) && parsedProfile.experience.length > 0;
  const hasParsedEducation = Array.isArray(parsedProfile.education) && parsedProfile.education.length > 0;
  const hasParsedSkills = Array.isArray(parsedProfile.skills) && parsedProfile.skills.length >= 3;
  const hasParsedLanguages = Array.isArray(parsedProfile.languages) && parsedProfile.languages.length > 0;
  const signalScore = (looksLikeResumeFile ? 1 : 0)
    + ((hasEmail || hasPhone) ? 1 : 0)
    + (sectionHits >= 1 ? 1 : 0)
    + (hasParsedExperience ? 1 : 0)
    + (hasParsedEducation ? 1 : 0)
    + (hasParsedSkills ? 1 : 0)
    + (hasParsedLanguages ? 1 : 0)
    + (words.length >= 80 ? 1 : 0);
  const issues = [];

  if (imageLike) {
    issues.push('Image-only files are not accepted. Upload a CV document with readable text.');
  }
  if (clean.length < 120 || words.length < 20) {
    issues.push('CV text is too short to validate. Upload a full CV document.');
  }
  if (templateMarkerHits >= 3 && !hasParsedExperience && !hasParsedEducation && !hasEmail && !hasPhone) {
    issues.push('Template helper/copyright text detected. Upload your filled personal CV, not a template notice page.');
  }
  if (placeholderHits >= 2 && !hasParsedExperience && !hasParsedEducation) {
    issues.push('Detected placeholder text in the CV. Replace template placeholders with real personal details.');
  }
  if (noiseRatio > 0.78 && uniqueWords.size < 24 && sectionHits === 0) {
    issues.push('Uploaded file looks like random or unreadable content.');
  }
  if (issues.length === 0 && signalScore < 2) {
    issues.push('Could not confirm this file as a CV. Please upload a CV with clearer profile details.');
  }

  const valid = issues.length === 0;
  const detectedFormat = europassHits >= 2
    ? 'europass'
    : (looksLikeResumeFile || sectionHits >= 1 || hasParsedExperience || hasParsedEducation || hasParsedSkills)
      ? 'other'
      : 'unknown';
  const confidence = valid
    ? Math.max(0.72, Math.min(0.99, 0.45 + (signalScore * 0.08) + (sectionHits * 0.04) + ((hasEmail || hasPhone) ? 0.04 : 0)))
    : Math.max(0.15, 0.58 - (issues.length * 0.1));

  return {
    valid,
    format: valid ? detectedFormat : 'unknown',
    confidence: Number(confidence.toFixed(2)),
    issues,
    parsed: parsedProfile,
    fileName: truncateText(fileName || '', 220),
    mimeType: truncateText(mimeType || '', 120),
  };
}

function normalizeCvAnalysisResult(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const rawFormat = String(src.format || base.format || 'unknown').toLowerCase();
  const normalizedFormat = rawFormat === 'europass' || rawFormat === 'other' ? rawFormat : 'unknown';
  const normalizedIssues = normalizeStringArray(src.issues ?? base.issues, 12)
    .map((issue) => {
      const text = String(issue || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      if (/please choose europass format/i.test(text)) {
        return 'Please upload a CV document with readable text.';
      }
      return text
        .replace(/europass-style/ig, 'CV')
        .replace(/europass cv structure/ig, 'CV structure')
        .replace(/\beuropass\b/ig, 'CV');
    })
    .filter(Boolean)
    .slice(0, 6);
  const mergedParsed = mergeCvParsedProfiles(src.parsed || {}, base.parsed || {});
  return {
    valid: !!(src.valid ?? base.valid),
    format: normalizedFormat,
    confidence: Math.max(0, Math.min(1, Number(src.confidence ?? base.confidence ?? 0))),
    issues: normalizedIssues,
    fileName: truncateText(src.fileName || base.fileName || '', 220),
    mimeType: truncateText(src.mimeType || base.mimeType || '', 120),
    parsed: mergedParsed,
    updatedAt: nowIso(),
  };
}

async function analyzeCvWithAi(text, declaredFormat, fileName, mimeType, router, profileContext) {
  const heuristic = analyzeCvHeuristics(text, declaredFormat, fileName, mimeType);
  const lowerIssues = (heuristic.issues || []).map((s) => String(s || '').toLowerCase());
  const hardReject = lowerIssues.some((s) => s.includes('image-only'))
    || lowerIssues.some((s) => s.includes('too short'))
    || lowerIssues.some((s) => s.includes('random or unreadable'));
  if (hardReject) {
    return normalizeCvAnalysisResult(heuristic, heuristic);
  }

  if (!router || typeof router !== 'object') {
    return normalizeCvAnalysisResult(heuristic, heuristic);
  }

  const sampleText = truncateText(String(text || ''), 14000);
  const prompt = `Return ONLY valid JSON (no markdown, no extra text).\n\nYou are validating whether this uploaded file is a real CV/resume document and extracting profile details.\n\nRules:\n- Reject random documents, images, or unrelated text.\n- Accept standard CV/resume structures (Europass or non-Europass).\n- Keep extracted values concise and professional.\n- If uncertain, mark valid=false and explain in issues.\n\nInput metadata:\n- declaredFormat: ${declaredFormat}\n- fileName: ${fileName}\n- mimeType: ${mimeType}\n- preferredLanguage: ${profileContext.preferredLanguage}\n\nCV text:\n${sampleText}\n\nJSON shape:\n{\n  "valid": boolean,\n  "format": "europass" | "other" | "unknown",\n  "confidence": number,\n  "issues": string[],\n  "fileName": string,\n  "mimeType": string,\n  "parsed": {\n    "fullName": string,\n    "headline": string,\n    "summary": string,\n    "location": string,\n    "email": string,\n    "phone": string,\n    "skills": string[],\n    "languages": string[],\n    "experience": [{ "role": string, "organization": string, "period": string, "highlights": string[] }],\n    "education": [{ "program": string, "institution": string, "period": string }],\n    "certifications": string[]\n  }\n}`;

  try {
    const aiJson = await routeJsonWithRepair(
      router,
      prompt,
      `cv-analyze|${sha256(`${fileName}|${mimeType}|${sampleText.slice(0, 6000)}`)}`,
      { passes: 2, ttlMs: 30 * 60 * 1000, routeOptions: { skipCache: true } }
    );
    const aiResult = normalizeCvAnalysisResult(aiJson, heuristic);
    const aiFormat = aiResult.format === 'unknown'
      ? (heuristic.format === 'unknown' ? 'other' : heuristic.format)
      : aiResult.format;
    const mergedValid = !!(heuristic.valid || aiResult.valid);
    const mergedIssues = mergedValid
      ? []
      : Array.from(new Set([...(heuristic.issues || []), ...(aiResult.issues || [])])).slice(0, 6);
    const mergedParsed = mergeCvParsedProfiles(aiResult.parsed || {}, heuristic.parsed || {});
    return normalizeCvAnalysisResult({
      valid: mergedValid,
      format: aiFormat,
      confidence: Math.max(heuristic.confidence || 0, aiResult.confidence || 0),
      issues: mergedIssues,
      parsed: mergedParsed,
      fileName: aiResult.fileName || heuristic.fileName || fileName,
      mimeType: aiResult.mimeType || heuristic.mimeType || mimeType,
    }, heuristic);
  } catch {
    return normalizeCvAnalysisResult(heuristic, heuristic);
  }
}

function targetScriptRegex(locale) {
  const code = String(locale || 'en').toLowerCase();
  if (code === 'my') return /[\u1000-\u109f\uaa60-\uaa7f]/g;
  if (code === 'th') return /[\u0e00-\u0e7f]/g;
  if (code === 'km') return /[\u1780-\u17ff]/g;
  if (code === 'lo') return /[\u0e80-\u0eff]/g;
  return null;
}

function collectStringSamples(value, out = [], depth = 0) {
  if (depth > 5 || out.length >= 80) return out;
  if (typeof value === 'string') {
    const clean = value.trim();
    if (clean && !/^https?:\/\//i.test(clean) && clean.length >= 3) out.push(clean);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringSamples(item, out, depth + 1);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^(id|courseId|ownerId|videoUrl|videoWebUrl|image|imageUrl|icon|layout|type|status|createdAt|updatedAt)$/i.test(k)) continue;
      collectStringSamples(v, out, depth + 1);
    }
  }
  return out;
}

function needsLocaleTranslation(payload, locale) {
  const rx = targetScriptRegex(locale);
  if (!rx) return false;
  const sample = collectStringSamples(payload).join(' ');
  if (!sample) return false;
  const matches = sample.match(rx) || [];
  return matches.length < 8;
}

async function enforcePreferredLocale(payload, locale, router, contextKey) {
  const target = String(locale || 'en').toLowerCase();
  if (!payload || target === 'en') return payload;
  if (!needsLocaleTranslation(payload, target)) return payload;
  const prompt = `Return ONLY valid JSON.

Translate every learner-facing string value in this JSON to ${localeDisplayName(target)} (${target}).
Keep JSON keys, structure, arrays, ids, numbers, URLs, and code tokens unchanged.
Do not add new keys. Do not remove keys. Do not explain.

JSON:
${JSON.stringify(payload)}`;
  try {
    const key = sha256(`translate-json|${target}|${contextKey}|${sha256(JSON.stringify(payload))}|${JSON.stringify(router || {})}`);
    const text = await routeText(router || {}, prompt, key, 7 * 24 * 60 * 60 * 1000);
    const translated = extractJson(text);
    return translated;
  } catch {
    return payload;
  }
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
  return String(courseTitle || '').trim().toLowerCase();
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
  MODULE_VIDEO_REGISTRY.set(key, { ids: ids.slice(-120), at: Date.now() });
}

function isRetriableStatus(status) {
  return status === 0 || status === 408 || status === 429 || status === 503 || status === 502 || status === 504;
}

function normalizePromptDraft(value) {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([!?.,])\1{2,}/g, '$1$1');
}

function normalizePromptInput(value) {
  return normalizePromptDraft(value).trim();
}

function stripInterviewPromptScaffolding(value = '') {
  let text = normalizePromptInput(value)
    .replace(/^[`"']+|[`"']+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  const hadInterviewIntent = /\b(interview|questions?|questionnaire|guide|prep(?:aration)?|simulation)\b/i.test(text);
  if (hadInterviewIntent) {
    const afterFor = text.match(/\b(?:for|about|regarding|on)\s+(.+)$/i);
    if (afterFor?.[1]) text = String(afterFor[1]).trim();
    text = text
      .replace(/^(?:an?\s+)?(?:interview\s+)?(?:questions?|questionnaire|guide|prep(?:aration)?|simulation)\s*(?:for|about|regarding|on)?\s*/i, '')
      .replace(/^(?:generate|create|write|give|make|prepare|show|need|want)\s+/i, '')
      .trim();
  }
  text = text
    .replace(/^for\s+/i, '')
    .replace(/\b(?:interview\s+questions?|questionnaire|interview\s+guide|interview\s+prep(?:aration)?|interview\s+simulation)\b$/i, '')
    .replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^[a-z0-9][a-z0-9\s/-]*$/.test(text)) {
    text = text
      .split(/\s+/)
      .map((word) => word ? (word.charAt(0).toUpperCase() + word.slice(1)) : word)
      .join(' ');
  }
  return text.slice(0, 120);
}

function getInterviewInputSafetyError(value = '') {
  const lower = String(value || '').toLowerCase();
  if (!lower) return '';
  const blockedPatterns = [
    /\b(?:porn|porno|xxx|nsfw|nude|nudity|erotic|fetish|escort|brothel|onlyfans|sexual?|sex)\b/i,
    /\b(?:hate\s*speech|white\s*power|heil\s*hitler|nazi\s*propaganda|ethnic\s*cleansing|genocide|terrorist\s*recruitment)\b/i,
    /\b(?:kill\s+all|rape|slur)\b/i,
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(lower)) {
      return 'Interview role contains disallowed sexual or hate content. Please enter a professional job title.';
    }
  }
  return '';
}

function getTopicValidationError(value) {
  const prompt = normalizePromptInput(value);
  if (!prompt) return 'Enter a topic before generating.';
  if (prompt.length < 3) return 'Topic is too short. Add more detail.';

  const chars = prompt.replace(/\s/g, '');
  const letters = (chars.match(/\p{L}/gu) || []).length;
  const symbols = (chars.match(/[^\p{L}\p{N}]/gu) || []).length;
  const repeatedChars = /(.)\1{5,}/.test(prompt);

  if (!/[\p{L}\p{N}]/u.test(prompt)) return 'Use words or numbers to describe a real topic.';
  if (repeatedChars) return 'Input looks invalid. Please enter a clear learning topic.';
  if (chars.length >= 6 && letters > 0 && symbols / chars.length > 0.45) {
    return 'Input has too many symbols. Use plain words for the topic.';
  }

  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length <= 2) return 'Add a more specific topic.';
  if (/[a-z]{12,}/i.test(prompt) && /(asdf|qwer|zxcv|hjkl|dfgh|xcvb|fghj)/i.test(prompt)) {
    return 'Input looks like random keyboard text. Try a clear topic.';
  }

  const normalizedWords = words
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);

  const asciiWords = words.filter((w) => /^[A-Za-z]+$/.test(w));
  const noVowelPattern = asciiWords.length >= 2 && asciiWords.every((w) => w.length >= 4 && !/[aeiou]/i.test(w));
  if (noVowelPattern) return 'Input looks like gibberish. Try a readable topic.';

  const shortLoopTokens = normalizedWords.filter((w) => w.length <= 3);
  if (shortLoopTokens.length >= 4) {
    const uniqueShort = Array.from(new Set(shortLoopTokens));
    const mostlyShortLoop = uniqueShort.length <= 2 && (shortLoopTokens.length / Math.max(normalizedWords.length, 1)) >= 0.8;
    if (mostlyShortLoop) return 'Input looks like repeated gibberish. Please enter a real topic.';
  }

  if (normalizedWords.length >= 6) {
    const uniqueRatio = new Set(normalizedWords).size / normalizedWords.length;
    const avgWordLength = normalizedWords.reduce((sum, word) => sum + word.length, 0) / normalizedWords.length;
    if (uniqueRatio < 0.4 && avgWordLength < 4.2) {
      return 'Input looks too repetitive. Please describe a clear learning topic.';
    }
  }

  return null;
}

function extractJson(text) {
  if (!text) throw new Error('Empty model response');
  const raw = String(text || '').trim();
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw) || tryParse(unfenced);
  if (direct !== null) return direct;

  const starts = [];
  for (let i = 0; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (ch === '{' || ch === '[') starts.push(i);
  }

  const firstBalancedSlice = (source, startIndex) => {
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let i = startIndex; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }
      if (ch === '}' || ch === ']') {
        const open = stack[stack.length - 1];
        if (!open) continue;
        if ((open === '{' && ch === '}') || (open === '[' && ch === ']')) {
          stack.pop();
          if (stack.length === 0) {
            return source.slice(startIndex, i + 1);
          }
        } else {
          return '';
        }
      }
    }
    return '';
  };

  for (const start of starts) {
    const candidate = firstBalancedSlice(unfenced, start);
    if (!candidate) continue;
    const parsed = tryParse(candidate);
    if (parsed !== null) return parsed;
  }

  const firstObj = unfenced.indexOf('{');
  const firstArr = unfenced.indexOf('[');
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) throw new Error('Model did not return JSON');

  const endObj = unfenced.lastIndexOf('}');
  const endArr = unfenced.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end <= start) throw new Error('Invalid JSON boundaries');

  const slice = unfenced.slice(start, end + 1);
  const parsedSlice = tryParse(slice);
  if (parsedSlice !== null) return parsedSlice;

  throw new Error('Model returned invalid JSON.');
}

async function routeJsonWithRepair(router, prompt, keyBase, options = {}) {
  const ttlMs = Number(options?.ttlMs) > 0 ? Number(options.ttlMs) : (7 * 24 * 60 * 60 * 1000);
  const passes = Math.max(1, Math.min(Number(options?.passes) || 3, 5));
  const retryDelayMs = Math.max(250, Math.min(Number(options?.retryDelayMs) || 900, 5000));
  const maxTotalMs = Math.max(5000, Math.min(Number(options?.maxTotalMs) || 60000, 240000));
  const routeOptions = options?.routeOptions || {};
  let lastErr = null;
  const startedAt = Date.now();
  for (let pass = 0; pass < passes; pass++) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = maxTotalMs - elapsedMs;
    if (remainingMs <= 0) {
      const timeoutErr = lastErr || new Error(`AI JSON routing timed out after ${Math.round(maxTotalMs / 1000)}s.`);
      timeoutErr.status = timeoutErr.status || 503;
      lastErr = timeoutErr;
      break;
    }
    const passRouteOptions = {
      ...routeOptions,
      maxTotalMs: Math.min(
        Math.max(5000, Number(routeOptions?.maxTotalMs || remainingMs)),
        remainingMs
      ),
    };
    const cacheKey = pass === 0
      ? sha256(`${keyBase}|primary`)
      : sha256(`${keyBase}|fresh:${Date.now()}|pass:${pass}`);
    try {
      const text = await routeText(router, prompt, cacheKey, ttlMs, passRouteOptions);
      try {
        return extractJson(text);
      } catch {
        const repairPrompt = `${prompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanations, no prose.`;
        const repairKey = sha256(`repair|${cacheKey}`);
        const repairedText = await routeText(router, repairPrompt, repairKey, 5 * 60 * 1000, passRouteOptions);
        return extractJson(repairedText);
      }
    } catch (e) {
      lastErr = e;
      if (pass < passes - 1) {
        const jitter = Math.floor(Math.random() * 250);
        await sleep(Math.min(retryDelayMs * (pass + 1), 5000) + jitter);
      }
    }
  }
  if (options?.throwOnError) {
    throw (lastErr || new Error('AI response could not be generated as valid JSON.'));
  }
  return null;
}

function lessonFlowTypes(programmingTrack) {
  return programmingTrack
    ? ['TEXT', 'LEARNING_CARD', 'FLIP_CARD', 'VIDEO', 'CODE_BUILDER', 'DRAG_FILL', 'QUIZ']
    : ['TEXT', 'LEARNING_CARD', 'FLIP_CARD', 'VIDEO', 'POP_CARD', 'DRAG_FILL', 'QUIZ'];
}

function titleForLessonFlowStep(lessonTopic, type) {
  if (type === 'TEXT') return `${lessonTopic}: Core Concepts`;
  if (type === 'LEARNING_CARD') return `Learning Cards: ${lessonTopic} Essentials`;
  if (type === 'FLIP_CARD') return `Flashcards: Key Terms in ${lessonTopic}`;
  if (type === 'VIDEO') return `Video: ${lessonTopic} Walkthrough`;
  if (type === 'CODE_BUILDER') return `Interactive Coding: ${lessonTopic}`;
  if (type === 'ACCORDION') return `Concept Breakdown: ${lessonTopic}`;
  if (type === 'POP_CARD') return `Pop Cards: ${lessonTopic} Insights`;
  if (type === 'DRAG_FILL') return `Challenge: Apply ${lessonTopic}`;
  if (type === 'QUIZ') return `Quiz: ${lessonTopic} Checkpoint`;
  return `${lessonTopic}: ${type}`;
}

function normalizeLessonPlan(raw, topicContext = '') {
  const programmingTrack = isProgrammingTopic(topicContext);
  const flow = lessonFlowTypes(programmingTrack);
  const tokens = extractMeaningfulTokens(String(topicContext || ''), 5);
  const lessonTopics = [
    `${tokens[0] || 'Core'} Fundamentals`,
    `${tokens[1] || tokens[0] || 'Practical'} Applications`,
    `${tokens[2] || tokens[1] || tokens[0] || 'Advanced'} Mastery`,
  ];
  const defaults = [];
  for (const lessonTopic of lessonTopics) {
    for (const type of flow) {
      defaults.push({
        title: titleForLessonFlowStep(lessonTopic, type),
        type,
      });
    }
  }

  const canonicalTypes = new Set([
    'TEXT',
    'VIDEO',
    'FLIP_CARD',
    'QUIZ',
    'CODE_BUILDER',
    'LEARNING_CARD',
    'DRAG_FILL',
    'ACCORDION',
    'HOTSPOT',
    'CAROUSEL',
    'POP_CARD',
  ]);
  const source = Array.isArray(raw) ? raw.slice(0, 21) : [];
  const out = [];
  for (let i = 0; i < 21; i += 1) {
    const row = source[i] || {};
    const fallback = defaults[i];
    const requestedType = String(row.type || '').toUpperCase();
    let resolvedType = canonicalTypes.has(requestedType) ? requestedType : String(fallback.type || 'TEXT').toUpperCase();
    if (!programmingTrack && resolvedType === 'CODE_BUILDER') resolvedType = 'DRAG_FILL';
    const expectedType = String(fallback.type || 'TEXT').toUpperCase();
    if (resolvedType !== expectedType) resolvedType = expectedType;
    const rawTitle = String(row.title || '').replace(/\s+/g, ' ').trim();
    const weakTitle = !rawTitle || /^step\s*\d+$/i.test(rawTitle) || /^lesson\s*\d+$/i.test(rawTitle);
    const title = weakTitle ? String(fallback.title || `Step ${i + 1}`) : rawTitle;
    out.push({
      id: `step-${i + 1}`,
      title,
      type: resolvedType,
    });
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
  const weakWords = new Set([
    'complete',
    'code',
    'snippet',
    'find',
    'maximum',
    'minimum',
    'max',
    'min',
    'statement',
    'question',
    'challenge',
    'exercise',
    'option',
    'answer',
    'blank',
    'blanks',
    'token',
    'tokens',
    'value',
    'values',
    'term',
    'terms',
    'left',
    'right',
  ]);
  const normalizedWords = t.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  return (
    !t ||
    weakWords.has(t) ||
    (normalizedWords.length > 0 && normalizedWords.every((word) => weakWords.has(word))) ||
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
    'is', 'are', 'to', 'for', 'of', 'in', 'on', 'a', 'an', 'by', 'or', 'as', 'be',
    'complete', 'code', 'snippet', 'find', 'maximum', 'minimum', 'question', 'challenge',
    'exercise', 'answer', 'option', 'value', 'values', 'term', 'terms', 'token', 'tokens'
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

function isFinalModuleQuizTitle(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  if (text.includes('final module assessment')) return true;
  if (text.includes('final quiz')) return true;
  return /(?:module|final)\s+(?:assessment|quiz)/i.test(text);
}

function rebalanceQuizOptionOrder(options, correctAnswer, questionIndex = 0) {
  const rows = Array.isArray(options) ? options.slice(0, 4) : [];
  if (rows.length < 2) {
    return { options: rows, correctAnswer: 0 };
  }
  const safeCorrect = Math.min(Math.max(Number(correctAnswer) || 0, 0), rows.length - 1);
  const pattern = [1, 3, 0, 2];
  const desired = Math.min(rows.length - 1, pattern[Math.abs(Number(questionIndex) || 0) % pattern.length]);
  if (desired === safeCorrect) {
    return { options: rows, correctAnswer: safeCorrect };
  }
  const correctValue = rows[safeCorrect];
  const others = rows.filter((_, idx) => idx !== safeCorrect);
  const nextOptions = [];
  let cursor = 0;
  for (let idx = 0; idx < rows.length; idx += 1) {
    if (idx === desired) {
      nextOptions.push(correctValue);
    } else {
      nextOptions.push(others[cursor] || correctValue);
      cursor += 1;
    }
  }
  return {
    options: nextOptions,
    correctAnswer: desired,
  };
}

function buildFallbackQuizQuestions(topic, count) {
  const target = Math.max(1, Math.floor(Number(count) || 1));
  const topicText = String(topic || '').trim() || 'this lesson';
  const seeds = [
    {
      question: `What is the best first move to apply ${topicText}?`,
      options: [
        'Connect the concept to one real scenario.',
        'Skip context and guess answers.',
        'Ignore feedback and checkpoints.',
        'Memorize terms only.',
      ],
      correctAnswer: 0,
    },
    {
      question: `Which behavior demonstrates mastery of ${topicText}?`,
      options: [
        'You can explain decisions with evidence from the lesson.',
        'You avoid practical examples.',
        'You never verify outcomes.',
        'You change approach randomly each step.',
      ],
      correctAnswer: 0,
    },
    {
      question: `A common error when studying ${topicText} is:`,
      options: [
        'Using short, repeated practice loops.',
        'Linking concept to application.',
        'Treating theory and practice as disconnected.',
        'Checking results after each attempt.',
      ],
      correctAnswer: 2,
    },
    {
      question: `Why does review matter after finishing a ${topicText} task?`,
      options: [
        'It confirms quality and improves future decisions.',
        'It makes learning slower with no value.',
        'It prevents useful feedback.',
        'It replaces all practical practice.',
      ],
      correctAnswer: 0,
    },
  ];
  const rows = [];
  let cursor = 0;
  while (rows.length < target) {
    const seed = seeds[cursor % seeds.length];
    const cycle = Math.floor(cursor / seeds.length) + 1;
    const balanced = rebalanceQuizOptionOrder(
      seed.options.slice(0, 4),
      Math.max(0, Math.min(3, Number(seed.correctAnswer || 0))),
      rows.length
    );
    rows.push({
      question: `${seed.question}${cycle > 1 ? ` (${cycle})` : ''}`,
      options: balanced.options,
      correctAnswer: balanced.correctAnswer,
      explanation: `This answer best aligns with practical application of ${topicText}.`,
    });
    cursor += 1;
  }
  return rows;
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

function normalizeReferenceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function normalizeReferences(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const url = normalizeReferenceUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const kindRaw = String(item?.kind || '').trim().toLowerCase();
    const kind = kindRaw === 'youtube' || kindRaw === 'doc' || kindRaw === 'web'
      ? kindRaw
      : (url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'web');
    out.push({
      title: String(item?.title || '').trim() || 'Reference',
      url,
      kind,
    });
  }
  return out;
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
    const isFinalModuleQuiz = isFinalModuleQuizTitle(safe(obj?.title, '')) || isFinalModuleQuizTitle(safe(obj?.lessonText, ''));
    const targetQuestionCount = isFinalModuleQuiz ? 20 : 4;
    const maxQuestionCount = isFinalModuleQuiz ? 24 : 6;
    const qs = Array.isArray(obj?.data?.questions) ? obj.data.questions : [];
    const cleanedQuestions = qs.slice(0, maxQuestionCount).map((q, qIdx) => {
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
      const balanced = rebalanceQuizOptionOrder(options, correctAnswer, qIdx);

      return {
        question,
        options: balanced.options,
        correctAnswer: balanced.correctAnswer,
        explanation,
      };
    }).filter(Boolean);

    const topicText = String(safe(base.title, 'this lesson')).trim() || 'this lesson';
    const normalizedQuestions = cleanedQuestions.slice(0, maxQuestionCount);
    if (!normalizedQuestions.length) {
      normalizedQuestions.push(...buildFallbackQuizQuestions(topicText, targetQuestionCount));
    } else if (normalizedQuestions.length < targetQuestionCount) {
      normalizedQuestions.push(...buildFallbackQuizQuestions(topicText, targetQuestionCount - normalizedQuestions.length));
    }

    base.data = {
      questions: normalizedQuestions.slice(0, maxQuestionCount),
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
    const refs = normalizeReferences([
      ...(Array.isArray(obj?.data?.references) ? obj.data.references : []),
      normalizedWebUrl ? { title: safe(obj?.data?.videoTitle, base.title || 'Video'), url: normalizedWebUrl, kind: 'youtube' } : null,
    ]);
    base.data = {
      videoUrl: normalizedVideoUrl,
      videoWebUrl: normalizedWebUrl,
      videoTitle: safe(obj?.data?.videoTitle, base.title || 'Video'),
      content: safe(obj?.data?.content, ''),
      references: refs,
    };
  }

  if (type === 'DRAG_FILL') {
    const challenges = Array.isArray(obj?.data?.challenges) ? obj.data.challenges : [];
    const outChallenges = challenges.slice(0, 6).map((ch) => {
      const rawTemplate = String(safe(ch?.codeTemplate || ch?.statement || ch?.prompt, '')).trim();
      const normalizedTemplate = normalizeTemplateBlanks(rawTemplate);
      const fallbackTopic = extractMeaningfulTokens(`${base.title} ${base.lessonText}`, 2).join(' ');
      const fallbackTemplate = `In ${fallbackTopic || 'this lesson'}, ___ leads to ___.`;
      const templateSeed = countTemplateBlanks(normalizedTemplate) > 0
        ? normalizedTemplate
        : `${normalizedTemplate || rawTemplate || fallbackTemplate} ___`.trim();
      const weakTemplateWords = String(templateSeed || '')
        .replace(/[_`*#()[\]{}<>.,;:!?/\\-]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const weakTemplateCount = weakTemplateWords.filter((word) => isPlaceholderToken(word)).length;
      const templateWithBlanks = (!templateSeed || (weakTemplateWords.length > 0 && weakTemplateCount >= Math.ceil(weakTemplateWords.length * 0.6)))
        ? fallbackTemplate
        : templateSeed;
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
      options = options.filter((opt) => !isPlaceholderToken(opt) && /[a-z0-9]/i.test(opt) && opt.length <= 64);
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
        options = ['Core concept', 'Practical action', 'Expected output', 'Correct sequence'];
      }
      options = Array.from(new Set(options.filter((opt) => !isPlaceholderToken(opt)))).slice(0, 12);
      if (options.length < Math.max(3, blankCount)) {
        for (const token of contextTokens) {
          if (options.length >= Math.max(blankCount + 1, 4)) break;
          if (!options.includes(token)) options.push(token);
        }
      }
      if (options.length < Math.max(blankCount + 1, 4)) {
        for (const fallback of ['Core concept', 'Practical action', 'Expected output', 'Correct sequence', 'Key term']) {
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
        instruction: String(safe(ch?.instruction, 'Fill each blank from left to right using topic terms from this lesson.')),
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

    const avatarInstructionRaw = String(safe(cb?.avatarInstruction, '')).trim();
    const goalRaw = String(safe(cb?.goal, '')).trim();
    const expectedOutputRaw = String(safe(cb?.expectedOutput, '')).trim();
    const codingTopicHint = String(base.title || '').trim();
    const arithmeticStyle = /\b(arithmetic|python|number|math|calculation)\b/i.test(
      `${codingTopicHint} ${goalRaw} ${avatarInstructionRaw}`
    );
    const genericGoal = !goalRaw
      || /\b(basic arithmetic calculations|complete the code by choosing the correct pieces|fill in the blanks to complete the code)\b/i.test(goalRaw);
    const genericAvatar = !avatarInstructionRaw
      || /\b(use python to perform basic arithmetic calculations|fill in the blanks to complete the code)\b/i.test(avatarInstructionRaw);
    const normalizedGoal = genericGoal
      ? (arithmeticStyle
        ? 'Complete each mini-goal with concrete results: print 10, set buyer to "Bob", increase player score by 8, and set drink to "water".'
        : `Complete each line to satisfy a concrete coding goal for ${codingTopicHint || 'this lesson'}.`)
      : goalRaw;
    const normalizedAvatarInstruction = genericAvatar
      ? 'Choose the token that makes each mini-goal true, then continue to the next line.'
      : avatarInstructionRaw;

    base.data = {
      codeBuilder: {
        avatarInstruction: normalizedAvatarInstruction,
        title: String(safe(cb?.title, base.title || 'Interactive Coding')),
        goal: normalizedGoal,
        expectedOutput: expectedOutputRaw,
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

  if (type === 'POP_CARD') {
    const cards = Array.isArray(obj?.data?.cards)
      ? obj.data.cards
      : (Array.isArray(obj?.data?.points) ? obj.data.points : []);
    const normalizedCards = cards
      .slice(0, 8)
      .map((item) => ({
        title: String(safe(item?.title || item?.front, '')).trim(),
        content: String(safe(item?.content || item?.back, '')).trim(),
        icon: String(safe(item?.icon, '')).trim(),
        imageUrl: /^https?:\/\//i.test(String(item?.imageUrl || '')) ? String(item.imageUrl) : '',
      }))
      .filter((item) => item.title || item.content);
    base.data = {
      cards: normalizedCards.length
        ? normalizedCards
        : [
            { title: 'Why it matters', content: 'Summarize the key insight of this concept.', icon: 'Target', imageUrl: '' },
            { title: 'Real example', content: 'Provide one practical scenario from daily work.', icon: 'Lightbulb', imageUrl: '' },
            { title: 'Next action', content: 'Define one concrete action the learner can take now.', icon: 'Rocket', imageUrl: '' },
          ],
    };
  }

  if (type !== 'VIDEO') {
    const refs = normalizeReferences(Array.isArray(obj?.data?.references) ? obj.data.references : []);
    if (refs.length) {
      base.data = {
        ...(base.data || {}),
        references: refs,
      };
    }
  }

  return base;
}

function providerTimeoutMs() {
  const n = Number(process.env.AI_PROVIDER_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 45000);
  if (!Number.isFinite(n)) return 45000;
  return Math.max(10000, Math.min(n, 120000));
}

async function fetchJson(url, options = {}, timeoutMs = providerTimeoutMs()) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    const msg = String(e?.message || 'fetch failed');
    const aborted = String(e?.name || '').toLowerCase() === 'aborterror' || msg.toLowerCase().includes('aborted');
    return { ok: false, status: aborted ? 503 : 0, text: msg, json: null };
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
  const requested = envList('AI_PROVIDER_CANDIDATES', ['openrouter', 'ollama', 'gemini', 'openai', 'anthropic'])
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  const ordered = Array.from(new Set(requested));
  const knownProviders = ['openrouter', 'mistral', 'ollama', 'gemini', 'openai', 'anthropic'];
  for (const provider of knownProviders) {
    if (ordered.includes(provider)) continue;
    if (providerAvailable(provider)) ordered.push(provider);
  }
  return ordered;
}

function providerAvailable(provider) {
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY;
  if (provider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  if (provider === 'mistral') return mistralApiKeys().length > 0;
  if (provider === 'ollama') {
    const hasBase = !!String(process.env.OLLAMA_API_BASE || '').trim();
    const hasModels = envList('OLLAMA_MODELS', []).length > 0;
    const hasKey = !!String(process.env.OLLAMA_API_KEY || '').trim();
    return hasBase || hasModels || hasKey;
  }
  if (provider === 'openrouter') return openRouterApiKeys().length > 0;
  return false;
}

function modelCandidatesFor(provider) {
  if (provider === 'gemini') {
    const envModels = envList('GEMINI_MODELS', []);
    const backupModels = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ];
    return Array.from(new Set(
      [...envModels, ...backupModels]
        .map((m) => String(m || '').trim().replace(/^models\//i, ''))
        .filter(Boolean)
        .filter((m) => m !== 'gemini-3-flash-preview')
    ));
  }
  if (provider === 'openai') return envList('OPENAI_MODELS', ['gpt-4o-mini']);
  if (provider === 'anthropic') return envList('ANTHROPIC_MODELS', ['claude-3-5-sonnet-latest']);
  if (provider === 'mistral') return envList('MISTRAL_MODELS', ['mistral-small-latest']);
  if (provider === 'ollama') return envList('OLLAMA_MODELS', ['llama3.2:3b']);
  if (provider === 'openrouter') {
    return envList('OPENROUTER_MODELS', [
      'mistralai/mistral-small-3.2-24b-instruct:free',
      'mistralai/ministral-8b',
      'openai/gpt-4o-mini',
      'openai/gpt-4.1-mini',
      'google/gemini-2.0-flash-001',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct:free',
    ]);
  }
  return [];
}

function outputTokenCap(defaultCap = 1200) {
  const n = Number(process.env.AI_MAX_OUTPUT_TOKENS || defaultCap);
  if (!Number.isFinite(n) || n <= 0) return defaultCap;
  return Math.max(256, Math.min(Math.floor(n), 4096));
}

function openRouterBaseMaxTokens() {
  const n = Number(process.env.OPENROUTER_MAX_TOKENS || outputTokenCap(1200));
  if (!Number.isFinite(n) || n <= 0) return 1200;
  return Math.max(256, Math.min(Math.floor(n), 4096));
}

function openRouterInterviewMaxKeys(defaultValue = 4) {
  const totalKeys = openRouterApiKeys().length;
  if (!totalKeys) return 0;
  const raw = Number(process.env.OPENROUTER_INTERVIEW_MAX_KEYS || defaultValue);
  if (!Number.isFinite(raw) || raw <= 0) return Math.min(totalKeys, 4);
  return Math.max(1, Math.min(Math.floor(raw), totalKeys, 16));
}

function openRouterApiKeys() {
  const all = [
    ...envList('OPENROUTER_API_KEYS', []),
    String(process.env.OPENROUTER_API_KEY || '').trim(),
  ]
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

let openRouterKeyCursor = 0;
function pickOpenRouterApiKey(seed = '') {
  const keys = openRouterApiKeys();
  if (!keys.length) return '';
  const hint = String(seed || '').trim();
  if (!hint) {
    const idx = openRouterKeyCursor % keys.length;
    openRouterKeyCursor += 1;
    return keys[idx];
  }
  const hash = sha256(hint).slice(0, 8);
  const idx = (Number.parseInt(hash, 16) || 0) % keys.length;
  return keys[idx];
}

function mistralApiKeys() {
  const all = [
    ...envList('MISTRAL_API_KEYS', []),
    String(process.env.MISTRAL_API_KEY || '').trim(),
  ]
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

let mistralKeyCursor = 0;
function pickMistralApiKey(seed = '') {
  const keys = mistralApiKeys();
  if (!keys.length) return '';
  const hint = String(seed || '').trim();
  if (!hint) {
    const idx = mistralKeyCursor % keys.length;
    mistralKeyCursor += 1;
    return keys[idx];
  }
  const hash = sha256(hint).slice(0, 8);
  const idx = (Number.parseInt(hash, 16) || 0) % keys.length;
  return keys[idx];
}

function isOpenRouterBudgetError(status, message) {
  const msg = String(message || '').toLowerCase();
  if (status === 402) return true;
  return (
    msg.includes('requires more credits') ||
    msg.includes('fewer max_tokens') ||
    msg.includes('requested up to') ||
    msg.includes('can only afford') ||
    msg.includes('insufficient credits') ||
    msg.includes('payment required')
  );
}

function normalizeGeminiModelName(model) {
  return String(model || '').trim().replace(/^models\//i, '');
}

function isGeminiModelUnavailable(status, message) {
  const lower = String(message || '').toLowerCase();
  if (status === 404) return true;
  return (
    lower.includes('not a valid model') ||
    lower.includes('not found for api version') ||
    lower.includes('model not found') ||
    lower.includes('unknown model')
  );
}

const geminiModelDiscoveryCache = {
  at: 0,
  models: [],
};

async function discoverGeminiModels() {
  const now = Date.now();
  if (geminiModelDiscoveryCache.models.length && (now - geminiModelDiscoveryCache.at) < (10 * 60 * 1000)) {
    return geminiModelDiscoveryCache.models;
  }

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const r = await fetchJson(url, { method: 'GET' }, 12000);
  if (!r.ok || !Array.isArray(r.json?.models)) {
    return geminiModelDiscoveryCache.models;
  }

  const discovered = r.json.models
    .map((m) => {
      const name = normalizeGeminiModelName(m?.name);
      const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      return { name, methods };
    })
    .filter((row) => !!row.name)
    .filter((row) => row.name.toLowerCase().startsWith('gemini'))
    .filter((row) => !row.methods.length || row.methods.includes('generateContent'))
    .map((row) => row.name);

  if (!discovered.length) return geminiModelDiscoveryCache.models;

  const rank = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.includes('2.5') && n.includes('flash')) return 0;
    if (n.includes('2.0') && n.includes('flash')) return 1;
    if (n.includes('1.5') && n.includes('flash')) return 2;
    if (n.includes('1.5') && n.includes('pro')) return 3;
    return 9;
  };

  const sorted = Array.from(new Set(discovered)).sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return String(a).localeCompare(String(b));
  });

  geminiModelDiscoveryCache.at = now;
  geminiModelDiscoveryCache.models = sorted;
  return sorted;
}

async function callGemini(prompt, model) {
  const key = process.env.GEMINI_API_KEY;
  const requestWithModel = async (modelName) => {
    const cleanModel = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, topP: 0.95, maxOutputTokens: outputTokenCap(1200) },
    };
    const r = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const msg = (r.json?.error?.message) || r.text || 'Gemini error';
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    return r.json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  };

  const queue = Array.from(new Set([
    normalizeGeminiModelName(model),
    ...modelCandidatesFor('gemini').map(normalizeGeminiModelName),
  ])).filter(Boolean);

  let expanded = false;
  let lastErr = null;
  for (let i = 0; i < queue.length; i++) {
    const candidate = queue[i];
    try {
      return await requestWithModel(candidate);
    } catch (e) {
      lastErr = e;
      if (isGeminiModelUnavailable(e?.status || 0, e?.message || '')) {
        if (!expanded) {
          expanded = true;
          const discovered = await discoverGeminiModels();
          for (const discoveredModel of discovered) {
            const clean = normalizeGeminiModelName(discoveredModel);
            if (!clean || queue.includes(clean)) continue;
            queue.push(clean);
          }
        }
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error('Gemini error');
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
    max_tokens: outputTokenCap(1200),
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

function normalizeAudioMimeType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.startsWith('audio/webm')) return 'audio/webm';
  if (raw.startsWith('audio/ogg')) return 'audio/ogg';
  if (raw.startsWith('audio/mp4')) return 'audio/mp4';
  if (raw.startsWith('audio/mpeg')) return 'audio/mpeg';
  if (raw.startsWith('audio/wav') || raw.startsWith('audio/x-wav')) return 'audio/wav';
  return 'audio/webm';
}

function audioExtensionFromMimeType(mimeType) {
  if (mimeType === 'audio/ogg') return 'ogg';
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/wav') return 'wav';
  return 'webm';
}

function interviewLanguageLabel(value) {
  const code = normalizeInterviewLanguageCode(value);
  if (code === 'th') return 'Thai';
  if (code === 'my') return 'Burmese';
  if (code === 'id') return 'Indonesian';
  if (code === 'ms') return 'Malay';
  if (code === 'vi') return 'Vietnamese';
  if (code === 'tl') return 'Filipino';
  if (code === 'km') return 'Khmer';
  if (code === 'lo') return 'Lao';
  return 'English';
}

function normalizeInterviewLanguageCode(value) {
  return normalizeLocaleCode(value, 'en');
}

function targetScriptRegexForLanguage(languageCode) {
  if (languageCode === 'th') return /[\u0E00-\u0E7F]/g;
  if (languageCode === 'my') return /[\u1000-\u109F]/g;
  if (languageCode === 'km') return /[\u1780-\u17FF]/g;
  if (languageCode === 'lo') return /[\u0E80-\u0EFF]/g;
  return null;
}

function countUnicodeLetters(text) {
  return (String(text || '').match(/\p{L}/gu) || []).length;
}

function scriptSignalCount(text) {
  return (String(text || '').match(/[\u1000-\u109F\u0E00-\u0E7F\u1780-\u17FF\u0E80-\u0EFF]/g) || []).length;
}

function looksLikeMojibakeText(value = '') {
  const raw = String(value || '');
  if (!raw.trim()) return false;
  if (raw.includes('\uFFFD')) return true;
  let hits = 0;
  if (raw.includes('\u00C3')) hits += 1;
  if (raw.includes('\u00C2')) hits += 1;
  if (raw.includes('\u00E2')) hits += 1;
  if (raw.includes('\u00E1\u20AC')) hits += 1;
  if (raw.includes('\u00E0\u00B8')) hits += 1;
  if (raw.includes('\u00E1\u00BA') || raw.includes('\u00E1\u00BB')) hits += 1;
  if (hits >= 2) return true;
  if (hits === 1) {
    const nonAsciiCount = (raw.match(/[^\x00-\x7f]/g) || []).length;
    return nonAsciiCount >= 4;
  }
  return false;
}

const CP1252_REVERSE_MAP = Object.freeze({
  '\u20AC': 0x80,
  '\u201A': 0x82,
  '\u0192': 0x83,
  '\u201E': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02C6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8A,
  '\u2039': 0x8B,
  '\u0152': 0x8C,
  '\u017D': 0x8E,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201C': 0x93,
  '\u201D': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02DC': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9A,
  '\u203A': 0x9B,
  '\u0153': 0x9C,
  '\u017E': 0x9E,
  '\u0178': 0x9F,
});

function decodeCp1252Mojibake(raw = '') {
  const bytes = [];
  for (const ch of String(raw || '')) {
    if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE_MAP, ch)) {
      bytes.push(CP1252_REVERSE_MAP[ch]);
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) {
      bytes.push(cp);
      continue;
    }
    const fallback = Buffer.from(ch, 'utf8');
    for (const b of fallback) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

function repairLikelyMojibakeText(value = '') {
  const raw = String(value || '');
  if (!raw) return '';
  if (!looksLikeMojibakeText(raw)) return raw;
  try {
    const repaired = decodeCp1252Mojibake(raw);
    if (!repaired || repaired === raw) return raw;
    const rawSignals = scriptSignalCount(raw);
    const repairedSignals = scriptSignalCount(repaired);
    const rawBurst = (raw.match(/\?{3,}/g) || []).length;
    const repairedBurst = (repaired.match(/\?{3,}/g) || []).length;
    if (repairedSignals > rawSignals || repairedBurst < rawBurst) return repaired;
    const rawLetters = countUnicodeLetters(raw);
    const repairedLetters = countUnicodeLetters(repaired);
    if (repairedLetters >= rawLetters) return repaired;
  } catch {
    // keep original text on decode failures
  }
  return raw;
}

function isLikelyEnglishInterviewText(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return false;
  const padded = ` ${raw.replace(/\s+/g, ' ')} `;
  const alphaCount = (raw.match(/[a-z]/g) || []).length;
  const nonAsciiCount = (raw.match(/[^\x00-\x7f]/g) || []).length;
  const englishCuePatterns = [
    'tell me about',
    'walk me through',
    'describe a',
    'how do you',
    'why should we hire',
    'share a mistake',
    'what changed',
    'can you describe',
    'which',
  ];
  const cueHits = englishCuePatterns.reduce((count, pattern) => (
    count + (raw.includes(pattern) ? 1 : 0)
  ), 0);
  const commonWordPatterns = [
    ' the ',
    ' and ',
    ' for ',
    ' with ',
    ' your ',
    ' role ',
    ' work ',
    ' skills ',
    ' responsibilities ',
  ];
  const wordHits = commonWordPatterns.reduce((count, pattern) => (
    count + (padded.includes(pattern) ? 1 : 0)
  ), 0);
  const asciiDominant = alphaCount >= 18 && nonAsciiCount <= Math.max(2, Math.floor(alphaCount * 0.08));
  return asciiDominant && (cueHits > 0 || wordHits >= 3);
}

function interviewLanguageSignalTokens(languageCode) {
  const code = normalizeInterviewLanguageCode(languageCode);
  if (code === 'id') return [' yang ', ' untuk ', ' dengan ', ' pada ', ' dan ', ' atau ', ' anda ', ' saya ', ' bagaimana ', ' mengapa ', ' kapan ', ' apa ', ' jelaskan ', ' ceritakan ', ' sebutkan '];
  if (code === 'ms') return [' yang ', ' untuk ', ' dengan ', ' pada ', ' dan ', ' atau ', ' anda ', ' saya ', ' bagaimana ', ' mengapa ', ' kapan ', ' apa ', ' terangkan ', ' ceritakan ', ' sebutkan '];
  if (code === 'vi') return [' ban ', ' toi ', ' va ', ' cua ', ' de ', ' trong ', ' khi ', ' hay ', ' tai sao ', ' vi sao ', ' nhu the nao ', ' lam sao ', ' nao ', ' mot '];
  if (code === 'tl') return [' ang ', ' at ', ' sa ', ' mga ', ' ng ', ' ikaw ', ' ka ', ' paano ', ' bakit ', ' ano ', ' kailan ', ' sino ', ' ilarawan ', ' ikuwento '];
  return [];
}

function normalizeInterviewSignalText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function textHasTargetLanguageSignals(text, languageCode) {
  const code = normalizeInterviewLanguageCode(languageCode);
  if (code === 'en') return true;
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return false;
  if (code === 'vi' && /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(raw)) {
    return true;
  }
  if (['th', 'my', 'km', 'lo'].includes(code)) {
    return textMeetsTargetScriptThreshold(raw, code, 0.38);
  }
  const tokens = interviewLanguageSignalTokens(code);
  if (!tokens.length) return false;
  const padded = ` ${normalizeInterviewSignalText(raw).replace(/\s+/g, ' ')} `;
  const hits = tokens.reduce((count, token) => (
    count + (padded.includes(token) ? 1 : 0)
  ), 0);
  if (padded.length <= 110) return hits >= 1;
  return hits >= Math.max(2, Math.ceil(tokens.length * 0.18));
}

function textMeetsTargetScriptThreshold(text, languageCode, minRatio = 0.52) {
  const scriptRegex = targetScriptRegexForLanguage(languageCode);
  if (!scriptRegex) return true;
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const targetChars = (raw.match(scriptRegex) || []).length;
  const totalLetters = Math.max(1, countUnicodeLetters(raw));
  const ratio = targetChars / totalLetters;
  return targetChars >= 8 && ratio >= minRatio;
}

function interviewQuestionScriptThreshold(languageCode) {
  const code = normalizeInterviewLanguageCode(languageCode);
  if (code === 'my') return 0.44;
  return 0.52;
}

function interviewTextScriptThreshold(languageCode) {
  const code = normalizeInterviewLanguageCode(languageCode);
  if (code === 'my') return 0.42;
  return 0.48;
}

function canUseSoftBurmeseQuestionSet(questions, minCount = 4) {
  const rows = Array.isArray(questions) ? questions : [];
  if (!rows.length || rows.length < Math.max(1, Number(minCount) || 4)) return false;
  const cleanRows = rows.filter((row) => {
    const text = String(row?.question || '').trim();
    if (!text) return false;
    if (looksLikeMojibakeText(text)) return false;
    return true;
  });
  if (cleanRows.length < Math.max(1, Number(minCount) || 4)) return false;
  const localizedCount = cleanRows.filter((row) => textHasTargetLanguageSignals(row?.question, 'my')).length;
  return localizedCount >= Math.ceil(cleanRows.length * 0.35);
}

function hasStrongEnglishLeakage(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return false;
  if (raw.includes('how would you') || raw.includes('in real work')) return true;
  const englishWords = raw.match(/\b[a-z]{2,}\b/g) || [];
  return englishWords.length >= 3;
}

function shouldForceLocalizedQuestionFallback(questions, targetLanguage) {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'en') return false;
  if (!['th', 'my', 'km', 'lo'].includes(languageCode)) {
    if (!Array.isArray(questions) || !questions.length) return true;
    const total = questions.length;
    const localizedCount = questions.filter((row) => textHasTargetLanguageSignals(row?.question, languageCode)).length;
    const englishCount = questions.filter((row) => isLikelyEnglishInterviewText(row?.question)).length;
    const wrapperLeakCount = questions.filter((row) => /(?:how would you|in real work)/i.test(String(row?.question || ''))).length;
    if (wrapperLeakCount >= Math.ceil(total * 0.3)) return true;
    const localizedFloor = Math.max(1, Math.ceil(total * 0.45));
    if (localizedCount >= localizedFloor && englishCount <= Math.floor(total * 0.35)) {
      return false;
    }
    if (englishCount >= Math.ceil(total * 0.5)) return true;
    return localizedCount < localizedFloor;
  }
  if (!Array.isArray(questions) || !questions.length) return true;
  const scriptThreshold = interviewQuestionScriptThreshold(languageCode);
  const compliantCount = questions.filter((row) => (
    textMeetsTargetScriptThreshold(row?.question, languageCode, scriptThreshold)
    && !hasStrongEnglishLeakage(row?.question)
  )).length;
  return compliantCount < Math.ceil(questions.length * 0.7);
}

function shouldForceLocalizedTextFallback(text, targetLanguage) {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'en') return false;
  if (!['th', 'my', 'km', 'lo'].includes(languageCode)) {
    return isLikelyEnglishInterviewText(text) && !textHasTargetLanguageSignals(text, languageCode);
  }
  return !textMeetsTargetScriptThreshold(text, languageCode, interviewTextScriptThreshold(languageCode));
}

function interviewTranslationCode(targetLanguage) {
  const code = normalizeInterviewLanguageCode(targetLanguage);
  if (code === 'en') return 'en';
  if (code === 'my') return 'my';
  if (code === 'id') return 'id';
  if (code === 'ms') return 'ms';
  if (code === 'th') return 'th';
  if (code === 'vi') return 'vi';
  if (code === 'tl') return 'tl';
  if (code === 'km') return 'km';
  if (code === 'lo') return 'lo';
  return code || 'en';
}

function interviewTranslationTimeoutMs() {
  const raw = Number(process.env.INTERVIEW_TRANSLATION_TIMEOUT_MS || 7000);
  if (!Number.isFinite(raw)) return 7000;
  return Math.max(3000, Math.min(Math.floor(raw), 20000));
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function translateTextWithMyMemory(text, targetLanguage) {
  const input = String(text || '').trim();
  const targetCode = interviewTranslationCode(targetLanguage);
  if (!input || !targetCode || targetCode === 'en') return input;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=${encodeURIComponent(`en|${targetCode}`)}`;
  const r = await fetchJson(url, { method: 'GET' }, interviewTranslationTimeoutMs());
  if (!r.ok) {
    const e = new Error(String(r.json?.responseDetails || r.text || 'Translation request failed'));
    e.status = r.status || 502;
    throw e;
  }
  const translated = decodeHtmlEntities(String(r.json?.responseData?.translatedText || '').trim());
  return translated || input;
}

async function translateTextWithGoogleFree(text, targetLanguage) {
  const input = String(text || '').trim();
  const targetCode = interviewTranslationCode(targetLanguage);
  if (!input || !targetCode || targetCode === 'en') return input;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetCode)}&dt=t&q=${encodeURIComponent(input)}`;
  const r = await fetchJson(url, { method: 'GET' }, interviewTranslationTimeoutMs());
  if (!r.ok) {
    const e = new Error(String(r.json?.error || r.text || 'Translation request failed'));
    e.status = r.status || 502;
    throw e;
  }
  const rows = Array.isArray(r.json?.[0]) ? r.json[0] : [];
  const translated = decodeHtmlEntities(rows
    .map((part) => (Array.isArray(part) ? String(part[0] || '') : ''))
    .join('')
    .trim());
  return translated || input;
}

function looksLikeBrokenTranslation(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  const questionMarks = (raw.match(/\?/g) || []).length;
  if (questionMarks < 4) return false;
  const letters = Math.max(1, countUnicodeLetters(raw));
  return (questionMarks / letters) > 0.16;
}

async function safeTranslateInterviewText(text, targetLanguage) {
  const input = String(text || '').trim();
  if (!input) return input;
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'en') return input;
  const scriptLockedLanguage = ['th', 'my', 'km', 'lo'].includes(languageCode);
  const translators = scriptLockedLanguage
    ? [translateTextWithGoogleFree, translateTextWithMyMemory]
    : [translateTextWithMyMemory, translateTextWithGoogleFree];

  let best = input;
  for (const translate of translators) {
    try {
      const translated = String(await translate(input, targetLanguage) || '').trim();
      if (!translated || translated === input) continue;
      if (looksLikeBrokenTranslation(translated)) continue;
      const localized = textHasTargetLanguageSignals(translated, languageCode);
      if (localized) {
        return translated;
      }
      if (!scriptLockedLanguage) best = translated;
    } catch {
      // try next translator
    }
  }
  return best;
}

async function localizeInterviewSessionQuestions(session, targetLanguage, options = {}) {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'en') return session;
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  const role = session?.role || {};
  const roleBlock = [
    String(role?.roleSummary || ''),
    ...(Array.isArray(role?.responsibilities) ? role.responsibilities : []),
    ...(Array.isArray(role?.requirements) ? role.requirements : []),
  ].join('\n');
  const needRoleLocalization = shouldForceLocalizedTextFallback(roleBlock, targetLanguage);
  const questionNeedsLocalization = (questionText) => {
    const text = String(questionText || '');
    if (!text.trim()) return false;
    if (['th', 'my', 'km', 'lo'].includes(languageCode)) {
      return !textMeetsTargetScriptThreshold(text, languageCode, interviewTextScriptThreshold(languageCode)) || hasStrongEnglishLeakage(text);
    }
    return isLikelyEnglishInterviewText(text) || !textHasTargetLanguageSignals(text, languageCode);
  };
  const needQuestionLocalization = questions.some((row) => questionNeedsLocalization(row?.question));
  if (!needRoleLocalization && !needQuestionLocalization) return session;

  const localizationRouter = options?.router && typeof options.router === 'object'
    ? options.router
    : null;
  const localizationKeyBase = String(options?.keyBase || '').trim();
  if (localizationRouter) {
    try {
      const aiLocalized = await localizeInterviewSessionWithAi(
        session,
        targetLanguage,
        localizationRouter,
        localizationKeyBase || 'interview-session'
      );
      const aiQuestions = Array.isArray(aiLocalized?.questions) ? aiLocalized.questions : [];
      const aiRole = aiLocalized?.role || {};
      const aiRoleBlock = [
        String(aiRole?.roleSummary || ''),
        ...(Array.isArray(aiRole?.responsibilities) ? aiRole.responsibilities : []),
        ...(Array.isArray(aiRole?.requirements) ? aiRole.requirements : []),
      ].join('\n');
      const aiNeedRoleLocalization = shouldForceLocalizedTextFallback(aiRoleBlock, targetLanguage);
      const aiNeedQuestionLocalization = aiQuestions.some((row) => questionNeedsLocalization(row?.question));
      if (!aiNeedRoleLocalization && !aiNeedQuestionLocalization) {
        return aiLocalized;
      }
    } catch {
      // fall through to deterministic translator-based localization
    }
  }

  const localized = {
    ...session,
    role: {
      ...role,
      responsibilities: Array.isArray(role?.responsibilities) ? role.responsibilities.slice() : [],
      requirements: Array.isArray(role?.requirements) ? role.requirements.slice() : [],
    },
    questions: questions.map((row) => ({ ...row })),
  };
  const translationCache = new Map();
  const translateCached = async (value) => {
    const input = String(value || '').trim();
    if (!input) return '';
    let task = translationCache.get(input);
    if (!task) {
      task = safeTranslateInterviewText(input, targetLanguage);
      translationCache.set(input, task);
    }
    const translated = String(await task || '').trim();
    return translated || input;
  };

  if (needRoleLocalization) {
    const [roleSummary, responsibilities, requirements] = await Promise.all([
      translateCached(localized.role.roleSummary),
      Promise.all(localized.role.responsibilities.map((item) => translateCached(item))),
      Promise.all(localized.role.requirements.map((item) => translateCached(item))),
    ]);
    localized.role.roleSummary = roleSummary;
    localized.role.responsibilities = responsibilities;
    localized.role.requirements = requirements;
  }

  if (needQuestionLocalization) {
    localized.questions = await Promise.all(localized.questions.map(async (row) => {
      const nextRow = { ...row };
      if (questionNeedsLocalization(nextRow.question)) {
        nextRow.question = await translateCached(nextRow.question);
      }
      nextRow.question = enforceInterviewQuestionText(nextRow.question, targetLanguage);
      return nextRow;
    }));
  } else {
    for (let i = 0; i < localized.questions.length; i += 1) {
      localized.questions[i].question = enforceInterviewQuestionText(localized.questions[i].question, targetLanguage);
    }
  }

  return localized;
}

async function localizeInterviewSessionWithAi(session, targetLanguage, router, keyBase = '') {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'en') return session;
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  if (!questions.length) return session;

  const targetLanguageLabel = interviewLanguageLabel(targetLanguage);
  const prompt = `Return ONLY valid JSON (no markdown, no extra text).

Rewrite this interview session so ALL learner-facing text is in ${targetLanguageLabel}.
Do not translate IDs or change ordering.
Keep question count, question IDs, and focus values unchanged.
Keep proper nouns as-is only when unavoidable.
Do not convert questions into facts/statements.
Every question must remain an interrogative sentence and end with "?".

JSON shape:
{
  "role": {
    "jobTitle": string,
    "roleSummary": string,
    "responsibilities": string[],
    "requirements": string[]
  },
  "questions": [
    { "id": string, "question": string, "focus": string }
  ]
}

Session JSON:
${JSON.stringify(session)}`;

  const localizedRaw = await routeJsonWithRepair(
    router,
    prompt,
    `${keyBase || 'interview-session'}|localize-ai|${languageCode}`,
    {
      passes: 1,
      retryDelayMs: 500,
      maxTotalMs: 18000,
      throwOnError: false,
      routeOptions: { skipCache: true, bypassBreaker: true, maxTotalMs: 16000, maxAttempts: 3, attemptTimeoutMs: 7000, maxTokens: 520 },
    }
  );
  if (!localizedRaw) return session;
  return normalizeInterviewSession(
    localizedRaw,
    String(session?.role?.jobTitle || 'target role'),
    {},
    { targetLanguage, allowFallback: false, enforceLanguageGate: false }
  );
}

async function transcribeInterviewAudioWithOpenAI(audioBuffer, mimeType, language = '') {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    const e = new Error('Voice transcription is not configured on this server.');
    e.status = 503;
    throw e;
  }
  const normalizedMimeType = normalizeAudioMimeType(mimeType);
  const model = String(process.env.OPENAI_TRANSCRIPTION_MODEL || '').trim() || 'gpt-4o-mini-transcribe';
  const form = new FormData();
  const fileName = `interview-answer.${audioExtensionFromMimeType(normalizedMimeType)}`;
  form.append('file', new Blob([audioBuffer], { type: normalizedMimeType }), fileName);
  form.append('model', model);
  const cleanLanguage = String(language || '').trim().toLowerCase();
  if (/^[a-z]{2,5}(?:-[a-z]{2})?$/.test(cleanLanguage)) {
    form.append('language', cleanLanguage.slice(0, 5));
  }
  form.append('response_format', 'json');

  const r = await fetchJson('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  }, 45000);
  if (!r.ok) {
    const msg = r.json?.error?.message || r.text || 'Audio transcription failed';
    const e = new Error(msg);
    e.status = r.status || 502;
    throw e;
  }
  return String(r.json?.text || r.json?.transcript || '').replace(/\s+/g, ' ').trim();
}

function openRouterTranscriptionModels() {
  const fromList = envList('OPENROUTER_TRANSCRIPTION_MODELS', []);
  const fromSingle = String(process.env.OPENROUTER_TRANSCRIPTION_MODEL || '').trim();
  const fallback = [
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash-001',
    ...modelCandidatesFor('openrouter'),
  ];
  return Array.from(new Set([
    ...fromList,
    fromSingle,
    ...fallback,
  ].map((m) => String(m || '').trim()).filter(Boolean)));
}

function openRouterAudioInputFormatFromMimeType(mimeType) {
  const normalizedMime = normalizeAudioMimeType(mimeType);
  const ext = audioExtensionFromMimeType(normalizedMime);
  if (!ext) return 'webm';
  return ext;
}

function openRouterMessageContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .join(' ');
}

async function transcribeInterviewAudioWithOpenRouter(audioBuffer, mimeType, language = '') {
  const keys = openRouterApiKeys();
  if (!keys.length) {
    const e = new Error('OpenRouter transcription is not configured on this server.');
    e.status = 503;
    throw e;
  }
  const models = openRouterTranscriptionModels();
  if (!models.length) {
    const e = new Error('No OpenRouter transcription model is configured.');
    e.status = 503;
    throw e;
  }
  const cleanLanguage = String(language || '').trim().toLowerCase();
  const languageHint = cleanLanguage && /^[a-z]{2,5}(?:-[a-z]{2})?$/.test(cleanLanguage)
    ? cleanLanguage
    : 'auto';
  const audioFormat = openRouterAudioInputFormatFromMimeType(mimeType);
  const audioBase64 = Buffer.from(audioBuffer).toString('base64');

  let lastErr = null;
  const key = pickOpenRouterApiKey(`transcribe|${sha256(audioBase64.slice(0, 128))}`);
  const orderedKeys = Array.from(new Set([key, ...keys.filter((k) => k !== key)]));

  keyLoop:
  for (const token of orderedKeys) {
    for (const model of models) {
      const body = {
        model,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: 'You are a strict speech transcription engine. Return plain transcript text only.' },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Transcribe this spoken answer exactly as spoken. Keep original language (language hint: ${languageHint}). Do not translate. Return transcript text only.`,
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format: audioFormat,
                },
              },
            ],
          },
        ],
      };
      const r = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }, 60000);
      if (r.ok) {
        const content = r.json?.choices?.[0]?.message?.content;
        const transcript = openRouterMessageContentToText(content).replace(/\s+/g, ' ').trim();
        if (transcript) return transcript;
        const e = new Error('OpenRouter returned an empty transcript.');
        e.status = 502;
        lastErr = e;
        continue;
      }

      const msg = String(r.json?.error?.message || r.text || 'OpenRouter audio transcription error');
      const lower = msg.toLowerCase();
      if (r.status === 404 || lower.includes('model') && (lower.includes('not found') || lower.includes('unsupported'))) {
        const e = new Error(msg);
        e.status = r.status || 404;
        lastErr = e;
        continue;
      }
      if (r.status === 401 || r.status === 403 || isRetriableStatus(r.status)) {
        const e = new Error(msg);
        e.status = r.status || 503;
        lastErr = e;
        continue keyLoop;
      }
      const e = new Error(msg);
      e.status = r.status || 502;
      throw e;
    }
  }
  if (lastErr) throw lastErr;
  const e = new Error('OpenRouter transcription failed.');
  e.status = 503;
  throw e;
}

async function transcribeInterviewAudio(audioBuffer, mimeType, language = '') {
  const errors = [];
  if (openRouterApiKeys().length > 0) {
    try {
      return await transcribeInterviewAudioWithOpenRouter(audioBuffer, mimeType, language);
    } catch (e) {
      errors.push(`openrouter:${String(e?.message || 'failed')}`);
    }
  }
  if (String(process.env.OPENAI_API_KEY || '').trim()) {
    try {
      return await transcribeInterviewAudioWithOpenAI(audioBuffer, mimeType, language);
    } catch (e) {
      errors.push(`openai:${String(e?.message || 'failed')}`);
    }
  }
  const hasBudgetError = errors.some((msg) => {
    const lower = String(msg || '').toLowerCase();
    return (
      lower.includes('requires at least $0.50')
      || lower.includes('insufficient')
      || lower.includes('credit')
      || lower.includes('payment required')
    );
  });
  const e = new Error(
    errors.length
      ? `Voice transcription failed (${errors.join(' | ')})`
      : 'Voice transcription is not configured. Set OPENROUTER_API_KEY (and optional OPENROUTER_TRANSCRIPTION_MODEL) or OPENAI_API_KEY.'
  );
  e.status = hasBudgetError ? 402 : 503;
  throw e;
}

async function callAnthropic(prompt, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model,
    max_tokens: outputTokenCap(1200),
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

async function callOpenRouter(prompt, model, requestSeed = '', requestOptions = {}) {
  const allKeys = openRouterApiKeys();
  if (!allKeys.length) {
    const e = new Error('OpenRouter API key is missing');
    e.status = 401;
    throw e;
  }
  const requestedTimeoutMs = Number(requestOptions?.timeoutMs || 0);
  const requestTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.max(5000, Math.min(Math.floor(requestedTimeoutMs), providerTimeoutMs()))
    : providerTimeoutMs();
  const callStartedAt = Date.now();
  const callDeadlineAt = callStartedAt + requestTimeoutMs;
  const firstKey = pickOpenRouterApiKey(requestSeed);
  let keys = Array.from(new Set([
    firstKey,
    ...allKeys.filter((k) => k !== firstKey),
  ]));
  const requestedMaxKeys = Number(requestOptions?.openRouterMaxKeys || 0);
  if (Number.isFinite(requestedMaxKeys) && requestedMaxKeys > 0) {
    const maxKeys = Math.max(1, Math.min(Math.floor(requestedMaxKeys), keys.length));
    keys = keys.slice(0, maxKeys);
  }
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const requestedMaxTokens = Number(requestOptions?.maxTokens || 0);
  const base = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.max(256, Math.min(Math.floor(requestedMaxTokens), 4096))
    : openRouterBaseMaxTokens();
  const tokenCaps = Array.from(new Set([base, 1024, 768, 512, 384, 256]))
    .filter((n) => n <= base)
    .sort((a, b) => b - a);
  if (!tokenCaps.length) tokenCaps.push(256);

  let lastBudgetErr = null;
  let lastTransientErr = null;
  keyLoop:
  for (const key of keys) {
    for (const maxTokens of tokenCaps) {
      const remainingMs = callDeadlineAt - Date.now();
      if (remainingMs <= 0) {
        const timeoutErr = new Error(`OpenRouter request timed out after ${requestTimeoutMs}ms.`);
        timeoutErr.status = 503;
        throw timeoutErr;
      }
      const body = {
        model,
        messages: [
          { role: 'system', content: 'You are a precise educator. Follow instructions exactly.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
      };
      const r = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
        body: JSON.stringify(body),
      }, Math.max(1000, remainingMs));
      if (r.ok) {
        return r.json?.choices?.[0]?.message?.content || '';
      }

      const msg = r.json?.error?.message || r.text || 'OpenRouter error';
      if (isOpenRouterBudgetError(r.status, msg) && maxTokens > 256) {
        lastBudgetErr = { status: r.status, message: msg };
        continue;
      }

      if (isRetriableStatus(r.status)) {
        const retryErr = new Error(msg);
        retryErr.status = r.status || 503;
        lastTransientErr = retryErr;
        // Likely per-key pressure; immediately try next key.
        continue keyLoop;
      }

      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
  }

  if (lastTransientErr) throw lastTransientErr;
  const final = new Error(
    lastBudgetErr?.message || 'OpenRouter credit/token budget is insufficient for this request.'
  );
  final.status = lastBudgetErr?.status || 402;
  throw final;
}

function extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      return String(part.text || part.content || '');
    }).join('');
  }
  if (content && typeof content === 'object') {
    return String(content.text || content.content || '');
  }
  return '';
}

async function callMistral(prompt, model, requestSeed = '') {
  const key = pickMistralApiKey(requestSeed);
  if (!key) {
    const e = new Error('Mistral API key is not configured.');
    e.status = 503;
    throw e;
  }
  const url = 'https://api.mistral.ai/v1/chat/completions';
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a precise educator. Follow instructions exactly.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: outputTokenCap(1200),
  };
  const r = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = r.json?.error?.message || r.text || 'Mistral error';
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return extractAssistantText(r.json?.choices?.[0]?.message?.content);
}

function ollamaBaseUrl() {
  return String(process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
}

const ollamaModelDiscoveryCache = {
  at: 0,
  models: [],
};

function normalizeOllamaDiscoveredModels(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean)));
}

async function discoverOllamaModels() {
  const now = Date.now();
  if (ollamaModelDiscoveryCache.models.length && (now - ollamaModelDiscoveryCache.at) < (60 * 1000)) {
    return ollamaModelDiscoveryCache.models;
  }
  const url = `${ollamaBaseUrl()}/api/tags`;
  const r = await fetchJson(url, { method: 'GET' }, 8000);
  if (!r.ok) return ollamaModelDiscoveryCache.models;
  const discovered = normalizeOllamaDiscoveredModels(r.json?.models);
  if (!discovered.length) return ollamaModelDiscoveryCache.models;
  ollamaModelDiscoveryCache.at = now;
  ollamaModelDiscoveryCache.models = discovered;
  return discovered;
}

function isOllamaModelNotFound(status, message) {
  const lower = String(message || '').toLowerCase();
  if (status !== 404 && status !== 400) return false;
  return (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('does not exist') || lower.includes('pull'))
  );
}

function shouldFallbackToOllamaGenerate(status, message) {
  const lower = String(message || '').toLowerCase();
  if (status === 404 && (lower.includes('/api/chat') || lower.includes('not found'))) return true;
  return (
    lower.includes('template') ||
    lower.includes('chat template') ||
    lower.includes('unsupported') ||
    lower.includes('invalid message format')
  );
}

async function callOllama(prompt, model, requestOptions = {}) {
  const key = String(process.env.OLLAMA_API_KEY || '').trim();
  const baseUrl = ollamaBaseUrl();
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  const requestedTimeoutMs = Number(requestOptions?.timeoutMs || 0);
  const defaultOllamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 18000);
  const ollamaTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.max(8000, Math.min(Math.floor(requestedTimeoutMs), 45000))
    : Math.max(8000, Math.min(defaultOllamaTimeoutMs, 45000));

  const requestChat = async (candidateModel) => {
    const url = `${baseUrl}/api/chat`;
    const body = {
      model: candidateModel,
      stream: false,
      messages: [
        { role: 'system', content: 'You are a precise educator. Follow instructions exactly.' },
        { role: 'user', content: prompt }
      ],
      options: {
        temperature: 0.4,
        num_predict: outputTokenCap(1200),
      },
    };
    return fetchJson(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, ollamaTimeoutMs);
  };

  const requestGenerate = async (candidateModel) => {
    const url = `${baseUrl}/api/generate`;
    const body = {
      model: candidateModel,
      stream: false,
      prompt: `System: You are a precise educator. Follow instructions exactly.\n\nUser: ${prompt}`,
      options: {
        temperature: 0.4,
        num_predict: outputTokenCap(1200),
      },
    };
    return fetchJson(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, ollamaTimeoutMs);
  };

  const queue = Array.from(new Set([
    String(model || '').trim(),
    ...envList('OLLAMA_MODELS', ['llama3.2:3b']),
  ])).filter(Boolean);
  let expanded = false;
  let lastErr = null;

  for (let i = 0; i < queue.length; i++) {
    const candidateModel = queue[i];
    const chatResult = await requestChat(candidateModel);
    if (chatResult.ok) {
      return extractAssistantText(chatResult.json?.message?.content || chatResult.json?.choices?.[0]?.message?.content || chatResult.json?.response || '');
    }

    const chatMsg = chatResult.json?.error || chatResult.text || 'Ollama chat error';
    if (isOllamaModelNotFound(chatResult.status, chatMsg)) {
      if (!expanded) {
        expanded = true;
        const discovered = await discoverOllamaModels();
        for (const discoveredModel of discovered) {
          if (!queue.includes(discoveredModel)) queue.push(discoveredModel);
        }
      }
      lastErr = (() => {
        const e = new Error(chatMsg);
        e.status = chatResult.status;
        return e;
      })();
      continue;
    }

    if (shouldFallbackToOllamaGenerate(chatResult.status, chatMsg)) {
      const generateResult = await requestGenerate(candidateModel);
      if (generateResult.ok) {
        return extractAssistantText(generateResult.json?.response || generateResult.json?.message?.content || '');
      }
      const genMsg = generateResult.json?.error || generateResult.text || 'Ollama generate error';
      if (isOllamaModelNotFound(generateResult.status, genMsg)) {
        if (!expanded) {
          expanded = true;
          const discovered = await discoverOllamaModels();
          for (const discoveredModel of discovered) {
            if (!queue.includes(discoveredModel)) queue.push(discoveredModel);
          }
        }
        lastErr = (() => {
          const e = new Error(genMsg);
          e.status = generateResult.status;
          return e;
        })();
        continue;
      }
      const e = new Error(genMsg);
      e.status = generateResult.status;
      throw e;
    }

    const e = new Error(chatMsg);
    e.status = chatResult.status;
    throw e;
  }

  throw lastErr || new Error('Ollama error');
}

async function callProvider(provider, prompt, model, requestSeed = '', requestOptions = {}) {
  if (provider === 'gemini') return callGemini(prompt, model);
  if (provider === 'openai') return callOpenAI(prompt, model);
  if (provider === 'anthropic') return callAnthropic(prompt, model);
  if (provider === 'mistral') return callMistral(prompt, model, requestSeed);
  if (provider === 'ollama') return callOllama(prompt, model, requestOptions);
  if (provider === 'openrouter') return callOpenRouter(prompt, model, requestSeed, requestOptions);
  throw new Error(`Unknown provider: ${provider}`);
}

// circuit breaker per provider
const breaker = new Map(); // provider -> { fails, openUntil }

function breakerState(provider) {
  const s = breaker.get(provider) || { fails: 0, openUntil: 0 };
  breaker.set(provider, s);
  return s;
}

function normalizeRouterMode(value = 'auto_thinking') {
  const raw = String(value || 'auto_thinking').trim().toLowerCase();
  if (raw === 'manual') return 'manual';
  if (raw === 'auto_fast' || raw === 'autofast' || raw === 'fast') return 'auto_fast';
  if (
    raw === 'auto_thinking'
    || raw === 'autothinking'
    || raw === 'thinking'
    || raw === 'auto'
    || !raw
  ) {
    return 'auto_thinking';
  }
  return 'auto_thinking';
}

function prioritizeProviders(base = [], priority = []) {
  const ordered = [];
  const seen = new Set();
  for (const p of priority) {
    if (!base.includes(p) || seen.has(p)) continue;
    ordered.push(p);
    seen.add(p);
  }
  for (const p of base) {
    if (seen.has(p)) continue;
    ordered.push(p);
    seen.add(p);
  }
  return ordered;
}

const AUTO_FAST_PROVIDER_PRIORITY = ['mistral', 'openrouter', 'openai', 'gemini', 'anthropic', 'ollama'];

function pickAutoFastMistralModel(models = []) {
  const rows = Array.isArray(models) ? models.map((m) => String(m || '').trim()).filter(Boolean) : [];
  const priority = [
    'open-mistral-nemo',
    'mistral-small-latest',
    'ministral-8b-latest',
    'ministral-3b-latest',
    'mistral-medium-latest',
    'mistral-large-latest',
  ];
  for (const candidate of priority) {
    if (rows.includes(candidate)) return candidate;
  }
  return rows[0] || 'open-mistral-nemo';
}

async function routeText(router, prompt, cacheKey, ttlMs = 7 * 24 * 60 * 60 * 1000, options = {}) {
  const skipCache = !!options?.skipCache;
  const bypassBreaker = !!options?.bypassBreaker;
  const maxTotalMs = Math.max(8000, Math.min(Number(options?.maxTotalMs || process.env.AI_ROUTE_MAX_TOTAL_MS || 45000), 180000));
  const requestedMaxAttempts = Number(options?.maxAttempts || 0);
  const requestedAttemptTimeoutMs = Number(options?.attemptTimeoutMs || 0);
  const attemptTimeoutCapMs = Number.isFinite(requestedAttemptTimeoutMs) && requestedAttemptTimeoutMs > 0
    ? Math.max(5000, Math.min(Math.floor(requestedAttemptTimeoutMs), providerTimeoutMs()))
    : Math.max(8000, Math.min(providerTimeoutMs(), 25000));
  const requestedMaxTokens = Number(options?.maxTokens || 0);
  const routeMaxTokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.max(256, Math.min(Math.floor(requestedMaxTokens), 4096))
    : 0;
  if (!skipCache) {
    const cached = cacheGet(cacheKey, ttlMs);
    if (cached?.text) return cached.text;
  }

  const mode = normalizeRouterMode(router?.mode || 'auto');
  const provider = (router?.provider || 'auto').toLowerCase();
  const manualModel = router?.model || 'auto';
  const clientCandidates = Array.isArray(router?.modelCandidates) ? router.modelCandidates : null;

  const tryProviders = [];
  if (mode === 'manual' && provider !== 'auto') {
    if (providerAvailable(provider)) tryProviders.push(provider);
  } else {
    const availableProviders = providerCandidates().filter(providerAvailable);
    const orderedProviders = mode === 'auto_fast'
      ? prioritizeProviders(availableProviders, AUTO_FAST_PROVIDER_PRIORITY)
      : availableProviders;
    for (const p of orderedProviders) {
      if (providerAvailable(p)) tryProviders.push(p);
    }
  }

  if (!tryProviders.length) {
    const selectedMsg = mode === 'manual' && provider !== 'auto'
      ? `Selected provider "${provider}" is not configured or unavailable.`
      : 'No AI providers are configured. Add at least one API key (OPENROUTER_API_KEY / OPENROUTER_API_KEYS / MISTRAL_API_KEY / MISTRAL_API_KEYS) or Ollama config (OLLAMA_API_BASE / OLLAMA_MODELS).';
    throw new Error(selectedMsg);
  }

  let lastErr = null;
  let backoff = 500;
  const startedAt = Date.now();
  const providerAttemptCount = new Map();
  const manualModelBlockedProviders = new Set();
  const manualRetriableFailureCount = new Map();
  const maxAttempts = Number.isFinite(requestedMaxAttempts) && requestedMaxAttempts > 0
    ? Math.max(1, Math.min(Math.floor(requestedMaxAttempts), 30))
    : Math.max(4, tryProviders.length * 3);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if ((Date.now() - startedAt) > maxTotalMs) {
      const timeoutErr = lastErr || new Error(`AI request timed out after ${Math.round(maxTotalMs / 1000)}s.`);
      timeoutErr.status = timeoutErr.status || 503;
      throw timeoutErr;
    }
    const p = tryProviders[attempt % tryProviders.length];
    const br = breakerState(p);
    if (!bypassBreaker && Date.now() < br.openUntil) {
      continue;
    }

    const modelAttempt = providerAttemptCount.get(p) || 0;
    providerAttemptCount.set(p, modelAttempt + 1);

    const envModels = modelCandidatesFor(p);
    const models = clientCandidates && p === 'gemini'
      ? Array.from(new Set([
          ...clientCandidates.map((m) => String(m || '').trim()).filter(Boolean),
          ...envModels,
        ]))
      : envModels;
    const normalizedManualModel = String(manualModel || '').trim();
    const effectiveManualModel = (
      normalizedManualModel === 'auto-fast'
      || normalizedManualModel === 'auto-thinking'
    )
      ? 'auto'
      : normalizedManualModel;
    const canUseManual = !manualModelBlockedProviders.has(p) && (effectiveManualModel && effectiveManualModel !== 'auto') && (
      (mode === 'manual' && provider !== 'auto') ||
      (p === 'gemini' && String(effectiveManualModel).startsWith('gemini')) ||
      (p === 'openai' && String(effectiveManualModel).startsWith('gpt')) ||
      (p === 'anthropic' && String(effectiveManualModel).startsWith('claude')) ||
      (p === 'mistral' && /^(open-mistral|mistral|ministral|codestral|pixtral)/i.test(String(effectiveManualModel))) ||
      (p === 'ollama' && !String(effectiveManualModel).includes('/')) ||
      (p === 'openrouter' && String(effectiveManualModel).includes('/'))
    );
    const chosenModel = canUseManual
      ? effectiveManualModel
      : (
          mode === 'auto_fast' && p === 'mistral'
            ? pickAutoFastMistralModel(models)
            : (models[modelAttempt % Math.max(models.length, 1)] || models[0] || 'gpt-4o-mini')
        );

    try {
      const remainingBudgetMs = Math.max(5000, maxTotalMs - (Date.now() - startedAt));
      const perAttemptTimeoutMs = Math.max(5000, Math.min(attemptTimeoutCapMs, remainingBudgetMs));
      const providerRequestOptions = {
        timeoutMs: perAttemptTimeoutMs,
        maxTokens: routeMaxTokens,
      };
      const openRouterMaxKeys = Number(options?.openRouterMaxKeys || 0);
      if (Number.isFinite(openRouterMaxKeys) && openRouterMaxKeys > 0) {
        providerRequestOptions.openRouterMaxKeys = Math.max(1, Math.min(Math.floor(openRouterMaxKeys), 16));
      }
      const text = await callProvider(
        p,
        prompt,
        chosenModel,
        `${cacheKey}|${attempt}|${p}|${chosenModel}`,
        providerRequestOptions
      );
      if (!skipCache) {
        cacheSet(cacheKey, { text, provider: p, model: chosenModel, at: Date.now() });
      }
      br.fails = 0;
      br.openUntil = 0;
      manualRetriableFailureCount.delete(p);
      return text;
    } catch (e) {
      lastErr = e;
      const status = e.status || 0;
      const hasAlternativeModels = !canUseManual && Array.isArray(models) && models.length > 1;
      const exhaustedModels = !hasAlternativeModels || modelAttempt >= (models.length - 1);

      if (status === 404 && canUseManual) {
        // Manual model is likely outdated; retry this provider with its default candidates.
        manualModelBlockedProviders.add(p);
        continue;
      }

      if (status === 404 && hasAlternativeModels && !exhaustedModels) {
        // Try another model on the same provider before opening its breaker.
        continue;
      }

      if (status === 402 && canUseManual) {
        // Manual premium model may exceed budget; retry this provider with default candidates.
        manualModelBlockedProviders.add(p);
        continue;
      }

      if (status === 402 && hasAlternativeModels && !exhaustedModels) {
        // On budget error, walk through cheaper/free models before opening breaker.
        continue;
      }

      if (canUseManual && isRetriableStatus(status)) {
        const failures = (manualRetriableFailureCount.get(p) || 0) + 1;
        manualRetriableFailureCount.set(p, failures);
        if (failures >= 2) {
          // Manual model might be temporarily overloaded; fallback to provider defaults.
          manualModelBlockedProviders.add(p);
          continue;
        }
      }

      br.fails += 1;
      if (p === 'openrouter' && status === 402) {
        // Cool down briefly after exhausting all OpenRouter model candidates on budget errors.
        br.openUntil = Date.now() + 2 * 60 * 1000;
        continue;
      }
      if (p === 'ollama' && status === 0) {
        // Local Ollama usually means connection refused when not running; back off longer.
        br.openUntil = Date.now() + 5 * 60 * 1000;
      }
      if (status === 401 || status === 403 || status === 404) {
        // Invalid key/model/provider config; cool down this provider.
        br.openUntil = Date.now() + 10 * 60 * 1000;
      }
      if (br.fails >= 2 && isRetriableStatus(status)) {
        br.openUntil = Date.now() + 20_000;
      }

      if (isRetriableStatus(status)) {
        await sleep(Math.min(backoff, 5_000));
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
    'tutorial', 'course', 'video', 'youtube', 'guide', 'intro', 'basics',
    'learn', 'learning', 'overview', 'practice', 'part'
  ]);
  return Array.from(new Set(
    String(query || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .filter((w) => !stop.has(w))
  )).slice(0, 8);
}

function computeTextRelevanceScore(text, tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return { matchCount: 0, relevanceRatio: 0, penalty: 0, score: 0 };
  }
  const hay = String(text || '').toLowerCase();
  let matchCount = 0;
  for (const token of tokens) {
    if (hay.includes(token)) matchCount += 1;
  }
  const mismatchTokens = ['ukulele', 'guitar', 'piano', 'song', 'lyrics', 'music', 'cover', 'chord'];
  let penalty = 0;
  for (const mismatchToken of mismatchTokens) {
    if (hay.includes(mismatchToken) && !tokens.some((token) => token.includes(mismatchToken) || mismatchToken.includes(token))) {
      penalty += 1;
    }
  }
  const relevanceRatio = matchCount / Math.max(tokens.length, 1);
  const score = (matchCount * 2) + relevanceRatio - (penalty * 2);
  return { matchCount, relevanceRatio, penalty, score };
}

function passesVideoRelevanceGate(metrics, queryTokens) {
  const tokenCount = Array.isArray(queryTokens) ? queryTokens.length : 0;
  if (!metrics || tokenCount === 0) return true;
  if (metrics.penalty >= 2 && metrics.matchCount < 3) return false;
  if (tokenCount >= 5) {
    return metrics.matchCount >= 2 && metrics.relevanceRatio >= 0.28;
  }
  if (tokenCount >= 3) {
    return metrics.matchCount >= 2 || metrics.relevanceRatio >= 0.45;
  }
  return metrics.matchCount >= 1;
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
      .filter((it) => passesVideoRelevanceGate(it.relevance, queryTokens))
      .sort((a, b) => {
        if (a.relevance.score !== b.relevance.score) return b.relevance.score - a.relevance.score;
        if (a.relevance.matchCount !== b.relevance.matchCount) return b.relevance.matchCount - a.relevance.matchCount;
        return b.durationSeconds - a.durationSeconds;
      });

    const nonShortRanked = ranked.filter((it) => !it.short);
    if (!nonShortRanked.length) return null;

    for (const it of nonShortRanked) {
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
      if (!passesVideoRelevanceGate(relevance, queryTokens)) continue;
      candidates.push({
        id,
        title,
        relevance,
        short: isLikelyYouTubeShort(title, 0),
      });
    }

    candidates.sort((a, b) => {
      if (a.relevance.score !== b.relevance.score) return b.relevance.score - a.relevance.score;
      return b.relevance.matchCount - a.relevance.matchCount;
    });

    const best = candidates.find((c) => !c.short) || null;
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function supabaseAuthEnabled() {
  return !!(SUPABASE_AUTH_BASE && SUPABASE_ANON_KEY);
}

function supabaseDbEnabled() {
  return !!(SUPABASE_REST_BASE && SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseErrorMessage(resp, fallback = 'Supabase request failed') {
  if (!resp) return fallback;
  const j = resp.json || {};
  return String(
    j.error_description ||
    j.msg ||
    j.message ||
    j.error ||
    resp.text ||
    fallback
  );
}

function isSupabaseAlreadyRegisteredError(resp) {
  const message = String(supabaseErrorMessage(resp, '') || '').toLowerCase();
  const status = Number(resp?.status || 0);
  return status === 409
    || status === 422
    || message.includes('already registered')
    || message.includes('already exists')
    || message.includes('user already');
}

async function supabaseAuthRequest(pathname, method = 'GET', body = null, accessToken = '') {
  if (!supabaseAuthEnabled()) return { ok: false, status: 0, text: 'Supabase auth is not configured', json: null };
  const key = SUPABASE_ANON_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${accessToken || key}`,
  };
  if (body !== null) headers['content-type'] = 'application/json';
  return fetchJson(`${SUPABASE_AUTH_BASE}/${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  }, 45000);
}

async function supabaseAuthAdminRequest(pathname, method = 'GET', body = null) {
  if (!SUPABASE_AUTH_BASE) return { ok: false, status: 0, text: 'Supabase auth is not configured', json: null };
  if (!SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 0, text: 'Supabase service role key is missing', json: null };
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (body !== null) headers['content-type'] = 'application/json';
  return fetchJson(`${SUPABASE_AUTH_BASE}/${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  }, 45000);
}

async function supabaseRestRequest(pathname, options = {}) {
  const {
    method = 'GET',
    body = null,
    prefer = '',
    accessToken = '',
    useAnon = false,
  } = options || {};

  if (!SUPABASE_REST_BASE) return { ok: false, status: 0, text: 'Supabase DB is not configured', json: null };
  const key = useAnon ? SUPABASE_ANON_KEY : SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, status: 0, text: 'Supabase key is missing', json: null };

  const headers = {
    apikey: key,
    authorization: `Bearer ${accessToken || key}`,
  };
  if (body !== null) headers['content-type'] = 'application/json';
  if (prefer) headers['prefer'] = prefer;

  return fetchJson(`${SUPABASE_REST_BASE}/${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  }, 45000);
}

function buildInFilter(values) {
  const safe = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
  return `in.(${safe.join(',')})`;
}

function normalizeVisibility(value) {
  return String(value || '').toLowerCase() === 'public' ? 'public' : 'private';
}

function isCourseSnapshotLike(value) {
  return !!value && typeof value === 'object' && Array.isArray(value.modules);
}

function courseSnapshotScore(value) {
  if (!isCourseSnapshotLike(value)) return -1;
  const modules = Array.isArray(value.modules) ? value.modules : [];
  let stepsTotal = 0;
  let stepsCompleted = 0;
  let stepsWithContent = 0;
  for (const module of modules) {
    const steps = Array.isArray(module?.steps) ? module.steps : [];
    stepsTotal += steps.length;
    for (const step of steps) {
      if (String(step?.status || '') === 'completed') stepsCompleted += 1;
      if (step && typeof step === 'object' && step.content) stepsWithContent += 1;
    }
  }
  return (stepsWithContent * 10000) + (stepsCompleted * 100) + stepsTotal;
}

function pickRicherCourseSnapshot(incoming, existing) {
  const incomingScore = courseSnapshotScore(incoming);
  const existingScore = courseSnapshotScore(existing);
  if (incomingScore < 0 && existingScore < 0) return null;
  if (existingScore > incomingScore) return existing;
  return incoming;
}

function normalizeModeration(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'clean' || v === 'under_review' || v === 'flagged' || v === 'hidden') return v;
  return 'under_review';
}

async function fetchSupabaseLatestSnapshotsByCourseIds(courseIds) {
  const map = new Map();
  const ids = (courseIds || []).filter(isUuid);
  if (!ids.length || !supabaseDbEnabled()) return map;

  const params = new URLSearchParams();
  params.set('select', 'course_id,snapshot_version,snapshot_json');
  params.set('course_id', buildInFilter(ids));
  params.set('order', 'snapshot_version.desc');
  const r = await supabaseRestRequest(`course_snapshots?${params.toString()}`, { method: 'GET' });
  if (!r.ok || !Array.isArray(r.json)) return map;
  for (const row of r.json) {
    const key = String(row?.course_id || '').trim();
    if (!key || map.has(key)) continue;
    map.set(key, row?.snapshot_json || null);
  }
  return map;
}

async function fetchSupabasePostCounts(postIds, viewerId = '') {
  const reactionMap = new Map();
  const upvoteMap = new Map();
  const downvoteMap = new Map();
  const commentMap = new Map();
  const saveMap = new Map();
  const userReactionMap = new Map();
  const ids = (postIds || []).filter(isUuid);
  if (!ids.length || !supabaseDbEnabled()) {
    return { reactionMap, upvoteMap, downvoteMap, commentMap, saveMap, userReactionMap };
  }

  const postFilter = buildInFilter(ids);

  const reactionParams = new URLSearchParams();
  reactionParams.set('select', 'post_id,user_id,reaction,created_at');
  reactionParams.set('post_id', postFilter);
  reactionParams.set('order', 'created_at.desc');
  const reactionResp = await supabaseRestRequest(`course_reactions?${reactionParams.toString()}`, { method: 'GET' });
  if (reactionResp.ok && Array.isArray(reactionResp.json)) {
    const seenReactionByPostUser = new Set();
    for (const row of reactionResp.json) {
      const postId = String(row?.post_id || '');
      const userId = String(row?.user_id || '');
      if (!postId) continue;
      const dedupeKey = `${postId}:${userId}`;
      if (seenReactionByPostUser.has(dedupeKey)) continue;
      seenReactionByPostUser.add(dedupeKey);
      const reactionType = normalizeReactionType(row?.reaction);
      if (reactionType === 'down') {
        downvoteMap.set(postId, (downvoteMap.get(postId) || 0) + 1);
      } else {
        upvoteMap.set(postId, (upvoteMap.get(postId) || 0) + 1);
      }
      if (viewerId && userId === String(viewerId) && !userReactionMap.has(postId)) {
        userReactionMap.set(postId, reactionType);
      }
    }
  }

  for (const id of ids) {
    reactionMap.set(id, Number(upvoteMap.get(id) || 0));
  }

  const commentParams = new URLSearchParams();
  commentParams.set('select', 'post_id');
  commentParams.set('post_id', postFilter);
  commentParams.set('moderation_status', 'neq.hidden');
  const commentResp = await supabaseRestRequest(`course_comments?${commentParams.toString()}`, { method: 'GET' });
  if (commentResp.ok && Array.isArray(commentResp.json)) {
    for (const row of commentResp.json) {
      const postId = String(row?.post_id || '');
      commentMap.set(postId, (commentMap.get(postId) || 0) + 1);
    }
  }

  const saveParams = new URLSearchParams();
  saveParams.set('select', 'post_id,user_id');
  saveParams.set('post_id', postFilter);
  const saveResp = await supabaseRestRequest(`course_saves?${saveParams.toString()}`, { method: 'GET' });
  if (saveResp.ok && Array.isArray(saveResp.json)) {
    const seenSaveByPostUser = new Set();
    for (const row of saveResp.json) {
      const postId = String(row?.post_id || '');
      const userId = String(row?.user_id || '');
      const dedupeKey = `${postId}:${userId}`;
      if (seenSaveByPostUser.has(dedupeKey)) continue;
      seenSaveByPostUser.add(dedupeKey);
      saveMap.set(postId, (saveMap.get(postId) || 0) + 1);
    }
  }

  return { reactionMap, upvoteMap, downvoteMap, commentMap, saveMap, userReactionMap };
}

function computeLocalPostCounts(db, postId, viewerId = '', fallbackPost = null) {
  const out = {
    upvotes: 0,
    downvotes: 0,
    comments: 0,
    saves: 0,
    userReaction: null,
  };
  const reactions = Array.isArray(db?.reactions) ? db.reactions : [];
  const latestReactionByAccount = new Map();
  const reactionsForPost = reactions
    .filter((row) => String(row?.postId || '') === String(postId || ''))
    .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
  for (const row of reactionsForPost) {
    const reactionAccountId = String(row?.accountId || '').trim();
    if (!reactionAccountId || latestReactionByAccount.has(reactionAccountId)) continue;
    const reactionType = normalizeReactionType(row?.reaction);
    latestReactionByAccount.set(reactionAccountId, reactionType);
    if (viewerId && reactionAccountId === String(viewerId)) out.userReaction = reactionType;
  }
  for (const reactionType of latestReactionByAccount.values()) {
    if (reactionType === 'down') out.downvotes += 1;
    else out.upvotes += 1;
  }
  out.comments = (Array.isArray(db?.comments) ? db.comments : []).filter((row) => (
    String(row?.postId || '') === String(postId || '')
  )).length;
  const localSaveRows = (Array.isArray(db?.saves) ? db.saves : []).filter((row) => (
    String(row?.postId || '') === String(postId || '')
  ));
  const saveUsers = new Set(localSaveRows.map((row) => String(row?.accountId || '').trim()).filter(Boolean));
  out.saves = saveUsers.size || Number(fallbackPost?.saves || 0);
  return out;
}

function withLocalPostCounts(post, db, viewerId = '') {
  const counts = computeLocalPostCounts(db, post?.id, viewerId, post);
  return {
    ...post,
    reactions: counts.upvotes,
    upvotes: counts.upvotes,
    downvotes: counts.downvotes,
    comments: counts.comments,
    saves: counts.saves,
    userReaction: counts.userReaction,
  };
}

function sumReactionCountFromPosts(posts = []) {
  let total = 0;
  for (const post of posts) {
    total += Number((post?.upvotes ?? post?.reactions) || 0);
  }
  return total;
}

function localFollowStats(userId, viewerId = '', db) {
  const rows = Array.isArray(db?.follows) ? db.follows : [];
  const user = String(userId || '').trim();
  const viewer = String(viewerId || '').trim();
  const followers = rows.filter((row) => String(row?.followingId || '') === user).length;
  const following = rows.filter((row) => String(row?.followerId || '') === user).length;
  const isFollowing = !!(viewer && rows.some((row) => (
    String(row?.followerId || '') === viewer && String(row?.followingId || '') === user
  )));
  return { followers, following, isFollowing };
}

async function fetchSupabaseFollowStats(userId, viewerId = '') {
  const out = { followers: 0, following: 0, isFollowing: false };
  const target = String(userId || '').trim();
  const viewer = String(viewerId || '').trim();
  if (!supabaseDbEnabled() || !isUuid(target)) return out;

  const followersParams = new URLSearchParams();
  followersParams.set('select', 'follower_id');
  followersParams.set('following_id', `eq.${target}`);
  const followingParams = new URLSearchParams();
  followingParams.set('select', 'following_id');
  followingParams.set('follower_id', `eq.${target}`);

  const followCheckParams = new URLSearchParams();
  followCheckParams.set('select', 'id');
  followCheckParams.set('follower_id', `eq.${viewer}`);
  followCheckParams.set('following_id', `eq.${target}`);
  followCheckParams.set('limit', '1');

  const requests = [
    supabaseRestRequest(`user_follows?${followersParams.toString()}`, { method: 'GET' }),
    supabaseRestRequest(`user_follows?${followingParams.toString()}`, { method: 'GET' }),
  ];
  if (isUuid(viewer)) {
    requests.push(supabaseRestRequest(`user_follows?${followCheckParams.toString()}`, { method: 'GET' }));
  }

  const [followersResp, followingResp, followCheckResp] = await Promise.all(requests);
  if (followersResp?.ok && Array.isArray(followersResp.json)) {
    out.followers = followersResp.json.length;
  }
  if (followingResp?.ok && Array.isArray(followingResp.json)) {
    out.following = followingResp.json.length;
  }
  if (followCheckResp?.ok && Array.isArray(followCheckResp.json) && followCheckResp.json[0]) {
    out.isFollowing = true;
  }
  return out;
}

function toPostPublicShape(row, snapshotsByCourse, counts) {
  const courseMeta = Array.isArray(row?.courses) ? row.courses[0] : (row?.courses || {});
  const postId = String(row?.id || '');
  const courseId = String(row?.course_id || '');
  const upvotes = Number(counts.upvoteMap.get(postId) || 0);
  const downvotes = Number(counts.downvoteMap.get(postId) || 0);
  const userReaction = counts.userReactionMap.get(postId) || null;
  return {
    id: postId,
    courseId,
    ownerId: String(row?.owner_id || ''),
    title: String(row?.title || ''),
    description: String(row?.description || ''),
    snapshot: snapshotsByCourse.get(courseId) || null,
    language: String(row?.language || 'en'),
    segment: String(row?.segment || 'youth'),
    visibility: normalizeVisibility(courseMeta?.visibility),
    moderationStatus: normalizeModeration(row?.moderation_status || courseMeta?.moderation_status),
    reactions: upvotes,
    upvotes,
    downvotes,
    userReaction,
    comments: Number(counts.commentMap.get(postId) || 0),
    saves: Number(counts.saveMap.get(postId) || 0),
    createdAt: String(row?.created_at || nowIso()),
  };
}

async function listSupabasePublicPosts(options = {}) {
  const { ownerId = '', publicOnly = false, viewerId = '' } = options || {};
  if (!supabaseDbEnabled()) return [];

  const params = new URLSearchParams();
  params.set('select', 'id,course_id,owner_id,title,description,language,segment,moderation_status,created_at,courses!inner(visibility,moderation_status)');
  params.set('moderation_status', 'neq.hidden');
  params.set('order', 'created_at.desc');
  if (publicOnly) {
    params.set('courses.visibility', 'eq.public');
  }
  if (ownerId && isUuid(ownerId)) {
    params.set('owner_id', `eq.${ownerId}`);
  }

  const r = await supabaseRestRequest(`course_public_posts?${params.toString()}`, { method: 'GET' });
  if (!r.ok || !Array.isArray(r.json)) {
    throw new Error(supabaseErrorMessage(r, 'Failed to load Supabase posts'));
  }

  const rows = r.json;
  const postIds = rows.map((x) => String(x?.id || '')).filter(isUuid);
  const courseIds = rows.map((x) => String(x?.course_id || '')).filter(isUuid);
  const [counts, snapshotsByCourse] = await Promise.all([
    fetchSupabasePostCounts(postIds, viewerId),
    fetchSupabaseLatestSnapshotsByCourseIds(courseIds),
  ]);
  return rows.map((row) => toPostPublicShape(row, snapshotsByCourse, counts));
}

async function fetchSupabaseProfileRowById(userId) {
  if (!supabaseDbEnabled() || !isUuid(userId)) return null;
  const params = new URLSearchParams();
  params.set('id', `eq.${userId}`);
  params.set('limit', '1');

  const withVisibility = new URLSearchParams(params.toString());
  withVisibility.set('select', 'id,email,user_segment,connectivity_level,learning_goal,preferred_language,region,device_class,low_bandwidth_mode,professional_visibility,created_at,updated_at');
  let resp = await supabaseRestRequest(`profiles?${withVisibility.toString()}`, { method: 'GET' });
  if (!resp.ok) {
    const fallbackSelect = new URLSearchParams(params.toString());
    fallbackSelect.set('select', 'id,email,user_segment,connectivity_level,learning_goal,preferred_language,region,device_class,low_bandwidth_mode,created_at,updated_at');
    resp = await supabaseRestRequest(`profiles?${fallbackSelect.toString()}`, { method: 'GET' });
  }
  if (!resp.ok || !Array.isArray(resp.json) || !resp.json[0]) return null;
  return resp.json[0];
}

async function fetchSupabaseCvRowByUserId(userId) {
  if (!supabaseDbEnabled() || !isUuid(userId)) return null;
  const params = new URLSearchParams();
  params.set('select', 'user_id,valid,format,confidence,file_name,mime_type,issues,parsed,updated_at,created_at');
  params.set('user_id', `eq.${userId}`);
  params.set('limit', '1');
  const resp = await supabaseRestRequest(`profile_cv?${params.toString()}`, { method: 'GET' });
  if (!resp.ok || !Array.isArray(resp.json) || !resp.json[0]) return null;
  return resp.json[0];
}

async function setSupabaseFollowState(followerId, followingId, follow) {
  if (!supabaseDbEnabled() || !isUuid(followerId) || !isUuid(followingId)) return;
  if (follow) {
    const insertResp = await supabaseRestRequest('user_follows?on_conflict=follower_id,following_id', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        follower_id: followerId,
        following_id: followingId,
      },
    });
    if (!insertResp.ok) {
      throw new Error(supabaseErrorMessage(insertResp, 'Failed to follow creator'));
    }
    return;
  }
  const params = new URLSearchParams();
  params.set('follower_id', `eq.${followerId}`);
  params.set('following_id', `eq.${followingId}`);
  const deleteResp = await supabaseRestRequest(`user_follows?${params.toString()}`, { method: 'DELETE' });
  if (!deleteResp.ok) {
    throw new Error(supabaseErrorMessage(deleteResp, 'Failed to unfollow creator'));
  }
}

async function buildSupabaseCreatorPublicProfile(ownerId, viewerId = '') {
  if (!supabaseDbEnabled() || !isUuid(ownerId)) return null;

  const [profileRow, cvRow, courses, followStats] = await Promise.all([
    fetchSupabaseProfileRowById(ownerId),
    fetchSupabaseCvRowByUserId(ownerId),
    listSupabasePublicPosts({ ownerId, publicOnly: true, viewerId }),
    fetchSupabaseFollowStats(ownerId, viewerId),
  ]);
  if (!profileRow && !courses.length) return null;

  const professionalVisibility = normalizeProfessionalVisibility(profileRow?.professional_visibility);
  const canSeeDashboard = professionalVisibility === 'public' || String(ownerId) === String(viewerId);
  const normalizedCv = cvRow
    ? normalizeCvAnalysisResult({
        valid: !!cvRow.valid,
        format: String(cvRow.format || 'unknown'),
        confidence: Number(cvRow.confidence || 0),
        fileName: String(cvRow.file_name || ''),
        mimeType: String(cvRow.mime_type || ''),
        issues: Array.isArray(cvRow.issues) ? cvRow.issues : [],
        parsed: cvRow.parsed && typeof cvRow.parsed === 'object' ? cvRow.parsed : {},
        updatedAt: cvRow.updated_at || cvRow.created_at || nowIso(),
      }, {})
    : null;
  const parsedDashboard = canSeeDashboard ? (normalizedCv?.parsed || null) : null;
  const totalLikes = sumReactionCountFromPosts(courses);

  return {
    id: String(ownerId),
    displayName: deriveDisplayName(ownerId, String(profileRow?.email || ''), parsedDashboard || normalizedCv?.parsed || null),
    headline: canSeeDashboard ? String(parsedDashboard?.headline || '') : '',
    summary: canSeeDashboard ? String(parsedDashboard?.summary || '') : '',
    profileImageDataUrl: canSeeDashboard ? String(parsedDashboard?.profileImageDataUrl || '') : '',
    region: String(profileRow?.region || 'ASEAN'),
    preferredLanguage: String(profileRow?.preferred_language || 'en'),
    userSegment: String(profileRow?.user_segment || 'youth'),
    professionalVisibility,
    stats: {
      totalLikes,
      totalFollowers: Number(followStats.followers || 0),
      totalFollowing: Number(followStats.following || 0),
      publicCourses: courses.length,
    },
    dashboard: parsedDashboard,
    courses,
    isFollowing: !!followStats.isFollowing,
  };
}

async function upsertSupabaseCoursePublication(accountId, visibility, course, profileContext, courseIdHint = '') {
  if (!supabaseDbEnabled()) throw new Error('Supabase DB is not configured');
  if (!isUuid(accountId)) throw new Error('Supabase publish requires authenticated user id');

  const cleanVisibility = normalizeVisibility(visibility);
  const hintedCourseId = String(courseIdHint || '').trim();
  let existingCourse = null;

  if (isUuid(hintedCourseId)) {
    const byIdParams = new URLSearchParams();
    byIdParams.set('select', 'id,title,moderation_status');
    byIdParams.set('id', `eq.${hintedCourseId}`);
    byIdParams.set('owner_id', `eq.${accountId}`);
    byIdParams.set('limit', '1');
    const byIdResp = await supabaseRestRequest(`courses?${byIdParams.toString()}`, { method: 'GET' });
    if (byIdResp.ok && Array.isArray(byIdResp.json) && byIdResp.json[0]) {
      existingCourse = byIdResp.json[0];
    }
  }

  const title = String(course?.title || existingCourse?.title || '').trim() || 'Untitled Course';
  const description = String(course?.description || '').trim();
  const language = String(profileContext?.preferredLanguage || 'en').toLowerCase();
  const segment = String(profileContext?.userSegment || 'youth');

  if (!existingCourse) {
    const courseLookupParams = new URLSearchParams();
    courseLookupParams.set('select', 'id,title,moderation_status');
    courseLookupParams.set('owner_id', `eq.${accountId}`);
    courseLookupParams.set('title', `eq.${title}`);
    courseLookupParams.set('order', 'created_at.desc');
    courseLookupParams.set('limit', '1');
    const existingCourseResp = await supabaseRestRequest(`courses?${courseLookupParams.toString()}`, { method: 'GET' });
    existingCourse = existingCourseResp.ok && Array.isArray(existingCourseResp.json) ? existingCourseResp.json[0] : null;
  }

  const nextModeration = cleanVisibility === 'public'
    ? (String(existingCourse?.moderation_status || '').toLowerCase() === 'hidden' ? 'hidden' : 'under_review')
    : 'clean';

  let courseRow = existingCourse;
  if (!existingCourse?.id) {
    const insertResp = await supabaseRestRequest('courses', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        owner_id: accountId,
        title,
        description,
        visibility: cleanVisibility,
        moderation_status: nextModeration,
        language,
        segment,
      },
    });
    if (!insertResp.ok || !Array.isArray(insertResp.json) || !insertResp.json[0]?.id) {
      throw new Error(supabaseErrorMessage(insertResp, 'Failed to create course in Supabase'));
    }
    courseRow = insertResp.json[0];
  } else {
    const updateParams = new URLSearchParams();
    updateParams.set('id', `eq.${existingCourse.id}`);
    updateParams.set('owner_id', `eq.${accountId}`);
    const updateResp = await supabaseRestRequest(`courses?${updateParams.toString()}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        title,
        description,
        visibility: cleanVisibility,
        moderation_status: nextModeration,
        language,
        segment,
        updated_at: nowIso(),
      },
    });
    if (!updateResp.ok) {
      throw new Error(supabaseErrorMessage(updateResp, 'Failed to update course in Supabase'));
    }
    if (Array.isArray(updateResp.json) && updateResp.json[0]) {
      courseRow = updateResp.json[0];
    }
  }

  const courseId = String(courseRow?.id || '').trim();
  if (!isUuid(courseId)) throw new Error('Invalid Supabase course id');

  const snapshotVersionParams = new URLSearchParams();
  snapshotVersionParams.set('select', 'snapshot_version,snapshot_json');
  snapshotVersionParams.set('course_id', `eq.${courseId}`);
  snapshotVersionParams.set('order', 'snapshot_version.desc');
  snapshotVersionParams.set('limit', '1');
  const snapshotVersionResp = await supabaseRestRequest(`course_snapshots?${snapshotVersionParams.toString()}`, { method: 'GET' });
  const latestSnapshotRow = snapshotVersionResp.ok && Array.isArray(snapshotVersionResp.json) && snapshotVersionResp.json[0]
    ? snapshotVersionResp.json[0]
    : null;
  const latestVersion = latestSnapshotRow
    ? Number(latestSnapshotRow.snapshot_version || 0)
    : 0;
  const nextVersion = Number.isFinite(latestVersion) ? latestVersion + 1 : 1;
  const incomingSnapshot = isCourseSnapshotLike(course) ? course : null;
  const existingSnapshot = latestSnapshotRow?.snapshot_json || null;
  const snapshotToStore = pickRicherCourseSnapshot(incomingSnapshot, existingSnapshot) || incomingSnapshot || existingSnapshot || {
    title,
    description,
    modules: [],
  };

  const snapshotInsertResp = await supabaseRestRequest('course_snapshots', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      course_id: courseId,
      snapshot_version: nextVersion,
      snapshot_json: snapshotToStore,
    },
  });
  if (!snapshotInsertResp.ok) {
    throw new Error(supabaseErrorMessage(snapshotInsertResp, 'Failed to store Supabase course snapshot'));
  }

  const postLookupParams = new URLSearchParams();
  postLookupParams.set('select', 'id,moderation_status');
  postLookupParams.set('course_id', `eq.${courseId}`);
  postLookupParams.set('owner_id', `eq.${accountId}`);
  postLookupParams.set('order', 'created_at.desc');
  postLookupParams.set('limit', '1');
  const existingPostResp = await supabaseRestRequest(`course_public_posts?${postLookupParams.toString()}`, { method: 'GET' });
  const existingPost = existingPostResp.ok && Array.isArray(existingPostResp.json) ? existingPostResp.json[0] : null;

  let postRow = existingPost;
  if (!existingPost?.id) {
    const postInsertResp = await supabaseRestRequest('course_public_posts', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        course_id: courseId,
        owner_id: accountId,
        title,
        description,
        language,
        segment,
        moderation_status: nextModeration,
      },
    });
    if (!postInsertResp.ok || !Array.isArray(postInsertResp.json) || !postInsertResp.json[0]?.id) {
      throw new Error(supabaseErrorMessage(postInsertResp, 'Failed to create Supabase public post'));
    }
    postRow = postInsertResp.json[0];
  } else {
    const postUpdateParams = new URLSearchParams();
    postUpdateParams.set('id', `eq.${existingPost.id}`);
    postUpdateParams.set('owner_id', `eq.${accountId}`);
    const postUpdateResp = await supabaseRestRequest(`course_public_posts?${postUpdateParams.toString()}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        title,
        description,
        language,
        segment,
        moderation_status: nextModeration,
      },
    });
    if (!postUpdateResp.ok) {
      throw new Error(supabaseErrorMessage(postUpdateResp, 'Failed to update Supabase public post'));
    }
    if (Array.isArray(postUpdateResp.json) && postUpdateResp.json[0]) {
      postRow = postUpdateResp.json[0];
    }
  }

  return {
    id: String(postRow?.id || ''),
    courseId,
    visibility: cleanVisibility,
    moderationStatus: nextModeration,
  };
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

function supplementalReferencesForTopic(topicText, max = 4) {
  const topic = String(topicText || '').trim();
  const lower = topic.toLowerCase();
  const out = [];
  const add = (title, url, kind = 'web') => {
    const normalized = normalizeReferenceUrl(url);
    if (!normalized) return;
    out.push({
      title: String(title || 'Reference').trim() || 'Reference',
      url: normalized,
      kind,
    });
  };

  if (/\bjava\b/i.test(lower)) {
    add('Dev.java Learning', 'https://dev.java/learn/');
    add('Oracle Java Documentation', 'https://docs.oracle.com/en/java/');
  }
  if (/\bpython\b/i.test(lower)) {
    add('Python Official Tutorial', 'https://docs.python.org/3/tutorial/');
    add('Python Standard Library', 'https://docs.python.org/3/library/');
  }
  if (/\b(javascript|typescript|node|react|html|css|web)\b/i.test(lower)) {
    add('MDN Web Docs', 'https://developer.mozilla.org/');
  }
  if (/\b(sql|database|postgres|mysql)\b/i.test(lower)) {
    add('PostgreSQL Documentation', 'https://www.postgresql.org/docs/');
    add('MySQL Documentation', 'https://dev.mysql.com/doc/');
  }
  if (/\b(cybersecurity|security|owasp|threat|vulnerability)\b/i.test(lower)) {
    add('OWASP Top 10', 'https://owasp.org/www-project-top-ten/');
    add('CISA Cybersecurity Resources', 'https://www.cisa.gov/topics/cybersecurity-best-practices');
  }
  if (/\b(network|internet|tcp|ip|dns|routing)\b/i.test(lower)) {
    add('Cisco Networking Academy', 'https://www.netacad.com/');
  }

  add(
    'Wikipedia Topic Overview',
    `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic || 'learning topic')}`
  );
  add(
    'Google Scholar Search',
    `https://scholar.google.com/scholar?q=${encodeURIComponent(topic || 'learning topic')}`
  );

  return normalizeReferences(out).slice(0, max);
}

function mergeReferences(existing, extra) {
  return normalizeReferences([
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(extra) ? extra : []),
  ]);
}

// ------------------------ prompt builders ------------------------

function promptAssessment(topic, profileContext = {}) {
  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON (no markdown, no extra text).\n\nTask: Generate 3-4 short assessment questions to understand a learner's current level and goals for: ${topic}.\n\nProfile constraints:\n${profileRules}\n\nJSON format: an array of objects with: id (string), question (string), type ('text' or 'choice'), options (optional array of strings).`;
}

function promptInterviewQuestionsDirect(options = {}) {
  const requestedJobTitle = String(options?.requestedJobTitle || 'target role').replace(/\s+/g, ' ').trim() || 'target role';
  const targetLanguage = String(options?.targetLanguage || 'en-US').trim() || 'en-US';
  const targetLanguageLabel = String(options?.targetLanguageLabel || interviewLanguageLabel(targetLanguage)).trim() || targetLanguage;
  const localeCode = normalizeInterviewLanguageCode(targetLanguage);
  const candidateName = String(options?.candidateName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const region = String(options?.region || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const profileSkills = normalizeInterviewList(options?.profileSkills, 10, 80);
  const profileExperience = Array.isArray(options?.profileExperience)
    ? options.profileExperience
      .map((row) => {
        const role = String(row?.role || '').replace(/\s+/g, ' ').trim();
        const org = String(row?.organization || '').replace(/\s+/g, ' ').trim();
        if (!role && !org) return '';
        return org ? `${role} @ ${org}`.trim() : role;
      })
      .filter(Boolean)
      .slice(0, 6)
    : [];
  const seniorityRaw = String(options?.seniority || 'mid').trim().toLowerCase();
  const seniority = ['entry', 'mid', 'senior'].includes(seniorityRaw) ? seniorityRaw : 'mid';
  const questionFocusRaw = String(options?.questionFocus || 'mixed').trim().toLowerCase();
  const questionFocus = ['mixed', 'behavioral', 'technical'].includes(questionFocusRaw) ? questionFocusRaw : 'mixed';
  const strictRetry = !!options?.strictRetry;
  const questionPlan = options?.questionPlan && typeof options.questionPlan === 'object' ? options.questionPlan : {};
  const defaultCount = seniority === 'entry' ? 6 : (seniority === 'senior' ? 10 : 8);
  const questionCount = Math.max(4, Math.min(12, Number(options?.questionCount || questionPlan?.targetCount) || defaultCount));
  const strictLocaleGate = localeCode === 'en'
    ? '- Language gate: English output is allowed.'
    : (['my', 'th', 'km', 'lo'].includes(localeCode)
      ? `- CRITICAL LANGUAGE GATE: Use ${targetLanguageLabel} script for at least 95% of letters in ALL learner-facing text. Do not use English sentence frames.`
      : `- CRITICAL LANGUAGE GATE: All learner-facing text must be fully in ${targetLanguageLabel}. Avoid English sentence frames; only keep unavoidable proper nouns/tool names.`);
  return `Return ONLY valid JSON (no markdown, no extra text).

You are a professional multilingual interviewer creating realistic hiring questions for a ${seniority}-level ${requestedJobTitle} candidate.
Generate exactly ${questionCount} interview questions focused on ${questionFocus}, based on real responsibilities and required skills for this role.
Also generate ONE short roleSummary sentence that reflects real responsibilities and required skills of ${requestedJobTitle}.
Write roleSummary and all questions in ${targetLanguageLabel} (${targetLanguage}).
Keep each question concise, professional, non-repetitive, and tightly role-specific.
Avoid generic, theoretical, trivia-style, or overly broad questions.
- Keep role.jobTitle exactly as "${requestedJobTitle}" (no renaming or role substitution).
- If profile history is unrelated to "${requestedJobTitle}", use only transferable skills and do NOT inject unrelated company names/domains.
- Never overfit to profile context when it conflicts with requested role responsibilities.
${region ? `Target market/region context: ${region}.` : ''}
${profileSkills.length ? `Candidate skills context: ${profileSkills.join(', ')}.` : ''}
${profileExperience.length ? `Candidate experience context: ${profileExperience.join(' | ')}.` : ''}
${strictLocaleGate}
- Self-check before final output: reject and rewrite any row containing mixed-language sentence scaffolding.

Each question should be creative. Avoid simple format.
Forbidden generic questions: "Tell me about yourself", "Why should we hire you?", "What are your strengths and weaknesses?", "Walk me through your resume".
Do not output interview questions in English unless target language is English.
If target language is not English, keep each full sentence in the target language and avoid English scaffold words like "Scenario", "KPI", "diagnostic", or "recovery".
If target language is not English, the question must be completely generated in (${targetLanguage}).
${candidateName ? `Use candidate name "${candidateName}" naturally in 1-2 questions only; do not force it into every question.` : ''}
${strictRetry ? `Previous output was weak. Regenerate from scratch and keep every question tightly role-specific for "${requestedJobTitle}".` : ''}
Return ONLY valid JSON with exactly this schema:
{
  "role": {
    "jobTitle": "string",
    "roleSummary": "string"
  },
  "questions": [{"id":"string","question":"string","focus":"string"}]
}.`;
}

function buildOutlineFactCorrectionContext(topic, answers = {}) {
  const questionText = Object.keys(answers || {}).map((v) => String(v || '')).join('\n');
  const answerText = Object.values(answers || {}).map((v) => String(v || '')).join('\n');
  const merged = `${topic}\n${questionText}\n${answerText}`.toLowerCase();
  const mentionsMyanmar = /\bmyanmar\b|\bburma\b/.test(merged);
  const mentionsColonial = /colonis|coloniz|colonial|coloniser|colonizer/.test(merged);

  if (mentionsMyanmar && mentionsColonial) {
    return {
      note: 'Historical guardrail: Myanmar was colonized by the British Empire, not the Netherlands.',
      replacements: [
        { pattern: /\bthe\s+netherlands[â€™']?\s+shadow\b/gi, replace: 'British colonial rule' },
        { pattern: /\bnetherlands[â€™']?s?\b/gi, replace: 'British' },
        { pattern: /\bdutch\b/gi, replace: 'British' },
        { pattern: /\beuropean colonial powers in myanmar\b/gi, replace: 'British colonial rule in Myanmar' },
      ],
    };
  }

  return {
    note: '',
    replacements: [],
  };
}

function applyOutlineFactCorrections(value, factContext) {
  let out = String(value || '').trim();
  if (!out) return out;
  const replacements = Array.isArray(factContext?.replacements) ? factContext.replacements : [];
  for (const rule of replacements) {
    if (!rule?.pattern) continue;
    out = out.replace(rule.pattern, String(rule.replace || ''));
  }
  out = out
    .replace(/\bBritish's\b/g, 'British')
    .replace(/\bBritishs\b/g, 'British')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function promptCourseOutline(topic, answers, profileContext = {}) {
  const factContext = buildOutlineFactCorrectionContext(topic, answers);
  const context = Object.entries(answers || {})
    .map(([q, a]) => {
      const cleanQ = String(q || '').trim();
      const cleanA = applyOutlineFactCorrections(String(a || '').trim(), factContext);
      return `Q: ${cleanQ}\nA: ${cleanA}`;
    })
    .join('\n\n');
  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON.

Create a learner-specific 4-module course outline for: ${topic}.
Use learner goals and constraints from survey context below, but DO NOT treat all survey statements as facts.

Learner survey context:
${context || '- No survey details provided.'}

Profile constraints:
${profileRules}

Hard requirements:
- Exactly 4 modules.
- Each module title must be specific and distinct (no generic labels like "Module 1", "Foundations of Foundations", or repeated patterns).
- At least 2 module titles must explicitly include learner goals, constraints, or preferred outcomes from survey answers.
- Module descriptions must mention concrete skills/tasks, not vague statements.
- Treat survey answers as learner perspective. Verify factual claims against established knowledge before using them.
- If a survey claim is likely wrong, convert it into correction-focused phrasing (for example, myth vs fact), never present it as truth.
${factContext.note ? `- ${factContext.note}` : ''}

JSON format:
{
  "title": string,
  "description": string,
  "modules": [{"id": string, "title": string, "description": string}]
}`;
}

function topicDisplayName(topic) {
  const clean = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'This topic';
  return clean.slice(0, 80);
}

function fallbackAssessment(topic) {
  const t = topicDisplayName(topic);
  return [
    {
      id: 'q1',
      question: `What is your current experience with ${t}?`,
      type: 'text',
    },
    {
      id: 'q2',
      question: `What do you want to be able to do after learning ${t}?`,
      type: 'text',
    },
    {
      id: 'q3',
      question: 'How much time can you study each week?',
      type: 'choice',
      options: ['1-2 hours', '3-5 hours', '6-8 hours', '8+ hours'],
    },
    {
      id: 'q4',
      question: 'Which learning style helps you most?',
      type: 'choice',
      options: ['Hands-on practice', 'Short videos', 'Reading and notes', 'Quizzes and challenges'],
    },
  ];
}

function fallbackCourseOutline(topic, answers = {}) {
  const t = topicDisplayName(topic);
  const programmingTrack = isProgrammingTopic(t);
  const factContext = buildOutlineFactCorrectionContext(t, answers);
  const answerHints = Object.values(answers || {})
    .map((v) => applyOutlineFactCorrections(String(v || '').trim(), factContext))
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  const descHint = answerHints ? ` Learner goals: ${answerHints.slice(0, 180)}.` : '';

  const answerTopics = extractMeaningfulTokens(answerHints || t, 6);
  const f1 = answerTopics[0] || 'Core Fundamentals';
  const f2 = answerTopics[1] || 'Workflow';
  const f3 = answerTopics[2] || 'Applied Practice';
  const f4 = answerTopics[3] || 'Real-World Readiness';

  if (programmingTrack) {
    return {
      title: `${t} Learning Path`,
      description: `A practical, beginner-friendly path to build core skills and confidence in ${t}.${descHint}`,
      modules: [
        { id: 'module-1', title: `${t}: ${f1}`, description: `Understand essential concepts, terms, and setup for ${t}.` },
        { id: 'module-2', title: `${t}: ${f2}`, description: `Build the day-to-day workflow with practical examples.` },
        { id: 'module-3', title: `${t}: ${f3}`, description: `Practice through guided exercises and scenario-based tasks.` },
        { id: 'module-4', title: `${t}: ${f4}`, description: `Apply skills to realistic tasks and readiness checkpoints.` },
      ],
    };
  }

  return {
    title: `${t} Learning Path`,
    description: `A structured, practical course to build strong understanding and application in ${t}.${descHint}`,
    modules: [
      { id: 'module-1', title: `${t}: ${f1}`, description: `Build baseline understanding, vocabulary, and foundational context.` },
      { id: 'module-2', title: `${t}: ${f2}`, description: `Learn major ideas and how they connect in real decisions.` },
      { id: 'module-3', title: `${t}: ${f3}`, description: `Apply concepts through practical scenarios and case examples.` },
      { id: 'module-4', title: `${t}: ${f4}`, description: `Review mastery with structured application and reflection.` },
    ],
  };
}

function normalizeCourseOutline(raw, topic, answers = {}) {
  const fb = fallbackCourseOutline(topic, answers);
  const factContext = buildOutlineFactCorrectionContext(topic, answers);
  if (!raw || typeof raw !== 'object') return fb;

  const clean = (v) => String(v || '').trim();
  const title = applyOutlineFactCorrections(clean(raw.title) || fb.title, factContext) || fb.title;
  const description = applyOutlineFactCorrections(clean(raw.description) || fb.description, factContext) || fb.description;
  const sourceModules = Array.isArray(raw.modules) ? raw.modules : [];
  if (!sourceModules.length) return { ...fb, title, description };

  const genericTitle = (value) => {
    const text = clean(value).toLowerCase();
    if (!text) return true;
    if (/^module\s*\d+/.test(text)) return true;
    if (/^(lesson|topic|unit)\s*\d+/.test(text)) return true;
    if (text.length < 5) return true;
    return false;
  };

  const seen = new Set();
  const normalized = [];
  for (let i = 0; i < sourceModules.length && normalized.length < 6; i++) {
    const m = sourceModules[i] || {};
    const fallbackModule = fb.modules[normalized.length % fb.modules.length];
    const moduleTitleRaw = applyOutlineFactCorrections(clean(m.title), factContext);
    const moduleTitle = genericTitle(moduleTitleRaw) ? fallbackModule.title : moduleTitleRaw;
    const moduleDesc = applyOutlineFactCorrections(clean(m.description), factContext) || fallbackModule.description;
    const signature = moduleTitle.toLowerCase();
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    normalized.push({
      id: clean(m.id) || `module-${normalized.length + 1}`,
      title: moduleTitle,
      description: moduleDesc,
    });
  }

  while (normalized.length < 4 && normalized.length < fb.modules.length) {
    const f = fb.modules[normalized.length];
    const sig = String(f.title || '').toLowerCase();
    if (!seen.has(sig)) {
      seen.add(sig);
      normalized.push({
        id: `module-${normalized.length + 1}`,
        title: applyOutlineFactCorrections(f.title, factContext) || f.title,
        description: applyOutlineFactCorrections(f.description, factContext) || f.description,
      });
    } else {
      break;
    }
  }

  return {
    title,
    description,
    modules: normalized.length ? normalized : fb.modules,
  };
}

function fallbackModuleLessonPlan(courseTitle, moduleTitle, moduleDesc = '') {
  const programmingTrack = isProgrammingTopic(courseTitle, moduleTitle, moduleDesc);
  const tokens = extractMeaningfulTokens(`${moduleTitle} ${moduleDesc}`, 4);
  const primary = tokens[0] || moduleTitle || 'This topic';
  const secondary = tokens[1] || tokens[0] || primary;
  const tertiary = tokens[2] || tokens[1] || tokens[0] || secondary;
  const lessonTopics = [
    `${primary} Fundamentals`,
    `${secondary} Practical Applications`,
    `${tertiary} Mastery`,
  ];

  const flow = lessonFlowTypes(programmingTrack);

  const out = [];
  let cursor = 1;
  for (const lessonTopic of lessonTopics) {
    for (const type of flow) {
      out.push({
        id: `step-${cursor}`,
        title: titleForLessonFlowStep(lessonTopic, type),
        type,
      });
      cursor += 1;
    }
  }
  return out;
}

function promptLessonPlan(courseTitle, moduleTitle, moduleDesc, profileContext = {}) {
  const normalizedProfile = normalizeProfileContext(profileContext);
  const programmingTrack = isProgrammingTopic(courseTitle, moduleTitle, moduleDesc);
  const lowBandwidth = normalizedProfile.lowBandwidthMode;
  const step5Rule = programmingTrack
    ? (lowBandwidth
      ? '- Step5 POP_CARD or LEARNING_CARD (low bandwidth mode, no heavy coding mini-game)'
      : '- Step5 CODE_BUILDER (only for programming/software topics)')
    : '- Step5 POP_CARD or LEARNING_CARD (concept clarification, no coding game)';
  const domainRule = programmingTrack
    ? (lowBandwidth
      ? '- Keep exercises lightweight and text-first because of low bandwidth constraints.'
      : '- Keep coding practice tied to the concepts taught in this module.')
    : '- Do NOT include CODE_BUILDER for non-programming topics.';
  const profileRules = profileRulesText(profileContext);

  return `Return ONLY valid JSON (array).

Plan a detailed module lesson plan for:
- Course: "${courseTitle}"
- Module: "${moduleTitle}"
- Description: "${moduleDesc}"

Profile constraints:
${profileRules}

Output exactly 21 steps organized as exactly 3 lessons (7 sub-contents per lesson in sequence).
Each lesson must have clear sub-content titles and practical progression.

Required sub-content flow per lesson:
- Step1 TEXT (teaching first, not quiz)
- Step2 LEARNING_CARD
- Step3 FLIP_CARD
- Step4 VIDEO (exactly 1 video per lesson unless low bandwidth mode suggests text-first alternatives)
${step5Rule}
- Step6 DRAG_FILL (applied challenge)
- Step7 QUIZ (exactly 4 questions later when generating content)
${domainRule}

Array item format:
{"id": string, "title": string, "type": "TEXT"|"VIDEO"|"FLIP_CARD"|"QUIZ"|"CODE_BUILDER"|"LEARNING_CARD"|"DRAG_FILL"|"ACCORDION"|"HOTSPOT"|"CAROUSEL"|"POP_CARD"}

Important:
- Use specific lesson-aware titles like "<lesson topic>: <exact sub-content focus>".
- Do not output generic placeholders.
- Titles must be concrete and distinct across the module.
- If edit instructions are included in module description, apply them exactly.`;
}

function promptStepContent(courseTitle, moduleTitle, stepTitle, type, referenceContext = '', profileContext = {}) {
  const normalizedProfile = normalizeProfileContext(profileContext);
  const programmingTrack = isProgrammingTopic(courseTitle, moduleTitle, stepTitle);
  const lowBandwidth = normalizedProfile.lowBandwidthMode;
  const finalModuleQuiz = String(type || '').toUpperCase() === 'QUIZ' && isFinalModuleQuizTitle(stepTitle);
  const quizQuestionCount = finalModuleQuiz ? 20 : 4;
  const flashcardRule = String(type || '').toUpperCase() === 'FLIP_CARD'
    ? '- For FLIP_CARD: do not repeat fronts/backs from earlier flashcards listed in reference context.\n'
    : '';
  const referenceBlock = referenceContext
    ? `\nReference context from earlier generated lesson content (must be reused in this step):\n${referenceContext}\n`
    : '\nReference context from earlier generated lesson content:\n- Not available yet. Use module and step titles directly and keep the challenge coherent.\n';

  const profileRules = profileRulesText(profileContext);
  return `Return ONLY valid JSON (no markdown, no explanations outside JSON).\n\nGenerate lesson content for:\nCourse: ${courseTitle}\nModule: ${moduleTitle}\nStep: ${stepTitle}\nType: ${type}\n${referenceBlock}\nProfile constraints:\n${profileRules}\nGlobal rules:\n- Include lessonText: 1 concise sentence intro.\n- Keep content scannable: bullets, short sentences.\n- Use specific, meaningful titles and terms from this module.\n- Never generate random or unrelated tasks.\n- Make every quiz/challenge item traceable to concepts already taught in TEXT/VIDEO/learning cards.\n- Keep content localized to output language code ${normalizedProfile.preferredLanguage}.\n\nType-specific formats:\nTEXT => {type,title,lessonText,data:{content:string (markdown)}}\nACCORDION => data:{items:[{title,content}]} (3 items)\nFLIP_CARD => data:{cards:[{front,back,icon?,imageUrl?}]} (4 cards)\nVIDEO => data:{videoUrl (embed), videoTitle, content (short summary + bullets), videoWebUrl?}\nQUIZ => data:{questions:[{question,options[4],correctAnswer(0-3),explanation}]} (${quizQuestionCount} questions)\nCODE_BUILDER => data:{codeBuilder:{avatarInstruction,goal,expectedOutput?,lines:[{content,correctValue}],options:[string]}}\nDRAG_FILL => data:{challenges:[{instruction,codeTemplate,options,correctAnswer,explanation}]}\nHOTSPOT => data:{image,points:[{title,content,icon}]}\nCAROUSEL => data:{slides:[{title,content,imagePrompt,imageUrl}] }\nLEARNING_CARD => data:{learningCards:[{title,content,layout}]}\nPOP_CARD => data:{cards:[{title,content,icon?,imageUrl?}]} (3-5 cards)\n\nExtra rules:\n- Use exact topic terms from module and step titles in all generated items.\n- If VIDEO: use an EMBEDDABLE URL format https://www.youtube-nocookie.com/embed/<real_11_char_video_id>. Never output placeholders like VIDEO_ID.\n- For VIDEO: pick a topic-related YouTube result, and prefer regular videos over Shorts when both are relevant.\n- For FLIP_CARD: each card front must be unique and clearly tied to this step title.\n- For DRAG_FILL: instruction must clearly state what learner should do, where to get clues, and how to fill blanks in order.\n- For DRAG_FILL: each challenge must use 2-4 blanks maximum.\n- For DRAG_FILL: options must be meaningful domain terms; never output placeholders like answer1, answer2, A, B, C, D.\n- For DRAG_FILL: if codeTemplate has N blanks, correctAnswer must have exactly N comma-separated answers in the same order.\n- For QUIZ: distribute correctAnswer indices across 0,1,2,3 instead of repeating mostly 0 or 2.\n- For QUIZ/DRAG_FILL: each question/challenge must include terms from the reference context, module title, or video summary.\n- For CODE_BUILDER: avoid vague goals like "perform basic arithmetic calculations"; each line must map to a concrete mini-goal.\n${finalModuleQuiz ? '- Final Module Assessment quiz must include 20 MCQs and cover the full module scope.' : ''}\n${lowBandwidth ? '- Low bandwidth mode is active: minimize media-heavy dependencies and provide text-first alternatives.\n' : ''}${flashcardRule}${programmingTrack ? '- For CODE_BUILDER: each line.content must contain exactly one ___ and correctValue must match one option exactly.\n- For CODE_BUILDER: correctValue must be a SINGLE value (no commas, no multiple answers).\n- For CODE_BUILDER: options must be short code tokens/expressions only (no full sentences, no questions).\n- For CODE_BUILDER: include codeBuilder.goal as one clear sentence with concrete outcomes (example style: print 10, set buyer to "Bob", increase score by 8, set drink to "water").' : '- This is not a programming topic. Avoid code syntax and use plain-language, topic-relevant activities.'}`;
}

function promptTutorAsk(contentJson, question) {
  return `Answer in markdown. Keep it short (<=120 words) and clear.\n\nLesson Content (JSON):\n${JSON.stringify(contentJson)}\n\nUser question: ${question}`;
}

function fallbackTutorAnswer(contentJson, question) {
  const content = contentJson && typeof contentJson === 'object' ? contentJson : {};
  const q = String(question || '').trim() || 'this section';
  const title = String(content?.title || '').trim() || 'this section';
  const lessonText = String(content?.lessonText || '').trim();
  const data = content?.data || {};
  const bullets = [];

  if (lessonText) bullets.push(lessonText);
  if (typeof data?.content === 'string' && data.content.trim()) bullets.push(String(data.content).replace(/\s+/g, ' ').slice(0, 260));
  if (Array.isArray(data?.items)) {
    for (const item of data.items.slice(0, 2)) {
      const t = String(item?.title || '').trim();
      const v = String(item?.content || '').trim();
      if (t || v) bullets.push(`${t}: ${v}`.trim().slice(0, 220));
    }
  }
  if (Array.isArray(data?.learningCards)) {
    for (const card of data.learningCards.slice(0, 2)) {
      const t = String(card?.title || '').trim();
      const v = String(card?.content || '').trim();
      if (t || v) bullets.push(`${t}: ${v}`.trim().slice(0, 220));
    }
  }
  if (Array.isArray(data?.cards)) {
    for (const card of data.cards.slice(0, 2)) {
      const front = String(card?.front || '').trim();
      const back = String(card?.back || '').trim();
      if (front || back) bullets.push(`${front} -> ${back}`.trim().slice(0, 220));
    }
  }

  const lines = bullets.filter(Boolean).slice(0, 4);
  if (!lines.length) {
    lines.push(`Focus on the title and key terms in "${title}".`);
  }

  return [
    `AI provider is unavailable right now, so here is a local answer for **${title}**.`,
    '',
    `Question: ${q}`,
    '',
    'Quick summary:',
    ...lines.map((line) => `- ${line}`),
    '',
    'Try asking again in a moment for a richer AI explanation.',
  ].join('\n');
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

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s)]+/i);
  return match ? String(match[0]).trim() : '';
}

function extractAllUrls(text, max = 8) {
  const raw = String(text || '');
  const matches = raw.match(/https?:\/\/[^\s)]+/gi) || [];
  const out = [];
  const seen = new Set();
  for (const item of matches) {
    const url = normalizeReferenceUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= Math.max(1, Math.min(20, Number(max) || 8))) break;
  }
  return out;
}

function inferRequestedAddCount(text, fallback = 1, maxCount = 4) {
  const raw = String(text || '').toLowerCase();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const direct = raw.match(/\b(?:add|more|extra|additional)\s+(\d+|one|two|three|four|five|six)\b/i);
  const aroundTarget = raw.match(/\b(\d+|one|two|three|four|five|six)\s+(?:more\s+)?(?:videos?|challenges?|exercises?|lines?|tasks?)\b/i);
  const token = (direct?.[1] || aroundTarget?.[1] || '').toLowerCase();

  let count = Number.parseInt(token, 10);
  if (!Number.isFinite(count)) {
    count = words[token] || 0;
  }
  if (!Number.isFinite(count) || count <= 0) {
    if (/\b(a few|several)\b/i.test(raw)) count = 2;
    else count = fallback;
  }
  return Math.max(1, Math.min(maxCount, count));
}

async function youtubeSearchEmbeddableNoKeyRelaxed(query, excludeIds = []) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || '').trim())}`;
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
      if (ids.length >= 16) break;
    }
    for (const id of ids) {
      const web = `https://www.youtube.com/watch?v=${id}`;
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(web)}`;
      const oe = await fetchJson(oembed, { method: 'GET' }, 8000);
      if (!oe.ok) continue;
      const title = String(oe.json?.title || 'Video').trim() || 'Video';
      if (isLikelyYouTubeShort(title, 0)) continue;
      return {
        videoUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        videoWebUrl: web,
        videoTitle: title,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function pickAdditionalYoutubeVideos(query, excludedIds = new Set(), targetCount = 1) {
  const out = [];
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(Array.isArray(excludedIds) ? excludedIds : []);
  const desired = Math.max(1, Math.min(4, Number(targetCount) || 1));
  const baseQuery = String(query || '').replace(/\s+/g, ' ').trim();
  if (!baseQuery) return out;

  let attempts = 0;
  const maxAttempts = Math.max(2, desired * 4);
  while (out.length < desired && attempts < maxAttempts) {
    attempts += 1;
    const blocked = Array.from(excluded);
    const picked = await youtubeSearchEmbed(`${baseQuery} tutorial`, blocked)
      || await youtubeSearchEmbedNoKey(`${baseQuery} tutorial`, blocked)
      || await youtubeSearchEmbeddableNoKeyRelaxed(`${baseQuery} tutorial`, blocked)
      || await youtubeSearchEmbeddableNoKeyRelaxed(baseQuery, blocked)
      || null;
    if (!picked) break;

    const id = extractYoutubeVideoId(picked.videoWebUrl) || extractYoutubeVideoId(picked.videoUrl);
    if (!id || excluded.has(id)) continue;
    excluded.add(id);
    out.push({
      videoUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      videoWebUrl: `https://www.youtube.com/watch?v=${id}`,
      videoTitle: String(picked.videoTitle || 'Video Lesson').trim() || 'Video Lesson',
    });
  }
  return out;
}

function buildCodeBuilderScenarioLine(topic, index = 0) {
  const safeTopic = String(topic || '').replace(/\s+/g, ' ').trim() || 'this coding task';
  const templates = [
    {
      goal: 'Make the code print 10.',
      content: 'print(___)  # target: 10',
      correctValue: '10',
      options: ['10', '8', '"10"', 'True'],
      expectedOutput: '10',
    },
    {
      goal: 'Set the ticket buyer name to Bob.',
      content: 'receipt = ___ + " bought 2 tickets"',
      correctValue: '"Bob"',
      options: ['"Bob"', '"Alice"', '2', 'None'],
      expectedOutput: 'Bob bought 2 tickets',
    },
    {
      goal: 'Increase the player score by 8.',
      content: 'player_score = player_score + ___',
      correctValue: '8',
      options: ['8', '2', '-8', '"8"'],
      expectedOutput: 'Score increases by 8',
    },
    {
      goal: 'Store the drink name as water.',
      content: 'drink = ___',
      correctValue: '"water"',
      options: ['"water"', '"juice"', '0', 'False'],
      expectedOutput: 'water',
    },
    {
      goal: `Fill the blank with a valid value related to ${safeTopic}.`,
      content: 'result = ___',
      correctValue: '42',
      options: ['42', '0', 'None', '"result"'],
      expectedOutput: '',
    },
  ];
  return templates[Math.max(0, index % templates.length)];
}

async function applyDirectTutorEdit(contentJson, editPrompt) {
  const content = contentJson && typeof contentJson === 'object' ? contentJson : null;
  if (!content) return null;
  const prompt = String(editPrompt || '').trim();
  const lower = prompt.toLowerCase();
  const type = String(content?.type || '').toUpperCase();

  if (type === 'VIDEO') {
    const wantsMoreVideos = /\b(add|more|extra|additional)\b.*\bvideos?\b|\bmore videos?\b|\badd\b.*\bvideo\b/i.test(lower);
    const wantsReplaceVideo = /\b(change|replace|switch|another|different|new)\b.*\bvideo\b/i.test(lower);
    if (!wantsMoreVideos && !wantsReplaceVideo) return null;

    const safeVideo = validateStepContent('VIDEO', content);
    const before = validateStepContent('VIDEO', safeVideo);
    const existingIds = new Set();
    const collectId = (raw) => {
      const id = extractYoutubeVideoId(raw);
      if (id) existingIds.add(id);
    };
    collectId(safeVideo?.data?.videoWebUrl);
    collectId(safeVideo?.data?.videoUrl);
    for (const ref of Array.isArray(safeVideo?.data?.references) ? safeVideo.data.references : []) {
      collectId(ref?.url);
    }

    const directUrls = extractAllUrls(prompt, 10);
    const directCandidates = [];
    for (const rawUrl of directUrls) {
      const id = extractYoutubeVideoId(rawUrl);
      if (!id || existingIds.has(id)) continue;
      existingIds.add(id);
      directCandidates.push({
        videoUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        videoWebUrl: `https://www.youtube.com/watch?v=${id}`,
        videoTitle: safeVideo?.data?.videoTitle || safeVideo?.title || 'Video Lesson',
      });
    }

    const query = String(
      `${safeVideo?.data?.videoTitle || safeVideo?.title || ''} ${prompt || ''}`.trim()
      || safeVideo?.data?.videoTitle
      || safeVideo?.title
      || prompt
      || 'tutorial'
    )
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'tutorial';

    let next = {
      ...safeVideo,
      data: {
        ...(safeVideo?.data || {}),
      },
    };
    const isYoutubeReference = (url) => {
      const raw = String(url || '').trim();
      if (!raw) return false;
      return !!extractYoutubeVideoId(raw) || /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(raw);
    };

    if (wantsReplaceVideo) {
      let primary = directCandidates.shift() || null;
      if (!primary) {
        const fetched = await pickAdditionalYoutubeVideos(query, existingIds, 1);
        primary = fetched[0] || null;
      }
      if (!primary) {
        primary = curatedVideo(query) || curatedVideo(String(safeVideo?.title || ''));
      }
      if (primary) {
        const primaryId = extractYoutubeVideoId(primary.videoWebUrl) || extractYoutubeVideoId(primary.videoUrl);
        if (primaryId) existingIds.add(primaryId);
        next.data.videoUrl = primary.videoUrl;
        next.data.videoWebUrl = primary.videoWebUrl;
        next.data.videoTitle = primary.videoTitle || next.data.videoTitle || safeVideo.title || 'Video Lesson';
        next.data.references = (Array.isArray(next?.data?.references) ? next.data.references : [])
          .filter((ref) => !isYoutubeReference(ref?.url));
      }
    }

    if (wantsMoreVideos) {
      const addCount = inferRequestedAddCount(prompt, 1, 4);
      const extras = [];
      while (directCandidates.length && extras.length < addCount) {
        extras.push(directCandidates.shift());
      }
      if (extras.length < addCount) {
        const fetched = await pickAdditionalYoutubeVideos(query, existingIds, addCount - extras.length);
        extras.push(...fetched);
      }
      const searchFallbackRefs = [];
      if (extras.length < addCount) {
        const missing = addCount - extras.length;
        for (let idx = 0; idx < missing; idx += 1) {
          searchFallbackRefs.push({
            title: `Find more videos: ${query} (${idx + 1})`,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} tutorial`)}`,
            kind: 'web',
          });
        }
      }
      if (!next.data.videoUrl && extras.length) {
        const first = extras.shift();
        next.data.videoUrl = first.videoUrl;
        next.data.videoWebUrl = first.videoWebUrl;
        next.data.videoTitle = first.videoTitle || next.data.videoTitle || safeVideo.title || 'Video Lesson';
      }

      const refs = [
        ...(Array.isArray(next?.data?.references) ? next.data.references : []),
        next?.data?.videoWebUrl
          ? { title: next?.data?.videoTitle || next.title || 'Primary video', url: next.data.videoWebUrl, kind: 'youtube' }
          : null,
        ...extras.map((item, idx) => ({
          title: item?.videoTitle || `Related video ${idx + 1}`,
          url: item?.videoWebUrl || '',
          kind: 'youtube',
        })),
        ...searchFallbackRefs,
      ];
      next.data.references = normalizeReferences(refs).slice(0, 12);
    }

    const out = validateStepContent('VIDEO', next);
    if (JSON.stringify(out) === JSON.stringify(before)) return null;
    return out;
  }

  if (type === 'DRAG_FILL') {
    const wantsAddChallenges = /\b(add|more|extra|additional)\b.*\b(challenge|challenges|exercise|exercises)\b/i.test(lower);
    const wantsDeleteChallenge = /\b(delete|remove)\b.*\b(challenge|exercise)\b/i.test(lower);
    if (!wantsAddChallenges && !wantsDeleteChallenge) return null;

    const safeDrag = validateStepContent('DRAG_FILL', content);
    const before = validateStepContent('DRAG_FILL', safeDrag);
    let challenges = Array.isArray(safeDrag?.data?.challenges) ? safeDrag.data.challenges.slice(0, 10) : [];
    if (wantsDeleteChallenge && challenges.length > 1) {
      challenges = challenges.slice(0, -1);
    }
    if (wantsAddChallenges) {
      const addCount = inferRequestedAddCount(prompt, 1, 4);
      const topic = String(safeDrag?.title || 'this topic').replace(/^challenge\s*:\s*/i, '').trim() || 'this topic';
      for (let idx = 0; idx < addCount; idx += 1) {
        const n = challenges.length + 1;
        challenges.push({
          instruction: `Challenge ${n}: complete the blanks in order to satisfy the goal for ${topic}.`,
          codeTemplate: `Goal ${n}: first identify the ___ in ${topic}, then apply it through ___.`,
          options: ['core concept', 'one practical action', 'random guessing', 'skipping validation'],
          correctAnswer: 'core concept, one practical action',
          explanation: `A strong answer starts with the key concept, then applies it in a practical step.`,
        });
      }
    }
    const out = validateStepContent('DRAG_FILL', {
      ...safeDrag,
      data: {
        ...(safeDrag?.data || {}),
        challenges,
      },
    });
    if (JSON.stringify(out) === JSON.stringify(before)) return null;
    return out;
  }

  if (type === 'CODE_BUILDER') {
    const wantsAddLines = /\b(add|more|extra|additional)\b.*\b(lines?|challenges?|tasks?|exercises?)\b/i.test(lower);
    const wantsDeleteLine = /\b(delete|remove)\b.*\b(lines?|challenges?|tasks?|exercises?)\b/i.test(lower);
    if (!wantsAddLines && !wantsDeleteLine) return null;

    const safeCode = validateStepContent('CODE_BUILDER', content);
    const before = validateStepContent('CODE_BUILDER', safeCode);
    const cb = safeCode?.data?.codeBuilder || {};
    let lines = Array.isArray(cb.lines) ? cb.lines.slice(0, 10) : [];
    let options = Array.isArray(cb.options) ? cb.options.slice(0, 20) : [];
    const addedGoals = [];
    const expectedOutputs = [];
    if (wantsDeleteLine && lines.length > 2) {
      lines = lines.slice(0, -1);
    }
    if (wantsAddLines) {
      const addCount = inferRequestedAddCount(prompt, 1, 4);
      const topic = String(safeCode?.title || 'coding').replace(/^interactive coding\s*:\s*/i, '').trim() || 'coding';
      const baseLineCount = lines.length;
      for (let idx = 0; idx < addCount && lines.length < 10; idx += 1) {
        const scenario = buildCodeBuilderScenarioLine(topic, baseLineCount + idx);
        lines.push({
          content: scenario.content,
          correctValue: scenario.correctValue,
        });
        addedGoals.push(scenario.goal);
        if (scenario.expectedOutput) expectedOutputs.push(scenario.expectedOutput);
        for (const opt of scenario.options) {
          if (!options.includes(opt)) options.push(opt);
        }
      }
    }
    const goalRaw = String(cb?.goal || '').trim();
    const avatarRaw = String(cb?.avatarInstruction || '').trim();
    const expectedOutputRaw = String(cb?.expectedOutput || '').trim();
    const genericGoal = !goalRaw || /\b(basic arithmetic calculations|complete the code by choosing|fill in the blanks to complete the code)\b/i.test(goalRaw);
    const genericAvatar = !avatarRaw || /\b(basic arithmetic calculations|fill in the blanks)\b/i.test(avatarRaw);
    const nextCodeBuilder = {
      ...cb,
      avatarInstruction: genericAvatar
        ? 'Choose the option that makes each mini-goal true, then continue to the next line.'
        : avatarRaw,
      goal: (genericGoal && addedGoals.length)
        ? `Complete each mini-goal: ${addedGoals.join(' ')}`
        : goalRaw,
      expectedOutput: expectedOutputRaw || expectedOutputs.join(', '),
      lines,
      options,
    };
    const out = validateStepContent('CODE_BUILDER', {
      ...safeCode,
      data: {
        ...(safeCode?.data || {}),
        codeBuilder: nextCodeBuilder,
      },
    });
    if (JSON.stringify(out) === JSON.stringify(before)) return null;
    return out;
  }

  return null;
}

function normalizeInterviewList(items, max = 12, itemMax = 220) {
  const rows = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const value = repairLikelyMojibakeText(String(row || '')).replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length < 3) continue;
    const trimmed = value.slice(0, itemMax);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeInterviewCandidateName(value = '') {
  const raw = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!raw) return '';
  const lettersOnly = raw.replace(/[^A-Za-z\s.'-]/g, '').trim();
  if (!lettersOnly) return '';
  const words = lettersOnly.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return '';
  const titled = words
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .trim();
  if (!titled) return '';
  const lower = titled.toLowerCase();
  if (/\b(developer|engineer|manager|designer|analyst|specialist|intern|assistant|officer|consultant)\b/.test(lower)) return '';
  return titled;
}

function inferInterviewCandidateName(profile = {}) {
  const directCandidates = [
    profile?.fullName,
    profile?.name,
    profile?.displayName,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeInterviewCandidateName(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function inferInterviewRoleTrack(jobTitle = '', profile = {}) {
  const title = String(jobTitle || '').toLowerCase();
  const skillText = normalizeInterviewList(profile?.skills, 12, 80).join(' ').toLowerCase();
  const combined = `${title} ${skillText}`.replace(/\s+/g, ' ').trim();
  const handsOnPattern = /\b(toilet|cleaner|cleaning|janitor|housekeeping|housekeeper|sanitation|waste|garbage|driver|delivery|rider|courier|warehouse|picker|packer|loader|cashier|retail|shop assistant|waiter|server|cook|kitchen helper|security guard|construction|laborer|helper|mechanic|car wash|laundry|nanny|caregiver|maid|farm|farmer|farmhand|dairy|milker|cow milker|livestock|animal care|ranch|barn|herder)\b/;
  if (handsOnPattern.test(combined)) return 'hands_on';
  return 'knowledge';
}

function specializedEnglishFallbackRole(role = '', skillHints = '') {
  const title = String(role || '').toLowerCase();
  if (!title) return null;
  if (/\b(police|law enforcement|constable|patrol officer|detective|investigator)\b/i.test(title)) {
    return {
      jobTitle: role,
      roleSummary: `We are hiring a ${role} to protect public safety, enforce laws fairly, and de-escalate incidents under pressure.`,
      responsibilities: [
        'Respond to incidents, assess risk quickly, and apply lawful procedures.',
        'Gather evidence, document case details, and write clear incident reports.',
        'Use de-escalation and communication to resolve conflict safely.',
        'Coordinate with dispatch, emergency services, and community stakeholders.',
        'Maintain professional conduct, ethics, and accountability on every shift.',
      ],
      requirements: [
        `Demonstrated readiness for ${role} duties through field training, practical exercises, or relevant service experience.`,
        `Strong fundamentals in ${skillHints || 'situation assessment, communication, and lawful decision-making'}.`,
        'Ability to make sound decisions in high-pressure and ambiguous situations.',
        'Clear report writing, evidence handling discipline, and procedural consistency.',
        'Professional integrity, emotional control, and community-focused mindset.',
      ],
    };
  }
  if (/\b(audition|singer|singing|vocal|vocalist|performer|musician|music)\b/i.test(title)) {
    return {
      jobTitle: role,
      roleSummary: `We are hiring a ${role} who can deliver consistent live performance quality, adapt quickly to feedback, and engage diverse audiences.`,
      responsibilities: [
        'Prepare and deliver performances with strong vocal control and stage presence.',
        'Interpret creative direction and adjust performance style for different formats.',
        'Collaborate with coaches, producers, and teammates during rehearsals.',
        'Manage pressure in auditions and maintain quality under time constraints.',
        'Review performance recordings and improve through structured iteration.',
      ],
      requirements: [
        `Demonstrated readiness for ${role} responsibilities through stage work, auditions, or portfolio evidence.`,
        `Strong fundamentals in ${skillHints || 'vocal technique, rehearsal discipline, and audience communication'}.`,
        'Ability to receive critical feedback and convert it into measurable improvement.',
        'Reliable preparation habits, time management, and professional attitude.',
        'Confidence to perform consistently in high-visibility evaluation settings.',
      ],
    };
  }
  if (/\b(sailor|seafarer|maritime|deckhand|able seaman|navy)\b/i.test(title)) {
    return {
      jobTitle: role,
      roleSummary: `We are hiring a ${role} who can execute maritime operations safely, follow navigation and safety procedures, and perform reliably at sea.`,
      responsibilities: [
        'Support vessel operations, deck duties, and safety drills according to protocol.',
        'Monitor equipment status and report hazards or faults immediately.',
        'Follow watchkeeping routines and maintain clear shift handovers.',
        'Coordinate with crew during docking, cargo, and emergency scenarios.',
        'Maintain logs and compliance records with accuracy and timeliness.',
      ],
      requirements: [
        `Demonstrated readiness for ${role} responsibilities through maritime training, onboard practice, or related certifications.`,
        `Strong fundamentals in ${skillHints || 'maritime safety, communication, and procedural execution'}.`,
        'Ability to perform under changing weather and operational pressure.',
        'Discipline in safety compliance, checklist execution, and teamwork.',
        'Professional reliability, stamina, and accountability in shift-based work.',
      ],
    };
  }
  return null;
}

function fallbackInterviewRole(jobTitle, profile = {}, targetLanguage = 'en-US') {
  const role = String(jobTitle || 'Target Role').trim() || 'Target Role';
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  const skills = normalizeInterviewList(profile?.skills, 6, 80);
  const skillHints = skills.length ? skills.join(', ') : 'communication, collaboration, and structured problem solving';
  const roleTrack = inferInterviewRoleTrack(role, profile);
  const specializedEnglishRole = specializedEnglishFallbackRole(role, skillHints);
  if (languageCode === 'th') {
    return {
      jobTitle: role,
      roleSummary: `à¹€à¸£à¸²à¸à¸³à¸¥à¸±à¸‡à¸¡à¸­à¸‡à¸«à¸² ${role} à¸—à¸µà¹ˆà¸ªà¹ˆà¸‡à¸¡à¸­à¸šà¸œà¸¥à¸‡à¸²à¸™à¸§à¸±à¸”à¸œà¸¥à¹„à¸”à¹‰ à¸ªà¸·à¹ˆà¸­à¸ªà¸²à¸£à¸Šà¸±à¸”à¹€à¸ˆà¸™ à¹à¸¥à¸°à¸—à¸³à¸‡à¸²à¸™à¸£à¹ˆà¸§à¸¡à¸à¸±à¸šà¸—à¸µà¸¡à¸‚à¹‰à¸²à¸¡à¸ªà¸²à¸¢à¸‡à¸²à¸™à¹„à¸”à¹‰à¸”à¸µ`,
      responsibilities: [
        `à¸§à¸²à¸‡à¹à¸œà¸™à¹à¸¥à¸°à¸”à¸³à¹€à¸™à¸´à¸™à¸‡à¸²à¸™à¸«à¸¥à¸±à¸à¸‚à¸­à¸‡à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ ${role} à¸­à¸¢à¹ˆà¸²à¸‡à¹€à¸›à¹‡à¸™à¸£à¸°à¸šà¸š`,
        'à¸ªà¸·à¹ˆà¸­à¸ªà¸²à¸£à¸„à¸§à¸²à¸¡à¸„à¸·à¸šà¸«à¸™à¹‰à¸² à¸­à¸¸à¸›à¸ªà¸£à¸£à¸„ à¹à¸¥à¸°à¸à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆà¸à¸±à¸šà¸œà¸¹à¹‰à¹€à¸à¸µà¹ˆà¸¢à¸§à¸‚à¹‰à¸­à¸‡à¸­à¸¢à¹ˆà¸²à¸‡à¸ªà¸¡à¹ˆà¸³à¹€à¸ªà¸¡à¸­',
        'à¸ˆà¸±à¸”à¸—à¸³à¹€à¸­à¸à¸ªà¸²à¸£à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¹à¸¥à¸°à¸£à¸±à¸à¸©à¸²à¸¡à¸²à¸•à¸£à¸à¸²à¸™à¸„à¸¸à¸“à¸ à¸²à¸žà¹ƒà¸™à¸à¸²à¸£à¸—à¸³à¸‡à¸²à¸™à¸›à¸£à¸°à¸ˆà¸³',
        'à¸›à¸£à¸°à¸ªà¸²à¸™à¸‡à¸²à¸™à¸à¸±à¸šà¸—à¸µà¸¡à¹€à¸žà¸·à¹ˆà¸­à¸ªà¹ˆà¸‡à¸¡à¸­à¸šà¸‡à¸²à¸™à¸•à¸²à¸¡à¹€à¸§à¸¥à¸²à¹à¸¥à¸°à¹€à¸›à¹‰à¸²à¸«à¸¡à¸²à¸¢',
        'à¸›à¸£à¸±à¸šà¸›à¸£à¸¸à¸‡à¸§à¸´à¸˜à¸µà¸à¸²à¸£à¸—à¸³à¸‡à¸²à¸™à¸ˆà¸²à¸à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹à¸¥à¸°à¸‚à¹‰à¸­à¹€à¸ªà¸™à¸­à¹à¸™à¸°à¸­à¸¢à¹ˆà¸²à¸‡à¸•à¹ˆà¸­à¹€à¸™à¸·à¹ˆà¸­à¸‡',
      ],
      requirements: [
        `à¸¡à¸µà¸œà¸¥à¸‡à¸²à¸™à¸«à¸£à¸·à¸­à¸›à¸£à¸°à¸ªà¸šà¸à¸²à¸£à¸“à¹Œà¸—à¸µà¹ˆà¹à¸ªà¸”à¸‡à¸„à¸§à¸²à¸¡à¸žà¸£à¹‰à¸­à¸¡à¹ƒà¸™à¸šà¸—à¸šà¸²à¸— ${role}`,
        `à¸¡à¸µà¸žà¸·à¹‰à¸™à¸à¸²à¸™à¸—à¸µà¹ˆà¸”à¸µà¹ƒà¸™à¸”à¹‰à¸²à¸™ ${skillHints}`,
        'à¸¡à¸µà¸—à¸±à¸à¸©à¸°à¸à¸²à¸£à¸ªà¸·à¹ˆà¸­à¸ªà¸²à¸£à¸—à¸±à¹‰à¸‡à¸à¸²à¸£à¸žà¸¹à¸”à¹à¸¥à¸°à¸à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™',
        'à¸ªà¸²à¸¡à¸²à¸£à¸–à¸—à¸³à¸‡à¸²à¸™à¸ à¸²à¸¢à¹ƒà¸•à¹‰à¸à¸£à¸­à¸šà¹€à¸§à¸¥à¸²à¹à¸¥à¸°à¸„à¸§à¸²à¸¡à¸£à¸±à¸šà¸œà¸´à¸”à¸Šà¸­à¸šà¸—à¸µà¹ˆà¸Šà¸±à¸”à¹€à¸ˆà¸™',
        'à¸¡à¸µà¸—à¸±à¸¨à¸™à¸„à¸•à¸´à¹à¸šà¸šà¸¡à¸·à¸­à¸­à¸²à¸Šà¸µà¸žà¹à¸¥à¸°à¸žà¸£à¹‰à¸­à¸¡à¸žà¸±à¸’à¸™à¸²',
      ],
    };
  }
  if (languageCode === 'my') {
    return {
      jobTitle: role,
      roleSummary: `á€€á€»á€½á€”á€ºá€¯á€•á€ºá€á€­á€¯á€·á€žá€Šá€º ${role} á€›á€¬á€‘á€°á€¸á€¡á€á€½á€€á€º á€›á€œá€’á€ºá€á€­á€€á€»á€…á€½á€¬ á€•á€±á€¸á€”á€­á€¯á€„á€ºá€•á€¼á€®á€¸ á€¡á€žá€„á€ºá€¸á€™á€»á€¬á€¸á€¡á€€á€¼á€¬á€¸ á€›á€¾á€„á€ºá€¸á€œá€„á€ºá€¸á€…á€½á€¬ á€†á€€á€ºá€žá€½á€šá€ºá€”á€­á€¯á€„á€ºá€žá€±á€¬á€žá€°á€€á€­á€¯ á€›á€¾á€¬á€–á€½á€±á€”á€±á€•á€«á€žá€Šá€º`,
      responsibilities: [
        `${role} á€›á€¬á€‘á€°á€¸á á€¡á€“á€­á€€á€á€¬á€á€”á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€…á€”á€…á€ºá€á€€á€» á€…á€®á€™á€¶á€€á€­á€”á€ºá€¸á€á€»á á€¡á€€á€±á€¬á€„á€ºá€¡á€‘á€Šá€ºá€–á€±á€¬á€ºá€á€¼á€„á€ºá€¸`,
        'á€á€­á€¯á€¸á€á€€á€ºá€™á€¾á€¯áŠ á€¡á€á€€á€ºá€¡á€á€²á€™á€»á€¬á€¸á€”á€¾á€„á€·á€º á€†á€¯á€¶á€¸á€–á€¼á€á€ºá€á€»á€€á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€žá€€á€ºá€†á€­á€¯á€„á€ºá€žá€°á€™á€»á€¬á€¸á€‘á€¶ á€†á€€á€ºá€œá€€á€ºá€¡á€žá€­á€•á€±á€¸á€á€¼á€„á€ºá€¸',
        'á€”á€±á€·á€…á€‰á€ºá€œá€¯á€•á€ºá€„á€”á€ºá€¸á€›á€œá€’á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€™á€¾á€á€ºá€á€™á€ºá€¸á€á€„á€ºá€•á€¼á€®á€¸ á€¡á€›á€Šá€ºá€¡á€žá€½á€±á€¸á€…á€¶á€”á€¾á€¯á€”á€ºá€¸á€™á€»á€¬á€¸ á€‘á€­á€”á€ºá€¸á€žá€­á€™á€ºá€¸á€á€¼á€„á€ºá€¸',
        'á€¡á€žá€„á€ºá€¸á€–á€±á€¬á€ºá€™á€»á€¬á€¸á€”á€¾á€„á€·á€º á€•á€°á€¸á€•á€±á€«á€„á€ºá€¸á€€á€¬ á€žá€á€ºá€™á€¾á€á€ºá€¡á€á€»á€­á€”á€ºá€¡á€á€½á€„á€ºá€¸ á€¡á€œá€¯á€•á€ºá€•á€¼á€®á€¸á€™á€¼á€±á€¬á€€á€ºá€…á€±á€á€¼á€„á€ºá€¸',
        'á€¡á€€á€¼á€¶á€•á€¼á€¯á€á€»á€€á€ºá€”á€¾á€„á€·á€º á€™á€€á€ºá€‘á€›á€…á€ºá€™á€»á€¬á€¸á€¡á€•á€±á€«á€º á€¡á€á€¼á€±á€á€¶á á€œá€¯á€•á€ºá€„á€”á€ºá€¸á€…á€‰á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€†á€€á€ºá€œá€€á€ºá€á€­á€¯á€¸á€á€€á€ºá€…á€±á€á€¼á€„á€ºá€¸',
      ],
      requirements: [
        `${role} á€›á€¬á€‘á€°á€¸á€¡á€á€½á€€á€º á€¡á€†á€„á€ºá€žá€„á€·á€ºá€–á€¼á€…á€ºá€€á€¼á€±á€¬á€„á€ºá€¸ á€•á€¼á€žá€”á€­á€¯á€„á€ºá€žá€±á€¬ á€¡á€á€½á€±á€·á€¡á€€á€¼á€¯á€¶ á€žá€­á€¯á€·á€™á€Ÿá€¯á€á€º á€•á€›á€±á€¬á€‚á€»á€€á€ºá€™á€»á€¬á€¸`,
        `${skillHints} á€†á€­á€¯á€„á€ºá€›á€¬ á€¡á€á€¼á€±á€á€¶á€€á€»á€½á€™á€ºá€¸á€€á€»á€„á€ºá€™á€¾á€¯á€€á€±á€¬á€„á€ºá€¸`,
        'á€•á€¼á€±á€¬á€†á€­á€¯á€›á€±á€¸á€žá€¬á€¸ á€†á€€á€ºá€žá€½á€šá€ºá€™á€¾á€¯ á€€á€±á€¬á€„á€ºá€¸á€™á€½á€”á€ºá€™á€¾á€¯',
        'á€¡á€á€»á€­á€”á€ºá€€á€”á€·á€ºá€žá€á€ºá€á€»á€€á€ºá€”á€¾á€„á€·á€º á€á€¬á€á€”á€ºá€šá€°á€™á€¾á€¯á€¡á€±á€¬á€€á€ºá€á€½á€„á€º á€¡á€œá€¯á€•á€ºá€œá€¯á€•á€ºá€”á€­á€¯á€„á€ºá€™á€¾á€¯',
        'á€•á€›á€±á€¬á€ºá€–á€€á€ºá€›á€¾á€„á€ºá€”á€šá€º á€†á€”á€ºá€žá€±á€¬ á€¡á€•á€¼á€¯á€¡á€™á€°á€”á€¾á€„á€·á€º á€á€­á€¯á€¸á€á€€á€ºá€œá€­á€¯á€…á€­á€á€º',
      ],
    };
  }
  if (languageCode === 'id') {
    return {
      jobTitle: role,
      roleSummary: `Kami mencari ${role} yang mampu menghasilkan dampak kerja terukur, berkomunikasi jelas, dan berkolaborasi lintas tim.`,
      responsibilities: [
        `Merencanakan dan mengeksekusi tanggung jawab utama peran ${role} dengan kepemilikan yang jelas.`,
        'Mengomunikasikan progres, hambatan, dan keputusan kepada pemangku kepentingan.',
        'Mendokumentasikan hasil kerja dan menjaga standar kualitas harian.',
        'Berkoordinasi dengan tim untuk menyelesaikan proyek tepat waktu.',
        'Meningkatkan proses kerja berdasarkan umpan balik dan metrik.',
      ],
      requirements: [
        `Memiliki kesiapan untuk tanggung jawab ${role} melalui pengalaman praktik, magang, atau proyek.`,
        `Dasar yang kuat pada ${skillHints}.`,
        'Kemampuan komunikasi lisan dan tulisan yang baik.',
        'Mampu bekerja dengan struktur, tenggat, dan akuntabilitas.',
        'Sikap profesional serta growth mindset.',
      ],
    };
  }
  if (languageCode === 'ms') {
    return {
      jobTitle: role,
      roleSummary: `Kami mencari ${role} yang boleh menghasilkan impak kerja yang boleh diukur, berkomunikasi dengan jelas, dan bekerjasama merentas pasukan.`,
      responsibilities: [
        `Merancang dan melaksanakan tanggungjawab utama peranan ${role} dengan pemilikan yang jelas.`,
        'Memaklumkan kemajuan, halangan, dan keputusan kepada pihak berkepentingan.',
        'Mendokumenkan hasil kerja dan mengekalkan standard kualiti harian.',
        'Menyelaras dengan pasukan untuk menyiapkan projek mengikut masa.',
        'Menambah baik aliran kerja berdasarkan maklum balas dan metrik.',
      ],
      requirements: [
        `Kesediaan untuk tanggungjawab ${role} melalui pengalaman praktikal, latihan industri, atau projek.`,
        `Asas yang kukuh dalam ${skillHints}.`,
        'Kemahiran komunikasi lisan dan bertulis yang baik.',
        'Mampu bekerja dengan struktur, tarikh akhir, dan akauntabiliti.',
        'Sikap profesional serta minda berkembang.',
      ],
    };
  }
  if (languageCode === 'vi') {
    return {
      jobTitle: role,
      roleSummary: `ChÃºng tÃ´i Ä‘ang tuyá»ƒn ${role} cÃ³ kháº£ nÄƒng táº¡o ra káº¿t quáº£ Ä‘o lÆ°á»ng Ä‘Æ°á»£c, giao tiáº¿p rÃµ rÃ ng vÃ  phá»‘i há»£p tá»‘t vá»›i cÃ¡c nhÃ³m liÃªn chá»©c nÄƒng.`,
      responsibilities: [
        `Láº­p káº¿ hoáº¡ch vÃ  triá»ƒn khai cÃ¡c trÃ¡ch nhiá»‡m cá»‘t lÃµi cá»§a vá»‹ trÃ­ ${role} vá»›i tinh tháº§n sá»Ÿ há»¯u rÃµ rÃ ng.`,
        'Trao Ä‘á»•i tiáº¿n Ä‘á»™, trá»Ÿ ngáº¡i vÃ  quyáº¿t Ä‘á»‹nh vá»›i cÃ¡c bÃªn liÃªn quan.',
        'Ghi chÃ©p káº¿t quáº£ vÃ  duy trÃ¬ tiÃªu chuáº©n cháº¥t lÆ°á»£ng trong cÃ´ng viá»‡c háº±ng ngÃ y.',
        'Phá»‘i há»£p vá»›i Ä‘á»“ng Ä‘á»™i Ä‘á»ƒ bÃ n giao dá»± Ã¡n Ä‘Ãºng háº¡n.',
        'Cáº£i tiáº¿n quy trÃ¬nh lÃ m viá»‡c dá»±a trÃªn pháº£n há»“i vÃ  sá»‘ liá»‡u.',
      ],
      requirements: [
        `Thá»ƒ hiá»‡n sá»± sáºµn sÃ ng cho trÃ¡ch nhiá»‡m ${role} qua kinh nghiá»‡m thá»±c táº¿, thá»±c táº­p hoáº·c dá»± Ã¡n.`,
        `Ná»n táº£ng vá»¯ng vá» ${skillHints}.`,
        'Ká»¹ nÄƒng giao tiáº¿p nÃ³i vÃ  viáº¿t rÃµ rÃ ng.',
        'CÃ³ kháº£ nÄƒng lÃ m viá»‡c theo cáº¥u trÃºc, thá»i háº¡n vÃ  trÃ¡ch nhiá»‡m.',
        'TÃ¡c phong chuyÃªn nghiá»‡p vÃ  tÆ° duy phÃ¡t triá»ƒn.',
      ],
    };
  }
  if (languageCode === 'tl') {
    return {
      jobTitle: role,
      roleSummary: `Naghahanap kami ng ${role} na kayang maghatid ng nasusukat na resulta, malinaw makipagkomunikasyon, at mahusay makipagtulungan sa iba't ibang team.`,
      responsibilities: [
        `Magplano at magsagawa ng pangunahing responsibilidad ng ${role} na may malinaw na ownership.`,
        'Mag-ulat ng progreso, blockers, at desisyon sa mga stakeholder.',
        'I-dokumento ang kinalabasan at panatilihin ang pamantayan ng kalidad sa araw-araw.',
        'Makipag-ugnayan sa team para maihatid ang proyekto sa tamang oras.',
        'Patuloy na pagbutihin ang workflow gamit ang feedback at metrics.',
      ],
      requirements: [
        `May ipinakitang kahandaan sa responsibilidad ng ${role} sa pamamagitan ng praktikal na trabaho, internship, o proyekto.`,
        `Matibay na pundasyon sa ${skillHints}.`,
        'Malinaw na komunikasyon sa pagsasalita at pagsusulat.',
        'Kayang magtrabaho nang may istruktura, deadline, at pananagutan.',
        'Propesyonal na pag-uugali at growth mindset.',
      ],
    };
  }
  if (roleTrack === 'hands_on') {
    return {
      jobTitle: role,
      roleSummary: `We are hiring a ${role} who keeps work areas clean, safe, and ready for daily operations.`,
      responsibilities: [
        `Clean assigned areas and equipment for ${role} tasks each shift.`,
        'Follow safety and hygiene procedures at all times.',
        'Use cleaning tools and materials correctly and safely.',
        'Report damage, shortages, or hazards quickly to supervisors.',
        'Coordinate with teammates to finish tasks on time.',
      ],
      requirements: [
        `Reliable attendance and readiness for ${role} shift schedules.`,
        'Ability to follow instructions and safety checklists carefully.',
        `Basic practical skills relevant to ${role} work and tools.`,
        'Physical stamina for routine standing, lifting, and movement.',
        'Respectful communication with coworkers, supervisors, and customers.',
      ],
    };
  }
  return {
    ...(specializedEnglishRole || {
      jobTitle: role,
      roleSummary: `We are hiring a ${role} who can deliver measurable work outcomes, communicate clearly, and collaborate with cross-functional teams.`,
      responsibilities: [
        `Plan and execute core ${role} responsibilities with clear ownership.`,
        'Communicate progress, blockers, and decisions to stakeholders.',
        'Document outcomes and maintain quality standards in daily work.',
        'Coordinate with peers to deliver projects on deadline.',
        'Continuously improve workflows using feedback and metrics.',
      ],
      requirements: [
        `Demonstrated readiness for ${role} responsibilities through practical work, internships, or projects.`,
        `Strong fundamentals in ${skillHints}.`,
        'Clear verbal and written communication.',
        'Ability to work with structure, deadlines, and accountability.',
        'Professional attitude and growth mindset.',
      ],
    }),
  };
}

function pickInterviewQuestionVolume(options = {}) {
  const seniorityRaw = String(options?.seniority || 'mid').trim().toLowerCase();
  const seniority = seniorityRaw === 'entry' || seniorityRaw === 'senior' ? seniorityRaw : 'mid';
  const questionFocusRaw = String(options?.questionFocus || 'mixed').trim().toLowerCase();
  const questionFocus = questionFocusRaw === 'behavioral' || questionFocusRaw === 'technical'
    ? questionFocusRaw
    : 'mixed';
  const roleTrack = String(options?.roleTrack || '').trim().toLowerCase() === 'hands_on' ? 'hands_on' : 'knowledge';
  const role = options?.role && typeof options.role === 'object' ? options.role : {};
  const profile = options?.profile && typeof options.profile === 'object' ? options.profile : {};

  let minCount = 7;
  let maxCount = 12;
  if (seniority === 'entry') {
    minCount = 6;
    maxCount = 10;
  } else if (seniority === 'senior') {
    minCount = 9;
    maxCount = 14;
  }
  if (questionFocus === 'technical') {
    minCount += 1;
    maxCount += 1;
  }
  if (roleTrack === 'hands_on') {
    minCount = Math.max(5, minCount - 1);
    maxCount = Math.max(minCount + 1, maxCount - 2);
  }

  let complexity = 0;
  const responsibilitiesCount = normalizeInterviewList(role?.responsibilities, 20, 280).length;
  const requirementsCount = normalizeInterviewList(role?.requirements, 20, 280).length;
  const skillsCount = normalizeInterviewList(profile?.skills, 20, 80).length;
  const experienceCount = Array.isArray(profile?.experience) ? profile.experience.length : 0;
  const certCount = normalizeInterviewList(profile?.certifications, 12, 120).length;

  if (responsibilitiesCount >= 6) complexity += 1;
  if (requirementsCount >= 6) complexity += 1;
  if (skillsCount >= 8) complexity += 1;
  if (experienceCount >= 3) complexity += 1;
  if (certCount >= 3) complexity += 1;
  if (seniority === 'senior') complexity += 1;

  const bonus = complexity >= 5 ? 1 : (complexity <= 1 ? -1 : 0);
  minCount = Math.max(6, Math.min(14, minCount + bonus));
  maxCount = Math.max(minCount + 1, Math.min(16, maxCount + bonus));
  const targetCount = Math.max(minCount, Math.min(maxCount, Math.round((minCount + maxCount) / 2)));

  return { minCount, targetCount, maxCount };
}

function roleAnchorsForInterviewQuestions(roleContext = {}, profile = {}) {
  const responsibilities = normalizeInterviewList(roleContext?.responsibilities, 12, 220);
  const requirements = normalizeInterviewList(roleContext?.requirements, 12, 220);
  const skills = normalizeInterviewList(profile?.skills, 10, 80).map((skill) => `Hands-on skill in ${skill}`);
  const summary = String(roleContext?.roleSummary || '').replace(/\s+/g, ' ').trim();
  return normalizeInterviewList(
    [
      ...responsibilities,
      ...requirements,
      ...skills,
      summary,
    ],
    18,
    220
  );
}

function normalizeInterviewFlexibleList(input, max = 12, itemMax = 220) {
  if (Array.isArray(input)) return normalizeInterviewList(input, max, itemMax);
  if (input && typeof input === 'object') {
    return normalizeInterviewList(Object.values(input), max, itemMax);
  }
  const raw = String(input || '').trim();
  if (!raw) return [];
  const pieces = raw
    .replace(/\r/g, '\n')
    .split(/\n+|[;|]+/)
    .map((row) => String(row || '').replace(/^[\s\-*0-9.)]+/, '').trim())
    .filter(Boolean);
  return normalizeInterviewList(pieces.length ? pieces : [raw], max, itemMax);
}

function extractInterviewRoleRaw(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const hasRoleShape = (value) => !!(value && typeof value === 'object' && (
    value.jobTitle
    || value.title
    || value.roleSummary
    || value.summary
    || value.responsibilities
    || value.requirements
  ));

  const directCandidates = [
    source.role,
    source.job,
    source.roleInfo,
    source.roleContext,
    source.position,
    source.data?.role,
    source.data?.job,
    source.session?.role,
    source.output?.role,
    source.result?.role,
  ];
  for (const candidate of directCandidates) {
    if (hasRoleShape(candidate)) return candidate;
  }
  if (hasRoleShape(source)) return source;
  for (const value of Object.values(source)) {
    if (hasRoleShape(value)) return value;
  }
  return {};
}

function sanitizeInterviewQuestionText(text) {
  return repairLikelyMojibakeText(String(text || ''))
    .replace(/\s+/g, ' ')
    .replace(/^(?:[-*]|\d+[.)]|q\d+[:.)-])\s*/i, '')
    .trim();
}

function looksLikeInterviewQuestionText(text, targetLanguage = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  const hasQuestionMark = /[?？]/.test(raw);
  const lower = raw.toLowerCase();
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);

  // Keep model phrasing free-form: explicit question punctuation is enough.
  if (hasQuestionMark) return true;

  const englishCue = /^(?:how|what|why|when|where|who|which|can|could|would|should|do|did|is|are|am|tell|describe|share|explain|walk me through)\b/;
  const seaLatinCue = /^(?:bagaimana|mengapa|apa|kenapa|kapan|siapa|jelaskan|ceritakan|sebutkan|terangkan|paano|bakit|ano|kailan|sino|ilarawan|ikuwento|ipaliwanag|hay|vi sao|tai sao|nhu the nao|lam the nao|mo ta|giai thich)\b/;
  if (englishCue.test(lower) || seaLatinCue.test(lower)) return true;

  if (languageCode === 'my' || /[\u1000-\u109F]/u.test(raw)) {
    if (/(?:\u1018\u101A\u103A|\u1018\u102C|\u101E\u101C\u1032|\u1019\u101C\u1032|\u101C\u1032)/u.test(raw)) return true;
  }
  if (languageCode === 'th' || /[\u0E00-\u0E7F]/u.test(raw)) {
    if (/(?:\u0E17\u0E33\u0E44\u0E21|\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23|\u0E2D\u0E30\u0E44\u0E23|\u0E44\u0E2B\u0E21|\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48)/u.test(raw)) return true;
  }
  if (languageCode === 'km' || /[\u1780-\u17FF]/u.test(raw)) {
    if (/(?:\u17A2\u17D2?\u179C\u17B8|\u1798\u17D2?\u178F\u17C1\u1785|\u1796\u17C1\u179B)/u.test(raw)) return true;
  }
  if (languageCode === 'lo' || /[\u0E80-\u0EFF]/u.test(raw)) {
    if (/(?:\u0EAB\u0E8D\u0EB1\u0E87|\u0EC1\u0E99\u0EA7\u0EC3\u0E94|\u0EC4\u0E9C|\u0E9A\u0ECD)/u.test(raw)) return true;
  }
  return false;
}

function buildInterrogativeQuestionFromStatement(statement, targetLanguage = '') {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  let base = String(statement || '')
    .replace(/[?？.။!…]+$/u, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  base = base
    .replace(/^how would you\s+/i, '')
    .replace(/\s+in real work$/i, '')
    .replace(/^bagaimana\s+anda\s+/i, '')
    .replace(/^bagaimana\s+/i, '')
    .replace(/^ban se\s+/i, '')
    .replace(/\s+nhu the nao$/i, '')
    .replace(/^paano mo\s+/i, '')
    .trim();
  if (!base) return '';
  // Preserve the model's wording; just normalize punctuation to interrogative.
  if (languageCode === 'my' && /။$/.test(base)) base = base.replace(/။$/u, '').trim();
  return `${base}?`;
}

function normalizeInterviewQuestionTemplateArtifacts(text) {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const raw = value.toLowerCase();
  if (raw.startsWith('how would you ') || raw.includes(' in real work')) {
    value = value
      .replace(/^how would you\s+/i, '')
      .replace(/\s+in real work\??$/i, '')
      .trim();
    return value ? `${value.replace(/[?？.။!…]+$/u, '').trim()}?` : '';
  }
  return value;
}

function enforceInterviewQuestionText(text, targetLanguage = '') {
  let value = sanitizeInterviewQuestionText(text);
  if (!value) return '';
  value = normalizeInterviewQuestionTemplateArtifacts(value);
  if (!value) return '';
  // Do not force statement-to-question rewriting here.
  // Quality gate + repair flow will handle weak/fact-style rows.
  if (looksLikeInterviewQuestionText(value, targetLanguage) && !/[?？]/.test(value)) {
    value = `${value.replace(/[.။!…]+$/u, '').trim()}?`;
  }
  return value;
}

function normalizeInterviewComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[?？!….,;:()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function interviewQuestionCueRegex(languageCode) {
  const code = normalizeInterviewLanguageCode(languageCode);
  if (code === 'my') return /(?:\u1018\u101A\u103A|\u1018\u102C|\u101E\u101C\u1032|\u1019\u101C\u1032|\u101C\u1032)/u;
  if (code === 'th') return /(?:\u0E17\u0E33\u0E44\u0E21|\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23|\u0E2D\u0E30\u0E44\u0E23|\u0E44\u0E2B\u0E21|\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48)/u;
  if (code === 'km') return /(?:\u17A2\u17D2?\u179C\u17B8|\u1798\u17D2?\u178F\u17C1\u1785|\u1796\u17C1\u179B)/u;
  if (code === 'lo') return /(?:\u0EAB\u0E8D\u0EB1\u0E87|\u0EC1\u0E99\u0EA7\u0EC3\u0E94|\u0EC4\u0E9C|\u0E9A\u0ECD)/u;
  return /^(?:how|what|why|when|where|who|which|can|could|would|should|do|did|is|are|am|tell|describe|share|explain|walk me through|bagaimana|mengapa|apa|kenapa|kapan|siapa|jelaskan|ceritakan|terangkan|sebutkan|paano|bakit|ano|kailan|sino|ilarawan|ikuwento|ipaliwanag|hay|vi sao|tai sao|nhu the nao|lam the nao|mo ta|giai thich)\b/i;
}

function interviewWrapperArtifactPattern() {
  return /(?:how would you\s+.+\s+in real work\??|ကို\s+သင်\s+ဘယ်လို\s+ဆောင်ရွက်မလဲ\??|ban se\s+.+\s+nhu the nao\??)/i;
}

function tokenizeInterviewComparable(text) {
  return normalizeInterviewComparableText(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenOverlapRatio(aText, bText) {
  const aTokens = tokenizeInterviewComparable(aText);
  const bTokens = tokenizeInterviewComparable(bText);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let common = 0;
  for (const token of aSet) {
    if (bSet.has(token)) common += 1;
  }
  return common / Math.max(aSet.size, bSet.size, 1);
}

function buildInterviewRoleContextLines(role = {}) {
  const rows = [];
  const push = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    rows.push(text);
  };
  push(role?.roleSummary);
  if (Array.isArray(role?.responsibilities)) {
    for (const row of role.responsibilities) push(row);
  }
  if (Array.isArray(role?.requirements)) {
    for (const row of role.requirements) push(row);
  }
  return rows.slice(0, 40);
}

function mirrorsRoleStatement(questionText, roleContextLines = []) {
  const qNorm = normalizeInterviewComparableText(questionText);
  if (!qNorm) return false;
  const qCore = qNorm
    .replace(/^how would you\s+/i, '')
    .replace(/\s+in real work$/i, '')
    .trim();
  if (!qCore) return false;

  for (const line of roleContextLines) {
    const lineNorm = normalizeInterviewComparableText(line);
    if (!lineNorm || lineNorm.length < 10) continue;
    if (qCore === lineNorm) return true;
    if (Math.abs(qCore.length - lineNorm.length) <= 4 && (qCore.includes(lineNorm) || lineNorm.includes(qCore))) {
      return true;
    }
    const overlap = tokenOverlapRatio(qCore, lineNorm);
    if (overlap >= 0.92 && qCore.length >= 16 && lineNorm.length >= 16) return true;
  }
  return false;
}

function interviewQuestionQualityIssues(questionText, role = {}, targetLanguage = '') {
  const text = String(questionText || '').replace(/\s+/g, ' ').trim();
  if (!text) return ['empty'];
  const issues = [];
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  const cueRegex = interviewQuestionCueRegex(languageCode);
  const hasQuestionMark = /[?？]/.test(text);
  const letters = countUnicodeLetters(text);
  const latinWords = (normalizeInterviewComparableText(text).match(/[a-z]{2,}/g) || []).length;
  const roleLines = buildInterviewRoleContextLines(role);

  if (letters < 8 || (/[a-z]/i.test(text) && latinWords < 3)) issues.push('too_short');
  if (interviewWrapperArtifactPattern().test(text)) issues.push('wrapper_artifact');
  if (!hasQuestionMark && !cueRegex.test(text)) issues.push('not_interrogative');
  if (mirrorsRoleStatement(text, roleLines)) issues.push('mirrors_statement');
  return Array.from(new Set(issues));
}

function collectInvalidInterviewQuestionEntries(session, targetLanguage = '') {
  const rows = Array.isArray(session?.questions) ? session.questions : [];
  const role = session?.role && typeof session.role === 'object' ? session.role : {};
  const invalid = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const question = String(row?.question || '').replace(/\s+/g, ' ').trim();
    const issues = interviewQuestionQualityIssues(question, role, targetLanguage);
    if (issues.length) {
      invalid.push({
        index: i,
        id: String(row?.id || `q${i + 1}`),
        focus: String(row?.focus || 'general'),
        question,
        issues,
      });
    }
  }
  return invalid;
}

function normalizeInterviewQuestionPatchRows(raw) {
  const list = Array.isArray(raw?.questions) ? raw.questions : (Array.isArray(raw) ? raw : []);
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const index = Number(row.index);
    const id = String(row.id || row.questionId || '').trim();
    const focus = String(row.focus || row.type || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general';
    const question = enforceInterviewQuestionText(pickInterviewQuestionText(row), '');
    if ((!Number.isFinite(index) || index < 0) && !id) continue;
    if (!question) continue;
    out.push({
      index: Number.isFinite(index) ? Math.max(0, Math.floor(index)) : -1,
      id,
      focus,
      question: question.slice(0, 500),
    });
  }
  return out;
}

function applyInterviewQuestionPatchRows(session, patchRows, targetLanguage = '') {
  const current = Array.isArray(session?.questions) ? session.questions : [];
  if (!current.length || !Array.isArray(patchRows) || !patchRows.length) return session;
  const nextQuestions = current.map((row) => ({ ...row }));
  for (const patch of patchRows) {
    const byIndex = Number(patch?.index);
    let idx = (Number.isFinite(byIndex) && byIndex >= 0 && byIndex < nextQuestions.length)
      ? Math.floor(byIndex)
      : -1;
    if (idx < 0 && patch?.id) {
      idx = nextQuestions.findIndex((row) => String(row?.id || '') === String(patch.id));
    }
    if (idx < 0) continue;
    const normalizedQuestion = enforceInterviewQuestionText(patch.question, targetLanguage);
    if (!normalizedQuestion) continue;
    nextQuestions[idx] = {
      ...nextQuestions[idx],
      question: normalizedQuestion.slice(0, 500),
      focus: String(patch.focus || nextQuestions[idx]?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
    };
  }
  return { ...session, questions: nextQuestions };
}

async function rewriteInvalidInterviewQuestionsWithAi(session, invalidEntries, targetLanguage, router, keyBase = '', options = {}) {
  const rows = Array.isArray(invalidEntries) ? invalidEntries : [];
  if (!rows.length) return null;
  const role = session?.role || {};
  const existingQuestions = Array.isArray(session?.questions) ? session.questions : [];
  const keepers = existingQuestions
    .map((row, idx) => ({ idx, q: String(row?.question || '').replace(/\s+/g, ' ').trim() }))
    .filter((row) => row.q && !rows.some((bad) => bad.index === row.idx))
    .slice(0, 12)
    .map((row) => row.q);
  const targetLanguageLabel = interviewLanguageLabel(targetLanguage);
  const mode = String(options?.mode || 'repair').toLowerCase() === 'regenerate' ? 'regenerate' : 'repair';

  const prompt = `Return ONLY valid JSON (no markdown, no extra text).

${mode === 'repair' ? 'Rewrite ONLY the listed invalid interview questions.' : 'Generate NEW interview questions for the listed invalid slots.'}
All output must be in ${targetLanguageLabel}.
Keep each slot's index, id, and focus unchanged.
Do not change array size.
Every question must be a natural interviewer question and end with "?".
Do not output statement-like lines.
Do not repeat fixed wrappers (forbidden: "How would you ... in real work?").
Do not duplicate existing valid questions.
Each question must map to role responsibilities/requirements.

Role:
{
  "jobTitle": ${JSON.stringify(String(role?.jobTitle || 'target role'))},
  "roleSummary": ${JSON.stringify(String(role?.roleSummary || ''))},
  "responsibilities": ${JSON.stringify(Array.isArray(role?.responsibilities) ? role.responsibilities : [])},
  "requirements": ${JSON.stringify(Array.isArray(role?.requirements) ? role.requirements : [])}
}

Existing valid questions (do NOT rewrite):
${JSON.stringify(keepers)}

Invalid slots to ${mode === 'repair' ? 'rewrite' : 'fill'}:
${JSON.stringify(rows.map((row) => ({
    index: row.index,
    id: row.id,
    focus: row.focus,
    question: row.question,
    issues: row.issues,
  })))}

Output JSON shape:
{
  "questions": [
    { "index": number, "id": string, "focus": string, "question": string }
  ]
}`;

  const raw = await routeJsonWithRepair(
    router,
    prompt,
    `${keyBase || 'interview-session'}|quality-${mode}|${normalizeInterviewLanguageCode(targetLanguage)}|${rows.length}`,
    {
      passes: 1,
      retryDelayMs: 400,
      maxTotalMs: mode === 'repair' ? 12000 : 13000,
      throwOnError: false,
      routeOptions: {
        skipCache: true,
        bypassBreaker: true,
        maxTotalMs: mode === 'repair' ? 11000 : 12000,
        maxAttempts: 2,
        attemptTimeoutMs: 6000,
        maxTokens: 360,
      },
    }
  );
  if (!raw) return null;
  const patches = normalizeInterviewQuestionPatchRows(raw);
  return patches.length ? patches : null;
}

function pickInterviewQuestionText(row) {
  if (typeof row === 'string' || typeof row === 'number') {
    return sanitizeInterviewQuestionText(row);
  }
  if (!row || typeof row !== 'object') return '';

  const direct = [
    row.question,
    row.prompt,
    row.questionText,
    row.interviewQuestion,
    row.text,
    row.content,
    row.ask,
    row.query,
    row.statement,
    row.title,
  ];
  for (const candidate of direct) {
    const text = sanitizeInterviewQuestionText(candidate);
    if (text) return text;
  }

  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const k = String(key || '').toLowerCase();
    if (k.includes('question') || k.includes('prompt') || k.includes('ask') || k.includes('query')) {
      const text = sanitizeInterviewQuestionText(value);
      if (text) return text;
    }
  }

  let best = '';
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const k = String(key || '').toLowerCase();
    if (
      k === 'id'
      || k.includes('focus')
      || k === 'type'
      || k.includes('lang')
      || k.includes('responsib')
      || k.includes('require')
      || k.includes('summary')
      || k.includes('headline')
      || k === 'jobtitle'
      || k === 'title'
    ) continue;
    const text = sanitizeInterviewQuestionText(value);
    if (!text || !looksLikeInterviewQuestionText(text)) continue;
    if (text.length > best.length) best = text;
  }
  return best;
}

function pickInterviewQuestionFocus(row) {
  if (!row || typeof row !== 'object') return 'general';
  const direct = [
    row.focus,
    row.type,
    row.category,
    row.dimension,
    row.competency,
    row.skill,
    row.area,
  ];
  for (const candidate of direct) {
    const value = String(candidate || '').replace(/\s+/g, ' ').trim();
    if (value) return value.slice(0, 80);
  }
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const k = String(key || '').toLowerCase();
    if (!(k.includes('focus') || k.includes('category') || k.includes('type') || k.includes('skill'))) continue;
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (normalized) return normalized.slice(0, 80);
  }
  return 'general';
}

function normalizeInterviewQuestionArrayCandidate(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') {
    const rows = Object.values(candidate);
    if (rows.length) return rows;
  }
  return [];
}

function scoreInterviewQuestionArray(candidate) {
  const rows = normalizeInterviewQuestionArrayCandidate(candidate);
  if (!rows.length) return 0;
  let score = 0;
  for (const row of rows) {
    const question = pickInterviewQuestionText(row);
    if (!question || question.length < 6) continue;
    if (looksLikeInterviewQuestionText(question)) score += 2;
    if (/[?？]/.test(question)) score += 2;
  }
  return score;
}

function extractInterviewQuestionRows(raw) {
  if (Array.isArray(raw)) return raw;
  const source = raw && typeof raw === 'object' ? raw : {};
  const directCandidates = [
    source.questions,
    source.interviewQuestions,
    source.questionList,
    source.questionBank,
    source.question_bank,
    source.prompts,
    source.items,
    source.data?.questions,
    source.data?.interviewQuestions,
    source.data?.questionList,
    source.session?.questions,
    source.session?.interviewQuestions,
    source.output?.questions,
    source.result?.questions,
  ];
  for (const candidate of directCandidates) {
    const rows = normalizeInterviewQuestionArrayCandidate(candidate);
    if (rows.length && scoreInterviewQuestionArray(rows) > 0) return rows;
  }

  const queue = [source];
  const seen = new Set();
  let bestRows = [];
  let bestScore = 0;
  while (queue.length && seen.size < 120) {
    const obj = queue.shift();
    if (!obj || typeof obj !== 'object') continue;
    if (seen.has(obj)) continue;
    seen.add(obj);

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        const score = scoreInterviewQuestionArray(value);
        if (score > bestScore) {
          bestScore = score;
          bestRows = value;
        }
      } else if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return bestRows;
}

function isBoilerplateInterviewQuestion(text) {
  const lower = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return false;
  if (!/[a-z]/.test(lower)) return false;
  const patterns = [
    /\btell me about yourself\b/,
    /\bintroduce yourself\b/,
    /\bwhy should we hire you\b/,
    /\bwhat are your strengths and weaknesses\b/,
    /\bwhat is your greatest weakness\b/,
    /\bwhere do you see yourself in (?:3|5|10) years\b/,
    /\bwhy do you want to work (?:here|with us)\b/,
    /\bwalk me through your resume\b/,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

function extractInterviewRoleTokens(jobTitle = '') {
  const stopwords = new Set([
    'and', 'for', 'with', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'from',
    'jr', 'sr', 'junior', 'senior', 'level', 'associate', 'specialist', 'general', 'staff',
  ]);
  const raw = String(jobTitle || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .map((token) => token.replace(/[^\p{L}\p{N}_-]+/gu, ''))
    .filter((token) => token && token.length >= 2 && !stopwords.has(token) && !/^\d+$/.test(token));
  return Array.from(new Set(tokens)).slice(0, 6);
}

function interviewQuestionHasGenericSignals(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return true;
  if (isBoilerplateInterviewQuestion(raw)) return true;
  const lower = raw.toLowerCase();
  const patterns = [
    /describe a situation where you had to/i,
    /tell me about a time\b/i,
    /can you describe a situation\b/i,
    /what motivates you\b/i,
    /how do you handle stress\b/i,
    /where do you see yourself/i,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

function questionMentionsRoleTitle(question = '', roleTokens = []) {
  const normalized = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized || !Array.isArray(roleTokens) || !roleTokens.length) return false;
  const padded = ` ${normalized} `;
  return roleTokens.some((token) => padded.includes(` ${String(token || '').toLowerCase()} `));
}

function normalizeAiOnlyInterviewQuestions(raw, targetLanguage = 'en-US', targetCount = 8) {
  const limit = Math.max(4, Math.min(12, Number(targetCount) || 8));
  const rows = extractInterviewQuestionRows(raw);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const question = enforceInterviewQuestionText(pickInterviewQuestionText(row), targetLanguage);
    if (!question || question.length < 8) continue;
    if (!/[?ï¼Ÿ]/.test(question)) continue;
    if (isBoilerplateInterviewQuestion(question)) continue;
    const key = normalizeInterviewComparableText(question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(
        (row && typeof row === 'object' && (row.id || row.qid || row.questionId))
        || `q${out.length + 1}`
      ).slice(0, 80),
      question: question.slice(0, 500),
      focus: (pickInterviewQuestionFocus(row) || 'general').slice(0, 80),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function evaluateAiOnlyInterviewQuestions(questions, requestedJobTitle = '', targetLanguage = 'en-US', minCount = 4) {
  const rows = Array.isArray(questions) ? questions : [];
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (!rows.length) return { ok: false, reason: 'empty', genericCount: 0, roleMentionCount: 0 };
  if (rows.length < Math.max(1, Number(minCount) || 4)) {
    return { ok: false, reason: 'too_few', genericCount: 0, roleMentionCount: 0 };
  }
  const missingQuestionMarkCount = rows.filter((row) => !/[?ï¼Ÿ]/.test(String(row?.question || ''))).length;
  if (missingQuestionMarkCount) {
    return { ok: false, reason: 'missing_question_mark', genericCount: 0, roleMentionCount: 0 };
  }
  if (shouldForceLocalizedQuestionFallback(rows, targetLanguage)) {
    return { ok: false, reason: 'language_mismatch', genericCount: 0, roleMentionCount: 0 };
  }
  const roleTokens = extractInterviewRoleTokens(requestedJobTitle);
  let genericCount = 0;
  let roleMentionCount = 0;
  for (const row of rows) {
    const question = String(row?.question || '').replace(/\s+/g, ' ').trim();
    if (interviewQuestionHasGenericSignals(question)) genericCount += 1;
    if (questionMentionsRoleTitle(question, roleTokens)) roleMentionCount += 1;
  }
  const total = rows.length;
  const genericLimit = Math.max(1, Math.floor(total * 0.5));
  if (genericCount > genericLimit) {
    if (languageCode === 'my') {
      return { ok: true, reason: 'ok_soft_generic_my', genericCount, roleMentionCount };
    }
    return { ok: false, reason: 'too_generic', genericCount, roleMentionCount };
  }
  if (languageCode === 'en' && roleTokens.length) {
    const roleMentionRequired = Math.max(1, Math.ceil(total * 0.3));
    if (roleMentionCount < roleMentionRequired) {
      return { ok: false, reason: 'off_role', genericCount, roleMentionCount };
    }
  }
  return { ok: true, reason: 'ok', genericCount, roleMentionCount };
}

function marketDrivenEnglishFallbackInterviewQuestions(jobTitle, roleContext = {}, profile = {}, options = {}) {
  const role = String(roleContext?.jobTitle || jobTitle || 'this role').trim() || 'this role';
  const candidateName = normalizeInterviewCandidateName(options?.candidateName || '');
  const roleTrack = String(options?.roleTrack || inferInterviewRoleTrack(role, profile)).trim().toLowerCase() === 'hands_on'
    ? 'hands_on'
    : 'knowledge';
  const questionPlan = pickInterviewQuestionVolume({
    seniority: options?.seniority,
    questionFocus: options?.questionFocus,
    roleTrack,
    role: roleContext,
    profile,
  });
  const targetCount = Math.max(
    questionPlan.minCount,
    Math.min(
      questionPlan.maxCount,
      Number.isFinite(Number(options?.targetCount))
        ? Math.round(Number(options.targetCount))
        : questionPlan.targetCount
    )
  );
  const seniority = String(options?.seniority || 'mid').trim().toLowerCase();
  const questionFocus = String(options?.questionFocus || 'mixed').trim().toLowerCase();
  const region = String(profile?.region || '').replace(/\s+/g, ' ').trim();
  const anchors = roleAnchorsForInterviewQuestions(roleContext, profile);
  const skillAnchors = normalizeInterviewList(profile?.skills, 12, 80);
  const fallbackAnchor = `${role} delivery outcomes`;
  const anchorAt = (idx) => anchors[idx % (anchors.length || 1)] || fallbackAnchor;
  const skillAt = (idx) => skillAnchors[idx % (skillAnchors.length || 1)] || `${role} core tooling`;
  const scopeHint = seniority === 'entry'
    ? 'internship, coursework, or early-career projects'
    : seniority === 'senior'
      ? 'cross-team, production-scale delivery'
      : 'real project work with measurable outcomes';
  const regionClause = region ? ` in ${region}` : '';
  const withCandidateName = (question, idx) => {
    const base = String(question || '').trim();
    if (!candidateName || !base || idx > 1) return base;
    const head = base.charAt(0);
    const tail = base.slice(1);
    if (!/[A-Za-z]/.test(head)) return `${candidateName}, ${base}`;
    return `As ${candidateName}, ${head.toLowerCase()}${tail}`;
  };

  const templateByFocus = roleTrack === 'hands_on'
    ? {
        behavioral: [
          (idx) => `Describe a day when you handled "${anchorAt(idx)}" well during a busy shift.`,
          (idx) => `Tell me about a time you made sure cleaning and safety standards were followed.`,
          (idx) => `Share a mistake you made while doing "${anchorAt(idx)}" and how you fixed it.`,
        ],
        scenario: [
          (idx) => `If two urgent tasks arrive together during your shift, how do you prioritize "${anchorAt(idx)}" and why?`,
          (idx) => `If supplies run low while doing "${anchorAt(idx)}", what steps do you take immediately?`,
          (idx) => `If a coworker is absent, how do you keep "${anchorAt(idx)}" completed on time?`,
        ],
        technical: [
          (idx) => `Which tools or methods do you use for "${anchorAt(idx)}" to keep quality consistent?`,
          (idx) => `How do you check your work quality after finishing "${anchorAt(idx)}"?`,
          (idx) => `How do you safely use chemicals or equipment when doing "${anchorAt(idx)}"?`,
        ],
        communication: [
          (idx) => `How do you report hazards, breakages, or delays while doing "${anchorAt(idx)}"?`,
          (idx) => `How do you communicate with supervisors when priorities change during a shift?`,
        ],
        execution: [
          (idx) => `What routine helps you complete "${anchorAt(idx)}" on time every day?`,
          (idx) => `What do you do first at the start of a shift to keep work areas safe and clean?`,
        ],
        'problem-solving': [
          (idx) => `How do you handle difficult situations like blocked areas or unexpected messes during "${anchorAt(idx)}"?`,
          (idx) => `What steps do you take when quality checks fail for "${anchorAt(idx)}"?`,
        ],
        market: [
          () => `What behavior proves someone is reliable and hire-ready for ${role}${regionClause}?`,
        ],
      }
    : {
    behavioral: [
      (idx) => `Pick one responsibility from this role: "${anchorAt(idx)}". Describe a ${scopeHint} example where you delivered it end-to-end, including measurable impact.`,
      (idx) => `Tell me about a time you had to raise the quality bar for "${anchorAt(idx)}". What specific standard changed and what result followed?`,
      (idx) => `Describe a failure or rollback related to "${anchorAt(idx)}". What did you change to prevent recurrence?`,
    ],
    scenario: [
      (idx) => `In your first 30 days as ${role}, a key performance metric drops while you are delivering ${anchorAt(idx)}. How would you diagnose the root cause and recover outcomes?`,
      (idx) => `A stakeholder requests a last-minute change that puts quality at risk for ${anchorAt(idx)}. How would you negotiate scope, timeline, and trade-offs?`,
      (idx) => `You can deliver only one high-impact item this week: ${anchorAt(idx)} or ${anchorAt(idx + 1)}. Which would you prioritize first, and why?`,
    ],
    technical: [
      (idx) => `How would you technically execute "${anchorAt(idx)}" using ${skillAt(idx)} while keeping quality and maintainability?`,
      (idx) => `Walk me through a technical decision where you had multiple options for "${anchorAt(idx)}". Which option did you choose, and what trade-offs did you accept?`,
      (idx) => `What validation checks would you run before shipping work tied to "${anchorAt(idx)}"?`,
    ],
    communication: [
      (idx) => `How do you explain project risk and delivery status for "${anchorAt(idx)}" to non-technical stakeholders and leadership?`,
      (idx) => `Give an example of influencing a cross-functional team to align on "${anchorAt(idx)}". What was your communication strategy?`,
    ],
    execution: [
      (idx) => `Which KPI would you track to prove impact for "${anchorAt(idx)}", and what realistic 90-day target would you commit to${regionClause}?`,
      (idx) => `What is your execution plan for delivering "${anchorAt(idx)}" under tight deadlines without creating hidden technical debt?`,
    ],
    'problem-solving': [
      (idx) => `What are the top operational risks when handling "${anchorAt(idx)}", and how would you mitigate each one?`,
      (idx) => `Describe how you troubleshoot when output quality for "${anchorAt(idx)}" is below target. What signals do you check first?`,
    ],
    market: [
      () => `Given current hiring expectations for ${role}${regionClause}, which capability should be strongest on day one, and how would you demonstrate it in interview evidence?`,
    ],
  };

  const focusOrder = roleTrack === 'hands_on'
    ? (
      questionFocus === 'technical'
        ? ['scenario', 'execution', 'technical', 'problem-solving', 'communication', 'behavioral', 'market']
        : questionFocus === 'behavioral'
          ? ['behavioral', 'execution', 'scenario', 'communication', 'problem-solving', 'technical', 'market']
          : ['execution', 'scenario', 'behavioral', 'communication', 'problem-solving', 'technical', 'market']
    )
    : (
      questionFocus === 'technical'
        ? ['technical', 'scenario', 'problem-solving', 'execution', 'communication', 'behavioral', 'market']
        : questionFocus === 'behavioral'
          ? ['behavioral', 'communication', 'scenario', 'execution', 'problem-solving', 'technical', 'market']
          : ['scenario', 'execution', 'behavioral', 'technical', 'communication', 'problem-solving', 'market']
    );

  const focusCursor = {};
  const questions = [];
  const seen = new Set();
  let idx = 0;
  while (questions.length < targetCount && idx < 80) {
    const focus = focusOrder[idx % focusOrder.length] || 'execution';
    const builders = templateByFocus[focus] || templateByFocus.execution;
    const cursor = Number(focusCursor[focus] || 0);
    const builder = builders[cursor % builders.length];
    focusCursor[focus] = cursor + 1;
    const question = String(typeof builder === 'function' ? builder(idx) : '').replace(/\s+/g, ' ').trim();
    const personalizedQuestion = withCandidateName(question, questions.length);
    const key = personalizedQuestion.toLowerCase();
    if (personalizedQuestion.length >= 24 && !seen.has(key)) {
      seen.add(key);
      questions.push({
        id: `q${questions.length + 1}`,
        question: personalizedQuestion,
        focus,
      });
    }
    idx += 1;
  }
  if (!questions.length) {
    return [
      { id: 'q1', question: `Describe a real project where you delivered measurable impact in ${role}.`, focus: 'execution' },
      { id: 'q2', question: `How do you prioritize competing responsibilities in ${role} under deadline pressure?`, focus: 'scenario' },
      { id: 'q3', question: `Which evidence best proves you are ready for ${role}, and why?`, focus: 'market' },
    ];
  }
  return questions;
}

function slugifyCareerGuideId(value = '', fallbackIndex = 1) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  if (normalized) return normalized;
  return `role-${Math.max(1, Number(fallbackIndex) || 1)}`;
}

function normalizeCareerGuidanceSources(rawSources, fallbackTitle = '') {
  const rows = Array.isArray(rawSources)
    ? rawSources
    : (rawSources && typeof rawSources === 'object'
      ? Object.values(rawSources)
      : []);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    let label = '';
    let url = '';
    if (row && typeof row === 'object') {
      label = String(row?.label || row?.title || row?.name || row?.source || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      url = String(row?.url || row?.href || row?.link || '').trim();
    } else if (typeof row === 'string') {
      url = row.trim();
    }
    if (!/^https?:\/\//i.test(url)) continue;
    if (!label) {
      try {
        const parsed = new URL(url);
        label = parsed.hostname.replace(/^www\./i, '') || 'Source';
      } catch {
        label = 'Source';
      }
    }
    const key = `${label.toLowerCase()}|${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, url });
    if (out.length >= 4) break;
  }
  if (out.length) return out;
  const roleQuery = encodeURIComponent(String(fallbackTitle || '').trim() || 'career role');
  return [
    { label: 'BLS Occupational Outlook Handbook', url: `https://www.bls.gov/ooh/search.htm?ST=${roleQuery}` },
    { label: 'O*NET OnLine', url: `https://www.onetonline.org/find/quick?s=${roleQuery}` },
  ];
}

function inferCareerGuidanceTrack(title = '') {
  const lower = String(title || '').toLowerCase();
  if (/\bfull[\s-]*stack\b/.test(lower)) return 'fullstack';
  if (/\b(front[\s-]*end|frontend|ui|ux|web developer|web engineer)\b/.test(lower)) return 'frontend';
  if (/\b(back[\s-]*end|backend|api|server)\b/.test(lower)) return 'backend';
  if (/\b(devops|sre|site reliability|platform engineer|cloud engineer|infrastructure)\b/.test(lower)) return 'devops';
  if (/\b(data scientist|data engineer|data analyst|machine learning|ml engineer|ai engineer|analytics|business intelligence|bi)\b/.test(lower)) return 'data';
  if (/\b(qa|quality assurance|sdet|test engineer|automation tester)\b/.test(lower)) return 'qa';
  if (/\b(product manager|project manager|program manager)\b/.test(lower)) return 'management';
  return 'general';
}

function isSeniorCareerRoleTitle(title = '') {
  return /\b(senior|sr\.?|lead|principal|staff|architect|manager|head|director)\b/i.test(String(title || ''));
}

function mergeCareerGuidanceItems(primary = [], additions = [], max = 8) {
  const out = [];
  const seen = new Set();
  for (const row of [...primary, ...additions]) {
    const value = String(row || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function isWeakCareerGuidanceList(items = [], kind = 'requirements', isSenior = false) {
  const rows = normalizeInterviewList(items, 12, 220);
  if (!rows.length) return true;
  const minimum = kind === 'requirements'
    ? (isSenior ? 6 : 5)
    : (isSenior ? 5 : 4);
  if (rows.length < minimum) return true;
  const genericPattern = kind === 'requirements'
    ? /\b(proven experience|strong proficiency|familiarity|knowledge of|communication skills|team player|problem-solving ability)\b/i
    : /\b(collaborate with|deliver .* outcomes|maintain .* quality|support .* team|ensure .* responsiveness)\b/i;
  const genericHits = rows.filter((row) => genericPattern.test(row)).length;
  return genericHits >= Math.max(2, Math.ceil(rows.length * 0.5));
}

function careerGuidanceResponsibilityBoost(title = '') {
  const track = inferCareerGuidanceTrack(title);
  const isSenior = isSeniorCareerRoleTitle(title);
  const trackMap = {
    frontend: [
      'Design scalable front-end architecture, component boundaries, and state-management patterns.',
      'Own performance budgets and improve Core Web Vitals, rendering speed, and bundle efficiency.',
      'Define UI quality gates using unit, integration, and E2E testing strategies.',
      'Partner with design/product to translate requirements into accessible, production-ready interfaces.',
    ],
    backend: [
      'Design reliable APIs and service contracts with clear versioning and backward compatibility.',
      'Optimize database access, caching, and query performance for high-throughput workloads.',
      'Implement observability, error budgets, and incident response practices for backend services.',
      'Improve service reliability through resiliency patterns, testing, and release controls.',
    ],
    fullstack: [
      'Deliver end-to-end features across UI, API, data, and deployment pipelines.',
      'Set cross-stack standards for test coverage, code quality, and release readiness.',
      'Diagnose production bottlenecks and lead performance, reliability, and maintainability improvements.',
      'Coordinate implementation tradeoffs across product, design, and engineering stakeholders.',
    ],
    data: [
      'Build and maintain robust data pipelines, quality checks, and reproducible analysis workflows.',
      'Develop production-ready models or analytics assets with monitoring and drift awareness.',
      'Translate business questions into measurable metrics, experiments, and reporting frameworks.',
      'Document assumptions, validation methods, and decision impacts for stakeholder trust.',
    ],
    devops: [
      'Design CI/CD pipelines, deployment strategies, and environment governance for safe releases.',
      'Automate infrastructure provisioning and enforce reliability, security, and compliance baselines.',
      'Implement monitoring, alerting, and incident workflows to improve service uptime.',
      'Drive platform efficiency through capacity planning, cost optimization, and tooling automation.',
    ],
    qa: [
      'Build risk-based test strategies covering functional, regression, integration, and non-functional scope.',
      'Own automation frameworks and test data strategy integrated with CI/CD pipelines.',
      'Define release quality thresholds and collaborate on defect prevention at design time.',
      'Track quality metrics and drive root-cause analysis for recurring production defects.',
    ],
    management: [
      'Prioritize roadmap delivery by balancing customer impact, technical risk, and team capacity.',
      'Define measurable outcomes and align cross-functional teams on milestones and dependencies.',
      'Manage delivery risk through structured planning, escalation, and transparent communication.',
      'Drive continuous process improvement using delivery metrics and retrospective actions.',
    ],
    general: [
      'Own delivery outcomes with measurable quality, speed, and stakeholder impact.',
      'Translate goals into executable plans, milestones, and risk-managed implementation steps.',
      'Maintain quality standards through structured review, testing, and post-release learning.',
      'Collaborate across teams to unblock dependencies and improve execution predictability.',
    ],
  };
  const base = trackMap[track] || trackMap.general;
  const seniorExtras = [
    'Lead architecture decisions and technical direction across multiple initiatives.',
    'Mentor team members, enforce engineering standards, and improve review quality.',
    'Communicate delivery strategy and technical risks to senior stakeholders and leadership.',
  ];
  return isSenior ? [...base, ...seniorExtras] : base;
}

function careerGuidanceRequirementBoost(title = '') {
  const track = inferCareerGuidanceTrack(title);
  const isSenior = isSeniorCareerRoleTitle(title);
  const trackMap = {
    frontend: [
      'Advanced TypeScript and modern framework architecture (React/Vue/Angular) for large-scale apps.',
      'Performance optimization expertise: Core Web Vitals, rendering, bundle strategy, and profiling.',
      'Testing depth across unit, integration, and E2E pipelines (Jest/Vitest, Cypress/Playwright).',
      'Accessibility and design-system implementation aligned with WCAG standards.',
      'Front-end security knowledge: XSS prevention, auth/session handling, and browser hardening.',
      'CI/CD and observability workflows for reliable releases and production debugging.',
    ],
    backend: [
      'Strong API and service design expertise, including auth, rate limiting, and versioning.',
      'Data modeling and database optimization skills for transactional integrity and performance.',
      'Proficiency in distributed systems fundamentals: scalability, reliability, and fault tolerance.',
      'Production testing strategy across unit, integration, contract, and load testing.',
      'Security practices for APIs and data: secrets management, encryption, and vulnerability handling.',
      'Operational excellence with monitoring, logging, tracing, and incident response.',
    ],
    fullstack: [
      'Strong full-stack architecture skills spanning UI patterns, API design, and data modeling.',
      'Hands-on testing strategy across front-end, back-end, and end-to-end flows.',
      'Cloud deployment proficiency with CI/CD, containers, and environment automation.',
      'Performance optimization across browser, API, and database layers.',
      'Security fundamentals across application, API, data, and dependency lifecycle.',
      'Ability to debug production systems using observability and telemetry.',
    ],
    data: [
      'Strong statistics/data modeling skills and practical SQL/Python for production analytics.',
      'Experience building maintainable data pipelines with quality, lineage, and validation controls.',
      'Model evaluation and monitoring skills, including drift detection and performance tracking.',
      'Data visualization and storytelling ability for non-technical and executive audiences.',
      'Experimentation and metric design skills for evidence-based decision making.',
      'Data governance awareness: privacy, security, and responsible AI/data use.',
    ],
    devops: [
      'Deep CI/CD expertise, including rollback strategy, progressive delivery, and release governance.',
      'Infrastructure-as-code proficiency (Terraform/CloudFormation or equivalent) and automation mindset.',
      'Cloud platform operations knowledge for networking, IAM, compute, and storage reliability.',
      'Observability stack expertise for metrics, logs, traces, and SLO/SLA management.',
      'Security and compliance integration across build, deploy, and runtime systems.',
      'Incident management and resilience engineering experience in production environments.',
    ],
    qa: [
      'Advanced test design and automation strategy across UI, API, integration, and non-functional testing.',
      'Proficiency with automation tooling and CI pipeline integration for continuous quality feedback.',
      'Strong defect triage, root-cause analysis, and prevention-oriented quality practices.',
      'Performance, security, and reliability testing familiarity beyond functional scope.',
      'Quality metrics ownership with release-readiness criteria and risk reporting.',
      'Collaboration skills to embed quality early in planning and implementation cycles.',
    ],
    management: [
      'Strong planning and prioritization skills using delivery metrics and impact tradeoffs.',
      'Stakeholder management capability across product, engineering, operations, and leadership.',
      'Risk and dependency management discipline for complex multi-team initiatives.',
      'Data-informed decision making with clear KPI ownership and outcome tracking.',
      'Communication excellence in reporting progress, blockers, and strategic recommendations.',
      'Process improvement mindset with repeatable frameworks for execution quality.',
    ],
    general: [
      'Role-specific technical depth plus evidence of delivery in real production contexts.',
      'Structured problem-solving and decision-making under ambiguity and changing priorities.',
      'Ownership mindset for measurable outcomes, quality standards, and continuous improvement.',
      'Cross-functional communication skills with clear stakeholder alignment.',
      'Execution discipline: planning, prioritization, and risk mitigation.',
      'Ability to learn and adapt quickly to new tools, domain constraints, and business goals.',
    ],
  };
  const base = trackMap[track] || trackMap.general;
  const seniorExtras = [
    'System design and architecture decision-making for scale, reliability, and maintainability.',
    'Technical leadership experience: mentoring, code-review standards, and cross-team alignment.',
    'Ability to influence roadmap-level priorities using technical and business tradeoff analysis.',
  ];
  return isSenior ? [...base, ...seniorExtras] : base;
}

function normalizeCareerGuidanceRoles(raw, profile = {}, interests = []) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const rows = [
    ...asArray(source?.roles),
    ...asArray(source?.guidance),
    ...asArray(source?.recommendations),
    ...asArray(source?.jobs),
    ...asArray(source?.data?.roles),
    ...asArray(source?.data?.guidance),
    ...asArray(source?.data?.recommendations),
    ...asArray(source?.data?.jobs),
    ...asArray(source),
  ];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = String(
      row?.title
      || row?.jobTitle
      || row?.role
      || row?.name
      || row?.position
      || ''
    ).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const seniorRole = isSeniorCareerRoleTitle(title);
    const roleSummaryRaw = String(
      row?.roleSummary
      || row?.summary
      || row?.reason
      || row?.description
      || 'This role aligns with your profile and current growth goals.'
    ).replace(/\s+/g, ' ').trim();
    const roleSummary = (
      seniorRole && !/\b(architecture|strategy|lead|stakeholder|scal|reliab|mentor|ownership)\b/i.test(roleSummaryRaw)
        ? `${roleSummaryRaw} Senior-level scope includes architecture decisions, delivery leadership, and quality ownership.`
        : roleSummaryRaw
    ).slice(0, 420);

    const baseResponsibilities = normalizeInterviewList(
      row?.responsibilities
      || row?.responsibility
      || row?.duties
      || row?.tasks
      || row?.keyResponsibilities
      || row?.whatYouDo
      || [],
      10,
      220
    );
    const baseRequirements = normalizeInterviewList(
      row?.requirements
      || row?.requirement
      || row?.qualifications
      || row?.mustHave
      || row?.skills
      || row?.entryRequirements
      || [],
      10,
      220
    );
    const responsibilitiesBoost = careerGuidanceResponsibilityBoost(title);
    const requirementsBoost = careerGuidanceRequirementBoost(title);
    const responsibilities = isWeakCareerGuidanceList(baseResponsibilities, 'responsibilities', seniorRole)
      ? mergeCareerGuidanceItems(responsibilitiesBoost, baseResponsibilities, 8)
      : mergeCareerGuidanceItems(baseResponsibilities, responsibilitiesBoost, 8);
    const requirements = isWeakCareerGuidanceList(baseRequirements, 'requirements', seniorRole)
      ? mergeCareerGuidanceItems(requirementsBoost, baseRequirements, 8)
      : mergeCareerGuidanceItems(baseRequirements, requirementsBoost, 8);
    const sources = normalizeCareerGuidanceSources(
      row?.sources
      || row?.references
      || row?.links
      || row?.citations
      || [],
      title
    );

    out.push({
      id: String(row?.id || `career-${slugifyCareerGuideId(title, out.length + 1)}`).slice(0, 96),
      title,
      roleSummary: roleSummary || 'This role can be a strong next step from your current profile.',
      responsibilities,
      requirements,
      sources,
    });
    if (out.length >= 8) break;
  }

  if (out.length) return out.slice(0, 6);

  const hints = normalizeInterviewList(
    [
      ...normalizeInterviewList(interests, 8, 80),
      ...normalizeInterviewList(profile?.skills, 8, 80),
      String(profile?.learningGoal || '').trim(),
      String(profile?.headline || '').trim(),
    ],
    8,
    80
  );
  const titles = [];
  const titleSeen = new Set();
  for (const hint of hints) {
    const cleaned = String(hint || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!cleaned) continue;
    const title = cleaned.length > 2 ? cleaned : '';
    if (!title) continue;
    const key = title.toLowerCase();
    if (titleSeen.has(key)) continue;
    titleSeen.add(key);
    titles.push(title);
    if (titles.length >= 4) break;
  }
  if (!titles.length) {
    titles.push('Operations Associate', 'Customer Success Specialist', 'QA Engineer');
  }

  return titles.map((title, idx) => ({
    id: `career-${slugifyCareerGuideId(title, idx + 1)}`,
    title,
    roleSummary: isSeniorCareerRoleTitle(title)
      ? 'Potential match based on your CV and interests with senior-level ownership expectations.'
      : 'Potential match based on your CV and interests.',
    responsibilities: mergeCareerGuidanceItems(
      careerGuidanceResponsibilityBoost(title),
      [`Deliver practical outcomes expected for ${title}.`],
      8
    ),
    requirements: mergeCareerGuidanceItems(
      careerGuidanceRequirementBoost(title),
      ['Evidence of capability through projects or work history.'],
      8
    ),
    sources: normalizeCareerGuidanceSources([], title),
  })).slice(0, 4);
}

function normalizeInterviewRecommendations(raw, profile = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const rows = [
    ...asArray(source?.jobs),
    ...asArray(source?.recommendations),
    ...asArray(source?.roles),
    ...asArray(source?.data?.jobs),
    ...asArray(source?.data?.recommendations),
    ...asArray(source),
  ];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = String(
      row?.title
      || row?.jobTitle
      || row?.role
      || row?.name
      || row?.position
      || ''
    ).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = String(
      row?.reason
      || row?.why
      || row?.explanation
      || `Matches your profile for ${title}.`
    ).replace(/\s+/g, ' ').trim().slice(0, 260);
    const id = String(
      row?.id
      || `job-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || (out.length + 1)}`
    ).slice(0, 80);
    out.push({ id, title, reason });
    if (out.length >= 8) break;
  }

  if (out.length) return out;

  const skills = normalizeInterviewList(profile?.skills || [], 8, 80).map((v) => v.toLowerCase());
  const defaults = [
    { id: 'fallback-qa', title: 'QA Engineer', reason: 'Good match for analytical and detail-focused profiles.' },
    { id: 'fallback-web', title: 'Web Developer', reason: 'Strong fit for practical build-and-deliver workflows.' },
    { id: 'fallback-data', title: 'Data Analyst', reason: 'Useful path for evidence-based decision-making skills.' },
    { id: 'fallback-ops', title: 'Operations Associate', reason: 'Suitable for coordination, planning, and execution roles.' },
    { id: 'fallback-cs', title: 'Customer Success Specialist', reason: 'Aligned with communication and stakeholder support strengths.' },
  ];
  if (skills.some((s) => s.includes('design'))) {
    defaults.unshift({ id: 'fallback-ui', title: 'UI/UX Designer', reason: 'Aligned with visual design and product thinking strengths.' });
  }
  return defaults.slice(0, 6);
}

function normalizeInterviewSession(raw, requestedJobTitle, profile = {}, options = {}) {
  const targetLanguage = String(options?.targetLanguage || 'en-US').trim() || 'en-US';
  const allowFallback = options?.allowFallback !== false;
  const enforceLanguageGate = options?.enforceLanguageGate !== false;
  const questionFocus = String(options?.questionFocus || 'mixed').trim().toLowerCase();
  const seniority = String(options?.seniority || 'mid').trim().toLowerCase();
  const roleTrack = String(options?.roleTrack || inferInterviewRoleTrack(requestedJobTitle, profile)).trim().toLowerCase() === 'hands_on'
    ? 'hands_on'
    : 'knowledge';
  const questionPlan = pickInterviewQuestionVolume({
    seniority,
    questionFocus,
    roleTrack,
    profile,
    role: raw?.role || {},
  });
  const minQuestionCount = Math.max(
    0,
    Math.min(
      18,
      Number.isFinite(Number(options?.minQuestionCount))
        ? Math.round(Number(options.minQuestionCount))
        : questionPlan.minCount
    )
  );
  const maxQuestionCount = Math.max(
    minQuestionCount || 1,
    Math.min(
      18,
      Number.isFinite(Number(options?.maxQuestionCount))
        ? Math.round(Number(options.maxQuestionCount))
        : questionPlan.maxCount
    )
  );
  const targetQuestionCount = Math.max(
    minQuestionCount,
    Math.min(
      maxQuestionCount,
      Number.isFinite(Number(options?.targetQuestionCount))
        ? Math.round(Number(options.targetQuestionCount))
        : questionPlan.targetCount
    )
  );
  const stripBoilerplateQuestions = options?.stripBoilerplateQuestions !== false;
  const fallbackRole = fallbackInterviewRole(requestedJobTitle, profile, targetLanguage);
  const roleRaw = extractInterviewRoleRaw(raw);
  const roleResponsibilitiesSource = (
    roleRaw?.responsibilities
    ?? roleRaw?.responsibility
    ?? roleRaw?.duties
    ?? roleRaw?.tasks
    ?? fallbackRole.responsibilities
  );
  const roleRequirementsSource = (
    roleRaw?.requirements
    ?? roleRaw?.requirement
    ?? roleRaw?.qualifications
    ?? roleRaw?.mustHave
    ?? fallbackRole.requirements
  );
  const role = {
    jobTitle: String(roleRaw?.jobTitle || roleRaw?.title || requestedJobTitle || fallbackRole.jobTitle).replace(/\s+/g, ' ').trim().slice(0, 120) || fallbackRole.jobTitle,
    roleSummary: String(roleRaw?.roleSummary || roleRaw?.summary || fallbackRole.roleSummary).replace(/\s+/g, ' ').trim().slice(0, 1200) || fallbackRole.roleSummary,
    responsibilities: normalizeInterviewFlexibleList(roleResponsibilitiesSource, 20, 280),
    requirements: normalizeInterviewFlexibleList(roleRequirementsSource, 20, 280),
  };
  if (!role.responsibilities.length) role.responsibilities = fallbackRole.responsibilities;
  if (!role.requirements.length) role.requirements = fallbackRole.requirements;
  if (enforceLanguageGate && shouldForceLocalizedTextFallback(
    [role.roleSummary, ...role.responsibilities, ...role.requirements].join('\n'),
    targetLanguage
  )) {
    role.roleSummary = fallbackRole.roleSummary;
    role.responsibilities = fallbackRole.responsibilities.slice();
    role.requirements = fallbackRole.requirements.slice();
  }

  const rawQuestions = extractInterviewQuestionRows(raw);
  const normalizedQuestions = [];
  const seen = new Set();
  for (const row of rawQuestions) {
    const question = enforceInterviewQuestionText(pickInterviewQuestionText(row), targetLanguage);
    if (!question || question.length < 6) continue;
    // Prevent role statements (e.g., responsibilities) from leaking into interview questions.
    if (!/[?？]/.test(question)) continue;
    if (!looksLikeInterviewQuestionText(question, targetLanguage)) continue;
    if (stripBoilerplateQuestions && isBoilerplateInterviewQuestion(question)) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedQuestions.push({
      id: String(
        (row && typeof row === 'object' && (row.id || row.qid || row.questionId))
        || `q${normalizedQuestions.length + 1}`
      ),
      question: question.slice(0, 500),
      focus: pickInterviewQuestionFocus(row) || 'general',
    });
    if (normalizedQuestions.length >= maxQuestionCount) break;
  }

  const fallbackQuestions = allowFallback
    ? fallbackInterviewQuestions(role.jobTitle, targetLanguage, {
      role,
      profile,
      questionFocus,
      roleTrack,
      seniority,
      targetCount: targetQuestionCount,
    })
    : [];
  let questions = (
    normalizedQuestions.length && (!enforceLanguageGate || !shouldForceLocalizedQuestionFallback(normalizedQuestions, targetLanguage))
  )
    ? normalizedQuestions
    : fallbackQuestions;
  if (Array.isArray(questions) && questions.length > maxQuestionCount) {
    questions = questions.slice(0, maxQuestionCount);
  }
  if (allowFallback && minQuestionCount > 0 && (!Array.isArray(questions) || questions.length < minQuestionCount)) {
    const merged = [];
    const mergedSeen = new Set();
    for (const row of [...(Array.isArray(questions) ? questions : []), ...fallbackQuestions]) {
      const question = enforceInterviewQuestionText(row?.question, targetLanguage);
      if (!question || question.length < 10) continue;
      const key = question.toLowerCase();
      if (mergedSeen.has(key)) continue;
      mergedSeen.add(key);
      merged.push({
        id: String(row?.id || `q${merged.length + 1}`),
        question: question.slice(0, 500),
        focus: String(row?.focus || row?.type || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
      });
      if (merged.length >= targetQuestionCount) break;
    }
    questions = merged;
  }

  return {
    role,
    questions,
    generatedAt: nowIso(),
  };
}

function fallbackInterviewFeedbackByLanguage(targetLanguage = 'en-US') {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'th') {
    return {
      feedback: 'à¸„à¸³à¸•à¸­à¸šà¸‚à¸­à¸‡à¸„à¸¸à¸“à¸¢à¸±à¸‡à¸•à¹‰à¸­à¸‡à¹€à¸žà¸´à¹ˆà¸¡à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸—à¸µà¹ˆà¸Šà¸±à¸”à¹€à¸ˆà¸™ à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸—à¸µà¹ˆà¹€à¸›à¹‡à¸™à¸¥à¸³à¸”à¸±à¸š à¹à¸¥à¸°à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¸—à¸µà¹ˆà¸§à¸±à¸”à¹„à¸”à¹‰',
      sampleResponse: 'à¸¥à¸­à¸‡à¸•à¸­à¸šà¹à¸šà¸š STAR: à¸ªà¸–à¸²à¸™à¸à¸²à¸£à¸“à¹Œ à¸‡à¸²à¸™à¸—à¸µà¹ˆà¸£à¸±à¸šà¸œà¸´à¸”à¸Šà¸­à¸š à¸à¸²à¸£à¸¥à¸‡à¸¡à¸·à¸­à¸—à¸³ à¹à¸¥à¸°à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¹€à¸Šà¸´à¸‡à¸•à¸±à¸§à¹€à¸¥à¸‚à¸—à¸µà¹ˆà¸Šà¸±à¸”à¹€à¸ˆà¸™',
      toneFeedback: 'à¹ƒà¸Šà¹‰à¸™à¹‰à¸³à¹€à¸ªà¸µà¸¢à¸‡à¸¡à¸±à¹ˆà¸™à¹ƒà¸ˆ à¸à¸£à¸°à¸Šà¸±à¸š à¹à¸¥à¸°à¸•à¸£à¸‡à¸›à¸£à¸°à¹€à¸”à¹‡à¸™',
      grammarFeedback: 'à¹ƒà¸Šà¹‰à¸›à¸£à¸°à¹‚à¸¢à¸„à¸ªà¸±à¹‰à¸™à¸—à¸µà¹ˆà¸ªà¸¡à¸šà¸¹à¸£à¸“à¹Œ à¹à¸¥à¸°à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¹ƒà¸«à¹‰à¸¥à¸·à¹ˆà¸™à¹„à¸«à¸¥',
      pronunciationFeedback: 'à¹€à¸™à¹‰à¸™à¸„à¸³à¸ªà¸³à¸„à¸±à¸ à¸žà¸¹à¸”à¸Šà¹‰à¸²à¸¥à¸‡à¹€à¸¥à¹‡à¸à¸™à¹‰à¸­à¸¢ à¹à¸¥à¸°à¸¥à¸”à¸„à¸³à¸Ÿà¸¸à¹ˆà¸¡à¹€à¸Ÿà¸·à¸­à¸¢',
    };
  }
  if (languageCode === 'my') {
    return {
      feedback: 'á€žá€„á€·á€ºá€¡á€–á€¼á€±á€™á€¾á€¬ á€¥á€•á€™á€¬á€•á€±á€¸á€™á€¾á€¯ á€•á€­á€¯á€™á€­á€¯á€›á€¾á€„á€ºá€¸á€œá€„á€ºá€¸á€›á€”á€ºáŠ á€–á€½á€²á€·á€…á€Šá€ºá€¸á€•á€¯á€¶ á€•á€­á€¯á€™á€­á€¯á€€á€±á€¬á€„á€ºá€¸á€…á€±á€›á€”á€º á€”á€¾á€„á€·á€º á€á€­á€¯á€„á€ºá€¸á€á€¬á€”á€­á€¯á€„á€ºá€žá€±á€¬ á€›á€œá€’á€ºá€™á€»á€¬á€¸ á€‘á€Šá€·á€ºá€žá€½á€„á€ºá€¸á€›á€”á€º á€œá€­á€¯á€¡á€•á€ºá€•á€«á€žá€Šá€º',
      sampleResponse: 'STAR á€–á€±á€¬á€ºá€™á€á€ºá€€á€­á€¯ á€¡á€žá€¯á€¶á€¸á€•á€¼á€¯á€•á€« - á€¡á€á€¼á€±á€¡á€”á€±áŠ á€á€¬á€á€”á€ºáŠ á€œá€¯á€•á€ºá€†á€±á€¬á€„á€ºá€á€»á€€á€ºáŠ á€›á€œá€’á€º á€€á€­á€¯ á€á€­á€¯á€á€±á€¬á€„á€ºá€¸á€›á€¾á€„á€ºá€¸á€œá€„á€ºá€¸á€…á€½á€¬ á€–á€¼á€±á€•á€«',
      toneFeedback: 'á€šá€¯á€¶á€€á€¼á€Šá€ºá€™á€¾á€¯á€›á€¾á€­á€•á€¼á€®á€¸ á€á€­á€¯á€á€±á€¬á€„á€ºá€¸ á€á€­á€€á€»á€žá€±á€¬ á€¡á€žá€¶á€‘á€½á€€á€ºá€”á€¾á€„á€·á€º á€…á€€á€¬á€¸á€•á€¼á€±á€¬á€•á€¯á€¶á€€á€­á€¯ á€¡á€žá€¯á€¶á€¸á€•á€¼á€¯á€•á€«',
      grammarFeedback: 'á€…á€¬á€€á€¼á€±á€¬á€„á€ºá€¸á€á€­á€¯á€á€­á€¯ á€•á€¼á€Šá€·á€ºá€…á€¯á€¶á€…á€½á€¬ á€›á€±á€¸á€•á€¼á€®á€¸ á€¡á€á€»á€€á€ºá€¡á€œá€€á€ºá€¡á€€á€¼á€¬á€¸ á€á€»á€­á€á€ºá€†á€€á€ºá€™á€¾á€¯á€€á€­á€¯ á€•á€­á€¯á€›á€¾á€„á€ºá€¸á€…á€±á€•á€«',
      pronunciationFeedback: 'á€¡á€“á€­á€€á€…á€€á€¬á€¸á€œá€¯á€¶á€¸á€™á€»á€¬á€¸á€€á€­á€¯ á€‘á€„á€ºá€›á€¾á€¬á€¸á€…á€½á€¬ á€¡á€žá€¶á€‘á€½á€€á€ºá€•á€¼á€®á€¸ á€¡á€›á€¾á€­á€”á€ºá€€á€­á€¯ á€¡á€”á€Šá€ºá€¸á€„á€šá€ºá€œá€»á€¾á€±á€¬á€·á€•á€«',
    };
  }
  if (languageCode === 'id') {
    return {
      feedback: 'Jawaban Anda perlu contoh yang lebih konkret, struktur yang lebih rapi, dan dampak hasil yang terukur.',
      sampleResponse: 'Gunakan format STAR: Situasi, Tugas, Aksi, dan Hasil yang dapat diukur.',
      toneFeedback: 'Gunakan nada yang percaya diri, jelas, dan langsung ke inti.',
      grammarFeedback: 'Gunakan kalimat yang ringkas dan transisi yang lebih jelas.',
      pronunciationFeedback: 'Tekankan kata kunci dan kurangi filler agar lebih jelas.',
    };
  }
  if (languageCode === 'ms') {
    return {
      feedback: 'Jawapan anda perlukan contoh yang lebih konkrit, struktur yang lebih kemas, dan impak yang boleh diukur.',
      sampleResponse: 'Gunakan format STAR: Situasi, Tugas, Tindakan, dan Hasil yang boleh diukur.',
      toneFeedback: 'Gunakan nada yakin, jelas, dan terus kepada isi.',
      grammarFeedback: 'Gunakan ayat yang ringkas dengan peralihan yang jelas.',
      pronunciationFeedback: 'Tekankan kata kunci dan kurangkan filler untuk kejelasan.',
    };
  }
  if (languageCode === 'vi') {
    return {
      feedback: 'CÃ¢u tráº£ lá»i cá»§a báº¡n cáº§n vÃ­ dá»¥ cá»¥ thá»ƒ hÆ¡n, cáº¥u trÃºc rÃµ rÃ ng hÆ¡n vÃ  káº¿t quáº£ cÃ³ thá»ƒ Ä‘o lÆ°á»ng.',
      sampleResponse: 'HÃ£y dÃ¹ng cáº¥u trÃºc STAR: Bá»‘i cáº£nh, Nhiá»‡m vá»¥, HÃ nh Ä‘á»™ng, Káº¿t quáº£.',
      toneFeedback: 'Giá»¯ giá»ng Ä‘iá»‡u tá»± tin, trá»±c diá»‡n vÃ  chuyÃªn nghiá»‡p.',
      grammarFeedback: 'DÃ¹ng cÃ¢u ngáº¯n, máº¡ch láº¡c vÃ  liÃªn káº¿t Ã½ rÃµ hÆ¡n.',
      pronunciationFeedback: 'Nháº¥n máº¡nh tá»« khÃ³a quan trá»ng vÃ  giáº£m tá»« Ä‘á»‡m.',
    };
  }
  if (languageCode === 'tl') {
    return {
      feedback: 'Kailangan pang gawing mas konkreto ang mga halimbawa mo, mas malinaw ang istruktura, at mas masukat ang resulta.',
      sampleResponse: 'Gamitin ang STAR format: Sitwasyon, Tungkulin, Aksyon, Resulta.',
      toneFeedback: 'Panatilihing kumpiyansa, diretso, at propesyonal ang tono.',
      grammarFeedback: 'Gumamit ng maiikling pangungusap at mas malinaw na daloy ng ideya.',
      pronunciationFeedback: 'Idiing mabuti ang mahahalagang salita at bawasan ang fillers.',
    };
  }
  return {
    feedback: 'Your answer needs more concrete examples, structure, and stronger business impact.',
    sampleResponse: 'Use STAR format: Situation, Task, Action, Result. Quantify the result and connect it to role impact.',
    toneFeedback: 'Keep a confident, direct tone. Avoid apologetic wording and over-qualification.',
    grammarFeedback: 'Use shorter sentences and cleaner transitions. Avoid fragmented clauses.',
    pronunciationFeedback: 'Slow down key points and emphasize outcome words. Reduce filler sounds for clarity.',
  };
}

function normalizeInterviewFeedback(raw, questionId, targetLanguage = 'en-US') {
  const riskFlags = normalizeInterviewList(raw?.riskFlags || raw?.redFlags || [], 8, 140);
  const fallback = fallbackInterviewFeedbackByLanguage(targetLanguage);
  const fallbackFeedback = repairLikelyMojibakeText(String(fallback.feedback || '').trim()).slice(0, 2000);
  const fallbackSampleResponse = repairLikelyMojibakeText(String(fallback.sampleResponse || '').trim()).slice(0, 2200);
  const fallbackToneFeedback = repairLikelyMojibakeText(String(fallback.toneFeedback || '').trim()).slice(0, 800);
  const fallbackGrammarFeedback = repairLikelyMojibakeText(String(fallback.grammarFeedback || '').trim()).slice(0, 800);
  const fallbackPronunciationFeedback = repairLikelyMojibakeText(String(fallback.pronunciationFeedback || '').trim()).slice(0, 800);
  const feedback = repairLikelyMojibakeText(String(raw?.feedback || raw?.coaching || '').trim()).slice(0, 2000);
  const sampleResponse = repairLikelyMojibakeText(String(raw?.sampleResponse || raw?.exampleAnswer || '').trim()).slice(0, 2200);
  const toneFeedback = repairLikelyMojibakeText(String(raw?.toneFeedback || raw?.tone || '').trim()).slice(0, 800);
  const grammarFeedback = repairLikelyMojibakeText(String(raw?.grammarFeedback || raw?.grammar || '').trim()).slice(0, 800);
  const pronunciationFeedback = repairLikelyMojibakeText(String(raw?.pronunciationFeedback || raw?.pronunciation || '').trim()).slice(0, 800);
  const forceLocalizedFallback = shouldForceLocalizedTextFallback(
    `${feedback}\n${sampleResponse}\n${toneFeedback}\n${grammarFeedback}\n${pronunciationFeedback}`,
    targetLanguage
  );
  return {
    questionId: String(questionId || raw?.questionId || ''),
    feedback: forceLocalizedFallback ? fallbackFeedback : (feedback || fallbackFeedback),
    sampleResponse: forceLocalizedFallback ? fallbackSampleResponse : (sampleResponse || fallbackSampleResponse),
    toneFeedback: forceLocalizedFallback ? fallbackToneFeedback : (toneFeedback || fallbackToneFeedback),
    grammarFeedback: forceLocalizedFallback ? fallbackGrammarFeedback : (grammarFeedback || fallbackGrammarFeedback),
    pronunciationFeedback: forceLocalizedFallback ? fallbackPronunciationFeedback : (pronunciationFeedback || fallbackPronunciationFeedback),
    riskFlags,
    score: Math.max(1, Math.min(10, Number(raw?.score || 6))),
  };
}

function fallbackInterviewFinalReviewByLanguage(targetLanguage = 'en-US') {
  const languageCode = normalizeInterviewLanguageCode(targetLanguage);
  if (languageCode === 'th') {
    return {
      summary: 'à¸„à¸¸à¸“à¸¡à¸µà¸¨à¸±à¸à¸¢à¸ à¸²à¸ž à¹à¸•à¹ˆà¸„à¸³à¸•à¸­à¸šà¸¢à¸±à¸‡à¸•à¹‰à¸­à¸‡à¸¡à¸µà¸«à¸¥à¸±à¸à¸à¸²à¸™à¸Šà¸±à¸”à¹€à¸ˆà¸™ à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¸„à¸¡à¸‚à¸¶à¹‰à¸™ à¹à¸¥à¸°à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¹‚à¸¢à¸‡à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¸—à¸²à¸‡à¸˜à¸¸à¸£à¸à¸´à¸ˆà¸¡à¸²à¸à¸‚à¸¶à¹‰à¸™',
      strengths: ['à¸ªà¸·à¹ˆà¸­à¸ªà¸²à¸£à¹„à¸”à¹‰à¸Šà¸±à¸”à¹ƒà¸™à¸›à¸£à¸°à¹€à¸”à¹‡à¸™à¸«à¸¥à¸±à¸', 'à¸¡à¸µà¸„à¸§à¸²à¸¡à¸•à¸±à¹‰à¸‡à¹ƒà¸ˆà¹à¸¥à¸°à¸—à¸±à¸¨à¸™à¸„à¸•à¸´à¸—à¸µà¹ˆà¸”à¸µà¸•à¹ˆà¸­à¸à¸²à¸£à¸žà¸±à¸’à¸™à¸²'],
      improvements: ['à¹€à¸žà¸´à¹ˆà¸¡à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸—à¸µà¹ˆà¸§à¸±à¸”à¸œà¸¥à¹„à¸”à¹‰', 'à¸ˆà¸±à¸”à¸„à¸³à¸•à¸­à¸šà¸”à¹‰à¸§à¸¢à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡ STAR à¹ƒà¸«à¹‰à¸ªà¸¡à¹ˆà¸³à¹€à¸ªà¸¡à¸­'],
      hiringRiskNotes: [],
      nextSteps: ['à¸à¸¶à¸à¸•à¸­à¸š 5-8 à¸„à¸³à¸–à¸²à¸¡à¸«à¸¥à¸±à¸à¸žà¸£à¹‰à¸­à¸¡à¸•à¸±à¸§à¹€à¸¥à¸‚à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œ', 'à¸‹à¹‰à¸­à¸¡à¸•à¸­à¸šà¸”à¹‰à¸§à¸¢à¹€à¸§à¸¥à¸² 60-90 à¸§à¸´à¸™à¸²à¸—à¸µà¸•à¹ˆà¸­à¸„à¸³à¸–à¸²à¸¡'],
    };
  }
  if (languageCode === 'my') {
    return {
      summary: 'á€žá€„á€·á€ºá€™á€¾á€¬ á€¡á€œá€¬á€¸á€¡á€œá€¬á€€á€±á€¬á€„á€ºá€¸á€›á€¾á€­á€•á€±á€™á€šá€·á€º á€¡á€–á€¼á€±á€á€½á€±á€€á€­á€¯ á€žá€€á€ºá€žá€±á€á€­á€€á€»á€™á€¾á€¯áŠ á€–á€½á€²á€·á€…á€Šá€ºá€¸á€•á€¯á€¶á€”á€¾á€„á€·á€º á€œá€¯á€•á€ºá€„á€”á€ºá€¸á€›á€œá€’á€ºá€á€»á€­á€á€ºá€†á€€á€ºá€™á€¾á€¯ á€•á€­á€¯á€™á€­á€¯á€á€­á€¯á€¸á€á€€á€ºá€…á€±á€›á€”á€º á€œá€­á€¯á€¡á€•á€ºá€”á€±á€•á€«á€žá€Šá€º',
      strengths: ['á€¡á€“á€­á€€á€¡á€á€»á€€á€ºá€™á€»á€¬á€¸á€€á€­á€¯ á€›á€¾á€„á€ºá€¸á€œá€„á€ºá€¸á€…á€½á€¬ á€†á€€á€ºá€žá€½á€šá€ºá€”á€­á€¯á€„á€ºá€á€¼á€„á€ºá€¸', 'á€á€­á€¯á€¸á€á€€á€ºá€œá€­á€¯á€…á€­á€á€ºá€”á€¾á€„á€·á€º á€¡á€á€á€ºá€•á€Šá€¬á€†á€­á€¯á€„á€ºá€›á€¬ á€žá€˜á€±á€¬á€‘á€¬á€¸á€€á€±á€¬á€„á€ºá€¸á€›á€¾á€­á€á€¼á€„á€ºá€¸'],
      improvements: ['á€á€­á€¯á€„á€ºá€¸á€á€¬á€”á€­á€¯á€„á€ºá€žá€±á€¬ á€›á€œá€’á€ºá€¥á€•á€™á€¬á€™á€»á€¬á€¸ á€•á€­á€¯á€‘á€Šá€·á€ºá€›á€”á€º', 'á€™á€±á€¸á€á€½á€”á€ºá€¸á€á€­á€¯á€„á€ºá€¸á€¡á€á€½á€€á€º STAR á€–á€½á€²á€·á€…á€Šá€ºá€¸á€•á€¯á€¶á€€á€­á€¯ á€á€…á€ºá€žá€™á€á€ºá€á€Šá€ºá€¸ á€¡á€žá€¯á€¶á€¸á€•á€¼á€¯á€›á€”á€º'],
      hiringRiskNotes: [],
      nextSteps: ['á€¡á€“á€­á€€á€™á€±á€¸á€á€½á€”á€ºá€¸ 5-8 á€á€¯á€¡á€á€½á€€á€º á€›á€œá€’á€ºá€¡á€á€»á€€á€ºá€¡á€œá€€á€ºá€”á€²á€· á€¡á€œá€±á€·á€¡á€€á€»á€„á€·á€ºá€œá€¯á€•á€ºá€•á€«', 'á€™á€±á€¸á€á€½á€”á€ºá€¸á€á€…á€ºá€á€¯á€œá€»á€¾á€„á€º 60-90 á€…á€€á€¹á€€á€”á€·á€ºá€¡á€á€½á€„á€ºá€¸ á€–á€¼á€±á€†á€­á€¯á€œá€±á€·á€€á€»á€„á€·á€ºá€•á€«'],
    };
  }
  if (languageCode === 'id') {
    return {
      summary: 'Anda punya potensi, tetapi jawaban Anda masih perlu bukti yang lebih kuat, struktur yang lebih tajam, dan dampak bisnis yang lebih jelas.',
      strengths: ['Menyampaikan poin utama dengan cukup jelas', 'Menunjukkan sikap belajar dan berkembang'],
      improvements: ['Tambah contoh dengan hasil terukur', 'Gunakan struktur STAR secara konsisten'],
      hiringRiskNotes: [],
      nextSteps: ['Latih 5-8 jawaban inti dengan angka hasil yang konkret', 'Latihan menjawab 60-90 detik per pertanyaan'],
    };
  }
  if (languageCode === 'ms') {
    return {
      summary: 'Anda mempunyai potensi, namun jawapan anda masih memerlukan bukti yang lebih kukuh, struktur lebih tajam, dan impak perniagaan yang jelas.',
      strengths: ['Menyampaikan isi utama dengan agak jelas', 'Menunjukkan sikap mahu belajar dan berkembang'],
      improvements: ['Tambah contoh dengan hasil yang boleh diukur', 'Gunakan struktur STAR secara konsisten'],
      hiringRiskNotes: [],
      nextSteps: ['Latih 5-8 jawapan utama dengan angka hasil yang jelas', 'Berlatih menjawab 60-90 saat bagi setiap soalan'],
    };
  }
  if (languageCode === 'vi') {
    return {
      summary: 'Báº¡n cÃ³ tiá»m nÄƒng, nhÆ°ng cÃ¢u tráº£ lá»i váº«n cáº§n báº±ng chá»©ng cá»¥ thá»ƒ hÆ¡n, cáº¥u trÃºc sáº¯c nÃ©t hÆ¡n vÃ  tÃ¡c Ä‘á»™ng kinh doanh rÃµ rÃ ng hÆ¡n.',
      strengths: ['Truyá»n Ä‘áº¡t Ä‘Æ°á»£c Ã½ chÃ­nh khÃ¡ rÃµ', 'Thá»ƒ hiá»‡n tinh tháº§n há»c há»i vÃ  phÃ¡t triá»ƒn'],
      improvements: ['Bá»• sung vÃ­ dá»¥ cÃ³ sá»‘ liá»‡u Ä‘o lÆ°á»ng', 'DÃ¹ng cáº¥u trÃºc STAR nháº¥t quÃ¡n'],
      hiringRiskNotes: [],
      nextSteps: ['Luyá»‡n 5-8 cÃ¢u tráº£ lá»i cá»‘t lÃµi kÃ¨m sá»‘ liá»‡u káº¿t quáº£', 'Luyá»‡n tráº£ lá»i trong 60-90 giÃ¢y cho má»—i cÃ¢u há»i'],
    };
  }
  if (languageCode === 'tl') {
    return {
      summary: 'May potensyal ka, pero kailangan pang palakasin ang ebidensya, ayusin ang istruktura, at linawin ang business impact ng mga sagot mo.',
      strengths: ['Naipapaliwanag mo ang pangunahing punto', 'May malinaw kang growth mindset'],
      improvements: ['Magdagdag ng mas konkretong halimbawa na may sukat na resulta', 'Gamitin nang consistent ang STAR structure'],
      hiringRiskNotes: [],
      nextSteps: ['Sanayin ang 5-8 pangunahing sagot na may numerong resulta', 'Magpraktis ng 60-90 segundo kada tanong'],
    };
  }
  return {
    summary: 'You have potential, but your answers need more evidence, sharper structure, and stronger business framing.',
    strengths: [],
    improvements: [],
    hiringRiskNotes: [],
    nextSteps: [],
  };
}

function normalizeInterviewFinalReview(raw, targetLanguage = 'en-US') {
  const fallback = fallbackInterviewFinalReviewByLanguage(targetLanguage);
  const fallbackSummary = repairLikelyMojibakeText(String(fallback.summary || '').trim()).slice(0, 2200);
  const fallbackStrengths = normalizeInterviewList(fallback.strengths || [], 12, 220);
  const fallbackImprovements = normalizeInterviewList(fallback.improvements || [], 14, 220);
  const fallbackRiskNotes = normalizeInterviewList(fallback.hiringRiskNotes || [], 10, 220);
  const fallbackNextSteps = normalizeInterviewList(fallback.nextSteps || [], 12, 220);
  const summary = repairLikelyMojibakeText(String(raw?.summary || '').trim()).slice(0, 2200);
  const strengths = normalizeInterviewList(raw?.strengths || fallbackStrengths || [], 12, 220);
  const improvements = normalizeInterviewList(raw?.improvements || raw?.weaknesses || fallbackImprovements || [], 14, 220);
  const hiringRiskNotes = normalizeInterviewList(raw?.hiringRiskNotes || raw?.riskNotes || fallbackRiskNotes || [], 10, 220);
  const nextSteps = normalizeInterviewList(raw?.nextSteps || fallbackNextSteps || [], 12, 220);
  const forceLocalizedFallback = shouldForceLocalizedTextFallback(
    [summary, ...strengths, ...improvements, ...hiringRiskNotes, ...nextSteps].join('\n'),
    targetLanguage
  );
  return {
    summary: forceLocalizedFallback ? fallbackSummary : (summary || fallbackSummary),
    strengths: forceLocalizedFallback ? fallbackStrengths : strengths,
    improvements: forceLocalizedFallback ? fallbackImprovements : improvements,
    hiringRiskNotes: forceLocalizedFallback ? fallbackRiskNotes : hiringRiskNotes,
    nextSteps: forceLocalizedFallback ? fallbackNextSteps : nextSteps,
  };
}

function fallbackStepContent(type, stepTitle, moduleTitle, yt, reason = 'provider_unavailable') {
  const topic = String(stepTitle || moduleTitle || 'this topic').trim() || 'this topic';
  const moduleName = String(moduleTitle || 'this module').trim() || 'this module';
  const localFallbackIntro = `We generated this lesson locally while AI generation is recovering.`;
  const localFallbackTips = `- This is still usable learning content for "${topic}".\n- You can keep learning now and optionally regenerate later.\n- Focus on the examples and quick practice below.`;

  const withFallbackMeta = (payload) => ({
    ...payload,
    data: {
      ...(payload?.data || {}),
      references: mergeReferences(
        payload?.data?.references,
        supplementalReferencesForTopic(`${moduleTitle} ${stepTitle}`)
      ),
      generationFallback: true,
      generationFallbackReason: String(reason || 'provider_unavailable'),
    },
  });
  const programmingTrack = isProgrammingTopic(moduleTitle, stepTitle);

  if (type === 'TEXT') {
    return withFallbackMeta(validateStepContent('TEXT', {
      type: 'TEXT',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        content: `### ${topic}\n- **What it is:** ${topic} is a core part of ${moduleName}.\n- **Why it matters:** Understanding ${topic} helps you solve practical tasks with confidence.\n- **How to apply it:** Explain the concept in your own words, then write one real-world example.\n\n### Quick practice\n1. Define ${topic} in one sentence.\n2. List one common mistake and how to avoid it.\n3. Describe one situation where ${topic} is useful.\n\n${localFallbackTips}`
      }
    }));
  }

  if (type === 'ACCORDION') {
    return withFallbackMeta(validateStepContent('ACCORDION', {
      type: 'ACCORDION',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        items: [
          {
            title: `Core idea of ${topic}`,
            content: `${topic} focuses on the key principles learners need first before advanced practice.`
          },
          {
            title: `How ${topic} works in practice`,
            content: `In ${moduleName}, you apply ${topic} by connecting concept -> example -> action.`
          },
          {
            title: `Common pitfalls`,
            content: `Avoid memorizing only definitions. Always pair ${topic} with a concrete scenario and outcome.`
          }
        ]
      }
    }));
  }

  if (type === 'LEARNING_CARD') {
    return withFallbackMeta(validateStepContent('LEARNING_CARD', {
      type: 'LEARNING_CARD',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        learningCards: [
          {
            title: `${topic}: Foundation`,
            content: `${topic} introduces the base knowledge needed for the rest of ${moduleName}.`,
            layout: 'vertical'
          },
          {
            title: `${topic}: Application`,
            content: `Use ${topic} to analyze one real example and explain your reasoning step by step.`,
            layout: 'split'
          },
          {
            title: `${topic}: Reflection`,
            content: `Ask yourself: what changed in my understanding of ${topic} after this lesson?`,
            layout: 'overlay'
          }
        ]
      }
    }));
  }

  if (type === 'FLIP_CARD') {
    return withFallbackMeta(validateStepContent('FLIP_CARD', {
      type: 'FLIP_CARD',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        cards: [
          { front: `${topic} Definition`, back: `${topic} is a key concept in ${moduleName} used to build practical understanding.` },
          { front: `${topic} Purpose`, back: `The purpose is to help learners connect theory to real actions and decisions.` },
          { front: `${topic} Example`, back: `Example: explain ${topic} to a beginner using one simple real-world case.` },
          { front: `${topic} Pitfall`, back: `Pitfall: focusing on terms only without applying them to context.` },
        ]
      }
    }));
  }

  if (type === 'QUIZ') {
    const fallbackQuizCount = isFinalModuleQuizTitle(stepTitle) ? 20 : 4;
    return withFallbackMeta(validateStepContent('QUIZ', {
      type: 'QUIZ',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        questions: buildFallbackQuizQuestions(topic, fallbackQuizCount),
      }
    }));
  }

  if (type === 'VIDEO') {
    const safeVideo = yt || curatedVideo(`${moduleTitle} ${stepTitle}`);
    if (!safeVideo) {
      return withFallbackMeta(validateStepContent('TEXT', {
        type: 'TEXT',
        title: stepTitle,
        lessonText: localFallbackIntro,
        data: {
          content: `### ${topic}\n- Focus on the main idea of ${topic}.\n- List two practical examples from ${moduleName}.\n- Explain one challenge and one solution.\n\n${localFallbackTips}`,
        }
      }));
    }
    return withFallbackMeta(validateStepContent('VIDEO', {
      type: 'VIDEO',
      title: stepTitle,
      lessonText: 'Watch this short lesson, then summarize the key takeaways.',
      data: {
        videoUrl: safeVideo.videoUrl,
        videoWebUrl: safeVideo.videoWebUrl,
        videoTitle: safeVideo.videoTitle,
        content: '- Focus on the main idea.\n- Note 2 practical examples.\n- Rewatch difficult parts.',
      }
    }));
  }

  if (type === 'CODE_BUILDER') {
    if (!programmingTrack) {
      return withFallbackMeta(validateStepContent('DRAG_FILL', {
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
      }));
    }

    return withFallbackMeta(validateStepContent('CODE_BUILDER', {
      type: 'CODE_BUILDER',
      title: stepTitle,
      lessonText: 'Complete each blank with the best matching code token.',
      data: {
        codeBuilder: {
          avatarInstruction: 'Follow each mini-goal and choose the token that makes the line true.',
          goal: 'Complete each mini-goal: print 10, set buyer to "Bob", increase player score by 8, and set drink to "water".',
          expectedOutput: '10 | Bob bought 2 tickets | score +8 | water',
          lines: [
            { content: 'print(___)  # target: 10', correctValue: '10' },
            { content: 'receipt = ___ + " bought 2 tickets"', correctValue: '"Bob"' },
            { content: 'player_score = player_score + ___', correctValue: '8' },
            { content: 'drink = ___', correctValue: '"water"' },
          ],
          options: ['10', '"Bob"', '8', '"water"', '2', '"Alice"', 'None', 'False']
        }
      }
    }));
  }

  if (type === 'DRAG_FILL') {
    return withFallbackMeta(validateStepContent('DRAG_FILL', {
      type: 'DRAG_FILL',
      title: stepTitle,
      lessonText: localFallbackIntro,
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
    }));
  }

  if (type === 'POP_CARD') {
    return withFallbackMeta(validateStepContent('POP_CARD', {
      type: 'POP_CARD',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        cards: [
          { title: `${topic}: Why it matters`, content: `Understand why ${topic} is important in ${moduleName}.`, icon: 'Target', imageUrl: '' },
          { title: `${topic}: Real example`, content: `Review one practical scenario where ${topic} creates measurable impact.`, icon: 'Lightbulb', imageUrl: '' },
          { title: `${topic}: Next action`, content: `Choose one specific action to apply ${topic} in your next task.`, icon: 'Rocket', imageUrl: '' },
        ]
      }
    }));
  }

  if (type === 'HOTSPOT') {
    return withFallbackMeta(validateStepContent('HOTSPOT', {
      type: 'HOTSPOT',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        image: '',
        points: [
          { title: `${topic} Core`, content: `Identify the central idea in ${topic}.`, icon: 'target' },
          { title: `${topic} Context`, content: `Explain where ${topic} appears in real situations.`, icon: 'map' },
          { title: `${topic} Action`, content: `Choose one concrete action to apply ${topic} today.`, icon: 'play' },
        ]
      }
    }));
  }

  if (type === 'CAROUSEL') {
    return withFallbackMeta(validateStepContent('CAROUSEL', {
      type: 'CAROUSEL',
      title: stepTitle,
      lessonText: localFallbackIntro,
      data: {
        slides: [
          { title: `${topic}: Big Picture`, content: `Understand what ${topic} is and why it matters in ${moduleName}.` },
          { title: `${topic}: Example`, content: `Walk through one practical scenario where ${topic} is applied.` },
          { title: `${topic}: Next Step`, content: `Summarize your takeaway and define one immediate practice task.` },
        ]
      }
    }));
  }

  return withFallbackMeta(validateStepContent('TEXT', {
    type: 'TEXT',
    title: stepTitle,
    lessonText: localFallbackIntro,
    data: {
      content: `### ${topic}\n- Review the key concept.\n- Connect it to one practical example.\n- Complete one quick self-check.\n\n${localFallbackTips}`
    }
  }));
}

// ------------------------ API handlers ------------------------

async function handleApi(req, res, pathname) {
  const requestUrl = new URL(req.url || pathname || '/api/config', 'http://localhost');
  const query = requestUrl.searchParams;
  const db = loadAppDb();

  if (req.method === 'GET' && pathname === '/api/config') {
    const configuredProviders = providerCandidates();
    const providers = configuredProviders.map(p => ({
      id: p,
      available: providerAvailable(p),
      defaultModels: modelCandidatesFor(p)
    }));
    return sendJson(res, 200, {
      providers,
      providerCandidates: configuredProviders.filter(providerAvailable),
    });
  }

  if (req.method === 'GET' && pathname === '/api/auth/config') {
    return sendJson(res, 200, {
      ok: true,
      data: {
        enabled: supabaseAuthEnabled(),
        dbEnabled: supabaseDbEnabled(),
        emailVerificationRequired: !SUPABASE_DISABLE_EMAIL_VERIFICATION,
      },
    });
  }

  if (req.method === 'GET' && pathname === '/api/profile/me') {
    const accountId = String(query.get('accountId') || '').trim();
    if (supabaseDbEnabled() && isUuid(accountId)) {
      const [row, cvRow] = await Promise.all([
        fetchSupabaseProfileRowById(accountId),
        fetchSupabaseCvRowByUserId(accountId),
      ]);
      if (row) {
        return sendJson(res, 200, {
          ok: true,
          data: {
            id: String(row.id || ''),
            email: String(row.email || ''),
            userSegment: String(row.user_segment || 'youth'),
            connectivityLevel: String(row.connectivity_level || 'normal'),
            learningGoal: String(row.learning_goal || ''),
            preferredLanguage: String(row.preferred_language || 'en'),
            region: String(row.region || 'ASEAN'),
            deviceClass: String(row.device_class || 'unknown'),
            lowBandwidthMode: !!row.low_bandwidth_mode,
            professionalVisibility: normalizeProfessionalVisibility(row.professional_visibility),
            cvRequiredFormat: 'other',
            cvValidated: !!cvRow?.valid,
            cvFileName: String(cvRow?.file_name || ''),
            cvUpdatedAt: String(cvRow?.updated_at || cvRow?.created_at || ''),
            createdAt: row.created_at || nowIso(),
            updatedAt: row.updated_at || nowIso(),
          },
        });
      }
    }
    const profile = db.profiles.find((p) => p.id === accountId) || null;
    if (!profile) {
      return sendJson(res, 200, { ok: true, data: null });
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        ...profile,
        professionalVisibility: normalizeProfessionalVisibility(profile?.professionalVisibility || profile?.professional_visibility),
      },
    });
  }

  if (req.method === 'GET' && pathname === '/api/profile/cv') {
    const accountId = String(query.get('accountId') || '').trim();
    if (supabaseDbEnabled() && isUuid(accountId)) {
      const params = new URLSearchParams();
      params.set('select', 'user_id,valid,format,confidence,file_name,mime_type,issues,parsed,updated_at,created_at');
      params.set('user_id', `eq.${accountId}`);
      params.set('limit', '1');
      const r = await supabaseRestRequest(`profile_cv?${params.toString()}`, { method: 'GET' });
      if (r.ok && Array.isArray(r.json) && r.json[0]) {
        const row = r.json[0];
        const normalized = normalizeCvAnalysisResult({
          valid: !!row.valid,
          format: String(row.format || 'unknown'),
          confidence: Number(row.confidence || 0),
          fileName: String(row.file_name || ''),
          mimeType: String(row.mime_type || ''),
          issues: Array.isArray(row.issues) ? row.issues : [],
          parsed: row.parsed && typeof row.parsed === 'object' ? row.parsed : {},
          updatedAt: row.updated_at || row.created_at || nowIso(),
        }, {});
        return sendJson(res, 200, { ok: true, data: normalized });
      }
    }
    const row = (Array.isArray(db.cvProfiles) ? db.cvProfiles : []).find((entry) => entry.userId === accountId) || null;
    if (!row) return sendJson(res, 200, { ok: true, data: null });
    return sendJson(res, 200, { ok: true, data: normalizeCvAnalysisResult(row, row) });
  }

  if (req.method === 'GET' && pathname === '/api/impact/summary') {
    const accountId = String(query.get('accountId') || '').trim();
    const courseId = String(query.get('courseId') || '').trim();
    if (supabaseDbEnabled() && isUuid(accountId)) {
      const buildParams = (select) => {
        const p = new URLSearchParams();
        p.set('select', select);
        p.set('user_id', `eq.${accountId}`);
        if (courseId && isUuid(courseId)) p.set('course_id', `eq.${courseId}`);
        return p;
      };

      const [assessmentResp, confidenceResp, eventResp] = await Promise.all([
        supabaseRestRequest(`assessment_attempts?${buildParams('phase,score_pct').toString()}`, { method: 'GET' }),
        supabaseRestRequest(`confidence_surveys?${buildParams('phase,score').toString()}`, { method: 'GET' }),
        supabaseRestRequest(`progress_events?${buildParams('event_type,course_id,created_at,payload').toString()}`, { method: 'GET' }),
      ]);

      if (assessmentResp.ok && confidenceResp.ok && eventResp.ok) {
        const attempts = Array.isArray(assessmentResp.json) ? assessmentResp.json : [];
        const confidenceRows = Array.isArray(confidenceResp.json) ? confidenceResp.json : [];
        const events = (Array.isArray(eventResp.json) ? eventResp.json : []).map((row) => ({
          type: String(row?.event_type || ''),
          courseId: String(row?.course_id || ''),
          date: String(row?.created_at || ''),
          payload: row?.payload && typeof row.payload === 'object' ? row.payload : {},
          accountId,
        }));

        const pretests = attempts.filter((x) => String(x?.phase || '') === 'pre');
        const posttests = attempts.filter((x) => String(x?.phase || '') === 'post');
        const conf = confidenceRows.map((x) => ({
          phase: String(x?.phase || ''),
          score: Number(x?.score || 0),
        }));

        const avg = (arr) => arr.length ? (arr.reduce((acc, n) => acc + Number(n || 0), 0) / arr.length) : 0;
        const preAvg = avg(pretests.map((x) => safePercent(x?.score_pct)));
        const postAvg = avg(posttests.map((x) => safePercent(x?.score_pct)));
        const hasPreAssessment = pretests.length > 0;
        const hasPostAssessment = posttests.length > 0;

        const preConfRows = conf.filter((x) => x.phase === 'pre' && Number.isFinite(Number(x.score)));
        const postConfRows = conf.filter((x) => x.phase === 'post' && Number.isFinite(Number(x.score)));
        const preConf = avg(preConfRows.map((x) => Number(x.score || 0)));
        const postConf = avg(postConfRows.map((x) => Number(x.score || 0)));

        const started = events.filter((e) => e.type === 'course_started').length;
        const completed = events.filter((e) => e.type === 'course_completed').length;
        const eventCompletionRate = started ? Math.round((completed / started) * 100) : 0;
        const payloadCompletionValues = events
          .map((e) => Number(e?.payload?.completionRate))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.max(0, Math.min(100, Number(value))));
        const payloadCompletionRate = payloadCompletionValues.length
          ? Math.round(Math.max(...payloadCompletionValues))
          : 0;
        const completionRate = Math.max(eventCompletionRate, payloadCompletionRate);

        const activeDays = new Set(events.filter((e) => e.type === 'daily_active').map((e) => String(e.date || '').slice(0, 10))).size;
        const usersReached = events.length ? 1 : 0;

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
          skillGainPp: (hasPreAssessment && hasPostAssessment)
            ? (Math.round((postAvg - preAvg) * 10) / 10)
            : 0,
          confidenceGain: (preConfRows.length && postConfRows.length)
            ? (Math.round((postConf - preConf) * 10) / 10)
            : 0,
          completionRate,
          avgTimeToCompletionMins,
          d7Retention: activeDays >= 7 ? 1 : (activeDays > 0 ? Math.round((activeDays / 7) * 100) / 100 : 0),
        };
        return sendJson(res, 200, { ok: true, data: dashboard });
      }
    }
    const pretests = db.pretests.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const posttests = db.posttests.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const conf = db.confidence.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));
    const events = db.events.filter((x) => x.accountId === accountId && (!courseId || x.courseId === courseId));

    const avg = (arr) => arr.length ? (arr.reduce((acc, n) => acc + Number(n || 0), 0) / arr.length) : 0;
    const preAvg = avg(pretests.map((x) => safePercent(x.scorePct)));
    const postAvg = avg(posttests.map((x) => safePercent(x.scorePct)));
    const hasPreAssessment = pretests.length > 0;
    const hasPostAssessment = posttests.length > 0;

    const preConfRows = conf.filter((x) => x.phase === 'pre' && Number.isFinite(Number(x.score)));
    const postConfRows = conf.filter((x) => x.phase === 'post' && Number.isFinite(Number(x.score)));
    const preConf = avg(preConfRows.map((x) => Number(x.score || 0)));
    const postConf = avg(postConfRows.map((x) => Number(x.score || 0)));

    const started = events.filter((e) => e.type === 'course_started').length;
    const completed = events.filter((e) => e.type === 'course_completed').length;
    const eventCompletionRate = started ? Math.round((completed / started) * 100) : 0;
    const payloadCompletionValues = events
      .map((e) => Number(e?.payload?.completionRate))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.max(0, Math.min(100, Number(value))));
    const payloadCompletionRate = payloadCompletionValues.length
      ? Math.round(Math.max(...payloadCompletionValues))
      : 0;
    const completionRate = Math.max(eventCompletionRate, payloadCompletionRate);

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
      skillGainPp: (hasPreAssessment && hasPostAssessment)
        ? (Math.round((postAvg - preAvg) * 10) / 10)
        : 0,
      confidenceGain: (preConfRows.length && postConfRows.length)
        ? (Math.round((postConf - preConf) * 10) / 10)
        : 0,
      completionRate,
      avgTimeToCompletionMins,
      d7Retention: activeDays >= 7 ? 1 : (activeDays > 0 ? Math.round((activeDays / 7) * 100) / 100 : 0),
    };
    return sendJson(res, 200, { ok: true, data: dashboard });
  }

  if (req.method === 'GET' && pathname === '/api/impact/courses') {
    const accountId = String(query.get('accountId') || '').trim();
    const avg = (arr) => arr.length ? (arr.reduce((acc, n) => acc + Number(n || 0), 0) / arr.length) : 0;
    const buildCourseMetrics = (pretests, posttests, conf, events) => {
      const preAvg = avg((pretests || []).map((x) => safePercent(x?.scorePct ?? x?.score_pct)));
      const postAvg = avg((posttests || []).map((x) => safePercent(x?.scorePct ?? x?.score_pct)));
      const hasPreAssessment = (pretests || []).length > 0;
      const hasPostAssessment = (posttests || []).length > 0;
      const preConfRows = (conf || []).filter((x) =>
        String(x?.phase || '') === 'pre' && Number.isFinite(Number(x?.score))
      );
      const postConfRows = (conf || []).filter((x) =>
        String(x?.phase || '') === 'post' && Number.isFinite(Number(x?.score))
      );
      const preConf = avg(preConfRows.map((x) => Number(x?.score || 0)));
      const postConf = avg(postConfRows.map((x) => Number(x?.score || 0)));
      const started = (events || []).filter((e) => e.type === 'course_started').length;
      const completed = (events || []).filter((e) => e.type === 'course_completed').length;
      const eventCompletionRate = started ? Math.round((completed / started) * 100) : 0;
      const payloadCompletionValues = (events || [])
        .map((e) => Number(e?.payload?.completionRate))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(0, Math.min(100, Number(value))));
      const payloadCompletionRate = payloadCompletionValues.length
        ? Math.round(Math.max(...payloadCompletionValues))
        : 0;
      const completionRate = Math.max(eventCompletionRate, payloadCompletionRate);

      const startsByCourse = new Map();
      for (const e of events || []) {
        if (e.type !== 'course_started') continue;
        const courseKey = String(e.courseId || '');
        const at = Date.parse(String(e.date || ''));
        if (!Number.isFinite(at)) continue;
        const prev = startsByCourse.get(courseKey);
        if (prev === undefined || at < prev) startsByCourse.set(courseKey, at);
      }
      let completionSamples = 0;
      let completionMinutesTotal = 0;
      for (const e of events || []) {
        if (e.type !== 'course_completed') continue;
        const courseKey = String(e.courseId || '');
        const startAt = startsByCourse.get(courseKey);
        const doneAt = Date.parse(String(e.date || ''));
        if (!Number.isFinite(startAt) || !Number.isFinite(doneAt) || doneAt < startAt) continue;
        completionSamples += 1;
        completionMinutesTotal += Math.round((doneAt - startAt) / 60000);
      }
      const avgTimeToCompletionMins = completionSamples ? Math.round(completionMinutesTotal / completionSamples) : 0;
      const activeDays = new Set((events || []).filter((e) => e.type === 'daily_active').map((e) => String(e.date || '').slice(0, 10))).size;
      return {
        usersReached: (events || []).length ? 1 : 0,
        skillGainPp: (hasPreAssessment && hasPostAssessment)
          ? (Math.round((postAvg - preAvg) * 10) / 10)
          : 0,
        confidenceGain: (preConfRows.length && postConfRows.length)
          ? (Math.round((postConf - preConf) * 10) / 10)
          : 0,
        completionRate,
        avgTimeToCompletionMins,
        d7Retention: activeDays >= 7 ? 1 : (activeDays > 0 ? Math.round((activeDays / 7) * 100) / 100 : 0),
      };
    };

    if (supabaseDbEnabled() && isUuid(accountId)) {
      const eventParams = new URLSearchParams();
      eventParams.set('select', 'course_id,event_type,created_at,payload');
      eventParams.set('user_id', `eq.${accountId}`);
      const eventResp = await supabaseRestRequest(`progress_events?${eventParams.toString()}`, { method: 'GET' });
      if (eventResp.ok && Array.isArray(eventResp.json)) {
        const events = eventResp.json.map((row) => ({
          type: String(row?.event_type || ''),
          courseId: String(row?.course_id || ''),
          date: String(row?.created_at || ''),
          payload: row?.payload && typeof row.payload === 'object' ? row.payload : {},
        }));
        const courseIds = Array.from(new Set(events.map((row) => String(row.courseId || '').trim()).filter(Boolean)));
        if (!courseIds.length) return sendJson(res, 200, { ok: true, data: [] });

        const uuidCourseIds = courseIds.filter(isUuid);
        const buildMetricParams = (select) => {
          const p = new URLSearchParams();
          p.set('select', select);
          p.set('user_id', `eq.${accountId}`);
          if (uuidCourseIds.length) p.set('course_id', buildInFilter(uuidCourseIds));
          return p;
        };
        const [assessmentResp, confidenceResp] = await Promise.all([
          supabaseRestRequest(`assessment_attempts?${buildMetricParams('course_id,phase,score_pct').toString()}`, { method: 'GET' }),
          supabaseRestRequest(`confidence_surveys?${buildMetricParams('course_id,phase,score').toString()}`, { method: 'GET' }),
        ]);
        const attempts = assessmentResp.ok && Array.isArray(assessmentResp.json) ? assessmentResp.json : [];
        const confidenceRows = confidenceResp.ok && Array.isArray(confidenceResp.json) ? confidenceResp.json : [];
        const courseMeta = new Map();
        if (uuidCourseIds.length) {
          const courseParams = new URLSearchParams();
          courseParams.set('select', 'id,owner_id,title,description,visibility');
          courseParams.set('id', buildInFilter(uuidCourseIds));
          const coursesResp = await supabaseRestRequest(`courses?${courseParams.toString()}`, { method: 'GET' });
          if (coursesResp.ok && Array.isArray(coursesResp.json)) {
            for (const row of coursesResp.json) {
              const id = String(row?.id || '');
              if (!id) continue;
              courseMeta.set(id, {
                ownerId: String(row?.owner_id || ''),
                title: String(row?.title || ''),
                description: String(row?.description || ''),
                visibility: normalizeVisibility(row?.visibility),
              });
            }
          }
          const postParams = new URLSearchParams();
          postParams.set('select', 'course_id,owner_id,title,description');
          postParams.set('course_id', buildInFilter(uuidCourseIds));
          const postsResp = await supabaseRestRequest(`course_public_posts?${postParams.toString()}`, { method: 'GET' });
          if (postsResp.ok && Array.isArray(postsResp.json)) {
            for (const row of postsResp.json) {
              const id = String(row?.course_id || '');
              if (!id || courseMeta.has(id)) continue;
              courseMeta.set(id, {
                ownerId: String(row?.owner_id || ''),
                title: String(row?.title || ''),
                description: String(row?.description || ''),
                visibility: 'public',
              });
            }
          }
        }

        const rows = courseIds.map((courseId) => {
          const courseEvents = events.filter((e) => String(e.courseId || '') === courseId);
          const pretests = attempts.filter((x) => String(x?.course_id || '') === courseId && String(x?.phase || '') === 'pre');
          const posttests = attempts.filter((x) => String(x?.course_id || '') === courseId && String(x?.phase || '') === 'post');
          const conf = confidenceRows.filter((x) => String(x?.course_id || '') === courseId);
          const metrics = buildCourseMetrics(pretests, posttests, conf.map((x) => ({ phase: x?.phase, score: x?.score })), courseEvents);
          const meta = courseMeta.get(courseId) || {};
          const startedAt = courseEvents
            .filter((e) => e.type === 'course_started')
            .map((e) => String(e.date || ''))
            .sort()[0] || '';
          const lastActiveAt = courseEvents
            .map((e) => String(e.date || ''))
            .sort()
            .slice(-1)[0] || '';
          const payloadTitle = courseEvents.find((e) => String(e?.payload?.courseTitle || '').trim())?.payload?.courseTitle || '';
          const payloadDescription = courseEvents.find((e) => String(e?.payload?.courseDescription || '').trim())?.payload?.courseDescription || '';
          return {
            courseId,
            ownerId: String(meta.ownerId || ''),
            title: truncateText(String(meta.title || payloadTitle || courseId), 180),
            description: truncateText(String(meta.description || payloadDescription || ''), 400),
            visibility: normalizeVisibility(meta.visibility || 'public'),
            startedAt,
            lastActiveAt,
            metrics,
          };
        }).sort((a, b) => String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || '')));
        return sendJson(res, 200, { ok: true, data: rows });
      }
    }

    const userEvents = db.events.filter((e) => String(e?.accountId || '') === accountId);
    const courseIds = Array.from(new Set(userEvents.map((e) => String(e?.courseId || '').trim()).filter(Boolean)));
    const postByCourse = new Map();
    for (const post of db.publicPosts || []) {
      const courseId = String(post?.courseId || '').trim();
      if (!courseId || postByCourse.has(courseId)) continue;
      postByCourse.set(courseId, post);
    }
    const rows = courseIds.map((courseId) => {
      const events = userEvents.filter((e) => String(e?.courseId || '') === courseId).map((e) => ({
        type: String(e?.type || ''),
        courseId,
        date: String(e?.date || ''),
        payload: e?.payload && typeof e.payload === 'object' ? e.payload : {},
      }));
      const pretests = db.pretests.filter((x) => String(x?.accountId || '') === accountId && String(x?.courseId || '') === courseId && x?.scorePct !== undefined);
      const posttests = db.posttests.filter((x) => String(x?.accountId || '') === accountId && String(x?.courseId || '') === courseId && x?.scorePct !== undefined);
      const conf = db.confidence.filter((x) => String(x?.accountId || '') === accountId && String(x?.courseId || '') === courseId);
      const metrics = buildCourseMetrics(pretests, posttests, conf, events);
      const post = postByCourse.get(courseId) || null;
      const startedAt = events.filter((e) => e.type === 'course_started').map((e) => String(e.date || '')).sort()[0] || '';
      const lastActiveAt = events.map((e) => String(e.date || '')).sort().slice(-1)[0] || '';
      const payloadTitle = events.find((e) => String(e?.payload?.courseTitle || '').trim())?.payload?.courseTitle || '';
      const payloadDescription = events.find((e) => String(e?.payload?.courseDescription || '').trim())?.payload?.courseDescription || '';
      return {
        courseId,
        ownerId: String(post?.ownerId || ''),
        title: truncateText(String(post?.title || payloadTitle || courseId), 180),
        description: truncateText(String(post?.description || payloadDescription || ''), 400),
        visibility: normalizeVisibility(post?.visibility || 'public'),
        startedAt,
        lastActiveAt,
        metrics,
      };
    }).sort((a, b) => String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || '')));
    return sendJson(res, 200, { ok: true, data: rows });
  }

  if (req.method === 'GET' && pathname === '/api/public/feed') {
    const viewerId = String(query.get('accountId') || '').trim();
    if (supabaseDbEnabled()) {
      try {
        const feed = await listSupabasePublicPosts({ publicOnly: true, viewerId });
        return sendJson(res, 200, { ok: true, data: feed });
      } catch (e) {
        // fallback to local DB
      }
    }
    const feed = db.publicPosts
      .filter((p) => p.visibility === 'public')
      .sort((a, b) => {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      })
      .map((post) => withLocalPostCounts(post, db, viewerId));
    return sendJson(res, 200, { ok: true, data: feed });
  }

  const publicCourseMatch = pathname.match(/^\/api\/public\/course\/([^/]+)$/);
  if (req.method === 'GET' && publicCourseMatch) {
    const courseId = decodeURIComponent(publicCourseMatch[1]);
    const viewerId = String(query.get('accountId') || '').trim();
    if (supabaseDbEnabled() && isUuid(courseId)) {
      try {
        const fetchBy = async (mode) => {
          const params = new URLSearchParams();
          params.set('select', 'id,course_id,owner_id,title,description,language,segment,moderation_status,created_at,courses!inner(visibility,moderation_status)');
          params.set('course_id', `eq.${courseId}`);
          params.set('moderation_status', 'neq.hidden');
          params.set('limit', '1');
          if (mode === 'public') {
            params.set('courses.visibility', 'eq.public');
          } else if (mode === 'owner' && isUuid(viewerId)) {
            params.set('owner_id', `eq.${viewerId}`);
          }
          return await supabaseRestRequest(`course_public_posts?${params.toString()}`, { method: 'GET' });
        };

        let r = await fetchBy('public');
        if ((!r.ok || !Array.isArray(r.json) || !r.json[0]) && isUuid(viewerId)) {
          r = await fetchBy('owner');
        }
        if (r.ok && Array.isArray(r.json) && r.json[0]) {
          const row = r.json[0];
          const postId = String(row?.id || '');
          const [counts, snapshotsByCourse] = await Promise.all([
            fetchSupabasePostCounts(postId ? [postId] : [], viewerId),
            fetchSupabaseLatestSnapshotsByCourseIds([courseId]),
          ]);
          const post = toPostPublicShape(row, snapshotsByCourse, counts);
          return sendJson(res, 200, { ok: true, data: post });
        }
      } catch (e) {
        // fallback to local DB
      }
    }
    const post = db.publicPosts.find((p) => (
      p.courseId === courseId
      && p.moderationStatus !== 'hidden'
      && (
        p.visibility === 'public'
        || (viewerId && String(p.ownerId || '') === String(viewerId || ''))
      )
    )) || null;
    if (!post) return sendJson(res, 404, { error: 'course not found' });
    return sendJson(res, 200, { ok: true, data: withLocalPostCounts(post, db, viewerId) });
  }

  const publicCommentsMatch = pathname.match(/^\/api\/public\/([^/]+)\/comments$/);
  if (req.method === 'GET' && publicCommentsMatch) {
    const postId = decodeURIComponent(publicCommentsMatch[1]);
    if (supabaseDbEnabled() && isUuid(postId)) {
      const params = new URLSearchParams();
      params.set('select', 'id,user_id,comment,created_at,moderation_status');
      params.set('post_id', `eq.${postId}`);
      params.set('moderation_status', 'neq.hidden');
      params.set('order', 'created_at.desc');
      params.set('limit', '20');
      const r = await supabaseRestRequest(`course_comments?${params.toString()}`, { method: 'GET' });
      if (r.ok && Array.isArray(r.json)) {
        const comments = r.json.map((row) => ({
          id: String(row?.id || ''),
          accountId: String(row?.user_id || ''),
          text: String(row?.comment || ''),
          createdAt: String(row?.created_at || nowIso()),
        }));
        return sendJson(res, 200, { ok: true, data: comments });
      }
    }
    const comments = db.comments
      .filter((c) => c.postId === postId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 20);
    return sendJson(res, 200, { ok: true, data: comments });
  }

  if (req.method === 'GET' && pathname === '/api/courses/my') {
    const accountId = String(query.get('accountId') || '').trim();
    if (supabaseDbEnabled() && isUuid(accountId)) {
      try {
        const ownedPosts = await listSupabasePublicPosts({ ownerId: accountId, viewerId: accountId });
        return sendJson(res, 200, { ok: true, data: ownedPosts });
      } catch (e) {
        // fallback to local DB
      }
    }
    const ownedPosts = db.publicPosts
      .filter((p) => p.ownerId === accountId)
      .map((post) => withLocalPostCounts(post, db, accountId));
    return sendJson(res, 200, { ok: true, data: ownedPosts });
  }

  const creatorProfileMatch = pathname.match(/^\/api\/public\/creator\/([^/]+)$/);
  if (req.method === 'GET' && creatorProfileMatch) {
    const creatorId = decodeURIComponent(creatorProfileMatch[1]);
    const viewerId = String(query.get('viewerId') || '').trim();

    if (supabaseDbEnabled() && isUuid(creatorId)) {
      try {
        const payload = await buildSupabaseCreatorPublicProfile(creatorId, viewerId);
        if (payload) return sendJson(res, 200, { ok: true, data: payload });
      } catch (e) {
        // fallback to local DB
      }
    }

    const profile = db.profiles.find((p) => String(p?.id || '') === creatorId) || null;
    const cvRow = (Array.isArray(db.cvProfiles) ? db.cvProfiles : []).find((row) => String(row?.userId || '') === creatorId) || null;
    const courses = db.publicPosts
      .filter((p) => (
        String(p?.ownerId || '') === creatorId
        && String(p?.visibility || 'private') === 'public'
        && String(p?.moderationStatus || 'clean') !== 'hidden'
      ))
      .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))
      .map((post) => withLocalPostCounts(post, db, viewerId));
    if (!profile && !courses.length) {
      return sendJson(res, 404, { error: 'creator not found' });
    }

    const professionalVisibility = normalizeProfessionalVisibility(profile?.professionalVisibility || profile?.professional_visibility);
    const canSeeDashboard = professionalVisibility === 'public' || creatorId === viewerId;
    const cvNormalized = cvRow ? normalizeCvAnalysisResult(cvRow, cvRow) : null;
    const parsedDashboard = canSeeDashboard ? (cvNormalized?.parsed || null) : null;
    const followStats = localFollowStats(creatorId, viewerId, db);

    return sendJson(res, 200, {
      ok: true,
      data: {
        id: creatorId,
        displayName: deriveDisplayName(creatorId, String(profile?.email || ''), parsedDashboard || cvNormalized?.parsed || null),
        headline: canSeeDashboard ? String(parsedDashboard?.headline || '') : '',
        summary: canSeeDashboard ? String(parsedDashboard?.summary || '') : '',
        profileImageDataUrl: canSeeDashboard ? String(parsedDashboard?.profileImageDataUrl || '') : '',
        region: String(profile?.region || 'ASEAN'),
        preferredLanguage: String(profile?.preferredLanguage || 'en'),
        userSegment: String(profile?.userSegment || 'youth'),
        professionalVisibility,
        stats: {
          totalLikes: sumReactionCountFromPosts(courses),
          totalFollowers: followStats.followers,
          totalFollowing: followStats.following,
          publicCourses: courses.length,
        },
        dashboard: parsedDashboard,
        courses,
        isFollowing: !!followStats.isFollowing,
      },
    });
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

  const courseAnalyticsMatch = pathname.match(/^\/api\/courses\/([^/]+)\/analytics\/?$/);
  const courseAnalyticsId = courseAnalyticsMatch
    ? decodeURIComponent(courseAnalyticsMatch[1])
    : (pathname === '/api/courses/analytics' ? String(query.get('courseId') || '').trim() : '');
  if (req.method === 'GET' && courseAnalyticsId) {
    const courseId = courseAnalyticsId;
    const accountId = String(query.get('accountId') || '').trim();
    if (!courseId || !accountId) return sendJson(res, 400, { error: 'courseId and accountId required' });

    if (supabaseDbEnabled() && isUuid(courseId) && isUuid(accountId)) {
      try {
        const postParams = new URLSearchParams();
        postParams.set('select', 'id,course_id,owner_id,title');
        postParams.set('course_id', `eq.${courseId}`);
        postParams.set('owner_id', `eq.${accountId}`);
        postParams.set('limit', '1');
        const postResp = await supabaseRestRequest(`course_public_posts?${postParams.toString()}`, { method: 'GET' });
        if (!postResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(postResp, 'Failed to load course analytics') });
        }
        const postRow = Array.isArray(postResp.json) ? postResp.json[0] : null;
        if (!postRow) return sendJson(res, 404, { error: 'Course analytics unavailable for this account.' });

        const postId = String(postRow?.id || '');
        const counts = await fetchSupabasePostCounts(postId ? [postId] : [], accountId);

        const eventParams = new URLSearchParams();
        eventParams.set('select', 'user_id,event_type,created_at');
        eventParams.set('course_id', `eq.${courseId}`);
        eventParams.set('order', 'created_at.asc');
        const eventResp = await supabaseRestRequest(`progress_events?${eventParams.toString()}`, { method: 'GET' });
        if (!eventResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(eventResp, 'Failed to load completion trend') });
        }
        const events = (Array.isArray(eventResp.json) ? eventResp.json : []).map((row) => ({
          userId: String(row?.user_id || ''),
          type: String(row?.event_type || ''),
          date: String(row?.created_at || ''),
        }));
        const trendStats = buildCompletionTrend(events);

        return sendJson(res, 200, {
          ok: true,
          data: {
            courseId,
            title: String(postRow?.title || courseId),
            upvotes: Number(counts.upvoteMap.get(postId) || 0),
            downvotes: Number(counts.downvoteMap.get(postId) || 0),
            downloads: Number(counts.saveMap.get(postId) || 0),
            comments: Number(counts.commentMap.get(postId) || 0),
            learners: trendStats.learners,
            completedLearners: trendStats.completedLearners,
            averageCompletionRate: trendStats.averageCompletionRate,
            trend: trendStats.trend,
          },
        });
      } catch (e) {
        // fallback to local DB
      }
    }

    const ownedPost = (db.publicPosts || []).find((row) => (
      String(row?.courseId || '') === String(courseId)
      && String(row?.ownerId || '') === String(accountId)
    )) || null;
    if (!ownedPost) return sendJson(res, 404, { error: 'Course analytics unavailable for this account.' });

    const localCounts = computeLocalPostCounts(db, ownedPost.id, accountId, ownedPost);
    const localEvents = (db.events || [])
      .filter((row) => String(row?.courseId || '') === String(courseId))
      .map((row) => ({
        userId: String(row?.accountId || ''),
        type: String(row?.type || ''),
        date: String(row?.date || ''),
      }));
    const trendStats = buildCompletionTrend(localEvents);

    return sendJson(res, 200, {
      ok: true,
      data: {
        courseId,
        title: String(ownedPost?.title || courseId),
        upvotes: Number(localCounts.upvotes || 0),
        downvotes: Number(localCounts.downvotes || 0),
        downloads: Number(localCounts.saves || 0),
        comments: Number(localCounts.comments || 0),
        learners: trendStats.learners,
        completedLearners: trendStats.completedLearners,
        averageCompletionRate: trendStats.averageCompletionRate,
        trend: trendStats.trend,
      },
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

  if (pathname === '/api/auth/sign-up') {
    if (!supabaseAuthEnabled()) {
      return sendJson(res, 400, { error: 'Supabase auth is not configured.' });
    }
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) return sendJson(res, 400, { error: 'email and password required' });
    const sendAuthSuccess = (user, session, warning = '') => {
      return sendJson(res, 200, {
        ok: true,
        ...(warning ? { warning } : {}),
        data: {
          user: user ? { id: String(user.id || ''), email: String(user.email || email) } : null,
          session: session ? {
            access_token: session.access_token || '',
            refresh_token: session.refresh_token || '',
            expires_at: session.expires_at || null,
          } : null,
        },
      });
    };
    const signInWithPassword = async () => {
      return supabaseAuthRequest('token?grant_type=password', 'POST', { email, password });
    };

    // Dev-friendly path: create confirmed user via admin API and sign in immediately (no email verification flow).
    if (SUPABASE_DISABLE_EMAIL_VERIFICATION && SUPABASE_SERVICE_ROLE_KEY) {
      const adminCreate = await supabaseAuthAdminRequest('admin/users', 'POST', {
        email,
        password,
        email_confirm: true,
      });
      if (adminCreate.ok || isSupabaseAlreadyRegisteredError(adminCreate)) {
        const signInResp = await signInWithPassword();
        if (signInResp.ok) {
          return sendAuthSuccess(
            signInResp.json?.user || adminCreate.json?.user || null,
            signInResp.json || null,
            adminCreate.ok ? 'Account created and signed in without email verification.' : ''
          );
        }
        if (isSupabaseAlreadyRegisteredError(adminCreate)) {
          return sendJson(res, 400, { error: 'This email is already registered. Use Sign in with the existing password.' });
        }
      }
    }

    const r = await supabaseAuthRequest('signup', 'POST', { email, password });
    if (!r.ok) {
      const signupError = supabaseErrorMessage(r, 'Sign-up failed');
      const lowerSignupError = String(signupError || '').toLowerCase();
      const isEmailRateLimit = r.status === 429
        || lowerSignupError.includes('email rate limit')
        || (lowerSignupError.includes('rate limit') && lowerSignupError.includes('email'));

      if (isEmailRateLimit) {
        const signInResp = await signInWithPassword();
        if (signInResp.ok) {
          return sendAuthSuccess(
            signInResp.json?.user || null,
            signInResp.json || null,
            'Email verification is currently throttled; signed in to existing account.'
          );
        }
        return sendJson(res, 429, {
          error: SUPABASE_DISABLE_EMAIL_VERIFICATION
            ? 'Auth provider is temporarily rate-limited. Retry in about 60 seconds.'
            : 'Email verification is temporarily rate-limited. If this email was already registered, use Sign in. Otherwise wait about 60 seconds and retry sign-up.',
        });
      }

      return sendJson(res, 400, { error: signupError });
    }
    let user = r.json?.user || null;
    let session = r.json?.session || null;
    if (SUPABASE_DISABLE_EMAIL_VERIFICATION && !session) {
      const signInResp = await signInWithPassword();
      if (signInResp.ok) {
        user = signInResp.json?.user || user;
        session = signInResp.json || session;
      }
    }

    if (supabaseDbEnabled() && isUuid(user?.id)) {
      const profilePayload = {
        id: user.id,
        email: String(user?.email || email),
        user_segment: 'youth',
        connectivity_level: 'normal',
        learning_goal: '',
        preferred_language: 'en',
        region: 'ASEAN',
        device_class: 'unknown',
        low_bandwidth_mode: false,
      };
      const profileResp = await supabaseRestRequest('profiles?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: profilePayload,
      });
      if (!profileResp.ok) {
        // do not fail auth if profile upsert fails
      }
    }

    return sendAuthSuccess(user, session);
  }

  if (pathname === '/api/auth/sign-in') {
    if (!supabaseAuthEnabled()) {
      return sendJson(res, 400, { error: 'Supabase auth is not configured.' });
    }
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) return sendJson(res, 400, { error: 'email and password required' });
    const r = await supabaseAuthRequest('token?grant_type=password', 'POST', { email, password });
    if (!r.ok) return sendJson(res, 400, { error: supabaseErrorMessage(r, 'Sign-in failed') });
    const user = r.json?.user || null;
    const session = r.json || null;
    return sendJson(res, 200, {
      ok: true,
      data: {
        user: user ? { id: String(user.id || ''), email: String(user.email || email) } : null,
        session: session ? {
          access_token: session.access_token || '',
          refresh_token: session.refresh_token || '',
          expires_at: session.expires_at || null,
        } : null,
      },
    });
  }

  if (pathname === '/api/auth/sign-out') {
    if (!supabaseAuthEnabled()) {
      return sendJson(res, 400, { error: 'Supabase auth is not configured.' });
    }
    const accessToken = String(body?.accessToken || '').trim();
    if (!accessToken) return sendJson(res, 200, { ok: true, data: true });
    const r = await supabaseAuthRequest('logout', 'POST', {}, accessToken);
    if (!r.ok && r.status !== 401) {
      return sendJson(res, 400, { error: supabaseErrorMessage(r, 'Sign-out failed') });
    }
    return sendJson(res, 200, { ok: true, data: true });
  }

  const router = body?.router || {};
  const accountId = String(body?.accountId || '').trim() || `local-${sha256(String(req.headers['user-agent'] || 'ua')).slice(0, 12)}`;
  const profileContext = normalizeProfileContext(body?.profileContext || {});
  const profileKey = sha256(JSON.stringify(profileContext));
  const requestPolicy = aiRequestPolicy(router);

  try {
    if (pathname === '/api/profile/cv/analyze') {
      const fileName = String(body?.fileName || '').trim();
      const mimeType = String(body?.mimeType || '').trim();
      const declaredFormat = String(body?.declaredFormat || '').trim().toLowerCase() === 'europass' ? 'europass' : 'other';
      const cvText = truncateText(String(body?.text || ''), 24000);

      const analysis = await analyzeCvWithAi(cvText, declaredFormat, fileName, mimeType, router, profileContext);
      return sendJson(res, 200, { ok: true, data: analysis });
    }

    if (pathname === '/api/profile/cv/upsert') {
      const incoming = normalizeCvAnalysisResult(body?.cv || {}, {});
      const record = {
        userId: accountId,
        valid: !!incoming.valid,
        format: incoming.format,
        confidence: Number(incoming.confidence || 0),
        fileName: String(incoming.fileName || ''),
        mimeType: String(incoming.mimeType || ''),
        issues: normalizeStringArray(incoming.issues, 6),
        parsed: normalizeCvParsedProfile(incoming.parsed || {}),
        updatedAt: nowIso(),
      };

      if (supabaseDbEnabled() && isUuid(accountId)) {
        const upsertResp = await supabaseRestRequest('profile_cv?on_conflict=user_id', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: {
            user_id: accountId,
            valid: record.valid,
            format: record.format,
            confidence: record.confidence,
            file_name: record.fileName,
            mime_type: record.mimeType,
            issues: record.issues,
            parsed: record.parsed,
            updated_at: record.updatedAt,
          },
        });
        if (upsertResp.ok && Array.isArray(upsertResp.json) && upsertResp.json[0]) {
          const row = upsertResp.json[0];
          const normalized = normalizeCvAnalysisResult({
            valid: !!row.valid,
            format: String(row.format || 'unknown'),
            confidence: Number(row.confidence || 0),
            fileName: String(row.file_name || ''),
            mimeType: String(row.mime_type || ''),
            issues: Array.isArray(row.issues) ? row.issues : [],
            parsed: row.parsed && typeof row.parsed === 'object' ? row.parsed : {},
            updatedAt: row.updated_at || nowIso(),
          }, record);
          return sendJson(res, 200, { ok: true, data: normalized });
        }
        return sendJson(res, 400, { error: supabaseErrorMessage(upsertResp, 'Failed to save CV profile to Supabase') });
      }

      if (!Array.isArray(db.cvProfiles)) db.cvProfiles = [];
      const idx = db.cvProfiles.findIndex((entry) => entry.userId === accountId);
      if (idx === -1) db.cvProfiles.push(record);
      else db.cvProfiles[idx] = { ...db.cvProfiles[idx], ...record };

      const profileIdx = db.profiles.findIndex((entry) => entry.id === accountId);
      if (profileIdx >= 0) {
        db.profiles[profileIdx] = {
          ...db.profiles[profileIdx],
          cvValidated: record.valid,
          cvFileName: record.fileName,
          cvUpdatedAt: record.updatedAt,
          cvRequiredFormat: 'other',
        };
      }
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: normalizeCvAnalysisResult(record, record) });
    }

    if (pathname === '/api/profile/upsert') {
      const incoming = normalizeProfileContext(body?.profile || {});
      const requestedVisibility = normalizeProfessionalVisibility(body?.profile?.professionalVisibility);
      if (supabaseDbEnabled() && isUuid(accountId)) {
        const upsertBody = {
          id: accountId,
          email: String(body?.profile?.email || ''),
          user_segment: incoming.userSegment,
          connectivity_level: incoming.connectivityLevel,
          learning_goal: incoming.learningGoal || '',
          preferred_language: incoming.preferredLanguage || 'en',
          region: incoming.region || 'ASEAN',
          device_class: String(body?.profile?.deviceClass || 'unknown'),
          low_bandwidth_mode: !!incoming.lowBandwidthMode,
          professional_visibility: requestedVisibility,
          updated_at: nowIso(),
        };
        let upsertResp = await supabaseRestRequest('profiles?on_conflict=id', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: upsertBody,
        });
        if (!upsertResp.ok) {
          const fallbackBody = { ...upsertBody };
          delete fallbackBody.professional_visibility;
          upsertResp = await supabaseRestRequest('profiles?on_conflict=id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: fallbackBody,
          });
        }
        if (upsertResp.ok && Array.isArray(upsertResp.json) && upsertResp.json[0]) {
          const row = upsertResp.json[0];
          return sendJson(res, 200, {
            ok: true,
            data: {
              id: String(row.id || ''),
              email: String(row.email || ''),
              userSegment: String(row.user_segment || incoming.userSegment),
              connectivityLevel: String(row.connectivity_level || incoming.connectivityLevel),
              learningGoal: String(row.learning_goal || ''),
              preferredLanguage: String(row.preferred_language || incoming.preferredLanguage || 'en'),
              region: String(row.region || incoming.region || 'ASEAN'),
              discoverySource: String(body?.profile?.discoverySource || 'social_media'),
              deviceClass: String(row.device_class || 'unknown'),
              lowBandwidthMode: !!row.low_bandwidth_mode,
              professionalVisibility: normalizeProfessionalVisibility(row.professional_visibility || requestedVisibility),
              cvRequiredFormat: 'other',
              cvValidated: !!body?.profile?.cvValidated,
              cvFileName: String(body?.profile?.cvFileName || ''),
              cvUpdatedAt: String(body?.profile?.cvUpdatedAt || ''),
              createdAt: row.created_at || nowIso(),
              updatedAt: row.updated_at || nowIso(),
            },
          });
        }
        return sendJson(res, 400, { error: supabaseErrorMessage(upsertResp, 'Failed to save profile to Supabase') });
      }
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
        professionalVisibility: requestedVisibility,
        cvRequiredFormat: 'other',
        cvValidated: !!(body?.profile?.cvValidated ?? existing?.cvValidated),
        cvFileName: String(body?.profile?.cvFileName || existing?.cvFileName || ''),
        cvUpdatedAt: String(body?.profile?.cvUpdatedAt || existing?.cvUpdatedAt || ''),
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
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(String(body?.courseId || '').trim())) {
        const insertResp = await supabaseRestRequest('assessment_attempts', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            user_id: accountId,
            course_id: String(body?.courseId || '').trim(),
            phase: 'pre',
            score_pct: safePercent(body?.scorePct),
          },
        });
        if (!insertResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(insertResp, 'Failed to record pretest') });
        }
        return sendJson(res, 200, { ok: true, data: true });
      }
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
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(String(body?.courseId || '').trim())) {
        const insertResp = await supabaseRestRequest('assessment_attempts', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            user_id: accountId,
            course_id: String(body?.courseId || '').trim(),
            phase: 'post',
            score_pct: safePercent(body?.scorePct),
          },
        });
        if (!insertResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(insertResp, 'Failed to record posttest') });
        }
        return sendJson(res, 200, { ok: true, data: true });
      }
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
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(String(body?.courseId || '').trim())) {
        const insertResp = await supabaseRestRequest('confidence_surveys', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            user_id: accountId,
            course_id: String(body?.courseId || '').trim(),
            phase,
            score,
          },
        });
        if (!insertResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(insertResp, 'Failed to record confidence survey') });
        }
        return sendJson(res, 200, { ok: true, data: true });
      }
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
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(String(body?.courseId || '').trim())) {
        const insertResp = await supabaseRestRequest('progress_events', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            user_id: accountId,
            course_id: String(body?.courseId || '').trim(),
            event_type: type,
            payload: body?.payload && typeof body.payload === 'object' ? body.payload : {},
            created_at: nowIso(),
          },
        });
        if (!insertResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(insertResp, 'Failed to record impact event') });
        }
        return sendJson(res, 200, { ok: true, data: true });
      }
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
      const courseIdHint = decodeURIComponent(publishMatch[1]);
      const visibility = String(body?.visibility || 'private') === 'public' ? 'public' : 'private';
      const course = body?.course && typeof body.course === 'object' ? body.course : {};
      const courseIdFromBody = String(body?.courseId || '').trim();
      const publishCourseIdHint = isUuid(courseIdFromBody) ? courseIdFromBody : courseIdHint;
      if (supabaseDbEnabled() && isUuid(accountId)) {
        try {
          const published = await upsertSupabaseCoursePublication(accountId, visibility, course, profileContext, publishCourseIdHint);
          return sendJson(res, 200, {
            ok: true,
            data: {
              id: published.id,
              visibility: published.visibility,
              moderationStatus: published.moderationStatus,
              courseId: published.courseId || courseIdHint,
            },
          });
        } catch (e) {
          // fallback to local storage below
        }
      }

      const courseId = courseIdHint;
      const existingIdx = db.publicPosts.findIndex((p) => p.ownerId === accountId && p.courseId === courseId);
      const existingPost = existingIdx === -1 ? null : db.publicPosts[existingIdx];
      const snapshot = pickRicherCourseSnapshot(
        course && typeof course === 'object' ? course : null,
        existingPost?.snapshot || null
      );
      const next = {
        id: existingPost?.id || `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        courseId,
        ownerId: accountId,
        title: String(course?.title || existingPost?.title || courseId),
        description: String(course?.description || existingPost?.description || ''),
        snapshot,
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
      return sendJson(res, 200, { ok: true, data: { id: next.id, courseId: next.courseId, visibility: next.visibility, moderationStatus: next.moderationStatus } });
    }

    const creatorFollowMatch = pathname.match(/^\/api\/public\/creator\/([^/]+)\/follow$/);
    if (creatorFollowMatch) {
      const creatorId = decodeURIComponent(creatorFollowMatch[1]);
      const follow = boolFromUnknown(body?.follow, true);
      if (!creatorId) return sendJson(res, 400, { error: 'creatorId required' });
      if (String(creatorId) === String(accountId)) {
        return sendJson(res, 400, { error: 'You cannot follow your own profile.' });
      }

      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(creatorId)) {
        try {
          await setSupabaseFollowState(accountId, creatorId, follow);
          const stats = await fetchSupabaseFollowStats(creatorId, accountId);
          return sendJson(res, 200, {
            ok: true,
            data: {
              following: !!stats.isFollowing,
              followers: Number(stats.followers || 0),
              followingCount: Number(stats.following || 0),
            },
          });
        } catch (e) {
          return sendJson(res, 400, { error: String(e?.message || 'Failed to update follow state') });
        }
      }

      if (!Array.isArray(db.follows)) db.follows = [];
      if (follow) {
        const exists = db.follows.some((row) => (
          String(row?.followerId || '') === String(accountId)
          && String(row?.followingId || '') === String(creatorId)
        ));
        if (!exists) {
          db.follows.push({
            id: `fol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            followerId: String(accountId),
            followingId: String(creatorId),
            createdAt: nowIso(),
          });
        }
      } else {
        db.follows = db.follows.filter((row) => !(
          String(row?.followerId || '') === String(accountId)
          && String(row?.followingId || '') === String(creatorId)
        ));
      }
      saveAppDb(db);
      const stats = localFollowStats(creatorId, accountId, db);
      return sendJson(res, 200, {
        ok: true,
        data: {
          following: !!stats.isFollowing,
          followers: Number(stats.followers || 0),
          followingCount: Number(stats.following || 0),
        },
      });
    }

    const reactMatch = pathname.match(/^\/api\/public\/([^/]+)\/react$/);
    const saveMatch = pathname.match(/^\/api\/public\/([^/]+)\/save$/);
    if (saveMatch) {
      const postId = decodeURIComponent(saveMatch[1]);
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(postId)) {
        const existsParams = new URLSearchParams();
        existsParams.set('select', 'id');
        existsParams.set('id', `eq.${postId}`);
        existsParams.set('limit', '1');
        const existsResp = await supabaseRestRequest(`course_public_posts?${existsParams.toString()}`, { method: 'GET' });
        if (!existsResp.ok || !Array.isArray(existsResp.json) || !existsResp.json.length) {
          return sendJson(res, 404, { error: 'post not found' });
        }
        const existingSaveParams = new URLSearchParams();
        existingSaveParams.set('select', 'id');
        existingSaveParams.set('post_id', `eq.${postId}`);
        existingSaveParams.set('user_id', `eq.${accountId}`);
        existingSaveParams.set('limit', '1');
        const existingSaveResp = await supabaseRestRequest(`course_saves?${existingSaveParams.toString()}`, { method: 'GET' });
        if (!existingSaveResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(existingSaveResp, 'Failed to verify existing save') });
        }
        const alreadySaved = Array.isArray(existingSaveResp.json) && !!existingSaveResp.json[0];
        if (!alreadySaved) {
          const saveResp = await supabaseRestRequest('course_saves', {
            method: 'POST',
            prefer: 'return=minimal',
            body: {
              post_id: postId,
              user_id: accountId,
            },
          });
          if (!saveResp.ok) {
            return sendJson(res, 400, { error: supabaseErrorMessage(saveResp, 'Failed to save course') });
          }
        }
        const counts = await fetchSupabasePostCounts([postId], accountId);
        return sendJson(res, 200, {
          ok: true,
          data: {
            saves: Number(counts.saveMap.get(postId) || 0),
            alreadySaved: !!alreadySaved,
          },
        });
      }

      const post = db.publicPosts.find((p) => p.id === postId);
      if (!post) return sendJson(res, 404, { error: 'post not found' });
      if (!Array.isArray(db.saves)) db.saves = [];
      const exists = db.saves.some((row) => (
        String(row?.postId || '') === String(postId)
        && String(row?.accountId || '') === String(accountId)
      ));
      if (!exists) {
        db.saves.push({
          id: `sav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          postId,
          accountId,
          createdAt: nowIso(),
        });
      }
      const saveCount = new Set(
        db.saves
          .filter((row) => String(row?.postId || '') === String(postId))
          .map((row) => String(row?.accountId || '').trim())
          .filter(Boolean)
      ).size;
      post.saves = saveCount;
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: { saves: saveCount, alreadySaved: !!exists } });
    }

    if (reactMatch) {
      const postId = decodeURIComponent(reactMatch[1]);
      const requestedReaction = normalizeReactionType(body?.reaction);
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(postId)) {
        const existsParams = new URLSearchParams();
        existsParams.set('select', 'id');
        existsParams.set('id', `eq.${postId}`);
        existsParams.set('limit', '1');
        const existsResp = await supabaseRestRequest(`course_public_posts?${existsParams.toString()}`, { method: 'GET' });
        if (!existsResp.ok || !Array.isArray(existsResp.json) || !existsResp.json.length) {
          return sendJson(res, 404, { error: 'post not found' });
        }
        const currentParams = new URLSearchParams();
        currentParams.set('select', 'id,reaction,created_at');
        currentParams.set('post_id', `eq.${postId}`);
        currentParams.set('user_id', `eq.${accountId}`);
        currentParams.set('order', 'created_at.desc');
        const currentResp = await supabaseRestRequest(`course_reactions?${currentParams.toString()}`, { method: 'GET' });
        if (!currentResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(currentResp, 'Failed to resolve existing reaction') });
        }
        const currentRows = Array.isArray(currentResp.json) ? currentResp.json : [];
        const currentReaction = currentRows.length
          ? normalizeReactionType(currentRows[0]?.reaction)
          : null;
        const removeAllParams = new URLSearchParams();
        removeAllParams.set('post_id', `eq.${postId}`);
        removeAllParams.set('user_id', `eq.${accountId}`);

        if (currentRows.length) {
          const removeResp = await supabaseRestRequest(`course_reactions?${removeAllParams.toString()}`, { method: 'DELETE' });
          if (!removeResp.ok) {
            return sendJson(res, 400, { error: supabaseErrorMessage(removeResp, 'Failed to clear existing reaction state') });
          }
        }

        if (!currentRows.length || currentReaction !== requestedReaction) {
          const reactResp = await supabaseRestRequest('course_reactions', {
            method: 'POST',
            prefer: 'return=minimal',
            body: {
              post_id: postId,
              user_id: accountId,
              reaction: requestedReaction,
            },
          });
          if (!reactResp.ok) {
            return sendJson(res, 400, { error: supabaseErrorMessage(reactResp, 'Failed to react to post') });
          }
        }

        const updatedCounts = await fetchSupabasePostCounts([postId], accountId);
        return sendJson(res, 200, {
          ok: true,
          data: {
            upvotes: Number(updatedCounts.upvoteMap.get(postId) || 0),
            downvotes: Number(updatedCounts.downvoteMap.get(postId) || 0),
            userReaction: updatedCounts.userReactionMap.get(postId) || null,
          },
        });
      }
      const post = db.publicPosts.find((p) => p.id === postId);
      if (!post) return sendJson(res, 404, { error: 'post not found' });
      if (!Array.isArray(db.reactions)) db.reactions = [];
      const existingRows = db.reactions
        .filter((row) => (
          String(row?.postId || '') === String(postId)
          && String(row?.accountId || '') === String(accountId)
        ))
        .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
      const currentReaction = existingRows.length
        ? normalizeReactionType(existingRows[0]?.reaction)
        : null;
      db.reactions = db.reactions.filter((row) => !(
        String(row?.postId || '') === String(postId)
        && String(row?.accountId || '') === String(accountId)
      ));
      if (!existingRows.length || currentReaction !== requestedReaction) {
        db.reactions.push({
          id: `rea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          postId,
          accountId,
          reaction: requestedReaction,
          createdAt: nowIso(),
        });
      }
      const localCounts = computeLocalPostCounts(db, postId, accountId, post);
      post.reactions = localCounts.upvotes;
      saveAppDb(db);
      return sendJson(res, 200, {
        ok: true,
        data: {
          upvotes: localCounts.upvotes,
          downvotes: localCounts.downvotes,
          userReaction: localCounts.userReaction,
        },
      });
    }

    const commentMatch = pathname.match(/^\/api\/public\/([^/]+)\/comment$/);
    if (commentMatch) {
      const postId = decodeURIComponent(commentMatch[1]);
      const text = String(body?.comment || '').trim();
      if (!text) return sendJson(res, 400, { error: 'comment required' });
      const normalized = normalizeCommentForDedup(text);
      const duplicateWindowMs = 45 * 1000;

      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(postId)) {
        const existsParams = new URLSearchParams();
        existsParams.set('select', 'id');
        existsParams.set('id', `eq.${postId}`);
        existsParams.set('limit', '1');
        const existsResp = await supabaseRestRequest(`course_public_posts?${existsParams.toString()}`, { method: 'GET' });
        if (!existsResp.ok || !Array.isArray(existsResp.json) || !existsResp.json.length) {
          return sendJson(res, 404, { error: 'post not found' });
        }

        const latestParams = new URLSearchParams();
        latestParams.set('select', 'id,comment,created_at');
        latestParams.set('post_id', `eq.${postId}`);
        latestParams.set('user_id', `eq.${accountId}`);
        latestParams.set('order', 'created_at.desc');
        latestParams.set('limit', '1');
        const latestResp = await supabaseRestRequest(`course_comments?${latestParams.toString()}`, { method: 'GET' });
        if (latestResp.ok && Array.isArray(latestResp.json) && latestResp.json[0]) {
          const latest = latestResp.json[0];
          const latestNormalized = normalizeCommentForDedup(latest?.comment);
          const latestAt = new Date(String(latest?.created_at || 0)).getTime();
          if (latestNormalized && latestNormalized === normalized && Number.isFinite(latestAt) && (Date.now() - latestAt) <= duplicateWindowMs) {
            return sendJson(res, 200, { ok: true, data: { duplicate: true } });
          }
        }

        const commentResp = await supabaseRestRequest('course_comments', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            post_id: postId,
            user_id: accountId,
            comment: text.slice(0, 500),
            moderation_status: 'clean',
          },
        });
        if (!commentResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(commentResp, 'Failed to comment on post') });
        }
        return sendJson(res, 200, { ok: true, data: { duplicate: false } });
      }

      const post = db.publicPosts.find((p) => p.id === postId);
      if (!post) return sendJson(res, 404, { error: 'post not found' });
      const latestLocal = (db.comments || [])
        .filter((row) => String(row?.postId || '') === String(postId) && String(row?.accountId || '') === String(accountId))
        .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0] || null;
      if (latestLocal) {
        const latestNormalized = normalizeCommentForDedup(latestLocal?.text);
        const latestAt = new Date(String(latestLocal?.createdAt || 0)).getTime();
        if (latestNormalized && latestNormalized === normalized && Number.isFinite(latestAt) && (Date.now() - latestAt) <= duplicateWindowMs) {
          return sendJson(res, 200, { ok: true, data: { duplicate: true } });
        }
      }
      db.comments.push({
        id: `com-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        postId,
        accountId,
        text: text.slice(0, 500),
        createdAt: nowIso(),
      });
      saveAppDb(db);
      return sendJson(res, 200, { ok: true, data: { duplicate: false } });
    }

    const reportMatch = pathname.match(/^\/api\/courses\/([^/]+)\/report$/);
    if (reportMatch) {
      const courseId = decodeURIComponent(reportMatch[1]);
      const reason = String(body?.reason || '').trim() || 'Not specified';
      if (supabaseDbEnabled() && isUuid(accountId) && isUuid(courseId)) {
        const reportResp = await supabaseRestRequest('abuse_reports', {
          method: 'POST',
          prefer: 'return=minimal',
          body: {
            reporter_id: accountId,
            target_type: 'course',
            target_id: courseId,
            reason: reason.slice(0, 500),
          },
        });
        if (!reportResp.ok) {
          return sendJson(res, 400, { error: supabaseErrorMessage(reportResp, 'Failed to report course') });
        }

        const reportCountParams = new URLSearchParams();
        reportCountParams.set('select', 'id');
        reportCountParams.set('target_type', 'eq.course');
        reportCountParams.set('target_id', `eq.${courseId}`);
        const reportCountResp = await supabaseRestRequest(`abuse_reports?${reportCountParams.toString()}`, { method: 'GET' });
        const totalReports = reportCountResp.ok && Array.isArray(reportCountResp.json)
          ? reportCountResp.json.length
          : 0;
        const nextModeration = totalReports >= 5 ? 'hidden' : totalReports >= 3 ? 'flagged' : 'under_review';

        if (nextModeration === 'flagged' || nextModeration === 'hidden') {
          const postUpdateParams = new URLSearchParams();
          postUpdateParams.set('course_id', `eq.${courseId}`);
          await supabaseRestRequest(`course_public_posts?${postUpdateParams.toString()}`, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { moderation_status: nextModeration },
          });
          const courseUpdateParams = new URLSearchParams();
          courseUpdateParams.set('id', `eq.${courseId}`);
          await supabaseRestRequest(`courses?${courseUpdateParams.toString()}`, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { moderation_status: nextModeration },
          });
        }

        return sendJson(res, 200, { ok: true, data: true });
      }
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
      if (supabaseDbEnabled() && isUuid(accountId)) {
        const supaRows = [];
        const allowed = new Set(['course_started', 'lesson_started', 'lesson_completed', 'quiz_submitted', 'course_completed', 'daily_active']);
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const eventType = String(item.type || '').trim();
          const itemCourseId = String(item.courseId || '').trim();
          if (!allowed.has(eventType) || !isUuid(itemCourseId)) continue;
          supaRows.push({
            user_id: accountId,
            course_id: itemCourseId,
            event_type: eventType,
            payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
            created_at: item.createdAt || nowIso(),
          });
        }

        if (supaRows.length) {
          const insertResp = await supabaseRestRequest('progress_events', {
            method: 'POST',
            prefer: 'return=minimal',
            body: supaRows,
          });
          if (!insertResp.ok) {
            return sendJson(res, 400, { error: supabaseErrorMessage(insertResp, 'Failed to sync progress events') });
          }
        }
        return sendJson(res, 200, { ok: true, data: { merged: items.length } });
      }

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
      const topicValidationError = getTopicValidationError(topic);
      if (topicValidationError) return sendJson(res, 400, { error: topicValidationError });
      const prompt = promptAssessment(topic, profileContext);
      const keyBase = `assessment|${topic}|${profileKey}|${JSON.stringify(router)}`;
      try {
        let json = await routeJsonWithRepair(router, prompt, keyBase, {
          passes: 2,
          retryDelayMs: 1200,
          maxTotalMs: 30000,
          throwOnError: requestPolicy.strictAi,
          routeOptions: { skipCache: requestPolicy.noCache, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 28000, maxAttempts: 5 },
        });
        if (!Array.isArray(json)) throw new Error('Invalid assessment response');
        json = await enforcePreferredLocale(json, profileContext.preferredLanguage, router, `assessment|${topic}|${profileKey}`);
        return sendJson(res, 200, { ok: true, data: json });
      } catch (e) {
        const status = Number(e?.status || 0);
        const message = String(e?.message || '').toLowerCase();
        const isTransient = isRetriableStatus(status) || message.includes('rate') || message.includes('quota') || message.includes('busy');
        if (requestPolicy.strictAi && isTransient) {
          let fallback = fallbackAssessment(topic);
          fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `assessment-fallback|${topic}|${profileKey}`);
          return sendJson(res, 200, {
            ok: true,
            data: fallback,
            warning: 'AI assessment is temporarily rate-limited. Using fallback questions so user flow can continue.',
          });
        }
        if (requestPolicy.strictAi) {
          const fail = classifyAiFailure(e, 'Could not generate assessment with AI');
          return sendJson(res, fail.status, { error: fail.error });
        }
        let fallback = fallbackAssessment(topic);
        fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `assessment-fallback|${topic}|${profileKey}`);
        return sendJson(res, 200, {
          ok: true,
          data: fallback,
          warning: 'Using fallback assessment because AI providers are unavailable or budget-limited.',
        });
      }
    }

    if (pathname === '/api/generate/course-outline') {
      const topic = String(body?.topic || '').trim();
      const answers = body?.answers || {};
      const forceFreshNonce = String(body?.forceFresh || '').trim();
      if (!topic) return sendJson(res, 400, { error: 'topic required' });
      const topicValidationError = getTopicValidationError(topic);
      if (topicValidationError) return sendJson(res, 400, { error: topicValidationError });
      const prompt = promptCourseOutline(topic, answers, profileContext);
      const keyBase = `outline|${topic}|${JSON.stringify(answers)}|${profileKey}|${JSON.stringify(router)}|fresh:${forceFreshNonce}`;
      try {
        let json = await routeJsonWithRepair(router, prompt, keyBase, {
          passes: 3,
          retryDelayMs: 1300,
          maxTotalMs: 55000,
          throwOnError: requestPolicy.strictAi,
          routeOptions: { skipCache: requestPolicy.noCache || !!forceFreshNonce, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 45000, maxAttempts: 8 },
        });
        if (!json || typeof json !== 'object') throw new Error('Invalid outline response');
        json = normalizeCourseOutline(json, topic, answers);
        json = await enforcePreferredLocale(json, profileContext.preferredLanguage, router, `outline|${topic}|${profileKey}`);
        return sendJson(res, 200, { ok: true, data: json });
      } catch (e) {
        const status = Number(e?.status || 0);
        const message = String(e?.message || '').toLowerCase();
        const isTransient = isRetriableStatus(status) || message.includes('rate') || message.includes('quota') || message.includes('busy');
        if (requestPolicy.strictAi && isTransient) {
          let fallback = fallbackCourseOutline(topic, answers);
          fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `outline-fallback|${topic}|${profileKey}`);
          return sendJson(res, 200, {
            ok: true,
            data: fallback,
            warning: 'AI outline planning is temporarily rate-limited. Using fallback outline so generation can continue.',
          });
        }
        if (requestPolicy.strictAi) {
          const fail = classifyAiFailure(e, 'Could not generate course outline with AI');
          return sendJson(res, fail.status, { error: fail.error });
        }
        let fallback = fallbackCourseOutline(topic, answers);
        fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `outline-fallback|${topic}|${profileKey}`);
        return sendJson(res, 200, {
          ok: true,
          data: fallback,
          warning: 'Using fallback outline because AI providers are unavailable or budget-limited.',
        });
      }
    }

    if (pathname === '/api/generate/module-lesson-plan') {
      const courseTitle = String(body?.courseTitle || '').trim();
      const moduleTitle = String(body?.moduleTitle || '').trim();
      const moduleDesc = String(body?.moduleDesc || '').trim();
      const forceFreshNonce = String(body?.forceFresh || '').trim();
      if (!courseTitle || !moduleTitle) return sendJson(res, 400, { error: 'courseTitle and moduleTitle required' });

      const prompt = promptLessonPlan(courseTitle, moduleTitle, moduleDesc, profileContext);
      const keyBase = `lessonplan|${courseTitle}|${moduleTitle}|${moduleDesc}|${profileKey}|${JSON.stringify(router)}|fresh:${forceFreshNonce}`;
      try {
        const raw = await routeJsonWithRepair(router, prompt, keyBase, {
          passes: 2,
          maxTotalMs: 55000,
          throwOnError: requestPolicy.strictAi,
          routeOptions: { skipCache: requestPolicy.noCache || !!forceFreshNonce, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 45000, maxAttempts: 8 },
        });
        if (!raw) throw new Error('Invalid lesson plan response');
        let json = normalizeLessonPlan(raw, `${courseTitle} ${moduleTitle} ${moduleDesc}`);
        json = await enforcePreferredLocale(json, profileContext.preferredLanguage, router, `lessonplan|${courseTitle}|${moduleTitle}|${profileKey}`);
        return sendJson(res, 200, { ok: true, data: json });
      } catch (e) {
        if (requestPolicy.strictAi) {
          const fail = classifyAiFailure(e, `Could not generate lesson plan for "${moduleTitle}" with AI`);
          return sendJson(res, fail.status, { error: fail.error });
        }
        let fallback = normalizeLessonPlan(
          fallbackModuleLessonPlan(courseTitle, moduleTitle, moduleDesc),
          `${courseTitle} ${moduleTitle} ${moduleDesc}`
        );
        fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `lessonplan-fallback|${courseTitle}|${moduleTitle}|${profileKey}`);
        return sendJson(res, 200, {
          ok: true,
          data: fallback,
          warning: 'Using fallback lesson plan because AI providers are unavailable or budget-limited.',
        });
      }
    }

    if (pathname === '/api/generate/step-content') {
      const courseTitle = String(body?.courseTitle || '').trim();
      const moduleTitle = String(body?.moduleTitle || '').trim();
      const stepTitle = String(body?.stepTitle || '').trim();
      const type = String(body?.type || '').trim();
      const referenceContext = String(body?.referenceContext || '').trim().slice(0, 2000);
      const forceFreshNonce = String(body?.forceFresh || '').trim();
      if (!courseTitle || !moduleTitle || !stepTitle || !type) {
        return sendJson(res, 400, { error: 'courseTitle, moduleTitle, stepTitle, type required' });
      }
      const effectiveType = (!isProgrammingTopic(courseTitle, moduleTitle, stepTitle) && type === 'CODE_BUILDER')
        ? 'DRAG_FILL'
        : type;
      const restrictVideo = !!profileContext.lowBandwidthMode || profileContext.connectivityLevel === 'offline_first';
      const finalType = restrictVideo && effectiveType === 'VIDEO' ? 'TEXT' : effectiveType;
      const videoQuery = `${courseTitle} ${moduleTitle} ${stepTitle}`;

      let yt = null;
      let videoRegistryKey = '';
      if (finalType === 'VIDEO') {
        videoRegistryKey = moduleVideoKey(courseTitle, moduleTitle);
        const usedIds = getUsedVideoIds(videoRegistryKey);
        const searchQuery = `${videoQuery} tutorial`;
        const ytSearch = await youtubeSearchEmbed(searchQuery, usedIds);
        const ytNoKey = ytSearch ? null : await youtubeSearchEmbedNoKey(searchQuery, usedIds);
        const ytCurated = (ytSearch || ytNoKey) ? null : curatedVideo(videoQuery);
        yt = ytSearch || ytNoKey || ytCurated || null;
      }

      const prompt = promptStepContent(courseTitle, moduleTitle, stepTitle, finalType, referenceContext, profileContext);
      let json = null;
      let lastGenerationError = null;
      const routeOptions = { skipCache: requestPolicy.noCache || !!forceFreshNonce, bypassBreaker: requestPolicy.strictAi };
      const keyBase = `step|${courseTitle}|${moduleTitle}|${stepTitle}|${finalType}|${referenceContext}|${profileKey}|${JSON.stringify(router)}`;
      const baseKey = sha256(keyBase);
      const maxPasses = forceFreshNonce ? 3 : 2;
      for (let pass = 0; pass < maxPasses && !json; pass++) {
        const passKey = pass === 0
          ? (forceFreshNonce ? sha256(`${keyBase}|fresh:${forceFreshNonce}`) : baseKey)
          : sha256(`${keyBase}|fresh:${Date.now()}|pass:${pass}`);
        try {
          const text = await routeText(router, prompt, passKey, 7 * 24 * 60 * 60 * 1000, routeOptions);
          try {
            json = extractJson(text);
          } catch {
            const repairPrompt = `${prompt}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanations, no prose.`;
            const repairKey = sha256(`step-repair|${passKey}`);
            const repairedText = await routeText(router, repairPrompt, repairKey, 5 * 60 * 1000, routeOptions);
            json = extractJson(repairedText);
          }
        } catch (e) {
          lastGenerationError = e;
          if (pass < maxPasses - 1) {
            await sleep(300 * (pass + 1));
          }
        }
      }
      if (!json) {
        if (requestPolicy.strictAi) {
          const fail = classifyAiFailure(lastGenerationError, `Could not generate step content for "${stepTitle}" with AI`);
          return sendJson(res, fail.status, { error: fail.error });
        }
        let fallback = fallbackStepContent(finalType, stepTitle, moduleTitle, yt, 'generation_failed');
        fallback = await enforcePreferredLocale(fallback, profileContext.preferredLanguage, router, `step-fallback|${courseTitle}|${moduleTitle}|${stepTitle}|${profileKey}`);
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
      validated = {
        ...validated,
        data: {
          ...(validated?.data || {}),
          references: mergeReferences(
            validated?.data?.references,
            supplementalReferencesForTopic(`${courseTitle} ${moduleTitle} ${stepTitle}`)
          ),
        },
      };
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

      if (finalType === 'VIDEO' && yt) {
        const validId = extractYoutubeVideoId(validated?.data?.videoUrl) || extractYoutubeVideoId(validated?.data?.videoWebUrl);
        if (!validId) {
          const rescue = yt || await youtubeSearchEmbedNoKey(`${videoQuery} tutorial`, getUsedVideoIds(videoRegistryKey)) || curatedVideo(videoQuery);
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
      if (finalType === 'VIDEO' && !yt) {
        if (requestPolicy.strictAi) {
          return sendJson(res, 503, { error: 'Video embedding failed: no embeddable public YouTube video matched this lesson topic.' });
        }
        let fallback = fallbackStepContent('VIDEO', stepTitle, moduleTitle, null, 'no_relevant_video');
        fallback = await enforcePreferredLocale(
          fallback,
          profileContext.preferredLanguage,
          router,
          `step-video-fallback|${courseTitle}|${moduleTitle}|${stepTitle}|${profileKey}`
        );
        return sendJson(res, 200, {
          ok: true,
          data: fallback,
          warning: 'No embeddable public YouTube video matched this lesson topic. Showing text-first fallback for this step.',
        });
      }
      validated = await enforcePreferredLocale(
        validated,
        profileContext.preferredLanguage,
        router,
        `step-final|${courseTitle}|${moduleTitle}|${stepTitle}|${finalType}|${profileKey}`
      );
      validated = validateStepContent(finalType, validated);
      validated = {
        ...validated,
        data: {
          ...(validated?.data || {}),
          references: mergeReferences(
            validated?.data?.references,
            supplementalReferencesForTopic(`${courseTitle} ${moduleTitle} ${stepTitle}`)
          ),
        },
      };
      return sendJson(res, 200, { ok: true, data: validated });
    }

    if (pathname === '/api/tutor/ask') {
      const content = body?.content;
      const question = String(body?.question || '').trim();
      if (!content || !question) return sendJson(res, 400, { error: 'content and question required' });
      const prompt = promptTutorAsk(content, question);
      const key = sha256(`ask|${JSON.stringify(content)}|${question}|${JSON.stringify(router)}`);
      try {
        const text = await routeText(router, prompt, key, 24 * 60 * 60 * 1000);
        return sendJson(res, 200, { ok: true, data: text });
      } catch {
        return sendJson(res, 200, {
          ok: true,
          data: fallbackTutorAnswer(content, question),
          warning: 'AI assistant response used local fallback because providers are temporarily unavailable.',
        });
      }
    }

    if (pathname === '/api/tutor/edit') {
      const content = body?.content;
      const editPrompt = String(body?.editPrompt || '').trim();
      if (!content || !editPrompt) return sendJson(res, 400, { error: 'content and editPrompt required' });

      const directEdit = await applyDirectTutorEdit(content, editPrompt);
      if (directEdit) {
        return sendJson(res, 200, {
          ok: true,
          data: directEdit,
        });
      }

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

    const normalizedInterviewPath = String(pathname || '').replace(/\/+$/, '').toLowerCase();
    if (
      normalizedInterviewPath === '/api/interview/transcribe'
      || normalizedInterviewPath === '/api/interview/transcription'
      || normalizedInterviewPath === '/api/interview/transcribe-audio'
      || normalizedInterviewPath === '/api/interview/audio-transcribe'
      || normalizedInterviewPath === '/api/interview/transcribeaudio'
      || normalizedInterviewPath === '/api/interview/audiotranscribe'
    ) {
      const audioBase64 = String(body?.audioBase64 || '').trim();
      if (!audioBase64) return sendJson(res, 400, { error: 'audioBase64 required' });
      let audioBuffer = null;
      try {
        audioBuffer = Buffer.from(audioBase64, 'base64');
      } catch {
        audioBuffer = null;
      }
      if (!audioBuffer || !audioBuffer.length) {
        return sendJson(res, 400, { error: 'Invalid audio payload.' });
      }
      if (audioBuffer.length > 8 * 1024 * 1024) {
        return sendJson(res, 400, { error: 'Audio recording is too large. Keep the answer shorter and retry.' });
      }
      const mimeType = normalizeAudioMimeType(body?.mimeType);
      const language = String(body?.language || profileContext?.preferredLanguage || '').trim();
      const transcript = await transcribeInterviewAudio(audioBuffer, mimeType, language);
      return sendJson(res, 200, {
        ok: true,
        data: {
          transcript,
        },
      });
    }

    if (pathname === '/api/profile/career-guidance') {
      const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {};
      const interests = normalizeInterviewList(body?.interests, 12, 80);
      const skills = normalizeInterviewList(profile?.skills, 20, 80);
      const experiences = Array.isArray(profile?.experience) ? profile.experience.slice(0, 8) : [];
      const education = Array.isArray(profile?.education) ? profile.education.slice(0, 5) : [];
      const certs = normalizeInterviewList(profile?.certifications, 10, 80);
      const learningGoal = String(profile?.learningGoal || '').trim();
      const region = String(profile?.region || profileContext?.region || '').trim() || 'ASEAN';
      const preferredLanguage = String(profile?.preferredLanguage || profileContext?.preferredLanguage || 'en').trim();
      const profileText = [
        `Name: ${String(profile?.fullName || '').trim() || 'N/A'}`,
        `Headline: ${String(profile?.headline || '').trim() || 'N/A'}`,
        `Summary: ${String(profile?.summary || '').trim() || 'N/A'}`,
        `Learning goal: ${learningGoal || 'N/A'}`,
        `Region: ${region}`,
        `Interests: ${interests.join(', ') || 'N/A'}`,
        `Skills: ${skills.join(', ') || 'N/A'}`,
        `Experience: ${experiences.map((item) => `${String(item?.role || '').trim()} @ ${String(item?.organization || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Education: ${education.map((item) => `${String(item?.program || '').trim()} @ ${String(item?.institution || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Certifications: ${certs.join(', ') || 'N/A'}`,
      ].join('\n');
      const prompt = `Return ONLY valid JSON (no markdown, no extra text).

You are a labor-market aware career coach.
Generate 4-6 personalized career guidance role cards from the candidate profile.
Prioritize realistic, current-market roles aligned to readiness.
For each role, provide 5-8 responsibilities and 6-10 requirements.
Requirements must reflect real hiring expectations, not only what is already listed in the candidate CV.
If a role includes Senior/Lead/Principal/Manager scope, include architecture/system design, performance, testing strategy, security, CI/CD or observability, stakeholder communication, and mentoring/leadership expectations.
Avoid generic bullets like "proven experience" without concrete capability detail.
Each role MUST include at least 2 credible source links. Prefer official labor-market references (BLS, O*NET, government job outlook pages, reputable professional bodies). Do not invent broken links.

Candidate profile:
${profileText}

Output language: ${preferredLanguage}

JSON shape:
{
  "roles": [
    {
      "id": string,
      "title": string,
      "roleSummary": string,
      "responsibilities": [string],
      "requirements": [string],
      "sources": [{ "label": string, "url": string }]
    }
  ]
}`;
      const careerRouter = {
        mode: 'manual',
        provider: 'mistral',
        model: 'open-mistral-nemo',
      };
      const keyBase = `career-guidance|${accountId}|${sha256(profileText)}|${preferredLanguage}|mistral|open-mistral-nemo`;
      const raw = await routeJsonWithRepair(careerRouter, prompt, keyBase, {
        passes: 2,
        retryDelayMs: 900,
        maxTotalMs: 32000,
        throwOnError: true,
        routeOptions: {
          skipCache: requestPolicy.noCache,
          bypassBreaker: requestPolicy.strictAi,
          maxTotalMs: 30000,
          maxAttempts: 6,
        },
      });
      const roles = normalizeCareerGuidanceRoles(raw, profile, interests);
      return sendJson(res, 200, {
        ok: true,
        data: roles,
        ...(raw ? {} : { warning: 'Using fallback career guidance because AI output was unavailable.' }),
      });
    }

    if (pathname === '/api/profile/career-guidance/role') {
      const roleTitle = String(body?.roleTitle || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!roleTitle) return sendJson(res, 400, { error: 'roleTitle required' });
      const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {};
      const interests = normalizeInterviewList(body?.interests, 12, 80);
      const skills = normalizeInterviewList(profile?.skills, 20, 80);
      const experiences = Array.isArray(profile?.experience) ? profile.experience.slice(0, 8) : [];
      const education = Array.isArray(profile?.education) ? profile.education.slice(0, 5) : [];
      const certs = normalizeInterviewList(profile?.certifications, 10, 80);
      const learningGoal = String(profile?.learningGoal || '').trim();
      const region = String(profile?.region || profileContext?.region || '').trim() || 'ASEAN';
      const preferredLanguage = String(profile?.preferredLanguage || profileContext?.preferredLanguage || 'en').trim();
      const profileText = [
        `Target role: ${roleTitle}`,
        `Name: ${String(profile?.fullName || '').trim() || 'N/A'}`,
        `Headline: ${String(profile?.headline || '').trim() || 'N/A'}`,
        `Summary: ${String(profile?.summary || '').trim() || 'N/A'}`,
        `Learning goal: ${learningGoal || 'N/A'}`,
        `Region: ${region}`,
        `Interests: ${interests.join(', ') || 'N/A'}`,
        `Skills: ${skills.join(', ') || 'N/A'}`,
        `Experience: ${experiences.map((item) => `${String(item?.role || '').trim()} @ ${String(item?.organization || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Education: ${education.map((item) => `${String(item?.program || '').trim()} @ ${String(item?.institution || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Certifications: ${certs.join(', ') || 'N/A'}`,
      ].join('\n');
      const prompt = `Return ONLY valid JSON (no markdown, no extra text).

You are a labor-market aware career coach.
Analyze exactly ONE target role for this candidate.
The output role title must stay as "${roleTitle}" (or a very close standard variant).
Provide 5-8 responsibilities and 6-10 requirements for current hiring expectations.
Requirements must include concrete capability depth beyond basic CV keywords.
If the role is Senior/Lead/Principal/Manager, include architecture/system design, performance, testing strategy, security, CI/CD or observability, stakeholder communication, and mentoring/leadership expectations.
Avoid generic bullets like "proven experience" without specific competency detail.
Include at least 2 credible source links (BLS, O*NET, official labor statistics, reputable professional standards).

Candidate profile:
${profileText}

Output language: ${preferredLanguage}

JSON shape:
{
  "role": {
    "id": string,
    "title": string,
    "roleSummary": string,
    "responsibilities": [string],
    "requirements": [string],
    "sources": [{ "label": string, "url": string }]
  }
}`;
      const careerRouter = {
        mode: 'manual',
        provider: 'mistral',
        model: 'open-mistral-nemo',
      };
      const keyBase = `career-guidance-role|${accountId}|${sha256(profileText)}|${preferredLanguage}|mistral|open-mistral-nemo`;
      const raw = await routeJsonWithRepair(careerRouter, prompt, keyBase, {
        passes: 2,
        retryDelayMs: 900,
        maxTotalMs: 32000,
        throwOnError: false,
        routeOptions: {
          skipCache: requestPolicy.noCache,
          bypassBreaker: requestPolicy.strictAi,
          maxTotalMs: 30000,
          maxAttempts: 6,
        },
      });
      const normalized = normalizeCareerGuidanceRoles(
        (raw?.role && typeof raw.role === 'object')
          ? [raw.role]
          : raw,
        profile,
        [roleTitle, ...interests]
      );
      const selected = (
        normalized.find((row) => String(row?.title || '').trim().toLowerCase() === roleTitle.toLowerCase())
        || normalized[0]
      );
      if (!selected) {
        return sendJson(res, 503, { error: `Could not analyze role guidance for "${roleTitle}" right now. Please try again.` });
      }
      return sendJson(res, 200, {
        ok: true,
        data: selected,
      });
    }

    if (pathname === '/api/interview/recommendations') {
      const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {};
      const skills = normalizeInterviewList(profile?.skills, 20, 80);
      const experiences = Array.isArray(profile?.experience) ? profile.experience.slice(0, 8) : [];
      const education = Array.isArray(profile?.education) ? profile.education.slice(0, 5) : [];
      const certs = normalizeInterviewList(profile?.certifications, 10, 80);
      const learningGoal = String(profile?.learningGoal || '').trim();
      const region = String(profile?.region || profileContext?.region || '').trim() || 'ASEAN';
      const preferredLanguage = String(profile?.preferredLanguage || profileContext?.preferredLanguage || 'en').trim();
      const profileText = [
        `Name: ${String(profile?.fullName || '').trim() || 'N/A'}`,
        `Headline: ${String(profile?.headline || '').trim() || 'N/A'}`,
        `Summary: ${String(profile?.summary || '').trim() || 'N/A'}`,
        `Learning goal: ${learningGoal || 'N/A'}`,
        `Region: ${region}`,
        `Skills: ${skills.join(', ') || 'N/A'}`,
        `Experience: ${experiences.map((item) => `${String(item?.role || '').trim()} @ ${String(item?.organization || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Education: ${education.map((item) => `${String(item?.program || '').trim()} @ ${String(item?.institution || '').trim()}`).filter(Boolean).join(' | ') || 'N/A'}`,
        `Certifications: ${certs.join(', ') || 'N/A'}`,
      ].join('\n');
      const prompt = `Return ONLY valid JSON (no markdown, no extra text).

You are a labor-market aware career coach.
Generate 6-8 interview-ready job recommendations based on the candidate profile.
Prioritize realistic roles aligned to current market demand and candidate readiness.

Candidate profile:
${profileText}

Output language: ${preferredLanguage}

JSON shape:
{
  "jobs": [
    { "id": string, "title": string, "reason": string }
  ]
}`;
      const keyBase = `interview-recommendations|${accountId}|${sha256(profileText)}|${preferredLanguage}|${JSON.stringify(router)}`;
      const raw = await routeJsonWithRepair(router, prompt, keyBase, {
        passes: 2,
        retryDelayMs: 900,
        maxTotalMs: 30000,
        throwOnError: false,
        routeOptions: { skipCache: requestPolicy.noCache, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 28000, maxAttempts: 6 },
      });
      const jobs = normalizeInterviewRecommendations(raw, profile);
      return sendJson(res, 200, {
        ok: true,
        data: jobs,
        ...(raw ? {} : { warning: 'Using fallback interview job recommendations because AI output was unavailable.' }),
      });
    }

    if (pathname === '/api/interview/session') {
      const setup = body?.setup && typeof body.setup === 'object' ? body.setup : {};
      const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {};
      const requestedJobTitleRaw = String(body?.jobTitle || '').replace(/\s+/g, ' ').trim();
      const requestedJobTitle = stripInterviewPromptScaffolding(requestedJobTitleRaw);
      if (!requestedJobTitle) return sendJson(res, 400, { error: 'jobTitle required' });
      const safetyError = getInterviewInputSafetyError(requestedJobTitleRaw);
      if (safetyError) {
        return sendJson(res, 422, {
          ok: false,
          error: safetyError,
          code: 'INTERVIEW_INPUT_UNSAFE',
        });
      }
      const targetLanguage = String(setup?.targetLanguage || profileContext?.preferredLanguage || 'en-US').trim() || 'en-US';
      const targetLanguageLabel = interviewLanguageLabel(targetLanguage);
      const targetLanguageCode = normalizeInterviewLanguageCode(targetLanguage);
      const isEnglishInterview = targetLanguageCode === 'en';
      const questionFocusRaw = String(setup?.questionFocus || 'mixed').trim().toLowerCase();
      const questionFocus = ['mixed', 'behavioral', 'technical'].includes(questionFocusRaw) ? questionFocusRaw : 'mixed';
      const seniorityRaw = String(setup?.seniority || 'mid').trim().toLowerCase();
      const seniority = ['entry', 'mid', 'senior'].includes(seniorityRaw) ? seniorityRaw : 'mid';
      const candidateName = inferInterviewCandidateName(profile);
      const roleTrack = inferInterviewRoleTrack(requestedJobTitle, profile);
      const questionPlan = pickInterviewQuestionVolume({
        seniority,
        questionFocus,
        roleTrack,
        profile,
        role: { jobTitle: requestedJobTitle },
      });
      const questionCount = Math.max(4, Math.min(12, Number(questionPlan?.targetCount) || (seniority === 'entry' ? 6 : (seniority === 'senior' ? 10 : 8))));
      let minQuestionCount = Math.max(4, Math.min(questionCount, Number(questionPlan?.minCount) || (seniority === 'senior' ? 7 : (seniority === 'entry' ? 4 : 5))));
      if (targetLanguageCode === 'my') {
        minQuestionCount = Math.max(4, minQuestionCount - 2);
      }
      const roleBlueprint = fallbackInterviewRole(
        requestedJobTitle,
        profile,
        isEnglishInterview ? targetLanguage : 'en-US'
      );
      const debugRequestId = `intv-${sha256(`${accountId}|${requestedJobTitle}|${targetLanguage}|${Date.now()}|${Math.random()}`).slice(0, 12)}`;
      const attemptTrace = [];
      const addTrace = (step, data = {}) => {
        const row = {
          step,
          at: nowIso(),
          ...data,
        };
        attemptTrace.push(row);
        interviewDebugLog('session-step', {
          requestId: debugRequestId,
          ...row,
        });
      };
      const withDebug = (payload = {}) => (
        INTERVIEW_GENERATION_DEBUG_ENABLED
          ? {
              debug: {
                requestId: debugRequestId,
                jobTitle: requestedJobTitle,
                targetLanguage,
                questionFocus,
                seniority,
                attempts: attemptTrace.slice(-20),
                ...payload,
              },
            }
          : {}
      );
      const assessmentStyleEnabled = !/^(0|false|no|off)$/i.test(String(process.env.INTERVIEW_SESSION_ASSESSMENT_STYLE || '1').trim());
      // Assessment-style flow is lighter/faster for English, but non-English quality is better in the full flow.
      const useAssessmentStyleInterviewFlow = assessmentStyleEnabled && isEnglishInterview;
      if (useAssessmentStyleInterviewFlow) {
        const buildAssessmentStyleSession = (questions = [], roleOverride = null) => {
          const roleSource = roleOverride && typeof roleOverride === 'object'
            ? roleOverride
            : {};
          return {
            role: {
              jobTitle: String(roleSource?.jobTitle || requestedJobTitle).replace(/\s+/g, ' ').trim().slice(0, 120) || requestedJobTitle,
              roleSummary: String(roleSource?.roleSummary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
            },
            questions: Array.isArray(questions) ? questions : [],
            generatedAt: nowIso(),
          };
        };
        const extractAssessmentStyleRole = (source = {}) => {
          const roleRaw = extractInterviewRoleRaw(source);
          return {
            jobTitle: String(roleRaw?.jobTitle || roleRaw?.title || requestedJobTitle).replace(/\s+/g, ' ').trim().slice(0, 120) || requestedJobTitle,
            roleSummary: String(roleRaw?.roleSummary || roleRaw?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
          };
        };
        const normalizeAssessmentStyleRows = (rawRows = [], language = 'en-US') => normalizeAiOnlyInterviewQuestions(rawRows, language, questionCount)
          .map((row, idx) => ({
            id: String(row?.id || `q${idx + 1}`).slice(0, 80),
            question: enforceInterviewQuestionText(row?.question, language).slice(0, 500),
            focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
          }))
          .filter((row) => !!row.question);
        const normalizeAssessmentStyleSession = (raw = {}, language = targetLanguage) => buildAssessmentStyleSession(
          normalizeAssessmentStyleRows(raw?.questions ?? raw, language),
          extractAssessmentStyleRole(raw?.role || raw)
        );
        const isAssessmentStyleSessionValid = (session = {}) => {
          const rows = Array.isArray(session?.questions) ? session.questions : [];
          if (rows.length < minQuestionCount) return false;
          if (!isEnglishInterview && shouldForceLocalizedQuestionFallback(rows, targetLanguage)) return false;
          const quality = evaluateAiOnlyInterviewQuestions(rows, requestedJobTitle, targetLanguage, minQuestionCount);
          if (!quality?.ok) return false;
          return true;
        };
        const localizeAssessmentStyleSession = async (session = {}, contextTag = 'primary') => {
          if (isEnglishInterview) return session;
          const roleNeedsLocalization = shouldForceLocalizedTextFallback(String(session?.role?.roleSummary || ''), targetLanguage);
          const questionsNeedLocalization = shouldForceLocalizedQuestionFallback(session?.questions, targetLanguage);
          if (!roleNeedsLocalization && !questionsNeedLocalization) return session;
          try {
            const localized = await localizeInterviewSessionQuestions(session, targetLanguage);
            const normalized = normalizeAssessmentStyleSession(localized, targetLanguage);
            if (shouldForceLocalizedQuestionFallback(normalized?.questions, targetLanguage)) return session;
            return normalized;
          } catch (e) {
            addTrace('assessment-style-localize-fail', {
              stage: contextTag,
              status: Number(e?.status || 0),
              message: String(e?.message || '').slice(0, 220),
            });
            return session;
          }
        };
        const buildAssessmentStyleFallbackSession = async () => {
          const nativeFallbackRows = targetLanguageCode === 'my'
            ? [
                { id: 'q1', question: `${requestedJobTitle} အဖြစ် တိုင်းတာနိုင်သော ရလဒ်ရခဲ့သည့် ပရောဂျက်တစ်ခုကို ရှင်းပြပါ?`, focus: 'execution' },
                { id: 'q2', question: `${requestedJobTitle} အတွက် ပထမဆုံး စောင့်ကြည့်မည့် KPI က ဘာလဲ၊ ASEAN အတွက် ရက် ၉၀ အတွင်း လက်တွေ့ကျသော ရည်မှန်းချက်က ဘာလဲ?`, focus: 'execution' },
                { id: 'q3', question: `${requestedJobTitle} အလုပ်တွင် အရေးပေါ်နှင့် အရေးကြီးအလုပ်များကို အရည်အသွေးမကျစေဘဲ ဘယ်လို ဦးစားပေးမလဲ?`, focus: 'scenario' },
                { id: 'q4', question: `ဆင်တူသော အလုပ်တစ်ခုတွင် သင်လုပ်မိခဲ့သည့် အမှားတစ်ခုနှင့် ထို့နောက် ပြင်ဆင်ပြောင်းလဲခဲ့သည့် နည်းလမ်းကို ပြောပြပါ?`, focus: 'behavioral' },
              ]
            : [];
          const fallbackBase = marketDrivenEnglishFallbackInterviewQuestions(
            requestedJobTitle,
            roleBlueprint,
            profile,
            {
              questionFocus,
              roleTrack,
              seniority,
              targetCount: Math.max(minQuestionCount, Math.min(questionCount, 8)),
              candidateName: isEnglishInterview ? candidateName : '',
            }
          );
          const fallbackRows = normalizeAiOnlyInterviewQuestions(fallbackBase, 'en-US', Math.max(minQuestionCount, Math.min(questionCount, 8)))
            .map((row, idx) => ({
              id: String(row?.id || `q${idx + 1}`),
              question: enforceInterviewQuestionText(row?.question, 'en-US').slice(0, 500),
              focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
            }))
            .filter((row) => !!row.question);
          const safeFallbackRows = fallbackRows.length
            ? fallbackRows
            : [
                { id: 'q1', question: enforceInterviewQuestionText(`Describe a recent project where you delivered measurable results as ${requestedJobTitle}.`, 'en-US').slice(0, 500), focus: 'execution' },
                { id: 'q2', question: enforceInterviewQuestionText(`How do you prioritize urgent and important tasks in ${requestedJobTitle} work while protecting quality?`, 'en-US').slice(0, 500), focus: 'scenario' },
                { id: 'q3', question: enforceInterviewQuestionText(`Which skill should be strongest for ${requestedJobTitle} on day one, and why?`, 'en-US').slice(0, 500), focus: 'market' },
                { id: 'q4', question: enforceInterviewQuestionText(`Tell me about a mistake you made in similar work and what you changed after that?`, 'en-US').slice(0, 500), focus: 'behavioral' },
              ];
          if (nativeFallbackRows.length) {
            return buildAssessmentStyleSession(
              nativeFallbackRows.map((row) => ({
                ...row,
                question: enforceInterviewQuestionText(row.question, targetLanguage).slice(0, 500),
              })),
              { jobTitle: requestedJobTitle, roleSummary: '' }
            );
          }
          let session = buildAssessmentStyleSession(safeFallbackRows, { jobTitle: requestedJobTitle, roleSummary: '' });
          session = await localizeAssessmentStyleSession(session, 'fallback');
          if (!Array.isArray(session?.questions) || !session.questions.length) {
            session = buildAssessmentStyleSession(safeFallbackRows, { jobTitle: requestedJobTitle, roleSummary: '' });
          }
          return session;
        };
        const generateAssessmentStyleInterview = async (strictRetry = false) => {
          const prompt = promptInterviewQuestionsDirect({
            requestedJobTitle,
            targetLanguage,
            targetLanguageLabel,
            candidateName,
            region: String(profile?.region || profileContext?.region || 'ASEAN').trim() || 'ASEAN',
            profileSkills: profile?.skills,
            profileExperience: profile?.experience,
            questionFocus,
            seniority,
            questionCount,
            strictRetry,
          });
          const keyBase = `interview-session|assessment-style|${strictRetry ? 'retry' : 'primary'}|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|focus:${questionFocus}|seniority:${seniority}|${profileKey}|${JSON.stringify(router)}`;
          const raw = await routeJsonWithRepair(router, prompt, keyBase, {
            passes: 2,
            retryDelayMs: 1200,
            maxTotalMs: 30000,
            throwOnError: requestPolicy.strictAi,
            routeOptions: {
              skipCache: requestPolicy.noCache,
              bypassBreaker: requestPolicy.strictAi,
              maxTotalMs: 28000,
              maxAttempts: 5,
            },
          });
          if (!raw || typeof raw !== 'object') {
            const e = new Error('Invalid interview response');
            e.status = 503;
            throw e;
          }
          let session = normalizeAssessmentStyleSession(raw, targetLanguage);
          session = await localizeAssessmentStyleSession(session, strictRetry ? 'retry' : 'primary');
          if (!isAssessmentStyleSessionValid(session)) {
            const e = new Error('Interview response failed validation');
            e.status = 422;
            throw e;
          }
          return session;
        };

        try {
          const session = await generateAssessmentStyleInterview(false);
          addTrace('assessment-style', { result: 'primary-ok', questionCount: session.questions.length });
          return sendJson(res, 200, {
            ok: true,
            data: session,
            ...withDebug({ result: 'assessment-style-primary-ok' }),
          });
        } catch (firstErr) {
          const firstStatus = Number(firstErr?.status || 0);
          const firstMessage = String(firstErr?.message || '').toLowerCase();
          const isTransient = (
            isRetriableStatus(firstStatus)
            || isInterviewValidationFailure(firstErr)
            || isModelUnavailableFailure(firstErr)
            || firstMessage.includes('rate')
            || firstMessage.includes('quota')
            || firstMessage.includes('busy')
            || isTimeoutOrAbortMessage(firstMessage)
          );
          addTrace('assessment-style', {
            result: 'primary-fail',
            status: firstStatus,
            transient: isTransient,
            message: String(firstErr?.message || '').slice(0, 220),
          });

          if (requestPolicy.strictAi && isTransient) {
            const fallback = await buildAssessmentStyleFallbackSession();
            addTrace('assessment-style', { result: 'transient-fallback', questionCount: fallback.questions.length });
            return sendJson(res, 200, {
              ok: true,
              data: fallback,
              warning: 'AI interview generation is temporarily rate-limited. Using fallback interview questions so user flow can continue.',
              ...withDebug({ result: 'assessment-style-transient-fallback' }),
            });
          }
          if (requestPolicy.strictAi) {
            const fail = classifyAiFailure(firstErr, 'Could not generate interview questions with AI');
            addTrace('assessment-style', { result: 'strict-fail', status: fail.status, error: fail.error });
            return sendJson(res, fail.status, {
              error: fail.error,
              ...withDebug({ result: 'assessment-style-strict-fail' }),
            });
          }

          const fallback = await buildAssessmentStyleFallbackSession();
          addTrace('assessment-style', { result: 'fallback', questionCount: fallback.questions.length });
          return sendJson(res, 200, {
            ok: true,
            data: fallback,
            warning: 'Using fallback interview questions because AI providers are unavailable or budget-limited.',
            ...withDebug({ result: 'assessment-style-fallback' }),
          });
        }
      }
      const dominantInterviewError = (...errors) => {
        const rows = errors
          .flat()
          .filter(Boolean)
          .map((err) => ({
            err,
            status: Number(err?.status || 0),
            message: String(err?.message || '').toLowerCase(),
          }));
        if (!rows.length) return null;
        const rank = (row) => {
          if (row.status === 429) return 1;
          if (row.status === 402) return 2;
          if (row.status === 401 || row.status === 403) return 3;
          if (row.status === 404) return 4;
          if (row.status === 422 || row.message.includes('invalid json')) return 5;
          if (isTimeoutOrAbortMessage(row.message) || row.status === 503 || row.status === 504 || row.status === 408) return 8;
          if (row.status === 0) return 9;
          return 6;
        };
        rows.sort((a, b) => rank(a) - rank(b));
        return rows[0].err || null;
      };
      const defaultInterviewOpenRouterModel = (() => {
        const preferred = modelCandidatesFor('openrouter')
          .map((m) => String(m || '').trim())
          .filter((m) => m.includes('/'));
        if (preferred.includes('openai/gpt-4o-mini')) return 'openai/gpt-4o-mini';
        return preferred[0] || 'openai/gpt-4o-mini';
      })();
      const defaultLocalizedInterviewOpenRouterModel = (() => {
        const preferred = modelCandidatesFor('openrouter')
          .map((m) => String(m || '').trim())
          .filter((m) => m.includes('/'));
        const priority = [
          'openai/gpt-4o-mini',
          'google/gemini-2.5-flash',
          'google/gemini-2.0-flash-001',
          'openai/gpt-4.1-mini',
          'deepseek/deepseek-chat',
          'mistralai/ministral-8b',
          'mistralai/mistral-small-3.2-24b-instruct:free',
          'meta-llama/llama-3.3-70b-instruct:free',
        ];
        for (const candidate of priority) {
          if (preferred.includes(candidate)) return candidate;
        }
        return defaultInterviewOpenRouterModel;
      })();
      const requestedInterviewRouter = { ...(router && typeof router === 'object' ? router : {}) };
      const requestedInterviewModeRaw = normalizeRouterMode(requestedInterviewRouter?.mode || 'auto_thinking');
      const requestedInterviewProvider = String(requestedInterviewRouter?.provider || 'auto').trim().toLowerCase();
      const openRouterAvailableForInterview = providerAvailable('openrouter');
      const openRouterLocalizedLanguageCodes = new Set(['my', 'vi', 'tl', 'km', 'lo']);
      const forceOpenRouterForLanguage = (
        openRouterLocalizedLanguageCodes.has(targetLanguageCode)
        && ['auto', 'openrouter', ''].includes(requestedInterviewProvider)
      );
      const requestedInterviewMode = (
        requestedInterviewModeRaw === 'auto_fast' && forceOpenRouterForLanguage
      )
        ? 'auto_thinking'
        : requestedInterviewModeRaw;
      const manualOpenRouterRequested = (
        requestedInterviewMode === 'manual'
        && requestedInterviewProvider === 'openrouter'
      );
      const autoOpenRouterPreferred = (
        openRouterAvailableForInterview
        && requestedInterviewMode === 'auto_thinking'
      );
      const forcedLocalizedOpenRouter = (
        openRouterAvailableForInterview
        && forceOpenRouterForLanguage
      );
      const useOpenRouterInterview = (
        manualOpenRouterRequested
        || autoOpenRouterPreferred
        || forcedLocalizedOpenRouter
      );
      const manualInterviewModel = (
        requestedInterviewProvider === 'openrouter'
        && String(requestedInterviewRouter?.model || '').includes('/')
      )
        ? String(requestedInterviewRouter.model || '').trim()
        : defaultInterviewOpenRouterModel;
      const interviewRouter = useOpenRouterInterview
        ? {
            ...requestedInterviewRouter,
            mode: 'manual',
            provider: 'openrouter',
            model: manualInterviewModel,
          }
        : requestedInterviewRouter;
      const canUseOpenRouterFastLane = openRouterAvailableForInterview && useOpenRouterInterview;
      const interviewOpenRouterMaxKeys = openRouterInterviewMaxKeys(4);
      const interviewOpenRouterQuickMaxKeys = openRouterInterviewMaxKeys(3);
      const fastRetryRouter = canUseOpenRouterFastLane
        ? {
            ...interviewRouter,
            mode: 'manual',
            provider: 'openrouter',
            model: defaultInterviewOpenRouterModel,
          }
        : interviewRouter;
      const localizedFastRetryRouter = canUseOpenRouterFastLane
        ? {
            ...interviewRouter,
            mode: 'manual',
            provider: 'openrouter',
            model: defaultLocalizedInterviewOpenRouterModel,
          }
        : interviewRouter;
      const fallbackLocalizedInterviewRouter = (() => {
        if (!forceOpenRouterForLanguage || isEnglishInterview) return interviewRouter;
        const requestedManualProvider = (
          requestedInterviewMode === 'manual'
          && requestedInterviewProvider
          && requestedInterviewProvider !== 'auto'
        )
          ? requestedInterviewProvider
          : '';
        const fallbackProviderOrder = [
          requestedManualProvider,
          'mistral',
          'gemini',
          'openai',
          'anthropic',
        ];
        for (const providerName of fallbackProviderOrder) {
          const provider = String(providerName || '').trim().toLowerCase();
          if (!provider || provider === 'openrouter') continue;
          if (!providerAvailable(provider)) continue;
          if (provider === 'mistral') {
            return {
              ...requestedInterviewRouter,
              mode: 'manual',
              provider: 'mistral',
              model: pickAutoFastMistralModel(modelCandidatesFor('mistral')),
            };
          }
          if (provider === 'gemini') {
            const geminiModels = modelCandidatesFor('gemini');
            return {
              ...requestedInterviewRouter,
              mode: 'manual',
              provider: 'gemini',
              model: geminiModels[0] || 'gemini-2.5-flash',
            };
          }
          if (provider === 'openai') {
            const openAiModels = modelCandidatesFor('openai');
            return {
              ...requestedInterviewRouter,
              mode: 'manual',
              provider: 'openai',
              model: openAiModels[0] || 'gpt-4o-mini',
            };
          }
          if (provider === 'anthropic') {
            const anthropicModels = modelCandidatesFor('anthropic');
            return {
              ...requestedInterviewRouter,
              mode: 'manual',
              provider: 'anthropic',
              model: anthropicModels[0] || 'claude-3-5-sonnet-latest',
            };
          }
        }
        return interviewRouter;
      })();
      const shouldBypassInterviewBreaker = (candidateRouter = {}) => {
        const mode = String(candidateRouter?.mode || 'auto').trim().toLowerCase();
        const provider = String(candidateRouter?.provider || 'auto').trim().toLowerCase();
        return mode === 'manual' && provider !== 'auto';
      };
      const buildInterviewSession = (questions = [], roleOverride = null) => {
        const roleSource = roleOverride && typeof roleOverride === 'object'
          ? roleOverride
          : {};
        return {
          role: {
            jobTitle: String(requestedJobTitle).replace(/\s+/g, ' ').trim().slice(0, 120) || requestedJobTitle,
            roleSummary: String(roleSource?.roleSummary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
          },
          questions,
          generatedAt: nowIso(),
        };
      };
      const resolveFastInterviewRole = (source = {}) => {
        const roleRaw = extractInterviewRoleRaw(source);
        return {
          jobTitle: String(requestedJobTitle).replace(/\s+/g, ' ').trim().slice(0, 120) || requestedJobTitle,
          roleSummary: String(roleRaw?.roleSummary || roleRaw?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        };
      };
      const normalizeFastInterviewRows = (rawRows = [], language = 'en-US') => {
        const rows = extractInterviewQuestionRows(rawRows);
        const out = [];
        const seen = new Set();
        for (let idx = 0; idx < rows.length; idx += 1) {
          const row = rows[idx] || {};
          let question = enforceInterviewQuestionText(pickInterviewQuestionText(row), language).slice(0, 500);
          if (!question || question.length < 8) continue;
          if (!/[?ï¼Ÿ]/.test(question) && looksLikeInterviewQuestionText(question)) {
            question = `${question.replace(/[။.。！？!?…]+$/u, '').trim()}?`;
          }
          const key = normalizeInterviewComparableText(question);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: String(row?.id || row?.questionId || `q${out.length + 1}`).slice(0, 80),
            question,
            focus: String(row?.focus || row?.type || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
          });
          if (out.length >= questionCount) break;
        }
        return out;
      };
      const enforceFastInterviewLocale = async (sessionInput = {}, contextTag = 'fast-locale') => {
        const baseRole = resolveFastInterviewRole(sessionInput?.role || sessionInput);
        let session = buildInterviewSession(
          normalizeFastInterviewRows(sessionInput?.questions ?? sessionInput, targetLanguage),
          baseRole
        );
        if (isEnglishInterview || !session.questions.length) return session;
        const roleNeedsLocalization = shouldForceLocalizedTextFallback(String(session?.role?.roleSummary || ''), targetLanguage);
        const questionNeedsLocalization = shouldForceLocalizedQuestionFallback(session.questions, targetLanguage);
        if (!roleNeedsLocalization && !questionNeedsLocalization) return session;
        const localizedSessionRaw = await enforcePreferredLocale(
          session,
          targetLanguageCode,
          interviewRouter,
          `interview-session|${contextTag}|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|focus:${questionFocus}|seniority:${seniority}`
        );
        session = buildInterviewSession(
          normalizeFastInterviewRows(localizedSessionRaw?.questions ?? localizedSessionRaw, targetLanguage),
          resolveFastInterviewRole(localizedSessionRaw?.role || localizedSessionRaw)
        );
        const finalRoleNeedsLocalization = shouldForceLocalizedTextFallback(String(session?.role?.roleSummary || ''), targetLanguage);
        const finalQuestionNeedsLocalization = shouldForceLocalizedQuestionFallback(session.questions, targetLanguage);
        if (finalQuestionNeedsLocalization || !Array.isArray(session.questions) || !session.questions.length) {
          if (
            targetLanguageCode === 'my'
            && Array.isArray(session.questions)
            && canUseSoftBurmeseQuestionSet(session.questions, minQuestionCount)
          ) {
            return session;
          }
          const e = new Error('Localized interview output failed language gate.');
          e.status = 503;
          throw e;
        }
        if (finalRoleNeedsLocalization) {
          session = buildInterviewSession(session.questions, {
            ...session.role,
            roleSummary: '',
          });
        }
        return session;
      };
      const fastGenerationLanguage = targetLanguage;
      const fastGenerationLanguageLabel = targetLanguageLabel;
      const fastPrompt = promptInterviewQuestionsDirect({
        requestedJobTitle,
        targetLanguage: fastGenerationLanguage,
        targetLanguageLabel: fastGenerationLanguageLabel,
        candidateName,
        region: String(profile?.region || profileContext?.region || 'ASEAN').trim() || 'ASEAN',
        profileSkills: profile?.skills,
        profileExperience: profile?.experience,
        questionFocus,
        seniority,
        questionCount,
        strictRetry: false,
      });
      const fastKeyBase = `interview-session|fast|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|gen:${fastGenerationLanguage}|focus:${questionFocus}|seniority:${seniority}|${JSON.stringify(interviewRouter)}`;
      const localizedTransientFallbackQuestions = () => {
        const roleLabel = String(requestedJobTitle || 'ဤရာထူး').trim() || 'ဤရာထူး';
        if (targetLanguageCode === 'my') {
          return [
            {
              id: 'q1',
              question: `${roleLabel} အလုပ်မှာ တိုင်းတာနိုင်တဲ့ ရလဒ် ရခဲ့တဲ့ ပရောဂျက်တစ်ခုကို ဖော်ပြပါ?`,
              focus: 'execution',
            },
            {
              id: 'q2',
              question: `${roleLabel} အလုပ်မှာ အရေးကြီးပြီး အရေးပေါ် အလုပ်တွေကို ဘယ်လို ဦးစားပေးစီမံပါသလဲ?`,
              focus: 'scenario',
            },
            {
              id: 'q3',
              question: `${roleLabel} အတွက် ပထမနေ့မှာ အရေးအကြီးဆုံး ကျွမ်းကျင်မှုတစ်ခုက ဘာလဲ၊ ဘာကြောင့်လဲ?`,
              focus: 'market',
            },
            {
              id: 'q4',
              question: `ဆင်တူတဲ့ အလုပ်တစ်ခုမှာ သင်လုပ်မိခဲ့တဲ့ အမှားတစ်ခုနဲ့ နောက်ပိုင်း ဘာတွေ ပြောင်းလဲခဲ့သလဲ?`,
              focus: 'behavioral',
            },
          ];
        }
        if (targetLanguageCode === 'ms') {
          return [
            {
              id: 'q1',
              question: `Ceritakan satu projek terkini sebagai ${roleLabel} yang menunjukkan hasil boleh diukur?`,
              focus: 'execution',
            },
            {
              id: 'q2',
              question: `Apakah KPI pertama yang anda akan pantau dalam peranan ${roleLabel}, dan sasaran realistik 90 hari anda?`,
              focus: 'scenario',
            },
            {
              id: 'q3',
              question: `Bagaimana anda mengutamakan tugas mendesak dan penting dalam kerja ${roleLabel} tanpa menjejaskan kualiti?`,
              focus: 'execution',
            },
            {
              id: 'q4',
              question: `Kongsi satu kesilapan yang pernah anda lakukan dalam kerja seumpama ini dan perubahan yang anda buat selepas itu?`,
              focus: 'behavioral',
            },
          ];
        }
        return [];
      };
      const buildQuickTransientFallbackSession = async () => {
        const nativeFallback = localizedTransientFallbackQuestions();
        if (nativeFallback.length) {
          return buildInterviewSession(
            nativeFallback.map((row) => ({
              id: String(row?.id || '').slice(0, 80),
              question: enforceInterviewQuestionText(row?.question, targetLanguage).slice(0, 500),
              focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
            })).filter((row) => !!row.question),
            { jobTitle: requestedJobTitle, roleSummary: '' }
          );
        }
        let fallbackQuestions = marketDrivenEnglishFallbackInterviewQuestions(
          requestedJobTitle,
          { jobTitle: requestedJobTitle, roleSummary: '' },
          profile,
          {
            questionFocus,
            roleTrack,
            seniority,
            targetCount: questionCount,
            candidateName: isEnglishInterview ? candidateName : '',
          }
        )
          .map((row, idx) => ({
            id: String(row?.id || `q${idx + 1}`).slice(0, 80),
            question: enforceInterviewQuestionText(row?.question, 'en-US').slice(0, 500),
            focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
          }))
          .filter((row) => !!row.question)
          .slice(0, questionCount);
        if (!fallbackQuestions.length) {
          fallbackQuestions = [
            { id: 'q1', question: `Describe a recent project where you delivered measurable results as ${requestedJobTitle}.`, focus: 'execution' },
            { id: 'q2', question: `How do you prioritize urgent and important tasks in ${requestedJobTitle} work?`, focus: 'scenario' },
            { id: 'q3', question: `Which skill should be strongest for ${requestedJobTitle} on day one, and why?`, focus: 'market' },
            { id: 'q4', question: `Tell me about a mistake you made in similar work and what you changed after that?`, focus: 'behavioral' },
          ].map((row) => ({
            ...row,
            question: enforceInterviewQuestionText(row.question, 'en-US').slice(0, 500),
          }));
        }
        let session = buildInterviewSession(fallbackQuestions, { jobTitle: requestedJobTitle, roleSummary: '' });
        if (!isEnglishInterview) {
          try {
            const localized = await localizeInterviewSessionQuestions(session, targetLanguage);
            session = buildInterviewSession(
              normalizeFastInterviewRows(localized?.questions || session.questions, targetLanguage),
              resolveFastInterviewRole(localized?.role || session.role)
            );
          } catch {
            // keep English fallback if deterministic localization fails
          }
        }
        if (!Array.isArray(session?.questions) || !session.questions.length) {
          session = buildInterviewSession(fallbackQuestions, { jobTitle: requestedJobTitle, roleSummary: '' });
        }
        return session;
      };
      try {
        const localizedOpenRouterFastPath = !isEnglishInterview && forceOpenRouterForLanguage;
        const fastRouteOptions = {
          skipCache: requestPolicy.noCache,
          bypassBreaker: shouldBypassInterviewBreaker(interviewRouter) || requestPolicy.strictAi,
          maxTotalMs: localizedOpenRouterFastPath ? 36000 : 26000,
          maxAttempts: localizedOpenRouterFastPath ? 3 : 2,
          attemptTimeoutMs: localizedOpenRouterFastPath ? 16000 : 12000,
          maxTokens: localizedOpenRouterFastPath ? 520 : 420,
          ...(String(interviewRouter?.provider || '').toLowerCase() === 'openrouter' && interviewOpenRouterMaxKeys > 0
            ? { openRouterMaxKeys: interviewOpenRouterMaxKeys }
            : {}),
        };
        const fastRaw = await routeJsonWithRepair(interviewRouter, fastPrompt, fastKeyBase, {
          passes: 2,
          retryDelayMs: 700,
          maxTotalMs: 30000,
          throwOnError: requestPolicy.strictAi,
          routeOptions: fastRouteOptions,
        });
        let fastSession = buildInterviewSession(
          normalizeFastInterviewRows(fastRaw, fastGenerationLanguage),
          resolveFastInterviewRole(fastRaw)
        );
        if (!Array.isArray(fastSession?.questions) || !fastSession.questions.length) {
          throw new Error('Invalid interview response');
        }
        fastSession = await enforceFastInterviewLocale(fastSession, 'fast-locale');
        if (!Array.isArray(fastSession?.questions) || !fastSession.questions.length) {
          throw new Error('Localized interview response is empty');
        }
        addTrace('session', { result: 'fast-pass-ok', questionCount: fastSession.questions.length });
        return sendJson(res, 200, {
          ok: true,
          data: fastSession,
          ...withDebug({ result: 'fast-pass-ok' }),
        });
      } catch (fastErr) {
        const status = Number(fastErr?.status || 0);
        const message = String(fastErr?.message || '').toLowerCase();
        const isTransient = (
          isRetriableStatus(status)
          || isInterviewValidationFailure(fastErr)
          || isModelUnavailableFailure(fastErr)
          || message.includes('rate')
          || message.includes('quota')
          || message.includes('busy')
          || isTimeoutOrAbortMessage(message)
        );
        addTrace('fast-fail', {
          status,
          message: String(fastErr?.message || '').slice(0, 260),
          transient: isTransient,
        });
        if (isTransient) {
          if (!isEnglishInterview) {
            addTrace('session', {
              result: 'fast-transient-continue',
              status,
            });
          } else {
            const fallbackSession = await buildQuickTransientFallbackSession();
            addTrace('session', {
              result: 'fast-transient-fallback',
              status,
              questionCount: Array.isArray(fallbackSession?.questions) ? fallbackSession.questions.length : 0,
            });
            return sendJson(res, 200, {
              ok: true,
              data: fallbackSession,
              warning: 'AI interview generation is temporarily rate-limited. Using fallback interview questions so user flow can continue.',
              ...withDebug({ result: 'fast-transient-fallback' }),
            });
          }
        } else {
          const fail = classifyAiFailure(fastErr, 'Could not generate interview questions with AI');
          addTrace('session', { result: 'fast-fail-no-fallback', error: fail.error, status: fail.status });
          return sendJson(res, fail.status, {
            ok: false,
            error: fail.error,
            ...withDebug({ rootCause: 'fast-fail-no-fallback' }),
          });
        }
      }
      const localizeInterviewSession = async (session, stage = 'localize') => localizeInterviewSessionQuestions(
        session,
        targetLanguage,
        {
          router: localizedFastRetryRouter,
          keyBase: `interview-session|${stage}|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|focus:${questionFocus}|seniority:${seniority}`,
        }
      );
      const buildDeterministicFallbackQuestions = async () => {
        const fallbackRoleContext = isEnglishInterview
          ? roleBlueprint
          : fallbackInterviewRole(requestedJobTitle, profile, 'en-US');
        const fallbackBase = marketDrivenEnglishFallbackInterviewQuestions(
          requestedJobTitle,
          fallbackRoleContext,
          profile,
          {
            questionFocus,
            roleTrack,
            seniority,
            targetCount: questionCount,
            candidateName: isEnglishInterview ? candidateName : '',
          }
        );
        const normalizeFallbackRows = (rows = [], language = 'en-US') => normalizeAiOnlyInterviewQuestions(rows, language, questionCount)
          .map((row, idx) => ({
            id: String(row?.id || `q${idx + 1}`),
            question: enforceInterviewQuestionText(row?.question, language),
            focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
          }))
          .filter((row) => !!row.question);
        let fallbackQuestions = normalizeFallbackRows(fallbackBase, 'en-US');
        if (!isEnglishInterview && fallbackQuestions.length) {
          const localizedSession = await localizeInterviewSession(
            buildInterviewSession(fallbackQuestions),
            'fallback-localize'
          );
          if (localizedSession && Array.isArray(localizedSession.questions) && localizedSession.questions.length) {
            fallbackQuestions = normalizeFallbackRows(localizedSession.questions, targetLanguage);
          } else {
            fallbackQuestions = normalizeFallbackRows(fallbackQuestions, 'en-US');
          }
        } else {
          fallbackQuestions = normalizeFallbackRows(fallbackQuestions, 'en-US');
        }
        if (!isEnglishInterview && shouldForceLocalizedQuestionFallback(fallbackQuestions, targetLanguage)) {
          const nativeFallback = normalizeFallbackRows(localizedTransientFallbackQuestions(), targetLanguage);
          if (nativeFallback.length) {
            fallbackQuestions = nativeFallback;
          }
        }
        if (!fallbackQuestions.length) {
          fallbackQuestions = fallbackBase
            .map((row, idx) => ({
              id: String(row?.id || `q${idx + 1}`).slice(0, 80),
              question: enforceInterviewQuestionText(row?.question, isEnglishInterview ? 'en-US' : targetLanguage).slice(0, 500),
              focus: String(row?.focus || 'general').replace(/\s+/g, ' ').trim().slice(0, 80) || 'general',
            }))
            .filter((row) => !!row.question)
            .slice(0, Math.max(4, Math.min(questionCount, 8)));
        }
        if (!fallbackQuestions.length) {
          fallbackQuestions = [
            { id: 'q1', question: enforceInterviewQuestionText(`Describe a recent project where you delivered measurable results as ${requestedJobTitle}.`, isEnglishInterview ? 'en-US' : targetLanguage), focus: 'execution' },
            { id: 'q2', question: enforceInterviewQuestionText(`How do you prioritize urgent and important tasks in ${requestedJobTitle} work?`, isEnglishInterview ? 'en-US' : targetLanguage), focus: 'scenario' },
            { id: 'q3', question: enforceInterviewQuestionText(`Which skill should be strongest for ${requestedJobTitle} on day one, and why?`, isEnglishInterview ? 'en-US' : targetLanguage), focus: 'market' },
            { id: 'q4', question: enforceInterviewQuestionText(`Tell me about a mistake you made in similar work and what you changed after that?`, isEnglishInterview ? 'en-US' : targetLanguage), focus: 'behavioral' },
          ];
        }
        return fallbackQuestions;
      };
      const canReturnFirstPassQuestions = (result) => {
        if (!result || !Array.isArray(result.questions) || !result.questions.length) return false;
        if (result.questions.length < minQuestionCount) return false;
        const reason = String(result?.quality?.reason || '').toLowerCase();
        if (!reason) return true;
        if (targetLanguageCode === 'my' && ['off_role', 'too_generic'].includes(reason)) return true;
        if (
          targetLanguageCode === 'my'
          && ['language_mismatch', 'off_role', 'too_generic'].includes(reason)
          && canUseSoftBurmeseQuestionSet(result.questions, minQuestionCount)
        ) {
          return true;
        }
        if (['empty', 'too_few', 'missing_question_mark', 'language_mismatch', 'off_role', 'too_generic'].includes(reason)) return false;
        return true;
      };
      const tryLocalizeFirstPassQuestions = async (result) => {
        if (isEnglishInterview) return null;
        if (!result || !Array.isArray(result.questions) || !result.questions.length) return null;
        const reason = String(result?.quality?.reason || '').toLowerCase();
        if (reason !== 'language_mismatch') return null;
        const localized = await localizeInterviewSession(
          buildInterviewSession(result.questions),
          'first-pass-localize'
        );
        if (!localized || !Array.isArray(localized.questions) || localized.questions.length < minQuestionCount) return null;
        const localizedQuality = evaluateAiOnlyInterviewQuestions(
          localized.questions,
          requestedJobTitle,
          targetLanguage,
          minQuestionCount
        );
        if (!localizedQuality.ok) return null;
        return localized.questions;
      };
      const tryEnglishBridgeLocalization = async () => {
        if (isEnglishInterview) return null;
        try {
          const bridgePrompt = promptInterviewQuestionsDirect({
            requestedJobTitle,
            targetLanguage: 'en-US',
            targetLanguageLabel: 'English',
            candidateName,
            region: String(profile?.region || profileContext?.region || 'ASEAN').trim() || 'ASEAN',
            profileSkills: profile?.skills,
            profileExperience: profile?.experience,
            questionFocus,
            seniority,
            questionCount,
            strictRetry: false,
          });
          const bridgeRouter = providerAvailable('openrouter') ? fastRetryRouter : interviewRouter;
          const bridgeKey = sha256(
            `interview-session|bridge-localize|${accountId}|${requestedJobTitle}|target:${targetLanguage}|focus:${questionFocus}|seniority:${seniority}|${JSON.stringify(bridgeRouter)}`
          );
          const bridgeRaw = await routeJsonWithRepair(bridgeRouter, bridgePrompt, bridgeKey, {
            passes: 2,
            retryDelayMs: 650,
            maxTotalMs: 10000,
            throwOnError: true,
            routeOptions: {
              skipCache: requestPolicy.noCache,
              bypassBreaker: shouldBypassInterviewBreaker(bridgeRouter),
              maxTotalMs: 10000,
              maxAttempts: 2,
              attemptTimeoutMs: 5000,
              maxTokens: 320,
              ...(String(bridgeRouter?.provider || '').toLowerCase() === 'openrouter' && interviewOpenRouterQuickMaxKeys > 0
                ? { openRouterMaxKeys: interviewOpenRouterQuickMaxKeys }
                : {}),
            },
          });
          const bridgeQuestions = normalizeAiOnlyInterviewQuestions(bridgeRaw, 'en-US', questionCount);
          const bridgeQuality = evaluateAiOnlyInterviewQuestions(
            bridgeQuestions,
            requestedJobTitle,
            'en-US',
            minQuestionCount
          );
          const bridgeResult = { questions: bridgeQuestions, quality: bridgeQuality };
          if (!bridgeQuality.ok && !canReturnFirstPassQuestions(bridgeResult)) return null;
          const localized = await localizeInterviewSession(
            buildInterviewSession(bridgeQuestions),
            'bridge-localize'
          );
          if (!localized || !Array.isArray(localized.questions) || localized.questions.length < minQuestionCount) return null;
          const localizedQuality = evaluateAiOnlyInterviewQuestions(
            localized.questions,
            requestedJobTitle,
            targetLanguage,
            minQuestionCount
          );
          if (!localizedQuality.ok) return null;
          return localized.questions;
        } catch {
          return null;
        }
      };
      const tryTimeoutRecoveryGeneration = async () => {
        const localizedRecoveryRouter = (
          !isEnglishInterview
          && forceOpenRouterForLanguage
          && String(fallbackLocalizedInterviewRouter?.provider || '').toLowerCase() !== 'openrouter'
        )
          ? fallbackLocalizedInterviewRouter
          : null;
        const recoveryRouter = localizedRecoveryRouter || (
          providerAvailable('openrouter')
            ? (isEnglishInterview ? fastRetryRouter : localizedFastRetryRouter)
            : interviewRouter
        );
        const recoveryGenerationLanguage = isEnglishInterview ? targetLanguage : 'en-US';
        const recoveryGenerationLanguageLabel = isEnglishInterview ? targetLanguageLabel : 'English';
        const recoveryPrompt = promptInterviewQuestionsDirect({
          requestedJobTitle,
          targetLanguage: recoveryGenerationLanguage,
          targetLanguageLabel: recoveryGenerationLanguageLabel,
          candidateName,
          region: String(profile?.region || profileContext?.region || 'ASEAN').trim() || 'ASEAN',
          profileSkills: profile?.skills,
          profileExperience: profile?.experience,
          questionFocus,
          seniority,
          questionCount,
          strictRetry: true,
        });
        const recoveryKey = sha256(
          `interview-session|timeout-recovery|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|focus:${questionFocus}|seniority:${seniority}|${JSON.stringify(recoveryRouter)}`
        );
        const startedAt = Date.now();
        try {
          const raw = await routeJsonWithRepair(recoveryRouter, recoveryPrompt, recoveryKey, {
            passes: 2,
            retryDelayMs: 600,
            maxTotalMs: isEnglishInterview ? 20000 : 22000,
            throwOnError: true,
            routeOptions: {
              skipCache: requestPolicy.noCache,
              bypassBreaker: shouldBypassInterviewBreaker(recoveryRouter),
              maxTotalMs: isEnglishInterview ? 20000 : 22000,
              maxAttempts: shouldBypassInterviewBreaker(recoveryRouter) ? 1 : 2,
              attemptTimeoutMs: isEnglishInterview ? 18000 : 20000,
              maxTokens: isEnglishInterview ? 320 : 360,
              ...(String(recoveryRouter?.provider || '').toLowerCase() === 'openrouter' && interviewOpenRouterQuickMaxKeys > 0
                ? { openRouterMaxKeys: interviewOpenRouterQuickMaxKeys }
                : {}),
            },
          });
          let questions = normalizeAiOnlyInterviewQuestions(raw, recoveryGenerationLanguage, questionCount);
          if (!isEnglishInterview && questions.length) {
            const localized = await localizeInterviewSession(
              buildInterviewSession(questions),
              'timeout-recovery-localize'
            );
            if (localized && Array.isArray(localized.questions)) {
              questions = normalizeAiOnlyInterviewQuestions(localized.questions, targetLanguage, questionCount);
            }
          }
          const quality = evaluateAiOnlyInterviewQuestions(
            questions,
            requestedJobTitle,
            targetLanguage,
            minQuestionCount
          );
          addTrace('timeout-recovery', {
            ok: !!quality?.ok,
            durationMs: Date.now() - startedAt,
            questionCount: Array.isArray(questions) ? questions.length : 0,
            quality: String(quality?.reason || ''),
            router: {
              mode: String(recoveryRouter?.mode || 'auto'),
              provider: String(recoveryRouter?.provider || 'auto'),
              model: String(recoveryRouter?.model || 'auto'),
            },
          });
          if (quality.ok) return questions;
          if (canReturnFirstPassQuestions({ questions, quality })) return questions;
          return null;
        } catch (recoveryErr) {
          addTrace('timeout-recovery', {
            ok: false,
            durationMs: Date.now() - startedAt,
            status: Number(recoveryErr?.status || 0),
            message: String(recoveryErr?.message || '').slice(0, 260),
            router: {
              mode: String(recoveryRouter?.mode || 'auto'),
              provider: String(recoveryRouter?.provider || 'auto'),
              model: String(recoveryRouter?.model || 'auto'),
            },
          });
          return null;
        }
      };
      const runInterviewGeneration = async (strictRetry = false, forceFastRouter = false) => {
        const useFastRouter = forceFastRouter || (canUseOpenRouterFastLane && !isEnglishInterview && !strictRetry);
        const diversifiedLocalizedRetryRouter = (
          strictRetry
          && !isEnglishInterview
          && forceOpenRouterForLanguage
          && String(fallbackLocalizedInterviewRouter?.provider || '').toLowerCase() !== 'openrouter'
        )
          ? fallbackLocalizedInterviewRouter
          : interviewRouter;
        const activeRouter = useFastRouter
          ? (isEnglishInterview ? fastRetryRouter : localizedFastRetryRouter)
          : diversifiedLocalizedRetryRouter;
        const localLanguageMode = !isEnglishInterview;
        const routerMode = String(activeRouter?.mode || 'auto').trim().toLowerCase();
        const routerProvider = String(activeRouter?.provider || 'auto').trim().toLowerCase();
        const autoRouting = routerMode !== 'manual' || routerProvider === 'auto';
        const manualPinnedRouter = !autoRouting;
        let maxTotalMs = strictRetry
          ? (localLanguageMode ? (manualPinnedRouter ? 16000 : 22000) : (manualPinnedRouter ? 14000 : 20000))
          : (localLanguageMode ? (manualPinnedRouter ? 22000 : 32000) : (manualPinnedRouter ? 20000 : 28000));
        let attemptTimeoutMs = strictRetry
          ? (localLanguageMode ? (manualPinnedRouter ? 7000 : 8500) : (manualPinnedRouter ? 6500 : 8000))
          : (localLanguageMode ? (manualPinnedRouter ? 9000 : 11000) : (manualPinnedRouter ? 8500 : 10000));
        let maxAttempts = manualPinnedRouter
          ? (strictRetry ? 1 : 2)
          : (localLanguageMode ? (strictRetry ? 3 : 4) : (strictRetry ? 2 : 3));
        if (localLanguageMode && forceOpenRouterForLanguage) {
          if (strictRetry) {
            maxTotalMs = Math.max(maxTotalMs, manualPinnedRouter ? 26000 : 28000);
            attemptTimeoutMs = Math.max(attemptTimeoutMs, manualPinnedRouter ? 12000 : 13000);
            maxAttempts = Math.max(maxAttempts, manualPinnedRouter ? 2 : 3);
          } else {
            maxTotalMs = Math.max(maxTotalMs, manualPinnedRouter ? 36000 : 38000);
            attemptTimeoutMs = Math.max(attemptTimeoutMs, manualPinnedRouter ? 15000 : 16000);
            maxAttempts = Math.max(maxAttempts, manualPinnedRouter ? 3 : 4);
          }
        }
        const maxTokens = strictRetry
          ? (localLanguageMode ? 560 : 520)
          : (localLanguageMode ? 680 : 620);
        const openRouterMaxKeys = String(activeRouter?.provider || '').toLowerCase() === 'openrouter'
          ? interviewOpenRouterMaxKeys
          : 0;
        const startedAt = Date.now();
        const generationMeta = {
          strictRetry: !!strictRetry,
          useFastRouter: !!useFastRouter,
          localLanguageMode: !!localLanguageMode,
          router: {
            mode: String(activeRouter?.mode || 'auto'),
            provider: String(activeRouter?.provider || 'auto'),
            model: String(activeRouter?.model || 'auto'),
          },
          limits: {
            maxTotalMs,
            maxAttempts,
            attemptTimeoutMs,
            maxTokens,
            openRouterMaxKeys,
          },
        };
        const generationLanguage = isEnglishInterview ? targetLanguage : 'en-US';
        const generationLanguageLabel = isEnglishInterview ? targetLanguageLabel : 'English';
        const prompt = promptInterviewQuestionsDirect({
          requestedJobTitle,
          targetLanguage: generationLanguage,
          targetLanguageLabel: generationLanguageLabel,
          candidateName,
          region: String(profile?.region || profileContext?.region || 'ASEAN').trim() || 'ASEAN',
          profileSkills: profile?.skills,
          profileExperience: profile?.experience,
          questionFocus,
          seniority,
          questionCount,
          strictRetry,
        });
        const key = sha256(
          `interview-session|ai-only|${accountId}|${requestedJobTitle}|lang:${targetLanguage}|gen:${generationLanguage}|focus:${questionFocus}|seniority:${seniority}|strict:${strictRetry ? '1' : '0'}|fast:${forceFastRouter ? '1' : '0'}|p:${sha256(prompt).slice(0, 12)}|${JSON.stringify(activeRouter)}`
        );
        // Match assessment flow: route JSON with repair before normalization.
        let raw = null;
        try {
          raw = await routeJsonWithRepair(activeRouter, prompt, key, {
            passes: strictRetry ? 2 : 3,
            retryDelayMs: strictRetry ? 600 : 900,
            maxTotalMs,
            throwOnError: true,
            routeOptions: {
              skipCache: requestPolicy.noCache,
              bypassBreaker: shouldBypassInterviewBreaker(activeRouter),
              maxTotalMs,
              maxAttempts,
              attemptTimeoutMs,
              maxTokens,
              ...(openRouterMaxKeys > 0 ? { openRouterMaxKeys } : {}),
            },
          });
        } catch (routeErr) {
          routeErr.interviewMeta = {
            ...generationMeta,
            durationMs: Date.now() - startedAt,
          };
          throw routeErr;
        }
        if (!raw) {
          const emptyErr = new Error('Interview question generation returned no JSON payload.');
          emptyErr.status = 503;
          emptyErr.interviewMeta = {
            ...generationMeta,
            durationMs: Date.now() - startedAt,
          };
          throw emptyErr;
        }
        let questions = normalizeAiOnlyInterviewQuestions(raw, generationLanguage, questionCount);
        if (!isEnglishInterview && questions.length) {
          const localized = await localizeInterviewSession(
            buildInterviewSession(questions),
            strictRetry ? 'retry-pass-localize' : 'first-pass-localize'
          );
          if (localized && Array.isArray(localized.questions)) {
            questions = normalizeAiOnlyInterviewQuestions(localized.questions, targetLanguage, questionCount);
          }
        }
        const quality = evaluateAiOnlyInterviewQuestions(
          questions,
          requestedJobTitle,
          targetLanguage,
          minQuestionCount
        );
        return {
          questions,
          quality,
          meta: {
            ...generationMeta,
            durationMs: Date.now() - startedAt,
          },
        };
      };
      const shouldRetryInterviewGenerationError = (err) => {
        const status = Number(err?.status || 0);
        const message = String(err?.message || '').toLowerCase();
        return (
          isInterviewValidationFailure(err)
          || isModelUnavailableFailure(err)
          ||
          isTimeoutOrAbortMessage(message)
          || message.includes('invalid json')
          || isRetriableStatus(status)
          || status === 0
        );
      };
      let first = null;
      let firstErr = null;
      try {
        first = await runInterviewGeneration(false, false);
        addTrace('first', {
          ok: true,
          durationMs: Number(first?.meta?.durationMs || 0),
          questionCount: Array.isArray(first?.questions) ? first.questions.length : 0,
          quality: String(first?.quality?.reason || 'ok'),
          router: first?.meta?.router || null,
          limits: first?.meta?.limits || null,
        });
      } catch (firstAttemptErr) {
        firstErr = firstAttemptErr;
        const firstMeta = firstErr?.interviewMeta || {};
        addTrace('first', {
          ok: false,
          durationMs: Number(firstMeta?.durationMs || 0),
          status: Number(firstErr?.status || 0),
          message: String(firstErr?.message || '').slice(0, 260),
          router: firstMeta?.router || null,
          limits: firstMeta?.limits || null,
        });
        if (!shouldRetryInterviewGenerationError(firstErr)) {
          const fail = classifyAiFailure(firstErr, 'Could not generate interview questions with AI');
          return sendJson(res, fail.status, {
            error: fail.error,
            ...withDebug({ rootCause: 'first-non-retriable' }),
          });
        }
      }
      if (first?.quality?.ok) {
        addTrace('session', { result: 'first-pass-ok' });
        return sendJson(res, 200, {
          ok: true,
          data: buildInterviewSession(first.questions),
          ...withDebug({ result: 'first-pass-ok' }),
        });
      }
      try {
        const retry = await runInterviewGeneration(true, isEnglishInterview);
        addTrace('retry', {
          ok: true,
          durationMs: Number(retry?.meta?.durationMs || 0),
          questionCount: Array.isArray(retry?.questions) ? retry.questions.length : 0,
          quality: String(retry?.quality?.reason || 'ok'),
          router: retry?.meta?.router || null,
          limits: retry?.meta?.limits || null,
        });
        if (retry.quality.ok) {
          addTrace('session', { result: 'retry-pass-ok' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(retry.questions),
            ...withDebug({ result: 'retry-pass-ok' }),
          });
        }
        const localizedFirstQuestions = await tryLocalizeFirstPassQuestions(first);
        if (localizedFirstQuestions) {
          addTrace('session', { result: 'localize-first-pass' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(localizedFirstQuestions),
            warning: 'Local language rescue mode used first-pass AI questions localized to target language.',
            ...withDebug({ result: 'localize-first-pass' }),
          });
        }
        if (canReturnFirstPassQuestions(first)) {
          addTrace('session', { result: 'return-first-pass-after-retry-quality-fail' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(first.questions),
            warning: 'Returning first-pass AI questions because retry quality did not improve.',
            ...withDebug({ result: 'return-first-pass-after-retry-quality-fail' }),
          });
        }
        const bridgeQuestions = await tryEnglishBridgeLocalization();
        if (bridgeQuestions) {
          addTrace('session', { result: 'english-bridge-localization' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(bridgeQuestions),
            warning: 'Localized interview questions were generated via English bridge recovery.',
            ...withDebug({ result: 'english-bridge-localization' }),
          });
        }
        const qualityFallbackQuestions = await buildDeterministicFallbackQuestions();
        addTrace('session', { result: 'quality-fallback-deterministic' });
        return sendJson(res, 200, {
          ok: true,
          data: buildInterviewSession(qualityFallbackQuestions),
          warning: 'AI output was too generic/off-role; using fallback interview questions tuned to the requested role.',
          ...withDebug({ result: 'quality-fallback-deterministic' }),
        });
      } catch (e) {
        const retryMeta = e?.interviewMeta || {};
        addTrace('retry', {
          ok: false,
          durationMs: Number(retryMeta?.durationMs || 0),
          status: Number(e?.status || 0),
          message: String(e?.message || '').slice(0, 260),
          router: retryMeta?.router || null,
          limits: retryMeta?.limits || null,
        });
        const message = String(e?.message || '').toLowerCase();
        if (isTimeoutOrAbortMessage(message)) {
          const localizedFirstQuestions = await tryLocalizeFirstPassQuestions(first);
          if (localizedFirstQuestions) {
            addTrace('session', { result: 'timeout-localize-first-pass' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(localizedFirstQuestions),
              warning: 'Local language rescue mode used first-pass AI questions localized to target language.',
              ...withDebug({ result: 'timeout-localize-first-pass' }),
            });
          }
          if (canReturnFirstPassQuestions(first)) {
            addTrace('session', { result: 'timeout-return-first-pass' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(first.questions),
              warning: 'Retry timed out, returning first-pass AI questions.',
              ...withDebug({ result: 'timeout-return-first-pass' }),
            });
          }
          const bridgeQuestions = await tryEnglishBridgeLocalization();
          if (bridgeQuestions) {
            addTrace('session', { result: 'timeout-english-bridge-localization' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(bridgeQuestions),
              warning: 'Localized interview questions were generated via English bridge recovery.',
              ...withDebug({ result: 'timeout-english-bridge-localization' }),
            });
          }
          const recoveryQuestions = await tryTimeoutRecoveryGeneration();
          if (recoveryQuestions) {
            addTrace('session', { result: 'timeout-recovery-generation' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(recoveryQuestions),
              warning: 'Provider responded during timeout recovery pass.',
              ...withDebug({ result: 'timeout-recovery-generation' }),
            });
          }
          const rootErr = dominantInterviewError(firstErr, e);
          if (
            rootErr
            && !isTimeoutOrAbortMessage(String(rootErr?.message || '').toLowerCase())
            && !isInterviewValidationFailure(rootErr)
            && !isModelUnavailableFailure(rootErr)
          ) {
            const fail = classifyAiFailure(rootErr, 'Could not generate interview questions with AI');
            addTrace('root-cause', {
              status: fail.status,
              error: fail.error,
              selected: 'dominant-over-timeout',
            });
            return sendJson(res, fail.status, {
              error: fail.error,
              ...withDebug({ rootCause: 'dominant-over-timeout' }),
            });
          }
          const timeoutFallbackQuestions = await buildDeterministicFallbackQuestions();
          addTrace('session', { result: 'timeout-deterministic-fallback' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(timeoutFallbackQuestions),
            warning: 'AI provider timed out; using fallback interview questions tuned to the requested role.',
            ...withDebug({ result: 'timeout-deterministic-fallback' }),
          });
        }
        if (isRetriableStatus(Number(e?.status || 0)) || isInterviewValidationFailure(e) || isModelUnavailableFailure(e)) {
          const localizedFirstQuestions = await tryLocalizeFirstPassQuestions(first);
          if (localizedFirstQuestions) {
            addTrace('session', { result: 'retriable-localize-first-pass' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(localizedFirstQuestions),
              warning: 'Local language rescue mode used first-pass AI questions localized to target language.',
              ...withDebug({ result: 'retriable-localize-first-pass' }),
            });
          }
          if (canReturnFirstPassQuestions(first)) {
            addTrace('session', { result: 'retriable-return-first-pass' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(first.questions),
              warning: 'Retry failed on provider pressure, returning first-pass AI questions.',
              ...withDebug({ result: 'retriable-return-first-pass' }),
            });
          }
          const bridgeQuestions = await tryEnglishBridgeLocalization();
          if (bridgeQuestions) {
            addTrace('session', { result: 'retriable-english-bridge-localization' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(bridgeQuestions),
              warning: 'Localized interview questions were generated via English bridge recovery.',
              ...withDebug({ result: 'retriable-english-bridge-localization' }),
            });
          }
          const recoveryQuestions = await tryTimeoutRecoveryGeneration();
          if (recoveryQuestions) {
            addTrace('session', { result: 'retriable-timeout-recovery-generation' });
            return sendJson(res, 200, {
              ok: true,
              data: buildInterviewSession(recoveryQuestions),
              warning: 'Provider responded during timeout recovery pass.',
              ...withDebug({ result: 'retriable-timeout-recovery-generation' }),
            });
          }
          const retriableFallbackQuestions = await buildDeterministicFallbackQuestions();
          addTrace('session', { result: 'retriable-deterministic-fallback' });
          return sendJson(res, 200, {
            ok: true,
            data: buildInterviewSession(retriableFallbackQuestions),
            warning: 'AI provider is under pressure; using fallback interview questions tuned to the requested role.',
            ...withDebug({ result: 'retriable-deterministic-fallback' }),
          });
        }
        const rootErr = dominantInterviewError(firstErr, e) || e;
        const fail = classifyAiFailure(rootErr, 'Could not generate interview questions with AI');
        addTrace('final-fail', {
          status: fail.status,
          error: fail.error,
        });
        return sendJson(res, fail.status, {
          error: fail.error,
          ...withDebug({ rootCause: 'final-fail' }),
        });
      }
    }

    if (pathname === '/api/interview/feedback') {
      const role = body?.role && typeof body.role === 'object' ? body.role : {};
      const questionId = String(body?.questionId || '').trim() || 'q';
      const question = String(body?.question || '').replace(/\s+/g, ' ').trim();
      const answer = String(body?.answer || '').trim();
      const answerMode = String(body?.answerMode || 'text').trim().toLowerCase() === 'voice' ? 'voice' : 'text';
      if (!question || !answer) return sendJson(res, 400, { error: 'question and answer required' });
      const roleTitle = String(role?.jobTitle || 'target role').trim() || 'target role';
      const targetLanguage = String(body?.targetLanguage || profileContext?.preferredLanguage || 'en-US').trim() || 'en-US';
      const targetLanguageLabel = interviewLanguageLabel(targetLanguage);
      const voiceMeta = body?.voiceMeta && typeof body.voiceMeta === 'object' ? body.voiceMeta : {};
      const voiceHints = answerMode === 'voice'
        ? `Voice transcript hints:
- confidence: ${Number(voiceMeta?.confidence || 0).toFixed(2)}
- fillerCount: ${Math.max(0, Math.floor(Number(voiceMeta?.fillerCount || 0)))}
- wordCount: ${Math.max(0, Math.floor(Number(voiceMeta?.wordCount || 0)))}`
        : 'Voice transcript hints: N/A (text answer)';
      const roleBlock = [
        `Job title: ${roleTitle}`,
        `Role summary: ${String(role?.roleSummary || '').trim() || 'N/A'}`,
        `Responsibilities: ${normalizeInterviewList(role?.responsibilities, 20, 220).join(' | ') || 'N/A'}`,
        `Requirements: ${normalizeInterviewList(role?.requirements, 20, 220).join(' | ') || 'N/A'}`,
      ].join('\n');
      const prompt = `Return ONLY valid JSON (no markdown, no extra text).

You are a blunt but constructive interview coach.
Analyze the candidate answer for this interview question.
Write human, practical coaching, not robotic AI style.
If language/tone hurts candidate perception, say it directly and explain impact.
Write all output fields in ${targetLanguageLabel}.
Feedback and sampleResponse must be in ${targetLanguageLabel} only.

Role context:
${roleBlock}

Question:
${question}

Candidate answer (${answerMode}):
${answer}

${voiceHints}

Output JSON shape:
{
  "questionId": string,
  "feedback": string,
  "sampleResponse": string,
  "toneFeedback": string,
  "grammarFeedback": string,
  "pronunciationFeedback": string,
  "riskFlags": string[],
  "score": number
}`;
      const keyBase = `interview-feedback|${accountId}|${roleTitle}|${questionId}|${sha256(answer)}|${answerMode}|lang:${targetLanguage}|${JSON.stringify(router)}`;
      const raw = await routeJsonWithRepair(router, prompt, keyBase, {
        passes: 2,
        retryDelayMs: 900,
        maxTotalMs: 30000,
        throwOnError: false,
        routeOptions: { skipCache: requestPolicy.noCache, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 28000, maxAttempts: 6 },
      });
      const feedback = normalizeInterviewFeedback(raw || {}, questionId, targetLanguage);
      return sendJson(res, 200, {
        ok: true,
        data: feedback,
        ...(raw ? {} : { warning: 'Using fallback answer feedback because AI output was unavailable.' }),
      });
    }

    if (pathname === '/api/interview/final-review') {
      const role = body?.role && typeof body.role === 'object' ? body.role : {};
      const targetLanguage = String(body?.targetLanguage || profileContext?.preferredLanguage || 'en-US').trim() || 'en-US';
      const targetLanguageLabel = interviewLanguageLabel(targetLanguage);
      const items = Array.isArray(body?.items) ? body.items : [];
      const preparedItems = items
        .map((item) => ({
          questionId: String(item?.questionId || '').trim(),
          question: String(item?.question || '').replace(/\s+/g, ' ').trim(),
          answer: String(item?.answer || '').trim(),
          feedback: String(item?.feedback || '').trim(),
          sampleResponse: String(item?.sampleResponse || '').trim(),
        }))
        .filter((item) => item.question && item.answer);
      if (!preparedItems.length) return sendJson(res, 400, { error: 'At least one answered question is required' });
      const roleTitle = String(role?.jobTitle || 'target role').trim() || 'target role';
      const qaBlock = preparedItems
        .slice(0, 30)
        .map((item, idx) => `#${idx + 1}\nQuestion: ${item.question}\nAnswer: ${item.answer}\nPrior feedback: ${item.feedback || 'N/A'}\nSample response: ${item.sampleResponse || 'N/A'}`)
        .join('\n\n');
      const prompt = `Return ONLY valid JSON (no markdown, no extra text).

You are an interview coach writing final candid feedback after a mock interview.
Be human, direct, and practical. Avoid generic AI wording.
Write all output fields in ${targetLanguageLabel}.

Role context:
- Job title: ${roleTitle}
- Role summary: ${String(role?.roleSummary || '').trim() || 'N/A'}
- Key responsibilities: ${normalizeInterviewList(role?.responsibilities, 20, 220).join(' | ') || 'N/A'}
- Key requirements: ${normalizeInterviewList(role?.requirements, 20, 220).join(' | ') || 'N/A'}

Interview transcript:
${qaBlock}

Output JSON shape:
{
  "summary": string,
  "strengths": string[],
  "improvements": string[],
  "hiringRiskNotes": string[],
  "nextSteps": string[]
}`;
      const keyBase = `interview-final|${accountId}|${roleTitle}|${sha256(qaBlock)}|lang:${targetLanguage}|${JSON.stringify(router)}`;
      const raw = await routeJsonWithRepair(router, prompt, keyBase, {
        passes: 2,
        retryDelayMs: 1000,
        maxTotalMs: 40000,
        throwOnError: false,
        routeOptions: { skipCache: requestPolicy.noCache, bypassBreaker: requestPolicy.strictAi, maxTotalMs: 36000, maxAttempts: 7 },
      });
      const finalReview = normalizeInterviewFinalReview(raw || {}, targetLanguage);
      return sendJson(res, 200, {
        ok: true,
        data: finalReview,
        ...(raw ? {} : { warning: 'Using fallback final review because AI output was unavailable.' }),
      });
    }

    return sendJson(res, 404, { error: 'Unknown endpoint' });

  } catch (e) {
    const status = e.status && Number.isFinite(e.status) ? e.status : 500;
    const msg = String(e?.message || 'Server error');
    const debugPayload = e && typeof e === 'object' && e.debug && typeof e.debug === 'object'
      ? { debug: e.debug }
      : {};
    if (status === 402 || isOpenRouterBudgetError(status, msg)) {
      return sendJson(res, 402, {
        error: 'Generation exceeds current token/credit budget. Reduce output tokens or top up provider credits.',
        ...debugPayload,
      });
    }
    return sendJson(res, status, { error: msg, ...debugPayload });
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
  if (name === 'profile-career-guidance') return '/api/profile/career-guidance';
  if (name === 'profile-career-guidance-role') return '/api/profile/career-guidance/role';
  if (name === 'generate-assessment') return '/api/generate/assessment';
  if (name === 'generate-course-outline') return '/api/generate/course-outline';
  if (name === 'generate-module-lesson-plan') return '/api/generate/module-lesson-plan';
  if (name === 'generate-step-content') return '/api/generate/step-content';
  if (name === 'interview-recommendations') return '/api/interview/recommendations';
  if (name === 'interview-session') return '/api/interview/session';
  if (name === 'interview-transcribe') return '/api/interview/transcribe';
  if (name === 'interview-feedback') return '/api/interview/feedback';
  if (name === 'interview-final-review') return '/api/interview/final-review';
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
    console.log(`OpenRouter keys loaded: ${openRouterApiKeys().length} | Mistral keys loaded: ${mistralApiKeys().length}`);
  });
}
