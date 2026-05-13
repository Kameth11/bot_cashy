require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels(apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!response.ok) {
    throw new Error(`No pude listar modelos: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return (data.models || [])
    .filter(model => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
    .map(model => model.name.replace(/^models\//, ''));
}

async function testModel(ai, modelName) {
  try {
    const model = ai.getGenerativeModel({
      model: modelName,
      generationConfig: { maxOutputTokens: 16, temperature: 0.1 },
    });
    const result = await model.generateContent('Responde solo: ok');
    return { modelName, ok: true, output: result.response.text().trim().slice(0, 60) };
  } catch (error) {
    return { modelName, ok: false, error: error.message.slice(0, 200) };
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta GEMINI_API_KEY en .env');
  }

  const ai = new GoogleGenerativeAI(apiKey);
  const models = await listModels(apiKey);

  console.log(`Modelos visibles con generateContent: ${models.length}`);
  console.log('');

  const preferred = [
    process.env.GEMINI_MODEL,
    'gemini-2.0-flash-001',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite-001',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest',
  ].filter(Boolean);

  const uniqueCandidates = [...new Set(preferred.filter(name => models.includes(name)))];

  if (uniqueCandidates.length === 0) {
    console.log('No encontré candidatos comunes entre tu config y los modelos visibles.');
    return;
  }

  console.log('Probando modelos candidatos:');
  for (const modelName of uniqueCandidates) {
    const result = await testModel(ai, modelName);
    if (result.ok) {
      console.log(`OK  ${modelName} -> ${result.output}`);
    } else {
      console.log(`ERR ${modelName} -> ${result.error}`);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
