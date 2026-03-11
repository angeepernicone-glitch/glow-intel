/**
 * Downloads all remote heroImages in blog posts to public/images/blog/
 * and updates frontmatter to point to local paths.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const IMG_DIR = path.join(ROOT, 'public', 'images', 'blog');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/avif,image/jpeg,image/png,*/*',
        'Referer': 'https://glowintel.com',
      },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', err => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Curated fallback images by slug keyword
const FALLBACKS = {
  'peptides': 'https://images.pexels.com/photos/6621462/pexels-photo-6621462.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'aha-vs-bha': 'https://images.pexels.com/photos/3762879/pexels-photo-3762879.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'retinol-purging': 'https://images.pexels.com/photos/6203796/pexels-photo-6203796.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'snail-mucin': 'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'clean-beauty': 'https://images.pexels.com/photos/3735657/pexels-photo-3735657.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'collagen': 'https://images.pexels.com/photos/8460157/pexels-photo-8460157.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'rhode': 'https://images.pexels.com/photos/5632385/pexels-photo-5632385.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'shopify': 'https://images.pexels.com/photos/6956903/pexels-photo-6956903.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'damaged-skin': 'https://images.pexels.com/photos/6621461/pexels-photo-6621461.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'dry-skin': 'https://images.pexels.com/photos/3997991/pexels-photo-3997991.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'layering': 'https://images.pexels.com/photos/7428099/pexels-photo-7428099.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'men': 'https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'tiktok': 'https://images.pexels.com/photos/4458554/pexels-photo-4458554.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'sunscreen-indoors': 'https://images.pexels.com/photos/5938580/pexels-photo-5938580.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'influencer': 'https://images.pexels.com/photos/7014337/pexels-photo-7014337.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'gen-z': 'https://images.pexels.com/photos/5632389/pexels-photo-5632389.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'azelaic': 'https://images.pexels.com/photos/6621463/pexels-photo-6621463.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'combination': 'https://images.pexels.com/photos/3997993/pexels-photo-3997993.jpeg?auto=compress&cs=tinysrgb&w=1200',
};

async function main() {
  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));
  let fixed = 0;

  for (const file of files) {
    const mdPath = path.join(BLOG_DIR, file);
    const content = fs.readFileSync(mdPath, 'utf-8');
    const match = content.match(/^heroImage:\s*"(https?:\/\/[^"]+)"/m);
    if (!match) continue;

    const remoteUrl = match[1];
    const slug = file.replace('.md', '');
    const ext = remoteUrl.includes('.png') ? 'png' : remoteUrl.includes('.webp') ? 'webp' : 'jpg';
    const localFile = `${slug}.${ext}`;
    const localPath = path.join(IMG_DIR, localFile);
    const localUrl = `/images/blog/${localFile}`;

    process.stdout.write(`  Downloading ${slug}... `);

    // Try original URL first, then fallback
    let downloaded = false;
    const urlsToTry = [remoteUrl];

    // Find matching fallback
    for (const [key, fb] of Object.entries(FALLBACKS)) {
      if (slug.includes(key)) { urlsToTry.push(fb); break; }
    }

    for (const url of urlsToTry) {
      try {
        await download(url, localPath);
        const stat = fs.statSync(localPath);
        if (stat.size < 5000) {
          fs.unlinkSync(localPath);
          console.log(`too small (${stat.size}b), trying fallback...`);
          continue;
        }
        downloaded = true;
        console.log(`OK (${Math.round(stat.size/1024)}KB)`);
        break;
      } catch (e) {
        try { fs.unlinkSync(localPath); } catch {}
        console.log(`failed: ${e.message}, trying fallback...`);
      }
    }

    if (!downloaded) {
      console.log(`  ⚠ Skipping ${slug} — no working URL`);
      continue;
    }

    // Update frontmatter
    const updated = content.replace(
      /^(heroImage:\s*)"https?:\/\/[^"]+"/m,
      `$1"${localUrl}"`
    );
    fs.writeFileSync(mdPath, updated);
    fixed++;
  }

  console.log(`\nDone. Fixed ${fixed} posts.`);
}

main().catch(e => { console.error(e); process.exit(1); });
