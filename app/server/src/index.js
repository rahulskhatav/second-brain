import { app } from './app.js';
import { hasGemini } from './gemini.js';

const PORT = Number(process.env.PORT ?? 8787);

app.listen(PORT, () => {
  console.log(`Second Brain server on http://localhost:${PORT}`);
  console.log(
    hasGemini() ? '  reader: Gemini' : '  reader: fallback (no GEMINI_API_KEY set — summaries are extractive)'
  );
});
