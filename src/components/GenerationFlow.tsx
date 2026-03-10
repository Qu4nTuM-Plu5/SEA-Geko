import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  CheckCircle2,
  Circle,
  Cpu,
  Sparkles,
  BookOpen,
  Layers,
  ArrowRight,
  ListTree,
  Boxes,
  AlertCircle,
  RotateCcw,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Course, Module, SupportedLocale } from '../types';
import { cn } from '../lib/utils';
import { t } from '../lib/i18n';

interface GenerationFlowProps {
  course: Course;
  onComplete: () => void;
  onUseSample: () => void;
  onRetryModule: (moduleId: string) => void;
  retryInfo?: { attempt: number, delay: number } | null;
  phase?: 'outline' | 'content';
  locale?: SupportedLocale;
}

const stripStructuredStepPrefix = (title: string) => String(title || '').replace(/^\d+\.\d+(?:\.\d+)?\s+/, '').trim();

const summarizeLessons = (module: Module) => {
  const lessons = new Map<number, { lessonNumber: number; title: string; count: number }>();
  for (const [idx, step] of module.steps.entries()) {
    const lessonNumber = typeof step.lessonNumber === 'number' ? step.lessonNumber : Math.floor(idx / 7) + 1;
    const fallbackTitle = step.title.split(':')[0]?.trim() || `Lesson ${lessonNumber}`;
    const lessonTitle = stripStructuredStepPrefix(step.lessonTitle || fallbackTitle) || `Lesson ${lessonNumber}`;
    const current = lessons.get(lessonNumber);
    if (current) {
      current.count += 1;
    } else {
      lessons.set(lessonNumber, { lessonNumber, title: lessonTitle, count: 1 });
    }
  }
  return Array.from(lessons.values()).sort((a, b) => a.lessonNumber - b.lessonNumber);
};

const renderStepLabel = (moduleIndex: number, step: Module['steps'][number], fallbackIndex: number) => {
  const lesson = typeof step.lessonNumber === 'number' ? step.lessonNumber : 1;
  const segment = typeof step.segmentNumber === 'number' ? step.segmentNumber : fallbackIndex + 1;
  return `${moduleIndex + 1}.${lesson}.${segment}`;
};

const groupModuleStepsByLesson = (module: Module) => {
  const groups = new Map<number, { lessonNumber: number; lessonTitle: string; steps: Module['steps'] }>();
  for (const step of module.steps) {
    const lessonNumber = typeof step.lessonNumber === 'number' ? step.lessonNumber : 1;
    const fallbackTitle = stripStructuredStepPrefix(step.lessonTitle || step.title || `Lesson ${lessonNumber}`);
    const lessonTitle = fallbackTitle || `Lesson ${lessonNumber}`;
    const existing = groups.get(lessonNumber);
    if (existing) {
      existing.steps.push(step);
    } else {
      groups.set(lessonNumber, { lessonNumber, lessonTitle, steps: [step] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.lessonNumber - b.lessonNumber);
};

const isStepRunning = (status: Module['steps'][number]['status']) => status === 'generating' || status === 'loading';

const ProcessConnector: React.FC<{ active?: boolean; danger?: boolean }> = ({ active, danger }) => (
  <div className={cn("h-[2px] flex-1 rounded-full relative overflow-hidden", danger ? "bg-red-200/70" : "bg-emerald-100/70")}>
    {active ? (
      <motion.div
        initial={{ x: '-120%' }}
        animate={{ x: '140%' }}
        transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
        className={cn("absolute inset-y-[-2px] w-14 rounded-full blur-[1px] flex items-center justify-end", danger ? "bg-red-300/60" : "bg-emerald-300/60")}
      >
        <ArrowRight className={cn("w-3.5 h-3.5", danger ? "text-red-600/80" : "text-emerald-700/80")} />
      </motion.div>
    ) : null}
  </div>
);

const StageNode: React.FC<{ label: string; done?: boolean; active?: boolean; danger?: boolean }> = ({ label, done, active, danger }) => (
  <div className="flex items-center gap-2 min-w-0">
    <div className={cn(
      "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
      done ? "border-emerald-500 bg-emerald-500" : danger ? "border-red-400 bg-red-50" : active ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
    )}>
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-white" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" />
      ) : danger ? (
        <X className="w-3.5 h-3.5 text-red-500" />
      ) : (
        <Circle className="w-3.5 h-3.5 text-slate-300" />
      )}
    </div>
    <span className={cn("text-[11px] font-semibold whitespace-nowrap", done ? "text-emerald-700" : danger ? "text-red-600" : active ? "text-amber-700" : "text-slate-400")}>
      {label}
    </span>
  </div>
);

export const GenerationFlow: React.FC<GenerationFlowProps> = ({
  course,
  onComplete,
  onUseSample,
  onRetryModule,
  retryInfo,
  phase = 'content',
  locale = 'en',
}) => {
  const allFinished = course.modules.every(m => m.status === 'completed' || m.status === 'error');
  const someFailed = course.modules.some(m => m.status === 'error');
  const modulesStarted = course.modules.filter((m) => m.status !== 'pending').length;
  const lessonsStructured = course.modules.filter((m) => summarizeLessons(m).length > 0).length;
  const subContentMapped = course.modules.reduce((acc, module) => acc + module.steps.length, 0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const moduleTrackSectionRef = useRef<HTMLDivElement | null>(null);
  const completionCtaRef = useRef<HTMLDivElement | null>(null);
  const moduleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const subContentScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const subContentStepRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastRunningStepByModuleRef = useRef<Record<string, string>>({});
  const [outlineFocusModuleId, setOutlineFocusModuleId] = useState<string | null>(null);
  const [focusedProcessingStep, setFocusedProcessingStep] = useState<{ moduleId: string; stepId: string; key: string } | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const activeProcessingModuleId = useMemo(() => {
    if (phase === 'outline' && outlineFocusModuleId) return outlineFocusModuleId;
    if (focusedProcessingStep?.moduleId) return focusedProcessingStep.moduleId;
    const running = course.modules.find((m) =>
      m.status !== 'pending' && m.steps.some((s) => isStepRunning(s.status))
    );
    if (running) return running.id;
    const active = course.modules.find((m) => m.status === 'generating');
    if (active) return active.id;
    const queued = course.modules.find((m) => m.status === 'pending');
    if (queued) return queued.id;
    return course.modules[0]?.id || '';
  }, [phase, course.modules, focusedProcessingStep?.moduleId, outlineFocusModuleId]);

  const activeProcessingStep = useMemo(() => {
    if (phase !== 'content') return null;
    if (focusedProcessingStep) {
      const focusedModule = course.modules.find((m) => m.id === focusedProcessingStep.moduleId);
      const focusedRunningStep = focusedModule?.steps.find((step) => step.id === focusedProcessingStep.stepId && isStepRunning(step.status));
      if (focusedModule && focusedRunningStep) return focusedProcessingStep;
    }
    const activeModule = course.modules.find((m) =>
      m.status !== 'pending' && m.steps.some((step) => isStepRunning(step.status))
    );
    if (!activeModule) return null;
    const runningStep = activeModule.steps.find((step) => isStepRunning(step.status));
    if (!runningStep) return null;
    return {
      moduleId: activeModule.id,
      stepId: runningStep.id,
      key: `${activeModule.id}:${runningStep.id}`,
    };
  }, [phase, course.modules, focusedProcessingStep]);

  const titleLabel = phase === 'outline'
    ? t('generationOutlineTitle', locale)
    : t('generationCourseTitle', locale);
  const subtitleLabel = phase === 'outline'
    ? t('generationOutlineSubtitle', locale)
    : t('generationCourseSubtitle', locale);

  const ctaLabel = useMemo(() => {
    if (phase === 'outline') return someFailed ? t('reviewPartialOutline', locale) : t('reviewOutline', locale);
    return someFailed ? t('reviewAvailableContent', locale) : t('startLearningNow', locale);
  }, [phase, someFailed, locale]);

  useEffect(() => {
    const update = () => {
      const el = trackRef.current;
      if (!el) {
        setCanScrollLeft(false);
        setCanScrollRight(false);
        return;
      }
      setCanScrollLeft(el.scrollLeft > 12);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 12);
    };
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [course.modules.length]);

  useEffect(() => {
    if (phase !== 'content') return;
    if (!activeProcessingModuleId) return;
    const track = trackRef.current;
    const card = moduleRefs.current[activeProcessingModuleId];
    if (!track || !card) return;
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const targetLeft = track.scrollLeft + (cardRect.left - trackRect.left) - Math.max(0, (track.clientWidth - card.clientWidth) / 2);
    track.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [phase, activeProcessingModuleId]);

  useEffect(() => {
    if (phase !== 'content') return;
    const runningByModule = course.modules
      .filter((module) => module.status !== 'pending')
      .map((module) => {
        const runningStep = module.steps.find((step) => isStepRunning(step.status));
        if (!runningStep) return null;
        return {
          moduleId: module.id,
          stepId: runningStep.id,
          key: `${module.id}:${runningStep.id}`,
        };
      })
      .filter(Boolean) as Array<{ moduleId: string; stepId: string; key: string }>;

    const nextRunningMap: Record<string, string> = {};
    const changed: Array<{ moduleId: string; stepId: string; key: string }> = [];

    for (const entry of runningByModule) {
      nextRunningMap[entry.moduleId] = entry.stepId;
      const prevStepId = lastRunningStepByModuleRef.current[entry.moduleId];
      if (prevStepId && prevStepId !== entry.stepId) {
        changed.push(entry);
      }
    }

    lastRunningStepByModuleRef.current = nextRunningMap;

    if (changed.length) {
      setFocusedProcessingStep(changed[0]);
      return;
    }

    if (focusedProcessingStep) {
      const stillRunning = runningByModule.some((entry) => entry.key === focusedProcessingStep.key);
      if (stillRunning) return;
    }

    setFocusedProcessingStep(runningByModule[0] || null);
  }, [phase, course.modules, focusedProcessingStep?.key]);

  useEffect(() => {
    if (phase !== 'outline') return;
    const generatingIds = course.modules
      .filter((module) => module.status === 'generating')
      .map((module) => module.id);
    if (!generatingIds.length) {
      setOutlineFocusModuleId(null);
      return;
    }
    if (generatingIds.length === 1) {
      setOutlineFocusModuleId(generatingIds[0]);
      return;
    }

    let idx = 0;
    setOutlineFocusModuleId(generatingIds[idx]);
    const timer = window.setInterval(() => {
      idx = (idx + 1) % generatingIds.length;
      setOutlineFocusModuleId(generatingIds[idx]);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [phase, course.modules]);

  useEffect(() => {
    if (!activeProcessingStep) return;
    const container = subContentScrollRefs.current[activeProcessingStep.moduleId];
    const stepEl = subContentStepRefs.current[activeProcessingStep.key];
    if (!stepEl) return;
    if (!container) {
      stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const stepRect = stepEl.getBoundingClientRect();
    const offsetTop = stepRect.top - containerRect.top;
    const targetTop = container.scrollTop + offsetTop - Math.max(0, (container.clientHeight - stepEl.clientHeight) / 2);
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [activeProcessingStep?.key]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      moduleTrackSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!allFinished) return;
    const timer = window.setTimeout(() => {
      completionCtaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [allFinished, phase]);

  const scrollByCards = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(320, Math.floor(el.clientWidth * 0.72));
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  };

  return (
    <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center overflow-y-auto p-4 md:p-8 py-12 md:py-20">
      <div
        className="fixed inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(#000000 1px, transparent 1px)', backgroundSize: '40px 40px' }}
      />

      <div className="max-w-7xl w-full relative z-10">
        <div className="text-center mb-10 md:mb-14">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-mono font-bold uppercase tracking-widest mb-6 shadow-sm"
          >
            <Cpu className="w-3.5 h-3.5 animate-pulse" />
            {t('aiSynthesisInProgress', locale)}
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold text-slate-900 mb-4 tracking-tight break-words leading-tight"
          >
            {titleLabel}: <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600">{course.title}</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-slate-500 max-w-3xl mx-auto text-base md:text-lg leading-relaxed break-words"
          >
            {subtitleLabel}
          </motion.p>
        </div>

        <div className="mb-8 md:mb-12 rounded-3xl border border-emerald-100 bg-white p-4 md:p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-4">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">{t('stageLabelOne', locale)}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">{t('stageModuleCreation', locale)}</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{modulesStarted}/{course.modules.length}</span>
              </div>
            </div>
            <div className="hidden md:flex items-center">
              <ProcessConnector active={!allFinished} />
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">{t('stageLabelTwo', locale)}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ListTree className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">{t('stageLessonsInModule', locale)}</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{lessonsStructured}/{course.modules.length}</span>
              </div>
            </div>
            <div className="hidden md:flex items-center">
              <ProcessConnector active={!allFinished} />
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">{t('stageLabelThree', locale)}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Boxes className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">{t('stageSubcontentMapping', locale)}</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{subContentMapped}</span>
              </div>
            </div>
          </div>
        </div>

        <div ref={moduleTrackSectionRef} className="relative mb-16">
          <button
            type="button"
            onClick={() => scrollByCards(-1)}
            disabled={!canScrollLeft}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full border border-slate-200 bg-white/95 items-center justify-center text-slate-600 shadow-sm disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label="Scroll modules left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCards(1)}
            disabled={!canScrollRight}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full border border-slate-200 bg-white/95 items-center justify-center text-slate-600 shadow-sm disabled:opacity-35 disabled:cursor-not-allowed"
            aria-label="Scroll modules right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div
            ref={trackRef}
            className="overflow-x-auto overflow-y-visible pb-3 scrollbar-thin"
            style={{ scrollbarGutter: 'stable both-edges' }}
          >
            <div className="min-w-max flex items-stretch gap-4 pr-4">
              {course.modules.map((module, mIdx) => {
            const lessonSummary = summarizeLessons(module);
            const lessonGroups = groupModuleStepsByLesson(module);
            const previewSteps = module.steps.slice(0, 7);
            const totalSteps = module.steps.length;
            const completedSteps = module.steps.filter((s) => s.status === 'completed').length;
            const runningSteps = module.steps.filter((s) => isStepRunning(s.status)).length;
            const pendingSteps = module.steps.filter((s) => s.status === 'pending').length;
            const errorSteps = module.steps.filter((s) => s.status === 'error').length;
            const allStepsCompleted = totalSteps > 0 && completedSteps === totalSteps;
            const moduleCreated = phase === 'content' ? true : module.status !== 'pending';
            const lessonsCreated = lessonSummary.length > 0;
            const subContentCreated = phase === 'content'
              ? allStepsCompleted
              : totalSteps > 0;
            const isGenerating = module.status === 'generating' || runningSteps > 0;
            const hasError = module.status === 'error' || errorSteps > 0;
            const isQueued = !allFinished
              && !isGenerating
              && !hasError
              && (module.status === 'pending' || (phase === 'content' && pendingSteps > 0));
            const remainingStepCount = Math.max(0, module.steps.length - previewSteps.length);
            const isFocused = !allFinished && module.id === activeProcessingModuleId;
            const statusLabel = hasError
              ? t('statusError', locale)
              : isGenerating
              ? t('statusProcessing', locale)
              : allStepsCompleted
              ? t('statusCompleted', locale)
              : isQueued
              ? t('statusQueued', locale)
              : phase === 'outline' && totalSteps > 0
              ? t('statusOutlineReady', locale)
              : t('statusWaiting', locale);

            return (
              <React.Fragment key={module.id}>
                <motion.div
                  ref={(el) => {
                    moduleRefs.current[module.id] = el;
                  }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: mIdx * 0.08 }}
                  className={cn(
                    "relative w-[min(86vw,560px)] min-h-[430px] p-5 md:p-7 rounded-[28px] border transition-all duration-500 shadow-sm overflow-hidden bg-white snap-start",
                    allStepsCompleted && !hasError
                      ? "border-emerald-100 shadow-xl shadow-emerald-500/5"
                      : isGenerating
                      ? "border-amber-200 shadow-lg shadow-amber-200/30"
                      : hasError
                      ? "bg-red-50 border-red-100"
                      : "border-slate-100"
                    ,
                    isFocused && "ring-2 ring-amber-200/80"
                  )}
                >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={cn(
                      "w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm shrink-0",
                      allStepsCompleted && !hasError
                        ? "bg-emerald-500 text-white"
                        : isGenerating
                        ? "bg-amber-100 text-amber-700"
                        : hasError
                        ? "bg-red-100 text-red-600"
                        : "bg-slate-100 text-slate-500"
                    )}>
                      <Layers className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">{t('moduleLabel', locale)} {mIdx + 1}</p>
                      <h3 className="text-lg md:text-xl font-bold text-slate-900 break-words line-clamp-2 leading-tight">{module.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 break-words line-clamp-2">{module.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest border",
                      hasError
                        ? "bg-red-50 border-red-200 text-red-700"
                        : isGenerating
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : allStepsCompleted
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-slate-50 border-slate-200 text-slate-500"
                    )}>
                      {statusLabel}
                    </span>
                    {allStepsCompleted && !hasError ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : isGenerating ? (
                      <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                    ) : hasError ? (
                      <X className="w-5 h-5 text-red-500" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300" />
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 mb-5">
                  <div className="flex items-center gap-3">
                    <StageNode label={t('stageNodeModule', locale)} done={moduleCreated} active={isGenerating && !moduleCreated} danger={hasError && !moduleCreated} />
                    <ProcessConnector active={isGenerating} danger={hasError} />
                    <StageNode label={t('stageNodeLessons', locale)} done={lessonsCreated} active={isGenerating && moduleCreated && !lessonsCreated} danger={hasError && !lessonsCreated} />
                    <ProcessConnector active={isGenerating && lessonsCreated} danger={hasError} />
                    <StageNode label={t('stageNodeContents', locale)} done={subContentCreated} active={isGenerating && lessonsCreated && !subContentCreated} danger={hasError && !subContentCreated} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-100 bg-white p-3 min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">{t('lessonsLabel', locale)}</p>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {lessonSummary.length ? lessonSummary.map((lesson) => {
                        const group = lessonGroups.find((g) => g.lessonNumber === lesson.lessonNumber);
                        const lessonDone = group ? group.steps.filter((s) => s.status === 'completed').length : 0;
                        const lessonRunning = group ? group.steps.some((s) => isStepRunning(s.status)) : false;
                        const lessonError = group ? group.steps.some((s) => s.status === 'error') : false;
                        return (
                          <div
                            key={`${module.id}-lesson-${lesson.lessonNumber}`}
                            className={cn(
                              "flex items-center gap-2 text-xs min-w-0 rounded-lg border px-2.5 py-1.5",
                              lessonError
                                ? "border-red-100 bg-red-50/70 text-red-700"
                                : lessonRunning
                                ? "border-amber-100 bg-amber-50/70 text-amber-800"
                                : lessonDone === lesson.count && lesson.count > 0
                                ? "border-emerald-100 bg-emerald-50/70 text-emerald-800"
                                : "border-slate-100 bg-slate-50 text-slate-700"
                            )}
                          >
                            <span className="font-mono shrink-0">{mIdx + 1}.{lesson.lessonNumber}</span>
                            <span className="font-medium min-w-0 line-clamp-1 break-words">{lesson.title}</span>
                            <span className="ml-auto text-[10px] font-mono shrink-0">{lessonDone}/{lesson.count}</span>
                          </div>
                        );
                      }) : (
                        <div className="text-xs text-slate-400">{t('awaitingLessonBlueprint', locale)}</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-white p-3 min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">{t('subcontentsLabel', locale)}</p>
                    <div
                      ref={(el) => {
                        subContentScrollRefs.current[module.id] = el;
                      }}
                      className="space-y-2 max-h-56 overflow-y-auto pr-1"
                    >
                      {phase === 'content' && lessonGroups.length ? lessonGroups.map((group) => (
                        <div key={`${module.id}-subgroup-${group.lessonNumber}`} className="rounded-xl border border-slate-100 p-2.5">
                          <p className="text-[10px] font-mono text-slate-500 mb-1.5">
                            {mIdx + 1}.{group.lessonNumber} {group.lessonTitle}
                          </p>
                          <div className="space-y-1">
                            {group.steps.map((step, stepIdx) => {
                              const processing = isStepRunning(step.status);
                              const completed = step.status === 'completed';
                              const errored = step.status === 'error';
                              const label = renderStepLabel(mIdx, step, stepIdx);
                              const stepFocusKey = `${module.id}:${step.id}`;
                              const isActiveProcessingStep = activeProcessingStep?.key === stepFocusKey;
                              return (
                                <motion.div
                                  key={step.id}
                                  ref={(el) => {
                                    subContentStepRefs.current[stepFocusKey] = el;
                                  }}
                                  initial={false}
                                  animate={processing
                                    ? { backgroundColor: 'rgba(254, 243, 199, 0.8)', borderColor: 'rgba(251, 191, 36, 0.6)' }
                                    : completed
                                    ? { backgroundColor: 'rgba(209, 250, 229, 0.75)', borderColor: 'rgba(16, 185, 129, 0.45)' }
                                    : errored
                                    ? { backgroundColor: 'rgba(254, 226, 226, 0.75)', borderColor: 'rgba(248, 113, 113, 0.45)' }
                                    : { backgroundColor: 'rgba(248, 250, 252, 0.8)', borderColor: 'rgba(226, 232, 240, 0.75)' }}
                                  transition={{ duration: 0.35 }}
                                  className={cn(
                                    "rounded-lg border px-2 py-1.5 flex items-center gap-2 text-xs min-w-0",
                                    isActiveProcessingStep && "ring-2 ring-amber-300/80"
                                  )}
                                >
                                  <motion.span
                                    className={cn(
                                      "w-2 h-2 rounded-full shrink-0",
                                      processing
                                        ? "bg-amber-500"
                                        : completed
                                        ? "bg-emerald-500"
                                        : errored
                                        ? "bg-red-500"
                                        : "bg-slate-300"
                                    )}
                                    animate={processing ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                                    transition={{ duration: 0.9, repeat: processing ? Infinity : 0, ease: 'easeInOut' }}
                                  />
                                  <span className={cn(
                                    "font-mono shrink-0",
                                    processing
                                      ? "text-amber-700"
                                      : completed
                                      ? "text-emerald-700"
                                      : errored
                                      ? "text-red-700"
                                      : "text-slate-400"
                                  )}>
                                    {label}
                                  </span>
                                  <span className={cn(
                                    "min-w-0 line-clamp-1 break-words font-medium",
                                    processing
                                      ? "text-amber-900"
                                      : completed
                                      ? "text-emerald-900"
                                      : errored
                                      ? "text-red-800"
                                      : "text-slate-700"
                                  )}>
                                    {stripStructuredStepPrefix(step.title)}
                                  </span>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )) : previewSteps.length ? previewSteps.map((step, stepIdx) => (
                        <div key={step.id} className="flex items-center gap-2 text-xs min-w-0">
                            <span className="font-mono text-slate-400 shrink-0">{renderStepLabel(mIdx, step, stepIdx)}</span>
                          <span className="font-medium text-slate-700 min-w-0 line-clamp-1 break-words">
                            {stripStructuredStepPrefix(step.title)}
                          </span>
                        </div>
                      )) : (
                        <div className="text-xs text-slate-400">{t('waitingSubContent', locale)}</div>
                      )}
                      {phase !== 'content' && remainingStepCount > 0 ? (
                        <div className="text-[10px] font-mono text-slate-400">+{remainingStepCount} more</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {isGenerating && (
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-amber-700 uppercase tracking-widest font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      {t('processingModuleGraph', locale)} {completedSteps}/{totalSteps} {t('completedLabel', locale)}
                    </div>
                  </div>
                )}

                {module.status === 'error' && (
                  <div className="mt-5 pt-4 border-t border-red-100 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-red-600 uppercase tracking-widest font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t('generationFailed', locale)}
                    </div>
                    <button
                      onClick={() => onRetryModule(module.id)}
                      className="p-2 hover:bg-red-100 rounded-xl text-red-600 transition-colors"
                      title="Retry Module"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                )}
                </motion.div>
                {mIdx < course.modules.length - 1 ? (
                  <div className="hidden md:flex items-center justify-center w-16 lg:w-24 relative shrink-0">
                    <div className={cn(
                      "h-[2px] w-full border-t-2 border-dashed",
                      hasError ? "border-red-300" : "border-emerald-300/90"
                    )} />
                    <motion.div
                      initial={{ x: '-45%' }}
                      animate={{ x: '45%' }}
                      transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
                      className={cn(
                        "absolute w-3 h-3 rounded-full border-2",
                        hasError ? "bg-red-100 border-red-400" : "bg-emerald-50 border-emerald-500"
                      )}
                    />
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {retryInfo && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-md mx-auto bg-white border-2 border-orange-200 p-8 rounded-[32px] text-center shadow-2xl shadow-orange-500/10 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-orange-100">
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: retryInfo.delay / 1000, ease: 'linear' }}
                  className="h-full bg-orange-500"
                />
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center text-orange-600">
                  <RotateCcw className="w-7 h-7 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Rate Limit Encountered</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  {t('autoResumingIn', locale)} <span className="font-bold text-orange-600">{Math.round(retryInfo.delay / 1000)}s</span>.
                </p>
                <div className="px-4 py-2 bg-slate-50 rounded-full text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">
                  {t('attemptLabel', locale)} {11 - retryInfo.attempt} / 10
                </div>
                <button
                  onClick={onComplete}
                  className="text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors underline underline-offset-4"
                >
                  {t('skipAndViewPartialCourse', locale)}
                </button>
                <button
                  onClick={onUseSample}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-slate-600 rounded-2xl transition-all text-xs font-bold shadow-sm"
                >
                  <BookOpen className="w-4 h-4" />
                  {t('switchToSampleCourse', locale)}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {allFinished && phase === 'content' && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-16 flex flex-col items-center gap-6"
              ref={completionCtaRef}
            >
              <div className={cn(
                "flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-widest",
                someFailed ? "text-orange-600" : "text-emerald-600"
              )}>
                {someFailed ? (
                  <>
                    <AlertCircle className="w-5 h-5" />
                    {t('curriculumPartiallyReady', locale)}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    {t('curriculumReady', locale)}
                  </>
                )}
              </div>

              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={onComplete}
                  className="group relative px-14 py-6 md:px-16 md:py-7 bg-slate-900 text-white rounded-[28px] font-bold text-xl md:text-2xl transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-slate-900/20"
                >
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-6 h-6" />
                    {ctaLabel}
                  </div>
                </button>
                {someFailed ? (
                  <p className="text-slate-400 text-xs max-w-xs text-center leading-relaxed">
                    {t('someModulesFailedHint', locale)}
                  </p>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {allFinished && phase === 'outline' && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-10 flex flex-col items-center gap-4"
              ref={completionCtaRef}
            >
              <div className={cn(
                "flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest",
                someFailed ? "text-orange-600" : "text-emerald-600"
              )}>
                {someFailed ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {someFailed ? t('outlinePartiallyReady', locale) : t('outlineReady', locale)}
              </div>
              <button
                onClick={onComplete}
                className="group relative px-8 py-4 bg-slate-900 text-white rounded-2xl font-semibold text-base transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-slate-900/15"
              >
                {ctaLabel}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
