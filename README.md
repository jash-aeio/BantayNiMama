# BantayNiMama

**Offline-first visual price scanner for Philippine sari-sari stores.**

Point the camera at a product — see its name and price. Teach it new products in seconds.
No barcode required, no internet, no account.

---

## The problem

A new store helper (*katulong*) is expected to quote prices for several hundred SKUs within days of
starting. And a large share of sari-sari inventory — repacked sugar and rice, pandesal, *tingi*
shampoo sachets, single-stick candy — **has no barcode at all**.

Existing POS apps assume a barcode and assume a connected backend. Both assumptions fail at a
neighbourhood counter in the Philippines.

BantayNiMama replaces the barcode with the product's own appearance, and replaces the backend with
the phone.

## How it works

On-device image embeddings plus local vector search — **few-shot, with no model retraining**.
The vendor captures 3–5 photos of a product; the embeddings are written to an on-device vector
database; the product is recognizable on the very next camera frame.

```
camera frame → reticle crop → MobileNetV3 embedding (in-worklet)
             → nearest-neighbour search → τ/δ policy → 3-of-5 stability gate → price on screen
```

Budget: ≤ 60 ms per processed frame at 4 fps (`NFR-07`). **Not met yet.** On an Infinix X6823
(release build) crop + resize + inference measures a median 145.5 ms; see
[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## Status

**Phase 1 — Proof of concept, real data path.** Phase 0 tested the core thesis first: a generic
mobile embedding model ranked the right product first for **94.5%** of test photos of real
sari-sari SKUs (gate ≥ 85%). Phase 1 now builds storage, enrollment and scanning on top of it.

See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## Documentation

| Document | Contents |
|---|---|
| [`PROJECT_SPECS.md`](docs/PROJECT_SPECS.md) | System + technical requirements, NFRs, known limitations, glossary |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Threading model, pipeline, schema, invariants |
| [`PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Current phase, gates, measured results |
| [`DECISIONS.md`](docs/DECISIONS.md) | Architecture decision records |
| [`CHANGELOG.md`](docs/CHANGELOG.md) | What shipped, when |
| [`TOOLING.md`](docs/TOOLING.md) | Claude Code setup, slash commands, MCP recommendations |
| [`CLAUDE.md`](CLAUDE.md) | Agent instructions and project conventions |

## Stack

React Native · Expo SDK 57 (dev client) · react-native-vision-camera v5 ·
react-native-fast-tflite · op-sqlite (vectors stored as BLOBs — ADR-014) · expo-router · TypeScript

> **Expo Go will not work.** The native modules require a development build (`TR-03`).

## Getting started

```bash
cp .env.example .env
npm install
npx expo start --dev-client   # needs a dev build installed on a physical device
```

Nothing here talks to a network. If a dependency does, it does not belong in this project
(`TR-51`).

## Design constraints worth knowing before contributing

- **No backend, no API keys, no auth — ever** (`TR-50`)
- **Money is integer centavos**, never floats (`TR-41`)
- **Precision beats recall** — prefer "Unknown" over a wrong price (`NFR-02` > `NFR-01`)
- Two limitations are **genuinely unsolvable** by embeddings and are designed around rather than
  fixed: repacked goods in clear bags (`L-01`) and same-product-different-size (`L-02`)

## Glossary

**Sari-sari store** — small neighbourhood convenience store · **Tindera** — the store owner ·
**Katulong** — helper, the primary scanner user · **Tingi** — sold per piece ·
**Buo** — sold by the pack
