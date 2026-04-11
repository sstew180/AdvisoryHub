const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function embed(text) {
  const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text.slice(0, 8000) });
  return r.data[0].embedding;
}
module.exports = { embed };
