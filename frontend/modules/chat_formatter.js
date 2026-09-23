(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIChatFormatter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const ChatFormatter = (() => {
  // Patterns: "User:", "Human:", "You:", "Você:", etc.
  const USER_PATTERN = /^(user|human|you|você|eu|pergunta|question)\s*:\s*/i;
  // Patterns: "AI:", "Assistant:", "Gemini:", "ChatGPT:", "Claude:", "GPT:", etc.
  const AI_PATTERN = /^(ai|assistant|assistente|gemini|chatgpt|gpt|claude|bot|copilot|bing|resposta|answer)\s*:\s*/i;
  // Timestamp
  const TIMESTAMP_PATTERN = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]?\s*/i;

  function format(text) {
    const lines = text.split('\n');
    let md = '# Conversa com IA\n\n';
    md += `*Formatado em ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;

    let currentSpeaker = null;
    let currentLines = [];
    let codeBlock = false;

    function flush() {
      if (!currentLines.length) return;
      const body = currentLines.join('\n').trim();
      if (!body) { currentLines = []; return; }

      if (currentSpeaker === 'user') {
        md += `> 🧑 **Usuário:**\n>\n> ${body.replace(/\n/g, '\n> ')}\n\n`;
      } else if (currentSpeaker === 'ai') {
        md += `> 🤖 **IA:**\n>\n> ${body.replace(/\n/g, '\n> ')}\n\n`;
      } else {
        md += body + '\n\n';
      }
      currentLines = [];
    }

    for (let line of lines) {
      // Handle code blocks — pass through unmodified
      if (line.trim().startsWith('```')) {
        codeBlock = !codeBlock;
        currentLines.push(line);
        continue;
      }
      if (codeBlock) { currentLines.push(line); continue; }

      // Strip optional timestamp
      line = line.replace(TIMESTAMP_PATTERN, '').trim();
      if (!line) { currentLines.push(''); continue; }

      if (USER_PATTERN.test(line)) {
        flush();
        currentSpeaker = 'user';
        currentLines.push(line.replace(USER_PATTERN, ''));
      } else if (AI_PATTERN.test(line)) {
        flush();
        currentSpeaker = 'ai';
        currentLines.push(line.replace(AI_PATTERN, ''));
      } else {
        currentLines.push(line);
      }
    }
    flush();
    return md.trimEnd();
  }

  return { format };
})();



  return ChatFormatter;
});