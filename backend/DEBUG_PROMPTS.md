# ACM Debug Prompts (when AI code is wrong)

Use these prompts to force strict, actionable debugging output.

## 1) API compliance
**Prompt:** “Compare the implementation to the API spec exactly. List every mismatch in path, fields, enums, status codes, and response shape. Cite file paths + line numbers.”

## 2) Schema ↔ query mismatches
**Prompt:** “Find schema fields that are written/queried/sorted but not defined or indexed in Mongoose. For each, show the write site and read site and propose the minimal schema/index fix.”

## 3) Node/Python boundary contract
**Prompt:** “Define the exact Node↔Python payload contract (units, required fields, types). Identify any unit mismatches and propose a single authoritative conversion point without adding physics to Node.”

## 4) Collision scaling (no O(N²))
**Prompt:** “Prove the collision pipeline is not O(N²) in typical operation. Identify any parameters that can cause KD-tree to return near-all pairs and propose caps/substepping.”

## 5) Retry/timeout correctness
**Prompt:** “Audit retry logic: which failures are retried, with what backoff, and what’s the worst-case request amplification? Propose a safer retry policy (only transient errors).”

## 6) Step correctness / determinism
**Prompt:** “Trace one `/api/simulate/step` request end-to-end and list all state mutations in Node and Python. Identify any ordering/race hazards and propose fixes.”

## 7) Edge-case drills
**Prompt:** “Create a table of edge cases (fuel depletion, cooldown violation, LOS blackout). For each: expected behavior, current behavior, missing logic, and a minimal implementation plan.”

