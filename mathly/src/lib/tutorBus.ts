// Opens the global tutor drawer with the context of whatever the student is looking at.
export interface TutorContext { questionId?: string; skillId?: string; studentAnswer?: string; helpLevel?: number; lessonStage?: string; homeworkId?: string; prompt?: string }
const listeners = new Set<(c: TutorContext) => void>();
export const onOpenTutor = (fn: (c: TutorContext) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const openTutor = (c: TutorContext = {}) => listeners.forEach((l) => l(c));
