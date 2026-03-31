// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// immutable on-chain audit log for autonomous agent decisions.
// each cycle commits five steps in order. every step stores a keccak256 hash
// of the off-chain payload so the session can be verified without trusting anyone.
contract DecisionLog {

    enum StepKind {
        POLICY,   // 0 — operating rules, committed before any action
        MARKET,   // 1 — raw market data the agent saw
        DECISION, // 2 — AI verdict, reasoning, confidence
        CHECK,    // 3 — policy gate result
        EXECUTION // 4 — swap outcome or block reason
    }

    struct Step {
        StepKind kind;
        bytes32  dataHash;  // keccak256 of the off-chain JSON payload
        uint256  timestamp;
        address  agent;
    }

    struct Session {
        bytes32  sessionId;
        address  agent;
        uint256  startedAt;
        uint256  stepCount;
        bool     finalized;
        mapping(uint256 => Step) steps;
    }

    struct Attestation {
        address attester;
        uint256 timestamp;
    }

    mapping(bytes32 => Session) private _sessions;
    mapping(address => bytes32[]) public agentSessions;
    mapping(bytes32 => Attestation[]) private _attestations;
    mapping(bytes32 => mapping(address => bool)) private _hasAttested;

    event SessionStarted(bytes32 indexed sessionId, address indexed agent, uint256 timestamp);
    event StepCommitted(
        bytes32 indexed sessionId,
        address indexed agent,
        uint8   stepKind,
        uint256 stepIndex,
        bytes32 dataHash,
        uint256 timestamp,
        string  payload
    );
    event SessionFinalized(bytes32 indexed sessionId, address indexed agent, uint256 timestamp);
    event Attested(bytes32 indexed sessionId, address indexed attester, uint256 timestamp);

    error SessionAlreadyExists(bytes32 sessionId);
    error SessionNotFound(bytes32 sessionId);
    error SessionAlreadyFinalized(bytes32 sessionId);
    error NotSessionAgent(bytes32 sessionId, address caller);
    error InvalidStepOrder(uint8 expected, uint8 got);
    error StepOutOfRange(uint256 stepIndex);
    error AlreadyAttested(bytes32 sessionId, address attester);
    error SessionNotFinalized(bytes32 sessionId);

    // start a new session — must be called before committing any steps
    function startSession(bytes32 sessionId) external {
        if (_sessions[sessionId].startedAt != 0) revert SessionAlreadyExists(sessionId);

        Session storage s = _sessions[sessionId];
        s.sessionId = sessionId;
        s.agent     = msg.sender;
        s.startedAt = block.timestamp;

        agentSessions[msg.sender].push(sessionId);
        emit SessionStarted(sessionId, msg.sender, block.timestamp);
    }

    // commit a step hash — steps must arrive in order: POLICY → MARKET → DECISION → CHECK → EXECUTION
    // payload is emitted in the event for on-chain retrieval but not stored in contract state
    function commitStep(bytes32 sessionId, StepKind kind, bytes32 dataHash, string calldata payload) external {
        Session storage s = _sessions[sessionId];

        if (s.startedAt == 0)      revert SessionNotFound(sessionId);
        if (s.finalized)           revert SessionAlreadyFinalized(sessionId);
        if (s.agent != msg.sender) revert NotSessionAgent(sessionId, msg.sender);

        uint256 expected = s.stepCount;
        if (uint8(kind) != expected) revert InvalidStepOrder(uint8(expected), uint8(kind));

        s.steps[expected] = Step({ kind: kind, dataHash: dataHash, timestamp: block.timestamp, agent: msg.sender });
        s.stepCount++;

        emit StepCommitted(sessionId, msg.sender, uint8(kind), expected, dataHash, block.timestamp, payload);
    }

    // mark session complete — no more steps after this
    function finalizeSession(bytes32 sessionId) external {
        Session storage s = _sessions[sessionId];

        if (s.startedAt == 0)      revert SessionNotFound(sessionId);
        if (s.finalized)           revert SessionAlreadyFinalized(sessionId);
        if (s.agent != msg.sender) revert NotSessionAgent(sessionId, msg.sender);

        s.finalized = true;
        emit SessionFinalized(sessionId, msg.sender, block.timestamp);
    }

    function getStep(bytes32 sessionId, uint256 stepIndex)
        external view
        returns (uint8 kind, bytes32 dataHash, uint256 timestamp, address agent)
    {
        Session storage s = _sessions[sessionId];
        if (s.startedAt == 0)          revert SessionNotFound(sessionId);
        if (stepIndex >= s.stepCount)  revert StepOutOfRange(stepIndex);
        Step storage step = s.steps[stepIndex];
        return (uint8(step.kind), step.dataHash, step.timestamp, step.agent);
    }

    function getSession(bytes32 sessionId)
        external view
        returns (address agent, uint256 startedAt, uint256 stepCount, bool finalized)
    {
        Session storage s = _sessions[sessionId];
        if (s.startedAt == 0) revert SessionNotFound(sessionId);
        return (s.agent, s.startedAt, s.stepCount, s.finalized);
    }

    function sessionCount(address agent) external view returns (uint256) {
        return agentSessions[agent].length;
    }

    // attest that you have independently verified this session's hashes on-chain
    function attest(bytes32 sessionId) external {
        Session storage s = _sessions[sessionId];
        if (s.startedAt == 0)    revert SessionNotFound(sessionId);
        if (!s.finalized)        revert SessionNotFinalized(sessionId);
        if (_hasAttested[sessionId][msg.sender]) revert AlreadyAttested(sessionId, msg.sender);

        _attestations[sessionId].push(Attestation({ attester: msg.sender, timestamp: block.timestamp }));
        _hasAttested[sessionId][msg.sender] = true;

        emit Attested(sessionId, msg.sender, block.timestamp);
    }

    function getAttestationCount(bytes32 sessionId) external view returns (uint256) {
        return _attestations[sessionId].length;
    }

    function getAttestation(bytes32 sessionId, uint256 index)
        external view
        returns (address attester, uint256 timestamp)
    {
        Attestation storage a = _attestations[sessionId][index];
        return (a.attester, a.timestamp);
    }

    function hasAttested(bytes32 sessionId, address attester) external view returns (bool) {
        return _hasAttested[sessionId][attester];
    }
}
