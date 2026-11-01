import {build} from 'esbuild';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('dist', {recursive:true});
await cp('static', 'dist', {recursive:true});
await cp('licenses', 'dist/licenses', {recursive:true});
await build({entryPoints:['src/background.js','src/main.js','src/content.js','src/popup.js','src/comments-main.js','src/comments-content.js','src/subscribe-time-main.js','src/subscribe-time-content.js'],bundle:true,outdir:'dist',format:'iife',target:'chrome111',legalComments:'eof',charset:'utf8'});
await mkdir('dist/icons', {recursive:true});
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="30" fill="#00a1d6"/><path d="M64 22c-19 0-33 14-33 32 0 24 33 53 33 53s33-29 33-53c0-18-14-32-33-32z" fill="white"/><circle cx="64" cy="54" r="13" fill="#00a1d6"/></svg>';
for (const size of [16,48,128]) await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`dist/icons/${size}.png`);
for (const name of ['LICENSE','THIRD_PARTY_NOTICES.md','CHANGELOG.md']) {
  try { await writeFile(`dist/${name}`, await readFile(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await cp('README.md','dist/使用说明.md');
console.log('扩展已生成：dist/');
