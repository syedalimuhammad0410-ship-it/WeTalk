// Shared types used by both the API server and the web client.

export type DomainId =
  | 'number' | 'fractions' | 'ratios' | 'algebra' | 'functions' | 'geometry'
  | 'statistics' | 'probability' | 'trigonometry' | 'calculus' | 'linear-algebra'
  | 'discrete' | 'mental' | 'realworld' | 'puzzles';

export type AgeBand = 'early' | 'elementary' | 'secondary' | 'university';

export type VisualSpec =
  | { type: 'objects'; emoji: string; count: number; groups?: number }
  | { type: 'fraction-bar'; parts: number; shaded: number }
  | { type: 'fraction-circle'; parts: number; shaded: number }
  | { type: 'rect'; w: number; h: number; unit?: string; labels?: boolean }
  | { type: 'right-triangle'; a: number | string; b: number | string; c: number | string; unit?: string }
  | { type: 'circle'; r: number; unit?: string }
  | { type: 'clock'; h: number; m: number }
  | { type: 'number-line'; min: number; max: number; marks?: number[]; highlight?: number }
  | { type: 'line-graph'; m: number; b: number; points?: [number, number][] }
  | { type: 'parabola'; a: number; h: number; k: number }
  | { type: 'bar-chart'; labels: string[]; values: number[] }
  | { type: 'shape'; shape: 'circle' | 'square' | 'triangle' | 'rectangle' | 'hexagon' | 'pentagon' | 'star' }
  | { type: 'coins'; coins: number[] }
  | { type: 'pattern'; items: string[] }
  | { type: 'matrix'; rows: (number | string)[][] }
  | { type: 'dice'; values: number[] }
  | { type: 'unit-circle'; angle: number };

export type AnswerType = 'number' | 'fraction' | 'expression' | 'set' | 'pair' | 'choice' | 'text' | 'antiderivative';

export type Verify =
  | { kind: 'numeric'; expr: string }
  | { kind: 'equation'; eq: string; variable: string }
  | { kind: 'roots'; expr: string; variable: string }
  | { kind: 'system'; eqs: string[]; vars: string[] }
  | { kind: 'derivative'; f: string; variable: string }
  | { kind: 'antiderivative'; f: string; variable: string }
  | { kind: 'equivalent'; expr: string; vars: string[] }
  | { kind: 'choice' }
  | { kind: 'none'; reason: string };

/** A fully generated question including its answer. Never sent to the client before it is answered. */
export interface Question {
  id: string;
  skillId: string;
  prompt: string;
  answerType: AnswerType;
  answer: string;
  choices?: string[];
  accept?: string[];
  tolerance?: number;
  unit?: string;
  variable?: string;
  requireSimplest?: boolean;
  hints: string[];          // [small hint, concept reminder, next step]
  steps: string[];          // full worked solution (UNDERSTAND → PLAN → SOLVE → CHECK)
  explanation: string;      // one-paragraph "why" + communicated answer
  mistakes?: { answer: string; type: string; message: string }[];
  difficulty: number;       // 1..5
  visual?: VisualSpec;
  verify: Verify;
  context?: string;         // real-world framing
  source?: 'generator' | 'ai' | 'bank';
}

/** What the client sees before answering. */
export type PublicQuestion = Omit<Question, 'answer' | 'accept' | 'hints' | 'steps' | 'explanation' | 'mistakes' | 'verify'> & {
  hintCount: number;
};

export interface CheckResult {
  correct: boolean;
  feedback: string;
  mistakeType?: string;
  nudge?: boolean;
}

export interface SkillMeta {
  id: string;
  title: string;
  domain: DomainId;
  grade: number;                 // 0 = K, 1..12, 13..15 = university years
  prereqs: string[];
  tags: string[];
  summary: string;
  learn: string[];               // short explanation paragraphs
  keyIdea: string;               // formula / rule
  realWorld: string;
  explainPrompt: string;
  explainKeywords: string[];     // concepts a good explanation should mention
  calculator?: boolean;
  visual?: boolean;              // generator commonly produces visuals
}

export interface CourseUnit { id: string; title: string; description?: string; lessons: CourseLesson[] }
export interface CourseLesson {
  id: string;
  title: string;
  skillId?: string;              // built-in skill
  generated?: GeneratedLesson;   // AI-generated content (validated)
  kind?: 'lesson' | 'review' | 'checkpoint';
}
export interface GeneratedLesson {
  objective: string;
  explanation: string[];
  example: { problem: string; steps: string[]; answer: string };
  practice: Question[];
  challenge?: Question;
  explainPrompt: string;
  explainKeywords: string[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  targetLevel: number;
  prerequisites: string[];
  units: CourseUnit[];
  resources: string[];
  masteryRules: { lessonPass: number; unitPass: number };
  generatedBy: 'curriculum' | 'planner' | 'ai';
  icon?: string;
  band?: string;
  status?: 'approved' | 'pending_review' | 'draft' | 'personal';
}

export interface ProfileSummary {
  id: string;
  name: string;
  avatar: string;
  color: string;
  schoolGrade: number | null;
  schoolLabel: string;
  learningLevel: number | null;
  ageBand: AgeBand;
  xp: number;
  level: number;
  streak: number;
  onboarded: boolean;
  placementDone: boolean;
  hasPin: boolean;
  curriculum: string;
  dailyGoalMin: number;
}
