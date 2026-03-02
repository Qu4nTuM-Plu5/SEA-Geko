/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Play,
  Sparkles,
  Lock,
  Edit3,
  RotateCcw,
  Plus,
  Minus,
  X,
  AlertCircle,
  Upload,
  FileText
} from 'lucide-react';
import Markdown from 'react-markdown';
import { aiService } from './services/aiService';
import { Course, AssessmentQuestion, Module, ContentType, ModuleContent } from './types';
import { SAMPLE_COURSE } from './constants';
import { cn } from './lib/utils';
import { Quiz } from './components/Quiz';
import { FlipCard } from './components/FlipCard';
import { DragFillChallenge } from './components/DragFillChallenge';
import { CodeBuilder } from './components/CodeBuilder';
import { Avatar } from './components/Avatar';
import { GenerationFlow } from './components/GenerationFlow';
import { ContentEditor } from './components/ContentEditor';
import { CiscoAccordion, CiscoHotspot, CiscoCarousel, CiscoLearningCard } from './components/CiscoComponents';

type AppState = 'idle' | 'assessing' | 'planning' | 'generating_content' | 'learning';

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
  lastUpdated?: string;
};

type MascotToastState = {
  id: number;
  title: string;
  subtitle: string;
  mood: 'happy' | 'sad' | 'idle';
};

type MascotMood = 'happy' | 'sad' | 'idle';

const SEA_GEKO_ASSETS = {
  happy: [
    '/mascot/good-job.png',
    '/mascot/sea-geko-good-job.png',
    '/mascot/sea-geko-happy.png',
    '/mascot/sea-geko-happy.svg',
  ],
  sad: [
    '/mascot/sea-geko-sad.png',
    '/mascot/sad.png',
    '/mascot/sea-geko-cry.png',
    '/mascot/sea-geko-sad.svg',
  ],
  idle: [
    '/mascot/sea-geko-icon.png',
    '/mascot/sea-geko-idle.png',
    '/mascot/icon.png',
    '/mascot/idle.png',
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

const getYouTubeWatchUrl = (videoUrl?: string, videoWebUrl?: string) => {
  const id = extractYouTubeVideoId(videoWebUrl) || extractYouTubeVideoId(videoUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
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
    const id = extractYouTubeVideoId(data.videoWebUrl) || extractYouTubeVideoId(data.videoUrl);
    out.data.videoUrl = id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    out.data.videoWebUrl = id ? `https://www.youtube.com/watch?v=${id}` : '';
  }

  if (type === 'FLIP_CARD') {
    const cards = Array.isArray(data.cards) ? data.cards : [];
    out.data.cards = cards.map((card: any) => ({
      ...card,
      imageUrl: /^https?:\/\//i.test(String(card?.imageUrl || '')) ? card.imageUrl : '',
    }));
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
          const moduleNumberHint = m.steps.find((step) => typeof step.moduleNumber === 'number')?.moduleNumber || idx + 1;
          const steps = Array.isArray(m.steps)
            ? m.steps.map((s) => {
                const step = s.content ? { ...s, content: sanitizeModuleContent(s.content, s.title) } : s;
                const c: any = (step as any)?.content;
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
    default:
      return `${defaultSegmentLabelByType(type)}: ${topic}`;
  }
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
  const numbered: Module['steps'] = [];

  for (const step of steps) {
    const resolvedType = (!programmingTrack && step.type === ContentType.CODE_BUILDER)
      ? ContentType.DRAG_FILL
      : step.type;
    const rawTitle = stripStructuredStepPrefix(step.title || '');
    const lessonHint = (() => {
      if (rawTitle.includes(':')) return rawTitle.split(':')[0].trim();
      const m = rawTitle.match(/^(lesson\s*\d+)\s*[-:]\s*(.+)$/i);
      if (m?.[2]) return m[2].trim();
      return '';
    })();
    const startNewLesson =
      numbered.length === 0 ||
      resolvedType === ContentType.TEXT ||
      segmentNumber >= 6 ||
      (!!lessonHint && lessonHint !== lessonTitle);

    if (startNewLesson) {
      lessonNumber += 1;
      segmentNumber = 1;
      lessonTitle = buildLessonTitle(lessonHint || `Lesson ${lessonNumber}`, moduleTitle, lessonNumber);
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
        { type: ContentType.ACCORDION, segmentLabel: 'Concept breakdown' },
        { type: ContentType.DRAG_FILL, segmentLabel: 'Gamified challenge' },
        { type: ContentType.QUIZ, segmentLabel: 'Quiz' },
      ];

  const moduleNumber = steps.find((step) => typeof step.moduleNumber === 'number')?.moduleNumber || 1;
  const groups = groupModuleStepsByLesson(steps);
  const complete: Module['steps'] = [];
  let cursor = 1;

  for (const group of groups) {
    const lessonNumber = group.lessonNumber;
    const lessonTitle = buildLessonTitle(String(group.lessonTitle || `Lesson ${lessonNumber}`).trim() || `Lesson ${lessonNumber}`, moduleTitle, lessonNumber);
    const bucket = new Map<ContentType, Module['steps'][number]>();
    const extras: Module['steps'][number][] = [];

    for (const { step } of group.steps) {
      const normalizedType = (!programmingTrack && step.type === ContentType.CODE_BUILDER)
        ? ContentType.DRAG_FILL
        : step.type;
      const normalizedStep: Module['steps'][number] = normalizedType === step.type
        ? step
        : {
            ...step,
            type: normalizedType,
            segmentLabel: defaultSegmentLabelByType(normalizedType),
            title: buildSubContentTitle(lessonTitle, normalizedType),
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

      complete.push(
        existing
          ? {
              ...existing,
              title: baseTitle,
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
      const extraTitle = extraTitleRaw.includes(':')
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

  return ensureUniqueStepIds(complete, moduleNumber);
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

  if (contentTitle && !['video lesson', 'flashcards', 'learning cards', 'quiz'].includes(contentTitle.toLowerCase())) {
    return contentTitle;
  }

  if (segmentLabel) return segmentLabel;

  const fallback = stripStructuredStepPrefix(step.title).split(':').slice(1).join(':').trim() || stripStructuredStepPrefix(step.title);
  return fallback || step.title;
};

const normalizePromptDraft = (value: string) => {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([!?.,])\1{2,}/g, '$1$1');
};

const normalizePromptInput = (value: string) => normalizePromptDraft(value).trim();

const getPromptValidationError = (value: string): string | null => {
  const prompt = normalizePromptInput(value);
  if (!prompt) return 'Enter a topic before generating.';
  if (prompt.length < 3) return 'Topic is too short. Add more detail.';

  const chars = prompt.replace(/\s/g, '');
  const letters = (chars.match(/[A-Za-z]/g) || []).length;
  const symbols = (chars.match(/[^A-Za-z0-9]/g) || []).length;
  const repeatedChars = /(.)\1{5,}/.test(prompt);

  if (!/[A-Za-z0-9]/.test(prompt)) return 'Use words or numbers to describe a real topic.';
  if (repeatedChars) return 'Input looks invalid. Please enter a clear learning topic.';
  if (chars.length >= 6 && letters > 0 && symbols / chars.length > 0.45) {
    return 'Input has too many symbols. Use plain words for the topic.';
  }

  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length <= 2) return 'Add a more specific topic.';

  const asciiWords = words.filter((w) => /^[A-Za-z]+$/.test(w));
  const noVowelPattern = asciiWords.length >= 2 && asciiWords.every((w) => w.length >= 4 && !/[aeiou]/i.test(w));
  if (noVowelPattern) return 'Input looks like gibberish. Try a readable topic.';

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

export default function App() {
  const normalizeProvider = (value: string): ProviderId => {
    if (value === 'gemini' || value === 'openai' || value === 'anthropic' || value === 'openrouter') {
      return value;
    }
    return 'auto';
  };

  const [state, setState] = useState<AppState>('idle');
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
  const [outlineBuilderSource, setOutlineBuilderSource] = useState<'manual' | 'auto'>('manual');
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isAutoDraftingOutline, setIsAutoDraftingOutline] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [shakePrompt, setShakePrompt] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: number; type: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const outlineTitleInputRef = useRef<HTMLInputElement | null>(null);
  const outlineScrollRef = useRef<HTMLDivElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);

  const [assessment, setAssessment] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
    try {
      const raw = localStorage.getItem('nexus_router_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        return cfg.model || 'auto';
      }
      const mode = localStorage.getItem('nexus_model_mode');
      const manual = localStorage.getItem('nexus_model_manual');
      return mode === 'manual' && manual ? manual : 'auto';
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

  const getStepProgress = (moduleId: string, stepId: string): StepInteractionProgress => {
    return interactionProgress[stepProgressKey(moduleId, stepId)] || {};
  };

  const isStepLearnerComplete = (moduleId: string, step: Module['steps'][number]): boolean => {
    if (step.status !== 'completed') return false;
    const track = getStepProgress(moduleId, step.id);
    const content: any = step.content || {};
    const cardTotal = Array.isArray(content?.data?.cards) ? content.data.cards.length : 0;
    const dragTotal = Array.isArray(content?.data?.challenges) ? content.data.challenges.length : 0;

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
    return true;
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

  const scrollToStep = (stepId: string) => {
    const element = document.getElementById(`step-${stepId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    // Load progress from local storage
    const saved = localStorage.getItem('nexus_progress');
    if (saved) {
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
      } = JSON.parse(saved);
      
      setPoints(p || 0);
      setStreak(s || 0);
      if (c) setCourse(sanitizeCourse(c));
      if (st) setState(st);
      if (am) setActiveModuleId(am);
      if (am) setExpandedModuleId(am);
      if (as) setAssessment(as);
      if (an) setAnswers(an);
      if (cai !== undefined) setCurrentAssessmentIdx(cai);
      if (pr) setPrompt(pr);
      if (ip && typeof ip === 'object') setInteractionProgress(ip);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('nexus_progress', JSON.stringify({ 
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
      let candidates = ['gemini-3-flash-preview', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      const existing = localStorage.getItem('nexus_model_candidates');
      if (existing) {
        const parsed = existing.split(',').map(s => s.trim()).filter(Boolean);
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
    const t = window.setTimeout(() => setMascotToast(null), 3400);
    return () => window.clearTimeout(t);
  }, [mascotToast]);

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

  const addPoints = (amount: number) => {
    setPoints(prev => prev + amount);
  };

  const handleReset = () => {
    if (confirm("Are you sure you want to reset your progress and start a new course?")) {
      setState('idle');
      setCourse(null);
      setAssessment([]);
      setAnswers({});
      setCurrentAssessmentIdx(0);
      setActiveModuleId(null);
      setActiveLessonByModule({});
      setExpandedModuleId(null);
      setPrompt('');
      setPromptError(null);
      setAttachedFiles([]);
      setInteractionProgress({});
      setIsComposerMenuOpen(false);
      setIsOutlineBuilderOpen(false);
      setUseOutlineMode(false);
      setGlobalError(null);
      localStorage.removeItem('nexus_progress');
    }
  };

  const handleUseSample = () => {
    setCourse(SAMPLE_COURSE);
    setState('generating_content');
    setActiveModuleId(SAMPLE_COURSE.modules[0].id);
    setExpandedModuleId(SAMPLE_COURSE.modules[0].id);
    setGlobalError(null);
    setRetryInfo(null);
    setPromptError(null);
    setAttachedFiles([]);
    setInteractionProgress({});
    setIsComposerMenuOpen(false);
    setIsOutlineBuilderOpen(false);
    setUseOutlineMode(false);
  };


  const downloadCoursePack = () => {
    try {
      const pack = {
        version: 1,
        savedAt: new Date().toISOString(),
        progress: {
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
        },
        router: (() => {
          try { return JSON.parse(localStorage.getItem('nexus_router_config') || '{}'); } catch { return {}; }
        })(),
      };

      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-course-pack-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export pack.');
    }
  };

  const triggerImportCoursePack = () => {
    fileInputRef.current?.click();
  };

  const triggerAttachmentPicker = () => {
    setIsComposerMenuOpen(false);
    attachmentInputRef.current?.click();
  };

  const closeOutlineBuilder = () => {
    setIsOutlineBuilderOpen(false);
    setUseOutlineMode(false);
  };

  const openManualOutlineBuilder = () => {
    setIsComposerMenuOpen(false);
    setOutlineBuilderSource('manual');
    setUseOutlineMode(true);
    setIsOutlineBuilderOpen(true);
    setPromptError(null);
    setGlobalError(null);
  };

  const handleAttachmentInputChange = (files: FileList | null) => {
    const picked = files ? Array.from(files) : [];
    if (!picked.length) return;

    const normalized = picked.slice(0, 8).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || 'file',
    }));

    setAttachedFiles((prev) => {
      const merged = [...prev, ...normalized];
      const uniq = merged.filter((f, idx) => merged.findIndex((x) => x.name === f.name && x.size === f.size) === idx);
      return uniq.slice(0, 8);
    });

    setPrompt((prev) => {
      const clean = normalizePromptDraft(prev);
      if (clean.trim()) return clean;
      const firstName = normalized[0]?.name || 'your files';
      return `Create a course using context from ${firstName}`;
    });

    setPromptError(null);
  };

  const removeAttachedFile = (fileName: string) => {
    setAttachedFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const handleCreateAutoOutlineDraft = async () => {
    const normalizedPrompt = normalizePromptInput(prompt);
    if (normalizedPrompt !== prompt) setPrompt(normalizedPrompt);

    const validation = getPromptValidationError(normalizedPrompt);
    if (validation) {
      setPromptError(validation);
      setShakePrompt(true);
      setIsComposerMenuOpen(false);
      promptInputRef.current?.focus();
      return;
    }

    if (!isOnline) {
      setGlobalError('You are offline. Auto-outline requires network access. Use manual outline mode instead.');
      setIsComposerMenuOpen(false);
      return;
    }

    setIsComposerMenuOpen(false);
    setIsAutoDraftingOutline(true);
    setPromptError(null);
    setGlobalError(null);
    setRetryInfo(null);

    try {
      const draft = await aiService.generateCourseOutline(normalizedPrompt, {}, (attempt, delay) => {
        setRetryInfo({ attempt, delay });
      });
      setOutlineTitle(draft.title?.trim() || normalizedPrompt);
      setOutlineModules(convertOutlineDraftToEditableModules(draft));
      setOutlineBuilderSource('auto');
      setUseOutlineMode(true);
      setIsOutlineBuilderOpen(true);
    } catch (error: any) {
      setGlobalError(aiService.formatError(error));
    } finally {
      setIsAutoDraftingOutline(false);
      setRetryInfo(null);
    }
  };

  const importCoursePack = async (file: File) => {
    try {
      const raw = await file.text();
      const pack = JSON.parse(raw);

      const p = pack?.progress || {};
      setPoints(p.points || 0);
      setStreak(p.streak || 0);
      setCourse(sanitizeCourse(p.course || null));
      setState(p.state || 'idle');
      setActiveModuleId(p.activeModuleId || null);
      setExpandedModuleId(p.activeModuleId || null);
      setAssessment(p.assessment || []);
      setAnswers(p.answers || {});
      setCurrentAssessmentIdx(p.currentAssessmentIdx || 0);
      setPrompt(p.prompt || '');
      setInteractionProgress((p.interactionProgress && typeof p.interactionProgress === 'object') ? p.interactionProgress : {});

      if (pack?.router) {
        localStorage.setItem('nexus_router_config', JSON.stringify(pack.router));
      }

      localStorage.setItem('nexus_progress', JSON.stringify({
        points: p.points || 0,
        streak: p.streak || 0,
        course: p.course || null,
        state: p.state || 'idle',
        activeModuleId: p.activeModuleId || null,
        assessment: p.assessment || [],
        answers: p.answers || {},
        currentAssessmentIdx: p.currentAssessmentIdx || 0,
        prompt: p.prompt || '',
        interactionProgress: (p.interactionProgress && typeof p.interactionProgress === 'object') ? p.interactionProgress : {},
      }));

      alert('Imported course pack!');
    } catch {
      alert('Invalid pack file.');
    }
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
        title: programmingTrack ? `Practice Coding: ${moduleTitle}` : `Concept Breakdown: ${moduleTitle}`,
        type: programmingTrack ? ContentType.CODE_BUILDER : ContentType.ACCORDION,
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
      const m = tLine.match(/course outline\s*[:\-–—]\s*(.*)$/i);
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
        .replace(/module\s*\d+\s*[:\-–—]?\s*/i, '')
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
        description: desc.slice(0, 4).join(' • ') || 'Interactive lessons and practice.'
      });
    }

    const course: Course = {
      title,
      description: descriptionParts.slice(0, 6).join(' • ') || 'Interactive, Duolingo-style learning path.',
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
    setInteractionProgress({});
    setState('learning');
    setActiveModuleId(c.modules[0]?.id || null);
    setExpandedModuleId(c.modules[0]?.id || null);
    setGlobalError(null);
    setRetryInfo(null);
  };

  const startFromStructuredOutline = () => {
    const c = buildStructuredOutlineCourse(outlineTitle || prompt, outlineModules);
    setCourse(c);
    setInteractionProgress({});
    setState('learning');
    setActiveModuleId(c.modules[0]?.id || null);
    setExpandedModuleId(c.modules[0]?.id || null);
    setGlobalError(null);
    setRetryInfo(null);
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
    setPromptError(null);
    startFromStructuredOutline();
    closeOutlineBuilder();
  };

  const handleStart = async () => {
    const normalizedPrompt = normalizePromptInput(prompt);
    if (normalizedPrompt !== prompt) setPrompt(normalizedPrompt);

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
      setGlobalError('You are offline. Import a saved course pack, use a sample course, or switch to outline mode (structure works offline).');
      return;
    }

    const attachedContext = attachedFiles.length
      ? ` (context files: ${attachedFiles.map((file) => file.name).join(', ')})`
      : '';
    const topicForGeneration = `${normalizedPrompt}${attachedContext}`;

    setPromptError(null);
    setInteractionProgress({});
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

  const handleAnswer = (answer: string) => {
    const q = assessment[currentAssessmentIdx];
    setAnswers(prev => ({ ...prev, [q.question]: answer }));
    
    if (currentAssessmentIdx < assessment.length - 1) {
      setCurrentAssessmentIdx(prev => prev + 1);
    } else {
      handleGeneratePlan();
    }
  };

  const handleGeneratePlan = async () => {
    const normalizedPrompt = normalizePromptInput(prompt);
    if (normalizedPrompt !== prompt) setPrompt(normalizedPrompt);
    const attachedContext = attachedFiles.length
      ? ` (context files: ${attachedFiles.map((file) => file.name).join(', ')})`
      : '';
    const topicForPlan = `${normalizedPrompt}${attachedContext}`;

    setState('planning');
    setGlobalError(null);
    setRetryInfo(null);
    
    // Initial breathing room
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      const plan = await aiService.generateCourseOutline(topicForPlan, answers, (attempt, delay) => {
        setRetryInfo({ attempt, delay });
      });
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
      setState('generating_content');
      generateAllModuleContent(initializedPlan);
    } catch (error: any) {
      console.error(error);
      setGlobalError(aiService.formatError(error));
      setState('idle');
    } finally {
      setRetryInfo(null);
    }
  };

  const generateAllModuleContent = async (plan: Course) => {
    setIsGeneratingModules(true);
    
    // Initial delay to avoid bursting immediately after outline generation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Process modules sequentially to generate STRUCTURE only
    for (const [modIdx, mod] of plan.modules.entries()) {
      try {
        setCourse(prev => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map(m =>
              m.id === mod.id ? { ...m, status: 'generating' as const } : m
            )
          };
        });

        // Add a small delay between modules
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 1. Generate Lesson Plan (Structure) for this module
        const steps = await aiService.generateModuleLessonPlan(plan.title, mod.title, mod.description, (attempt, delay) => {
          setRetryInfo({ attempt, delay });
        });
        const initialSteps = ensureLessonStepCoverage(normalizeGeneratedLessonSteps(steps, modIdx + 1, mod.title), mod.title, plan.title);
        
        setCourse(prev => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map(m => 
              m.id === mod.id ? { ...m, steps: initialSteps, status: 'completed' as const } : m
            )
          };
        });

        // Auto-select the first module if none is active
        setActiveModuleId(current => current || mod.id);
        setExpandedModuleId(current => current || mod.id);

        // We no longer generate all step content upfront to save quota.
        // Content will be generated on-demand when the user views the step.

      } catch (e) {
        console.error(`Failed to generate lesson plan for ${mod.title}`, e);
        setCourse(prev => {
          if (!prev) return null;
          return {
            ...prev,
            modules: prev.modules.map(m => 
              m.id === mod.id ? { ...m, status: 'error' as const } : m
            )
          };
        });
      }
    }

    setIsGeneratingModules(false);
  };

  const handleRetryModule = async (moduleId: string) => {
    if (!course) return;
    const mod = course.modules.find(m => m.id === moduleId);
    if (!mod) return;
    setInteractionProgress((prev) => {
      const next: Record<string, StepInteractionProgress> = {};
      const prefix = `${moduleId}:`;
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) next[key] = value;
      }
      return next;
    });

    // Mark as generating
    setCourse(prev => {
      if (!prev) return null;
      return {
        ...prev,
        modules: prev.modules.map(m => m.id === moduleId ? { ...m, status: 'generating' as const } : m)
      };
    });

    try {
      const steps = await aiService.generateModuleLessonPlan(course.title, mod.title, mod.description, (attempt, delay) => {
        setRetryInfo({ attempt, delay });
      });
      const moduleIndex = Math.max(0, course.modules.findIndex((m) => m.id === moduleId));
      const initialSteps = ensureLessonStepCoverage(normalizeGeneratedLessonSteps(steps, moduleIndex + 1, mod.title), mod.title, course.title);
      
      setCourse(prev => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map(m => 
            m.id === moduleId ? { ...m, steps: initialSteps, status: 'completed' as const } : m
          )
        };
      });
    } catch (e) {
      console.error(`Failed to retry module ${mod.title}`, e);
      setCourse(prev => {
        if (!prev) return null;
        return {
          ...prev,
          modules: prev.modules.map(m => m.id === moduleId ? { ...m, status: 'error' as const } : m)
        };
      });
    } finally {
      setRetryInfo(null);
    }
  };

  const handleModuleComplete = (moduleId: string) => {
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
      const content = await aiService.generateStepContent(
        course.title,
        mod.title,
        step.title,
        step.type,
        { referenceContext: buildStepReferenceContext(mod, step.id) },
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

          // Small delay to respect quota
          await new Promise(resolve => setTimeout(resolve, 2000));

          const content = await aiService.generateStepContent(
            course.title,
            activeModule.title,
            pendingStep.title,
            pendingStep.type,
            { referenceContext: buildStepReferenceContext(activeModule, pendingStep.id) },
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
  }, [course, activeModuleId, isGeneratingModules]);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-500/30">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0">
        <div className={cn(
          "mx-auto px-6 h-16 flex items-center justify-between",
          state === 'learning' ? "max-w-[1700px]" : "max-w-5xl"
        )}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <MascotImage mood="idle" alt="SEA-Geko" className="w-full h-full object-contain" />
            </div>
            <span className="font-bold tracking-tight text-slate-900">SEA-Geko</span>
            {state === 'learning' && course ? (
              <>
                <span className="hidden md:inline text-slate-300">|</span>
                <span className="hidden md:inline text-sm text-slate-600 truncate max-w-[520px]">{course.title}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            {state !== 'idle' && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={downloadCoursePack}
                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors px-3 py-1.5 border border-slate-200 rounded-full bg-white"
                >
                  Export
                </button>
                <button 
                  onClick={triggerImportCoursePack}
                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors px-3 py-1.5 border border-slate-200 rounded-full bg-white"
                >
                  Import
                </button>
                <button 
                  onClick={handleReset}
                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors px-3 py-1.5 border border-slate-200 rounded-full bg-white"
                >
                  Reset
                </button>
              </div>
            )}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-900/5 border border-slate-900/10 rounded-full">
              <span className={cn(
                "w-2 h-2 rounded-full",
                isOnline ? "bg-emerald-500" : "bg-red-500"
              )} />
              <span className="text-xs font-bold text-slate-600">{isOnline ? "Online" : "Offline"}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/10 rounded-full">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-600">{points} XP</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/5 border border-orange-500/10 rounded-full">
              <Play className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
              <span className="text-xs font-bold text-orange-500">{streak}</span>
            </div>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importCoursePack(f);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.pdf,.txt,.md,.markdown,.csv,.json,.doc,.docx"
        onChange={(e) => {
          handleAttachmentInputChange(e.target.files);
          e.currentTarget.value = '';
        }}
      />

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
              className="relative w-full max-w-2xl rounded-3xl border border-emerald-100 bg-white p-6 md:p-7 shadow-2xl shadow-emerald-500/20"
            >
              <div className="flex items-center gap-4">
                <MascotImage
                  mood={mascotToast.mood}
                  alt="SEA-Geko feedback"
                  className="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-contain shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">{mascotToast.title}</p>
                  <p className="text-base md:text-lg text-slate-500 mt-1 leading-relaxed">{mascotToast.subtitle}</p>
                </div>
                <button
                  onClick={() => setMascotToast(null)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
                  aria-label="Dismiss message"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={cn(
        "relative z-10 mx-auto px-4 md:px-6 py-8 md:py-12",
        state === 'learning' ? "max-w-[1700px]" : "max-w-5xl"
      )}>
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[70vh] text-center"
            >
              <div className="mb-8 p-3 bg-emerald-500/5 rounded-3xl">
                <MascotImage mood="idle" alt="SEA-Geko mascot" className="w-14 h-14 rounded-2xl object-contain" />
              </div>
              <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-6 bg-gradient-to-b from-slate-900 to-slate-600 bg-clip-text text-transparent">
                What do you want to <br /> master today?
              </h1>
              <p className="text-xl text-slate-500 mb-12 max-w-2xl">
                SEA-Geko crafts personalized, interactive learning paths in seconds. 
                Enter a topic to begin your journey.
              </p>
              
              <div className="w-full max-w-4xl">
                <div className={cn(
                  "bg-white border rounded-[32px] p-3 md:p-4 shadow-xl shadow-slate-200/50 flex flex-col gap-3 transition-all",
                  promptError ? "border-red-200" : "border-slate-200",
                  shakePrompt && "shake"
                )}>
                  <div className="flex items-center gap-2">
                    <div ref={composerMenuRef} className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsComposerMenuOpen((v) => !v)}
                        className={cn(
                          "h-12 w-12 rounded-2xl border flex items-center justify-center transition-all",
                          isComposerMenuOpen
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                        )}
                        title="Open actions"
                      >
                        <Plus className={cn("w-5 h-5 transition-transform", isComposerMenuOpen && "rotate-45")} />
                      </button>

                      <AnimatePresence>
                        {isComposerMenuOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            className="absolute left-0 top-full mt-3 z-50 w-72 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-xl shadow-2xl p-2 text-left"
                          >
                            <button
                              type="button"
                              onClick={triggerAttachmentPicker}
                              className="w-full rounded-xl px-3 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-3"
                            >
                              <div className="h-8 w-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
                                <Upload className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">Add photos & files</p>
                                <p className="text-xs text-slate-500">Attach context to your prompt</p>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={handleCreateAutoOutlineDraft}
                              disabled={isAutoDraftingOutline}
                              className="w-full rounded-xl px-3 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-3 disabled:opacity-60"
                            >
                              <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                <Sparkles className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">Course Outline (Auto)</p>
                                <p className="text-xs text-slate-500">Generate with AI, then edit</p>
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
                      placeholder={isOutlineBuilderOpen ? "Optional topic hint (outline is open)" : "e.g. Master Python for Data Science"}
                      className="flex-1 bg-transparent px-2 md:px-4 py-3 text-lg md:text-xl focus:outline-none placeholder:text-slate-300 min-w-0"
                    />

                    <button
                      onClick={handleStart}
                      disabled={isAutoDraftingOutline}
                      className="relative overflow-hidden px-8 py-3 md:py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-70 disabled:cursor-wait text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 flex-shrink-0"
                    >
                      {isAutoDraftingOutline ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      {isAutoDraftingOutline ? 'Drafting...' : 'Generate'}
                      {isAutoDraftingOutline ? (
                        <motion.span
                          initial={{ x: '-110%' }}
                          animate={{ x: '120%' }}
                          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                          className="absolute inset-y-0 w-16 bg-white/30 blur-xl"
                        />
                      ) : null}
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

                  {attachedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-1">
                      {attachedFiles.map((file) => (
                        <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs">
                          <FileText className="w-3.5 h-3.5" />
                          <span className="max-w-[220px] truncate">{file.name}</span>
                          <button
                            type="button"
                            className="text-slate-400 hover:text-slate-700"
                            onClick={() => removeAttachedFile(file.name)}
                            title="Remove file"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

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
                </div>

                <AnimatePresence>
                  {isOutlineBuilderOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[95] bg-slate-900/30 backdrop-blur-sm p-2 md:p-8 flex items-end md:items-center justify-center"
                      onClick={(e) => {
                        if (e.target === e.currentTarget) closeOutlineBuilder();
                      }}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.98 }}
                        className="w-full max-w-6xl max-h-[90vh] bg-white border border-slate-200 rounded-[28px] shadow-2xl flex flex-col overflow-hidden text-left"
                      >
                        <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-600">
                              {outlineBuilderSource === 'auto' ? 'AI Draft + Editor' : 'Manual Builder'}
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
                            Outline mode skips assessment and starts directly from this curriculum.
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
                              Generate Course
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-6 flex items-center gap-2 text-slate-400 text-sm">
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

          {state === 'assessing' && assessment.length === 0 && (
            <motion.div 
              key="assessing-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-2xl mx-auto"
            >
              {!globalError && !retryInfo && <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-8" />}
              
              <h2 className="text-4xl font-bold text-slate-900 mb-4">
                {globalError ? "Assessment Paused" : "Preparing your assessment..."}
              </h2>
              <p className="text-slate-500 text-lg mb-12">
                {globalError ? "We encountered an issue while tailoring your questions." : "Tailoring questions to your specific goals."}
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
                      <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest">OR</span>
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
                      Explore Sample Course
                    </button>
                  </div>
                  
                  <button
                    onClick={() => {
                      setState('idle');
                      setGlobalError(null);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-4"
                  >
                    Go back to home
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
                      onClick={() => handleAnswer(opt)}
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
                      className="w-full bg-white border border-slate-200 rounded-2xl p-6 text-lg focus:outline-none focus:ring-4 focus:ring-emerald-500/10 min-h-[200px] text-slate-700 placeholder:text-slate-300 shadow-sm"
                      placeholder="Type your answer here..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAnswer((e.target as HTMLTextAreaElement).value);
                        }
                      }}
                    />
                    <div className="absolute bottom-4 right-4 text-[10px] font-mono text-slate-400 uppercase tracking-widest">Press Enter to continue</div>
                  </div>
                )}
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

          {state === 'generating_content' && course && (
            <GenerationFlow 
              course={course} 
              retryInfo={retryInfo}
              onComplete={() => setState('learning')} 
              onUseSample={handleUseSample}
              onRetryModule={handleRetryModule}
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
	              <div className="xl:sticky xl:top-20 self-start xl:h-[calc(100vh-6.5rem)] min-h-0">
	                <div className="h-full rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
	                  <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50">
	                    <div className="px-4 py-3 text-sm font-semibold text-slate-900 border-b-2 border-emerald-500 bg-white">
	                      Course Outline
	                    </div>
	                    <div className="px-4 py-3 text-sm font-medium text-slate-400">
	                      Resources
	                    </div>
	                  </div>

	                  <div className="p-3 border-b border-slate-100">
	                    <input
	                      type="text"
	                      placeholder="Search course outline"
	                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
	                    />
	                  </div>

	                  <div className="px-3 py-3 border-b border-slate-100 bg-emerald-50/40 flex items-center gap-3">
	                    <MascotImage mood="idle" alt="SEA-Geko helper" className="w-12 h-12 rounded-xl object-contain" />
	                    <div className="flex-1 min-w-0">
	                      <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">Course Progress</p>
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
	                      <span className="text-xs text-indigo-600 font-medium">Planning module structure...</span>
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
                          <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">Module Progress</p>
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
                          <h3 className="text-2xl font-bold text-slate-900 mb-3">This module isn’t ready yet</h3>
                          <p className="text-slate-500 max-w-md">
                            We couldn’t generate the module lesson steps (usually due to rate limits).
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
                                    stepCompletedByInteraction
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}
                                >
                                  {stepCompletedByInteraction ? 'Completed' : 'In Progress'}
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

                                {content.type === "LEARNING_CARD" && content.data.learningCards && (
                                  <CiscoLearningCard cards={content.data.learningCards} />
                                )}

                                {content.type === "QUIZ" && (
                                  <div className="bg-slate-50 border border-slate-200 rounded-[32px] p-10 shadow-sm">
                                    <div className="flex items-center gap-3 mb-8 text-emerald-600">
                                      <div className="p-2 bg-emerald-100 rounded-lg">
                                        <Layout className="w-5 h-5" />
                                      </div>
                                      <span className="font-mono text-xs uppercase tracking-widest font-bold">
                                        {activeModule.steps[activeModule.steps.length - 1]?.id === step.id ? "Final Module Assessment" : "Knowledge Check"}
                                      </span>
                                    </div>
                                    <Quiz 
                                      key={`quiz-${activeModule.id}-${step.id}`}
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
                              <>
                                <div className="flex justify-end mt-6">
                                  <button
                                    onClick={() => setEditingStepId(editingStepId === step.id ? null : step.id)}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-500/50 transition-all text-[10px] font-mono uppercase tracking-widest font-bold shadow-sm"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    Refine Content
                                  </button>
                                </div>

                                <AnimatePresence>
                                  {editingStepId === step.id && (
                                    <ContentEditor 
                                      content={content}
                                      onUpdate={(newContent) => handleUpdateStepContent(activeModule.id, step.id, newContent)}
                                      onClose={() => setEditingStepId(null)}
                                    />
                                  )}
                                </AnimatePresence>
                              </>
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
                      <h3 className="text-3xl font-bold text-slate-900 mb-4">Select a module to begin</h3>
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
      </main>
    </div>
  );
}
