import {
  AssessmentQuestion,
  Course,
  ModuleContent,
  ContentType,
  RouterConfig
} from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_GEMINI_CANDIDATES = [
  'gemini-3-flash-preview',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

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
  const payload = { ...body, router };

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
};
