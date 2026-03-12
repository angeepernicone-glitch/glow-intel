import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

// PubMed IDs confirmed to be wrong studies (hallucinated by Claude API)
const BAD_IDS = ['20534556','19178590','12524555','29935531','26047626','34738083','10595578','2180917','1700939'];
// Bad PMC IDs
const BAD_PMC_IDS = ['4505095'];

const files = readdirSync('src/content/blog').filter(f => f.endsWith('.md'));
let totalFixed = 0;

for (const file of files) {
  const path = join('src/content/blog', file);
  let content = readFileSync(path, 'utf-8');
  let changed = false;

  for (const id of BAD_IDS) {
    const re = new RegExp('\\[([^\\]]+)\\]\\(https?://pubmed\\.ncbi\\.nlm\\.nih\\.gov/' + id + '/?\\)', 'g');
    const next = content.replace(re, '$1');
    if (next !== content) {
      console.log(file + ': removed bad PubMed ID ' + id);
      content = next;
      changed = true;
      totalFixed++;
    }
  }

  for (const id of BAD_PMC_IDS) {
    const re = new RegExp('\\[([^\\]]+)\\]\\(https?://(?:www\\.)?ncbi\\.nlm\\.nih\\.gov/pmc/articles/PMC' + id + '/?\\)', 'g');
    const next = content.replace(re, '$1');
    if (next !== content) {
      console.log(file + ': removed bad PMC ID ' + id);
      content = next;
      changed = true;
      totalFixed++;
    }
  }

  // Remove bare root pubmed link (no ID)
  const bareRe = /\[([^\]]+)\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\)/g;
  const next2 = content.replace(bareRe, '$1');
  if (next2 !== content) {
    console.log(file + ': removed bare pubmed root link');
    content = next2;
    changed = true;
    totalFixed++;
  }

  if (changed) writeFileSync(path, content, 'utf-8');
}

console.log('\nDone. ' + totalFixed + ' bad links removed.');
console.log('Kept: PMC3970829 (hyaluronic acid) + 16766489 (niacinamide) — both verified correct.');
