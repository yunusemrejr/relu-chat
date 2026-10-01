// Tool pages are hand-written, so their illustration layer is applied here:
//   /tools/           each listing swaps its stroke icon for the tool's own picture
//   /tools/<slug>/    the header gets the same picture
import { toolSvg } from './home.mjs';
import { TOOLS } from './config.mjs';

const known = new Set(TOOLS.map((t) => t.slug));

export function tagTools(html, urlPath) {
  if (urlPath === '/tools/') {
    return html.replace(/<a href="([a-z-]+)\/"\s+class="tool-listing">\s*<div class="tool-listing-icon">[\s\S]*?<\/svg>\s*<\/div>/g, (m, slug) => (known.has(slug) ? `<a href="${slug}/" class="tool-listing">\n<div class="tool-pic">${toolSvg(slug)}</div>` : m))
      .replace(/<a href="([a-z-]+)\/"\s+class="tool-listing">\s*<div class="tool-pic">[\s\S]*?<\/svg><\/div>/g, (m, slug) => (known.has(slug) ? `<a href="${slug}/" class="tool-listing">\n<div class="tool-pic">${toolSvg(slug)}</div>` : m));
  }
  const m = urlPath.match(/^\/tools\/([a-z-]+)\/$/);
  if (m && known.has(m[1])) {
    const art = `<div class="tool-art" aria-hidden="true">${toolSvg(m[1])}</div>`;
    if (/<div class="tool-art"/.test(html)) return html.replace(/<div class="tool-art"[^>]*>[\s\S]*?<\/svg><\/div>/, art);
    return html.replace(/(<div class="tool-header">)/, `$1${art}`);
  }
  return html;
}
