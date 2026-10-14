import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

// Patterns that violate Rule A in production application code outside tests
const FORBIDDEN_PATTERNS = [
  { name: 'mock keyword', regex: /\b(mock|mocked|mocking)\b/i },
  { name: 'demo keyword', regex: /\b(demo|demos)\b/i },
  { name: 'fixture keyword', regex: /\b(fixture|fixtures)\b/i },
  { name: 'hardcoded partner ID', regex: /\bptr_[a-zA-Z0-9_-]+/i },
  { name: 'hardcoded user ID', regex: /\busr_[a-zA-Z0-9_-]+/i },
];

function getAllFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (['.ts', '.tsx', '.js', '.jsx', '.css', '.html'].includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

const files = getAllFiles(srcDir);
const violations = [];

for (const filePath of files) {
  const relativePath = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: pattern.name,
          content: line.trim(),
        });
      }
    }
  });
}

console.log('====================================================');
console.log('  Rule A Automated Check: Zero Demo/Mock Data Audit');
console.log('====================================================');
console.log(`Scanned ${files.length} production source files under web/src/\n`);

if (violations.length > 0) {
  console.error(`❌ Found ${violations.length} Rule A violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`);
    console.error(`    > ${v.content}\n`);
  }
  process.exit(1);
} else {
  console.log('✅ PASS: Zero mock, demo, fixture, or hardcoded ptr_/usr_ IDs found in web/src/.');
  console.log('All application data adheres strictly to backend contract alignment.');
  process.exit(0);
}
