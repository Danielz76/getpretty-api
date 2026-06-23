async function analyzeShelfAndSubstitute(shelfPhotoBase64Array, srRecommendations, quizAnswers, eraResult) {
  if (!shelfPhotoBase64Array || shelfPhotoBase64Array.length === 0) return null;

  const eraId = eraResult.era?.id;
  const safetyFlags = eraResult.safety_flags || [];

  const imageBlocks = shelfPhotoBase64Array.map(base64 => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
  }));

  const systemPrompt = `You are a professional clinical cosmetologist analyzing photos of a user's current product shelf to:
1. Identify every visible skincare product (brand, product name, category)
2. Assess whether each product is COMPATIBLE or CONFLICTING with the user's assigned Skin Era
3. Create a "use until depleted, then switch to SR" substitution plan

PHILOSOPHY: We never tell users to throw away products they own. Guide them to finish what they have responsibly, while planning the transition to SR Cosmetics.

CRITICAL RULES:
- Only flag products as CONFLICTING if they actively harm the user's era goals or violate safety flags
- Compatible = use until depleted, no rush to replace
- Borderline = use with caution (reduce frequency) until depleted
- Conflicting = pause immediately or use with specific restrictions
- For each conflicting/borderline product, provide the SR substitute from recommendations
- NEVER diagnose or make medical claims. Use gentle, non-judgmental language.

Return ONLY valid JSON. No commentary outside the JSON object.`;

  const userMessage = [
    ...imageBlocks,
    {
      type: 'text',
      text: `USER'S ASSIGNED SKIN ERA: ${eraId}
ERA NAME: ${eraResult.era?.name}

SAFETY FLAGS ACTIVE: ${JSON.stringify(safetyFlags.map(f => ({ type: f.type, avoids: f.ingredients_to_avoid })))}

USER CONCERNS: ${JSON.stringify(quizAnswers.concerns)}
FITZPATRICK: ${quizAnswers.fitzpatrick}
PREGNANT/TTC: ${quizAnswers.pregnant_or_ttc}
ALLERGIES: ${JSON.stringify(quizAnswers.allergies)}

SR RECOMMENDATIONS (for substitution mapping):
${JSON.stringify(srRecommendations, null, 2)}

Analyze all visible products in the photos. Return this exact JSON:
{
  "identified_products": [
    {
      "brand": "string",
      "product_name": "string",
      "category": "cleanser | moisturizer | serum | spf | toner | exfoliant | mask | eye_cream | treatment | other",
      "status": "compatible | borderline | conflicting | unknown",
      "status_reason": "string — 1 sentence, bestie tone",
      "use_until_depleted": true,
      "use_instruction": "string",
      "sr_substitute_id": "string or null",
      "sr_substitute_name": "string or null",
      "substitution_note": "string or null"
    }
  ],
  "shelf_summary": {
    "total_identified": 0,
    "compatible_count": 0,
    "borderline_count": 0,
    "conflicting_count": 0,
    "missing_from_era": ["list of essential missing categories"],
    "overall_note": "string — 2-3 sentences, bestie tone"
  },
  "transition_plan": {
    "immediate_pauses": ["products to pause now"],
    "use_first": ["products to use up before switching to SR"],
    "first_sr_purchase": "string — single most impactful SR product to add NOW"
  }
}`,
    },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Shelf Analyzer API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.content.find(b => b.type === 'text')?.text || '';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('Shelf Analyzer parse error:', e);
    return null;
  }
}

module.exports = { analyzeShelfAndSubstitute };
