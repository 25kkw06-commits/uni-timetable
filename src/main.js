import "./style.css";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const COLORS = [
  "#e85d4c",
  "#f08c2d",
  "#3aa0d8",
  "#2f9e8a",
  "#6c63d4",
  "#d4538a",
  "#4c7cf0",
  "#c9a227",
  "#2aa5a0",
  "#8a5a44",
];
const STORAGE_KEY = "uni-timetable-v1";

const defaultState = () => ({
  title: "내 시간표",
  settings: {
    startTime: "09:00",
    lectureMin: 50,
    breakMin: 10,
    periodCount: 10,
  },
  courses: [],
  memo: "",
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

let state = loadState();
let modalCourseId = null;
let drag = null;
let toastTimer = null;

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return crypto.randomUUID();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function minutesToTime(total) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

function parseTime(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function periodTimes() {
  const { startTime, lectureMin, breakMin, periodCount } = state.settings;
  let cursor = parseTime(startTime);
  const list = [];
  for (let i = 0; i < periodCount; i += 1) {
    const start = cursor;
    const end = start + Number(lectureMin);
    list.push({ index: i, start, end });
    cursor = end + Number(breakMin);
  }
  return list;
}

function nextColor() {
  return COLORS[state.courses.length % COLORS.length];
}

function getCourse(id) {
  return state.courses.find((c) => c.id === id);
}

function overlaps(aStart, aLen, bStart, bLen) {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

function canPlace(courseId, day, startPeriod) {
  const course = getCourse(courseId);
  if (!course) return false;
  const count = Number(state.settings.periodCount);
  const len = Number(course.credits);
  if (startPeriod < 0 || startPeriod + len > count) return false;
  return state.courses.every((other) => {
    if (other.id === courseId || !other.placement) return true;
    if (other.placement.day !== day) return true;
    return !overlaps(startPeriod, len, other.placement.startPeriod, Number(other.credits));
  });
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 1800);
}

function clampSettings() {
  const s = state.settings;
  s.lectureMin = Math.max(10, Number(s.lectureMin) || 50);
  s.breakMin = Math.max(0, Number(s.breakMin) || 0);
  s.periodCount = Math.min(16, Math.max(4, Number(s.periodCount) || 10));
  state.courses.forEach((course) => {
    if (!course.placement) return;
    if (course.placement.startPeriod + Number(course.credits) > s.periodCount) {
      course.placement = null;
    }
  });
}

function render() {
  clampSettings();
  save();
  const app = document.querySelector("#app");
  const { settings } = state;
  const periods = periodTimes();

  app.innerHTML = `
    <div class="app">
      <section class="toolbar">
        <div class="title-wrap">
          <label for="title">시간표 제목</label>
          <input id="title" class="title-input" value="${escapeAttr(state.title)}" />
        </div>
        <div class="fields">
          <label class="field">1교시 시작
            <input id="startTime" type="time" value="${settings.startTime}" />
          </label>
          <label class="field">수업 시간(분)
            <input id="lectureMin" type="number" min="10" step="5" value="${settings.lectureMin}" />
          </label>
          <label class="field">쉬는 시간(분)
            <input id="breakMin" type="number" min="0" step="5" value="${settings.breakMin}" />
          </label>
          <label class="field">교시 수
            <input id="periodCount" type="number" min="4" max="16" value="${settings.periodCount}" />
          </label>
        </div>
        <div class="actions">
          <button class="btn" id="exportPng" type="button">PNG</button>
          <button class="btn btn-primary" id="exportPdf" type="button">PDF</button>
        </div>
      </section>

      <section class="sheet" id="exportRoot">
        <div class="sheet-inner">
          <div class="sheet-title">${escapeText(state.title)}</div>
          <div class="tt" id="grid" style="--period-count:${periods.length}">
            <div class="tt-head">
              <div></div>
              ${DAYS.map(
                (day, i) =>
                  `<div class="${i >= 5 ? "weekend" : ""}">${day}</div>`,
              ).join("")}
            </div>
            <div class="tt-body">
              <div class="tt-times">
                ${periods
                  .map(
                    (p) => `
                      <div class="tt-time">
                        <strong>${p.index + 1}교시</strong>
                        <span>${minutesToTime(p.start)}–${minutesToTime(p.end)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              ${DAYS.map(
                (day, i) => `
                  <div class="tt-day ${i >= 5 ? "weekend" : ""}" data-day="${i}">
                    <div class="tt-day-slots">
                      ${periods
                        .map(
                          (p) =>
                            `<div class="tt-slot" data-day="${i}" data-period="${p.index}"></div>`,
                        )
                        .join("")}
                    </div>
                    <div class="tt-day-blocks">
                      ${placedBlocksHtml(i, periods.length)}
                    </div>
                  </div>
                `,
              ).join("")}
            </div>
          </div>
          ${creditBarHtml()}
        </div>
      </section>

      <aside class="sidebar">
        <section class="panel">
          <h2>미배치 수업</h2>
          <p class="hint">오른쪽 아래 + 로 추가한 뒤, 블럭을 표 위로 끌어다 놓으세요.</p>
          <div class="tray" id="tray">${trayHtml()}</div>
        </section>
        <section class="panel">
          <h2>메모</h2>
          <textarea class="memo" id="memo" placeholder="과제, 수강신청 메모, 강의실 등">${escapeText(state.memo)}</textarea>
        </section>
      </aside>
    </div>
    <button class="fab" id="fab" type="button" aria-label="수업 추가">+</button>
  `;

  bind();
}

function creditTotals() {
  return state.courses.reduce(
    (acc, course) => {
      const credits = Number(course.credits) || 0;
      acc.total += credits;
      acc.count += 1;
      if (course.placement) acc.placed += credits;
      else acc.unplaced += credits;
      return acc;
    },
    { total: 0, placed: 0, unplaced: 0, count: 0 },
  );
}

function creditBarHtml() {
  const { total, placed, unplaced, count } = creditTotals();
  return `
    <div class="credit-bar">
      <div class="credit-main">총 <strong>${total}</strong>학점</div>
      <div class="credit-meta">과목 ${count}개</div>
      <div class="credit-meta">배치 ${placed}학점</div>
      <div class="credit-meta">미배치 ${unplaced}학점</div>
    </div>
  `;
}

function placedBlocksHtml(day, periodCount) {
  return state.courses
    .filter((c) => c.placement?.day === day)
    .map((course) => {
      const start = course.placement.startPeriod;
      const span = Math.min(Number(course.credits), periodCount - start);
      return `
        <div class="course-block" data-id="${course.id}"
          style="top:calc(${start} * var(--cell-h) + 2px);height:calc(${span} * var(--cell-h) - 4px);background:${course.color}">
          <div class="name">${escapeText(course.name)}</div>
          <div class="meta">${escapeText(course.professor || "")} · ${course.credits}시간</div>
        </div>
      `;
    })
    .join("");
}

function trayHtml() {
  const unplaced = state.courses.filter((c) => !c.placement);
  if (!unplaced.length) {
    return `<div class="empty-tray">아직 미배치 수업이 없습니다</div>`;
  }
  return unplaced
    .map(
      (course) => `
        <div class="tray-card" data-id="${course.id}" style="background:${course.color}">
          <div class="name">${escapeText(course.name)}</div>
          <div class="meta">${escapeText(course.professor || "교수 미입력")} · ${course.credits}시간</div>
        </div>
      `,
    )
    .join("");
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function bind() {
  document.querySelector("#title").addEventListener("input", (e) => {
    state.title = e.target.value;
    save();
  });
  ["startTime", "lectureMin", "breakMin", "periodCount"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("change", (e) => {
      const key = id;
      state.settings[key] = e.target.value;
      render();
    });
  });
  document.querySelector("#memo").addEventListener("input", (e) => {
    state.memo = e.target.value;
    save();
  });
  document.querySelector("#fab").addEventListener("click", () => openModal());
  document.querySelector("#exportPng").addEventListener("click", () => exportImage("png"));
  document.querySelector("#exportPdf").addEventListener("click", () => exportImage("pdf"));

  document.querySelectorAll(".course-block, .tray-card").forEach((el) => {
    el.addEventListener("pointerdown", onPointerDown);
  });
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const id = event.currentTarget.dataset.id;
  const course = getCourse(id);
  if (!course) return;
  event.currentTarget.setPointerCapture?.(event.pointerId);

  const rect = event.currentTarget.getBoundingClientRect();
  const cellH = getCellHeight();
  const dayWidth = document.querySelector(".tt-day")?.getBoundingClientRect().width ?? rect.width;
  drag = {
    id,
    fromPlaced: Boolean(course.placement),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    grabOffset: course.placement
      ? Math.max(0, Math.min(course.credits - 1, Math.floor((event.clientY - rect.top) / cellH)))
      : 0,
    width: Math.max(0, dayWidth - 4),
    height: Number(course.credits) * cellH - 4,
    ghost: null,
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function getCellHeight() {
  const slot = document.querySelector(".tt-slot");
  return slot ? slot.getBoundingClientRect().height : 58;
}

function makeGhost(course, width, height) {
  const el = document.createElement("div");
  el.className = "ghost";
  el.style.width = `${Math.max(72, width)}px`;
  el.style.height = `${Math.max(48, height)}px`;
  el.style.background = course.color;
  el.innerHTML = `<div class="name">${escapeText(course.name)}</div><div class="meta">${course.credits}시간</div>`;
  document.body.appendChild(el);
  return el;
}

function onPointerMove(event) {
  if (!drag) return;
  const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && dist < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    const course = getCourse(drag.id);
    drag.ghost = makeGhost(course, drag.width, drag.height);
    document.querySelector(`[data-id="${drag.id}"]`)?.classList.add("dragging");
    document.querySelectorAll(".course-block").forEach((el) => {
      el.style.pointerEvents = "none";
    });
  }
  drag.ghost.style.left = `${event.clientX - 24}px`;
  drag.ghost.style.top = `${event.clientY - 16}px`;
  highlightDrop(event.clientX, event.clientY);
}

function slotFromPoint(x, y) {
  const stack = document.elementsFromPoint(x, y);
  return stack.find((el) => el.classList?.contains("tt-slot")) ?? null;
}

function highlightDrop(x, y) {
  document.querySelectorAll(".tt-slot").forEach((s) => s.classList.remove("drop-ok", "drop-bad"));
  const slot = slotFromPoint(x, y);
  if (!slot || !drag) return;
  const day = Number(slot.dataset.day);
  const period = Number(slot.dataset.period) - drag.grabOffset;
  const ok = canPlace(drag.id, day, period);
  const course = getCourse(drag.id);
  for (let i = 0; i < Number(course.credits); i += 1) {
    const cell = document.querySelector(`.tt-slot[data-day="${day}"][data-period="${period + i}"]`);
    cell?.classList.add(ok ? "drop-ok" : "drop-bad");
  }
}

function onPointerUp(event) {
  window.removeEventListener("pointermove", onPointerMove);
  document.querySelectorAll(".tt-slot").forEach((s) => s.classList.remove("drop-ok", "drop-bad"));
  document.querySelectorAll(".course-block").forEach((el) => {
    el.style.pointerEvents = "";
  });
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  const current = drag;
  current?.ghost?.remove();
  drag = null;

  if (!current) return;
  if (!current.moved) {
    openModal(current.id);
    return;
  }

  const slot = slotFromPoint(event.clientX, event.clientY);
  if (slot) {
    const day = Number(slot.dataset.day);
    const startPeriod = Number(slot.dataset.period) - current.grabOffset;
    if (canPlace(current.id, day, startPeriod)) {
      getCourse(current.id).placement = { day, startPeriod };
    } else {
      showToast("그 자리에는 놓을 수 없습니다");
    }
  }
  render();
}

function openModal(courseId = null) {
  modalCourseId = courseId;
  const course = courseId ? getCourse(courseId) : null;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <form class="modal">
      <h3>${course ? "수업 수정" : "수업 추가"}</h3>
      <div class="stack">
        <label>과목명
          <input name="name" required maxlength="40" value="${escapeAttr(course?.name ?? "")}" placeholder="자료구조" />
        </label>
        <label>교수명
          <input name="professor" maxlength="20" value="${escapeAttr(course?.professor ?? "")}" placeholder="김교수" />
        </label>
        <label>학점 / 시간 (연속 몇 교시)
          <input name="credits" type="number" min="1" max="8" value="${course?.credits ?? 3}" />
        </label>
      </div>
      <div class="modal-actions">
        ${course ? `<button class="btn btn-danger" type="button" id="deleteCourse">삭제</button>` : ""}
        ${course?.placement ? `<button class="btn" type="button" id="unplace">표에서 빼기</button>` : ""}
        <button class="btn" type="button" id="cancelModal">취소</button>
        <button class="btn btn-primary" type="submit">저장</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("input[name=name]").focus();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#cancelModal").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#deleteCourse")?.addEventListener("click", () => {
    state.courses = state.courses.filter((c) => c.id !== courseId);
    overlay.remove();
    render();
  });
  overlay.querySelector("#unplace")?.addEventListener("click", () => {
    getCourse(courseId).placement = null;
    overlay.remove();
    render();
  });
  overlay.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = {
      name: String(data.get("name")).trim(),
      professor: String(data.get("professor")).trim(),
      credits: Math.min(8, Math.max(1, Number(data.get("credits") || 1))),
    };
    if (!payload.name) return;
    if (course) {
      Object.assign(course, payload);
      if (course.placement && !canPlace(course.id, course.placement.day, course.placement.startPeriod)) {
        course.placement = null;
        showToast("시간이 안 맞아 미배치로 옮겨 두었습니다");
      }
    } else {
      state.courses.push({
        id: uid(),
        color: nextColor(),
        placement: null,
        ...payload,
      });
    }
    overlay.remove();
    render();
  });
}

async function exportImage(kind) {
  const root = document.querySelector("#exportRoot");
  const inner = root.querySelector(".sheet-inner");
  let memoEl = null;
  if (state.memo.trim()) {
    memoEl = document.createElement("div");
    memoEl.style.cssText =
      "margin:12px 8px 8px;padding:12px;background:#fffcf5;border:1px solid #d5dce6;border-radius:12px;white-space:pre-wrap;font-size:13px;line-height:1.5;";
    memoEl.textContent = state.memo;
    inner.appendChild(memoEl);
  }
  let canvas;
  try {
    canvas = await html2canvas(root, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
  } finally {
    memoEl?.remove();
  }
  const filename = `${state.title || "시간표"}`;
  if (kind === "png") {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${filename}.png`;
    a.click();
    return;
  }
  const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "l" : "p",
    unit: "px",
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(img, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(`${filename}.pdf`);
}

render();
