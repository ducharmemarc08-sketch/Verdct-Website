const { requireAdmin, getAdminClient } = require("./_auth");

const PAGE_SIZE = 1000;

// Fetches every row of `columns` from `table`, paging past Supabase's
// default 1000-row cap so aggregate counts stay accurate as data grows.
async function fetchAllRows(admin, table, columns) {
  let rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const admin = getAdminClient();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalUsers },
      { count: activeLast7Days },
      { count: totalHoldings },
      holdingsRows,
      recentProfiles,
    ] = await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin.from("profiles").select("*", { count: "exact", head: true }).gte("last_active", sevenDaysAgo),
      admin.from("holdings").select("*", { count: "exact", head: true }),
      fetchAllRows(admin, "holdings", "ticker,type"),
      fetchAllRows(admin, "profiles", "created_at").then((rows) =>
        rows.filter((r) => r.created_at && r.created_at >= thirtyDaysAgo)
      ),
    ]);

    const tickerCounts = {};
    const typeCounts = { stock: 0, crypto: 0, etf: 0 };
    for (const row of holdingsRows) {
      if (row.ticker) tickerCounts[row.ticker] = (tickerCounts[row.ticker] || 0) + 1;
      if (row.type && typeCounts[row.type] !== undefined) typeCounts[row.type]++;
    }
    const topTickers = Object.entries(tickerCounts)
      .map(([ticker, count]) => ({ ticker, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const signupsByDay = {};
    for (const row of recentProfiles) {
      const day = row.created_at.slice(0, 10);
      signupsByDay[day] = (signupsByDay[day] || 0) + 1;
    }
    const signupSeries = Object.entries(signupsByDay)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    res.status(200).json({
      totalUsers: totalUsers || 0,
      activeLast7Days: activeLast7Days || 0,
      totalHoldings: totalHoldings || 0,
      typeBreakdown: typeCounts,
      topTickers,
      signupsByDay: signupSeries,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
};
