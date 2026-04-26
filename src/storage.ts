import fs from 'fs';
import path from 'path';
import { WalletData } from './solana';

export interface UserData {
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
    private data: Record<number, UserData> = {};

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STORAGE_FILE)) {
            try {
                const fileContent = fs.readFileSync(STORAGE_FILE, 'utf-8');
                this.data = JSON.parse(fileContent);
            } catch (error) {
                console.error('Failed to load user data:', error);
            }
        }
    }

    private save() {
        try {
            fs.writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('Failed to save user data:', error);
        }
    }

    public getUser(userId: number): UserData {
        if (!this.data[userId]) {
            const { generateWallets } = require('./solana');
            this.data[userId] = {
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
        } else if (!this.data[userId].mainWallet) {
            const { generateWallets } = require('./solana');
            this.data[userId].mainWallet = generateWallets(1)[0];
            this.save();
        }
        return this.data[userId];
    }

    public updateUser(userId: number, updateFn: (user: UserData) => void) {
        const user = this.getUser(userId);
        updateFn(user);
        this.save();
    }
}

export const storage = new Storage();
