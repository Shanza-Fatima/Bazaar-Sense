
import { GoogleGenAI, Type, Modality, Chat, LiveServerMessage, Blob } from "@google/genai";
import { AnalysisResult, GroundingSource } from "../types.ts";

/**
 * Helper to handle retries for API calls with specialized handling for Quota and Network errors.
 */
async function withRetry<T>(
  fn: (ai: GoogleGenAI, modelName: string) => Promise<T>, 
  primaryModel: string,
  fallbackModel?: string,
  maxRetries = 2
): Promise<T> {
  let lastError: any;
  let currentModel = primaryModel;

  const apiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey === "" || apiKey.includes("your_actual")) {
    throw new Error("KEY_NOT_CONFIGURED: The Gemini API key is missing. Check Vercel Environment Variables or the diagnostic console.");
  }

  for (let i = 0; i < maxRetries; i++) {
    const ai = new GoogleGenAI({ apiKey });
    try {
      return await fn(ai, currentModel);
    } catch (err: any) {
      lastError = err;
      const errStr = err?.message || JSON.stringify(err) || "";
      
      console.error(`Bazaar-Sense: Attempt ${i+1} failed [${currentModel}]:`, err);

      // Handle Quota or Rate Limits
      const isQuotaError = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED');
      if (isQuotaError && i < maxRetries - 1) {
        if (fallbackModel && i === 0) {
          currentModel = fallbackModel;
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }

      // Handle generic 500 error (transient proxy issues)
      const isInternalError = errStr.includes('500') || errStr.includes('Rpc failed');
      if (isInternalError && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      
      // Handle Invalid Key (403)
      if (errStr.includes('403')) {
        throw new Error("FORBIDDEN: Your API Key was rejected. Please check it in Google AI Studio.");
      }

      // Handle Model Not Found (404)
      if (errStr.includes('404') || errStr.includes('not found')) {
        if (fallbackModel && i === 0) {
          currentModel = fallbackModel;
          continue;
        }
      }

      throw err;
    }
  }
  throw lastError;
}

function parseJSONFromResponse(text: string): any {
  const jsonRegex = /\{[\s\S]*\}/;
  const match = text.match(jsonRegex);
  if (!match) throw new Error("The expert returned an unreadable format.");
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error("Failed to parse bazaar data.");
  }
}

export const analyzeImage = async (
  base64Image: string, 
  location?: { latitude: number; longitude: number }
): Promise<AnalysisResult> => {
  return withRetry(async (ai, modelName) => {
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
        tools: [{ googleSearch: {} }],
      }
    });

    const text = response.text;
    if (!text) throw new Error("The analysis returned no content.");
    const parsedResult = parseJSONFromResponse(text) as AnalysisResult;

    // Extract grounding sources
    const sources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri) sources.push({ title: chunk.web.title || "Web", uri: chunk.web.uri, type: 'web' });
      });
    }
    
    parsedResult.groundingSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
    return parsedResult;
  }, 'gemini-3-flash-preview', 'gemini-flash-lite-latest');
};

export const generateTTS = async (text: string, targetLanguageContext: string = "Pashto"): Promise<Uint8Array> => {
  return withRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ 
        parts: [{ text: `Say clearly in ${targetLanguageContext} dialect of Peshawar: "${text}"` }] 
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
    if (!data) throw new Error("Speech synthesis failed.");
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
