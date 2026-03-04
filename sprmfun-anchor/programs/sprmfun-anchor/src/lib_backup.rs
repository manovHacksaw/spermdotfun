use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("BN8y2gfrrVe1Nira9R9PtN6BzfuyKjQZ1LyoXUT3yJfw");

// ── Seeds ─────────────────────────────────────────────────────────────────────
pub const STATE_SEED: &[u8] = b"state";
pub const MINT_SEED:  &[u8] = b"mint";
pub const BET_SEED:   &[u8] = b"bet";

// ── Layout constants ──────────────────────────────────────────────────────────
pub const ROW_COUNT: u8 = 10;

// ── Multipliers (per row 0-9) ─────────────────────────────────────────────────
// row 0: 0.1x  row 1: 0.25x  row 2: 0.5x  row 3: 0.75x  row 4: 1.0x
// row 5: 1.5x  row 6: 2.0x   row 7: 3.0x  row 8: 5.0x   row 9: 10.0x
pub const MULT_NUM: [u64; 10] = [1, 1, 1, 3, 1, 3, 2, 3, 5, 10];
pub const MULT_DEN: [u64; 10] = [10, 4, 2, 4, 1, 2, 1, 1, 1, 1];


// ── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod sprmfun_anchor {
    use super::*;

    // ── 1a. Create state PDA + mint ──────────────────────────────────────────
    pub fn initialize(ctx: Context<Initialize>, house_edge_bps: u16) -> Result<()> {
        require!(house_edge_bps <= 5_000, SprmError::HouseEdgeTooHigh);

        let state = &mut ctx.accounts.state;
        state.authority       = ctx.accounts.authority.key();
        state.mint            = ctx.accounts.mint.key();
        state.escrow          = Pubkey::default(); // set in init_atas
        state.house_edge_bps  = house_edge_bps;
        state.faucet_enabled  = true;
        state.seed_index      = 0;
        state.vrf_result      = [0u8; 32];
        state.seed_salt       = [0u8; 32];
        state.seed_updated_at = 0;
        state.bump            = ctx.bumps.state;

        msg!("Initialized state+mint. Authority: {}", state.authority);
        Ok(())
    }

    // ── 1b. Create escrow + treasury ATAs (separate to avoid stack overflow) ─
    pub fn init_atas(ctx: Context<InitAtas>) -> Result<()> {
        ctx.accounts.state.escrow = ctx.accounts.escrow.key();
        msg!("ATAs initialized. Escrow: {}", ctx.accounts.escrow.key());
        Ok(())
    }

    // ── 2. Faucet: mint tokens to caller ─────────────────────────────────────
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        require!(ctx.accounts.state.faucet_enabled, SprmError::FaucetDisabled);

        let seeds = &[STATE_SEED, &[ctx.accounts.state.bump]];
        let signer_seeds = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint:      ctx.accounts.mint.to_account_info(),
                    to:        ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        msg!("Faucet: minted {} tokens to {}", amount, ctx.accounts.user.key());
        Ok(())
    }

    pub fn enable_faucet(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.state.faucet_enabled = true;
        Ok(())
    }

    pub fn disable_faucet(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.state.faucet_enabled = false;
        Ok(())
    }

    // ── 3. Consume VRF: authority posts new randomness + salt ────────────────
    // On localnet: authority calls this directly with crypto.randomBytes(32)
    // On devnet:   MagicBlock oracle calls this after requestRandomness
    pub fn consume_vrf(
        ctx: Context<ConsumeVrf>,
        randomness: [u8; 32],
        server_salt: [u8; 32],
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.vrf_result      = randomness;
        state.seed_salt       = server_salt;
        state.seed_index      = state.seed_index.checked_add(1).ok_or(SprmError::Overflow)?;
        state.seed_updated_at = Clock::get()?.unix_timestamp;

        emit!(VrfUpdated {
            seed_index:   state.seed_index,
            vrf_result:   randomness,
            server_salt,
            timestamp:    state.seed_updated_at,
        });

        msg!("VRF updated — seed_index={}", state.seed_index);
        Ok(())
    }

    // ── 4. Place bet: user locks tokens on a specific box ────────────────────
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        box_x: i64,
        box_row: u8,
        amount: u64,
    ) -> Result<()> {
        require!(box_row < ROW_COUNT, SprmError::InvalidRow);
        require!(amount > 0, SprmError::ZeroBet);

        // Transfer tokens from user to escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.user_ata.to_account_info(),
                    to:        ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.user       = ctx.accounts.user.key();
        bet.box_x      = box_x;
        bet.box_row    = box_row;
        bet.amount     = amount;
        bet.seed_index = ctx.accounts.state.seed_index;
        bet.resolved   = false;
        bet.won        = false;
        bet.payout     = 0;
        bet.bump       = ctx.bumps.bet;

        msg!("Bet placed: user={} box_x={} row={} amount={} seed_index={}",
            ctx.accounts.user.key(), box_x, box_row, amount, bet.seed_index);
        Ok(())
    }

    // ── 5. Resolve bet: authority calls when pointer passes bet's column ──────
    // winning_row is the row the pointer was on when it crossed this column.
    // Authority (server) is trusted — it signs the tx and observed the path.
    pub fn resolve_bet(
        ctx: Context<ResolveBet>,
        winning_row: u8,
    ) -> Result<()> {
        let bet = &ctx.accounts.bet;
        require!(!bet.resolved, SprmError::AlreadyResolved);
        require!(winning_row < ROW_COUNT, SprmError::InvalidRow);

        let bet = &mut ctx.accounts.bet;
        bet.resolved = true;

        if bet.box_row == winning_row {
            let gross = (bet.amount as u128)
                .checked_mul(MULT_NUM[bet.box_row as usize] as u128)
                .ok_or(SprmError::Overflow)?
                .checked_div(MULT_DEN[bet.box_row as usize] as u128)
                .ok_or(SprmError::Overflow)?;

            let house_edge_bps = ctx.accounts.state.house_edge_bps;
            let state_bump     = ctx.accounts.state.bump;

            let fee = gross
                .checked_mul(house_edge_bps as u128)
                .ok_or(SprmError::Overflow)?
                / 10_000;

            let net = (gross - fee) as u64;
            bet.won    = true;
            bet.payout = net;

            let signer_seeds: &[&[&[u8]]] = &[&[STATE_SEED, &[state_bump]]];

            // Payout to winner
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from:      ctx.accounts.escrow.to_account_info(),
                        to:        ctx.accounts.user_ata.to_account_info(),
                        authority: ctx.accounts.state.to_account_info(),
                    },
                    signer_seeds,
                ),
                net,
            )?;

            // Fee to treasury
            if fee > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from:      ctx.accounts.escrow.to_account_info(),
                            to:        ctx.accounts.treasury.to_account_info(),
                            authority: ctx.accounts.state.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    fee as u64,
                )?;
            }

            emit!(BetResolved {
                user:        bet.user,
                box_x:       bet.box_x,
                box_row:     bet.box_row,
                amount:      bet.amount,
                winning_row,
                won:         true,
                payout:      net,
                seed_index:  bet.seed_index,
            });

            msg!("WIN  — user={} box_x={} row={} payout={}", bet.user, bet.box_x, bet.box_row, net);
        } else {
            emit!(BetResolved {
                user:        bet.user,
                box_x:       bet.box_x,
                box_row:     bet.box_row,
                amount:      bet.amount,
                winning_row,
                won:         false,
                payout:      0,
                seed_index:  bet.seed_index,
            });

            msg!("LOSE — user={} box_x={} row={} amount={}", bet.user, bet.box_x, bet.box_row, bet.amount);
        }

        Ok(())
    }

    // ── 6. Sweep: admin drains escrow to treasury ─────────────────────────────
    pub fn sweep_escrow(ctx: Context<SweepEscrow>) -> Result<()> {
        let remaining = ctx.accounts.escrow.amount;
        if remaining == 0 {
            return Ok(());
        }

        let signer_seeds: &[&[&[u8]]] = &[&[STATE_SEED, &[ctx.accounts.state.bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow.to_account_info(),
                    to:        ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                signer_seeds,
            ),
            remaining,
        )?;

        msg!("Swept {} tokens to treasury", remaining);
        Ok(())
    }
}

// ── State accounts ────────────────────────────────────────────────────────────

#[account]
pub struct State {
    pub authority:       Pubkey,   // 32
    pub mint:            Pubkey,   // 32
    pub escrow:          Pubkey,   // 32
    pub house_edge_bps:  u16,      // 2
    pub faucet_enabled:  bool,     // 1
    pub seed_index:      u64,      // 8
    pub vrf_result:      [u8; 32], // 32
    pub seed_salt:       [u8; 32], // 32
    pub seed_updated_at: i64,      // 8
    pub bump:            u8,       // 1
}

impl State {
    // 8 disc + 32*3 + 2 + 1 + 8 + 32 + 32 + 8 + 1
    pub const LEN: usize = 8 + 32 * 3 + 2 + 1 + 8 + 32 + 32 + 8 + 1;
}

#[account]
pub struct Bet {
    pub user:       Pubkey, // 32
    pub box_x:      i64,    // 8
    pub box_row:    u8,     // 1
    pub amount:     u64,    // 8
    pub seed_index: u64,    // 8
    pub resolved:   bool,   // 1
    pub won:        bool,   // 1
    pub payout:     u64,    // 8
    pub bump:       u8,     // 1
}

impl Bet {
    // 8 disc + 32 + 8 + 1 + 8 + 8 + 1 + 1 + 8 + 1
    pub const LEN: usize = 8 + 32 + 8 + 1 + 8 + 8 + 1 + 1 + 8 + 1;
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct VrfUpdated {
    pub seed_index:  u64,
    pub vrf_result:  [u8; 32],
    pub server_salt: [u8; 32],
    pub timestamp:   i64,
}

#[event]
pub struct BetResolved {
    pub user:        Pubkey,
    pub box_x:       i64,
    pub box_row:     u8,
    pub amount:      u64,
    pub winning_row: u8,
    pub won:         bool,
    pub payout:      u64,
    pub seed_index:  u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum SprmError {
    #[msg("House edge cannot exceed 50%")]
    HouseEdgeTooHigh,
    #[msg("Faucet is disabled")]
    FaucetDisabled,
    #[msg("Row must be 0-9")]
    InvalidRow,
    #[msg("Bet amount must be > 0")]
    ZeroBet,
    #[msg("Bet already resolved")]
    AlreadyResolved,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ── Instruction contexts ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = State::LEN,
        seeds = [STATE_SEED],
        bump,
    )]
    pub state: Account<'info, State>,

    #[account(
        init,
        payer           = authority,
        mint::decimals  = 9,
        mint::authority = state,
        seeds           = [MINT_SEED, state.key().as_ref()],
        bump,
    )]
    pub mint: Account<'info, Mint>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitAtas<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,

    #[account(address = state.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer                       = authority,
        associated_token::mint      = mint,
        associated_token::authority = state,
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        init,
        payer                       = authority,
        associated_token::mint      = mint,
        associated_token::authority = authority,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,

    #[account(mut, address = state.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer                       = user,
        associated_token::mint      = mint,
        associated_token::authority = user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(address = state.authority)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct ConsumeVrf<'info> {
    #[account(address = state.authority)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
#[instruction(box_x: i64, box_row: u8, amount: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,

    #[account(mut, address = state.escrow)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = Bet::LEN,
        seeds = [BET_SEED, user.key().as_ref(), &box_x.to_le_bytes(), &[box_row]],
        bump,
    )]
    pub bet: Account<'info, Bet>,

    #[account(address = state.mint)]
    pub mint: Account<'info, Mint>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveBet<'info> {
    #[account(address = state.authority)]
    pub authority: Signer<'info>,

    #[account(seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,

    #[account(
        mut,
        seeds = [BET_SEED, bet.user.as_ref(), &bet.box_x.to_le_bytes(), &[bet.box_row]],
        bump  = bet.bump,
    )]
    pub bet: Account<'info, Bet>,

    #[account(mut, address = state.escrow)]
    pub escrow: Account<'info, TokenAccount>,

    /// The winner's token account — must match bet.user
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = bet.user,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    /// Treasury = authority's ATA (receives fees; must already exist)
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = authority,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(address = state.mint)]
    pub mint: Account<'info, Mint>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepEscrow<'info> {
    #[account(mut, address = state.authority)]
    pub authority: Signer<'info>,

    #[account(seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,

    #[account(mut, address = state.escrow)]
    pub escrow: Account<'info, TokenAccount>,

    /// Treasury = authority's ATA (must already exist)
    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = authority,
    )]
    pub treasury: Account<'info, TokenAccount>,

    #[account(address = state.mint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}
