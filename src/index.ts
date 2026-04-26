import { bot } from './bot';

bot.launch().then(() => {
    console.log('🚀 Elirix Bot is running!');
}).catch((err) => {
    console.error('Failed to launch bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
