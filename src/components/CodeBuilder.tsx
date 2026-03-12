import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, RotateCcw, Rocket } from 'lucide-react';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';
import { shuffleListBySeed } from '../lib/shuffle';

interface CodeBuilderProps {
  data: {
    avatarInstruction: string;
    title: string;
    lines: {
      content: string;
      correctValue: string;
    }[];
    options: string[];
  };
  onComplete: () => void;
}

export const CodeBuilder: React.FC<CodeBuilderProps> = ({ data, onComplete }) => {
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [filledValues, setFilledValues] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<'idle' | 'correct' | 'incorrect'>('idle');
  const [isFinished, setIsFinished] = useState(false);

  const currentLine = data.lines[currentLineIdx];
  const isLastLine = currentLineIdx === data.lines.length - 1;
  const displayOptions = useMemo(() => {
    const options = Array.isArray(data.options)
      ? data.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    const lineSeed = (Array.isArray(data.lines) ? data.lines : [])
      .map((line) => `${String(line?.content || '')}::${String(line?.correctValue || '')}`)
      .join('|');
    const seedKey = `${String(data.title || '')}::${lineSeed}`;
    return shuffleListBySeed(options, seedKey);
  }, [data.options, data.lines, data.title]);

  const normalizeToken = (v: string) => String(v || '').replace(/\s+/g, ' ').trim();

  const handleOptionClick = (option: string) => {
    if (status !== 'idle') return;
    if (!currentLine) return;
    
    const expected = normalizeToken(currentLine?.correctValue || '');
    const isCorrect = !expected || normalizeToken(option) === expected;
    setFilledValues(prev => ({ ...prev, [currentLineIdx]: option }));
    
    if (isCorrect) {
      setStatus('correct');
      setTimeout(() => {
        if (isLastLine) {
          setIsFinished(true);
          onComplete();
        } else {
          setCurrentLineIdx(prev => prev + 1);
          setStatus('idle');
        }
      }, 800);
    } else {
      setStatus('incorrect');
      setTimeout(() => setStatus('idle'), 1000);
    }
  };

  return (
    <div className="space-y-6">
      <Avatar message={data.avatarInstruction} />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
        <div className="bg-slate-50 px-4 py-2 flex items-center gap-2 border-b border-slate-100">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400/50" />
            <div className="w-3 h-3 rounded-full bg-amber-400/50" />
            <div className="w-3 h-3 rounded-full bg-emerald-400/50" />
          </div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest ml-2">python</span>
        </div>

        <div className="p-4 md:p-6 font-mono text-base md:text-lg space-y-2 bg-white overflow-x-auto">
          {data.lines.map((line, idx) => {
            const isCurrent = idx === currentLineIdx;
            const isPast = idx < currentLineIdx;
            const parts = line.content.split('___');
            const value = filledValues[idx];

            return (
              <div 
                key={idx} 
                className={cn(
                  "flex items-center gap-2 transition-all duration-300",
                  isCurrent ? "opacity-100 scale-[1.01]" : "opacity-40",
                  isPast && "text-emerald-600"
                )}
              >
                <span className="text-slate-300 text-sm w-4">{idx + 1}</span>
                <div className="flex items-center gap-2 text-slate-800 min-w-max">
                  {parts[0]}
                  <div 
                    className={cn(
                      "min-w-[80px] h-9 border-b-2 flex items-center justify-center transition-all px-2",
                      isCurrent ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200",
                      isPast && "border-transparent text-emerald-600 font-bold"
                    )}
                  >
                    {value || (isCurrent ? "___" : "")}
                  </div>
                  {parts[1]}
                </div>
                {isPast && <Check className="w-4 h-4 text-emerald-500" />}
                {isCurrent && status === 'incorrect' && <X className="w-4 h-4 text-red-500" />}
              </div>
            );
          })}
        </div>
      </div>

      {!isFinished ? (
        <div className="flex flex-wrap gap-3 justify-center mt-8">
          {displayOptions.map((option, optionIdx) => (
            <button
              key={`${option}-${optionIdx}`}
              onClick={() => handleOptionClick(option)}
              className={cn(
                "px-4 md:px-6 py-3 rounded-xl font-mono text-sm md:text-base transition-all border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-emerald-500/50 shadow-sm text-left whitespace-normal break-words max-w-full",
                status === 'incorrect' && "shake"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center p-8 bg-emerald-500/10 border border-emerald-500/20 rounded-3xl text-center"
        >
          <Rocket className="w-12 h-12 text-emerald-400 mb-4" />
          <h3 className="text-2xl font-bold text-emerald-800 mb-2">You Built This!</h3>
          <p className="text-emerald-700/80">Great job completing this program.</p>
        </motion.div>
      )}
    </div>
  );
};
