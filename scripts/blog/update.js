#!/usr/bin/env node
/**
 * Blog Update — Updates an existing blog post
 * Usage: node scripts/blog/update.js --slug "my-post" [--title "New Title"] [--content-file path.md] [--publish] [--draft]
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) parsed.slug = args[++i];
    else if (args[i] === '--title' && args[i + 1]) parsed.title = args[++i];
    else if (args[i] === '--author' && args[i + 1]) parsed.author = args[++i];
    else if (args[i] === '--tags' && args[i + 1]) parsed.tags = args[++i];
    else if (args[i] === '--excerpt' && args[i + 1]) parsed.excerpt = args[++i];
    else if (args[i] === '--cover' && args[i + 1]) parsed.cover = args[++i];
    else if (args[i] === '--meta-title' && args[i + 1]) parsed.meta_title = args[++i];
    else if (args[i] === '--meta-desc' && args[i + 1]) parsed.meta_description = args[++i];
    else if (args[i] === '--content-file' && args[i + 1]) parsed.contentFile = args[++i];
    else if (args[i] === '--content' && args[i + 1]) parsed.content = args[++i];
    else if (args[i] === '--publish') parsed.publish = true;
    else if (args[i] === '--draft') parsed.draft = true;
    else if (args[i] === '--archive') parsed.archive = true;
  }
  return parsed;
}

function update() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.slug) {
    console.error('Usage: node scripts/blog/update.js --slug "my-post" [--title "New Title"] [--content-file path.md] [--publish]');
    process.exit(1);
  }

  const post = engine.findBySlug(args.slug);
  if (!post) {
    console.error(`Error: No post found with slug "${args.slug}"`);
    process.exit(1);
  }

  // Apply updates
  if (args.title) post.title = args.title;
  if (args.author) post.author = args.author;
  if (args.tags) post.tags = args.tags.split(',').map(t => t.trim());
  if (args.excerpt) post.excerpt = args.excerpt;
  if (args.cover) post.cover_image = args.cover;
  if (args.meta_title) post.meta_title = args.meta_title;
  if (args.meta_description) post.meta_description = args.meta_description;
  if (args.content) post.content = args.content;
  if (args.contentFile) {
    const contentPath = path.resolve(args.contentFile);
    if (!fs.existsSync(contentPath)) {
      console.error(`Error: Content file not found: ${contentPath}`);
      process.exit(1);
    }
    post.content = fs.readFileSync(contentPath, 'utf8');
  }

  if (args.publish) {
    post.status = 'published';
    if (!post.published_at) post.published_at = new Date().toISOString();
  }
  if (args.draft) post.status = 'draft';
  if (args.archive) post.status = 'archived';

  post.updated_at = new Date().toISOString();

  // Validate
  const errors = engine.validatePost(post);
  if (errors.length > 0) {
    console.error('Validation errors:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  // Write
  const filePath = path.join(engine.POSTS_DIR, `${post.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2) + '\n');

  console.log(`Updated: ${filePath}`);
  console.log(`Status: ${post.status}`);
  console.log(`Slug: ${post.slug}`);
  console.log(`URL: ${engine.SITE_URL}/blog/${post.slug}/`);
}

update();
