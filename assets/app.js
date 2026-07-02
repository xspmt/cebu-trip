const SUPABASE_URL = "https://ftbdipplulwxzfjqillg.supabase.co";
const SUPABASE_KEY = "sb_publishable_lhJBj_J3HtM4ba1C5msQJg_rdp8eOGr";
const TRIP_EDIT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/trip-edit`;
const TABLES = ["days", "day_times", "places", "segments"];
const flightSegments = [
  {
    id: "flight-d1",
    day_id: "d1",
    from_place: "PEK",
    to_place: "CEB",
    mode: "flight",
    minutes: 645,
    note: "2026/9/25 PEK 07:25 -> HKG 11:00 CX345；HKG 15:20 -> CEB 18:10 CX925",
    sort_order: 0,
    virtual: true
  },
  {
    id: "flight-d12",
    day_id: "d12",
    from_place: "CEB",
    to_place: "PEK",
    mode: "flight",
    minutes: 505,
    note: "2026/10/6 CEB 12:00 -> HKG 15:00 CX948；HKG 17:00 -> PEK 20:25 CX312",
    sort_order: 99,
    virtual: true
  }
];

const state = {
  days: [],
  dayTimes: [],
  places: [],
  segments: [],
  activeDayId: "overview",
  editPassword: "",
  editEnabled: false,
  editing: { type: null, id: null },
  addingTime: false,
  addingPlace: false,
  addingSegment: false,
  saveTimer: null,
  layers: [],
  routeCache: new Map(),
  overviewCollapsed: {
    places: true,
    segments: true
  }
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

function moveRoutePanelBeforePlaces() {
  const routePanel = els.segmentList.closest(".panel");
  const placePanel = els.placeList.closest(".panel");
  if (routePanel && placePanel) {
    placePanel.before(routePanel);
  }
}

function configureOverviewPanel(listEl, key) {
  const panel = listEl.closest(".panel");
  const title = panel ? panel.querySelector("h2") : null;
  if (!panel || !title) return;
  const isOverview = state.activeDayId === "overview";
  panel.classList.toggle("overview-collapsible", isOverview);
  panel.classList.toggle("collapsed", isOverview && state.overviewCollapsed[key]);
  if (!isOverview) {
    const oldToggle = title.querySelector(".panel-toggle");
    if (oldToggle) oldToggle.remove();
    return;
  }
  let toggle = title.querySelector(".panel-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.className = "panel-toggle";
    toggle.type = "button";
    title.appendChild(toggle);
  }
  const collapsed = state.overviewCollapsed[key];
  toggle.textContent = collapsed ? "+" : "-";
  toggle.setAttribute("aria-label", collapsed ? "展开" : "收起");
  toggle.onclick = () => {
    state.overviewCollapsed[key] = !state.overviewCollapsed[key];
    render();
  };
}

function configureOverviewPanels() {
  configureOverviewPanel(els.segmentList, "segments");
  configureOverviewPanel(els.placeList, "places");
}

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
  })).filter((segment) => !flightSegments.some((flight) => flight.day_id === segment.day_id && segment.mode === "flight"));
  state.segments = sortByOrder([...state.segments, ...flightSegments]);
}

function setSaveStatus(text) {
  els.saveStatus.textContent = text || "";
}

function errorMessage(error) {
  return error && error.message ? error.message : "操作失败";
}

function setEditing(enabled) {
  state.editEnabled = enabled;
  if (!enabled) state.editing = { type: null, id: null };
  els.dayNote.disabled = !enabled || state.activeDayId === "overview";
  els.unlockEdit.textContent = enabled ? "已解锁" : "编辑";
}

async function callTripEdit(action, payload) {
  const response = await fetch(TRIP_EDIT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({
      action,
      payload,
      password: state.editPassword
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "保存失败");
  return result;
}

async function saveDayNote() {
  if (!state.editEnabled || state.activeDayId === "overview") return;
  const note = els.dayNote.value;
  const day = state.days.find((item) => item.id === state.activeDayId);
  if (day) day.note = note;
  setSaveStatus("保存中...");
  try {
    await callTripEdit("update_day_note", { dayId: state.activeDayId, note });
    setSaveStatus("已保存");
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
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
    els.dayNote.value = "请检查 Supabase 权限或浏览器控制台。";
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

function splitTimeRange(value) {
  const text = String(value || "").trim();
  if (text.includes("-")) {
    const [start, end] = text.split("-").map((part) => part.trim());
    return { start, end };
  }
  return { start: text, end: "" };
}

function combineTimeRange(start, end) {
  if (start && end) return `${start}-${end}`;
  return start || end || "";
}

function timeOptions(selected, includeBlank = false) {
  const options = [];
  if (includeBlank) options.push("");
  for (let hour = 5; hour <= 23; hour += 1) {
    for (const minute of ["00", "30"]) {
      options.push(`${String(hour).padStart(2, "0")}:${minute}`);
    }
  }
  if (selected && !options.includes(selected)) options.unshift(selected);
  return options.map((time) => `<option value="${escapeHtml(time)}"${time === selected ? " selected" : ""}>${escapeHtml(time)}</option>`).join("");
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
    motorbike: "🏍️",
    pier: "⛴️",
    ferry: "⛴️",
    flight: "✈️"
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
  return `<span class="badge emoji-badge ${escapeHtml(place.kind)}">${placeKindIcon(place.kind)}</span>`;
}

function placeKindIcon(kind) {
  const icons = {
    airport: "✈",
    hotel: "🏨",
    stay: "🏨",
    port: "⛴",
    pier: "⛴",
    beach: "🏖",
    waterfall: "📍",
    falls: "📍",
    food: "🍽",
    mall: "🛍",
    spot: "📍"
  };
  return icons[kind] || icons.spot;
}

function segmentBadge(segment) {
  const type = segmentType(segment.mode);
  return `<span class="badge emoji-badge ${type}">${modeIcon(segment.mode)}</span>`;
}

function modeOptions(selected) {
  const modes = [
    ["car", `${modeIcon("car")} car`],
    ["charter", `${modeIcon("charter")} charter`],
    ["trike", `${modeIcon("trike")} trike`],
    ["motorbike", `${modeIcon("motorbike")} motorbike`],
    ["ferry", `${modeIcon("ferry")} ferry`],
    ["flight", `${modeIcon("flight")} flight`]
  ];
  return modes.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function kindOptions(selected) {
  if (selected === "stay") selected = "hotel";
  const kinds = [
    ["spot", `${placeKindIcon("spot")} 景点`],
    ["hotel", `${placeKindIcon("hotel")} 酒店`],
    ["port", `${placeKindIcon("port")} 码头`],
    ["airport", `${placeKindIcon("airport")} 机场`],
    ["beach", `${placeKindIcon("beach")} 海滩`],
    ["food", `${placeKindIcon("food")} 餐饮`],
    ["mall", `${placeKindIcon("mall")} 商场`]
  ];
  return kinds.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function placeOptions(selected) {
  return sortByOrder(state.places)
    .map((place) => `<option value="${escapeHtml(place.name)}"${place.name === selected ? " selected" : ""}>${escapeHtml(place.name)}</option>`)
    .join("");
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
      state.editing = { type: null, id: null };
      els.sidebar.classList.remove("open");
      render();
    });
  });
}

function editButtons(type, id) {
  if (!state.editEnabled || state.activeDayId === "overview") return "";
  if (String(id).startsWith("flight-")) return "";
  return `
    <span class="row-actions">
      <button class="icon-tool" type="button" data-edit-type="${type}" data-edit-id="${escapeHtml(id)}" aria-label="编辑" title="编辑">✎</button>
      <button class="icon-tool danger" type="button" data-delete-type="${type}" data-delete-id="${escapeHtml(id)}" aria-label="删除" title="删除">×</button>
    </span>
  `;
}

function renderTimeRow(item) {
  const isEditing = state.editing.type === "time" && state.editing.id === item.id;
  const range = splitTimeRange(item.time_text);
  if (!isEditing) {
    return `
      <li>
        <span class="badge">${escapeHtml(item.time_text)}</span>
        <span class="read-row">
          <span>${escapeHtml(item.detail)}</span>
          ${editButtons("time", item.id)}
        </span>
      </li>
    `;
  }
  return `
    <li class="editable-row" data-time-id="${escapeHtml(item.id)}">
      <select class="edit-time-start">${timeOptions(range.start)}</select>
      <select class="edit-time-end">${timeOptions(range.end, true)}</select>
      <input class="edit-detail" value="${escapeHtml(item.detail)}" aria-label="安排内容">
      <button class="icon-tool save-time" type="button" aria-label="保存" title="保存">✓</button>
      <button class="icon-tool cancel-edit" type="button" aria-label="取消" title="取消">×</button>
    </li>
  `;
}

function renderPlaceRow(place, index) {
  const isEditing = state.editing.type === "place" && state.editing.id === place.id;
  if (!isEditing) {
    return `
      <li>
        ${placeBadge(place, index)}
        <span class="read-row">
          <span>
            <strong>${escapeHtml(place.name)}</strong>
            <span class="item-meta">${escapeHtml(place.note)}</span>
          </span>
          ${editButtons("place", place.id)}
        </span>
      </li>
    `;
  }
  return `
    <li class="editable-place" data-place-id="${escapeHtml(place.id)}">
      <input class="edit-place-name" value="${escapeHtml(place.name)}" aria-label="地点名">
      <input class="edit-place-note" value="${escapeHtml(place.note)}" aria-label="地点备注">
      <div class="coord-row">
        <input class="edit-place-lat" type="number" step="0.000001" value="${escapeHtml(place.lat)}" aria-label="纬度">
        <input class="edit-place-lon" type="number" step="0.000001" value="${escapeHtml(place.lon)}" aria-label="经度">
        <select class="edit-place-kind" aria-label="类型">${kindOptions(place.kind || "spot")}</select>
      </div>
      <div class="edit-actions">
        <button class="icon-tool save-place" type="button" aria-label="保存" title="保存">✓</button>
        <button class="icon-tool cancel-edit" type="button" aria-label="取消" title="取消">×</button>
      </div>
    </li>
  `;
}

function renderLists(data) {
  els.timeline.innerHTML = [
    ...(data.times.length ? data.times.map(renderTimeRow) : ['<li class="empty">暂无时间安排</li>']),
    state.editEnabled && state.activeDayId !== "overview"
      ? state.addingTime
        ? `<li class="add-row">
          <select id="new-time-start">${timeOptions("09:00")}</select>
          <select id="new-time-end">${timeOptions("", true)}</select>
          <input id="new-time-detail" value="新的安排" aria-label="新增安排内容">
          <button class="icon-tool add-icon" id="confirm-add-time" type="button" aria-label="确认新增" title="确认新增">✓</button>
          <button class="icon-tool" id="cancel-add-time" type="button" aria-label="取消新增" title="取消新增">×</button>
        </li>`
        : `<li class="add-collapsed-row">
          <button class="icon-tool add-icon" id="show-add-time" type="button" aria-label="新增时间" title="新增时间">+</button>
        </li>`
      : ""
  ].join("");

  els.placeList.innerHTML = [
    ...(data.places.length ? data.places.map(renderPlaceRow) : ['<li class="empty">暂无地点</li>']),
    state.editEnabled && state.activeDayId !== "overview"
      ? state.addingPlace
        ? `<li class="editable-place add-place-row">
            <input id="new-place-name" value="新地点" aria-label="地点名">
            <input id="new-place-note" value="" placeholder="备注" aria-label="地点备注">
            <input id="new-place-plus" value="" placeholder="Google Plus Code" aria-label="Plus Code">
            <div class="coord-row">
              <input id="new-place-lat" type="number" step="0.000001" placeholder="纬度">
              <input id="new-place-lon" type="number" step="0.000001" placeholder="经度">
              <select id="new-place-kind">${kindOptions("spot")}</select>
            </div>
            <div class="edit-actions">
              <button class="icon-tool add-icon" id="confirm-add-place" type="button" aria-label="确认新增" title="确认新增">✓</button>
              <button class="icon-tool" id="cancel-add-place" type="button" aria-label="取消新增" title="取消新增">×</button>
            </div>
          </li>`
        : '<li class="add-collapsed-row"><button class="icon-tool add-icon" id="show-add-place" type="button" aria-label="新增地点" title="新增地点">+</button></li>'
      : ""
  ].join("");

  els.segmentList.innerHTML = data.segments.length
    ? data.segments.map(renderSegmentRow).join("")
    : '<li class="empty">暂无路线</li>';

  if (state.editEnabled && state.activeDayId !== "overview") {
    els.segmentList.innerHTML += state.addingSegment
      ? `<li class="editable-segment add-segment-row">
          <input id="new-segment-from" value="" placeholder="起点">
          <input id="new-segment-to" value="" placeholder="终点">
          <select id="new-segment-mode">${modeOptions("car")}</select>
          <input id="new-segment-minutes" type="number" min="0" placeholder="分钟">
          <input id="new-segment-note" value="" placeholder="备注">
          <div class="edit-actions">
            <button class="icon-tool add-icon" id="confirm-add-segment" type="button" aria-label="确认新增" title="确认新增">✓</button>
            <button class="icon-tool" id="cancel-add-segment" type="button" aria-label="取消新增" title="取消新增">×</button>
          </div>
        </li>`
      : '<li class="add-collapsed-row"><button class="icon-tool add-icon" id="show-add-segment" type="button" aria-label="新增路线" title="新增路线">+</button></li>';
  }

  bindListActions();
}

function renderSegmentRow(segment) {
  const isEditing = state.editing.type === "segment" && state.editing.id === segment.id;
  if (segment.virtual) {
    return `
      <li>
        ${segmentBadge(segment)}
        <span>
          <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong>
          <span class="item-meta">${escapeHtml(segment.note)} · ${formatMinutes(segment.minutes)}</span>
        </span>
      </li>
    `;
  }
  if (!isEditing) {
    return `
      <li>
        ${segmentBadge(segment)}
        <span class="read-row">
          <span>
            <strong>${escapeHtml(segment.from_place)} → ${escapeHtml(segment.to_place)}</strong>
            <span class="item-meta">${escapeHtml(segment.note)}${segment.minutes ? ` · ${formatMinutes(segment.minutes)}` : ""}</span>
          </span>
          ${editButtons("segment", segment.id)}
        </span>
      </li>
    `;
  }
  return `
    <li class="editable-segment" data-segment-id="${escapeHtml(segment.id)}">
      <input class="edit-segment-from" value="${escapeHtml(segment.from_place)}" placeholder="起点">
      <input class="edit-segment-to" value="${escapeHtml(segment.to_place)}" placeholder="终点">
      <select class="edit-segment-mode">${modeOptions(segment.mode)}</select>
      <input class="edit-segment-minutes" type="number" min="0" value="${escapeHtml(segment.minutes || "")}" placeholder="分钟">
      <input class="edit-segment-note" value="${escapeHtml(segment.note || "")}" placeholder="备注">
      <div class="edit-actions">
        <button class="icon-tool save-segment" type="button" aria-label="保存" title="保存">✓</button>
        <button class="icon-tool cancel-edit" type="button" aria-label="取消" title="取消">×</button>
      </div>
    </li>
  `;
}

function bindListActions() {
  document.querySelectorAll("[data-edit-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editing = { type: button.dataset.editType, id: button.dataset.editId };
      render();
    });
  });

  document.querySelectorAll(".cancel-edit").forEach((button) => {
    button.addEventListener("click", () => {
      state.editing = { type: null, id: null };
      render();
    });
  });

  document.querySelectorAll("[data-delete-type]").forEach((button) => {
    button.addEventListener("click", () => deleteRow(button.dataset.deleteType, button.dataset.deleteId));
  });

  const saveTime = document.querySelector(".save-time");
  if (saveTime) saveTime.addEventListener("click", saveEditingTime);

  const savePlace = document.querySelector(".save-place");
  if (savePlace) savePlace.addEventListener("click", saveEditingPlace);

  const saveSegment = document.querySelector(".save-segment");
  if (saveSegment) saveSegment.addEventListener("click", saveEditingSegment);

  const showAddSegment = document.getElementById("show-add-segment");
  if (showAddSegment) showAddSegment.addEventListener("click", () => {
    state.addingSegment = true;
    render();
  });

  const confirmAddSegment = document.getElementById("confirm-add-segment");
  if (confirmAddSegment) confirmAddSegment.addEventListener("click", addSegmentRow);

  const cancelAddSegment = document.getElementById("cancel-add-segment");
  if (cancelAddSegment) cancelAddSegment.addEventListener("click", () => {
    state.addingSegment = false;
    render();
  });

  const showAddTime = document.getElementById("show-add-time");
  if (showAddTime) showAddTime.addEventListener("click", () => {
    state.addingTime = true;
    render();
  });

  const confirmAddTime = document.getElementById("confirm-add-time");
  if (confirmAddTime) confirmAddTime.addEventListener("click", addTimeRow);

  const cancelAddTime = document.getElementById("cancel-add-time");
  if (cancelAddTime) cancelAddTime.addEventListener("click", () => {
    state.addingTime = false;
    render();
  });

  const showAddPlace = document.getElementById("show-add-place");
  if (showAddPlace) showAddPlace.addEventListener("click", () => {
    state.addingPlace = true;
    render();
  });

  const confirmAddPlace = document.getElementById("confirm-add-place");
  if (confirmAddPlace) confirmAddPlace.addEventListener("click", addPlaceRow);

  const cancelAddPlace = document.getElementById("cancel-add-place");
  if (cancelAddPlace) cancelAddPlace.addEventListener("click", () => {
    state.addingPlace = false;
    render();
  });
}

async function saveEditingSegment() {
  const row = document.querySelector(".editable-segment");
  if (!row) return;
  const id = row.dataset.segmentId;
  const segment = state.segments.find((item) => item.id === id);
  segment.from_place = row.querySelector(".edit-segment-from").value;
  segment.to_place = row.querySelector(".edit-segment-to").value;
  segment.mode = row.querySelector(".edit-segment-mode").value;
  segment.minutes = toNumber(row.querySelector(".edit-segment-minutes").value);
  segment.note = row.querySelector(".edit-segment-note").value;
  setSaveStatus("保存中...");
  try {
    await callTripEdit("update_segment", {
      id,
      from_place: segment.from_place,
      to_place: segment.to_place,
      mode: segment.mode,
      minutes: segment.minutes,
      note: segment.note
    });
    state.editing = { type: null, id: null };
    state.routeCache.clear();
    setSaveStatus("已保存");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function addSegmentRow() {
  if (!state.editEnabled || state.activeDayId === "overview") return;
  const rows = state.segments.filter((item) => item.day_id === state.activeDayId);
  const fromPlace = document.getElementById("new-segment-from").value;
  const toPlace = document.getElementById("new-segment-to").value;
  if (!fromPlace || !toPlace) {
    setSaveStatus("请选择起点和终点");
    return;
  }
  setSaveStatus("新增中...");
  try {
    const result = await callTripEdit("insert_segment", {
      day_id: state.activeDayId,
      from_place: fromPlace,
      to_place: toPlace,
      mode: document.getElementById("new-segment-mode").value,
      minutes: toNumber(document.getElementById("new-segment-minutes").value),
      note: document.getElementById("new-segment-note").value || "",
      sort_order: rows.length + 1
    });
    state.segments.push({
      ...result.row,
      minutes: toNumber(result.row.minutes)
    });
    state.addingSegment = false;
    state.routeCache.clear();
    setSaveStatus("已新增");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function saveEditingTime() {
  const row = document.querySelector(".editable-row");
  if (!row) return;
  const id = row.dataset.timeId;
  const item = state.dayTimes.find((time) => time.id === id);
  item.time_text = combineTimeRange(
    row.querySelector(".edit-time-start").value,
    row.querySelector(".edit-time-end").value
  );
  item.detail = row.querySelector(".edit-detail").value;
  setSaveStatus("保存中...");
  try {
    await callTripEdit("update_day_time", {
      id,
      time_text: item.time_text,
      detail: item.detail
    });
    state.editing = { type: null, id: null };
    setSaveStatus("已保存");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function saveEditingPlace() {
  const row = document.querySelector(".editable-place");
  if (!row) return;
  const id = row.dataset.placeId;
  const place = state.places.find((item) => item.id === id);
  place.name = row.querySelector(".edit-place-name").value;
  place.note = row.querySelector(".edit-place-note").value;
  place.lat = toNumber(row.querySelector(".edit-place-lat").value);
  place.lon = toNumber(row.querySelector(".edit-place-lon").value);
  place.kind = row.querySelector(".edit-place-kind").value || "spot";
  setSaveStatus("保存中...");
  try {
    await callTripEdit("update_place", {
      id,
      name: place.name,
      note: place.note,
      lat: place.lat,
      lon: place.lon,
      kind: place.kind
    });
    state.editing = { type: null, id: null };
    state.routeCache.clear();
    setSaveStatus("已保存");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function addTimeRow() {
  if (!state.editEnabled || state.activeDayId === "overview") return;
  const rows = state.dayTimes.filter((item) => item.day_id === state.activeDayId);
  const timeText = combineTimeRange(
    document.getElementById("new-time-start").value,
    document.getElementById("new-time-end").value
  );
  const detail = document.getElementById("new-time-detail").value || "新的安排";
  setSaveStatus("新增中...");
  try {
    const result = await callTripEdit("insert_day_time", {
      day_id: state.activeDayId,
      time_text: timeText,
      detail,
      sort_order: rows.length + 1
    });
    state.dayTimes.push(result.row);
    state.addingTime = false;
    setSaveStatus("已新增");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function addPlaceRow() {
  if (!state.editEnabled || state.activeDayId === "overview") return;
  const rows = state.places.filter((item) => item.day_id === state.activeDayId);
  const existing = rows[rows.length - 1] || state.places.find((item) => item.lat !== null && item.lon !== null);
  const plusCode = document.getElementById("new-place-plus").value.trim();
  let lat = toNumber(document.getElementById("new-place-lat").value);
  let lon = toNumber(document.getElementById("new-place-lon").value);
  if (plusCode && window.OpenLocationCode) {
    try {
      const code = plusCode.toUpperCase().split(" ")[0];
      const area = OpenLocationCode.decode(code);
      lat = (area.latitudeLo + area.latitudeHi) / 2;
      lon = (area.longitudeLo + area.longitudeHi) / 2;
    } catch (error) {
      setSaveStatus("Plus Code 无效");
      return;
    }
  }
  if (lat === null || lon === null) {
    lat = existing ? existing.lat : 10.3157;
    lon = existing ? existing.lon : 123.8854;
  }
  setSaveStatus("新增中...");
  try {
    const result = await callTripEdit("insert_place", {
      day_id: state.activeDayId,
      name: document.getElementById("new-place-name").value || "新地点",
      note: document.getElementById("new-place-note").value || "",
      lat,
      lon,
      kind: document.getElementById("new-place-kind").value || "spot",
      plus_code: plusCode,
      sort_order: rows.length + 1
    });
    state.places.push({
      ...result.row,
      lat: toNumber(result.row.lat),
      lon: toNumber(result.row.lon)
    });
    state.editing = { type: "place", id: result.row.id };
    state.addingPlace = false;
    setSaveStatus("已新增");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
}

async function deleteRow(type, id) {
  if (!state.editEnabled) return;
  const label = type === "time" ? "这条时间安排" : "这个地点";
  if (!window.confirm(`删除${label}？`)) return;
  setSaveStatus("删除中...");
  try {
    if (type === "time") {
      await callTripEdit("delete_day_time", { id });
      state.dayTimes = state.dayTimes.filter((item) => item.id !== id);
    } else {
      await callTripEdit("delete_place", { id });
      state.places = state.places.filter((item) => item.id !== id);
      state.routeCache.clear();
    }
    state.editing = { type: null, id: null };
    setSaveStatus("已删除");
    render();
  } catch (error) {
    console.error(error);
    setSaveStatus(errorMessage(error));
  }
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
  const key = `${from.name}->${to.name}:${from.lat},${from.lon}:${to.lat},${to.lon}`;
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
  if (segmentType(segment.mode) === "road") {
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
    if (segmentType(segment.mode) === "flight") continue;
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
  configureOverviewPanels();
  renderLists(data);
  renderMap(data);
}

els.unlockEdit.addEventListener("click", () => {
  if (!state.editEnabled) {
    const password = window.prompt("输入编辑密码");
    if (!password) return;
    state.editPassword = password;
    setEditing(true);
    render();
    setSaveStatus("已解锁");
    els.dayNote.focus();
    return;
  }
  setEditing(false);
  state.editPassword = "";
  render();
  setSaveStatus("");
});

els.dayNote.addEventListener("input", scheduleSaveDayNote);
els.toggleSidebar.addEventListener("click", () => els.sidebar.classList.toggle("open"));
moveRoutePanelBeforePlaces();
loadData();
