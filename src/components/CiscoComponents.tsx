import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Plus, Check, LucideIcon, ChevronLeft, X } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

const formatContent = (text: string) => {
  if (!text) return '';
  return text.replace(/\\n/g, '\n');
};

interface AccordionItem {
  title: string;
  content: string;
}

export const CiscoAccordion: React.FC<{ items: AccordionItem[] }> = ({ items }) => {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div 
          key={idx} 
          className={cn(
            "border rounded-2xl overflow-hidden transition-all",
            openIdx === idx ? "border-emerald-500 bg-emerald-50/30" : "border-slate-200 bg-white"
          )}
        >
          <button
            onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
            className="w-full px-6 py-4 flex items-center justify-between text-left"
          >
            <span className={cn("font-bold", openIdx === idx ? "text-emerald-700" : "text-slate-700")}>
              {item.title}
            </span>
            {openIdx === idx ? (
              <ChevronDown className="w-5 h-5 text-emerald-500" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400" />
            )}
          </button>
          <AnimatePresence>
            {openIdx === idx && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 text-slate-600 leading-relaxed text-sm prose prose-slate prose-sm max-w-none">
                  <Markdown>{formatContent(item.content)}</Markdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
};

interface HotspotPoint {
  title: string;
  content: string;
  icon: string;
}

export const CiscoHotspot: React.FC<{ points: HotspotPoint[], image?: string }> = ({ points, image }) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const handleOpen = (idx: number) => {
    setActiveIdx(idx);
    setShowModal(true);
  };

  const handleNext = () => {
    if (activeIdx !== null) {
      setActiveIdx((activeIdx + 1) % points.length);
    }
  };

  const handlePrev = () => {
    if (activeIdx !== null) {
      setActiveIdx((activeIdx - 1 + points.length) % points.length);
    }
  };

  return (
    <div className="flex flex-col gap-10 py-8">
      {image && (
        <div className="relative w-full aspect-video rounded-[40px] overflow-hidden border border-slate-200 shadow-xl bg-white">
          <img src={image} alt="Hotspot Background" className="w-full h-full object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-white/20 to-transparent" />
        </div>
      )}
      
      <div className="flex flex-wrap justify-center gap-12">
        {points.map((point, idx) => {
          const IconComponent = (point.icon && (LucideIcons as any)[point.icon]) || LucideIcons.Info;
          const isCompleted = activeIdx !== null && idx <= (activeIdx || -1); // Simple completion logic
          const isActive = activeIdx === idx;

          return (
            <div key={idx} className="flex flex-col items-center gap-6">
              <button
                onClick={() => handleOpen(idx)}
                className={cn(
                  "relative w-36 h-36 rounded-full flex items-center justify-center transition-all",
                  isActive ? "scale-110 z-10" : "hover:scale-105"
                )}
              >
                {/* Large Dark Blue Circle */}
                <div className={cn(
                  "absolute inset-0 rounded-full transition-all duration-500",
                  isActive ? "bg-[#1a365d] shadow-[0_0_40px_rgba(26,54,93,0.3)]" : "bg-[#1a365d]/90"
                )} />
                
                {/* Icon */}
                <div className={cn(
                  "relative z-10 transition-all duration-500",
                  isActive ? "scale-110" : "opacity-80"
                )}>
                  <IconComponent className={cn(
                    "w-16 h-16",
                    isActive ? "text-emerald-400" : [
                      "text-emerald-400",
                      "text-sky-400",
                      "text-slate-300",
                      "text-amber-400"
                    ][idx % 4]
                  )} />
                </div>

                {/* Plus/Check Button at Bottom - Cisco Style */}
                <div className={cn(
                  "absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full border bg-white flex items-center justify-center transition-all shadow-lg",
                  isCompleted ? "border-emerald-500 text-emerald-500" : "border-sky-400 text-sky-400"
                )}>
                  {isCompleted ? <Check className="w-6 h-6 stroke-[3]" /> : <Plus className="w-6 h-6 stroke-[3]" />}
                </div>
              </button>
              
              <div className="text-center w-36">
                <span className={cn(
                  "text-[10px] font-mono font-bold uppercase tracking-widest block leading-tight",
                  isActive ? "text-emerald-600" : "text-slate-400"
                )}>
                  {point.title}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cisco Style Modal Overlay */}
      <AnimatePresence>
        {showModal && activeIdx !== null && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={handlePrev}
                    className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleNext}
                    className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="text-sm font-bold text-slate-500 font-mono">
                  {activeIdx + 1} / {points.length}
                </div>
                
                <button 
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-white rounded-lg transition-colors text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 md:p-8 flex flex-col md:flex-row gap-6 items-center">
                <div className="flex-1 space-y-3">
                  <h3 className="text-xl font-bold text-slate-900 leading-tight">
                    {points[activeIdx].title}
                  </h3>
                  <div className="text-slate-600 text-sm leading-relaxed prose prose-slate max-w-none">
                    <Markdown>{formatContent(points[activeIdx].content)}</Markdown>
                  </div>
                </div>
                
                <div className="w-full md:w-40 flex-shrink-0 flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full bg-[#1a365d] flex items-center justify-center shadow-lg">
                    {(() => {
                      const Icon = (LucideIcons as any)[points[activeIdx].icon] || LucideIcons.Info;
                      return <Icon className="w-16 h-16 text-sky-400" />;
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface CarouselSlide {
  title: string;
  content: string;
  imagePrompt: string;
  imageUrl?: string;
}

export const CiscoCarousel: React.FC<{ slides: CarouselSlide[] }> = ({ slides }) => {
  const [current, setCurrent] = useState(0);

  return (
    <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
      <div className="flex flex-col md:flex-row min-h-[350px]">
        <div className="flex-1 p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                {current + 1} / {slides.length}
              </span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <h3 className="text-2xl font-bold text-slate-900 leading-tight">{slides[current].title}</h3>
                <div className="text-slate-600 text-sm leading-relaxed prose prose-slate prose-sm max-w-none">
                  <Markdown>{formatContent(slides[current].content)}</Markdown>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              disabled={current === 0}
              onClick={() => setCurrent(c => c - 1)}
              className="w-12 h-12 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="w-5 h-5 text-slate-400" />
            </button>
            <button
              disabled={current === slides.length - 1}
              onClick={() => setCurrent(c => c + 1)}
              className="flex-1 h-12 bg-[#1a365d] text-white rounded-xl font-bold hover:bg-[#1a365d]/90 disabled:opacity-30 transition-all flex items-center justify-center gap-2 text-sm"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 bg-slate-50 p-8 flex items-center justify-center border-l border-slate-100">
          <div className="relative w-full aspect-square max-w-[240px]">
            <motion.div
              key={current}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative w-full h-full bg-white rounded-2xl border border-slate-200 shadow-lg flex items-center justify-center overflow-hidden"
            >
              {slides[current].imageUrl ? (
                <img 
                  src={slides[current].imageUrl} 
                  alt={slides[current].title} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="p-6 text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto">
                    <LucideIcons.Image className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest leading-tight">
                    {slides[current].imagePrompt}
                  </p>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface LearningCardProps {
  title: string;
  content: string;
  image?: string;
  icon?: string;
  layout: 'split' | 'vertical' | 'overlay';
}

export const CiscoLearningCard: React.FC<{ cards: LearningCardProps[] }> = ({ cards }) => {
  return (
    <div className="space-y-12">
      {cards.map((card, idx) => {
        const IconComponent = (card.icon && (LucideIcons as any)[card.icon]) || LucideIcons.Info;

        if (card.layout === 'split') {
          return (
            <div key={idx} className="flex flex-col md:flex-row gap-8 items-stretch">
              <div className="flex-1 bg-white border border-slate-200 p-10 rounded-[32px] shadow-sm flex flex-col justify-center">
                <h3 className="text-3xl font-bold text-slate-900 mb-6 leading-tight">{card.title}</h3>
                <div className="text-slate-600 text-lg leading-relaxed prose prose-slate max-w-none">
                  <Markdown>{formatContent(card.content)}</Markdown>
                </div>
              </div>
              <div className="flex-1 bg-slate-50 rounded-[32px] overflow-hidden border border-slate-200 min-h-[350px] relative p-10 flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  <h4 className="text-xl font-bold text-slate-800 pr-16">{card.title}</h4>
                  {card.icon && (
                    <div className="bg-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center border border-slate-100 flex-shrink-0">
                      <IconComponent className="w-6 h-6 text-sky-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 relative flex items-center justify-center">
                  <div className="w-48 h-48 rounded-full bg-[#1a365d] flex items-center justify-center shadow-xl">
                    <IconComponent className="w-24 h-24 text-sky-400" />
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (card.layout === 'vertical') {
          return (
            <div key={idx} className="flex flex-col items-center gap-8 max-w-2xl mx-auto">
              <div className="relative">
                <div className="w-32 h-32 rounded-full bg-[#1a365d] flex items-center justify-center shadow-xl">
                  <IconComponent className="w-16 h-16 text-sky-400" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full border bg-white flex items-center justify-center shadow-lg text-sky-400">
                  <Plus className="w-5 h-5 stroke-[3]" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h3 className="text-3xl font-bold text-slate-900">{card.title}</h3>
                <div className="text-slate-600 text-lg leading-relaxed prose prose-slate max-w-none">
                  <Markdown>{formatContent(card.content)}</Markdown>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={idx} className="relative w-full min-h-[400px] rounded-[40px] overflow-hidden border border-slate-200 shadow-xl group">
            {card.image ? (
              <img src={card.image} alt={card.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
            ) : (
              <div className="absolute inset-0 bg-slate-100" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-white via-white/40 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-10 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500 rounded-full text-white text-[10px] font-bold uppercase tracking-widest">
                <IconComponent className="w-3 h-3" />
                Key Concept
              </div>
              <h3 className="text-3xl font-bold text-slate-900">{card.title}</h3>
              <div className="text-slate-700 text-lg leading-relaxed max-w-2xl prose prose-invert prose-lg">
                <Markdown>{formatContent(card.content)}</Markdown>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
