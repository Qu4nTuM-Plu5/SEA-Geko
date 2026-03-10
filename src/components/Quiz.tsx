import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Trophy, ChevronDown, Lightbulb, ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface QuizProps {
  questions: {
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }[];
  topicLabel?: string;
  onComplete?: (result: { passed: boolean; score: number; percentage: number }) => void;
}

const isPlaceholderQuestion = (question: string): boolean => {
  const q = String(question || '').trim().toLowerCase();
  return !q || /^quick\s*check\s*:?\s*which\s*statement\s*is\s*true\??$/.test(q) || /^question\s*\d*$/.test(q);
};

const isPlaceholderOption = (option: string): boolean => {
  const o = String(option || '').trim().toLowerCase();
  return !o || /^[a-d]$/.test(o) || /^option\s*[a-d0-9]+$/.test(o);
};

export const Quiz: React.FC<QuizProps> = ({ questions, topicLabel, onComplete }) => {
  const normalizedQuestions = useMemo(() => {
    const cleaned = (Array.isArray(questions) ? questions : [])
      .map((q) => {
        const question = String(q?.question || '').trim();
        const options = Array.isArray(q?.options)
          ? Array.from(new Set(q.options.map((opt) => String(opt).trim()).filter(Boolean)))
          : [];
        if (options.length < 2) return null;
        if (isPlaceholderQuestion(question) && options.every((opt) => isPlaceholderOption(opt))) return null;
        if (!question || isPlaceholderQuestion(question)) return null;

        const limitedOptions = options.slice(0, 4);
        let correctAnswer = Number.isFinite(q?.correctAnswer)
          ? Number(q.correctAnswer)
          : Number.parseInt(String(q?.correctAnswer ?? ''), 10);
        if (!Number.isFinite(correctAnswer)) correctAnswer = 0;
        correctAnswer = Math.min(Math.max(correctAnswer, 0), limitedOptions.length - 1);

        const explanation = String(q?.explanation || '').trim()
          || `Review the lesson content to confirm why "${limitedOptions[correctAnswer]}" is correct.`;

        return {
          question,
          options: limitedOptions,
          correctAnswer,
          explanation,
        };
      })
      .filter(Boolean) as Array<{ question: string; options: string[]; correctAnswer: number; explanation: string }>;

    if (cleaned.length) return cleaned;

    return [{
      question: 'Which statement best matches this lesson?',
      options: [
        'The answer should align with the module concepts.',
        'The answer should ignore the lesson context.',
        'The answer must be unrelated to this topic.',
        'The answer should come from an outside subject.',
      ],
      correctAnswer: 0,
      explanation: 'When generated quiz content is incomplete, this fallback keeps the assessment usable.',
    }];
  }, [questions]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedByQuestion, setSelectedByQuestion] = useState<Array<number | null>>([]);
  const [submittedByQuestion, setSubmittedByQuestion] = useState<boolean[]>([]);
  const [showInfoByQuestion, setShowInfoByQuestion] = useState<boolean[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    setCurrentIdx(0);
    setSelectedByQuestion(Array(normalizedQuestions.length).fill(null));
    setSubmittedByQuestion(Array(normalizedQuestions.length).fill(false));
    setShowInfoByQuestion(Array(normalizedQuestions.length).fill(false));
    setIsFinished(false);
    setScore(0);
  }, [normalizedQuestions]);

  const current = normalizedQuestions[currentIdx];
  const selected = selectedByQuestion[currentIdx] ?? null;
  const isSubmitted = submittedByQuestion[currentIdx] ?? false;

  const handleSelectOption = (idx: number) => {
    if (isSubmitted) return;

    setSelectedByQuestion((prev) => {
      const next = [...prev];
      next[currentIdx] = idx;
      return next;
    });

    setSubmittedByQuestion((prev) => {
      const next = [...prev];
      next[currentIdx] = true;
      return next;
    });

    if (idx === current.correctAnswer) {
      setScore((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIdx <= 0) return;
    setCurrentIdx((prev) => prev - 1);
  };

  const handleNext = () => {
    if (!isSubmitted) return;
    if (currentIdx < normalizedQuestions.length - 1) {
      setCurrentIdx((prev) => prev + 1);
      return;
    }
    const percentage = Math.round((score / normalizedQuestions.length) * 100);
    const passed = percentage >= 70;
    setIsFinished(true);
    onComplete?.({ passed, score, percentage });
  };

  const toggleInfo = () => {
    setShowInfoByQuestion((prev) => {
      const next = [...prev];
      next[currentIdx] = !next[currentIdx];
      return next;
    });
  };

  if (isFinished) {
    const percentage = Math.round((score / normalizedQuestions.length) * 100);
    const passed = percentage >= 70;

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-12 space-y-8"
      >
        <div className="relative inline-block">
          <div className={cn(
            "w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 relative z-10 shadow-lg",
            passed ? "bg-emerald-100" : "bg-orange-100"
          )}>
            {passed ? (
              <Trophy className="w-12 h-12 text-emerald-600" />
            ) : (
              <RotateCcw className="w-12 h-12 text-orange-600" />
            )}
          </div>
          {passed && (
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="absolute inset-0 bg-emerald-500/20 rounded-full"
            />
          )}
        </div>

	        <div>
	          <h3 className="text-3xl font-bold text-slate-900 mb-2">
	            {passed ? "Module Mastered!" : "Keep Practicing!"}
	          </h3>
	          <p className="text-slate-500 max-w-xs mx-auto text-lg leading-relaxed">
	            You scored {score} out of {normalizedQuestions.length} ({percentage}%)
	          </p>
	        </div>

        {passed ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl inline-block shadow-sm">
              <span className="text-emerald-700 font-bold">+500 XP Earned</span>
            </div>
            <p className="text-sm text-slate-400 font-medium">Next module is now unlocked!</p>
          </div>
        ) : (
          <button 
            onClick={() => {
              setCurrentIdx(0);
              setSelectedByQuestion(Array(normalizedQuestions.length).fill(null));
              setSubmittedByQuestion(Array(normalizedQuestions.length).fill(false));
              setShowInfoByQuestion(Array(normalizedQuestions.length).fill(false));
              setIsFinished(false);
              setScore(0);
            }}
            className="px-10 py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all flex items-center gap-3 mx-auto shadow-xl"
          >
            <RotateCcw className="w-5 h-5" />
            Try Again
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Trophy className="w-5 h-5 text-emerald-600" />
        <div className="flex-1 h-4 rounded-full border border-slate-300 bg-slate-100 overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${(score / normalizedQuestions.length) * 100}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <div className="px-4 py-1 rounded-full border border-emerald-500 bg-emerald-50 text-emerald-600 font-semibold">
          {score} / {normalizedQuestions.length}
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 md:p-6 space-y-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-2 rounded-full bg-violet-600" />
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-xl font-bold text-slate-900 whitespace-nowrap">Question {currentIdx + 1}</h3>
              <ChevronDown className="w-4 h-4 text-slate-400" />
              {topicLabel ? (
                <span className="hidden md:inline-flex items-center px-3 py-1 rounded-lg border border-orange-200 text-orange-500 bg-orange-50 text-sm truncate max-w-[360px]">
                  {topicLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <h4 className="text-xl md:text-[1.75rem] font-medium text-slate-900 leading-snug">
          {current.question}
        </h4>

        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {current.options.map((option, idx) => {
              const isCorrect = idx === current.correctAnswer;
              const isSelected = selected === idx;

              return (
                <motion.button
                  key={idx}
                  layout
                  onClick={() => handleSelectOption(idx)}
                  className={cn(
                    "w-full rounded-2xl p-4 border text-left transition-colors flex items-center justify-between",
                    !isSubmitted && "bg-slate-100 border-slate-200 hover:bg-slate-50",
                    isSubmitted && isCorrect && "bg-emerald-100 border-emerald-400 text-emerald-900",
                    isSubmitted && isSelected && !isCorrect && "bg-red-50 border-red-300 text-red-900",
                    isSubmitted && !isCorrect && !isSelected && "bg-slate-100 border-slate-200 text-slate-500"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-800 flex items-center justify-center text-xl font-normal">
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span className="text-[15px] md:text-base text-current">{option}</span>
                  </div>
                  {isSubmitted && isCorrect ? <Check className="w-6 h-6 text-emerald-600" /> : null}
                  {isSubmitted && isSelected && !isCorrect ? <X className="w-6 h-6 text-red-500" /> : null}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={toggleInfo}
            className={cn(
              "w-full rounded-xl border px-4 py-2.5 text-base flex items-center justify-center gap-2 transition-colors",
              isSubmitted
                ? "border-amber-300 text-amber-600 hover:bg-amber-50"
                : "border-blue-300 text-blue-600 hover:bg-blue-50"
            )}
          >
            <Lightbulb className="w-5 h-5" />
            {isSubmitted ? "Show Explanation" : "Show Hint"}
          </button>

          <AnimatePresence>
            {showInfoByQuestion[currentIdx] ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className={cn(
                  "rounded-2xl p-4 border",
                  isSubmitted ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-blue-50 border-blue-200 text-slate-800"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center",
                    isSubmitted ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                  )}>
                    <Lightbulb className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold">{isSubmitted ? "Explanation" : "Hint"}</p>
                    <p className="text-base leading-relaxed">{current.explanation}</p>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center pt-1">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentIdx === 0}
            className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!isSubmitted}
            className={cn(
              "w-full md:w-auto md:justify-self-end inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors border",
              isSubmitted
                ? "bg-violet-500 border-violet-500 text-white hover:bg-violet-600"
                : "bg-white border-slate-300 text-slate-400 cursor-not-allowed"
            )}
          >
            {currentIdx < normalizedQuestions.length - 1 ? 'Next' : 'Finish'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
