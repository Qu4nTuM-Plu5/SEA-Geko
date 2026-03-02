import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

import { Plus } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

interface FlipCardProps {
  card: {
    front: string;
    back: string;
    icon?: string;
    imageUrl?: string;
    cardType?: 'definition' | 'command' | 'acronym' | 'diagram';
  };
  onFlipToBack?: () => void;
}

export const FlipCard: React.FC<FlipCardProps> = ({ card, onFlipToBack }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const IconComponent = (LucideIcons as any)[card.icon || 'Info'] || LucideIcons.Info;

  useEffect(() => {
    setIsFlipped(false);
    setImageFailed(false);
  }, [card.front, card.back, card.imageUrl, card.icon]);

  return (
    <div 
      className="group perspective-1000 h-[360px] sm:h-[400px] md:h-[420px] w-full cursor-pointer"
      onClick={() => {
        const next = !isFlipped;
        setIsFlipped(next);
        if (next) onFlipToBack?.();
      }}
    >
      <motion.div
        className="relative h-full w-full transition-all duration-500 preserve-3d"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
      >
        {/* Front - Matches Photo 2 (Hotspot Circle) */}
        <div className={cn(
          "absolute inset-0 h-full w-full rounded-[32px] bg-white border border-slate-200 p-4 sm:p-6 md:p-8 flex flex-col items-center justify-center text-center backface-hidden overflow-hidden",
          isFlipped ? "" : "shadow-xl shadow-slate-200/50"
        )}>
          <div className="relative mb-4 sm:mb-6">
            <div className="w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 rounded-full bg-[#1a365d] flex items-center justify-center shadow-xl transition-transform group-hover:scale-105 duration-500 overflow-hidden">
              {card.imageUrl && !imageFailed ? (
                <img 
                  src={card.imageUrl} 
                  alt={card.front} 
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <IconComponent className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 text-sky-400" />
              )}
            </div>
            {/* Plus Button at Bottom */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full border bg-white flex items-center justify-center shadow-lg text-sky-400">
              <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3]" />
            </div>
          </div>
          
          <div className="space-y-2 max-w-full min-w-0">
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Challenge</div>
            <p className="text-base sm:text-lg md:text-xl font-bold text-slate-900 leading-tight px-2 sm:px-4 break-normal hyphens-none">
              {card.front}
            </p>
          </div>
          
          <div className="hidden sm:block absolute bottom-6 text-[10px] text-slate-300 uppercase tracking-[0.2em] font-bold">Click to reveal</div>
        </div>

        {/* Back - Matches Photo 3 (Hotspot Modal) */}
        <div 
          className="absolute inset-0 h-full w-full rounded-[32px] bg-white border border-slate-200 p-4 sm:p-6 md:p-8 flex flex-col items-center gap-4 sm:gap-6 backface-hidden overflow-hidden"
          style={{ transform: 'rotateY(180deg)' }}
        >
          <div className="flex-1 min-h-0 w-full text-left space-y-3 sm:space-y-4 overflow-y-auto pr-1">
            <div className="text-[10px] font-mono text-emerald-600 font-bold uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-full inline-block">Solution</div>
            <h4 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 leading-tight break-normal">{card.front}</h4>
            <div className="text-slate-600 text-sm leading-relaxed prose prose-slate prose-sm max-w-none">
              <Markdown>{card.back}</Markdown>
            </div>
          </div>
          
          <div className="w-full flex-shrink-0 flex items-center justify-center">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#1a365d] flex items-center justify-center shadow-lg overflow-hidden">
              {card.imageUrl && !imageFailed ? (
                <img 
                  src={card.imageUrl} 
                  alt={card.front} 
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <IconComponent className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-sky-400" />
              )}
            </div>
          </div>

          <div className="hidden sm:block absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-slate-300 uppercase tracking-[0.2em] font-bold">Click to flip back</div>
        </div>
      </motion.div>
    </div>
  );
};
