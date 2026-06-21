// score.js — canonical prep score calculations shared across all pages

export const SCORE_COLORS = [
  {min:96,max:100,color:'#00CC55'}, {min:91,max:95,color:'#1A9A4A'},
  {min:86,max:90,color:'#2DB85C'}, {min:81,max:85,color:'#52CC6E'},
  {min:76,max:80,color:'#7DD47A'}, {min:71,max:75,color:'#C8D44A'},
  {min:66,max:70,color:'#E0C832'}, {min:61,max:65,color:'#F0A820'},
  {min:56,max:60,color:'#F08818'}, {min:51,max:55,color:'#E86818'},
  {min:46,max:50,color:'#E04C14'}, {min:41,max:45,color:'#D43010'},
  {min:0, max:40, color:'#880000'},
];

export function getScoreColor(score) {
  for (const b of SCORE_COLORS) if (score >= b.min && score <= b.max) return b.color;
  return '#880000';
}

export function today() {
  const d = new Date(); d.setHours(0,0,0,0); return d;
}

export function parseDate(str) {
  if (!str) return null;
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y,m-1,d);
}

export function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function daysUntil(d) {
  return Math.round((d - today()) / 86400000);
}

export function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getStageDueDate(sermonDateStr, stageKey, customDeadlines, STAGES) {
  if (customDeadlines && customDeadlines[stageKey]) {
    return parseDate(customDeadlines[stageKey]);
  }
  const stage = STAGES.find(s => s.key === stageKey);
  if (!stage || stage.dueDay === null) return null;
  const sermonDate = parseDate(sermonDateStr);
  const base = new Date(sermonDate);
  base.setDate(sermonDate.getDate() - (stage.weeksBack * 7));
  const baseDow = base.getDay();
  let diff = baseDow - stage.dueDay;
  if (diff < 0) diff += 7;
  let result = new Date(base);
  result.setDate(base.getDate() - diff);
  if (result > sermonDate && stage.key !== 'completed') {
    result = new Date(sermonDate);
  }
  return result;
}

export function isStageCompleted(sermon, stageKey, stages) {
  const stageKeys = stages.map(s => s.key);
  const currentIdx = stageKeys.indexOf(sermon.status);
  const stageIdx = stageKeys.indexOf(stageKey);
  return stageIdx < currentIdx;
}

export function calculateWeekScore(sermons, stages) {
  const todayDate = today();
  let totalDeductions = 0;

  const activeSermons = sermons.filter(s =>
    s.status !== 'completed' && s.date && parseDate(s.date) >= todayDate
  );

  if (activeSermons.length === 0) return { score: 100, hasData: false };

  for (const sermon of activeSermons) {
    const workingStages = stages.filter(st => st.key !== 'not-started' && st.key !== 'completed');
    for (const stage of workingStages) {
      if (isStageCompleted(sermon, stage.key, stages)) continue;
      const dueDate = getStageDueDate(sermon.date, stage.key, sermon.customDeadlines, stages);
      if (!dueDate) continue;
      const du = daysUntil(dueDate);
      if (du < 0) {
        const overdueDays = Math.abs(du);
        totalDeductions += Math.min(20, 10 + (overdueDays - 1) * 5);
      } else if (du <= 1) {
        totalDeductions += 10;
      } else if (du === 2) {
        totalDeductions += 5;
      }
    }
  }

  return { score: Math.max(0, 100 - totalDeductions), hasData: true };
}

export function calculateOverallScore(streakData) {
  const scores = (streakData && streakData.weeklyScores) || [];
  if (scores.length === 0) return 75;
  const sum = scores.reduce((acc, w) => acc + (w.score ?? 75), 0);
  return Math.round(sum / scores.length);
}

export async function loadOrInitStreakData(db, docFn, getDocFn, setDocFn, uid) {
  const ref = docFn(db, 'users', uid, 'meta', 'streak_data');
  const snap = await getDocFn(ref);
  if (!snap.exists()) {
    const data = { weeklyScores: [], currentStreak: 0, bestStreak: 0, lastRecorded: null };
    await setDocFn(ref, data);
    return data;
  }
  return snap.data();
}

export async function recordMissingWeeklyScores(db, docFn, getDocFn, setDocFn, uid, sermons, stages, streakData) {
  if (!sermons || sermons.length === 0) return streakData;

  const now = new Date();
  const todayDate = today();
  const mondays = [];
  for (let i = 1; i <= 12; i++) {
    const d = getWeekStart(new Date(todayDate));
    d.setDate(d.getDate() - i * 7);
    mondays.push(d);
  }

  const recorded = new Set((streakData.weeklyScores || []).map(w => w.weekStart));
  let updated = { ...streakData, weeklyScores: [...(streakData.weeklyScores || [])] };
  let changed = false;

  for (const monday of mondays) {
    const weekStart = toYMD(monday);
    if (recorded.has(weekStart)) continue;

    const weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let hadTasks = false;
    for (const sermon of sermons.filter(s => s.status !== 'completed')) {
      const workingStages = stages.filter(st => st.key !== 'not-started' && st.key !== 'completed' && st.dueDay !== null);
      for (const stage of workingStages) {
        const due = getStageDueDate(sermon.date, stage.key, sermon.customDeadlines, stages);
        if (due && due >= monday && due <= weekEnd) { hadTasks = true; break; }
      }
      if (hadTasks) break;
    }
    if (!hadTasks) continue;

    let deductions = 0;
    for (const sermon of sermons.filter(s => s.status !== 'completed' && s.date && parseDate(s.date) >= monday)) {
      const workingStages = stages.filter(st => st.key !== 'not-started' && st.key !== 'completed');
      for (const stage of workingStages) {
        if (isStageCompleted(sermon, stage.key, stages)) continue;
        const due = getStageDueDate(sermon.date, stage.key, sermon.customDeadlines, stages);
        if (!due || due < monday || due > weekEnd) continue;
        const du = Math.round((due - todayDate) / 86400000);
        if (du < 0) deductions += Math.min(20, 10 + (Math.abs(du) - 1) * 5);
        else if (du <= 1) deductions += 10;
        else if (du === 2) deductions += 5;
      }
    }
    const score = Math.max(0, 100 - deductions);
    updated.weeklyScores.push({ weekStart, score });
    recorded.add(weekStart);
    changed = true;
  }

  const thisWeekStart = toYMD(getWeekStart());
  const isMonday = now.getDay() === 1;
  const isPastMidnight = now.getHours() > 0 || (now.getHours() === 0 && now.getMinutes() >= 1);
  if (isMonday && isPastMidnight && !recorded.has(thisWeekStart)) {
    const weekResult = calculateWeekScore(sermons, stages);
    if (weekResult.hasData) {
      updated.weeklyScores.push({ weekStart: thisWeekStart, score: weekResult.score });
      changed = true;
    }
  }

  if (!changed) return streakData;

  updated.weeklyScores.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (updated.weeklyScores.length > 12) updated.weeklyScores = updated.weeklyScores.slice(-12);

  const sorted = [...updated.weeklyScores].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].score >= 80) streak++; else break;
  }
  updated.currentStreak = streak;
  updated.bestStreak = Math.max(streak, streakData.bestStreak || 0);

  await setDocFn(docFn(db, 'users', uid, 'meta', 'streak_data'), updated);
  return updated;
}
