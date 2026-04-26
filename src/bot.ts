import { Telegraf, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { generateWallets, getBalance } from './solana';
import { storage } from './storage';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN must be provided in .env! (Placeholder mode active)');
}

// Fallback token for initial setup to avoid crashing if user hasn't set it yet
// We will use a mock token just so Telegraf doesn't throw, but it won't connect.
export const bot = new Telegraf(token || '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ');

// Simple in-memory state to simulate the bot functionality
const userState: Record<number, any> = {};

function handleHome(ctx: any) {
    const welcomeMessage = `🌟 **Welcome to Elirix Bot!**\n\n🔥 **Where Things Happen!** 🔥\n\n**Available Features:**\n• Launch pump.fun tokens\n• Create or import multiple wallets\n• Auto-fund wallets via SOL disperser\n• Bundle up to 24 wallets\n• CTO pump.fun/raydium tokens\n• Delayed bundle on pump.fun\n• Advanced swap manager with intervals, sell all functions.\n• Anti-MEV protection\n\nUse /home to access all features\nUse /settings for configuration`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Launch Token', 'action_launch')],
        [Markup.button.callback('💼 Wallets', 'action_wallets'), Markup.button.callback('💰 Balance', 'action_balance')],
        [Markup.button.callback('📦 Bundle Settings', 'action_bundle'), Markup.button.callback('⚙️ Settings', 'action_settings')],
    ]);

    ctx.replyWithMarkdown(welcomeMessage, keyboard);
}

bot.start(handleHome);
bot.command('home', handleHome);

bot.help((ctx) => {
    ctx.replyWithMarkdown(`**Elirix Bot Commands:**\n\n/home - Main menu\n/launch - 3-step token launch wizard\n/wallets - Manage bundle wallets\n/bundle - Configure multi-wallet simultaneous buy\n/balance - Display SOL balance\n/settings - Configure slippage, priority fees, RPC node\n/help - Show this menu`);
});

bot.command('launch', (ctx) => launchWizard(ctx));
bot.action('action_launch', (ctx) => launchWizard(ctx));

function launchWizard(ctx: any) {
    const userId = ctx.from.id;
    userState[userId] = { step: 'launch_step_1' };
    
    ctx.replyWithMarkdown(`**Step 1/3: Token Metadata**\n\nPlease reply with your Token Name (e.g., Pump Token).`, Markup.forceReply());
}

bot.on('text', (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (!state) return;

    if (state.step === 'launch_step_1') {
        state.tokenName = ctx.message.text;
        state.step = 'launch_step_1_symbol';
        ctx.replyWithMarkdown(`Great! Now reply with your Token Symbol (max 10 chars, e.g., PUMP).`, Markup.forceReply());
    } else if (state.step === 'launch_step_1_symbol') {
        state.tokenSymbol = ctx.message.text;
        state.step = 'launch_step_2';
        
        ctx.replyWithMarkdown(`✅ **Metadata Collected**\nName: ${state.tokenName}\nSymbol: ${state.tokenSymbol}\n\n**Step 2/3: Bundle Configuration**\n\nHow many wallets should participate in the bundle buy? (Max 24)`, 
            Markup.inlineKeyboard([
                [Markup.button.callback('5 Wallets', 'bundle_5'), Markup.button.callback('10 Wallets', 'bundle_10')],
                [Markup.button.callback('24 Wallets', 'bundle_24'), Markup.button.callback('Custom', 'bundle_custom')]
            ])
        );
    } else if (state.step === 'edit_buy_amount') {
        const amt = parseFloat(ctx.message.text);
        if (!isNaN(amt)) {
            storage.updateUser(userId, user => user.bundleSettings.buyAmount = amt);
            ctx.reply(`✅ Buy amount updated to ${amt} SOL per wallet.`);
        } else {
            ctx.reply(`❌ Invalid amount.`);
        }
        userState[userId] = null;
    } else if (state.step === 'edit_slippage') {
        const slip = parseFloat(ctx.message.text);
        if (!isNaN(slip)) {
            storage.updateUser(userId, user => user.settings.slippage = slip);
            ctx.reply(`✅ Slippage updated to ${slip}%.`);
        } else {
            ctx.reply(`❌ Invalid amount.`);
        }
        userState[userId] = null;
    } else if (state.step === 'edit_fee') {
        const fee = parseFloat(ctx.message.text);
        if (!isNaN(fee)) {
            storage.updateUser(userId, user => user.settings.priorityFee = fee);
            ctx.reply(`✅ Priority fee updated to ${fee} SOL.`);
        } else {
            ctx.reply(`❌ Invalid amount.`);
        }
        userState[userId] = null;
    } else if (state.step === 'withdraw_address') {
        state.withdrawAddress = ctx.message.text;
        state.step = 'withdraw_amount';
        ctx.reply('Reply with the amount of SOL to withdraw (or type "ALL"):', Markup.forceReply());
    } else if (state.step === 'withdraw_amount') {
        const amount = ctx.message.text;
        ctx.reply(`✅ Withdrawal of ${amount} SOL to ${state.withdrawAddress} initiated.\n\n⚠️ *Transaction simulated for security.*`);
        userState[userId] = null;
    } else if (state.step === 'import_wallet_pk') {
        ctx.reply(`✅ Wallet imported successfully!`);
        userState[userId] = null;
    }
});

bot.action(/bundle_(\d+)/, (ctx) => {
    const wallets = ctx.match[1];
    const userId = ctx.from?.id;
    if (userId && userState[userId]) {
        userState[userId].wallets = wallets;
        userState[userId].step = 'launch_step_3';

        ctx.replyWithMarkdown(`✅ **Bundle Configured** for ${wallets} wallets.\n\n**Step 3/3: Confirm & Deploy**\n\nSummary:\n- Name: ${userState[userId].tokenName}\n- Symbol: ${userState[userId].tokenSymbol}\n- Bundle Wallets: ${wallets}\n\n**Estimated Cost:** 0.1 SOL + Bundle Buys\n\nDo you want to deploy now?`, 
            Markup.inlineKeyboard([
                [Markup.button.callback('🚀 Deploy to pump.fun', 'deploy_pumpfun')],
                [Markup.button.callback('🚀 Deploy to Raydium', 'deploy_raydium')],
                [Markup.button.callback('❌ Cancel', 'action_cancel')]
            ])
        );
    }
});

bot.action('deploy_pumpfun', (ctx) => {
    ctx.replyWithMarkdown(`✅ **Deployment Initiated on pump.fun!**\n\n⚠️ *Please wait while we simulate the transaction...*\n\nTransaction Hash: \`SimulatedTxHash1234567890\`\n[View on Solscan](https://solscan.io/)`);
});

bot.action('deploy_raydium', (ctx) => {
    ctx.replyWithMarkdown(`✅ **Deployment Initiated on Raydium!**\n\n⚠️ *Please wait while we simulate the transaction...*\n\nTransaction Hash: \`SimulatedTxHash0987654321\`\n[View on Solscan](https://solscan.io/)`);
});

bot.action('action_cancel', (ctx) => {
    const userId = ctx.from?.id;
    if (userId) userState[userId] = null;
    ctx.reply(`❌ Launch cancelled.`);
});

// Wallet Management
async function handleWallets(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    let msg = `💼 **Wallets Management**\n\n`;
    if (user.mainWallet) {
        msg += `**Main Funding Wallet:**\n\`${user.mainWallet.publicKey}\`\n*(Deposit SOL here to fund operations)*\n\n`;
    }

    if (user.wallets.length === 0) {
        msg += `You currently have no bundle wallets configured.\nHow many wallets would you like to generate? (Max 24)`;
        ctx.replyWithMarkdown(msg, 
            Markup.inlineKeyboard([
                [Markup.button.callback('Generate 5 Wallets', 'gen_wallets_5'), Markup.button.callback('Generate 10 Wallets', 'gen_wallets_10')],
                [Markup.button.callback('Generate 24 Wallets', 'gen_wallets_24'), Markup.button.callback('Import Wallet', 'import_wallet')]
            ])
        );
    } else {
        msg += `**Your Bundle Wallets (${user.wallets.length}):**\n`;
        user.wallets.forEach((w, i) => {
            msg += `W${i+1}: \`${w.publicKey}\`\n`;
        });
        msg += `\n⚠️ *These are non-custodial wallets. Keep your keys safe!*`;
        
        ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
            [Markup.button.callback('📥 Deposit', 'action_deposit'), Markup.button.callback('📤 Withdraw', 'action_withdraw')],
            [Markup.button.callback('🔑 Export Private Keys', 'export_pks'), Markup.button.callback('💸 Auto-Fund (Disperse)', 'auto_fund')],
            [Markup.button.callback('🗑 Clear Wallets', 'clear_wallets'), Markup.button.callback('💰 Check Balances', 'action_balance')]
        ]));
    }
}

bot.command('wallets', handleWallets);
bot.action('action_wallets', handleWallets);

bot.action(/gen_wallets_(\d+)/, (ctx) => {
    const count = parseInt(ctx.match[1]);
    const userId = ctx.from?.id;
    if (userId) {
        const wallets = generateWallets(count);
        storage.updateUser(userId, (user) => {
            user.wallets = wallets;
        });
        ctx.reply(`✅ Successfully generated ${count} wallets!\nUse /wallets to view them.`);
    }
});

bot.action('clear_wallets', (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
        storage.updateUser(userId, (user) => {
            user.wallets = [];
        });
        ctx.reply(`🗑 All wallets have been cleared from your account.`);
    }
});

bot.action('action_deposit', (ctx) => {
    const user = storage.getUser(ctx.from.id);
    if(user.mainWallet) {
        ctx.replyWithMarkdown(`📥 **Deposit SOL**\n\nSend SOL to your Main Funding Wallet:\n\`${user.mainWallet.publicKey}\`\n\n*All bundle distributions and fees will be deducted from this wallet.*`);
    }
});

bot.action('action_withdraw', (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'withdraw_address' };
    ctx.reply('📤 **Withdraw SOL**\n\nReply with the destination Solana address:', Markup.forceReply());
});

bot.action('export_pks', (ctx) => {
    const user = storage.getUser(ctx.from.id);
    let msg = `🔑 **Your Private Keys**\n\n⚠️ *NEVER share these with anyone!* ⚠️\n\n`;
    if (user.mainWallet) {
        msg += `**Main Wallet:**\n\`${user.mainWallet.secretKey}\`\n\n`;
    }
    msg += `**Bundle Wallets:**\n`;
    user.wallets.forEach((w, i) => {
        msg += `W${i+1}: \`${w.secretKey}\`\n`;
    });
    ctx.replyWithMarkdown(msg);
});

bot.action('import_wallet', (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'import_wallet_pk' };
    ctx.reply('Reply with the Base58 Private Key to import:', Markup.forceReply());
});

bot.action('auto_fund', (ctx) => {
    const user = storage.getUser(ctx.from.id);
    const cost = user.bundleSettings.buyAmount * user.wallets.length;
    ctx.replyWithMarkdown(`💸 **Auto-Fund (Disperse)**\n\nThis will send **${user.bundleSettings.buyAmount} SOL** to each of your ${user.wallets.length} bundle wallets from your Main Wallet.\n\nTotal required: **${cost} SOL**\n\n*Simulating dispersal...*\n✅ Dispersal complete!`);
});

// Balance Checking
async function handleBalance(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    if (user.wallets.length === 0) {
        return ctx.reply('💰 You have no wallets configured. Use /wallets to generate some.');
    }

    ctx.reply('🔄 Fetching balances from Solana Mainnet...');
    let totalBalance = 0;
    let msg = `💰 **Wallet Balances**\n\n`;
    
    for (let i = 0; i < user.wallets.length; i++) {
        const bal = await getBalance(user.wallets[i].publicKey);
        totalBalance += bal;
        msg += `Wallet ${i+1}: \`${bal.toFixed(4)}\` SOL\n`;
    }

    msg += `\n**Total Balance:** \`${totalBalance.toFixed(4)}\` SOL`;
    ctx.replyWithMarkdown(msg);
}

bot.command('balance', handleBalance);
bot.action('action_balance', handleBalance);

function handleBundle(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    
    const msg = `📦 **Bundle Settings**\n\n- Wallets Configured: ${user.wallets.length}\n- Buy per Wallet: ${user.bundleSettings.buyAmount} SOL\n\nWhen you launch, the bot will distribute SOL from your primary funding wallet to these bundle wallets and simultaneously buy your token.`;
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
        [Markup.button.callback('Edit Buy Amount', 'edit_buy_amount')]
    ]));
}

bot.command('bundle', handleBundle);
bot.action('action_bundle', handleBundle);

bot.action('edit_buy_amount', (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'edit_buy_amount' };
    ctx.reply('Reply with the new buy amount per wallet (in SOL):', Markup.forceReply());
});

function handleSettings(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    const msg = `⚙️ **Settings**\n\n- Slippage: ${user.settings.slippage}%\n- Priority Fee: ${user.settings.priorityFee} SOL\n- RPC Node: Mainnet-Beta`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Edit Slippage', 'edit_slippage'), Markup.button.callback('Edit Priority Fee', 'edit_fee')]
    ]);
    ctx.replyWithMarkdown(msg, kb);
}

bot.command('settings', handleSettings);
bot.action('action_settings', handleSettings);

bot.action('edit_slippage', (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'edit_slippage' };
    ctx.reply('Reply with the new slippage percentage (e.g., 10):', Markup.forceReply());
});

bot.action('edit_fee', (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'edit_fee' };
    ctx.reply('Reply with the new priority fee in SOL (e.g., 0.001):', Markup.forceReply());
});
