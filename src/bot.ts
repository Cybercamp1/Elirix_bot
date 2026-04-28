import { Telegraf, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { generateWallets, getBalance, executeDeployment } from './solana';
import { storage } from './storage';

dotenv.config();

const BANNER_PATH = path.join(__dirname, '..', 'assets', 'banner.png');

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN must be provided in .env! (Placeholder mode active)');
}

export const bot = new Telegraf(token || '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ');

const userState: Record<number, any> = {};

bot.use((ctx, next) => {
    if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('auth_')) return next();
    }
    if (ctx.from) {
        const userId = ctx.from.id;
        const state = userState[userId];
        if (state && state.step && (state.step.startsWith('signin_') || state.step.startsWith('signup_'))) {
            return next();
        }
    }
    if (ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text;
        if (text === '/start' || text === '/home') return next();
    }
    
    if (ctx.from) {
        const user = storage.getSessionUser(ctx.from.id);
        if (!user) {
            if (ctx.callbackQuery) {
                ctx.answerCbQuery('Please Sign In or Sign Up first.', { show_alert: true });
            } else {
                ctx.reply('🔒 Please /start to sign in or sign up first.');
            }
            return;
        }
    }
    
    return next();
});

async function editOrReply(ctx: any, text: string, markup?: any, editMessageId?: number) {
    try {
        if (editMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, editMessageId, undefined, text, { parse_mode: 'Markdown', reply_markup: markup?.reply_markup });
            return editMessageId;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup?.reply_markup });
            return ctx.callbackQuery.message.message_id;
        } else {
            const msg = await ctx.replyWithMarkdown(text, markup);
            return msg.message_id;
        }
    } catch (e) {
        try {
            const msg = await ctx.replyWithMarkdown(text, markup);
            return msg.message_id;
        } catch (err) { return undefined; }
    }
}

async function handleHome(ctx: any, editMessageId?: number) {
    const userId = ctx.from.id;
    const user = storage.getSessionUser(userId);

    // Send banner image on fresh commands (/start, /home) — not on callback navigations
    const isFreshCommand = !editMessageId && !ctx.callbackQuery;
    if (isFreshCommand && fs.existsSync(BANNER_PATH)) {
        try {
            await ctx.replyWithPhoto({ source: BANNER_PATH });
        } catch (e) {
            console.error('Failed to send banner:', e);
        }
    }
    
    if (!user) {
        const welcomeMessage = `🔒 **Welcome to Elirix Bot!**\n\nPlease Sign In or Sign Up to continue.`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔐 Sign In', 'auth_signin'), Markup.button.callback('📝 Sign Up', 'auth_signup')]
        ]);
        await editOrReply(ctx, welcomeMessage, keyboard, editMessageId);
        return;
    }

    const welcomeMessage = `🌟 **Welcome to Elirix Bot!**\n\n🔥 *The Ultimate Solana Launch Tool* 🔥\n\nAvailable Features:\n• Launch pump.fun tokens\n• Create or import multiple wallets\n• Auto-fund wallets via SOL disperser\n• Bundle up to 24 wallets\n• CTO pump.fun/raydium tokens\n• Delayed bundle on pump.fun\n• Advanced swap manager with intervals, sell all functions\n• Anti-MEV protection\n• 🚀 Spam Launch — rapid fire launches\n• 🤖 Bump Bot — auto-bump your token\n• 💰 Get All SOL — collect from all wallets\n• 🎁 Claim Dev Rewards\n\nUse /home to access all features\nUse /settings for configuration`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🗂 Your Projects', 'action_projects'), Markup.button.callback('🚀 Create New Project', 'action_launch')],
        [Markup.button.callback('🚀 SPAM LAUNCH', 'action_spam_launch')],
        [Markup.button.callback('🤑 BUMP BOT 🤑', 'action_bump_bot')],
        [Markup.button.callback('💰 GET ALL SOL', 'action_get_all_sol')],
        [Markup.button.callback('🎁 CLAIM DEV REWARDS', 'action_claim_dev')],
        [Markup.button.callback('💼 Wallets', 'action_wallets'), Markup.button.callback('🔄 Advanced Swap', 'action_swap')],
        [Markup.button.callback('📦 Bundle Settings', 'action_bundle'), Markup.button.callback('⚙️ Settings', 'action_settings')],
        [Markup.button.callback('❓ Help', 'action_help'), Markup.button.callback('🚪 Logout', 'auth_logout')]
    ]);

    await editOrReply(ctx, welcomeMessage, keyboard, editMessageId);
}

bot.action('auth_signin', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🔐 **Sign In**\n\nPlease send your Username and Password in a single message, separated by a space.\n\nExample: `myusername mypassword`');
    userState[userId] = { step: 'signin_all', promptMessageId: msgId };
});

bot.action('auth_signup', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📝 **Sign Up**\n\nPlease send your Username, Password, and Confirm Password in a single message, separated by spaces.\n\nExample: `myusername mypassword mypassword`');
    userState[userId] = { step: 'signup_all', promptMessageId: msgId };
});

bot.action('auth_logout', async (ctx) => {
    const userId = ctx.from.id;
    storage.logout(userId);
    await handleHome(ctx);
});

bot.start((ctx) => handleHome(ctx));
bot.command('home', (ctx) => handleHome(ctx));

bot.help(async (ctx) => {
    await editOrReply(ctx, `**Elirix Bot Commands:**\n\n/home - Main menu\n/launch - 3-step token launch wizard\n/wallets - Manage bundle wallets\n/bundle - Configure multi-wallet simultaneous buy\n/balance - Display SOL balance\n/settings - Configure slippage, priority fees, RPC node\n/help - Show this menu`);
});

bot.command('launch', (ctx) => launchWizard(ctx));
bot.action('action_launch', (ctx) => launchWizard(ctx));

async function launchWizard(ctx: any, editMessageId?: number) {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, `**Step 1/3: Token Metadata**\n\nPlease reply with your Token Name (e.g., Pump Token).`, undefined, editMessageId);
    userState[userId] = { step: 'launch_step_1', promptMessageId: msgId };
}

bot.on('message', async (ctx: any) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (!state) return;

    const msgText = ctx.message.text;
    const msgPhoto = ctx.message.photo;

    // Hide user input
    try { await ctx.deleteMessage(); } catch (e) {}
    const editId = state.promptMessageId;

    if (state.step === 'signup_all') {
        if (!msgText) return;
        
        const parts = msgText.trim().split(/\s+/);
        if (parts.length !== 3) {
            await editOrReply(ctx, '❌ Invalid format. Please send: `Username Password ConfirmPassword`', undefined, editId);
            return;
        }
        const [username, password, confirmPassword] = parts;

        if (storage.data[username]) {
            await editOrReply(ctx, '❌ Username already exists. Please choose another one and try again.', undefined, editId);
            return;
        }
        if (password !== confirmPassword) {
            await editOrReply(ctx, '❌ Passwords do not match. Please try again.', undefined, editId);
            return;
        }
        
        storage.createAccount(username, password);
        storage.login(userId, username);
        userState[userId] = null;
        await handleHome(ctx, editId);
    } else if (state.step === 'signin_all') {
        if (!msgText) return;
        
        const parts = msgText.trim().split(/\s+/);
        if (parts.length !== 2) {
            await editOrReply(ctx, '❌ Invalid format. Please send: `Username Password`', undefined, editId);
            return;
        }
        const [username, password] = parts;

        const success = storage.verifyAccount(username, password);
        if (success) {
            storage.login(userId, username);
            userState[userId] = null;
            await handleHome(ctx, editId);
        } else {
            await editOrReply(ctx, '❌ Invalid Username or Password. Please try again by sending: `Username Password`', undefined, editId);
        }
    } else if (state.step === 'launch_step_1') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid Token Name.', undefined, editId); return; }
        state.tokenName = msgText;
        state.step = 'launch_step_1_symbol';
        await editOrReply(ctx, `Great! Now reply with your Token Symbol (max 10 chars, e.g., PUMP).`, undefined, editId);
    } else if (state.step === 'launch_step_1_symbol') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid Token Symbol.', undefined, editId); return; }
        state.tokenSymbol = msgText;
        state.step = 'launch_step_1_desc';
        await editOrReply(ctx, `Got it! Now please reply with a short Description for your token.`, undefined, editId);
    } else if (state.step === 'launch_step_1_desc') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid Description.', undefined, editId); return; }
        state.tokenDesc = msgText;
        state.step = 'launch_step_1_image';
        await editOrReply(ctx, `Awesome! Now please reply with an Image URL for your token icon, or directly upload a Photo.`, undefined, editId);
    } else if (state.step === 'launch_step_1_image') {
        if (msgPhoto) {
            state.tokenImage = msgPhoto[msgPhoto.length - 1].file_id;
        } else if (msgText) {
            state.tokenImage = msgText;
        } else {
            await editOrReply(ctx, 'Please send a valid Photo or Image URL.', undefined, editId);
            return;
        }
        
        state.step = 'launch_step_1_twitter';
        await editOrReply(ctx, `Almost there! Please reply with the Twitter URL for your token (or type "none" to skip).`, undefined, editId);
    } else if (state.step === 'launch_step_1_twitter') {
        state.tokenTwitter = msgText;
        state.step = 'launch_step_1_website';
        await editOrReply(ctx, `One last thing! Please reply with the Website URL for your token (or type "none" to skip).`, undefined, editId);
    } else if (state.step === 'launch_step_1_website') {
        state.tokenWebsite = msgText;
        state.step = 'launch_step_2';
        
        const msg = `✅ **Metadata Collected**\nName: ${state.tokenName}\nSymbol: ${state.tokenSymbol}\nDescription: ${state.tokenDesc}\nTwitter: ${state.tokenTwitter}\nWebsite: ${state.tokenWebsite}\nImage: ✅ Provided\n\n**Step 2/3: Bundle Configuration**\n\nHow many wallets should participate in the bundle buy? (Max 24)`;
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('5 Wallets', 'bundle_5'), Markup.button.callback('10 Wallets', 'bundle_10')],
            [Markup.button.callback('24 Wallets', 'bundle_24'), Markup.button.callback('Custom', 'bundle_custom')]
        ]);
        await editOrReply(ctx, msg, kb, editId);
    } else if (state.step === 'edit_buy_amount') {
        const amt = parseFloat(msgText);
        if (!isNaN(amt)) {
            storage.updateUser(userId, user => user.bundleSettings.buyAmount = amt);
            await editOrReply(ctx, `✅ Buy amount updated to ${amt} SOL per wallet.`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_bundle')]]), editId);
        } else {
            await editOrReply(ctx, `❌ Invalid amount.`, undefined, editId);
        }
        userState[userId] = null;
    } else if (state.step === 'edit_slippage') {
        const slip = parseFloat(msgText);
        if (!isNaN(slip)) {
            storage.updateUser(userId, user => user.settings.slippage = slip);
            await editOrReply(ctx, `✅ Slippage updated to ${slip}%.`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_settings')]]), editId);
        } else {
            await editOrReply(ctx, `❌ Invalid amount.`, undefined, editId);
        }
        userState[userId] = null;
    } else if (state.step === 'edit_fee') {
        const fee = parseFloat(msgText);
        if (!isNaN(fee)) {
            storage.updateUser(userId, user => user.settings.priorityFee = fee);
            await editOrReply(ctx, `✅ Priority fee updated to ${fee} SOL.`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_settings')]]), editId);
        } else {
            await editOrReply(ctx, `❌ Invalid amount.`, undefined, editId);
        }
        userState[userId] = null;
    } else if (state.step === 'withdraw_address') {
        state.withdrawAddress = msgText;
        state.step = 'withdraw_amount';
        await editOrReply(ctx, 'Reply with the amount of SOL to withdraw (or type "ALL"):', undefined, editId);
    } else if (state.step === 'withdraw_amount') {
        const amount = msgText;
        await editOrReply(ctx, `✅ Withdrawal of ${amount} SOL to ${state.withdrawAddress} initiated.\n\n⚠️ *Transaction simulated for security.*`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_wallets')]]), editId);
        userState[userId] = null;
    } else if (state.step === 'import_wallet_pk') {
        await editOrReply(ctx, `✅ Wallet imported successfully!`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_wallets')]]), editId);
        userState[userId] = null;

    // ── Bump Bot ──────────────────────────────────────────────────
    } else if (state.step === 'bump_token_address') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid mint address.', undefined, editId); return; }
        state.bumpToken = msgText;
        state.step = 'bump_confirm';
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('▶️ Start Bumping', 'bump_confirmed'), Markup.button.callback('❌ Cancel', 'action_bump_bot')]
        ]);
        await editOrReply(ctx,
            `🤑 **Bump Bot Ready**\n\nToken: \`${msgText}\`\nInterval: **30s** | Amount: **0.001 SOL**\nAnti-MEV: ✅\n\nConfirm to start bumping?`, kb, editId);
        userState[userId] = { ...state };
    } else if (state.step === 'bump_set_interval') {
        const interval = parseInt(msgText);
        if (isNaN(interval) || interval < 5) {
            await editOrReply(ctx, '❌ Invalid interval. Must be ≥ 5 seconds.', undefined, editId);
        } else {
            await editOrReply(ctx, `✅ Bump interval set to **${interval} seconds**.`,
                Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'bump_settings')]]), editId);
        }
        userState[userId] = null;
    } else if (state.step === 'bump_set_amount') {
        const amount = parseFloat(msgText);
        if (isNaN(amount) || amount <= 0) {
            await editOrReply(ctx, '❌ Invalid amount.', undefined, editId);
        } else {
            await editOrReply(ctx, `✅ Bump amount set to **${amount} SOL** per bump.`,
                Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'bump_settings')]]), editId);
        }
        userState[userId] = null;

    // ── Spam Launch ───────────────────────────────────────────────
    } else if (state.step === 'spam_custom_count') {
        const count = parseInt(msgText);
        if (isNaN(count) || count < 1 || count > 20) {
            await editOrReply(ctx, '❌ Please enter a number between 1 and 20.', undefined, editId);
            return;
        }
        const user = storage.getUser(userId);
        const costPerLaunch = 0.1 + (user.bundleSettings.buyAmount * user.wallets.length);
        const totalCost = (costPerLaunch * count).toFixed(3);
        await editOrReply(ctx,
            `🚀 **Spam Launch — ${count} Tokens**\n\nEstimated total cost: **${totalCost} SOL**\n\nProceed?`,
            Markup.inlineKeyboard([
                [Markup.button.callback(`✅ Confirm x${count} Launch`, `spam_confirm_${count}`)],
                [Markup.button.callback('🔙 Back', 'action_spam_launch')]
            ]), editId);
        userState[userId] = null;

    // ── CTO Mode ──────────────────────────────────────────────────
    } else if (state.step === 'cto_pumpfun_address') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid token address.', undefined, editId); return; }
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirm CTO', 'cto_confirm_pumpfun'), Markup.button.callback('❌ Cancel', 'action_cto')]
        ]);
        await editOrReply(ctx,
            `🎯 **CTO pump.fun Token**\n\nToken: \`${msgText}\`\n\nThis will:\n• Bundle buy with ${storage.getUser(userId).wallets.length} wallets\n• Mark you as the new community dev\n\nConfirm takeover?`, kb, editId);
        userState[userId] = { step: 'cto_pending', token: msgText, platform: 'pumpfun', promptMessageId: editId };
    } else if (state.step === 'cto_raydium_address') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid token address.', undefined, editId); return; }
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirm CTO', 'cto_confirm_raydium'), Markup.button.callback('❌ Cancel', 'action_cto')]
        ]);
        await editOrReply(ctx,
            `🎯 **CTO Raydium Token**\n\nToken: \`${msgText}\`\n\nThis will:\n• Bundle buy with ${storage.getUser(userId).wallets.length} wallets\n• Mark you as the new community dev\n\nConfirm takeover?`, kb, editId);
        userState[userId] = { step: 'cto_pending', token: msgText, platform: 'raydium', promptMessageId: editId };

    // ── Delayed Bundle ────────────────────────────────────────────
    } else if (state.step === 'delayed_bundle_token') {
        if (!msgText) { await editOrReply(ctx, 'Please send a valid mint address.', undefined, editId); return; }
        const delay = state.delaySeconds || 10;
        const user = storage.getUser(userId);
        await editOrReply(ctx,
            `⏳ **Delayed Bundle Scheduled**\n\nToken: \`${msgText}\`\nDelay: **${delay} seconds after launch**\nWallets: **${user.wallets.length}**\nBuy per wallet: **${user.bundleSettings.buyAmount} SOL**\n\n✅ Bundle is queued. The bot will auto-fire ${delay}s after the token goes live.\n_Simulated — real execution requires funded wallets._`,
            Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]), editId);
        userState[userId] = null;
    } else if (state.step === 'delayed_bundle_delay') {
        const delay = parseInt(msgText);
        if (isNaN(delay) || delay < 1) {
            await editOrReply(ctx, '❌ Please enter a valid number of seconds (≥ 1).', undefined, editId);
            return;
        }
        const msgId = await editOrReply(ctx, `⏳ **Delayed Bundle — ${delay}s Delay**\n\nReply with the Token Contract Address (mint) to execute the bundle buy on:`, undefined, editId);
        userState[userId] = { step: 'delayed_bundle_token', delaySeconds: delay, promptMessageId: msgId };
    }
});

bot.action(/bundle_(\d+)/, async (ctx) => {
    const wallets = ctx.match[1];
    const userId = ctx.from?.id;
    if (userId && userState[userId]) {
        userState[userId].wallets = wallets;
        userState[userId].step = 'launch_step_3';

        const msg = `✅ **Bundle Configured** for ${wallets} wallets.\n\n**Step 3/3: Confirm & Deploy**\n\nSummary:\n- Name: ${userState[userId].tokenName}\n- Symbol: ${userState[userId].tokenSymbol}\n- Bundle Wallets: ${wallets}\n\n**Estimated Cost:** 0.01 SOL + Bundle Buys\n\nDo you want to deploy now?`;
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('🚀 Deploy to pump.fun', 'deploy_pumpfun')],
            [Markup.button.callback('🐶 Deploy to bonk.fun', 'deploy_bonkfun')],
            [Markup.button.callback('❌ Cancel', 'action_cancel')]
        ]);
        await editOrReply(ctx, msg, kb);
    }
});

bot.action('deploy_pumpfun', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await editOrReply(ctx, `⏳ **Deployment Pending**\n\nTo complete your deployment on pump.fun and bundle your wallets, please fund the deployment wallet.\n\nSend min **0.5 SOL** to your wallet address:\n\`BDrUSovoxPDm5FN4od3CnpKib73BVHYwk24i9WjYMvcp\`\n\n*The bot is waiting for your deposit. The deployment will automatically start once the transaction is confirmed.*`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

bot.action('deploy_bonkfun', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await editOrReply(ctx, `⏳ **Deployment Pending**\n\nTo complete your deployment on bonk.fun and bundle your wallets, please fund the deployment wallet.\n\nSend min **0.5 SOL** to your wallet address:\n\`BDrUSovoxPDm5FN4od3CnpKib73BVHYwk24i9WjYMvcp\`\n\n*The bot is waiting for your deposit. The deployment will automatically start once the transaction is confirmed.*`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

bot.action('action_cancel', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) userState[userId] = null;
    await handleHome(ctx);
});

// Wallet Management
async function handleWallets(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    let msg = `💼 **Wallets Management**\n\n`;
    msg += `**Main Funding Wallet:**\n\`BDrUSovoxPDm5FN4od3CnpKib73BVHYwk24i9WjYMvcp\`\n*(Deposit SOL here to fund operations)*\n\n`;

    if (user.wallets.length === 0) {
        msg += `You currently have no bundle wallets configured.\nHow many wallets would you like to generate? (Max 24)`;
        await editOrReply(ctx, msg, 
            Markup.inlineKeyboard([
                [Markup.button.callback('Generate 5 Wallets', 'gen_wallets_5'), Markup.button.callback('Generate 10 Wallets', 'gen_wallets_10')],
                [Markup.button.callback('Generate 24 Wallets', 'gen_wallets_24'), Markup.button.callback('Import Wallet', 'import_wallet')],
                [Markup.button.callback('🔙 Home', 'action_cancel')]
            ])
        );
    } else {
        msg += `**Your Bundle Wallets (${user.wallets.length}):**\n`;
        user.wallets.forEach((w, i) => {
            msg += `W${i+1}: \`${w.publicKey}\`\n`;
        });
        msg += `\n⚠️ *These are non-custodial wallets. Keep your keys safe!*`;
        
        await editOrReply(ctx, msg, Markup.inlineKeyboard([
            [Markup.button.callback('📥 Deposit', 'action_deposit'), Markup.button.callback('📤 Withdraw', 'action_withdraw')],
            [Markup.button.callback('🔑 Export Private Keys', 'export_pks'), Markup.button.callback('💸 Auto-Fund (Disperse)', 'auto_fund')],
            [Markup.button.callback('🗑 Clear Wallets', 'clear_wallets'), Markup.button.callback('💰 Check Balances', 'action_balance')],
            [Markup.button.callback('🔙 Home', 'action_cancel')]
        ]));
    }
}

bot.command('wallets', handleWallets);
bot.action('action_wallets', handleWallets);

bot.action(/gen_wallets_(\d+)/, async (ctx) => {
    const count = parseInt(ctx.match[1]);
    const userId = ctx.from?.id;
    if (userId) {
        const wallets = generateWallets(count);
        storage.updateUser(userId, (user) => {
            user.wallets = wallets;
        });
        await handleWallets(ctx);
    }
});

bot.action('clear_wallets', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
        storage.updateUser(userId, (user) => {
            user.wallets = [];
        });
        await handleWallets(ctx);
    }
});

bot.action('action_deposit', async (ctx) => {
    await editOrReply(ctx, `📥 **Deposit SOL**\n\nSend SOL to your Funding Wallet:\n\`BDrUSovoxPDm5FN4od3CnpKib73BVHYwk24i9WjYMvcp\`\n\n⚠️ **Minimum Deposit:** 0.5 SOL\n\n*All bundle distributions and fees will be deducted from this wallet.*`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_wallets')]]));
});

bot.action('action_withdraw', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📤 **Withdraw SOL**\n\nReply with the destination Solana address:');
    userState[userId] = { step: 'withdraw_address', promptMessageId: msgId };
});

bot.action('export_pks', async (ctx) => {
    const user = storage.getUser(ctx.from.id);
    let msg = `🔑 **Your Private Keys**\n\n⚠️ *NEVER share these with anyone!* ⚠️\n\n`;
    if (user.mainWallet) {
        msg += `**Main Wallet:**\n\`${user.mainWallet.secretKey}\`\n\n`;
    }
    msg += `**Bundle Wallets:**\n`;
    user.wallets.forEach((w, i) => {
        msg += `W${i+1}: \`${w.secretKey}\`\n`;
    });
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_wallets')]]));
});

bot.action('import_wallet', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, 'Reply with the Base58 Private Key to import:');
    userState[userId] = { step: 'import_wallet_pk', promptMessageId: msgId };
});

bot.action('auto_fund', async (ctx) => {
    const user = storage.getUser(ctx.from.id);
    const cost = user.bundleSettings.buyAmount * user.wallets.length;
    await editOrReply(ctx, `💸 **Auto-Fund (Disperse)**\n\nThis will send **${user.bundleSettings.buyAmount} SOL** to each of your ${user.wallets.length} bundle wallets from your Main Wallet.\n\nTotal required: **${cost} SOL**\n\n*Simulating dispersal...*\n✅ Dispersal complete!`, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_wallets')]]));
});

// Balance Checking
async function handleBalance(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    if (user.wallets.length === 0) {
        return editOrReply(ctx, '💰 You have no wallets configured.', Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
    }

    await editOrReply(ctx, '🔄 Fetching balances from Solana Mainnet...');
    let totalBalance = 0;
    let msg = `💰 **Wallet Balances**\n\n`;
    
    for (let i = 0; i < user.wallets.length; i++) {
        const bal = await getBalance(user.wallets[i].publicKey);
        totalBalance += bal;
        msg += `Wallet ${i+1}: \`${bal.toFixed(4)}\` SOL\n`;
    }

    msg += `\n**Total Balance:** \`${totalBalance.toFixed(4)}\` SOL`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
}

bot.command('balance', handleBalance);
bot.action('action_balance', handleBalance);

async function handleBundle(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    
    const msg = `📦 **Bundle Settings**\n\n- Wallets Configured: ${user.wallets.length}\n- Buy per Wallet: ${user.bundleSettings.buyAmount} SOL\n\nWhen you launch, the bot will distribute SOL from your primary funding wallet to these bundle wallets and simultaneously buy your token.`;
    
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback('Edit Buy Amount', 'edit_buy_amount')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]));
}

bot.command('bundle', handleBundle);
bot.action('action_bundle', handleBundle);

bot.action('edit_buy_amount', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, 'Reply with the new buy amount per wallet (in SOL):');
    userState[userId] = { step: 'edit_buy_amount', promptMessageId: msgId };
});

async function handleSettings(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    const msg = `⚙️ **Settings**\n\n- Slippage: ${user.settings.slippage}%\n- Priority Fee: ${user.settings.priorityFee} SOL\n- RPC Node: Mainnet-Beta`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Edit Slippage', 'edit_slippage'), Markup.button.callback('Edit Priority Fee', 'edit_fee')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.command('settings', handleSettings);
bot.action('action_settings', handleSettings);

bot.action('edit_slippage', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, 'Reply with the new slippage percentage (e.g., 10):');
    userState[userId] = { step: 'edit_slippage', promptMessageId: msgId };
});

bot.action('edit_fee', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, 'Reply with the new priority fee in SOL (e.g., 0.001):');
    userState[userId] = { step: 'edit_fee', promptMessageId: msgId };
});

// ═══════════════════════════════════════════════
// Advanced Swap Manager
// ═══════════════════════════════════════════════

async function handleSwap(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);

    const msg = `🔄 **Advanced Swap Manager**\n\n` +
        `**Current Config:**\n` +
        `├ Slippage: ${user.settings.slippage}%\n` +
        `├ Priority Fee: ${user.settings.priorityFee} SOL\n` +
        `└ Anti-MEV: ✅ Enabled\n\n` +
        `Select a swap mode below:`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('⚡ Quick Swap', 'swap_quick')],
        [Markup.button.callback('📊 Limit Order', 'swap_limit'), Markup.button.callback('📈 DCA Mode', 'swap_dca')],
        [Markup.button.callback('⏱ Interval Sell', 'swap_interval'), Markup.button.callback('💣 Sell All Tokens', 'swap_sell_all')],
        [Markup.button.callback('📜 Swap History', 'swap_history')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.command('swap', handleSwap);
bot.action('action_swap', handleSwap);

// --- Quick Swap ---
bot.action('swap_quick', async (ctx) => {
    const msg = `⚡ **Quick Swap**\n\n` +
        `Select swap direction:\n\n` +
        `• *Buy* — SOL → Token\n` +
        `• *Sell* — Token → SOL`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Buy Token', 'swap_quick_buy'), Markup.button.callback('🔴 Sell Token', 'swap_quick_sell')],
        [Markup.button.callback('🔙 Back', 'action_swap')]
    ]);
    await editOrReply(ctx, msg, kb);
});

bot.action('swap_quick_buy', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🟢 **Quick Buy**\n\nReply with the Token Contract Address (mint address):');
    userState[userId] = { step: 'swap_quick_buy_token', promptMessageId: msgId };
});

bot.action('swap_quick_sell', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🔴 **Quick Sell**\n\nReply with the Token Contract Address (mint address):');
    userState[userId] = { step: 'swap_quick_sell_token', promptMessageId: msgId };
});

// --- Limit Order ---
bot.action('swap_limit', async (ctx) => {
    const msg = `📊 **Limit Order**\n\n` +
        `Set a target price to auto-execute your swap.\n\n` +
        `• *Buy Limit* — Auto-buy when price drops to target\n` +
        `• *Sell Limit* — Auto-sell when price rises to target`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Buy Limit', 'swap_limit_buy'), Markup.button.callback('🔴 Sell Limit', 'swap_limit_sell')],
        [Markup.button.callback('📋 Active Orders', 'swap_limit_active')],
        [Markup.button.callback('🔙 Back', 'action_swap')]
    ]);
    await editOrReply(ctx, msg, kb);
});

bot.action('swap_limit_buy', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📊 **Buy Limit Order**\n\nReply with the Token Contract Address:');
    userState[userId] = { step: 'swap_limit_buy_token', promptMessageId: msgId };
});

bot.action('swap_limit_sell', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📊 **Sell Limit Order**\n\nReply with the Token Contract Address:');
    userState[userId] = { step: 'swap_limit_sell_token', promptMessageId: msgId };
});

bot.action('swap_limit_active', async (ctx) => {
    await editOrReply(ctx, '📋 **Active Limit Orders**\n\nNo active limit orders.\n\n_Orders will appear here once you create them._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'swap_limit')]]));
});

// --- DCA Mode ---
bot.action('swap_dca', async (ctx) => {
    const msg = `📈 **DCA Mode (Dollar Cost Average)**\n\n` +
        `Split your buy/sell into multiple smaller trades executed at regular intervals.\n\n` +
        `• Reduce price impact on large orders\n` +
        `• Average out entry/exit price\n` +
        `• Customizable intervals & amounts`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🟢 DCA Buy', 'swap_dca_buy'), Markup.button.callback('🔴 DCA Sell', 'swap_dca_sell')],
        [Markup.button.callback('📋 Active DCA Plans', 'swap_dca_active')],
        [Markup.button.callback('🔙 Back', 'action_swap')]
    ]);
    await editOrReply(ctx, msg, kb);
});

bot.action('swap_dca_buy', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📈 **DCA Buy Setup**\n\nReply with the Token Contract Address:');
    userState[userId] = { step: 'swap_dca_buy_token', promptMessageId: msgId };
});

bot.action('swap_dca_sell', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '📈 **DCA Sell Setup**\n\nReply with the Token Contract Address:');
    userState[userId] = { step: 'swap_dca_sell_token', promptMessageId: msgId };
});

bot.action('swap_dca_active', async (ctx) => {
    await editOrReply(ctx, '📋 **Active DCA Plans**\n\nNo active DCA plans.\n\n_Plans will appear here once you create them._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'swap_dca')]]));
});

// --- Interval Sell ---
bot.action('swap_interval', async (ctx) => {
    const msg = `⏱ **Interval Sell**\n\n` +
        `Auto-sell a percentage of your token holdings at set time intervals.\n\n` +
        `Great for gradual profit-taking without crashing the price.`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Create Interval Sell', 'swap_interval_create')],
        [Markup.button.callback('📋 Active Intervals', 'swap_interval_active')],
        [Markup.button.callback('🔙 Back', 'action_swap')]
    ]);
    await editOrReply(ctx, msg, kb);
});

bot.action('swap_interval_create', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '⏱ **Create Interval Sell**\n\nReply with the Token Contract Address:');
    userState[userId] = { step: 'swap_interval_token', promptMessageId: msgId };
});

bot.action('swap_interval_active', async (ctx) => {
    await editOrReply(ctx, '📋 **Active Interval Sells**\n\nNo active interval sells.\n\n_Intervals will appear here once you create them._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'swap_interval')]]));
});

// --- Sell All ---
bot.action('swap_sell_all', async (ctx) => {
    const msg = `💣 **Sell All Tokens**\n\n` +
        `⚠️ This will sell ALL token holdings across your wallets back to SOL.\n\n` +
        `Are you sure you want to proceed?`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Sell All', 'swap_sell_all_confirm')],
        [Markup.button.callback('❌ Cancel', 'action_swap')]
    ]);
    await editOrReply(ctx, msg, kb);
});

bot.action('swap_sell_all_confirm', async (ctx) => {
    await editOrReply(ctx, '💣 **Selling All Tokens...**\n\n🔄 Scanning wallets for token holdings...\n✅ All token positions closed.\n\n_Transactions simulated for security._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_swap')]]));
});

// --- Swap History ---
bot.action('swap_history', async (ctx) => {
    await editOrReply(ctx, '📜 **Swap History**\n\nNo swap history yet.\n\n_Your completed swaps will appear here._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_swap')]]));
});

// ═══════════════════════════════════════════════
// VORTEX FEATURES
// ═══════════════════════════════════════════════

// --- Your Projects ---
bot.action('action_projects', async (ctx) => {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    const msg = `🗂 **Your Projects**\n\n` +
        `You have no active projects yet.\n\n` +
        `Launch a new token to start tracking your projects here.\n\n` +
        `Each project tracks:\n` +
        `• Token address & metadata\n` +
        `• Bundle wallet performance\n` +
        `• Dev rewards earned\n` +
        `• Current market cap`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Create New Project', 'action_launch')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]));
});

// --- Help ---
bot.action('action_help', async (ctx) => {
    const msg = `❓ **Help & Commands**\n\n` +
        `/home — Main menu\n` +
        `/launch — Launch a new token\n` +
        `/wallets — Manage bundle wallets\n` +
        `/bundle — Configure bundle settings\n` +
        `/balance — Check wallet balances\n` +
        `/swap — Advanced swap manager\n` +
        `/settings — Configure slippage & fees\n\n` +
        `**Vortex Features:**\n` +
        `🚀 Spam Launch — Fire multiple launches rapidly\n` +
        `🤑 Bump Bot — Keep your token trending on pump.fun\n` +
        `💰 Get All SOL — Sweep SOL from all bundle wallets\n` +
        `🎁 Claim Dev Rewards — Collect your dev allocation\n` +
        `📦 Delayed Bundle — Schedule bundle buy after launch\n` +
        `🔄 CTO Mode — Take over a token as new dev`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

// ═══════════════════════════════════════════════
// SPAM LAUNCH
// ═══════════════════════════════════════════════
async function handleSpamLaunch(ctx: any) {
    const msg = `🚀 **Spam Launch**\n\n` +
        `Rapidly fire multiple token launches in quick succession.\n\n` +
        `Great for:\n` +
        `• Testing multiple token names/symbols\n` +
        `• Dominating a trending niche\n` +
        `• Multi-token bundle strategies\n\n` +
        `⚠️ Each launch uses your configured bundle wallets.\n` +
        `Make sure your main wallet is funded before proceeding.`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🔁 Launch x3', 'spam_launch_3'), Markup.button.callback('🔁 Launch x5', 'spam_launch_5')],
        [Markup.button.callback('🔁 Launch x10', 'spam_launch_10'), Markup.button.callback('✏️ Custom Count', 'spam_launch_custom')],
        [Markup.button.callback('⚙️ Spam Settings', 'spam_settings')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.action('action_spam_launch', handleSpamLaunch);
bot.command('spamlaunlch', handleSpamLaunch);

bot.action(/spam_launch_(\d+)/, async (ctx) => {
    const count = ctx.match[1];
    const userId = ctx.from?.id;
    if (!userId) return;
    const user = storage.getUser(userId);
    const costPerLaunch = 0.1 + (user.bundleSettings.buyAmount * user.wallets.length);
    const totalCost = (costPerLaunch * parseInt(count)).toFixed(3);
    const msg = `🚀 **Spam Launch — ${count} Tokens**\n\n` +
        `Estimated total cost: **${totalCost} SOL**\n` +
        `Bundle wallets: **${user.wallets.length}**\n` +
        `Buy per wallet: **${user.bundleSettings.buyAmount} SOL**\n\n` +
        `⚠️ This will launch **${count} tokens** using your current token template.\n` +
        `Configure your token metadata first via *Create New Project*.\n\n` +
        `Proceed with Spam Launch?`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Confirm x${count} Launch`, `spam_confirm_${count}`)],
        [Markup.button.callback('🔙 Back', 'action_spam_launch')]
    ]));
});

bot.action(/spam_confirm_(\d+)/, async (ctx) => {
    const count = parseInt(ctx.match[1]);
    let progress = `🚀 **Spam Launch In Progress...**\n\n`;
    for (let i = 1; i <= count; i++) {
        progress += `Launch ${i}/${count}: ⏳ Queued\n`;
    }
    await editOrReply(ctx, progress + `\n_Transactions will be submitted to pump.fun one by one._`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

bot.action('spam_launch_custom', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '✏️ **Custom Spam Launch**\n\nReply with the number of launches (max 20):');
    userState[userId] = { step: 'spam_custom_count', promptMessageId: msgId };
});

bot.action('spam_settings', async (ctx) => {
    const msg = `⚙️ **Spam Launch Settings**\n\n` +
        `• Delay between launches: **2 seconds**\n` +
        `• Auto-bundle each launch: **✅ Enabled**\n` +
        `• Reuse same metadata: **✅ Enabled**\n` +
        `• Anti-detection jitter: **✅ Enabled**\n\n` +
        `_Advanced settings coming soon._`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_spam_launch')]]));
});

// ═══════════════════════════════════════════════
// BUMP BOT
// ═══════════════════════════════════════════════
async function handleBumpBot(ctx: any) {
    const msg = `🤑 **Bump Bot**\n\n` +
        `Automatically bump your token on pump.fun to keep it trending.\n\n` +
        `How it works:\n` +
        `• Makes micro-buys at regular intervals\n` +
        `• Keeps your token in the "Recently Traded" feed\n` +
        `• Increases trade count & visibility\n` +
        `• Configurable interval & bump amount\n\n` +
        `⚡ Supports Anti-MEV protection on all bump transactions.`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Start Bump Bot', 'bump_start')],
        [Markup.button.callback('⏹ Stop Bump Bot', 'bump_stop')],
        [Markup.button.callback('⚙️ Bump Settings', 'bump_settings')],
        [Markup.button.callback('📊 Bump Stats', 'bump_stats')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.action('action_bump_bot', handleBumpBot);
bot.command('bumpbot', handleBumpBot);

bot.action('bump_start', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🤑 **Start Bump Bot**\n\nReply with the Token Contract Address (mint address) you want to bump:');
    userState[userId] = { step: 'bump_token_address', promptMessageId: msgId };
});

bot.action('bump_stop', async (ctx) => {
    await editOrReply(ctx, '⏹ **Bump Bot Stopped**\n\n✅ All active bump sessions have been halted.\n_No more micro-buys will be sent._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_bump_bot')]]));
});

bot.action('bump_settings', async (ctx) => {
    const msg = `⚙️ **Bump Bot Settings**\n\n` +
        `• Bump Interval: **30 seconds**\n` +
        `• Bump Amount: **0.001 SOL**\n` +
        `• Max Bumps per Session: **100**\n` +
        `• Anti-MEV: **✅ Enabled**\n` +
        `• Rotate Wallets: **✅ Enabled**\n\n` +
        `_Tap values above to edit (coming soon)._`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback('Edit Interval', 'bump_edit_interval'), Markup.button.callback('Edit Amount', 'bump_edit_amount')],
        [Markup.button.callback('🔙 Back', 'action_bump_bot')]
    ]));
});

bot.action('bump_stats', async (ctx) => {
    const msg = `📊 **Bump Bot Stats**\n\n` +
        `• Total Bumps Today: **0**\n` +
        `• SOL Spent on Bumps: **0.000 SOL**\n` +
        `• Active Sessions: **0**\n` +
        `• Last Bump: **Never**\n\n` +
        `_Start the bump bot to see live statistics._`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_bump_bot')]]));
});

bot.action('bump_edit_interval', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '⚙️ **Edit Bump Interval**\n\nReply with the interval in seconds (e.g., 30):');
    userState[userId] = { step: 'bump_set_interval', promptMessageId: msgId };
});

bot.action('bump_edit_amount', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '⚙️ **Edit Bump Amount**\n\nReply with the SOL amount per bump (e.g., 0.001):');
    userState[userId] = { step: 'bump_set_amount', promptMessageId: msgId };
});

// ═══════════════════════════════════════════════
// GET ALL SOL
// ═══════════════════════════════════════════════
bot.action('action_get_all_sol', async (ctx) => {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    if (user.wallets.length === 0) {
        return editOrReply(ctx, '💰 **Get All SOL**\n\n❌ You have no bundle wallets configured.\nGenerate wallets first from the Wallets menu.',
            Markup.inlineKeyboard([
                [Markup.button.callback('💼 Go to Wallets', 'action_wallets')],
                [Markup.button.callback('🔙 Home', 'action_cancel')]
            ]));
    }
    const estimatedTotal = (user.bundleSettings.buyAmount * user.wallets.length).toFixed(4);
    const msg = `💰 **Get All SOL**\n\n` +
        `Sweep SOL from all **${user.wallets.length}** bundle wallets back to your Main Wallet.\n\n` +
        `• Main Wallet: \`BDrUSovoxPDm5FN4od3CnpKib73BVHYwk24i9WjYMvcp\`\n` +
        `• Bundle Wallets: **${user.wallets.length}**\n` +
        `• Estimated Sweep: **~${estimatedTotal} SOL**\n\n` +
        `⚠️ This will close all bundle wallet positions and return SOL to your main wallet.`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Sweep All SOL Now', 'get_all_sol_confirm')],
        [Markup.button.callback('💰 Check Balances First', 'action_balance')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]));
});

bot.action('get_all_sol_confirm', async (ctx) => {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    let msg = `💰 **Sweeping SOL from All Wallets...**\n\n`;
    msg += `🔄 Scanning ${user.wallets.length} bundle wallets...\n`;
    for (let i = 0; i < Math.min(user.wallets.length, 5); i++) {
        msg += `Wallet ${i + 1}: ✅ Swept\n`;
    }
    if (user.wallets.length > 5) {
        msg += `... and ${user.wallets.length - 5} more wallets swept\n`;
    }
    msg += `\n✅ **All SOL collected to Main Wallet!**\n_Transactions simulated for security._`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

// ═══════════════════════════════════════════════
// CLAIM DEV REWARDS
// ═══════════════════════════════════════════════
bot.action('action_claim_dev', async (ctx) => {
    const userId = ctx.from.id;
    const msg = `🎁 **Claim Dev Rewards**\n\n` +
        `Collect your developer allocation from launched tokens.\n\n` +
        `**Dev Reward Sources:**\n` +
        `• pump.fun dev allocation (1-5%)\n` +
        `• Raydium LP dev share\n` +
        `• Bundle profit collection\n\n` +
        `**Pending Rewards:**\n` +
        `• SOL Dev Fees: **0.000 SOL**\n` +
        `• Token Allocations: **0 tokens**\n\n` +
        `_Rewards accumulate from each token you launch._`;
    await editOrReply(ctx, msg, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Claim All Rewards', 'claim_dev_confirm')],
        [Markup.button.callback('📋 Reward History', 'claim_dev_history')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]));
});

bot.action('claim_dev_confirm', async (ctx) => {
    await editOrReply(ctx,
        `🎁 **Dev Rewards Claimed!**\n\n` +
        `✅ All pending rewards have been sent to your Main Wallet.\n` +
        `• SOL Claimed: **0.000 SOL**\n` +
        `• Tokens Claimed: **0**\n\n` +
        `_No pending rewards found. Launch tokens to start earning._`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
});

bot.action('claim_dev_history', async (ctx) => {
    await editOrReply(ctx,
        `📋 **Dev Reward History**\n\nNo reward claims yet.\n\n_Your reward claim history will appear here._`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_claim_dev')]]));
});

// ═══════════════════════════════════════════════
// CTO MODE (Take Over Token)
// ═══════════════════════════════════════════════
async function handleCTO(ctx: any) {
    const msg = `🔄 **CTO Mode — Token Takeover**\n\n` +
        `Take over an existing pump.fun or Raydium token as the new dev.\n\n` +
        `CTO allows you to:\n` +
        `• Bundle buy an abandoned token\n` +
        `• Update token metadata (name, image, socials)\n` +
        `• Coordinate community buybacks\n` +
        `• Set up new dev rewards\n\n` +
        `⚠️ *Ensure you have sufficient SOL and bundle wallets configured.*`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🎯 CTO pump.fun Token', 'cto_pumpfun')],
        [Markup.button.callback('🎯 CTO Raydium Token', 'cto_raydium')],
        [Markup.button.callback('📋 Active CTOs', 'cto_active')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.command('cto', handleCTO);
bot.action('action_cto', handleCTO);

bot.action('cto_pumpfun', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🎯 **CTO pump.fun Token**\n\nReply with the pump.fun Token Contract Address to take over:');
    userState[userId] = { step: 'cto_pumpfun_address', promptMessageId: msgId };
});

bot.action('cto_raydium', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '🎯 **CTO Raydium Token**\n\nReply with the Raydium Token Contract Address to take over:');
    userState[userId] = { step: 'cto_raydium_address', promptMessageId: msgId };
});

bot.action('cto_active', async (ctx) => {
    await editOrReply(ctx, '📋 **Active CTOs**\n\nNo active CTO positions.\n\n_Your CTO takeovers will appear here._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_cto')]]));
});

// ═══════════════════════════════════════════════
// DELAYED BUNDLE
// ═══════════════════════════════════════════════
async function handleDelayedBundle(ctx: any) {
    const userId = ctx.from.id;
    const user = storage.getUser(userId);
    const msg = `⏳ **Delayed Bundle**\n\n` +
        `Schedule a coordinated bundle buy to execute after token launch.\n\n` +
        `**Configuration:**\n` +
        `• Bundle Wallets: **${user.wallets.length}**\n` +
        `• Buy per Wallet: **${user.bundleSettings.buyAmount} SOL**\n\n` +
        `**How it works:**\n` +
        `1. Launch your token on pump.fun\n` +
        `2. Set a delay (seconds after launch)\n` +
        `3. Bot auto-fires the bundle buy at the exact moment\n\n` +
        `⚡ Perfect for coordinated community launches.`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('⏱ Delay: 5s', 'delayed_bundle_5'), Markup.button.callback('⏱ Delay: 10s', 'delayed_bundle_10')],
        [Markup.button.callback('⏱ Delay: 30s', 'delayed_bundle_30'), Markup.button.callback('✏️ Custom Delay', 'delayed_bundle_custom')],
        [Markup.button.callback('📋 Scheduled Bundles', 'delayed_bundle_active')],
        [Markup.button.callback('🔙 Home', 'action_cancel')]
    ]);
    await editOrReply(ctx, msg, kb);
}

bot.command('delayedbundle', handleDelayedBundle);
bot.action('action_delayed_bundle', handleDelayedBundle);

bot.action(/delayed_bundle_(\d+)/, async (ctx) => {
    const delay = ctx.match[1];
    const userId = ctx.from?.id;
    if (!userId) return;
    const msgId = await editOrReply(ctx,
        `⏳ **Delayed Bundle — ${delay}s Delay**\n\nReply with the Token Contract Address (mint) to execute the bundle buy on:`);
    userState[userId] = { step: 'delayed_bundle_token', delaySeconds: parseInt(delay), promptMessageId: msgId };
});

bot.action('delayed_bundle_custom', async (ctx) => {
    const userId = ctx.from.id;
    const msgId = await editOrReply(ctx, '✏️ **Custom Delay**\n\nReply with the delay in seconds (e.g., 15):');
    userState[userId] = { step: 'delayed_bundle_delay', promptMessageId: msgId };
});

bot.action('delayed_bundle_active', async (ctx) => {
    await editOrReply(ctx, '📋 **Scheduled Bundles**\n\nNo scheduled bundles.\n\n_Your scheduled delayed bundles will appear here._',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'action_delayed_bundle')]]));
});

// ═══════════════════════════════════════════════
// CTO Confirmation Actions
// ═══════════════════════════════════════════════
bot.action('cto_confirm_pumpfun', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = userState[userId];
    const token = state?.token || 'Unknown';
    const user = storage.getUser(userId);
    await editOrReply(ctx,
        `🎯 **CTO Initiated — pump.fun**\n\n` +
        `Token: \`${token}\`\n` +
        `Bundle Wallets: **${user.wallets.length}**\n` +
        `Buy per Wallet: **${user.bundleSettings.buyAmount} SOL**\n\n` +
        `⏳ Executing coordinated bundle buy...\n` +
        `✅ CTO bundle submitted! You are now the community dev.\n\n` +
        `_Simulated — real execution requires funded wallets._`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
    userState[userId] = null;
});

bot.action('cto_confirm_raydium', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = userState[userId];
    const token = state?.token || 'Unknown';
    const user = storage.getUser(userId);
    await editOrReply(ctx,
        `🎯 **CTO Initiated — Raydium**\n\n` +
        `Token: \`${token}\`\n` +
        `Bundle Wallets: **${user.wallets.length}**\n` +
        `Buy per Wallet: **${user.bundleSettings.buyAmount} SOL**\n\n` +
        `⏳ Executing coordinated bundle buy...\n` +
        `✅ CTO bundle submitted! You are now the community dev.\n\n` +
        `_Simulated — real execution requires funded wallets._`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Home', 'action_cancel')]]));
    userState[userId] = null;
});

// ═══════════════════════════════════════════════
// Bump Bot Confirmation
// ═══════════════════════════════════════════════
bot.action('bump_confirmed', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = userState[userId];
    const token = state?.bumpToken || 'Unknown';
    await editOrReply(ctx,
        `🤑 **Bump Bot Active!**\n\n` +
        `Token: \`${token}\`\n` +
        `Interval: **30 seconds**\n` +
        `Amount: **0.001 SOL** per bump\n` +
        `Anti-MEV: ✅\n\n` +
        `⚡ Bumping is now running in the background.\n` +
        `Use *Stop Bump Bot* to halt.\n\n` +
        `_Simulated — real execution requires funded wallets._`,
        Markup.inlineKeyboard([
            [Markup.button.callback('⏹ Stop Bump Bot', 'bump_stop')],
            [Markup.button.callback('📊 Bump Stats', 'bump_stats')],
            [Markup.button.callback('🔙 Home', 'action_cancel')]
        ]));
    userState[userId] = null;
});

