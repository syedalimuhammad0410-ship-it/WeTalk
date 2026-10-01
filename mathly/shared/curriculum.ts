import type { AgeBand, Course, DomainId } from './types.ts';
import { SKILLS, SKILL_MAP } from './skills.ts';

export const APP_NAME = 'Mathly';
export const APP_TAGLINE = "Don't just get the answer. Learn how to think.";

export const DOMAINS: Record<DomainId, { name: string; icon: string; color: string }> = {
  number: { name: 'Numbers & Operations', icon: '🔢', color: '#6366f1' },
  fractions: { name: 'Fractions & Decimals', icon: '🍕', color: '#f59e0b' },
  ratios: { name: 'Ratios & Percent', icon: '⚖️', color: '#14b8a6' },
  algebra: { name: 'Algebra', icon: '𝑥', color: '#8b5cf6' },
  functions: { name: 'Functions & Graphs', icon: '📈', color: '#0ea5e9' },
  geometry: { name: 'Geometry & Measurement', icon: '📐', color: '#22c55e' },
  statistics: { name: 'Statistics', icon: '📊', color: '#ec4899' },
  probability: { name: 'Probability', icon: '🎲', color: '#f97316' },
  trigonometry: { name: 'Trigonometry', icon: '📏', color: '#06b6d4' },
  calculus: { name: 'Calculus', icon: '∫', color: '#a855f7' },
  'linear-algebra': { name: 'Linear Algebra', icon: '▦', color: '#3b82f6' },
  discrete: { name: 'Discrete Math & Proofs', icon: '∴', color: '#64748b' },
  mental: { name: 'Mental Math', icon: '⚡', color: '#eab308' },
  realworld: { name: 'Real-World Math', icon: '🌍', color: '#10b981' },
  puzzles: { name: 'Puzzles & Logic', icon: '🧩', color: '#ef4444' },
};

/** Domains assessed in the placement test (in round-robin order). */
export const PLACEMENT_DOMAINS: DomainId[] = [
  'number', 'fractions', 'algebra', 'geometry', 'ratios', 'statistics', 'probability', 'functions', 'mental', 'realworld', 'trigonometry', 'calculus',
];

export const SCHOOL_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: 'Kindergarten' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Grade ${i + 1}` })),
  { value: 13, label: 'College' },
  { value: 14, label: 'University' },
  { value: 15, label: 'Adult learner' },
];

export const CURRICULA = [
  { id: 'canada', label: 'Canada', flag: '🇨🇦' },
  { id: 'us', label: 'United States', flag: '🇺🇸' },
  { id: 'uk', label: 'United Kingdom', flag: '🇬🇧' },
  { id: 'pakistan', label: 'Pakistan', flag: '🇵🇰' },
  { id: 'india', label: 'India', flag: '🇮🇳' },
  { id: 'australia', label: 'Australia', flag: '🇦🇺' },
  { id: 'ib', label: 'IB / International', flag: '🌐' },
  { id: 'other', label: 'Other', flag: '🗺️' },
  { id: 'custom', label: 'Custom', flag: '✏️' },
];

/** Curriculum-aware grade label. Grade numbers are internal (0=K, 1..12, 13+=university). */
export function gradeLabel(grade: number | null | undefined, curriculum = 'us'): string {
  if (grade == null || Number.isNaN(grade)) return 'Not set';
  const g = Math.round(grade);
  if (g >= 13) return g >= 15 ? 'Advanced University' : `University Year ${g - 12}`;
  switch (curriculum) {
    case 'uk': return g === 0 ? 'Reception' : `Year ${g + 1}`;
    case 'australia': return g === 0 ? 'Foundation' : `Year ${g}`;
    case 'pakistan':
    case 'india': return g === 0 ? 'KG' : `Class ${g}`;
    case 'ib': return g <= 5 ? (g === 0 ? 'PYP (K)' : `PYP ${g}`) : g <= 10 ? `MYP ${g - 5}` : `DP ${g - 10}`;
    default: return g === 0 ? 'Kindergarten' : `Grade ${g}`;
  }
}

/** Learning-level label with one decimal, e.g. "Grade 8.1". */
export function levelLabel(level: number | null | undefined, curriculum = 'us'): string {
  if (level == null) return 'Not assessed';
  if (level >= 13) return `University ${Math.min(3, Math.floor(level - 12)).toString()}${level >= 15 ? '+' : ''}`;
  if (level < 1) return 'Kindergarten';
  const base = gradeLabel(Math.floor(level), curriculum);
  const frac = Math.floor((level - Math.floor(level)) * 10);
  return curriculum === 'us' || curriculum === 'canada' || curriculum === 'other' || curriculum === 'custom'
    ? `${base}.${frac}` : `${base} (${level.toFixed(1)})`;
}

export function ageBandFor(schoolGrade: number | null | undefined): AgeBand {
  if (schoolGrade == null) return 'secondary';
  if (schoolGrade <= 2) return 'early';
  if (schoolGrade <= 5) return 'elementary';
  if (schoolGrade <= 12) return 'secondary';
  return 'university';
}

export const ONBOARDING = {
  purposes: ['School', 'Homework', 'Tests', 'University', 'Business', 'Finance', 'Engineering', 'Computer science', 'Medicine', 'Science', 'Economics', 'Everyday life', 'Competition/Olympiad', 'Personal interest', 'I just want to become better at math', 'Other'],
  enjoys: ['Mental math', 'Word problems', 'Algebra', 'Geometry', 'Graphs', 'Statistics', 'Probability', 'Calculus', 'Logic', 'Puzzles', 'Numbers', 'Money', 'Real-world problems', 'Programming/math', 'Other'],
  styles: ['Visual explanations', 'Step-by-step examples', 'Practice problems', 'AI explanations', 'Videos', 'Articles', 'Real-world examples', 'Games', 'Challenges', 'Speaking/explaining concepts'],
  goals: ['Improve grades', 'Get ahead', 'Learn one grade ahead', 'Prepare for a test', 'Prepare for university', 'Learn advanced mathematics', 'Become better at mental math', 'Become more confident', 'Learn math for a career', 'Competition/Olympiad', 'Other'],
};

/** Which domains each "enjoy" choice boosts in recommendations. */
export const ENJOY_DOMAINS: Record<string, DomainId[]> = {
  'Mental math': ['mental'], 'Word problems': ['realworld', 'puzzles'], Algebra: ['algebra'], Geometry: ['geometry'],
  Graphs: ['functions'], Statistics: ['statistics'], Probability: ['probability'], Calculus: ['calculus'], Logic: ['discrete', 'puzzles'],
  Puzzles: ['puzzles'], Numbers: ['number'], Money: ['realworld'], 'Real-world problems': ['realworld'], 'Programming/math': ['discrete', 'linear-algebra'],
};

export const AVATARS = ['🦊', '🐼', '🦉', '🐯', '🐙', '🦄', '🐸', '🐧', '🦁', '🐨', '🚀', '🌟', '🧠', '📐', '🪐', '🐢', '🦋', '🐳'];
export const PROFILE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#0ea5e9', '#22c55e', '#eab308'];

// ─────────────────────────────────────────── Courses (core curriculum)
const unit = (id: string, title: string, skills: string[], description?: string) => ({
  id, title, description,
  lessons: skills.filter((s) => SKILL_MAP[s]).map((s) => ({ id: s, title: SKILL_MAP[s].title, skillId: s, kind: 'lesson' as const })),
});
const course = (id: string, title: string, description: string, band: string, icon: string, targetLevel: number, difficulty: string, units: Course['units'], prerequisites: string[] = []): Course => ({
  id, title, description, band, icon, targetLevel, difficulty, units, prerequisites, resources: [],
  masteryRules: { lessonPass: 70, unitPass: 75 }, generatedBy: 'curriculum', status: 'approved',
});

export const CORE_COURSES: Course[] = [
  course('kindergarten', 'Kindergarten Math', 'Counting, shapes, patterns and first steps in adding and subtracting.', 'Kindergarten', '🧸', 0, 'Beginner', [
    unit('k-u1', 'Counting & Comparing', ['k-count', 'k-compare']),
    unit('k-u2', 'Shapes & Patterns', ['k-shapes', 'k-patterns']),
    unit('k-u3', 'Adding & Taking Away', ['k-add10', 'k-sub10']),
  ]),
  course('grades-1-3', 'Foundations (Grades 1–3)', 'Place value, the four operations, first fractions, money, time and measurement.', 'Grades 1–3', '🌱', 2, 'Beginner', [
    unit('f-u1', 'Place Value & Time', ['place-value', 'telling-time']),
    unit('f-u2', 'Adding & Subtracting', ['add-2digit', 'sub-2digit', 'mental-add']),
    unit('f-u3', 'Multiplying & Dividing', ['mult-facts', 'div-facts']),
    unit('f-u4', 'Fractions, Money & Measurement', ['frac-intro', 'money', 'perimeter', 'area-rect', 'bar-graphs']),
  ]),
  course('grades-4-6', 'Grades 4–6 Math', 'Fractions, decimals, ratios, percentages, geometry, data and first variables.', 'Grades 4–6', '🧩', 5, 'Intermediate', [
    unit('m-u1', 'Bigger Numbers', ['multi-digit-mult', 'long-division', 'order-ops', 'primes-factors']),
    unit('m-u2', 'Fractions', ['frac-equiv', 'frac-add-like', 'frac-add-unlike', 'frac-mult', 'frac-div']),
    unit('m-u3', 'Decimals & Percents', ['decimals', 'dec-mult', 'frac-dec-convert', 'percent-of']),
    unit('m-u4', 'Ratios & Rates', ['ratios', 'unit-rate', 'recipe-scaling']),
    unit('m-u5', 'Geometry & Graphs', ['area-triangle', 'coord-plane', 'negatives']),
    unit('m-u6', 'Data, Chance & Variables', ['mean-median-mode', 'simple-prob', 'variables-eval', 'one-step-eq']),
  ]),
  course('grades-7-8', 'Grades 7–8 Math', 'Algebra, linear equations, functions, geometry, exponents, statistics and probability.', 'Grades 7–8', '🚀', 8, 'Intermediate', [
    unit('j-u1', 'Expressions & Equations', ['simplify-expr', 'two-step-eq', 'multi-step-eq', 'inequalities']),
    unit('j-u2', 'Proportional Reasoning', ['proportions', 'percent-change', 'shopping-discounts']),
    unit('j-u3', 'Exponents & Roots', ['exponents', 'exponent-rules', 'square-roots', 'sci-notation']),
    unit('j-u4', 'Linear Functions', ['function-eval', 'slope', 'slope-intercept']),
    unit('j-u5', 'Geometry', ['angles', 'circles', 'volume', 'pythagorean']),
    unit('j-u6', 'Statistics & Probability', ['compound-prob', 'sports-stats']),
  ]),
  course('algebra-1', 'Algebra I', 'A complete first course in algebra: equations, functions, systems and quadratics.', 'Grades 8–9', '𝑥', 9, 'Intermediate', [
    unit('a-u1', 'Foundations', ['variables-eval', 'simplify-expr', 'two-step-eq', 'multi-step-eq']),
    unit('a-u2', 'Linear Functions', ['slope', 'slope-intercept', 'systems']),
    unit('a-u3', 'Exponents', ['exponent-rules', 'sci-notation']),
    unit('a-u4', 'Quadratics', ['factor-quadratic', 'quadratic-formula']),
  ]),
  course('grades-9-12', 'High School Math (Grades 9–12)', 'Quadratics, functions, trigonometry, analytic geometry, vectors, sequences and statistics.', 'Grades 9–12', '🎓', 11, 'Advanced', [
    unit('h-u1', 'Quadratics', ['factor-quadratic', 'quadratic-formula', 'vertex-form']),
    unit('h-u2', 'Functions', ['composition', 'exponential-growth', 'logarithms', 'arith-sequence', 'geom-series']),
    unit('h-u3', 'Trigonometry', ['trig-ratios', 'unit-circle', 'law-of-sines']),
    unit('h-u4', 'Analytic Geometry & Vectors', ['distance-midpoint', 'vectors']),
    unit('h-u5', 'Statistics & Probability', ['counting', 'std-dev', 'binomial', 'z-scores']),
    unit('h-u6', 'Into Calculus', ['limits', 'derivative-power', 'complex-numbers']),
  ]),
  course('calculus-1', 'Calculus I', 'Limits, derivatives and their applications, and an introduction to integration.', 'University', '∂', 12.5, 'University', [
    unit('c1-u1', 'Limits', ['function-eval', 'limits']),
    unit('c1-u2', 'Derivatives', ['derivative-power', 'derivative-rules']),
    unit('c1-u3', 'Applications of Derivatives', ['optimization', 'newtons-method']),
    unit('c1-u4', 'Integrals', ['integrals-power', 'definite-integrals']),
  ], ['factor-quadratic', 'function-eval', 'exponent-rules']),
  course('calculus-2', 'Calculus II', 'Integration techniques, series, Taylor polynomials and first differential equations.', 'University', '∫', 13.5, 'University', [
    unit('c2-u1', 'Integration Techniques', ['definite-integrals', 'integration-by-parts']),
    unit('c2-u2', 'Sequences & Series', ['geom-series', 'series-convergence', 'taylor-series']),
    unit('c2-u3', 'Differential Equations', ['separable-ode']),
  ], ['integrals-power']),
  course('multivariable', 'Multivariable Calculus & ODEs', 'Partial derivatives, vectors and differential equations.', 'University', '∇', 14, 'University', [
    unit('mv-u1', 'Vectors & Space', ['vectors']),
    unit('mv-u2', 'Partial Derivatives', ['partial-derivatives']),
    unit('mv-u3', 'Differential Equations', ['separable-ode']),
  ], ['derivative-rules']),
  course('linear-algebra', 'Linear Algebra', 'Systems, matrices, determinants and eigenvalues.', 'University', '▦', 13.5, 'University', [
    unit('la-u1', 'Systems & Vectors', ['systems', 'vectors']),
    unit('la-u2', 'Matrices', ['matrix-mult', 'determinants']),
    unit('la-u3', 'Eigen-theory', ['eigenvalues']),
  ]),
  course('discrete-math', 'Discrete Math, Number Theory & Proofs', 'Logic, induction, counting, gcd and modular arithmetic.', 'University', '∴', 13.5, 'University', [
    unit('d-u1', 'Logic & Proof', ['logic-truth', 'proofs-induction']),
    unit('d-u2', 'Counting', ['counting', 'binomial']),
    unit('d-u3', 'Number Theory', ['gcd-euclid', 'modular']),
  ]),
  course('abstract-analysis', 'Intro to Abstract Algebra & Real Analysis', 'Groups, complex numbers, bounds and convergence.', 'University', '𝔾', 15, 'Expert', [
    unit('aa-u1', 'Algebraic Structures', ['complex-numbers', 'modular', 'group-order']),
    unit('aa-u2', 'Analysis', ['real-analysis-sup', 'series-convergence']),
  ]),
  course('stats-prob', 'Statistics & Probability', 'From averages to distributions and expected value.', 'Grades 9–University', '📊', 12, 'Advanced', [
    unit('s-u1', 'Describing Data', ['mean-median-mode', 'std-dev', 'z-scores']),
    unit('s-u2', 'Probability', ['simple-prob', 'compound-prob', 'counting']),
    unit('s-u3', 'Distributions', ['binomial', 'expected-value']),
  ]),
  course('financial-math', 'Financial Mathematics', 'Percentages, interest, loans, mortgages, growth and present value.', 'Real World', '💹', 10, 'Intermediate', [
    unit('fm-u1', 'Percent Foundations', ['percent-of', 'percent-change', 'shopping-discounts']),
    unit('fm-u2', 'Interest', ['simple-interest', 'compound-interest', 'exponential-growth']),
    unit('fm-u3', 'Business Math', ['profit-margin', 'growth-rates']),
    unit('fm-u4', 'Time Value of Money', ['present-value', 'mortgage']),
  ]),
  course('everyday-math', 'Everyday Math', 'Shopping, cooking, travel, sports and money in daily life.', 'Real World', '🛒', 7, 'Beginner', [
    unit('e-u1', 'Money & Shopping', ['money', 'unit-rate', 'shopping-discounts']),
    unit('e-u2', 'Kitchen Math', ['recipe-scaling']),
    unit('e-u3', 'Travel', ['speed-distance', 'fuel-cost', 'currency']),
    unit('e-u4', 'Sports', ['sports-stats']),
  ]),
  course('engineering-math', 'Math for Engineering', 'Measurement, formulas, trigonometry, vectors and calculus used by engineers.', 'Real World', '⚙️', 12, 'Advanced', [
    unit('en-u1', 'Measurement & Formulas', ['volume', 'engineering-formulas']),
    unit('en-u2', 'Triangles & Forces', ['pythagorean', 'trig-ratios', 'vectors']),
    unit('en-u3', 'Rates of Change', ['derivative-power', 'integrals-power']),
  ]),
  course('mental-math', 'Mental Math Mastery', 'Strategies to calculate quickly and confidently in your head.', 'All levels', '⚡', 6, 'All levels', [
    unit('mm-u1', 'Fast Facts', ['mental-add', 'mult-facts']),
    unit('mm-u2', 'Tricks', ['mental-mult', 'mental-percent', 'mental-squares']),
  ]),
  course('puzzles-logic', 'Puzzles & Logic', 'Patterns, reasoning puzzles and competition-style thinking.', 'All levels', '🧩', 6, 'All levels', [
    unit('pz-u1', 'Patterns', ['k-patterns', 'sequences-next']),
    unit('pz-u2', 'Reasoning', ['missing-digit', 'logic-puzzles']),
  ]),
];

export const CORE_COURSE_MAP: Record<string, Course> = Object.fromEntries(CORE_COURSES.map((c) => [c.id, c]));

// ─────────────────────────────────────────── Gamification
export const DEFAULT_XP_RULES: Record<string, number> = {
  lesson_complete: 100,
  practice_correct: 10,
  hard_correct: 30,
  perfect_lesson: 50,
  test_complete: 200,
  explain: 25,
  presentation: 100,
  daily_challenge: 100,
  placement_complete: 150,
  homework_complete: 50,
};

export const XP_RULE_LABELS: Record<string, string> = {
  lesson_complete: 'Complete a lesson', practice_correct: 'Correct practice question', hard_correct: 'Correct difficult question',
  perfect_lesson: 'Perfect lesson bonus', test_complete: 'Complete a mock test', explain: 'Explain your thinking',
  presentation: 'Presentation practice', daily_challenge: 'Daily challenge', placement_complete: 'Finish placement', homework_complete: 'Finish a homework session',
};

/** Total XP required to reach a level. Level 1 = 0 XP. */
export const xpForLevel = (level: number) => (level <= 1 ? 0 : Math.round(100 * Math.pow(level - 1, 1.6)));
export function levelFromXp(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, current: xp, base: xpForLevel(level), next: xpForLevel(level + 1) };
}

export const UNLOCKS: { level: number; kind: 'theme' | 'avatar' | 'badge' | 'mode'; id: string; label: string }[] = [
  { level: 2, kind: 'mode', id: 'game', label: 'Game Mode: Number Blitz' },
  { level: 3, kind: 'theme', id: 'ocean', label: 'Ocean accent theme' },
  { level: 4, kind: 'avatar', id: '🐉', label: 'Dragon avatar' },
  { level: 5, kind: 'theme', id: 'sunset', label: 'Sunset accent theme' },
  { level: 6, kind: 'mode', id: 'challenge', label: 'Challenge Mode' },
  { level: 7, kind: 'avatar', id: '🤖', label: 'Robot avatar' },
  { level: 8, kind: 'theme', id: 'forest', label: 'Forest accent theme' },
  { level: 10, kind: 'avatar', id: '👑', label: 'Crown avatar' },
  { level: 12, kind: 'theme', id: 'midnight', label: 'Midnight accent theme' },
  { level: 15, kind: 'badge', id: 'scholar', label: 'Scholar badge' },
];

export const ACCENT_THEMES: Record<string, { label: string; accent: string; accent2: string; minLevel: number }> = {
  default: { label: 'Mathly Indigo', accent: '#5b5bf0', accent2: '#8b5cf6', minLevel: 1 },
  ocean: { label: 'Ocean', accent: '#0891b2', accent2: '#0ea5e9', minLevel: 3 },
  sunset: { label: 'Sunset', accent: '#ea580c', accent2: '#e11d48', minLevel: 5 },
  forest: { label: 'Forest', accent: '#16a34a', accent2: '#0d9488', minLevel: 8 },
  midnight: { label: 'Midnight', accent: '#4338ca', accent2: '#0f172a', minLevel: 12 },
};

export const ACHIEVEMENTS: { id: string; title: string; description: string; icon: string; xp: number }[] = [
  { id: 'first_lesson', title: 'First Lesson', description: 'Complete your first lesson.', icon: '🎉', xp: 50 },
  { id: 'placement', title: 'Know Thyself', description: 'Finish the placement assessment.', icon: '🧭', xp: 50 },
  { id: 'streak_3', title: 'Warming Up', description: 'Learn 3 days in a row.', icon: '🔥', xp: 30 },
  { id: 'streak_7', title: '7 Day Streak', description: 'Learn 7 days in a row.', icon: '🔥', xp: 100 },
  { id: 'streak_30', title: 'Unstoppable', description: 'Learn 30 days in a row.', icon: '🌋', xp: 500 },
  { id: 'problems_100', title: '100 Problems Solved', description: 'Answer 100 questions correctly.', icon: '💯', xp: 100 },
  { id: 'problems_1000', title: '1,000 Calculations', description: 'Answer 1,000 questions correctly.', icon: '🧮', xp: 500 },
  { id: 'one_grade_ahead', title: 'One Grade Ahead', description: 'Reach a learning level one grade above your school grade.', icon: '⏫', xp: 200 },
  { id: 'perfect_practice', title: 'Perfect Practice', description: 'Get 10 correct in a row without hints.', icon: '🎯', xp: 75 },
  { id: 'geometry_explorer', title: 'Geometry Explorer', description: 'Reach 60% mastery in 4 geometry skills.', icon: '📐', xp: 100 },
  { id: 'mental_master', title: 'Mental Math Master', description: 'Answer 50 mental-math questions correctly.', icon: '⚡', xp: 150 },
  { id: 'confident_presenter', title: 'Confident Presenter', description: 'Score 80+ on a presentation practice.', icon: '🎤', xp: 150 },
  { id: 'math_explorer', title: 'Math Explorer', description: 'Practice in 6 different areas of math.', icon: '🧭', xp: 100 },
  { id: 'course_creator', title: 'Custom Course Creator', description: 'Build your own learning path.', icon: '🛠️', xp: 75 },
  { id: 'explainer', title: 'Great Explainer', description: 'Explain your thinking 10 times.', icon: '💬', xp: 100 },
  { id: 'test_ready', title: 'Test Ready', description: 'Score 80% or more on a mock test.', icon: '📝', xp: 150 },
  { id: 'homework_hero', title: 'Homework Hero', description: 'Work through 5 homework problems with the tutor.', icon: '🦸', xp: 100 },
  { id: 'daily_7', title: 'Daily Challenger', description: 'Complete 7 daily challenges.', icon: '🌅', xp: 150 },
];

// ─────────────────────────────────────────── Presentation practice topics with rubrics
export const PRESENTATION_TOPICS: { id: string; title: string; prompt: string; skillId: string; concepts: { label: string; keywords: string[] }[]; vocabulary: string[] }[] = [
  { id: 'pythagorean', title: 'The Pythagorean Theorem', prompt: 'Explain the Pythagorean theorem, when it applies, and show an example.', skillId: 'pythagorean',
    concepts: [
      { label: 'States the theorem (a² + b² = c²)', keywords: ['a squared plus b squared', 'a² + b²', 'a^2', 'squared plus', 'equals c squared'] },
      { label: 'Says it only works for right triangles', keywords: ['right triangle', 'right angle', '90 degree', 'ninety degree'] },
      { label: 'Identifies the hypotenuse as the longest side', keywords: ['hypotenuse', 'longest side', 'opposite the right angle'] },
      { label: 'Works through an example', keywords: ['for example', 'example', '3', '4', '5', 'let’s say', "let's say"] },
    ], vocabulary: ['hypotenuse', 'legs', 'right angle', 'square', 'theorem'] },
  { id: 'slope', title: 'What Slope Means', prompt: 'Explain what the slope of a line is, how to calculate it, and what it means in a real situation.', skillId: 'slope',
    concepts: [
      { label: 'Defines slope as rise over run / rate of change', keywords: ['rise over run', 'rise', 'run', 'rate of change', 'steepness', 'steep'] },
      { label: 'Gives the formula', keywords: ['y2 minus y1', 'change in y', 'difference in y', 'over change in x', 'divided by'] },
      { label: 'Explains positive vs negative slope', keywords: ['positive', 'negative', 'goes up', 'goes down', 'increasing', 'decreasing'] },
      { label: 'Connects to a real situation', keywords: ['for example', 'per hour', 'per', 'cost', 'speed', 'real'] },
    ], vocabulary: ['slope', 'rate of change', 'rise', 'run', 'intercept'] },
  { id: 'fraction-add', title: 'Adding Fractions', prompt: 'Explain how to add two fractions with different denominators and why it works.', skillId: 'frac-add-unlike',
    concepts: [
      { label: 'Explains the need for a common denominator', keywords: ['common denominator', 'same denominator', 'same size'] },
      { label: 'Shows how to make equivalent fractions', keywords: ['equivalent', 'multiply the top and bottom', 'multiply both', 'numerator and denominator'] },
      { label: 'Adds the numerators, keeps the denominator', keywords: ['add the numerators', 'add the tops', 'keep the denominator'] },
      { label: 'Simplifies or checks the answer', keywords: ['simplify', 'simplest', 'check', 'reduce'] },
    ], vocabulary: ['numerator', 'denominator', 'equivalent', 'common denominator'] },
  { id: 'linear-eq', title: 'Solving a Linear Equation', prompt: 'Explain how to solve 3x + 5 = 20 and why each step is allowed.', skillId: 'two-step-eq',
    concepts: [
      { label: 'Describes keeping the equation balanced', keywords: ['both sides', 'balance', 'same thing to both'] },
      { label: 'Uses inverse operations', keywords: ['inverse', 'undo', 'opposite operation', 'subtract 5', 'divide by 3'] },
      { label: 'Finds the correct solution x = 5', keywords: ['x equals 5', 'x = 5', 'x is 5', 'equals five'] },
      { label: 'Checks the answer', keywords: ['check', 'substitute', 'plug', 'put it back'] },
    ], vocabulary: ['equation', 'variable', 'inverse', 'isolate', 'substitute'] },
  { id: 'circle-area', title: 'Area of a Circle', prompt: 'Explain the formula for the area of a circle and how to use it.', skillId: 'circles',
    concepts: [
      { label: 'States A = πr²', keywords: ['pi r squared', 'πr²', 'pi times radius squared', 'pi r^2'] },
      { label: 'Defines the radius', keywords: ['radius', 'center to the edge', 'half the diameter'] },
      { label: 'Explains π', keywords: ['pi', '3.14', 'ratio', 'circumference'] },
      { label: 'Gives units (square units)', keywords: ['square', 'squared units', 'cm²', 'square centimeters', 'units squared'] },
    ], vocabulary: ['radius', 'diameter', 'pi', 'area', 'circumference'] },
  { id: 'quadratic-formula', title: 'The Quadratic Formula', prompt: 'Explain the quadratic formula, what each part means, and what the discriminant tells you.', skillId: 'quadratic-formula',
    concepts: [
      { label: 'States the formula', keywords: ['negative b', 'minus b', 'plus or minus', 'square root', 'over 2a', '2a'] },
      { label: 'Explains standard form ax² + bx + c = 0', keywords: ['standard form', 'equals zero', 'equal to zero', 'a b and c', 'coefficients'] },
      { label: 'Explains the discriminant', keywords: ['discriminant', 'b squared minus 4ac', 'b² − 4ac'] },
      { label: 'Number of solutions', keywords: ['two solutions', 'one solution', 'no real', 'two roots', 'roots'] },
    ], vocabulary: ['quadratic', 'discriminant', 'roots', 'coefficient', 'solutions'] },
  { id: 'derivative', title: 'What Is a Derivative?', prompt: 'Explain what a derivative is, how to compute one with the power rule, and why it matters.', skillId: 'derivative-power',
    concepts: [
      { label: 'Rate of change / slope of tangent', keywords: ['rate of change', 'slope', 'tangent', 'instantaneous'] },
      { label: 'Power rule', keywords: ['power rule', 'bring down', 'exponent', 'subtract one', 'n x to the n minus 1'] },
      { label: 'Limit idea', keywords: ['limit', 'approaches', 'h goes to zero', 'smaller and smaller'] },
      { label: 'Application', keywords: ['velocity', 'speed', 'maximum', 'minimum', 'optimization', 'for example'] },
    ], vocabulary: ['derivative', 'tangent', 'limit', 'rate of change', 'function'] },
  { id: 'probability', title: 'Basic Probability', prompt: 'Explain how to calculate the probability of an event with an example.', skillId: 'simple-prob',
    concepts: [
      { label: 'Favorable over total outcomes', keywords: ['favorable', 'total outcomes', 'number of outcomes', 'out of'] },
      { label: 'Probability is between 0 and 1', keywords: ['between 0 and 1', 'zero and one', 'impossible', 'certain'] },
      { label: 'Equally likely outcomes', keywords: ['equally likely', 'fair', 'same chance'] },
      { label: 'Example', keywords: ['dice', 'die', 'coin', 'cards', 'for example'] },
    ], vocabulary: ['probability', 'outcome', 'event', 'likely', 'fraction'] },
  { id: 'mean-median', title: 'Mean vs. Median', prompt: 'Explain the difference between the mean and the median and when each is more useful.', skillId: 'mean-median-mode',
    concepts: [
      { label: 'Defines mean', keywords: ['add them all', 'add up', 'sum', 'divide by how many', 'average'] },
      { label: 'Defines median', keywords: ['middle', 'in order', 'sorted', 'order them'] },
      { label: 'Discusses outliers', keywords: ['outlier', 'extreme', 'very large', 'skew'] },
      { label: 'Gives an example', keywords: ['for example', 'salaries', 'house prices', 'test scores'] },
    ], vocabulary: ['mean', 'median', 'outlier', 'data', 'average'] },
  { id: 'percent', title: 'Percentages', prompt: 'Explain what a percentage is and how to find a percentage of an amount.', skillId: 'percent-of',
    concepts: [
      { label: 'Percent means per hundred', keywords: ['per hundred', 'out of 100', 'out of a hundred'] },
      { label: 'Converts percent to decimal or fraction', keywords: ['divide by 100', 'decimal', '0.', 'fraction'] },
      { label: 'Multiplies by the amount', keywords: ['multiply', 'times', 'of means'] },
      { label: 'Real-world example', keywords: ['discount', 'tip', 'tax', 'sale', 'for example'] },
    ], vocabulary: ['percent', 'decimal', 'fraction', 'hundred'] },
  { id: 'eigen', title: 'Eigenvalues and Eigenvectors', prompt: 'Explain what eigenvalues and eigenvectors are and how to compute eigenvalues of a 2×2 matrix.', skillId: 'eigenvalues',
    concepts: [
      { label: 'Av = λv definition', keywords: ['a v equals lambda v', 'av = λv', 'scaled', 'stretch', 'same direction'] },
      { label: 'Characteristic equation', keywords: ['determinant', 'a minus lambda i', 'characteristic', 'det'] },
      { label: 'Solve the polynomial', keywords: ['roots', 'polynomial', 'quadratic', 'solve for lambda'] },
      { label: 'Application', keywords: ['pagerank', 'vibration', 'stability', 'pca', 'markov'] },
    ], vocabulary: ['eigenvalue', 'eigenvector', 'determinant', 'matrix', 'linear transformation'] },
  { id: 'custom', title: 'Your own topic', prompt: 'Choose any math idea and explain it as if teaching a classmate.', skillId: '',
    concepts: [
      { label: 'Defines the main idea', keywords: ['is when', 'means', 'is defined', 'definition', 'is a'] },
      { label: 'Uses an example', keywords: ['for example', 'for instance', 'example', 'let’s say', "let's say"] },
      { label: 'Explains why it works', keywords: ['because', 'so that', 'which means', 'therefore', 'reason'] },
      { label: 'Concludes / summarizes', keywords: ['in summary', 'so the answer', 'to sum up', 'in conclusion', 'overall'] },
    ], vocabulary: [] },
];

// ─────────────────────────────────────────── Learn Anything: topic → skills map (deterministic planner)
export const TOPIC_MAP: { keywords: string[]; title: string; skills: string[]; description: string }[] = [
  { keywords: ['calculus'], title: 'Calculus', description: 'Limits, derivatives, integrals and their applications.', skills: ['limits', 'derivative-power', 'derivative-rules', 'optimization', 'integrals-power', 'definite-integrals', 'integration-by-parts'] },
  { keywords: ['derivative', 'differentiation'], title: 'Derivatives', description: 'Rates of change and the rules of differentiation.', skills: ['limits', 'derivative-power', 'derivative-rules', 'optimization'] },
  { keywords: ['integral', 'integration'], title: 'Integration', description: 'Antiderivatives, definite integrals and techniques.', skills: ['integrals-power', 'definite-integrals', 'integration-by-parts'] },
  { keywords: ['linear algebra', 'matrix', 'matrices', 'eigen'], title: 'Linear Algebra', description: 'Vectors, matrices, determinants and eigenvalues.', skills: ['systems', 'vectors', 'matrix-mult', 'determinants', 'eigenvalues'] },
  { keywords: ['finance', 'financial', 'investment', 'banking', 'invest', 'stock'], title: 'Financial Mathematics', description: 'Percentages, interest, growth, discounting and valuation math.', skills: ['percent-of', 'ratios', 'percent-change', 'profit-margin', 'simple-interest', 'compound-interest', 'growth-rates', 'present-value', 'mean-median-mode', 'std-dev', 'expected-value'] },
  { keywords: ['mortgage', 'loan', 'house', 'debt'], title: 'How Mortgages Work', description: 'Interest, compounding and amortized loan payments.', skills: ['percent-of', 'simple-interest', 'compound-interest', 'geom-series', 'mortgage'] },
  { keywords: ['engineer', 'engineering', 'physics', 'mechanic'], title: 'Math for Engineering', description: 'Formulas, trigonometry, vectors, calculus and linear algebra used by engineers.', skills: ['engineering-formulas', 'pythagorean', 'trig-ratios', 'vectors', 'derivative-power', 'integrals-power', 'separable-ode', 'matrix-mult'] },
  { keywords: ['rocket', 'space', 'orbit', 'aerospace'], title: 'The Mathematics of Rockets', description: 'Vectors, exponentials, logarithms and calculus behind rocket motion.', skills: ['engineering-formulas', 'vectors', 'quadratic-formula', 'exponential-growth', 'logarithms', 'derivative-power', 'integrals-power', 'separable-ode'] },
  { keywords: ['probability', 'chance', 'odds', 'gambling'], title: 'Probability', description: 'From simple chance to distributions and expected value.', skills: ['simple-prob', 'compound-prob', 'counting', 'binomial', 'expected-value'] },
  { keywords: ['statistic', 'data science', 'data'], title: 'Statistics', description: 'Describing data, spread, and the normal distribution.', skills: ['mean-median-mode', 'std-dev', 'z-scores', 'binomial', 'expected-value'] },
  { keywords: ['trig', 'trigonometry', 'sine', 'cosine'], title: 'Trigonometry', description: 'Right-triangle trig, the unit circle and solving any triangle.', skills: ['pythagorean', 'trig-ratios', 'unit-circle', 'law-of-sines'] },
  { keywords: ['olympiad', 'competition', 'contest', 'amc', 'imo'], title: 'Olympiad Preparation', description: 'Number theory, counting, algebra and logical reasoning for competitions.', skills: ['primes-factors', 'gcd-euclid', 'modular', 'counting', 'logic-puzzles', 'sequences-next', 'proofs-induction', 'quadratic-formula', 'angles'] },
  { keywords: ['algebra'], title: 'Algebra', description: 'Expressions, equations, functions and quadratics.', skills: ['variables-eval', 'simplify-expr', 'two-step-eq', 'multi-step-eq', 'systems', 'factor-quadratic', 'quadratic-formula'] },
  { keywords: ['quadratic', 'parabola'], title: 'Quadratics', description: 'Factoring, the quadratic formula and parabolas.', skills: ['factor-quadratic', 'quadratic-formula', 'vertex-form'] },
  { keywords: ['fraction'], title: 'Fractions', description: 'Everything about fractions.', skills: ['frac-intro', 'frac-equiv', 'frac-add-like', 'frac-add-unlike', 'frac-mult', 'frac-div'] },
  { keywords: ['geometry', 'shape', 'area', 'volume'], title: 'Geometry', description: 'Area, volume, angles and the Pythagorean theorem.', skills: ['area-rect', 'area-triangle', 'angles', 'circles', 'volume', 'pythagorean', 'distance-midpoint'] },
  { keywords: ['proof', 'logic', 'discrete'], title: 'Discrete Math & Proofs', description: 'Logic, induction and number theory.', skills: ['logic-truth', 'proofs-induction', 'counting', 'gcd-euclid', 'modular'] },
  { keywords: ['number theory', 'prime', 'modular', 'cryptograph'], title: 'Number Theory', description: 'Primes, gcd and modular arithmetic.', skills: ['primes-factors', 'gcd-euclid', 'modular', 'group-order'] },
  { keywords: ['differential equation', 'ode'], title: 'Differential Equations', description: 'Modeling change with equations.', skills: ['derivative-rules', 'integrals-power', 'logarithms', 'separable-ode'] },
  { keywords: ['analysis', 'real analysis', 'series', 'convergence'], title: 'Real Analysis Foundations', description: 'Limits, bounds and convergence.', skills: ['limits', 'geom-series', 'series-convergence', 'real-analysis-sup', 'taylor-series'] },
  { keywords: ['abstract algebra', 'group theory', 'groups'], title: 'Abstract Algebra', description: 'Modular arithmetic, groups and complex numbers.', skills: ['modular', 'gcd-euclid', 'group-order', 'complex-numbers'] },
  { keywords: ['mental', 'fast', 'speed', 'head'], title: 'Mental Math', description: 'Strategies for fast calculation.', skills: ['mental-add', 'mental-mult', 'mental-percent', 'mental-squares'] },
  { keywords: ['game', 'graphics', 'video game', 'game development'], title: 'Math for Game Development', description: 'Coordinates, vectors, trigonometry and matrices behind games.', skills: ['coord-plane', 'distance-midpoint', 'vectors', 'trig-ratios', 'unit-circle', 'matrix-mult'] },
  { keywords: ['machine learning', 'ai', 'artificial intelligence', 'neural'], title: 'Math for Machine Learning', description: 'Linear algebra, calculus and probability for ML.', skills: ['matrix-mult', 'eigenvalues', 'partial-derivatives', 'derivative-rules', 'std-dev', 'expected-value', 'binomial'] },
  { keywords: ['business', 'economics', 'company', 'profit'], title: 'Business & Economics Math', description: 'Percentages, profit, growth and optimization.', skills: ['percent-of', 'percent-change', 'profit-margin', 'growth-rates', 'slope-intercept', 'optimization'] },
  { keywords: ['cook', 'shopping', 'everyday', 'travel'], title: 'Everyday Math', description: 'Math for daily life.', skills: ['unit-rate', 'shopping-discounts', 'recipe-scaling', 'speed-distance', 'fuel-cost', 'currency'] },
  { keywords: ['medicine', 'medical', 'nursing', 'dosage', 'pharmacy'], title: 'Math for Medicine', description: 'Ratios, proportions, unit rates, exponential decay and statistics.', skills: ['ratios', 'proportions', 'unit-rate', 'percent-of', 'exponential-growth', 'mean-median-mode', 'z-scores'] },
  { keywords: ['computer science', 'programming', 'coding', 'algorithm'], title: 'Math for Computer Science', description: 'Logic, number theory, counting, matrices and proofs.', skills: ['logic-truth', 'modular', 'gcd-euclid', 'counting', 'proofs-induction', 'exponent-rules', 'logarithms', 'matrix-mult'] },
];

/** All searchable skill ids, convenient for validation. */
export const ALL_SKILL_IDS = SKILLS.map((s) => s.id);
