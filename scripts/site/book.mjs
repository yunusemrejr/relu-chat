// "How to Remain Valuable When Intelligence Becomes Cheap" placements.
// Existing hand-written copy is preserved; this only adds the cover thumbnail
// and normalises the three older markup variants into one card component.
import { BOOK } from './config.mjs';

export const THUMB = `<a class="rv-thumb" href="${BOOK.url}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="/assets/remain-valuable-cover-sm.webp" alt="" width="68" height="91" loading="lazy" decoding="async"></a>`;

export function applyBook(html) {
  let out = html;

  // Article end-notes: <aside class="rv-note"><span label/><p/></aside>
  out = out.replace(/<aside class="rv-note" aria-label="Recommended book">(?!<a class="rv-thumb")([\s\S]*?)<\/aside>/g,
    (_, inner) => `<aside class="rv-note" aria-label="Recommended book">${THUMB}<div class="rv-note-body">${inner}</div></aside>`);

  // Tool notes: <p class="rv-tool-note">text</p> -> same card
  out = out.replace(/<p class="rv-tool-note">([\s\S]*?)<\/p>/g,
    (_, inner) => `<aside class="rv-note rv-note--wide" aria-label="Recommended book">${THUMB}<div class="rv-note-body"><span class="rv-note-label">Going further</span><p class="rv-note-text">${inner.replace(/\s+/g, ' ').trim()}</p></div></aside>`);

  // Blog hub strip: add thumbnail
  out = out.replace(/<section class="rv-strip" aria-label="Recommended book">(?!<a class="rv-thumb")([\s\S]*?)<\/section>/g,
    (_, inner) => `<section class="rv-strip" aria-label="Recommended book">${THUMB}<div class="rv-note-body">${inner}</div></section>`);
  return out;
}

/** Book card for generated pages (same component the codemod produces elsewhere). */
export function bookCard(copyHtml) {
  return `<aside class="rv-note rv-note--wide" aria-label="Recommended book">${THUMB}<div class="rv-note-body"><span class="rv-note-label">Going further</span><p class="rv-note-text">${copyHtml} <a class="rv-note-link" href="${BOOK.url}" target="_blank" rel="noopener noreferrer">Get the book <span class="rv-arrow" aria-hidden="true">&rarr;</span></a></p></div></aside>`;
}
