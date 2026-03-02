import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Trophy, ArrowRight, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface QuizProps {
  questions: {
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }[];
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

export const Quiz: React.FC<QuizProps> = ({ questions, onComplete }) => {
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
  const [selected, setSelected] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    setCurrentIdx(0);
    setSelected(null);
    setIsSubmitted(false);
    setIsFinished(false);
    setScore(0);
  }, [normalizedQuestions]);

  const current = normalizedQuestions[currentIdx];

  const handleSubmit = () => {
    if (selected === current.correctAnswer) {
      setScore(prev => prev + 1);
    }
    setIsSubmitted(true);
  };

  const handleNext = () => {
    if (currentIdx < normalizedQuestions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelected(null);
      setIsSubmitted(false);
    }
  };

  const handleFinish = () => {
    const percentage = Math.round((score / normalizedQuestions.length) * 100);
    const passed = percentage >= 70;
    setIsFinished(true);
    onComplete?.({ passed, score, percentage });
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
              setSelected(null);
              setIsSubmitted(false);
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
    <div className="space-y-10">
      <div className="space-y-4">
        <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
          <span>Question {currentIdx + 1} of {normalizedQuestions.length}</span>
          <span className="text-emerald-600">{score} Correct</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-emerald-500 shadow-sm" 
            initial={{ width: 0 }}
            animate={{ width: `${((currentIdx + 1) / normalizedQuestions.length) * 100}%` }}
          />
        </div>
      </div>

      <h3 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">{current.question}</h3>

      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {current.options.map((option, idx) => {
            const isCorrect = idx === current.correctAnswer;
            const isSelected = selected === idx;
            
            return (
              <motion.button
                key={idx}
                layout
                disabled={isSubmitted}
                onClick={() => setSelected(idx)}
                className={cn(
                  "w-full p-6 rounded-2xl text-left transition-all border-2 flex items-center justify-between group shadow-sm",
                  !isSubmitted && isSelected && "bg-emerald-50 border-emerald-500 text-emerald-700 ring-4 ring-emerald-500/10",
                  !isSubmitted && !isSelected && "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300",
                  isSubmitted && isCorrect && "bg-emerald-50 border-emerald-500 text-emerald-700",
                  isSubmitted && isSelected && !isCorrect && "bg-red-50 border-red-500 text-red-700",
                  isSubmitted && !isSelected && !isCorrect && "opacity-40 border-slate-100 bg-slate-50"
                )}
              >
                <div className="flex items-center gap-5">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold border-2 transition-all",
                    isSelected ? "bg-emerald-500 text-white border-emerald-500" : "bg-slate-50 border-slate-100 text-slate-400"
                  )}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <span className="text-lg font-medium">{option}</span>
                </div>
                {isSubmitted && isCorrect && <Check className="w-6 h-6 text-emerald-600" />}
                {isSubmitted && isSelected && !isCorrect && <X className="w-6 h-6 text-red-600" />}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isSubmitted && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-8 rounded-3xl border-2 shadow-sm",
              selected === current.correctAnswer 
                ? "bg-emerald-50 border-emerald-100 text-emerald-900" 
                : "bg-red-50 border-red-100 text-red-900"
            )}
          >
            <div className="flex items-start gap-4">
              <div className={cn(
                "p-1.5 rounded-full mt-0.5 shadow-sm",
                selected === current.correctAnswer ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
              )}>
                {selected === current.correctAnswer ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </div>
              <div className="space-y-2">
                <div className="font-bold text-xs uppercase tracking-widest">
                  {selected === current.correctAnswer ? "Correct!" : "Not quite"}
                </div>
                <p className="text-base opacity-90 leading-relaxed font-medium">{current.explanation}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pt-6">
        {!isSubmitted ? (
          <button
            onClick={handleSubmit}
            disabled={selected === null}
            className="w-full py-5 bg-emerald-500 text-white font-bold rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 text-lg"
          >
            Check Answer
          </button>
        ) : (
          currentIdx < normalizedQuestions.length - 1 ? (
            <button
              onClick={handleNext}
              className="w-full py-5 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all flex items-center justify-center gap-3 text-lg shadow-xl"
            >
              Continue
              <ArrowRight className="w-6 h-6" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="w-full py-5 bg-emerald-500 text-white font-bold rounded-2xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-3 shadow-xl shadow-emerald-500/20 text-lg"
            >
              Finish Module
              <Trophy className="w-6 h-6" />
            </button>
          )
        )}
      </div>
    </div>
  );
};
