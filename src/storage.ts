import fs from 'fs';
import path from 'path';
import { WalletData } from './solana';

export interface UserData {
    username?: string;
    password?: string;
    mainWallet?: WalletData;
    wallets: WalletData[];
    bundleSettings: {
        walletsToUse: number;
        buyAmount: number; // SOL per wallet
    };
    settings: {
        slippage: number; // %
        priorityFee: number; // SOL
    };
}

const STORAGE_FILE = path.join(__dirname, '..', 'users.json');

export class Storage {
    public data: Record<string, UserData> = {};
    public sessions: Record<number, string> = {};

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STORAGE_FILE)) {
            try {
                const fileContent = fs.readFileSync(STORAGE_FILE, 'utf-8');
                const parsed = JSON.parse(fileContent);
                if (parsed.data) {
                    this.data = parsed.data;
                    this.sessions = parsed.sessions || {};
                }
            } catch (error) {
                console.error('Failed to load user data:', error);
            }
        }
    }

    private save() {
        try {
            fs.writeFileSync(STORAGE_FILE, JSON.stringify({ data: this.data, sessions: this.sessions }, null, 2));
        } catch (error) {
            console.error('Failed to save user data:', error);
        }
    }

    public createAccount(username: string, password: string): boolean {
        if (this.data[username]) return false;
        
        const { generateWallets } = require('./solana');
        this.data[username] = {
            username,
            password,
            mainWallet: generateWallets(1)[0],
            wallets: [],
            bundleSettings: {
                walletsToUse: 0,
                buyAmount: 0.1,
            },
            settings: {
                slippage: 10,
                priorityFee: 0.001,
            }
        };
        this.save();
        return true;
    }

    public verifyAccount(username: string, password: string): boolean {
        const user = this.data[username];
        if (!user) return false;
        return user.password === password;
    }

    public login(telegramId: number, username: string) {
        this.sessions[telegramId] = username;
        this.save();
    }

    public logout(telegramId: number) {
        delete this.sessions[telegramId];
        this.save();
    }

    public getSessionUser(telegramId: number): UserData | null {
        const username = this.sessions[telegramId];
        if (!username) return null;
        return this.data[username] || null;
    }

    public getUser(telegramId: number): UserData {
        const user = this.getSessionUser(telegramId);
        if (!user) throw new Error("User not authenticated");
        return user;
    }

    public updateUser(userId: number, updateFn: (user: UserData) => void) {
        const user = this.getUser(userId);
        updateFn(user);
        this.save();
    }
}

export const storage = new Storage();
