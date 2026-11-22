import {
  GatewayModelId,
  RoutingMode,
  SafeDebugInfo,
  ErrorType
} from '../types';
import { AUTO_FALLBACK_CHAIN, getModelUIName } from '../config/models';
import { ApiKeyManager } from './apiKeyManager';
import { parseKieResponse, mapHttpStatusToErrorType, ParsedKieResponse } from './kieClient';
import { parseModelJSON, INVALID_JSON } from './jsonParser';
import { sanitizeSafeBody } from './kieConnectionTester';
import { sanitizeConsumerFacingDescription, containsForbiddenSeoContent } from './youtubeSeoValidator';

export interface SeoFromTitleResult {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
}

export interface CreateSeoFromTitleSavedResult {
  inputTitle: string;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  timestamp?: number;
}

export const CREATE_SEO_FROM_TITLE_STORAGE_KEY = 'peta_piano_create_seo_from_title_result';
const CREATE_SEO_INTRO_HISTORY_KEY = 'peta_piano_create_seo_intro_history_v1';
const MAX_CREATE_SEO_INTRO_HISTORY = 20;

/** Extracts the opening hook only; the rest of the SEO workflow is deliberately untouched. */
function extractSeoIntro(description: string): string {
  const clean = String(description || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  return sentences.slice(0, 2).join(' ').trim().split(' ').slice(0, 55).join(' ');
}

function getRecentSeoIntros(): string[] {
  try {
    const raw = localStorage.getItem(CREATE_SEO_INTRO_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(-MAX_CREATE_SEO_INTRO_HISTORY) : [];
  } catch { return []; }
}

function saveSeoIntroToHistory(description: string): void {
  const intro = extractSeoIntro(description);
  if (!intro) return;
  const history = getRecentSeoIntros();
  const next = [...history, intro].slice(-MAX_CREATE_SEO_INTRO_HISTORY);
  try { localStorage.setItem(CREATE_SEO_INTRO_HISTORY_KEY, JSON.stringify(next)); } catch (err) {
    console.warn('Could not persist Create SEO intro history:', err);
  }
}

function introSimilarity(a: string, b: string): number {
  const stop = new Set(['this','that','with','from','into','your','you','the','and','for','are','is','a','an','of','to','in','on','as','at','by','it','its','be','can','will','let','when','where','while','whether','or','whether']);
  const tokens = (value: string) => new Set(((value.toLowerCase().match(/[a-z0-9]+/g) || []) as string[]).filter(w => w.length > 2 && !stop.has(w)));
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  aa.forEach(w => { if (bb.has(w)) intersection++; });
  return intersection / new Set([...aa, ...bb]).size;
}

function findRepeatedIntro(description: string, previousIntros: string[]): boolean {
  const intro = extractSeoIntro(description);
  return previousIntros.some(previous => introSimilarity(intro, previous) >= 0.48);
}

export function getStoredSeoFromTitle(): CreateSeoFromTitleSavedResult | null {
  try {
    const raw = localStorage.getItem(CREATE_SEO_FROM_TITLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.title === 'string' &&
      typeof parsed.description === 'string' &&
      Array.isArray(parsed.hashtags) &&
      Array.isArray(parsed.tags)
    ) {
      return {
        inputTitle: typeof parsed.inputTitle === 'string' ? parsed.inputTitle : '',
        title: parsed.title,
        description: parsed.description,
        hashtags: parsed.hashtags,
        tags: parsed.tags,
        timestamp: parsed.timestamp || Date.now()
      };
    }
  } catch (err) {
    console.error('Failed to load stored CreateSeoFromTitle result:', err);
  }
  return null;
}

export function saveStoredSeoFromTitle(result: CreateSeoFromTitleSavedResult): void {
  try {
    localStorage.setItem(CREATE_SEO_FROM_TITLE_STORAGE_KEY, JSON.stringify(result));
  } catch (err) {
    console.error('Failed to save CreateSeoFromTitle result:', err);
  }
}

export interface SeoFromTitleSuccessResponse {
  success: true;
  data: SeoFromTitleResult;
  modelUsed: string;
  gatewayModelId: GatewayModelId;
  errorMessage?: undefined;
  debugInfo?: SafeDebugInfo;
}

export interface SeoFromTitleErrorResponse {
  success: false;
  errorType: ErrorType;
  errorMessage: string;
  debugInfo: SafeDebugInfo;
}

export type SeoFromTitleResponse = SeoFromTitleSuccessResponse | SeoFromTitleErrorResponse;

/**
 * Builds the focused prompt for AI Title Optimization and UNIQUE, Title-Specific SEO generation.
 * Generates an optimized final title, then writes a 100% bespoke SEO Description tailored
 * specifically to that final title without any generic reusable templates or mentions of "PETA PIANO".
 */
export function buildSeoFromTitlePrompt(userTitle: string, previousIntros: string[] = []): string {
  const recentIntroBlock = previousIntros.length
    ? previousIntros.slice(-8).map((intro, index) => `${index + 1}. ${intro}`).join('\n')
    : '(No previous intro samples are available.)';
  return `
You are a professional YouTube Content & SEO Specialist for music soundscapes, deep relaxation, sleep, meditation, study, and ambient listening.
The user has provided an original YouTube video title as source/reference.

==================================================
STEP 1: AI TITLE OPTIMIZATION
==================================================
Analyze the user-entered title and generate an improved, attractive, and SEO-optimized YouTube title.
ORIGINAL TITLE: "${userTitle.trim()}"

Rules for the Final Title:
- Actively evaluate how it can be enhanced. Do NOT simply copy the original title by default.
- Refine, rewrite, or change wording/structure to maximize click-through appeal and search discovery.
- It MAY be substantially different when beneficial for viewer appeal and SEO.
- Add relevant emoticons (e.g. 🎹, 🌙, ✨, 🌿, 🎧, 🌧️, ☕, 🕊️) when they enhance viewer interest.
- Do NOT overuse emoticons; use only relevant ones matching the title's mood.
- Preserve the core musical/thematic intent (e.g. sleep, deep relaxation, meditation, studying, healing, rainy ambience, cafe vibe).
- Never add BPM, keys, technical metadata, track counts, AI process notes, or medical claims.

==================================================
STEP 2: UNIQUE, TITLE-SPECIFIC SEO DESCRIPTION
==================================================
Write a concise, engaging, 100% TITLE-SPECIFIC YouTube description based on the FINAL OPTIMIZED TITLE. The description must contain no more than 500 words.

CRITICAL MANDATES:

1. ABSOLUTELY NO “PETA PIANO” OR SYSTEM NAMES:
   The generated SEO Description MUST NOT mention:
   - PETA PIANO
   - PETA PIANO AI
   - PETA PIANO AI project
   - The name of the application or system
   - Internal system names, system prompts, or model names
   - Style Prompt #1–#50
   - AI generation process or internal workflows
   The description must read 100% as a standalone, authentic YouTube description for the actual music/content represented by the FINAL TITLE.

2. TITLE-SPECIFIC WRITING (NO REUSABLE TEMPLATES):
   Do NOT generate a generic reusable description template.
   Do NOT repeat the same paragraph structure, wording, opening sentence, closing sentence, or keyword sequence across different titles.
   Every different title must produce a genuinely different description reflecting the specific subject, mood, use case, atmosphere, and keywords in that title.

   Deeply analyze your FINAL OPTIMIZED TITLE before writing. Extract and prioritize:
   - Main subject (e.g., gentle acoustic piano, felt piano, nighttime soundscape)
   - Specific mood & atmosphere (e.g., quiet serenity, introspective calm, deep rest, focused clarity, cozy rainy day)
   - Listening purpose & activity (e.g., bedtime preparation, deep sleep, mindfulness meditation, reading, study concentration, quiet work, evening unwinding)
   - Environmental / sound elements (e.g., gentle rain, bamboo water sound, soft breeze, nocturnal nature). ONLY include environmental elements that are supported by the final title!
   - Time-of-day context (e.g., late night, midnight, rainy afternoon, early morning).
   - The distinctive scene or listening situation implied by this title; do not invent sounds, instruments, places, or events that the title does not support.

   DIFFERENT TITLES MUST PRODUCE GENUINELY DIFFERENT DESCRIPTIONS:
   - If the title emphasizes Deep Sleep → focus deeply on nighttime listening, winding down, releasing racing thoughts, sleep hygiene, and restful slumber.
   - If the title emphasizes Meditation → focus deeply on stillness, breath, quiet reflection, and mindful listening.
   - If the title emphasizes Study / Focus → focus on concentration, cognitive flow, reading, studying, and unobtrusive background music.
   - If the title emphasizes Relaxation → focus on calming moments, unwinding, and peaceful listening.
   - If the title mentions Bamboo Water Sound → naturally describe the gentle water ambience and natural soundscape.
   - If the title mentions Rain → naturally describe the soothing rainfall and cozy acoustic atmosphere.
   Do NOT use the same combination of these topics for every title. Only include contexts that are directly relevant to the final title.

3. FORBIDDEN GENERIC OPENINGS & PHRASES (ANTI-REPETITION):
   Never use formulaic generic templates such as:
   - "Welcome to this peaceful music..."
   - "This relaxing piano music is perfect for..."
   - "Whether you are studying, sleeping, meditating..."
   - "Let the gentle melodies help you..."
   - "Immerse yourself in..."
   - "Enjoy this..."
   - "Take a moment..."
   - "Experience..."
   Craft a fresh, creative opening hook tailored specifically to the unique atmosphere and subject of the title.
   Vary sentence structure, paragraph structure, vocabulary, and narrative approach according to the title.
   Choose one clear narrative angle that fits this title (for example: sensory scene-setting, a quiet listening ritual, a specific natural setting, or a focused listening purpose). Do not combine every possible use case into every description.
   Avoid repeating the same SEO claims or describing generic benefits in multiple paragraphs. Each paragraph must add a distinct, title-relevant detail. Do not invent detailed audio elements that are not supported by the title.

4. ANTI-REPETITION SELF-CHECK:
   The following are opening hooks used in recent successful Create SEO results. Treat them as examples of wording and structure that MUST NOT be reused or closely paraphrased:
${recentIntroBlock}
   Create a different opening angle, sentence rhythm, and vocabulary. Do not merely swap synonyms.
   Before returning the description, verify:
   - Is this description substantially based on the current title?
   - Does it contain title-specific information?
   - Does the opening feel different from generic music descriptions?
   - Would this description still make sense if the title were replaced with another title? If it could be reused for an unrelated title with only a few words changed, REWRITE IT.

5. NATURAL SEO OPTIMIZATION:
   - Prioritize primary keywords and natural long-tail phrases from the FINAL OPTIMIZED TITLE.
   - Weave keywords smoothly into natural, evocative prose.
   - Avoid keyword stuffing, keyword dumps, or robotic lists.
   - Zero medical claims (never state music cures depression, heals disease, or treats clinical insomnia).

6. EMOTICONS:
   - Relevant emoticons may be included naturally matching the title theme (e.g. 🎹, 🌙, ✨, 🌿, ☕).
   - Do NOT overuse emoticons; place them organically at section breaks, highlights, or closing notes. Never place an emoticon in every sentence.

7. DESCRIPTION LENGTH:
   - HARD MAXIMUM: 500 words, including all words in the description. Never exceed this limit.
   - Recommended target: 180–350 words; use only as many words as needed to create a complete, specific description.
   - Write 3–5 cohesive paragraphs when appropriate; do not pad the description to reach a minimum length.

==================================================
STEP 3: TITLE-SPECIFIC HASHTAGS (5–15)
==================================================
Generate 5–15 relevant, SEO-optimized hashtags specifically from the FINAL OPTIMIZED TITLE and its actual content.
Do NOT reuse a fixed hashtag set. Prioritize the title's primary keywords and relevant use-case terms.
Format: #KeywordWithNoSpaces

==================================================
STEP 4: TITLE-SPECIFIC YOUTUBE TAGS (15–25)
==================================================
Generate 15–25 SEO-optimized YouTube tags specifically from the FINAL OPTIMIZED TITLE.
Do NOT use a static tag list. Create varied combinations based on exact title concepts, keyword variations, long-tail listener queries, mood, and relevant sound elements.
Format: Comma-separated array of clean tag strings.

==================================================
OUTPUT FORMAT (STRICT JSON ONLY):
==================================================
Return ONLY one valid JSON object. No markdown fences (\`\`\`json), no explanation, no introductory text:
{
  "title": "AI-optimized final title with relevant emoticons if appropriate",
  "description": "A unique, title-specific YouTube description of no more than 500 words, ZERO mention of PETA PIANO",
  "hashtags": ["#Hashtag1", "#Hashtag2"],
  "tags": ["tag 1", "tag 2", "tag 3"]
}
`.trim();
}

/**
 * Validates and sanitizes the model output for Title-Based SEO.
 * Validates the AI-optimized title and ensures description/hashtags/tags comply with all SEO rules.
 * Strictly removes any accidental mentions of "PETA PIANO" or system names.
 */
function validateAndSanitizeSeoFromTitle(
  raw: any,
  userTitle: string
): { success: boolean; data?: SeoFromTitleResult; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Model tidak mengembalikan objek data yang valid.' };
  }

  // 1. AI-Optimized Final Title
  let title = typeof raw.title === 'string' ? raw.title.trim() : '';
  title = title.replace(/^["']|["']$/g, '').trim();

  // If model didn't return a title or returned something too short, fallback to user title
  if (!title || title.length < 3) {
    title = userTitle.trim();
  }

  // Remove any prohibited technical metadata like BPM or key from title
  title = title
    .replace(/\b\d+(?:\.\d+)?\s*BPM\b/gi, '')
    .replace(/\b(?:key|key signature)\s*[:=]?\s*[A-G][#b]?\s*(?:major|minor)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Description
  let description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!description) {
    return { success: false, error: 'SEO Description kosong atau tidak ditemukan.' };
  }

  // STRICT REQUIREMENT: Clean any accidental mentions of "PETA PIANO" or system/prompt names
  description = description
    .replace(/\bPETA\s+PIANO(?:\s+AI)?(?:\s+project)?\b/gi, '')
    .replace(/\bthe\s+PETA\s+PIANO\s+project\b/gi, '')
    .replace(/\bstyle\s+prompts?\s*#?\s*\d+\b/gi, '')
    .replace(/\bprompt\s*#?\s*\d+\b/gi, '')
    .replace(/\bAI\s+generation\s+process\b/gi, '')
    .replace(/\binternal\s+workflow\b/gi, '');

  description = sanitizeConsumerFacingDescription(description);

  if (containsForbiddenSeoContent(description)) {
    return { success: false, error: 'Description mengandung istilah teknis atau katalog terlarang.' };
  }

  // Neutralize medical claims
  const medicalClaims = /\b(cures?|treating|treats)\s+(depression|anxiety|insomnia)\b|\bmedical(ly)?\s+proven\b|\bclinically\s+proven\b/i;
  if (medicalClaims.test(description)) {
    description = description.replace(medicalClaims, 'supports peaceful calm and deep relaxation');
  }

  // Remove any lingering double spaces or blank spaces
  description = description.replace(/[ \t]{2,}/g, ' ').trim();

  let words = description.split(/\s+/).filter(Boolean);

  // Hard maximum for Create SEO From Title: 500 words. Prefer a clean sentence boundary.
  if (words.length > 500) {
    const first500Words = words.slice(0, 500).join(' ');
    const lastSentenceEnd = Math.max(
      first500Words.lastIndexOf('.'),
      first500Words.lastIndexOf('!'),
      first500Words.lastIndexOf('?')
    );
    if (lastSentenceEnd > 100) {
      description = first500Words.slice(0, lastSentenceEnd + 1).trim();
    } else {
      // Guarantee the hard cap even if the model omitted sentence punctuation.
      description = first500Words.trim();
    }
    words = description.split(/\s+/).filter(Boolean);
  }

  // No minimum word count: concise, title-specific writing is preferred to padded repetition.
  if (words.length > 500) {
    return {
      success: false,
      error: `Description melebihi batas 500 kata (${words.length} kata). Silakan buat ulang deskripsi yang lebih ringkas.`
    };
  }

  // 3. Hashtags (5-15) based specifically on the final title
  let rawHashtags = Array.isArray(raw.hashtags) ? raw.hashtags : [];
  let hashtags: string[] = [];
  const seenHashtags = new Set<string>();

  for (const h of rawHashtags) {
    if (typeof h !== 'string') continue;
    let clean = h.trim();
    if (!clean.startsWith('#')) {
      clean = '#' + clean.replace(/\s+/g, '');
    } else {
      clean = '#' + clean.slice(1).replace(/\s+/g, '');
    }
    const lower = clean.toLowerCase();
    if (clean.length > 1 && !seenHashtags.has(lower) && !lower.includes('petapiano')) {
      seenHashtags.add(lower);
      hashtags.push(clean);
    }
  }

  if (hashtags.length < 5) {
    // Generate context-derived fallback hashtags strictly based on the final title
    const titleWords = title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
    for (const w of titleWords) {
      const tag = `#${w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()}`;
      if (!seenHashtags.has(tag.toLowerCase()) && !tag.toLowerCase().includes('petapiano')) {
        seenHashtags.add(tag.toLowerCase());
        hashtags.push(tag);
      }
    }
  }
  hashtags = hashtags.slice(0, 15);

  // 4. YouTube Tags (15-25) based specifically on the final title
  let rawTags = Array.isArray(raw.tags)
    ? raw.tags
    : (typeof raw.tags === 'string' ? raw.tags.split(',') : []);

  let tags: string[] = [];
  const seenTags = new Set<string>();

  for (const t of rawTags) {
    if (typeof t !== 'string') continue;
    const clean = t.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (clean.length >= 2 && !seenTags.has(clean) && !clean.includes('peta piano')) {
      seenTags.add(clean);
      tags.push(clean);
    }
  }

  if (tags.length < 15) {
    // Dynamically derive contextual search phrases from the final title
    const titleClean = title.replace(/[^\w\s]/g, '').trim().toLowerCase();
    const wordsInTitle = titleClean.split(/\s+/).filter(w => w.length > 2);
    const dynamicVariations = [
      titleClean,
      `${titleClean} instrumental`,
      `${titleClean} soundscape`,
      `${titleClean} for deep relaxation`,
      `${titleClean} peaceful background`,
      ...wordsInTitle.map(w => `${w} piano music`),
      ...wordsInTitle.map(w => `peaceful ${w}`)
    ];
    for (const dv of dynamicVariations) {
      if (tags.length < 18 && dv.length > 3 && !seenTags.has(dv) && !dv.includes('peta piano')) {
        seenTags.add(dv);
        tags.push(dv);
      }
    }
  }
  tags = tags.slice(0, 25);

  return {
    success: true,
    data: {
      title, // AI-Optimized final title!
      description,
      hashtags,
      tags
    }
  };
}

/**
 * Generates an optimized title and complete bespoke SEO package based on user-entered YouTube title.
 * Uses the existing centralized AI Chat Model infrastructure.
 */
export async function generateSeoFromTitle(
  enteredTitle: string,
  selectedModelId: GatewayModelId,
  routingMode: RoutingMode,
  onStatusUpdate: (message: string) => void = () => {}
): Promise<SeoFromTitleResponse> {
  const trimmedTitle = enteredTitle.trim();
  if (!trimmedTitle || trimmedTitle.length < 3) {
    return {
      success: false,
      errorType: 'TITLE_INVALID',
      errorMessage: 'Judul YouTube tidak boleh kosong (minimal 3 karakter).',
      debugInfo: {
        selectedModel: getModelUIName(selectedModelId),
        gatewayModelId: selectedModelId,
        errorType: 'TITLE_INVALID',
        errorMessage: 'Judul YouTube tidak valid.',
        time: new Date().toLocaleTimeString()
      }
    };
  }

  const keyManager = ApiKeyManager.getInstance();
  const activeKeys = keyManager.getActiveKeys();
  if (!activeKeys.length) {
    return {
      success: false,
      errorType: 'API_KEY_ERROR',
      errorMessage: 'Tidak ada Kunci KIE Aktif.',
      debugInfo: {
        selectedModel: getModelUIName(selectedModelId),
        gatewayModelId: selectedModelId,
        errorType: 'API_KEY_ERROR',
        errorMessage: 'Tidak ada Kunci KIE Aktif.',
        time: new Date().toLocaleTimeString()
      }
    };
  }

  const models = routingMode === 'AUTO' && selectedModelId.startsWith('gpt-')
    ? Array.from(new Set([selectedModelId, ...AUTO_FALLBACK_CHAIN]))
    : [selectedModelId];
  let key = routingMode === 'MANUAL'
    ? (keyManager.getManualSelectedKey() || activeKeys[0])
    : (keyManager.getNextActiveKey() || activeKeys[0]);

  // Keep a small local history dedicated exclusively to Create SEO. Seed it with the
  // currently saved result so the first update also avoids repeating the last intro.
  const previousIntros = getRecentSeoIntros();
  const lastSaved = getStoredSeoFromTitle();
  if (lastSaved?.description) {
    const lastIntro = extractSeoIntro(lastSaved.description);
    if (lastIntro && !previousIntros.includes(lastIntro)) previousIntros.push(lastIntro);
  }
  const basePrompt = buildSeoFromTitlePrompt(trimmedTitle, previousIntros);
  let currentPrompt = basePrompt;
  let lastFailure: { errorType: ErrorType; errorMessage: string } | null = null;

  for (const modelId of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      onStatusUpdate(`OPTIMIZING TITLE & GENERATING BESPOKE SEO... (${attempt}/3)`);
      try {
        const seoJsonSchema = {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } }
          },
          required: ['title', 'description', 'hashtags', 'tags'],
          additionalProperties: false
        };

        const structuredTextFormat = {
          type: 'json_schema',
          name: 'youtube_seo_from_title',
          strict: true,
          schema: seoJsonSchema
        };

        const basePayload = {
          model: modelId,
          stream: false,
          input: [{ role: 'user', content: [{ type: 'input_text', text: currentPrompt }] }],
          reasoning: { effort: 'high' },
          text: { format: structuredTextFormat }
        };

        let res: Response;
        let parsed: ParsedKieResponse;
        let usedRecoveryRequest = false;

        const sendRequest = async (payload: Record<string, any>) => {
          const response = await fetch('/api/kie/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key.rawKey}`
            },
            body: JSON.stringify(payload)
          });
          const parsedResponse = await parseKieResponse(response);
          return { response, parsedResponse };
        };

        // KIE contract ladder
        const plainPayload = { ...basePayload };
        delete (plainPayload as any).text;
        const noReasoningStructured = { ...basePayload };
        delete (noReasoningStructured as any).reasoning;
        const noReasoningPlain = { ...plainPayload };
        const requestVariants: Record<string, any>[] = [
          basePayload,
          noReasoningStructured,
          noReasoningPlain,
          { ...noReasoningPlain, stream: true }
        ];

        ({ response: res, parsedResponse: parsed } = await sendRequest(requestVariants[0]));

        if ([500, 502, 503, 504].includes(res.status)) {
          usedRecoveryRequest = true;
          for (let variantIndex = 1; variantIndex < requestVariants.length; variantIndex++) {
            await new Promise((resolve) => setTimeout(resolve, 900 * variantIndex));
            ({ response: res, parsedResponse: parsed } = await sendRequest(requestVariants[variantIndex]));
            if (![500, 502, 503, 504].includes(res.status)) break;
          }
        }

        if (!res.ok) {
          const type = mapHttpStatusToErrorType(res.status);
          const message = parsed.assistantText || `KIE HTTP ${res.status}`;
          lastFailure = { errorType: type, errorMessage: message };

          if (res.status === 401 || res.status === 403) {
            keyManager.updateKeyStatus(key.id, 'INVALID', message);
            return {
              success: false,
              errorType: type,
              errorMessage: message,
              debugInfo: {
                selectedModel: getModelUIName(modelId),
                gatewayModelId: modelId,
                endpoint: 'https://api.kie.ai/codex/v1/responses',
                httpStatus: res.status,
                errorType: type,
                errorMessage: message,
                sanitizedResponseBody: sanitizeSafeBody(parsed.rawText || '', key.rawKey),
                time: new Date().toLocaleTimeString(),
                attempt
              }
            };
          }

          if ([429, 500, 502, 503, 504].includes(res.status)) {
            if (attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, usedRecoveryRequest ? 1400 * attempt : 900 * attempt));
              continue;
            }
            if (routingMode === 'AUTO') break;
            continue;
          }

          return {
            success: false,
            errorType: type,
            errorMessage: message,
            debugInfo: {
              selectedModel: getModelUIName(modelId),
              gatewayModelId: modelId,
              endpoint: 'https://api.kie.ai/codex/v1/responses',
              httpStatus: res.status,
              errorType: type,
              errorMessage: message,
              sanitizedResponseBody: sanitizeSafeBody(parsed.rawText || '', key.rawKey),
              time: new Date().toLocaleTimeString(),
              attempt
            }
          };
        }

        if (!parsed.assistantText || !parsed.assistantText.trim()) {
          lastFailure = { errorType: 'MODEL_EMPTY_RESPONSE', errorMessage: 'Model mengembalikan respons kosong.' };
          if (attempt < 3) {
            currentPrompt = `${basePrompt}\n\nFOCUSED RETRY: Respons sebelumnya kosong. Kembalikan HANYA JSON object valid: {"title":"...","description":"...","hashtags":[],"tags":[]}.`;
            continue;
          }
          if (routingMode === 'AUTO') break;
          continue;
        }

        const parsedModel = parseModelJSON(parsed.assistantText);
        if (parsedModel === INVALID_JSON) {
          lastFailure = { errorType: 'INVALID_JSON', errorMessage: 'Model menghasilkan output yang tidak dapat diparse sebagai JSON.' };
          if (attempt < 3) {
            currentPrompt = `${basePrompt}\n\nFOCUSED RETRY (INVALID_JSON): Output sebelumnya bukan JSON valid. Kembalikan HANYA JSON: {"title":"...","description":"...","hashtags":[],"tags":[]}. Tanpa markdown, tanpa teks lain.`;
            continue;
          }
          if (routingMode === 'AUTO') break;
          continue;
        }

        const validation = validateAndSanitizeSeoFromTitle(parsedModel, trimmedTitle);
        if (validation.success && validation.data && findRepeatedIntro(validation.data.description, previousIntros)) {
          lastFailure = { errorType: 'DESCRIPTION_TOO_SHORT', errorMessage: 'Intro deskripsi terlalu mirip dengan intro Create SEO sebelumnya.' };
          if (attempt < 3) {
            currentPrompt = `${basePrompt}\n\nANTI-REPETITION RETRY: Intro yang baru dibuat terlalu mirip dengan intro sebelumnya. Tulis ulang HANYA dengan pendekatan pembuka yang benar-benar berbeda: ubah sudut narasi, ritme kalimat, pilihan detail, dan susunan gagasan. Jangan sekadar mengganti sinonim. Hindari semua contoh intro terdahulu yang tercantum di prompt. Pertahankan relevansi dengan judul saat ini dan batas maksimum 500 kata. Return ONLY valid JSON dengan title, description, hashtags, tags.`;
            continue;
          }
          if (routingMode === 'AUTO') break;
          continue;
        }
        if (validation.success && validation.data) {
          saveSeoIntroToHistory(validation.data.description);
          keyManager.updateKeyStatus(key.id, 'ACTIVE');
          return {
            success: true,
            data: validation.data,
            modelUsed: getModelUIName(modelId),
            gatewayModelId: modelId
          };
        }

        lastFailure = { errorType: 'DESCRIPTION_TOO_SHORT', errorMessage: validation.error || 'Validasi SEO gagal.' };
        if (attempt < 3) {
          currentPrompt = `${basePrompt}\n\nFOCUSED RETRY: ${validation.error}\nBuat judul final yang teroptimasi dan deskripsi SEO yang benar-benar spesifik untuk judul tersebut. Maksimum 500 kata; target 180–350 kata, tanpa minimum kata. Jangan mengulang ide, jangan mengisi deskripsi dengan manfaat generik, dan jangan memakai struktur template. Setiap paragraf harus menambahkan detail berbeda yang relevan dengan judul. Jangan mengarang elemen audio yang tidak didukung judul. DILARANG menyebut 'PETA PIANO' atau nama aplikasi. Return ONLY valid JSON: {"title":"...","description":"...","hashtags":[],"tags":[]}.`;
          continue;
        }
        if (routingMode === 'AUTO') break;
      } catch (err: any) {
        lastFailure = { errorType: 'NETWORK_ERROR', errorMessage: err?.message || 'Koneksi gagal.' };
        if (attempt === 3 && routingMode === 'AUTO') break;
        if (attempt === 3) {
          return {
            success: false,
            errorType: 'NETWORK_ERROR',
            errorMessage: err?.message || 'Koneksi gagal.',
            debugInfo: {
              selectedModel: getModelUIName(modelId),
              gatewayModelId: modelId,
              endpoint: 'https://api.kie.ai/codex/v1/responses',
              errorType: 'NETWORK_ERROR',
              errorMessage: err?.message || 'Koneksi gagal.',
              time: new Date().toLocaleTimeString(),
              attempt
            }
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
    }
  }

  return {
    success: false,
    errorType: lastFailure?.errorType || 'GATEWAY_ERROR',
    errorMessage: lastFailure?.errorMessage || 'KIE Gateway gagal membuat SEO dari judul.',
    debugInfo: {
      selectedModel: getModelUIName(selectedModelId),
      gatewayModelId: selectedModelId,
      endpoint: 'https://api.kie.ai/codex/v1/responses',
      errorType: lastFailure?.errorType || 'GATEWAY_ERROR',
      errorMessage: lastFailure?.errorMessage || 'KIE Gateway gagal membuat SEO dari judul.',
      time: new Date().toLocaleTimeString()
    }
  };
}
