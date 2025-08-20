#!/usr/bin/env node

/**
 * Audit script to check for absolute self-host URLs that should be relative
 * 
 * RULE: Web app assets (scripts, CSS, manifest, images) should be relative
 *       SMS/email links should be absolute (phones/email clients can't resolve relative paths)
 * 
 * Run with: npm run audit:urls
 */

const { execSync } = require('child_process');
const path = require('path');

// Dynamic host detection from environment variables
const getSelfHostPatterns = () => {
  const patterns = [];
  
  // Parse ROOT_URL if present
  if (process.env.ROOT_URL) {
    try {
      const url = new URL(process.env.ROOT_URL);
      patterns.push(`https?://${url.hostname.replace(/\./g, '\\.')}`);
    } catch (e) {
      console.warn('⚠️  Invalid ROOT_URL format:', process.env.ROOT_URL);
    }
  }
  
  // Parse CANONICAL_HOST if present
  if (process.env.CANONICAL_HOST) {
    patterns.push(`https?://${process.env.CANONICAL_HOST.replace(/\./g, '\\.')}`);
  }
  
  // Parse ALLOWED_SELF_HOSTS (comma-separated) if present
  if (process.env.ALLOWED_SELF_HOSTS) {
    const hosts = process.env.ALLOWED_SELF_HOSTS.split(',').map(h => h.trim()).filter(Boolean);
    hosts.forEach(host => {
      patterns.push(`https?://${host.replace(/\./g, '\\.')}`);
    });
  }
  
  // Fallback to common patterns if no environment variables set
  if (patterns.length === 0) {
    patterns.push(
      'https?://(web-template-1\\.onrender\\.com|sherbrt-test\\.onrender\\.com)',
      'https?://sherbrt\\.com'
    );
    console.log('⚠️  No environment variables set for host detection, using fallback patterns');
  }
  
  return patterns;
};

// Patterns to search for absolute self-host URLs that should be relative
// Note: SMS/email links are allowed to be absolute
const SELF_HOST_PATTERNS = getSelfHostPatterns();

// Files that are allowed to contain absolute URLs (SMS/email templates)
const ALLOWED_ABSOLUTE_URL_FILES = [
  'server/api/transition-privileged.js',
  'server/api/initiate-privileged.js'
];

// Files/directories to exclude from search
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'build',
  'dist',
  '*.md',
  '*.txt',
  '*.log',
  '*.zip',
  '*.backup'
];

console.log('🔍 Auditing for absolute self-host URLs...\n');
console.log('📋 Using host patterns:');
SELF_HOST_PATTERNS.forEach(pattern => console.log(`  - ${pattern}`));
console.log('');

let foundIssues = false;

SELF_HOST_PATTERNS.forEach(pattern => {
  try {
    // Build grep command with exclusions
    const excludeArgs = EXCLUDE_PATTERNS.map(p => `--exclude=${p}`).join(' ');
    const command = `grep -r --include="*.{js,jsx,tsx,html,css}" ${excludeArgs} "${pattern}" . || true`;
    
    const output = execSync(command, { encoding: 'utf8', cwd: process.cwd() });
    
    if (output.trim()) {
      // Filter out allowed files (SMS/email templates)
      const lines = output.trim().split('\n');
      const filteredLines = lines.filter(line => {
        const filePath = line.split(':')[0];
        return !ALLOWED_ABSOLUTE_URL_FILES.some(allowed => filePath.includes(allowed));
      });
      
      if (filteredLines.length > 0) {
        console.log(`❌ Found absolute self-host URLs matching pattern: ${pattern}`);
        console.log('Files that should use relative URLs:');
        filteredLines.forEach(line => console.log(`  ${line}`));
        foundIssues = true;
      } else {
        console.log(`✅ No issues found for pattern: ${pattern} (allowed URLs are in SMS/email templates)`);
      }
    } else {
      console.log(`✅ No issues found for pattern: ${pattern}`);
    }
  } catch (error) {
    console.log(`⚠️  Error checking pattern ${pattern}:`, error.message);
  }
});

console.log('\n' + '='.repeat(50));

if (foundIssues) {
  console.log('❌ AUDIT FAILED: Found absolute self-host URLs that should be relative');
  console.log('Fix these by converting to relative paths (e.g., /static/... instead of https://domain.com/static/...)');
  process.exit(1);
} else {
  console.log('✅ AUDIT PASSED: No absolute self-host URLs found');
  console.log('All asset references use relative paths as expected');
  process.exit(0);
}
