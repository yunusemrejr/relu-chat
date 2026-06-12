#!/usr/bin/env node
/**
 * Blog Validate — Validates all blog posts against schema
 * Usage: node scripts/blog/validate.js [--fix]
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

function validate() {
  console.log('Blog Validate — ReLU.chat');
  console.log('=========================\n');

  const files = engine.listPostFiles();
  if (files.length === 0) {
    console.log('No posts found.');
    return;
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const post = engine.loadPost(file);
    const errors = engine.validatePost(post);

    // Warnings (non-blocking)
    const warnings = [];
    if (!post.excerpt) warnings.push('Missing excerpt');
    if (!post.cover_image) warnings.push('Missing cover image');
    if (!post.tags || post.tags.length === 0) warnings.push('No tags');
    if (post.meta_title && post.meta_title.length > 55) warnings.push(`meta_title near limit (${post.meta_title.length}/60)`);
    if (post.meta_description && post.meta_description.length > 150) warnings.push(`meta_description near limit (${post.meta_description.length}/160)`);

    const status = errors.length === 0 ? 'PASS' : 'FAIL';
    const icon = status === 'PASS' ? '\u2705' : '\u274C';

    console.log(`${icon} ${post.id} (${post.status})`);
    if (errors.length > 0) {
      errors.forEach(e => console.error(`   ERROR: ${e}`));
      totalErrors += errors.length;
    }
    if (warnings.length > 0) {
      warnings.forEach(w => console.log(`   WARN:  ${w}`));
      totalWarnings += warnings.length;
    }
  }

  console.log(`\n${files.length} posts checked.`);
  console.log(`${totalErrors} errors, ${totalWarnings} warnings.`);
  if (totalErrors > 0) process.exit(1);
}

validate();
