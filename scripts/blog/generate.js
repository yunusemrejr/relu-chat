#!/usr/bin/env node
/**
 * Blog Generate — Builds static HTML from JSON posts
 * Usage: node scripts/blog/generate.js
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

const { POSTS_DIR, BLOG_OUT, SITE_URL } = engine;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function generate() {
  console.log('Blog Generate — ReLU.chat');
  console.log('========================\n');

  // Load published posts
  const posts = engine.getPublishedPosts();
  console.log(`Found ${posts.length} published posts`);

  if (posts.length === 0) {
    console.log('No published posts. Generating empty blog.');
  }

  // Clean output directory
  cleanDir(BLOG_OUT);

  // Generate index page
  const indexHTML = engine.generateIndexHTML(posts);
  fs.writeFileSync(path.join(BLOG_OUT, 'index.html'), indexHTML);
  console.log('Generated: blog/index.html');

  // Generate individual post pages
  for (const post of posts) {
    const postDir = path.join(BLOG_OUT, post.slug);
    ensureDir(postDir);
    const postHTML = engine.generatePostHTML(post);
    fs.writeFileSync(path.join(postDir, 'index.html'), postHTML);
    console.log(`Generated: blog/${post.slug}/index.html`);
  }

  // Generate RSS feed
  const rssXML = engine.generateRSSFeed(posts);
  fs.writeFileSync(path.join(BLOG_OUT, 'feed.xml'), rssXML);
  console.log('Generated: blog/feed.xml');

  // Generate sitemap
  const sitemapXML = engine.generateSitemap(posts);
  fs.writeFileSync(path.join(BLOG_OUT, 'sitemap.xml'), sitemapXML);
  console.log('Generated: blog/sitemap.xml');

  // Generate robots.txt
  const robotsTxt = engine.generateRobotsTxt();
  fs.writeFileSync(path.join(BLOG_OUT, 'robots.txt'), robotsTxt);
  console.log('Generated: blog/robots.txt');

  // Generate llms.txt
  const llmsTxt = engine.generateLLMsTxt();
  fs.writeFileSync(path.join(BLOG_OUT, 'llms.txt'), llmsTxt);
  console.log('Generated: blog/llms.txt');

  // Generate llms-full.txt
  const llmsFullTxt = engine.generateLLMsFullTxt();
  fs.writeFileSync(path.join(BLOG_OUT, 'llms-full.txt'), llmsFullTxt);
  console.log('Generated: blog/llms-full.txt');

  // Also copy discovery files to project root (for site-wide access)
  const ROOT = path.resolve(__dirname, '../..');
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXML);
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robotsTxt);
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), llmsTxt);
  fs.writeFileSync(path.join(ROOT, 'llms-full.txt'), llmsFullTxt);
  console.log('\nCopied discovery files to project root: sitemap.xml, robots.txt, llms.txt, llms-full.txt');

  console.log(`\nDone. ${posts.length} posts generated to ${BLOG_OUT}/`);
}

generate();
