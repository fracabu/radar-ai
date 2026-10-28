// Radar AI: riepilogo quotidiano su Telegram.
// Fonti: post X dei profili in config.json (scraper Apify), news di Anthropic,
// CHANGELOG di Claude Code, repo AI in crescita su GitHub.
// Uso: node scripts/radar.mjs [--dry]   (--dry stampa senza mandare e senza salvare lo stato)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
// --cron: lo lancia GitHub Actions due volte (ora legale e solare); parte solo
// dalle config.ora di Roma in poi e una volta al giorno.
const CRON = process.argv.includes('--cron');
const ACTOR = 'igolaizola~x-twitter-scraper';

const leggiEnv = file => {
  if (!existsSync(file)) return {};
  const out = {};
  for (const riga of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};
const env = { ...leggiEnv('.env'), ...process.env };
// Il chat id è lo stesso del planner: se manca qui, lo prende da lì.
env.TELEGRAM_CHAT_ID ||= leggiEnv('../planner-my-work/.env').TELEGRAM_CHAT_ID;

const config = JSON.parse(readFileSync('config.json', 'utf8'));
const stato = existsSync('stato.json') ? JSON.parse(readFileSync('stato.json', 'utf8')) : {};
const giorno = d => d.toISOString().slice(0, 10);
const ieri = new Date(Date.now() - 864e5);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const breve = (s, n) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const k = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n ?? 0));

const oggiRoma = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const oraRoma = new Date().toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
if (CRON && (oraRoma < config.ora || stato.ultimo_invio === oggiRoma)) {
  console.log(`Niente da fare: sono le ${oraRoma} a Roma, ultimo invio ${stato.ultimo_invio ?? 'mai'}.`);
  process.exit(0);
}

async function postX() {
  if (!env.APIFY_TOKEN) return { righe: [], errore: 'manca APIFY_TOKEN' };
  const tutti = [];
  for (const h of config.profili_x) {
    let res;
    for (let tentativo = 1; tentativo <= 2; tentativo++) { // lo scraper ogni tanto fallisce al primo colpo
      res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=280`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIFY_TOKEN}` },
        body: JSON.stringify({ username: h, minDate: giorno(ieri), maxItems: config.x_max_per_profilo }),
      });
      if (res.ok) break;
    }
    if (!res.ok) { console.error(`Apify @${h}: ${res.status}`); continue; }
    tutti.push(...(await res.json()));
  }
  const visti = new Set(stato.x_visti || []);
  const nuovi = tutti
    .filter(t => !t.isRetweet && !(t.replyingTo && t.replyingTo.length))
    .filter(t => Date.now() - Date.parse(t.createdAt) < 36 * 3600e3 && !visti.has(t.id))
    .sort((a, b) => (b.likes || 0) - (a.likes || 0));
  stato.x_visti = [...nuovi.map(t => t.id), ...visti].slice(0, 500);
  return {
    letti: tutti.length,
    righe: nuovi.slice(0, config.x_top).map(t =>
      `• <b>@${esc(t.username)}</b> ${esc(breve(t.text, 220))} <i>(♥${k(t.likes)})</i> <a href="${t.permalink}">→</a>`),
  };
}

async function newsAnthropic() {
  const html = await (await fetch('https://www.anthropic.com/news')).text();
  const slug = [...new Set([...html.matchAll(/href="\/news\/([a-z0-9-]+)"/g)].map(m => m[1]))]
    .filter(s => !['announcements', 'features'].includes(s));
  const primoGiro = !stato.news_visti;
  const visti = new Set(stato.news_visti || []);
  const nuovi = slug.filter(s => !visti.has(s));
  stato.news_visti = [...new Set([...slug, ...visti])].slice(0, 300);
  if (primoGiro) return []; // al primo giro memorizza soltanto, altrimenti sarebbe tutto "nuovo"
  return nuovi.map(s => `• <a href="https://www.anthropic.com/news/${s}">${esc(s.replace(/-/g, ' '))}</a>`);
}

async function changelogClaudeCode() {
  const md = await (await fetch('https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md')).text();
  const sezioni = md.split(/^## /m).slice(1).map(s => {
    const [versione, ...righe] = s.split('\n');
    return { versione: versione.trim(), voci: righe.filter(r => r.startsWith('- ')).map(r => r.slice(2)) };
  });
  const ultima = stato.cc_versione;
  stato.cc_versione = sezioni[0]?.versione;
  const nuove = [];
  for (const s of sezioni) { if (s.versione === ultima) break; nuove.push(s); }
  if (!ultima) nuove.splice(1); // al primo giro mostra solo l'ultima versione
  return nuove.map(s => {
    const aggiunte = s.voci.filter(v => /^Added/.test(v)).slice(0, 4);
    const resto = s.voci.length - aggiunte.length;
    return `• <b>${esc(s.versione)}</b>\n` + aggiunte.map(v => `   – ${esc(breve(v, 160))}`).join('\n')
      + (resto > 0 ? `\n   <i>+ ${resto} correzioni e modifiche</i>` : '');
  });
}

async function repoGithub() {
  const dal = giorno(new Date(Date.now() - config.github_giorni * 864e5));
  // La ricerca di GitHub non accetta OR fra topic: una ricerca per topic, poi si uniscono.
  const trovati = new Map();
  for (const topic of config.github_topic) {
    const q = encodeURIComponent(`topic:${topic} created:>${dal} stars:>=${config.github_stelle_min}`);
    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`,
      { headers: { 'User-Agent': 'radar-ai' } });
    if (!res.ok) { console.error(`GitHub ${topic}: ${res.status}`); continue; }
    for (const r of (await res.json()).items || []) trovati.set(r.id, r);
  }
  const items = [...trovati.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, config.github_top);
  return items.map(r => `• <a href="${r.html_url}">${esc(r.full_name)}</a> ⭐${k(r.stargazers_count)} — ${esc(breve(r.description || '', 120))}`);
}

const prova = async (nome, fn) => { try { return await fn(); } catch (e) { console.error(`${nome}: ${e.message}`); return null; } };
const [x, news, cc, repo] = await Promise.all([
  prova('X', postX), prova('news', newsAnthropic), prova('changelog', changelogClaudeCode), prova('GitHub', repoGithub),
]);

const sezioni = [
  ['🚀 Claude Code: nuove versioni', cc],
  ['📰 Anthropic: nuovi articoli', news],
  ['𝕏 I post più forti delle ultime 24 ore', x?.righe],
  [`⭐ Repo AI nuovi più stellati (ultimi ${config.github_giorni} giorni)`, repo],
].filter(([, righe]) => righe && righe.length);

const data = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const testo = `<b>Radar AI · ${data}</b>\n\n`
  + (sezioni.length ? sezioni.map(([t, r]) => `<b>${t}</b>\n${r.join('\n')}`).join('\n\n') : 'Nessuna novità oggi.');

if (DRY) {
  console.log(testo.replace(/<[^>]+>/g, ''));
  console.log(`\n(${testo.length} caratteri; post X letti: ${x?.letti ?? 0})`);
  process.exit(0);
}

if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
  console.error('Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID nel .env');
  process.exit(1);
}
// Telegram accetta al massimo 4096 caratteri per messaggio: si spezza fra le sezioni.
const pezzi = [];
for (const blocco of testo.split('\n\n')) {
  if (pezzi.length && (pezzi.at(-1) + '\n\n' + blocco).length < 4000) pezzi[pezzi.length - 1] += '\n\n' + blocco;
  else pezzi.push(blocco);
}
// TELEGRAM_CHAT_ID può contenere più destinatari separati da virgola.
for (const chat of env.TELEGRAM_CHAT_ID.split(',').map(s => s.trim()).filter(Boolean)) {
  for (const pezzo of pezzi) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: pezzo, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) { console.error(`Telegram: ${res.status} ${await res.text()}`); process.exit(1); }
  }
}
stato.ultimo_invio = oggiRoma;
writeFileSync('stato.json', JSON.stringify(stato, null, 2));
console.log(`Mandato su Telegram (${pezzi.length} messaggi).`);
