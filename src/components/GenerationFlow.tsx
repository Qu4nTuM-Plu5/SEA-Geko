import React from 'react';
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
} from 'lucide-react';
import { Course, Module } from '../types';
import { cn } from '../lib/utils';

interface GenerationFlowProps {
  course: Course;
  onComplete: () => void;
  onUseSample: () => void;
  onRetryModule: (moduleId: string) => void;
  retryInfo?: { attempt: number, delay: number } | null;
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
      done ? "border-emerald-500 bg-emerald-500" : danger ? "border-red-400 bg-red-50" : active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
    )}>
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-white" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
      ) : danger ? (
        <X className="w-3.5 h-3.5 text-red-500" />
      ) : (
        <Circle className="w-3.5 h-3.5 text-slate-300" />
      )}
    </div>
    <span className={cn("text-[11px] font-semibold whitespace-nowrap", done ? "text-emerald-700" : danger ? "text-red-600" : active ? "text-emerald-600" : "text-slate-400")}>
      {label}
    </span>
  </div>
);

export const GenerationFlow: React.FC<GenerationFlowProps> = ({ course, onComplete, onUseSample, onRetryModule, retryInfo }) => {
  const allFinished = course.modules.every(m => m.status === 'completed' || m.status === 'error');
  const someFailed = course.modules.some(m => m.status === 'error');
  const modulesStarted = course.modules.filter((m) => m.status !== 'pending').length;
  const lessonsStructured = course.modules.filter((m) => summarizeLessons(m).length > 0).length;
  const subContentMapped = course.modules.reduce((acc, module) => acc + module.steps.length, 0);

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
            AI CURRICULUM SYNTHESIS IN PROGRESS
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold text-slate-900 mb-4 tracking-tight break-words leading-tight"
          >
            Crafting your <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600">{course.title}</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-slate-500 max-w-3xl mx-auto text-base md:text-lg leading-relaxed break-words"
          >
            Building module map, lessons, and sub-content graph with connected generation pipelines.
          </motion.p>
        </div>

        <div className="mb-8 md:mb-12 rounded-3xl border border-emerald-100 bg-white p-4 md:p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-4">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Stage 1</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">Module Creation</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{modulesStarted}/{course.modules.length}</span>
              </div>
            </div>
            <div className="hidden md:flex items-center">
              <ProcessConnector active={!allFinished} />
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Stage 2</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ListTree className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">Lessons in Module</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{lessonsStructured}/{course.modules.length}</span>
              </div>
            </div>
            <div className="hidden md:flex items-center">
              <ProcessConnector active={!allFinished} />
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Stage 3</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Boxes className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 truncate">Sub-content Mapping</span>
                </div>
                <span className="text-xs font-mono text-emerald-700">{subContentMapped}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 relative mb-16">
          {course.modules.map((module, mIdx) => {
            const lessonSummary = summarizeLessons(module);
            const previewSteps = module.steps.slice(0, 7);
            const moduleCreated = module.status !== 'pending';
            const lessonsCreated = lessonSummary.length > 0;
            const subContentCreated = module.steps.length > 0 && (module.status === 'completed' || module.status === 'error');
            const isGenerating = module.status === 'generating';
            const hasError = module.status === 'error';
            const remainingStepCount = Math.max(0, module.steps.length - previewSteps.length);

            return (
              <motion.div
                key={module.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: mIdx * 0.08 }}
                className={cn(
                  "relative p-5 md:p-7 rounded-[28px] border transition-all duration-500 shadow-sm overflow-hidden",
                  module.status === 'completed'
                    ? "bg-white border-emerald-100 shadow-xl shadow-emerald-500/5"
                    : module.status === 'generating'
                    ? "bg-white border-emerald-200"
                    : module.status === 'error'
                    ? "bg-red-50 border-red-100"
                    : "bg-white/60 border-slate-100"
                )}
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={cn(
                      "w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm shrink-0",
                      module.status === 'completed' ? "bg-emerald-500 text-white" : module.status === 'error' ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
                    )}>
                      <Layers className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">Module {mIdx + 1}</p>
                      <h3 className="text-lg md:text-xl font-bold text-slate-900 break-words line-clamp-2 leading-tight">{module.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 break-words line-clamp-2">{module.description}</p>
                    </div>
                  </div>
                  {module.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : module.status === 'generating' ? (
                    <Loader2 className="w-5 h-5 text-emerald-500 animate-spin shrink-0" />
                  ) : module.status === 'error' ? (
                    <X className="w-5 h-5 text-red-500 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-200 shrink-0" />
                  )}
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 mb-5">
                  <div className="flex items-center gap-3">
                    <StageNode label="Module" done={moduleCreated} active={isGenerating && !moduleCreated} danger={hasError && !moduleCreated} />
                    <ProcessConnector active={isGenerating} danger={hasError} />
                    <StageNode label="Lessons" done={lessonsCreated} active={isGenerating && moduleCreated && !lessonsCreated} danger={hasError && !lessonsCreated} />
                    <ProcessConnector active={isGenerating && lessonsCreated} danger={hasError} />
                    <StageNode label="Contents" done={subContentCreated} active={isGenerating && lessonsCreated && !subContentCreated} danger={hasError && !subContentCreated} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-100 bg-white p-3 min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Lessons</p>
                    <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                      {lessonSummary.length ? lessonSummary.map((lesson) => (
                        <div key={`${module.id}-lesson-${lesson.lessonNumber}`} className="flex items-center gap-2 text-xs min-w-0">
                          <span className="font-mono text-slate-400 shrink-0">{mIdx + 1}.{lesson.lessonNumber}</span>
                          <span className="font-medium text-slate-700 min-w-0 line-clamp-1 break-words">{lesson.title}</span>
                          <span className="ml-auto text-[10px] text-emerald-600 font-mono shrink-0">{lesson.count}</span>
                        </div>
                      )) : (
                        <div className="text-xs text-slate-400">Awaiting lesson blueprint...</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-white p-3 min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 mb-2">Sub-contents</p>
                    <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                      {previewSteps.length ? previewSteps.map((step, stepIdx) => (
                        <div key={step.id} className="flex items-center gap-2 text-xs min-w-0">
                          <span className="font-mono text-slate-400 shrink-0">{renderStepLabel(mIdx, step, stepIdx)}</span>
                          <span className="font-medium text-slate-700 min-w-0 line-clamp-1 break-words">
                            {stripStructuredStepPrefix(step.title)}
                          </span>
                        </div>
                      )) : (
                        <div className="text-xs text-slate-400">Waiting for sub-content mapping...</div>
                      )}
                      {remainingStepCount > 0 ? (
                        <div className="text-[10px] font-mono text-slate-400">+{remainingStepCount} more</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {module.status === 'generating' && (
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-600 uppercase tracking-widest font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      Processing module graph...
                    </div>
                  </div>
                )}

                {module.status === 'error' && (
                  <div className="mt-5 pt-4 border-t border-red-100 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-red-600 uppercase tracking-widest font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Generation failed
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
            );
          })}
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
                  Auto-resuming in <span className="font-bold text-orange-600">{Math.round(retryInfo.delay / 1000)}s</span>.
                </p>
                <div className="px-4 py-2 bg-slate-50 rounded-full text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">
                  Attempt {11 - retryInfo.attempt} of 10
                </div>
                <button
                  onClick={onComplete}
                  className="text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors underline underline-offset-4"
                >
                  Skip and view partial course
                </button>
                <button
                  onClick={onUseSample}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-slate-600 rounded-2xl transition-all text-xs font-bold shadow-sm"
                >
                  <BookOpen className="w-4 h-4" />
                  Switch to Sample Course
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {allFinished && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-16 flex flex-col items-center gap-6"
            >
              <div className={cn(
                "flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-widest",
                someFailed ? "text-orange-600" : "text-emerald-600"
              )}>
                {someFailed ? (
                  <>
                    <AlertCircle className="w-5 h-5" />
                    CURRICULUM PARTIALLY SYNTHESIZED
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    CURRICULUM READY FOR DEPLOYMENT
                  </>
                )}
              </div>

              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={onComplete}
                  className="group relative px-12 py-5 bg-slate-900 text-white rounded-[24px] font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-slate-900/20"
                >
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-5 h-5" />
                    {someFailed ? 'Review Available Content' : 'Start Learning Now'}
                  </div>
                </button>
                {someFailed ? (
                  <p className="text-slate-400 text-xs max-w-xs text-center leading-relaxed">
                    Some modules could not be fully generated. Retry them later from the course map.
                  </p>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
