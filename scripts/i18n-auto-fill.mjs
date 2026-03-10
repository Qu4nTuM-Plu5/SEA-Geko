import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const LOCALES_DIR = path.join(ROOT, 'src', 'locales');
const SOURCE_LOCALE = 'en';
const DEFAULT_TARGETS = ['id', 'ms', 'vi', 'tl', 'km', 'lo', 'my'];

const args = process.argv.slice(2);
const translateMode = args.includes('--translate') || process.env.I18N_AUTOTRANSLATE === '1';
const targetsArg = args.find((arg) => arg.startsWith('--locales='));
const targets = targetsArg
  ? targetsArg.split('=')[1].split(',').map((v) => v.trim()).filter(Boolean)
  : DEFAULT_TARGETS;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function extractPlaceholders(text) {
  const value = String(text || '');
  const matches = value.match(/\{[^}]+\}|\{\{[^}]+\}\}|%s|%d|%f/g) || [];
  return Array.from(new Set(matches));
}

function placeholdersMatch(sourceText, translatedText) {
  const source = extractPlaceholders(sourceText);
  const translated = extractPlaceholders(translatedText);
  return source.every((token) => translated.includes(token));
}

async function translateWithOpenRouter(text, targetLocale) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = String(process.env.I18N_OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim();

  const system = 'You are a professional localization translator.';
  const user = [
    `Translate the UI text from English to ${targetLocale}.`,
    'Rules:',
    '- Keep placeholders exactly unchanged: {name}, {{name}}, %s, %d, %f.',
    '- Keep product names unchanged.',
    '- Output only translated text, no quotes or notes.',
    `Text: ${text}`,
  ].join('\n');

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  const out = String(json?.choices?.[0]?.message?.content || '').trim();
  return out || null;
}

async function translateWithGemini(text, targetLocale) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  const model = String(process.env.I18N_GEMINI_MODEL || 'gemini-1.5-flash').trim();
  const prompt = [
    `Translate this UI text from English to ${targetLocale}.`,
    'Rules:',
    '- Keep placeholders unchanged: {name}, {{name}}, %s, %d, %f.',
    '- Keep product names unchanged.',
    '- Output only translated text.',
    `Text: ${text}`,
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
    }),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  const out = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  return out || null;
}

async function autoTranslate(text, targetLocale) {
  const fromOpenRouter = await translateWithOpenRouter(text, targetLocale);
  if (fromOpenRouter) return fromOpenRouter;
  return await translateWithGemini(text, targetLocale);
}

function ensureLocaleFile(localeCode, template) {
  const filePath = path.join(LOCALES_DIR, `${localeCode}.json`);
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, { ...template });
  }
  return filePath;
}

async function main() {
  const sourcePath = path.join(LOCALES_DIR, `${SOURCE_LOCALE}.json`);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source locale file not found: ${sourcePath}`);
  }
  const source = readJson(sourcePath);
  const sourceKeys = Object.keys(source);

  for (const locale of targets) {
    if (locale === SOURCE_LOCALE) continue;
    const filePath = ensureLocaleFile(locale, source);
    const current = readJson(filePath);

    let translated = 0;
    let copied = 0;
    let kept = 0;

    const next = {};
    for (const key of sourceKeys) {
      const sourceText = String(source[key] ?? '');
      const existing = String(current[key] ?? '').trim();

      if (existing && existing !== sourceText) {
        next[key] = existing;
        kept += 1;
        continue;
      }

      if (translateMode && sourceText) {
        try {
          const candidate = await autoTranslate(sourceText, locale);
          if (candidate && placeholdersMatch(sourceText, candidate)) {
            next[key] = candidate;
            translated += 1;
            continue;
          }
        } catch {
          // Ignore translation failure and fall back to source text.
        }
      }

      next[key] = sourceText;
      copied += 1;
    }

    writeJson(filePath, next);
    console.log(`${locale}: kept=${kept}, translated=${translated}, copied=${copied}`);
  }

  console.log(`Done. mode=${translateMode ? 'translate' : 'copy-only'}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

