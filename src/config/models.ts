import { GatewayModelId, ModelConfigItem } from '../types';

export type ModelProvider = 'OpenAI' | 'Gemini' | 'Claude';
export interface ChatModelOption extends ModelConfigItem { provider: ModelProvider; accent: string; }

// Existing GPT identifiers are retained. Gemini and Claude identifiers below are
// taken from KIE model documentation; the server also exposes live model discovery.
export const MODEL_CONFIG: Record<string, ChatModelOption> = {
  'gpt-6-astra': { uiName: 'GPT-6 Astra', gatewayId: 'gpt-6-astra', description: 'Model OpenAI yang sudah digunakan aplikasi.', provider: 'OpenAI', accent: 'blue' },
  'gpt-5-6-luna': { uiName: 'GPT-5.6 Luna', gatewayId: 'gpt-5-6-luna', description: 'Model OpenAI yang sudah digunakan aplikasi.', provider: 'OpenAI', accent: 'blue' },
  'gpt-5-5': { uiName: 'GPT-5.5', gatewayId: 'gpt-5-5', description: 'Model OpenAI yang sudah digunakan aplikasi.', provider: 'OpenAI', accent: 'blue' },
  'gemini-3.1-pro': { uiName: 'Gemini 3.1 Pro', gatewayId: 'gemini-3.1-pro', description: 'Gemini chat melalui endpoint OpenAI-compatible KIE.', provider: 'Gemini', accent: 'violet' },
  'gemini-3-6-flash': { uiName: 'Gemini 3.6 Flash', gatewayId: 'gemini-3-6-flash', description: 'Gemini chat dengan endpoint native KIE.', provider: 'Gemini', accent: 'violet' },
  'gemini-3-8-flash': { uiName: 'Gemini 3.8 Flash', gatewayId: 'gemini-3-8-flash', description: 'Gemini chat dengan endpoint native KIE.', provider: 'Gemini', accent: 'violet' },
  'gemini-4-neon': { uiName: 'Gemini 4 Neon', gatewayId: 'gemini-4-neon', description: 'Gemini chat dengan kemampuan reasoning tingkat lanjut.', provider: 'Gemini', accent: 'violet' },
  'gemini-4-carbon': { uiName: 'Gemini 4 Carbon', gatewayId: 'gemini-4-carbon', description: 'Gemini chat dengan kemampuan reasoning tingkat lanjut.', provider: 'Gemini', accent: 'violet' },
  'claude-sonnet-5-5': { uiName: 'Claude Sonnet 5.5', gatewayId: 'claude-sonnet-5-5', description: 'Claude Messages API melalui KIE.', provider: 'Claude', accent: 'emerald' },
  'claude-opus-5-5': { uiName: 'Claude Opus 5.5', gatewayId: 'claude-opus-5-5', description: 'Claude Messages API melalui KIE.', provider: 'Claude', accent: 'emerald' },
  'claude-fable-5': { uiName: 'Claude Fable 5', gatewayId: 'claude-fable-5', description: 'Claude Messages API melalui KIE.', provider: 'Claude', accent: 'emerald' }
};

export const MODEL_GROUPS: ModelProvider[] = ['OpenAI', 'Gemini', 'Claude'];
export const DEFAULT_MODEL_ID: GatewayModelId = 'gpt-5-5';
export const AUTO_FALLBACK_CHAIN: GatewayModelId[] = ['gpt-5-5', 'gpt-5-6-luna', 'gpt-6-astra'];
export function validateGatewayModelId(id: string): id is GatewayModelId { return Boolean(MODEL_CONFIG[id]); }
export function getModelUIName(id: GatewayModelId): string { return MODEL_CONFIG[id]?.uiName || id; }
export function getModelProvider(id: GatewayModelId): ModelProvider { return MODEL_CONFIG[id]?.provider || 'OpenAI'; }
