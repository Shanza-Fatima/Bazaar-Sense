
import { GoogleGenAI, Type, Modality, Chat, LiveServerMessage, Blob } from "@google/genai";
import { AnalysisResult, GroundingSource } from "../types.ts";

/**
 * Safely retrieves the API Key from the environment.
 * Searches multiple common injection points used by Vercel, Vite, and other bundlers.
 */
const getApiKey = (): string => {
  try {
    // 1. Check window.process.env (Shimmed in index.html)
    if ((window as any).process?.env?.API_KEY) {
      const key = (window as any).process.env.API_KEY;
      if (key && !key.includes("your_actual")) return key;
    }
    
    // 2. Check standard process.env (for bundlers like Webpack/Vite)
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      const key = process.env.API_KEY;
      if (key && !key.includes("your_actual")) return key;
    }
    
    // 3. Check Vite/ESM standard environment variables
    // @ts-ignore - meta is not always defined in all environments
    if (typeof import.meta !== 'undefined' && import.meta.env?.API_KEY) {
      // @ts-ignore
      const key = import.meta.env.API_KEY;
      if (key && !key.includes("your_actual")) return key;
    }

    // 4. Fallback to common global injection points
    if ((window as any).API_KEY && !(window as any).API_KEY.includes("your_actual")) {
      return (window as any).API_KEY;
    }

  } catch (e) {
    console.warn("Bazaar-Sense: Key lookup failed", e);
  }
  return "";
};

/**
 * Helper to handle retries for API calls with specialized handling for 429 Quota Exceeded.
 */
async function withRetry<T>(
  fn: (modelName: string) => Promise<T>, 
  primaryModel: string,
  fallbackModel?: string,
  maxRetries = 3
): Promise<T> {
  let lastError: any;
  let currentModel = primaryModel;

  const apiKey = getApiKey();
  
  if (!apiKey || apiKey === "") {
    throw new Error("MISSING_API_KEY: No API Key found. Ensure 'API_KEY' is set in Vercel Environment Variables and you have REDEPLOYED.");
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn(currentModel);
    } catch (err: any) {
      lastError = err;
      const errStr = typeof err === 'string' ? err : (err?.message || JSON.stringify(err) || "");
      
      console.error(`Bazaar-Sense: Attempt ${i+1} failed for ${currentModel}:`, err);

      const isQuotaError = errStr.includes('429') || 
                          errStr.includes('RESOURCE_EXHAUSTED') ||
                          errStr.toLowerCase().includes('quota') ||
                          errStr.toLowerCase().includes('rate limit');
      
      if (isQuotaError && i < maxRetries - 1) {
        if (fallbackModel && i === 0) {
          console.warn(`Bazaar-Sense: Quota hit for ${currentModel}. Switching to fallback: ${fallbackModel}`);
          currentModel = fallbackModel;
        }
        
        const delay = (i + 1) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If it's a 403, the key is likely wrong
      if (errStr.includes('403') || errStr.toLowerCase().includes('permission')) {
        throw new Error("INVALID_API_KEY: The provided Gemini API Key is invalid or restricted. Check your Google AI Studio credentials.");
      }

      throw err;
    }
  }
  throw lastError;
}

function parseJSONFromResponse(text: string): any {
  const jsonRegex = /\{[\s\S]*\}/;
  const match = text.match(jsonRegex);
  if (!match) {
    throw new Error("The model did not return a valid data structure.");
  }
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error("Failed to interpret the bazaar data.");
  }
}

export const analyzeImage = async (
  base64Image: string, 
  location?: { latitude: number; longitude: number }
): Promise<AnalysisResult> => {
  return withRetry(async (modelName) => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const is25Series = modelName.includes('2.5');
    const tools: any[] = [{ googleSearch: {} }];
    if (is25Series) {
      tools.push({ googleMaps: {} });
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `Identify this item from a local bazaar in Peshawar, Pakistan. Find typical prices in PKR. 
            
            CRITICAL: Return strictly JSON. 
            Do NOT confuse Urdu/Pashto with Hindi script or vocabulary. Use authentic regional naming.
            JSON structure:
            {
              "objectName": "string",
              "pricePKR": "string",
              "urdu": { "name": "string", "phonetic": "string" },
              "pashto": { "name": "string", "phonetic": "string" },
              "description": "string",
              "locationTips": "string"
            }`,
          },
        ],
      },
      config: {
        tools: tools,
        toolConfig: (is25Series && location) ? {
          retrievalConfig: {
            latLng: {
              latitude: location.latitude,
              longitude: location.longitude
            }
          }
        } : undefined,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from expert.");
    const parsedResult = parseJSONFromResponse(text) as AnalysisResult;

    const sources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri) sources.push({ title: chunk.web.title || "Web", uri: chunk.web.uri, type: 'web' });
        else if (chunk.maps?.uri) sources.push({ title: chunk.maps.title || "Maps", uri: chunk.maps.uri, type: 'maps' });
      });
    }
    
    parsedResult.groundingSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
    return parsedResult;
  }, 'gemini-2.5-flash', 'gemini-3-flash-preview');
};

export const generateTTS = async (text: string, targetLanguageContext: string = "Pashto"): Promise<Uint8Array> => {
  return withRetry(async (modelName) => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ 
        parts: [{ text: `Instruction: Speak this clearly and naturally as a native ${targetLanguageContext} speaker from Peshawar. 
        CRITICAL: Use authentic ${targetLanguageContext} phonetics. Absolutely NO Hindi sounds or Devnagari-style script patterns.
        Target text to speak: "${text}"` }] 
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

    const data = response.candidates?.[0]?.content?.parts.find(p => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("Audio generation failed.");
    return decode(data);
  }, 'gemini-2.5-flash-preview-tts');
};

export function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): Blob {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] * 2.0));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
