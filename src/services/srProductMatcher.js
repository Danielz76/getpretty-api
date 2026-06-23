const { SR_PRODUCTS, filterForHomeUse, filterForPregnancy, filterForDarkSkin } = require('../data/srProducts');

function getSafeProductsForUser(quizAnswers) {
  let products = [...SR_PRODUCTS];
  products = filterForHomeUse(products);

  if (quizAnswers.pregnant_or_ttc === 'yes' || quizAnswers.pregnant_or_ttc === 'prefer_not_to_say') {
    products = filterForPregnancy(products);
  }

  if (quizAnswers.fitzpatrick >= 4) {
    products = filterForDarkSkin(products, quizAnswers.fitzpatrick);
  }

  if (quizAnswers.allergies?.includes('fragrances')) {
    products = products.filter(p => !p.fragrance);
  }

  return products;
}

function buildProductContext(products) {
  return products.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    eras: p.eras,
    key_actives: p.key_actives,
    suitable_for: p.suitable_for,
    strengths: p.strengths,
    notes: p.notes,
  }));
}

async function matchSRProducts(eraResult, quizAnswers) {
  const safeProducts = getSafeProductsForUser(quizAnswers);
  const productContext = buildProductContext(safeProducts);

  const eraId = eraResult.era?.id;
  const amSteps = eraResult.routine?.am || [];
  const pmSteps = eraResult.routine?.pm || [];
  const safetyFlags = eraResult.safety_flags || [];

  const systemPrompt = `You are a professional SR Cosmetics product specialist. Match SR Cosmetics products to skincare routine steps based on the user's Skin Era, each step's required category and key ingredients, the user's safety profile, and the Lu Skincare Lab clinical philosophy (barrier-first, inflammation reduction before correction).

CRITICAL RULES:
- Only recommend products from the SR_PRODUCTS list provided. Never invent products.
- If no SR product fits a step well, return null for that step.
- For the One Step Peel: apply the Professional Exfoliation Exception — evaluate by formula context (it is a controlled professional exfoliation serum, NOT a harsh peel).
- If the user is Fitzpatrick 4+, prioritize products with arbutin, tranexamic acid, niacinamide for every step possible.
- Prefer products whose era array includes the user's assigned era.
- For cleanser steps: Herbal Cleansing Mousse is suitable for all eras.
- For SPF steps: Demi Make Up is the SR SPF option (unless pregnancy contraindicated — then note SPF must be sourced externally).
- For pregnancy users: only recommend pregnancy_safe: true products. If no SR match exists for a step, return null and note "source externally."

Return ONLY valid JSON matching the specified structure. No commentary outside the JSON object.`;

  const userMessage = `ASSIGNED ERA: ${eraId}

USER PROFILE:
- Fitzpatrick: ${quizAnswers.fitzpatrick}
- Pregnant/TTC: ${quizAnswers.pregnant_or_ttc}
- Allergies: ${JSON.stringify(quizAnswers.allergies)}
- Concerns: ${JSON.stringify(quizAnswers.concerns)}
- Safety Flags: ${JSON.stringify(safetyFlags.map(f => f.type))}

AM ROUTINE STEPS:
${JSON.stringify(amSteps, null, 2)}

PM ROUTINE STEPS:
${JSON.stringify(pmSteps, null, 2)}

AVAILABLE SR PRODUCTS (safety-filtered for this user):
${JSON.stringify(productContext, null, 2)}

Match ONE SR product to each AM and PM routine step. Return this exact JSON:
{
  "era_id": "${eraId}",
  "am": [
    {
      "step": 1,
      "routine_category": "string",
      "sr_product_id": "string or null",
      "sr_product_name": "string or null",
      "match_reason": "string — 1 sentence",
      "key_actives_matched": ["array"],
      "use_instruction": "string",
      "no_match_note": "string or null"
    }
  ],
  "pm": [
    {
      "step": 1,
      "routine_category": "string",
      "sr_product_id": "string or null",
      "sr_product_name": "string or null",
      "match_reason": "string",
      "key_actives_matched": ["array"],
      "use_instruction": "string",
      "no_match_note": "string or null"
    }
  ],
  "era_hero_product": {
    "sr_product_id": "string",
    "sr_product_name": "string",
    "hero_reason": "string — 1-2 sentences"
  },
  "bundle_note": "string — 1 sentence"
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`SR Product Matcher API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('SR Product Matcher parse error:', e);
    return null;
  }
}

module.exports = { matchSRProducts };
