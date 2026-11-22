<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/327de911-14e7-40fe-9b3a-9201b6762b2e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## V3 KIE compatibility patch
- Generation remains browser -> same-origin `/api/kie/responses` -> KIE.
- The server-side KIE request now matches the official KIE cURL header set exactly: `Authorization` and `Content-Type`.
- No custom `Accept`, `Cache-Control`, or `User-Agent` headers are sent upstream.
- No automatic duplicate generation/retry was added, preserving the one-request-per-generation rule.
- The UI/visual design is unchanged.

## YouTube Title Generator (Batch Complete)
When a batch reaches exactly 25 successful style prompts, the PETA screen unlocks a **BUAT JUDUL YOUTUBE** panel. The app sends all 25 generated style prompts and their musical metadata to the selected KIE model, asks for one album-level title, and then enforces the fixed suffix:

` + Bamboo Water Sound`

The title is stored in the current batch state, can be copied, and can be regenerated. Title generation does not increment the 25-track counter and is never treated as a track.

## Vercel Production API
The project includes Vercel Serverless Functions under `api/kie/` so production requests use `/api/kie/responses` and `/api/kie/credit` without relying on the Express `server.ts` process. The frontend never sends requests directly to KIE from the browser.


KIE SEO JSON FIX V3: the SEO Responses request now uses strict text.format JSON Schema as the primary response contract, with structured/no-reasoning/plain/streaming fallbacks. This specifically addresses HTTP 200 responses whose model text previously failed JSON parsing.

## Chat model providers update

PETA and CREATE SEO now share a provider-aware chat model selector. OpenAI and Claude choices are loaded from KIE's authenticated model-list endpoints; Gemini choices use the documented KIE chat catalog. The app keeps its existing GPT aliases as compatibility choices.

The same-origin `/api/kie/responses` proxy accepts the app's existing Responses-shaped request and translates it server-side for Claude Messages and Gemini chat endpoints. OpenAI requests continue through the existing KIE Codex Responses endpoint. `/api/kie/models` provides the model catalog used by both selectors.

Provider selector styling: OpenAI / Electric Blue, Gemini / Violet, Claude / Emerald, on the existing Graphite interface.

Only chat model selection and the provider request adapter are changed. Existing batch generation, prompt validation, anti-repetition, tracklist, API key/token manager, SEO generation and PWA configuration are retained.
