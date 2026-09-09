// Small conversational turns should not depend on model downloads or topic scores.
// Normalize only familiar chat words: technical spelling and the displayed message stay intact.
export function normalizeConversationQuery(raw) {
  return String(raw).trim().replace(/[’‘]/g, "'")
    .replace(/\b(?:he+y+|h+i+|he+l{2,}o+|ho+w{2,}|wh+y{2,}|o+k{2,}|oka+y{2,}|hu+h{2,}|ple+a+se+)\b/gi, word => {
      if (/^he+y+$/i.test(word)) return 'hey';
      if (/^h+i+$/i.test(word)) return 'hi';
      if (/^he+l{2,}o+$/i.test(word)) return 'hello';
      if (/^ho+w{2,}$/i.test(word)) return 'how';
      if (/^wh+y{2,}$/i.test(word)) return 'why';
      if (/^o+k{2,}$/i.test(word)) return 'ok';
      if (/^oka+y{2,}$/i.test(word)) return 'okay';
      if (/^hu+h{2,}$/i.test(word)) return 'huh';
      return 'please';
    }).replace(/\s+/g, ' ');
}
function classify(text) {
  if (/^[?¿]+$/.test(text)) return 'clarify';
  const q=text.toLowerCase().replace(/[.!?,;:]+/g,' ').replace(/\s+/g,' ').trim();
  if (/^(?:(?:hey|hi|hello|yo|sup|hiya|howdy|greetings)(?: there)?\s*)+$/.test(q) || /^(?:what'?s up|whats up|what is up|how are (?:you|u)|how(?:'s| is) it going|good (?:morning|afternoon|evening))$/.test(q)) return 'greeting';
  if (/^(?:who are (?:you|u)|what are (?:you|u)|are (?:you|u) (?:a bot|human|real|an ai))$/.test(q)) return 'identity';
  if (/^(?:bye|bye bye|goodbye|see (?:you|ya)(?: later)?|cya|take care)$/.test(q)) return 'farewell';
  if (/^(?:(?:ok|okay|k|sure|yes|yep|yup|alright|cool|nice|great|awesome|got it|gotcha|i see|i get it|understood|makes sense|that makes sense|fair enough|thanks|thank you|thx|ty|cheers)\s*)+$/.test(q) || /^(?:👍|🙏|🙌|👌|😊|🙂)(?:\uFE0F)?$/.test(q)) return /\b(thanks|thank you|thx|ty|cheers)\b/.test(q)?'thanks':'acknowledgement';
  if (/^(?:(?:wait|sorry|um) )?(?:huh|what|wdym|what do (?:you|u) mean|what does that mean|i (?:do not|don't|dont) (?:get it|understand|follow)|i(?:'m| am|m) (?:confused|lost)|idk|i dunno|can (?:you|u) explain (?:that|it)|explain (?:that|it)|say that again|i still (?:don't|dont) get it)$/.test(q)) return 'clarify';
  if (/^(?:how|how so|how does (?:that|it|this) work|how do you mean|show me how)$/.test(q)) return 'how';
  if (/^(?:why|why so|why is that|how come)$/.test(q)) return 'why';
  if (/^(?:(?:can (?:you|u) )?(?:give|show)(?: me)? (?:an? )?)?(?:example|another example|one more example)(?: please)?$/.test(q) || /^(?:like what|for example|for instance)$/.test(q)) return 'example';
  if (/^(?:simplify|simplify (?:it|that|this)|eli5|explain (?:it |that )?(?:simply|more simply)|in simpler terms|break (?:it |that )?down|can (?:you|u) simplify|too complicated)$/.test(q)) return 'clarify';
  if (/^(?:summarize|summary|tl dr|tldr|short version|in one sentence|briefly)$/.test(q)) return 'summary';
  if (/^(?:tell me more|more|more details|go on|keep going|continue|another one|and then|what else)$/.test(q)) return 'continue';
  return null;
}
export function interpretMessage(raw) {
  let query=normalizeConversationQuery(raw);
  let kind=classify(query);
  if(kind) return {kind,query};
  // A greeting or acknowledgment before a real question must not swallow the question.
  query=query.replace(/^(?:hey|hi|hello|yo)(?: there)?[!,.\s]+/i,'')
    .replace(/^(?:ok(?:ay)?(?: got it)?|got it|thanks(?: for (?:that|explaining|clarifying))?|thank you|cool|yes|yep)(?:[,!.;]\s*(?:(?:and|now|but|so)\s+)?|\s+(?:and|now|but|so)\s+)/i,'')
    .replace(/^(?:please|pls|plz)\s+/i,'')
    .replace(/^(?:can|could|would) (?:you|u) (?:please )?(?=(?:explain|describe|compare|define|show|give|help)\b)/i,'')
    .replace(/^what['’]s\s+/i,'what is ')
    .trim();
  kind=classify(query);
  return {kind:kind||'question',query};
}
export function conversationalReply(message, session, KB, bot = {}) {
  const topicIndex=session?.lastTopic;
  const entry=Number.isInteger(topicIndex)?KB[topicIndex]:null;
  const finish=(text,topics=[])=>({text,topics,meta:[],kind:message.kind,showSuggestions:!entry});
  switch(message.kind){
    case 'greeting':return finish(entry?`Hey! Want to keep exploring **${entry.name}**, or try a different topic?`:'Hey! What would you like to learn about? You can ask a question or choose one below.');
    case 'identity':return finish(`I'm ${bot.name||'ReLU.chat'}, a learning assistant. I explain topics from a curated knowledge base and can walk through examples. I'm not a person, and I can misunderstand questions.`);
    case 'thanks':return finish("You're welcome! Ask whenever you want to explore something else.");
    case 'acknowledgement':return finish("Sounds good. I'm here if you have another question.");
    case 'farewell':return finish('See you! Come back whenever you want to explore another topic.');
    case 'question':return null;
  }
  if(!entry)return finish('Which topic or part would you like me to explain? Name a subject or choose a question below.');
  const previous=(session.history||[]).filter(turn=>turn.topics.includes(topicIndex)).slice(-3).map(turn=>turn.response).join('\n');
  const choose=category=>{
    const fragments=(entry.f?.[category]||[]).filter(text=>typeof text==='string'&&text.trim());
    return fragments.find(text=>!previous.includes(text))||fragments[0];
  };
  const categories={clarify:['int','ex'],how:['ex','int'],why:['int','ex'],example:['ex'],summary:['int'],continue:['app','ex']}[message.kind];
  if(!categories)return null;
  const parts=[...new Set(categories.map(choose).filter(Boolean))];
  if(!parts.length)return finish(`Which part of **${entry.name}** should we focus on?`);
  const prefix={clarify:`For **${entry.name}**, here's the idea:`,how:`Here's a concrete way to see **${entry.name}**:`,why:`For **${entry.name}**, connect the intuition with an example:`,example:`An example of **${entry.name}**:`,summary:`**${entry.name}**, briefly:`,continue:`A bit more about **${entry.name}**:`}[message.kind];
  return finish(prefix+'\n\n'+parts.join('\n\n'),[topicIndex]);
}
