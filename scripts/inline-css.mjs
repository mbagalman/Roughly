// Injects a freshly compiled Tailwind stylesheet into roughly/roughly.html.
//
// Run via `npm run build:css`, which first compiles `tw.min.css` at the repo
// root with the pinned Tailwind CLI and then invokes this script to replace
// the vendored <style> block (the one directly following the "Tailwind CSS"
// comment in <head>). The temp file is deleted on success.
//
// Zero dependencies — Node 20+ only, same as the test suite.

import { readFile, writeFile, unlink } from 'node:fs/promises';

const cssUrl  = new URL('../tw.min.css', import.meta.url);
const htmlUrl = new URL('../roughly/roughly.html', import.meta.url);

const css = (await readFile(cssUrl, 'utf8')).trim();
if (!css.includes('tailwindcss')) {
    throw new Error('tw.min.css does not look like Tailwind output (missing version banner)');
}
if (/<\/style/i.test(css)) {
    throw new Error('tw.min.css contains "</style" and cannot be inlined safely');
}

const html = await readFile(htmlUrl, 'utf8');
// The vendored block: the first <style> immediately after the Tailwind comment.
const marker = /(<!-- Tailwind CSS[\s\S]*?-->\s*<style>)[\s\S]*?(<\/style>)/;
if (!marker.test(html)) {
    throw new Error('Could not find the vendored Tailwind <style> block in roughly.html');
}
const updated = html.replace(marker, (_, open, close) => open + css + close);

await writeFile(htmlUrl, updated);
await unlink(cssUrl);
console.log(`Inlined ${css.length.toLocaleString()} chars of compiled CSS into roughly/roughly.html (now ${updated.length.toLocaleString()} chars).`);
console.log('Run `npm test` to confirm the assembled-page checks still pass.');
