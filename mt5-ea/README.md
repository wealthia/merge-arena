# FundedTrendEA — MetaTrader 5 Expert Advisor

A trend-following Expert Advisor for MetaTrader 5, built specifically with **funded / prop-firm challenge accounts** in mind (e.g. FTMO, MyForexFunds, The5ers, etc.). The strategy logic is intentionally simple and robust; the emphasis is on **strict, automatic risk controls** so the EA can't accidentally blow past a firm's daily-loss or max-drawdown rules.

## Strategy

- **Trend filter**: price vs. a slow EMA (`TrendEmaPeriod`) determines the allowed trade direction (long above, short below).
- **Entry trigger**: fast EMA crosses medium EMA (`FastEmaPeriod` / `SlowEmaPeriod`) in the direction of the trend.
- **Momentum confirmation**: RSI (`RsiPeriod`) must not be in the overbought/oversold extreme against the trade direction (avoids buying into an exhausted move).
- **Exit**: ATR-based stop loss and take profit (`AtrSlMultiplier`, `AtrTpMultiplier`), plus an optional trailing stop once the trade is in sufficient profit (`UseTrailingStop`, `TrailingStartRR`, `TrailingAtrMultiplier`).
- **One position at a time** per symbol by default (`MaxOpenPositions`), to keep exposure predictable.

This is a directional swing/trend strategy — no martingale, no grid, no averaging-in — since those techniques are explicitly banned by almost every prop firm's rulebook.

## Risk management (the important part)

All limits are enforced automatically, every tick, independent of the trading logic:

| Control | Input | Behaviour |
|---|---|---|
| Per-trade risk | `RiskPercentPerTrade` | Lot size is calculated from account equity × risk% ÷ stop-loss distance, so every trade risks the same fraction of the account. |
| Daily loss limit | `MaxDailyLossPercent` | Tracks equity at the start of the broker day; if realised+floating loss exceeds this %, the EA closes everything and stops opening new trades until the next day. |
| Max drawdown kill-switch | `MaxOverallDrawdownPercent` | Tracks the account's peak equity since the EA started; if drawdown from that peak exceeds this %, the EA disables trading entirely (manual re-enable required). |
| Max spread filter | `MaxSpreadPoints` | Skips new entries when the current spread is abnormally wide (news spikes, low liquidity). |
| Trading session filter | `UseSessionFilter`, `SessionStartHour`, `SessionEndHour` | Restricts new entries to a configurable server-time window. |
| Friday/weekend flat | `CloseAllBeforeWeekend`, `WeekendCloseHour` | Optionally flattens all positions before the weekend gap. |
| Max concurrent positions | `MaxOpenPositions` | Hard cap on simultaneous open trades for the symbol. |

All the above are **inputs**, so you can tune them to match the exact rules of whichever funded program you're on (e.g. set `MaxDailyLossPercent` to slightly under the firm's actual daily-loss limit to leave a safety margin).

## Files

- `FundedTrendEA.mq5` — the Expert Advisor source.

## How to use

1. Open MetaEditor (bundled with MetaTrader 5).
2. Copy `FundedTrendEA.mq5` into `MQL5/Experts/` in your MT5 data folder (`File > Open Data Folder` from the terminal).
3. Open the file in MetaEditor and press **Compile** (F7). This produces `FundedTrendEA.ex5`.
4. In MT5, drag the EA from the Navigator onto the chart of the symbol/timeframe you want to trade (this strategy is designed for H1/H4 charts, not scalping timeframes).
5. Set the inputs to match your account size and the funded program's specific rules, then enable **AutoTrading**.
6. **Always backtest and forward-test on a demo account first** before running on a live funded account. Past performance of any strategy is not a guarantee of future results.

## Disclaimer

This code is provided as a starting point/framework, not financial advice. Algorithmic trading carries real risk of loss. Test thoroughly in the Strategy Tester and on a demo account, and confirm your prop firm explicitly permits algorithmic/EA trading on the account type you hold before going live.
