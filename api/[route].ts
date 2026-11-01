// Vercel serverless function: handles every /api/* route in one file.
//   /api/health  /api/check-quota  /api/analyze-image  /api/bazaar-translate  /api/generate-tts
// (Locally, `npm run dev` uses server.ts instead; this file is only used on Vercel.)
// Set GEMINI_API_KEY in Vercel -> Project -> Settings -> Environment Variables.
import { GoogleGenAI, Modality } from "@google/genai";

export const config = { maxDuration: 60 };

const TEXT_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"];
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
// 3 models x 18s stays inside the 60s function limit.
const PER_MODEL_TIMEOUT_MS = 18000;

function getClient(req: any) {
  const header = req.headers?.["x-gemini-api-key"];
  const custom = Array.isArray(header) ? header[0] : header;
  const key = custom || process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  if (!key || key.includes("your_actual") || key.includes("your_key")) {
    throw new Error("key_not_configured: Gemini API key is missing. Add GEMINI_API_KEY in Vercel > Settings > Environment Variables, then redeploy.");
  }
  return new GoogleGenAI({ apiKey: key });
}

function extractJsonFromText(rawText: string): any {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error("Response was not returned as a valid JSON structure.");
  }
}

async function withModels(req: any, fn: (client: GoogleGenAI, model: string) => Promise<any>, models: string[] = TEXT_MODELS) {
  let lastError: any;
  for (const model of models) {
    const client = getClient(req); // throws key_not_configured straight away
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(client, model),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timeout: ${model} took longer than ${PER_MODEL_TIMEOUT_MS / 1000} seconds`)), PER_MODEL_TIMEOUT_MS);
        }),
      ]);
    } catch (err: any) {
      lastError = err;
      const s = (err?.message || JSON.stringify(err) || "").toLowerCase();
      console.error(`Bazaar-Sense API: ${model} failed:`, err?.message || err);
      if (s.includes("api key not valid") || s.includes("403") || s.includes("unauthorized") || s.includes("key_not_configured")) throw err;
      // anything else (429, 503, 404, timeout...) -> try the next model
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError;
}

async function analyzeImage(req: any) {
  const { base64Image } = req.body || {};
  if (!base64Image) { const e: any = new Error("Missing image payload."); e.status = 400; throw e; }
  return withModels(req, async (client, model) => {
    const response = await client.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          { text: `Identify this item from a bazaar in Peshawar. 
                Find typical prices in PKR.
                Provide 2-3 "Verified Shops" in either Namak Mandi, Qissa Khwani, or Khyber Bazaar that sell this authentic item.
                
                IMPORTANT: If the item is NOT a bazaar item (e.g., just a person, a blank wall, or a non-commercial object), set "objectName" to "Item Not Identified" and provide a helpful tip about how to scan bazaar goods instead.
                
                JSON structure:
                {
                  "objectName": "string",
                  "pricePKR": "string",
                  "urdu": { "name": "string", "phonetic": "string" },
                  "pashto": { "name": "string", "phonetic": "string" },
                  "description": "string",
                  "locationTips": "string",
                  "verifiedShops": [
                    { "name": "string", "location": "string", "specialty": "string", "discountCode": "string", "rating": 5 }
                  ]
                }` },
        ],
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned an empty response. Let's try again.");
    const parsed = extractJsonFromText(text);
    const sources: any[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) chunks.forEach((c: any) => { if (c.web?.uri) sources.push({ title: c.web.title || "Web", uri: c.web.uri, type: "web" }); });
    parsed.groundingSources = Array.from(new Map(sources.map((s) => [s.uri, s])).values());
    return parsed;
  });
}

async function translate(req: any) {
  const { text, speaker = "traveler", targetLanguage = "pashto", itemContext = "" } = req.body || {};
  if (!text || typeof text !== "string") { const e: any = new Error("Missing text to translate."); e.status = 400; throw e; }
  return withModels(req, async (client, model) => {
        const isPashto = targetLanguage.toLowerCase().includes("pashto");
        const langName = isPashto ? "Pashto (پښتو, Peshawar dialect)" : "Urdu (اردو)";

        const systemPrompt = speaker === "traveler"
          ? `You are a real-time bazaar translator in Peshawar, KP, Pakistan.
The traveler is speaking in English to a local shopkeeper regarding: "${itemContext || "traditional bazaar merchandise"}".
Traveler said: "${text}".

Translate the traveler's English phrase into authentic, polite, spoken ${langName}.
Rules:
1. SCRIPT CONSTRAINTS: For Pashto, use ONLY real Pashto script (پښتو الفبا) with letters like ښ, ڼ, ړ, څ, ځ, ږ, ۍ, ې, ډ, ټ, ګ. For Urdu, use proper Urdu script. NEVER output Devanagari or Hindi under any condition.
2. CULTURAL TONE: Use respectful terms when addressing the seller (e.g., "وروره / Wrora" or "لالا / Lala" for Pashto; "بھائی / Bhai" or "خان صاحب / Khan Sahib" for Urdu).
3. Provide:
   - "translation": The exact spoken translation in native script.
   - "phonetic": Simple English phonetic pronunciation so the traveler can easily read it aloud.
   - "sellerQuickReplies": 2-3 likely merchant counter-replies in English with native script (e.g. "Original quality, 2,500 PKR final", "I will give you special guest discount").

Output strict JSON:
{
  "translation": "string in native script",
  "phonetic": "string pronunciation guide",
  "sellerQuickReplies": [
    { "text": "English reply text", "native": "Native script text" }
  ]
}`
          : `You are a real-time bazaar translator in Peshawar, KP, Pakistan.
The local shopkeeper is speaking in ${langName} to an English-speaking traveler regarding: "${itemContext || "traditional bazaar merchandise"}".
Merchant said: "${text}".

Translate the merchant's words into clear, friendly English for the traveler.
Rules:
1. Provide:
   - "translation": Accurate, colloquial English translation explaining the merchant's tone, offer, or hospitality.
   - "phonetic": The seller's phrase written phonetically in Latin alphabet.
   - "travelerQuickReplies": 2-3 smart bargaining follow-ups the traveler can say back in English (e.g. "Can you do 20% discount?", "Pack it up, deal!", "Is there guarantee?").

Output strict JSON:
{
  "translation": "string in English",
  "phonetic": "string pronunciation",
  "travelerQuickReplies": [
    { "text": "English reply suggestion", "subtext": "context or discount tip" }
  ]
}`;

    const response = await client.models.generateContent({
      model,
      contents: [{ parts: [{ text: systemPrompt }] }],
    });
    return extractJsonFromText(response.text || "");
  });
}

async function tts(req: any) {
  const { text, targetLanguageContext } = req.body || {};
  if (!text) { const e: any = new Error("Missing text parameter for speech synthesis."); e.status = 400; throw e; }
  return withModels(req, async (client, model) => {
    const languageLabel = targetLanguageContext === "Pashto" ? "Pashto (Peshawar dialect)" : targetLanguageContext;
    const response = await client.models.generateContent({
      model,
      contents: [{ parts: [{ text: `Say this ${languageLabel} word clearly: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) throw new Error("Speech synthesis returned no audio parts.");
    const audio = parts.find((p: any) => p.inlineData?.data)?.inlineData?.data;
    if (!audio) throw new Error("Audio data missing in TTS response.");
    return { audioBase64: audio };
  }, TTS_MODELS);
}

async function checkQuota(req: any) {
  const client = getClient(req);
  try {
    await client.models.get({ model: "gemini-3.8-flash" });
    return { success: true, message: "Healthy", isQuota: false };
  } catch (getErr: any) {
    const m = (getErr?.message || "").toLowerCase();
    if (!m.includes("key_not_configured") && !m.includes("api key not valid")) {
      const list = await client.models.list();
      if (list) return { success: true, message: "Healthy", isQuota: false };
    }
    throw getErr;
  }
}

export default async function handler(req: any, res: any) {
  const route = String(req.query?.route || "").replace(/\/+$/, "");

  if (route === "health") {
    return res.status(200).json({ status: "ok", runtime: "vercel" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    if (route === "analyze-image") return res.status(200).json(await analyzeImage(req));
    if (route === "bazaar-translate") return res.status(200).json(await translate(req));
    if (route === "generate-tts") return res.status(200).json(await tts(req));
    if (route === "check-quota") {
      try {
        return res.status(200).json(await checkQuota(req));
      } catch (err: any) {
        const msg = (err?.message || "").toLowerCase();
        const isConfig = msg.includes("key_not_configured");
        const isQuota = msg.includes("429") || msg.includes("resource_exhausted");
        const isInvalid = msg.includes("api key not valid") || msg.includes("403") || msg.includes("unauthorized");
        const isNetwork = msg.includes("fetch") || msg.includes("load failed");
        let statusMsg = "Connection Error";
        if (isConfig) statusMsg = "Key Required";
        else if (isQuota) statusMsg = "Quota Exceeded";
        else if (isInvalid) statusMsg = "Invalid API Key";
        else if (isNetwork) statusMsg = "Network Blocked";
        return res.status(200).json({ success: false, message: statusMsg, isQuota, isConfig, details: err?.message || "Backend connection error." });
      }
    }
    return res.status(404).json({ error: `Unknown API route: /api/${route}` });
  } catch (err: any) {
    console.error(`Bazaar-Sense API error (${route}):`, err);
    const isConfig = (err?.message || "").toLowerCase().includes("key_not_configured");
    return res.status(err?.status || (isConfig ? 401 : 500)).json({ error: err?.message || "Request failed." });
  }
}
