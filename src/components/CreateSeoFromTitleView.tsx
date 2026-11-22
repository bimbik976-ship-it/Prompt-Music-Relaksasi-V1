import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  AlertTriangle,
  FileText,
  KeyRound
} from 'lucide-react';
import { GatewayModelId, RoutingMode } from '../types';
import { MODEL_CONFIG, MODEL_GROUPS } from '../config/models';
import { loadAvailableChatModels } from '../services/modelCatalog';
import {
  generateSeoFromTitle,
  CreateSeoFromTitleSavedResult,
  getStoredSeoFromTitle,
  saveStoredSeoFromTitle
} from '../services/titleSeoGenerator';

interface CreateSeoFromTitleViewProps {
  selectedModelId: GatewayModelId;
  routingMode: RoutingMode;
  hasActiveKey: boolean;
  onSwitchToAPI: () => void;
}

export const CreateSeoFromTitleView: React.FC<CreateSeoFromTitleViewProps> = ({
  selectedModelId,
  routingMode,
  hasActiveKey,
  onSwitchToAPI,
}) => {
  // Create SEO has its own model selection, initialized from the model selected for Style Prompt.
  const [seoModelId, setSeoModelId] = useState<GatewayModelId>(selectedModelId);
  const [availableModels, setAvailableModels] = useState(Object.values(MODEL_CONFIG));
  useEffect(() => { let mounted = true; loadAvailableChatModels().then((models) => { if (mounted) setAvailableModels(models); }); return () => { mounted = false; }; }, []);

  // Persisted state: loads last successful result so it never disappears on tab switch or re-render
  const [savedResult, setSavedResult] = useState<CreateSeoFromTitleSavedResult | null>(() => {
    return getStoredSeoFromTitle();
  });
  const [inputTitle, setInputTitle] = useState<string>(() => {
    const stored = getStoredSeoFromTitle();
    return stored?.inputTitle || '';
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('MENYIAPKAN GENERASI SEO...');
  const [error, setError] = useState<string | null>(null);

  // Copy states
  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedDescription, setCopiedDescription] = useState(false);
  const [copiedHashtags, setCopiedHashtags] = useState(false);
  const [copiedTags, setCopiedTags] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopy = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAll = () => {
    if (!savedResult) return;
    const allText = [
      `TITLE:\n${savedResult.title}`,
      `\nDESCRIPTION:\n${savedResult.description}`,
      `\nHASHTAGS:\n${savedResult.hashtags.join(' ')}`,
      `\nYOUTUBE TAGS:\n${savedResult.tags.join(', ')}`
    ].join('\n\n');
    handleCopy(allText, setCopiedAll);
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating) return; // Prevent double request

    const cleanTitle = inputTitle.trim();
    if (!cleanTitle) {
      setError('Silakan masukkan judul YouTube terlebih dahulu.');
      return;
    }
    if (!hasActiveKey) {
      setError('Kunci KIE Aktif diperlukan untuk melakukan generasi.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setStatusMessage('MENGANALISIS & MENGOPTIMASI JUDUL...');

    try {
      const response = await generateSeoFromTitle(
        cleanTitle,
        seoModelId,
        routingMode,
        (msg) => setStatusMessage(msg)
      );

      if (response.success && response.data) {
        const data = response.data;
        const hasValidTitle = typeof data.title === 'string' && data.title.trim().length >= 3;
        const hasValidDesc = typeof data.description === 'string' && data.description.trim().length >= 50;
        const hasValidHashtags = Array.isArray(data.hashtags) && data.hashtags.length >= 5;
        const hasValidTags = Array.isArray(data.tags) && data.tags.length >= 15;

        if (hasValidTitle && hasValidDesc && hasValidHashtags && hasValidTags) {
          const newSaved: CreateSeoFromTitleSavedResult = {
            inputTitle: cleanTitle,
            title: data.title,
            description: data.description,
            hashtags: data.hashtags,
            tags: data.tags,
            timestamp: Date.now()
          };
          saveStoredSeoFromTitle(newSaved);
          setSavedResult(newSaved);
          setError(null);
        } else {
          // If validation fails, KEEP OLD RESULT and show error
          setError('Validasi hasil baru tidak lengkap. Hasil SEO sebelumnya tetap dipertahankan.');
        }
      } else {
        // If request fails, KEEP OLD RESULT and show error
        setError(response.errorMessage || 'Gagal membuat paket SEO baru. Hasil SEO sebelumnya tetap dipertahankan.');
      }
    } catch (err: any) {
      // If network/runtime fails, KEEP OLD RESULT and show error
      setError(err?.message || 'Terjadi kesalahan sistem saat generasi. Hasil SEO sebelumnya tetap dipertahankan.');
    } finally {
      setIsGenerating(false);
      setStatusMessage('SELESAI');
    }
  };

  const descriptionWordCount = savedResult
    ? savedResult.description.split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div className="space-y-6 pb-24">
      {/* Top Banner & Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#242a3a] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-violet-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-white text-base sm:text-lg tracking-wide uppercase">
              CREATE SEO FROM TITLE
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Analisis & optimasi judul dengan AI (termasuk emoticon), lalu buat SEO Description, Hashtags, dan YouTube Tags berdasarkan judul final yang telah dioptimasi.
            </p>
          </div>
        </div>

        {/* Create SEO model selector: all available chat models grouped by provider */}
        <div className="flex flex-col items-stretch gap-1.5 w-full sm:w-auto sm:min-w-[180px] shrink-0">
          <label htmlFor="create-seo-model" className="text-[10px] text-slate-400 uppercase tracking-wider">CHAT MODEL CREATE SEO</label>
          <select
            id="create-seo-model"
            value={seoModelId}
            onChange={(e) => setSeoModelId(e.target.value as GatewayModelId)}
            disabled={isGenerating}
            className="w-full sm:max-w-[240px] rounded-xl bg-[#1b1429] border border-[#3b465d] px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 shadow-lg"
            aria-label="Pilih model Chat untuk Create SEO"
          >
            {MODEL_GROUPS.map((provider) => <optgroup key={provider} label={provider}>
              {availableModels.filter((model) => model.provider === provider).map((model) => <option key={model.gatewayId} value={model.gatewayId} className="bg-[#241A35] text-white">{model.uiName}</option>)}
            </optgroup>)}
          </select>
        </div>
      </div>

      {/* No Key Warning */}
      {!hasActiveKey && (
        <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-violet-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Tidak ada Kunci KIE Aktif. Silakan aktifkan atau tambahkan kunci API terlebih dahulu.</span>
          </div>
          <button
            onClick={onSwitchToAPI}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-500 text-black text-xs font-bold shrink-0 hover:bg-violet-400 transition"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>BUKA API</span>
          </button>
        </div>
      )}

      {/* Main Card: Input & Generate */}
      <div className="rounded-2xl bg-[#12151e] border border-[#242a3a] p-5 sm:p-6 shadow-2xl space-y-4">
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 tracking-wider uppercase flex items-center justify-between">
              <span className="text-violet-400 font-mono flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                INPUT YOUTUBE TITLE
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                {inputTitle.length} karakter
              </span>
            </label>
            <textarea
              value={inputTitle}
              onChange={(e) => setInputTitle(e.target.value)}
              disabled={isGenerating}
              placeholder="Masukkan judul YouTube di sini (contoh: Relaxing Piano Music with Calming Rain for Deep Sleep, Stress Relief & Meditation)..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-[#171025] border border-[#222838] focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 text-slate-100 text-sm font-medium placeholder:text-slate-600 outline-none transition resize-none disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="text-[11px] text-slate-400">
              * AI Chat Model akan menganalisis & mengoptimasi judul untuk YouTube, menyertakan emoticon relevan, dan membuat paket SEO lengkap berdasarkan judul final tersebut.
            </div>
            <button
              type="submit"
              disabled={isGenerating || !inputTitle.trim() || !hasActiveKey}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-extrabold text-xs uppercase tracking-wider transition ${
                isGenerating
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 cursor-wait animate-pulse'
                  : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-black shadow-lg shadow-amber-500/20 active:scale-[0.98]'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? statusMessage : 'GENERATE SEO'}</span>
            </button>
          </div>
        </form>

        {/* Error message: keeps old result visible below */}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold">Informasi:</span> {error}
            </div>
          </div>
        )}
      </div>

      {/* Generated SEO Output Card: remains visible during loading, tab switch, re-render, and on retry error */}
      {savedResult && (
        <div className="rounded-2xl bg-[#12151e] border border-violet-500/30 p-5 sm:p-6 shadow-2xl space-y-6 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#242a3a] pb-4">
            <div className="flex items-center gap-2.5">
              <div className={`w-2.5 h-2.5 rounded-full ${isGenerating ? 'bg-violet-400 animate-ping' : 'bg-emerald-400'}`} />
              <h3 className="font-extrabold text-white text-base tracking-wide uppercase">
                HASIL OPTIMASI JUDUL & PAKET SEO
              </h3>
              {isGenerating && (
                <span className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-[10px] font-bold text-violet-300 animate-pulse">
                  Memproses judul baru...
                </span>
              )}
            </div>

            <button
              onClick={handleCopyAll}
              className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition border ${
                copiedAll
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-[#1b202c] hover:bg-[#252c3d] text-violet-400 border-violet-500/30 hover:border-violet-500/60'
              }`}
            >
              {copiedAll ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedAll ? 'TERSALIN SEMUA!' : 'COPY ALL SEO'}</span>
            </button>
          </div>

          {/* 1. TITLE (AI-optimized final title) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                <span className="text-red-400 font-mono">TITLE</span>
                <span className="text-[10px] text-slate-400 font-normal ml-2">(Judul final hasil optimasi AI)</span>
              </label>
              <button
                onClick={() => handleCopy(savedResult.title, setCopiedTitle)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  copiedTitle
                    ? 'bg-emerald-600 text-white'
                    : 'bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40'
                }`}
              >
                {copiedTitle ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedTitle ? 'COPIED TITLE' : 'COPY TITLE'}</span>
              </button>
            </div>
            <div className="p-3.5 rounded-xl bg-[#171025] border border-[#222838] text-white font-medium text-sm sm:text-base leading-snug select-all">
              {savedResult.title}
            </div>
          </div>

          {/* 2. SEO DESCRIPTION */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                <span className="text-violet-400 font-mono">SEO DESCRIPTION</span>
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  ({descriptionWordCount} kata • maksimal 500 kata • berdasarkan judul teroptimasi)
                </span>
              </label>
              <button
                onClick={() => handleCopy(savedResult.description, setCopiedDescription)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  copiedDescription
                    ? 'bg-emerald-600 text-white'
                    : 'bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/40'
                }`}
              >
                {copiedDescription ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedDescription ? 'COPIED DESCRIPTION' : 'COPY DESCRIPTION'}</span>
              </button>
            </div>
            <div className="p-4 rounded-xl bg-[#171025] border border-[#222838] text-slate-200 text-xs sm:text-sm leading-relaxed whitespace-pre-line select-all max-h-96 overflow-y-auto pr-2">
              {savedResult.description}
            </div>
          </div>

          {/* 3. HASHTAGS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                <span className="text-sky-400 font-mono">HASHTAGS</span>
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  ({savedResult.hashtags.length} hashtags)
                </span>
              </label>
              <button
                onClick={() => handleCopy(savedResult.hashtags.join(' '), setCopiedHashtags)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  copiedHashtags
                    ? 'bg-emerald-600 text-white'
                    : 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40'
                }`}
              >
                {copiedHashtags ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedHashtags ? 'COPIED HASHTAGS' : 'COPY HASHTAGS'}</span>
              </button>
            </div>
            <div className="p-3.5 rounded-xl bg-[#171025] border border-[#222838] flex flex-wrap gap-2 select-all">
              {savedResult.hashtags.map((h, i) => (
                <span
                  key={`${h}-${i}`}
                  className="px-2.5 py-1 rounded-lg bg-sky-950/40 border border-sky-500/30 text-sky-300 font-mono text-xs font-semibold"
                >
                  {h}
                </span>
              ))}
            </div>
          </div>

          {/* 4. YOUTUBE TAGS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                <span className="text-emerald-400 font-mono">YOUTUBE TAGS</span>
                <span className="text-[10px] text-slate-500 font-normal ml-2">
                  ({savedResult.tags.length} tags • format koma)
                </span>
              </label>
              <button
                onClick={() => handleCopy(savedResult.tags.join(', '), setCopiedTags)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  copiedTags
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {copiedTags ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedTags ? 'COPIED TAGS' : 'COPY TAGS'}</span>
              </button>
            </div>
            <div className="p-3.5 rounded-xl bg-[#171025] border border-[#222838] text-xs font-mono text-slate-300 leading-relaxed select-all">
              {savedResult.tags.join(', ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
