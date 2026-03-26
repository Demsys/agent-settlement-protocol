import { ethers } from 'ethers';
export declare function encryptPrivateKey(privateKey: string): string;
export declare function decryptPrivateKey(encrypted: string): string;
export interface GeneratedWallet {
    address: string;
    privateKey: string;
    encryptedPrivateKey: string;
}
export declare function generateWallet(): GeneratedWallet;
export declare function walletFromEncrypted(encryptedPrivateKey: string, provider: ethers.Provider): ethers.Wallet;
//# sourceMappingURL=wallet.d.ts.map