import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const page = await ai.models.list();
    // In case it's an async iterator:
    if (page && typeof page[Symbol.asyncIterator] === 'function') {
      for await (const m of page) {
        console.log(m.name);
      }
    } else {
      console.log(JSON.stringify(page, null, 2));
    }
  } catch (e) { console.log(e); }
}
run();
