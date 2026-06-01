#!/usr/bin/env node
/**
 * Blog List — Lists all blog posts with status
 * Usage: node scripts/blog/list.js [--all]
 */

const engine = require('./engine');

function list() {
  const showAll = process.argv.includes('--all');
  const posts = showAll ? engine.loadAllPosts() : engine.getPublishedPosts();

  console.log(`Blog Posts (${showAll ? 'all' : 'published only'})`);
  console.log('='.repeat(70));

  if (posts.length === 0) {
    console.log('No posts found.');
    return;
  }

  for (const post of posts) {
    const statusIcon = {
      published: '\u2705',
      draft: '\u270D',
      archived: '\u26D4',
      deleted: '\u274C'
    }[post.status] || '?';

    console.log(`${statusIcon} [${post.status.padEnd(9)}] ${post.slug}`);
    console.log(`   Title: ${post.title}`);
    console.log(`   Author: ${post.author} | Date: ${post.published_at ? post.published_at.substring(0, 10) : 'N/A'}`);
    if (post.tags && post.tags.length) console.log(`   Tags: ${post.tags.join(', ')}`);
    console.log('');
  }

  console.log(`${posts.length} posts total.`);
}

list();
