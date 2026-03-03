import {
  AssessmentQuestion,
  Course,
  ModuleContent,
  ContentType,
  RouterConfig,
  UserProfile,
  ImpactMetrics,
  SyncQueueItem,
  PublicCoursePost,
  Cohort,
  ProfileContext,
} from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_GEMINI_CANDIDATES = [
  'gemini-3-flash-preview',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

const DEFAULT_PROFILE_CONTEXT: ProfileContext = {
  userSegment: 'youth',
  connectivityLevel: 'normal',
  preferredLanguage: 'en',
  learningGoal: '',
  region: 'ASEAN',
  lowBandwidthMode: false,
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
  try {
    const raw = localStorage.getItem('nexus_router_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: parsed.mode === 'manual' ? 'manual' : 'auto',
        provider: parsed.provider || 'auto',
        model: parsed.model || 'auto',
        modelCandidates: Array.isArray(parsed.modelCandidates) ? parsed.modelCandidates : undefined,
      };
    }
  } catch {
    // ignore
  }

  // Backward compatibility with older model selector
  let mode: 'auto' | 'manual' = 'auto';
  let model = 'auto';
  try {
    const m = localStorage.getItem('nexus_model_mode');
    const manual = localStorage.getItem('nexus_model_manual');
    if (m === 'manual' && manual) {
      mode = 'manual';
      model = manual;
    }
  } catch {
    // ignore
  }

  // Optional candidates
  let modelCandidates: string[] | undefined;
  try {
    const ls = localStorage.getItem('nexus_model_candidates');
    if (ls) {
      const parsed = ls.split(',').map(s => s.trim()).filter(Boolean);
      if (parsed.length) modelCandidates = parsed;
    }
  } catch {
    // ignore
  }

  return {
    mode,
    provider: 'auto',
    model,
    modelCandidates: modelCandidates || DEFAULT_GEMINI_CANDIDATES,
  };
};

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 45000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

const withClientRetry = async <T>(
  fn: () => Promise<T>,
  retries = 6,
  delayMs = 4000,
  onRetry?: (attemptRemaining: number, delay: number) => void
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
      const isBusy = status === 429 || status === 503 || msg.includes('rate') || msg.includes('quota') || msg.includes('busy');
      if (remaining > 0 && isBusy) {
        const wait = Math.min(backoff, 30000);
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

async function postApi<T>(path: string, body: any): Promise<T> {
  const router = getRouterConfig();
  const profileContext = getProfileContext();
  const accountId = getAccountId();
  const isAiPath = path.startsWith('/api/generate/') || path.startsWith('/api/tutor/');
  const payload = isAiPath
    ? { ...body, router, profileContext, accountId }
    : { ...body, accountId };

  const r = await fetchJsonWithTimeout(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const errMsg = r.json?.error || r.text || 'Request failed';
    const e: any = new Error(errMsg);
    e.status = r.status;
    throw e;
  }

  return r.json?.data as T;
}

export const aiService = {
  async getConfig(): Promise<any> {
    const r = await fetchJsonWithTimeout('/api/config', { method: 'GET' }, 12000);
    return r.json;
  },

  formatError(error: any): string {
    if (!error) return "An unknown error occurred.";
    const msg = error.message || String(error);

    if ((error.status === 429) || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) {
      return "The AI is currently at capacity (rate limit). Try switching provider/model, or wait a bit and retry.";
    }

    if (msg.toLowerCase().includes('no ai providers')) {
      return msg;
    }

    return msg;
  },

  async generateAssessment(topic: string, onRetry?: (attempt: number, delay: number) => void): Promise<AssessmentQuestion[]> {
    return withClientRetry(async () => {
      return await postApi<AssessmentQuestion[]>('/api/generate/assessment', { topic });
    }, 6, 4000, onRetry);
  },

  async generateCourseOutline(topic: string, answers: Record<string, string>, onRetry?: (attempt: number, delay: number) => void): Promise<Course> {
    return withClientRetry(async () => {
      return await postApi<Course>('/api/generate/course-outline', { topic, answers });
    }, 6, 4000, onRetry);
  },

  async generateModuleLessonPlan(courseTitle: string, moduleTitle: string, moduleDesc: string, onRetry?: (attempt: number, delay: number) => void): Promise<{ id: string, title: string, type: ContentType }[]> {
    return withClientRetry(async () => {
      return await postApi<{ id: string, title: string, type: ContentType }[]>('/api/generate/module-lesson-plan', {
        courseTitle,
        moduleTitle,
        moduleDesc
      });
    }, 6, 4000, onRetry);
  },

  async generateStepContent(
    courseTitle: string,
    moduleTitle: string,
    stepTitle: string,
    type: ContentType,
    optionsOrRetry?: { referenceContext?: string } | ((attempt: number, delay: number) => void),
    maybeOnRetry?: (attempt: number, delay: number) => void
  ): Promise<ModuleContent> {
    const options = typeof optionsOrRetry === 'function' ? {} : (optionsOrRetry || {});
    const onRetry = typeof optionsOrRetry === 'function' ? optionsOrRetry : maybeOnRetry;

    return withClientRetry(async () => {
      return await postApi<ModuleContent>('/api/generate/step-content', {
        courseTitle,
        moduleTitle,
        stepTitle,
        type,
        referenceContext: options.referenceContext || '',
      });
    }, 6, 4000, onRetry);
  },

  async askAboutContent(currentContent: ModuleContent, question: string, onRetry?: (attempt: number, delay: number) => void): Promise<string> {
    return withClientRetry(async () => {
      return await postApi<string>('/api/tutor/ask', { content: currentContent, question });
    }, 4, 3000, onRetry);
  },

  async editStepContent(currentContent: ModuleContent, editPrompt: string, onRetry?: (attempt: number, delay: number) => void): Promise<ModuleContent> {
    return withClientRetry(async () => {
      return await postApi<ModuleContent>('/api/tutor/edit', { content: currentContent, editPrompt });
    }, 4, 3000, onRetry);
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

  async publishCourse(course: Course, visibility: 'private' | 'public') {
    return await postApi<{ id: string; visibility: string; moderationStatus: string }>(
      `/api/courses/${encodeURIComponent(course.title || 'course')}/publish`,
      { course, visibility }
    );
  },

  async setCourseVisibility(post: PublicCoursePost, visibility: 'private' | 'public') {
    const snapshot = post.snapshot || { title: post.courseId, description: post.description || '', modules: [] };
    return await postApi<{ id: string; visibility: string; moderationStatus: string }>(
      `/api/courses/${encodeURIComponent(post.courseId || 'course')}/publish`,
      { course: snapshot, visibility }
    );
  },

  async listMyCourses(): Promise<PublicCoursePost[]> {
    const r = await fetchJsonWithTimeout(`/api/courses/my?accountId=${encodeURIComponent(getAccountId())}`, { method: 'GET' }, 12000);
    if (!r.ok || !Array.isArray(r.json?.data)) return [];
    return r.json.data as PublicCoursePost[];
  },

  async getPublicFeed(): Promise<PublicCoursePost[]> {
    const r = await fetchJsonWithTimeout('/api/public/feed', { method: 'GET' }, 12000);
    if (!r.ok) return [];
    return Array.isArray(r.json?.data) ? r.json.data : [];
  },

  async getPublicComments(postId: string): Promise<Array<{ id: string; accountId: string; text: string; createdAt: string }>> {
    const r = await fetchJsonWithTimeout(`/api/public/${encodeURIComponent(postId)}/comments`, { method: 'GET' }, 12000);
    if (!r.ok || !Array.isArray(r.json?.data)) return [];
    return r.json.data;
  },

  async reactToPublic(postId: string, reaction = 'like'): Promise<void> {
    await postApi(`/api/public/${encodeURIComponent(postId)}/react`, { reaction });
  },

  async commentOnPublic(postId: string, comment: string): Promise<void> {
    await postApi(`/api/public/${encodeURIComponent(postId)}/comment`, { comment });
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
