const modes = {
  urgent: {
    state: "硬性到达时间已保护",
    eyebrow: "赶时间 · 上课",
    headline: "不建议沿途堂食，改为终点取餐",
    subhead: "上海 · 南京西路 → 五角场",
    arriveBy: "13:30",
    origin: "南京西路",
    food: "终点便当",
    destination: "五角场",
    mapPill: "沿途火锅预计占用 80 分钟，已自动排除",
    direct: "60 分钟",
    safety: "10 分钟",
    slack: "20 分钟",
    slackNote: "不足以沿途堂食",
    user: "我 13:30 前要到五角场上课，路上想吃点东西。",
    copy: "直达约 60 分钟。保留 10 分钟安全缓冲后，只剩 20 分钟，不适合中途下车堂食。",
    tag: "已取消沿途堂食选项",
    action: "采用终点取餐方案",
    items: [
      { icon: "🍱", name: "终点便当店", detail: "到达后 · 预计取餐 10 分钟", meta: "不影响准时" },
      { icon: "🍜", name: "出发点快取面馆", detail: "出发前 · 总影响 14 分钟", meta: "剩余 6 分钟" },
    ],
  },
  leisure: {
    state: "已找到 3 个可行方案",
    eyebrow: "休闲自驾 · 周末游",
    headline: "时间充裕，可以安排沿途特色午餐",
    subhead: "杭州城区 → 千岛湖景区",
    arriveBy: "12:30",
    origin: "杭州城区",
    food: "沿途本地菜",
    destination: "千岛湖",
    mapPill: "推荐店仅多绕 15 分钟，仍保留 38 分钟余量",
    direct: "140 分钟",
    safety: "15 分钟",
    slack: "115 分钟",
    slackNote: "可安排一顿正餐",
    user: "去千岛湖玩，时间比较宽松，想顺路吃点本地特色。",
    copy: "沿途本地菜馆综合体验最好：多绕约 15 分钟，完整停靠预计 77 分钟，仍有充足余量。",
    tag: "体验优先 · 时间可行",
    action: "采用特色午餐方案",
    items: [
      { icon: "🥘", name: "沿途本地菜馆", detail: "沿途 · 评分 4.8 · 本地特色", meta: "剩余 38 分钟" },
      { icon: "🍜", name: "高速口快餐", detail: "沿途 · 总影响 35 分钟", meta: "最快" },
      { icon: "🐟", name: "千岛湖鱼味馆", detail: "到达后 · 景区附近", meta: "备选" },
    ],
  },
};

const modeName = new URLSearchParams(location.search).get("mode") === "leisure" ? "leisure" : "urgent";
const mode = modes[modeName];
document.body.classList.add(modeName);

const values = {
  "trip-state": mode.state,
  eyebrow: mode.eyebrow,
  headline: mode.headline,
  subhead: mode.subhead,
  "arrive-by": mode.arriveBy,
  "origin-label": mode.origin,
  "food-label": mode.food,
  "destination-label": mode.destination,
  "map-pill": mode.mapPill,
  "direct-time": mode.direct,
  "safety-time": mode.safety,
  "slack-time": mode.slack,
  "slack-note": mode.slackNote,
  "user-message": mode.user,
  "decision-copy": mode.copy,
  "decision-tag": mode.tag,
  "result-count": `${mode.items.length} 个可行选项`,
  "primary-action": `${mode.action} →`,
};

Object.entries(values).forEach(([id, value]) => {
  document.getElementById(id).textContent = value;
});

document.getElementById("recommendations").innerHTML = mode.items.map((item, index) => `
  <article class="recommendation ${index === 0 ? "best" : ""}">
    ${index === 0 ? '<span class="best-badge">BEST</span>' : ""}
    <span class="food-icon">${item.icon}</span>
    <div><strong>${item.name}</strong><p>${item.detail}</p></div>
    <em>${item.meta}</em>
  </article>
`).join("");
