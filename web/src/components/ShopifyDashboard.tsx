import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";

type ShopifyData = {
  period: string;
  totalOrders: number;
  cancelledOrders: number;
  totalSales: number;
  totalRefunds: number;
  netSales: number;
  avgOrderValue: number;
  itemsSold: number;
  avgItemsPerOrder: number;
  fulfilledOrders: number;
  unfulfilled: number;
  sparkline: Array<{ date: string; sales: number; orders: number }>;
};

type ShopifyStore = {
  id: string;
  shop_handle: string;
  display_name: string;
};

type Period = "30m" | "1h" | "6h" | "12h" | "today" | "yesterday" | "48h";

/* ── Helpers ── */

function fmtMoney(n: number) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: number) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  if (n >= 1) return "$" + n.toFixed(0);
  return "$0";
}

/** Format a date string into a short label depending on granularity */
function fmtXLabel(dateStr: string, _period: Period): string {
  // dateStr is "YYYY-MM-DD"
  const d = new Date(dateStr + "T12:00:00"); // noon to avoid TZ shifts
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = d.getDate();
  return `${month} ${day}`;
}

/** Generate ~4 evenly spaced y-axis tick values */
function yTicks(max: number, isMoney: boolean): Array<{ value: number; label: string }> {
  if (max === 0) return [{ value: 0, label: isMoney ? "$0" : "0" }];
  const steps = 4;
  const raw = max / steps;
  // Round to a nice number
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = Math.ceil(raw / mag) * mag;
  const ticks: Array<{ value: number; label: string }> = [];
  for (let i = 0; i <= steps; i++) {
    const v = nice * i;
    ticks.push({
      value: v,
      label: isMoney ? fmtCompact(v) : String(v),
    });
  }
  return ticks;
}

/* ── Chart Component ── */

function BarChart({
  data,
  dataKey,
  period,
}: {
  data: Array<{ date: string; sales: number; orders: number }>;
  dataKey: "sales" | "orders";
  period: Period;
}) {
  const isMoney = dataKey === "sales";
  const values = data.map((d) => d[dataKey]);
  const maxVal = Math.max(...values, 1);
  const ticks = yTicks(maxVal, isMoney);
  const chartMax = ticks[ticks.length - 1]?.value || maxVal;

  // Pick which x labels to show (avoid overcrowding)
  const labelEvery = data.length <= 7 ? 1 : data.length <= 14 ? 2 : Math.ceil(data.length / 6);

  return (
    <div className="shopifyChart">
      {/* Y-axis */}
      <div className="shopifyChartYAxis">
        {[...ticks].reverse().map((t) => (
          <div key={t.value} className="shopifyChartYTick">{t.label}</div>
        ))}
      </div>

      {/* Chart body */}
      <div className="shopifyChartMain">
        {/* Horizontal grid lines */}
        <div className="shopifyChartGrid">
          {ticks.map((t) => (
            <div
              key={t.value}
              className="shopifyChartGridLine"
              style={{ bottom: `${(t.value / chartMax) * 100}%` }}
            />
          ))}
        </div>

        {/* Bars */}
        <div className="shopifyChartBars">
          {data.map((d, i) => (
            <div key={d.date} className="shopifyChartBarCol">
              <div
                className="shopifyChartBar"
                title={`${fmtXLabel(d.date, period)}: ${isMoney ? fmtMoney(d.sales) : d.orders + " orders"}`}
                style={{ height: `${Math.max(2, (values[i] / chartMax) * 100)}%` }}
              />
            </div>
          ))}
        </div>

        {/* X-axis labels */}
        <div className="shopifyChartXAxis">
          {data.map((d, i) => (
            <div key={d.date} className="shopifyChartXTick">
              {i % labelEvery === 0 ? fmtXLabel(d.date, period) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Spinner ── */

function ShopifySpinner() {
  return (
    <div className="shopifySpinner">
      <svg viewBox="0 0 24 24" width="22" height="22" className="shopifySpinnerSvg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" fill="none" strokeDasharray="50 20" />
      </svg>
    </div>
  );
}

/* ── Main Dashboard ── */

export function ShopifyDashboard({ allowedStoreIds }: { allowedStoreIds: string[] }) {
  const supabase = getSupabase();
  const [stores, setStores] = useState<ShopifyStore[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [data, setData] = useState<ShopifyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("today");
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("tb:shopify-collapsed") === "true"; } catch { return false; }
  });

  useEffect(() => {
    if (allowedStoreIds.length === 0) return;
    (async () => {
      const { data: rows } = await supabase
        .from("shopify_stores_public")
        .select("id,shop_handle,display_name")
        .in("id", allowedStoreIds)
        .order("created_at", { ascending: true });
      const list = (rows ?? []) as ShopifyStore[];
      setStores(list);
      if (list.length > 0) {
        const saved = localStorage.getItem("tb:shopify-store");
        const match = list.find((s) => s.id === saved);
        setSelectedStore(match ? match.id : list[0].id);
      }
    })();
  }, [supabase, allowedStoreIds]);

  const load = useCallback(async (p: Period, storeId: string | null) => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) { setError("Not authenticated"); setLoading(false); return; }

      const res = await supabase.functions.invoke("shopify-proxy", {
        body: { period: p, store_id: storeId },
      });

      if (res.error) {
        setError(res.error.message || "Failed to fetch Shopify data");
        setLoading(false);
        return;
      }

      const result = res.data as ShopifyData;
      if ((result as any).error) {
        setError((result as any).error);
        setLoading(false);
        return;
      }

      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(period, selectedStore); }, [period, selectedStore, load]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("tb:shopify-collapsed", String(next)); } catch { /* */ }
      return next;
    });
  }

  function handleStoreChange(id: string) {
    setSelectedStore(id);
    setData(null);
    try { localStorage.setItem("tb:shopify-store", id); } catch { /* */ }
  }

  const periods: Array<{ key: Period; label: string }> = [
    { key: "30m", label: "30 Min" },
    { key: "1h", label: "1 Hour" },
    { key: "6h", label: "6 Hours" },
    { key: "12h", label: "12 Hours" },
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "48h", label: "48 Hours" },
  ];

  const fulfillPct = data && data.totalOrders > 0
    ? Math.round((data.fulfilledOrders / data.totalOrders) * 100) : 0;

  const currentStoreName = stores.find((s) => s.id === selectedStore)?.display_name ?? "Store";

  if (allowedStoreIds.length === 0) return null;

  return (
    <div className="shopifyDash">
      <div className="shopifyDashHeader">
        <div className="shopifyDashHeaderLeft">
          <button type="button" className="shopifyCollapseBtn" onClick={toggleCollapsed}>
            {collapsed ? "▶" : "▼"}
          </button>
          {loading ? <ShopifySpinner /> : <div className="shopifyDashIcon">🛍</div>}
          <div>
            <div className="shopifyDashTitle">Shopify Overview</div>
            {!collapsed ? (
              <div className="shopifyDashSub">
                {loading ? `Loading ${currentStoreName}…` : `${currentStoreName} · Last updated just now`}
              </div>
            ) : null}
          </div>
        </div>
        {!collapsed ? (
          <div className="shopifyHeaderControls">
            {stores.length > 1 ? (
              <div className="shopifyStorePicker">
                {stores.map((s) => (
                  <button key={s.id} type="button"
                    className={`shopifyStorePill ${selectedStore === s.id ? "active" : ""}`}
                    onClick={() => handleStoreChange(s.id)}
                    disabled={loading}>
                    {s.display_name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="shopifyPeriodPills">
              {periods.map((p) => (
                <button key={p.key} type="button"
                  className={`shopifyPeriodPill ${period === p.key ? "active" : ""}`}
                  onClick={() => setPeriod(p.key)}
                  disabled={loading}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {collapsed ? null : (
        <>
          {error ? (
            <div className="shopifyError">
              <div className="shopifyErrorIcon">⚠</div>
              <div>
                <div className="shopifyErrorTitle">Shopify not connected</div>
                <div className="shopifyErrorBody">{error}</div>
              </div>
            </div>
          ) : loading && !data ? (
            <div className="shopifyLoading">
              <ShopifySpinner />
              <span>Loading Shopify data…</span>
            </div>
          ) : data ? (
            <div className={loading ? "shopifyBody shopifyBodyLoading" : "shopifyBody"}>
              {loading ? (
                <div className="shopifyRefreshOverlay">
                  <ShopifySpinner />
                </div>
              ) : null}

              {/* Row 1: Key metrics */}
              <div className="shopifyStatGrid">
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Net Sales</div>
                  <div className="shopifyStatValue">{fmtMoney(data.netSales)}</div>
                  {data.totalRefunds > 0 ? <div className="shopifyStatSub">Refunds: {fmtMoney(data.totalRefunds)}</div> : null}
                </div>
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Orders</div>
                  <div className="shopifyStatValue">{data.totalOrders}</div>
                  {data.cancelledOrders > 0 ? <div className="shopifyStatSub">{data.cancelledOrders} cancelled</div> : null}
                </div>
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Avg Order Value</div>
                  <div className="shopifyStatValue">{fmtMoney(data.avgOrderValue)}</div>
                </div>
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Items Sold</div>
                  <div className="shopifyStatValue">{data.itemsSold}</div>
                  <div className="shopifyStatSub">~{data.avgItemsPerOrder} per order</div>
                </div>
              </div>

              {/* Row 2: Fulfillment + Gross */}
              <div className="shopifyStatGrid shopifyStatGridSmall">
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Gross Sales</div>
                  <div className="shopifyStatValue shopifyStatValueSm">{fmtMoney(data.totalSales)}</div>
                </div>
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Fulfillment</div>
                  <div className="shopifyStatValue shopifyStatValueSm">{fulfillPct}%</div>
                  <div className="shopifyStatSub">{data.fulfilledOrders} fulfilled · {data.unfulfilled} pending</div>
                </div>
                <div className="shopifyStat">
                  <div className="shopifyStatLabel">Refunds</div>
                  <div className="shopifyStatValue shopifyStatValueSm">{fmtMoney(data.totalRefunds)}</div>
                </div>
              </div>

              {/* Charts with axes */}
              {data.sparkline.length > 1 ? (
                <div className="shopifyCharts">
                  <div className="shopifyChartBox">
                    <div className="shopifyChartLabel">Sales Trend</div>
                    <BarChart data={data.sparkline} dataKey="sales" period={period} />
                  </div>
                  <div className="shopifyChartBox">
                    <div className="shopifyChartLabel">Orders Trend</div>
                    <BarChart data={data.sparkline} dataKey="orders" period={period} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
