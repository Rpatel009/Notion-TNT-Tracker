import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DB_ID;

const AFTERSHIP_KEY = process.env.AFTERSHIP_KEY;
const BASE = "https://api.aftership.com/v4";

// Fetch shipment status from AfterShip
async function getStatus(carrier, number) {
  const res = await fetch(`${BASE}/trackings/${carrier}/${number}`, {
    headers: {
      "aftership-api-key": AFTERSHIP_KEY,
      "content-type": "application/json"
    }
  });
  if (!res.ok) throw new Error(`AfterShip error ${res.status}`);
  const { data } = await res.json();
  const t = data.tracking;
  return {
    status: t.tag || "In Transit",
    eta: t.expected_delivery || null,
    url: t.tracking_url
  };
}

function plain(prop) {
  if (!prop) return "";
  if (prop.type === "title") return prop.title.map(t => t.plain_text).join("");
  if (prop.type === "rich_text") return prop.rich_text.map(t => t.plain_text).join("");
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "select") return prop.select?.name || "";
  return "";
}

async function fetchRows() {
  const rows = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    });
    rows.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function run() {
  const rows = await fetchRows();

  for (const page of rows) {
    const props = page.properties;
    const number = plain(props["Tracking Number"]);
    const carrier = plain(props["Carrier"]) || "tnt";

    if (!number) continue;

    // Ensure tracking exists in AfterShip
    await fetch(`${BASE}/trackings`, {
      method: "POST",
      headers: {
        "aftership-api-key": AFTERSHIP_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({ tracking: { slug: carrier, tracking_number: number } })
    }).catch(() => {});

    const { status, eta, url } = await getStatus(carrier, number);

    const update = {
      page_id: page.id,
      properties: {
        "Shipment Status": { status: { name: status } },
        "Last Checked": { date: { start: new Date().toISOString() } }
      }
    };

    if (eta) update.properties["ETA"] = { date: { start: eta } };
    if (url) update.properties["Tracking URL"] = { url };

    await notion.pages.update(update);
    console.log(`Updated ${number}: ${status}`);
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
