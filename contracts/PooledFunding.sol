// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The two ERC-20 calls the pool needs. USDC implements both.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Pooled, all-or-nothing funding for open-source builds, listed and closed by Proof of Love votes.
///
/// A pool starts as a request (a funder with a need and a first pledge) or as a community proposal
/// (a contributor with Points and no money). Contributors vote on listing it. Once listed, anyone can
/// pledge until the deadline. A full pool launches and is later paid to contributors by their share of
/// project Points. A pool that is not listed, misses its target or is closed by vote is refunded in full.
///
/// Concept demo: no owner, no upgrade path, no admin key. Not audited. Testnet only.
contract PooledFunding {
    // Sample parameters of this demo. A production version would change them only by vote.
    uint256 public constant QUORUM_BPS = 4_000; // 40% of the power available on the pool's domain
    uint256 public constant FEE_BPS = 200; // 2% of the payout, deducted from the gross amount
    uint256 public constant DOMAIN_COUNT = 4;
    uint256 public constant MAX_TITLE_BYTES = 120;
    uint256 public constant MIN_PERIOD = 30; // seconds
    uint256 public constant MAX_PERIOD = 365 days;
    uint256 public constant MAX_PAYEES = 100;

    enum Kind {
        Request, // a funder needs something built and opens with a pledge
        Proposal // a contributor offers to build something for a budget
    }

    enum Status {
        Voting, // listing vote open
        NotListed, // listing vote failed: opening pledge refundable
        Funding, // listed: pledges open until the deadline
        Expired, // deadline passed below target: pledges refundable
        Building, // target reached and launched: the pool waits for accepted work
        Paid, // pool paid to contributors by share of project Points
        Closed // closed by vote before payout: pledges refundable
    }

    enum Choice {
        None,
        For,
        Against,
        Abstain
    }

    /// One community with its own Points book. Slop would run one; the demo creates one per visitor.
    struct Space {
        address steward; // writes Points and posts the payout record (Slop's scoring pipeline in production)
        address feeRecipient;
        uint32 votingPeriod; // seconds
        uint256[4] totalPower; // sum of every member's power, per domain
    }

    struct Tally {
        uint64 end;
        bool open;
        uint256 forPower;
        uint256 againstPower;
        uint256 abstainPower;
        uint256 totalPower; // power available on the pool's domain when the vote opened
    }

    struct Ballot {
        Choice choice;
        uint256 power;
    }

    struct Pool {
        uint256 spaceId;
        address proposer;
        Kind kind;
        uint8 domain;
        Status status;
        uint32 funders;
        uint32 round; // 0 is the listing vote, each closure vote adds one
        uint32 fundingPeriod; // seconds, counted from the listing
        uint64 deadline; // set when the pool is listed
        uint64 closureCooldown; // no new closure vote before this time, set when one fails
        uint256 target;
        uint256 pledged;
        uint256 refunded;
        Tally listing;
        Tally closure;
        string title;
    }

    IERC20 public immutable token;

    uint256 public spaceCount;
    uint256 public poolCount;

    mapping(uint256 => Space) private spaces;
    mapping(uint256 => Pool) private pools;
    mapping(uint256 => uint256[]) private spacePools;
    /// Points are soulbound: the steward writes them and no function moves them between accounts.
    mapping(uint256 => mapping(address => uint32[4])) private points;
    mapping(uint256 => mapping(address => uint256)) public pledgeOf;
    mapping(uint256 => mapping(uint256 => mapping(address => Ballot))) private ballots;

    event SpaceCreated(uint256 indexed spaceId, address indexed steward, address feeRecipient, uint32 votingPeriod);
    event PointsSet(uint256 indexed spaceId, address indexed member, uint32[4] points);
    event PoolProposed(
        uint256 indexed poolId,
        uint256 indexed spaceId,
        address indexed proposer,
        Kind kind,
        uint8 domain,
        uint256 target,
        uint32 fundingPeriod,
        uint64 voteEnd,
        string title
    );
    event Voted(uint256 indexed poolId, uint32 round, address indexed voter, Choice choice, uint256 power);
    event VoteFinalized(uint256 indexed poolId, uint32 round, bool passed, Status status);
    event Pledged(uint256 indexed poolId, address indexed funder, uint256 amount, uint256 pledged);
    event Launched(uint256 indexed poolId, uint256 amount);
    event Refunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event ClosureOpened(uint256 indexed poolId, uint32 round, address indexed by, uint64 voteEnd);
    event Payout(uint256 indexed poolId, address indexed contributor, uint256 workPoints, uint256 amount);
    event PaidOut(uint256 indexed poolId, uint256 net, uint256 fee);

    error UnknownSpace();
    error UnknownPool();
    error BadParameters();
    error NotSteward();
    error NoVoters();
    error NotAContributor();
    error OpeningPledgeRequired();
    error NoOpenVote();
    error VotingEnded();
    error NoVotingPower();
    error VoteStillOpen(uint64 end);
    error FundingClosed();
    error PoolFull();
    error NotFunding();
    error TargetNotReached(uint256 pledged, uint256 target);
    error RefundNotAvailable();
    error NothingToRefund();
    error NotBuilding();
    error ClosureVoteOpen();
    error ClosureCooldown(uint64 until);
    error NotAParticipant();
    error NoAcceptedWork();
    error TransferFailed();

    constructor(IERC20 token_) {
        token = token_;
    }

    // ----------------------------------------------------------------------------------------- Spaces and Points

    function createSpace(uint32 votingPeriod, address feeRecipient) external returns (uint256 spaceId) {
        if (votingPeriod < MIN_PERIOD || votingPeriod > MAX_PERIOD || feeRecipient == address(0)) revert BadParameters();
        spaceId = ++spaceCount;
        Space storage s = spaces[spaceId];
        s.steward = msg.sender;
        s.feeRecipient = feeRecipient;
        s.votingPeriod = votingPeriod;
        emit SpaceCreated(spaceId, msg.sender, feeRecipient, votingPeriod);
    }

    /// Records a member's Points per domain. Only the steward can, and Points cannot be transferred.
    function setPoints(uint256 spaceId, address member, uint32[4] calldata memberPoints) external {
        Space storage s = _space(spaceId);
        if (msg.sender != s.steward) revert NotSteward();
        if (member == address(0)) revert BadParameters();
        uint32[4] memory previous = points[spaceId][member];
        uint32[4] memory next = memberPoints;
        for (uint256 d = 0; d < DOMAIN_COUNT; d++) {
            s.totalPower[d] = s.totalPower[d] - _power(previous, d) + _power(next, d);
        }
        points[spaceId][member] = next;
        emit PointsSet(spaceId, member, next);
    }

    // ----------------------------------------------------------------------------------------------- Proposing

    /// Opens a pool and its listing vote. A request must come with a first pledge; a community proposal
    /// must come from a contributor with Points and carries no money.
    function propose(
        uint256 spaceId,
        Kind kind,
        uint8 domain,
        uint256 target,
        uint32 fundingPeriod,
        string calldata title,
        uint256 openingPledge
    ) external returns (uint256 poolId) {
        Space storage s = _space(spaceId);
        if (
            domain >= DOMAIN_COUNT ||
            target == 0 ||
            openingPledge > target ||
            fundingPeriod < MIN_PERIOD ||
            fundingPeriod > MAX_PERIOD ||
            bytes(title).length == 0 ||
            bytes(title).length > MAX_TITLE_BYTES
        ) revert BadParameters();
        uint256 total = s.totalPower[domain];
        if (total == 0) revert NoVoters();
        if (kind == Kind.Request) {
            if (openingPledge == 0) revert OpeningPledgeRequired();
        } else {
            if (openingPledge != 0) revert BadParameters();
            if (_power(points[spaceId][msg.sender], domain) == 0) revert NotAContributor();
        }

        poolId = ++poolCount;
        Pool storage p = pools[poolId];
        p.spaceId = spaceId;
        p.proposer = msg.sender;
        p.kind = kind;
        p.domain = domain;
        p.target = target;
        p.fundingPeriod = fundingPeriod;
        p.title = title;
        p.listing.end = uint64(block.timestamp) + s.votingPeriod;
        p.listing.open = true;
        p.listing.totalPower = total;
        spacePools[spaceId].push(poolId);
        emit PoolProposed(poolId, spaceId, msg.sender, kind, domain, target, fundingPeriod, p.listing.end, title);

        if (openingPledge > 0) _pledge(poolId, p, msg.sender, openingPledge);
    }

    // -------------------------------------------------------------------------------------------------- Voting

    /// Votes on the pool's open vote (listing, or closure while building). A member can change their
    /// vote until it ends; power is the square root of their effective Points on the pool's domain.
    function vote(uint256 poolId, Choice choice) external {
        Pool storage p = _pool(poolId);
        Tally storage t = _openTally(p);
        if (block.timestamp >= t.end) revert VotingEnded();
        if (choice == Choice.None) revert BadParameters();
        uint256 power = _power(points[p.spaceId][msg.sender], p.domain);
        if (power == 0) revert NoVotingPower();

        Ballot storage b = ballots[poolId][p.round][msg.sender];
        if (b.choice == Choice.For) t.forPower -= b.power;
        else if (b.choice == Choice.Against) t.againstPower -= b.power;
        else if (b.choice == Choice.Abstain) t.abstainPower -= b.power;

        if (choice == Choice.For) t.forPower += power;
        else if (choice == Choice.Against) t.againstPower += power;
        else t.abstainPower += power;
        b.choice = choice;
        b.power = power;
        emit Voted(poolId, p.round, msg.sender, choice, power);
    }

    /// Closes the open vote. Anyone can call it once the voting period is over, or earlier when the
    /// result can no longer change: For holds more than half of all power, or Against holds at least half.
    function finalize(uint256 poolId) external {
        Pool storage p = _pool(poolId);
        Tally storage t = _openTally(p);
        bool passed;
        if (block.timestamp < t.end) {
            if (t.forPower * 2 > t.totalPower) passed = true;
            else if (t.againstPower * 2 < t.totalPower) revert VoteStillOpen(t.end);
        } else {
            uint256 cast = t.forPower + t.againstPower + t.abstainPower;
            passed = cast * 10_000 >= t.totalPower * QUORUM_BPS && t.forPower > t.againstPower;
        }
        t.open = false;
        if (p.status == Status.Voting) {
            if (passed) {
                p.status = Status.Funding;
                p.deadline = uint64(block.timestamp) + p.fundingPeriod;
            } else {
                p.status = Status.NotListed;
            }
        } else if (passed) {
            p.status = Status.Closed;
        } else {
            // A failed closure vote leaves one voting period in which the pool can be paid.
            p.closureCooldown = uint64(block.timestamp) + spaces[p.spaceId].votingPeriod;
        }
        emit VoteFinalized(poolId, p.round, passed, p.status);
    }

    /// Opens a vote to close a launched pool before it is paid. A funder of the pool or a contributor
    /// can ask; contributors decide. If it passes, every pledge becomes refundable. After a failed
    /// closure vote, another one has to wait one voting period, so repeated votes cannot block a payout.
    function openClosure(uint256 poolId) external {
        Pool storage p = _pool(poolId);
        if (p.status != Status.Building) revert NotBuilding();
        if (p.closure.open) revert ClosureVoteOpen();
        if (block.timestamp < p.closureCooldown) revert ClosureCooldown(p.closureCooldown);
        if (pledgeOf[poolId][msg.sender] == 0 && _power(points[p.spaceId][msg.sender], p.domain) == 0) {
            revert NotAParticipant();
        }
        Space storage s = spaces[p.spaceId];
        uint256 total = s.totalPower[p.domain];
        if (total == 0) revert NoVoters();
        p.round += 1;
        p.closure = Tally({
            end: uint64(block.timestamp) + s.votingPeriod,
            open: true,
            forPower: 0,
            againstPower: 0,
            abstainPower: 0,
            totalPower: total
        });
        emit ClosureOpened(poolId, p.round, msg.sender, p.closure.end);
    }

    // --------------------------------------------------------------------------------------------------- Money

    /// Adds to a listed pool before its deadline. Only what is still missing is taken, never more.
    function pledge(uint256 poolId, uint256 amount) external {
        Pool storage p = _pool(poolId);
        if (p.status != Status.Funding || block.timestamp >= p.deadline) revert FundingClosed();
        _pledge(poolId, p, msg.sender, amount);
    }

    /// Starts the build. Anyone can call it, and it only works once the pool holds its full target.
    function launch(uint256 poolId) external {
        Pool storage p = _pool(poolId);
        if (p.status != Status.Funding) revert NotFunding();
        if (p.pledged < p.target) revert TargetNotReached(p.pledged, p.target);
        p.status = Status.Building;
        emit Launched(poolId, p.pledged);
    }

    /// Returns a funder's whole pledge. Anyone can trigger it and the money only ever goes back to the
    /// funder. Available when the pool was not listed, missed its target by the deadline, or was closed by vote.
    function refund(uint256 poolId, address funder) external {
        Pool storage p = _pool(poolId);
        if (p.status == Status.Funding && block.timestamp >= p.deadline && p.pledged < p.target) {
            p.status = Status.Expired;
        }
        if (p.status != Status.NotListed && p.status != Status.Expired && p.status != Status.Closed) {
            revert RefundNotAvailable();
        }
        uint256 amount = pledgeOf[poolId][funder];
        if (amount == 0) revert NothingToRefund();
        pledgeOf[poolId][funder] = 0;
        p.refunded += amount;
        emit Refunded(poolId, funder, amount);
        if (!token.transfer(funder, amount)) revert TransferFailed();
    }

    /// Pays a launched pool to its contributors by share of project Points, less the fee. The steward
    /// posts the record of accepted work; the split itself is computed here. The last payee receives
    /// the rounding remainder.
    function payOut(uint256 poolId, address[] calldata contributors, uint256[] calldata workPoints) external {
        Pool storage p = _pool(poolId);
        Space storage s = spaces[p.spaceId];
        if (msg.sender != s.steward) revert NotSteward();
        if (p.status != Status.Building) revert NotBuilding();
        if (p.closure.open) revert ClosureVoteOpen();
        uint256 n = contributors.length;
        if (n == 0) revert NoAcceptedWork();
        if (n > MAX_PAYEES || n != workPoints.length) revert BadParameters();
        uint256 totalPoints;
        for (uint256 i = 0; i < n; i++) {
            if (workPoints[i] == 0 || contributors[i] == address(0)) revert BadParameters();
            totalPoints += workPoints[i];
        }

        uint256 fee = (p.pledged * FEE_BPS) / 10_000;
        uint256 net = p.pledged - fee;
        p.status = Status.Paid;
        uint256 sent;
        for (uint256 i = 0; i < n; i++) {
            uint256 amount = i == n - 1 ? net - sent : (net * workPoints[i]) / totalPoints;
            sent += amount;
            emit Payout(poolId, contributors[i], workPoints[i], amount);
            if (!token.transfer(contributors[i], amount)) revert TransferFailed();
        }
        emit PaidOut(poolId, net, fee);
        if (!token.transfer(s.feeRecipient, fee)) revert TransferFailed();
    }

    // --------------------------------------------------------------------------------------------------- Views

    function getSpace(uint256 spaceId) external view returns (Space memory) {
        return _space(spaceId);
    }

    /// The pool as stored, with `status` already showing Expired once the deadline has passed below target.
    function getPool(uint256 poolId) external view returns (Pool memory p) {
        p = _pool(poolId);
        if (p.status == Status.Funding && block.timestamp >= p.deadline && p.pledged < p.target) {
            p.status = Status.Expired;
        }
    }

    function poolIdsOf(uint256 spaceId) external view returns (uint256[] memory) {
        return spacePools[spaceId];
    }

    function pointsOf(uint256 spaceId, address member) external view returns (uint32[4] memory) {
        return points[spaceId][member];
    }

    /// Voting power on a domain, scaled by 1e6: sqrt(Points in the domain + a quarter of all other Points).
    function powerOf(uint256 spaceId, address member, uint8 domain) external view returns (uint256) {
        if (domain >= DOMAIN_COUNT) revert BadParameters();
        return _power(points[spaceId][member], domain);
    }

    function ballotOf(uint256 poolId, uint32 round, address voter) external view returns (Ballot memory) {
        return ballots[poolId][round][voter];
    }

    // ------------------------------------------------------------------------------------------------ Internal

    function _space(uint256 spaceId) private view returns (Space storage s) {
        s = spaces[spaceId];
        if (s.steward == address(0)) revert UnknownSpace();
    }

    function _pool(uint256 poolId) private view returns (Pool storage p) {
        p = pools[poolId];
        if (p.proposer == address(0)) revert UnknownPool();
    }

    function _openTally(Pool storage p) private view returns (Tally storage) {
        if (p.status == Status.Voting) return p.listing;
        if (p.status == Status.Building && p.closure.open) return p.closure;
        revert NoOpenVote();
    }

    function _pledge(uint256 poolId, Pool storage p, address funder, uint256 amount) private {
        uint256 room = p.target - p.pledged;
        if (room == 0) revert PoolFull();
        if (amount == 0) revert BadParameters();
        uint256 take = amount < room ? amount : room;
        if (pledgeOf[poolId][funder] == 0) p.funders += 1;
        pledgeOf[poolId][funder] += take;
        p.pledged += take;
        emit Pledged(poolId, funder, take, p.pledged);
        if (!token.transferFrom(funder, address(this), take)) revert TransferFailed();
    }

    /// sqrt(on + off / 4) scaled by 1e6, written as sqrt((4 * on + off) * 2.5e11) to stay in integers.
    function _power(uint32[4] memory p, uint256 domain) private pure returns (uint256) {
        uint256 on = p[domain];
        uint256 off = uint256(p[0]) + p[1] + p[2] + p[3] - on;
        return _sqrt((4 * on + off) * 250_000_000_000);
    }

    /// Integer square root, rounded down (Babylonian method).
    function _sqrt(uint256 x) private pure returns (uint256 r) {
        if (x > 3) {
            r = x;
            uint256 k = x / 2 + 1;
            while (k < r) {
                r = k;
                k = (x / k + k) / 2;
            }
        } else if (x != 0) {
            r = 1;
        }
    }
}
