import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SprmfunAnchor } from "../target/types/sprmfun_anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import assert from "assert";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATE_SEED = Buffer.from("state");
const MINT_SEED  = Buffer.from("mint");
const BET_SEED   = Buffer.from("bet");

function boxXBytes(boxX: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(boxX);
  return b;
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("sprmfun-anchor (continuous model)", () => {
  const provider  = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program   = anchor.workspace.SprmfunAnchor as Program<SprmfunAnchor>;
  const authority = provider.wallet.publicKey;

  let statePda:    PublicKey;
  let mintPda:     PublicKey;
  let escrowPda:   PublicKey;
  let treasuryAta: PublicKey;

  const user = Keypair.generate();
  let userAta: PublicKey;
  let up: Program<SprmfunAnchor>; // user-signed program instance

  const vrfResult  = Buffer.from("aa".repeat(32), "hex");
  const serverSalt = Buffer.from("bb".repeat(32), "hex");

  before(async () => {
    [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], program.programId);
    [mintPda]  = PublicKey.findProgramAddressSync([MINT_SEED, statePda.toBuffer()], program.programId);
    escrowPda   = getAssociatedTokenAddressSync(mintPda, statePda, true);
    treasuryAta = getAssociatedTokenAddressSync(mintPda, authority);
    userAta     = getAssociatedTokenAddressSync(mintPda, user.publicKey);

    const sig = await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    // Reuse provider connection; wrap user keypair in a wallet for signing
    const userWallet = new anchor.Wallet(user);
    const userProv = new anchor.AnchorProvider(provider.connection, userWallet, { commitment: "confirmed" });
    up = new anchor.Program(program.idl, userProv) as Program<SprmfunAnchor>;
  });

  // ── 1. Initialize ─────────────────────────────────────────────────────────
  it("initializes state + mint + escrow", async () => {
    await program.methods
      .initialize(200)
      .accounts({
        authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    await program.methods
      .initAtas()
      .accounts({
        authority,
        mint: mintPda,
        escrow: escrowPda,
        treasury: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const s = await program.account.state.fetch(statePda);
    assert.equal(s.authority.toBase58(), authority.toBase58());
    assert.equal(s.houseEdgeBps, 200);
    assert.equal(s.faucetEnabled, true);
    assert.equal(s.seedIndex.toNumber(), 0);
    assert.equal(s.escrow.toBase58(), escrowPda.toBase58());
    console.log("state:", statePda.toBase58(), "| mint:", mintPda.toBase58());
  });

  // ── 2. Faucet ─────────────────────────────────────────────────────────────
  it("mints 10 SPRM to user via faucet", async () => {

    await up.methods
      .faucet(new BN(10 * 10 ** 9))
      .accounts({
        user: user.publicKey,
        mint: mintPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ skipPreflight: true });

    const acc = await getAccount(provider.connection, userAta);
    assert.equal(acc.amount, BigInt(10 * 10 ** 9));
    console.log("balance:", Number(acc.amount) / 1e9, "SPRM");
  });

  // ── 3. Consume VRF ────────────────────────────────────────────────────────
  it("posts VRF and increments seed_index", async () => {
    await program.methods
      .consumeVrf(Array.from(vrfResult) as number[], Array.from(serverSalt) as number[])
      .accounts({ authority } as any)
      .rpc();

    const s = await program.account.state.fetch(statePda);
    assert.equal(s.seedIndex.toNumber(), 1);
    console.log("seed_index:", s.seedIndex.toNumber());
  });

  // ── 4. Place bet ──────────────────────────────────────────────────────────
  it("places a bet on box_x=1000 row=5", async () => {
    const BOX_X = BigInt(1000), ROW = 5, AMOUNT = new BN(2 * 10 ** 9);

    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );

    await up.methods
      .placeBet(new BN(BOX_X.toString()), ROW, AMOUNT)
      .accounts({
        user: user.publicKey,
        userAta: userAta,
        escrow: escrowPda,
        bet: betPda,
        mint: mintPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ skipPreflight: true });

    const bet = await program.account.bet.fetch(betPda);
    assert.equal(bet.boxX.toString(), BOX_X.toString());
    assert.equal(bet.boxRow, ROW);
    assert.equal(bet.resolved, false);
    const escrow = await getAccount(provider.connection, escrowPda);
    assert.equal(escrow.amount, BigInt(AMOUNT.toString()));
    console.log("bet placed — escrow:", Number(escrow.amount) / 1e9, "SPRM");
  });

  // ── 5. Resolve bet (winning) ──────────────────────────────────────────────
  it("resolves bet with winning row and pays out", async () => {
    const BOX_X = BigInt(1000), ROW = 5;
    // Authority passes winning row = ROW (simulating pointer landed on row 5)
    const winRow = ROW;

    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );

    const balBefore = (await getAccount(provider.connection, userAta)).amount;

    await program.methods
      .resolveBet(winRow)
      .accounts({
        authority,
        bet: betPda,
        escrow: escrowPda,
        userAta,
        treasury: treasuryAta,
        mint: mintPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const bet = await program.account.bet.fetch(betPda);
    assert.equal(bet.resolved, true);
    assert.equal(bet.won, true);
    const balAfter = (await getAccount(provider.connection, userAta)).amount;
    assert(balAfter > balBefore, "Winner should have more tokens");
    console.log("WIN — payout:", Number(bet.payout) / 1e9, "SPRM");
  });

  // ── 6. Double resolve rejected ────────────────────────────────────────────
  it("rejects double resolve", async () => {
    const BOX_X = BigInt(1000), ROW = 5;
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );

    try {
      await program.methods
        .resolveBet(ROW)
        .accounts({
          authority, bet: betPda, escrow: escrowPda, userAta, treasury: treasuryAta, mint: mintPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert(err.message.includes("AlreadyResolved") || err.error?.errorCode?.code === "AlreadyResolved");
      console.log("double resolve rejected ✓");
    }
  });

  // ── 7. Invalid row rejected ───────────────────────────────────────────────
  it("rejects row >= 10", async () => {
    const BOX_X = BigInt(2000), ROW = 10;
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );
    try {
      await up.methods.placeBet(new BN(BOX_X.toString()), ROW, new BN(10 ** 9))
        .accounts({ user: user.publicKey, userAta, escrow: escrowPda, bet: betPda, mint: mintPda, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
        .rpc();
      assert.fail("Expected placeBet(row=10) to throw");
    } catch (err: any) {
      if (err.message === "Expected placeBet(row=10) to throw") throw err;
      assert(err.message.includes("InvalidRow") || err.error?.errorCode?.code === "InvalidRow", `unexpected error: ${err.message}`);
      console.log("invalid row rejected ✓");
    }
  });

  // ── 8. Zero bet rejected ──────────────────────────────────────────────────
  it("rejects zero-amount bet", async () => {
    const BOX_X = BigInt(3000), ROW = 5;
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );
    try {
      await up.methods.placeBet(new BN(BOX_X.toString()), ROW, new BN(0))
        .accounts({ user: user.publicKey, userAta, escrow: escrowPda, bet: betPda, mint: mintPda, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
        .rpc();
      assert.fail("Expected placeBet(amount=0) to throw");
    } catch (err: any) {
      if (err.message === "Expected placeBet(amount=0) to throw") throw err;
      assert(err.message.includes("ZeroBet") || err.error?.errorCode?.code === "ZeroBet", `unexpected error: ${err.message}`);
      console.log("zero bet rejected ✓");
    }
  });

  // ── 9. Resolve losing bet ─────────────────────────────────────────────────
  it("resolves a losing bet correctly (no payout)", async () => {
    const BOX_X = BigInt(4000), ROW = 3;
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, user.publicKey.toBuffer(), boxXBytes(BOX_X), Buffer.from([ROW])],
      program.programId
    );
    await up.methods.placeBet(new BN(BOX_X.toString()), ROW, new BN(10 ** 9))
      .accounts({ user: user.publicKey, userAta, escrow: escrowPda, bet: betPda, mint: mintPda, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .rpc();

    // Pass a different winning row → bet loses
    const losingRow = (ROW + 1) % 10;
    const balBefore = (await getAccount(provider.connection, userAta)).amount;

    await program.methods.resolveBet(losingRow)
      .accounts({ authority, bet: betPda, escrow: escrowPda, userAta, treasury: treasuryAta, mint: mintPda, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .rpc();

    const bet = await program.account.bet.fetch(betPda);
    assert.equal(bet.resolved, true);
    assert.equal(bet.won, false);
    const balAfter = (await getAccount(provider.connection, userAta)).amount;
    assert.equal(balAfter, balBefore, "Loser should not receive tokens");
    console.log("losing bet resolved ✓ — no payout");
  });

  // ── 10. Faucet toggle ─────────────────────────────────────────────────────
  it("toggles faucet on/off", async () => {
    await program.methods.disableFaucet().accounts({ authority } as any).rpc();
    let s = await program.account.state.fetch(statePda);
    assert.equal(s.faucetEnabled, false);

    await program.methods.enableFaucet().accounts({ authority } as any).rpc();
    s = await program.account.state.fetch(statePda);
    assert.equal(s.faucetEnabled, true);
    console.log("faucet toggle ✓");
  });

  // ── 11. Sweep escrow ──────────────────────────────────────────────────────
  it("sweeps remaining escrow to treasury", async () => {
    const before = await getAccount(provider.connection, escrowPda);
    if (before.amount === BigInt(0)) { console.log("escrow empty, skip"); return; }

    await program.methods.sweepEscrow()
      .accounts({ authority, escrow: escrowPda, treasury: treasuryAta, mint: mintPda, tokenProgram: TOKEN_PROGRAM_ID } as any)
      .rpc();

    const after = await getAccount(provider.connection, escrowPda);
    assert.equal(after.amount, BigInt(0));
    console.log("swept", Number(before.amount) / 1e9, "SPRM ✓");
  });
});
