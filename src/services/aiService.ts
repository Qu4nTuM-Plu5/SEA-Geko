import {
  AssessmentQuestion,
  Course,
  ModuleContent,
  ContentType,
  RouterConfig,
  UserProfile,
  ImpactMetrics,
  LearningCourseSummary,
  CourseAnalyticsSummary,
  CareerGuidanceRole,
  InterviewRecommendedJob,
  InterviewSession,
  InterviewAnswerFeedback,
  InterviewFinalReview,
  SyncQueueItem,
  PublicCoursePost,
  PublicCreatorProfile,
  Cohort,
  ProfileContext,
  CvAnalysisResult,
  CvDeclaredFormat,
} from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_GEMINI_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];
const DEPRECATED_MODELS = new Set(['gemini-3-flash-preview']);

const DEFAULT_PROFILE_CONTEXT: ProfileContext = {
  userSegment: 'youth',
  connectivityLevel: 'normal',
  preferredLanguage: 'en',
  learningGoal: '',
  region: 'ASEAN',
  lowBandwidthMode: false,
};

const RETRY_PROFILE = {
  fastGeneration: { retries: 3, delayMs: 1000, maxDelayMs: 7000 },
  assessment: { retries: 4, delayMs: 1300, maxDelayMs: 12000 },
  outline: { retries: 4, delayMs: 1400, maxDelayMs: 12000 },
  standard: { retries: 3, delayMs: 1500, maxDelayMs: 8000 },
  tutor: { retries: 2, delayMs: 1200, maxDelayMs: 6000 },
  interviewSession: { retries: 0, delayMs: 700, maxDelayMs: 1200 },
} as const;

const isTokenBudgetErrorMessage = (message: string): boolean => {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('requires more credits') ||
    msg.includes('fewer max_tokens') ||
    msg.includes('requested up to') ||
    msg.includes('can only afford') ||
    msg.includes('insufficient credits') ||
    msg.includes('payment required')
  );
};

const getProfileContext = (): ProfileContext => {
  try {
    const raw = localStorage.getItem('nexus_profile_context');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        userSegment: parsed.userSegment || 'youth',
        connectivityLevel: parsed.connectivityLevel || 'normal',
        preferredLanguage: parsed.preferredLanguage || 'en',
        learningGoal: parsed.learningGoal || '',
        region: parsed.region || 'ASEAN',
        lowBandwidthMode: !!parsed.lowBandwidthMode,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PROFILE_CONTEXT;
};

const getAccountId = (): string => {
  try {
    const authUserId = localStorage.getItem('nexus_supabase_user_id');
    if (authUserId) return authUserId;
    const key = 'nexus_account_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `local-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'local-anon';
  }
};

const getRouterConfig = (): RouterConfig => {
  const AUTO_FAST_MODEL = 'auto-fast';
  const AUTO_THINKING_MODEL = 'auto-thinking';
  const clampProvider = (value: unknown): RouterConfig['provider'] => {
    const v = String(value || 'auto').trim().toLowerCase();
    if (v === 'openrouter' || v === 'mistral' || v === 'ollama' || v === 'gemini' || v === 'openai' || v === 'anthropic') return v;
    return 'auto';
  };
  const sanitizeModel = (value: unknown): string => {
    const model = String(value || 'auto').trim() || 'auto';
    if (model === AUTO_FAST_MODEL || model === AUTO_THINKING_MODEL) return model;
    return DEPRECATED_MODELS.has(model) ? 'auto' : model;
  };
  const sanitizeCandidates = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const out = value
      .map((m) => String(m || '').trim())
      .filter((m) => m && !DEPRECATED_MODELS.has(m));
    return out.length ? out : undefined;
  };
  const normalizeMode = (modeRaw: unknown, providerRaw: unknown, modelRaw: unknown): RouterConfig['mode'] => {
    const mode = String(modeRaw || '').trim().toLowerCase();
    const provider = clampProvider(providerRaw);
    const model = sanitizeModel(modelRaw);
    if (mode === 'manual') return 'manual';
    if (mode === 'auto_fast' || mode === 'autofast' || mode === 'fast') return 'auto_fast';
    if (mode === 'auto_thinking' || mode === 'autothinking' || mode === 'thinking' || mode === 'auto') return 'auto_thinking';
    if (provider === 'auto' && model === AUTO_FAST_MODEL) return 'auto_fast';
    if (provider === 'auto' && (model === AUTO_THINKING_MODEL || model === 'auto')) return 'auto_thinking';
    return (provider !== 'auto' || model !== 'auto') ? 'manual' : 'auto_fast';
  };

  try {
    const raw = localStorage.getItem('nexus_router_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      const mode = normalizeMode(parsed.mode, parsed.provider, parsed.model);
      const parsedModel = sanitizeModel(parsed.model);
      const autoModel = (
        mode === 'auto_fast'
          ? AUTO_FAST_MODEL
          : AUTO_THINKING_MODEL
      );
      return {
        mode,
        provider: mode === 'manual' ? clampProvider(parsed.provider) : 'auto',
        model: mode === 'manual'
          ? parsedModel
          : (parsedModel === AUTO_FAST_MODEL || parsedModel === AUTO_THINKING_MODEL ? parsedModel : autoModel),
        modelCandidates: sanitizeCandidates(parsed.modelCandidates),
      };
    }
  } catch {
    // ignore
  }

  // Backward compatibility with older model selector
  let mode: RouterConfig['mode'] = 'auto_fast';
  let model = AUTO_FAST_MODEL;
  let provider: RouterConfig['provider'] = 'auto';
  try {
    const m = localStorage.getItem('nexus_model_mode');
    const manual = localStorage.getItem('nexus_model_manual');
    if (m === 'manual' && manual) {
      mode = 'manual';
      model = sanitizeModel(manual);
      provider = clampProvider(localStorage.getItem('nexus_router_provider') || 'auto');
    } else if (m === 'auto') {
      mode = 'auto_thinking';
      model = AUTO_THINKING_MODEL;
    }
  } catch {
    // ignore
  }

  // Optional candidates
  let modelCandidates: string[] | undefined;
  try {
    const ls = localStorage.getItem('nexus_model_candidates');
    if (ls) {
      const parsed = ls.split(',').map(s => s.trim()).filter((m) => m && !DEPRECATED_MODELS.has(m));
      if (parsed.length) modelCandidates = parsed;
    }
  } catch {
    // ignore
  }

  return {
    mode,
    provider,
    model,
    modelCandidates: modelCandidates || DEFAULT_GEMINI_CANDIDATES,
  };
};

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 90000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError' || String(e?.message || '').toLowerCase().includes('aborted');
    return {
      ok: false,
      status: aborted ? 503 : 0,
      text: aborted ? 'Request timed out before provider response.' : String(e?.message || 'Request failed'),
      json: null,
    };
  } finally {
    clearTimeout(t);
  }
}

const withClientRetry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1500,
  onRetry?: (attemptRemaining: number, delay: number) => void,
  maxDelayMs = 8000
): Promise<T> => {
  let backoff = delayMs;
  let lastErr: any = null;

  for (let remaining = retries; remaining >= 0; remaining--) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status || 0;
      const msg = String(e?.message || '').toLowerCase();
      const isBudgetError = status === 402 || isTokenBudgetErrorMessage(msg);
      if (isBudgetError) throw e;
      const isBusy = status === 429
        || status === 503
        || msg.includes('rate')
        || msg.includes('quota')
        || msg.includes('busy')
        || msg.includes('timeout')
        || msg.includes('timed out')
        || msg.includes('aborted');
      if (remaining > 0 && isBusy) {
        const wait = Math.min(backoff, maxDelayMs);
        onRetry?.(remaining, wait);
        await sleep(wait);
        backoff *= 2;
        continue;
      }
      throw e;
    }
  }

  throw lastErr;
};

type ApiEnvelope<T> = {
  data: T;
  warning?: string;
};

async function postApiEnvelope<T>(path: string, body: any): Promise<ApiEnvelope<T>> {
  const router = getRouterConfig();
  const profileContext = getProfileContext();
  const accountId = getAccountId();
  const isAiPath = path.startsWith('/api/generate/') || path.startsWith('/api/tutor/') || path.startsWith('/api/interview/');
  const useAiRouting = isAiPath || path === '/api/profile/cv/analyze';
  const aiRouter: RouterConfig = useAiRouting
    ? { ...router, strictAi: true, noCache: true }
    : router;
  const payload = useAiRouting
    ? { ...body, router: aiRouter, profileContext, accountId }
    : { ...body, accountId };
  const timeoutMs = path === '/api/interview/session' ? 150000 : 90000;

  const r = await fetchJsonWithTimeout(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }, timeoutMs);

  if (!r.ok) {
    const errMsg = r.json?.error || r.text || 'Request failed';
    const e: any = new Error(errMsg);
    e.status = r.status;
    if (r.json?.code) e.code = String(r.json.code);
    throw e;
  }

  return {
    data: r.json?.data as T,
    warning: typeof r.json?.warning === 'string' ? r.json.warning : undefined,
  };
}

async function postApi<T>(path: string, body: any): Promise<T> {
  const envelope = await postApiEnvelope<T>(path, body);
  return envelope.data;
}

export const aiService = {
  async getConfig(): Promise<any> {
    const r = await fetchJsonWithTimeout('/api/config', { method: 'GET' }, 12000);
    return r.json;
  },

  async getAuthConfig(): Promise<{ enabled: boolean }> {
    const r = await fetchJsonWithTimeout('/api/auth/config', { method: 'GET' }, 12000);
    if (!r.ok) return { enabled: false };
    return { enabled: !!r.json?.data?.enabled };
  },

  async signUp(email: string, password: string): Promise<{
    user: { id: string; email?: string };
    session?: { access_token?: string; refresh_token?: string; expires_at?: number | null };
  }> {
    return await postApi('/api/auth/sign-up', { email, password });
  },

  async signIn(email: string, password: string): Promise<{
    user: { id: string; email?: string };
    session?: { access_token?: string; refresh_token?: string; expires_at?: number | null };
  }> {
    return await postApi('/api/auth/sign-in', { email, password });
  },

  async signOut(accessToken?: string): Promise<void> {
    await postApi('/api/auth/sign-out', { accessToken: accessToken || '' });
  },

  formatError(error: any): string {
    if (!error) return "An unknown error occurred.";
    const msg = error.message || String(error);

    if ((error.status === 429) || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) {
      return "The AI is currently at capacity (rate limit). Try switching provider/model, or wait a bit and retry.";
    }

    if ((error.status === 402) || isTokenBudgetErrorMessage(msg)) {
      return "Generation exceeded your current token/credit budget. Reduce generation size or lower max output tokens.";
    }

    if (msg.toLowerCase().includes('no ai providers')) {
      return msg;
    }

    return msg;
  },

  async generateAssessment(topic: string, onRetry?: (attempt: number, delay: number) => void): Promise<AssessmentQuestion[]> {
    return withClientRetry(async () => {
      return await postApi<AssessmentQuestion[]>('/api/generate/assessment', { topic });
    }, RETRY_PROFILE.assessment.retries, RETRY_PROFILE.assessment.delayMs, onRetry, RETRY_PROFILE.assessment.maxDelayMs);
  },

  async generateCourseOutline(
    topic: string,
    answers: Record<string, string>,
    optionsOrRetry?: { forceFresh?: boolean; requireAi?: boolean } | ((attempt: number, delay: number) => void),
    maybeOnRetry?: (attempt: number, delay: number) => void
  ): Promise<Course> {
    const options = typeof optionsOrRetry === 'function' ? {} : (optionsOrRetry || {});
    const onRetry = typeof optionsOrRetry === 'function' ? optionsOrRetry : maybeOnRetry;
    return withClientRetry(async () => {
      const envelope = await postApiEnvelope<Course>('/api/generate/course-outline', {
        topic,
        answers,
        forceFresh: options.forceFresh ? Date.now() : '',
      });
      const warning = String(envelope.warning || '').toLowerCase();
      const isFallbackWarning =
        warning.includes('fallback') ||
        warning.includes('unavailable') ||
        warning.includes('budget');
      const isTransientRateWarning =
        warning.includes('rate-limited') ||
        warning.includes('rate limit') ||
        warning.includes('temporarily');
      if (options.requireAi && isFallbackWarning && !isTransientRateWarning) {
        const err: any = new Error('AI provider is currently unavailable for outline planning. Retry in a moment or switch provider/model.');
        err.status = 503;
        throw err;
      }
      return envelope.data;
    }, RETRY_PROFILE.outline.retries, RETRY_PROFILE.outline.delayMs, onRetry, RETRY_PROFILE.outline.maxDelayMs);
  },

  async generateModuleLessonPlan(
    courseTitle: string,
    moduleTitle: string,
    moduleDesc: string,
    optionsOrRetry?: { forceFresh?: boolean; requireAi?: boolean } | ((attempt: number, delay: number) => void),
    maybeOnRetry?: (attempt: number, delay: number) => void
  ): Promise<{ id: string, title: string, type: ContentType }[]> {
    const options = typeof optionsOrRetry === 'function' ? {} : (optionsOrRetry || {});
    const onRetry = typeof optionsOrRetry === 'function' ? optionsOrRetry : maybeOnRetry;
    return withClientRetry(async () => {
      const envelope = await postApiEnvelope<{ id: string, title: string, type: ContentType }[]>('/api/generate/module-lesson-plan', {
        courseTitle,
        moduleTitle,
        moduleDesc,
        forceFresh: options.forceFresh ? Date.now() : '',
      });
      const warning = String(envelope.warning || '').toLowerCase();
      const isFallbackWarning =
        warning.includes('fallback') ||
        warning.includes('unavailable') ||
        warning.includes('budget');
      if (options.requireAi && isFallbackWarning) {
        const err: any = new Error('AI provider is currently unavailable for outline edits. Retry in a moment or switch provider/model.');
        err.status = 503;
        throw err;
      }
      return envelope.data;
    }, 4, RETRY_PROFILE.standard.delayMs, onRetry, 12000);
  },

  async generateStepContent(
    courseTitle: string,
    moduleTitle: string,
    stepTitle: string,
    type: ContentType,
    optionsOrRetry?: { referenceContext?: string; forceFresh?: boolean } | ((attempt: number, delay: number) => void),
    maybeOnRetry?: (attempt: number, delay: number) => void
  ): Promise<ModuleContent> {
    const options = typeof optionsOrRetry === 'function' ? {} : (optionsOrRetry || {});
    const onRetry = typeof optionsOrRetry === 'function' ? optionsOrRetry : maybeOnRetry;

    return withClientRetry(async () => {
      const envelope = await postApiEnvelope<ModuleContent>('/api/generate/step-content', {
        courseTitle,
        moduleTitle,
        stepTitle,
        type,
        referenceContext: options.referenceContext || '',
        forceFresh: options.forceFresh ? Date.now() : '',
      });
      const warning = String(envelope.warning || '').toLowerCase();
      const isFallbackWarning =
        warning.includes('fallback') ||
        warning.includes('unavailable') ||
        warning.includes('budget');
      const data: any = envelope.data || {};
      if (isFallbackWarning || data?.data?.generationFallback === true) {
        const err: any = new Error('AI content generation failed. Local fallback content is disabled for this build.');
        err.status = 503;
        throw err;
      }
      return envelope.data;
    }, RETRY_PROFILE.fastGeneration.retries, RETRY_PROFILE.fastGeneration.delayMs, onRetry, RETRY_PROFILE.fastGeneration.maxDelayMs);
  },

  async askAboutContent(currentContent: ModuleContent, question: string, onRetry?: (attempt: number, delay: number) => void): Promise<string> {
    return withClientRetry(async () => {
      return await postApi<string>('/api/tutor/ask', { content: currentContent, question });
    }, RETRY_PROFILE.tutor.retries, RETRY_PROFILE.tutor.delayMs, onRetry, RETRY_PROFILE.tutor.maxDelayMs);
  },

  async editStepContent(currentContent: ModuleContent, editPrompt: string, onRetry?: (attempt: number, delay: number) => void): Promise<ModuleContent> {
    return withClientRetry(async () => {
      return await postApi<ModuleContent>('/api/tutor/edit', { content: currentContent, editPrompt });
    }, RETRY_PROFILE.tutor.retries, RETRY_PROFILE.tutor.delayMs, onRetry, RETRY_PROFILE.tutor.maxDelayMs);
  },

  async upsertProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
    const p = await postApi<UserProfile>('/api/profile/upsert', { profile });
    try {
      localStorage.setItem('nexus_profile_context', JSON.stringify({
        userSegment: p.userSegment,
        connectivityLevel: p.connectivityLevel,
        preferredLanguage: p.preferredLanguage,
        learningGoal: p.learningGoal,
        region: p.region,
        lowBandwidthMode: !!p.lowBandwidthMode,
      }));
    } catch {
      // ignore
    }
    return p;
  },

  async getProfile(): Promise<UserProfile | null> {
    try {
      const r = await fetchJsonWithTimeout(`/api/profile/me?accountId=${encodeURIComponent(getAccountId())}`, { method: 'GET' }, 12000);
      if (!r.ok) return null;
      return r.json?.data || null;
    } catch {
      return null;
    }
  },

  async analyzeCv(input: {
    fileName: string;
    mimeType: string;
    declaredFormat: CvDeclaredFormat;
    text: string;
  }): Promise<CvAnalysisResult> {
    return await postApi<CvAnalysisResult>('/api/profile/cv/analyze', input);
  },

  async upsertCvProfile(cv: CvAnalysisResult): Promise<CvAnalysisResult> {
    return await postApi<CvAnalysisResult>('/api/profile/cv/upsert', { cv });
  },

  async getCvProfile(): Promise<CvAnalysisResult | null> {
    try {
      const r = await fetchJsonWithTimeout(`/api/profile/cv?accountId=${encodeURIComponent(getAccountId())}`, { method: 'GET' }, 12000);
      if (!r.ok) return null;
      return r.json?.data || null;
    } catch {
      return null;
    }
  },

  async recordImpactEvent(
    courseId: string,
    type: SyncQueueItem['type'],
    payload: Record<string, any> = {}
  ): Promise<void> {
    await postApi('/api/impact/event', { courseId, type, payload });
  },

  async recordPretest(courseId: string, scorePct: number): Promise<void> {
    await postApi('/api/impact/pretest', { courseId, scorePct });
  },

  async recordPosttest(courseId: string, scorePct: number): Promise<void> {
    await postApi('/api/impact/posttest', { courseId, scorePct });
  },

  async recordConfidence(courseId: string, phase: 'pre' | 'post', score: number): Promise<void> {
    await postApi('/api/impact/confidence', { courseId, phase, score });
  },

  async getImpactSummary(courseId?: string): Promise<ImpactMetrics> {
    const r = await fetchJsonWithTimeout(
      `/api/impact/summary?accountId=${encodeURIComponent(getAccountId())}${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok || !r.json?.data) {
      return {
        usersReached: 0,
        skillGainPp: 0,
        confidenceGain: 0,
        completionRate: 0,
        avgTimeToCompletionMins: 0,
        d7Retention: 0,
      };
    }
    return r.json.data as ImpactMetrics;
  },

  async listLearningCourses(): Promise<LearningCourseSummary[]> {
    const r = await fetchJsonWithTimeout(
      `/api/impact/courses?accountId=${encodeURIComponent(getAccountId())}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok || !Array.isArray(r.json?.data)) return [];
    return r.json.data as LearningCourseSummary[];
  },

  async publishCourse(course: Course, visibility: 'private' | 'public', courseIdHint = '') {
    const routeKey = String(courseIdHint || course.title || 'course');
    return await postApi<{ id: string; visibility: string; moderationStatus: string; courseId?: string }>(
      `/api/courses/${encodeURIComponent(routeKey)}/publish`,
      { course, visibility, courseId: courseIdHint || '' }
    );
  },

  async setCourseVisibility(post: PublicCoursePost, visibility: 'private' | 'public') {
    const snapshot = post.snapshot || { title: post.courseId, description: post.description || '', modules: [] };
    return await postApi<{ id: string; visibility: string; moderationStatus: string; courseId?: string }>(
      `/api/courses/${encodeURIComponent(post.courseId || 'course')}/publish`,
      { course: snapshot, visibility, courseId: post.courseId || '' }
    );
  },

  async listMyCourses(): Promise<PublicCoursePost[]> {
    const r = await fetchJsonWithTimeout(`/api/courses/my?accountId=${encodeURIComponent(getAccountId())}`, { method: 'GET' }, 12000);
    if (!r.ok || !Array.isArray(r.json?.data)) return [];
    return r.json.data as PublicCoursePost[];
  },

  async getPublicFeed(): Promise<PublicCoursePost[]> {
    const r = await fetchJsonWithTimeout(
      `/api/public/feed?accountId=${encodeURIComponent(getAccountId())}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok) return [];
    return Array.isArray(r.json?.data) ? r.json.data : [];
  },

  async getPublicCourse(courseId: string): Promise<PublicCoursePost | null> {
    if (!courseId) return null;
    const r = await fetchJsonWithTimeout(
      `/api/public/course/${encodeURIComponent(courseId)}?accountId=${encodeURIComponent(getAccountId())}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok || !r.json?.data) return null;
    return r.json.data as PublicCoursePost;
  },

  async getPublicComments(postId: string): Promise<Array<{ id: string; accountId: string; text: string; createdAt: string }>> {
    const r = await fetchJsonWithTimeout(`/api/public/${encodeURIComponent(postId)}/comments`, { method: 'GET' }, 12000);
    if (!r.ok || !Array.isArray(r.json?.data)) return [];
    return r.json.data;
  },

  async getPublicCreatorProfile(creatorId: string): Promise<PublicCreatorProfile | null> {
    if (!creatorId) return null;
    const r = await fetchJsonWithTimeout(
      `/api/public/creator/${encodeURIComponent(creatorId)}?viewerId=${encodeURIComponent(getAccountId())}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok || !r.json?.data) return null;
    return r.json.data as PublicCreatorProfile;
  },

  async setCreatorFollow(creatorId: string, follow: boolean): Promise<{ following: boolean; followers: number; followingCount: number }> {
    return await postApi(`/api/public/creator/${encodeURIComponent(creatorId)}/follow`, { follow: !!follow });
  },

  async reactToPublic(
    postId: string,
    reaction: 'up' | 'down' | 'like' = 'up'
  ): Promise<{ upvotes: number; downvotes: number; userReaction: 'up' | 'down' | null }> {
    return await postApi(`/api/public/${encodeURIComponent(postId)}/react`, { reaction });
  },

  async commentOnPublic(postId: string, comment: string): Promise<{ duplicate?: boolean }> {
    return await postApi(`/api/public/${encodeURIComponent(postId)}/comment`, { comment });
  },

  async savePublicCourse(postId: string): Promise<{ saves: number; alreadySaved?: boolean }> {
    return await postApi(`/api/public/${encodeURIComponent(postId)}/save`, {});
  },

  async getCourseAnalytics(courseId: string): Promise<CourseAnalyticsSummary> {
    const accountId = getAccountId();
    const r = await fetchJsonWithTimeout(
      `/api/courses/${encodeURIComponent(courseId)}/analytics?accountId=${encodeURIComponent(accountId)}`,
      { method: 'GET' },
      12000
    );
    if (r.ok && r.json?.data) {
      return r.json.data as CourseAnalyticsSummary;
    }
    if (r.status === 405) {
      const retry = await fetchJsonWithTimeout(
        `/api/courses/analytics?courseId=${encodeURIComponent(courseId)}&accountId=${encodeURIComponent(accountId)}`,
        { method: 'GET' },
        12000
      );
      if (retry.ok && retry.json?.data) return retry.json.data as CourseAnalyticsSummary;
      const retryErr = retry.json?.error || retry.text || 'Failed to load course analytics.';
      throw new Error(retryErr);
    }
    const errMsg = r.json?.error || r.text || 'Failed to load course analytics.';
    throw new Error(errMsg);
  },

  async getInterviewRecommendedJobs(payload: {
    profile: {
      fullName?: string;
      headline?: string;
      summary?: string;
      skills?: string[];
      experience?: Array<{ role?: string; organization?: string; highlights?: string[] }>;
      education?: Array<{ program?: string; institution?: string }>;
      certifications?: string[];
      learningGoal?: string;
      region?: string;
      preferredLanguage?: string;
    };
  }): Promise<InterviewRecommendedJob[]> {
    return withClientRetry(async () => {
      const rows = await postApi<InterviewRecommendedJob[]>('/api/interview/recommendations', payload || {});
      return Array.isArray(rows) ? rows : [];
    }, RETRY_PROFILE.fastGeneration.retries, RETRY_PROFILE.fastGeneration.delayMs, undefined, RETRY_PROFILE.fastGeneration.maxDelayMs);
  },

  async getProfileCareerGuidance(payload: {
    profile: {
      fullName?: string;
      headline?: string;
      summary?: string;
      skills?: string[];
      experience?: Array<{ role?: string; organization?: string; highlights?: string[] }>;
      education?: Array<{ program?: string; institution?: string }>;
      certifications?: string[];
      learningGoal?: string;
      region?: string;
      preferredLanguage?: string;
    };
    interests?: string[];
  }): Promise<CareerGuidanceRole[]> {
    return withClientRetry(async () => {
      const rows = await postApi<CareerGuidanceRole[]>('/api/profile/career-guidance', payload || {});
      return Array.isArray(rows) ? rows : [];
    }, RETRY_PROFILE.fastGeneration.retries, RETRY_PROFILE.fastGeneration.delayMs, undefined, RETRY_PROFILE.fastGeneration.maxDelayMs);
  },

  async getProfileCareerGuidanceRole(payload: {
    roleTitle: string;
    profile: {
      fullName?: string;
      headline?: string;
      summary?: string;
      skills?: string[];
      experience?: Array<{ role?: string; organization?: string; highlights?: string[] }>;
      education?: Array<{ program?: string; institution?: string }>;
      certifications?: string[];
      learningGoal?: string;
      region?: string;
      preferredLanguage?: string;
    };
    interests?: string[];
  }): Promise<CareerGuidanceRole | null> {
    return withClientRetry(async () => {
      try {
        const row = await postApi<CareerGuidanceRole>('/api/profile/career-guidance/role', payload || {});
        if (!row || typeof row !== 'object') return null;
        return row;
      } catch (e: any) {
        const status = Number(e?.status || 0);
        const message = String(e?.message || '').toLowerCase();
        const missingRoute = (
          status === 404
          || message.includes('unknown endpoint')
          || message.includes('not found')
          || message.includes('missing on the running backend')
        );
        if (!missingRoute) throw e;
        const rows = await postApi<CareerGuidanceRole[]>('/api/profile/career-guidance', {
          profile: payload?.profile || {},
          interests: [String(payload?.roleTitle || '').trim(), ...(Array.isArray(payload?.interests) ? payload.interests : [])],
        });
        const target = String(payload?.roleTitle || '').trim().toLowerCase();
        const list = Array.isArray(rows) ? rows : [];
        const picked = list.find((row) => String(row?.title || '').trim().toLowerCase() === target) || list[0] || null;
        return picked;
      }
    }, RETRY_PROFILE.fastGeneration.retries, RETRY_PROFILE.fastGeneration.delayMs, undefined, RETRY_PROFILE.fastGeneration.maxDelayMs);
  },

  async generateInterviewSession(payload: {
    jobTitle: string;
    profile: {
      fullName?: string;
      headline?: string;
      summary?: string;
      skills?: string[];
      experience?: Array<{ role?: string; organization?: string; highlights?: string[] }>;
      education?: Array<{ program?: string; institution?: string }>;
      certifications?: string[];
      learningGoal?: string;
      region?: string;
      preferredLanguage?: string;
    };
    setup?: {
      targetLanguage?: string;
      questionFocus?: 'mixed' | 'behavioral' | 'technical';
      seniority?: 'entry' | 'mid' | 'senior';
    };
  }): Promise<InterviewSession> {
    return withClientRetry(async () => {
      return await postApi<InterviewSession>('/api/interview/session', payload || {});
    }, RETRY_PROFILE.interviewSession.retries, RETRY_PROFILE.interviewSession.delayMs, undefined, RETRY_PROFILE.interviewSession.maxDelayMs);
  },

  async transcribeInterviewAudio(payload: {
    audioBase64: string;
    mimeType?: string;
    language?: string;
  }): Promise<string> {
    const routes = [
      '/api/interview/transcribe',
      '/api/interview/transcription',
      '/api/interview/transcribe-audio',
      '/api/interview/audio-transcribe',
      '/api/interview/transcribeAudio',
      '/api/interview/audioTranscribe',
      '/api/interview/transcribe/',
    ];
    let lastErr: any = null;
    const attempts: Array<{ route: string; status: number; message: string }> = [];
    let allMissingRoute = true;
    for (const route of routes) {
      try {
        const transcript = await withClientRetry(async () => {
          const data = await postApi<{ transcript: string }>(route, payload || {});
          return String(data?.transcript || '').trim();
        }, RETRY_PROFILE.fastGeneration.retries, RETRY_PROFILE.fastGeneration.delayMs, undefined, RETRY_PROFILE.fastGeneration.maxDelayMs);
        if (transcript) return transcript;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || '').toLowerCase();
        const isMissingRoute = e?.status === 404 || msg.includes('unknown endpoint') || msg.includes('not found');
        attempts.push({
          route,
          status: Number(e?.status || 0),
          message: String(e?.message || 'Request failed'),
        });
        if (!isMissingRoute) allMissingRoute = false;
        if (!isMissingRoute) break;
      }
    }
    if (allMissingRoute) {
      const detail = attempts.map((row) => `${row.route} -> ${row.status || 0}`).join(', ');
      throw new Error(`Voice transcription API route is missing on the running backend. Tried: ${detail}. Ensure the latest API server is running (use npm run dev or npm run dev:local).`);
    }
    throw lastErr || new Error('Voice transcription endpoint is unavailable.');
  },

  async evaluateInterviewAnswer(payload: {
    role: {
      jobTitle: string;
      roleSummary: string;
      responsibilities: string[];
      requirements: string[];
    };
    questionId: string;
    question: string;
    answer: string;
    answerMode: 'text' | 'voice';
    voiceMeta?: {
      confidence?: number;
      fillerCount?: number;
      wordCount?: number;
    };
    targetLanguage?: string;
  }): Promise<InterviewAnswerFeedback> {
    return withClientRetry(async () => {
      return await postApi<InterviewAnswerFeedback>('/api/interview/feedback', payload || {});
    }, RETRY_PROFILE.tutor.retries, RETRY_PROFILE.tutor.delayMs, undefined, RETRY_PROFILE.tutor.maxDelayMs);
  },

  async finalizeInterviewReview(payload: {
    role: {
      jobTitle: string;
      roleSummary: string;
      responsibilities: string[];
      requirements: string[];
    };
    targetLanguage?: string;
    items: Array<{
      questionId: string;
      question: string;
      answer: string;
      feedback?: string;
      sampleResponse?: string;
    }>;
  }): Promise<InterviewFinalReview> {
    return withClientRetry(async () => {
      return await postApi<InterviewFinalReview>('/api/interview/final-review', payload || {});
    }, RETRY_PROFILE.standard.retries, RETRY_PROFILE.standard.delayMs, undefined, RETRY_PROFILE.standard.maxDelayMs);
  },

  async reportCourse(courseId: string, reason: string): Promise<void> {
    await postApi(`/api/courses/${encodeURIComponent(courseId)}/report`, { reason });
  },

  async createCohort(name: string, courseId: string): Promise<Cohort> {
    return await postApi<Cohort>('/api/cohorts', { name, courseId });
  },

  async joinCohort(cohortId: string): Promise<void> {
    await postApi(`/api/cohorts/${encodeURIComponent(cohortId)}/join`, {});
  },

  async syncProgress(items: SyncQueueItem[]): Promise<{ merged: number }> {
    return await postApi<{ merged: number }>('/api/progress/sync', { items });
  },

  async getCohortDashboard(cohortId: string): Promise<any> {
    const r = await fetchJsonWithTimeout(
      `/api/cohorts/${encodeURIComponent(cohortId)}/dashboard?accountId=${encodeURIComponent(getAccountId())}`,
      { method: 'GET' },
      12000
    );
    if (!r.ok) return null;
    return r.json?.data || null;
  },
};
