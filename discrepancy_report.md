# Discrepancy report

Built 2026-08-09. Flighty 307 · FR24 300 · merged 307 (304 flown, 2 booked, 1 cancelled).

## Section-2 correction checks

- ✅ FR24 NAP→MXP is Sep 2018
- ✅ FR24 MXP→MAN is Sep 2018
- ✅ FR24 MAN→FAO is 24 Sep 2018
- ✅ Flighty MAN→AMS is 18 Nov 2019
- ✅ Flighty SPU→MAN is 31 Jul 2017
- ✅ FR24 SIN→MEL is QF38 25 Nov 2025
- ✅ FR24 LGW→BGO is 3 Oct 2024
- ✅ 18 Jul 2025 is LCY→LIN (not STN→GOA)
- ✅ EZE→SCL 27 Jan 2024 deleted
- ✅ Phantom STN→TLS 31 May 2025 deleted from Flighty
- ✅ Added QF475 SYD→MEL 27 Mar 2023 present
- ✅ Added DL2265 BOS→LGA 16 Feb 2024 present
- ✅ Added BA302 LHR→CDG 8 Nov 2025 present
- ✅ Added VY6948 ORY→LGW 9 Nov 2025 present

## Validation vs country_reconciliation.csv

- Countries visited: **69** (reconciliation expects 66)
- Transit-only: **6** (expects 6)
- ✅ All reconciliation countries present with correct status

## Single-source flights (review — not dropped)

### Flighty only (7)

- 2026-07-06 LGW→BOD BAW2570
- 2026-07-10 BOD→LGW BAW2573
- 2026-07-27 FNC→LIS TAP1692
- 2026-07-28 LIS→VCE TAP860
- 2026-08-02 VCE→STN RYR793
- 2026-09-03 LGW→NAP EZY8341
- 2026-09-06 NAP→LGW EZY8342

### FR24 only (0)


## Notes & fuzzy matches

- Correction: flighty MAN→AMS 2019-11-19 → 2019-11-18 (KL1070 overnight — corrected to 18 Nov 2019)
- Correction: flighty SPU→MAN 2017-08-01 → 2017-07-31 (LS916 — corrected to 31 Jul 2017)
- Correction: removed flighty 2025-05-31 STN→TLS (phantom FR281 removed — real outbound was BA376 LHR→TLS 20 May 2025)