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
  CAROUSEL = "CAROUSEL"
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
  data: any;
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

export type UserSegment = 'youth' | 'educator' | 'displaced' | 'community_org';
export type ConnectivityLevel = 'offline_first' | 'low_bandwidth' | 'normal';
export type CourseVisibility = 'private' | 'public';
export type ModerationStatus = 'clean' | 'under_review' | 'flagged' | 'hidden';
export type SupportedLocale = 'en' | 'my' | 'id' | 'ms' | 'th' | 'vi' | 'tl' | 'km' | 'lo';

export interface UserProfile {
  id: string;
  email?: string;
  userSegment: UserSegment;
  connectivityLevel: ConnectivityLevel;
  learningGoal: string;
  preferredLanguage: SupportedLocale;
  region: string;
  discoverySource?: 'social_media' | 'friend' | 'school' | 'community' | 'other';
  deviceClass: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  lowBandwidthMode?: boolean;
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
  comments: number;
  saves: number;
  createdAt: string;
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
  provider: 'auto' | 'gemini' | 'openai' | 'anthropic' | 'openrouter';
  model: string; // 'auto' or provider model id
  // Optional, mostly for Gemini rotation
  modelCandidates?: string[];
};

export interface ProfileContext {
  userSegment: UserSegment;
  connectivityLevel: ConnectivityLevel;
  preferredLanguage: SupportedLocale;
  learningGoal?: string;
  region?: string;
  lowBandwidthMode?: boolean;
}
