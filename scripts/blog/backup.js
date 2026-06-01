#!/usr/bin/env node
/**
 * Blog Backup — Creates a timestamped backup of all blog content
 * Usage: node scripts/blog/backup.js
 */

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const backupDir = path.resolve(__dirname, '../../_backups/blog-' + timestamp);

  if (!fs.existsSync(engine.POSTS_DIR)) {
    console.log('No posts directory found. Nothing to back up.');
    return;
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const files = fs.readdirSync(engine.POSTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    fs.copyFileSync(
      path.join(engine.POSTS_DIR, file),
      path.join(backupDir, file)
    );
  }

  // Also backup schema
  const schemaPath = path.join(engine.POSTS_DIR, '../schema/schema.json');
  if (fs.existsSync(schemaPath)) {
    fs.copyFileSync(schemaPath, path.join(backupDir, 'schema.json'));
  }

  console.log(`Backed up ${files.length} posts to ${backupDir}`);
}

backup();
