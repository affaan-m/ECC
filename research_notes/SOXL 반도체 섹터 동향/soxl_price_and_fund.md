# SOXL price action, fund mechanics and flows (as of 2026-11-24)

Data caveats: Alpha Vantage prices are unadjusted raw OHLC from the Alpha Vantage MCP tool (TIME_SERIES_DAILY compact = Jul 6 to Nov 23 2026; TIME_SERIES_MONTHLY). Latest bar is 2026-11-23 (the 11-24 session was not available). Direct page fetches of direxion.com returned HTTP 403, so no primary fund-page data was obtained. Aggregator fund data conflict (flagged below). "Alpha Vantage" has no URL source beyond the API: [Alpha Vantage](https://www.alphavantage.co/documentation/).

## 1. Price levels, returns, 52-week range, drawdowns

### Takeaway
SOXL went from a ~$302 intraday peak in June 2026 to a $29.82 intraday low on 2026-11-20 (about -90%), then rebounded +39.9% on 2026-11-23 to close $43.21. The collapse accelerated from late October, with the Nov 5 chip crash and Nov 20 as the worst sessions.

### Cited Findings
- Last close 2026-11-23: $43.21 (O 44.82, H 44.85, L 40.68, vol 400.3M). Prior day 2026-11-20 close $30.88 (L 29.82, H 42.57, vol 543.7M); a -31.8% day close-to-close from $45.30. 11-23 was +39.9% from the 11-20 close — [Alpha Vantage daily](https://www.alphavantage.co/documentation/); -31.83% on 11-20 and 1-day range $29.82-$42.57 confirmed by [ETF Central](https://www.etfcentral.com/fund/SOXL)
- Monthly bars (Alpha Vantage, unadjusted): Jun 2026 high $302.00, close $266.71; Jul close $114.72 (month high $246.47, low $91.50); Aug close $112.79; Sep close $147.86; Oct close $77.05 (month high $169.83); Nov through 11-23 low $29.82 — [Alpha Vantage monthly](https://www.alphavantage.co/documentation/)
- Earlier 2026 month-end closes: Dec 2025 $42.03; Jan $61.79; Feb $62.77; Mar $47.91; Apr $126.98; May $224.34 — [Alpha Vantage monthly](https://www.alphavantage.co/documentation/). Nov 2025 close $41.26 (Nov 2025 monthly low $28.12) — same source; note a Dec 2025 article cited a November low of $30.81 and a December high of $50.09 ([24/7 Wall St via Yahoo](https://finance.yahoo.com/news/soxl-13-6-billion-fund-145735009.html)), which conflicts with the $28.12 monthly low
- ETF Central 52-week range: $30.69-$301.25 (as of 11/20/2026), but its own 1-day low $29.82 is below the stated 52-week low, so the range is stale/inconsistent — [ETF Central](https://www.etfcentral.com/fund/SOXL)
- ETF Central performance as of 11/20/2026: 1W -47.38%, 1M -68.54%, 3M -74.87%, YTD -26.86%, 1Y -0.15%, 3Y +29.07%, 5Y -51.60% — [ETF Central](https://www.etfcentral.com/fund/SOXL)
- My calculations from Alpha Vantage closes to 2026-11-23 $43.21: 1M (vs 10-23 $83.56) -48.3%; 3M (vs 08-24 $111.16) -61.1%; vs 07-06 $194.65 -77.8%; vs 05-29 month-end $224.34 -80.7% (6M exact-date close unavailable; compact daily data begins 07-06); YTD vs 2025-12-31 close $42.03 +2.8%; vs 2025-11-28 close $41.26 +4.7% (approx 1Y; the 2025-11-24 close was not retrieved)
- Same calcs to 11-20 close $30.88: YTD -26.5% (agrees with ETF Central -26.86%)
- Largest daily moves in the data window (close-to-close, Alpha Vantage): 11-23 +39.9%; 11-05 -38.7% ($66.68 to $40.87, vol 549M); 11-20 -31.8%; 11-04 -8.8%; 11-13 -11.0% ($65.53 to $58.32); 07-29 -16.0% (vs 109.54 prior close)... all as computed from the raw closes
- Peak-to-trough: Jun 2026 intraday high $302.00 to 11-20 intraday low $29.82 = -90.1%. Exact peak date not found (inside June 2026; daily data not retrieved). Close-to-close 11-20 $30.88 vs the Jun close high is not computable from monthly data
- Intermediate drawdowns: Jun month close $266.71 to Jul 29 low $91.50 = -65.7%; rebound to $165.75 high (Aug 17 ~$156.92 intraday high); Oct 2 close $163.71 (Oct 6 high $169.83) to Nov 5 close $40.87 = -75.0%; 10-29 close $102.39 to 11-05 close $40.87 = -60.1% in 5 sessions
- Edgen headline: "SOXL plunges 60 as leveraged ETF drawdown hits semiconductor bulls" and a report that SOXL gained 535% in H1 2026 then lost more than 60% in a little over a month (secondary report via search snippet, not verified) — [Edgen](https://www.edgen.tech/news/post/soxl-plunges-60-as-leveraged-etf-drawdown-hits-semiconductor-bulls) (page returned HTTP 410 on fetch; snippet only)

### Inferences
- Roughly all of SOXL's 2026 gain (Apr-Jun run from ~$46 to ~$302, +550%) has been erased by 11-20; at $43.21 it is back near the Dec 2025 close of $42.03.
- 11-20/11-23 intraday ranges ($29.82 to $42.57 on 11-20) imply extreme intraday volatility and a possible disorderly session; cause not found (see Gaps).

### Gaps
- Exact date of the all-time/52-week peak close and daily path before 07-06 (compact daily = 100 sessions; full output requires premium).
- Cause of the 11-20 -31.8% day and the 11-23 +39.9% rebound: a search found no coverage of a Nov 20 semiconductor event; the SOXX data show -10.5% on 11-20 and +13.6% on 11-23 (see section 4).
- The 11-24 session not available.

## 2. Fund structure: expense ratio, AUM, volume, flows, holdings, index

### Takeaway
Expense ratio is 0.91% gross / 0.75% net per search summary of Direxion (conflicting aggregator values). AUM reports range from $9.75B (11-20) to $23.07B (10-26), reflecting the price collapse and large inflows into the dip. The fund holds mostly swap exposure to the ICE/NYSE Semiconductor index.

### Cited Findings
- Expense ratio: 0.91% listed by ETF Central ([ETF Central](https://www.etfcentral.com/fund/SOXL)); search summary says Direxion shows 0.75% net / 0.91% gross, with an expense limitation agreement (not directly verified; Direxion page blocked, 403) — [Direxion](https://www.direxion.com/product/daily-semiconductor-bull-3x-etf). Alpha Vantage ETF_PROFILE net_expense_ratio: n/a
- Net assets: $9.75B as of 11/20/2026 — [ETF Central](https://www.etfcentral.com/fund/SOXL); Alpha Vantage ETF_PROFILE $18.3B (last_updated 2026-11-20 00:01 UTC; likely pre-crash stale figure); $23.07B as of 2026-10-26 per ETF Central (via search summary); $13.6B as of Dec 15 2025 — [24/7 Wall St via Yahoo](https://finance.yahoo.com/news/soxl-13-6-billion-fund-145735009.html); Trackinsight EUR 12.97B as of 2026-11-17 (search snippet only)
- Flows as of 11/20/2026: 1M +$4.34B; 3M +$9.13B; YTD -$1.56B; 1Y -$3.15B; 3Y -$10.75B; 5Y -$5.58B — [ETF Central](https://www.etfcentral.com/fund/SOXL). An earlier snapshot (as of 10/26/2026) showed 1M +$8.54B, YTD -$2.94B (search summary only). TradingView shows 1Y flows of about -$13.86B, undated and conflicting (search summary only)
- Volume (Alpha Vantage): 11-23 400.3M shares; 11-20 543.7M; 11-05 549.1M; 11-19 330.3M; vs typical Aug-Sep sessions 34M-100M and early Oct 37M-75M. Rough average of the last 10 sessions ~ 300M+ (my approximation from listed volumes); official average volume not found
- Index: ETF Central lists NYSE Semiconductor GTR Index (USD); Alpha Vantage holdings label "ICESEMI SWAP ASSET LEG" (ICE Semiconductor Index is the current name of the NYSE Semiconductor Index) — [ETF Central](https://www.etfcentral.com/fund/SOXL)
- Inception 2010-03-11; portfolio turnover 2.5 (250%); TTM distribution yield 0.3% — [Alpha Vantage ETF_PROFILE](https://www.alphavantage.co/documentation/); [ETF Central](https://www.etfcentral.com/fund/SOXL)
- Holdings (Alpha Vantage ETF_PROFILE, updated 2026-11-20, weights of net assets): ICE Semi swap asset leg 65.87%; cash/Treasury money-market lines ~ 18% in total (Dreyfus Treasury 6.23%, Goldman FS Treasury 4.66%, Dreyfus Govt 4.45%, GS Fin Gov 2.5%, JPM 0.27%, cash 0.9%); direct equities small: AMD 1.80%, AVGO 1.51%, MU 1.26%, NVDA 1.19%, INTC 1.04%, TXN 0.95%, ADI 0.89%, QCOM 0.83%, NXPI 0.74%, MPWR 0.72%, KLAC 0.69%, AMAT 0.64%, LRCX 0.59%, MRVL 0.58%, TSM 0.58%, SK Hynix ADR 0.48%. Look-through index weights not provided; the swap carries the main exposure
- In Dec 2025, the swap was 13.8% of assets, with cash/Treasuries ~30%, and AVGO 6.1% / MU 4.5% of equity exposure (equity weights) — [24/7 Wall St via Yahoo](https://finance.yahoo.com/news/soxl-13-6-billion-fund-145735009.html)

### Inferences
- A fall in AUM from $23.07B (10/26) to $9.75B (11/20) with +$4.34B of net inflows over 1M implies roughly $17B of the decline came from price losses.
- Flows are strongly dip-buying: positive 1M/3M flows, negative YTD/1Y, i.e., retail added through the crash.

### Gaps
- Official Direxion NAV, premium/discount, expense ratio confirmation, official average volume and SEC-filed holdings (site blocked).
- Look-through top-10 index constituent weights as of Nov 2026 (the ETF's equity lines are partial).

## 3. Volatility decay and path dependency (daily 3x reset)

### Takeaway
Over Jul 6 to Nov 23, 2026, SOXX (split-adjusted) fell 27.7% while SOXL fell 77.8%; SOXL lost less than the naive 3x of SOXX (-83%) in the decline, but in a choppy flat stretch (Jul 6 to Oct 2, SOXX +1.3%) SOXL lost 15.9%, showing clear volatility drag.

### Cited Findings
- SOXX had a 3-for-1 split effective 2026-11-05 (raw price $450.41 on 11-04 to $131.90 on 11-05; 24/7 Wall St states SOXX closed at $131.90, down $18.24, or 12.15%, implying a prior adjusted close of $150.14 = 450.41/3) — [24/7 Wall St](https://247wallst.com/investing/2026/11/06/chip-stocks-just-had-their-second-worst-day-on-record/); raw closes from [Alpha Vantage daily](https://www.alphavantage.co/documentation/)
- Nov 5 2026: SOX fell 12.25% to 9,011.14 (largest drop since 2020-03-16, -15.90%); SMH -11.21%; SOXL closed -38.7% (my calc, Alpha Vantage) vs 3x of -12.25% = -36.8% — [24/7 Wall St](https://247wallst.com/investing/2026/11/06/chip-stocks-just-had-their-second-worst-day-on-record/)
- Computed returns (split-adjusted SOXX closes, my calculation from Alpha Vantage data), start 2026-07-06 (SOXX 193.84 adjusted, SOXL 194.65): to 07-31 SOXX -13.2%, SOXL -41.1%; to 08-31 SOXX -12.1%, SOXL -42.1%; to 09-30 SOXX -2.2%... SOXL -24.0%; to 10-02 SOXX +1.3%, SOXL -15.9% (3x SOXX = +3.8%); to 10-30 SOXX -18.9%, SOXL -60.4%; to 11-12 SOXX -20.0%, SOXL -66.3% (3x -60.1%); to 11-23 SOXX -27.7%, SOXL -77.8% (3x simple -83.0%)
- Daily compounding check on two sessions: 11-20 SOXX -10.55% vs SOXL -31.8% (3x = -31.7%); 11-23 SOXX +13.6% vs SOXL +39.9% (3x = +40.8%); tracking for the daily objective looks tight on both days (my calc)
- 24/7 Wall St (Dec 2025) described rebalancing/cash drag and extreme turnover but gave no quantified decay — [Yahoo/24/7 Wall St](https://finance.yahoo.com/news/soxl-13-6-billion-fund-145735009.html)
- TTM 1Y return -0.15% (11/20/2026) vs 5Y -51.6% per ETF Central, indicating path-dependence over long horizons — [ETF Central](https://www.etfcentral.com/fund/SOXL)

### Inferences
- The drag shows up as: SOXX roughly flat (+1.3%) across Jul 6 to Oct 2 yet SOXL -15.9% (about a 20pt shortfall vs 3x). In the later one-way decline, compounding actually helped SOXL relative to linear 3x (-77.8% vs -83%).
- SOXX and SOXL have different return bases (price vs NAV and distributions); SOX (index) data not retrieved, so SOXX is a proxy. Daily 3x replication across the sampled days appears within ~1pt.
- Intermediate sample dates were chosen from Fridays/month-ends in the retrieved data, not a full-daily series; full daily compounding was not performed.

### Gaps
- Direxion tracking-difference data and SOX index levels over 6-12 months (ETF Central "replication quality" locked behind login).
- No full 12-month realized-volatility figure; daily data prior to 07-06 requires a premium plan.

## 4. Distributions, splits, product changes, and macro context

### Takeaway
No SOXL split since 2021 and distributions are tiny (latest $0.0929 ex-date 2026-09-22). The Nov 2026 selloff was driven by AI-spending fears, a midterm election outcome and profit taking.

### Cited Findings
- Splits (Alpha Vantage): 2021-03-02 split factor 15 (a forward 15-for-1; prior prices ~$500+ unadjusted in Feb 2021) and 2015-05-20 factor 4; no split in 2025-2026 — [Alpha Vantage splits](https://www.alphavantage.co/documentation/)
- Dividends (Alpha Vantage): ex-date 2026-09-22 $0.0929 (pay 2026-09-29); 2025-09-23 $0.01008; 2025-06-24 $0.06799; 2025-03-25 $0.06477; 2024-12-23 $0.07683. TTM yield ~0.3% (ETF Central) / 0.12% (Alpha Vantage ETF_PROFILE dividend_yield 0.0012) — [Alpha Vantage dividends](https://www.alphavantage.co/documentation/)
- No 2025 Q4/2026 Q1-Q2 distributions appear in the Alpha Vantage list beyond Sep 2026 (a 2025-12 and 2026-03/06 ex-dates are missing, so the list may be incomplete) — same source
- Reverse split: none found in data. No product change/closure found (not verified against Direxion notices).
- Context: SOX closed Nov 5 at 9,011.14 (-12.25%), first close below 10,000 since Apr 28; Nasdaq Composite -5.52%; MU -17.46% to $656.39; LRCX -16.36%; NVDA -9.26% to $181.60; reasons cited: AI-regulation fears after Democrats won Congress, hedge-fund profit taking (Nomura), weak results from two chip designers and Broadcom guidance below expectations — [24/7 Wall St](https://247wallst.com/investing/2026/11/06/chip-stocks-just-had-their-second-worst-day-on-record/); [Grafa](https://grafa.com/en/news/united-states/us-semiconductor-stocks-selloff-ai-trade-unwind-november-2026) (Grafa says approx 9% decline; sources differ). SOXX -22.99% and SMH -20.29% for the week to Nov 5 — via search summary of [StockTwits](https://stocktwits.com/news-articles/markets/equity/soxx-etf-semiconductor-is-set-for-its-worst-week-in-over-18-months/cNG1sEhR94Z)
- SOXX ended 11-23 at $140.22 (vs $123.40 on 11-20; $131.90 on 11-05; adjusted high ~$198 in early Jul 2026) — [Alpha Vantage daily](https://www.alphavantage.co/documentation/)
- Nvidia earnings were expected 2026-11-17 after close (not confirmed in sources); SOXL moved 11-17 -0.4%, 11-18 +0.4%, then 11-19 -8.0% (calc), 11-20 -31.8%

### Inferences
- No structural product event (split/reverse split) explains the Nov 20 or Nov 23 moves; they look market-driven, but I found no news explaining them.

### Gaps
- Cause of the Nov 20 plunge and Nov 23 rebound (no sources found; SOXX -10.5% / +13.6%).
- Whether any Direxion reverse-split notice or fund change was issued (Direxion site inaccessible); Q4 2026 distribution date.
- The Nvidia Nov 17 earnings outcome not found.
