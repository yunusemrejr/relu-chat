#!/usr/bin/env node
/**
 * Blog Create — Creates a new blog post
 * Usage: node scripts/blog/create.js --title "My Post" --author "Name" [--tags "ai,ml"] [--draft]
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && args[i + 1]) parsed.title = args[++i];
    else if (args[i] === '--author' && args[i + 1]) parsed.author = args[++i];
    else if (args[i] === '--tags' && args[i + 1]) parsed.tags = args[++i];
    else if (args[i] === '--excerpt' && args[i + 1]) parsed.excerpt = args[++i];
    else if (args[i] === '--cover' && args[i + 1]) parsed.cover = args[++i];
    else if (args[i] === '--draft') parsed.draft = true;
    else if (args[i] === '--slug' && args[i + 1]) parsed.slug = args[++i];
  }
  return parsed;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function create() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.title) {
    console.error('Usage: node scripts/blog/create.js --title "My Post" --author "Name" [--tags "ai,ml"] [--draft]');
    process.exit(1);
  }

  const slug = args.slug || slugify(args.title);
  const id = slug;
  const now = new Date().toISOString();
  const isDraft = args.draft || false;

  // Check for duplicate
  const existing = engine.findBySlug(slug);
  if (existing) {
    console.error(`Error: Post with slug "${slug}" already exists (id: ${existing.id})`);
    process.exit(1);
  }

  const post = {
    id,
    slug,
    title: args.title,
    meta_title: args.title.substring(0, 60),
    meta_description: args.excerpt || '',
    status: isDraft ? 'draft' : 'published',
    published_at: now,
    updated_at: now,
    author: args.author || 'ReLU.chat',
    content: '# ' + args.title + '\n\nWrite your content here...',
    excerpt: args.excerpt || '',
    canonical: `${engine.SITE_URL}/blog/${slug}/`,
    cover_image: args.cover || '',
    cover_image_alt: args.title,
    tags: args.tags ? args.tags.split(',').map(t => t.trim()) : [],
    redirects: []
  };

  // Validate
  const errors = engine.validatePost(post);
  if (errors.length > 0) {
    console.error('Validation errors:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  // Write
  if (!fs.existsSync(engine.POSTS_DIR)) {
    fs.mkdirSync(engine.POSTS_DIR, { recursive: true });
  }

  const filePath = path.join(engine.POSTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2) + '\n');

  console.log(`Created: ${filePath}`);
  console.log(`Status: ${post.status}`);
  console.log(`Slug: ${slug}`);
  console.log(`URL: ${engine.SITE_URL}/blog/${slug}/`);
  if (isDraft) console.log('(Draft — will not appear publicly until published)');
}

create();
