# Radar AI

Ogni mattina alle 08:00 (ora di Roma) un riepilogo su Telegram delle novità AI:

- **Claude Code**: le versioni nuove dal [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), con le funzioni aggiunte
- **Anthropic**: gli articoli nuovi su anthropic.com/news
- **X**: i post più forti delle ultime 24 ore dei profili in `config.json` (no risposte, no repost), letti con lo scraper Apify [igolaizola/x-twitter-scraper](https://apify.com/igolaizola/x-twitter-scraper)
- **GitHub**: i repo AI nati negli ultimi 7 giorni con più stelle

Gira su GitHub Actions, anche a PC spento. `stato.json` ricorda cosa è già stato mandato.

```bash
node scripts/radar.mjs --dry   # stampa il riepilogo senza mandarlo
node scripts/radar.mjs         # lo manda su Telegram
```

Profili, argomenti GitHub e ora in `config.json`. Chiavi in `.env` in locale e nei secret
della repo su GitHub: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APIFY_TOKEN`.
