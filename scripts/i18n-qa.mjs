import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const LOCALES_DIR = path.join(ROOT, 'src', 'locales');
const REPORT_DIR = path.join(ROOT, 'docs', 'localization');
const SOURCE = 'en';
const TARGETS = ['my', 'id', 'ms', 'th', 'vi', 'tl', 'km', 'lo'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractPlaceholders(text) {
  return Array.from(new Set(String(text || '').match(/\{[^}]+\}|\{\{[^}]+\}\}|%s|%d|%f/g) || []));
}

function scriptRegex(locale) {
  if (locale === 'my') return /[\u1000-\u109f\uaa60-\uaa7f]/g;
  if (locale === 'km') return /[\u1780-\u17ff]/g;
  if (locale === 'lo') return /[\u0e80-\u0eff]/g;
  if (locale === 'th') return /[\u0e00-\u0e7f]/g;
  return null;
}

function countScriptChars(text, regex) {
  if (!regex) return 0;
  return (String(text || '').match(regex) || []).length;
}

function runQa() {
  const sourcePath = path.join(LOCALES_DIR, `${SOURCE}.json`);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source locale: ${sourcePath}`);
  }
  const source = readJson(sourcePath);
  const sourceKeys = Object.keys(source);
  const reportRows = [];
  let hasBlocking = false;

  for (const locale of TARGETS) {
    const localePath = path.join(LOCALES_DIR, `${locale}.json`);
    if (!fs.existsSync(localePath)) {
      reportRows.push({ locale, missing: sourceKeys.length, extra: 0, placeholderMismatches: 0, englishLeakRatio: 1, scriptCoverage: 0, status: 'BLOCK' });
      hasBlocking = true;
      continue;
    }

    const dict = readJson(localePath);
    const localeKeys = Object.keys(dict);
    const missing = sourceKeys.filter((k) => !(k in dict));
    const extra = localeKeys.filter((k) => !(k in source));

    let placeholderMismatches = 0;
    let sameAsEnglish = 0;
    let scriptChars = 0;
    let totalChars = 0;
    const regex = scriptRegex(locale);

    for (const key of sourceKeys) {
      const base = String(source[key] ?? '');
      const translated = String(dict[key] ?? '');
      if (!translated) continue;

      const basePlaceholders = extractPlaceholders(base);
      const translatedPlaceholders = extractPlaceholders(translated);
      const okPlaceholders = basePlaceholders.every((token) => translatedPlaceholders.includes(token));
      if (!okPlaceholders) placeholderMismatches += 1;

      if (translated.trim() === base.trim()) sameAsEnglish += 1;

      if (regex) {
        scriptChars += countScriptChars(translated, regex);
        totalChars += translated.replace(/\s/g, '').length;
      }
    }

    const englishLeakRatio = sourceKeys.length ? sameAsEnglish / sourceKeys.length : 0;
    const scriptCoverage = totalChars ? scriptChars / totalChars : 0;
    const blocking = missing.length > 0 || placeholderMismatches > 0;
    const warning = englishLeakRatio > 0.25 || (!!regex && scriptCoverage < 0.15);
    if (blocking) hasBlocking = true;

    reportRows.push({
      locale,
      missing: missing.length,
      extra: extra.length,
      placeholderMismatches,
      englishLeakRatio,
      scriptCoverage,
      status: blocking ? 'BLOCK' : (warning ? 'WARN' : 'PASS'),
    });
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, 'latest-qa-report.md');
  const lines = [];
  lines.push('# Localization QA Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Locale | Missing Keys | Extra Keys | Placeholder Mismatch | English Leak | Script Coverage | Status |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of reportRows) {
    lines.push(`| ${row.locale} | ${row.missing} | ${row.extra} | ${row.placeholderMismatches} | ${(row.englishLeakRatio * 100).toFixed(1)}% | ${(row.scriptCoverage * 100).toFixed(1)}% | ${row.status} |`);
  }
  lines.push('');
  lines.push('## Review Checklist');
  lines.push('- Verify in-country reviewer reviewed context accuracy for each locale.');
  lines.push('- Verify legal/compliance terminology and educational tone.');
  lines.push('- Verify placeholders and interpolation tokens are unchanged.');
  lines.push('- Verify key screens for truncation/overflow in mobile and desktop.');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  console.log(`QA report written: ${reportPath}`);
  if (hasBlocking) {
    console.error('Blocking localization QA issues detected.');
    process.exit(1);
  }
}

runQa();
