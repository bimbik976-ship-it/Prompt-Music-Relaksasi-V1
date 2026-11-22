import { GeneratedTrackResult, MusicalMetadata, StyleIntensity } from '../types';

export const FORBIDDEN_TERMS = [
  'neo-classical',
  'neoclassical',
  'contemporary classical',
  'classical piano',
  'classical composition',
];

export const INCONSISTENT_HIGH_INTENSITY_TERMS = [
  'trailer',
  'trailer-like',
  'cinematic swell',
  'dramatic swell',
  'orchestral swell',
  'orchestral crescendo',
  'explosive climax',
  'passionate melodrama',
  'sentimental drama',
  'virtuosic cadenza',
  'furious arpeggio',
  'busy melodic',
  'busy accompaniment',
];

/**
 * Truncates and sanitizes a Style Prompt to ensure it strictly complies with the 1,000 character limit
 * while preserving natural musical phrasing, preventing unnecessary generation failures.
 * Target length: 750–900 characters. Absolute maximum: 1,000 characters.
 */
export function enforceStylePromptCharacterLimit(prompt: string, maxLimit = 1000): string {
  let text = prompt.trim();
  if (text.length <= maxLimit) {
    return text;
  }

  // If text > maxLimit (1,000 characters), truncate cleanly at a natural musical/sentence boundary.
  const sliced = text.slice(0, maxLimit);

  // 1. Try to find the last sentence end (. ! ?) within the valid range (>= 700 chars)
  const lastSentenceMatch = sliced.match(/^([\s\S]{700,999}[.!?])(?:\s|$)/);
  if (lastSentenceMatch && lastSentenceMatch[1]) {
    return lastSentenceMatch[1].trim();
  }

  // 2. Try to find the last comma, semicolon, or dash (>= 700 chars)
  const lastClauseMatch = sliced.match(/^([\s\S]{700,999})[,;—–-](?:\s|$)/);
  if (lastClauseMatch && lastClauseMatch[1]) {
    return lastClauseMatch[1].trim().replace(/[,;—–-]+$/, '');
  }

  // 3. Try to find the last word boundary before maxLimit
  const lastWordMatch = sliced.match(/^([\s\S]{700,995})\b/);
  if (lastWordMatch && lastWordMatch[1]) {
    return lastWordMatch[1].trim().replace(/[,;—–-]+$/, '');
  }

  // Fallback: slice strictly at maxLimit and trim any trailing punctuation
  return sliced.replace(/[,;—–-]+$/, '').trim();
}

/**
 * Sanitizes the final Style Prompt to ensure it looks like a clean musical prompt
 * without any meta-copyright text, Content ID mentions, or artist imitation references,
 * and ensures strict compliance with the 1,000 character maximum limit (Failure Prevention).
 */
export function sanitizePromptOriginality(prompt: string): string {
  let cleaned = prompt;
  // Clean meta-copyright terms
  cleaned = cleaned.replace(/\b100%\s+copyright\s+free\b/gi, '');
  cleaned = cleaned.replace(/\bguaranteed\s+(?:copyright\s+free|no\s+content\s+id|original)\b/gi, '');
  cleaned = cleaned.replace(/\b(?:anti[- ]copyright|content[- ]id|copyright[- ](?:free|protected|protection|safe|safety)|similarity[- ]detection|originality[- ]algorithm|ai[- ]safety|internal[- ]validation)\b/gi, '');
  // Clean imitation phrasing if any
  cleaned = cleaned.replace(/\b(?:in\s+the\s+style\s+of|reminiscent\s+of|sounds?\s+like|inspired\s+by)\s+[A-Za-z0-9\s,'"-]+\b/gi, '');
  // Clean leftover commas or spaces
  cleaned = cleaned.replace(/\s*,\s*,\s*/g, ', ').replace(/\s{2,}/g, ' ').replace(/^,\s*|,\s*$/g, '').trim();

  // Enforce 1,000 character maximum limit (Failure Prevention)
  cleaned = enforceStylePromptCharacterLimit(cleaned, 1000);

  return cleaned;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedData?: Omit<GeneratedTrackResult, 'id' | 'batchNumber' | 'modelUsed' | 'gatewayModelId' | 'timestamp' | 'attemptsCount'>;
}

const MUSICAL_KEYS = [
  'C Major', 'C Minor', 'C# Major', 'C# Minor', 'Db Major', 'Db Minor',
  'D Major', 'D Minor', 'D# Major', 'D# Minor', 'Eb Major', 'Eb Minor',
  'E Major', 'E Minor', 'F Major', 'F Minor', 'F# Major', 'F# Minor',
  'Gb Major', 'Gb Minor', 'G Major', 'G Minor', 'G# Major', 'G# Minor',
  'Ab Major', 'Ab Minor', 'A Major', 'A Minor', 'A# Major', 'A# Minor',
  'Bb Major', 'Bb Minor', 'B Major', 'B Minor',
  // Allow simple tonality notation like D Dorian, A Aeolian, etc.
  'C', 'D', 'E', 'F', 'G', 'A', 'B'
];

/**
 * Validates parsed model JSON against schema and Suno Style rules.
 */
export function validateOutput(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { isValid: false, error: 'Output is not a valid JSON object' };
  }

  const obj = data as Record<string, unknown>;

  // 1. stylePrompt validation
  if (typeof obj.stylePrompt !== 'string' || !obj.stylePrompt.trim()) {
    return { isValid: false, error: 'Field "stylePrompt" is missing or empty' };
  }
  const stylePrompt = sanitizePromptOriginality(obj.stylePrompt.trim());

  // Strict absolute maximum 1.000 characters
  if (stylePrompt.length > 1000) {
    return {
      isValid: false,
      error: `Field "stylePrompt" melebihi batas maksimal 1.000 karakter (${stylePrompt.length} karakter). Target: 750–900 karakter.`
    };
  }

  // Check forbidden terms in stylePrompt
  const lowerPrompt = stylePrompt.toLowerCase();
  for (const forbidden of FORBIDDEN_TERMS) {
    if (lowerPrompt.includes(forbidden.toLowerCase())) {
      return {
        isValid: false,
        error: `Forbidden term detected in stylePrompt: "${forbidden}". Suno style prompts must not contain classical legacy terms.`
      };
    }
  }

  // Check forbidden vocal / lyrics references
  if (/\b(lyrics|vocalist|lead vocals|singing|song structure|verse 1|chorus)\b/i.test(lowerPrompt)) {
    return {
      isValid: false,
      error: 'Instrumental violation: stylePrompt mentions vocals or song lyrics structure'
    };
  }

  // Check prompt consistency: avoid epic, trailer, or busy dramatic characteristics
  for (const inc of INCONSISTENT_HIGH_INTENSITY_TERMS) {
    if (lowerPrompt.includes(inc.toLowerCase())) {
      return {
        isValid: false,
        error: `Prompt consistency violation: stylePrompt contains high-intensity term "${inc}". Instrumental piano must remain low-intensity, sparse, slow, and calm.`
      };
    }
  }

  // 2. bpm validation (integer 40 - 120)
  const bpmNum = Number(obj.bpm);
  if (!Number.isFinite(bpmNum) || bpmNum < 40 || bpmNum > 120) {
    return { isValid: false, error: `Field "bpm" must be an integer between 40 and 120 (got ${obj.bpm})` };
  }
  const bpm = Math.round(bpmNum);

  // 3. key validation (valid musical key string)
  if (typeof obj.key !== 'string' || !obj.key.trim()) {
    return { isValid: false, error: 'Field "key" is missing or invalid' };
  }
  const key = obj.key.trim();
  const keyMatched = MUSICAL_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()));
  if (!keyMatched && key.length > 20) {
    return { isValid: false, error: `Invalid musical key format: "${key}"` };
  }

  // 4. instruments validation (array and not empty)
  if (!Array.isArray(obj.instruments) || obj.instruments.length === 0) {
    return { isValid: false, error: 'Field "instruments" must be a non-empty array of instrument strings' };
  }
  const instruments = obj.instruments
    .map(i => String(i).trim())
    .filter(Boolean);
  if (instruments.length === 0) {
    return { isValid: false, error: 'Field "instruments" must contain at least one instrument' };
  }

  // 5. metadata validation (object)
  if (!obj.metadata || typeof obj.metadata !== 'object' || Array.isArray(obj.metadata)) {
    return { isValid: false, error: 'Field "metadata" must be an object' };
  }
  const metaObj = obj.metadata as Record<string, unknown>;
  const metadata: MusicalMetadata = {
    pianoType: String(metaObj.pianoType || 'Piano').trim(),
    category: String(metaObj.category || 'Instrumental').trim(),
    genre: String(metaObj.genre || 'Ambient Piano').trim(),
    mood: String(metaObj.mood || 'Calm').trim(),
    country: String(metaObj.country || 'International').trim(),
  };

  // 6. styleIntensity validation
  // Wajib: ambient, minimalist, meditative, sleepFriendly, emotional, cinematic, musicalActivity (0 - 100)
  if (!obj.styleIntensity || typeof obj.styleIntensity !== 'object' || Array.isArray(obj.styleIntensity)) {
    return { isValid: false, error: 'Field "styleIntensity" must be an object' };
  }
  const intensityObj = obj.styleIntensity as Record<string, unknown>;
  const intensityKeys: (keyof StyleIntensity)[] = [
    'ambient',
    'minimalist',
    'meditative',
    'sleepFriendly',
    'emotional',
    'cinematic',
    'musicalActivity'
  ];

  const styleIntensity: Partial<StyleIntensity> = {};

  for (const k of intensityKeys) {
    const val = Number(intensityObj[k]);
    if (!Number.isFinite(val) || val < 0 || val > 100) {
      return {
        isValid: false,
        error: `Field "styleIntensity.${k}" must be a number between 0 and 100 (got ${intensityObj[k]})`
      };
    }
    styleIntensity[k] = Math.round(val);
  }

  // Enforce LOW constraints on Emotional (0-30%), Cinematic (0-20%), and Musical Activity (0-25%)
  if (styleIntensity.emotional !== undefined && styleIntensity.emotional > 30) {
    styleIntensity.emotional = Math.min(30, Math.max(0, Math.round((styleIntensity.emotional / 100) * 30)));
  }
  if (styleIntensity.cinematic !== undefined && styleIntensity.cinematic > 20) {
    styleIntensity.cinematic = Math.min(20, Math.max(0, Math.round((styleIntensity.cinematic / 100) * 20)));
  }
  if (styleIntensity.musicalActivity !== undefined && styleIntensity.musicalActivity > 25) {
    styleIntensity.musicalActivity = Math.min(25, Math.max(0, Math.round((styleIntensity.musicalActivity / 100) * 25)));
  }

  return {
    isValid: true,
    sanitizedData: {
      stylePrompt,
      bpm,
      key,
      instruments,
      metadata,
      styleIntensity: styleIntensity as StyleIntensity,
    }
  };
}
