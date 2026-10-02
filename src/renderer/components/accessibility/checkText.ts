import type { AccessibilityCheckId, AccessibilityStatus } from '@shared/schemas/accessibility';

/** What each check is called in the panel. */
export const CHECK_TITLES: Record<AccessibilityCheckId, string> = {
  title: 'Document title',
  displayTitle: 'Title in the title bar',
  language: 'Document language',
  tagged: 'Tags',
  figureAltText: 'Alternate text for figures',
  imageOnlyPages: 'Pages without text',
  formFieldNames: 'Form field descriptions',
  linkTargets: 'Links that go nowhere',
  linkDescriptions: 'Link descriptions',
  tabOrder: 'Tab order',
  untaggedContent: 'Text outside the tags',
  assistivePermission: 'Security and assistive technology',
  readingOrder: 'Reading order',
  colourContrast: 'Colour contrast',
};

/** The word a status is shown with, so colour is never the only signal. */
export const STATUS_WORDS: Record<AccessibilityStatus, string> = {
  failed: 'Problem',
  warning: 'Review',
  manual: 'Check by hand',
  passed: 'Passed',
  notApplicable: 'Not applicable',
};

/** The order checks are listed in: what needs doing first. */
export const STATUS_ORDER: Record<AccessibilityStatus, number> = {
  failed: 0,
  warning: 1,
  manual: 2,
  passed: 3,
  notApplicable: 4,
};

/** Common languages, offered while typing; any well-formed tag is accepted. */
export const COMMON_LANGUAGES: ReadonlyArray<{ tag: string; name: string }> = [
  { tag: 'en', name: 'English' },
  { tag: 'en-US', name: 'English (United States)' },
  { tag: 'en-GB', name: 'English (United Kingdom)' },
  { tag: 'fr', name: 'French' },
  { tag: 'de', name: 'German' },
  { tag: 'es', name: 'Spanish' },
  { tag: 'it', name: 'Italian' },
  { tag: 'pt', name: 'Portuguese' },
  { tag: 'nl', name: 'Dutch' },
  { tag: 'sv', name: 'Swedish' },
  { tag: 'pl', name: 'Polish' },
  { tag: 'ja', name: 'Japanese' },
  { tag: 'zh', name: 'Chinese' },
  { tag: 'ko', name: 'Korean' },
  { tag: 'ar', name: 'Arabic' },
  { tag: 'hi', name: 'Hindi' },
];
