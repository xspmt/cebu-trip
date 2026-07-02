const SUPABASE_URL = "https://ftbdipplulwxzfjqillg.supabase.co";
const SUPABASE_KEY = "sb_publishable_lhJBj_J3HtM4ba1C5msQJg_rdp8eOGr";

const TABLES = ["days", "day_times", "places", "segments"];
const csvPaths = {
  days: "csv/days_rows.csv",
  day_times: "csv/day_times_rows.csv",
  places: "csv/places_rows.csv",
  segments: "csv/segments_rows.csv"
};

const state = {
  source: "loading",
  days: [],
  dayTimes: [],
  places: [],
  segments: [],
  activeDayId: null,
  layers: []
};

const map = L.map("map", { zoomControl: true, scrollWheelZoom: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
map.setView([9.82, 123.64], 8);

const els = {
  status: document.getElementById("data-status"),
  refresh: document.getElementById("refresh-data"),
  dayTabs: document.getElementById("day-tabs"),
  mobileTabs: document.getElementById("mobile-tabs"),
  dayTitle: document.getElementById("day-title"),
  dayNote: document.getElementById("day-note"),
  statPlaces: document.getElementById("stat-places"),
  statSegments: document.getElementById("stat-segments"),
  statTimes: document.getElementById("stat-times"),
  timeline: document.getElementById("timeline"),
  placeList: document.getElementById("place-list"),
  segmentList: document.getElementById("segment-list"),
  sidebar: document.getElementById("sidebar"),
  toggleSidebar: document.getElementById("toggle-sidebar")
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortByOrder(rows) {
  return [...rows].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function loadScript(src, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    const timer = window.setTimeout(() => reject(new Error(`${src} 加载超时`)), timeoutMs);
    script.src = src;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`${src} 加载失败`));
    };
    document.head.appendChild(script);
  });
}

function formatDayLabel(day) {
  const date = new Date(`${day.trip_date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day.id;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
}

async function loadSupabaseData() {
  if (!window.supabase) {
    await loadScript("https://unpkg.com/@supabase/supabase-js@2");
  }
  if (!window.supabase) throw new Error("Supabase SDK 未加载");
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("Supabase 读取超时")), 4500);
  });
  const query = Promise.all(TABLES.map(async (table) => {
    const { data, error } = await client.from(table).select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return [table, data || []];
  }));
  const requests = await Promise.race([query, timeout]);
  return Object.fromEntries(requests);
}

async function loadCsvData() {
  const requests = await Promise.all(Object.entries(csvPaths).map(async ([table, path]) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} 读取失败`);
    return [table, parseCsv(await response.text())];
  }));
  return Object.fromEntries(requests);
}

function normalizeData(raw, source) {
  state.source = source;
  state.days = sortByOrder(raw.days || []);
  state.dayTimes = sortByOrder(raw.day_times || []);
  state.places = sortByOrder(raw.places || []).map((place) => ({
    ...place,
    lat: toNumber(place.lat),
    lon: toNumber(place.lon)
  }));
  state.segments = sortByOrder(raw.segments || []).map((segment) => ({
    ...segment,
    minutes: toNumber(segment.minutes)
  }));
  state.activeDayId = state.activeDayId || state.days[0]?.id || null;
}

async function loadData() {
  els.status.textContent = "正在读取 Supabase...";
  try {
    const raw = await loadSupabaseData();
    normalizeData(raw, "supabase");
    els.status.textContent = "已连接 Supabase 实时数据。";
  } catch (error) {
    console.warn(error);
    els.status.textContent = "Supabase 暂不可用，正在读取本地 CSV...";
    const raw = await loadCsvData();
    normalizeData(raw, "csv");
    els.status.textContent = "当前使用本地 CSV 数据。若要上线读取 Supabase，请先开启 Data API。";
  }
  render();
}

function getDayData(dayId) {
  return {
    day: state.days.find((day) => day.id === dayId),
    times: sortByOrder(state.dayTimes.filter((item) => item.day_id === dayId)),
    places: sortByOrder(state.places.filter((place) => place.day_id === dayId && place.lat !== null && place.lon !== null)),
    segments: sortByOrder(state.segments.filter((segment) => segment.day_id === dayId))
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeBadge(place, index) {
  const label = place.kind ? place.kind.slice(0, 2).toUpperCase() : String(index + 1);
  return `<span class="badge ${escapeHtml(place.kind)}">${escapeHtml(label)}</span>`;
}

function segmentType(mode) {
  if (mode === "flight") return "flight";
  if (mode === "pier" || mode === "ferry") return "ferry";
  return "road";
}

function segmentBadge(segment) {
  const modeLabels = {
    car: "车",
    charter: "包",
    trike: "突",
    motorbike: "摩",
    pier: "船",
    ferry: "船",
    flight: "飞"
  };
  const type = segmentType(segment.mode);
  return `<span class="badge ${type}">${modeLabels[segment.mode] || escapeHtml(segment.mode || "路")}</span>`;
}

function renderTabs() {
  const markup = state.days.map((day) => {
    const active = day.id === state.activeDayId ? " active" : "";
    return `
      <button class="day-tab${active}" type="button" data-day-id="${escapeHtml(day.id)}">
        <strong>${escapeHtml(formatDayLabel(day))}</strong>
        <span>${escapeHtml(day.title)}</span>
      </button>
    `;
  }).join("");

  els.dayTabs.innerHTML = markup;
  els.mobileTabs.innerHTML = markup;

  document.querySelectorAll(".day-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeDayId = button.dataset.dayId;
      els.sidebar.classList.remove("open");
      render();
    });
  });
}

function renderLists(data) {
  els.timeline.innerHTML = data.times.length
    ? data.times.map((item) => `
      <li>
        <span class="badge">${escapeHtml(item.time_text)}</span>
        <span>${escapeHtml(item.detail)}</span>
      </li>
    `).join("")
    : '<li class="empty">这一天还没有时间安排。</li>';

  els.placeList.innerHTML = data.places.length
    ? data.places.map((place, index) => `
      <li>
        ${placeBadge(place, index)}
        <span>
          <strong>${escapeHtml(place.name)}</strong>
          <span class="item-meta">${escapeHtml(place.note)} · ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}</span>
        </span>
      </li>
    `).join("")
    : '<li class="empty">这一天还没有地点。</li>';

  els.segmentList.innerHTML = data.segments.length
    ? data.segments.map((segment) => `
      <li>
        ${segmentBadge(segment)}
        <span>
          <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong>
          <span class="item-meta">${escapeHtml(segment.note)}${segment.minutes ? ` · ${segment.minutes} 分钟` : ""}</span>
        </span>
      </li>
    `).join("")
    : '<li class="empty">这一天没有路线段。</li>';
}

function clearMap() {
  state.layers.forEach((layer) => layer.remove());
  state.layers = [];
}

function findPlaceByName(name) {
  return state.places.find((place) => place.name === name && place.lat !== null && place.lon !== null);
}

function routeStyle(segment) {
  const type = segmentType(segment.mode);
  const color = type === "flight" ? "#6F58B7" : type === "ferry" ? "#2F7FC1" : "#008E6B";
  return {
    color,
    weight: type === "road" ? 5 : 4,
    opacity: 0.86,
    dashArray: type === "road" ? null : "9 8"
  };
}

function addMarkers(data, bounds) {
  data.places.forEach((place, index) => {
    const marker = L.circleMarker([place.lat, place.lon], {
      radius: 8,
      color: "#FBFFF2",
      weight: 3,
      fillColor: index === 0 ? "#008E6B" : "#46B065",
      fillOpacity: 0.96
    }).bindPopup(`
      <div class="popup-title">${escapeHtml(place.name)}</div>
      <div class="popup-meta">${escapeHtml(place.kind || "地点")}</div>
      <div class="popup-note">${escapeHtml(place.note)}</div>
    `).addTo(map);
    state.layers.push(marker);
    bounds.push([place.lat, place.lon]);
  });
}

function addRoutes(data, bounds) {
  data.segments.forEach((segment) => {
    const from = findPlaceByName(segment.from_place);
    const to = findPlaceByName(segment.to_place);
    if (!from || !to) return;

    const coords = [[from.lat, from.lon], [to.lat, to.lon]];
    const line = L.polyline(coords, routeStyle(segment)).bindPopup(`
      <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong><br>
      ${escapeHtml(segment.mode)}${segment.minutes ? ` · ${segment.minutes} 分钟` : ""}
    `).addTo(map);
    state.layers.push(line);
    coords.forEach((coord) => bounds.push(coord));
  });
}

function renderMap(data) {
  clearMap();
  const bounds = [];
  addRoutes(data, bounds);
  addMarkers(data, bounds);

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 13 });
  } else if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  }
}

function render() {
  if (!state.days.length) return;
  const data = getDayData(state.activeDayId);
  if (!data.day) return;

  renderTabs();
  els.dayTitle.textContent = data.day.title;
  els.dayNote.textContent = data.day.note || "";
  els.statPlaces.textContent = data.places.length;
  els.statSegments.textContent = data.segments.length;
  els.statTimes.textContent = data.times.length;
  renderLists(data);
  renderMap(data);
}

els.refresh.addEventListener("click", loadData);
els.toggleSidebar.addEventListener("click", () => els.sidebar.classList.toggle("open"));
loadData();
