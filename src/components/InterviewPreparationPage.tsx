import React from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Loader2, Mic, Square } from 'lucide-react';
import { cn } from '../lib/utils';
import { InterviewAnswerFeedback, InterviewFinalReview, InterviewRecommendedJob, InterviewSession } from '../types';

const INTERVIEW_RECORDING_LIMIT_SECONDS = 120;

const formatDurationClock = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(1, '0')}:${String(secs).padStart(2, '0')}`;
};

type Props = {
  interviewSession: InterviewSession | null;
  interviewBusy: boolean;
  interviewError: string | null;
  interviewFinalBusy: boolean;
  interviewFinalReview: InterviewFinalReview | null;
  interviewReviewOpen: boolean;
  interviewReviewProgress: number;
  interviewRecommendedJobs: InterviewRecommendedJob[];
  interviewJobsBusy: boolean;
  selectedInterviewJobTitle: string;
  prompt: string;
  activeInterviewQuestionIdx: number;
  activeInterviewQuestion: InterviewSession['questions'][number] | null;
  activeInterviewAnswer: string;
  activeInterviewAnswerMode: 'text' | 'voice';
  interviewVoiceSupported: boolean;
  interviewVoiceSupportMessage: string;
  activeInterviewRecordedSeconds: number;
  interviewVoiceWaveBars: number[];
  interviewRecordingElapsedSeconds: number;
  recordingQuestionId: string | null;
  interviewTranscribingQuestionId: string | null;
  interviewAnsweredCount: number;
  careerGuidanceEnabled: boolean;
  interviewAnswersByQuestionId: Record<string, string>;
  interviewFeedbackByQuestionId: Record<string, InterviewAnswerFeedback>;
  onBackToLearn: () => void;
  onRefreshRoles: () => void;
  onSelectRole: (job: InterviewRecommendedJob) => void;
  onPromptChange: (value: string) => void;
  onGenerateInterview: () => void;
  onStartRecording: (questionId: string) => void;
  onStopRecording: () => void;
  onRetryRecording: (questionId: string) => void;
  onAnswerChange: (value: string) => void;
  onSetAnswerMode: (mode: 'text' | 'voice') => void;
  onPrevQuestion: () => void;
  onSaveNext: () => void;
  onBackToQuestions: () => void;
};

export function InterviewPreparationPage(props: Props) {
  const isRecordingActive = !!(props.activeInterviewQuestion && props.recordingQuestionId === props.activeInterviewQuestion.id);
  const isTranscribingActive = !!(props.activeInterviewQuestion && props.interviewTranscribingQuestionId === props.activeInterviewQuestion.id);
  const isVoiceMode = props.interviewVoiceSupported && props.activeInterviewAnswerMode === 'voice';
  const isLastQuestion = !!(
    props.interviewSession
    && props.activeInterviewQuestionIdx >= props.interviewSession.questions.length - 1
  );
  const hasActiveAnswer = props.activeInterviewAnswer.trim().length > 0;
  const saveActionLabel = isLastQuestion ? 'Save & Review' : 'Save & Next';
  const saveActionDisabled = (
    !props.activeInterviewQuestion
    || isTranscribingActive
    || isRecordingActive
    || !hasActiveAnswer
  );
  const canRetryVoiceCapture = (
    isVoiceMode
    && props.interviewVoiceSupported
    && !isRecordingActive
    && !isTranscribingActive
    && !!props.activeInterviewQuestion
    && (props.activeInterviewRecordedSeconds > 0 || props.activeInterviewAnswer.trim().length > 0)
  );
  return (
    <motion.div
      key="interviewing"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      className="space-y-6"
    >
      {(props.interviewBusy || props.interviewSession) ? (
        <section className="rounded-3xl border border-emerald-100 bg-white p-4 md:p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg md:text-xl font-bold text-slate-900 mt-1">
                {props.interviewSession?.role?.jobTitle || 'Preparing your target interview'}
              </h3>
            </div>
            {props.interviewSession ? (
              <span className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                {`Answered ${props.interviewAnsweredCount} / ${props.interviewSession.questions.length}`}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {props.interviewError ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {props.interviewError}
        </section>
      ) : null}

      {props.interviewBusy ? (
        <section className="rounded-3xl border border-cyan-100 bg-white p-6 md:p-8 shadow-sm">
          <div className="min-h-[180px] flex flex-col items-center justify-center text-center gap-4">
            <div className="h-14 w-14 rounded-full border border-cyan-100 bg-cyan-50 inline-flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-cyan-600 animate-spin" />
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-600 font-bold">Processing Interview Setup</p>
              <h3 className="text-xl font-bold text-slate-900 mt-2">Generating your interview questions...</h3>
              <p className="text-sm text-slate-600 mt-1">
                Analyzing your role context and preparing practical interview questions.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {!props.interviewBusy && props.interviewSession && !props.interviewReviewOpen ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-500">{`Question ${props.activeInterviewQuestionIdx + 1} of ${props.interviewSession.questions.length}`}</p>
              <h3 className="text-xl md:text-2xl font-bold text-slate-900 mt-2 leading-tight">
                {props.activeInterviewQuestion?.question}
              </h3>
            </div>
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Focus: {props.activeInterviewQuestion?.focus || 'Interview communication'}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 md:p-8 text-center">
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => props.onSetAnswerMode('voice')}
                disabled={!props.interviewVoiceSupported || isRecordingActive || isTranscribingActive}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50",
                  isVoiceMode ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                Voice mode
              </button>
              <button
                type="button"
                onClick={() => props.onSetAnswerMode('text')}
                disabled={isRecordingActive || isTranscribingActive}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50",
                  !isVoiceMode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                Text mode
              </button>
            </div>
            {!props.interviewVoiceSupported ? (
              <p className="mb-3 text-xs text-amber-700">{props.interviewVoiceSupportMessage}</p>
            ) : null}

            {isVoiceMode ? (
              <>
                <p className="text-5xl md:text-6xl font-bold text-slate-300">
                  {`${formatDurationClock(props.activeInterviewRecordedSeconds)} / ${formatDurationClock(INTERVIEW_RECORDING_LIMIT_SECONDS)}`}
                </p>
                <div className="mt-5">
                  {isRecordingActive ? (
                    <button
                      type="button"
                      onClick={props.onStopRecording}
                      className="h-16 w-16 rounded-full bg-rose-600 text-white inline-flex items-center justify-center shadow-lg shadow-rose-500/25 hover:bg-rose-500"
                    >
                      <Square className="w-6 h-6" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => props.activeInterviewQuestion && props.onStartRecording(props.activeInterviewQuestion.id)}
                      disabled={isTranscribingActive}
                      className="h-16 w-16 rounded-full bg-rose-600 text-white inline-flex items-center justify-center shadow-lg shadow-rose-500/25 hover:bg-rose-500 disabled:opacity-50"
                    >
                      <Mic className="w-6 h-6" />
                    </button>
                  )}
                </div>
                <div className="mt-5 h-16 rounded-xl border border-slate-200 bg-white px-3 flex items-center justify-center gap-1.5">
                  {(props.interviewVoiceWaveBars.length ? props.interviewVoiceWaveBars : Array.from({ length: 24 }, () => 0.08)).map((value, idx) => (
                    <span
                      // eslint-disable-next-line react/no-array-index-key
                      key={`wave-${idx}`}
                      className={cn(
                        "w-1 rounded-full",
                        isRecordingActive ? "bg-rose-500" : isTranscribingActive ? "bg-cyan-500" : "bg-slate-300"
                      )}
                      style={{ height: `${Math.max(6, Math.min(42, Math.round(6 + (Number(value) * 36))))}px`, transition: 'height 120ms linear' }}
                    />
                  ))}
                </div>
                {canRetryVoiceCapture ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => props.activeInterviewQuestion && props.onRetryRecording(props.activeInterviewQuestion.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Retry recording
                    </button>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-slate-500">
                  {isTranscribingActive
                    ? 'Transcribing your local speech...'
                    : isRecordingActive
                      ? 'Recording voice answer...'
                      : 'Voice mode enabled. Transcript is hidden.'}
                </p>
              </>
            ) : (
              <>
                <textarea
                  value={props.activeInterviewAnswer}
                  onChange={(e) => props.onAnswerChange(e.target.value)}
                  placeholder="Type your answer..."
                  className="w-full min-h-[170px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 mt-2"
                />
                <p className="mt-3 text-xs text-slate-500">Typed answer mode.</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={props.onPrevQuestion}
                disabled={props.activeInterviewQuestionIdx <= 0}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={props.onSaveNext}
                disabled={saveActionDisabled}
                className="px-4 py-2 rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saveActionLabel}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!props.interviewBusy && props.interviewSession && props.interviewReviewOpen ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl md:text-2xl font-bold text-slate-900">Final interview feedback</h3>
            {!props.interviewFinalBusy ? (
              <button
                type="button"
                onClick={props.onBackToQuestions}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back to Questions
              </button>
            ) : null}
          </div>

          {props.interviewFinalBusy ? (
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4 space-y-3">
              <p className="text-xs font-semibold text-cyan-800">Analyzing all answers for final report...</p>
              <div className="h-2 rounded-full bg-white/80 border border-cyan-100 overflow-hidden">
                <motion.div
                  className="h-full bg-cyan-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(5, Math.min(100, props.interviewReviewProgress))}%` }}
                />
              </div>
            </div>
          ) : props.interviewFinalReview ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {props.interviewFinalReview.summary}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold text-emerald-800 mb-1">Strengths</p>
                  <ul className="list-disc list-inside space-y-1 text-emerald-900">
                    {props.interviewFinalReview.strengths.map((item, idx) => (
                      <li key={`final-strength-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Improvements</p>
                  <ul className="list-disc list-inside space-y-1 text-amber-900">
                    {props.interviewFinalReview.improvements.map((item, idx) => (
                      <li key={`final-improve-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {props.interviewFinalReview.hiringRiskNotes.length ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-semibold text-rose-800 mb-1">Hiring risk notes</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-rose-900">
                    {props.interviewFinalReview.hiringRiskNotes.map((item, idx) => (
                      <li key={`final-risk-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800 mb-1">Next steps</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-700">
                  {props.interviewFinalReview.nextSteps.map((item, idx) => (
                    <li key={`final-next-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200">
                {props.interviewSession.questions.map((question) => {
                  const answer = String(props.interviewAnswersByQuestionId[question.id] || '').trim();
                  if (!answer) return null;
                  const feedback = props.interviewFeedbackByQuestionId[question.id];
                  return (
                    <details key={`review-${question.id}`} className="group">
                      <summary className="cursor-pointer list-none text-base text-slate-900 px-4 py-4 flex items-center justify-between gap-3">
                        <span className="font-medium">{question.question}</span>
                        <span className="h-9 w-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                          <ChevronDown className="w-5 h-5 transition-transform group-open:rotate-180" />
                        </span>
                      </summary>
                      <div className="px-4 pb-4 space-y-2">
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">Your answer:</span> {answer}
                        </p>
                        {feedback ? (
                          <>
                            <p className="text-sm text-slate-700">
                              <span className="font-semibold text-slate-900">Feedback:</span> {feedback.feedback}
                            </p>
                            <p className="text-sm text-slate-700">
                              <span className="font-semibold text-slate-900">Sample response:</span> {feedback.sampleResponse}
                            </p>
                          </>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No final report yet. Try ending and reviewing again.</p>
          )}
        </section>
      ) : null}
    </motion.div>
  );
}
