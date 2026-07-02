const SUPABASE_URL = "https://ftbdipplulwxzfjqillg.supabase.co";
const SUPABASE_KEY = "sb_publishable_lhJBj_J3HtM4ba1C5msQJg_rdp8eOGr";
const UPDATE_NOTE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/update-day-note`;
const TABLES = ["days", "day_times", "places", "segments"];

const state = {
  days: [],
  dayTimes: [],
  places: [],
  segments: [],
  activeDayId: "overview",
  editPassword: "",
  editEnabled: false,
  saveTimer: null,
  layers: [],
  routeCache: new Map()
};

const map = L.map("map", { zoomControl: true, scrollWheelZoom: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
map.setView([9.82, 123.64], 8);

const els = {
  dayTabs: document.getElementById("day-tabs"),
  mobileTabs: document.getElementById("mobile-tabs"),
  dayTitle: document.getElementById("day-title"),
  dayNote: document.getElementById("day-note"),
  unlockEdit: document.getElementById("unlock-edit"),
  saveStatus: document.getElementById("save-status"),
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

function loadScript(src, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    if (window.supabase) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    const timer = window.setTimeout(() => reject(new Error(`${src} load timeout`)), timeoutMs);
    script.src = src;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`${src} load failed`));
    };
    document.head.appendChild(script);
  });
}

function formatDayLabel(day) {
  const date = new Date(`${day.trip_date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day.id;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadSupabaseData() {
  await loadScript("https://unpkg.com/@supabase/supabase-js@2");
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const requests = await Promise.all(TABLES.map(async (table) => {
    const { data, error } = await client.from(table).select("*").order("sort_order", { ascending: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return [table, data || []];
  }));
  return Object.fromEntries(requests);
}

function normalizeData(raw) {
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
}

function setSaveStatus(text) {
  els.saveStatus.textContent = text || "";
}

function setEditing(enabled) {
  state.editEnabled = enabled;
  els.dayNote.disabled = !enabled || state.activeDayId === "overview";
  els.unlockEdit.textContent = enabled ? "已解锁" : "编辑";
}

async function saveDayNote() {
  if (!state.editEnabled || state.activeDayId === "overview") return;
  const note = els.dayNote.value;
  const day = state.days.find((item) => item.id === state.activeDayId);
  if (day) day.note = note;

  setSaveStatus("保存中...");
  try {
    const response = await fetch(UPDATE_NOTE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dayId: state.activeDayId,
        note,
        password: state.editPassword
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "保存失败");
    setSaveStatus("已保存");
  } catch (error) {
    console.error(error);
    setSaveStatus("保存失败");
  }
}

function scheduleSaveDayNote() {
  window.clearTimeout(state.saveTimer);
  setSaveStatus("待保存...");
  state.saveTimer = window.setTimeout(saveDayNote, 700);
}

async function loadData() {
  try {
    normalizeData(await loadSupabaseData());
    render();
  } catch (error) {
    console.error(error);
    els.dayTitle.textContent = "数据读取失败";
    els.dayNote.textContent = "请检查 Supabase 权限或浏览器控制台。";
  }
}

function getDayData(dayId) {
  if (dayId === "overview") {
    return {
      day: { id: "overview", title: "总览", note: "" },
      times: [],
      places: sortByOrder(state.places.filter((place) => place.lat !== null && place.lon !== null)),
      segments: sortByOrder(state.segments)
    };
  }

  return {
    day: state.days.find((day) => day.id === dayId),
    times: sortByOrder(state.dayTimes.filter((item) => item.day_id === dayId)),
    places: sortByOrder(state.places.filter((place) => place.day_id === dayId && place.lat !== null && place.lon !== null)),
    segments: sortByOrder(state.segments.filter((segment) => segment.day_id === dayId))
  };
}

function segmentType(mode) {
  if (mode === "flight") return "flight";
  if (mode === "pier" || mode === "ferry") return "ferry";
  return "road";
}

function modeIcon(mode) {
  const icons = {
    car: "🚗",
    charter: "🚗",
    trike: "🛺",
    motorbike: "🏍",
    pier: "⛴",
    ferry: "⛴",
    flight: "✈"
  };
  return icons[mode] || "➜";
}

function formatMinutes(minutes) {
  if (!minutes && minutes !== 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

function placeBadge(place, index) {
  const label = place.kind ? place.kind.slice(0, 2).toUpperCase() : String(index + 1);
  return `<span class="badge ${escapeHtml(place.kind)}">${escapeHtml(label)}</span>`;
}

function segmentBadge(segment) {
  const type = segmentType(segment.mode);
  return `<span class="badge ${type}">${modeIcon(segment.mode)}</span>`;
}

function renderTabs() {
  const tabs = [
    { id: "overview", label: "总览", title: "总览" },
    ...state.days.map((day) => ({ id: day.id, label: formatDayLabel(day), title: day.title }))
  ];
  const markup = tabs.map((tab) => {
    const active = tab.id === state.activeDayId ? " active" : "";
    return `
      <button class="day-tab${active}" type="button" data-day-id="${escapeHtml(tab.id)}" title="${escapeHtml(tab.title)}">
        <strong>${escapeHtml(tab.label)}</strong>
        <span>${escapeHtml(tab.title)}</span>
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
    : '<li class="empty">暂无时间安排</li>';

  els.placeList.innerHTML = data.places.length
    ? data.places.map((place, index) => `
      <li>
        ${placeBadge(place, index)}
        <span>
          <strong>${escapeHtml(place.name)}</strong>
          <span class="item-meta">${escapeHtml(place.note)}</span>
        </span>
      </li>
    `).join("")
    : '<li class="empty">暂无地点</li>';

  els.segmentList.innerHTML = data.segments.length
    ? data.segments.map((segment) => `
      <li>
        ${segmentBadge(segment)}
        <span>
          <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong>
          <span class="item-meta">${escapeHtml(segment.note)}${segment.minutes ? ` · ${formatMinutes(segment.minutes)}` : ""}</span>
        </span>
      </li>
    `).join("")
    : '<li class="empty">暂无路线</li>';
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
    opacity: 0.88,
    dashArray: type === "road" ? null : "9 8"
  };
}

function routeMidpoint(coords) {
  if (!coords.length) return [0, 0];
  if (coords.length === 1) return coords[0];

  let total = 0;
  const segments = [];
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = b[1] - a[1];
    const dy = b[0] - a[0];
    const length = Math.sqrt(dx * dx + dy * dy);
    segments.push({ a, b, length });
    total += length;
  }

  if (!total) return coords[0];

  const half = total / 2;
  let walked = 0;
  for (const segment of segments) {
    if (walked + segment.length >= half) {
      const ratio = (half - walked) / segment.length;
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * ratio,
        segment.a[1] + (segment.b[1] - segment.a[1]) * ratio
      ];
    }
    walked += segment.length;
  }

  return coords[coords.length - 1];
}

async function fetchRoadRoute(from, to) {
  const key = `${from.name}->${to.name}`;
  if (state.routeCache.has(key)) return state.routeCache.get(key);

  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("OSRM route failed");
  const data = await response.json();
  const route = data.routes && data.routes[0];
  if (!route) throw new Error("OSRM route missing");
  const coords = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  state.routeCache.set(key, coords);
  return coords;
}

async function getRouteCoords(segment, from, to) {
  const type = segmentType(segment.mode);
  if (type === "road") {
    try {
      return await fetchRoadRoute(from, to);
    } catch (error) {
      console.warn(error);
    }
  }
  return [[from.lat, from.lon], [to.lat, to.lon]];
}

function addRouteLabel(segment, coords) {
  const type = segmentType(segment.mode);
  const label = L.divIcon({
    className: "",
    html: `
      <div class="route-label ${type}">
        <span class="route-label-icon">${modeIcon(segment.mode)}</span>
        <span class="route-label-time">${formatMinutes(segment.minutes)}</span>
      </div>
    `,
    iconSize: [58, 44],
    iconAnchor: [29, 22]
  });
  const marker = L.marker(routeMidpoint(coords), { icon: label, interactive: false }).addTo(map);
  state.layers.push(marker);
}

function addPlaceNameLabel(place) {
  const label = L.divIcon({
    className: "",
    html: `<div class="place-name-label">${escapeHtml(place.name)}</div>`,
    iconSize: [160, 24],
    iconAnchor: [80, 34]
  });
  const marker = L.marker([place.lat, place.lon], { icon: label, interactive: false }).addTo(map);
  state.layers.push(marker);
}

function addMarkers(data, bounds, labeledPlaces = new Set()) {
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
    if (labeledPlaces.has(place.name)) addPlaceNameLabel(place);
    bounds.push([place.lat, place.lon]);
  });
}

async function addRoutes(data, bounds) {
  const labeledPlaces = new Set();
  for (const segment of data.segments) {
    const from = findPlaceByName(segment.from_place);
    const to = findPlaceByName(segment.to_place);
    if (!from || !to) continue;

    const coords = await getRouteCoords(segment, from, to);
    const line = L.polyline(coords, routeStyle(segment)).bindPopup(`
      <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong><br>
      ${escapeHtml(segment.mode)}${segment.minutes ? ` · ${formatMinutes(segment.minutes)}` : ""}
    `).addTo(map);
    state.layers.push(line);
    addRouteLabel(segment, coords);
    if (state.activeDayId !== "overview") {
      labeledPlaces.add(from.name);
      labeledPlaces.add(to.name);
    }
    coords.forEach((coord) => bounds.push(coord));
  }
  return labeledPlaces;
}

async function renderMap(data) {
  clearMap();
  const bounds = [];
  const labeledPlaces = await addRoutes(data, bounds);
  if (state.activeDayId !== "overview") {
    addMarkers(data, bounds, labeledPlaces);
  }

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
  els.dayNote.value = data.day.note || "";
  setEditing(state.editEnabled);
  setSaveStatus("");
  renderLists(data);
  renderMap(data);
}

els.unlockEdit.addEventListener("click", () => {
  if (!state.editEnabled) {
    const password = window.prompt("输入编辑密码");
    if (!password) return;
    state.editPassword = password;
    setEditing(true);
    setSaveStatus("已解锁");
    els.dayNote.focus();
    return;
  }
  setEditing(false);
  state.editPassword = "";
  setSaveStatus("");
});

els.dayNote.addEventListener("input", scheduleSaveDayNote);
els.toggleSidebar.addEventListener("click", () => els.sidebar.classList.toggle("open"));
loadData();
