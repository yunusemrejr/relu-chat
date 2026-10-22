// Compact index of every assistant's topics (names, aliases, one-line overview
// and /learn/ URL). Each chat loads it after start-up so a question that belongs
// to another assistant can be answered with "the X assistant covers that".
import { SITE } from './config.mjs';

/**
 * @param {ReturnType<import('./data.mjs').loadBots>} bots
 * @param {object[]} manifestBots - data/manifest.json "bots"
 * @returns {string} JSON text
 */
export function topicDirectory(bots, manifestBots) {
  const order = manifestBots.map((m) => m.id);
  const sorted = [...bots].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const directory = {
    version: 1,
    bots: sorted.map((b) => ({ id: b.id, name: manifestBots.find((m) => m.id === b.id)?.name || b.name, url: `/chat/${b.id}/`, subject: b.cfg.subject })),
    topics: sorted.flatMap((b, bi) => b.topics.map((t) => [
      bi, t.id, t.name, [...new Set(t.aliases.map((a) => a.trim()).filter(Boolean))],
      String(t.summary || '').replace(/\s+/g, ' ').trim(), `/learn/${b.cfg.slug}/${t.slug}/`,
    ])),
    source: `${SITE}/learn/`,
  };
  return JSON.stringify(directory) + '\n';
}
