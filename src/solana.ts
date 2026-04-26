import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const connection = new Connection(RPC_URL, 'confirmed');

export interface WalletData {
    publicKey: string;
    secretKey: string;
}

/**
 * Generates a specified number of new Solana wallets.
 */
export function generateWallets(count: number): WalletData[] {
    const wallets: WalletData[] = [];
    for (let i = 0; i < count; i++) {
        const keypair = Keypair.generate();
        wallets.push({
            publicKey: keypair.publicKey.toBase58(),
            secretKey: bs58.encode(keypair.secretKey),
        });
    }
    return wallets;
}

/**
 * Fetches the SOL balance for a given public key.
 */
export async function getBalance(publicKeyBase58: string): Promise<number> {
    try {
        const pubKey = new PublicKey(publicKeyBase58);
        const balance = await connection.getBalance(pubKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        console.error(`Failed to get balance for ${publicKeyBase58}:`, error);
        return 0;
    }
}
