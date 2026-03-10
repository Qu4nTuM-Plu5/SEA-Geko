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
  onRefineSuccess?: () => void;
  onRefineError?: (message: string) => void;
  modal?: boolean;
}

export const ContentEditor: React.FC<ContentEditorProps> = ({
  content,
  onUpdate,
  onClose,
  onRefineSuccess,
  onRefineError,
  modal = false,
}) => {
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
        onRefineSuccess?.();
        onClose();
        return;
      }

      const res = await aiService.askAboutContent(content, prompt);
      setAnswer(res);
    } catch (error) {
      console.error('AI request failed:', error);
      if (mode === 'refine') {
        onRefineError?.('Could not refine this content. Try again in a moment.');
      } else {
        setAnswer('Could not get a response. Try again in a moment.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "p-6 bg-emerald-50 border border-emerald-200 rounded-3xl relative overflow-hidden group",
        modal ? "w-full shadow-2xl" : "mt-6"
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-100/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-700 font-mono text-xs uppercase tracking-widest font-bold">
            <Sparkles className="w-4 h-4" />
            AI Assistant
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close AI assistant"
            title="Close"
          >
            <X className="w-5 h-5" />
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
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-white text-slate-700 border-slate-200 hover:text-emerald-700 hover:border-emerald-300'
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
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-white text-slate-700 border-slate-200 hover:text-emerald-700 hover:border-emerald-300'
            )}
          >
            Ask about it
          </button>
        </div>

        <p className="text-sm text-slate-700 mb-4">
          {mode === 'refine'
            ? 'Tell the AI how to change this section (add examples, simplify, make it more detailed, etc.).'
            : 'Ask a question about this exact section (e.g., "I do not understand this; explain with an example").'}
        </p>

        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={mode === 'refine' ? 'Describe how to edit this content...' : 'Ask your question...'}
            className="w-full bg-white border border-slate-300 rounded-xl p-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 min-h-[140px] resize-y leading-relaxed"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleUpdate();
              }
            }}
          />
          <div className="absolute bottom-3 left-4 text-[10px] text-slate-500 font-mono uppercase tracking-wider pointer-events-none">
            Ctrl+Enter to send
          </div>
          <button
            onClick={handleUpdate}
            disabled={isUpdating || !prompt.trim()}
            className="absolute bottom-3 right-3 p-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all"
          >
            {isUpdating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        {mode === 'ask' && answer && (
          <div className="mt-4 p-4 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 prose prose-slate max-w-none">
            <Markdown>{answer}</Markdown>
          </div>
        )}
      </div>
    </motion.div>
  );
};
