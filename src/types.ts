export enum ContentType {
  VIDEO = "VIDEO",
  QUIZ = "QUIZ",
  FLIP_CARD = "FLIP_CARD",
  DRAG_FILL = "DRAG_FILL",
  CODE_BUILDER = "CODE_BUILDER",
  TEXT = "TEXT",
  LEARNING_CARD = "LEARNING_CARD",
  ACCORDION = "ACCORDION",
  HOTSPOT = "HOTSPOT",
  CAROUSEL = "CAROUSEL",
  POP_CARD = "POP_CARD",
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface FlipCard {
  front: string;
  back: string;
  icon?: string;
  imageUrl?: string;
  cardType?: 'definition' | 'command' | 'acronym' | 'diagram';
}

export interface LearningCard {
  title: string;
  content: string;
  image?: string;
  icon?: string;
  layout: 'split' | 'vertical' | 'overlay';
}

export interface DragFillChallenge {
  codeTemplate: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface ModuleContent {
  type: ContentType | string;
  title: string;
  lessonText?: string;
  data: {
    references?: Array<{
      title: string;
      url: string;
      kind: 'youtube' | 'web' | 'doc';
    }>;
    [key: string]: any;
  };
}

export interface LessonStep {
  id: string;
  title: string;
  type: ContentType;
  content?: ModuleContent;
  status: 'pending' | 'generating' | 'completed' | 'loading' | 'error';
  isCompleted?: boolean;
  moduleNumber?: number;
  lessonNumber?: number;
  segmentNumber?: number;
  lessonTitle?: string;
  segmentLabel?: string;
}

export interface Module {
  id: string;
  title: string;
  description: string;
  steps: LessonStep[];
  status: 'pending' | 'generating' | 'completed' | 'error';
  isLocked?: boolean;
  isCompleted?: boolean;
}

export interface Course {
  title: string;
  description: string;
  modules: Module[];
}

export interface AssessmentQuestion {
  id: string;
  question: string;
  type: 'text' | 'choice';
  options?: string[];
}

export interface InterviewRecommendedJob {
  id: string;
  title: string;
  reason: string;
}

export interface InterviewRoleBlueprint {
  jobTitle: string;
  roleSummary: string;
  responsibilities: string[];
  requirements: string[];
}

export interface InterviewQuestion {
  id: string;
  question: string;
  focus: string;
}

export interface InterviewSession {
  role: InterviewRoleBlueprint;
  questions: InterviewQuestion[];
  generatedAt: string;
}

export interface InterviewAnswerFeedback {
  questionId: string;
  feedback: string;
  sampleResponse: string;
  toneFeedback: string;
  grammarFeedback: string;
  pronunciationFeedback: string;
  riskFlags: string[];
  score: number;
}

export interface InterviewFinalReview {
  summary: string;
  strengths: string[];
  improvements: string[];
  hiringRiskNotes: string[];
  nextSteps: string[];
}

export type UserSegment = 'youth' | 'educator' | 'displaced' | 'community_org';
export type ConnectivityLevel = 'offline_first' | 'low_bandwidth' | 'normal';
export type CourseVisibility = 'private' | 'public';
export type ModerationStatus = 'clean' | 'under_review' | 'flagged' | 'hidden';
export type SupportedLocale = 'en' | 'my' | 'id' | 'ms' | 'th' | 'vi' | 'tl' | 'km' | 'lo';
export type CvDeclaredFormat = 'europass' | 'other';

export interface CvExperienceItem {
  role: string;
  organization: string;
  period: string;
  highlights: string[];
}

export interface CvEducationItem {
  program: string;
  institution: string;
  period: string;
}

export interface CvParsedProfile {
  fullName: string;
  headline: string;
  summary: string;
  location: string;
  email: string;
  phone: string;
  profileImageDataUrl?: string;
  skills: string[];
  languages: string[];
  experience: CvExperienceItem[];
  education: CvEducationItem[];
  certifications: string[];
}

export interface CvAnalysisResult {
  valid: boolean;
  format: 'europass' | 'other' | 'unknown';
  confidence: number;
  issues: string[];
  fileName?: string;
  mimeType?: string;
  parsed: CvParsedProfile | null;
  updatedAt?: string;
}

export interface UserProfile {
  id: string;
  email?: string;
  userSegment: UserSegment;
  connectivityLevel: ConnectivityLevel;
  learningGoal: string;
  preferredLanguage: SupportedLocale;
  region: string;
  discoverySource?: 'social_media' | 'friend' | 'school' | 'community' | 'other' | 'x_twitter' | 'linkedin' | 'youtube' | 'newsletter' | 'conference' | 'friend_colleague' | 'google' | 'llm' | 'other_not_sure';
  deviceClass: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  lowBandwidthMode?: boolean;
  professionalVisibility?: 'public' | 'private';
  cvRequiredFormat?: CvDeclaredFormat;
  cvValidated?: boolean;
  cvUpdatedAt?: string;
  cvFileName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImpactMetrics {
  usersReached: number;
  skillGainPp: number;
  confidenceGain: number;
  completionRate: number;
  avgTimeToCompletionMins: number;
  d7Retention: number;
}

export interface LearningCourseSummary {
  courseId: string;
  ownerId: string;
  title: string;
  description: string;
  visibility: CourseVisibility;
  startedAt: string;
  lastActiveAt: string;
  metrics: ImpactMetrics;
}

export interface SyncQueueItem {
  id: string;
  courseId: string;
  type: 'course_started' | 'lesson_started' | 'lesson_completed' | 'quiz_submitted' | 'course_completed' | 'daily_active';
  payload?: Record<string, any>;
  createdAt: string;
}

export interface DownloadState {
  courseId: string;
  snapshotVersion: number;
  downloadedAt: string;
  sizeBytes: number;
  title: string;
}

export interface PublicCoursePost {
  id: string;
  courseId: string;
  ownerId: string;
  title: string;
  description?: string;
  snapshot?: Course;
  language?: SupportedLocale;
  segment?: UserSegment;
  visibility: CourseVisibility;
  moderationStatus: ModerationStatus;
  reactions: number;
  upvotes: number;
  downvotes: number;
  userReaction?: 'up' | 'down' | null;
  comments: number;
  saves: number;
  createdAt: string;
}

export interface CourseAnalyticsPoint {
  date: string;
  completionRate: number;
}

export interface CourseAnalyticsSummary {
  courseId: string;
  title: string;
  upvotes: number;
  downvotes: number;
  downloads: number;
  comments: number;
  learners: number;
  completedLearners: number;
  averageCompletionRate: number;
  trend: CourseAnalyticsPoint[];
}

export interface PublicCreatorProfile {
  id: string;
  displayName: string;
  headline: string;
  summary: string;
  profileImageDataUrl: string;
  region: string;
  preferredLanguage: string;
  userSegment: UserSegment;
  professionalVisibility: 'public' | 'private';
  stats: {
    totalLikes: number;
    totalFollowers: number;
    totalFollowing: number;
    publicCourses: number;
  };
  dashboard: CvParsedProfile | null;
  courses: PublicCoursePost[];
  isFollowing: boolean;
}

export interface Cohort {
  id: string;
  name: string;
  ownerId: string;
  courseId: string;
  createdAt: string;
}

export interface AbuseReport {
  id: string;
  targetType: 'course' | 'comment';
  targetId: string;
  reason: string;
  reporterId: string;
  createdAt: string;
}

export type RouterConfig = {
  mode: 'auto' | 'manual';
  provider: 'auto' | 'openrouter' | 'mistral' | 'ollama' | 'gemini' | 'openai' | 'anthropic';
  model: string; // 'auto' or provider model id
  // Optional, mostly for Gemini rotation
  modelCandidates?: string[];
  // Force strict AI generation (no local fallback content)
  strictAi?: boolean;
  // Bypass generation cache (fresh provider call)
  noCache?: boolean;
};

export interface ProfileContext {
  userSegment: UserSegment;
  connectivityLevel: ConnectivityLevel;
  preferredLanguage: SupportedLocale;
  learningGoal?: string;
  region?: string;
  lowBandwidthMode?: boolean;
}
