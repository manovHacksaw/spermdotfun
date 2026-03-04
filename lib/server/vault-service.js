const { ethers } = require("ethers");

/**
 * VaultService handles off-chain balance tracking and signing for the "Locked Vault" model.
 */
class VaultService {
    constructor({ logger, serverWallet, domain }) {
        this.logger = logger || console;
        this.serverWallet = serverWallet;
        this.domain = domain; // EIP-712 Domain

        // In-memory balance store: Map<address, { balance: bigint, nonce: number }>
        this.balances = new Map();
    }

    /**
     * Called when a 'Deposited' event is received from the smart contract.
     */
    handleDeposit(user, amount) {
        const addr = user.toLowerCase();
        const current = this.balances.get(addr) || { balance: 0n, nonce: 0 };
        current.balance += BigInt(amount);
        this.balances.set(addr, current);
        this.logger.log(`[VAULT] Deposit: ${addr} +${ethers.formatEther(amount)} SPRM. New Total: ${ethers.formatEther(current.balance)}`);
    }

    /**
     * Updates balance after a bet outcome.
     */
    updateBalance(user, delta) {
        const addr = user.toLowerCase();
        const current = this.balances.get(addr);
        if (!current) {
            this.logger.error(`[VAULT] Attempted to update balance for unknown user: ${addr}`);
            return false;
        }
        current.balance += BigInt(delta);
        if (current.balance < 0n) {
            this.logger.error(`[VAULT] Balance went negative for ${addr}: ${current.balance}`);
            current.balance = 0n;
        }
        this.balances.set(addr, current);
        return true;
    }

    getBalance(user) {
        const addr = user.toLowerCase();
        return this.balances.get(addr)?.balance || 0n;
    }

    /**
     * Generates an EIP-712 signature for settlement.
     */
    async generateSettlementProof(user) {
        const addr = user.toLowerCase();
        const state = this.balances.get(addr);

        if (!state) throw new Error("No balance found for user");
        if (!this.serverWallet) throw new Error("Server wallet not initialized for signing");

        const types = {
            Settlement: [
                { name: "user", type: "address" },
                { name: "balance", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            user: addr,
            balance: state.balance.toString(),
            nonce: state.nonce
        };

        const signature = await this.serverWallet.signTypedData(this.domain, types, value);

        // Increment nonce after successful signature generation to prevent reusing this proof
        // Note: In a real production app, the nonce should be synced with the contract's nonce for that user.
        state.nonce += 1;
        this.balances.set(addr, state);

        return {
            balance: value.balance,
            nonce: value.nonce,
            signature
        };
    }
}

function createVaultService(opts) {
    return new VaultService(opts);
}

module.exports = { createVaultService };
