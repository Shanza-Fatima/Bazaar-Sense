// Run with:  npm run check
// Tells you exactly which part of the Gemini setup is broken: key, model names, or image input.
import dotenv from "dotenv";
import { GoogleGenAI, Modality } from "@google/genai";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const TEXT_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"];
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
// A tiny 1x1 PNG, just to prove image input works.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const key = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
if (!key || key.includes("your_")) {
  console.log("\n❌ NO KEY FOUND.");
  console.log("   Create a file named .env.local in this folder (next to server.ts) containing:");
  console.log("   GEMINI_API_KEY=paste_your_key_here");
  console.log("   Get a key at https://aistudio.google.com/apikey\n");
  process.exit(1);
}
console.log(`\n✅ Key found (ends with ...${key.slice(-4)}, ${key.length} characters)`);
if (key.length < 30 || /\s|["']/.test(key)) console.log("⚠️  The key looks wrong (too short, or has spaces/quotes). Re-copy it without quotes.");

const ai = new GoogleGenAI({ apiKey: key });
const short = (e: any) => String(e?.message || e).replace(/\s+/g, " ").slice(0, 160);

async function main() {
  let okText = 0;
  console.log("\nText + image models:");
  for (const model of TEXT_MODELS) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: { parts: [{ inlineData: { mimeType: "image/png", data: TINY_PNG } }, { text: "Reply with the single word OK." }] },
      });
      console.log(`  ✅ ${model}  ->  ${(r.text || "").trim().slice(0, 30)}`);
      okText++;
    } catch (e) {
      console.log(`  ❌ ${model}  ->  ${short(e)}`);
    }
  }

  let okTts = 0;
  console.log("\nSpeech (TTS) models:");
  for (const model of TTS_MODELS) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: "Say hello" }] }],
        config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
      });
      const has = r.candidates?.[0]?.content?.parts?.some((p: any) => p.inlineData?.data);
      console.log(`  ${has ? "✅" : "❌"} ${model}  ->  ${has ? "audio received" : "no audio in reply"}`);
      if (has) okTts++;
    } catch (e) {
      console.log(`  ❌ ${model}  ->  ${short(e)}`);
    }
  }

  console.log("\nSummary:");
  console.log(okText ? "  Photo analysis should work." : "  Photo analysis will FAIL. Read the errors above (invalid key = make a new key; 429 = wait or use another key).");
  console.log(okTts ? "  Pronunciation audio should work." : "  Pronunciation audio will fail (the rest of the app can still work).");
  console.log("");
}
main();
