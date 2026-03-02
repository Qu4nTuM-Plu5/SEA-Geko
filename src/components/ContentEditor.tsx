import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { aiService } from '../services/aiService';
import { ModuleContent } from '../types';
import { cn } from '../lib/utils';

interface ContentEditorProps {
  content: ModuleContent;
  onUpdate: (newContent: ModuleContent) => void;
  onClose: () => void;
}

export const ContentEditor: React.FC<ContentEditorProps> = ({ content, onUpdate, onClose }) => {
  const [mode, setMode] = useState<'refine' | 'ask'>('refine');
  const [prompt, setPrompt] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [answer, setAnswer] = useState<string>('');

  const handleUpdate = async () => {
    if (!prompt.trim()) return;
    setIsUpdating(true);
    setAnswer('');

    try {
      if (mode === 'refine') {
        const updated = await aiService.editStepContent(content, prompt);
        onUpdate(updated);
        onClose();
        return;
      }

      const res = await aiService.askAboutContent(content, prompt);
      setAnswer(res);
    } catch (error) {
      console.error('AI request failed:', error);
      setAnswer('Could not get a response. Try again in a moment.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="mt-6 p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-3xl relative overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs uppercase tracking-widest">
            <Sparkles className="w-4 h-4" />
            AI Assistant
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/40 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => {
              setMode('refine');
              setAnswer('');
            }}
            className={cn(
              'px-3 py-1.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest border transition-colors',
              mode === 'refine'
                ? 'bg-indigo-500 text-white border-indigo-400'
                : 'bg-black/30 text-white/60 border-white/10 hover:text-white'
            )}
          >
            Edit this content
          </button>
          <button
            onClick={() => {
              setMode('ask');
              setAnswer('');
            }}
            className={cn(
              'px-3 py-1.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest border transition-colors',
              mode === 'ask'
                ? 'bg-indigo-500 text-white border-indigo-400'
                : 'bg-black/30 text-white/60 border-white/10 hover:text-white'
            )}
          >
            Ask about it
          </button>
        </div>

        <p className="text-sm text-white/60 mb-4">
          {mode === 'refine'
            ? 'Tell the AI how to change this section (add examples, simplify, make it more detailed, etc.).'
            : 'Ask a question about this exact section (e.g., "I do not understand this; explain with an example").'}
        </p>

        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={mode === 'refine' ? 'Describe how to edit this content...' : 'Ask your question...'}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[140px] resize-y leading-relaxed"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleUpdate();
              }
            }}
          />
          <div className="absolute bottom-3 left-4 text-[10px] text-white/40 font-mono uppercase tracking-wider pointer-events-none">
            Ctrl+Enter to send
          </div>
          <button
            onClick={handleUpdate}
            disabled={isUpdating || !prompt.trim()}
            className="absolute bottom-3 right-3 p-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all"
          >
            {isUpdating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        {mode === 'ask' && answer && (
          <div className="mt-4 p-4 bg-black/30 border border-white/10 rounded-2xl text-sm text-white/80 prose prose-invert max-w-none">
            <Markdown>{answer}</Markdown>
          </div>
        )}
      </div>
    </motion.div>
  );
};
