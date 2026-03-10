import { SupportedLocale } from "../types";
import en from "../locales/en.json";
import my from "../locales/my.json";
import id from "../locales/id.json";
import ms from "../locales/ms.json";
import th from "../locales/th.json";
import vi from "../locales/vi.json";
import tl from "../locales/tl.json";
import km from "../locales/km.json";
import lo from "../locales/lo.json";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "my", "id", "ms", "th", "vi", "tl", "km", "lo"];

type Dict = Record<string, string>;

const EN: Dict = en;
const DICTIONARIES: Record<SupportedLocale, Dict> = {
  en,
  my,
  id,
  ms,
  th,
  vi,
  tl,
  km,
  lo,
};

const flagFromCountry = (countryCode: string): string => {
  const chars = String(countryCode || "")
    .trim()
    .toUpperCase()
    .slice(0, 2)
    .split("");
  if (chars.length !== 2) return "";
  return String.fromCodePoint(...chars.map((ch) => 127397 + ch.charCodeAt(0)));
};

export const LOCALE_META: Record<SupportedLocale, { flag: string; country: string; short: string; name: string }> = {
  en: { flag: flagFromCountry("US"), country: "US", short: "EN", name: "English" },
  my: { flag: flagFromCountry("MM"), country: "MM", short: "MM", name: "Myanmar" },
  id: { flag: flagFromCountry("ID"), country: "ID", short: "ID", name: "Bahasa Indonesia" },
  ms: { flag: flagFromCountry("MY"), country: "MY", short: "MS", name: "Bahasa Melayu" },
  th: { flag: flagFromCountry("TH"), country: "TH", short: "TH", name: "Thai" },
  vi: { flag: flagFromCountry("VN"), country: "VN", short: "VN", name: "Tieng Viet" },
  tl: { flag: flagFromCountry("PH"), country: "PH", short: "TL", name: "Filipino" },
  km: { flag: flagFromCountry("KH"), country: "KH", short: "KM", name: "Khmer" },
  lo: { flag: flagFromCountry("LA"), country: "LA", short: "LO", name: "Lao" },
};

const SUPPORTED_LOCALE_SET = new Set<SupportedLocale>(SUPPORTED_LOCALES);

export const normalizeSupportedLocale = (value: unknown, fallback: SupportedLocale = "en"): SupportedLocale => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (SUPPORTED_LOCALE_SET.has(raw as SupportedLocale)) return raw as SupportedLocale;

  // Handle standard locale tags first (e.g. ms-MY, vi-VN, tl-PH)
  // so region tokens do not get mistaken as language codes.
  const localeLike = raw.replace(/[_/]+/g, "-").trim();
  const primary = localeLike.split("-").map((token) => token.trim()).filter(Boolean)[0] || "";
  if (SUPPORTED_LOCALE_SET.has(primary as SupportedLocale)) return primary as SupportedLocale;

  const cleaned = raw.replace(/[_/]+/g, "-").replace(/[^a-z-]+/g, " ").trim();
  const tokens = cleaned
    .split(/\s+/)
    .flatMap((token) => token.split("-"))
    .map((token) => token.trim())
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const hasToken = (...candidates: string[]): boolean => candidates.some((candidate) => tokenSet.has(candidate));
  const hasText = (...candidates: string[]): boolean => candidates.some((candidate) => cleaned.includes(candidate));

  if (hasToken("th") || hasText("thai")) return "th";
  if (hasToken("my") || hasText("myanmar", "burmese")) return "my";
  if (hasToken("id") || hasText("indonesian", "bahasa indonesia")) return "id";
  if (hasToken("ms") || hasText("malay", "bahasa melayu")) return "ms";
  if (hasToken("vi") || hasText("vietnamese", "tieng viet")) return "vi";
  if (hasToken("tl", "fil", "ph") || hasText("filipino", "tagalog")) return "tl";
  if (hasToken("km", "kh") || hasText("khmer")) return "km";
  if (hasToken("lo", "la") || hasText("lao")) return "lo";
  if (hasToken("en", "us", "gb") || hasText("english")) return "en";

  const short = tokens.find((token) => token.length === 2 && SUPPORTED_LOCALE_SET.has(token as SupportedLocale));
  if (short) return short as SupportedLocale;
  return fallback;
};

const OVERRIDES: Partial<Record<SupportedLocale, Dict>> = {
  my: {},
  id: {
    lang: "Bahasa",
    lowBandwidth: "Mode hemat data",
    navLearn: "Belajar",
    navCommunity: "Komunitas",
    navLeaderboard: "Papan Peringkat",
    navProfile: "Profil",
    navDownloads: "Unduhan",
    generate: "Buat",
    generating: "Menyusun...",
    profileStats: "Ringkasan Profil",
  },
  ms: {
    lang: "Bahasa",
    lowBandwidth: "Mod jimat data",
    navLearn: "Belajar",
    navCommunity: "Komuniti",
    navLeaderboard: "Papan Kedudukan",
    navProfile: "Profil",
    navDownloads: "Muat Turun",
    generate: "Jana",
    generating: "Menjana...",
    profileStats: "Ringkasan Profil",
  },
  th: {
    lang: "\u0e20\u0e32\u0e29\u0e32",
  },
  vi: {
    lang: "Ngon ngu",
    lowBandwidth: "Che do tiet kiem du lieu",
    navLearn: "Hoc",
    navCommunity: "Cong dong",
    navLeaderboard: "Bang xep hang",
    navProfile: "Ho so",
    navDownloads: "Tai xuong",
    generate: "Tao",
    generating: "Dang tao...",
    profileStats: "Tong quan ho so",
  },
  tl: {
    lang: "Wika",
    navLearn: "Matuto",
    navCommunity: "Komunidad",
    navLeaderboard: "Leaderboard",
    navProfile: "Profile",
    navDownloads: "Downloads",
    generate: "Gumawa",
    generating: "Gumagawa...",
  },
  km: {
    lang: "áž—áž¶ážŸáž¶",
  },
  lo: {
    lang: "àºžàº²àºªàº²",
  },
};

export const getLocale = (): SupportedLocale => {
  try {
    const raw = localStorage.getItem("nexus_locale");
    if (raw) return normalizeSupportedLocale(raw, "en");
  } catch {
    // ignore
  }
  return "en";
};

export const setLocale = (locale: SupportedLocale) => {
  try {
    localStorage.setItem("nexus_locale", normalizeSupportedLocale(locale, "en"));
  } catch {
    // ignore
  }
};

export const t = (key: string, locale: SupportedLocale): string => {
  const override = OVERRIDES[locale]?.[key];
  if (override) return override;
  const dict = DICTIONARIES[locale] || EN;
  const english = EN[key] || key;
  const localized = dict[key];
  if (localized && localized.trim()) return localized;
  return english;
};
