/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ModelPicker, type ProviderId } from "./components/ModelPicker";
import { 
  BookOpen, 
  Layout, 
  CheckCircle2, 
  Loader2, 
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Sparkles,
  Lock,
  Edit3,
  RotateCcw,
  Plus,
  SlidersHorizontal,
  Minus,
  X,
  AlertCircle,
  Upload,
  Download,
  Home,
  Users,
  Trophy,
  UserCircle2,
  MessageSquare,
  Share2,
  BarChart3,
  Power,
  Facebook,
  MessageCircle,
  Send,
  Linkedin,
  Mail,
  Link2,
  Twitter,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';
import Markdown from 'react-markdown';
import { aiService } from './services/aiService';
import { Course, AssessmentQuestion, Module, ContentType, ModuleContent, UserProfile, SupportedLocale, ImpactMetrics, DownloadState, PublicCoursePost, CvAnalysisResult, PublicCreatorProfile, LearningCourseSummary, CourseAnalyticsSummary, InterviewRecommendedJob, InterviewSession, InterviewAnswerFeedback, InterviewFinalReview } from './types';
import { SAMPLE_COURSE } from './constants';
import { cn } from './lib/utils';
import { Quiz } from './components/Quiz';
import { FlipCard } from './components/FlipCard';
import { DragFillChallenge } from './components/DragFillChallenge';
import { CodeBuilder } from './components/CodeBuilder';
import { Avatar } from './components/Avatar';
import { GenerationFlow } from './components/GenerationFlow';
import { InterviewPreparationPage } from './components/InterviewPreparationPage';
import { ContentEditor } from './components/ContentEditor';
import { CiscoAccordion, CiscoHotspot, CiscoCarousel, CiscoLearningCard, CiscoPopCards } from './components/CiscoComponents';
import StarterPage from './components/StarterPage';
import { getLocale, setLocale, SUPPORTED_LOCALES, LOCALE_META, normalizeSupportedLocale, t } from './lib/i18n';
import { offlineStore } from './lib/offlineStore';

type AppState = 'idle' | 'assessing' | 'planning' | 'generating_outline' | 'outline_review' | 'generating_content' | 'learning' | 'interview_setup' | 'interviewing';
type HomeTab = 'learn' | 'community' | 'leaderboard' | 'profile' | 'downloads';
type CvResubmitStatus = 'idle' | 'processing' | 'valid' | 'invalid' | 'success' | 'fail';

type LessonOptions = {
  quiz: boolean;
  gamifiedQuiz: boolean;
  flashcards: boolean;
  video: boolean;
  codeBuilder: boolean;
  learningCard: boolean;
};

type OutlineLesson = {
  id: string;
  title: string;
  options: LessonOptions;
};

type OutlineModule = {
  id: string;
  title: string;
  lessons: OutlineLesson[];
};

type OutlineEditTargetType = 'module' | 'lesson' | 'subcontent';

type OutlineEditTarget = {
  key: string;
  type: OutlineEditTargetType;
  label: string;
  moduleId: string;
  moduleTitle: string;
  lessonNumber?: number;
  segmentNumber?: number;
  lessonTitle?: string;
  stepId?: string;
  stepTitle?: string;
};

type OutlineEditChange = {
  target: OutlineEditTarget;
  targetKey: string;
  label: string;
  moduleId: string;
  lessonNumber?: number;
  instruction: string;
  before: string;
  after: string;
  changed: boolean;
};

type OutlineEditSummary = {
  at: number;
  total: number;
  changed: number;
  unchanged: number;
  failedModules: string[];
  changes: OutlineEditChange[];
};

type GroupedLesson = {
  lessonNumber: number;
  lessonTitle: string;
  steps: Array<{ step: Module['steps'][number]; stepIdx: number }>;
};

type LessonOptionConfig = {
  key: keyof LessonOptions;
  label: string;
  contentType: ContentType;
  stepLabel: string;
};

type StepInteractionProgress = {
  videoSeconds?: number;
  videoCompleted?: boolean;
  flashcardsTotal?: number;
  flashcardSeen?: number[];
  flashcardsViewed?: number;
  quizPassed?: boolean;
  quizScore?: number;
  quizTotal?: number;
  dragFillTotal?: number;
  dragFillSolved?: number[];
  dragFillCompleted?: number;
  codeBuilderCompleted?: boolean;
  readStartedAt?: string;
  readDwellMs?: number;
  readScrollMaxRatio?: number;
  readCompleted?: boolean;
  lastUpdated?: string;
};

type SidebarView = 'outline' | 'resources';

type CourseResourceKind = 'youtube' | 'web' | 'doc';

type CourseResource = {
  key: string;
  title: string;
  url: string;
  kind: CourseResourceKind;
  origin: string;
  moduleId: string;
  stepId: string;
};

type MascotToastState = {
  id: number;
  title: string;
  subtitle: string;
  mood: 'happy' | 'sad' | 'idle';
};

type MascotMood = 'happy' | 'sad' | 'idle';
type ComposerMode = 'default' | 'interview';

type CareerGuide = {
  id: string;
  title: string;
  roleSummary: string;
  responsibilities: string[];
  requirements: string[];
  sources: Array<{ label: string; url: string }>;
  keywords: string[];
};

type PublicIdentity = {
  displayName: string;
  profileImageDataUrl: string;
};

const DEFAULT_PUBLIC_PROFILE_IMAGE = '/mascot/course-progress-graduate.png';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const fallbackPublicDisplayName = (accountId: string): string => {
  const key = String(accountId || '').trim();
  if (!key) return 'User';
  if (UUID_PATTERN.test(key)) return `User ${key.slice(0, 8)}`;
  if (key.startsWith('local-')) return `User ${key.slice(6, 12) || 'local'}`;
  return key;
};

const SEA_GEKO_ASSETS = {
  happy: [
    '/mascot/sea-geko-happy.png',
    '/mascot/sea-geko-happy.svg',
  ],
  sad: [
    '/mascot/sea-geko-sad.png',
    '/mascot/sea-geko-sad.svg',
  ],
  idle: [
    '/mascot/icon.png',
    '/mascot/sea-geko-idle.svg',
  ],
} as const;

const MascotImage: React.FC<{ mood: MascotMood; alt: string; className?: string }> = ({ mood, alt, className }) => {
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = SEA_GEKO_ASSETS[mood];
  const src = sources[Math.min(srcIndex, sources.length - 1)];

  useEffect(() => {
    setSrcIndex(0);
  }, [mood]);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setSrcIndex((prev) => (prev < sources.length - 1 ? prev + 1 : prev));
      }}
    />
  );
};

const formatMarkdown = (text: string) => {
  if (!text) return '';
  // Replace literal \n with actual newlines
  return text.replace(/\\n/g, '\n');
};

const stripStructuredStepPrefix = (title: string) => String(title || '').replace(/^\d+\.\d+(?:\.\d+)?\s+/, '').trim();

const normalizeYouTubeId = (candidate?: string) => {
  const raw = String(candidate || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(raw)) return '';
  const lower = raw.toLowerCase();
  if (lower === 'video_id') return '';
  if (lower.includes('example') || lower.includes('sample') || lower.includes('placeholder')) return '';
  if (/^[-_x]{6,}$/i.test(raw)) return '';
  return raw;
};

const extractYouTubeVideoId = (input?: string) => {
  if (!input) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  const direct = normalizeYouTubeId(raw);
  if (direct) return direct;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) return normalizeYouTubeId(url.pathname.replace('/', '').slice(0, 11));
    if (url.searchParams.get('v')) return normalizeYouTubeId(String(url.searchParams.get('v')).split(/[?&#]/)[0].slice(0, 11));
    const parts = url.pathname.split('/').filter(Boolean);
    const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v');
    if (embedIdx !== -1 && parts[embedIdx + 1]) return normalizeYouTubeId(parts[embedIdx + 1].slice(0, 11));
  } catch {
    return '';
  }
  return '';
};

const extractYouTubeIdFromText = (input?: string) => {
  const text = String(input || '');
  if (!text) return '';
  const match = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+/i);
  if (!match) return '';
  return extractYouTubeVideoId(match[0]);
};

const getYouTubeWatchUrl = (videoUrl?: string, videoWebUrl?: string) => {
  const id = extractYouTubeVideoId(videoWebUrl) || extractYouTubeVideoId(videoUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
};

const isFallbackModuleContent = (content?: ModuleContent): boolean => {
  if (!content) return false;
  const data: any = content.data || {};
  if (data.generationFallback === true) return true;
  const hay = `${String(content.lessonText || '')}\n${String(data.content || '')}`.toLowerCase();
  return (
    hay.includes('fallback lesson') ||
    hay.includes('provider is currently unavailable') ||
    hay.includes('retry generation in a moment') ||
    hay.includes('switch ai provider/model')
  );
};

const normalizeContentType = (value: unknown): string => String(value || '').trim().toUpperCase();

const isReadTrackedType = (value: unknown): boolean => READ_TRACKED_TYPES.has(normalizeContentType(value));

const normalizeResourceUrl = (raw: string): string => {
  const value = String(raw || '').trim();
  if (!value) return '';
  const ytId = extractYouTubeVideoId(value);
  if (ytId) return `https://www.youtube.com/watch?v=${ytId}`;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
};

const inferResourceKind = (url: string): CourseResourceKind => {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (/\.(pdf|doc|docx|ppt|pptx|xls|xlsx)(\?|$)/i.test(lower)) return 'doc';
  return 'web';
};

const buildResourceTitle = (url: string, fallback = 'Reference'): string => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '') || fallback;
  } catch {
    return fallback;
  }
};

const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gim;
const plainUrlRegex = /\bhttps?:\/\/[^\s<>()]+/gim;

const extractLinksFromText = (text: string): Array<{ title: string; url: string; kind: CourseResourceKind }> => {
  const out: Array<{ title: string; url: string; kind: CourseResourceKind }> = [];
  const raw = String(text || '');
  if (!raw.trim()) return out;

  for (const match of raw.matchAll(markdownLinkRegex)) {
    const title = String(match[1] || '').trim() || 'Reference';
    const url = normalizeResourceUrl(String(match[2] || ''));
    if (!url) continue;
    out.push({ title, url, kind: inferResourceKind(url) });
  }

  for (const match of raw.matchAll(plainUrlRegex)) {
    const url = normalizeResourceUrl(String(match[0] || ''));
    if (!url) continue;
    if (out.some((entry) => entry.url === url)) continue;
    out.push({ title: buildResourceTitle(url, 'Reference'), url, kind: inferResourceKind(url) });
  }

  return out;
};

const collectReferencesFromModuleContent = (content: ModuleContent | undefined): Array<{ title: string; url: string; kind: CourseResourceKind }> => {
  if (!content) return [];
  const data: any = content.data || {};
  const references: Array<{ title: string; url: string; kind: CourseResourceKind }> = [];

  const pushLink = (title: string, urlRaw: string, kindHint?: CourseResourceKind) => {
    const url = normalizeResourceUrl(urlRaw);
    if (!url) return;
    const kind = kindHint || inferResourceKind(url);
    references.push({
      title: String(title || '').trim() || buildResourceTitle(url, 'Reference'),
      url,
      kind,
    });
  };

  if (Array.isArray(data.references)) {
    for (const ref of data.references) {
      pushLink(ref?.title || 'Reference', ref?.url || '', ref?.kind);
    }
  }

  pushLink(data.videoTitle || content.title || 'YouTube', data.videoWebUrl || data.videoUrl || '', 'youtube');

  const textBlocks: string[] = [
    String(content.lessonText || ''),
    String(data.content || ''),
  ];

  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      textBlocks.push(String(item?.content || ''));
      textBlocks.push(String(item?.title || ''));
    }
  }
  if (Array.isArray(data.learningCards)) {
    for (const card of data.learningCards) {
      textBlocks.push(String(card?.title || ''));
      textBlocks.push(String(card?.content || ''));
    }
  }
  if (Array.isArray(data.points)) {
    for (const point of data.points) {
      textBlocks.push(String(point?.title || ''));
      textBlocks.push(String(point?.content || ''));
    }
  }
  if (Array.isArray(data.slides)) {
    for (const slide of data.slides) {
      textBlocks.push(String(slide?.title || ''));
      textBlocks.push(String(slide?.content || ''));
    }
  }

  for (const block of textBlocks) {
    for (const link of extractLinksFromText(block)) {
      references.push(link);
    }
  }

  const dedup = new Map<string, { title: string; url: string; kind: CourseResourceKind }>();
  for (const link of references) {
    if (!dedup.has(link.url)) dedup.set(link.url, link);
  }

  const hasWebReference = Array.from(dedup.values()).some((link) => link.kind !== 'youtube');
  if (!hasWebReference) {
    const topic = String(content.title || '').trim();
    if (topic) {
      const wikiUrl = normalizeResourceUrl(`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)}`);
      if (wikiUrl && !dedup.has(wikiUrl)) {
        dedup.set(wikiUrl, {
          title: `Wikipedia: ${topic}`,
          url: wikiUrl,
          kind: 'web',
        });
      }
    }
  }

  return Array.from(dedup.values());
};

const buildCourseResources = (course: Course | null): CourseResource[] => {
  if (!course) return [];
  const dedup = new Map<string, CourseResource>();

  for (const [moduleIdx, module] of course.modules.entries()) {
    for (const [stepIdx, step] of module.steps.entries()) {
      const moduleNumber = typeof step.moduleNumber === 'number' ? step.moduleNumber : moduleIdx + 1;
      const origin = typeof step.lessonNumber === 'number' && typeof step.segmentNumber === 'number'
        ? `${moduleNumber}.${step.lessonNumber}.${step.segmentNumber}`
        : `${moduleNumber}.${stepIdx + 1}`;
      const links = collectReferencesFromModuleContent(step.content);
      for (const link of links) {
        const key = link.url;
        if (dedup.has(key)) continue;
        dedup.set(key, {
          key,
          title: link.title || stripStructuredStepPrefix(step.title) || buildResourceTitle(link.url, 'Reference'),
          url: link.url,
          kind: link.kind,
          origin,
          moduleId: module.id,
          stepId: step.id,
        });
      }
    }
  }

  return Array.from(dedup.values()).sort((a, b) => a.origin.localeCompare(b.origin, undefined, { numeric: true }));
};

const isPlaceholderToken = (token: string): boolean => {
  const t = String(token || '').trim().toLowerCase();
  return (
    !t ||
    /^answer\s*\d+$/.test(t) ||
    /^blank\s*\d+$/.test(t) ||
    /^option\s*[a-z0-9]+$/.test(t) ||
    /^[a-d]$/.test(t)
  );
};

const extractMeaningfulTokens = (text: string, limit = 8): string[] => {
  const stopWords = new Set([
    'the', 'and', 'with', 'from', 'that', 'this', 'your', 'into', 'about', 'using',
    'each', 'left', 'right', 'blank', 'blanks', 'step', 'lesson', 'module', 'course',
    'is', 'are', 'to', 'for', 'of', 'in', 'on', 'a', 'an', 'by', 'or', 'as', 'be',
  ]);

  const words = String(text || '')
    .replace(/[_`*#()[\]{}<>.,;:!?/\\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && /[a-z]/i.test(w))
    .filter((w) => !stopWords.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  return Array.from(new Set(words)).slice(0, limit);
};

const limitTemplateBlanks = (template: string, keep: number, fillFrom: string[]): string => {
  let seen = 0;
  return String(template || '').replace(/___/g, () => {
    seen += 1;
    if (seen <= keep) return '___';
    const replacement = fillFrom[seen - 1] || fillFrom[fillFrom.length - 1] || 'term';
    return replacement;
  });
};

const normalizeTemplateBlanks = (template: string): string => {
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
};

const countTemplateBlanks = (template: string): number => (String(template || '').match(/___/g) || []).length;

const parseAnswerList = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[,\n;|]/g)
    .map((v) => v.trim())
    .filter(Boolean);
};

const inferAnswerOrderFromContext = (options: string[], context: string): string[] => {
  const contextText = String(context || '').toLowerCase();
  if (!contextText) return [];
  return options
    .map((option) => ({ option, idx: contextText.indexOf(option.toLowerCase()) }))
    .filter((entry) => entry.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.option);
};

const isPlaceholderQuizQuestion = (question: string): boolean => {
  const q = String(question || '').trim().toLowerCase();
  return (
    !q ||
    /^quick\s*check\s*:?\s*which\s*statement\s*is\s*true\??$/.test(q) ||
    /^question\s*\d*$/.test(q)
  );
};

const isPlaceholderQuizOption = (option: string): boolean => {
  const o = String(option || '').trim().toLowerCase();
  return !o || /^[a-d]$/.test(o) || /^option\s*[a-d0-9]+$/.test(o);
};

const toQuizFallbackQuestion = (topic: string) => {
  const topicText = String(topic || '').trim() || 'this lesson';
  return {
    question: `Which statement best reflects the core idea in ${topicText}?`,
    options: [
      'It should align with concepts taught in this module.',
      'It should ignore the lesson content completely.',
      'It is unrelated to this course topic.',
      'It must come from outside the module context.',
    ],
    correctAnswer: 0,
    explanation: `The correct statement is the one that aligns with the lesson focus on ${topicText}.`,
  };
};

const normalizeFlashcardKey = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#()[\]{}<>.,;:!?/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const listFlashcardFrontKeys = (cards: Array<{ front?: string }>): string[] => {
  return cards
    .map((card) => normalizeFlashcardKey(String(card?.front || '')))
    .filter(Boolean);
};

const buildFallbackFlashcards = (topic: string, seenKeys: Set<string>, count = 4) => {
  const rootTopic = String(topic || '').replace(/^flashcards\s*:?\s*/i, '').trim() || 'This topic';
  const candidates = [
    {
      front: `${rootTopic} Overview`,
      back: `A concise summary of ${rootTopic} and why it matters in this lesson.`,
    },
    {
      front: `${rootTopic} Key Concept`,
      back: `The main idea learners should remember when applying ${rootTopic}.`,
    },
    {
      front: `${rootTopic} Practical Use`,
      back: `A real situation where ${rootTopic} can be applied effectively.`,
    },
    {
      front: `${rootTopic} Common Pitfall`,
      back: `A frequent mistake related to ${rootTopic} and how to avoid it.`,
    },
    {
      front: `${rootTopic} Quick Recall`,
      back: `A short memory cue to quickly review ${rootTopic}.`,
    },
  ];

  const out: Array<{ front: string; back: string }> = [];
  for (const item of candidates) {
    if (out.length >= count) break;
    const key = normalizeFlashcardKey(item.front);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(item);
  }

  let cursor = 1;
  while (out.length < count) {
    const front = `${rootTopic} Insight ${cursor}`;
    const back = `A focused takeaway (${cursor}) that reinforces ${rootTopic}.`;
    const key = normalizeFlashcardKey(front);
    cursor += 1;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({ front, back });
  }

  return out;
};

const sanitizeFlashcards = (
  cards: any[],
  topicHint: string,
  blockedKeys: Set<string> = new Set()
) => {
  const used = new Set<string>(blockedKeys);
  const out: Array<{ front: string; back: string; icon?: string; imageUrl?: string; cardType?: string }> = [];

  for (const raw of Array.isArray(cards) ? cards : []) {
    if (out.length >= 6) break;
    const front = String(raw?.front || '').trim();
    const back = String(raw?.back || '').trim();
    if (!front || !back) continue;

    const frontKey = normalizeFlashcardKey(front);
    const pairKey = `${frontKey}::${normalizeFlashcardKey(back).slice(0, 120)}`;
    if (!frontKey || used.has(frontKey) || used.has(pairKey)) continue;
    used.add(frontKey);
    used.add(pairKey);

    out.push({
      front,
      back,
      icon: raw?.icon,
      imageUrl: /^https?:\/\//i.test(String(raw?.imageUrl || '')) ? String(raw.imageUrl) : '',
      cardType: raw?.cardType,
    });
  }

  if (out.length < 4) {
    const fillers = buildFallbackFlashcards(topicHint, used, 4 - out.length);
    for (const card of fillers) out.push(card);
  }

  return out.slice(0, 6);
};

const sanitizePopCards = (cards: any[], topicHint: string) => {
  const out: Array<{ title: string; content: string; icon?: string; imageUrl?: string }> = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(cards) ? cards : []) {
    if (out.length >= 8) break;
    const title = String(raw?.title || raw?.front || '').trim();
    const content = String(raw?.content || raw?.back || '').trim();
    if (!title && !content) continue;
    const key = `${title.toLowerCase()}::${content.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: title || `Insight ${out.length + 1}`,
      content: content || `Practical takeaway for ${topicHint || 'this topic'}.`,
      icon: String(raw?.icon || '').trim(),
      imageUrl: /^https?:\/\//i.test(String(raw?.imageUrl || '')) ? String(raw.imageUrl) : '',
    });
  }
  if (out.length) return out;
  const topic = stripStructuredStepPrefix(String(topicHint || '')).trim() || 'this topic';
  return [
    {
      title: `${topic}: Why it matters`,
      content: `Summarize the core purpose of ${topic} and why learners should care.`,
      icon: 'Target',
      imageUrl: '',
    },
    {
      title: `${topic}: Real example`,
      content: `Give one concrete example that shows ${topic} in action.`,
      icon: 'Lightbulb',
      imageUrl: '',
    },
    {
      title: `${topic}: Next action`,
      content: `State one clear action the learner can take immediately.`,
      icon: 'Rocket',
      imageUrl: '',
    },
  ];
};

const sanitizeModuleContent = (content: ModuleContent, fallbackTitle = ''): ModuleContent => {
  if (!content || typeof content !== 'object') return content;
  const type = String(content.type || '').toUpperCase();
  const data = (content.data && typeof content.data === 'object') ? content.data : {};
  const out: ModuleContent = {
    ...content,
    title: String(content.title || fallbackTitle || '').trim(),
    data: { ...data },
  };

  if (type === 'VIDEO') {
    const id = extractYouTubeVideoId(data.videoWebUrl)
      || extractYouTubeVideoId(data.videoUrl)
      || extractYouTubeIdFromText(data.content)
      || extractYouTubeIdFromText(out.lessonText)
      || extractYouTubeIdFromText(out.title);
    out.data.videoUrl = id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    out.data.videoWebUrl = id ? `https://www.youtube.com/watch?v=${id}` : '';
  }

  if (type === 'FLIP_CARD') {
    const cards = Array.isArray(data.cards) ? data.cards : [];
    out.data.cards = sanitizeFlashcards(cards, out.title || fallbackTitle || 'Flashcards');
  }

  if (type === 'POP_CARD') {
    const cards = Array.isArray(data.cards)
      ? data.cards
      : (Array.isArray(data.points) ? data.points : []);
    out.data.cards = sanitizePopCards(cards, out.title || fallbackTitle || 'Pop cards');
  }

  if (type === 'DRAG_FILL') {
    const challenges = Array.isArray(data.challenges) ? data.challenges : [];
    out.data.challenges = challenges.map((ch: any) => {
      const rawTemplate = String(ch?.codeTemplate || ch?.statement || ch?.prompt || '').trim();
      const normalizedTemplate = normalizeTemplateBlanks(rawTemplate);
      const templateWithBlanks = countTemplateBlanks(normalizedTemplate) > 0
        ? normalizedTemplate
        : `${normalizedTemplate || rawTemplate || 'Complete the statement:'} ___`.trim();
      const initialBlankCount = Math.max(1, Math.min(4, countTemplateBlanks(templateWithBlanks)));
      const contextText = `${templateWithBlanks} ${String(ch?.instruction || '')} ${String(ch?.explanation || '')}`;
      const contextTokens = extractMeaningfulTokens(contextText, 10);

      let options = Array.isArray(ch?.options)
        ? ch.options.map((o: any) => String(o).trim()).filter(Boolean)
        : [];
      if (!options.length && Array.isArray(ch?.choices)) {
        options = ch.choices.map((o: any) => String(o).trim()).filter(Boolean);
      }
      options = Array.from(new Set(options.filter((o) => !isPlaceholderToken(o))));
      if (!options.length) options = contextTokens.slice(0, 6);

      let answers = parseAnswerList(ch?.correctAnswer)
        .filter((s) => !isPlaceholderToken(s))
        .slice(0, initialBlankCount);
      if (!answers.length) {
        const directAnswer = String(ch?.answer || '').trim();
        if (directAnswer && !isPlaceholderToken(directAnswer)) {
          answers = [directAnswer];
        }
      }

      const orderedFromContext = inferAnswerOrderFromContext(
        options,
        `${String(ch?.instruction || '')} ${String(ch?.explanation || '')}`
      );
      for (const option of orderedFromContext) {
        if (answers.length >= initialBlankCount) break;
        if (!answers.includes(option)) answers.push(option);
      }

      while (answers.length < initialBlankCount) {
        const fallback = options.find((o) => !answers.includes(o)) || '';
        if (!fallback) break;
        answers.push(fallback);
      }
      answers = answers.filter((ans) => !isPlaceholderToken(ans));
      if (!answers.length) {
        answers = (options.length ? options : contextTokens).slice(0, 2);
      }

      const blankCount = Math.max(1, Math.min(4, Math.max(initialBlankCount, Math.min(answers.length || 1, 4))));
      answers = answers.slice(0, blankCount);
      for (const ans of answers) {
        if (!options.includes(ans)) options.unshift(ans);
      }
      if (!options.length) {
        options = ['Concept', 'Application', 'Principle', 'Practice'];
      }

      if (options.length < Math.max(3, blankCount)) {
        for (const token of contextTokens) {
          if (options.length >= Math.max(4, blankCount + 1)) break;
          if (!options.includes(token)) options.push(token);
        }
      }
      if (options.length < Math.max(4, blankCount + 1)) {
        for (const fallback of ['Concept', 'Application', 'Principle', 'Practice', 'Review']) {
          if (options.length >= Math.max(4, blankCount + 1)) break;
          if (!options.includes(fallback)) options.push(fallback);
        }
      }
      options = Array.from(new Set(options.filter((o) => !isPlaceholderToken(o)))).slice(0, 12);

      if (answers.length < blankCount) {
        for (const option of options) {
          if (answers.length >= blankCount) break;
          if (!answers.includes(option)) answers.push(option);
        }
      }

      const codeTemplate = limitTemplateBlanks(templateWithBlanks, blankCount, answers);
      const instructionRaw = String(ch?.instruction || '').trim();
      const explanationRaw = String(ch?.explanation || '').trim();
      return {
        ...ch,
        instruction: instructionRaw.length >= 18
          ? instructionRaw
          : 'Fill in every blank from left to right using the options based on the previous lesson.',
        codeTemplate,
        options,
        correctAnswer: answers.join(', '),
        explanation: explanationRaw || 'Check how each selected option connects to the concept taught just above this challenge.',
      };
    });
  }

  if (type === 'QUIZ') {
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const topicContext = stripStructuredStepPrefix(
      String(out.title || content.title || '').replace(/^quiz\s*:\s*/i, '').trim()
    );
    const quizContextTokens = extractMeaningfulTokens(`${topicContext} ${String(out.lessonText || '')}`, 8)
      .map((token) => token.toLowerCase());

    const sanitizedQuestions = questions
      .map((q: any) => {
        const questionText = String(q?.question || q?.statement || q?.prompt || '').trim();
        let options = Array.isArray(q?.options)
          ? q.options.map((o: any) => String(o).trim()).filter(Boolean)
          : [];
        if (!options.length && Array.isArray(q?.choices)) {
          options = q.choices.map((o: any) => String(o).trim()).filter(Boolean);
        }
        options = Array.from(new Set(options));
        if (options.length < 2) return null;

        const placeholderQuestion = isPlaceholderQuizQuestion(questionText);
        const placeholderOptions = options.every((option) => isPlaceholderQuizOption(option));
        if (placeholderQuestion && placeholderOptions) return null;
        if (!questionText || placeholderQuestion) return null;

        if (quizContextTokens.length >= 2) {
          const haystack = `${questionText} ${options.join(' ')} ${String(q?.explanation || '')}`.toLowerCase();
          const hasContextSignal = quizContextTokens.some((token) => token.length >= 4 && haystack.includes(token));
          if (!hasContextSignal) return null;
        }

        if (options.length > 4) options = options.slice(0, 4);
        if (options.length < 4) {
          const fallbackOptions = [
            'It aligns with the lesson concepts.',
            'It conflicts with the module content.',
            'It is outside this lesson scope.',
            'It ignores the provided context.',
          ];
          for (const fallback of fallbackOptions) {
            if (options.length >= 4) break;
            if (!options.includes(fallback)) options.push(fallback);
          }
        }

        let correctAnswer = 0;
        const rawCorrect = q?.correctAnswer;
        if (typeof rawCorrect === 'number' && Number.isFinite(rawCorrect)) {
          correctAnswer = rawCorrect;
        } else {
          const parsed = Number.parseInt(String(rawCorrect ?? ''), 10);
          if (Number.isFinite(parsed)) {
            correctAnswer = parsed;
          } else {
            const letter = String(rawCorrect || q?.correctOption || '').trim().toUpperCase();
            if (/^[A-D]$/.test(letter)) {
              correctAnswer = letter.charCodeAt(0) - 65;
            } else if (typeof rawCorrect === 'string' && rawCorrect.trim()) {
              const byText = options.findIndex((opt) => opt.toLowerCase() === rawCorrect.trim().toLowerCase());
              if (byText >= 0) correctAnswer = byText;
            }
          }
        }
        correctAnswer = Math.min(Math.max(correctAnswer, 0), options.length - 1);

        const explanation = String(q?.explanation || '').trim()
          || `Review the lesson details to confirm why "${options[correctAnswer]}" is the best answer.`;

        return {
          question: questionText,
          options,
          correctAnswer,
          explanation,
        };
      })
      .filter(Boolean) as Array<{ question: string; options: string[]; correctAnswer: number; explanation: string }>;

    out.data.questions = sanitizedQuestions.length
      ? sanitizedQuestions
      : [toQuizFallbackQuestion(topicContext || 'this lesson')];
  }

  if (type === 'CODE_BUILDER') {
    const cb = data.codeBuilder || {};
    let options = Array.isArray(cb.options)
      ? cb.options.map((s: any) => String(s).trim()).filter((s: string) => s && s.length <= 80 && !s.includes('\n'))
      : [];
    let lines = Array.isArray(cb.lines) ? cb.lines : [];
    const shortFallback = options.find((o: string) => o.length <= 40) || 'pass';
    lines = lines.map((ln: any) => {
      let line = String(ln?.content || '').trim();
      let correctValue = String(ln?.correctValue || '').trim();
      if (!line.includes('___')) {
        line = correctValue && line.includes(correctValue) ? line.replace(correctValue, '___') : `${line} ___`.trim();
      }
      const first = line.indexOf('___');
      if (first !== -1) {
        line = line.slice(0, first + 3) + line.slice(first + 3).replace(/___/g, '');
      }
      if (!correctValue) correctValue = shortFallback;
      if (correctValue && !options.includes(correctValue)) options.unshift(correctValue);
      return { ...ln, content: line, correctValue };
    });
    options = Array.from(new Set(options)).slice(0, 16);
    out.data.codeBuilder = { ...cb, lines, options };
  }

  return out;
};

const sanitizeCourse = (course: Course | null): Course | null => {
  if (!course) return course;
  return {
    ...course,
    modules: Array.isArray(course.modules)
      ? course.modules.map((m, idx) => {
          const seenVideoIds = new Set<string>();
          const seenFlashcardFrontKeys = new Set<string>();
          const moduleNumberHint = m.steps.find((step) => typeof step.moduleNumber === 'number')?.moduleNumber || idx + 1;
          const steps = Array.isArray(m.steps)
            ? m.steps.map((s) => {
                const step = s.content ? { ...s, content: sanitizeModuleContent(s.content, s.title) } : s;
                const c: any = (step as any)?.content;
                const normalizedType = String(c?.type || step.type || '').toUpperCase();
                const isFlashcard = normalizedType === 'FLIP_CARD';
                if (isFlashcard && Array.isArray(c?.data?.cards)) {
                  const topicHint = String(c?.title || step.title || m.title || '').trim();
                  const cards = sanitizeFlashcards(c.data.cards, topicHint, seenFlashcardFrontKeys);
                  for (const key of listFlashcardFrontKeys(cards)) {
                    seenFlashcardFrontKeys.add(key);
                  }
                  return {
                    ...step,
                    content: {
                      ...c,
                      data: {
                        ...(c?.data || {}),
                        cards,
                      },
                    },
                  };
                }
                const isVideo = String(c?.type || step.type || '').toUpperCase() === 'VIDEO';
                if (!isVideo) return step;
                const videoId = extractYouTubeVideoId(c?.data?.videoUrl) || extractYouTubeVideoId(c?.data?.videoWebUrl);
                if (!videoId || seenVideoIds.has(videoId)) {
                  return { ...step, status: 'pending' as const, content: undefined };
                }
                seenVideoIds.add(videoId);
                return step;
              })
            : [];
          const deduped = ensureUniqueStepIds(steps, moduleNumberHint);
          return { ...m, steps: ensureLessonStepCoverage(deduped, m.title, course.title) };
        })
      : [],
  };
};

const defaultLessonOptions = (): LessonOptions => ({
  quiz: true,
  gamifiedQuiz: false,
  flashcards: false,
  video: false,
  codeBuilder: false,
  learningCard: false,
});

const createOutlineLesson = (title = 'Lesson 1'): OutlineLesson => ({
  id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title,
  options: defaultLessonOptions(),
});

const createOutlineModule = (index: number): OutlineModule => ({
  id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: `Module ${index}`,
  lessons: [createOutlineLesson('Lesson 1')],
});

const outlineOptionConfigs: LessonOptionConfig[] = [
  { key: 'learningCard', label: 'Learning Cards', contentType: ContentType.LEARNING_CARD, stepLabel: 'Learning cards' },
  { key: 'flashcards', label: 'Flashcards', contentType: ContentType.FLIP_CARD, stepLabel: 'Flashcards' },
  { key: 'video', label: 'Video', contentType: ContentType.VIDEO, stepLabel: 'Video lesson' },
  { key: 'codeBuilder', label: 'Code Builder', contentType: ContentType.CODE_BUILDER, stepLabel: 'Interactive coding' },
  { key: 'gamifiedQuiz', label: 'Gamified Quiz', contentType: ContentType.DRAG_FILL, stepLabel: 'Gamified challenge' },
  { key: 'quiz', label: 'Quiz', contentType: ContentType.QUIZ, stepLabel: 'Quiz' },
];

const defaultSegmentLabelByType = (type: ContentType): string => {
  switch (type) {
    case ContentType.TEXT:
      return 'Core Concepts';
    case ContentType.LEARNING_CARD:
      return 'Learning cards';
    case ContentType.FLIP_CARD:
      return 'Flashcards';
    case ContentType.VIDEO:
      return 'Video lesson';
    case ContentType.CODE_BUILDER:
      return 'Interactive coding';
    case ContentType.DRAG_FILL:
      return 'Gamified challenge';
    case ContentType.QUIZ:
      return 'Quiz';
    case ContentType.ACCORDION:
      return 'Concept breakdown';
    case ContentType.HOTSPOT:
      return 'Interactive hotspot';
    case ContentType.CAROUSEL:
      return 'Guided walkthrough';
    case ContentType.POP_CARD:
      return 'Pop cards';
    default:
      return 'Sub-content';
  }
};

const normalizeTopicFragment = (value: string): string => {
  return String(value || '')
    .replace(/^module\s*\d+\s*[:\-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const PROGRAMMING_TOPIC_PATTERN = /\b(python|javascript|typescript|java|c\+\+|c#|ruby|php|swift|kotlin|golang|go|rust|sql|html|css|react|node|node\.js|django|flask|spring|programming|coding|developer|software|frontend|backend|fullstack|web app|mobile app|algorithm|data structure|devops|api|database|computer science|cybersecurity|machine learning|deep learning|artificial intelligence)\b/i;

const isProgrammingTopic = (...values: Array<string | undefined>): boolean => {
  return values.some((value) => PROGRAMMING_TOPIC_PATTERN.test(normalizeTopicFragment(String(value || ''))));
};

const toPlainSnippet = (value: unknown, limit = 200): string => {
  const plain = String(value || '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/[`*_>#~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}...` : plain;
};

const summarizeStepForReference = (step: Module['steps'][number]): string => {
  const content: any = step.content || {};
  if (!content || typeof content !== 'object') return '';

  if (content.type === 'TEXT') {
    return toPlainSnippet(content?.data?.content || content.lessonText || '');
  }
  if (content.type === 'VIDEO') {
    return toPlainSnippet(`${content?.data?.videoTitle || ''}. ${content?.data?.content || ''}`.trim());
  }
  if (content.type === 'LEARNING_CARD') {
    const cards = Array.isArray(content?.data?.learningCards) ? content.data.learningCards : [];
    return toPlainSnippet(cards.slice(0, 3).map((c: any) => `${c?.title || ''}: ${c?.content || ''}`).join('; '));
  }
  if (content.type === 'FLIP_CARD') {
    const cards = Array.isArray(content?.data?.cards) ? content.data.cards : [];
    return toPlainSnippet(cards.slice(0, 3).map((c: any) => `${c?.front || ''}: ${c?.back || ''}`).join('; '));
  }
  if (content.type === 'ACCORDION') {
    const items = Array.isArray(content?.data?.items) ? content.data.items : [];
    return toPlainSnippet(items.slice(0, 3).map((i: any) => `${i?.title || ''}: ${i?.content || ''}`).join('; '));
  }
  if (content.type === 'HOTSPOT') {
    const points = Array.isArray(content?.data?.points) ? content.data.points : [];
    return toPlainSnippet(points.slice(0, 3).map((p: any) => `${p?.title || ''}: ${p?.content || ''}`).join('; '));
  }
  if (content.type === 'CAROUSEL') {
    const slides = Array.isArray(content?.data?.slides) ? content.data.slides : [];
    return toPlainSnippet(slides.slice(0, 3).map((s: any) => `${s?.title || ''}: ${s?.content || ''}`).join('; '));
  }
  if (content.type === 'POP_CARD') {
    const cards = Array.isArray(content?.data?.cards) ? content.data.cards : [];
    return toPlainSnippet(cards.slice(0, 3).map((c: any) => `${c?.title || ''}: ${c?.content || ''}`).join('; '));
  }
  if (content.type === 'QUIZ') {
    const questions = Array.isArray(content?.data?.questions) ? content.data.questions : [];
    return toPlainSnippet(questions.slice(0, 2).map((q: any) => `${q?.question || ''} (${q?.explanation || ''})`).join('; '));
  }
  if (content.type === 'DRAG_FILL') {
    const challenges = Array.isArray(content?.data?.challenges) ? content.data.challenges : [];
    return toPlainSnippet(challenges.slice(0, 2).map((c: any) => `${c?.instruction || ''} ${c?.codeTemplate || ''}`).join('; '));
  }
  if (content.type === 'CODE_BUILDER') {
    const lines = Array.isArray(content?.data?.codeBuilder?.lines) ? content.data.codeBuilder.lines : [];
    return toPlainSnippet(lines.slice(0, 3).map((l: any) => l?.content || '').join(' ; '));
  }

  return toPlainSnippet(content.lessonText || '');
};

const isGenericLessonLabel = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/^lesson\s*\d+$/i.test(text)) return true;
  if (/^topic\s*\d+$/i.test(text)) return true;
  if (/^section\s*\d+$/i.test(text)) return true;
  return false;
};

const isGenericSubContentTitle = (value: string): boolean => {
  const text = stripStructuredStepPrefix(String(value || ''))
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    .toLowerCase()
    .trim();
  if (!text) return true;
  if (/^sub[\s-]?content\s*\d*$/i.test(text)) return true;
  if (/^segment\s*\d*$/i.test(text)) return true;
  if (/^step\s*\d*$/i.test(text)) return true;
  return [
    'core concepts',
    'learning cards',
    'learning card',
    'flashcards',
    'video lesson',
    'video',
    'concept breakdown',
    'gamified challenge',
    'challenge',
    'interactive coding',
    'quiz',
    'accordion',
    'hotspot',
    'carousel',
    'pop cards',
    'pop card',
    'text',
  ].includes(text);
};

const buildLessonTitle = (rawLessonTitle: string, moduleTitle: string, lessonNumber: number): string => {
  const cleanRaw = normalizeTopicFragment(rawLessonTitle);
  if (cleanRaw && !isGenericLessonLabel(cleanRaw)) return cleanRaw;

  const moduleTopic = normalizeTopicFragment(moduleTitle) || 'Core Topic';
  const lessonPatterns = [
    `Foundations of ${moduleTopic}`,
    `${moduleTopic} in Practice`,
    `Advanced ${moduleTopic} Techniques`,
    `${moduleTopic} Mastery`,
  ];
  return lessonPatterns[Math.max(0, (lessonNumber - 1) % lessonPatterns.length)];
};

const ensureUniqueLessonTitle = (candidateTitle: string, usedTitles: Set<string>): string => {
  const base = normalizeTopicFragment(candidateTitle) || 'Lesson';
  let next = base;
  let counter = 2;
  while (usedTitles.has(next.toLowerCase())) {
    next = `${base} (${counter})`;
    counter += 1;
  }
  usedTitles.add(next.toLowerCase());
  return next;
};

const buildSubContentTitle = (lessonTitle: string, type: ContentType): string => {
  const topic = normalizeTopicFragment(lessonTitle) || 'This Topic';
  switch (type) {
    case ContentType.TEXT:
      return `Core Concepts of ${topic}`;
    case ContentType.LEARNING_CARD:
      return `Learning Cards: ${topic} Essentials`;
    case ContentType.FLIP_CARD:
      return `Flashcards: Key Terms in ${topic}`;
    case ContentType.VIDEO:
      return `Video: ${topic} Walkthrough`;
    case ContentType.CODE_BUILDER:
      return `Interactive Coding: ${topic}`;
    case ContentType.DRAG_FILL:
      return `Challenge: Apply ${topic}`;
    case ContentType.QUIZ:
      return `Quiz: ${topic} Checkpoint`;
    case ContentType.ACCORDION:
      return `Concept Breakdown: ${topic}`;
    case ContentType.HOTSPOT:
      return `Hotspot: ${topic} Exploration`;
    case ContentType.CAROUSEL:
      return `Guided Walkthrough: ${topic}`;
    case ContentType.POP_CARD:
      return `Pop Cards: ${topic} Insights`;
    default:
      return `${defaultSegmentLabelByType(type)}: ${topic}`;
  }
};

const cleanInferredLessonTopic = (value: string): string => {
  return normalizeTopicFragment(String(value || ''))
    .replace(/^core concepts of\s+/i, '')
    .replace(/^key terms in\s+/i, '')
    .replace(/^apply\s+/i, '')
    .replace(/^introduction to\s+/i, '')
    .replace(/^learning cards:\s*/i, '')
    .replace(/^flashcards:\s*/i, '')
    .replace(/\b(essentials?|walkthrough|checkpoint|overview|review|practice)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const inferLessonTopicFromStepTitle = (rawTitle: string, type: ContentType): string => {
  const text = stripStructuredStepPrefix(rawTitle || '');
  if (!text) return '';

  const explicitLesson = text.match(/^lesson\s*\d+\s*[-:]\s*(.+)$/i);
  if (explicitLesson?.[1]) return cleanInferredLessonTopic(explicitLesson[1]);

  const parts = text.split(':');
  if (parts.length < 2) return '';

  const head = parts[0].trim();
  const tail = parts.slice(1).join(':').trim();
  const headLower = head.toLowerCase();

  if (type === ContentType.TEXT) {
    if (headLower === 'core concepts' || headLower === 'introduction' || headLower === 'text') {
      return cleanInferredLessonTopic(tail);
    }
    return cleanInferredLessonTopic(head);
  }
  if (type === ContentType.LEARNING_CARD && /^learning cards?$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/\bessentials?\b/ig, ''));
  }
  if (type === ContentType.FLIP_CARD && /^flashcards?$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/^key terms in\s+/i, ''));
  }
  if (type === ContentType.VIDEO && /^video(?: lesson)?$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/\bwalkthrough\b/ig, ''));
  }
  if (type === ContentType.CODE_BUILDER && /^interactive coding$/i.test(head)) {
    return cleanInferredLessonTopic(tail);
  }
  if (type === ContentType.DRAG_FILL && /^challenge$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/^apply\s+/i, ''));
  }
  if (type === ContentType.QUIZ && /^quiz$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/\bcheckpoint\b/ig, ''));
  }
  if (type === ContentType.ACCORDION && /^concept breakdown$/i.test(head)) {
    return cleanInferredLessonTopic(tail);
  }
  if (type === ContentType.POP_CARD && /^pop cards?$/i.test(head)) {
    return cleanInferredLessonTopic(tail.replace(/\binsights?\b/ig, ''));
  }

  return '';
};

const normalizeGeneratedLessonSteps = (
  steps: Array<{ id: string; title: string; type: ContentType }>,
  moduleNumber: number,
  moduleTitle: string = ''
): Module['steps'] => {
  if (!Array.isArray(steps) || !steps.length) return [];
  const programmingTrack = isProgrammingTopic(moduleTitle);

  let lessonNumber = 0;
  let segmentNumber = 0;
  let lessonTitle = '';
  const usedLessonTitles = new Set<string>();
  const numbered: Module['steps'] = [];

  for (const step of steps) {
    const resolvedType = (!programmingTrack && step.type === ContentType.CODE_BUILDER)
      ? ContentType.DRAG_FILL
      : step.type;
    const rawTitle = stripStructuredStepPrefix(step.title || '');
    const inferredLessonTopic = inferLessonTopicFromStepTitle(rawTitle, resolvedType);
    const explicitLessonMatch = rawTitle.match(/^lesson\s*\d+\s*[-:]\s*(.+)$/i);
    const explicitLessonTopic = explicitLessonMatch?.[1] ? cleanInferredLessonTopic(explicitLessonMatch[1]) : '';
    const startNewLesson =
      numbered.length === 0 ||
      resolvedType === ContentType.TEXT ||
      segmentNumber >= 7 ||
      (!!explicitLessonTopic && explicitLessonTopic.toLowerCase() !== lessonTitle.toLowerCase());

    if (startNewLesson) {
      lessonNumber += 1;
      segmentNumber = 1;
      const lessonSeed = explicitLessonTopic
        || inferredLessonTopic
        || (resolvedType === ContentType.TEXT && rawTitle.includes(':') ? rawTitle.split(':')[0].trim() : '')
        || `Lesson ${lessonNumber}`;
      lessonTitle = ensureUniqueLessonTitle(
        buildLessonTitle(lessonSeed, moduleTitle, lessonNumber),
        usedLessonTitles
      );
    } else {
      segmentNumber += 1;
    }

    const segmentLabel = defaultSegmentLabelByType(resolvedType);
    const hasSpecificRaw = !!rawTitle && !isGenericLessonLabel(rawTitle) && !/^lesson\s*\d+\s*[:\-]?$/i.test(rawTitle);
    const resolvedTitle = rawTitle.includes(':')
      ? rawTitle
      : hasSpecificRaw
      ? `${lessonTitle}: ${rawTitle}`
      : buildSubContentTitle(lessonTitle, resolvedType);

    numbered.push({
      ...step,
      type: resolvedType,
      title: resolvedTitle,
      status: 'pending',
      moduleNumber,
      lessonNumber,
      segmentNumber,
      lessonTitle,
      segmentLabel,
    });
  }

  return numbered;
};

const ensureUniqueStepIds = (steps: Module['steps'], moduleNumber: number): Module['steps'] => {
  const seen = new Map<string, number>();
  return steps.map((step, idx) => {
    const base = String(step.id || `step-${moduleNumber}-${idx + 1}`).trim() || `step-${moduleNumber}-${idx + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) return { ...step, id: base };
    return { ...step, id: `${base}-${count + 1}` };
  });
};

const ensureDistinctLessonTitles = (steps: Module['steps']): Module['steps'] => {
  if (!Array.isArray(steps) || !steps.length) return [];
  const lessonOrder = Array.from(new Set(
    steps
      .map((step) => (typeof step.lessonNumber === 'number' ? step.lessonNumber : null))
      .filter((n): n is number => typeof n === 'number')
  )).sort((a, b) => a - b);
  if (!lessonOrder.length) return steps;

  const used = new Set<string>();
  const mapByLesson = new Map<number, string>();
  for (const lessonNumber of lessonOrder) {
    const sample = steps.find((step) => step.lessonNumber === lessonNumber);
    const base = normalizeTopicFragment(String(sample?.lessonTitle || '').trim()) || `Lesson ${lessonNumber}`;
    let next = base;
    let suffix = 2;
    while (used.has(next.toLowerCase())) {
      next = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(next.toLowerCase());
    mapByLesson.set(lessonNumber, next);
  }

  return steps.map((step) => {
    const lessonNumber = typeof step.lessonNumber === 'number' ? step.lessonNumber : null;
    if (!lessonNumber) return step;
    const lessonTitle = mapByLesson.get(lessonNumber) || step.lessonTitle || `Lesson ${lessonNumber}`;
    const normalizedTitleRaw = stripStructuredStepPrefix(step.title || '');
    const title = normalizedTitleRaw && !isGenericSubContentTitle(normalizedTitleRaw)
      ? normalizedTitleRaw
      : buildSubContentTitle(lessonTitle, step.type);
    return {
      ...step,
      lessonTitle,
      title,
    };
  });
};

const ensureLessonStepCoverage = (steps: Module['steps'], moduleTitle: string = '', courseTitle: string = ''): Module['steps'] => {
  if (!Array.isArray(steps) || !steps.length) return [];
  const programmingTrack = isProgrammingTopic(moduleTitle, courseTitle);

  const requiredFlow: Array<{ type: ContentType; segmentLabel: string }> = programmingTrack
    ? [
        { type: ContentType.TEXT, segmentLabel: 'Core Concepts' },
        { type: ContentType.LEARNING_CARD, segmentLabel: 'Learning cards' },
        { type: ContentType.FLIP_CARD, segmentLabel: 'Flashcards' },
        { type: ContentType.VIDEO, segmentLabel: 'Video lesson' },
        { type: ContentType.CODE_BUILDER, segmentLabel: 'Interactive coding' },
        { type: ContentType.DRAG_FILL, segmentLabel: 'Gamified challenge' },
        { type: ContentType.QUIZ, segmentLabel: 'Quiz' },
      ]
    : [
        { type: ContentType.TEXT, segmentLabel: 'Core Concepts' },
        { type: ContentType.LEARNING_CARD, segmentLabel: 'Learning cards' },
        { type: ContentType.FLIP_CARD, segmentLabel: 'Flashcards' },
        { type: ContentType.VIDEO, segmentLabel: 'Video lesson' },
        { type: ContentType.POP_CARD, segmentLabel: 'Pop cards' },
        { type: ContentType.DRAG_FILL, segmentLabel: 'Gamified challenge' },
        { type: ContentType.QUIZ, segmentLabel: 'Quiz' },
      ];

  const moduleNumber = steps.find((step) => typeof step.moduleNumber === 'number')?.moduleNumber || 1;
  const groups = groupModuleStepsByLesson(steps);
  const complete: Module['steps'] = [];
  let cursor = 1;
  const usedLessonTitles = new Set<string>();

  for (const group of groups) {
    const lessonNumber = group.lessonNumber;
    const lessonTitle = ensureUniqueLessonTitle(
      buildLessonTitle(String(group.lessonTitle || `Lesson ${lessonNumber}`).trim() || `Lesson ${lessonNumber}`, moduleTitle, lessonNumber),
      usedLessonTitles
    );
    const bucket = new Map<ContentType, Module['steps'][number]>();
    const extras: Module['steps'][number][] = [];

    for (const { step } of group.steps) {
      const normalizedType = (!programmingTrack && step.type === ContentType.CODE_BUILDER)
        ? ContentType.DRAG_FILL
        : step.type;
      const normalizedTitleRaw = stripStructuredStepPrefix(step.title || '');
      const normalizedTitle = normalizedTitleRaw && !isGenericSubContentTitle(normalizedTitleRaw)
        ? normalizedTitleRaw
        : buildSubContentTitle(lessonTitle, normalizedType);
      const normalizedStep: Module['steps'][number] = normalizedType === step.type
        ? step
        : {
            ...step,
            type: normalizedType,
            segmentLabel: defaultSegmentLabelByType(normalizedType),
            title: normalizedTitle,
          };

      if (!bucket.has(normalizedType)) {
        bucket.set(normalizedType, normalizedStep);
      } else {
        extras.push(normalizedStep);
      }
    }

    let segmentNumber = 1;

    for (const req of requiredFlow) {
      const existing = bucket.get(req.type);
      const baseTitle = buildSubContentTitle(lessonTitle, req.type);
      const existingTitleRaw = stripStructuredStepPrefix(existing?.title || '');
      const resolvedExistingTitle = existingTitleRaw && !isGenericSubContentTitle(existingTitleRaw)
        ? existingTitleRaw
        : baseTitle;

      complete.push(
        existing
          ? {
              ...existing,
              title: resolvedExistingTitle,
              moduleNumber,
              lessonNumber,
              segmentNumber,
              lessonTitle,
              segmentLabel: req.segmentLabel,
            }
          : {
              id: `step-${moduleNumber}-${lessonNumber}-${segmentNumber}-${req.type.toLowerCase()}`,
              title: baseTitle,
              type: req.type,
              status: 'pending',
              moduleNumber,
              lessonNumber,
              segmentNumber,
              lessonTitle,
              segmentLabel: req.segmentLabel,
            }
      );

      segmentNumber += 1;
    }

    for (const extra of extras) {
      const extraTitleRaw = stripStructuredStepPrefix(extra.title || '');
      const extraTitle = extraTitleRaw && !isGenericSubContentTitle(extraTitleRaw)
        ? extraTitleRaw
        : buildSubContentTitle(lessonTitle, extra.type);
      complete.push({
        ...extra,
        id: extra.id || `step-${moduleNumber}-${lessonNumber}-${segmentNumber}-extra-${cursor}`,
        moduleNumber,
        lessonNumber,
        segmentNumber,
        lessonTitle,
        segmentLabel: extra.segmentLabel || defaultSegmentLabelByType(extra.type),
        title: extraTitle,
      });
      segmentNumber += 1;
      cursor += 1;
    }
  }

  const uniqueIds = ensureUniqueStepIds(complete, moduleNumber);
  return ensureDistinctLessonTitles(uniqueIds);
};

const buildStructuredOutlineCourse = (titleInput: string, modulesInput: OutlineModule[]): Course => {
  const title = titleInput.trim() || 'Custom Course';
  const modules = modulesInput.length ? modulesInput : [createOutlineModule(1)];

  return {
    title,
    description: 'Custom course generated from your manual outline.',
    modules: modules.map((module, moduleIdx) => {
      const moduleTitle = module.title.trim() || `Module ${moduleIdx + 1}`;
      const lessons = module.lessons.length ? module.lessons : [createOutlineLesson('Lesson 1')];
      const lessonTitles = lessons
        .map((lesson, lessonIdx) => lesson.title.trim() || `Lesson ${lessonIdx + 1}`)
        .slice(0, 3);

      let stepCursor = 1;
      const steps: Module['steps'] = [];

      for (const [lessonIdx, lesson] of lessons.entries()) {
        const lessonNumber = lessonIdx + 1;
        const lessonTitle = lesson.title.trim() || `Lesson ${lessonIdx + 1}`;
        let segmentNumber = 1;

        const pushLessonStep = (segmentLabel: string, type: ContentType) => {
          steps.push({
            id: `step-${stepCursor++}`,
            title: `${lessonTitle}: ${segmentLabel}`,
            type,
            status: 'pending',
            moduleNumber: moduleIdx + 1,
            lessonNumber,
            segmentNumber,
            lessonTitle,
            segmentLabel,
          });
          segmentNumber += 1;
        };

        pushLessonStep('Core Concepts', ContentType.TEXT);

        for (const option of outlineOptionConfigs) {
          if (!lesson.options[option.key]) continue;
          pushLessonStep(option.stepLabel, option.contentType);
        }
      }

      if (!steps.some((s) => s.type === ContentType.QUIZ || s.type === ContentType.DRAG_FILL)) {
        steps.push({
          id: `step-${stepCursor++}`,
          title: `Module Review: Knowledge Check`,
          type: ContentType.QUIZ,
          status: 'pending',
          moduleNumber: moduleIdx + 1,
          lessonNumber: lessons.length + 1,
          segmentNumber: 1,
          lessonTitle: 'Module Review',
          segmentLabel: 'Knowledge Check',
        });
      }

      return {
        id: `m-${moduleIdx + 1}`,
        title: moduleTitle,
        description: lessonTitles.length
          ? `Covers: ${lessonTitles.join(', ')}.`
          : 'Interactive lessons and practice.',
        steps,
        status: 'completed',
        isLocked: moduleIdx > 0,
        isCompleted: false,
      };
    }),
  };
};

const groupModuleStepsByLesson = (steps: Module['steps']): GroupedLesson[] => {
  const groups: GroupedLesson[] = [];
  for (const [stepIdx, step] of steps.entries()) {
    if (typeof step.lessonNumber !== 'number') {
      groups.push({
        lessonNumber: groups.length + 1,
        lessonTitle: stripStructuredStepPrefix(step.lessonTitle || step.title) || `Lesson ${groups.length + 1}`,
        steps: [{ step, stepIdx }],
      });
      continue;
    }
    const existing = groups.find((g) => g.lessonNumber === step.lessonNumber);
    if (existing) {
      existing.steps.push({ step, stepIdx });
      continue;
    }
    groups.push({
      lessonNumber: step.lessonNumber,
      lessonTitle: stripStructuredStepPrefix(step.lessonTitle || step.title) || `Lesson ${step.lessonNumber}`,
      steps: [{ step, stepIdx }],
    });
  }
  return groups.sort((a, b) => a.lessonNumber - b.lessonNumber);
};

const resolveStepTitle = (step: Module['steps'][number]) => {
  const clean = (v: unknown) => String(v || '').trim();
  const content: any = step.content || {};
  const contentTitle = clean(content?.title);
  const segmentLabel = clean(step.segmentLabel);
  const lessonTopic = normalizeTopicFragment(step.lessonTitle || '');

  if (step.type === ContentType.VIDEO) {
    const videoTitle = clean(content?.data?.videoTitle);
    if (videoTitle) return videoTitle;
  }

  if (step.type === ContentType.FLIP_CARD) {
    const firstFront = clean(content?.data?.cards?.[0]?.front);
    if (firstFront) return `Flashcards: ${firstFront}`;
  }

  if (step.type === ContentType.QUIZ) {
    const firstQuestion = clean(content?.data?.questions?.[0]?.question);
    if (firstQuestion) return `Quiz: ${firstQuestion}`;
  }

  if (step.type === ContentType.DRAG_FILL) {
    const firstInstruction = clean(content?.data?.challenges?.[0]?.instruction);
    if (firstInstruction) return `Challenge: ${firstInstruction}`;
  }

  if (step.type === ContentType.CODE_BUILDER) {
    const cbTitle = clean(content?.data?.codeBuilder?.title);
    if (cbTitle) return cbTitle;
  }

  if (contentTitle && !isGenericSubContentTitle(contentTitle)) {
    return contentTitle;
  }

  const rawStepTitle = stripStructuredStepPrefix(step.title);
  const fallback = rawStepTitle.split(':').slice(1).join(':').trim() || rawStepTitle;
  if (fallback && !isGenericSubContentTitle(fallback)) return fallback;

  if (lessonTopic) {
    return buildSubContentTitle(lessonTopic, step.type);
  }

  if (fallback) return fallback;
  if (segmentLabel) return segmentLabel;
  return step.title;
};

const normalizePromptDraft = (value: string) => {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([!?.,])\1{2,}/g, '$1$1');
};

const normalizePromptInput = (value: string) => normalizePromptDraft(value).trim();

const normalizeOutlineSnapshot = (value: string): string => {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const resolveOutlineTargetSnapshot = (module: Module, target: OutlineEditTarget): string => {
  const lessonGroups = groupModuleStepsByLesson(Array.isArray(module.steps) ? module.steps : []);
  const pickLessonGroup = (lessonNumber?: number): GroupedLesson | null => {
    if (!lessonGroups.length) return null;
    if (typeof lessonNumber !== 'number') return lessonGroups[0];
    return lessonGroups.find((group) => group.lessonNumber === lessonNumber) || lessonGroups[0];
  };

  const describeLesson = (group: GroupedLesson | null): string => {
    if (!group) return 'Lesson not found';
    const titles = group.steps
      .slice(0, 6)
      .map(({ step, stepIdx }) => {
        const segment = typeof step.segmentNumber === 'number' ? step.segmentNumber : stepIdx + 1;
        return `${group.lessonNumber}.${segment} ${resolveStepTitle(step)}`;
      });
    return [group.lessonTitle, titles.join(' | ')].filter(Boolean).join(' -> ');
  };

  if (target.type === 'module') {
    const lessonNames = lessonGroups
      .slice(0, 6)
      .map((group) => `${group.lessonNumber}. ${group.lessonTitle}`);
    return lessonNames.length
      ? lessonNames.join(' | ')
      : `${module.title} (${module.steps.length} sub-contents)`;
  }

  if (target.type === 'lesson') {
    return describeLesson(pickLessonGroup(target.lessonNumber));
  }

  if (target.type === 'subcontent') {
    const byId = target.stepId
      ? module.steps.find((step) => step.id === target.stepId)
      : null;
    if (byId) return resolveStepTitle(byId);

    const group = pickLessonGroup(target.lessonNumber);
    if (group) {
      if (typeof target.segmentNumber === 'number') {
        const bySegment = group.steps.find(({ step, stepIdx }) => {
          const segment = typeof step.segmentNumber === 'number' ? step.segmentNumber : stepIdx + 1;
          return segment === target.segmentNumber;
        });
        if (bySegment?.step) return resolveStepTitle(bySegment.step);

        const byIndex = group.steps[target.segmentNumber - 1];
        if (byIndex?.step) return resolveStepTitle(byIndex.step);
      }

      if (target.stepTitle) {
        const needle = normalizeOutlineSnapshot(stripStructuredStepPrefix(target.stepTitle));
        const byTitle = group.steps.find(({ step }) => {
          return normalizeOutlineSnapshot(stripStructuredStepPrefix(resolveStepTitle(step))) === needle;
        });
        if (byTitle?.step) return resolveStepTitle(byTitle.step);
      }

      if (group.steps[0]?.step) return resolveStepTitle(group.steps[0].step);
    }

    return String(target.stepTitle || 'Removed from outline').trim() || 'Removed from outline';
  }

  return '';
};

const getPromptValidationError = (value: string): string | null => {
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
};

const getOutlineValidationError = (titleInput: string, modules: OutlineModule[]): string | null => {
  const titleValidation = getPromptValidationError(titleInput);
  if (titleValidation) {
    return `Course title: ${titleValidation}`;
  }

  if (!Array.isArray(modules) || !modules.length) {
    return 'Add at least one module.';
  }

  for (const [moduleIdx, module] of modules.entries()) {
    const moduleTitle = normalizePromptInput(module.title);
    if (moduleTitle.length < 3) {
      return `Module ${moduleIdx + 1} needs a clearer title.`;
    }
    if (!/[\p{L}\p{N}]/u.test(moduleTitle)) {
      return `Module ${moduleIdx + 1} title is invalid.`;
    }

    if (!Array.isArray(module.lessons) || !module.lessons.length) {
      return `Module ${moduleIdx + 1} must include at least one lesson.`;
    }

    for (const [lessonIdx, lesson] of module.lessons.entries()) {
      const lessonTitle = normalizePromptInput(lesson.title);
      if (lessonTitle.length < 3) {
        return `Lesson ${moduleIdx + 1}.${lessonIdx + 1} needs a clearer title.`;
      }
      if (!/[\p{L}\p{N}]/u.test(lessonTitle)) {
        return `Lesson ${moduleIdx + 1}.${lessonIdx + 1} title is invalid.`;
      }
    }
  }

  return null;
};

const getOutlineEditInstructionError = (value: string): string | null => {
  const prompt = normalizePromptInput(value);
  if (!prompt) return 'Describe how you want this outline item edited.';
  if (prompt.length < 8) return 'Add more detail for this edit request.';
  if (!/[\p{L}\p{N}]/u.test(prompt)) return 'Use readable words to describe the edit.';
  if (/(.)\1{5,}/.test(prompt)) return 'Edit instruction looks invalid. Please rephrase it.';
  return null;
};

const getAssessmentAnswerValidationError = (value: string): string | null => {
  const answer = normalizePromptInput(value);
  if (!answer) return 'Please answer before continuing.';
  if (answer.length < 4) return 'Answer is too short.';
  if (!/[\p{L}\p{N}]/u.test(answer)) return 'Use readable words in your answer.';
  if (/[a-z]{10,}/i.test(answer) && /(asdf|qwer|zxcv|hjkl|dfgh|xcvb)/i.test(answer)) {
    return 'Answer looks like random keyboard text. Please enter a real response.';
  }
  return null;
};

const getEmailValidationError = (value: string): string | null => {
  const email = String(value || '').trim();
  if (!email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  return null;
};

const getPasswordValidationError = (value: string): string | null => {
  const password = String(value || '');
  if (!password) return 'Password is required.';
  if (password.length < 6) return 'Password must be at least 6 characters.';
  return null;
};

const sentenceCase = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const convertOutlineDraftToEditableModules = (courseDraft: Course): OutlineModule[] => {
  const source = Array.isArray(courseDraft.modules) ? courseDraft.modules : [];
  const mapped = source.slice(0, 10).map((module, idx) => {
    const moduleTitle = String(module.title || `Module ${idx + 1}`).trim() || `Module ${idx + 1}`;
    const description = String(module.description || '');
    const seeds = description
      .split(/[,;|]/g)
      .map((s) => s.replace(/^covers\s*:/i, '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const lessonTitles = seeds.length ? seeds : [`${moduleTitle} Foundations`, `${moduleTitle} Practice`];

    return {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: sentenceCase(moduleTitle),
      lessons: lessonTitles.map((title) => createOutlineLesson(sentenceCase(title))),
    } as OutlineModule;
  });

  return mapped.length ? mapped : [createOutlineModule(1), createOutlineModule(2)];
};

const getAccountId = () => {
  try {
    const authUserId = localStorage.getItem('nexus_supabase_user_id');
    if (authUserId) return authUserId;
    const key = 'nexus_account_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `local-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'local-anon';
  }
};

const ONBOARDING_TOTAL_STEPS = 8;
const ONBOARDING_LAST_STEP = ONBOARDING_TOTAL_STEPS - 1;
const CV_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CDIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const DISCOVERY_OPTIONS: Array<{ value: NonNullable<UserProfile['discoverySource']>; label: string }> = [
  { value: 'x_twitter', label: 'X / Twitter' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'conference', label: 'Conference' },
  { value: 'friend_colleague', label: 'Friend / Colleague' },
  { value: 'google', label: 'Google' },
  { value: 'llm', label: 'ChatGPT / Perplexity / Claude' },
  { value: 'other_not_sure', label: 'Other / Not sure' },
];

const normalizeExtractedText = (value: string): string => {
  const base = String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\r/g, '\n');
  const lines = base
    .split('\n')
    .map((line) => line.replace(CV_NUMERIC_CLUSTER, ' ').replace(/\b0\s+0\b/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^(?:-?\d+\s*){3,}$/.test(line))
    .filter((line) => !/\b(?:modeles?-de-cv|azurius)\b/i.test(line));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
    if (deduped.length >= 1200) break;
  }
  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const extractPdfLikeText = (raw: string): string => {
  const extracted: string[] = [];
  const re = /\(([^()]{3,500})\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(raw)) !== null) {
    const cleaned = String(match[1] || '')
      .replace(/\\[nrt]/g, ' ')
      .replace(/\\\d{3}/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .trim();
    if (cleaned.length >= 3) extracted.push(cleaned);
    if (extracted.length >= 500) break;
  }
  return normalizeExtractedText(extracted.join('\n'));
};

const readUInt16LE = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 1 >= bytes.length) return 0;
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
};

const readUInt32LE = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 3 >= bytes.length) return 0;
  return (
    (bytes[offset]) |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
};

const decodeXmlEntities = (value: string): string => {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(String(hex || '0'), 16) || 0));
};

const xmlToReadableText = (xml: string): string => {
  const withBreaks = String(xml || '')
    .replace(/<w:tab[^>]*\/>/gi, '\t')
    .replace(/<w:br[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n');
  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  return normalizeExtractedText(decodeXmlEntities(withoutTags));
};

const inflateDeflateRaw = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  const DecompressionCtor: any = (globalThis as any).DecompressionStream;
  if (!DecompressionCtor) return null;
  try {
    // Ensure Blob gets an ArrayBuffer-backed payload (not SharedArrayBuffer-backed).
    const safe = new Uint8Array(bytes.byteLength);
    safe.set(bytes);
    const stream = new Blob([safe.buffer]).stream().pipeThrough(new DecompressionCtor('deflate-raw'));
    const inflated = await new Response(stream).arrayBuffer();
    return new Uint8Array(inflated);
  } catch {
    return null;
  }
};

const extractDocxText = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 22) return '';

  // Search End of Central Directory from file tail.
  let eocdOffset = -1;
  const eocdScanStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= eocdScanStart; i -= 1) {
    if (readUInt32LE(bytes, i) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return '';

  const centralDirectorySize = readUInt32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16);
  if (!centralDirectoryOffset || centralDirectoryOffset >= bytes.length) return '';

  const centralDirectoryEnd = Math.min(bytes.length, centralDirectoryOffset + centralDirectorySize);
  const collected: string[] = [];
  let cursor = centralDirectoryOffset;

  while (cursor + 46 <= centralDirectoryEnd && readUInt32LE(bytes, cursor) === ZIP_CDIR_SIGNATURE) {
    const compressionMethod = readUInt16LE(bytes, cursor + 10);
    const compressedSize = readUInt32LE(bytes, cursor + 20);
    const fileNameLen = readUInt16LE(bytes, cursor + 28);
    const extraLen = readUInt16LE(bytes, cursor + 30);
    const commentLen = readUInt16LE(bytes, cursor + 32);
    const localHeaderOffset = readUInt32LE(bytes, cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLen;
    if (fileNameEnd > bytes.length) break;

    const entryName = decodeUtf8(bytes.subarray(fileNameStart, fileNameEnd)).replace(/\\/g, '/');
    const isTargetXml = /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entryName);

    if (isTargetXml && localHeaderOffset + 30 < bytes.length) {
      const localSig = readUInt32LE(bytes, localHeaderOffset);
      if (localSig === ZIP_LOCAL_SIGNATURE) {
        const localNameLen = readUInt16LE(bytes, localHeaderOffset + 26);
        const localExtraLen = readUInt16LE(bytes, localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataStart >= 0 && dataEnd > dataStart && dataEnd <= bytes.length) {
          const payload = bytes.subarray(dataStart, dataEnd);
          let inflated: Uint8Array | null = null;
          if (compressionMethod === 0) inflated = payload;
          if (compressionMethod === 8) inflated = await inflateDeflateRaw(payload);
          if (inflated && inflated.length) {
            const xmlText = decodeUtf8(inflated);
            const readable = xmlToReadableText(xmlText);
            if (readable) collected.push(readable);
          }
        }
      }
    }

    cursor = fileNameEnd + extraLen + commentLen;
  }

  return normalizeExtractedText(collected.join('\n')).slice(0, 24000);
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const mimeTypeForDocxImage = (entryName: string): string => {
  const lower = String(entryName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return '';
};

const readUInt32BE = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 3 >= bytes.length) return 0;
  return (
    ((bytes[offset] << 24) >>> 0)
    + ((bytes[offset + 1] << 16) >>> 0)
    + ((bytes[offset + 2] << 8) >>> 0)
    + bytes[offset + 3]
  ) >>> 0;
};

const readInt32LE = (bytes: Uint8Array, offset: number): number => {
  const raw = readUInt32LE(bytes, offset);
  if (raw & 0x80000000) return -((~raw + 1) >>> 0);
  return raw;
};

const normalizeZipPath = (pathValue: string): string => {
  const parts = String(pathValue || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
};

const resolveZipTargetPath = (basePath: string, target: string): string => {
  const rawTarget = String(target || '').trim();
  if (!rawTarget) return '';
  let decoded = rawTarget;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    decoded = rawTarget;
  }
  if (decoded.startsWith('/')) return normalizeZipPath(decoded.slice(1)).toLowerCase();
  const baseParts = normalizeZipPath(basePath).split('/').filter(Boolean);
  baseParts.pop();
  return normalizeZipPath(`${baseParts.join('/')}/${decoded}`).toLowerCase();
};

const parseDocxImageRelationshipMap = (relsXml: string): Map<string, string> => {
  const map = new Map<string, string>();
  const source = String(relsXml || '');
  if (!source) return map;
  const relationTagRe = /<Relationship\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = relationTagRe.exec(source)) !== null) {
    const tag = String(match[0] || '');
    const relId = String(tag.match(/\bId=['"]([^'"]+)['"]/i)?.[1] || '').trim();
    const relationType = String(tag.match(/\bType=['"]([^'"]+)['"]/i)?.[1] || '').trim().toLowerCase();
    const rawTarget = String(tag.match(/\bTarget=['"]([^'"]+)['"]/i)?.[1] || '').trim();
    if (!relationType.includes('/image')) continue;
    const target = resolveZipTargetPath('word/document.xml', rawTarget);
    if (!relId || !target) continue;
    map.set(relId, target);
  }
  return map;
};

const parseDocxImageEmbedIds = (documentXml: string): string[] => {
  const ids: string[] = [];
  const source = String(documentXml || '');
  if (!source) return ids;
  const seen = new Set<string>();
  const patterns = [
    /<a:blip\b[^>]*\br:embed=['"]([^'"]+)['"][^>]*\/?>/gi,
    /<v:imagedata\b[^>]*\br:id=['"]([^'"]+)['"][^>]*\/?>/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source)) !== null) {
      const id = String(match[1] || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
};

const detectImageDimensions = (bytes: Uint8Array, mimeType: string): { width: number; height: number } => {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/png' && bytes.length >= 24) {
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const validSig = pngSig.every((v, i) => bytes[i] === v);
    if (validSig) {
      return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
    }
  }
  if (mime === 'image/jpeg' && bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segmentLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segmentLen < 2 || offset + 2 + segmentLen > bytes.length) break;
      const isSOF = (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      );
      if (isSOF) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      offset += 2 + segmentLen;
    }
  }
  if (mime === 'image/gif' && bytes.length >= 10) {
    return {
      width: readUInt16LE(bytes, 6),
      height: readUInt16LE(bytes, 8),
    };
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const riff = String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
    const webp = String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
    if (riff && webp && chunkType === 'VP8X') {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
  }
  if (mime === 'image/bmp' && bytes.length >= 26) {
    return {
      width: Math.abs(readInt32LE(bytes, 18)),
      height: Math.abs(readInt32LE(bytes, 22)),
    };
  }
  return { width: 0, height: 0 };
};

const loadImageDataUrl = (dataUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = dataUrl;
  });
};

const renderScaledDataUrl = (img: HTMLImageElement, maxDim: number, quality: number, mimeType: string): string => {
  const width = img.naturalWidth || 0;
  const height = img.naturalHeight || 0;
  if (!width || !height) return '';
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL(mimeType, quality);
};

const optimizeProfileImageDataUrl = async (dataUrl: string): Promise<string> => {
  const raw = String(dataUrl || '').trim();
  if (!raw) return '';
  if (raw.length <= 1_800_000) return raw;
  if (typeof document === 'undefined') return raw.length <= 4_900_000 ? raw : '';
  try {
    const img = await loadImageDataUrl(raw);
    const presets = [
      { maxDim: 720, quality: 0.88, mimeType: 'image/jpeg' },
      { maxDim: 640, quality: 0.84, mimeType: 'image/jpeg' },
      { maxDim: 560, quality: 0.8, mimeType: 'image/jpeg' },
      { maxDim: 480, quality: 0.74, mimeType: 'image/jpeg' },
      { maxDim: 420, quality: 0.7, mimeType: 'image/jpeg' },
    ];
    let best = '';
    for (const preset of presets) {
      const next = renderScaledDataUrl(img, preset.maxDim, preset.quality, preset.mimeType);
      if (!next) continue;
      if (!best || next.length < best.length) best = next;
      if (next.length <= 1_800_000) return next;
    }
    if (best && best.length <= 4_900_000) return best;
  } catch {
    // Keep original when compression cannot be applied.
  }
  return raw.length <= 4_900_000 ? raw : '';
};

const extractDocxPrimaryImage = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 22) return '';

  let eocdOffset = -1;
  const eocdScanStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= eocdScanStart; i -= 1) {
    if (readUInt32LE(bytes, i) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return '';

  const centralDirectorySize = readUInt32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16);
  if (!centralDirectoryOffset || centralDirectoryOffset >= bytes.length) return '';

  const centralDirectoryEnd = Math.min(bytes.length, centralDirectoryOffset + centralDirectorySize);
  let cursor = centralDirectoryOffset;
  let documentXml = '';
  let documentRelsXml = '';
  const mediaCandidates: Array<{
    entryName: string;
    mimeType: string;
    compressionMethod: number;
    dataStart: number;
    dataEnd: number;
  }> = [];

  while (cursor + 46 <= centralDirectoryEnd && readUInt32LE(bytes, cursor) === ZIP_CDIR_SIGNATURE) {
    const compressionMethod = readUInt16LE(bytes, cursor + 10);
    const compressedSize = readUInt32LE(bytes, cursor + 20);
    const fileNameLen = readUInt16LE(bytes, cursor + 28);
    const extraLen = readUInt16LE(bytes, cursor + 30);
    const commentLen = readUInt16LE(bytes, cursor + 32);
    const localHeaderOffset = readUInt32LE(bytes, cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLen;
    if (fileNameEnd > bytes.length) break;

    const entryName = decodeUtf8(bytes.subarray(fileNameStart, fileNameEnd)).replace(/\\/g, '/');
    const mimeType = mimeTypeForDocxImage(entryName);
    const isMediaFile = /^word\/media\/.+\.(png|jpe?g|webp|gif|bmp)$/i.test(entryName);
    const isDocumentXml = /^word\/document\.xml$/i.test(entryName);
    const isDocumentRels = /^word\/_rels\/document\.xml\.rels$/i.test(entryName);

    if ((isMediaFile || isDocumentXml || isDocumentRels) && localHeaderOffset + 30 < bytes.length) {
      const localSig = readUInt32LE(bytes, localHeaderOffset);
      if (localSig === ZIP_LOCAL_SIGNATURE) {
        const localNameLen = readUInt16LE(bytes, localHeaderOffset + 26);
        const localExtraLen = readUInt16LE(bytes, localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataStart >= 0 && dataEnd > dataStart && dataEnd <= bytes.length) {
          if (isMediaFile && mimeType) {
            mediaCandidates.push({ entryName, mimeType, compressionMethod, dataStart, dataEnd });
          } else {
            const payload = bytes.subarray(dataStart, dataEnd);
            let inflated: Uint8Array | null = null;
            if (compressionMethod === 0) inflated = payload;
            if (compressionMethod === 8) inflated = await inflateDeflateRaw(payload);
            if (inflated && inflated.length) {
              const xmlText = decodeUtf8(inflated);
              if (isDocumentXml) documentXml = xmlText;
              if (isDocumentRels) documentRelsXml = xmlText;
            }
          }
        }
      }
    }

    cursor = fileNameEnd + extraLen + commentLen;
  }

  if (!mediaCandidates.length) return '';

  const relMap = parseDocxImageRelationshipMap(documentRelsXml);
  const embedIds = parseDocxImageEmbedIds(documentXml);
  const mediaOrder = new Map<string, number>();
  embedIds.forEach((relId, idx) => {
    const target = relMap.get(relId);
    if (!target) return;
    if (!mediaOrder.has(target)) mediaOrder.set(target, idx);
  });

  let best: { score: number; mimeType: string; bytes: Uint8Array } | null = null;
  for (const media of mediaCandidates) {
    const payload = bytes.subarray(media.dataStart, media.dataEnd);
    let inflated: Uint8Array | null = null;
    if (media.compressionMethod === 0) inflated = payload;
    if (media.compressionMethod === 8) inflated = await inflateDeflateRaw(payload);
    if (!inflated || inflated.length < 512 || inflated.length > (6 * 1024 * 1024)) continue;

    const dims = detectImageDimensions(inflated, media.mimeType);
    const name = media.entryName.toLowerCase();
    const normalizedPath = normalizeZipPath(name).toLowerCase();
    const ratio = dims.width > 0 && dims.height > 0 ? dims.width / dims.height : 1;
    const area = dims.width * dims.height;
    const orderIdx = mediaOrder.has(normalizedPath) ? Number(mediaOrder.get(normalizedPath)) : 99;

    let score = 0;
    score += Math.max(0, 72 - (orderIdx * 8));
    if (/\b(photo|avatar|portrait|headshot|profile|person)\b/i.test(name)) score += 60;
    if (/\b(logo|europass|header|footer|icon|watermark|emblem|flag)\b/i.test(name)) score -= 180;
    if (dims.width && dims.height) {
      if (Math.min(dims.width, dims.height) < 70) score -= 80;
      if (area < 14_000) score -= 50;
      if (area >= 20_000 && area <= 1_000_000) score += 35;
      if (area > 2_800_000) score -= 15;
      if (ratio >= 0.65 && ratio <= 1.45) score += 42;
      else if (ratio >= 0.5 && ratio <= 1.8) score += 10;
      else score -= 30;
    }
    if (media.mimeType === 'image/png' || media.mimeType === 'image/jpeg') score += 6;
    if (inflated.length < 6_000) score -= 30;

    if (!best || score > best.score) {
      best = { score, mimeType: media.mimeType, bytes: inflated };
    }
  }

  if (!best || best.score < -20) return '';
  const rawDataUrl = `data:${best.mimeType};base64,${uint8ArrayToBase64(best.bytes)}`;
  return await optimizeProfileImageDataUrl(rawDataUrl);
};

const keepLikelyPortrait = async (dataUrl: string): Promise<string> => {
  const raw = String(dataUrl || '').trim();
  if (!raw) return '';
  if (typeof document === 'undefined') return raw;
  try {
    const img = await loadImageDataUrl(raw);
    const width = img.naturalWidth || 0;
    const height = img.naturalHeight || 0;
    if (!width || !height) return '';
    const ratio = width / height;
    const area = width * height;
    if (Math.min(width, height) < 60) return '';
    if (ratio < 0.45 || ratio > 2.2) return '';
    if (area < 10_000) return '';
    return raw;
  } catch {
    return '';
  }
};

const extractCvTextFromFile = async (file: File): Promise<{ text: string; profileImageDataUrl: string }> => {
  const name = String(file.name || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  const isPlainText = mime.startsWith('text/') || /\.(txt|md|markdown|json|csv|rtf)$/i.test(name);
  const isDocx = mime.includes('wordprocessingml.document') || name.endsWith('.docx');

  if (isPlainText) {
    const direct = await file.text();
    return { text: normalizeExtractedText(direct).slice(0, 24000), profileImageDataUrl: '' };
  }

  const arrayBuffer = await file.arrayBuffer();
  if (isDocx) {
    const [docxText, rawProfileImageDataUrl] = await Promise.all([
      extractDocxText(arrayBuffer),
      extractDocxPrimaryImage(arrayBuffer),
    ]);
    const profileImageDataUrl = await keepLikelyPortrait(rawProfileImageDataUrl);
    if (docxText) {
      return { text: docxText.slice(0, 24000), profileImageDataUrl };
    }
    return { text: '', profileImageDataUrl };
  }

  const raw = new TextDecoder('latin1').decode(arrayBuffer);

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfText = extractPdfLikeText(raw);
    if (pdfText) return { text: pdfText.slice(0, 24000), profileImageDataUrl: '' };
  }

  // Lightweight fallback for binary docs when no parser dependency is available.
  const fallback = normalizeExtractedText(
    raw
      .replace(/[^A-Za-z0-9@._:+\-/\s\n]/g, ' ')
      .replace(/\s+/g, ' ')
  );
  return { text: fallback.slice(0, 24000), profileImageDataUrl: '' };
};

const formatLocaleLabel = (loc: SupportedLocale): string => {
  const meta = LOCALE_META[loc];
  return `${meta.country} - ${meta.name}`;
};

const emojiFontStyle: React.CSSProperties = {
  fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif',
};

type LocaleMenuSelectProps = {
  id: string;
  value: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
  listClassName?: string;
};

function LocaleMenuSelect({
  id,
  value,
  onChange,
  ariaLabel,
  className,
  buttonClassName,
  listClassName,
}: LocaleMenuSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeMeta = LOCALE_META[value] || LOCALE_META.en;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900',
          buttonClassName
        )}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-sm leading-none" style={emojiFontStyle}>
            {activeMeta.flag || activeMeta.country}
          </span>
          <span className="truncate font-semibold">{formatLocaleLabel(value)}</span>
        </span>
        <ChevronDown className={cn('w-4 h-4 text-slate-500 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className={cn(
              'absolute z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl',
              listClassName
            )}
            role="listbox"
            aria-label={ariaLabel}
          >
            {SUPPORTED_LOCALES.map((loc) => {
              const meta = LOCALE_META[loc];
              const active = loc === value;
              return (
                <button
                  key={`${id}-${loc}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(normalizeSupportedLocale(loc));
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm',
                    active ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span aria-hidden className="text-sm leading-none" style={emojiFontStyle}>
                    {meta.flag || meta.country}
                  </span>
                  <span className="truncate">{formatLocaleLabel(loc)}</span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const CV_NUMERIC_CLUSTER = /\b(?:-?\d{4,}\s+){1,}-?\d{2,}\b/g;
const CV_SECTION_HEADING = /\b(?:personal information|about me|education(?: and training)?|work experience|language skills|digital skills|hobbies and interests|email address|job applied for|position|replace with)\b/i;
const CV_CONTACT_LABEL = /^(?:-+\s*)?(?:phone|mobile|tel|e-?mail|email|linkedin|contact|address|location)\s*:?$/i;
const CV_KNOWN_LANGUAGE = new Set([
  'english', 'spanish', 'chinese', 'mandarin', 'french', 'german', 'italian', 'portuguese', 'russian',
  'japanese', 'korean', 'arabic', 'hindi', 'bengali', 'burmese', 'myanmar', 'thai', 'vietnamese', 'khmer',
  'lao', 'filipino', 'tagalog', 'indonesian', 'malay', 'urdu', 'turkish', 'dutch', 'swedish', 'norwegian',
  'danish', 'finnish', 'polish', 'ukrainian', 'czech', 'greek',
]);

const cleanCvUiValue = (value: string, max = 220): string => {
  const text = String(value || '')
    .replace(CV_NUMERIC_CLUSTER, ' ')
    .replace(/\b0\s+0\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.slice(0, max);
};

const isMeaninglessCvUiValue = (value: string): boolean => {
  const text = cleanCvUiValue(value, 420);
  if (!text) return true;
  if (CV_CONTACT_LABEL.test(text)) return true;
  if (/^(?:-+\s*)?(?:phone|mobile|tel|e-?mail|email|linkedin|contact|address|location)\s*:/i.test(text)) return true;
  if (/^(?:-?\d+\s*){2,}$/.test(text)) return true;
  if (/^[\W_]+$/u.test(text)) return true;
  if (CV_SECTION_HEADING.test(text)) return true;
  if (/\b(?:modeles?-de-cv|azurius)\b/i.test(text)) return true;
  if (/@/.test(text) && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text)) return true;
  const hasLetter = /\p{L}/u.test(text);
  const digitCount = (text.match(/\d/g) || []).length;
  if (!hasLetter && digitCount >= 3) return true;
  if (digitCount >= 8 && !/\b(?:20\d{2}|19\d{2}|c[12])\b/i.test(text)) return true;
  return false;
};

const normalizeCvUiList = (input: string[] = [], limit = 16, max = 120): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const value = cleanCvUiValue(raw, max);
    if (!value || isMeaninglessCvUiValue(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const looksLikeLanguageEntry = (value: string): boolean => {
  const text = cleanCvUiValue(value, 120);
  if (!text) return false;
  if (/\b(?:experience|education|skill|reference|certification|phone|email|developer)\b/i.test(text)) return false;
  const cefr = text.match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  if (cefr) return true;
  if (/\b(?:native|fluent|intermediate|beginner)\b/i.test(text)) return true;
  const core = text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-–:,]/g, ' ')
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, 3);
  if (!core.length) return false;
  return core.some((token) => CV_KNOWN_LANGUAGE.has(token));
};

const extractSkillsFromLabeledLine = (value: string): string[] => {
  const text = cleanCvUiValue(value, 240);
  if (!text) return [];
  const stripped = text.replace(/^(?:programming languages?|technical skills?|skills?|skill highlights?)\s*:\s*/i, '');
  return stripped
    .split(/[|/,;]+/g)
    .map((part) => cleanCvUiValue(part, 80))
    .filter(Boolean);
};

const sanitizeCvProfileForDisplay = (parsed: CvAnalysisResult['parsed']) => {
  if (!parsed) return null;
  const summary = cleanCvUiValue(parsed.summary || '', 1200);
  const profileImageDataUrl = (() => {
    const raw = String(parsed.profileImageDataUrl || '').trim();
    if (!raw) return '';
	    if (!/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(raw)) return '';
	    if (raw.length > 5_000_000) return '';
	    return raw;
	  })();
  const baseSkills = normalizeCvUiList(parsed.skills || [], 24, 100);
  const baseLanguages = normalizeCvUiList(parsed.languages || [], 16, 80);
  const derivedSkills = [...baseSkills];
  const derivedLanguages = baseLanguages.filter((entry) => looksLikeLanguageEntry(entry));
  const derivedCertifications = normalizeCvUiList(parsed.certifications || [], 16, 160);
  const derivedExperience = (parsed.experience || [])
    .map((item) => ({
      role: isMeaninglessCvUiValue(item.role || '') ? '' : cleanCvUiValue(item.role || '', 120),
      organization: isMeaninglessCvUiValue(item.organization || '') ? '' : cleanCvUiValue(item.organization || '', 120),
      period: isMeaninglessCvUiValue(item.period || '') ? '' : cleanCvUiValue(item.period || '', 90),
      highlights: normalizeCvUiList(item.highlights || [], 4, 180),
    }))
    .filter((item) => item.role || item.organization || item.highlights.length);
  const derivedEducation: Array<{ program: string; institution: string; period: string }> = [];
  for (const item of parsed.education || []) {
    const program = isMeaninglessCvUiValue(item.program || '') ? '' : cleanCvUiValue(item.program || '', 120);
    const institution = isMeaninglessCvUiValue(item.institution || '') ? '' : cleanCvUiValue(item.institution || '', 120);
    const period = isMeaninglessCvUiValue(item.period || '') ? '' : cleanCvUiValue(item.period || '', 90);
    const combined = cleanCvUiValue(`${program} ${institution}`.trim(), 220);
    if (!combined) continue;
    if (CV_CONTACT_LABEL.test(combined) || /^(?:-+\s*)?(?:phone|mobile|tel|e-?mail|email|linkedin|contact|address|location)\s*:/i.test(combined)) {
      continue;
    }
    if (/^(?:references?|references?\s+available)/i.test(combined)) continue;
    if (/^(?:programming languages?|technical skills?|skills?|skill highlights?)\s*:/i.test(combined)) {
      derivedSkills.push(...extractSkillsFromLabeledLine(combined));
      continue;
    }
    if (/\b(?:certification|certificate|certified|license)\b/i.test(combined)) {
      derivedCertifications.push(combined);
      continue;
    }
    if (
      /\b(?:senior|junior|developer|engineer|specializing|experienced|project)\b/i.test(combined)
      && !/\b(?:university|college|institute|bachelor|master|phd|degree|diploma)\b/i.test(combined)
    ) {
      derivedExperience.push({
        role: program,
        organization: institution,
        period,
        highlights: [],
      });
      continue;
    }
    derivedEducation.push({ program, institution, period });
  }
  const fullName = isMeaninglessCvUiValue(parsed.fullName || '') ? '' : cleanCvUiValue(parsed.fullName || '', 120);
  return {
    fullName,
    headline: isMeaninglessCvUiValue(parsed.headline || '') ? '' : cleanCvUiValue(parsed.headline || '', 220),
    summary: isMeaninglessCvUiValue(summary) ? '' : summary,
    location: isMeaninglessCvUiValue(parsed.location || '') ? '' : cleanCvUiValue(parsed.location || '', 120),
    email: isMeaninglessCvUiValue(parsed.email || '') ? '' : cleanCvUiValue(parsed.email || '', 180),
    phone: isMeaninglessCvUiValue(parsed.phone || '') ? '' : cleanCvUiValue(parsed.phone || '', 80),
    profileImageDataUrl,
    skills: normalizeCvUiList(derivedSkills, 20, 100),
    languages: normalizeCvUiList(derivedLanguages, 12, 80),
    experience: derivedExperience
      .filter((item) => item.role || item.organization || item.highlights.length)
      .slice(0, 8),
    education: derivedEducation
      .filter((item) => item.program || item.institution)
      .slice(0, 8),
    certifications: normalizeCvUiList(derivedCertifications, 12, 140),
  };
};

const normalizeInterestTerms = (...values: string[]): string[] => {
  const joined = values
    .map((entry) => String(entry || ''))
    .join(',')
    .toLowerCase();
  const tokens = joined
    .split(/[\n,;/|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const cleaned = token.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (cleaned.length < 2) continue;
    if (!/\p{L}/u.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 12) break;
  }
  return out;
};

const CAREER_GUIDES: CareerGuide[] = [
  {
    id: 'qa-engineer',
    title: 'QA Engineer',
    roleSummary: 'Plan and run software tests, find defects early, and improve release quality with developers.',
    responsibilities: [
      'Design test plans, cases, and regression suites.',
      'Track defects in bug systems and verify fixes.',
      'Collaborate with engineering teams on release quality gates.',
      'Support automation for repeatable test coverage.',
    ],
    requirements: [
      'Strong understanding of software testing fundamentals.',
      'Familiarity with automation and CI/CD workflows.',
      'Attention to detail and analytical problem solving.',
      'Clear written communication for defect reporting.',
    ],
    sources: [
      { label: 'O*NET: Software QA Analysts and Testers', url: 'https://www.onetonline.org/link/summary/15-1253.00' },
      { label: 'BLS: Software Developers, QA Analysts, and Testers', url: 'https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm' },
    ],
    keywords: ['qa', 'quality assurance', 'tester', 'test engineer', 'software testing'],
  },
  {
    id: 'web-designer',
    title: 'Web Designer',
    roleSummary: 'Design user-friendly website interfaces and visual layouts that balance usability and brand goals.',
    responsibilities: [
      'Create responsive page layouts and design systems.',
      'Design interface components and interaction flows.',
      'Collaborate with developers to implement accessible UI.',
      'Iterate on designs using user feedback and analytics.',
    ],
    requirements: [
      'Portfolio demonstrating interface and visual design.',
      'Knowledge of accessibility and responsive design patterns.',
      'Familiarity with prototyping and design tools.',
      'Strong communication with product and engineering teams.',
    ],
    sources: [
      { label: 'BLS: Web Developers and Digital Designers', url: 'https://www.bls.gov/ooh/computer-and-information-technology/web-developers.htm' },
      { label: 'O*NET: Web and Digital Interface Designers', url: 'https://www.onetonline.org/link/summary/15-1255.00' },
    ],
    keywords: ['web designer', 'ui designer', 'ux', 'interface design', 'digital designer', 'web design'],
  },
  {
    id: 'web-developer',
    title: 'Web Developer',
    roleSummary: 'Build and maintain websites and web applications with reliable performance and maintainable code.',
    responsibilities: [
      'Implement features using modern web technologies.',
      'Optimize site performance and browser compatibility.',
      'Integrate APIs, data stores, and authentication flows.',
      'Write tests and maintain production-ready code quality.',
    ],
    requirements: [
      'Proficiency in HTML, CSS, JavaScript, and frameworks.',
      'Understanding of version control and deployment workflows.',
      'Problem-solving for debugging and performance tuning.',
      'Ability to work with product, design, and QA teams.',
    ],
    sources: [
      { label: 'O*NET: Web Developers', url: 'https://www.onetonline.org/link/summary/15-1254.00' },
      { label: 'BLS: Web Developers and Digital Designers', url: 'https://www.bls.gov/ooh/computer-and-information-technology/web-developers.htm' },
    ],
    keywords: ['web developer', 'frontend', 'front-end', 'javascript', 'react', 'html', 'css'],
  },
  {
    id: 'graphic-designer',
    title: 'Graphic Designer',
    roleSummary: 'Translate ideas into visual assets for digital and print channels that communicate clearly.',
    responsibilities: [
      'Create branding, marketing, and campaign visuals.',
      'Prepare production-ready design assets and layouts.',
      'Coordinate with stakeholders on visual direction.',
      'Maintain consistency with brand guidelines.',
    ],
    requirements: [
      'Strong portfolio of visual design projects.',
      'Proficiency with design software and typography basics.',
      'Understanding of composition, color, and hierarchy.',
      'Ability to iterate from feedback and deadlines.',
    ],
    sources: [
      { label: 'BLS: Graphic Designers', url: 'https://www.bls.gov/ooh/arts-and-design/graphic-designers.htm' },
      { label: 'O*NET: Graphic Designers', url: 'https://www.onetonline.org/link/summary/27-1024.00' },
    ],
    keywords: ['graphic design', 'graphic designer', 'branding', 'visual design', 'photoshop', 'illustrator'],
  },
  {
    id: 'data-scientist',
    title: 'Data Scientist',
    roleSummary: 'Use data analysis, modeling, and communication to generate insights and support business decisions.',
    responsibilities: [
      'Collect, clean, and analyze structured and unstructured data.',
      'Build and validate statistical or machine-learning models.',
      'Communicate findings through clear data storytelling.',
      'Partner with teams to prioritize high-impact analytics work.',
    ],
    requirements: [
      'Strong foundation in statistics and data analysis.',
      'Programming skills for data workflows and modeling.',
      'Ability to explain technical results to non-technical teams.',
      'Experience with data visualization and reporting tools.',
    ],
    sources: [
      { label: 'BLS: Data Scientists', url: 'https://www.bls.gov/ooh/math/data-scientists.htm' },
      { label: 'O*NET: Data Scientists', url: 'https://www.onetonline.org/link/summary/15-2051.00' },
    ],
    keywords: ['data scientist', 'data science', 'analytics', 'machine learning', 'python', 'sql'],
  },
];

const selectCareerGuides = (interests: string[], fallbackSkills: string[] = []): CareerGuide[] => {
  const pool = [...interests, ...fallbackSkills].map((entry) => String(entry || '').toLowerCase());
  if (!pool.length) return CAREER_GUIDES.slice(0, 3);
  const scored = CAREER_GUIDES.map((guide) => {
    let score = 0;
    for (const keyword of guide.keywords) {
      if (pool.some((entry) => entry.includes(keyword) || keyword.includes(entry))) score += 1;
    }
    if (pool.some((entry) => entry.includes(guide.title.toLowerCase()))) score += 2;
    return { guide, score };
  });
  const ranked = scored
    .sort((a, b) => b.score - a.score)
    .map((item) => item.guide);
  return ranked.slice(0, 4);
};

const rotateList = <T,>(items: T[], offset: number): T[] => {
  if (!items.length) return [];
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
};

const buildVoiceAnswerHints = (value: string) => {
  const text = String(value || '').trim();
  const words = text ? text.split(/\s+/g).filter(Boolean) : [];
  const filler = (text.match(/\b(um|uh|like|you know|actually|basically|sort of|kind of)\b/gi) || []).length;
  return {
    wordCount: words.length,
    fillerCount: filler,
  };
};

const parseCourseIdFromPath = (pathname: string): string => {
  const match = String(pathname || '').match(/^\/courses\/([^/]+)\/?$/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
};

const formatTrendDateLabel = (date: string): string => {
  const d = new Date(String(date || ''));
  if (!Number.isFinite(d.getTime())) return String(date || '');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const buildCompletionTrendPolyline = (
  points: Array<{ date: string; completionRate: number }>,
  width = 720,
  height = 220,
  padX = 28,
  padY = 20
) => {
  const safe = (Array.isArray(points) ? points : []).map((row) => ({
    date: String(row?.date || ''),
    completionRate: Math.max(0, Math.min(100, Number(row?.completionRate || 0))),
  }));
  if (!safe.length) {
    return {
      polyline: '',
      dots: [] as Array<{ x: number; y: number; value: number; date: string }>,
      xTicks: [] as Array<{ x: number; label: string }>,
      yTicks: [0, 25, 50, 75, 100].map((v) => ({ y: padY + ((100 - v) / 100) * Math.max(1, height - padY * 2), label: `${v}%` })),
      width,
      height,
    };
  }
  const innerW = Math.max(1, width - padX * 2);
  const innerH = Math.max(1, height - padY * 2);
  const denominator = Math.max(1, safe.length - 1);
  const dots = safe.map((row, idx) => {
    const x = padX + (idx / denominator) * innerW;
    const y = padY + ((100 - row.completionRate) / 100) * innerH;
    return { x, y, value: row.completionRate, date: row.date };
  });
  const polyline = dots.map((p) => `${p.x},${p.y}`).join(' ');

  const xTickIndexes = Array.from(new Set([
    0,
    Math.floor((safe.length - 1) / 2),
    safe.length - 1,
  ]));
  const xTicks = xTickIndexes.map((idx) => {
    const dot = dots[idx];
    return { x: dot.x, label: formatTrendDateLabel(safe[idx].date) };
  });
  const yTicks = [0, 25, 50, 75, 100].map((v) => ({
    y: padY + ((100 - v) / 100) * innerH,
    label: `${v}%`,
  }));
  return { polyline, dots, xTicks, yTicks, width, height };
};

const DEFAULT_PROFILE: UserProfile = {
  id: '',
  userSegment: 'youth',
  connectivityLevel: 'normal',
  learningGoal: '',
  preferredLanguage: 'en',
  region: 'ASEAN',
  discoverySource: 'x_twitter',
  deviceClass: 'unknown',
  lowBandwidthMode: false,
  professionalVisibility: 'private',
  cvRequiredFormat: 'other',
  cvValidated: false,
  cvUpdatedAt: '',
  cvFileName: '',
};

const DEFAULT_IMPACT: ImpactMetrics = {
  usersReached: 0,
  skillGainPp: 0,
  confidenceGain: 0,
  completionRate: 0,
  avgTimeToCompletionMins: 0,
  d7Retention: 0,
};

const PROGRESS_SCHEMA_VERSION = 2;
const MODULE_PARALLEL_WORKERS = (() => {
  const raw = Number(import.meta.env.VITE_MODULE_PARALLEL_WORKERS || 4);
  if (!Number.isFinite(raw) || raw <= 0) return 4;
  return Math.max(1, Math.min(Math.floor(raw), 8));
})();
const READ_SCROLL_COMPLETE_RATIO = 0.9;
const READ_DWELL_COMPLETE_MS = 2000;
const READ_TRACKED_TYPES = new Set<string>([
  ContentType.TEXT,
  ContentType.ACCORDION,
  ContentType.LEARNING_CARD,
  ContentType.HOTSPOT,
  ContentType.CAROUSEL,
  ContentType.POP_CARD,
]);
const INTERVIEW_RECORDING_LIMIT_SECONDS = 120;
const INTERVIEW_VOICE_UNSUPPORTED_MESSAGE = 'Voice transcription requires Chrome/Edge Web Speech API. Use text mode in this browser.';
const INTERVIEW_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English' },
  { value: 'my-MM', label: 'Burmese' },
  { value: 'id-ID', label: 'Indonesian' },
  { value: 'ms-MY', label: 'Malay' },
  { value: 'th-TH', label: 'Thai' },
  { value: 'vi-VN', label: 'Vietnamese' },
  { value: 'tl-PH', label: 'Filipino' },
  { value: 'km-KH', label: 'Khmer' },
  { value: 'lo-LA', label: 'Lao' },
] as const;

const localeToInterviewLanguage = (value: SupportedLocale | string): string => {
  const locale = normalizeSupportedLocale(value);
  if (locale === 'my') return 'my-MM';
  if (locale === 'id') return 'id-ID';
  if (locale === 'ms') return 'ms-MY';
  if (locale === 'th') return 'th-TH';
  if (locale === 'vi') return 'vi-VN';
  if (locale === 'tl') return 'tl-PH';
  if (locale === 'km') return 'km-KH';
  if (locale === 'lo') return 'lo-LA';
  return 'en-US';
};

const interviewLanguageToShortCode = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'en';
  const localeCode = normalizeSupportedLocale(normalized, 'en');
  if (localeCode && localeCode !== 'en') return localeCode;
  const lower = normalized.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('my') || lower.includes('myanmar') || lower.includes('burmese')) return 'my';
  if (lower.startsWith('id') || lower.includes('indonesia')) return 'id';
  if (lower.startsWith('ms') || lower.includes('malay')) return 'ms';
  if (lower.startsWith('th') || lower.includes('thai')) return 'th';
  if (lower.startsWith('vi') || lower.includes('vietnam')) return 'vi';
  if (lower.startsWith('tl') || lower.startsWith('fil') || lower.includes('tagalog') || lower.includes('filipino')) return 'tl';
  if (lower.startsWith('km') || lower.includes('khmer')) return 'km';
  if (lower.startsWith('lo') || lower.includes('lao')) return 'lo';
  return 'en';
};

const normalizeInterviewLanguageSelection = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return 'en-US';
  const direct = INTERVIEW_LANGUAGE_OPTIONS.find((opt) => opt.value.toLowerCase() === raw.toLowerCase());
  if (direct) return direct.value;
  return localeToInterviewLanguage(interviewLanguageToShortCode(raw));
};

const getInterviewSpeechRecognitionCtor = (): any => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

const getInterviewFallbackFeedbackCopy = (shortCode: string) => {
  if (shortCode === 'th') {
    return {
      feedback: 'ระบบให้คำแนะนำรายคำถามอัตโนมัติใช้งานไม่ได้ชั่วคราว กรุณาทบทวนความชัดเจน โครงสร้าง และความตรงประเด็นก่อนลองอีกครั้ง',
      sampleResponse: 'ใช้โครงสร้าง STAR: สถานการณ์ ภารกิจ การลงมือทำ และผลลัพธ์ที่วัดได้ โดยตอบให้กระชับ',
      toneFeedback: 'ใช้น้ำเสียงมั่นใจและตรงประเด็น',
      grammarFeedback: 'ใช้ประโยคสั้นที่สมบูรณ์และใช้ active voice',
      pronunciationVoice: 'พูดช้าลงเล็กน้อยและเน้นคำสำคัญให้ชัดเจน',
      pronunciationText: 'ไม่พร้อมใช้งานสำหรับคำตอบแบบพิมพ์',
    };
  }
  return {
    feedback: 'Automatic question-level feedback is temporarily unavailable. Review clarity, structure, and relevance before your next attempt.',
    sampleResponse: 'Use STAR: situation, task, action, and measurable result in concise language.',
    toneFeedback: 'Keep confident and direct wording.',
    grammarFeedback: 'Use short complete sentences with active voice.',
    pronunciationVoice: 'Slow down and articulate key terms clearly.',
    pronunciationText: 'Not available for typed answers.',
  };
};

export default function App() {
  const normalizeProvider = (value: string): ProviderId => {
    if (
      value === 'openrouter' ||
      value === 'mistral' ||
      value === 'ollama' ||
      value === 'gemini' ||
      value === 'openai' ||
      value === 'anthropic'
    ) {
      return value;
    }
    return 'auto';
  };

  const [state, setState] = useState<AppState>('idle');
  const [showStarter, setShowStarter] = useState<boolean>(() => {
    try {
      const authId = localStorage.getItem('nexus_supabase_user_id');
      if (authId) return false;
      const raw = localStorage.getItem('nexus_supabase_user');
      if (!raw) return true;
      const parsed = JSON.parse(raw);
      return !parsed?.id;
    } catch {
      return true;
    }
  });
  const [openStarterFaq, setOpenStarterFaq] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [useOutlineMode, setUseOutlineMode] = useState(false);
  const [outlineText] = useState('');
  const [outlineTitle, setOutlineTitle] = useState('');
  const [outlineModules, setOutlineModules] = useState<OutlineModule[]>([
    createOutlineModule(1),
    createOutlineModule(2),
    createOutlineModule(3),
  ]);
  const [isOutlineBuilderOpen, setIsOutlineBuilderOpen] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>('default');
  const [careerPromptSeed, setCareerPromptSeed] = useState(0);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [shakePrompt, setShakePrompt] = useState(false);
  const [interviewRecommendedJobs, setInterviewRecommendedJobs] = useState<InterviewRecommendedJob[]>([]);
  const [interviewJobsBusy, setInterviewJobsBusy] = useState(false);
  const [selectedInterviewJobTitle, setSelectedInterviewJobTitle] = useState('');
  const [interviewTargetLanguage, setInterviewTargetLanguage] = useState<string>(() => localeToInterviewLanguage(getLocale()));
  const [interviewQuestionFocus, setInterviewQuestionFocus] = useState<'mixed' | 'behavioral' | 'technical'>('mixed');
  const [interviewSeniority, setInterviewSeniority] = useState<'entry' | 'mid' | 'senior'>('mid');
  const [interviewSession, setInterviewSession] = useState<InterviewSession | null>(null);
  const [interviewActiveQuestionIdx, setInterviewActiveQuestionIdx] = useState(0);
  const [interviewAnswersByQuestionId, setInterviewAnswersByQuestionId] = useState<Record<string, string>>({});
  const [interviewAnswerModeByQuestionId, setInterviewAnswerModeByQuestionId] = useState<Record<string, 'text' | 'voice'>>({});
  const [interviewVoiceMetaByQuestionId, setInterviewVoiceMetaByQuestionId] = useState<Record<string, { confidence: number; fillerCount: number; wordCount: number }>>({});
  const [interviewFeedbackByQuestionId, setInterviewFeedbackByQuestionId] = useState<Record<string, InterviewAnswerFeedback>>({});
  const [interviewFinalReview, setInterviewFinalReview] = useState<InterviewFinalReview | null>(null);
  const [interviewFinalBusy, setInterviewFinalBusy] = useState(false);
  const [interviewReviewOpen, setInterviewReviewOpen] = useState(false);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [recordingQuestionId, setRecordingQuestionId] = useState<string | null>(null);
  const [interviewReviewProgress, setInterviewReviewProgress] = useState(0);
  const [interviewRecordingElapsedSeconds, setInterviewRecordingElapsedSeconds] = useState(0);
  const [interviewRecordedSecondsByQuestionId, setInterviewRecordedSecondsByQuestionId] = useState<Record<string, number>>({});
  const [interviewTranscribingQuestionId, setInterviewTranscribingQuestionId] = useState<string | null>(null);
  const [interviewVoiceWaveBars, setInterviewVoiceWaveBars] = useState<number[]>(() => Array.from({ length: 24 }, () => 0.08));
  const speechRecognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingElapsedRef = useRef(0);
  const recordingStartedAtMsRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const waveRuntimeBarsRef = useRef<number[]>(Array.from({ length: 24 }, () => 0.08));
  const recordingTimerRef = useRef<number | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const outlineTitleInputRef = useRef<HTMLInputElement | null>(null);
  const outlineScrollRef = useRef<HTMLDivElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const legacyProgressRef = useRef(false);
  const readTrackingRuntimeRef = useRef<
    Record<string, {
      maxRatio: number;
      dwellMs: number;
      lastTick: number;
      startedAt: string;
      completed: boolean;
      persistedRatio: number;
      persistedDwellMs: number;
    }>
  >({});
  const trackedCourseStartRef = useRef<string | null>(null);
  const trackedLessonRef = useRef<string | null>(null);
  const trackedCompletedLessonRef = useRef<string | null>(null);
  const trackedDailyRef = useRef<string | null>(null);
  const autoPublishedCourseSignaturesRef = useRef<Record<string, string>>({});
  const autoPublishingCourseIdsRef = useRef<Set<string>>(new Set());
  const autoRetriedVideoStepsRef = useRef<Set<string>>(new Set());
  const autoRetriedFallbackStepsRef = useRef<Set<string>>(new Set());
  const resolvedSharedCourseIdRef = useRef('');

  const [assessment, setAssessment] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assessmentDraft, setAssessmentDraft] = useState('');
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [currentAssessmentIdx, setCurrentAssessmentIdx] = useState(0);
  const [course, setCourse] = useState<Course | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [isGeneratingModules, setIsGeneratingModules] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [routerProvider, setRouterProvider] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('nexus_router_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        return cfg.provider || 'auto';
      }
    } catch {}
    return 'auto';
  });
  const [routerModel, setRouterModel] = useState<string>(() => {
    const sanitizeModel = (value: string) => {
      const model = String(value || 'auto').trim() || 'auto';
      return model === 'gemini-3-flash-preview' ? 'auto' : model;
    };
    try {
      const raw = localStorage.getItem('nexus_router_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        return sanitizeModel(cfg.model || 'auto');
      }
      const mode = localStorage.getItem('nexus_model_mode');
      const manual = localStorage.getItem('nexus_model_manual');
      return mode === 'manual' && manual ? sanitizeModel(manual) : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [activeLessonByModule, setActiveLessonByModule] = useState<Record<string, number>>({});
  const [isRetrying, setIsRetrying] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number, delay: number } | null>(null);
  const [interactionProgress, setInteractionProgress] = useState<Record<string, StepInteractionProgress>>({});
  const [mascotToast, setMascotToast] = useState<MascotToastState | null>(null);
  const [accountId, setAccountId] = useState<string>(() => getAccountId());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<UserProfile>(DEFAULT_PROFILE);
  const [cvUploadMeta, setCvUploadMeta] = useState<{ name: string; size: number; type: string } | null>(null);
  const [cvAnalysis, setCvAnalysis] = useState<CvAnalysisResult | null>(null);
  const [cvAnalyzeBusy, setCvAnalyzeBusy] = useState(false);
  const [cvAnalysisError, setCvAnalysisError] = useState<string | null>(null);
  const [cvResubmitStatus, setCvResubmitStatus] = useState<CvResubmitStatus>('idle');
  const [cvResubmitMessage, setCvResubmitMessage] = useState('');
  const [cvResubmitDirty, setCvResubmitDirty] = useState(false);
  const [careerInterestsInput, setCareerInterestsInput] = useState('');
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement | null>(null);
  const [locale, setLocaleState] = useState<SupportedLocale>(() => normalizeSupportedLocale(getLocale()));
  const [activeHomeTab, setActiveHomeTab] = useState<HomeTab>('learn');
  const [sidebarView, setSidebarView] = useState<SidebarView>('outline');
  const [lowBandwidthMode, setLowBandwidthMode] = useState<boolean>(() => {
    try { return localStorage.getItem('nexus_low_bandwidth_mode') === '1'; } catch { return false; }
  });
  const [impactMetrics, setImpactMetrics] = useState<ImpactMetrics>(DEFAULT_IMPACT);
  const [downloadStates, setDownloadStates] = useState<DownloadState[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityNotice, setCommunityNotice] = useState<string | null>(null);
  const [isOpeningCourse, setIsOpeningCourse] = useState<boolean>(() => !!parseCourseIdFromPath(window.location.pathname));
  const [visibilityBusyByCourseId, setVisibilityBusyByCourseId] = useState<Record<string, boolean>>({});
  const [myPostsCount, setMyPostsCount] = useState(0);
  const [publicPostsCount, setPublicPostsCount] = useState(0);
  const [myCourses, setMyCourses] = useState<PublicCoursePost[]>([]);
  const [publicFeed, setPublicFeed] = useState<PublicCoursePost[]>([]);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, Array<{ id: string; accountId: string; text: string; createdAt: string }>>>({});
  const [commentDraftByPost, setCommentDraftByPost] = useState<Record<string, string>>({});
  const [commentBusyByPost, setCommentBusyByPost] = useState<Record<string, boolean>>({});
  const [reactionBusyByPost, setReactionBusyByPost] = useState<Record<string, boolean>>({});
  const [publicIdentityByAccountId, setPublicIdentityByAccountId] = useState<Record<string, PublicIdentity>>({});
  const [activeCommunityPost, setActiveCommunityPost] = useState<PublicCoursePost | null>(null);
  const [shareModalPost, setShareModalPost] = useState<PublicCoursePost | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState<PublicCreatorProfile | null>(null);
  const [creatorProfileBusy, setCreatorProfileBusy] = useState(false);
  const [creatorFollowBusy, setCreatorFollowBusy] = useState(false);
  const [creatorProfileError, setCreatorProfileError] = useState<string | null>(null);
  const [activeCourseId, setActiveCourseId] = useState('');
  const [activeCourseOwnerId, setActiveCourseOwnerId] = useState('');
  const [analyticsByCourse, setAnalyticsByCourse] = useState<Record<string, ImpactMetrics>>({});
  const [courseAnalyticsByCourseId, setCourseAnalyticsByCourseId] = useState<Record<string, CourseAnalyticsSummary>>({});
  const [activeAnalyticsCourseId, setActiveAnalyticsCourseId] = useState('');
  const [courseAnalyticsBusy, setCourseAnalyticsBusy] = useState(false);
  const [courseAnalyticsError, setCourseAnalyticsError] = useState<string | null>(null);
  const [learningCourses, setLearningCourses] = useState<LearningCourseSummary[]>([]);
  const [cohortName, setCohortName] = useState('');
  const [activeCohortId, setActiveCohortId] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(() => {
    try {
      const raw = localStorage.getItem('nexus_supabase_user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.id) return null;
      return { id: String(parsed.id), email: parsed.email ? String(parsed.email) : '' };
    } catch {
      return null;
    }
  });
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const publicIdentityLoadingRef = useRef<Set<string>>(new Set());
  const [outlineReviewSelection, setOutlineReviewSelection] = useState<OutlineEditTarget[]>([]);
  const [outlineReviewLessonByModule, setOutlineReviewLessonByModule] = useState<Record<string, number>>({});
  const [outlineDropActive, setOutlineDropActive] = useState(false);
  const [isOutlinePromptSequenceOpen, setIsOutlinePromptSequenceOpen] = useState(false);
  const [outlinePromptCursor, setOutlinePromptCursor] = useState(0);
  const [outlinePromptDraft, setOutlinePromptDraft] = useState('');
  const [outlinePromptByTarget, setOutlinePromptByTarget] = useState<Record<string, string>>({});
  const [outlineReviewError, setOutlineReviewError] = useState<string | null>(null);
  const [isRecraftingOutline, setIsRecraftingOutline] = useState(false);
  const [outlineProcessingTargetKey, setOutlineProcessingTargetKey] = useState<string | null>(null);
  const [outlineFocusTargetKey, setOutlineFocusTargetKey] = useState<string | null>(null);
  const [outlineEditSummary, setOutlineEditSummary] = useState<OutlineEditSummary | null>(null);
  const [isOutlineSummaryModalOpen, setIsOutlineSummaryModalOpen] = useState(false);
  const outlineTargetRefs = useRef<Record<string, HTMLElement | null>>({});

  const stepProgressKey = (moduleId: string, stepId: string) => `${moduleId}:${stepId}`;

  const upsertStepProgress = (
    moduleId: string,
    stepId: string,
    updater: (prev: StepInteractionProgress) => StepInteractionProgress
  ) => {
    const key = stepProgressKey(moduleId, stepId);
    setInteractionProgress((prev) => {
      const previous = prev[key] || {};
      return {
        ...prev,
        [key]: {
          ...updater(previous),
          lastUpdated: new Date().toISOString(),
        },
      };
    });
  };

  const showMascotToast = (title: string, subtitle: string, mood: MascotToastState['mood'] = 'happy') => {
    setMascotToast({ id: Date.now(), title, subtitle, mood });
  };

  const buildPublicIdentity = (id: string, profile: PublicCreatorProfile | null): PublicIdentity => {
    const accountKey = String(id || '').trim();
    const dashboardName = String(profile?.dashboard?.fullName || '').trim();
    const profileName = String(profile?.displayName || '').trim();
    const profileImageDataUrl = String(
      profile?.profileImageDataUrl
      || profile?.dashboard?.profileImageDataUrl
      || ''
    ).trim();
    return {
      displayName: dashboardName || profileName || fallbackPublicDisplayName(accountKey),
      profileImageDataUrl: profileImageDataUrl || DEFAULT_PUBLIC_PROFILE_IMAGE,
    };
  };

  const resolvePublicIdentity = async (id: string) => {
    const accountKey = String(id || '').trim();
    if (!accountKey) return;
    if (publicIdentityByAccountId[accountKey]) return;
    if (publicIdentityLoadingRef.current.has(accountKey)) return;
    publicIdentityLoadingRef.current.add(accountKey);
    try {
      const profilePayload = await aiService.getPublicCreatorProfile(accountKey);
      const nextIdentity = buildPublicIdentity(accountKey, profilePayload);
      setPublicIdentityByAccountId((prev) => (
        prev[accountKey] ? prev : { ...prev, [accountKey]: nextIdentity }
      ));
    } catch {
      setPublicIdentityByAccountId((prev) => (
        prev[accountKey]
          ? prev
          : {
              ...prev,
              [accountKey]: {
                displayName: fallbackPublicDisplayName(accountKey),
                profileImageDataUrl: DEFAULT_PUBLIC_PROFILE_IMAGE,
              },
            }
      ));
    } finally {
      publicIdentityLoadingRef.current.delete(accountKey);
    }
  };

  const hydrateCommentIdentities = (rows: Array<{ accountId: string }>) => {
    const ids = Array.from(new Set((rows || []).map((row) => String(row?.accountId || '').trim()).filter(Boolean)));
    for (const id of ids) void resolvePublicIdentity(id);
  };

  const getStepProgress = (moduleId: string, stepId: string): StepInteractionProgress => {
    return interactionProgress[stepProgressKey(moduleId, stepId)] || {};
  };

  const isReadTrackedStep = (step: Module['steps'][number]): boolean => {
    const resolvedType = normalizeContentType((step.content as any)?.type || step.type);
    return isReadTrackedType(resolvedType);
  };

  const computeReadScrollRatio = (el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const ratio = (viewportHeight - rect.top) / Math.max(rect.height, 1);
    return Math.max(0, Math.min(1, ratio));
  };

  const isStepLearnerComplete = (moduleId: string, step: Module['steps'][number]): boolean => {
    if (step.status !== 'completed') return false;
    const track = getStepProgress(moduleId, step.id);
    const content: any = step.content || {};
    const cardTotal = Array.isArray(content?.data?.cards) ? content.data.cards.length : 0;
    const dragTotal = Array.isArray(content?.data?.challenges) ? content.data.challenges.length : 0;
    const resolvedType = normalizeContentType(content?.type || step.type);
    const legacyAutoComplete = legacyProgressRef.current && !('readCompleted' in track);

    if (step.type === ContentType.VIDEO) {
      return !!track.videoCompleted;
    }
    if (step.type === ContentType.FLIP_CARD) {
      const total = track.flashcardsTotal || cardTotal || 1;
      return (track.flashcardsViewed || 0) >= total;
    }
    if (step.type === ContentType.QUIZ) {
      return !!track.quizPassed;
    }
    if (step.type === ContentType.DRAG_FILL) {
      const total = track.dragFillTotal || dragTotal || 1;
      return (track.dragFillCompleted || 0) >= total;
    }
    if (step.type === ContentType.CODE_BUILDER) {
      return !!track.codeBuilderCompleted;
    }
    if (isReadTrackedType(resolvedType)) {
      if (legacyAutoComplete) return true;
      return !!track.readCompleted;
    }
    return legacyAutoComplete;
  };

  const getModuleLearningProgress = (module: Module) => {
    const total = module.steps.length;
    const completed = module.steps.filter((step) => isStepLearnerComplete(module.id, step)).length;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  };

  const buildStepReferenceContext = (module: Module, stepId: string): string => {
    const targetIdx = module.steps.findIndex((step) => step.id === stepId);
    const scopedSteps = module.steps
      .slice(0, targetIdx >= 0 ? targetIdx : module.steps.length)
      .filter((step) => step.status === 'completed' && !!step.content);

    if (!scopedSteps.length) return '';

    const refs = scopedSteps
      .slice(-4)
      .map((step) => {
        const title = resolveStepTitle(step);
        const summary = summarizeStepForReference(step);
        return summary ? `- ${title}: ${summary}` : '';
      })
      .filter(Boolean);

    return refs.length
      ? `Reference points from earlier parts of this module:\n${refs.join('\n')}`.slice(0, 1400)
      : '';
  };

  const generateStepWithFallbackRetry = async (
    courseTitle: string,
    moduleTitle: string,
    stepTitle: string,
    type: ContentType,
    referenceContext: string,
    onRetry?: (attempt: number, delay: number) => void
  ): Promise<ModuleContent> => {
    const generated = await aiService.generateStepContent(
      courseTitle,
      moduleTitle,
      stepTitle,
      type,
      { referenceContext, forceFresh: false },
      onRetry
    );
    if (isFallbackModuleContent(generated)) {
      throw new Error('AI provider returned fallback content. Local fallback is disabled.');
    }
    return generated;
  };

  const scrollToStep = (stepId: string) => {
    const element = document.getElementById(`step-${stepId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    // Load progress from local storage
    try {
      const saved = localStorage.getItem('nexus_progress');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      const {
        points: p,
        streak: s,
        course: c,
        state: st,
        activeModuleId: am,
        assessment: as,
        answers: an,
        currentAssessmentIdx: cai,
        prompt: pr,
        interactionProgress: ip,
        progressSchemaVersion: sv,
      } = parsed;
      legacyProgressRef.current = Number(sv || 1) < PROGRESS_SCHEMA_VERSION;

      setPoints(p || 0);
      setStreak(s || 0);
      if (c) {
        setCourse(sanitizeCourse(c));
        setActiveCourseOwnerId('');
      }
      if (st) setState(st);
      if (am) setActiveModuleId(am);
      if (am) setExpandedModuleId(am);
      if (as) setAssessment(as);
      if (an) setAnswers(an);
      if (cai !== undefined) setCurrentAssessmentIdx(cai);
      if (pr) setPrompt(pr);
      if (ip && typeof ip === 'object') setInteractionProgress(ip);
    } catch {
      try { localStorage.removeItem('nexus_progress'); } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('nexus_progress', JSON.stringify({ 
      progressSchemaVersion: PROGRESS_SCHEMA_VERSION,
      points, 
      streak, 
      course, 
      state, 
      activeModuleId,
      assessment,
      answers,
      currentAssessmentIdx,
      prompt,
      interactionProgress,
    }));
  }, [points, streak, course, state, activeModuleId, assessment, answers, currentAssessmentIdx, prompt, interactionProgress]);

  useEffect(() => {
    try {
      // Candidate list (mostly used for Gemini rotation)
      let candidates = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      const existing = localStorage.getItem('nexus_model_candidates');
      if (existing) {
        const parsed = existing
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .filter((m) => m !== 'gemini-3-flash-preview');
        if (parsed.length) candidates = parsed;
      } else {
        localStorage.setItem('nexus_model_candidates', candidates.join(','));
      }

      const mode = (routerProvider !== 'auto' || routerModel !== 'auto') ? 'manual' : 'auto';
      localStorage.setItem('nexus_router_config', JSON.stringify({
        mode,
        provider: routerProvider,
        model: routerModel,
        modelCandidates: candidates,
      }));

      // Backward-compatibility for older builds
      if (routerModel && routerModel !== 'auto') {
        localStorage.setItem('nexus_model_mode', 'manual');
        localStorage.setItem('nexus_model_manual', routerModel);
      } else {
        localStorage.setItem('nexus_model_mode', 'auto');
      }
    } catch {
      // ignore
    }
  }, [routerProvider, routerModel]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const sharedCourseId = parseCourseIdFromPath(window.location.pathname);
    if (!sharedCourseId) {
      setIsOpeningCourse(false);
      return;
    }
    if (resolvedSharedCourseIdRef.current === sharedCourseId) {
      setIsOpeningCourse(false);
      return;
    }
    let cancelled = false;
    setIsOpeningCourse(true);
    setGlobalError(null);
    (async () => {
      try {
        let post: PublicCoursePost | null = null;
        for (let attempt = 0; attempt < 5 && !post; attempt += 1) {
          try {
            post = await aiService.getPublicCourse(sharedCourseId);
          } catch {
            post = null;
          }
          if (!post) {
            try {
              const mine = await aiService.listMyCourses();
              post = mine.find((row) => row.courseId === sharedCourseId) || null;
            } catch {
              post = null;
            }
          }
          if (post?.snapshot) break;
          if (attempt < 4) {
            await new Promise((resolve) => window.setTimeout(resolve, 600 + attempt * 500));
          }
        }
        if (cancelled) return;
        if (!post?.snapshot) {
          setGlobalError('Course link is unavailable or access is restricted.');
          return;
        }
        const restored = sanitizeCourse(post.snapshot);
        if (!restored) {
          setGlobalError('Shared course content is unavailable.');
          return;
        }
        setCourse(restored);
        setActiveCourseId(post.courseId || sharedCourseId);
        setActiveCourseOwnerId(String(post.ownerId || '').trim());
        setState('learning');
        setActiveHomeTab('learn');
        setActiveModuleId(restored.modules[0]?.id || null);
        setExpandedModuleId(restored.modules[0]?.id || null);
        setGlobalError(null);
        setRetryInfo(null);
        setPrompt('');
        setPromptError(null);
        setActiveCommunityPost(null);
        if (post.courseId) setBrowserPath(post.courseId);
        resolvedSharedCourseIdRef.current = sharedCourseId;
      } catch {
        if (!cancelled) {
          setGlobalError('Course link is unavailable or access is restricted.');
        }
      } finally {
        if (!cancelled) {
          setIsOpeningCourse(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, authUser?.id]);

  useEffect(() => {
    if (!isComposerMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = composerMenuRef.current;
      if (!root) return;
      if (!root.contains(event.target as Node)) {
        setIsComposerMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isComposerMenuOpen]);

  useEffect(() => {
    if (!shakePrompt) return;
    const t = window.setTimeout(() => setShakePrompt(false), 550);
    return () => window.clearTimeout(t);
  }, [shakePrompt]);

  useEffect(() => {
    if (state !== 'assessing') {
      setAssessmentDraft('');
      setAssessmentError(null);
      return;
    }
    setAssessmentDraft('');
    setAssessmentError(null);
  }, [currentAssessmentIdx, state]);

  useEffect(() => {
    if (!isOutlineBuilderOpen) return;
    const t = window.setTimeout(() => {
      outlineTitleInputRef.current?.focus();
      outlineTitleInputRef.current?.select();
    }, 120);
    return () => window.clearTimeout(t);
  }, [isOutlineBuilderOpen]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (isOutlineBuilderOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }
    return undefined;
  }, [isOutlineBuilderOpen]);

  useEffect(() => {
    if (!mascotToast) return;
    const t = window.setTimeout(() => setMascotToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [mascotToast]);

  useEffect(() => {
    recordingElapsedRef.current = interviewRecordingElapsedSeconds;
  }, [interviewRecordingElapsedSeconds]);

  useEffect(() => {
    if (!course) return;
    setInteractionProgress((prev) => {
      const validKeys = new Set<string>();
      for (const module of course.modules) {
        for (const step of module.steps) {
          validKeys.add(stepProgressKey(module.id, step.id));
        }
      }
      const next: Record<string, StepInteractionProgress> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (validKeys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [course]);

  useEffect(() => {
    const normalizedLocale = normalizeSupportedLocale(locale);
    setLocale(normalizedLocale);
    try {
      const raw = localStorage.getItem('nexus_profile_context');
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem('nexus_profile_context', JSON.stringify({
        ...parsed,
        preferredLanguage: normalizedLocale,
      }));
    } catch {
      // ignore
    }
    setProfileDraft((prev) => ({ ...prev, preferredLanguage: normalizedLocale }));
  }, [locale]);

  useEffect(() => {
    if (state === 'interviewing') return;
    setInterviewTargetLanguage(localeToInterviewLanguage(locale));
  }, [locale, state]);

  useEffect(() => {
    if (state !== 'idle') {
      setActiveHomeTab('learn');
    }
  }, [state]);

  useEffect(() => {
    if (state === 'outline_review') return;
    setOutlineDropActive(false);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptCursor(0);
    setOutlinePromptDraft('');
    setOutlineReviewError(null);
    setOutlineProcessingTargetKey(null);
    setOutlineFocusTargetKey(null);
    setOutlineEditSummary(null);
    setIsOutlineSummaryModalOpen(false);
  }, [state]);

  useEffect(() => {
    autoRetriedVideoStepsRef.current.clear();
    autoRetriedFallbackStepsRef.current.clear();
  }, [course?.title]);

  useEffect(() => {
    if (activeHomeTab !== 'community') {
      setActiveCommunityPost(null);
      setCreatorProfile(null);
      setCreatorProfileError(null);
    }
  }, [activeHomeTab]);

  useEffect(() => {
    try {
      localStorage.setItem('nexus_low_bandwidth_mode', lowBandwidthMode ? '1' : '0');
      const raw = localStorage.getItem('nexus_profile_context');
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem('nexus_profile_context', JSON.stringify({
        ...parsed,
        lowBandwidthMode,
        connectivityLevel: lowBandwidthMode ? 'low_bandwidth' : (parsed.connectivityLevel || 'normal'),
      }));
    } catch {
      // ignore
    }
  }, [lowBandwidthMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authUser?.id) {
        if (cancelled) return;
        setProfile(null);
        setProfileDraft(DEFAULT_PROFILE);
        setCvAnalysis(null);
        setCvUploadMeta(null);
        setCvResubmitStatus('idle');
        setCvResubmitMessage('');
        setCvResubmitDirty(false);
        setCareerInterestsInput('');
        setProfileNotice(null);
        setOnboardingOpen(false);
        return;
      }
      const [existing, existingCv] = await Promise.all([
        aiService.getProfile(),
        aiService.getCvProfile(),
      ]);
      if (cancelled) return;
      if (existing && existing.id) {
        const mergedExisting: UserProfile = {
          ...DEFAULT_PROFILE,
          ...existing,
          professionalVisibility: existing.professionalVisibility || 'private',
        };
        setProfile(mergedExisting);
        setProfileDraft(mergedExisting);
        setProfileNotice(null);
        const persistedLocaleRaw = (() => {
          try {
            return String(localStorage.getItem('nexus_locale') || '').trim();
          } catch {
            return '';
          }
        })();
        if (!persistedLocaleRaw && mergedExisting.preferredLanguage) {
          setLocaleState(normalizeSupportedLocale(mergedExisting.preferredLanguage));
        }
        if (typeof mergedExisting.lowBandwidthMode === 'boolean') {
          setLowBandwidthMode(!!mergedExisting.lowBandwidthMode);
        }
      }
      if (existingCv) {
        setCvAnalysis(existingCv);
        if (existingCv.fileName) {
          setCvUploadMeta((prev) => ({
            name: existingCv.fileName || prev?.name || '',
            size: prev?.size || 0,
            type: existingCv.mimeType || prev?.type || '',
          }));
        }
      } else {
        setCvUploadMeta(null);
      }
      setCvResubmitStatus('idle');
      setCvResubmitMessage('');
      setCvResubmitDirty(false);

      const hasProfile = !!(existing && existing.id);
      const hasValidatedCv = !!existingCv?.valid;
      if (hasProfile && hasValidatedCv) {
        setOnboardingOpen(false);
      } else {
        setOnboardingOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, authUser?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authCfg = await aiService.getAuthConfig();
        if (!cancelled) setAuthEnabled(!!authCfg.enabled);
      } catch {
        if (!cancelled) setAuthEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authUser?.id) return;
    setAccountId(authUser.id);
    try {
      localStorage.setItem('nexus_supabase_user_id', authUser.id);
      localStorage.setItem('nexus_account_id', authUser.id);
      localStorage.setItem('nexus_supabase_user', JSON.stringify(authUser));
    } catch {
      // ignore
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (!accountId) return;
    try {
      const raw = localStorage.getItem(`nexus_career_interests_${accountId}`);
      setCareerInterestsInput(raw || '');
    } catch {
      setCareerInterestsInput('');
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    try {
      localStorage.setItem(`nexus_career_interests_${accountId}`, careerInterestsInput || '');
    } catch {
      // ignore
    }
  }, [accountId, careerInterestsInput]);

  useEffect(() => {
    if (onboardingOpen) {
      setOnboardingStep(0);
    }
  }, [onboardingOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await offlineStore.getDownloadStates(accountId);
      if (!cancelled) setDownloadStates(rows);
    })();
    return () => { cancelled = true; };
  }, [accountId, course, state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const currentCourseId = state === 'learning'
        ? (activeCourseId || (course?.title ? `course:${course.title}` : ''))
        : '';
      const metrics = await aiService.getImpactSummary(currentCourseId || undefined);
      if (!cancelled) setImpactMetrics(metrics);
    })();
    return () => { cancelled = true; };
  }, [course, state, activeCourseId]);

  const handleCvFileSelected = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCvResubmitDirty(true);
    setCvAnalysisError(null);
    setCvResubmitStatus('processing');
    setCvResubmitMessage('Reading and validating your CV...');
    setProfileNotice(null);
    setCvUploadMeta({ name: file.name, size: file.size, type: file.type || 'application/octet-stream' });

    if (file.size > CV_MAX_SIZE_BYTES) {
      setCvAnalysis(null);
      const sizeError = `File is too large (${Math.round(file.size / (1024 * 1024))} MB). Please upload a file up to 8 MB.`;
      setCvAnalysisError(sizeError);
      setCvResubmitStatus('invalid');
      setCvResubmitMessage(sizeError);
      return;
    }

    setCvAnalyzeBusy(true);
    const analyzeStartedAt = Date.now();
    try {
      const extracted = await extractCvTextFromFile(file);
      const text = extracted.text;
      if (!text || text.length < 120) {
        setCvAnalysis(null);
        const textError = 'This file has little or no readable text. Please upload another CV document.';
        setCvAnalysisError(textError);
        setCvResubmitStatus('invalid');
        setCvResubmitMessage(textError);
        return;
      }
      const analyzed = await aiService.analyzeCv({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        declaredFormat: 'other',
        text,
      });
      const withImage: CvAnalysisResult = extracted.profileImageDataUrl
        ? {
            ...analyzed,
            parsed: {
              ...(analyzed.parsed || {
                fullName: '',
                headline: '',
                summary: '',
                location: '',
                email: '',
                phone: '',
                skills: [],
                languages: [],
                experience: [],
                education: [],
                certifications: [],
              }),
              profileImageDataUrl: extracted.profileImageDataUrl,
            },
          }
        : analyzed;
      const sanitizedIssues = (withImage.issues || [])
        .map((issue) => String(issue || '').replace(/\s+/g, ' ').trim())
        .map((issue) => issue
          .replace(/please choose europass format for onboarding cv verification\.?/ig, '')
          .replace(/europass-style/ig, 'CV')
          .replace(/europass cv structure/ig, 'CV structure')
          .replace(/\beuropass\b/ig, 'CV')
          .trim())
        .filter(Boolean);
      const hasHardRejectIssue = sanitizedIssues.some((issue) =>
        /\b(image-only|too short|random or unreadable|little or no readable text|no readable text)\b/i.test(issue)
      );
      const effectiveValid = withImage.valid || !hasHardRejectIssue;
      const normalizedCvAnalysis: CvAnalysisResult = {
        ...withImage,
        valid: effectiveValid,
        format: effectiveValid && withImage.format === 'unknown' ? 'other' : withImage.format,
        issues: effectiveValid ? [] : sanitizedIssues,
      };
      setCvAnalysis(normalizedCvAnalysis);
      if (!normalizedCvAnalysis.valid) {
        const invalidReason = normalizedCvAnalysis.issues?.[0] || 'We could not validate this CV. Please upload another file with readable CV content.';
        setCvAnalysisError(invalidReason);
        setCvResubmitStatus('invalid');
        setCvResubmitMessage(invalidReason);
      } else {
        setCvAnalysisError(null);
        setCvResubmitStatus('valid');
        setCvResubmitMessage('CV validated successfully. Save profile to finalize this update.');
      }
    } catch (e: any) {
      setCvAnalysis(null);
      const analyzeError = String(e?.message || 'Failed to analyze CV. Please try again.');
      setCvAnalysisError(analyzeError);
      setCvResubmitStatus('fail');
      setCvResubmitMessage(analyzeError);
    } finally {
      const minAnalyzeMs = 2200;
      const elapsed = Date.now() - analyzeStartedAt;
      if (elapsed < minAnalyzeMs) {
        await new Promise((resolve) => window.setTimeout(resolve, minAnalyzeMs - elapsed));
      }
      setCvAnalyzeBusy(false);
    }
  };

  const isOnboardingStepValid = (step: number): { ok: boolean; reason?: string } => {
    if (step === 5) {
      if (normalizePromptInput(profileDraft.learningGoal).length < 4) {
        return { ok: false, reason: 'Please add a clear learning goal before continuing.' };
      }
    }
    if (step === 6) {
      if (normalizePromptInput(profileDraft.region).length < 2) {
        return { ok: false, reason: 'Please enter your learning region.' };
      }
    }
    if (step === 7) {
      if (!cvUploadMeta) {
        return { ok: false, reason: 'Please upload your CV document.' };
      }
      if (!cvAnalysis?.valid) {
        return { ok: false, reason: cvAnalysisError || 'Please upload a valid CV before saving profile.' };
      }
    }
    return { ok: true };
  };

  const handleOnboardingNext = () => {
    const validation = isOnboardingStepValid(onboardingStep);
    if (!validation.ok) {
      setGlobalError(validation.reason || 'Please complete this step before continuing.');
      return;
    }
    setGlobalError(null);
    setOnboardingStep((prev) => Math.min(ONBOARDING_LAST_STEP, prev + 1));
  };

  const handleSaveProfile = async () => {
    if (!authUser?.id) {
      setAuthMode('signup');
      setAuthModalOpen(true);
      setGlobalError('Please create an account first, then complete onboarding.');
      return;
    }
    const validation = isOnboardingStepValid(ONBOARDING_LAST_STEP);
    if (!validation.ok) {
      setGlobalError(validation.reason || 'Please complete onboarding requirements.');
      setOnboardingStep(ONBOARDING_LAST_STEP);
      return;
    }
    setCvResubmitStatus('processing');
    setCvResubmitMessage('Saving CV verification...');
    try {
      const payload: UserProfile = {
        ...profileDraft,
        id: accountId,
        preferredLanguage: locale,
        lowBandwidthMode,
        professionalVisibility: profileDraft.professionalVisibility || 'private',
        cvRequiredFormat: 'other',
        cvValidated: !!cvAnalysis?.valid,
        cvFileName: cvUploadMeta?.name || cvAnalysis?.fileName || '',
        cvUpdatedAt: cvAnalysis?.updatedAt || new Date().toISOString(),
      };
      if (!cvAnalysis) {
        throw new Error('CV validation is required before saving.');
      }
      const saved = await aiService.upsertProfile(payload);
      const savedCv = await aiService.upsertCvProfile({
        ...cvAnalysis,
        fileName: cvUploadMeta?.name || cvAnalysis?.fileName || '',
        mimeType: cvUploadMeta?.type || cvAnalysis?.mimeType || '',
        updatedAt: new Date().toISOString(),
      });
      setProfile(saved);
      setProfileDraft(saved);
      setCvAnalysis(savedCv);
      setCvResubmitStatus('success');
      setCvResubmitMessage('CV saved successfully.');
      setCvResubmitDirty(false);
      setOnboardingOpen(false);
      setGlobalError(null);
    } catch (e: any) {
      const saveError = String(e?.message || 'Failed to save profile');
      setCvResubmitStatus('fail');
      setCvResubmitMessage(saveError);
      setGlobalError(saveError);
    }
  };

  const handleSaveProfileEdits = async () => {
    if (!authUser?.id) {
      setAuthMode('signin');
      setAuthModalOpen(true);
      setGlobalError('Please sign in to update your profile.');
      return;
    }
    setProfileSaveBusy(true);
    setProfileNotice(null);
    const shouldSaveCv = cvResubmitDirty && !!cvAnalysis;
    if (shouldSaveCv) {
      setCvResubmitStatus('processing');
      setCvResubmitMessage('Saving updated CV...');
    }
    try {
      let latestCv = cvAnalysis;
      if (shouldSaveCv && latestCv) {
        latestCv = await aiService.upsertCvProfile({
          ...latestCv,
          fileName: cvUploadMeta?.name || latestCv.fileName || '',
          mimeType: cvUploadMeta?.type || latestCv.mimeType || '',
          updatedAt: new Date().toISOString(),
        });
        setCvAnalysis(latestCv);
      }
      const payload: UserProfile = {
        ...(profile || DEFAULT_PROFILE),
        ...profileDraft,
        id: accountId,
        preferredLanguage: locale,
        lowBandwidthMode,
        professionalVisibility: profileDraft.professionalVisibility || profile?.professionalVisibility || 'private',
        cvRequiredFormat: 'other',
        cvValidated: latestCv ? !!latestCv.valid : !!profile?.cvValidated,
        cvFileName: cvUploadMeta?.name || latestCv?.fileName || profile?.cvFileName || '',
        cvUpdatedAt: latestCv?.updatedAt || profile?.cvUpdatedAt || '',
      };
      const saved = await aiService.upsertProfile(payload);
      setProfile(saved);
      setProfileDraft(saved);
      setGlobalError(null);
      setProfileNotice('Profile updated successfully.');
      if (shouldSaveCv) {
        setCvResubmitStatus(latestCv?.valid ? 'success' : 'invalid');
        setCvResubmitMessage(latestCv?.valid ? 'CV resubmitted successfully.' : 'CV is invalid. Upload a valid CV and save again.');
        setCvResubmitDirty(false);
      }
    } catch (e: any) {
      const saveError = String(e?.message || 'Failed to save profile changes.');
      setGlobalError(saveError);
      if (shouldSaveCv) {
        setCvResubmitStatus('fail');
        setCvResubmitMessage(saveError);
      }
    } finally {
      setProfileSaveBusy(false);
    }
  };

  const handleAuthSubmit = async () => {
    const emailValidation = getEmailValidationError(authEmail);
    if (emailValidation) {
      setAuthError(emailValidation);
      return;
    }
    const passwordValidation = getPasswordValidationError(authPassword);
    if (passwordValidation) {
      setAuthError(passwordValidation);
      return;
    }
    if (!authEnabled) {
      setAuthError('Supabase auth is not configured yet. Add Supabase keys in .env.');
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      const response = authMode === 'signup'
        ? await aiService.signUp(authEmail.trim(), authPassword)
        : await aiService.signIn(authEmail.trim(), authPassword);
      const nextUser = response?.user;
      if (!nextUser?.id) {
        setAuthError('Authentication failed. Please try again.');
        return;
      }

      try {
        localStorage.setItem('nexus_supabase_user_id', nextUser.id);
        localStorage.setItem('nexus_account_id', nextUser.id);
        localStorage.setItem('nexus_supabase_user', JSON.stringify({ id: nextUser.id, email: nextUser.email || authEmail.trim() }));
        localStorage.setItem('nexus_supabase_session', JSON.stringify(response?.session || {}));
      } catch {
        // ignore
      }

      setAuthUser({ id: nextUser.id, email: nextUser.email || authEmail.trim() });
      setAccountId(nextUser.id);
      setAuthModalOpen(false);
      setAuthPassword('');
      setAuthError(null);
      await refreshCoursePanels(true);
    } catch (e: any) {
      const raw = String(e?.message || 'Authentication failed.');
      const lower = raw.toLowerCase();
      if (lower.includes('email rate limit')) {
        setAuthError('Sign-up is temporarily rate-limited. If this email is already registered, switch to Sign in. Otherwise wait about 60 seconds and try again.');
      } else {
        setAuthError(raw);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAuthSignOut = async () => {
    const sessionRaw = (() => {
      try {
        return localStorage.getItem('nexus_supabase_session');
      } catch {
        return '';
      }
    })();
    const accessToken = (() => {
      try {
        const parsed = sessionRaw ? JSON.parse(sessionRaw) : null;
        return parsed?.access_token ? String(parsed.access_token) : '';
      } catch {
        return '';
      }
    })();

    try {
      if (accessToken) {
        await aiService.signOut(accessToken);
      }
    } catch {
      // ignore signout API failures
    }

    try {
      localStorage.removeItem('nexus_supabase_user_id');
      localStorage.removeItem('nexus_supabase_user');
      localStorage.removeItem('nexus_supabase_session');
      localStorage.removeItem('nexus_account_id');
      localStorage.removeItem('nexus_profile_context');
      localStorage.removeItem('nexus_low_bandwidth_mode');
      localStorage.removeItem('nexus_progress');
      const keysToClear: string[] = [];
      for (let idx = 0; idx < localStorage.length; idx += 1) {
        const key = localStorage.key(idx) || '';
        if (key.startsWith('nexus_career_interests_') || key.startsWith('nexus_progress_')) {
          keysToClear.push(key);
        }
      }
      for (const key of keysToClear) {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }

    const nextLocalId = getAccountId();
    setAuthUser(null);
    setAccountId(nextLocalId);
    setCourse(null);
    setState('idle');
    setProfile(null);
    setProfileDraft(DEFAULT_PROFILE);
    setCvAnalysis(null);
    setCvUploadMeta(null);
    setCvResubmitStatus('idle');
    setCvResubmitMessage('');
    setCvResubmitDirty(false);
    setCareerInterestsInput('');
    setMyCourses([]);
    setPublicFeed([]);
    setLearningCourses([]);
    setCommentsByPost({});
    setCommentBusyByPost({});
    setReactionBusyByPost({});
    setPublicIdentityByAccountId({});
    setAnalyticsByCourse({});
    setCourseAnalyticsByCourseId({});
    setActiveAnalyticsCourseId('');
    setCourseAnalyticsError(null);
    setAuthError(null);
    setShareModalPost(null);
    setCreatorProfile(null);
    setCreatorProfileError(null);
    setCreatorFollowBusy(false);
    setInterviewRecommendedJobs([]);
    setInterviewJobsBusy(false);
    setSelectedInterviewJobTitle('');
    setInterviewTargetLanguage(localeToInterviewLanguage(getLocale()));
    setInterviewQuestionFocus('mixed');
    setInterviewSeniority('mid');
    setInterviewSession(null);
    setInterviewActiveQuestionIdx(0);
    setInterviewAnswersByQuestionId({});
    setInterviewAnswerModeByQuestionId({});
    setInterviewVoiceMetaByQuestionId({});
    setInterviewRecordedSecondsByQuestionId({});
    setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
    setInterviewFeedbackByQuestionId({});
    setInterviewFinalReview(null);
    setInterviewFinalBusy(false);
    setInterviewReviewOpen(false);
    setInterviewBusy(false);
    setInterviewError(null);
    setRecordingQuestionId(null);
    setInterviewTranscribingQuestionId(null);
    stopInterviewRecording();
    speechRecognitionRef.current = null;
    clearInterviewMediaStream();
    setInterviewRecordingElapsedSeconds(0);
    setActiveCourseId('');
    setActiveCourseOwnerId('');
    setBrowserPath('');
  };

  const handleDownloadCurrentCourse = async () => {
    if (!course) return;
    try {
      const courseId = activeCourseId || `course:${course.title}`;
      const snapshotVersion = 1;
      const serialized = JSON.stringify(course);
      await offlineStore.saveCourseSnapshot(accountId, courseId, snapshotVersion, course);
      await offlineStore.saveDownloadState(accountId, {
        courseId,
        snapshotVersion,
        downloadedAt: new Date().toISOString(),
        sizeBytes: serialized.length,
        title: course.title,
      });
      const rows = await offlineStore.getDownloadStates(accountId);
      setDownloadStates(rows);
      setDownloadError(null);
      showMascotToast('Course downloaded', 'This course is now available from your account in offline mode.', 'happy');
    } catch (e: any) {
      setDownloadError(String(e?.message || 'Failed to download course for offline use.'));
    }
  };

  const handleOpenDownloadedCourse = async (row: DownloadState) => {
    try {
      const restored = await offlineStore.getCourseSnapshot(accountId, row.courseId, row.snapshotVersion);
      if (!restored) {
        setDownloadError('Downloaded snapshot not found. Please re-download this course.');
        return;
      }
      setCourse(sanitizeCourse(restored));
      const openedCourseId = row.courseId && !String(row.courseId).startsWith('course:') ? row.courseId : '';
      const ownedPost = myCourses.find((post) => post.courseId === openedCourseId);
      setActiveCourseId(openedCourseId);
      setActiveCourseOwnerId(String(ownedPost?.ownerId || '').trim());
      setBrowserPath(openedCourseId);
      setState('learning');
      setActiveModuleId(restored.modules[0]?.id || null);
      setExpandedModuleId(restored.modules[0]?.id || null);
      setGlobalError(null);
      setRetryInfo(null);
      showMascotToast('Opened downloaded course', 'You can continue learning offline from your account.', 'happy');
    } catch (e: any) {
      setDownloadError(String(e?.message || 'Failed to open downloaded course.'));
    }
  };

  const refreshCoursePanels = async (includeComments = false) => {
    if (!isOnline) return;
    const [mine, feed, learningRows] = await Promise.all([
      aiService.listMyCourses(),
      aiService.getPublicFeed(),
      aiService.listLearningCourses(),
    ]);
    setMyCourses(mine);
    setPublicFeed(feed);
    setActiveCommunityPost((prev) => {
      if (!prev) return prev;
      const fromFeed = feed.find((row) => row.id === prev.id);
      if (fromFeed) return fromFeed;
      const fromMine = mine.find((row) => row.courseId === prev.courseId);
      return fromMine || prev;
    });
    setLearningCourses(learningRows);
    setMyPostsCount(mine.length);
    setPublicPostsCount(feed.length);

    const metricPairs = await Promise.all(
      mine.map(async (post) => {
        try {
          const metrics = await aiService.getImpactSummary(post.courseId);
          return [post.courseId, metrics] as const;
        } catch {
          return [post.courseId, DEFAULT_IMPACT] as const;
        }
      })
    );
    setAnalyticsByCourse(Object.fromEntries(metricPairs));

    if (includeComments) {
      const commentPairs = await Promise.all(
        feed.slice(0, 12).map(async (post) => {
          const rows = await aiService.getPublicComments(post.id);
          return [post.id, rows] as const;
        })
      );
      for (const [, rows] of commentPairs) hydrateCommentIdentities(rows);
      setCommentsByPost((prev) => ({ ...prev, ...Object.fromEntries(commentPairs) }));
    }
  };

  const buildCoursePath = (courseId: string) => `/courses/${encodeURIComponent(String(courseId || '').trim())}`;
  const setBrowserPath = (courseId: string) => {
    if (typeof window === 'undefined') return;
    const nextPath = courseId ? buildCoursePath(courseId) : '/';
    if (window.location.pathname === nextPath) return;
    window.history.replaceState({}, '', nextPath);
  };
  const buildCourseShareUrl = (courseId: string) => {
    if (typeof window === 'undefined') return buildCoursePath(courseId);
    return `${window.location.origin}${buildCoursePath(courseId)}`;
  };

  const handleToggleCourseVisibility = async (post: PublicCoursePost) => {
    if (!isOnline) {
      setCommunityError('Publishing requires an internet connection.');
      return;
    }
    if (visibilityBusyByCourseId[post.courseId]) return;
    const nextVisibility = post.visibility === 'public' ? 'private' : 'public';
    const previousVisibility = post.visibility;
    setVisibilityBusyByCourseId((prev) => ({ ...prev, [post.courseId]: true }));
    setMyCourses((prev) => prev.map((row) => (
      row.courseId === post.courseId ? { ...row, visibility: nextVisibility } : row
    )));
    setPublicFeed((prev) => (
      nextVisibility === 'private'
        ? prev.filter((row) => !(row.courseId === post.courseId && row.ownerId === post.ownerId))
        : prev
    ));
    setActiveCommunityPost((prev) => (
      prev && prev.courseId === post.courseId
        ? { ...prev, visibility: nextVisibility }
        : prev
    ));
    try {
      const result = await aiService.setCourseVisibility(post, nextVisibility);
      if (result.courseId && post.title === course?.title) {
        setActiveCourseId(result.courseId);
        setActiveCourseOwnerId(accountId);
        if (state === 'learning') setBrowserPath(result.courseId);
      }
      setCommunityError(null);
      setCommunityNotice(`Course updated to ${result.visibility}.`);
      void refreshCoursePanels();
    } catch (e: any) {
      setMyCourses((prev) => prev.map((row) => (
        row.courseId === post.courseId ? { ...row, visibility: previousVisibility } : row
      )));
      setActiveCommunityPost((prev) => (
        prev && prev.courseId === post.courseId
          ? { ...prev, visibility: previousVisibility }
          : prev
      ));
      void refreshCoursePanels();
      setCommunityError(String(e?.message || 'Failed to update visibility.'));
    } finally {
      setVisibilityBusyByCourseId((prev) => ({ ...prev, [post.courseId]: false }));
    }
  };

  const handleReactToPost = async (postId: string, reaction: 'up' | 'down') => {
    if (!isOnline) {
      setCommunityError('Reacting requires an internet connection.');
      return;
    }
    if (reactionBusyByPost[postId]) return;
    setReactionBusyByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const updated = await aiService.reactToPublic(postId, reaction);
      const hasUpvoteValue = Number.isFinite(Number(updated?.upvotes));
      const hasDownvoteValue = Number.isFinite(Number(updated?.downvotes));
      const applyReactionPatch = (row: PublicCoursePost) => (
        row.id === postId
          ? {
              ...row,
              reactions: hasUpvoteValue ? Number(updated.upvotes) : Number((row.upvotes ?? row.reactions) || 0),
              upvotes: hasUpvoteValue ? Number(updated.upvotes) : Number((row.upvotes ?? row.reactions) || 0),
              downvotes: hasDownvoteValue ? Number(updated.downvotes) : Number(row.downvotes || 0),
              userReaction: updated?.userReaction ?? row.userReaction ?? null,
            }
          : row
      );
      setPublicFeed((prev) => prev.map(applyReactionPatch));
      setMyCourses((prev) => prev.map(applyReactionPatch));
      setActiveCommunityPost((prev) => {
        if (!prev || prev.id !== postId) return prev;
        return {
          ...prev,
          reactions: hasUpvoteValue ? Number(updated.upvotes) : Number((prev.upvotes ?? prev.reactions) || 0),
          upvotes: hasUpvoteValue ? Number(updated.upvotes) : Number((prev.upvotes ?? prev.reactions) || 0),
          downvotes: hasDownvoteValue ? Number(updated.downvotes) : Number(prev.downvotes || 0),
          userReaction: updated?.userReaction ?? prev.userReaction ?? null,
        };
      });
      setCommunityError(null);
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Failed to react to post.'));
    } finally {
      setReactionBusyByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleCommentOnPost = async (postId: string) => {
    if (!isOnline) {
      setCommunityError('Commenting requires an internet connection.');
      return;
    }
    if (commentBusyByPost[postId]) return;
    const text = String(commentDraftByPost[postId] || '').trim();
    if (!text) return;
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const duplicateWindowMs = 45 * 1000;
    const nowTs = Date.now();
    const existing = (commentsByPost[postId] || [])
      .find((row) => (
        String(row.accountId || '').trim() === String(accountId || '').trim()
        && String(row.text || '').toLowerCase().replace(/\s+/g, ' ').trim() === normalized
        && (nowTs - new Date(String(row.createdAt || 0)).getTime()) <= duplicateWindowMs
      ));
    if (existing) {
      setCommunityNotice('Duplicate comment skipped.');
      return;
    }
    setCommentBusyByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const result = await aiService.commentOnPublic(postId, text);
      setCommentDraftByPost((prev) => ({ ...prev, [postId]: '' }));
      const comments = await aiService.getPublicComments(postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
      hydrateCommentIdentities(comments);
      const nextCommentCount = comments.length;
      const patchCommentCount = (row: PublicCoursePost) => (
        row.id === postId ? { ...row, comments: nextCommentCount } : row
      );
      setPublicFeed((prev) => prev.map(patchCommentCount));
      setMyCourses((prev) => prev.map(patchCommentCount));
      setActiveCommunityPost((prev) => (prev && prev.id === postId ? { ...prev, comments: nextCommentCount } : prev));
      setCommunityError(null);
      if (result?.duplicate) {
        setCommunityNotice('Duplicate comment skipped.');
      } else {
        setCommunityNotice('Comment added.');
      }
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Failed to post comment.'));
    } finally {
      setCommentBusyByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleSharePost = async (post: PublicCoursePost) => {
    if (!post?.courseId) return;
    if (post.visibility !== 'public') {
      setCommunityError('Only public courses can be shared.');
      return;
    }
    setShareModalPost(post);
    setShareCopied(false);
    setCommunityError(null);
  };

  const handleCopyShareLink = async () => {
    if (!shareModalPost?.courseId) return;
    const url = buildCourseShareUrl(shareModalPost.courseId);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (navigator.share) await navigator.share({ title: shareModalPost.title, text: shareModalPost.description || '', url });
      setCommunityError(null);
      setCommunityNotice('Course share link copied.');
      setShareCopied(true);
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Unable to share this post.'));
    }
  };

  const handleShareViaPlatform = (platform: 'facebook' | 'messenger' | 'telegram' | 'whatsapp' | 'x' | 'linkedin' | 'reddit' | 'email') => {
    if (!shareModalPost?.courseId) return;
    const url = buildCourseShareUrl(shareModalPost.courseId);
    const text = `${shareModalPost.title}${shareModalPost.description ? ` - ${shareModalPost.description}` : ''}`.trim();
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(text);
    const target =
      platform === 'facebook'
        ? `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
        : platform === 'messenger'
        ? `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=291494419107518&redirect_uri=${encodedUrl}`
        : platform === 'telegram'
        ? `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
        : platform === 'whatsapp'
        ? `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
        : platform === 'x'
        ? `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`
        : platform === 'linkedin'
        ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
        : platform === 'reddit'
        ? `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`
        : `mailto:?subject=${encodeURIComponent(shareModalPost.title || 'Shared course')}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadPostCourse = async (post: PublicCoursePost) => {
    const snapshot = post.snapshot;
    if (!snapshot) {
      setDownloadError('Course snapshot is not available for download.');
      return;
    }
    try {
      const serialized = JSON.stringify(snapshot);
      await offlineStore.saveCourseSnapshot(accountId, post.courseId, 1, snapshot);
      await offlineStore.saveDownloadState(accountId, {
        courseId: post.courseId,
        snapshotVersion: 1,
        downloadedAt: new Date().toISOString(),
        sizeBytes: serialized.length,
        title: post.title || post.courseId,
      });
      const rows = await offlineStore.getDownloadStates(accountId);
      setDownloadStates(rows);
      if (isOnline && post.id) {
        try {
          const saved = await aiService.savePublicCourse(post.id);
          const nextSaves = Number(saved?.saves || 0);
          const patchSaves = (row: PublicCoursePost) => (
            row.id === post.id ? { ...row, saves: nextSaves } : row
          );
          setPublicFeed((prev) => prev.map(patchSaves));
          setMyCourses((prev) => prev.map(patchSaves));
          setActiveCommunityPost((prev) => (prev && prev.id === post.id ? { ...prev, saves: nextSaves } : prev));
          setCommunityNotice(saved?.alreadySaved ? 'You already downloaded this course.' : 'Course downloaded to your account.');
        } catch {
          const fallbackSaves = Number(post.saves || 0) + 1;
          const patchSaves = (row: PublicCoursePost) => (
            row.id === post.id ? { ...row, saves: fallbackSaves } : row
          );
          setPublicFeed((prev) => prev.map(patchSaves));
          setMyCourses((prev) => prev.map(patchSaves));
          setActiveCommunityPost((prev) => (prev && prev.id === post.id ? { ...prev, saves: fallbackSaves } : prev));
          setCommunityNotice('Course downloaded to your account.');
        }
      } else {
        setCommunityNotice('Course downloaded to your account.');
      }
      setDownloadError(null);
      showMascotToast('Good job!', 'You downloaded this course successfully.', 'happy');
    } catch (e: any) {
      setDownloadError(String(e?.message || 'Failed to download course.'));
    }
  };

  const handleOpenCommunityPost = async (post: PublicCoursePost) => {
    setActiveCommunityPost(post);
    void resolvePublicIdentity(String(post?.ownerId || ''));
    if (!commentsByPost[post.id] && isOnline) {
      try {
        const comments = await aiService.getPublicComments(post.id);
        setCommentsByPost((prev) => ({ ...prev, [post.id]: comments }));
        hydrateCommentIdentities(comments);
      } catch {
        // ignore
      }
    } else {
      hydrateCommentIdentities(commentsByPost[post.id] || []);
    }
  };

  const loadCourseAnalytics = async (courseId: string, options?: { force?: boolean }) => {
    const id = String(courseId || '').trim();
    if (!id) return;
    const force = !!options?.force;
    if (!force && courseAnalyticsByCourseId[id]) {
      setCourseAnalyticsError(null);
      return;
    }
    setCourseAnalyticsBusy(true);
    setCourseAnalyticsError(null);
    try {
      const payload = await aiService.getCourseAnalytics(id);
      setCourseAnalyticsByCourseId((prev) => ({ ...prev, [id]: payload }));
    } catch (e: any) {
      setCourseAnalyticsError(String(e?.message || 'Failed to load analytics.'));
    } finally {
      setCourseAnalyticsBusy(false);
    }
  };

  const handleOpenAnalyticsStudio = async (post: PublicCoursePost) => {
    const courseId = String(post?.courseId || '').trim();
    if (!courseId) {
      setCourseAnalyticsError('Course analytics is unavailable because this course has no stable id yet.');
      return;
    }
    setActiveAnalyticsCourseId(courseId);
    await loadCourseAnalytics(courseId);
  };

  const closeCreatorProfile = () => {
    setCreatorProfile(null);
    setCreatorProfileError(null);
    setCreatorProfileBusy(false);
    setCreatorFollowBusy(false);
  };

  const handleOpenCreatorProfile = async (creatorId: string) => {
    const id = String(creatorId || '').trim();
    if (!id) return;
    setCreatorProfile(null);
    setCreatorProfileBusy(true);
    setCreatorProfileError(null);
    try {
      const payload = await aiService.getPublicCreatorProfile(id);
      if (!payload) throw new Error('Creator profile is unavailable.');
      setCreatorProfile(payload);
      setCommunityError(null);
    } catch (e: any) {
      setCreatorProfile(null);
      setCreatorProfileError(String(e?.message || 'Unable to load creator profile.'));
    } finally {
      setCreatorProfileBusy(false);
    }
  };

  const handleToggleCreatorFollow = async () => {
    if (!creatorProfile || creatorFollowBusy) return;
    if (!authUser?.id) {
      setAuthMode('signin');
      setAuthModalOpen(true);
      setCreatorProfileError('Please sign in to follow creators.');
      return;
    }
    if (creatorProfile.id === authUser.id) return;
    setCreatorFollowBusy(true);
    setCreatorProfileError(null);
    try {
      const nextFollow = !creatorProfile.isFollowing;
      const updated = await aiService.setCreatorFollow(creatorProfile.id, nextFollow);
      setCreatorProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          isFollowing: !!updated.following,
          stats: {
            ...prev.stats,
            totalFollowers: Number(updated.followers || 0),
            totalFollowing: prev.id === authUser.id
              ? Number(updated.followingCount || prev.stats.totalFollowing)
              : prev.stats.totalFollowing,
          },
        };
      });
    } catch (e: any) {
      setCreatorProfileError(String(e?.message || 'Unable to update follow state.'));
    } finally {
      setCreatorFollowBusy(false);
    }
  };

  const handleLearnNowFromPost = async (post: PublicCoursePost) => {
    setIsOpeningCourse(true);
    try {
      let source = post;
      if (!source.snapshot && source.courseId) {
        const loaded = await aiService.getPublicCourse(source.courseId);
        if (loaded) source = loaded;
      }
      if (!source.snapshot) {
        setCommunityError('Course details are unavailable for this post.');
        return;
      }
      const restored = sanitizeCourse(source.snapshot);
      if (!restored) {
        setCommunityError('Unable to open this course.');
        return;
      }
      setCourse(restored);
      const sourceCourseId = String(source.courseId || '').trim() || `public-post:${source.id}`;
      setActiveCourseId(sourceCourseId);
      setActiveCourseOwnerId(String(source.ownerId || '').trim());
      if (source.courseId) setBrowserPath(source.courseId);
      setState('learning');
      setActiveModuleId(restored.modules[0]?.id || null);
      setExpandedModuleId(restored.modules[0]?.id || null);
      setActiveCommunityPost(null);
      setShareModalPost(null);
      setCommunityError(null);
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Unable to open this course.'));
    } finally {
      setIsOpeningCourse(false);
    }
  };

  const handleLearnLiveFromPost = async (post: PublicCoursePost) => {
    if (!isOnline) {
      setCommunityError('Live learning requires an internet connection.');
      return;
    }
    try {
      const cohort = await aiService.createCohort(`${post.title.slice(0, 36)} Live`, post.courseId);
      await aiService.joinCohort(cohort.id);
      setActiveCohortId(cohort.id);
      setCommunityNotice(`Live cohort created: ${cohort.name}`);
      void handleLearnNowFromPost(post);
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Failed to start live learning.'));
    }
  };

  const handleCreateCohort = async () => {
    if (!course) return;
    const name = cohortName.trim();
    if (!name) {
      setCommunityError('Enter a cohort name.');
      return;
    }
    try {
      const c = await aiService.createCohort(name, activeCourseId || `course:${course.title}`);
      setActiveCohortId(c.id);
      setCommunityError(null);
      setCommunityNotice(`Cohort created: ${c.name}`);
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Failed to create cohort.'));
    }
  };

  const handleJoinCohort = async () => {
    if (!activeCohortId) return;
    try {
      await aiService.joinCohort(activeCohortId);
      setCommunityError(null);
      setCommunityNotice('Joined cohort successfully.');
    } catch (e: any) {
      setCommunityError(String(e?.message || 'Failed to join cohort.'));
    }
  };

  const trackImpactEvent = async (
    type: 'course_started' | 'lesson_started' | 'lesson_completed' | 'quiz_submitted' | 'course_completed' | 'daily_active',
    payload: Record<string, any> = {}
  ) => {
    const courseId = activeCourseId || (course?.title ? `course:${course.title}` : '');
    if (!courseId) return;
    const eventPayload = {
      courseTitle: course?.title || '',
      courseDescription: course?.description || '',
      ...payload,
    };
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      courseId,
      type,
      payload: eventPayload,
      createdAt: new Date().toISOString(),
    } as const;

    try {
      if (isOnline) {
        await aiService.recordImpactEvent(courseId, type, eventPayload);
      } else {
        await offlineStore.queueSyncEvent(item);
      }
    } catch {
      await offlineStore.queueSyncEvent(item);
    }
  };

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    (async () => {
      try {
        const queued = await offlineStore.getSyncQueue();
        if (!queued.length || cancelled) return;
        await aiService.syncProgress(queued);
        for (const item of queued) {
          await offlineStore.clearSyncEvent(item.id);
        }
      } catch {
        // keep queue for later
      }
    })();
    return () => { cancelled = true; };
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setMyPostsCount(0);
      setPublicPostsCount(0);
      setMyCourses([]);
      setPublicFeed([]);
      setLearningCourses([]);
      setCommentsByPost({});
      setCommentBusyByPost({});
      setReactionBusyByPost({});
      setAnalyticsByCourse({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [mine, feed, learningRows] = await Promise.all([
          aiService.listMyCourses(),
          aiService.getPublicFeed(),
          aiService.listLearningCourses(),
        ]);
        if (cancelled) return;
        setMyCourses(mine);
        setPublicFeed(feed);
        setActiveCommunityPost((prev) => {
          if (!prev) return prev;
          const fromFeed = feed.find((row) => row.id === prev.id);
          if (fromFeed) return fromFeed;
          const fromMine = mine.find((row) => row.courseId === prev.courseId);
          return fromMine || prev;
        });
        setLearningCourses(learningRows);
        setMyPostsCount(mine.length);
        setPublicPostsCount(feed.length);

        const metricPairs = await Promise.all(
          mine.map(async (post) => {
            try {
              const metrics = await aiService.getImpactSummary(post.courseId);
              return [post.courseId, metrics] as const;
            } catch {
              return [post.courseId, DEFAULT_IMPACT] as const;
            }
          })
        );
        if (!cancelled) {
          setAnalyticsByCourse(Object.fromEntries(metricPairs));
        }

        const commentPairs = await Promise.all(
          feed.slice(0, 8).map(async (post) => {
            const comments = await aiService.getPublicComments(post.id);
            return [post.id, comments] as const;
          })
        );
        if (!cancelled) {
          for (const [, comments] of commentPairs) hydrateCommentIdentities(comments);
          setCommentsByPost((prev) => ({ ...prev, ...Object.fromEntries(commentPairs) }));
        }
      } catch {
        if (!cancelled) {
          setMyPostsCount(0);
          setPublicPostsCount(0);
          setMyCourses([]);
          setPublicFeed([]);
          setLearningCourses([]);
          setCommentsByPost({});
          setCommentBusyByPost({});
          setReactionBusyByPost({});
          setAnalyticsByCourse({});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOnline, course?.title, state]);

  useEffect(() => {
    if (!isOnline || !publicFeed.length) return;
    const ownerIds = Array.from(new Set(
      publicFeed
        .slice(0, 24)
        .map((post) => String(post?.ownerId || '').trim())
        .filter(Boolean)
    ));
    for (const ownerId of ownerIds) void resolvePublicIdentity(ownerId);
  }, [publicFeed, isOnline]);

  useEffect(() => {
    const ownerId = String(activeCommunityPost?.ownerId || '').trim();
    if (!ownerId || !isOnline) return;
    void resolvePublicIdentity(ownerId);
  }, [activeCommunityPost?.ownerId, isOnline]);

  useEffect(() => {
    if (!isOnline || !course) return;
    // Only persist full snapshots once learner-facing content exists.
    if (state !== 'learning') return;
    if (course.title === SAMPLE_COURSE.title && course.description === SAMPLE_COURSE.description) return;
    const ownerByCourseId = !!activeCourseId && myCourses.some((post) => (
      post.courseId === activeCourseId && post.ownerId === accountId
    ));
    const ownerByActiveSource = String(activeCourseOwnerId || '').trim() === String(accountId || '').trim();
    const isOwnedOrUnsavedCourse = ownerByCourseId || ownerByActiveSource;
    if (!isOwnedOrUnsavedCourse) return;

    const publishKey = `course:${String(course.title || '').trim()}`;
    if (!publishKey || publishKey === 'course:') return;

    const signature = `${course.title}|${course.modules
      .map((module) => {
        const total = module.steps.length;
        const completedWithContent = module.steps.filter((step) => step.status === 'completed' && !!step.content).length;
        const errored = module.steps.filter((step) => step.status === 'error').length;
        return `${module.id}:${module.status}:${completedWithContent}/${total}:${errored}`;
      })
      .join('|')}`;

    if (autoPublishedCourseSignaturesRef.current[publishKey] === signature) return;
    if (autoPublishingCourseIdsRef.current.has(publishKey)) return;

    autoPublishingCourseIdsRef.current.add(publishKey);
    let cancelled = false;
    (async () => {
      try {
        const mineBefore = await aiService.listMyCourses();
        if (cancelled) return;
        const titleKey = String(course.title || '').trim().toLowerCase();
        const matched = mineBefore.find((post) => (
          (activeCourseId && post.courseId === activeCourseId)
          || String(post.title || '').trim().toLowerCase() === titleKey
        )) || null;
        const targetVisibility = matched?.visibility === 'public' ? 'public' : 'private';
        const published = await aiService.publishCourse(course, targetVisibility, matched?.courseId || activeCourseId || '');
        if (cancelled) return;
        if (published?.courseId) {
          setActiveCourseId(published.courseId);
          setActiveCourseOwnerId(accountId);
          setBrowserPath(published.courseId);
        }
        autoPublishedCourseSignaturesRef.current[publishKey] = signature;
        const mine = await aiService.listMyCourses();
        if (cancelled) return;
        setMyCourses(mine);
        setMyPostsCount(mine.length);
      } catch {
        // keep previous signature and retry next cycle when course changes
      } finally {
        autoPublishingCourseIdsRef.current.delete(publishKey);
      }
    })();
    return () => { cancelled = true; };
  }, [course, isOnline, state, activeCourseId, activeCourseOwnerId, myCourses, accountId]);

  useEffect(() => {
    if (!isOnline || state !== 'learning' || !course) return;
    for (const module of course.modules) {
      for (const step of module.steps) {
        if (step.type !== ContentType.VIDEO || step.status !== 'completed') continue;
        const videoId = extractYouTubeVideoId(step.content?.data?.videoUrl)
          || extractYouTubeVideoId(step.content?.data?.videoWebUrl)
          || extractYouTubeIdFromText(step.content?.data?.content)
          || extractYouTubeIdFromText(step.content?.lessonText);
        if (videoId) continue;
        const retryKey = `${module.id}:${step.id}`;
        if (autoRetriedVideoStepsRef.current.has(retryKey)) continue;
        autoRetriedVideoStepsRef.current.add(retryKey);
        void handleRetryStep(module.id, step.id);
      }
    }
  }, [course, isOnline, state]);

  useEffect(() => {
    if (!isOnline || state !== 'learning' || !course) return;
    for (const module of course.modules) {
      for (const step of module.steps) {
        if (step.status !== 'completed' || !isFallbackModuleContent(step.content)) continue;
        const retryKey = `${module.id}:${step.id}`;
        if (autoRetriedFallbackStepsRef.current.has(retryKey)) continue;
        autoRetriedFallbackStepsRef.current.add(retryKey);
        void handleRetryStep(module.id, step.id);
        return;
      }
    }
  }, [course, isOnline, state]);

  const addPoints = (amount: number) => {
    setPoints(prev => prev + amount);
  };

  const navigateHome = () => {
    setState('idle');
    setActiveHomeTab('learn');
    setActiveCommunityPost(null);
    setShareModalPost(null);
    setActiveCourseId('');
    setActiveCourseOwnerId('');
    setGlobalError(null);
    setRetryInfo(null);
    setBrowserPath('');
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to reset your progress and start a new course?")) {
      setState('idle');
      setCourse(null);
      setAssessment([]);
      setAnswers({});
      setAssessmentDraft('');
      setAssessmentError(null);
      setCurrentAssessmentIdx(0);
      setActiveModuleId(null);
      setActiveLessonByModule({});
      setExpandedModuleId(null);
      setOutlineReviewSelection([]);
      setOutlineReviewLessonByModule({});
      setOutlineDropActive(false);
      setIsOutlinePromptSequenceOpen(false);
      setOutlinePromptCursor(0);
      setOutlinePromptDraft('');
      setOutlinePromptByTarget({});
      setOutlineReviewError(null);
      setIsRecraftingOutline(false);
      setPrompt('');
      setPromptError(null);
      setInterviewSession(null);
      setInterviewReviewOpen(false);
      setInterviewFinalReview(null);
      setInterviewQuestionFocus('mixed');
      setInterviewSeniority('mid');
      setInterviewTargetLanguage(localeToInterviewLanguage(getLocale()));
      setInterviewAnswersByQuestionId({});
      setInterviewRecordedSecondsByQuestionId({});
      setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
      setInterviewFeedbackByQuestionId({});
      setInterviewError(null);
      setRecordingQuestionId(null);
      setInterviewTranscribingQuestionId(null);
      stopInterviewRecording();
      speechRecognitionRef.current = null;
      clearInterviewMediaStream();
      setInterviewRecordingElapsedSeconds(0);
      setInteractionProgress({});
      setIsComposerMenuOpen(false);
      setIsOutlineBuilderOpen(false);
      setUseOutlineMode(false);
      setActiveCourseId('');
      setActiveCourseOwnerId('');
      setShareModalPost(null);
      setGlobalError(null);
      setCommunityError(null);
      setCommunityNotice(null);
      trackedCourseStartRef.current = null;
      trackedLessonRef.current = null;
      trackedCompletedLessonRef.current = null;
      autoPublishedCourseSignaturesRef.current = {};
      autoPublishingCourseIdsRef.current.clear();
      autoRetriedVideoStepsRef.current.clear();
      autoRetriedFallbackStepsRef.current.clear();
      localStorage.removeItem('nexus_progress');
      setBrowserPath('');
    }
  };

  const handleUseSample = () => {
    setCourse(SAMPLE_COURSE);
    setActiveCourseId('');
    setActiveCourseOwnerId('');
    setBrowserPath('');
    setState('learning');
    setActiveModuleId(SAMPLE_COURSE.modules[0].id);
    setExpandedModuleId(SAMPLE_COURSE.modules[0].id);
    setOutlineReviewSelection([]);
    setOutlineReviewLessonByModule({});
    setOutlineReviewError(null);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptByTarget({});
    setOutlinePromptDraft('');
    setOutlinePromptCursor(0);
    setGlobalError(null);
    setRetryInfo(null);
    setPromptError(null);
    setAssessmentError(null);
    setAssessmentDraft('');
    setInterviewSession(null);
    setInterviewReviewOpen(false);
    setInterviewFinalReview(null);
    setInterviewQuestionFocus('mixed');
    setInterviewSeniority('mid');
    setInterviewTargetLanguage(localeToInterviewLanguage(getLocale()));
    setInterviewAnswersByQuestionId({});
    setInterviewRecordedSecondsByQuestionId({});
    setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
    setInterviewFeedbackByQuestionId({});
    setInterviewError(null);
    setRecordingQuestionId(null);
    setInterviewTranscribingQuestionId(null);
    stopInterviewRecording();
    speechRecognitionRef.current = null;
    clearInterviewMediaStream();
    setInterviewRecordingElapsedSeconds(0);
    setInteractionProgress({});
    setIsComposerMenuOpen(false);
    setIsOutlineBuilderOpen(false);
    setUseOutlineMode(false);
    trackedCourseStartRef.current = null;
    trackedLessonRef.current = null;
    trackedCompletedLessonRef.current = null;
    autoRetriedFallbackStepsRef.current.clear();
  };

  const closeOutlineBuilder = () => {
    setIsOutlineBuilderOpen(false);
    setUseOutlineMode(false);
  };

  const openManualOutlineBuilder = () => {
    setIsComposerMenuOpen(false);
    setUseOutlineMode(true);
    setIsOutlineBuilderOpen(true);
    setPromptError(null);
    setGlobalError(null);
  };

  const buildDefaultSteps = (moduleTitle: string, courseTitle: string = '') => {
    const programmingTrack = isProgrammingTopic(moduleTitle, courseTitle);
    return [
      { id: 'step-1', title: `Introduction to ${moduleTitle}`, type: ContentType.TEXT, status: 'pending' as const },
      { id: 'step-2', title: `Key concepts in ${moduleTitle}`, type: ContentType.ACCORDION, status: 'pending' as const },
      { id: 'step-3', title: `Flashcards: ${moduleTitle}`, type: ContentType.FLIP_CARD, status: 'pending' as const },
      { id: 'step-4', title: `Video: ${moduleTitle}`, type: ContentType.VIDEO, status: 'pending' as const },
      {
        id: 'step-5',
        title: programmingTrack ? `Practice Coding: ${moduleTitle}` : `Pop Cards: ${moduleTitle} Insights`,
        type: programmingTrack ? ContentType.CODE_BUILDER : ContentType.POP_CARD,
        status: 'pending' as const
      },
      { id: 'step-6', title: `Summary & review`, type: ContentType.TEXT, status: 'pending' as const },
      { id: 'step-7', title: `Final quiz`, type: ContentType.QUIZ, status: 'pending' as const },
    ];
  };

  const parseOutlineToCourse = (raw: string): Course => {
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    let title = 'Custom Course';
    let descriptionParts: string[] = [];
    const modules: Array<{ title: string; description: string }> = [];

    // Best-effort title
    const tLine = lines.find(l => /course outline/i.test(l));
    if (tLine) {
      const m = tLine.match(/course outline\s*[:\-]\s*(.*)$/i);
      if (m?.[1]) title = m[1].trim();
    } else if (lines[0] && lines[0].length < 80) {
      title = lines[0];
    }

    const isModuleLine = (l: string) => /(^|\s)module\s*\d+/i.test(l) || /\bmodule\b/i.test(l) && /\d+/.test(l);

    let i = 0;
    while (i < lines.length && !isModuleLine(lines[i])) {
      descriptionParts.push(lines[i]);
      i++;
    }

    while (i < lines.length) {
      const line = lines[i];
      if (!isModuleLine(line)) { i++; continue; }

      const head = line
        .replace(/^[^A-Za-z0-9]+\s*/g, '')
        .replace(/module\s*\d+\s*[:\-]?\s*/i, '')
        .trim();

      const modTitle = head || `Module ${modules.length + 1}`;
      i++;

      const desc: string[] = [];
      while (i < lines.length && !isModuleLine(lines[i])) {
        desc.push(lines[i]);
        i++;
      }

      modules.push({
        title: modTitle,
        description: desc.slice(0, 4).join(' | ') || 'Interactive lessons and practice.'
      });
    }

    const course: Course = {
      title,
      description: descriptionParts.slice(0, 6).join(' | ') || 'Interactive, Duolingo-style learning path.',
      modules: (modules.length ? modules : [{ title: 'Module 1', description: 'Interactive lessons and practice.' }]).map((m, idx) => ({
        id: `m-${idx + 1}`,
        title: m.title,
        description: m.description,
        steps: ensureLessonStepCoverage(
          normalizeGeneratedLessonSteps(
            buildDefaultSteps(m.title, title).map((step) => ({ id: step.id, title: step.title, type: step.type })),
            idx + 1,
            m.title
          ),
          m.title,
          title
        ),
        status: 'completed' as const,
        isLocked: idx > 0,
        isCompleted: false,
      }))
    };

    return course;
  };

  const startFromOutline = (raw: string) => {
    const c = parseOutlineToCourse(raw);
    setCourse(c);
    setActiveCourseId('');
    setActiveCourseOwnerId(accountId);
    setBrowserPath('');
    setInteractionProgress({});
    setState('outline_review');
    setActiveModuleId(c.modules[0]?.id || null);
    setExpandedModuleId(c.modules[0]?.id || null);
    setOutlineReviewSelection([]);
    setOutlineReviewLessonByModule({});
    setOutlineReviewError(null);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptByTarget({});
    setOutlinePromptDraft('');
    setOutlinePromptCursor(0);
    setGlobalError(null);
    setRetryInfo(null);
    trackedCourseStartRef.current = null;
    trackedLessonRef.current = null;
    trackedCompletedLessonRef.current = null;
  };

  const startFromStructuredOutline = () => {
    const c = buildStructuredOutlineCourse(outlineTitle || prompt, outlineModules);
    setCourse(c);
    setActiveCourseId('');
    setActiveCourseOwnerId(accountId);
    setBrowserPath('');
    setInteractionProgress({});
    setState('outline_review');
    setActiveModuleId(c.modules[0]?.id || null);
    setExpandedModuleId(c.modules[0]?.id || null);
    setOutlineReviewSelection([]);
    setOutlineReviewLessonByModule({});
    setOutlineReviewError(null);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptByTarget({});
    setOutlinePromptDraft('');
    setOutlinePromptCursor(0);
    setGlobalError(null);
    setRetryInfo(null);
    trackedCourseStartRef.current = null;
    trackedLessonRef.current = null;
    trackedCompletedLessonRef.current = null;
  };

  const updateOutlineModuleTitle = (moduleId: string, title: string) => {
    setOutlineModules(prev => prev.map(module => (
      module.id === moduleId ? { ...module, title } : module
    )));
  };

  const addOutlineModule = () => {
    setOutlineModules(prev => [...prev, createOutlineModule(prev.length + 1)]);
    requestAnimationFrame(() => {
      const panel = outlineScrollRef.current;
      if (panel) {
        panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
      }
    });
  };

  const removeOutlineModule = (moduleId: string) => {
    setOutlineModules(prev => (prev.length <= 1 ? prev : prev.filter(module => module.id !== moduleId)));
  };

  const updateOutlineLessonTitle = (moduleId: string, lessonId: string, title: string) => {
    setOutlineModules(prev => prev.map(module => {
      if (module.id !== moduleId) return module;
      return {
        ...module,
        lessons: module.lessons.map(lesson => (lesson.id === lessonId ? { ...lesson, title } : lesson)),
      };
    }));
  };

  const addOutlineLesson = (moduleId: string) => {
    setOutlineModules(prev => prev.map(module => {
      if (module.id !== moduleId) return module;
      return {
        ...module,
        lessons: [...module.lessons, createOutlineLesson(`Lesson ${module.lessons.length + 1}`)],
      };
    }));
  };

  const removeOutlineLesson = (moduleId: string, lessonId: string) => {
    setOutlineModules(prev => prev.map(module => {
      if (module.id !== moduleId) return module;
      if (module.lessons.length <= 1) return module;
      return {
        ...module,
        lessons: module.lessons.filter(lesson => lesson.id !== lessonId),
      };
    }));
  };

  const toggleOutlineLessonOption = (moduleId: string, lessonId: string, key: keyof LessonOptions) => {
    setOutlineModules(prev => prev.map(module => {
      if (module.id !== moduleId) return module;
      return {
        ...module,
        lessons: module.lessons.map(lesson => {
          if (lesson.id !== lessonId) return lesson;
          return {
            ...lesson,
            options: {
              ...lesson.options,
              [key]: !lesson.options[key],
            },
          };
        }),
      };
    }));
  };

  const handleVideoCompletionToggle = (moduleId: string, stepId: string, completed: boolean) => {
    upsertStepProgress(moduleId, stepId, (prev) => ({
      ...prev,
      videoCompleted: completed,
      videoSeconds: completed ? Math.max(prev.videoSeconds || 0, 1) : 0,
    }));
    if (completed) {
      showMascotToast('Great watch!', 'SEA-Geko marked this video as completed.', 'happy');
    }
  };

  const handleFlashcardFlipToBack = (moduleId: string, stepId: string, cardIdx: number, totalCards: number) => {
    upsertStepProgress(moduleId, stepId, (prev) => {
      const seen = new Set<number>(Array.isArray(prev.flashcardSeen) ? prev.flashcardSeen : []);
      seen.add(cardIdx);
      return {
        ...prev,
        flashcardsTotal: Math.max(1, totalCards || 1),
        flashcardSeen: Array.from(seen.values()),
        flashcardsViewed: seen.size,
      };
    });
  };

  const handleQuizResult = (
    moduleId: string,
    stepId: string,
    result: { passed: boolean; score: number; percentage: number },
    isFinalAssessment: boolean
  ) => {
    const activeStep = course?.modules.find((m) => m.id === moduleId)?.steps.find((s) => s.id === stepId);
    const totalQuestions = Array.isArray((activeStep as any)?.content?.data?.questions)
      ? (activeStep as any).content.data.questions.length
      : 0;

    upsertStepProgress(moduleId, stepId, (prev) => ({
      ...prev,
      quizPassed: result.passed,
      quizScore: result.score,
      quizTotal: totalQuestions || prev.quizTotal || 0,
    }));

    void trackImpactEvent('quiz_submitted', {
      moduleId,
      stepId,
      passed: result.passed,
      score: result.score,
      percentage: result.percentage,
      finalAssessment: isFinalAssessment,
    });
    const currentCourseId = activeCourseId || (course?.title ? `course:${course.title}` : '');
    if (currentCourseId) {
      const pretestKey = `nexus_metric_pretest:${currentCourseId}`;
      const confPreKey = `nexus_metric_conf_pre:${currentCourseId}`;
      const confPostKey = `nexus_metric_conf_post:${currentCourseId}`;
      try {
        if (!localStorage.getItem(pretestKey)) {
          localStorage.setItem(pretestKey, '1');
          void aiService.recordPretest(currentCourseId, result.percentage);
        }
        if (!localStorage.getItem(confPreKey)) {
          localStorage.setItem(confPreKey, '1');
          void aiService.recordConfidence(currentCourseId, 'pre', 3);
        }
        if (isFinalAssessment && result.passed) {
          void aiService.recordPosttest(currentCourseId, result.percentage);
          if (!localStorage.getItem(confPostKey)) {
            localStorage.setItem(confPostKey, '1');
            void aiService.recordConfidence(currentCourseId, 'post', 4);
          }
        }
      } catch {
        // ignore local metric cache failures
      }
    }

    if (result.passed) {
      showMascotToast('Good job!', `Quiz passed with ${result.percentage}% score.`, 'happy');
      if (isFinalAssessment) {
        handleModuleComplete(moduleId);
      }
    } else {
      showMascotToast('Keep going!', `You scored ${result.percentage}%. Try again to improve.`, 'sad');
    }
  };

  const handleDragFillResult = (moduleId: string, stepId: string, challengeIdx: number, isCorrect: boolean, totalChallenges: number) => {
    upsertStepProgress(moduleId, stepId, (prev) => {
      const solved = new Set<number>(Array.isArray(prev.dragFillSolved) ? prev.dragFillSolved : []);
      if (isCorrect) solved.add(challengeIdx);
      return {
        ...prev,
        dragFillTotal: Math.max(1, totalChallenges || 1),
        dragFillSolved: Array.from(solved.values()),
        dragFillCompleted: solved.size,
      };
    });
  };

  const handleCodeBuilderComplete = (moduleId: string, stepId: string) => {
    upsertStepProgress(moduleId, stepId, (prev) => ({
      ...prev,
      codeBuilderCompleted: true,
    }));
    showMascotToast('Nice coding!', 'SEA-Geko says your practice challenge is completed.', 'happy');
  };

  const handleGenerateFromOutlineBuilder = () => {
    const resolvedTitle = normalizePromptInput(outlineTitle || prompt);
    if (!resolvedTitle) {
      setPromptError('Add a course title or topic hint before generating.');
      setShakePrompt(true);
      outlineTitleInputRef.current?.focus();
      return;
    }
    const outlineValidation = getOutlineValidationError(resolvedTitle, outlineModules);
    if (outlineValidation) {
      setPromptError(outlineValidation);
      setShakePrompt(true);
      outlineTitleInputRef.current?.focus();
      return;
    }
    setPromptError(null);
    startFromStructuredOutline();
    closeOutlineBuilder();
  };

  const buildInterviewProfilePayload = () => ({
    fullName: cvProfile?.fullName || '',
    headline: cvProfile?.headline || '',
    summary: cvProfile?.summary || '',
    skills: cvProfile?.skills || [],
    experience: (cvProfile?.experience || []).map((row) => ({
      role: row.role || '',
      organization: row.organization || '',
      highlights: row.highlights || [],
    })),
    education: (cvProfile?.education || []).map((row) => ({
      program: row.program || '',
      institution: row.institution || '',
    })),
    certifications: cvProfile?.certifications || [],
    learningGoal: profileDraft.learningGoal || '',
    region: profileDraft.region || '',
    preferredLanguage: locale || 'en',
  });

  const clearInterviewRecordingTimer = () => {
    if (recordingTimerRef.current == null) return;
    window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    recordingStartedAtMsRef.current = null;
  };

  const startInterviewRecordingTimer = () => {
    clearInterviewRecordingTimer();
    recordingStartedAtMsRef.current = Date.now();
    const tick = () => {
      const startedAt = recordingStartedAtMsRef.current || Date.now();
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const bounded = Math.min(elapsed, INTERVIEW_RECORDING_LIMIT_SECONDS);
      recordingElapsedRef.current = bounded;
      setInterviewRecordingElapsedSeconds(bounded);
      if (bounded >= INTERVIEW_RECORDING_LIMIT_SECONDS) {
        stopInterviewRecording();
      }
    };
    tick();
    recordingTimerRef.current = window.setInterval(tick, 200);
  };

  const stopInterviewVoiceWaveMonitor = () => {
    if (audioFrameRef.current != null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      audioSourceRef.current = null;
    }
    audioAnalyserRef.current = null;
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    waveRuntimeBarsRef.current = Array.from({ length: 24 }, () => 0.08);
    setInterviewVoiceWaveBars(waveRuntimeBarsRef.current);
  };

  const startInterviewVoiceWaveMonitor = (stream: MediaStream) => {
    stopInterviewVoiceWaveMonitor();
    const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxCtor) return;
    try {
      const context = new AudioCtxCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      audioContextRef.current = context;
      audioSourceRef.current = source;
      audioAnalyserRef.current = analyser;

      const barCount = 24;
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      waveRuntimeBarsRef.current = Array.from({ length: barCount }, () => 0.08);

      const tick = () => {
        const activeAnalyser = audioAnalyserRef.current;
        if (!activeAnalyser) return;
        activeAnalyser.getByteFrequencyData(buffer);
        const bucketSize = Math.max(1, Math.floor(buffer.length / barCount));
        const rawBars = Array.from({ length: barCount }, (_, idx) => {
          const start = idx * bucketSize;
          const end = Math.min(buffer.length, start + bucketSize);
          let total = 0;
          for (let i = start; i < end; i += 1) total += buffer[i];
          const avg = (end > start ? total / (end - start) : 0) / 255;
          return Math.max(0.04, Math.min(1, avg));
        });
        const previous = waveRuntimeBarsRef.current;
        const smoothedBars = rawBars.map((value, idx) => (
          Math.max(0.04, Math.min(1, (Number(previous[idx] || 0.08) * 0.4) + (value * 0.6)))
        ));
        waveRuntimeBarsRef.current = smoothedBars;
        setInterviewVoiceWaveBars(smoothedBars);
        audioFrameRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      stopInterviewVoiceWaveMonitor();
    }
  };

  const clearInterviewMediaStream = () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
    mediaStreamRef.current = null;
    stopInterviewVoiceWaveMonitor();
  };

  const stopInterviewRecording = () => {
    clearInterviewRecordingTimer();
    stopInterviewVoiceWaveMonitor();
    const rec = speechRecognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    clearInterviewMediaStream();
  };

  const startInterviewRecordingWithSpeechRecognition = async (questionId: string, SpeechRecognitionCtor: any) => {
    const rec = new SpeechRecognitionCtor();
    speechRecognitionRef.current = rec;
    rec.lang = interviewTargetLanguage || localeToInterviewLanguage(locale);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const monitorStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = monitorStream;
        startInterviewVoiceWaveMonitor(monitorStream);
      }
    } catch {
      // Speech recognition can still run without waveform monitor.
    }

    let confidenceTotal = 0;
    let confidenceCount = 0;
    let committedText = String(interviewAnswersByQuestionId[questionId] || '').trim();
    let previewText = committedText;

    rec.onresult = (event: any) => {
      const finalSegments: string[] = [];
      const interimSegments: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alt = result?.[0];
        const transcript = String(alt?.transcript || '').replace(/\s+/g, ' ').trim();
        if (!transcript) continue;
        if (typeof alt?.confidence === 'number' && Number.isFinite(alt.confidence)) {
          confidenceTotal += alt.confidence;
          confidenceCount += 1;
        }
        if (result.isFinal) {
          finalSegments.push(transcript);
        } else {
          interimSegments.push(transcript);
        }
      }

      if (finalSegments.length) {
        committedText = `${committedText} ${finalSegments.join(' ')}`.replace(/\s+/g, ' ').trim();
      }
      previewText = `${committedText} ${interimSegments.join(' ')}`.replace(/\s+/g, ' ').trim();
      const nextText = previewText || committedText;
      if (!nextText) return;

      setInterviewAnswersByQuestionId((prev) => ({ ...prev, [questionId]: nextText }));
      setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [questionId]: 'voice' }));
      setInterviewVoiceMetaByQuestionId((prev) => {
        const hints = buildVoiceAnswerHints(nextText);
        return {
          ...prev,
          [questionId]: {
            confidence: confidenceCount ? (confidenceTotal / confidenceCount) : Number(prev[questionId]?.confidence || 0),
            fillerCount: hints.fillerCount,
            wordCount: hints.wordCount,
          },
        };
      });
    };

    rec.onerror = (event: any) => {
      const reason = String(event?.error || '').trim().toLowerCase();
      if (reason === 'aborted') {
        return;
      }
      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        setInterviewError('Microphone access was denied. Allow microphone permission and retry recording.');
      } else if (reason === 'no-speech') {
        setInterviewError('No speech detected. Please speak and try recording again.');
      } else if (reason === 'audio-capture') {
        setInterviewError('No microphone was detected. Connect a microphone and retry.');
      } else {
        setInterviewError('Voice capture failed. Please retry or use text answer.');
      }
    };
    rec.onend = () => {
      clearInterviewRecordingTimer();
      stopInterviewVoiceWaveMonitor();
      setRecordingQuestionId((prev) => (prev === questionId ? null : prev));
      speechRecognitionRef.current = null;
      const recordedSeconds = Math.max(0, Math.floor(recordingElapsedRef.current || 0));
      setInterviewRecordedSecondsByQuestionId((prev) => ({ ...prev, [questionId]: recordedSeconds }));
      clearInterviewMediaStream();
      const finalAnswer = String(previewText || committedText || '').replace(/\s+/g, ' ').trim();
      if (finalAnswer) {
        const hints = buildVoiceAnswerHints(finalAnswer);
        setInterviewAnswersByQuestionId((prev) => ({ ...prev, [questionId]: finalAnswer }));
        setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [questionId]: 'voice' }));
        setInterviewVoiceMetaByQuestionId((prev) => ({
          ...prev,
          [questionId]: {
            confidence: confidenceCount ? (confidenceTotal / confidenceCount) : Number(prev[questionId]?.confidence || 0),
            fillerCount: hints.fillerCount,
            wordCount: hints.wordCount,
          },
        }));
      }
    };

    try {
      rec.start();
      startInterviewRecordingTimer();
    } catch {
      clearInterviewRecordingTimer();
      clearInterviewMediaStream();
      setRecordingQuestionId(null);
      setInterviewError('Unable to start voice recording. Please retry.');
    }
  };

  const startInterviewRecording = async (questionId: string) => {
    if (!interviewSession) return;
    const speechCtor = getInterviewSpeechRecognitionCtor();
    if (!speechCtor) {
      setRecordingQuestionId(null);
      setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [questionId]: 'text' }));
      setInterviewError(INTERVIEW_VOICE_UNSUPPORTED_MESSAGE);
      return;
    }
    stopInterviewRecording();
    recordingElapsedRef.current = 0;
    setInterviewRecordingElapsedSeconds(0);
    setInterviewRecordedSecondsByQuestionId((prev) => ({ ...prev, [questionId]: 0 }));
    setRecordingQuestionId(questionId);
    setInterviewError(null);
    setInterviewTranscribingQuestionId(null);
    await startInterviewRecordingWithSpeechRecognition(questionId, speechCtor);
  };

  const handleRetryInterviewRecording = (questionId: string) => {
    const speechCtor = getInterviewSpeechRecognitionCtor();
    if (!speechCtor) {
      setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [questionId]: 'text' }));
      setInterviewError(INTERVIEW_VOICE_UNSUPPORTED_MESSAGE);
      return;
    }
    stopInterviewRecording();
    recordingElapsedRef.current = 0;
    setInterviewRecordingElapsedSeconds(0);
    setInterviewRecordedSecondsByQuestionId((prev) => ({ ...prev, [questionId]: 0 }));
    setInterviewTranscribingQuestionId((prev) => (prev === questionId ? null : prev));
    setInterviewAnswersByQuestionId((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setInterviewVoiceMetaByQuestionId((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [questionId]: 'voice' }));
    setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
    setInterviewError(null);
  };

  const handleInterviewSaveAndNext = () => {
    if (!interviewSession) return;
    const question = interviewSession.questions[interviewActiveQuestionIdx];
    if (!question) return;
    if (recordingQuestionId === question.id || interviewTranscribingQuestionId === question.id) return;
    const answer = normalizePromptInput(interviewAnswersByQuestionId[question.id] || '');
    if (!answer) {
      setInterviewError('Please answer this question in voice or text before continuing.');
      return;
    }
    if (answer !== interviewAnswersByQuestionId[question.id]) {
      setInterviewAnswersByQuestionId((prev) => ({ ...prev, [question.id]: answer }));
    }
    const activeMode: 'text' | 'voice' = (
      interviewVoiceSupported
      ? (interviewAnswerModeByQuestionId[question.id] || 'text')
      : 'text'
    );
    setInterviewError(null);
    if (!interviewAnswerModeByQuestionId[question.id]) {
      setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [question.id]: activeMode }));
    }
    const isLastQuestion = interviewActiveQuestionIdx >= interviewSession.questions.length - 1;
    if (isLastQuestion) {
      void handleEndInterviewAndReview();
      return;
    }
    const nextIdx = Math.min(interviewSession.questions.length - 1, interviewActiveQuestionIdx + 1);
    const nextQuestion = interviewSession.questions[nextIdx];
    if (nextQuestion) {
      setInterviewAnswerModeByQuestionId((prev) => (
        prev[nextQuestion.id]
          ? prev
          : { ...prev, [nextQuestion.id]: activeMode }
      ));
    }
    setInterviewActiveQuestionIdx(nextIdx);
  };

  const handleOpenInterviewSetup = (requestedRole: string) => {
    if (!isOnline) {
      setInterviewError('Interview preparation requires an internet connection.');
      return;
    }
    if (!cvIsValidated || !cvProfile) {
      setInterviewError('Upload and validate your CV first to unlock interview preparation mode.');
      return;
    }
    const roleTitle = normalizePromptInput(requestedRole || selectedInterviewJobTitle || prompt);
    if (!roleTitle) {
      setInterviewError('Select a recommended job or type the target job title first.');
      setShakePrompt(true);
      return;
    }
    setPrompt(roleTitle);
    setSelectedInterviewJobTitle(roleTitle);
    setInterviewError(null);
    setState('interview_setup');
    setActiveHomeTab('learn');
  };

  const handleStartInterviewPreparation = async (requestedRole: string) => {
    if (!isOnline) {
      setInterviewError('Interview preparation requires an internet connection.');
      return;
    }
    if (!cvIsValidated || !cvProfile) {
      setInterviewError('Upload and validate your CV first to unlock interview preparation mode.');
      return;
    }
    const roleTitle = normalizePromptInput(requestedRole || selectedInterviewJobTitle || prompt);
    if (!roleTitle) {
      setInterviewError('Select a recommended job or type the target job title first.');
      setShakePrompt(true);
      return;
    }
    setPrompt(roleTitle);
    setSelectedInterviewJobTitle(roleTitle);
    setState('interviewing');
    setActiveHomeTab('learn');
    setInterviewBusy(true);
    setInterviewError(null);
    setInterviewSession(null);
    setInterviewReviewOpen(false);
    setInterviewFinalReview(null);
    setInterviewReviewProgress(0);
    setInterviewFeedbackByQuestionId({});
    setInterviewAnswersByQuestionId({});
    setInterviewAnswerModeByQuestionId({});
    setInterviewVoiceMetaByQuestionId({});
    setInterviewRecordedSecondsByQuestionId({});
    setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
    setInterviewActiveQuestionIdx(0);
    setInterviewRecordingElapsedSeconds(0);
    setInterviewTranscribingQuestionId(null);
    stopInterviewRecording();
    try {
      const session = await aiService.generateInterviewSession({
        jobTitle: roleTitle,
        profile: buildInterviewProfilePayload(),
        setup: {
          targetLanguage: normalizeInterviewLanguageSelection(interviewTargetLanguage),
          questionFocus: interviewQuestionFocus,
          seniority: interviewSeniority,
        },
      });
      setInterviewSession(session);
      setInterviewError(null);
	    } catch (e: any) {
	      setInterviewSession(null);
	      const message = String(e?.message || '').trim();
	      setInterviewError(message || 'Failed to generate interview preparation session.');
	    } finally {
	      setInterviewBusy(false);
	    }
	  };

  const handleEndInterviewAndReview = async () => {
    if (!interviewSession) return;
    stopInterviewRecording();
    const items = interviewSession.questions
      .map((question) => ({
        questionId: question.id,
        question: question.question,
        answer: normalizePromptInput(interviewAnswersByQuestionId[question.id] || ''),
      }))
      .filter((row) => row.answer);
    if (!items.length) {
      setInterviewError('Answer at least one question before ending and reviewing.');
      return;
    }

    setInterviewReviewOpen(true);
    setInterviewFinalBusy(true);
    setInterviewReviewProgress(0);
    setInterviewError(null);

    try {
      const feedbackMap: Record<string, InterviewAnswerFeedback> = {};
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const answerMode = interviewAnswerModeByQuestionId[item.questionId] || 'text';
        const hintsFromText = buildVoiceAnswerHints(item.answer);
        const voiceMeta = answerMode === 'voice'
          ? {
              confidence: Number(interviewVoiceMetaByQuestionId[item.questionId]?.confidence || 0),
              fillerCount: Number(interviewVoiceMetaByQuestionId[item.questionId]?.fillerCount || hintsFromText.fillerCount),
              wordCount: Number(interviewVoiceMetaByQuestionId[item.questionId]?.wordCount || hintsFromText.wordCount),
            }
          : undefined;
        try {
          const feedback = await aiService.evaluateInterviewAnswer({
            role: interviewSession.role,
            questionId: item.questionId,
            question: item.question,
            answer: item.answer,
            answerMode,
            voiceMeta,
            targetLanguage: interviewTargetLanguage,
          });
          feedbackMap[item.questionId] = feedback;
        } catch {
          const fallbackCopy = getInterviewFallbackFeedbackCopy(
            interviewLanguageToShortCode(normalizeInterviewLanguageSelection(interviewTargetLanguage))
          );
          feedbackMap[item.questionId] = {
            questionId: item.questionId,
            feedback: fallbackCopy.feedback,
            sampleResponse: fallbackCopy.sampleResponse,
            toneFeedback: fallbackCopy.toneFeedback,
            grammarFeedback: fallbackCopy.grammarFeedback,
            pronunciationFeedback: answerMode === 'voice' ? fallbackCopy.pronunciationVoice : fallbackCopy.pronunciationText,
            riskFlags: [],
            score: 0,
          };
        }
        setInterviewReviewProgress(Math.max(10, Math.round(((i + 1) / items.length) * 75)));
      }

      setInterviewFeedbackByQuestionId(feedbackMap);
      const review = await aiService.finalizeInterviewReview({
        role: interviewSession.role,
        targetLanguage: interviewTargetLanguage,
        items: items.map((item) => ({
          questionId: item.questionId,
          question: item.question,
          answer: item.answer,
          feedback: feedbackMap[item.questionId]?.feedback || '',
          sampleResponse: feedbackMap[item.questionId]?.sampleResponse || '',
        })),
      });
      setInterviewReviewProgress(100);
      setInterviewFinalReview(review);
    } catch (e: any) {
      setInterviewError(String(e?.message || 'Failed to generate final interview review.'));
    } finally {
      setInterviewFinalBusy(false);
    }
  };

  const handleStart = async () => {
    if (interviewBusy || interviewTranscribingQuestionId) return;
    if (!authUser?.id) {
      setAuthMode('signup');
      setAuthModalOpen(true);
      setGlobalError('Please create an account or sign in before generating courses.');
      return;
    }
    if (!profile) {
      setOnboardingOpen(true);
      setGlobalError('Please complete onboarding before generating courses.');
      return;
    }

    const normalizedPrompt = normalizePromptInput(prompt);
    if (normalizedPrompt !== prompt) setPrompt(normalizedPrompt);

    if (composerMode === 'interview') {
      handleOpenInterviewSetup(normalizedPrompt || selectedInterviewJobTitle);
      return;
    }

    if (useOutlineMode) {
      if (outlineText.trim()) {
        startFromOutline(outlineText);
      } else {
        handleGenerateFromOutlineBuilder();
      }
      return;
    }

    const promptValidation = getPromptValidationError(normalizedPrompt);
    if (promptValidation) {
      setPromptError(promptValidation);
      setShakePrompt(true);
      promptInputRef.current?.focus();
      return;
    }

    if (!isOnline) {
      setGlobalError('You are offline. Open a downloaded course from your account, use a sample course, or switch to manual outline mode.');
      return;
    }

    const topicForGeneration = normalizedPrompt;

    setPromptError(null);
    setAssessmentDraft('');
    setAssessmentError(null);
    setInteractionProgress({});
    setActiveCourseId('');
    setActiveCourseOwnerId(accountId);
    setBrowserPath('');
    trackedCourseStartRef.current = null;
    trackedLessonRef.current = null;
    trackedCompletedLessonRef.current = null;
    setState('assessing');
    setGlobalError(null);
    setRetryInfo(null);
    try {
      const questions = await aiService.generateAssessment(topicForGeneration, (attempt, delay) => {
        setRetryInfo({ attempt, delay });
      });
      setAssessment(questions);
    } catch (error: any) {
      console.error(error);
      setGlobalError(aiService.formatError(error));
      // We stay in 'assessing' state but assessment.length is 0, 
      // so the loading screen can show the error and a retry button.
    } finally {
      setRetryInfo(null);
    }
  };

  const handleAnswer = (answer: string, options?: { skipValidation?: boolean }) => {
    const q = assessment[currentAssessmentIdx];
    if (!q) return;
    const shouldValidate = q.type !== 'choice' && !options?.skipValidation;
    const cleanAnswer = normalizePromptInput(answer);

    if (shouldValidate) {
      const validation = getAssessmentAnswerValidationError(cleanAnswer);
      if (validation) {
        setAssessmentError(validation);
        return;
      }
    }

    setAssessmentError(null);
    setAssessmentDraft('');
    setAnswers(prev => ({ ...prev, [q.question]: cleanAnswer }));
    
    if (currentAssessmentIdx < assessment.length - 1) {
      setCurrentAssessmentIdx(prev => prev + 1);
    } else {
      handleGeneratePlan();
    }
  };

  const enterOutlineReview = () => {
    setState('outline_review');
    setOutlineReviewSelection([]);
    setOutlineReviewLessonByModule({});
    setOutlineReviewError(null);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptByTarget({});
    setOutlinePromptDraft('');
    setOutlinePromptCursor(0);
  };

  const handleGeneratePlan = async () => {
    const normalizedPrompt = normalizePromptInput(prompt);
    if (normalizedPrompt !== prompt) setPrompt(normalizedPrompt);
    const topicForPlan = normalizedPrompt;

    setState('planning');
    setGlobalError(null);
    setRetryInfo(null);
    
    // Small breathing room before first request
    await new Promise(resolve => setTimeout(resolve, 250));

    try {
      const plan = await aiService.generateCourseOutline(
        topicForPlan,
        answers,
        { requireAi: true, forceFresh: true },
        (attempt, delay) => {
          setRetryInfo({ attempt, delay });
        }
      );
      // Initialize modules with steps and status
      const initializedPlan = {
        ...plan,
        modules: plan.modules.map((m, idx) => ({
          ...m,
          steps: [],
          status: 'pending' as const,
          isLocked: idx > 0,
          isCompleted: false
        }))
      };
      setCourse(initializedPlan);
      setInteractionProgress({});
      setState('generating_outline');
      const outlineRun = await generateAllModuleContent(initializedPlan, {
        generateStepContent: false,
        regenerateLessonPlan: true,
      });
      if (outlineRun.failedModules.length) {
        const failedCount = outlineRun.failedModules.length;
        const totalCount = initializedPlan.modules.length;
        if (failedCount >= totalCount) {
          setGlobalError(`Outline generation failed for ${failedCount} module(s). Please retry or switch provider/model.`);
          setState('idle');
          return;
        }
        showMascotToast(
          'Partial outline ready',
          `Outline generation failed for ${failedCount} module(s). You can review partial outline and retry failed modules.`,
          'sad'
        );
      }
      enterOutlineReview();
    } catch (error: any) {
      console.error(error);
      setGlobalError(aiService.formatError(error));
      setState('idle');
    } finally {
      setRetryInfo(null);
    }
  };

  const generateAllModuleContent = async (
    plan: Course,
    options: {
      generateStepContent?: boolean;
      regenerateLessonPlan?: boolean;
    } = {}
  ): Promise<{ failedModules: string[] }> => {
    const generateStepContent = !!options.generateStepContent;
    const regenerateLessonPlan = options.regenerateLessonPlan !== false;
    const isOutlinePass = !generateStepContent;

    if (generateStepContent) {
      // Reset module + step statuses so queued modules don't look completed.
      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) => ({
            ...m,
            status: 'pending' as const,
            steps: (Array.isArray(m.steps) ? m.steps : []).map((s) => ({
              ...s,
              status: 'pending' as const,
              content: undefined,
            })),
          })),
        };
      });
    }

    setIsGeneratingModules(true);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const failedModuleIds = new Set<string>();
    const failedModuleTitles = new Map<string, string>();
    const manualModelSelected = !!routerModel && routerModel !== 'auto';
    const effectiveParallelWorkers = manualModelSelected
      ? Math.min(2, MODULE_PARALLEL_WORKERS)
      : MODULE_PARALLEL_WORKERS;
    const outlineWorkerRaw = Number(import.meta.env.VITE_OUTLINE_PARALLEL_WORKERS || 2);
    const outlineWorkerCap = Math.max(1, Math.min(3, Number.isFinite(outlineWorkerRaw) ? Math.floor(outlineWorkerRaw) : 2));
    const workerCap = isOutlinePass ? Math.min(effectiveParallelWorkers, outlineWorkerCap) : effectiveParallelWorkers;
    const maxParallelModules = Math.min(workerCap, Math.max(1, plan.modules.length));

    const runModuleGeneration = async (mod: Module, modIdx: number) => {
      try {
        if (isOutlinePass) {
          // Stagger outline requests slightly to reduce first-wave rate-limit spikes.
          await new Promise((resolve) => setTimeout(resolve, 140 * (modIdx % Math.max(1, maxParallelModules))));
        }
        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === mod.id ? { ...m, status: 'generating' as const } : m
            ),
          };
        });

        let moduleSteps: Module['steps'] = Array.isArray(mod.steps) ? mod.steps : [];

        if (regenerateLessonPlan || !moduleSteps.length) {
          const steps = await aiService.generateModuleLessonPlan(
            plan.title,
            mod.title,
            mod.description,
            { forceFresh: !generateStepContent, requireAi: !generateStepContent },
            (attempt, delay) => {
              setRetryInfo({ attempt, delay });
            }
          );
          moduleSteps = ensureLessonStepCoverage(
            normalizeGeneratedLessonSteps(steps, modIdx + 1, mod.title),
            mod.title,
            plan.title
          );
        } else {
          moduleSteps = ensureLessonStepCoverage(moduleSteps, mod.title, plan.title);
        }

        if (generateStepContent) {
          moduleSteps = moduleSteps.map((step) => ({
            ...step,
            status: 'pending',
            content: undefined,
          }));
        }

        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === mod.id
                ? { ...m, steps: moduleSteps, status: generateStepContent ? 'generating' as const : 'completed' as const }
                : m
            ),
          };
        });

        setActiveModuleId((current) => current || mod.id);
        setExpandedModuleId((current) => current || mod.id);

        if (!generateStepContent) return;

        let workingSteps = [...moduleSteps];
        let moduleHasError = false;

        for (const step of moduleSteps) {
          setCourse((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              modules: prev.modules.map((m) => {
                if (m.id !== mod.id) return m;
                return {
                  ...m,
                  steps: m.steps.map((s) => (s.id === step.id ? { ...s, status: 'generating' as const } : s)),
                };
              }),
            };
          });

          await new Promise((resolve) => setTimeout(resolve, 60));

          try {
            const referenceModule: Module = {
              ...mod,
              steps: workingSteps,
              status: 'generating',
            };
            const content = await generateStepWithFallbackRetry(
              plan.title,
              mod.title,
              step.title,
              step.type,
              buildStepReferenceContext(referenceModule, step.id),
              (attempt, delay) => {
                setRetryInfo({ attempt, delay });
              }
            );

            const sanitizedContent = sanitizeModuleContent(content, step.title);
            if (isFallbackModuleContent(sanitizedContent)) {
              moduleHasError = true;
            }

            workingSteps = workingSteps.map((s) =>
              s.id === step.id
                ? { ...s, status: 'completed' as const, content: sanitizedContent }
                : s
            );
          } catch (stepError) {
            console.error(`Failed to generate step ${step.title}`, stepError);
            moduleHasError = true;
            workingSteps = workingSteps.map((s) =>
              s.id === step.id ? { ...s, status: 'error' as const } : s
            );
          }

          const allSettled = workingSteps.every((s) => s.status === 'completed' || s.status === 'error');
          const nextStatus = allSettled
            ? (moduleHasError ? 'error' : 'completed')
            : 'generating';

          setCourse((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              modules: prev.modules.map((m) =>
                m.id === mod.id ? { ...m, steps: workingSteps, status: nextStatus } : m
              ),
            };
          });
        }

        const finalHasError = moduleHasError || workingSteps.some((s) => s.status === 'error');
        if (finalHasError) {
          failedModuleIds.add(mod.id);
          failedModuleTitles.set(mod.id, mod.title);
        } else {
          failedModuleIds.delete(mod.id);
        }
      } catch (e) {
        console.error(`Failed to generate lesson plan for ${mod.title}`, e);
        failedModuleIds.add(mod.id);
        failedModuleTitles.set(mod.id, mod.title);
        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === mod.id ? { ...m, status: 'error' as const } : m
            ),
          };
        });
      }
    };

    const queue = plan.modules.map((mod, modIdx) => ({ mod, modIdx }));
    const workers = Array.from({ length: maxParallelModules }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;
        await runModuleGeneration(next.mod, next.modIdx);
      }
    });

    await Promise.all(workers);

    if (isOutlinePass && failedModuleIds.size > 0 && failedModuleIds.size < plan.modules.length) {
      // Common case: first wave hits provider limits. Retry failed outline modules once, sequentially.
      for (const moduleId of Array.from(failedModuleIds)) {
        const modIdx = plan.modules.findIndex((m) => m.id === moduleId);
        const mod = modIdx >= 0 ? plan.modules[modIdx] : null;
        if (!mod) continue;
        await runModuleGeneration(mod, modIdx);
      }
    }

    setIsGeneratingModules(false);
    return {
      failedModules: Array.from(failedModuleIds).map((id) => failedModuleTitles.get(id) || id),
    };
  };

  const upsertOutlineEditTarget = (target: OutlineEditTarget) => {
    setOutlineReviewSelection((prev) => {
      if (prev.some((item) => item.key === target.key)) return prev;
      return [...prev, target];
    });
  };

  const handleOutlineDragStart = (event: React.DragEvent, target: OutlineEditTarget) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-outline-target', JSON.stringify(target));
  };

  const handleOutlineDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setOutlineDropActive(false);
    const raw = event.dataTransfer.getData('application/x-outline-target');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as OutlineEditTarget;
      if (!parsed || !parsed.key || !parsed.moduleId || !parsed.label) return;
      upsertOutlineEditTarget(parsed);
      setOutlineReviewError(null);
    } catch {
      setOutlineReviewError('Could not add this outline item. Please drag again.');
    }
  };

  const handleRemoveOutlineTarget = (targetKey: string) => {
    setOutlineReviewSelection((prev) => prev.filter((item) => item.key !== targetKey));
    setOutlinePromptByTarget((prev) => {
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
  };

  const handleDoneSelectingOutlineTargets = () => {
    if (!outlineReviewSelection.length) {
      setOutlineReviewError('Drag at least one module, lesson, or sub-content into the edit box.');
      return;
    }
    setOutlineReviewError(null);
    setOutlinePromptCursor(0);
    const firstKey = outlineReviewSelection[0]?.key;
    setOutlinePromptDraft(firstKey ? (outlinePromptByTarget[firstKey] || '') : '');
    setIsOutlinePromptSequenceOpen(true);
  };

  const handleCancelOutlinePromptSequence = () => {
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptCursor(0);
    setOutlinePromptDraft('');
    setOutlineReviewError(null);
  };

  const handleApplyOutlineEdits = async (promptByTarget: Record<string, string>) => {
    if (!course) return;
    if (!isOnline) {
      setOutlineReviewError('Outline recrafting requires an internet connection.');
      return;
    }

    const groupedByModule = new Map<string, Array<{ target: OutlineEditTarget; prompt: string }>>();
    for (const target of outlineReviewSelection) {
      const promptText = normalizePromptInput(promptByTarget[target.key] || '');
      if (!promptText) continue;
      const bucket = groupedByModule.get(target.moduleId) || [];
      bucket.push({ target, prompt: promptText });
      groupedByModule.set(target.moduleId, bucket);
    }

    if (!groupedByModule.size) {
      setOutlineReviewError('Add at least one valid edit instruction before recrafting.');
      return;
    }

    setIsRecraftingOutline(true);
    setOutlineReviewError(null);
    setRetryInfo(null);
    setOutlineEditSummary(null);
    setOutlineFocusTargetKey(null);

    const allChanges: OutlineEditChange[] = [];
    const failedModules: string[] = [];

    for (const [moduleId, instructions] of groupedByModule.entries()) {
      const module = course.modules.find((m) => m.id === moduleId);
      if (!module) continue;

      const leadTarget = instructions[0]?.target;
      if (leadTarget) {
        setOutlineProcessingTargetKey(leadTarget.key);
        if (typeof leadTarget.lessonNumber === 'number') {
          setOutlineReviewLessonByModule((prev) => ({ ...prev, [moduleId]: leadTarget.lessonNumber as number }));
        }
      }

      const beforeByTarget = new Map<string, string>();
      for (const { target } of instructions) {
        beforeByTarget.set(target.key, resolveOutlineTargetSnapshot(module, target));
      }

      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) =>
            m.id === moduleId ? { ...m, status: 'generating' as const } : m
          ),
        };
      });

      const moduleInstruction = instructions
        .map(({ target, prompt }) => `- ${target.label}: ${prompt}`)
        .join('\n');

      try {
        const previousSignature = (Array.isArray(module.steps) ? module.steps : [])
          .map((step) => `${step.type}:${stripStructuredStepPrefix(step.title || '')}`)
          .join('|');
        const moduleIndex = Math.max(0, course.modules.findIndex((m) => m.id === moduleId));
        const buildSteps = (generated: Array<{ id: string; title: string; type: ContentType }>) => ensureLessonStepCoverage(
          normalizeGeneratedLessonSteps(generated, moduleIndex + 1, module.title),
          module.title,
          course.title
        );
        const requestLessonPlan = async (extraInstruction: string) => aiService.generateModuleLessonPlan(
          course.title,
          module.title,
          `${module.description}\n\nTargeted edits:\n${moduleInstruction}${extraInstruction ? `\n\n${extraInstruction}` : ''}`,
          { forceFresh: true, requireAi: true },
          (attempt, delay) => {
            setRetryInfo({ attempt, delay });
          }
        );

        let generated = await requestLessonPlan('');
        let steps = buildSteps(generated);
        let nextSignature = steps
          .map((step) => `${step.type}:${stripStructuredStepPrefix(step.title || '')}`)
          .join('|');

        if (previousSignature && previousSignature === nextSignature) {
          generated = await requestLessonPlan('Critical: Apply the targeted edits with at least one visible title/structure change in this module.');
          steps = buildSteps(generated);
          nextSignature = steps
            .map((step) => `${step.type}:${stripStructuredStepPrefix(step.title || '')}`)
            .join('|');
        }

        const updatedModule: Module = {
          ...module,
          steps,
          status: 'completed',
        };
        const moduleChanges = instructions.map(({ target, prompt }) => {
          const before = beforeByTarget.get(target.key) || '';
          const after = resolveOutlineTargetSnapshot(updatedModule, target);
          return {
            target,
            targetKey: target.key,
            label: target.label,
            moduleId,
            lessonNumber: target.lessonNumber,
            instruction: prompt,
            before,
            after,
            changed: normalizeOutlineSnapshot(before) !== normalizeOutlineSnapshot(after),
          } as OutlineEditChange;
        });
        allChanges.push(...moduleChanges);

        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === moduleId ? { ...m, steps, status: 'completed' as const } : m
            ),
          };
        });
        const firstLesson = steps.find((step) => typeof step.lessonNumber === 'number')?.lessonNumber;
        if (typeof firstLesson === 'number') {
          setOutlineReviewLessonByModule((prev) => ({ ...prev, [moduleId]: firstLesson }));
        }
      } catch (e: any) {
        failedModules.push(module.title);
        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === moduleId ? { ...m, status: 'error' as const } : m
            ),
          };
        });
        setOutlineReviewError(String(e?.message || `Failed to recraft ${module.title}.`));
      } finally {
        setRetryInfo(null);
      }
    }

    setIsRecraftingOutline(false);
    setOutlineProcessingTargetKey(null);
    setOutlineReviewSelection([]);
    setIsOutlinePromptSequenceOpen(false);
    setOutlinePromptByTarget({});
    setOutlinePromptCursor(0);
    setOutlinePromptDraft('');

    if (allChanges.length) {
      const changedCount = allChanges.filter((change) => change.changed).length;
      const unchangedCount = allChanges.length - changedCount;
      const focusTarget = allChanges.find((change) => change.changed) || allChanges[0];

      setOutlineEditSummary({
        at: Date.now(),
        total: allChanges.length,
        changed: changedCount,
        unchanged: unchangedCount,
        failedModules,
        changes: allChanges,
      });
      setIsOutlineSummaryModalOpen(true);
      if (focusTarget) {
        setOutlineFocusTargetKey(focusTarget.targetKey);
        if (typeof focusTarget.lessonNumber === 'number') {
          setOutlineReviewLessonByModule((prev) => ({ ...prev, [focusTarget.moduleId]: focusTarget.lessonNumber as number }));
        }
      }

      if (changedCount > 0) {
        showMascotToast(
          'Outline updated',
          `${changedCount}/${allChanges.length} selected item(s) changed successfully.`,
          'happy'
        );
      } else {
        showMascotToast(
          'No visible outline change',
          'Try a more specific edit instruction so the outline can change visibly.',
          'sad'
        );
      }
    }

    if (failedModules.length) {
      setOutlineReviewError(
        `Recraft failed for ${failedModules.length} module(s): ${failedModules.join(', ')}.`
      );
      showMascotToast('Some edits failed', 'Check the error and retry the affected modules.', 'sad');
    }
  };

  const handleOutlinePromptDone = () => {
    const currentTarget = outlineReviewSelection[outlinePromptCursor];
    if (!currentTarget) {
      setIsOutlinePromptSequenceOpen(false);
      return;
    }
    const validation = getOutlineEditInstructionError(outlinePromptDraft);
    if (validation) {
      setOutlineReviewError(validation);
      return;
    }

    const cleaned = normalizePromptInput(outlinePromptDraft);
    const nextPrompts = {
      ...outlinePromptByTarget,
      [currentTarget.key]: cleaned,
    };
    setOutlinePromptByTarget(nextPrompts);
    setOutlineReviewError(null);

    if (outlinePromptCursor < outlineReviewSelection.length - 1) {
      const nextCursor = outlinePromptCursor + 1;
      const nextTarget = outlineReviewSelection[nextCursor];
      setOutlinePromptCursor(nextCursor);
      setOutlinePromptDraft(nextTarget ? (nextPrompts[nextTarget.key] || '') : '');
      return;
    }

    void handleApplyOutlineEdits(nextPrompts);
  };

  const handleAcceptOutlineSummary = () => {
    setIsOutlineSummaryModalOpen(false);
    setOutlineEditSummary(null);
  };

  const handleRefineOutlineSummary = () => {
    if (!outlineEditSummary?.changes.length) return;
    const seen = new Set<string>();
    const nextTargets: OutlineEditTarget[] = [];
    const nextPrompts: Record<string, string> = {};

    for (const change of outlineEditSummary.changes) {
      const target = change.target;
      if (!target || !target.key || seen.has(target.key)) continue;
      seen.add(target.key);
      nextTargets.push(target);
      nextPrompts[target.key] = change.instruction || '';
    }
    if (!nextTargets.length) return;

    const firstTarget = nextTargets[0];
    setOutlineReviewSelection(nextTargets);
    setOutlinePromptByTarget(nextPrompts);
    setOutlinePromptCursor(0);
    setOutlinePromptDraft(nextPrompts[firstTarget.key] || '');
    setIsOutlinePromptSequenceOpen(true);
    setOutlineReviewError(null);
    setOutlineFocusTargetKey(firstTarget.key);
    if (typeof firstTarget.lessonNumber === 'number') {
      setOutlineReviewLessonByModule((prev) => ({ ...prev, [firstTarget.moduleId]: firstTarget.lessonNumber as number }));
    }
    setIsOutlineSummaryModalOpen(false);
  };

  const handleApproveOutline = () => {
    const currentCourse = course;
    if (!currentCourse) return;

    if (!isOnline) {
      setGlobalError('Crafting full course content requires an internet connection.');
      return;
    }

    setGlobalError(null);
    setOutlineReviewError(null);
    setRetryInfo(null);
    setState('generating_content');
    void generateAllModuleContent(currentCourse, {
      generateStepContent: true,
      regenerateLessonPlan: false,
    });
  };

  const handleRetryModule = async (moduleId: string) => {
    if (!course) return;
    const mod = course.modules.find(m => m.id === moduleId);
    if (!mod) return;
    const retryableSteps = (Array.isArray(mod.steps) ? mod.steps : []).filter((step) =>
      step.status === 'error'
      || step.status === 'pending'
      || step.status === 'loading'
      || (step.status === 'completed' && !step.content)
    );

    // Retry only failed sub-contents when the module already has a lesson plan.
    if (retryableSteps.length > 0) {
      const retrySet = new Set(retryableSteps.map((step) => step.id));
      setInteractionProgress((prev) => {
        const next = { ...prev };
        for (const step of retryableSteps) {
          delete next[stepProgressKey(moduleId, step.id)];
        }
        return next;
      });

      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) => {
            if (m.id !== moduleId) return m;
            return {
              ...m,
              status: 'generating' as const,
              steps: m.steps.map((s) => (retrySet.has(s.id) ? { ...s, status: 'loading' as const } : s)),
            };
          }),
        };
      });

      let workingSteps = mod.steps.map((step) =>
        retrySet.has(step.id) ? { ...step, status: 'loading' as const } : step
      );
      let moduleHasError = false;

      for (const step of retryableSteps) {
        try {
          const referenceModule: Module = {
            ...mod,
            steps: workingSteps,
            status: 'generating',
          };
          const content = await generateStepWithFallbackRetry(
            course.title,
            mod.title,
            step.title,
            step.type,
            buildStepReferenceContext(referenceModule, step.id),
            (attempt, delay) => {
              setRetryInfo({ attempt, delay });
            }
          );
          const sanitized = sanitizeModuleContent(content, step.title);
          if (isFallbackModuleContent(sanitized)) {
            moduleHasError = true;
          }
          workingSteps = workingSteps.map((s) =>
            s.id === step.id ? { ...s, status: 'completed' as const, content: sanitized } : s
          );
        } catch (e) {
          console.error(`Failed to retry step ${step.title}`, e);
          moduleHasError = true;
          workingSteps = workingSteps.map((s) =>
            s.id === step.id ? { ...s, status: 'error' as const } : s
          );
        }

        const pendingOrErrored = workingSteps.some((s) =>
          s.status === 'error'
          || s.status === 'pending'
          || s.status === 'loading'
          || s.status === 'generating'
          || (s.status === 'completed' && !s.content)
        );

        setCourse((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === moduleId
                ? {
                    ...m,
                    steps: workingSteps,
                    status: pendingOrErrored || moduleHasError ? 'generating' as const : 'completed' as const,
                  }
                : m
            ),
          };
        });
      }

      const unresolved = workingSteps.some((s) =>
        s.status === 'error'
        || s.status === 'pending'
        || s.status === 'loading'
        || s.status === 'generating'
        || (s.status === 'completed' && !s.content)
      );
      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) =>
            m.id === moduleId
              ? { ...m, steps: workingSteps, status: unresolved || moduleHasError ? 'error' as const : 'completed' as const }
              : m
          ),
        };
      });

      setRetryInfo(null);
      return;
    }

    // If lesson plan itself is missing/broken, regenerate only the module structure.
    setInteractionProgress((prev) => {
      const next: Record<string, StepInteractionProgress> = {};
      const prefix = `${moduleId}:`;
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) next[key] = value;
      }
      return next;
    });

    setCourse((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        modules: prev.modules.map((m) => (m.id === moduleId ? { ...m, status: 'generating' as const } : m)),
      };
    });

    try {
      const steps = await aiService.generateModuleLessonPlan(course.title, mod.title, mod.description, (attempt, delay) => {
        setRetryInfo({ attempt, delay });
      });
      const moduleIndex = Math.max(0, course.modules.findIndex((m) => m.id === moduleId));
      const initialSteps = ensureLessonStepCoverage(
        normalizeGeneratedLessonSteps(steps, moduleIndex + 1, mod.title),
        mod.title,
        course.title
      );

      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) =>
            m.id === moduleId ? { ...m, steps: initialSteps, status: 'completed' as const } : m
          ),
        };
      });
    } catch (e) {
      console.error(`Failed to retry module ${mod.title}`, e);
      setCourse((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map((m) => (m.id === moduleId ? { ...m, status: 'error' as const } : m)),
        };
      });
    } finally {
      setRetryInfo(null);
    }
  };

  const handleModuleComplete = (moduleId: string) => {
    const currentCourse = course;
    if (!currentCourse) return;
    const moduleIdx = currentCourse.modules.findIndex((m) => m.id === moduleId);
    const module = moduleIdx >= 0 ? currentCourse.modules[moduleIdx] : null;
    const courseAlreadyCompleted = currentCourse.modules.every((m) => !!m.isCompleted);
    const willCompleteCourse = !!module && !module.isCompleted && !courseAlreadyCompleted
      && currentCourse.modules.every((m, idx) => idx === moduleIdx || !!m.isCompleted);

    setCourse(prev => {
      if (!prev) return null;
      const moduleIdx = prev.modules.findIndex(m => m.id === moduleId);
      if (moduleIdx === -1) return prev;

      const newModules = [...prev.modules];
      if (newModules[moduleIdx].isCompleted) return prev; // Already completed

      newModules[moduleIdx] = { ...newModules[moduleIdx], isCompleted: true };
      
      // Unlock next module
      if (moduleIdx < newModules.length - 1) {
        newModules[moduleIdx + 1] = { ...newModules[moduleIdx + 1], isLocked: false };
      }

      addPoints(500);
      setStreak(prev => prev + 1);
      showMascotToast('Module cleared!', 'SEA-Geko unlocked the next module for you.', 'happy');

      return { ...prev, modules: newModules };
    });
    void trackImpactEvent('lesson_completed', { moduleId });
    if (willCompleteCourse) {
      void trackImpactEvent('course_completed', { moduleId });
    }
  };

  const handleUpdateStepContent = (moduleId: string, stepId: string, newContent: ModuleContent) => {
    const stepTitleHint = course?.modules.find((m) => m.id === moduleId)?.steps.find((s) => s.id === stepId)?.title || '';
    const safeContent = sanitizeModuleContent(newContent, stepTitleHint);
    setCourse(prev => {
      if (!prev) return null;
      return {
        ...prev,
        modules: prev.modules.map(m => {
          if (m.id !== moduleId) return m;
          return {
            ...m,
            steps: m.steps.map(s => 
              s.id === stepId ? { ...s, content: safeContent } : s
            )
          };
        })
      };
    });
  };

  const handleRetryStep = async (moduleId: string, stepId: string) => {
    if (!course) return;
    const mod = course.modules.find(m => m.id === moduleId);
    const step = mod?.steps.find(s => s.id === stepId);
    if (!mod || !step) return;
    setInteractionProgress((prev) => {
      const next = { ...prev };
      delete next[stepProgressKey(moduleId, stepId)];
      return next;
    });

    setIsRetrying(stepId);
    setCourse(prev => {
      if (!prev) return null;
      return {
        ...prev,
        modules: prev.modules.map(m => {
          if (m.id !== moduleId) return m;
          return {
            ...m,
            steps: m.steps.map(s => s.id === stepId ? { ...s, status: 'loading' as const } : s)
          };
        })
      };
    });

    try {
      const content = await generateStepWithFallbackRetry(
        course.title,
        mod.title,
        step.title,
        step.type,
        buildStepReferenceContext(mod, step.id),
        (attempt, delay) => {
          setRetryInfo({ attempt, delay });
        }
      );
      handleUpdateStepContent(moduleId, stepId, content);
      setCourse(prev => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id !== moduleId) return m;
            return {
              ...m,
              steps: m.steps.map(s => s.id === stepId ? { ...s, status: 'completed' as const } : s)
            };
          })
        };
      });
    } catch (e) {
      console.error(e);
      setCourse(prev => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map(m => {
            if (m.id !== moduleId) return m;
            return {
              ...m,
              steps: m.steps.map(s => s.id === stepId ? { ...s, status: 'error' as const } : s)
            };
          })
        };
      });
    } finally {
      setIsRetrying(null);
    }
  };

  // Sequential background generation for active module steps
  useEffect(() => {
    if (state !== 'learning') return;
    if (!course || !activeModuleId || isGeneratingModules) return;

    const activeModule = course.modules.find(m => m.id === activeModuleId);
    if (!activeModule) return;

    // Check if any step is already generating to avoid double calls
    if (activeModule.steps.some(s => s.status === 'generating')) return;

    // Find the first pending step in the active module
    const pendingStep = activeModule.steps.find(s => s.status === 'pending');
    
    if (pendingStep) {
      const generateStep = async () => {
        try {
          // Mark as generating
          setCourse(prev => {
            if (!prev) return null;
            return {
              ...prev,
              modules: prev.modules.map(m => {
                if (m.id !== activeModuleId) return m;
                return {
                  ...m,
                  steps: m.steps.map(s => s.id === pendingStep.id ? { ...s, status: 'generating' as const } : s)
                };
              })
            };
          });

          // Keep responsive without overloading providers.
          await new Promise(resolve => setTimeout(resolve, 400));

          const content = await generateStepWithFallbackRetry(
            course.title,
            activeModule.title,
            pendingStep.title,
            pendingStep.type,
            buildStepReferenceContext(activeModule, pendingStep.id),
            (attempt, delay) => {
              setRetryInfo({ attempt, delay });
            }
          );

          setCourse(prev => {
            if (!prev) return null;
            return {
              ...prev,
              modules: prev.modules.map(m => {
                if (m.id !== activeModuleId) return m;
                return {
                  ...m,
                  steps: m.steps.map(s => 
                    s.id === pendingStep.id ? { ...s, content: sanitizeModuleContent(content, pendingStep.title), status: 'completed' as const } : s
                  )
                };
              })
            };
          });
        } catch (e) {
          console.error(`Failed to generate step ${pendingStep.title}`, e);
          setCourse(prev => {
            if (!prev) return null;
            return {
              ...prev,
              modules: prev.modules.map(m => {
                if (m.id !== activeModuleId) return m;
                return {
                  ...m,
                  steps: m.steps.map(s => s.id === pendingStep.id ? { ...s, status: 'error' as const } : s)
                };
              })
            };
          });
        } finally {
          setRetryInfo(null);
        }
      };

      generateStep();
    }
  }, [course, activeModuleId, isGeneratingModules, state]);

  useEffect(() => {
    if (!course) return;
    setActiveLessonByModule(prev => {
      const next = { ...prev };
      for (const module of course.modules) {
        if (typeof next[module.id] === 'number') continue;
        const firstLesson = module.steps.find((s) => typeof s.lessonNumber === 'number')?.lessonNumber;
        if (typeof firstLesson === 'number') next[module.id] = firstLesson;
      }
      return next;
    });
  }, [course]);

  useEffect(() => {
    if (!course || state !== 'outline_review') return;
    setOutlineReviewLessonByModule((prev) => {
      const next = { ...prev };
      for (const module of course.modules) {
        const firstLesson = module.steps.find((s) => typeof s.lessonNumber === 'number')?.lessonNumber;
        if (typeof firstLesson !== 'number') continue;
        if (typeof next[module.id] === 'number') continue;
        next[module.id] = firstLesson;
      }
      return next;
    });
  }, [course, state]);

  useEffect(() => {
    if (state !== 'outline_review') return;
    const targetKey = outlineProcessingTargetKey || outlineFocusTargetKey;
    if (!targetKey) return;
    const timer = window.setTimeout(() => {
      const targetEl = outlineTargetRefs.current[targetKey];
      if (!targetEl) return;
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [state, outlineProcessingTargetKey, outlineFocusTargetKey, course, outlineReviewLessonByModule]);
  
  const activeModule = course?.modules.find(m => m.id === activeModuleId);
  const activeModuleHasStructuredLessons = !!activeModule?.steps.some((s) => typeof s.lessonNumber === 'number');
  const activeModuleLessonGroups = activeModule && activeModuleHasStructuredLessons
    ? groupModuleStepsByLesson(activeModule.steps)
    : [];
  const activeLessonNumber = activeModule
    ? (activeLessonByModule[activeModule.id] ?? activeModuleLessonGroups[0]?.lessonNumber ?? null)
    : null;
  const visibleModuleSteps = activeModule && activeModuleHasStructuredLessons && typeof activeLessonNumber === 'number'
    ? activeModule.steps.filter((s) => s.lessonNumber === activeLessonNumber)
    : (activeModule?.steps || []);
  const activeModuleProgress = activeModule
    ? getModuleLearningProgress(activeModule)
    : { completed: 0, total: 0, percent: 0 };
  const activeEditingStep = useMemo(() => {
    if (!activeModule || !editingStepId) return null;
    const step = activeModule.steps.find((s) => s.id === editingStepId);
    if (!step || step.status !== 'completed' || !step.content) return null;
    return {
      moduleId: activeModule.id,
      stepId: step.id,
      content: step.content,
    };
  }, [activeModule, editingStepId]);
  const overallProgress = (() => {
    const totals = course
      ? course.modules.reduce(
          (acc, module) => {
            const p = getModuleLearningProgress(module);
            return {
              completed: acc.completed + p.completed,
              total: acc.total + p.total,
            };
          },
          { completed: 0, total: 0 }
        )
      : { completed: 0, total: 0 };
    return {
      ...totals,
      percent: totals.total ? Math.round((totals.completed / totals.total) * 100) : 0,
    };
  })();
  const courseResources = useMemo(() => buildCourseResources(course), [course]);
  const isSampleCourseActive = !!course
    && course.title === SAMPLE_COURSE.title
    && course.description === SAMPLE_COURSE.description;
  const myCourseIdSet = useMemo(
    () => new Set(myCourses.map((post) => String(post.courseId || ''))),
    [myCourses]
  );
  const activeCourseOwnedByMe = (
    String(activeCourseOwnerId || '').trim() === String(accountId || '').trim()
    || (!!activeCourseId && myCourseIdSet.has(activeCourseId))
  );
  const canShowDraftCourse = !!course
    && !isSampleCourseActive
    && activeCourseOwnedByMe
    && (!activeCourseId || myCourseIdSet.has(activeCourseId));
  const draftCoursePost = canShowDraftCourse && course
    ? ({
        id: `draft-${course.title}`,
        courseId: activeCourseId || course.title,
        ownerId: accountId,
        title: course.title,
        description: course.description,
        snapshot: course,
        visibility: 'private',
        moderationStatus: 'clean',
        reactions: 0,
        upvotes: 0,
        downvotes: 0,
        userReaction: null,
        comments: 0,
        saves: 0,
        createdAt: new Date().toISOString(),
      } as PublicCoursePost)
    : null;
  const profileCreatedCourses = (() => {
    if (!draftCoursePost) return myCourses;
    const exists = myCourses.some((post) =>
      post.courseId === draftCoursePost.courseId
      || (post.ownerId === draftCoursePost.ownerId && post.title === draftCoursePost.title)
    );
    return exists ? myCourses : [draftCoursePost, ...myCourses];
  })();
  const currentlyLearningCourses = useMemo(() => {
    const dedup = new Map<string, LearningCourseSummary>();
    for (const row of learningCourses || []) {
      const courseId = String(row?.courseId || '').trim();
      if (!courseId) continue;
      const ownerId = String(row?.ownerId || '').trim();
      const shouldAppear = !myCourseIdSet.has(courseId) || (ownerId && ownerId !== accountId);
      if (!shouldAppear) continue;
      if (!dedup.has(courseId)) dedup.set(courseId, row);
    }
    if (state === 'learning' && course && activeCourseId && !myCourseIdSet.has(activeCourseId) && !dedup.has(activeCourseId)) {
      dedup.set(activeCourseId, {
        courseId: activeCourseId,
        ownerId: '',
        title: course.title || activeCourseId,
        description: course.description || '',
        visibility: 'public',
        startedAt: '',
        lastActiveAt: new Date().toISOString(),
        metrics: impactMetrics,
      });
    }
    return Array.from(dedup.values()).slice(0, 12);
  }, [learningCourses, myCourseIdSet, accountId, state, course, activeCourseId, impactMetrics]);
  const activeAnalyticsCourse = useMemo(
    () => myCourses.find((post) => post.courseId === activeAnalyticsCourseId) || null,
    [myCourses, activeAnalyticsCourseId]
  );
  const activeCourseAnalytics = activeAnalyticsCourseId
    ? (courseAnalyticsByCourseId[activeAnalyticsCourseId] || null)
    : null;
  const activeCommunityOwnerIdentity = activeCommunityPost
    ? publicIdentityByAccountId[String(activeCommunityPost.ownerId || '').trim()] || null
    : null;
  const analyticsTrendChart = useMemo(
    () => buildCompletionTrendPolyline(activeCourseAnalytics?.trend || []),
    [activeCourseAnalytics?.trend]
  );
  const cvProfile = useMemo(() => sanitizeCvProfileForDisplay(cvAnalysis?.parsed || null), [cvAnalysis?.parsed]);
  const cvIsValidated = !!cvAnalysis?.valid;
  const cvStatusMeta = useMemo(() => {
    switch (cvResubmitStatus) {
      case 'processing':
        return {
          label: 'Processing CV',
          detail: cvResubmitMessage || 'Analyzing and validating CV fields...',
          tone: 'border-cyan-200 bg-cyan-50 text-cyan-800',
          progressTone: 'bg-cyan-500',
          icon: 'processing' as const,
        };
      case 'valid':
        return {
          label: 'CV Valid',
          detail: cvResubmitMessage || 'CV format and core fields look valid.',
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          progressTone: 'bg-emerald-500',
          icon: 'success' as const,
        };
      case 'invalid':
        return {
          label: 'CV Invalid',
          detail: cvResubmitMessage || cvAnalysisError || 'Upload a readable CV with enough text content.',
          tone: 'border-amber-200 bg-amber-50 text-amber-800',
          progressTone: 'bg-amber-500',
          icon: 'warning' as const,
        };
      case 'success':
        return {
          label: 'CV Saved',
          detail: cvResubmitMessage || 'CV data saved successfully.',
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          progressTone: 'bg-emerald-500',
          icon: 'success' as const,
        };
      case 'fail':
        return {
          label: 'CV Save Failed',
          detail: cvResubmitMessage || 'Could not save CV update. Please retry.',
          tone: 'border-red-200 bg-red-50 text-red-800',
          progressTone: 'bg-red-500',
          icon: 'warning' as const,
        };
      default:
        return null;
    }
  }, [cvResubmitStatus, cvResubmitMessage, cvAnalysisError]);
  const careerGuidanceEnabled = !!(authUser?.id && cvIsValidated && cvProfile);
  const discoverySourceChoice = DISCOVERY_OPTIONS.some((option) => option.value === profileDraft.discoverySource)
    ? (profileDraft.discoverySource as NonNullable<UserProfile['discoverySource']>)
    : DISCOVERY_OPTIONS[0].value;
  const careerInterests = useMemo(
    () => normalizeInterestTerms(careerInterestsInput, profileDraft.learningGoal),
    [careerInterestsInput, profileDraft.learningGoal]
  );
  const matchedCareerGuides = useMemo(
    () => (careerGuidanceEnabled ? selectCareerGuides(careerInterests, cvProfile?.skills || []) : []),
    [careerGuidanceEnabled, careerInterests, cvProfile?.skills]
  );
  const fallbackInterviewJobs = useMemo(
    () => matchedCareerGuides.map((guide) => ({
      id: guide.id,
      title: guide.title,
      reason: guide.roleSummary,
    })),
    [matchedCareerGuides]
  );
  const isViewingOwnCreatorProfile = !!(creatorProfile?.id && authUser?.id && creatorProfile.id === authUser.id);
  const canFollowActiveCreator = !!(creatorProfile?.id && authUser?.id && creatorProfile.id !== authUser.id);
  const outlinePromptTarget = outlineReviewSelection[outlinePromptCursor] || null;
  const interviewVoiceSupported = !!getInterviewSpeechRecognitionCtor();
  const interviewVoiceSupportMessage = INTERVIEW_VOICE_UNSUPPORTED_MESSAGE;
  const activeInterviewQuestion = interviewSession?.questions?.[interviewActiveQuestionIdx] || null;
  const activeInterviewAnswer = activeInterviewQuestion
    ? interviewAnswersByQuestionId[activeInterviewQuestion.id] || ''
    : '';
  const inheritedInterviewAnswerMode = useMemo(() => {
    if (!interviewSession || !activeInterviewQuestion || !interviewVoiceSupported) return 'text' as const;
    const direct = interviewAnswerModeByQuestionId[activeInterviewQuestion.id];
    if (direct) return direct;
    for (let idx = interviewActiveQuestionIdx - 1; idx >= 0; idx -= 1) {
      const priorQuestion = interviewSession.questions[idx];
      if (!priorQuestion) continue;
      const priorMode = interviewAnswerModeByQuestionId[priorQuestion.id];
      if (priorMode) return priorMode;
    }
    return 'text' as const;
  }, [
    interviewSession,
    activeInterviewQuestion,
    interviewVoiceSupported,
    interviewAnswerModeByQuestionId,
    interviewActiveQuestionIdx,
  ]);
  const activeInterviewAnswerMode = activeInterviewQuestion
    ? (
      interviewVoiceSupported
        ? inheritedInterviewAnswerMode
        : 'text'
    )
    : 'text';
  const activeInterviewRecordedSeconds = activeInterviewQuestion
    ? (
      recordingQuestionId === activeInterviewQuestion.id
        ? interviewRecordingElapsedSeconds
        : Number(interviewRecordedSecondsByQuestionId[activeInterviewQuestion.id] || 0)
    )
    : 0;
  const interviewAnsweredCount = interviewSession
    ? interviewSession.questions.filter((q) => normalizePromptInput(interviewAnswersByQuestionId[q.id] || '').length > 0).length
    : 0;
  const interviewRolesHeading = useMemo(() => {
    if (locale === 'my') return 'အကြံပြု အင်တာဗျူး အလုပ်ရာထူးများ';
    if (locale === 'th') return 'ตำแหน่งสัมภาษณ์ที่แนะนำ';
    if (locale === 'id') return 'Peran wawancara yang direkomendasikan';
    if (locale === 'ms') return 'Peranan temu duga yang disyorkan';
    if (locale === 'vi') return 'Vai trò phỏng vấn được đề xuất';
    if (locale === 'tl') return 'Mga inirerekomendang interview role';
    if (locale === 'km') return 'តួនាទីសម្ភាសន៍ដែលបានណែនាំ';
    if (locale === 'lo') return 'ບົດບາດສໍາພາດທີ່ແນະນໍາ';
    return 'Recommended interview roles';
  }, [locale]);

  useEffect(() => {
    if (interviewVoiceSupported) return;
    setInterviewAnswerModeByQuestionId((prev) => {
      const entries = Object.entries(prev);
      if (!entries.some(([, mode]) => mode === 'voice')) return prev;
      const next: Record<string, 'text' | 'voice'> = {};
      for (const [questionId, mode] of entries) {
        next[questionId] = mode === 'voice' ? 'text' : mode;
      }
      return next;
    });
    if (recordingQuestionId) {
      stopInterviewRecording();
      setRecordingQuestionId(null);
    }
  }, [interviewVoiceSupported, recordingQuestionId]);

  useEffect(() => {
    if (composerMode !== 'interview') {
      stopInterviewRecording();
      setRecordingQuestionId(null);
      setInterviewTranscribingQuestionId(null);
      setInterviewRecordingElapsedSeconds(0);
      setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
      return;
    }
    if (!careerGuidanceEnabled || !cvProfile) {
      setInterviewRecommendedJobs(fallbackInterviewJobs.slice(0, 6));
      setInterviewJobsBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setInterviewJobsBusy(true);
      try {
        const jobs = await aiService.getInterviewRecommendedJobs({
          profile: buildInterviewProfilePayload(),
        });
        if (cancelled) return;
        const merged = jobs.length ? jobs : fallbackInterviewJobs;
        setInterviewRecommendedJobs(merged.slice(0, 8));
      } catch {
        if (cancelled) return;
        setInterviewRecommendedJobs(fallbackInterviewJobs.slice(0, 6));
      } finally {
        if (!cancelled) setInterviewJobsBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    composerMode,
    careerGuidanceEnabled,
    cvProfile,
    fallbackInterviewJobs,
    careerPromptSeed,
    profileDraft.learningGoal,
    profileDraft.region,
    locale,
  ]);

  useEffect(() => {
    return () => {
      stopInterviewRecording();
      speechRecognitionRef.current = null;
      clearInterviewMediaStream();
    };
  }, []);

  useEffect(() => {
    if (state !== 'learning' || !course) return;
    const courseId = activeCourseId || `course:${course.title}`;
    if (trackedCourseStartRef.current !== courseId) {
      trackedCourseStartRef.current = courseId;
      void trackImpactEvent('course_started', {
        segment: profile?.userSegment || 'youth',
        language: locale,
        lowBandwidthMode,
      });
    }
    const day = new Date().toISOString().slice(0, 10);
    const dayKey = `${courseId}:${day}`;
    if (trackedDailyRef.current !== dayKey) {
      trackedDailyRef.current = dayKey;
      void trackImpactEvent('daily_active', { day });
    }
  }, [state, course?.title, profile?.userSegment, locale, lowBandwidthMode, activeCourseId]);

  useEffect(() => {
    if (state !== 'learning' || !course || !activeModuleId) return;
    const lessonKey = `${course.title}:${activeModuleId}:${String(activeLessonNumber ?? 'all')}`;
    if (trackedLessonRef.current === lessonKey) return;
    trackedLessonRef.current = lessonKey;
    void trackImpactEvent('lesson_started', {
      moduleId: activeModuleId,
      lessonNumber: typeof activeLessonNumber === 'number' ? activeLessonNumber : null,
    });
  }, [state, course?.title, activeModuleId, activeLessonNumber]);

  useEffect(() => {
    if (state !== 'learning' || !activeModule || !course) return;
    const stepsForLesson = activeModuleHasStructuredLessons && typeof activeLessonNumber === 'number'
      ? activeModule.steps.filter((s) => s.lessonNumber === activeLessonNumber)
      : visibleModuleSteps;
    if (!stepsForLesson.length) return;
    const lessonDone = stepsForLesson.every((step) => isStepLearnerComplete(activeModule.id, step));
    if (!lessonDone) return;
    const lessonKey = `${course.title}:${activeModule.id}:${String(activeLessonNumber ?? 'all')}`;
    if (trackedCompletedLessonRef.current === lessonKey) return;
    trackedCompletedLessonRef.current = lessonKey;
    void trackImpactEvent('lesson_completed', {
      moduleId: activeModule.id,
      lessonNumber: typeof activeLessonNumber === 'number' ? activeLessonNumber : null,
      steps: stepsForLesson.length,
    });
  }, [state, course?.title, activeModule, activeModuleHasStructuredLessons, activeLessonNumber, visibleModuleSteps, interactionProgress]);

  useEffect(() => {
    if (state !== 'learning' || !activeModule) return;
    const readSteps = visibleModuleSteps.filter((step) => step.status === 'completed' && isReadTrackedStep(step));
    if (!readSteps.length) return;

    const runtime = readTrackingRuntimeRef.current;
    const now = Date.now();

    for (const step of readSteps) {
      const key = stepProgressKey(activeModule.id, step.id);
      const track = getStepProgress(activeModule.id, step.id);
      if (!runtime[key]) {
        runtime[key] = {
          maxRatio: Math.max(0, Math.min(1, Number(track.readScrollMaxRatio || 0))),
          dwellMs: Math.max(0, Number(track.readDwellMs || 0)),
          lastTick: now,
          startedAt: String(track.readStartedAt || new Date(now).toISOString()),
          completed: !!track.readCompleted,
          persistedRatio: Math.max(0, Math.min(1, Number(track.readScrollMaxRatio || 0))),
          persistedDwellMs: Math.max(0, Number(track.readDwellMs || 0)),
        };
      }
    }

    const tick = () => {
      const ts = Date.now();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;

      for (const step of readSteps) {
        const el = document.getElementById(`step-${step.id}`);
        if (!el) continue;
        const entryKey = stepProgressKey(activeModule.id, step.id);
        const entry = runtime[entryKey];
        if (!entry) continue;

        const rect = el.getBoundingClientRect();
        const inView = rect.bottom > 0 && rect.top < viewportHeight;
        const ratio = computeReadScrollRatio(el);
        if (ratio > entry.maxRatio) {
          entry.maxRatio = ratio;
        }

        const elapsed = Math.max(0, ts - entry.lastTick);
        if (inView) {
          entry.dwellMs += elapsed;
        }
        entry.lastTick = ts;

        if (entry.completed) continue;

        const shouldComplete = entry.maxRatio >= READ_SCROLL_COMPLETE_RATIO && entry.dwellMs >= READ_DWELL_COMPLETE_MS;
        if (shouldComplete) {
          entry.completed = true;
          entry.persistedDwellMs = entry.dwellMs;
          entry.persistedRatio = entry.maxRatio;
          upsertStepProgress(activeModule.id, step.id, (prev) => ({
            ...prev,
            readStartedAt: prev.readStartedAt || entry.startedAt,
            readDwellMs: entry.dwellMs,
            readScrollMaxRatio: entry.maxRatio,
            readCompleted: true,
          }));
          continue;
        }

        const shouldPersistPartial =
          (entry.dwellMs - entry.persistedDwellMs) >= 1200
          || (entry.maxRatio - entry.persistedRatio) >= 0.15;
        if (!shouldPersistPartial) continue;

        entry.persistedDwellMs = entry.dwellMs;
        entry.persistedRatio = entry.maxRatio;
        upsertStepProgress(activeModule.id, step.id, (prev) => ({
          ...prev,
          readStartedAt: prev.readStartedAt || entry.startedAt,
          readDwellMs: entry.dwellMs,
          readScrollMaxRatio: entry.maxRatio,
          readCompleted: false,
        }));
      }
    };

    const onScrollOrResize = () => tick();
    const timer = window.setInterval(tick, 300);
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    tick();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [state, activeModule?.id, visibleModuleSteps]);

  if (showStarter) {
    return (
      <StarterPage
        openStarterFaq={openStarterFaq}
        setOpenStarterFaq={setOpenStarterFaq}
        onStart={() => {
          setShowStarter(false);
          if (!authUser?.id) {
            setAuthMode('signin');
            setAuthEmail('');
            setAuthPassword('');
            setAuthError(null);
            setAuthModalOpen(true);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-500/30">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md shadow-sm">
        <div className="w-full px-4 md:px-8 h-20 flex items-center justify-between">
	          <div className="flex items-center gap-3 min-w-0">
	            <button
	              type="button"
	              onClick={() => {
	                if (state === 'learning') {
	                  navigateHome();
	                } else {
	                  setActiveHomeTab('learn');
	                  setActiveCommunityPost(null);
	                }
	              }}
	              className="w-16 h-16 overflow-hidden shrink-0"
	              aria-label={t('home', locale)}
	              title={t('home', locale)}
	            >
              <MascotImage mood="idle" alt="SEA-Geko" className="w-full h-full object-contain" />
            </button>
            {state === 'learning' && course ? (
              <span className="hidden md:inline text-sm text-slate-600 truncate max-w-[520px]">{course.title}</span>
            ) : null}
          </div>

			          <div className="flex items-center gap-3">
			            <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 border border-slate-200 bg-white rounded-full">
			              <label htmlFor="locale-select" className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">{t('lang', locale)}</label>
			              <LocaleMenuSelect
		                id="locale-select"
		                value={locale}
		                onChange={(nextLocale) => setLocaleState(nextLocale)}
		                ariaLabel={t('onboardingQuestionLanguage', locale)}
		                className="min-w-[190px]"
		                buttonClassName="border-0 bg-transparent shadow-none px-0 py-0 text-xs"
			                listClassName="w-[230px] right-0 left-auto"
			              />
			            </div>
                  <button
                    type="button"
                    onClick={() => setShowStarter(true)}
                    className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center"
                    title="Back to starter page"
                    aria-label="Back to starter page"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
		            {state === 'learning' ? (
		              <button
		                type="button"
		                onClick={navigateHome}
	                className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
	              >
	                <Home className="w-4 h-4" />
	                {t('home', locale)}
	              </button>
	            ) : null}
		              {!authUser ? (
		                <button
		                  type="button"
		                  onClick={() => {
	                    setAuthMode('signin');
                    setAuthEmail('');
                    setAuthPassword('');
	                    setAuthError(null);
	                    setAuthModalOpen(true);
		                  }}
		                  className="inline-flex items-center gap-2 text-base font-bold px-6 py-3 rounded-2xl border-2 border-slate-200 bg-white text-slate-800 hover:bg-slate-50 shadow-sm transition-colors"
			                >
                      <Lock className="w-4 h-4" />
			                  {t('login', locale)}
			                </button>
			              ) : null}
	          </div>
        </div>
      </header>

      <input
        ref={cvInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.md,.markdown,.rtf"
        onChange={(e) => {
          handleCvFileSelected(e.target.files);
          e.currentTarget.value = '';
        }}
      />

      <AnimatePresence>
        {onboardingOpen && !!authUser?.id && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-slate-900/40 backdrop-blur-sm p-4 flex items-center justify-center"
          >
            <div className="w-full max-w-xl bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-slate-900">{t('onboardingTitle', locale)}</h3>
                <span className="text-xs font-semibold text-slate-500">
                  {onboardingStep + 1} / {ONBOARDING_TOTAL_STEPS}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${((onboardingStep + 1) / ONBOARDING_TOTAL_STEPS) * 100}%` }} />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {onboardingStep === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionSegment', locale)}</p>
                    <select
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                      value={profileDraft.userSegment}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, userSegment: e.target.value as UserProfile['userSegment'] }))}
                      aria-label={t('onboardingQuestionSegment', locale)}
                    >
                      <option value="youth">{t('segmentYouth', locale)}</option>
                      <option value="educator">{t('segmentEducator', locale)}</option>
                      <option value="displaced">{t('segmentDisplaced', locale)}</option>
                      <option value="community_org">{t('segmentCommunityOrg', locale)}</option>
                    </select>
                  </div>
                )}

                {onboardingStep === 1 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionConnectivity', locale)}</p>
                    <select
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                      value={profileDraft.connectivityLevel}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, connectivityLevel: e.target.value as UserProfile['connectivityLevel'] }))}
                      aria-label={t('onboardingQuestionConnectivity', locale)}
                    >
                      <option value="normal">{t('connectivityNormal', locale)}</option>
                      <option value="low_bandwidth">{t('connectivityLowBandwidth', locale)}</option>
                      <option value="offline_first">{t('connectivityOfflineFirst', locale)}</option>
                    </select>
                  </div>
                )}

	                {onboardingStep === 2 && (
	                  <div className="space-y-3">
	                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionLanguage', locale)}</p>
	                    <LocaleMenuSelect
	                      id="onboarding-locale-select"
	                      value={locale}
	                      onChange={(nextLocale) => setLocaleState(nextLocale)}
	                      ariaLabel={t('onboardingQuestionLanguage', locale)}
	                      className="w-full"
	                      buttonClassName="justify-between"
	                    />
	                  </div>
	                )}

                {onboardingStep === 3 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionDevice', locale)}</p>
                    <select
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                      value={profileDraft.deviceClass}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, deviceClass: e.target.value as UserProfile['deviceClass'] }))}
                      aria-label={t('onboardingQuestionDevice', locale)}
                    >
                      <option value="mobile">{t('deviceMobile', locale)}</option>
                      <option value="desktop">{t('deviceDesktop', locale)}</option>
                      <option value="tablet">{t('deviceTablet', locale)}</option>
                      <option value="unknown">{t('deviceUnknown', locale)}</option>
                    </select>
                  </div>
                )}

                {onboardingStep === 4 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionDiscovery', locale)}</p>
                    <div role="radiogroup" aria-label={t('onboardingQuestionDiscovery', locale)} className="space-y-1">
                      {DISCOVERY_OPTIONS.map((option) => {
                        const checked = discoverySourceChoice === option.value;
                        return (
                          <label
                            key={`discovery-${option.value}`}
                            className={cn(
                              "flex items-center gap-3 rounded-xl px-2 py-2 cursor-pointer transition-colors",
                              checked ? "bg-white border border-slate-200" : "hover:bg-slate-100/80 border border-transparent"
                            )}
                          >
                            <input
                              type="radio"
                              name="onboarding-discovery-source"
                              checked={checked}
                              onChange={() => setProfileDraft((prev) => ({ ...prev, discoverySource: option.value }))}
                              className="sr-only"
                            />
                            <span className={cn(
                              "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                              checked ? "border-slate-500 bg-white" : "border-slate-300 bg-transparent"
                            )}>
                              {checked ? <span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> : null}
                            </span>
                            <span className="text-base text-slate-900">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {onboardingStep === 5 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionGoal', locale)}</p>
                    <input
                      value={profileDraft.learningGoal}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, learningGoal: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                      placeholder={t('onboardingQuestionGoal', locale)}
                      aria-label={t('onboardingQuestionGoal', locale)}
                    />
                  </div>
                )}

                {onboardingStep === 6 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">{t('onboardingQuestionRegion', locale)}</p>
                    <input
                      value={profileDraft.region}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, region: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                      placeholder={t('onboardingQuestionRegion', locale)}
                      aria-label={t('onboardingQuestionRegion', locale)}
                    />
                  </div>
                )}

                {onboardingStep === 7 && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-4">
                      <p className="text-sm font-semibold text-emerald-800">Upload your CV</p>
                      <p className="text-xs text-emerald-700 mt-1">
                        Accepted: PDF, DOC/DOCX, TXT, MD, RTF (max 8 MB). Files with little or no readable text are rejected.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => cvInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                        >
	                          <Upload className="w-3.5 h-3.5" />
	                          {cvAnalyzeBusy ? 'Analyzing CV with AI...' : 'Upload & Analyze CV'}
	                        </button>
                        {cvUploadMeta ? (
                          <span className="text-xs text-slate-600 break-all">
                            {cvUploadMeta.name} ({Math.max(1, Math.round(cvUploadMeta.size / 1024))} KB)
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {cvAnalysis?.valid ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        <p className="font-semibold">CV analyzed successfully.</p>
                      </div>
                    ) : null}

                    {cvAnalysisError ? (
                      <p className="text-xs text-red-600">{cvAnalysisError}</p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">{t('account', locale)}: {authUser?.email || authUser?.id || accountId}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOnboardingStep((prev) => Math.max(0, prev - 1))}
                    disabled={onboardingStep === 0}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold disabled:opacity-40"
                  >
                    {t('onboardingBack', locale)}
                  </button>
                  {onboardingStep < ONBOARDING_LAST_STEP ? (
                    <button
                      type="button"
                      onClick={handleOnboardingNext}
                      disabled={cvAnalyzeBusy}
                      className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {t('onboardingNext', locale)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={cvAnalyzeBusy}
                      className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {t('onboardingSave', locale)}
                    </button>
                  )}
                </div>
              </div>
              {globalError ? (
                <p className="text-xs text-red-600">{globalError}</p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {authModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[125] bg-slate-900/45 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAuthModalOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-slate-900">
                  {authMode === 'signin' ? 'Login' : 'Create account'}
                </h3>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="h-9 w-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {authEnabled
                  ? 'Use Supabase auth to sync your data across devices.'
                  : 'Supabase auth is not enabled. Add Supabase keys in .env first.'}
              </p>

              <div className="mt-4 space-y-3">
                <input
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white"
                />
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Password"
                  type="password"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAuthSubmit();
                    }
                  }}
                />
              </div>

              {authError ? (
                <p className="mt-3 text-sm text-red-600">{authError}</p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
                    setAuthError(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-4"
                >
                  {authMode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
                </button>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleAuthSubmit()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {authBusy ? 'Please wait...' : authMode === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shareModalPost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[128] bg-slate-900/55 backdrop-blur-sm p-4 flex items-end md:items-center justify-center"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShareModalPost(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              className="w-full max-w-xl rounded-3xl border border-slate-200 bg-[#0b1220] text-white p-5 md:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-300">Share course</p>
                  <h3 className="mt-1 text-xl font-bold text-white line-clamp-2">{shareModalPost.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShareModalPost(null)}
                  className="h-9 w-9 rounded-xl border border-slate-600 text-slate-300 hover:bg-white/10 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300 break-all">
                {buildCourseShareUrl(shareModalPost.courseId)}
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button type="button" onClick={() => void handleCopyShareLink()} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">
                  {shareCopied ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" onClick={() => handleShareViaPlatform('facebook')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">Facebook</button>
                <button type="button" onClick={() => handleShareViaPlatform('messenger')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">Messenger</button>
                <button type="button" onClick={() => handleShareViaPlatform('telegram')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">Telegram</button>
                <button type="button" onClick={() => handleShareViaPlatform('whatsapp')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">WhatsApp</button>
                <button type="button" onClick={() => handleShareViaPlatform('x')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">X</button>
                <button type="button" onClick={() => handleShareViaPlatform('linkedin')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">LinkedIn</button>
                <button type="button" onClick={() => handleShareViaPlatform('reddit')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">Reddit</button>
                <button type="button" onClick={() => handleShareViaPlatform('email')} className="rounded-xl border border-slate-600 bg-white/5 py-3 text-xs font-semibold hover:bg-white/10">Email</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(creatorProfileBusy || !!creatorProfile || !!creatorProfileError) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[131] bg-slate-900/55 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeCreatorProfile();
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              className="w-full max-w-5xl max-h-[92vh] overflow-auto rounded-3xl border border-slate-200 bg-white"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
                <p className="text-sm font-bold text-slate-900">Creator profile</p>
                <button
                  type="button"
                  onClick={closeCreatorProfile}
                  className="h-9 w-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                  aria-label={t('close', locale)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {creatorProfileBusy ? (
                <div className="px-6 py-14 flex items-center justify-center gap-3 text-slate-600">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  <span className="text-sm font-semibold">Loading creator profile...</span>
                </div>
              ) : null}

              {!creatorProfileBusy && creatorProfileError ? (
                <div className="px-6 py-8">
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-700">{creatorProfileError}</p>
                  </div>
                </div>
              ) : null}

              {!creatorProfileBusy && !creatorProfileError && creatorProfile ? (
                <div className="space-y-5 p-5 md:p-6">
                  <section className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="h-36 bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500" />
                    <div className="px-5 pb-5">
                      <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
	                        <div className="flex items-end gap-4 min-w-0">
                            <img
                              src={creatorProfile.profileImageDataUrl || DEFAULT_PUBLIC_PROFILE_IMAGE}
                              alt={creatorProfile.displayName || 'Creator'}
                              className="h-24 w-24 rounded-full border-4 border-white bg-white object-cover shadow-sm"
                              onError={(e) => {
                                if (e.currentTarget.src.endsWith(DEFAULT_PUBLIC_PROFILE_IMAGE)) return;
                                e.currentTarget.src = DEFAULT_PUBLIC_PROFILE_IMAGE;
                              }}
                            />
	                          <div className="min-w-0 pb-1">
                            <p className="text-2xl font-bold text-slate-900 truncate">{creatorProfile.displayName || creatorProfile.id}</p>
                            {creatorProfile.headline ? <p className="text-sm text-slate-600 truncate mt-1">{creatorProfile.headline}</p> : null}
                            {creatorProfile.summary ? <p className="text-sm text-slate-600 mt-2 line-clamp-2">{creatorProfile.summary}</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">{creatorProfile.region || 'ASEAN'}</span>
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">{creatorProfile.userSegment}</span>
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">{creatorProfile.preferredLanguage}</span>
                            </div>
                          </div>
                        </div>
                        <div className="pb-1">
                          {canFollowActiveCreator ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleCreatorFollow()}
                              disabled={creatorFollowBusy}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border disabled:opacity-60 disabled:cursor-not-allowed",
                                creatorProfile.isFollowing
                                  ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              )}
                            >
                              {creatorFollowBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                              <span>{creatorProfile.isFollowing ? 'Following' : 'Follow'}</span>
                            </button>
                          ) : (
                            <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                              {isViewingOwnCreatorProfile ? t('yourCreatorProfile', locale) : t('signInToFollowCreators', locale)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t('totalLikes', locale)}</p>
                      <p className="text-xl font-bold text-slate-900">{creatorProfile.stats.totalLikes}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t('followers', locale)}</p>
                      <p className="text-xl font-bold text-slate-900">{creatorProfile.stats.totalFollowers}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t('following', locale)}</p>
                      <p className="text-xl font-bold text-slate-900">{creatorProfile.stats.totalFollowing}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{t('publicCourses', locale)}</p>
                      <p className="text-xl font-bold text-slate-900">{creatorProfile.stats.publicCourses}</p>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-base font-bold text-slate-900">{t('professionalDashboard', locale)}</h4>
                      <span className={cn(
                        "text-xs rounded-lg border px-2.5 py-1.5 font-semibold",
                        creatorProfile.professionalVisibility === 'public'
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-slate-100 border-slate-200 text-slate-600"
                      )}>
                        {creatorProfile.professionalVisibility === 'public' ? t('visibilityPublic', locale) : t('visibilityPrivate', locale)}
                      </span>
                    </div>

                    {creatorProfile.dashboard ? (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-900">{creatorProfile.dashboard.fullName || creatorProfile.displayName}</p>
                          {creatorProfile.dashboard.headline ? <p className="text-xs text-slate-600 mt-1">{creatorProfile.dashboard.headline}</p> : null}
                          {creatorProfile.dashboard.summary ? <p className="text-sm text-slate-600 mt-2">{creatorProfile.dashboard.summary}</p> : null}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-widest font-semibold text-slate-500">{t('coreSkills', locale)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {creatorProfile.dashboard.skills.length ? creatorProfile.dashboard.skills.slice(0, 18).map((skill, idx) => (
                              <span key={`creator-skill-${idx}`} className="text-xs rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-700">{skill}</span>
                            )) : <span className="text-xs text-slate-400">{t('noSkillsListed', locale)}</span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                        {creatorProfile.professionalVisibility === 'private'
                          ? t('creatorDashboardPrivate', locale)
                          : t('creatorDashboardEmpty', locale)}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h4 className="text-base font-bold text-slate-900">{t('createdPublicCourses', locale)}</h4>
                    {creatorProfile.courses.length ? (
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {creatorProfile.courses.map((post) => (
                          <article key={`creator-course-${post.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                            <p className="text-sm font-semibold text-slate-900 line-clamp-2">{post.title}</p>
                            <p className="text-xs text-slate-600 line-clamp-2">{post.description || post.courseId}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                              <span className="rounded-lg border border-slate-200 bg-white px-2 py-1">{t('likes', locale)} {post.reactions || 0}</span>
                              <span className="rounded-lg border border-slate-200 bg-white px-2 py-1">{t('comments', locale)} {post.comments || 0}</span>
                              <span className="rounded-lg border border-slate-200 bg-white px-2 py-1">{t('downloadedCourses', locale)} {post.saves || 0}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  closeCreatorProfile();
                                  void handleLearnNowFromPost(post);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-xs font-semibold hover:bg-emerald-100"
                              >
                                <BookOpen className="w-3.5 h-3.5" />
                                <span>Open course</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSharePost(post)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                <span>Share</span>
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No public courses published yet.</p>
                    )}
                  </section>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpeningCourse && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[129] bg-slate-900/35 backdrop-blur-sm p-4 flex items-center justify-center"
          >
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-2xl flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Opening shared course...</p>
                <p className="text-xs text-slate-500">Please wait while we load the course snapshot.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {globalError && state === 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-white/80 border border-red-500/20 backdrop-blur-xl p-8 rounded-[40px] flex flex-col items-center gap-6 shadow-2xl shadow-red-500/10 text-center">
              <div className="bg-red-50 p-4 rounded-[24px]">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-slate-900">Generation Failed</p>
                <p className="text-sm text-slate-500 leading-relaxed">{globalError}</p>
              </div>
              
              <div className="flex flex-col gap-3 w-full">
                <button 
                  onClick={handleUseSample}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-2xl text-sm font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  <BookOpen className="w-4 h-4" />
                  Try Sample Course Instead
                </button>
                <button 
                  onClick={() => setGlobalError(null)}
                  className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl text-sm font-bold transition-all"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mascotToast && (
          <motion.div
            key={mascotToast.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          >
            <button
              type="button"
              onClick={() => setMascotToast(null)}
              aria-label="Dismiss message overlay"
              className="absolute inset-0 bg-slate-900/25 backdrop-blur-[1px]"
            />
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              className="relative w-full max-w-4xl rounded-[32px] border border-emerald-100 bg-white p-7 md:p-9 shadow-2xl shadow-emerald-500/20"
            >
              <button
                type="button"
                onClick={() => setMascotToast(null)}
                className="absolute top-4 right-4 md:top-5 md:right-5 h-11 w-11 rounded-xl border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 transition-colors flex items-center justify-center"
                aria-label="Dismiss message"
                title="Close"
              >
                <X className="w-6 h-6" />
              </button>
              <div className="flex items-center gap-4">
                <MascotImage
                  mood={mascotToast.mood}
                  alt="SEA-Geko feedback"
                  className="w-28 h-28 md:w-36 md:h-36 rounded-2xl object-contain shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight">{mascotToast.title}</p>
                  <p className="text-lg md:text-xl text-slate-500 mt-2 leading-relaxed">{mascotToast.subtitle}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeEditingStep && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[131] p-3 md:p-6 flex items-center justify-center"
          >
            <button
              type="button"
              onClick={() => setEditingStepId(null)}
              aria-label="Close AI assistant"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto"
            >
              <ContentEditor
                modal
                content={activeEditingStep.content}
                onUpdate={(newContent) => handleUpdateStepContent(activeEditingStep.moduleId, activeEditingStep.stepId, newContent)}
                onRefineSuccess={() => showMascotToast('Good job!', 'Your content update was saved.', 'happy')}
                onRefineError={(message) => showMascotToast('Update failed', message, 'sad')}
                onClose={() => setEditingStepId(null)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state === 'outline_review' && outlineEditSummary && isOutlineSummaryModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[132] bg-slate-900/45 backdrop-blur-sm p-3 md:p-6 flex items-center justify-center"
          >
            <button
              type="button"
              onClick={handleAcceptOutlineSummary}
              aria-label="Close outline recraft summary"
              className="absolute inset-0"
            />
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="relative w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            >
              <button
                type="button"
                onClick={handleAcceptOutlineSummary}
                className="absolute top-4 right-4 z-10 h-10 w-10 rounded-lg border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 flex items-center justify-center"
                aria-label="Close outline recraft summary"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 font-bold">{t('outlineRecraftResult', locale)}</p>
                  <p className="text-base md:text-lg font-semibold text-slate-900 mt-1">
                    {outlineEditSummary.changed} changed, {outlineEditSummary.unchanged} unchanged
                    {outlineEditSummary.failedModules.length ? `, ${outlineEditSummary.failedModules.length} failed` : ''}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500 shrink-0">
                  {new Date(outlineEditSummary.at).toLocaleTimeString()}
                </span>
              </div>

              <div className="px-4 md:px-6 py-4 max-h-[55vh] overflow-auto space-y-3">
                {outlineEditSummary.changes.map((change) => (
                  <button
                    key={`outline-modal-change-${change.targetKey}-${change.label}`}
                    type="button"
                    onClick={() => {
                      setOutlineFocusTargetKey(change.targetKey);
                      if (typeof change.lessonNumber === 'number') {
                        setOutlineReviewLessonByModule((prev) => ({ ...prev, [change.moduleId]: change.lessonNumber as number }));
                      }
                    }}
                    className={cn(
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors",
                      change.changed
                        ? "border-emerald-200 hover:bg-emerald-50/60"
                        : "border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">{change.label}</p>
                      <span className={cn(
                        "text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border",
                        change.changed
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      )}>
                        {change.changed ? t('updatedLabel', locale) : t('noChangeLabel', locale)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 break-words">
                      {t('instructionLabel', locale)}: {change.instruction}
                    </p>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{t('beforeLabel', locale)}</p>
                        <p className="text-xs text-slate-700 mt-1 line-clamp-3 break-words">{change.before || t('naLabel', locale)}</p>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-600">{t('afterLabel', locale)}</p>
                        <p className="text-xs text-emerald-900 mt-1 line-clamp-3 break-words">{change.after || t('naLabel', locale)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="px-4 md:px-6 py-4 border-t border-slate-100 bg-white flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRefineOutlineSummary}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  {t('refineAgain', locale)}
                </button>
                <button
                  type="button"
                  onClick={handleAcceptOutlineSummary}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 transition-colors"
                >
                  {t('acceptChanges', locale)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={cn(
        "relative z-10 pt-28 md:pt-32 pb-8 md:pb-12",
        state === 'idle'
          ? "w-full px-0 max-w-none"
          : cn("mx-auto px-4 md:px-6", state === 'learning' ? "max-w-[1700px]" : "max-w-7xl")
      )}>
        {state === 'idle' ? (
          <div className="relative min-h-[calc(100vh-5rem)] lg:pl-[280px]">
            <aside className="lg:fixed lg:left-0 lg:top-20 lg:bottom-0 lg:w-[280px] lg:overflow-y-auto border-r border-emerald-900/40 bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-800 p-3 min-h-[calc(100vh-5rem)]">
              <div className="space-y-2">
                {[
                  { key: 'learn' as const, icon: Home, label: t('navLearn', locale) },
                  { key: 'community' as const, icon: Users, label: t('navCommunity', locale) },
                  { key: 'leaderboard' as const, icon: Trophy, label: t('navLeaderboard', locale) },
                  { key: 'profile' as const, icon: UserCircle2, label: t('navProfile', locale) },
                  { key: 'downloads' as const, icon: Download, label: t('navDownloads', locale) },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = activeHomeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveHomeTab(item.key)}
                      className={cn(
                        "w-full rounded-2xl px-4 py-3 flex items-center gap-3 border transition-colors",
                        active
                          ? "bg-emerald-400/15 border-emerald-300 text-emerald-50"
                          : "bg-white/0 border-transparent text-emerald-50/90 hover:bg-white/10 hover:border-emerald-600/60"
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-bold tracking-wide">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-w-0 w-full px-3 md:px-6 lg:px-8">
              <div className="mx-auto w-full max-w-[1500px]">
              <AnimatePresence mode="wait">
                {activeHomeTab === 'profile' && (
	                  <motion.div
	                    key="profile-tab"
	                    initial={{ opacity: 0, y: 16 }}
	                    animate={{ opacity: 1, y: 0 }}
	                    exit={{ opacity: 0, y: -16 }}
	                    className="space-y-4"
	                  >
                    {activeAnalyticsCourseId ? (
                      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveAnalyticsCourseId('');
                              setCourseAnalyticsError(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            <ArrowLeft className="w-4 h-4" />
                            Back to profile
                          </button>
                          <button
                            type="button"
                            onClick={() => activeAnalyticsCourseId && void loadCourseAnalytics(activeAnalyticsCourseId, { force: true })}
                            disabled={courseAnalyticsBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            {courseAnalyticsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Refresh analytics
                          </button>
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-slate-900">Analytics studio</h2>
                          <p className="text-sm text-slate-600 mt-1">
                            {activeCourseAnalytics?.title || activeAnalyticsCourse?.title || activeAnalyticsCourseId}
                          </p>
                        </div>
                        {courseAnalyticsError ? (
                          <p className="text-sm text-red-600">{courseAnalyticsError}</p>
                        ) : null}
                        {courseAnalyticsBusy && !activeCourseAnalytics ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading analytics...
                          </div>
                        ) : activeCourseAnalytics ? (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Upvotes</p>
                                <p className="text-lg font-bold text-slate-900">{activeCourseAnalytics.upvotes}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Downvotes</p>
                                <p className="text-lg font-bold text-slate-900">{activeCourseAnalytics.downvotes}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Downloads</p>
                                <p className="text-lg font-bold text-slate-900">{activeCourseAnalytics.downloads}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Comments</p>
                                <p className="text-lg font-bold text-slate-900">{activeCourseAnalytics.comments}</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">Avg completion</p>
                                <p className="text-lg font-bold text-slate-900">{activeCourseAnalytics.averageCompletionRate.toFixed(1)}%</p>
                              </div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <p className="text-sm font-semibold text-slate-800 mb-2">Completion trend</p>
                              <div className="w-full overflow-x-auto">
                                <svg
                                  viewBox={`0 0 ${analyticsTrendChart.width} ${analyticsTrendChart.height}`}
                                  className="w-full min-w-[640px] h-[220px]"
                                  role="img"
                                  aria-label="Average completion rate trend chart"
                                >
                                  {analyticsTrendChart.yTicks.map((tick) => (
                                    <g key={`y-${tick.label}`}>
                                      <line
                                        x1={28}
                                        y1={tick.y}
                                        x2={analyticsTrendChart.width - 28}
                                        y2={tick.y}
                                        stroke="#e2e8f0"
                                        strokeWidth="1"
                                      />
                                      <text x={6} y={tick.y + 4} fontSize="10" fill="#64748b">{tick.label}</text>
                                    </g>
                                  ))}
                                  {analyticsTrendChart.xTicks.map((tick) => (
                                    <text
                                      key={`x-${tick.label}-${tick.x}`}
                                      x={tick.x}
                                      y={analyticsTrendChart.height - 4}
                                      textAnchor="middle"
                                      fontSize="10"
                                      fill="#64748b"
                                    >
                                      {tick.label}
                                    </text>
                                  ))}
                                  {analyticsTrendChart.polyline ? (
                                    <>
                                      <polyline
                                        fill="none"
                                        stroke="#10b981"
                                        strokeWidth="2.5"
                                        points={analyticsTrendChart.polyline}
                                      />
                                      {analyticsTrendChart.dots.map((dot) => (
                                        <g key={`dot-${dot.date}-${dot.x}`}>
                                          <circle cx={dot.x} cy={dot.y} r="3.5" fill="#10b981" />
                                          <title>{`${formatTrendDateLabel(dot.date)}: ${dot.value.toFixed(1)}%`}</title>
                                        </g>
                                      ))}
                                    </>
                                  ) : null}
                                </svg>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Learners started: {activeCourseAnalytics.learners} | Learners completed: {activeCourseAnalytics.completedLearners}
                              </p>
                            </div>
                          </>
                        ) : null}
                      </section>
                    ) : (
                    <>
		                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
		                      <h2 className="text-xl font-bold text-slate-900">{t('profileStats', locale)}</h2>
	                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">{t('skillGain', locale)}</p>
                          <p className="text-lg font-bold text-slate-900">{impactMetrics.skillGainPp.toFixed(1)} pp</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">{t('confidenceGain', locale)}</p>
                          <p className="text-lg font-bold text-slate-900">{impactMetrics.confidenceGain.toFixed(1)}</p>
                        </div>
	                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
	                          <p className="text-xs text-slate-500">{t('completionRate', locale)}</p>
	                          <p className="text-lg font-bold text-slate-900">
	                            {(Number(impactMetrics.completionRate || 0) > 1
	                              ? Math.round(Number(impactMetrics.completionRate || 0))
	                              : Math.round(Number(impactMetrics.completionRate || 0) * 100))}%
	                          </p>
	                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">{t('downloadedCourses', locale)}</p>
                          <p className="text-lg font-bold text-slate-900">{downloadStates.length}</p>
	                        </div>
	                      </div>
	                    </section>

	                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-lg font-bold text-slate-900">Profile settings</h3>
                        <button
                          type="button"
	                          onClick={handleSaveProfileEdits}
	                          disabled={profileSaveBusy}
	                          className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
	                        >
                          {profileSaveBusy ? 'Saving...' : 'Save profile'}
                        </button>
                      </div>
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                        {cvProfile?.profileImageDataUrl ? (
                          <img
                            src={cvProfile.profileImageDataUrl}
                            alt={cvProfile.fullName || 'Profile photo'}
                            className="h-14 w-14 rounded-full border border-slate-200 bg-white object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-14 w-14 rounded-full border border-slate-200 bg-white text-slate-400 flex items-center justify-center shrink-0">
                            <UserCircle2 className="w-7 h-7" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">Profile photo from CV</p>
                          <p className="text-xs text-slate-500">
                            {cvProfile?.profileImageDataUrl
                              ? 'Using the detected candidate photo from your latest CV upload.'
                              : 'Upload a CV with a clear portrait photo to auto-fill this image.'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="text-xs text-slate-600">
                          <span className="font-semibold">Learning goal</span>
	                          <input
	                            value={profileDraft.learningGoal}
	                            onChange={(e) => setProfileDraft((prev) => ({ ...prev, learningGoal: e.target.value }))}
	                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
	                            placeholder="e.g. Start a QA career with practical projects"
	                          />
	                        </label>
	                        <label className="text-xs text-slate-600">
	                          <span className="font-semibold">Region</span>
	                          <input
	                            value={profileDraft.region}
	                            onChange={(e) => setProfileDraft((prev) => ({ ...prev, region: e.target.value }))}
	                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
	                            placeholder="e.g. ASEAN"
	                          />
	                        </label>
	                        <label className="text-xs text-slate-600">
	                          <span className="font-semibold">User segment</span>
	                          <select
	                            value={profileDraft.userSegment}
	                            onChange={(e) => setProfileDraft((prev) => ({ ...prev, userSegment: e.target.value as UserProfile['userSegment'] }))}
	                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
	                          >
	                            <option value="youth">{t('segmentYouth', locale)}</option>
	                            <option value="educator">{t('segmentEducator', locale)}</option>
	                            <option value="displaced">{t('segmentDisplaced', locale)}</option>
	                            <option value="community_org">{t('segmentCommunityOrg', locale)}</option>
	                          </select>
	                        </label>
	                        <label className="text-xs text-slate-600">
                          <span className="font-semibold">{t('connectivityLabel', locale)}</span>
	                          <select
	                            value={profileDraft.connectivityLevel}
	                            onChange={(e) => setProfileDraft((prev) => ({ ...prev, connectivityLevel: e.target.value as UserProfile['connectivityLevel'] }))}
	                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
	                          >
	                            <option value="normal">{t('connectivityNormal', locale)}</option>
	                            <option value="low_bandwidth">{t('connectivityLowBandwidth', locale)}</option>
	                            <option value="offline_first">{t('connectivityOfflineFirst', locale)}</option>
	                          </select>
	                        </label>
	                        <label className="text-xs text-slate-600 md:col-span-2">
                          <span className="font-semibold">{t('careerInterestsLabel', locale)}</span>
                          <input
                            value={careerInterestsInput}
                            onChange={(e) => setCareerInterestsInput(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            placeholder={t('careerInterestsPlaceholder', locale)}
                          />
                        </label>
                        <label className="text-xs text-slate-600 md:col-span-2">
                          <span className="font-semibold">{t('professionalDashboardVisibility', locale)}</span>
                          <select
                            value={profileDraft.professionalVisibility || 'private'}
                            onChange={(e) => setProfileDraft((prev) => ({
                              ...prev,
                              professionalVisibility: e.target.value === 'public' ? 'public' : 'private',
                            }))}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="private">{t('visibilityPrivateOnlyMe', locale)}</option>
                            <option value="public">{t('visibilityPublicCreatorProfile', locale)}</option>
                          </select>
                        </label>
                      </div>
			                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
			                        <div>
			                          <p className="text-sm font-semibold text-slate-900">{t('lowBandwidth', locale)}</p>
			                          <p className="text-xs text-slate-500">{t('lowBandwidthHint', locale)}</p>
			                        </div>
		                        <button
		                          type="button"
		                          onClick={() => setLowBandwidthMode((v) => !v)}
		                          aria-pressed={lowBandwidthMode}
		                          className={cn(
		                            "relative h-14 w-40 rounded-full border-2 transition-all",
		                            lowBandwidthMode
		                              ? "bg-gradient-to-r from-emerald-700 to-emerald-500 border-emerald-300 shadow-lg shadow-emerald-500/20"
		                              : "bg-slate-100 border-slate-200"
		                          )}
		                        >
		                          <span className={cn(
		                            "absolute top-1 h-11 w-11 rounded-full border flex items-center justify-center transition-all",
		                            lowBandwidthMode
		                              ? "left-[6.4rem] bg-white border-emerald-200 text-emerald-700"
		                              : "left-1 bg-white border-slate-200 text-slate-500"
		                          )}>
		                            <Power className="w-5 h-5" />
		                          </span>
		                          <span className={cn(
		                            "absolute inset-0 flex items-center text-sm font-bold px-4",
		                            lowBandwidthMode ? "justify-start text-white" : "justify-end text-slate-600"
		                          )}>
		                            {lowBandwidthMode ? 'Enabled' : 'Disabled'}
		                          </span>
		                        </button>
		                      </div>
	                      {profileNotice ? <p className="mt-3 text-xs text-emerald-700">{profileNotice}</p> : null}
	                    </section>

			                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
			                      <div className="flex flex-wrap items-center justify-between gap-2">
		                        <h3 className="text-lg font-bold text-slate-900">{t('professionalDashboard', locale)}</h3>
		                        <div className="flex items-center gap-2">
	                          <span className={cn(
	                            "text-xs rounded-lg border px-2.5 py-1.5 font-semibold",
	                            cvIsValidated
	                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
	                              : "bg-amber-50 border-amber-200 text-amber-700"
	                          )}>
	                            {cvIsValidated ? t('cvVerifiedEuropass', locale) : t('cvRequired', locale)}
	                          </span>
		                          <button
		                            type="button"
		                            onClick={() => cvInputRef.current?.click()}
		                            disabled={cvAnalyzeBusy}
		                            className="text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-1.5"
		                          >
		                            {cvAnalyzeBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
		                            {cvAnalyzeBusy ? 'Processing...' : 'Resubmit CV'}
		                          </button>
		                        </div>
		                      </div>
		                      <AnimatePresence mode="wait">
		                        {cvStatusMeta ? (
		                          <motion.div
		                            key={`${cvResubmitStatus}:${cvStatusMeta.label}:${cvStatusMeta.detail}`}
		                            initial={{ opacity: 0, y: -6 }}
		                            animate={{ opacity: 1, y: 0 }}
		                            exit={{ opacity: 0, y: -6 }}
		                            className={cn("mt-3 rounded-xl border p-3 text-xs", cvStatusMeta.tone)}
		                          >
		                            <div className="flex items-start gap-2">
		                              {cvStatusMeta.icon === 'processing' ? (
		                                <Loader2 className="w-4 h-4 mt-0.5 animate-spin" />
		                              ) : cvStatusMeta.icon === 'success' ? (
		                                <CheckCircle2 className="w-4 h-4 mt-0.5" />
		                              ) : (
		                                <AlertCircle className="w-4 h-4 mt-0.5" />
		                              )}
		                              <div className="min-w-0">
		                                <p className="font-semibold">{cvStatusMeta.label}</p>
		                                <p className="mt-0.5 opacity-90 break-words">{cvStatusMeta.detail}</p>
		                              </div>
		                            </div>
		                            <div className="mt-2 h-1.5 rounded-full bg-white/60 overflow-hidden">
		                              {cvResubmitStatus === 'processing' ? (
		                                <motion.div
		                                  className={cn("h-full w-1/3 rounded-full", cvStatusMeta.progressTone)}
		                                  animate={{ x: ['-120%', '220%'] }}
		                                  transition={{ duration: 1.1, ease: 'linear', repeat: Infinity }}
		                                />
		                              ) : (
		                                <motion.div
		                                  className={cn("h-full rounded-full", cvStatusMeta.progressTone)}
		                                  initial={{ width: '0%' }}
		                                  animate={{ width: '100%' }}
		                                  transition={{ duration: 0.35, ease: 'easeOut' }}
		                                />
		                              )}
		                            </div>
		                          </motion.div>
		                        ) : null}
		                      </AnimatePresence>

	                      {cvIsValidated && cvProfile ? (
	                        <div className="mt-4 space-y-4">
	                          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
	                            <div className="flex items-start gap-4">
	                              {cvProfile.profileImageDataUrl ? (
	                                <img
	                                  src={cvProfile.profileImageDataUrl}
	                                  alt={cvProfile.fullName || 'CV profile image'}
	                                  className="h-20 w-20 rounded-full border border-slate-200 bg-white object-cover shadow-sm shrink-0"
	                                />
	                              ) : null}
	                              <div className="min-w-0">
	                                <p className="text-lg font-bold text-slate-900">{cvProfile.fullName || t('unnamedCandidate', locale)}</p>
	                                {cvProfile.headline ? <p className="text-sm text-slate-700 mt-1">{cvProfile.headline}</p> : null}
	                                {cvProfile.summary ? <p className="text-sm text-slate-600 mt-3 leading-relaxed">{cvProfile.summary}</p> : null}
	                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
	                                  {cvProfile.location ? <span className="rounded-lg bg-white border border-slate-200 px-2 py-1">{cvProfile.location}</span> : null}
	                                  {cvProfile.email ? <span className="rounded-lg bg-white border border-slate-200 px-2 py-1">{cvProfile.email}</span> : null}
	                                  {cvProfile.phone ? <span className="rounded-lg bg-white border border-slate-200 px-2 py-1">{cvProfile.phone}</span> : null}
	                                </div>
	                              </div>
	                            </div>
	                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                              <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">{t('coreSkills', locale)}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {cvProfile.skills.length ? cvProfile.skills.map((skill, idx) => (
                                  <span key={`cv-skill-${idx}`} className="text-xs rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-700">
                                    {skill}
                                  </span>
                                )) : <span className="text-xs text-slate-400">{t('noSkillsExtractedYet', locale)}</span>}
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                              <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">{t('languagesLabel', locale)}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {cvProfile.languages.length ? cvProfile.languages.map((lang, idx) => (
                                  <span key={`cv-lang-${idx}`} className="text-xs rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-700">
                                    {lang}
                                  </span>
                                )) : <span className="text-xs text-slate-400">{t('noLanguageEntriesDetected', locale)}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-slate-200 p-4">
                              <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">{t('experienceLabel', locale)}</p>
                              <div className="mt-3 space-y-3">
                                {cvProfile.experience.length ? cvProfile.experience.map((exp, idx) => (
                                  <div key={`cv-exp-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-sm font-semibold text-slate-900">{exp.role || t('roleLabel', locale)}</p>
                                    <p className="text-xs text-slate-600">{exp.organization || t('organizationLabel', locale)}{exp.period ? ` - ${exp.period}` : ''}</p>
                                    {exp.highlights?.length ? (
                                      <ul className="mt-2 list-disc list-inside text-xs text-slate-600 space-y-1">
                                        {exp.highlights.map((line, lineIdx) => (
                                          <li key={`cv-exp-${idx}-hl-${lineIdx}`}>{line}</li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>
                                )) : <p className="text-xs text-slate-400">{t('noExperienceEntries', locale)}</p>}
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 p-4">
                              <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">{t('educationAndCertifications', locale)}</p>
                              <div className="mt-3 space-y-3">
                                {cvProfile.education.length ? cvProfile.education.map((edu, idx) => (
                                  <div key={`cv-edu-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-sm font-semibold text-slate-900">{edu.program || t('programLabel', locale)}</p>
                                    <p className="text-xs text-slate-600">{edu.institution || t('institutionLabel', locale)}{edu.period ? ` - ${edu.period}` : ''}</p>
                                  </div>
                                )) : <p className="text-xs text-slate-400">{t('noEducationEntries', locale)}</p>}
                                {cvProfile.certifications.length ? (
                                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-xs font-semibold text-slate-600 mb-2">{t('certificationsLabel', locale)}</p>
                                    <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                                      {cvProfile.certifications.map((cert, idx) => (
                                        <li key={`cv-cert-${idx}`}>{cert}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-sm font-semibold text-amber-800">{t('uploadValidCvPrompt', locale)}</p>
                          <p className="text-xs text-amber-700 mt-1">
                            {t('completeOnboardingCvHint', locale)}
                          </p>
	                        </div>
	                      )}
	                    </section>

		                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
		                      <div className="flex items-center justify-between gap-3">
		                        <h3 className="text-lg font-bold text-slate-900">Career guidance</h3>
		                        <button
		                          type="button"
		                          onClick={() => setCareerPromptSeed((prev) => prev + 1)}
		                          disabled={!careerGuidanceEnabled}
		                          className="text-xs rounded-lg border border-slate-200 px-3 py-1.5 bg-slate-50 hover:bg-slate-100"
		                        >
		                          Refresh
		                        </button>
		                      </div>
		                      <p className="text-sm text-slate-600 mt-1">
		                        Recommendations from your CV and interests. Sources are linked for each role.
		                      </p>
		                      <div className="mt-4 space-y-3">
			                        {!authUser?.id ? (
			                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
			                            Sign in and upload a validated CV to unlock personalized career guidance.
			                          </div>
			                        ) : null}
			                        {authUser?.id && !cvIsValidated ? (
			                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
			                            Career guidance is locked until a valid CV is verified.
			                          </div>
			                        ) : null}
		                        {careerGuidanceEnabled && matchedCareerGuides.map((guide) => (
		                          <details key={guide.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
		                            <summary className="cursor-pointer text-sm font-semibold text-slate-900">{guide.title}</summary>
	                            <p className="mt-2 text-sm text-slate-700">{guide.roleSummary}</p>
	                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
	                              <div className="rounded-lg border border-slate-200 bg-white p-3">
	                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Responsibilities</p>
	                                <ul className="mt-2 list-disc list-inside text-xs text-slate-700 space-y-1">
	                                  {guide.responsibilities.map((item) => (
	                                    <li key={`${guide.id}-resp-${item}`}>{item}</li>
	                                  ))}
	                                </ul>
	                              </div>
	                              <div className="rounded-lg border border-slate-200 bg-white p-3">
	                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Requirements</p>
	                                <ul className="mt-2 list-disc list-inside text-xs text-slate-700 space-y-1">
	                                  {guide.requirements.map((item) => (
	                                    <li key={`${guide.id}-req-${item}`}>{item}</li>
	                                  ))}
	                                </ul>
	                              </div>
	                            </div>
	                            <div className="mt-3 flex flex-wrap gap-2">
	                              {guide.sources.map((source) => (
	                                <a
	                                  key={`${guide.id}-src-${source.url}`}
	                                  href={source.url}
	                                  target="_blank"
	                                  rel="noreferrer"
	                                  className="text-xs rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:text-emerald-700 hover:border-emerald-200"
	                                >
	                                  Source: {source.label}
	                                </a>
	                              ))}
		                            </div>
		                          </details>
		                        ))}
		                        {careerGuidanceEnabled && !matchedCareerGuides.length ? (
		                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
		                            Add career interests or complete CV sections to generate role guidance.
		                          </div>
		                        ) : null}
			                      </div>
			                    </section>

		                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
		                      <div className="flex items-center justify-between gap-2">
		                        <h3 className="text-lg font-bold text-slate-900">Currently Learning Courses</h3>
		                      </div>
		                      {currentlyLearningCourses.length ? (
		                        <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
		                          {currentlyLearningCourses.map((row) => {
		                            const metrics = row.metrics || DEFAULT_IMPACT;
		                            const completionRaw = Number(metrics.completionRate || 0);
		                            const completionPct = completionRaw > 1
		                              ? Math.round(completionRaw)
		                              : Math.round(completionRaw * 100);
		                            return (
		                              <article key={`learning-${row.courseId}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
		                                <div className="flex items-start justify-between gap-3">
		                                  <div className="min-w-0">
		                                    <p className="text-sm font-bold text-slate-900 line-clamp-2">{row.title || row.courseId}</p>
		                                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">{row.description || row.courseId}</p>
		                                  </div>
		                                  <span className="text-xs rounded-lg border px-2.5 py-1.5 font-semibold bg-cyan-50 border-cyan-200 text-cyan-700">
		                                    {completionPct >= 100 ? 'Completed' : 'In Progress'}
		                                  </span>
		                                </div>
		                                <div className="grid grid-cols-3 gap-2 text-xs">
		                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
		                                    <p className="text-slate-500">{t('skillGain', locale)}</p>
		                                    <p className="font-bold text-slate-900">{metrics.skillGainPp.toFixed(1)} pp</p>
		                                  </div>
		                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
		                                    <p className="text-slate-500">{t('confidenceGain', locale)}</p>
		                                    <p className="font-bold text-slate-900">{metrics.confidenceGain.toFixed(1)}</p>
		                                  </div>
		                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
		                                    <p className="text-slate-500">{t('completionRate', locale)}</p>
		                                    <p className="font-bold text-slate-900">{completionPct}%</p>
		                                  </div>
		                                </div>
		                              </article>
		                            );
		                          })}
		                        </div>
		                      ) : (
		                        <p className="text-sm text-slate-500 mt-3">No learning activity yet.</p>
		                      )}
		                    </section>

		                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
		                      <div className="flex items-center justify-between gap-2">
	                        <h3 className="text-lg font-bold text-slate-900">{t('createdCourses', locale)}</h3>
	                      </div>

                      {profileCreatedCourses.length ? (
                        <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
	                          {profileCreatedCourses.map((post) => {
	                            const isDraftOnly = String(post.id || '').startsWith('draft-');
	                            const metrics = analyticsByCourse[post.courseId] || DEFAULT_IMPACT;
	                            const completionRaw = Number(metrics.completionRate || 0);
	                            const completionPct = completionRaw > 1
	                              ? Math.round(completionRaw)
	                              : Math.round(completionRaw * 100);
	                            return (
                              <article key={post.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
	                                <div className="flex items-start justify-between gap-3">
	                                  <div className="min-w-0">
	                                    <p className="text-sm font-bold text-slate-900 line-clamp-2">{post.title}</p>
	                                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">{post.description || post.courseId}</p>
	                                  </div>
	                                  <div className="flex items-center gap-2">
	                                    {isDraftOnly ? (
	                                      <span className="text-xs rounded-lg border px-2.5 py-1.5 font-semibold bg-amber-50 border-amber-200 text-amber-700">
	                                        Draft
	                                      </span>
	                                    ) : (
	                                      <button
	                                        type="button"
	                                        onClick={() => handleToggleCourseVisibility(post)}
	                                        disabled={!!visibilityBusyByCourseId[post.courseId]}
	                                        className={cn(
	                                          "text-xs rounded-lg border px-2.5 py-1.5 font-semibold inline-flex items-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed",
	                                          post.visibility === 'public'
	                                            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
	                                            : "bg-slate-100 border-slate-200 text-slate-600"
	                                        )}
	                                      >
	                                        {visibilityBusyByCourseId[post.courseId] ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
	                                        {post.visibility === 'public' ? t('visibilityPublic', locale) : t('visibilityPrivate', locale)}
	                                      </button>
	                                    )}
	                                    {!isDraftOnly ? (
	                                      <button
	                                        type="button"
	                                        onClick={() => void handleSharePost(post)}
	                                        disabled={post.visibility !== 'public'}
	                                        className={cn(
	                                          "text-xs rounded-lg border px-2.5 py-1.5 font-semibold",
	                                          post.visibility === 'public'
	                                            ? "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
	                                            : "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
	                                        )}
	                                      >
	                                        {t('share', locale)}
	                                      </button>
	                                    ) : null}
	                                  </div>
	                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                                    <p className="text-slate-500">{t('skillGain', locale)}</p>
                                    <p className="font-bold text-slate-900">{metrics.skillGainPp.toFixed(1)} pp</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                                    <p className="text-slate-500">{t('completionRate', locale)}</p>
                                    <p className="font-bold text-slate-900">{completionPct}%</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                                    <p className="text-slate-500">{t('downloadedCourses', locale)}</p>
                                    <p className="font-bold text-slate-900">{post.saves || 0}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                                    <p className="text-slate-500">{t('comments', locale)}</p>
                                    <p className="font-bold text-slate-900">{post.comments || 0}</p>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="flex items-center gap-2 mb-2">
                                    <BarChart3 className="w-4 h-4 text-slate-500" />
                                    <p className="text-xs font-semibold text-slate-600">{t('analyticsOverview', locale)}</p>
                                  </div>
                                  <div className="grid grid-cols-4 gap-2 h-16 items-end">
                                    <div className="rounded-md bg-emerald-100">
                                      <div className="rounded-md bg-emerald-500 w-full" style={{ height: `${Math.min(100, Math.max(4, metrics.skillGainPp * 12))}%` }} />
                                    </div>
                                    <div className="rounded-md bg-cyan-100">
                                      <div className="rounded-md bg-cyan-500 w-full" style={{ height: `${Math.min(100, Math.max(4, metrics.confidenceGain * 20))}%` }} />
                                    </div>
                                    <div className="rounded-md bg-indigo-100">
                                      <div className="rounded-md bg-indigo-500 w-full" style={{ height: `${Math.min(100, Math.max(4, completionPct))}%` }} />
                                    </div>
                                    <div className="rounded-md bg-orange-100">
                                      <div className="rounded-md bg-orange-500 w-full" style={{ height: `${Math.min(100, Math.max(4, (post.saves || 0) * 15))}%` }} />
                                    </div>
                                  </div>
	                                  {!isDraftOnly && !!String(post.courseId || '').trim() ? (
	                                    <button
	                                      type="button"
	                                      onClick={() => void handleOpenAnalyticsStudio(post)}
	                                      className="mt-3 inline-flex items-center gap-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                                    >
                                      <BarChart3 className="w-3.5 h-3.5" />
                                      Analytics studio
                                    </button>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 mt-3">{t('noCreatedCourses', locale)}</p>
                      )}
                    </section>

	                    {communityError ? <p className="text-xs text-red-600">{communityError}</p> : null}
	                    {communityNotice ? <p className="text-xs text-emerald-700">{communityNotice}</p> : null}
		                    {authUser ? (
		                      <section className="rounded-2xl border border-red-200 bg-white p-5">
		                        <button
	                          type="button"
	                          onClick={handleAuthSignOut}
	                          className="w-full inline-flex items-center justify-center rounded-2xl bg-red-600 hover:bg-red-500 text-white text-base font-bold py-4 shadow-lg shadow-red-500/20"
	                          title={authUser.email || authUser.id}
	                        >
	                          {t('logout', locale)}
		                        </button>
		                      </section>
		                    ) : null}
                    </>
                    )}
		                  </motion.div>
		                )}

                {activeHomeTab === 'downloads' && (
            <motion.div
              key="downloads-tab"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="max-w-4xl mx-auto"
            >
              <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{t('downloadedInAccount', locale)}</p>
                  <span className="text-xs text-slate-400">{accountId}</span>
                </div>
                <div className="mt-3 space-y-2 max-h-[50vh] overflow-auto">
                  {downloadStates.length ? downloadStates.map((row) => (
                    <button
                      key={`${row.courseId}:${row.snapshotVersion}`}
                      type="button"
                      onClick={() => handleOpenDownloadedCourse(row)}
                      className="w-full text-left rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <div className="text-sm font-semibold text-slate-800">{row.title || row.courseId}</div>
                      <div className="text-[11px] text-slate-500">
                        v{row.snapshotVersion} - {Math.max(1, Math.round(row.sizeBytes / 1024))} KB - {new Date(row.downloadedAt).toLocaleString()}
                      </div>
                    </button>
                  )) : (
                    <p className="text-sm text-slate-500">{t('noDownloadsYet', locale)}</p>
                  )}
                </div>
              </section>
              {downloadError ? <p className="mt-2 text-xs text-red-600">{downloadError}</p> : null}
            </motion.div>
          )}

                {activeHomeTab === 'community' && (
            <motion.div
              key="community-tab"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-4"
            >
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-900">{t('communityFeed', locale)}</h2>
                  <button
                    type="button"
                    onClick={() => refreshCoursePanels(true)}
                    className="text-xs rounded-lg border border-slate-200 px-3 py-1.5 bg-slate-50 hover:bg-slate-100"
                  >
                    {t('refresh', locale)}
                  </button>
                </div>
              </section>

              {!activeCommunityPost ? (
                publicFeed.length ? (
	                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
	                    {publicFeed.map((post) => {
                        const ownerIdentity = publicIdentityByAccountId[String(post.ownerId || '').trim()];
                        const ownerName = ownerIdentity?.displayName || fallbackPublicDisplayName(post.ownerId);
                        const ownerAvatar = ownerIdentity?.profileImageDataUrl || DEFAULT_PUBLIC_PROFILE_IMAGE;
                        return (
	                      <article
	                        key={post.id}
	                        onClick={() => handleOpenCommunityPost(post)}
	                        className="rounded-2xl overflow-hidden border border-slate-200 bg-[#0b1220] text-slate-100 shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
	                      >
	                        <div className="h-40 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-emerald-500/20 px-4 py-4 flex items-end">
	                          <div>
                              <div className="flex items-center gap-2 mb-1">
                                <img
                                  src={ownerAvatar}
                                  alt={ownerName}
                                  className="h-7 w-7 rounded-full border border-slate-500/50 bg-slate-800 object-cover"
                                  onError={(e) => {
                                    if (e.currentTarget.src.endsWith(DEFAULT_PUBLIC_PROFILE_IMAGE)) return;
                                    e.currentTarget.src = DEFAULT_PUBLIC_PROFILE_IMAGE;
                                  }}
                                />
	                              <button
	                                type="button"
	                                onClick={(e) => {
	                                  e.stopPropagation();
	                                  void handleOpenCreatorProfile(post.ownerId);
	                                }}
	                                className="text-xs uppercase tracking-widest text-cyan-200 hover:text-white transition-colors truncate"
	                              >
	                                {ownerName}
	                              </button>
                              </div>
	                            <h3 className="text-lg font-bold text-white line-clamp-2">{post.title}</h3>
	                          </div>
	                        </div>
	                        <div className="p-4 space-y-3">
	                          <p className="text-sm text-slate-300 line-clamp-2">{post.description || post.courseId}</p>
	                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
	                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5">
	                              <ThumbsUp className="w-3.5 h-3.5" />
	                              {Number((post.upvotes ?? post.reactions) || 0)}
	                            </span>
	                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5">
	                              <MessageSquare className="w-3.5 h-3.5" />
	                              {post.comments}
	                            </span>
	                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5">
	                              <Download className="w-3.5 h-3.5" />
	                              {post.saves}
	                            </span>
	                          </div>
	                          <p className="text-xs text-slate-400">{t('openDetails', locale)}</p>
	                        </div>
	                      </article>
                        );
                      })}
	                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t('noPublicCourses', locale)}</p>
                )
              ) : (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => setActiveCommunityPost(null)}
                        className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700 hover:bg-slate-100"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back to feed
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenCreatorProfile(activeCommunityPost.ownerId)}
                        className="mt-2 inline-flex items-center gap-2 text-xs tracking-widest text-slate-500 hover:text-emerald-700 transition-colors"
                      >
                        <img
                          src={activeCommunityOwnerIdentity?.profileImageDataUrl || DEFAULT_PUBLIC_PROFILE_IMAGE}
                          alt={activeCommunityOwnerIdentity?.displayName || activeCommunityPost.ownerId}
                          className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover"
                          onError={(e) => {
                            if (e.currentTarget.src.endsWith(DEFAULT_PUBLIC_PROFILE_IMAGE)) return;
                            e.currentTarget.src = DEFAULT_PUBLIC_PROFILE_IMAGE;
                          }}
                        />
                        <span>{t('creator', locale)}: {activeCommunityOwnerIdentity?.displayName || fallbackPublicDisplayName(activeCommunityPost.ownerId)}</span>
                      </button>
	                      <h3 className="text-2xl font-bold text-slate-900 mt-1">{activeCommunityPost.title}</h3>
	                      <p className="text-sm text-slate-600 mt-2">{activeCommunityPost.description || activeCommunityPost.courseId}</p>
	                    </div>
	                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="text-xs rounded-lg bg-slate-100 text-slate-700 px-2.5 py-1.5">{t('likes', locale)}: {Number((activeCommunityPost.upvotes ?? activeCommunityPost.reactions) || 0)}</span>
                    <span className="text-xs rounded-lg bg-slate-100 text-slate-700 px-2.5 py-1.5">{t('comments', locale)}: {activeCommunityPost.comments || 0}</span>
                    <span className="text-xs rounded-lg bg-slate-100 text-slate-700 px-2.5 py-1.5">{t('downloadedCourses', locale)}: {activeCommunityPost.saves || 0}</span>
                  </div>

	                  <div className="mt-4 flex flex-wrap gap-2">
	                    <button
	                      type="button"
	                      onClick={() => handleReactToPost(activeCommunityPost.id, 'up')}
                        disabled={!!reactionBusyByPost[activeCommunityPost.id]}
	                      className={cn(
	                        "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed",
	                        activeCommunityPost.userReaction === 'up'
	                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
	                          : "border-slate-200 hover:bg-slate-50"
	                      )}
	                    >
	                      <ThumbsUp className="w-4 h-4" />
	                        <span>{Number((activeCommunityPost.upvotes ?? activeCommunityPost.reactions) || 0)}</span>
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => handleReactToPost(activeCommunityPost.id, 'down')}
                        disabled={!!reactionBusyByPost[activeCommunityPost.id]}
	                      className={cn(
	                        "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed",
	                        activeCommunityPost.userReaction === 'down'
	                          ? "border-red-200 bg-red-50 text-red-700"
	                          : "border-slate-200 hover:bg-slate-50"
	                      )}
	                    >
	                      <ThumbsDown className="w-4 h-4" />
	                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenCreatorProfile(activeCommunityPost.ownerId)}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 text-sm hover:bg-indigo-100"
                    >
                      <Users className="w-4 h-4" />
                      <span>Visit creator profile</span>
                    </button>
                    <button type="button" onClick={() => handleSharePost(activeCommunityPost)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <Share2 className="w-4 h-4" />
                      <span>{t('share', locale)}</span>
                    </button>
                    <button type="button" onClick={() => handleDownloadPostCourse(activeCommunityPost)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <Download className="w-4 h-4" />
                      <span>{t('download', locale)}</span>
                    </button>
                    <button type="button" onClick={() => void handleLearnNowFromPost(activeCommunityPost)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm hover:bg-emerald-100">
                      <BookOpen className="w-4 h-4" />
                      <span>{t('learnNow', locale)}</span>
                    </button>
                  </div>

	                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
	                    <p className="text-sm font-semibold text-slate-800">{t('comments', locale)}</p>
	                    <div className="mt-3 space-y-2 max-h-64 overflow-auto">
	                      {(commentsByPost[activeCommunityPost.id] || []).length ? (
	                        (commentsByPost[activeCommunityPost.id] || []).map((row) => {
                            const commenterIdentity = publicIdentityByAccountId[String(row.accountId || '').trim()];
                            const commenterName = commenterIdentity?.displayName || fallbackPublicDisplayName(row.accountId);
                            const commenterAvatar = commenterIdentity?.profileImageDataUrl || DEFAULT_PUBLIC_PROFILE_IMAGE;
                            return (
	                          <article key={row.id} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-start gap-2.5">
                              <img
                                src={commenterAvatar}
                                alt={commenterName}
                                className="h-8 w-8 rounded-full border border-slate-200 bg-slate-100 object-cover shrink-0"
                                onError={(e) => {
                                  if (e.currentTarget.src.endsWith(DEFAULT_PUBLIC_PROFILE_IMAGE)) return;
                                  e.currentTarget.src = DEFAULT_PUBLIC_PROFILE_IMAGE;
                                }}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-600">{commenterName}</p>
                                <p className="text-sm text-slate-800 break-words">{row.text}</p>
                              </div>
	                          </article>
                            );
                          })
	                      ) : (
	                        <p className="text-sm text-slate-500">{t('noCommentsYet', locale)}</p>
	                      )}
	                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={commentDraftByPost[activeCommunityPost.id] || ''}
                        onChange={(e) => setCommentDraftByPost((prev) => ({ ...prev, [activeCommunityPost.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleCommentOnPost(activeCommunityPost.id);
                          }
                        }}
                        placeholder={t('writeComment', locale)}
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCommentOnPost(activeCommunityPost.id)}
                        disabled={!!commentBusyByPost[activeCommunityPost.id]}
                        className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {commentBusyByPost[activeCommunityPost.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                        <span>{t('send', locale)}</span>
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {communityError ? <p className="text-xs text-red-600">{communityError}</p> : null}
              {communityNotice ? <p className="text-xs text-emerald-700">{communityNotice}</p> : null}
            </motion.div>
          )}

                {activeHomeTab === 'leaderboard' && (
            <motion.div
              key="leaderboard-tab"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="max-w-3xl mx-auto"
            >
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-xl font-bold text-slate-900">{t('leaderboardTitle', locale)}</h2>
                <p className="text-sm text-slate-500 mt-1">{t('leaderboardSubtitle', locale)}</p>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{t('totalXp', locale)}</p>
                    <p className="text-lg font-bold text-slate-900">{points}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{t('dayStreak', locale)}</p>
                    <p className="text-lg font-bold text-slate-900">{streak}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{t('globalRank', locale)}</p>
                    <p className="text-lg font-bold text-slate-900">#{Math.max(1, 1000 - (points + streak))}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

                {activeHomeTab === 'learn' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mx-auto flex flex-col items-center justify-start min-h-[calc(100vh-9rem)] text-center w-full max-w-6xl pt-1 md:pt-2"
            >
              <img
                src="/mascot/banner.png"
                alt="SEA-Geko Banner"
                className="w-full max-w-[920px] max-h-[34vh] object-contain h-auto mb-4 md:mb-5"
              />
              <p className="text-lg md:text-xl text-slate-500 mb-5 md:mb-6 max-w-2xl leading-snug">
                {t('heroSubtitle', locale)}
              </p>
              
              <div className="w-full max-w-5xl">
	                <div className={cn(
	                  "bg-white border rounded-[32px] p-3 md:p-4 shadow-xl shadow-slate-200/50 flex flex-col gap-3 transition-all",
	                  promptError ? "border-red-200" : "border-slate-200",
	                  shakePrompt && "shake"
	                )}>
		                  {composerMode === 'interview' ? (
	                    <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 px-3 py-3 text-left">
	                      <div className="flex flex-wrap items-center justify-between gap-2">
	                        <h3 className="text-sm font-bold text-emerald-900">{interviewRolesHeading}</h3>
                        <button
                          type="button"
                          onClick={() => setCareerPromptSeed((prev) => prev + 1)}
                          disabled={!careerGuidanceEnabled || interviewJobsBusy}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {interviewJobsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          {t('refresh', locale)}
                        </button>
                      </div>
                      {!careerGuidanceEnabled ? (
                        <p className="mt-2 text-xs text-slate-600">{t('signInValidateCvPrompt', locale)}</p>
                      ) : null}
		                      <div className="mt-3 flex flex-wrap gap-2">
		                        {interviewRecommendedJobs.map((job) => (
	                          <button
	                            key={`prompt-interview-chip-${job.id}`}
	                            type="button"
	                            onClick={() => {
	                              setSelectedInterviewJobTitle(job.title);
	                              setPrompt(job.title);
	                              setInterviewError(null);
	                            }}
	                            className={cn(
	                              "rounded-full border px-4 py-2 text-sm transition-colors",
	                              selectedInterviewJobTitle === job.title
	                                ? "border-emerald-400 bg-emerald-100 text-emerald-800"
	                                : "border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
	                            )}
	                            title={job.reason}
	                          >
	                            {job.title}
	                          </button>
	                        ))}
                        {!interviewJobsBusy && careerGuidanceEnabled && !interviewRecommendedJobs.length ? (
                          <span className="text-xs text-slate-500">{t('noRoleRecommendationsYet', locale)}</span>
                        ) : null}
		                      </div>
			                    </section>
			                  ) : null}

			                  <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
		                    <div ref={composerMenuRef} className="relative flex-shrink-0">
	                      <button
	                        type="button"
	                        onClick={() => setIsComposerMenuOpen((v) => !v)}
	                        className={cn(
	                          "h-12 px-4 rounded-2xl border flex items-center justify-center gap-2 transition-all",
	                          isComposerMenuOpen
	                            ? "border-emerald-500 bg-emerald-500 text-white"
	                            : "border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
	                        )}
	                        title="Open tools"
		                      >
		                        <SlidersHorizontal className="w-5 h-5" />
		                        <span className="text-sm font-semibold">Tools</span>
		                      </button>

	                      <AnimatePresence>
	                        {isComposerMenuOpen && (
	                          <motion.div
	                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
	                            animate={{ opacity: 1, y: 0, scale: 1 }}
	                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
	                            className="absolute left-0 bottom-full mb-3 z-50 w-72 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xl shadow-2xl p-2 text-left"
	                          >
			                            <button
			                              type="button"
			                              onClick={() => {
			                                const enableInterviewMode = composerMode !== 'interview';
			                                setComposerMode(enableInterviewMode ? 'interview' : 'default');
			                                if (enableInterviewMode) {
			                                  setCareerPromptSeed((prev) => prev + 1);
			                                  setActiveHomeTab('learn');
			                                } else {
			                                  stopInterviewRecording();
			                                  setRecordingQuestionId(null);
			                                  setInterviewTranscribingQuestionId(null);
			                                  setInterviewSession(null);
			                                  setInterviewRecordedSecondsByQuestionId({});
			                                  setInterviewVoiceWaveBars(Array.from({ length: 24 }, () => 0.08));
			                                  setInterviewReviewOpen(false);
			                                  setInterviewFinalReview(null);
			                                  setInterviewError(null);
			                                  setState('idle');
			                                }
			                                setIsComposerMenuOpen(false);
			                              }}
	                              className="w-full rounded-xl px-3 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-3"
	                            >
	                              <div className={cn(
	                                "h-8 w-8 rounded-lg flex items-center justify-center",
	                                composerMode === 'interview' ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
	                              )}>
	                                <Sparkles className="w-4 h-4" />
	                              </div>
	                              <div>
	                                <p className="text-sm font-semibold text-slate-800">Interview Preparation mode {composerMode === 'interview' ? '(On)' : '(Off)'}</p>
	                                <p className="text-xs text-slate-500">Generate role requirements, questions, and AI interview coaching</p>
	                              </div>
	                            </button>
                            <button
                              type="button"
                              onClick={openManualOutlineBuilder}
                              className="w-full rounded-xl px-3 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-3"
                            >
                              <div className="h-8 w-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
                                <Layout className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">Outline Builder (Manual)</p>
                                <p className="text-xs text-slate-500">Build the course structure yourself</p>
                              </div>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="hidden md:block md:flex-shrink-0">
                      <ModelPicker
                        provider={normalizeProvider(routerProvider)}
                        model={routerModel || 'auto'}
                        onChange={(next) => {
                          setRouterProvider(next.provider);
                          setRouterModel(next.model);
                        }}
                      />
                    </div>

	                    <input
	                      ref={promptInputRef}
	                      type="text"
                      value={prompt}
                      onChange={(e) => {
                        const next = normalizePromptDraft(e.target.value);
                        setPrompt(next);
                        if (promptError) {
                          setPromptError(getPromptValidationError(next));
                        }
                      }}
	                      onKeyDown={(e) => e.key === 'Enter' && handleStart()}
	                      placeholder={composerMode === 'interview'
	                        ? 'e.g. Human Resources Specialist'
	                        : (isOutlineBuilderOpen ? "Optional topic hint (outline is open)" : "e.g. Master Python for Data Science")}
	                      className="flex-1 min-w-[220px] bg-transparent px-2 md:px-4 py-3 text-lg md:text-xl focus:outline-none placeholder:text-slate-300"
	                    />

		                    <button
		                      onClick={handleStart}
			                      disabled={interviewBusy || !!interviewTranscribingQuestionId}
		                      className="relative overflow-hidden px-8 py-3 md:py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-70 disabled:cursor-wait text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 flex-shrink-0"
		                    >
		                      {interviewBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
		                      {composerMode === 'interview' ? 'Generate interview' : t('generate', locale)}
		                    </button>
	                  </div>

                  <div className="md:hidden">
                    <ModelPicker
                      provider={normalizeProvider(routerProvider)}
                      model={routerModel || 'auto'}
                      onChange={(next) => {
                        setRouterProvider(next.provider);
                        setRouterModel(next.model);
                      }}
                    />
                  </div>

	                  <AnimatePresence>
	                    {promptError ? (
                      <motion.p
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="text-left text-xs text-red-600 px-2"
                      >
                        {promptError}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>

		                  <AnimatePresence>
		                    {useOutlineMode && isOutlineBuilderOpen ? (
	                      <motion.p
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="text-left text-xs text-emerald-700 px-2"
                      >
                        Outline Builder is open. Generate directly from the editor panel.
		                      </motion.p>
		                    ) : null}
		                  </AnimatePresence>
		                  <AnimatePresence>
		                    {composerMode === 'interview' && interviewError ? (
		                      <motion.p
		                        initial={{ opacity: 0, y: 4 }}
		                        animate={{ opacity: 1, y: 0 }}
		                        exit={{ opacity: 0, y: 4 }}
		                        className="text-left text-xs text-red-600 px-2"
		                      >
		                        {interviewError}
		                      </motion.p>
		                    ) : null}
		                  </AnimatePresence>
		                </div>

	                <AnimatePresence>
		                  {isOutlineBuilderOpen && (
	                    <motion.div
	                      initial={{ opacity: 0 }}
	                      animate={{ opacity: 1 }}
	                      exit={{ opacity: 0 }}
	                      className="fixed inset-0 z-[120] bg-slate-900/30 backdrop-blur-sm px-2 md:px-6 pt-24 md:pt-28 pb-4 flex items-end md:items-start justify-center"
	                      onClick={(e) => {
	                        if (e.target === e.currentTarget) closeOutlineBuilder();
	                      }}
	                    >
	                      <motion.div
	                        initial={{ opacity: 0, y: 20, scale: 0.98 }}
	                        animate={{ opacity: 1, y: 0, scale: 1 }}
	                        exit={{ opacity: 0, y: 20, scale: 0.98 }}
	                        className="w-full max-w-6xl max-h-[calc(100vh-7rem)] md:max-h-[calc(100vh-8rem)] bg-white border border-slate-200 rounded-[28px] shadow-2xl flex flex-col overflow-hidden text-left"
	                      >
	                        <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
	                          <div>
	                            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-600">
	                              Manual Builder
	                            </p>
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900">Course Plan Structure</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={addOutlineModule}
                              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center gap-1 hover:bg-slate-700 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                              Add Module
                            </button>
                            <button
                              type="button"
                              onClick={closeOutlineBuilder}
                              className="h-10 w-10 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                              title="Close builder"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div ref={outlineScrollRef} className="flex-1 overflow-auto px-4 md:px-6 py-5 space-y-4">
                          <div>
                            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Course title</label>
                            <input
                              ref={outlineTitleInputRef}
                              value={outlineTitle}
                              onChange={(e) => setOutlineTitle(e.target.value)}
                              placeholder="Custom course title"
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            />
                          </div>

                          {outlineModules.map((module, moduleIdx) => (
                            <div key={module.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                              <div className="flex items-center gap-2">
                                <input
                                  value={module.title}
                                  onChange={(e) => updateOutlineModuleTitle(module.id, e.target.value)}
                                  placeholder={`Module ${moduleIdx + 1}`}
                                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOutlineModule(module.id)}
                                  disabled={outlineModules.length <= 1}
                                  className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                  title="Remove module"
                                >
                                  <Minus className="w-4 h-4" />
                                </button>
                              </div>

                              <div className="mt-3 space-y-3">
                                {module.lessons.map((lesson, lessonIdx) => (
                                  <div key={lesson.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="flex items-center gap-2">
                                      <input
                                        value={lesson.title}
                                        onChange={(e) => updateOutlineLessonTitle(module.id, lesson.id, e.target.value)}
                                        placeholder={`Lesson ${lessonIdx + 1}`}
                                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeOutlineLesson(module.id, lesson.id)}
                                        disabled={module.lessons.length <= 1}
                                        className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                        title="Remove lesson"
                                      >
                                        <Minus className="w-4 h-4" />
                                      </button>
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {outlineOptionConfigs.map((option) => {
                                        const active = lesson.options[option.key];
                                        return (
                                          <button
                                            key={option.key}
                                            type="button"
                                            onClick={() => toggleOutlineLessonOption(module.id, lesson.id, option.key)}
                                            className={cn(
                                              "px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                                              active
                                                ? "bg-emerald-500 text-white border-emerald-500"
                                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                            )}
                                          >
                                            {option.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <button
                                type="button"
                                onClick={() => addOutlineLesson(module.id)}
                                className="mt-3 px-3 py-2 rounded-lg bg-slate-900/90 text-white text-xs font-semibold flex items-center gap-1 hover:bg-slate-700 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Add Lesson
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="px-4 md:px-6 py-4 border-t border-slate-100 bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                          <p className="text-xs text-slate-500">
                            Outline mode skips assessment, opens outline review, then crafts full content after approval.
                          </p>
                          <div className="flex items-center gap-2 w-full md:w-auto">
                            <button
                              type="button"
                              onClick={closeOutlineBuilder}
                              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleGenerateFromOutlineBuilder}
                              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                            >
                              <Sparkles className="w-4 h-4" />
                              Review Outline
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

	              <div className="mt-4 md:mt-5 flex items-center gap-2 text-slate-400 text-sm">
	                <span>Not sure where to start?</span>
	                <button 
	                  onClick={handleUseSample}
	                  className="text-emerald-600 font-bold hover:underline underline-offset-4 flex items-center gap-1"
                >
                  <BookOpen className="w-4 h-4" />
	                  Try a sample course
	                </button>
	              </div>

		            </motion.div>
          )}
              </AnimatePresence>
              </div>
            </div>
          </div>
	        ) : (
	          <AnimatePresence mode="wait">
	          {state === 'interview_setup' && (
	            <motion.div
	              key="interview-setup"
	              initial={{ opacity: 0, y: 14 }}
	              animate={{ opacity: 1, y: 0 }}
	              exit={{ opacity: 0, y: -14 }}
	              className="max-w-5xl mx-auto space-y-5"
	            >
	              <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
	                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-emerald-600 font-bold">Interview Setup</p>
	                <h2 className="text-2xl font-bold text-slate-900 mt-2">Set your interview configuration</h2>
	                <p className="text-sm text-slate-600 mt-2">Role: <span className="font-semibold text-slate-900">{selectedInterviewJobTitle || prompt || 'Not selected'}</span></p>
	              </section>

	              <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
	                <article className="rounded-2xl border border-slate-200 bg-white p-4">
	                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500">Q1</p>
	                  <p className="text-sm font-semibold text-slate-900 mt-1">Target language</p>
	                  <p className="text-xs text-slate-500 mt-1">Questions and coaching will follow this language.</p>
	                  <select
	                    value={interviewTargetLanguage}
                    onChange={(e) => setInterviewTargetLanguage(normalizeInterviewLanguageSelection(e.target.value))}
	                    className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
	                  >
	                    {INTERVIEW_LANGUAGE_OPTIONS.map((option) => (
	                      <option key={option.value} value={option.value}>{option.label}</option>
	                    ))}
	                  </select>
	                </article>
	                <article className="rounded-2xl border border-slate-200 bg-white p-4">
	                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500">Q2</p>
	                  <p className="text-sm font-semibold text-slate-900 mt-1">Question focus</p>
	                  <p className="text-xs text-slate-500 mt-1">Choose which style appears more often.</p>
	                  <select
	                    value={interviewQuestionFocus}
	                    onChange={(e) => setInterviewQuestionFocus(e.target.value as 'mixed' | 'behavioral' | 'technical')}
	                    className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
	                  >
	                    <option value="mixed">Mixed</option>
	                    <option value="behavioral">Behavioral first</option>
	                    <option value="technical">Technical first</option>
	                  </select>
	                </article>
	                <article className="rounded-2xl border border-slate-200 bg-white p-4">
	                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500">Q3</p>
	                  <p className="text-sm font-semibold text-slate-900 mt-1">Seniority level</p>
	                  <p className="text-xs text-slate-500 mt-1">Adjust difficulty and expectation level.</p>
	                  <select
	                    value={interviewSeniority}
	                    onChange={(e) => setInterviewSeniority(e.target.value as 'entry' | 'mid' | 'senior')}
	                    className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
	                  >
	                    <option value="entry">Entry-level</option>
	                    <option value="mid">Mid-level</option>
	                    <option value="senior">Senior-level</option>
	                  </select>
	                </article>
	              </section>

	              {interviewError ? (
	                <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
	                  {interviewError}
	                </section>
	              ) : null}

	              <div className="flex flex-wrap items-center justify-between gap-3">
	                <button
	                  type="button"
	                  onClick={() => setState('idle')}
	                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
	                >
	                  Back
	                </button>
	                <button
	                  type="button"
	                  onClick={() => void handleStartInterviewPreparation(selectedInterviewJobTitle || prompt)}
	                  disabled={interviewBusy}
	                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-60"
	                >
	                  {interviewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
	                  Start interview simulation
	                </button>
	              </div>
	            </motion.div>
	          )}

	          {state === 'interviewing' && (
	            <InterviewPreparationPage
              interviewSession={interviewSession}
              interviewBusy={interviewBusy}
              interviewError={interviewError}
	              interviewFinalBusy={interviewFinalBusy}
	              interviewFinalReview={interviewFinalReview}
	              interviewReviewOpen={interviewReviewOpen}
	              interviewReviewProgress={interviewReviewProgress}
	              interviewRecommendedJobs={interviewRecommendedJobs}
	              interviewJobsBusy={interviewJobsBusy}
	              selectedInterviewJobTitle={selectedInterviewJobTitle}
              prompt={prompt}
              activeInterviewQuestionIdx={interviewActiveQuestionIdx}
              activeInterviewQuestion={activeInterviewQuestion}
              activeInterviewAnswer={activeInterviewAnswer}
              activeInterviewAnswerMode={activeInterviewAnswerMode}
              interviewVoiceSupported={interviewVoiceSupported}
              interviewVoiceSupportMessage={interviewVoiceSupportMessage}
              activeInterviewRecordedSeconds={activeInterviewRecordedSeconds}
              interviewVoiceWaveBars={interviewVoiceWaveBars}
              interviewRecordingElapsedSeconds={interviewRecordingElapsedSeconds}
              recordingQuestionId={recordingQuestionId}
              interviewTranscribingQuestionId={interviewTranscribingQuestionId}
              interviewAnsweredCount={interviewAnsweredCount}
              careerGuidanceEnabled={careerGuidanceEnabled}
              interviewAnswersByQuestionId={interviewAnswersByQuestionId}
              interviewFeedbackByQuestionId={interviewFeedbackByQuestionId}
              onBackToLearn={() => {
                stopInterviewRecording();
                setComposerMode('default');
                setState('idle');
                setActiveHomeTab('learn');
              }}
              onRefreshRoles={() => setCareerPromptSeed((prev) => prev + 1)}
              onSelectRole={(job) => {
                setSelectedInterviewJobTitle(job.title);
                setPrompt(job.title);
                setInterviewError(null);
              }}
              onPromptChange={(value) => setPrompt(normalizePromptDraft(value))}
	              onGenerateInterview={() => void handleStartInterviewPreparation(prompt || selectedInterviewJobTitle)}
		              onStartRecording={(questionId) => void startInterviewRecording(questionId)}
		              onStopRecording={stopInterviewRecording}
		              onRetryRecording={handleRetryInterviewRecording}
		              onAnswerChange={(value) => {
		                if (!activeInterviewQuestion) return;
		                setInterviewAnswersByQuestionId((prev) => ({ ...prev, [activeInterviewQuestion.id]: value }));
	                setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [activeInterviewQuestion.id]: 'text' }));
	              }}
              onSetAnswerMode={(mode) => {
                if (!activeInterviewQuestion) return;
                if (recordingQuestionId === activeInterviewQuestion.id || interviewTranscribingQuestionId === activeInterviewQuestion.id) return;
                if (mode === 'voice' && !interviewVoiceSupported) {
                  setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [activeInterviewQuestion.id]: 'text' }));
                  setInterviewError(INTERVIEW_VOICE_UNSUPPORTED_MESSAGE);
                  return;
                }
                setInterviewAnswerModeByQuestionId((prev) => ({ ...prev, [activeInterviewQuestion.id]: mode }));
              }}
	              onPrevQuestion={() => setInterviewActiveQuestionIdx((prev) => Math.max(0, prev - 1))}
	              onSaveNext={handleInterviewSaveAndNext}
	              onBackToQuestions={() => {
	                setInterviewReviewOpen(false);
	                setInterviewFinalReview(null);
	                setInterviewReviewProgress(0);
	              }}
            />
          )}

          {state === 'assessing' && assessment.length === 0 && (
            <motion.div 
              key="assessing-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-2xl mx-auto"
            >
              {!globalError && !retryInfo && <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-8" />}
              
              <h2 className="text-4xl font-bold text-slate-900 mb-4">
                {globalError ? t('assessmentPaused', locale) : t('preparingAssessment', locale)}
              </h2>
              <p className="text-slate-500 text-lg mb-12">
                {globalError ? t('assessmentErrorSub', locale) : t('preparingAssessmentSub', locale)}
              </p>
              
              {retryInfo && (
                <div className="w-full max-w-md space-y-6">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white border-2 border-orange-200 p-8 rounded-[40px] shadow-xl shadow-orange-500/5 relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-orange-100">
                      <motion.div 
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: retryInfo.delay / 1000, ease: "linear" }}
                        className="h-full bg-orange-500"
                      />
                    </div>
                    <div className="flex items-center gap-4 text-orange-600 mb-4 justify-center">
                      <RotateCcw className="w-5 h-5 animate-spin" />
                      <span className="text-sm font-bold uppercase tracking-widest">Rate Limit Hit</span>
                    </div>
                    <p className="text-sm text-slate-600">
                      The AI is busy. Retrying in <span className="font-bold text-orange-600">{Math.round(retryInfo.delay / 1000)}s</span>... 
                      <span className="block mt-1 text-[10px] text-slate-400 uppercase tracking-widest">({retryInfo.attempt} attempts remaining)</span>
                    </p>
                  </motion.div>
                  
                  <div className="flex flex-col gap-4">
                    <button
                      onClick={() => setState('idle')}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-4"
                    >
                      Cancel and try again
                    </button>

                    <div className="flex items-center gap-4 py-2">
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest">{t('orLabel', locale)}</span>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>

                    <button 
                      onClick={handleUseSample}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-slate-600 rounded-2xl transition-all text-sm font-bold shadow-sm"
                    >
                      <BookOpen className="w-4 h-4" />
                      Explore Sample Course Instead
                    </button>
                  </div>
                </div>
              )}

              {globalError && !retryInfo && (
                <div className="w-full max-w-md space-y-8">
                  <div className="bg-red-50 border border-red-100 p-8 rounded-[40px] shadow-sm">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm mx-auto mb-4">
                      <AlertCircle className="w-6 h-6 text-red-500" />
                    </div>
                    <p className="text-slate-900 font-bold mb-2">Generation Error</p>
                    <p className="text-red-600 text-sm mb-6 font-medium leading-relaxed">{globalError}</p>
                    <button
                      onClick={handleStart}
                      className="flex items-center gap-2 px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl transition-all text-sm font-bold mx-auto shadow-lg"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Retry Assessment
                    </button>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4 py-2">
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest">OR</span>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>

                    <button 
                      onClick={handleUseSample}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-slate-600 rounded-2xl transition-all text-sm font-bold shadow-sm mx-auto"
                    >
                      <BookOpen className="w-4 h-4" />
                      {t('exploreSampleCourse', locale)}
                    </button>
                  </div>
                  
                  <button
                    onClick={navigateHome}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-4"
                  >
                    {t('goBackHome', locale)}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {state === 'assessing' && assessment.length > 0 && (
            <motion.div 
              key="assessing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="max-w-2xl mx-auto"
            >
              <div className="mb-12">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-emerald-600 font-mono text-sm uppercase tracking-widest">Initial Assessment</span>
                  <span className="text-slate-400 text-sm">{currentAssessmentIdx + 1} / {assessment.length}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-emerald-500 shadow-sm"
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentAssessmentIdx + 1) / assessment.length) * 100}%` }}
                  />
                </div>
              </div>

              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-10 leading-tight">
                {assessment[currentAssessmentIdx].question}
              </h2>

              <div className="space-y-4">
                {assessment[currentAssessmentIdx].type === 'choice' ? (
                  assessment[currentAssessmentIdx].options?.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => handleAnswer(opt, { skipValidation: true })}
                      className="w-full p-6 bg-white border border-slate-200 rounded-2xl text-left hover:bg-slate-50 hover:border-emerald-500/50 transition-all group flex justify-between items-center shadow-sm hover:shadow-md"
                    >
                      <span className="text-lg font-medium text-slate-700">{opt}</span>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                    </button>
                  ))
                ) : (
                  <div className="relative">
                    <textarea 
                      autoFocus
                      value={assessmentDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAssessmentDraft(next);
                        if (assessmentError) {
                          setAssessmentError(getAssessmentAnswerValidationError(next));
                        }
                      }}
                      className="w-full bg-white border border-slate-200 rounded-2xl p-6 text-lg focus:outline-none focus:ring-4 focus:ring-emerald-500/10 min-h-[200px] text-slate-700 placeholder:text-slate-300 shadow-sm"
                      placeholder="Type your answer here..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAnswer(assessmentDraft);
                        }
                      }}
                    />
                    <div className="absolute bottom-4 right-4 text-[10px] font-mono text-slate-400 uppercase tracking-widest">Press Enter to continue</div>
                    <button
                      type="button"
                      onClick={() => handleAnswer(assessmentDraft)}
                      className="absolute bottom-3 left-4 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                )}
                {assessmentError ? (
                  <p className="text-sm text-red-600">{assessmentError}</p>
                ) : null}
              </div>
            </motion.div>
          )}

          {state === 'planning' && (
            <motion.div 
              key="planning"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center min-h-[50vh] text-center"
            >
              <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-6" />
              <h2 className="text-3xl font-bold text-slate-900 mb-4">Architecting your curriculum...</h2>
              <p className="text-slate-500 mb-8">Our AI is analyzing your goals and structuring the optimal learning path.</p>
              
              {retryInfo && (
                <div className="space-y-4">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-orange-500/5 border border-orange-500/10 p-4 rounded-2xl max-w-xs mx-auto"
                  >
                    <div className="flex items-center gap-3 text-orange-600 mb-1">
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      <span className="text-sm font-bold uppercase tracking-wider">Rate Limit Hit</span>
                    </div>
                    <p className="text-xs text-orange-600/60">
                      The AI is busy. Retrying in {Math.round(retryInfo.delay / 1000)}s... 
                      ({retryInfo.attempt} attempts remaining)
                    </p>
                  </motion.div>
                  
                  <button
                    onClick={() => setState('idle')}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-4"
                  >
                    Cancel and try again later
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {state === 'generating_outline' && course && (
            <GenerationFlow
              course={course}
              phase="outline"
              retryInfo={retryInfo}
              onComplete={enterOutlineReview}
              onUseSample={handleUseSample}
              onRetryModule={handleRetryModule}
              locale={locale}
            />
          )}

          {state === 'outline_review' && course && (
            <motion.div
              key="outline-review"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <section className="rounded-3xl border border-emerald-100 bg-white p-5 md:p-7 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-emerald-600 font-bold">Course Creation Flow</p>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mt-2">Review the outline before crafting full content</h2>
                    <p className="text-sm text-slate-600 mt-2">
                      Check lessons and sub-contents first. Approve only when this outline is ready.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setState('idle')}
                      className="px-4 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </div>

                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOutlineDropActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                    setOutlineDropActive(false);
                  }}
                  onDrop={handleOutlineDrop}
                  className={cn(
                    "mt-6 rounded-2xl border-2 border-dashed p-5 transition-colors",
                    outlineDropActive ? "border-emerald-400 bg-emerald-50/80" : "border-slate-300 bg-slate-50"
                  )}
                >
                  <p className="text-sm font-semibold text-slate-800">Drag and drop the outlines to edit</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Drop modules, lessons, or sub-contents here.
                  </p>

                  {outlineReviewSelection.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {outlineReviewSelection.map((target) => (
                        <span
                          key={target.key}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-emerald-700"
                        >
                          {target.label}
                          <button
                            type="button"
                            onClick={() => handleRemoveOutlineTarget(target.key)}
                            className="text-emerald-500 hover:text-emerald-700"
                            aria-label={`Remove ${target.label}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDoneSelectingOutlineTargets}
                      disabled={!outlineReviewSelection.length || isRecraftingOutline}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Done Selecting
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOutlineReviewSelection([]);
                        setOutlinePromptByTarget({});
                        setOutlinePromptCursor(0);
                        setOutlinePromptDraft('');
                        setOutlineReviewError(null);
                      }}
                      disabled={!outlineReviewSelection.length || isRecraftingOutline}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Clear Selection
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveOutline}
                      disabled={isRecraftingOutline || isGeneratingModules}
                      className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-500/20"
                    >
                      {isGeneratingModules ? 'Crafting in progress...' : 'Approve Outline'}
                    </button>
                  </div>
                </div>

                {isOutlinePromptSequenceOpen && outlinePromptTarget ? (
                  <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 md:p-5">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-700 font-bold">
                      Edit instruction {outlinePromptCursor + 1} / {outlineReviewSelection.length}
                    </p>
                    <p className="text-sm font-semibold text-slate-900 mt-2">
                      How do you want to edit {outlinePromptTarget.label}?
                    </p>
                    <textarea
                      value={outlinePromptDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOutlinePromptDraft(next);
                        if (outlineReviewError) {
                          setOutlineReviewError(getOutlineEditInstructionError(next));
                        }
                      }}
                      placeholder={`Describe updates for ${outlinePromptTarget.label}`}
                      className="mt-3 w-full min-h-[120px] rounded-xl border border-cyan-100 bg-white px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleOutlinePromptDone}
                        disabled={isRecraftingOutline}
                        className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        {outlinePromptCursor === outlineReviewSelection.length - 1 ? 'Recraft Selected Outlines' : 'Done'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelOutlinePromptSequence}
                        disabled={isRecraftingOutline}
                        className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {outlineReviewError ? (
                  <p className="mt-4 text-sm text-red-600">{outlineReviewError}</p>
                ) : null}
              </section>

              <div className="overflow-x-auto pb-3">
                <div className="flex items-stretch gap-4 min-w-max pr-2">
                {course.modules.map((module, moduleIdx) => {
                  const lessonGroups = module.steps.some((s) => typeof s.lessonNumber === 'number')
                    ? groupModuleStepsByLesson(module.steps)
                    : [{
                        lessonNumber: 1,
                        lessonTitle: module.title,
                        steps: module.steps.map((step, stepIdx) => ({ step, stepIdx })),
                      }];
                  const selectedLesson = outlineReviewLessonByModule[module.id] ?? lessonGroups[0]?.lessonNumber ?? null;
                  const selectedLessonGroup = lessonGroups.find((group) => group.lessonNumber === selectedLesson) || lessonGroups[0] || null;
                  const moduleKey = `module:${module.id}`;
                  const moduleHasFocus = !!outlineFocusTargetKey && (
                    outlineFocusTargetKey === moduleKey
                    || outlineFocusTargetKey.startsWith(`lesson:${module.id}:`)
                    || outlineFocusTargetKey.startsWith(`subcontent:${module.id}:`)
                  );
                  const moduleIsProcessing = !!outlineProcessingTargetKey && (
                    outlineProcessingTargetKey === moduleKey
                    || outlineProcessingTargetKey.startsWith(`lesson:${module.id}:`)
                    || outlineProcessingTargetKey.startsWith(`subcontent:${module.id}:`)
                  );

                  const moduleTarget: OutlineEditTarget = {
                    key: moduleKey,
                    type: 'module',
                    label: `Module ${moduleIdx + 1}`,
                    moduleId: module.id,
                    moduleTitle: module.title,
                  };

                  return (
                    <React.Fragment key={module.id}>
                    <article
                      ref={(el) => {
                        outlineTargetRefs.current[moduleTarget.key] = el;
                      }}
                      className={cn(
                        "w-[680px] max-w-[calc(100vw-3rem)] shrink-0 rounded-[28px] border bg-white p-5 shadow-sm transition-colors",
                        moduleIsProcessing
                          ? "border-amber-200 ring-2 ring-amber-200/80"
                          : moduleHasFocus
                          ? "border-cyan-200 ring-2 ring-cyan-200/80"
                          : "border-emerald-100"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          draggable
                          onDragStart={(event) => handleOutlineDragStart(event, moduleTarget)}
                          className="min-w-0 cursor-grab active:cursor-grabbing"
                        >
                          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Module {moduleIdx + 1}</p>
                          <h3 className="text-xl font-bold text-slate-900 break-words">{module.title}</h3>
                          <p className="text-sm text-slate-500 mt-1 break-words">{module.description}</p>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border",
                            module.status === 'completed'
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                              : module.status === 'error'
                              ? "bg-red-50 border-red-200 text-red-700"
                              : "bg-amber-50 border-amber-200 text-amber-700"
                          )}
                        >
                          {module.status}
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Lessons</p>
                          <div className="space-y-1.5 max-h-52 overflow-auto pr-1">
                            {lessonGroups.map((group) => {
                              const lessonTarget: OutlineEditTarget = {
                                key: `lesson:${module.id}:${group.lessonNumber}`,
                                type: 'lesson',
                                label: `Lesson ${moduleIdx + 1}.${group.lessonNumber}`,
                                moduleId: module.id,
                                moduleTitle: module.title,
                                lessonNumber: group.lessonNumber,
                                lessonTitle: group.lessonTitle,
                              };
                              const lessonHasFocus = outlineFocusTargetKey === lessonTarget.key;
                              const lessonIsProcessing = outlineProcessingTargetKey === lessonTarget.key;
                              return (
                                <button
                                  key={`${module.id}-lesson-${group.lessonNumber}`}
                                  type="button"
                                  ref={(el) => {
                                    outlineTargetRefs.current[lessonTarget.key] = el;
                                  }}
                                  draggable
                                  onDragStart={(event) => handleOutlineDragStart(event, lessonTarget)}
                                  onClick={() => {
                                    setOutlineFocusTargetKey(lessonTarget.key);
                                    setOutlineReviewLessonByModule((prev) => ({ ...prev, [module.id]: group.lessonNumber }));
                                  }}
                                  className={cn(
                                    "w-full rounded-lg px-2.5 py-2 text-left text-xs border transition-colors cursor-grab active:cursor-grabbing",
                                    selectedLesson === group.lessonNumber
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                      : "border-transparent bg-white text-slate-600 hover:bg-slate-50",
                                    lessonIsProcessing
                                      ? "border-amber-200 bg-amber-50 text-amber-900 ring-2 ring-amber-200/80"
                                      : lessonHasFocus
                                      ? "border-cyan-200 bg-cyan-50 text-cyan-900 ring-2 ring-cyan-200/80"
                                      : null
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] text-emerald-700/70">{moduleIdx + 1}.{group.lessonNumber}</span>
                                    <span className="flex-1 line-clamp-1 break-words font-semibold">{group.lessonTitle}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Sub-contents</p>
                          <div className="space-y-1.5 max-h-52 overflow-auto pr-1">
                            {selectedLessonGroup?.steps.length ? selectedLessonGroup.steps.map(({ step }, stepIdx) => {
                              const segment = typeof step.segmentNumber === 'number' ? step.segmentNumber : stepIdx + 1;
                              const lessonNumber = selectedLessonGroup.lessonNumber;
                              const target: OutlineEditTarget = {
                                key: `subcontent:${module.id}:${step.id}`,
                                type: 'subcontent',
                                label: `Sub-content ${moduleIdx + 1}.${lessonNumber}.${segment}`,
                                moduleId: module.id,
                                moduleTitle: module.title,
                                lessonNumber,
                                segmentNumber: segment,
                                lessonTitle: selectedLessonGroup.lessonTitle,
                                stepId: step.id,
                                stepTitle: resolveStepTitle(step),
                              };
                              const subcontentHasFocus = outlineFocusTargetKey === target.key;
                              const subcontentIsProcessing = outlineProcessingTargetKey === target.key;
                              return (
                                <div
                                  key={step.id}
                                  ref={(el) => {
                                    outlineTargetRefs.current[target.key] = el;
                                  }}
                                  draggable
                                  onDragStart={(event) => handleOutlineDragStart(event, target)}
                                  onClick={() => {
                                    setOutlineFocusTargetKey(target.key);
                                  }}
                                  className={cn(
                                    "rounded-lg px-2.5 py-2 text-xs border transition-colors cursor-grab active:cursor-grabbing",
                                    subcontentIsProcessing
                                      ? "border-amber-200 bg-amber-50 text-amber-900 ring-2 ring-amber-200/80"
                                      : subcontentHasFocus
                                      ? "border-cyan-200 bg-cyan-50 text-cyan-900 ring-2 ring-cyan-200/80"
                                      : "border-transparent bg-white hover:bg-slate-50 text-slate-600"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] text-slate-400">{moduleIdx + 1}.{lessonNumber}.{segment}</span>
                                    <span className="line-clamp-1 break-words font-medium">{resolveStepTitle(step)}</span>
                                  </div>
                                </div>
                              );
                            }) : (
                              <p className="text-xs text-slate-400">{t('selectLessonPreviewSubcontents', locale)}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                    {moduleIdx < course.modules.length - 1 ? (
                      <div className="hidden md:flex items-center shrink-0 px-1">
                        <div className="w-20 h-px border-t-2 border-dashed border-emerald-300" />
                        <div className="w-3 h-3 rounded-full border-2 border-emerald-500 bg-white mx-1" />
                        <div className="w-20 h-px border-t-2 border-dashed border-emerald-300" />
                      </div>
                    ) : null}
                    </React.Fragment>
                  );
                })}
                </div>
              </div>
            </motion.div>
          )}

          {state === 'generating_content' && course && (
            <GenerationFlow 
              course={course} 
              phase="content"
              retryInfo={retryInfo}
              onComplete={() => {
                const hasErrors = course.modules.some((module) => module.status === 'error');
                setState('learning');
                setActiveCourseOwnerId(accountId);
                showMascotToast(
                  hasErrors ? 'Almost there!' : 'Good job!',
                  hasErrors
                    ? 'Some parts need retry, but you can start learning now.'
                    : 'Your full course is crafted. Start learning now.',
                  hasErrors ? 'sad' : 'happy'
                );
              }} 
              onUseSample={handleUseSample}
              onRetryModule={handleRetryModule}
              locale={locale}
            />
          )}

	      {state === 'learning' && course && (
	            <motion.div 
	              key="learning"
	              initial={{ opacity: 0 }}
	              animate={{ opacity: 1 }}
	              className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6 xl:gap-8 items-start"
	            >
	              {/* Sidebar / Course Map */}
	              <div className="xl:sticky xl:top-20 self-start xl:h-[calc(100vh-5.5rem)] min-h-0">
	                <div className="h-full rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
		                  <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50">
		                    <button
		                      type="button"
		                      onClick={() => setSidebarView('outline')}
		                      className={cn(
		                        "px-4 py-3 text-sm transition-colors border-b-2",
		                        sidebarView === 'outline'
		                          ? "font-semibold text-slate-900 border-emerald-500 bg-white"
		                          : "font-medium text-slate-400 border-transparent hover:text-slate-600"
		                      )}
		                    >
		                      {t('courseOutline', locale)}
		                    </button>
		                    <button
		                      type="button"
		                      onClick={() => setSidebarView('resources')}
		                      className={cn(
		                        "px-4 py-3 text-sm transition-colors border-b-2",
		                        sidebarView === 'resources'
		                          ? "font-semibold text-slate-900 border-emerald-500 bg-white"
		                          : "font-medium text-slate-400 border-transparent hover:text-slate-600"
		                      )}
		                    >
		                      {t('resources', locale)}
		                    </button>
		                  </div>

		                  {sidebarView === 'outline' ? (
		                  <>
		                  <div className="px-3 py-3 border-b border-slate-100 bg-emerald-50/40 flex items-center gap-3">
		                    <img
		                      src="/mascot/course-progress-graduate.png"
		                      alt="SEA-Geko helper"
		                      className="w-12 h-12 rounded-xl object-cover"
		                      onError={(e) => {
		                        e.currentTarget.src = '/mascot/icon.png';
		                      }}
		                    />
		                    <div className="flex-1 min-w-0">
	                      <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">{t('courseProgress', locale)}</p>
	                      <p className="text-xs text-slate-600 mt-1">{overallProgress.completed}/{overallProgress.total} sub-contents completed</p>
	                      <div className="mt-2 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
	                        <div className="h-full bg-emerald-500" style={{ width: `${overallProgress.percent}%` }} />
	                      </div>
	                    </div>
	                  </div>

	                  <div className="space-y-2 overflow-y-auto min-h-0 p-2 flex-1">
	                  {course.modules.map((mod, idx) => {
	                    const moduleProgress = getModuleLearningProgress(mod);
	                    const lessonGroups = mod.steps.some((s) => typeof s.lessonNumber === 'number')
	                      ? groupModuleStepsByLesson(mod.steps)
	                      : [];

	                    return (
	                      <div key={mod.id} className="space-y-1.5">
	                        <button
	                          disabled={mod.isLocked}
	                          onClick={() => {
	                            if (mod.isLocked) return;
	                            setActiveModuleId(mod.id);
	                            setExpandedModuleId(prev => prev === mod.id ? null : mod.id);
	                            const firstLesson = mod.steps.find((s) => typeof s.lessonNumber === 'number')?.lessonNumber;
	                            if (typeof firstLesson === 'number') {
	                              setActiveLessonByModule(prev => ({
	                                ...prev,
	                                [mod.id]: prev[mod.id] ?? firstLesson
	                              }));
	                            }
	                          }}
	                          className={cn(
	                            "w-full p-4 rounded-xl text-left transition-all border flex items-start gap-3 relative overflow-hidden",
	                            activeModuleId === mod.id
	                              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
	                              : mod.isLocked
	                              ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
	                              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
	                            mod.status !== 'completed' && !mod.isLocked && "opacity-70"
	                          )}
	                        >
	                          {mod.isLocked && (
	                            <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center z-10">
	                              <Lock className="w-5 h-5 text-slate-300" />
	                            </div>
	                          )}
	                          <div className="mt-0.5 relative z-20">
	                            {moduleProgress.completed >= moduleProgress.total && moduleProgress.total > 0 ? (
	                              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
	                            ) : mod.status === 'completed' ? (
	                              <div className="w-5 h-5 rounded-full border-2 border-emerald-200" />
	                            ) : (
	                              <Loader2 className="w-5 h-5 animate-spin text-emerald-500/40" />
	                            )}
	                          </div>
	                          <div className="relative z-20 flex-1 min-w-0">
	                            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">Module {idx + 1}</div>
	                            <div className="font-semibold text-sm break-words line-clamp-2">{mod.title}</div>
	                            <div className="mt-2 space-y-1">
	                              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-emerald-700/70">
	                                <span>{moduleProgress.completed}/{moduleProgress.total}</span>
	                                <span>{moduleProgress.percent}%</span>
	                              </div>
	                              <div className="h-1.5 rounded-full bg-emerald-100/80 overflow-hidden">
	                                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${moduleProgress.percent}%` }} />
	                              </div>
	                            </div>
	                          </div>
	                        </button>

	                        <AnimatePresence>
	                          {expandedModuleId === mod.id && (
	                            <motion.div
	                              initial={{ height: 0, opacity: 0 }}
	                              animate={{ height: 'auto', opacity: 1 }}
	                              exit={{ height: 0, opacity: 0 }}
	                              className="overflow-hidden pl-3 pr-1 pb-1 space-y-1.5"
	                            >
	                              {lessonGroups.map((group) => {
	                                const lessonLabel = `${idx + 1}.${group.lessonNumber}`;
	                                const firstStep = group.steps[0]?.step;
	                                const isLessonActive = activeLessonByModule[mod.id] === group.lessonNumber;
                                const lessonCompleted = group.steps.filter(({ step }) => isStepLearnerComplete(mod.id, step)).length;
                                const lessonTotal = group.steps.length;

                                return (
                                  <div key={`${mod.id}-lesson-${group.lessonNumber}`} className="space-y-1.5">
	                                    <button
	                                      onClick={() => {
	                                        if (!firstStep) return;
	                                        setActiveModuleId(mod.id);
	                                        setActiveLessonByModule(prev => ({ ...prev, [mod.id]: group.lessonNumber }));
	                                        setTimeout(() => scrollToStep(firstStep.id), 100);
	                                      }}
	                                      className={cn(
	                                        "w-full p-2.5 rounded-lg text-left transition-colors flex items-center gap-3",
	                                        isLessonActive ? "bg-emerald-100/90" : "bg-emerald-50/70 hover:bg-emerald-100/70"
	                                      )}
	                                    >
	                                      <span className="font-mono text-[10px] text-emerald-600/70">{lessonLabel}</span>
	                                      <span className="flex-1 min-w-0 text-xs font-bold text-emerald-900 line-clamp-1 break-words">{group.lessonTitle}</span>
	                                      <span className="text-[10px] font-mono text-emerald-700/70">{lessonCompleted}/{lessonTotal}</span>
                                    </button>

                                    <div className="pl-2 space-y-1">
                                      {group.steps.map(({ step }, stepIdx) => {
                                        const segmentNum = typeof step.segmentNumber === 'number' ? step.segmentNumber : (stepIdx + 1);
                                        const segmentLabel = `${lessonLabel}.${segmentNum}`;
                                        const segmentTitle = resolveStepTitle(step);
                                        const complete = isStepLearnerComplete(mod.id, step);
                                        return (
                                          <div key={step.id} className="relative pl-6">
                                            {stepIdx < group.steps.length - 1 && (
                                              <div className="absolute left-[11px] top-5 bottom-[-8px] w-px bg-emerald-100" />
                                            )}
                                            <div className="flex items-center gap-1 group">
                                              <button
                                                onClick={() => {
                                                  setActiveModuleId(mod.id);
                                                  setActiveLessonByModule(prev => ({ ...prev, [mod.id]: group.lessonNumber }));
                                                  setTimeout(() => scrollToStep(step.id), 100);
                                                }}
                                                className="flex-1 p-2 text-left text-xs text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-2"
                                              >
                                                <span
                                                  className={cn(
                                                    "absolute left-0 top-3.5 w-[10px] h-[10px] rounded-full border",
                                                    complete ? "bg-emerald-500 border-emerald-500" : "bg-white border-emerald-300"
                                                  )}
                                                />
                                                <span className="font-mono text-[10px] opacity-40">{segmentLabel}</span>
                                                <span className="flex-1 min-w-0 line-clamp-1 break-words font-medium">{segmentTitle}</span>
                                                {complete ? (
                                                  <CheckCircle2 className="w-3 h-3 text-emerald-500/70" />
                                                ) : step.status === 'loading' ? (
                                                  <Loader2 className="w-3 h-3 animate-spin text-emerald-500/20" />
                                                ) : step.status === 'error' ? (
                                                  <X className="w-3 h-3 text-red-500/50" />
                                                ) : null}
                                              </button>
                                              {step.status === 'error' && (
                                                <button
                                                  onClick={() => handleRetryStep(mod.id, step.id)}
                                                  className="p-2 text-slate-300 hover:text-emerald-600 transition-colors"
                                                  title="Retry generating this step"
                                                >
                                                  <RotateCcw className="w-3 h-3" />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                              {!mod.steps.some((s) => typeof s.lessonNumber === 'number') && mod.steps.map((step, sIdx) => {
                                const fallbackComplete = isStepLearnerComplete(mod.id, step);
                                return (
                                  <div key={step.id} className="flex items-center gap-1 group">
                                    <button
	                                      onClick={() => {
	                                        setActiveModuleId(mod.id);
	                                        setTimeout(() => scrollToStep(step.id), 100);
	                                      }}
	                                      className="flex-1 p-3 text-left text-sm text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-3"
	                                    >
	                                      <span className="font-mono text-[10px] opacity-30">{idx + 1}.{sIdx + 1}</span>
	                                      <span className="flex-1 min-w-0 line-clamp-1 break-words font-medium">{step.title}</span>
	                                      {fallbackComplete ? (
	                                        <CheckCircle2 className="w-3 h-3 text-emerald-500/60" />
                                      ) : step.status === 'loading' ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-emerald-500/20" />
                                      ) : step.status === 'error' ? (
                                        <X className="w-3 h-3 text-red-500/50" />
                                      ) : null}
                                    </button>
                                    {step.status === 'error' && (
                                      <button
                                        onClick={() => handleRetryStep(mod.id, step.id)}
                                        className="p-2 text-slate-300 hover:text-emerald-600 transition-colors"
                                        title="Retry generating this step"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
	                    );
	                  })}
	                  </div>

		                  {isGeneratingModules && (
		                    <div className="m-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-3">
		                      <Sparkles className="w-4 h-4 text-indigo-500" />
		                      <span className="text-xs text-indigo-600 font-medium">{t('planningModuleStructure', locale)}</span>
		                    </div>
		                  )}
		                  </>
		                  ) : (
		                    <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
		                      {courseResources.length ? (
		                        courseResources.map((resource) => (
		                          <a
		                            key={resource.key}
		                            href={resource.url}
		                            target="_blank"
		                            rel="noreferrer"
		                            className="block rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
		                          >
		                            <div className="flex items-start justify-between gap-2">
		                              <div className="min-w-0">
		                                <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">
		                                  {resource.origin} | {resource.kind}
		                                </p>
		                                <p className="text-xs font-semibold text-slate-800 mt-1 line-clamp-2 break-words">
		                                  {resource.title}
		                                </p>
		                                <p className="text-[11px] text-slate-500 mt-1 truncate">{resource.url}</p>
		                              </div>
		                              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
		                            </div>
		                          </a>
		                        ))
		                      ) : (
		                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
		                          <p className="text-sm font-semibold text-slate-700">{t('noResourcesYet', locale)}</p>
		                          <p className="text-xs text-slate-500 mt-2">
		                            {t('resourcesHint', locale)}
		                          </p>
		                        </div>
		                      )}
		                    </div>
		                  )}
		                </div>
		              </div>

              {/* Content Area */}
              <div className="min-w-0">
                <AnimatePresence mode="wait">
                  {activeModule ? (
                    <motion.div
                      key={activeModule.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-12"
                    >
	                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 md:px-5 md:py-4 mb-8 flex items-start md:items-center justify-between gap-4">
	                        <div className="flex items-start md:items-center gap-3 min-w-0">
	                          <button 
	                            onClick={() => setActiveModuleId(null)}
	                            className="p-3 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
	                          >
	                            <ArrowLeft className="w-5 h-5" />
	                          </button>
	                          <div className="min-w-0">
	                            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1 line-clamp-1">{course.title}</p>
	                            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight break-words leading-tight">{activeModule.title}</h2>
	                          </div>
	                        </div>
	                        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 whitespace-nowrap">
	                          Module {Math.max(1, course.modules.findIndex((m) => m.id === activeModule.id) + 1)}
	                        </div>
	                      </div>

                      <div className="rounded-2xl border border-emerald-100 bg-white p-4 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">{t('moduleProgress', locale)}</p>
                          <p className="text-sm text-slate-600 mt-1">
                            {activeModuleProgress.completed}/{activeModuleProgress.total} sub-contents completed ({activeModuleProgress.percent}%)
                          </p>
                        </div>
                        <div className="w-full md:w-64 h-2 bg-emerald-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${activeModuleProgress.percent}%` }} />
                        </div>
                      </div>

                      {activeModule.steps.length === 0 ? (
                        <div className="h-[60vh] flex flex-col items-center justify-center text-center p-12 bg-white border-2 border-dashed border-slate-200 rounded-[48px] shadow-sm">
                          <div className="p-6 bg-slate-50 rounded-3xl mb-8">
                            <AlertCircle className="w-16 h-16 text-slate-200" />
                          </div>
                          <h3 className="text-2xl font-bold text-slate-900 mb-3">This module is not ready yet</h3>
                          <p className="text-slate-500 max-w-md">
                            We could not generate the module lesson steps (usually due to rate limits).
                            Try again, or switch to the sample course.
                          </p>
                          <div className="mt-8 flex items-center gap-3">
                            <button
                              onClick={() => handleRetryModule(activeModule.id)}
                              className="flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl transition-all text-sm font-bold shadow-lg"
                            >
                              <RotateCcw className="w-4 h-4" />
                              Retry Module
                            </button>
                            <button
                              onClick={handleUseSample}
                              className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-slate-600 rounded-2xl transition-all text-sm font-bold shadow-sm"
                            >
                              <BookOpen className="w-4 h-4" />
                              Use Sample
                            </button>
                          </div>
                        </div>
                      ) : (
                        visibleModuleSteps.map((step, idx) => {
                        const content = step.content;
                        const stepTrack = getStepProgress(activeModule.id, step.id);
                        const stepCompletedByInteraction = isStepLearnerComplete(activeModule.id, step);
                        const moduleOrdinal = typeof step.moduleNumber === 'number'
                          ? step.moduleNumber
                          : Math.max(1, course.modules.findIndex((m) => m.id === activeModule.id) + 1);
                        const isStructuredLessonStep = typeof step.lessonNumber === 'number' && typeof step.segmentNumber === 'number';
                        const lessonLabel = typeof step.lessonNumber === 'number'
                          ? `${moduleOrdinal}.${step.lessonNumber}`
                          : `${moduleOrdinal}.${idx + 1}`;
                        const segmentLabel = isStructuredLessonStep
                          ? `${moduleOrdinal}.${step.lessonNumber}.${step.segmentNumber}`
                          : `${moduleOrdinal}.${idx + 1}`;
                        const prevStep = idx > 0 ? visibleModuleSteps[idx - 1] : null;
                        const isLessonStart = !!(isStructuredLessonStep && (!prevStep || prevStep.lessonNumber !== step.lessonNumber));
                        const lessonTitle = stripStructuredStepPrefix(step.lessonTitle || step.title.split(':')[0] || step.title);
                        const displayStepTitle = resolveStepTitle(step);
                        const isFallbackContent = isFallbackModuleContent(content);
                        const fallbackReason = String((content?.data as any)?.generationFallbackReason || '').trim();
                        const resolvedVideoId = content?.type === "VIDEO"
                          ? (extractYouTubeVideoId(content?.data?.videoUrl) || extractYouTubeVideoId(content?.data?.videoWebUrl))
                          : '';
                        const resolvedVideoEmbedUrl = resolvedVideoId
                          ? `https://www.youtube-nocookie.com/embed/${resolvedVideoId}`
                          : '';
                        const resolvedVideoWatchUrl = content?.type === "VIDEO"
                          ? getYouTubeWatchUrl(content?.data?.videoUrl, content?.data?.videoWebUrl)
                          : '';

                        return (
                          <motion.div 
                            key={`${activeModule.id}-${step.id}`} 
                            id={`step-${step.id}`}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="space-y-8 relative group pt-8"
                          >
                            <div className="space-y-4">
                              {isLessonStart && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
                                  <div className="text-[10px] font-mono text-emerald-700 uppercase tracking-widest font-bold">Lesson {lessonLabel}</div>
                                  <h3 className="text-2xl font-bold text-emerald-950 mt-1">{lessonTitle}</h3>
                                </div>
                              )}
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-[10px] text-emerald-600 uppercase tracking-widest font-bold">
                                  {isStructuredLessonStep ? `Section ${segmentLabel}` : `Step ${idx + 1}`}
                                </span>
                                <span
                                  className={cn(
                                    "text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border",
                                    isFallbackContent
                                      ? "bg-orange-50 text-orange-700 border-orange-200"
                                      : stepCompletedByInteraction
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}
                                >
                                  {isFallbackContent ? 'Needs Regeneration' : (stepCompletedByInteraction ? 'Completed' : 'In Progress')}
                                </span>
                                <div className="h-px flex-1 bg-slate-100" />
                              </div>
                              <h4 className="text-3xl font-bold text-slate-900 tracking-tight break-words leading-tight">{displayStepTitle}</h4>
                            </div>

                            {(step.status === 'loading' || step.status === 'generating' || step.status === 'pending') && (
                              <div className="flex flex-col items-center justify-center py-16 space-y-4 bg-slate-50/50 rounded-[32px] border-2 border-dashed border-slate-200">
                                <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
                                <p className="text-xs text-slate-400 font-mono uppercase tracking-widest font-bold">
                                  {step.status === 'pending' ? 'Waiting to start...' : 'Generating Content...'}
                                </p>
                                
                                {retryInfo && (
                                  <motion.div 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-orange-50 border border-orange-100 p-4 rounded-2xl max-w-xs mx-auto shadow-sm"
                                  >
                                    <div className="flex items-center gap-2 text-orange-600 mb-1">
                                      <RotateCcw className="w-3 h-3 animate-spin" />
                                      <span className="text-[10px] font-bold uppercase tracking-wider">Rate Limit Hit</span>
                                    </div>
                                    <p className="text-[10px] text-orange-600/60">
                                      Retrying in {Math.round(retryInfo.delay / 1000)}s... 
                                    </p>
                                  </motion.div>
                                )}
                              </div>
                            )}

                            {step.status === 'error' && (
                              <div className="flex flex-col items-center justify-center py-16 space-y-6 bg-red-50 rounded-[32px] border border-red-100 shadow-sm">
                                <div className="p-4 bg-white rounded-2xl shadow-sm">
                                  <AlertCircle className="w-8 h-8 text-red-500" />
                                </div>
                                <div className="text-center px-6">
                                  <p className="text-slate-900 font-bold mb-1">Failed to generate content</p>
                                  <p className="text-sm text-slate-500">This usually happens due to API quota limits or network issues.</p>
                                </div>
                                <button
                                  onClick={() => handleRetryStep(activeModule.id, step.id)}
                                  className="flex items-center gap-2 px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-all text-sm font-bold shadow-lg"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  Retry Generation
                                </button>
                              </div>
                            )}

                            {step.status === 'completed' && content && (
                              <div className="space-y-8">
                                {isFallbackContent && (
                                  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-orange-800">This section used fallback content.</p>
                                      <p className="text-xs text-orange-700/90 mt-1">
                                        {fallbackReason
                                          ? `Reason: ${fallbackReason.replace(/_/g, ' ')}.`
                                          : 'We are retrying generation to fetch topic-specific content.'}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRetryStep(activeModule.id, step.id)}
                                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-orange-300 bg-white text-orange-800 text-xs font-semibold hover:bg-orange-100 transition-colors"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Regenerate Content
                                    </button>
                                  </div>
                                )}
                                {content.lessonText && (
                                  <div className="prose prose-slate max-w-none text-lg text-slate-600 leading-relaxed">
                                    <Markdown>{formatMarkdown(content.lessonText)}</Markdown>
                                  </div>
                                )}

                                {content.type === "TEXT" && (
                                  <div className="prose prose-slate max-w-none bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                                    <Markdown>{formatMarkdown(content.data.content)}</Markdown>
                                  </div>
                                )}

                                {content.type === "FLIP_CARD" && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                                    {Array.isArray(content.data.cards) ? content.data.cards.map((card: any, cIdx: number) => (
                                      <FlipCard
                                        key={`${step.id}-card-${cIdx}`}
                                        card={card}
                                        onFlipToBack={() => handleFlashcardFlipToBack(activeModule.id, step.id, cIdx, content.data.cards.length)}
                                      />
                                    )) : null}
                                  </div>
                                )}

                                {content.type === "FLIP_CARD" && (
                                  <div className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                                    Flashcards viewed: {stepTrack.flashcardsViewed || 0}/{stepTrack.flashcardsTotal || (Array.isArray(content?.data?.cards) ? content.data.cards.length : 0)}
                                  </div>
                                )}

                                {content.type === "ACCORDION" && content.data.items && (
                                  <CiscoAccordion items={content.data.items} />
                                )}

                                {content.type === "HOTSPOT" && content.data.points && (
                                  <CiscoHotspot 
                                    image={content.data.image} 
                                    points={content.data.points} 
                                  />
                                )}

                                {content.type === "CAROUSEL" && content.data.slides && (
                                  <CiscoCarousel slides={content.data.slides} />
                                )}

                                {content.type === "POP_CARD" && content.data.cards && (
                                  <CiscoPopCards cards={content.data.cards} />
                                )}

                                {content.type === "LEARNING_CARD" && content.data.learningCards && (
                                  <CiscoLearningCard cards={content.data.learningCards} />
                                )}

                                {content.type === "QUIZ" && (
                                  <div className="bg-slate-50 border border-slate-200 rounded-[32px] p-5 md:p-6 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4 text-emerald-600">
                                      <div className="p-2 bg-emerald-100 rounded-lg">
                                        <Layout className="w-5 h-5" />
                                      </div>
                                      <span className="font-mono text-xs uppercase tracking-widest font-bold">
                                        {activeModule.steps[activeModule.steps.length - 1]?.id === step.id ? "Final Module Assessment" : "Knowledge Check"}
                                      </span>
                                    </div>
                                    <Quiz 
                                      key={`quiz-${activeModule.id}-${step.id}`}
                                      topicLabel={stripStructuredStepPrefix(String(content?.title || step.title || '').replace(/^quiz\s*:\s*/i, '').trim())}
                                      questions={Array.isArray(content.data.questions) ? content.data.questions : []} 
                                      onComplete={({ passed, score, percentage }) => {
                                        const isFinalAssessment = activeModule.steps[activeModule.steps.length - 1]?.id === step.id;
                                        handleQuizResult(activeModule.id, step.id, { passed, score, percentage }, isFinalAssessment);
                                      }}
                                    />
                                  </div>
                                )}

                                {content.type === "DRAG_FILL" && (
  <div className="space-y-6">
    {Array.isArray(content.data?.challenges)
      ? content.data.challenges.map((challenge: any, chIdx: number) => (
          <DragFillChallenge
            key={`${step.id}-challenge-${chIdx}`}
            challenge={challenge}
            onComplete={(isCorrect) => handleDragFillResult(activeModule.id, step.id, chIdx, isCorrect, content.data.challenges.length)}
          />
        ))
      : null}
  </div>
)}

                                {content.type === "DRAG_FILL" && (
                                  <div className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                                    Challenges solved: {stepTrack.dragFillCompleted || 0}/{stepTrack.dragFillTotal || (Array.isArray(content?.data?.challenges) ? content.data.challenges.length : 0)}
                                  </div>
                                )}

                                {content.type === "CODE_BUILDER" && content.data.codeBuilder && (
                                  <CodeBuilder 
                                    key={`code-${activeModule.id}-${step.id}`}
                                    data={content.data.codeBuilder} 
                                    onComplete={() => handleCodeBuilderComplete(activeModule.id, step.id)} 
                                  />
                                )}

                                {content.type === "VIDEO" && (
                                  <div className="space-y-6">
                                    {resolvedVideoEmbedUrl ? (
                                      <div className="aspect-video bg-slate-900 rounded-[32px] overflow-hidden border border-slate-200 shadow-xl relative group">
                                        <iframe
                                          src={`${resolvedVideoEmbedUrl}?rel=0&modestbranding=1`}
                                          title={content.data.videoTitle || content.title}
                                          className="w-full h-full"
                                          loading="lazy"
                                          referrerPolicy="strict-origin-when-cross-origin"
                                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                          allowFullScreen
                                        />
                                        {resolvedVideoWatchUrl ? (
                                          <a
                                            href={resolvedVideoWatchUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="absolute bottom-3 right-3 px-3 py-1.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest bg-white/90 hover:bg-white text-slate-700 shadow"
                                          >
                                            Open on YouTube -&gt;
                                          </a>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div className="p-8 rounded-3xl border border-amber-200 bg-amber-50 text-amber-900">
                                        <p className="text-sm font-semibold">Video embed unavailable for this step.</p>
                                        <p className="text-xs mt-2 text-amber-800/80">
                                          The generated URL was invalid. Retry this step to fetch a valid video.
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleRetryStep(activeModule.id, step.id)}
                                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-300 bg-white text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5" />
                                          Retry Video URL
                                        </button>
                                      </div>
                                    )}
                                    <div className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm">
                                      <h4 className="text-2xl font-bold mb-4 text-slate-900 break-words">{content.data.videoTitle || content.title}</h4>
                                      {resolvedVideoWatchUrl ? (
                                        <p className="text-xs text-slate-400 mb-3">
                                          If playback fails in the embed, use "Open on YouTube".
                                        </p>
                                      ) : null}
                                      <div className="prose prose-slate prose-sm max-w-none text-slate-600">
                                        <Markdown>{content.data.content}</Markdown>
                                      </div>
                                      <div className="mt-6 flex flex-wrap items-center gap-3">
                                        <button
                                          type="button"
                                          onClick={() => handleVideoCompletionToggle(activeModule.id, step.id, !stepTrack.videoCompleted)}
                                          className={cn(
                                            "px-4 py-2 rounded-xl text-xs font-semibold border transition-colors",
                                            stepTrack.videoCompleted
                                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                                          )}
                                        >
                                          {stepTrack.videoCompleted ? 'Video Completed' : 'Mark Video as Completed'}
                                        </button>
                                        <span className="text-xs text-slate-400">
                                          Completion tracking is based on your confirmation.
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Edit Content Trigger */}
                            {step.status === 'completed' && content && (
                              <div className="flex justify-end mt-6">
                                <button
                                  type="button"
                                  disabled={!isOnline}
                                  onClick={() => setEditingStepId(editingStepId === step.id ? null : step.id)}
                                  className={cn(
                                    "flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border transition-all text-[10px] font-mono uppercase tracking-widest font-bold shadow-sm",
                                    isOnline
                                      ? "border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-500/50"
                                      : "border-slate-200 text-slate-300 cursor-not-allowed"
                                  )}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  {isOnline ? 'About this content' : t('aiEditOnlineOnly', locale)}
                                </button>
                              </div>
                            )}
                          </motion.div>
                        );
                      })
                      )}
                    </motion.div>
                  ) : (
                    <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center p-12 bg-white border-2 border-dashed border-slate-200 rounded-[48px] shadow-sm">
                      <div className="p-6 bg-slate-50 rounded-3xl mb-8">
                        <BookOpen className="w-16 h-16 text-slate-200" />
                      </div>
                      <h3 className="text-3xl font-bold text-slate-900 mb-4">{t('selectModuleToBegin', locale)}</h3>
                      <p className="text-slate-500 max-w-sm text-lg leading-relaxed">
                        Dive into the interactive lessons and challenges generated specifically for your goals.
                      </p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </main>
    </div>
  );
}
