import dotenv from "dotenv";
import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

// Load environment variables from .env / .env.local file
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Initialize the GenAI SDK securely on the server side
function getAIClient(req?: express.Request) {
  const customKey = req?.headers ? (req.headers["x-gemini-api-key"] as string) : undefined;
  const currentKey = customKey || process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  
  if (!currentKey || currentKey === "" || currentKey.includes("your_actual")) {
    throw new Error("key_not_configured: Gemini API key is missing or not configured. Please set GEMINI_API_KEY in your environment or enter it below.");
  }
  return new GoogleGenAI({
    apiKey: currentKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

function extractJsonFromText(rawText: string): any {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Response was not returned as a valid JSON structure.");
  }
}

// Helper for retries with exponential backoff on transient errors and model fallbacks
async function generateWithFallbackAndRetry(
  req: express.Request,
  fn: (client: GoogleGenAI, model: string) => Promise<any>
): Promise<any> {
  // Priority order: 3.1 Flash Lite (high quota, ultra-fast), 2.5 Flash, then 3.8 Flash
  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-3.8-flash'];
  let lastError: any;

  for (const model of models) {
    let client: GoogleGenAI;
    try {
      client = getAIClient(req);
    } catch (keyErr) {
      throw keyErr;
    }

    try {
      console.log(`Bazaar-Sense Server: Model ${model} starting...`);
      // Wrap each model call in a 16-second timeout so spikes never hang the application
      const callWithTimeout = Promise.race([
        fn(client, model),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout: ${model} took longer than 16 seconds`)), 16000)
        )
      ]);
      return await callWithTimeout;
    } catch (err: any) {
      lastError = err;
      const errStr = (err?.message || JSON.stringify(err) || "").toLowerCase();
      console.error(`Bazaar-Sense Server: Model ${model} failed:`, err?.message || err);

      // If it's a key configuration or authentication error, do not retry
      const isAuthError = errStr.includes('api key not valid') || errStr.includes('403') || errStr.includes('unauthorized') || errStr.includes('key_not_configured');
      if (isAuthError) {
        throw err;
      }

      // If it's a quota limit (429) or high demand spike (503) or timeout, fail over immediately to next model
      const isFailoverTrigger = 
        errStr.includes('429') || 
        errStr.includes('resource_exhausted') || 
        errStr.includes('quota exceeded') ||
        errStr.includes('503') ||
        errStr.includes('high demand') ||
        errStr.includes('unavailable') ||
        errStr.includes('timeout');

      if (isFailoverTrigger) {
        console.warn(`Bazaar-Sense Server: ${model} failed (${err?.message || 'demand/quota'}). Immediately failing over...`);
        continue;
      }

      // Brief delay for transient errors
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();

  // Parse JSON bodies up to 15MB to easily accommodate image uploads
  app.use(express.json({ limit: "15mb" }));

  // API: Check Quota / Key Health
  app.post("/api/check-quota", async (req, res) => {
    try {
      const client = getAIClient(req);
      // Validate the key with a lightweight metadata call that does not consume generation quota
      try {
        await client.models.get({ model: "gemini-3.8-flash" });
        return res.json({ success: true, message: "Healthy", isQuota: false });
      } catch (getErr: any) {
        const getErrMsg = (getErr?.message || "").toLowerCase();
        // If models.get threw a quota or not-found, try models.list
        if (!getErrMsg.includes('key_not_configured') && !getErrMsg.includes('api key not valid')) {
          const list = await client.models.list();
          if (list) {
            return res.json({ success: true, message: "Healthy", isQuota: false });
          }
        }
        throw getErr;
      }
    } catch (err: any) {
      const msg = (err?.message || "").toLowerCase();
      const isConfig = msg.includes('key_not_configured');
      const isQuota = msg.includes('429') || msg.includes('resource_exhausted');
      const isInvalidKey = msg.includes('api key not valid') || msg.includes('403') || msg.includes('unauthorized');
      const isNetwork = msg.includes('fetch') || msg.includes('load failed');

      let statusMsg = "Connection Error";
      if (isConfig) statusMsg = "Key Required";
      else if (isQuota) statusMsg = "Quota Exceeded";
      else if (isInvalidKey) statusMsg = "Invalid API Key";
      else if (isNetwork) statusMsg = "Network Blocked";

      res.json({ 
        success: false, 
        message: statusMsg, 
        isQuota,
        isConfig,
        details: err?.message || "An error occurred during backend connection."
      });
    }
  });

  // API: Analyze Image
  app.post("/api/analyze-image", async (req, res) => {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image payload." });
    }

    try {
      const result = await generateWithFallbackAndRetry(req, async (client, model) => {
        const response = await client.models.generateContent({
          model: model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Image,
                },
              },
              {
                text: `Identify this item from a bazaar in Peshawar. 
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
                }`,
              },
            ],
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini returned an empty response. Let's try again.");
        }

        const parsedResult = extractJsonFromText(text);

        // Process ground sources if available
        const sources: any[] = [];
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
          chunks.forEach((chunk: any) => {
            if (chunk.web?.uri) {
              sources.push({ 
                title: chunk.web.title || "Web", 
                uri: chunk.web.uri, 
                type: 'web' 
              });
            }
          });
        }
        parsedResult.groundingSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
        return parsedResult;
      });

      res.json(result);
    } catch (err: any) {
      console.error("Server API Error (Analyze Image):", err);
      const isConfig = (err?.message || "").toLowerCase().includes("key_not_configured");
      res.status(isConfig ? 401 : 500).json({ 
        error: err?.message || "Failed to analyze bazaar image." 
      });
    }
  });

  // API: Bazaar Voice Bridge Translate
  app.post("/api/bazaar-translate", async (req, res) => {
    const { text, speaker = "traveler", targetLanguage = "pashto", itemContext = "" } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text to translate." });
    }

    try {
      const result = await generateWithFallbackAndRetry(req, async (client, model) => {
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
          model: model,
          contents: [{ parts: [{ text: systemPrompt }] }],
        });

        const raw = response.text || "";
        return extractJsonFromText(raw);
      });

      res.json(result);
    } catch (err: any) {
      console.error("Server API Error (Bazaar Translate):", err);
      res.status(500).json({ error: err?.message || "Failed to translate speech." });
    }
  });

  // API: Generate TTS
  app.post("/api/generate-tts", async (req, res) => {
    const { text, targetLanguageContext } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text parameter for speech synthesis." });
    }

    try {
      const result = await generateWithFallbackAndRetry(req, async (client, model) => {
        const languageLabel = targetLanguageContext === "Pashto" ? "Pashto (Peshawar dialect)" : targetLanguageContext;
        const prompt = `Say this ${languageLabel} word clearly: ${text}`;

        // Attempt TTS-specific model or fallback gracefully
        const ttsModel = model === 'gemini-2.5-flash' ? 'gemini-2.5-flash' : 'gemini-3.8-flash-lite-tts';

        const response = await client.models.generateContent({
          model: ttsModel,
          contents: [{ 
            parts: [{ text: prompt }] 
          }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        });

        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) throw new Error("Speech synthesis returned no results.");

        const candidate = candidates[0];
        const parts = candidate.content?.parts;
        if (!parts || parts.length === 0) throw new Error("Speech synthesis returned no audio parts.");

        let base64Data: string | undefined;
        for (const part of parts) {
          if (part.inlineData?.data) {
            base64Data = part.inlineData.data;
            break;
          }
        }
        
        if (!base64Data) throw new Error("Audio data missing in TTS response.");
        return { audioBase64: base64Data };
      });

      res.json(result);
    } catch (err: any) {
      console.error("Server API Error (Generate TTS):", err);
      res.status(500).json({ error: err?.message || "Failed to generate voice pronunciation." });
    }
  });

  // Cloud Run / container health check endpoint
  app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "ok", port: PORT });
  });

  // Serve static assets or mount Vite dev middleware
  const distPath = path.join(process.cwd(), 'dist');
  const indexHtmlPath = path.join(distPath, 'index.html');

  if (process.env.NODE_ENV === "production" && fs.existsSync(indexHtmlPath)) {
    console.log("Serving static production assets from:", distPath);
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(indexHtmlPath);
    });
  } else {
    console.log("Starting server with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Create HTTP server and mount Live API WebSocketServer
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws/live" });

  wss.on("connection", async (clientWs, req) => {
    console.log("Bazaar-Sense: Client connected to Live WebSocket voice bridge");
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const targetLanguage = url.searchParams.get("lang") || "pashto";
    const itemContext = url.searchParams.get("item") || "";

    const isPashto = targetLanguage.toLowerCase().includes("pashto");
    const langName = isPashto ? "Pashto (پښتو)" : "Urdu (اردو)";

    const systemPrompt = isPashto
      ? `You are an expert bilingual voice translation bridge at a traditional Peshawar bazaar in Khyber Pakhtunkhwa, Pakistan.
The two speakers are:
1. Traveler (speaking English)
2. Seller (speaking native Pashto / پښتو)
Bazaar merchandise being discussed: ${itemContext || "traditional handcrafted goods"}.

Your task:
- When Traveler speaks in English: translate their words immediately into authentic spoken Pashto (پښتو) and speak the translation aloud in natural Pashto with respectful terms like "Wrora" (brother) or "Lala".
- When Seller speaks in Pashto: translate their words immediately into clear English and speak the translation aloud in English.

STRICT LINGUISTIC RULES:
1. SCRIPT CONSTRAINTS: For all Pashto output and transcription, use ONLY authentic Pashto script (پښتو الفبا) with standard Pashto letters (ښ, ڼ, ړ, څ, ځ, ږ, ۍ, ئ, ې, ډ, ټ, ګ).
2. FORBIDDEN SCRIPTS: Absolutely NEVER output Devanagari or Hindi script.
3. CONVERSATION DISCIPLINE: Speak ONLY the direct translation with natural spoken cadence.`
      : `You are an expert bilingual voice translation bridge at a traditional Peshawar bazaar in Khyber Pakhtunkhwa, Pakistan.
The two speakers are:
1. Traveler (speaking English)
2. Seller (speaking native Urdu / اردو)
Bazaar merchandise being discussed: ${itemContext || "traditional handcrafted goods"}.

Your task:
- When Traveler speaks in English: translate their words immediately into authentic spoken Urdu (اردو) and speak the translation aloud.
- When Seller speaks in Urdu: translate their words immediately into clear English and speak the translation aloud in English.

STRICT LINGUISTIC RULES:
1. SCRIPT CONSTRAINTS: Use authentic Urdu Nastaliq/Perso-Arabic script.
2. FORBIDDEN SCRIPTS: Absolutely NEVER output Devanagari or Hindi script.
3. CONVERSATION DISCIPLINE: Speak ONLY the direct translation with natural spoken cadence.`;

    let session: any = null;
    let isClosed = false;

    try {
      const ai = getAIClient();
      session = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemPrompt,
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live session connected for client");
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "ready", message: "Live bridge connected" }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (isClosed || clientWs.readyState !== WebSocket.OPEN) return;

            // 1. Input audio transcription (what user spoke)
            if (message.serverContent?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({
                type: "inputTranscription",
                text: message.serverContent.inputTranscription.text,
              }));
            }

            // 2. Output audio transcription (translation text)
            if (message.serverContent?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({
                type: "outputTranscription",
                text: message.serverContent.outputTranscription.text,
              }));
            }

            // 3. Audio parts (24kHz PCM chunks)
            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({
                  type: "audio",
                  data: part.inlineData.data,
                }));
              }
            }

            // 4. Interrupted
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }

            // 5. Turn Complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
            }
          },
          onerror: (err: any) => {
            console.error("Gemini Live session error:", err?.message || err);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "error", error: err?.message || "Live API error" }));
            }
          },
          onclose: () => {
            console.log("Gemini Live session closed");
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "close" }));
            }
          }
        }
      });

      clientWs.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "audio" && msg.data && session) {
            session.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: "audio/pcm;rate=16000",
              }
            });
          } else if (msg.type === "text" && msg.text && session) {
            session.sendRealtimeInput({
              text: msg.text,
            });
          }
        } catch (err) {
          console.error("Error processing client live input:", err);
        }
      });

      clientWs.on("close", () => {
        isClosed = true;
        if (session) {
          try { session.close(); } catch {}
        }
      });

      clientWs.on("error", (err) => {
        console.warn("Client WS error:", err);
        isClosed = true;
        if (session) {
          try { session.close(); } catch {}
        }
      });

    } catch (err: any) {
      console.error("Failed to initialize server-side Live API session:", err?.message || err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: "error",
          error: err?.message || "Failed to start Gemini Live voice session"
        }));
      }
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Bazaar-Sense server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Critical server boot error:", error);
  process.exit(1);
});
