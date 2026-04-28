import { bot } from './bot';
import * as http from 'http';

// ── Keepalive HTTP server (for Replit / free hosting) ──────────
// UptimeRobot pings this URL every 5 min to keep the process alive
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('🤖 Elirix Bot is alive!');
}).listen(PORT, () => {
    console.log(`✅ Keepalive server running on port ${PORT}`);
});
// ───────────────────────────────────────────────────────────────

bot.launch().then(() => {
    console.log('🚀 Elirix Bot is running!');
}).catch((err) => {
    console.error('Failed to launch bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
