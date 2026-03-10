// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title SprmGameSimple
/// @notice Sprm.Fun game contract — no Chainlink VRF dependency.
///         Server uses local commit-reveal for grid fairness.
///         Chainlink VRF can be integrated later via SprmGame.sol upgrade.
contract SprmGameSimple is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EMERGENCY_DELAY = 48 hours;
    uint16  public constant MAX_HOUSE_EDGE  = 1000;

    IERC20  public immutable token;
    address public resolverSigner;
    address public treasury;
    uint16  public houseEdgeBps;
    uint256 public betCounter;

    // Grid commit-reveal
    bytes32 public currentCommitment;
    uint256 public currentEpochId;
    bool    public commitmentUsed;

    struct Bet {
        address player;
        uint256 amount;
        uint32  boxX;
        uint16  boxRow;
        uint16  multNum;
        bool    resolved;
        uint256 placedAt;
    }

    mapping(uint256 => Bet)     public bets;
    mapping(uint256 => uint256) public exitRequestedAt;

    event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount);
    event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout);
    event GridSeedCommitted(uint256 indexed epochId, bytes32 commitment);
    event GridSeedRevealed(uint256 indexed epochId, bytes32 seed);
    event EmergencyExitRequested(uint256 indexed betId, address indexed player);
    event EmergencyExitExecuted(uint256 indexed betId, address indexed player, uint256 amount);
    event HouseBankFunded(address indexed funder, uint256 amount);

    constructor(
        address _token,
        address _treasury,
        address _resolverSigner,
        uint16  _houseEdgeBps
    ) Ownable(msg.sender) {
        require(_token          != address(0), "zero token");
        require(_treasury       != address(0), "zero treasury");
        require(_resolverSigner != address(0), "zero resolver");
        require(_houseEdgeBps   <= MAX_HOUSE_EDGE, "edge>10%");
        token          = IERC20(_token);
        treasury       = _treasury;
        resolverSigner = _resolverSigner;
        houseEdgeBps   = _houseEdgeBps;
    }

    // ── Betting ────────────────────────────────────────────────────────────────

    function placeBet(uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount)
        external nonReentrant returns (uint256 betId)
    {
        require(amount > 0,                        "amount=0");
        require(boxRow < 500,                      "row OOB");
        require(multNum >= 101 && multNum <= 2000, "mult OOB");
        betId = ++betCounter;
        token.safeTransferFrom(msg.sender, address(this), amount);
        bets[betId] = Bet(msg.sender, amount, boxX, boxRow, multNum, false, block.timestamp);
        emit BetPlaced(betId, msg.sender, boxX, boxRow, multNum, amount);
    }

    function resolveBet(uint256 betId, bool won, bytes calldata serverSig)
        external nonReentrant
    {
        Bet storage bet = bets[betId];
        require(bet.player != address(0), "not found");
        require(!bet.resolved,            "resolved");
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(betId, won, address(this)))
        );
        require(ECDSA.recover(h, serverSig) == resolverSigner, "bad sig");
        bet.resolved = true;
        uint256 payout;
        if (won) {
            payout = (bet.amount * bet.multNum * (10_000 - houseEdgeBps)) / (100 * 10_000);
            require(token.balanceOf(address(this)) >= payout, "low bank");
            token.safeTransfer(bet.player, payout);
        } else {
            token.safeTransfer(treasury, bet.amount);
        }
        emit BetResolved(betId, bet.player, won, payout);
    }

    // ── Emergency exit ─────────────────────────────────────────────────────────

    function requestEmergencyExit(uint256 betId) external {
        Bet storage bet = bets[betId];
        require(bet.player == msg.sender,    "!owner");
        require(!bet.resolved,               "resolved");
        require(exitRequestedAt[betId] == 0, "pending");
        exitRequestedAt[betId] = block.timestamp;
        emit EmergencyExitRequested(betId, msg.sender);
    }

    function executeEmergencyExit(uint256 betId) external nonReentrant {
        Bet storage bet = bets[betId];
        require(bet.player == msg.sender,   "!owner");
        require(!bet.resolved,              "resolved");
        require(exitRequestedAt[betId] != 0,"not requested");
        require(block.timestamp >= exitRequestedAt[betId] + EMERGENCY_DELAY, "wait 48h");
        bet.resolved = true;
        token.safeTransfer(msg.sender, bet.amount);
        emit EmergencyExitExecuted(betId, msg.sender, bet.amount);
    }

    // ── Grid commit-reveal ─────────────────────────────────────────────────────

    function commitGridSeed(bytes32 commitment) external {
        require(msg.sender == resolverSigner || msg.sender == owner(), "unauth");
        currentEpochId++;
        currentCommitment = commitment;
        commitmentUsed    = false;
        emit GridSeedCommitted(currentEpochId, commitment);
    }

    function revealGridSeed(bytes32 seed) external {
        require(msg.sender == resolverSigner || msg.sender == owner(), "unauth");
        require(!commitmentUsed, "used");
        require(sha256(abi.encodePacked(seed)) == currentCommitment, "bad seed");
        commitmentUsed = true;
        emit GridSeedRevealed(currentEpochId, seed);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function fundHouseBank(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit HouseBankFunded(msg.sender, amount);
    }

    function setResolverSigner(address v) external onlyOwner { require(v!=address(0),"0"); resolverSigner=v; }
    function setTreasury(address v)       external onlyOwner { require(v!=address(0),"0"); treasury=v; }
    function setHouseEdge(uint16 v)       external onlyOwner { require(v<=MAX_HOUSE_EDGE,"edge>10%"); houseEdgeBps=v; }
    function withdrawHouseBank(uint256 a) external onlyOwner { token.safeTransfer(treasury,a); }
    function houseBankBalance()           external view returns (uint256) { return token.balanceOf(address(this)); }
    function expectedPayout(uint256 id)   external view returns (uint256) {
        Bet storage b = bets[id];
        require(b.player!=address(0),"nf");
        return (b.amount * b.multNum * (10_000-houseEdgeBps)) / (100*10_000);
    }
}
