import React from 'react';
import { motion } from 'motion/react';

export const Avatar: React.FC<{ message: string }> = ({ message }) => {
  return (
    <div className="flex items-start gap-4 mb-8">
      <div className="relative w-24 h-24 flex-shrink-0">
        <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse" />
        <img 
          src="https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4" 
          alt="AI Tutor"
          className="relative w-full h-full rounded-2xl border-2 border-emerald-500/30 bg-zinc-800 p-2"
        />
      </div>
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="relative bg-zinc-800 border border-white/10 p-4 rounded-2xl rounded-tl-none shadow-xl max-w-md"
      >
        <div className="absolute top-0 -left-2 w-0 h-0 border-t-[10px] border-t-zinc-800 border-l-[10px] border-l-transparent" />
        <p className="text-white text-sm leading-relaxed font-medium">
          {message}
        </p>
      </motion.div>
    </div>
  );
};
