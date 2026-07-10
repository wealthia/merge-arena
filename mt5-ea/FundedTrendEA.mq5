//+------------------------------------------------------------------+
//|                                                FundedTrendEA.mq5 |
//|                                                                  |
//| Trend-following EA (EMA cross + RSI filter + ATR exits) built    |
//| with strict, automatic risk controls suited to funded / prop-    |
//| firm challenge accounts (daily loss limit, max drawdown kill     |
//| switch, per-trade risk sizing, spread & session filters).        |
//|                                                                  |
//| No martingale, no grid, no averaging-in.                         |
//+------------------------------------------------------------------+
#property copyright "FundedTrendEA"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\AccountInfo.mqh>

//================= INPUTS =================//

input group "=== Strategy: EMAs ==="
input int    FastEmaPeriod          = 12;     // Fast EMA period
input int    SlowEmaPeriod          = 26;     // Slow EMA period (cross with fast)
input int    TrendEmaPeriod         = 200;    // Long-term trend filter EMA period

input group "=== Strategy: RSI filter ==="
input int    RsiPeriod              = 14;     // RSI period
input double RsiOverbought          = 70.0;   // Skip new longs if RSI above this
input double RsiOversold            = 30.0;   // Skip new shorts if RSI below this

input group "=== Strategy: ATR exits ==="
input int    AtrPeriod              = 14;     // ATR period
input double AtrSlMultiplier        = 1.5;    // Stop loss = ATR * this
input double AtrTpMultiplier        = 3.0;    // Take profit = ATR * this
input bool   UseTrailingStop        = true;   // Enable ATR trailing stop
input double TrailingStartRR        = 1.0;    // Start trailing once profit >= this * initial risk
input double TrailingAtrMultiplier  = 1.5;    // Trailing distance = ATR * this

input group "=== Risk management ==="
input double RiskPercentPerTrade    = 0.5;    // % of equity risked per trade
input double MaxDailyLossPercent    = 3.0;    // Stop trading for the day if equity drawdown exceeds this %
input double MaxOverallDrawdownPercent = 8.0; // Disable EA entirely if drawdown from peak equity exceeds this %
input int    MaxOpenPositions       = 1;      // Max simultaneous open positions on this symbol
input double MaxSpreadPoints        = 30;     // Skip new entries if current spread (points) exceeds this
input double MinLot                 = 0.01;   // Absolute floor for calculated lot size

input group "=== Session filter ==="
input bool   UseSessionFilter       = false;  // Restrict new entries to a server-time window
input int    SessionStartHour       = 7;      // Session start hour (server time, 0-23)
input int    SessionEndHour         = 19;     // Session end hour (server time, 0-23)

input group "=== Weekend safety ==="
input bool   CloseAllBeforeWeekend  = true;   // Flatten all positions before the weekend gap
input int    WeekendCloseHour       = 20;     // Hour on Friday (server time) to flatten everything

input group "=== Misc ==="
input ulong  MagicNumber            = 20260710; // Magic number for this EA's orders
input string TradeComment           = "FundedTrendEA";

//================= GLOBALS =================//

CTrade        trade;
CPositionInfo posInfo;
CSymbolInfo   symbolInfo;

int handleFastEma, handleSlowEma, handleTrendEma, handleRsi, handleAtr;

double g_dayStartEquity   = 0.0;
datetime g_currentDay     = 0;
double g_peakEquity       = 0.0;
bool   g_tradingDisabled  = false; // permanent kill switch (max overall drawdown breached)
bool   g_dailyLimitHit    = false; // resets every new day

//================= FORWARD DECLARATIONS =================//
// MQL5 requires a function to be declared before it is used, so functions
// that are called by others defined earlier in the file are declared here.
datetime CurrentDayStart();
void     UpdateDayRollover();
void     UpdateDrawdownGuard();
void     UpdateDailyLossGuard();
void     CloseAllPositions();
int      CountOpenPositions();
bool     IsWithinSession();
bool     IsWeekendCloseTime();
bool     SpreadOk();
double   CalculateLotSize(double slDistancePrice);
void     CheckForEntry();
void     ManageTrailingStops();

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(20);
   symbolInfo.Name(_Symbol);

   handleFastEma  = iMA(_Symbol, PERIOD_CURRENT, FastEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
   handleSlowEma  = iMA(_Symbol, PERIOD_CURRENT, SlowEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
   handleTrendEma = iMA(_Symbol, PERIOD_CURRENT, TrendEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
   handleRsi      = iRSI(_Symbol, PERIOD_CURRENT, RsiPeriod, PRICE_CLOSE);
   handleAtr      = iATR(_Symbol, PERIOD_CURRENT, AtrPeriod);

   if(handleFastEma == INVALID_HANDLE || handleSlowEma == INVALID_HANDLE ||
      handleTrendEma == INVALID_HANDLE || handleRsi == INVALID_HANDLE || handleAtr == INVALID_HANDLE)
   {
      Print("FundedTrendEA: failed to create one or more indicator handles");
      return(INIT_FAILED);
   }

   g_peakEquity     = AccountInfoDouble(ACCOUNT_EQUITY);
   g_dayStartEquity = g_peakEquity;
   g_currentDay     = CurrentDayStart();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   IndicatorRelease(handleFastEma);
   IndicatorRelease(handleSlowEma);
   IndicatorRelease(handleTrendEma);
   IndicatorRelease(handleRsi);
   IndicatorRelease(handleAtr);
}

//+------------------------------------------------------------------+
//| Returns the midnight (server time) timestamp of the current day |
//+------------------------------------------------------------------+
datetime CurrentDayStart()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return(StructToTime(dt));
}

//+------------------------------------------------------------------+
//| Refresh the "new trading day" bookkeeping used for the daily     |
//| loss limit.                                                      |
//+------------------------------------------------------------------+
void UpdateDayRollover()
{
   datetime today = CurrentDayStart();
   if(today != g_currentDay)
   {
      g_currentDay      = today;
      g_dayStartEquity  = AccountInfoDouble(ACCOUNT_EQUITY);
      g_dailyLimitHit   = false;
   }
}

//+------------------------------------------------------------------+
//| Update peak equity and check the permanent max-drawdown kill     |
//| switch.                                                          |
//+------------------------------------------------------------------+
void UpdateDrawdownGuard()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity > g_peakEquity)
      g_peakEquity = equity;

   if(g_peakEquity <= 0.0)
      return;

   double drawdownPct = (g_peakEquity - equity) / g_peakEquity * 100.0;
   if(drawdownPct >= MaxOverallDrawdownPercent && !g_tradingDisabled)
   {
      g_tradingDisabled = true;
      Print(StringFormat("FundedTrendEA: MAX OVERALL DRAWDOWN of %.2f%% reached (limit %.2f%%). " +
            "Trading permanently disabled for this EA instance. Flattening all positions.",
            drawdownPct, MaxOverallDrawdownPercent));
      CloseAllPositions();
   }
}

//+------------------------------------------------------------------+
//| Check the daily loss limit; flattens and blocks new trades for   |
//| the rest of the broker day if breached.                          |
//+------------------------------------------------------------------+
void UpdateDailyLossGuard()
{
   if(g_dayStartEquity <= 0.0 || g_dailyLimitHit)
      return;

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double lossPct = (g_dayStartEquity - equity) / g_dayStartEquity * 100.0;

   if(lossPct >= MaxDailyLossPercent)
   {
      g_dailyLimitHit = true;
      Print(StringFormat("FundedTrendEA: DAILY LOSS LIMIT of %.2f%% reached (limit %.2f%%). " +
            "No new trades until the next trading day. Flattening open positions.",
            lossPct, MaxDailyLossPercent));
      CloseAllPositions();
   }
}

//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
      {
         if(posInfo.Symbol() == _Symbol && posInfo.Magic() == MagicNumber)
            trade.PositionClose(posInfo.Ticket());
      }
   }
}

//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i))
      {
         if(posInfo.Symbol() == _Symbol && posInfo.Magic() == MagicNumber)
            count++;
      }
   }
   return(count);
}

//+------------------------------------------------------------------+
bool IsWithinSession()
{
   if(!UseSessionFilter)
      return(true);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);

   if(SessionStartHour <= SessionEndHour)
      return(dt.hour >= SessionStartHour && dt.hour < SessionEndHour);

   // Session wraps past midnight
   return(dt.hour >= SessionStartHour || dt.hour < SessionEndHour);
}

//+------------------------------------------------------------------+
bool IsWeekendCloseTime()
{
   if(!CloseAllBeforeWeekend)
      return(false);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);

   return(dt.day_of_week == 5 && dt.hour >= WeekendCloseHour); // Friday
}

//+------------------------------------------------------------------+
bool SpreadOk()
{
   symbolInfo.RefreshRates();
   long spreadPoints = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   return(spreadPoints <= (long)MaxSpreadPoints);
}

//+------------------------------------------------------------------+
//| Position size from account equity, risk % and stop distance      |
//+------------------------------------------------------------------+
double CalculateLotSize(double slDistancePrice)
{
   if(slDistancePrice <= 0.0)
      return(0.0);

   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskAmount  = equity * (RiskPercentPerTrade / 100.0);

   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0 || tickValue <= 0.0)
      return(0.0);

   double valuePerPriceUnit = tickValue / tickSize; // account currency per 1.0 lot per unit price move
   double lossPerLot        = slDistancePrice * valuePerPriceUnit;
   if(lossPerLot <= 0.0)
      return(0.0);

   double lots = riskAmount / lossPerLot;

   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lotMin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lotMax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);

   if(lotStep > 0.0)
      lots = MathFloor(lots / lotStep) * lotStep;

   lots = MathMax(lots, MathMax(lotMin, MinLot));
   lots = MathMin(lots, lotMax);

   return(NormalizeDouble(lots, 2));
}

//+------------------------------------------------------------------+
//| Core signal evaluation and entry logic, called once per new bar  |
//+------------------------------------------------------------------+
void CheckForEntry()
{
   if(g_tradingDisabled || g_dailyLimitHit)
      return;

   if(CountOpenPositions() >= MaxOpenPositions)
      return;

   if(!IsWithinSession())
      return;

   if(!SpreadOk())
      return;

   double fastEma[3], slowEma[3], trendEma[2], rsi[2], atr[2];

   if(CopyBuffer(handleFastEma, 0, 0, 3, fastEma) < 3) return;
   if(CopyBuffer(handleSlowEma, 0, 0, 3, slowEma) < 3) return;
   if(CopyBuffer(handleTrendEma, 0, 0, 2, trendEma) < 2) return;
   if(CopyBuffer(handleRsi, 0, 0, 2, rsi) < 2) return;
   if(CopyBuffer(handleAtr, 0, 0, 2, atr) < 2) return;

   // Index 0 = current forming bar, 1 = last closed bar, 2 = bar before that.
   // We trade on the last closed bar's cross to avoid repainting on the live bar.
   bool crossedUp   = fastEma[2] <= slowEma[2] && fastEma[1] > slowEma[1];
   bool crossedDown = fastEma[2] >= slowEma[2] && fastEma[1] < slowEma[1];

   double closePrice1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   bool trendIsUp   = closePrice1 > trendEma[1];
   bool trendIsDown = closePrice1 < trendEma[1];

   double atrValue = atr[1];
   if(atrValue <= 0.0)
      return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   if(crossedUp && trendIsUp && rsi[1] < RsiOverbought)
   {
      double slDist = atrValue * AtrSlMultiplier;
      double tpDist = atrValue * AtrTpMultiplier;
      double sl = ask - slDist;
      double tp = ask + tpDist;
      double lots = CalculateLotSize(slDist);
      if(lots > 0.0)
      {
         if(trade.Buy(lots, _Symbol, ask, sl, tp, TradeComment))
            Print("FundedTrendEA: opened BUY, lots=", lots, " sl=", sl, " tp=", tp);
      }
   }
   else if(crossedDown && trendIsDown && rsi[1] > RsiOversold)
   {
      double slDist = atrValue * AtrSlMultiplier;
      double tpDist = atrValue * AtrTpMultiplier;
      double sl = bid + slDist;
      double tp = bid - tpDist;
      double lots = CalculateLotSize(slDist);
      if(lots > 0.0)
      {
         if(trade.Sell(lots, _Symbol, bid, sl, tp, TradeComment))
            Print("FundedTrendEA: opened SELL, lots=", lots, " sl=", sl, " tp=", tp);
      }
   }
}

//+------------------------------------------------------------------+
//| Move stop loss to lock in profit once trade has moved far enough |
//| in our favour, trailing by a multiple of ATR.                    |
//+------------------------------------------------------------------+
void ManageTrailingStops()
{
   if(!UseTrailingStop)
      return;

   double atr[1];
   if(CopyBuffer(handleAtr, 0, 0, 1, atr) < 1)
      return;
   double atrValue = atr[0];
   if(atrValue <= 0.0)
      return;

   double trailDist = atrValue * TrailingAtrMultiplier;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i))
         continue;
      if(posInfo.Symbol() != _Symbol || posInfo.Magic() != MagicNumber)
         continue;

      double openPrice = posInfo.PriceOpen();
      double curSl      = posInfo.StopLoss();
      double curTp      = posInfo.TakeProfit();
      double initialRisk = MathAbs(openPrice - curSl);
      if(initialRisk <= 0.0)
         continue;

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         double profit = bid - openPrice;
         if(profit >= initialRisk * TrailingStartRR)
         {
            double newSl = bid - trailDist;
            if(newSl > curSl)
               trade.PositionModify(posInfo.Ticket(), newSl, curTp);
         }
      }
      else if(posInfo.PositionType() == POSITION_TYPE_SELL)
      {
         double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         double profit = openPrice - ask;
         if(profit >= initialRisk * TrailingStartRR)
         {
            double newSl = ask + trailDist;
            if(newSl < curSl || curSl == 0.0)
               trade.PositionModify(posInfo.Ticket(), newSl, curTp);
         }
      }
   }
}

//+------------------------------------------------------------------+
datetime g_lastBarTime = 0;

void OnTick()
{
   UpdateDayRollover();
   UpdateDrawdownGuard();
   UpdateDailyLossGuard();

   if(IsWeekendCloseTime())
   {
      CloseAllPositions();
      return;
   }

   if(g_tradingDisabled)
      return;

   ManageTrailingStops();

   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == g_lastBarTime)
      return; // only evaluate entries once per new bar
   g_lastBarTime = barTime;

   CheckForEntry();
}
//+------------------------------------------------------------------+
