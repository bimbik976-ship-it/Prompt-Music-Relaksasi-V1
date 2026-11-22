import { MODEL_CONFIG, ChatModelOption, ModelProvider } from '../config/models';
import { ApiKeyManager } from './apiKeyManager';

/**
 * Keep every model bundled with the app available even when the live KIE
 * catalog is partial or only returns the currently enabled OpenAI models.
 * Live catalog entries are merged by gatewayId; known configured entries
 * retain their verified UI labels and provider routing metadata.
 */
export async function loadAvailableChatModels(): Promise<ChatModelOption[]> {
  const configured = Object.values(MODEL_CONFIG);
  const key = ApiKeyManager.getInstance().getActiveKeys()[0]?.rawKey;
  if (!key) return configured;

  try {
    const response = await fetch('/api/kie/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!response.ok) return configured;

    const payload = await response.json();
    if (!Array.isArray(payload?.data)) return configured;

    const merged = new Map<string, ChatModelOption>();
    // Seed the map with all 11 configured models first.
    for (const model of configured) merged.set(model.gatewayId, model);

    // Add genuinely new models from KIE without dropping configured models.
    for (const item of payload.data) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
      const known = MODEL_CONFIG[item.id];
      if (known) {
        // Preserve canonical model name/provider/endpoint metadata from config.
        merged.set(known.gatewayId, known);
        continue;
      }
      const provider = item.provider as ModelProvider;
      if (!['OpenAI', 'Gemini', 'Claude'].includes(provider)) continue;
      merged.set(item.id, {
        gatewayId: item.id,
        uiName: typeof item.name === 'string' && item.name.trim() ? item.name : item.id,
        description: `${provider} model dari katalog aktif KIE.ai.`,
        provider,
        accent: provider === 'OpenAI' ? 'blue' : provider === 'Gemini' ? 'violet' : 'emerald'
      });
    }

    // Keep a predictable provider grouping and stable configured order.
    return [...merged.values()];
  } catch {
    return configured;
  }
}
