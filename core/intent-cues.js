// Explicit user requests should survive a change of embedding backend.
export function detectIntentCue(query) {
  const text = query.trim().toLowerCase();
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you)[!. ]*$/.test(text)) return 'greeting';
  if (/^(help|menu|list topics|what (can you do|do you know)|what topics.*|how do i use this)[?!. ]*$/.test(text)) return 'help';
  if (/\b(compare|comparison|versus|vs\.?|difference between|distinguish)\b/.test(text)) return 'comparison';
  if (/\b(formal|formula|equation|derive|proof|prove|theorem|mathematical|math behind)\b/.test(text)) return 'formal';
  if (/\b(example|illustrate|worked|concrete case|demonstrate)\b/.test(text)) return 'example';
  if (/\b(applications?|use cases?|used for|where.*used|practical uses?|why.*useful)\b/.test(text)) return 'application';
  if (/^(what (is|are|does)|define|explain|describe|tell me about|help me understand)\b/.test(text)) return 'definition';
  return null;
}
