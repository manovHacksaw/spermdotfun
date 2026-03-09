// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title SprmGame
/// @notice Per-bet on-chain resolution for Sprm.Fun with Chainlink VRF v2.5
///         for provably-fair grid path randomness.
///
/// VRF Flow:
///   1. Server calls requestVrf() every VRF_REFRESH_COLS columns.
///   2. Chainlink VRF calls fulfillRandomWords() with the random value.
///   3. Contract emits VrfFulfilled(epochId, vrfResult) — server listens for this.
///   4. Server uses vrfResult as entropy for deriveWinningRow(), populates local vrfPath.
///
/// Bet Flow:
///   1. User approves SPRM, calls placeBet() → receives betId.
///   2. Server monitors pointer; when pointer passes bet column, server signs
///      keccak256(betId, won, address(this)) and calls resolveBet().
///   3. Win: user receives amount * multNum/100 * (1 - houseEdge) from house bank.
///      Loss: bet amount goes to treasury.
///
/// Safety:
///   - emergencyExitRequest/executeEmergencyExit: user recovers stake after 48h.
///   - VRF subscription must be funded with LINK before calling requestVrf().
contract SprmGame is VRFConsumerBaseV2Plus, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────

    uint256 public constant EMERGENCY_DELAY = 48 hours;
    uint16  public constant MAX_HOUSE_EDGE  = 1000; // 10% ceiling

    // ── Immutables ─────────────────────────────────────────────────────────────

    IERC20  public immutable token;
    bytes32 public immutable vrfKeyHash;
    uint256 public immutable vrfSubscriptionId;

    // ── Mutable state ──────────────────────────────────────────────────────────

    address public resolverSigner;
    address public treasury;
    uint16  public houseEdgeBps; // e.g. 200 = 2%

    uint256 public betCounter;

    // VRF epoch tracking
    uint256 public currentEpochId;
    uint256 public pendingVrfRequestId;   // 0 when no request in flight
    uint256 public pendingVrfEpochId;     // epochId for the in-flight request

    // VRF request → epochId mapping (for fulfillment)
    mapping(uint256 => uint256) public vrfRequestEpoch;

    struct Bet {
        address player;
        uint256 amount;      // SPRM in wei (18 decimals)
        uint32  boxX;        // column pixel coordinate
        uint8   boxRow;      // row 0–29
        uint16  multNum;     // multiplier × 100, e.g. 173 = 1.73×
        bool    resolved;
        uint256 placedAt;    // block.timestamp
    }

    mapping(uint256 => Bet) public bets;

    // Emergency exit: betId → timestamp of exit request (0 if not requested)
    mapping(uint256 => uint256) public exitRequestedAt;

    // ── Events ─────────────────────────────────────────────────────────────────

    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        uint32  boxX,
        uint8   boxRow,
        uint16  multNum,
        uint256 amount
    );
    event BetResolved(
        uint256 indexed betId,
        address indexed player,
        bool    won,
        uint256 payout
    );
    /// @notice Emitted when Chainlink VRF fulfills a request.
    ///         Server listens for this to update local vrfPath.
    event VrfFulfilled(
        uint256 indexed epochId,
        uint256 indexed requestId,
        bytes32 vrfResult    // keccak256 of the raw random word — 32-byte entropy for server
    );
    event VrfRequested(uint256 indexed epochId, uint256 indexed requestId);
    event EmergencyExitRequested(uint256 indexed betId, address indexed player);
    event EmergencyExitExecuted(uint256 indexed betId, address indexed player, uint256 amount);
    event HouseBankFunded(address indexed funder, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────────

    /// @param _vrfCoordinator  Chainlink VRF Coordinator address.
    ///                         Fuji:  0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE
    ///                         Mainnet: see Chainlink docs
    /// @param _vrfKeyHash      Gas lane key hash.
    ///                         Fuji 300 gwei: 0xc799bd1e3bd4d1a41cd4968997a4e03dfd2a3c7c04b695881138580163f42887
    /// @param _vrfSubscriptionId  Chainlink VRF v2.5 subscription ID (funded with LINK).
    constructor(
        address _token,
        address _treasury,
        address _resolverSigner,
        uint16  _houseEdgeBps,
        address _vrfCoordinator,
        bytes32 _vrfKeyHash,
        uint256 _vrfSubscriptionId
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        require(_token          != address(0), "zero token");
        require(_treasury       != address(0), "zero treasury");
        require(_resolverSigner != address(0), "zero resolver");
        require(_houseEdgeBps   <= MAX_HOUSE_EDGE, "edge > 10%");

        token             = IERC20(_token);
        treasury          = _treasury;
        resolverSigner    = _resolverSigner;
        houseEdgeBps      = _houseEdgeBps;
        vrfKeyHash        = _vrfKeyHash;
        vrfSubscriptionId = _vrfSubscriptionId;
    }

    // ── Chainlink VRF ──────────────────────────────────────────────────────────

    /// @notice Request a new random value from Chainlink VRF.
    ///         Called by the server every VRF_REFRESH_COLS columns.
    ///         The subscription must have sufficient LINK.
    /// @return requestId  The Chainlink request ID (also emitted in VrfRequested).
    function requestVrf() external returns (uint256 requestId) {
        require(
            msg.sender == resolverSigner || msg.sender == owner(),
            "unauthorized"
        );
        require(pendingVrfRequestId == 0, "vrf request already pending");

        uint256 epochId = ++currentEpochId;

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:             vrfKeyHash,
                subId:               vrfSubscriptionId,
                requestConfirmations: 3,
                callbackGasLimit:    100_000,
                numWords:            1,
                extraArgs:           VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                )
            })
        );

        pendingVrfRequestId  = requestId;
        pendingVrfEpochId    = epochId;
        vrfRequestEpoch[requestId] = epochId;

        emit VrfRequested(epochId, requestId);
    }

    /// @notice Chainlink VRF callback — stores result and emits VrfFulfilled.
    ///         Server listens for this event to get entropy for the grid path.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 epochId = vrfRequestEpoch[requestId];
        // Compact the raw uint256 to bytes32 entropy for the server
        bytes32 vrfResult = keccak256(abi.encodePacked(randomWords[0]));

        pendingVrfRequestId = 0; // unblock next request

        emit VrfFulfilled(epochId, requestId, vrfResult);
    }

    // ── Core game ──────────────────────────────────────────────────────────────

    /// @notice Place a bet. Transfers `amount` SPRM from caller to this contract.
    /// @param boxX    Column pixel coordinate (multiple of 50).
    /// @param boxRow  Row index 0–29.
    /// @param multNum Multiplier × 100 (e.g. 173 = 1.73×). Range: 101–2000.
    /// @param amount  SPRM amount in wei.
    /// @return betId  Unique bet identifier emitted in BetPlaced event.
    function placeBet(
        uint32  boxX,
        uint8   boxRow,
        uint16  multNum,
        uint256 amount
    ) external nonReentrant returns (uint256 betId) {
        require(amount > 0,                        "amount = 0");
        require(boxRow < 30,                       "row out of range");
        require(multNum >= 101 && multNum <= 2000, "multiplier out of range");

        betId = ++betCounter;
        token.safeTransferFrom(msg.sender, address(this), amount);

        bets[betId] = Bet({
            player:   msg.sender,
            amount:   amount,
            boxX:     boxX,
            boxRow:   boxRow,
            multNum:  multNum,
            resolved: false,
            placedAt: block.timestamp
        });

        emit BetPlaced(betId, msg.sender, boxX, boxRow, multNum, amount);
    }

    /// @notice Resolve a bet. Server signs keccak256(betId, won, address(this))
    ///         and submits the resolution.
    /// @param betId     The bet to resolve.
    /// @param won       True if the player wins.
    /// @param serverSig 65-byte ECDSA signature from resolverSigner.
    function resolveBet(
        uint256 betId,
        bool    won,
        bytes calldata serverSig
    ) external nonReentrant {
        Bet storage bet = bets[betId];
        require(bet.player != address(0), "bet not found");
        require(!bet.resolved,            "already resolved");

        // Verify server signed exactly this resolution for this contract instance.
        // Including address(this) prevents cross-deployment replay.
        bytes32 msgHash = keccak256(abi.encodePacked(betId, won, address(this)));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        require(ECDSA.recover(ethHash, serverSig) == resolverSigner, "bad signature");

        bet.resolved = true;

        uint256 payout = 0;
        if (won) {
            // payout = amount × multNum/100 × (1 − houseEdge)
            payout = (bet.amount * bet.multNum * (10_000 - houseEdgeBps)) / (100 * 10_000);
            require(token.balanceOf(address(this)) >= payout, "insufficient house bank");
            token.safeTransfer(bet.player, payout);
        } else {
            token.safeTransfer(treasury, bet.amount);
        }

        emit BetResolved(betId, bet.player, won, payout);
    }

    // ── Emergency exit ─────────────────────────────────────────────────────────

    /// @notice Signal intent to exit a stuck bet. Starts the 48-hour delay clock.
    function requestEmergencyExit(uint256 betId) external {
        Bet storage bet = bets[betId];
        require(bet.player == msg.sender,    "not your bet");
        require(!bet.resolved,               "already resolved");
        require(exitRequestedAt[betId] == 0, "already requested");

        exitRequestedAt[betId] = block.timestamp;
        emit EmergencyExitRequested(betId, msg.sender);
    }

    /// @notice Claim stake back after EMERGENCY_DELAY has elapsed.
    function executeEmergencyExit(uint256 betId) external nonReentrant {
        Bet storage bet = bets[betId];
        require(bet.player == msg.sender,                              "not your bet");
        require(!bet.resolved,                                          "already resolved");
        require(exitRequestedAt[betId] != 0,                           "exit not requested");
        require(
            block.timestamp >= exitRequestedAt[betId] + EMERGENCY_DELAY,
            "delay not elapsed"
        );

        bet.resolved = true;
        token.safeTransfer(msg.sender, bet.amount);
        emit EmergencyExitExecuted(betId, msg.sender, bet.amount);
    }

    // ── View helpers ───────────────────────────────────────────────────────────

    function expectedPayout(uint256 betId) external view returns (uint256) {
        Bet storage bet = bets[betId];
        require(bet.player != address(0), "bet not found");
        return (bet.amount * bet.multNum * (10_000 - houseEdgeBps)) / (100 * 10_000);
    }

    function houseBankBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function isVrfPending() external view returns (bool) {
        return pendingVrfRequestId != 0;
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    function fundHouseBank(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit HouseBankFunded(msg.sender, amount);
    }

    function setResolverSigner(address _resolverSigner) external onlyOwner {
        require(_resolverSigner != address(0), "zero address");
        resolverSigner = _resolverSigner;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero address");
        treasury = _treasury;
    }

    function setHouseEdge(uint16 _houseEdgeBps) external onlyOwner {
        require(_houseEdgeBps <= MAX_HOUSE_EDGE, "edge > 10%");
        houseEdgeBps = _houseEdgeBps;
    }

    function withdrawHouseBank(uint256 amount) external onlyOwner {
        token.safeTransfer(treasury, amount);
    }
}
