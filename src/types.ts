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

export type RouterConfig = {
  mode: 'auto' | 'manual';
  provider: 'auto' | 'gemini' | 'openai' | 'anthropic' | 'openrouter';
  model: string; // 'auto' or provider model id
  // Optional, mostly for Gemini rotation
  modelCandidates?: string[];
};
