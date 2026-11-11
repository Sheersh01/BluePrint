/** Sections whose articles follow the interview structure and can be practised on the whiteboard. */
export const PRACTICE_SECTIONS = ["problem-breakdowns", "real-life"] as const;

export const isPracticeSection = (section: string) => (PRACTICE_SECTIONS as readonly string[]).includes(section);
