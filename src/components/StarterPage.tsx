import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Leaf, ChevronDown, ChevronUp, Sparkles, Brain, Layout, GraduationCap } from 'lucide-react';

type StarterPageProps = {
  openStarterFaq: number;
  setOpenStarterFaq: (index: number) => void;
  onStart: () => void;
};

const STARTER_WORKFLOW_STEPS = [
  { number: 1, title: 'Choose Topic', description: 'Enter what you want to learn.', icon: Sparkles },
  { number: 2, title: 'Plan Modules', description: 'Build or edit your course outline.', icon: Layout },
  { number: 3, title: 'Generate Content', description: 'Create lessons, quizzes, and activities.', icon: Brain },
  { number: 4, title: 'Learn & Track', description: 'Complete modules and monitor progress.', icon: GraduationCap },
];

const STARTER_FAQS = [
  {
    question: 'Why does generation fail sometimes?',
    answer: 'Usually backend or API key setup is missing. Run the API server and check your environment keys.',
  },
  {
    question: 'Can I edit the outline?',
    answer: 'Yes. You can adjust modules and lessons before content generation.',
  },
  {
    question: 'Can I export my work?',
    answer: 'Yes. Export and import keeps your course content and progress.',
  },
];

const SAMPLE_VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const SAMPLE_VIDEO_URL_2 = 'https://www.w3schools.com/html/mov_bbb.mp4';
const SAMPLE_CV_VIDEO_URL = '/videos/starter-cv-dashboard.mp4';
const GEKO_LOOP_WORDS = ['GEKO', 'AI', 'LEARN'];
const GEKO_LOOP_COPIES = 3;
const HERO_IMAGE_PRIMARY = '/mascot/starter-hero.png';
const HERO_IMAGE_FALLBACK = '/mascot/banner.png';
const LADYBUG_CRAWLERS = [
  { left: '12%', top: '20%', x: [0, 22, -10, 0], y: [0, -8, 6, 0], r: [0, 8, -6, 0], duration: 12, delay: 0.4 },
  { left: '34%', top: '10%', x: [0, -18, 14, 0], y: [0, 6, -7, 0], r: [0, -7, 5, 0], duration: 11, delay: 1.1 },
  { left: '58%', top: '24%', x: [0, 20, -12, 0], y: [0, -7, 8, 0], r: [0, 6, -8, 0], duration: 13, delay: 0.8 },
  { left: '75%', top: '16%', x: [0, -16, 18, 0], y: [0, 8, -6, 0], r: [0, -8, 6, 0], duration: 12.5, delay: 1.6 },
  { left: '22%', top: '56%', x: [0, 24, -9, 0], y: [0, -6, 7, 0], r: [0, 7, -5, 0], duration: 14, delay: 0.2 },
  { left: '68%', top: '62%', x: [0, -20, 12, 0], y: [0, 8, -7, 0], r: [0, -6, 8, 0], duration: 13.5, delay: 1.4 },
];

const getMarqueeWordClass = (word: string) => {
  if (word === 'GEKO') return 'text-emerald-700';
  if (word === 'AI') return 'text-red-500';
  return 'text-emerald-500';
};

export default function StarterPage({ openStarterFaq, setOpenStarterFaq, onStart }: StarterPageProps) {
  return (
    <div className="min-h-screen relative overflow-hidden text-white bg-[radial-gradient(circle_at_15%_12%,#72cde3_0%,#5d9dff_30%,#4c61d2_57%,#322f93_82%,#15174f_100%)] flex flex-col">
      <div className="absolute inset-0 pointer-events-none">
        <span className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full bg-slate-950/34 blur-3xl" />
        <span className="absolute -top-16 right-24 w-64 h-64 rounded-full bg-fuchsia-500/28 blur-3xl" />
        <span className="absolute top-40 left-16 w-72 h-72 rounded-full bg-cyan-400/26 blur-3xl" />
        <span className="absolute bottom-10 right-[28%] w-80 h-80 rounded-full bg-violet-300/18 blur-3xl" />
      </div>
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <motion.span
            key={i}
            className="leaf-float"
            style={{
              left: `${5 + (i * 7) % 90}%`,
              top: `${8 + (i % 6) * 14}%`,
              animationDelay: `${i * 0.25}s`,
            }}
          />
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none">
        {LADYBUG_CRAWLERS.map((bug, idx) => (
          <motion.div
            key={`ladybug-${idx}`}
            className="ladybug-walker"
            style={{ left: bug.left, top: bug.top }}
            animate={{ x: bug.x, y: bug.y, rotate: bug.r }}
            transition={{ duration: bug.duration, ease: 'easeInOut', repeat: Infinity, delay: bug.delay }}
          >
            <svg className="ladybug-trail" viewBox="0 0 140 70" aria-hidden="true">
              <path d="M3 46 C 26 8, 48 65, 72 34 S 115 12, 136 34" />
            </svg>
            <span className="ladybug-bug" aria-hidden="true">
              <span className="ladybug-head" />
              <span className="ladybug-wing ladybug-wing-left" />
              <span className="ladybug-wing ladybug-wing-right" />
              <span className="ladybug-seam" />
            </span>
          </motion.div>
        ))}
      </div>

      <header className="fixed inset-x-0 top-0 z-20">
        <div className="mx-auto w-full max-w-[1800px] px-4 md:px-7 pt-3">
          <div className="rounded-2xl border border-white/75 bg-white/36 backdrop-blur-2xl shadow-[0_14px_30px_rgba(6,18,53,0.14)]">
            <div className="h-20 flex items-center justify-between px-3 md:px-5">
              <div className="relative w-16 h-16 md:w-20 md:h-20 pointer-events-none">
                <span
                  aria-hidden="true"
                  className="absolute left-[30%] top-[24%] w-[40%] h-[26%] rounded-full bg-white/65 blur-[6px]"
                />
                <img
                  src="/mascot/icon.png"
                  alt="SEA-Geko logo"
                  className="relative w-full h-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.14)]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center rounded-full border border-white/70 bg-white/30 backdrop-blur-xl text-slate-900 px-7 py-3 font-extrabold text-lg shadow-[0_10px_26px_rgba(4,14,48,0.2)] transition-transform hover:-translate-y-0.5"
              >
                Use SEA-Geko
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 px-4 pt-28 pb-8 md:px-7 md:pt-32 md:pb-10 flex-1">
        <section className="mx-auto w-full max-w-7xl">
          <div className="w-full rounded-[2.4rem] border border-white/30 bg-white/10 backdrop-blur-3xl shadow-[0_18px_46px_rgba(6,18,53,0.36)]">
            <div className="grid md:grid-cols-2 gap-8 items-center px-8 py-12 md:px-10 md:py-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/16 px-3 py-1 text-[11px] uppercase tracking-[0.16em] font-semibold">
                <Leaf className="w-3 h-3" />
                SEA-Geko
              </p>
              <h1 className="mt-4 text-3xl md:text-5xl font-extrabold leading-[0.95] tracking-tight uppercase">
                Group Learning
                <br />
                That Feels Fun
              </h1>
              <p className="mt-4 text-base md:text-lg text-white/92 max-w-md">
                Build course plans, generate modules, and learn interactively in one workspace designed for fast progress.
              </p>
            </div>

            <div className="flex items-center justify-center md:justify-end">
              <img
                src={HERO_IMAGE_PRIMARY}
                alt="SEA-Geko learning workspace"
                className="block w-full max-w-[840px] md:max-w-[1080px] h-auto object-contain scale-[1.16] md:scale-[1.3] drop-shadow-[0_20px_40px_rgba(0,0,0,0.32)]"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.fallbackApplied === '1') return;
                  img.dataset.fallbackApplied = '1';
                  img.src = HERO_IMAGE_FALLBACK;
                }}
              />
            </div>
              </div>
            </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="w-full rounded-[2.2rem] border border-white/28 bg-white/10 backdrop-blur-3xl shadow-[0_18px_46px_rgba(6,18,53,0.34)] px-6 py-9 md:px-8 md:py-10">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] items-center">
              <div className="rounded-[2rem] bg-white/10 p-0 overflow-hidden flex items-center justify-center">
                <video
                  className="block w-full h-auto max-h-[48svh] md:max-h-[62svh] object-contain pointer-events-none select-none"
                  src={SAMPLE_CV_VIDEO_URL}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  tabIndex={-1}
                  onEnded={(e) => {
                    e.currentTarget.currentTime = 0;
                    void e.currentTarget.play();
                  }}
                />
              </div>

              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold leading-[1.08]">
                  Build your dashboard just by uploading your CV
                </h2>
                <p className="mt-4 text-base md:text-lg text-white/92 font-semibold">
                  Upload once and SEA-Geko generates your profile insights, learning direction, and a personalized dashboard.
                </p>
                <p className="mt-3 text-sm md:text-base text-white/85">
                  Available formats: PDF, DOC, DOCX, TXT, MD, and RTF.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="w-full rounded-[2.2rem] border border-white/28 bg-white/10 backdrop-blur-3xl shadow-[0_18px_46px_rgba(6,18,53,0.34)] px-6 py-9 md:px-8 md:py-10">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-center">
              <div className="rounded-[2rem] border border-white/22 bg-white/12 p-1.5 overflow-hidden">
                <video
                  className="block w-full h-[48svh] md:h-[62svh] rounded-[1.75rem] object-cover shadow-2xl pointer-events-none select-none"
                  src={SAMPLE_VIDEO_URL}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  tabIndex={-1}
                  onEnded={(e) => {
                    e.currentTarget.currentTime = 0;
                    void e.currentTarget.play();
                  }}
                />
              </div>

              <div>
                <h2 className="text-xl md:text-3xl font-extrabold leading-[1.08]">
                  Preview course generation before you start learning
                </h2>
                <p className="mt-4 text-base md:text-lg text-white/92">
                  SEA-Geko helps you build modules, lessons, quizzes, and interactive activities in one guided flow.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="w-full rounded-[2.2rem] border border-white/28 bg-white/10 backdrop-blur-3xl shadow-[0_18px_46px_rgba(6,18,53,0.34)] px-6 py-9 md:px-8 md:py-10">
            <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] items-center">
              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold leading-[1.08]">
                  See activity and progress in one learning workspace
                </h2>
                <p className="mt-5 text-base md:text-xl text-white/92 font-semibold">
                  Monitor course milestones, continue paused lessons, and stay aligned with your study path.
                </p>
              </div>

              <div className="rounded-[2rem] border border-white/22 bg-white/12 p-1.5 overflow-hidden">
                <video
                  className="block w-full h-[48svh] md:h-[62svh] rounded-[1.75rem] object-cover shadow-2xl pointer-events-none select-none"
                  src={SAMPLE_VIDEO_URL_2}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  tabIndex={-1}
                  onEnded={(e) => {
                    e.currentTarget.currentTime = 0;
                    void e.currentTarget.play();
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-20">
          <div className="w-full">
          <h2 className="text-3xl md:text-5xl font-extrabold text-center">How Geko AI Works</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {STARTER_WORKFLOW_STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.number} className="rounded-3xl border border-white/25 bg-white/12 backdrop-blur-2xl p-5 shadow-[0_14px_30px_rgba(6,18,53,0.28)]">
                  <Icon className="w-6 h-6 text-cyan-100" />
                  <h3 className="mt-3 text-2xl font-extrabold">{step.title}</h3>
                  <p className="mt-2 text-base text-white/92 font-semibold">{step.description}</p>
                </div>
              );
            })}
          </div>
          </div>
        </section>

        <section className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen mt-20">
          <div className="w-full bg-white/95 backdrop-blur-xl shadow-[0_16px_38px_rgba(0,0,0,0.18)] py-5 overflow-hidden">
            <motion.div
              className="flex w-max"
              animate={{ x: ['0%', '-33.333%'] }}
              transition={{ duration: 28, ease: 'linear', repeat: Infinity }}
            >
              {[...Array(GEKO_LOOP_COPIES)].map((_, groupIdx) => (
                <div
                  key={groupIdx}
                  className="flex items-center gap-16 md:gap-20 pl-10 md:pl-14 first:pl-0"
                >
                  {GEKO_LOOP_WORDS.map((word) => (
                    <React.Fragment key={`${groupIdx}-${word}`}>
                      <span className={`text-2xl md:text-4xl font-extrabold tracking-tight ${getMarqueeWordClass(word)}`}>
                        {word}
                      </span>
                      <img
                        src="/mascot/icon.png"
                        alt="Geko icon"
                        className="w-9 h-9 md:w-11 md:h-11 object-contain opacity-95"
                      />
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-20">
          <div className="w-full">
          <h2 className="text-4xl md:text-6xl font-extrabold text-center">Frequently Asked Questions</h2>
          <div className="mt-10 space-y-5">
            {STARTER_FAQS.map((item, index) => {
              const isOpen = openStarterFaq === index;
              return (
                <div key={item.question} className="rounded-3xl border border-white/25 bg-white/12 backdrop-blur-3xl overflow-hidden shadow-[0_14px_30px_rgba(6,18,53,0.28)]">
                  <button
                    type="button"
                    onClick={() => setOpenStarterFaq(isOpen ? -1 : index)}
                    className="w-full px-7 py-6 flex items-center justify-between text-left"
                  >
                    <span className="text-2xl font-extrabold">{item.question}</span>
                    {isOpen ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        <p className="px-7 pb-7 text-lg text-white/92 font-semibold border-t border-white/25 pt-5">{item.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mt-auto border-t border-white/20 bg-white/12 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 pt-5 pb-0 md:px-10 md:pt-6 md:pb-0 text-center">
          <p className="text-2xl md:text-3xl font-extrabold tracking-wide leading-none text-white/95">
            SEA-Geko 2026. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
