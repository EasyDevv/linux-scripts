#!/usr/bin/env bun
/**
 * count-lines - Detect code files with lines >= threshold (default: 400)
 * 
 * Usage:
 *   count-lines              # Show files >= 400 lines
 *   count-lines 300          # Show files >= 300 lines
 *   count-lines -a           # Show all files sorted by line count
 *   count-lines --help       # Show help
 * 
 * Features:
 *   - Respects .gitignore
 *   - Counts only code-related source files
 *   - Sorted by line count (descending)
 */

import { $ } from 'bun';
import { readFileSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import ignore from 'ignore';

// Default configuration
const DEFAULT_THRESHOLD = 400;
const INCLUDED_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.rb', '.php', '.java', '.kt', '.kts', '.scala',
  '.go', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp',
  '.cs', '.swift', '.m', '.mm', '.zig', '.lua', '.pl', '.r',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.nu',
  '.svelte', '.vue', '.astro',
  '.sql', '.graphql', '.gql',
  '.toml', '.yaml', '.yml', '.xml', '.ini', '.cfg', '.conf'
]);
const INCLUDED_FILENAMES = new Set([
  'Dockerfile', 'Makefile', 'Justfile',
  '.bashrc', '.zshrc', '.vimrc', '.gitignore', '.gitattributes',
  '.editorconfig', '.npmrc', '.prettierrc', '.eslintrc'
]);
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.svelte-kit', 'target', 
  '.next', '.nuxt', 'coverage', '__pycache__', '.cache', '.moon'
]);

interface FileInfo {
  path: string;
  lines: number;
  relativePath: string;
}

function showHelp() {
  console.log(`
count-lines - Detect code files with high line counts

Usage:
  count-lines [threshold]    Show files >= threshold lines (default: 400)
  count-lines -a             Show all files sorted by line count
  count-lines --help         Show this help

Examples:
  count-lines                # Files >= 400 lines
  count-lines 300            # Files >= 300 lines  
  count-lines -a             # All files sorted by line count

Features:
  - Respects .gitignore
  - Counts only code-related source files
  - Results sorted by line count (descending)
`);
}

function loadGitignore(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore();
  
  // Always ignore these
  EXCLUDED_DIRS.forEach(dir => ig.add(dir));
  
  // Load .gitignore if exists
  const gitignorePath = join(rootDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }
  
  return ig;
}

function isCodeFile(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? '';
  const ext = extname(filePath).toLowerCase();

  if (INCLUDED_FILENAMES.has(fileName)) return true;
  if (INCLUDED_EXTENSIONS.has(ext)) return true;
  
  // Check for minified files
  if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) return false;
  if (filePath.endsWith('.d.ts')) return false;
  
  return false;
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

async function getAllFiles(dir: string, ig: ReturnType<typeof ignore>, rootDir: string): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  
  async function walk(currentDir: string) {
    const entries = await Bun.file(currentDir).exists() 
      ? [] 
      : await (async () => {
          try {
            const { stdout } = await $`ls -1 ${currentDir}`.quiet();
            return stdout.toString().trim().split('\n').filter(Boolean);
          } catch {
            return [];
          }
        })();

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relativePath = relative(rootDir, fullPath);
      
      // Skip if ignored
      if (ig.ignores(relativePath)) continue;
      
      try {
        const stat = statSync(fullPath);
        
        if (stat.isDirectory()) {
          // Skip excluded directories
          if (!EXCLUDED_DIRS.has(entry)) {
            await walk(fullPath);
          }
        } else if (stat.isFile() && isCodeFile(fullPath)) {
          const lines = countLines(fullPath);
          if (lines > 0) {
            results.push({ path: fullPath, lines, relativePath });
          }
        }
      } catch {
        // Skip files we can't access
      }
    }
  }
  
  await walk(dir);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  // Help
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  // Parse threshold
  let threshold = DEFAULT_THRESHOLD;
  let showAll = false;
  
  if (args.includes('-a') || args.includes('--all')) {
    showAll = true;
    threshold = 0;
  } else if (args.length > 0 && !isNaN(parseInt(args[0]))) {
    threshold = parseInt(args[0]);
  }
  
  const rootDir = process.cwd();
  const ig = loadGitignore(rootDir);
  
  console.log(`\n📊 Scanning for ${showAll ? 'all' : `files >= ${threshold} lines`}...`);
  console.log(`📁 Root: ${rootDir}\n`);
  
  const files = await getAllFiles(rootDir, ig, rootDir);
  
  // Filter and sort
  const filtered = files
    .filter(f => f.lines >= threshold)
    .sort((a, b) => b.lines - a.lines);
  
  if (filtered.length === 0) {
    console.log(`✅ No files found with >= ${threshold} lines.`);
    return;
  }
  
  // Display results
  console.log('─'.repeat(80));
  console.log(`${'Lines'.padStart(7)}  ${'Path'}`);
  console.log('─'.repeat(80));
  
  for (const file of filtered) {
    const lineStr = file.lines.toString().padStart(6);
    const color = file.lines >= 600 ? '\x1b[31m' : file.lines >= 400 ? '\x1b[33m' : '\x1b[0m';
    console.log(`${color}${lineStr}\x1b[0m  ${file.relativePath}`);
  }
  
  console.log('─'.repeat(80));
  console.log(`\n📈 Total: ${filtered.length} files found`);
  
  if (!showAll && threshold === DEFAULT_THRESHOLD) {
    console.log(`\n💡 Tip: Use 'count-lines -a' to see all files sorted by line count`);
  }
}

main().catch(console.error);
