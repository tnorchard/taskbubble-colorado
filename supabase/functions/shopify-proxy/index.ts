// Supabase Edge Function: Shopify API proxy (multi-store)
// Auth is handled inside the function via supabase.auth.getUser()
// Store credentials are read from shopify_stores table via service role

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Get the start-of-day in a given IANA timezone as a UTC ISO string */
function startOfDayInTZ(tzName: string, daysAgo = 0): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tzName }));
  local.setHours(0, 0, 0, 0);
  local.setDate(local.getDate() - daysAgo);
  const utcNow = now.getTime();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tzName })).getTime();
  const offset = utcNow - localNow;
  return new Date(local.getTime() + offset).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client for auth verification
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for reading store secrets
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // ── Parse request body ──
    const body = await req.json().catch(() => ({}));
    const period: string = body.period || "today";
    const storeId: string | undefined = body.store_id;

    // ── Look up store credentials ──
    let shop: string;
    let token: string;

    if (storeId) {
      // Fetch specific store from DB
      const { data: storeRow, error: storeErr } = await supabaseAdmin
        .from("shopify_stores")
        .select("shop_domain,access_token")
        .eq("id", storeId)
        .maybeSingle();
      if (storeErr || !storeRow) {
        return new Response(
          JSON.stringify({ error: "Store not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      shop = storeRow.shop_domain;
      token = storeRow.access_token;
    } else {
      // Fallback: first store in table, or legacy env vars
      const { data: storeRows } = await supabaseAdmin
        .from("shopify_stores")
        .select("shop_domain,access_token")
        .order("created_at", { ascending: true })
        .limit(1);
      if (storeRows && storeRows.length > 0) {
        shop = storeRows[0].shop_domain;
        token = storeRows[0].access_token;
      } else {
        // Legacy env var fallback
        shop = Deno.env.get("SHOPIFY_SHOP_DOMAIN") ?? "";
        token = Deno.env.get("SHOPIFY_ACCESS_TOKEN") ?? "";
      }
    }

    if (!shop || !token) {
      return new Response(
        JSON.stringify({ error: "Shopify credentials not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiVersion = "2024-10";
    const baseUrl = `https://${shop}/admin/api/${apiVersion}`;
    const shopHeaders = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

    // ── Fetch shop timezone ──
    let shopTZ = "America/Denver";
    try {
      const shopRes = await fetch(`${baseUrl}/shop.json`, { headers: shopHeaders });
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        if (shopData.shop?.iana_timezone) shopTZ = shopData.shop.iana_timezone;
      }
    } catch { /* fallback */ }

    // ── Calculate date range ──
    let sinceISO: string;
    const now = new Date();
    switch (period) {
      case "30m":
        sinceISO = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        break;
      case "1h":
        sinceISO = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        break;
      case "6h":
        sinceISO = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        break;
      case "12h":
        sinceISO = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
        break;
      case "48h":
        sinceISO = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
        break;
      case "yesterday":
        sinceISO = startOfDayInTZ(shopTZ, 1);
        break;
      default: // today
        sinceISO = startOfDayInTZ(shopTZ, 0);
    }

    let untilISO: string | null = null;
    if (period === "yesterday") {
      untilISO = startOfDayInTZ(shopTZ, 0);
    }

    // ── Fetch ALL orders with pagination ──
    let allOrders: any[] = [];
    let pageUrl: string | null =
      `${baseUrl}/orders.json?status=any&created_at_min=${sinceISO}${untilISO ? `&created_at_max=${untilISO}` : ""}&limit=250`;

    while (pageUrl) {
      const ordersRes = await fetch(pageUrl, { headers: shopHeaders });
      if (!ordersRes.ok) {
        const errText = await ordersRes.text();
        return new Response(
          JSON.stringify({ error: `Shopify API error (${ordersRes.status}): ${errText}` }),
          { status: ordersRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const ordersData = await ordersRes.json();
      allOrders = allOrders.concat(ordersData.orders || []);
      const linkHeader = ordersRes.headers.get("link");
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        pageUrl = nextMatch ? nextMatch[1] : null;
      } else {
        pageUrl = null;
      }
      if (allOrders.length > 1000) break;
    }

    const orders = allOrders;

    // ── Calculate metrics ──
    let totalSales = 0;
    const totalOrders = orders.length;
    let totalRefunds = 0;
    let cancelledOrders = 0;
    let itemsSold = 0;
    let fulfilledOrders = 0;
    let unfulfilled = 0;
    const dailySales: Record<string, number> = {};
    const dailyOrders: Record<string, number> = {};

    for (const order of orders) {
      const price = parseFloat(order.total_price || "0");
      const day = order.created_at?.slice(0, 10);

      if (order.cancelled_at) {
        cancelledOrders++;
        continue;
      }

      totalSales += price;

      if (order.fulfillment_status === "fulfilled") {
        fulfilledOrders++;
      } else {
        unfulfilled++;
      }

      if (order.refunds?.length > 0) {
        for (const refund of order.refunds) {
          for (const txn of refund.transactions || []) {
            totalRefunds += parseFloat(txn.amount || "0");
          }
        }
      }

      if (order.line_items) {
        for (const item of order.line_items) {
          itemsSold += item.quantity || 1;
        }
      }

      if (day) {
        dailySales[day] = (dailySales[day] || 0) + price;
        dailyOrders[day] = (dailyOrders[day] || 0) + 1;
      }
    }

    const activeOrders = totalOrders - cancelledOrders;
    const netSales = totalSales - totalRefunds;
    const avgOrderValue = activeOrders > 0 ? netSales / activeOrders : 0;
    const avgItemsPerOrder = activeOrders > 0 ? Math.round((itemsSold / activeOrders) * 10) / 10 : 0;

    // ── Build sparkline ──
    const sparkline: Array<{ date: string; sales: number; orders: number }> = [];
    const sinceDate = new Date(sinceISO);
    const endDate = untilISO ? new Date(untilISO) : now;
    const dayMs = 86400000;
    for (let d = new Date(sinceDate); d <= endDate; d = new Date(d.getTime() + dayMs)) {
      const ds = d.toISOString().slice(0, 10);
      sparkline.push({
        date: ds,
        sales: dailySales[ds] || 0,
        orders: dailyOrders[ds] || 0,
      });
    }

    const result = {
      period,
      totalOrders: activeOrders,
      cancelledOrders,
      totalSales: Math.round(totalSales * 100) / 100,
      totalRefunds: Math.round(totalRefunds * 100) / 100,
      netSales: Math.round(netSales * 100) / 100,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      itemsSold,
      avgItemsPerOrder,
      fulfilledOrders,
      unfulfilled,
      sparkline,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
