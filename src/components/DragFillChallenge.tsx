import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';

interface DragFillProps {
  challenge: {
    instruction?: string;
    codeTemplate: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  };
  onComplete: (isCorrect: boolean) => void;
}

const normalizeChallengeTemplate = (template: string): string => {
  const raw = String(template || '').trim();
  if (!raw) return 'Complete the statement: ___';
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

  return out.includes('___') ? out : `${out} ___`.trim();
};

export const DragFillChallenge: React.FC<DragFillProps> = ({ challenge, onComplete }) => {
  const normalizedTemplate = normalizeChallengeTemplate(challenge.codeTemplate);
  const parts = normalizedTemplate.split('___');
  const blankCount = Math.max(1, parts.length - 1);
  const [selectedOptions, setSelectedOptions] = useState<(string | null)[]>(
    Array.from({ length: blankCount }, () => null)
  );
  const [activeBlankIdx, setActiveBlankIdx] = useState(0);
  const [status, setStatus] = useState<'idle' | 'correct' | 'incorrect'>('idle');

  useEffect(() => {
    setSelectedOptions(Array.from({ length: blankCount }, () => null));
    setActiveBlankIdx(0);
    setStatus('idle');
  }, [normalizedTemplate, challenge.correctAnswer, blankCount]);

  const expectedAnswers = (() => {
    const raw = String(challenge.correctAnswer || '');
    const parsed = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    if (!parsed.length) {
      return Array.from({ length: blankCount }, () => '');
    }
    if (parsed.length >= blankCount) {
      return parsed.slice(0, blankCount);
    }
    return [...parsed, ...Array.from({ length: blankCount - parsed.length }, () => '')];
  })();

  const handleCheck = () => {
    if (selectedOptions.some((v) => !v)) return;
    const normalize = (v: string | null) => String(v || '').trim().toLowerCase();
    const isCorrect = selectedOptions.every((picked, idx) => normalize(picked) === normalize(expectedAnswers[idx]));
    setStatus(isCorrect ? 'correct' : 'incorrect');
    onComplete(isCorrect);
  };

  const reset = () => {
    setSelectedOptions(Array.from({ length: blankCount }, () => null));
    setActiveBlankIdx(0);
    setStatus('idle');
  };

  const handlePickOption = (option: string) => {
    if (status !== 'idle') return;
    setSelectedOptions((prev) => {
      const next = [...prev];
      next[activeBlankIdx] = option;
      const nextEmpty = next.findIndex((v) => !v);
      if (nextEmpty !== -1) {
        setActiveBlankIdx(nextEmpty);
      }
      return next;
    });
  };

  return (
    <div className="p-8 bg-white rounded-[32px] border border-slate-200 shadow-sm">
      <div className="mb-8">
        <h3 className="text-xl font-bold text-slate-900">Interactive Challenge</h3>
        <p className="text-slate-500 mt-2 font-medium">{challenge.instruction || "Complete the activity below."}</p>
        <p className="text-xs text-slate-400 mt-2 font-mono uppercase tracking-widest">
          Select each blank from left to right ({blankCount} blank{blankCount > 1 ? 's' : ''})
        </p>
      </div>
      
      <div className="bg-slate-50 p-6 md:p-10 rounded-2xl font-mono text-base md:text-xl mb-10 flex flex-wrap items-center gap-3 leading-relaxed overflow-x-auto border border-slate-100 text-slate-700">
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            {part}
            {idx < blankCount && (
              <button
                onClick={() => status === 'idle' && setActiveBlankIdx(idx)}
                className={cn(
                  "min-w-[120px] min-h-12 px-3 py-2 border-2 border-dashed rounded-xl flex items-center justify-center transition-all shadow-inner",
                  activeBlankIdx === idx && status === 'idle' && "ring-2 ring-emerald-200",
                  selectedOptions[idx] ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-300 bg-white",
                  status === 'correct' && "border-emerald-500 bg-emerald-500 text-white shadow-lg",
                  status === 'incorrect' && "border-red-500 bg-red-500 text-white shadow-lg"
                )}
              >
                {selectedOptions[idx] || `Blank ${idx + 1}`}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 mb-10">
        {challenge.options.map((option, optionIdx) => (
          <button
            key={`${option}-${optionIdx}`}
            onClick={() => handlePickOption(option)}
            disabled={
              status !== 'idle' ||
              selectedOptions.some((v, idx) => idx !== activeBlankIdx && v === option)
            }
            className={cn(
              "px-8 py-4 rounded-xl font-mono text-lg transition-all border-2",
              selectedOptions[activeBlankIdx] === option
                ? "bg-emerald-500 border-emerald-500 text-white shadow-xl shadow-emerald-500/20 scale-105" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300",
              status !== 'idle' && !selectedOptions.includes(option) && "opacity-40"
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {status === 'idle' ? (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={handleCheck}
            disabled={selectedOptions.some((v) => !v)}
            className="w-full py-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all uppercase tracking-widest text-sm shadow-xl"
          >
            Check Answer
          </motion.button>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "p-8 rounded-2xl flex items-center justify-between border-2",
              status === 'correct' ? "bg-emerald-50 text-emerald-900 border-emerald-100" : "bg-red-50 text-red-900 border-red-100"
            )}
          >
            <div className="flex items-center gap-5">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shadow-sm",
                status === 'correct' ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
              )}>
                {status === 'correct' ? <Check className="w-6 h-6" /> : <X className="w-6 h-6" />}
              </div>
              <div>
                <p className="font-bold text-lg">{status === 'correct' ? 'Excellent!' : 'Not quite right'}</p>
                <p className="text-base opacity-80 font-medium leading-relaxed">{challenge.explanation}</p>
              </div>
            </div>
            <button onClick={reset} className="p-3 hover:bg-black/5 rounded-xl transition-colors">
              <RotateCcw className="w-6 h-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
