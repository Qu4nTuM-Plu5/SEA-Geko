import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Leaf, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';

type StarterPageProps = {
  openStarterFaq: number;
  setOpenStarterFaq: (index: number) => void;
  onStart: () => void;
};

const STARTER_FAQS = [
  {
    question: 'Can I add more challenges or contents within the learning page?',
    answer: 'You can add more details to your topic, then regenerate or modify specific parts (more flashcards , change lecture video , more challenges and more ) to expand the course step by step.',
  },
  {
    question: 'How do I create a course in this project?',
    answer: 'You can use Manual Outline mode to design modules yourself, or Auto Course mode to generate a full outline from your learning goal.',
  },
  {
    question: 'Can I edit course structure after generating?',
    answer: 'Yes. You can refine modules, lessons, and sub-content, then regenerate specific parts without rebuilding everything.',
  },
  {
    question: 'Does SEA-Geko support multiple languages?',
    answer: 'Yes. SEA-Geko supports English, Burmese, Indonesian, Malay, Thai, Vietnamese, Filipino, Khmer, and Lao.',
  },
  {
    question: 'Can I change language for the app and interview practice?',
    answer: 'Yes. You can switch app language from the language selector, and interview setup also lets you choose a target interview language.',
  },
  {
    question: 'Can I use the app offline?',
    answer: 'You can open downloaded courses and continue learning offline. AI generation, AI editing, publishing, and live community features require internet.',
  },
  {
    question: 'What is the CV upload used for?',
    answer: 'CV upload builds your professional dashboard, extracts profile signals, and powers role guidance. Supported formats include DOC, DOCX, TXT, MD, and RTF.',
  },
  {
    question: 'Can I publish courses or keep them private?',
    answer: 'Yes. Courses can stay private or be published to community feed. You can also download public courses into your own account.',
  },
  {
    question: 'Does SEA-Geko support interview practice?',
    answer: 'Yes. It includes AI interview preparation with generated questions, text or voice answers, feedback per question, and a final review summary.',
  },
];

const ASSET_VERSION = '20260312b';
const withBaseAsset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}?v=${ASSET_VERSION}`;
const SAMPLE_CV_VIDEO_URL = withBaseAsset('/videos/starter-cv-dashboard.mp4');
const SAMPLE_MANUAL_VIDEO_URL = withBaseAsset('/videos/starter-manual-outline.mp4');
const SAMPLE_AUTO_VIDEO_URL = withBaseAsset('/videos/starter-auto-course.mp4');
const SAMPLE_PROGRESS_TRACKING_VIDEO_URL = withBaseAsset('/videos/starter-progress-tracking.mp4');
const SAMPLE_GAMIFIED_QUIZ_VIDEO_URL = withBaseAsset('/videos/starter-gamified-quiz.mp4');
const SAMPLE_CONTENT_EDITING_VIDEO_URL = withBaseAsset('/videos/starter-content-editing.mp4');
const SAMPLE_VIDEO_EDIT_VIDEO_URL = withBaseAsset('/videos/starter-video-edit.mp4');
const SAMPLE_OUTLINE_EDITING_VIDEO_URL = withBaseAsset('/videos/starter-outline-editing.mp4');
const SAMPLE_MODULE_CRAFTING_VIDEO_URL = withBaseAsset('/videos/starter-module-crafting.mp4');
const SAMPLE_INTERVIEW_TEXT_MODE_VIDEO_URL = withBaseAsset('/videos/starter-interview-text-mode.mp4');
const SAMPLE_INTERVIEW_VOICE_MODE_VIDEO_URL = withBaseAsset('/videos/starter-interview-voice-mode.mp4');
const SAMPLE_INTERVIEW_FINAL_FEEDBACK_VIDEO_URL = withBaseAsset('/videos/starter-interview-final-feedback.mp4');
const GEKO_LOOP_WORDS = ['GEKO', 'AI', 'LEARN'];
const GEKO_LOOP_COPIES = 3;
const HERO_IMAGE_PRIMARY = '/mascot/starter-hero.png';
const HERO_IMAGE_FALLBACK = '/mascot/banner.png';
const CREATION_MODE_SLIDES = [
  {
    title: 'Manual Outline Creation',
    description: 'Design your modules and lessons yourself, then let SEA-Geko generate each sub-content exactly where you need it.',
    detail: 'Best for teachers and learners who want full structure control and precise topic ordering.',
    videoSrc: SAMPLE_MANUAL_VIDEO_URL,
  },
  {
    title: 'Auto Course Creation',
    description: 'Enter your learning goal and SEA-Geko automatically creates the complete course outline and lesson flow for you.',
    detail: 'Best for fast course setup when you want to start learning immediately.',
    videoSrc: SAMPLE_AUTO_VIDEO_URL,
  },
] as const;

const COURSE_FEATURE_SPOTLIGHTS = [
  {
    tag: 'Feature 01',
    title: 'Progress Completeness Tracking',
    description: 'Track finished lessons, pending steps, and completion rates across modules in one clear dashboard view.',
    detail: 'See what is complete, what is blocked, and what to continue next without losing your place.',
    videoSrc: SAMPLE_PROGRESS_TRACKING_VIDEO_URL,
  },
  {
    tag: 'Feature 02',
    title: 'Gamified Interactive Quiz',
    description: 'Turn assessment into interactive quiz moments that keep learners engaged and improve retention.',
    detail: 'Use challenge-style questions, instant feedback, and streak momentum to make practice enjoyable.',
    videoSrc: SAMPLE_GAMIFIED_QUIZ_VIDEO_URL,
  },
  {
    tag: 'Feature 03',
    title: 'Easy Content Editing',
    description: 'Quickly revise modules, lesson text, and generated activities whenever your outline changes.',
    detail: 'Update course flow in seconds and keep every section aligned without rebuilding from scratch.',
    videoSrc: SAMPLE_CONTENT_EDITING_VIDEO_URL,
  },
  {
    tag: 'Feature 04',
    title: 'Video Edit Feature',
    description: 'Edit and refine learning videos directly in your course flow without breaking lesson continuity.',
    detail: 'Trim, adjust, and upgrade video content quickly so every module stays clear and engaging.',
    videoSrc: SAMPLE_VIDEO_EDIT_VIDEO_URL,
  },
] as const;

const OUTLINE_EDITING_SHOWCASE = {
  title: 'Outline Editing Showcase',
  description: 'Refine lesson flow, reorder sections, and tune your learning path in seconds.',
  videoSrc: SAMPLE_OUTLINE_EDITING_VIDEO_URL,
  glowClass: 'from-cyan-300/45 via-sky-300/28 to-transparent',
} as const;

const MODULE_CRAFTING_SHOWCASE = {
  title: 'Module Crafting Workflow',
  description: 'Craft stronger modules with focused content blocks and cleaner structure.',
  videoSrc: SAMPLE_MODULE_CRAFTING_VIDEO_URL,
  glowClass: 'from-amber-300/45 via-orange-300/30 to-transparent',
} as const;

const INTERVIEW_MODE_SHOWCASES = [
  {
    title: 'Text Mode Interview',
    description: 'Answer interview questions in text mode and receive structured, skill-focused review.',
    videoSrc: SAMPLE_INTERVIEW_TEXT_MODE_VIDEO_URL,
    glowClass: 'from-teal-300/45 via-cyan-300/28 to-transparent',
  },
  {
    title: 'Voice Mode Interview',
    description: 'Practice speaking naturally with voice-mode responses and evaluate communication clarity.',
    videoSrc: SAMPLE_INTERVIEW_VOICE_MODE_VIDEO_URL,
    glowClass: 'from-indigo-300/45 via-blue-300/28 to-transparent',
  },
] as const;

const INTERVIEW_FINAL_FEEDBACK_SHOWCASE = {
  title: 'Final Feedback Review',
  description: 'Get a full interview summary with strengths, weak points, and concrete next-step improvements.',
  videoSrc: SAMPLE_INTERVIEW_FINAL_FEEDBACK_VIDEO_URL,
  glowClass: 'from-emerald-300/45 via-lime-300/28 to-transparent',
} as const;

const getMarqueeWordClass = (word: string) => {
  if (word === 'GEKO') return 'text-emerald-700';
  if (word === 'AI') return 'text-red-500';
  return 'text-emerald-500';
};

export default function StarterPage({ openStarterFaq, setOpenStarterFaq, onStart }: StarterPageProps) {
  const [creationModeIndex, setCreationModeIndex] = React.useState(0);
  const [creationModeDirection, setCreationModeDirection] = React.useState(1);
  const activeCreationMode = CREATION_MODE_SLIDES[creationModeIndex];

  const playMutedVideo = (video: HTMLVideoElement) => {
    video.muted = true;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  };

  const moveCreationMode = (dir: -1 | 1) => {
    setCreationModeDirection(dir);
    setCreationModeIndex((prev) => (prev + dir + CREATION_MODE_SLIDES.length) % CREATION_MODE_SLIDES.length);
  };

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
                
                <br />
                Bridging the Gap from Classroom to Career
              </h1>
              <p className="mt-4 text-base md:text-lg text-white/92 max-w-md">
                One AI workspace for course learning, interview practice, and job-role matching built for fast career progress.
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
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  tabIndex={-1}
                  onLoadedData={(e) => {
                    playMutedVideo(e.currentTarget);
                  }}
                  onEnded={(e) => {
                    e.currentTarget.currentTime = 0;
                    void e.currentTarget.play();
                  }}
                >
                  <source src={SAMPLE_CV_VIDEO_URL} type="video/mp4" />
                </video>
              </div>

              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold leading-[1.08]">
                  Build your dashboard just by uploading your CV
                </h2>
                <p className="mt-4 text-base md:text-lg text-white/92 font-semibold">
                  Upload once and SEA-Geko generates your profile insights, learning direction, and a personalized dashboard.
                </p>
                <p className="mt-3 text-sm md:text-base text-white/85">
                  Available formats: DOC, DOCX, TXT, MD, and RTF.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="w-full rounded-[2.2rem] border border-white/28 bg-white/10 backdrop-blur-3xl shadow-[0_18px_46px_rgba(6,18,53,0.34)] px-6 py-8 md:px-8 md:py-9">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-2xl md:text-4xl font-extrabold leading-tight">Start Creating Courses</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => moveCreationMode(-1)}
                  className="h-11 w-11 rounded-full border border-white/35 bg-white/18 hover:bg-white/28 transition-colors flex items-center justify-center"
                  aria-label="Previous mode"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCreationMode(1)}
                  className="h-11 w-11 rounded-full border border-white/35 bg-white/18 hover:bg-white/28 transition-colors flex items-center justify-center"
                  aria-label="Next mode"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[1.9rem] border border-white/25 bg-white/8">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={`${creationModeIndex}-${activeCreationMode.title}`}
                  initial={{ opacity: 0, x: creationModeDirection > 0 ? 90 : -90 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: creationModeDirection > 0 ? -90 : 90 }}
                  transition={{ duration: 0.34, ease: 'easeOut' }}
                  className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-center p-4 md:p-6"
                >
                  <div className="rounded-[1.5rem] border border-white/24 bg-white/10 p-0 overflow-hidden flex items-center justify-center">
                    <video
                      className="block w-full h-auto max-h-[48svh] md:max-h-[62svh] object-contain pointer-events-none select-none"
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="auto"
                      controls={false}
                      disablePictureInPicture
                      controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                      tabIndex={-1}
                      onLoadedData={(e) => {
                        playMutedVideo(e.currentTarget);
                      }}
                      onEnded={(e) => {
                        e.currentTarget.currentTime = 0;
                        void e.currentTarget.play();
                      }}
                    >
                      <source src={activeCreationMode.videoSrc} type="video/mp4" />
                    </video>
                  </div>

                  <div>
                    <p className="text-xs md:text-sm uppercase tracking-[0.18em] text-white/75 font-semibold">
                      Mode {creationModeIndex + 1} of {CREATION_MODE_SLIDES.length}
                    </p>
                    <h3 className="mt-3 text-2xl md:text-4xl font-extrabold leading-[1.06]">
                      {activeCreationMode.title}
                    </h3>
                    <p className="mt-4 text-base md:text-lg text-white/92 font-semibold">
                      {activeCreationMode.description}
                    </p>
                    <p className="mt-3 text-sm md:text-base text-white/86">
                      {activeCreationMode.detail}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="relative">
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-4xl font-extrabold leading-tight">{OUTLINE_EDITING_SHOWCASE.title}</h2>
              <p className="mt-2 text-sm md:text-base text-white/88">{OUTLINE_EDITING_SHOWCASE.description}</p>
              <svg
                viewBox="0 0 180 78"
                className="mt-2 h-14 w-40 md:h-16 md:w-44 text-cyan-200/85"
                fill="none"
                aria-hidden="true"
              >
                <path d="M10 10 C 8 42, 44 64, 138 64" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M128 54 L141 64 L128 74" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <video
              className="mt-2 block w-auto max-w-full md:max-w-[820px] h-auto mx-auto rounded-[2rem] border border-white/45 shadow-[0_18px_40px_rgba(6,18,53,0.3)] pointer-events-none select-none"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              tabIndex={-1}
              onLoadedData={(e) => {
                playMutedVideo(e.currentTarget);
              }}
              onEnded={(e) => {
                e.currentTarget.currentTime = 0;
                void e.currentTarget.play();
              }}
            >
              <source src={OUTLINE_EDITING_SHOWCASE.videoSrc} type="video/mp4" />
            </video>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-10">
          <div className="relative grid gap-6 lg:grid-cols-[1.22fr_0.78fr] items-center">
            <div className="lg:pr-3">
              <video
                className="block w-full h-auto max-h-[62svh] rounded-[2rem] shadow-[0_20px_44px_rgba(6,18,53,0.32)] pointer-events-none select-none"
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                controls={false}
                disablePictureInPicture
                controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                tabIndex={-1}
                onLoadedData={(e) => {
                  playMutedVideo(e.currentTarget);
                }}
                onEnded={(e) => {
                  e.currentTarget.currentTime = 0;
                  void e.currentTarget.play();
                }}
              >
                <source src={MODULE_CRAFTING_SHOWCASE.videoSrc} type="video/mp4" />
              </video>
            </div>
            <div className="lg:pl-2">
              <h2 className="text-2xl md:text-4xl font-extrabold leading-tight">{MODULE_CRAFTING_SHOWCASE.title}</h2>
              <p className="mt-3 text-sm md:text-lg text-white/88">{MODULE_CRAFTING_SHOWCASE.description}</p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl mt-16">
          <div className="w-full">
            <div className="flex flex-col gap-2 md:items-center md:text-center">
              <h2 className="text-3xl md:text-5xl font-extrabold leading-tight">Interactive Learning Highlights</h2>
            </div>

            <div className="relative mt-8 md:mt-10">
              <span className="hidden lg:block absolute left-1/2 top-0 h-full w-px bg-gradient-to-b from-white/30 via-white/18 to-transparent" />
              <div className="space-y-8 md:space-y-10">
                {COURSE_FEATURE_SPOTLIGHTS.map((feature, index) => {
                  const isEven = index % 2 === 0;
                  return (
                    <article
                      key={feature.title}
                      className={`relative grid gap-4 md:gap-6 lg:grid-cols-2 items-center ${
                        isEven ? '' : 'lg:[&>*:first-child]:order-2 lg:[&>*:last-child]:order-1'
                      }`}
                    >
                      <div className="relative">
                        <span className="hidden lg:block absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-white/40 bg-white/50 backdrop-blur-sm left-1/2 -translate-x-1/2" />
                        <div className="relative rounded-[1.8rem] border border-white/28 bg-white/12 backdrop-blur-3xl p-2 md:p-3 shadow-[0_16px_34px_rgba(6,18,53,0.26)]">
                          <video
                            className="block w-full h-auto max-h-[56svh] rounded-[1.35rem] object-contain bg-slate-950/28"
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="auto"
                            controls={false}
                            disablePictureInPicture
                            controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                            tabIndex={-1}
                            onLoadedData={(e) => {
                              playMutedVideo(e.currentTarget);
                            }}
                            onEnded={(e) => {
                              e.currentTarget.currentTime = 0;
                              void e.currentTarget.play();
                            }}
                          >
                            <source src={feature.videoSrc} type="video/mp4" />
                          </video>
                        </div>
                      </div>

                      <div className="px-1 md:px-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/72 font-semibold">{feature.tag}</p>
                        <h3 className="mt-2 text-2xl md:text-4xl font-extrabold leading-[1.06]">{feature.title}</h3>
                        <p className="mt-4 text-base md:text-lg text-white/92 font-semibold">{feature.description}</p>
                        <p className="mt-3 text-sm md:text-base text-white/82">{feature.detail}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl mt-16">
          <div className="flex flex-col gap-2 md:items-center md:text-center">
            <h2 className="text-3xl md:text-5xl font-extrabold leading-tight">Interview Practice Showcase</h2>
            <p className="text-sm md:text-base text-white/84 max-w-3xl">
              Flow from text mode and voice mode into one final feedback review.
            </p>
          </div>

          <div className="mt-8 grid gap-y-5 lg:grid-cols-2 lg:gap-x-8">
            {INTERVIEW_MODE_SHOWCASES.map((mode) => {
              const isVoiceMode = /voice/i.test(mode.title);
              return (
                <article
                  key={mode.title}
                  className="relative"
                >
                  <div className={`grid gap-4 items-center ${isVoiceMode ? 'lg:grid-cols-[74%_26%]' : 'lg:grid-cols-[26%_74%]'}`}>
                    {isVoiceMode ? (
                      <>
                        <video
                          className="block w-full h-auto rounded-[1.35rem] pointer-events-none select-none"
                          autoPlay
                          loop
                          muted
                          playsInline
                          preload="auto"
                          controls={false}
                          disablePictureInPicture
                          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                          tabIndex={-1}
                          onLoadedData={(e) => {
                            playMutedVideo(e.currentTarget);
                          }}
                          onEnded={(e) => {
                            e.currentTarget.currentTime = 0;
                            void e.currentTarget.play();
                          }}
                        >
                          <source src={mode.videoSrc} type="video/mp4" />
                        </video>
                        <div className="lg:pl-8">
                          <h3 className="text-xl md:text-3xl font-extrabold leading-tight">{mode.title}</h3>
                          <p className="mt-2 text-sm md:text-base text-white/86">{mode.description}</p>
                          <svg
                            viewBox="0 0 170 70"
                            className="mt-2 h-10 w-28 ml-auto text-cyan-200/85"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path d="M162 8 C 164 38, 114 52, 34 52" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                            <path d="M44 42 L30 52 L44 62" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                          </svg>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <h3 className="text-xl md:text-3xl font-extrabold leading-tight">{mode.title}</h3>
                          <p className="mt-2 text-sm md:text-base text-white/86">{mode.description}</p>
                          <svg
                            viewBox="0 0 170 70"
                            className="mt-2 h-10 w-28 text-cyan-200/85"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path d="M8 8 C 6 38, 56 52, 136 52" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                            <path d="M126 42 L140 52 L126 62" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                          </svg>
                        </div>
                        <video
                          className="block w-full h-auto rounded-[1.35rem] pointer-events-none select-none"
                          autoPlay
                          loop
                          muted
                          playsInline
                          preload="auto"
                          controls={false}
                          disablePictureInPicture
                          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                          tabIndex={-1}
                          onLoadedData={(e) => {
                            playMutedVideo(e.currentTarget);
                          }}
                          onEnded={(e) => {
                            e.currentTarget.currentTime = 0;
                            void e.currentTarget.play();
                          }}
                        >
                          <source src={mode.videoSrc} type="video/mp4" />
                        </video>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="relative mt-2 hidden lg:block h-24">
            <svg viewBox="0 0 1000 120" className="w-full h-full" fill="none" aria-hidden="true">
              <path d="M250 8 C 250 60, 420 60, 500 96" stroke="#b5deff" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 7" />
              <path d="M750 8 C 750 60, 580 60, 500 96" stroke="#b5deff" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 7" />
              <circle cx="250" cy="8" r="5" fill="#74f0cc" />
              <circle cx="750" cy="8" r="5" fill="#74f0cc" />
              <path d="M486 94 L500 112 L514 94 Z" fill="#9ed6ff" />
            </svg>
          </div>

          <div className="relative mt-2 h-12 lg:hidden flex justify-center">
            <svg viewBox="0 0 120 70" className="h-full w-20" fill="none" aria-hidden="true">
              <path d="M60 4 L60 56" stroke="#b5deff" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 6" />
              <path d="M52 48 L60 60 L68 48" stroke="#9ed6ff" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>

          <article className="mt-2 max-w-5xl mx-auto">
            <div className="max-w-3xl">
              <h3 className="text-2xl md:text-4xl font-extrabold leading-[1.05]">{INTERVIEW_FINAL_FEEDBACK_SHOWCASE.title}</h3>
              <p className="mt-3 text-sm md:text-lg text-white/90">{INTERVIEW_FINAL_FEEDBACK_SHOWCASE.description}</p>
              <svg
                viewBox="0 0 190 78"
                className="mt-2 h-11 w-32 text-emerald-200/85"
                fill="none"
                aria-hidden="true"
              >
                <path d="M10 10 C 12 46, 78 60, 154 60" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M144 50 L158 60 L144 70" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
              </svg>
            </div>
            <video
              className="mt-4 block w-auto max-w-full h-auto max-h-[48svh] mx-auto rounded-[1.45rem] border border-white/45 pointer-events-none select-none"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              tabIndex={-1}
              onLoadedData={(e) => {
                playMutedVideo(e.currentTarget);
              }}
              onEnded={(e) => {
                e.currentTarget.currentTime = 0;
                void e.currentTarget.play();
              }}
            >
              <source src={INTERVIEW_FINAL_FEEDBACK_SHOWCASE.videoSrc} type="video/mp4" />
            </video>
          </article>
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
