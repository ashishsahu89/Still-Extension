(function exposeRoutineSuggestions(global) {
  const LOOKBACK_DAYS = 28;
  const BUCKET_HOURS = 2;
  const MIN_OBSERVED_DAYS = 7;
  const MIN_TOTAL_IMPULSES = 10;
  const MIN_BUCKET_IMPULSES = 5;
  const MIN_PATTERN_DAYS = 3;
  const MIN_LIFT = 1.5;
  const MIN_RATE = 0.5;

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function startOfLookback(now) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (LOOKBACK_DAYS - 1));
    return start.getTime();
  }

  function dayGroup(timestamp) {
    const day = new Date(timestamp).getDay();
    return day === 0 || day === 6 ? "weekends" : "weekdays";
  }

  function bucketStart(timestamp) {
    return Math.floor(new Date(timestamp).getHours() / BUCKET_HOURS) * BUCKET_HOURS;
  }

  function minutesFromTime(value = "") {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function suggestedTimes(hour) {
    const endHour = hour + BUCKET_HOURS;
    return {
      startTime: `${String(hour).padStart(2, "0")}:00`,
      endTime: endHour >= 24 ? "23:59" : `${String(endHour).padStart(2, "0")}:00`
    };
  }

  function routineOverlaps(routine, days, startTime, endTime) {
    if (!routine.enabled) return false;
    if (!(routine.days || []).some((day) => days.includes(day))) return false;
    const existingStart = minutesFromTime(routine.startTime);
    const existingEnd = minutesFromTime(routine.endTime);
    const suggestedStart = minutesFromTime(startTime);
    const suggestedEnd = minutesFromTime(endTime);
    if (
      existingStart === null ||
      existingEnd === null ||
      suggestedStart === null ||
      suggestedEnd === null
    ) {
      return false;
    }
    return existingStart < suggestedEnd && suggestedStart < existingEnd;
  }

  function activeDates(data, startAt, now) {
    const dates = new Set();
    for (const [key, day = {}] of Object.entries(data.stats || {})) {
      if (
        (day.impulsesPaused || day.sessions || day.focusedSeconds || day.focusedMinutes) &&
        key >= dateKey(startAt) &&
        key <= dateKey(now)
      ) {
        dates.add(key);
      }
    }
    for (const event of data.impulseEvents || []) {
      if (event.createdAt >= startAt && event.createdAt <= now) {
        dates.add(dateKey(event.createdAt));
      }
    }
    for (const session of data.focusSessions || []) {
      if (session.startedAt >= startAt && session.startedAt <= now) {
        dates.add(dateKey(session.startedAt));
      }
    }
    return dates;
  }

  function formatHour(hour) {
    const normalized = hour % 24;
    if (normalized === 0) return "12 AM";
    if (normalized === 12) return "12 PM";
    return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
  }

  function periodName(hour) {
    if (hour < 6) return "early mornings";
    if (hour < 12) return "mornings";
    if (hour < 17) return "afternoons";
    if (hour < 21) return "evenings";
    return "late evenings";
  }

  function routineName(group, hour, mode) {
    const timeName =
      hour < 6
        ? "Early morning"
        : hour < 12
          ? "Morning"
          : hour < 17
            ? "Afternoon"
            : hour < 21
              ? "Evening"
              : "Late evening";
    const ending = mode === "strict" ? "focus" : "reset";
    return group === "weekends"
      ? `Weekend ${timeName.toLowerCase()} ${ending}`
      : `${timeName} ${ending}`;
  }

  function generate(data, timestamp = Date.now()) {
    const now = Number(timestamp);
    const startAt = startOfLookback(now);
    const events = (data.impulseEvents || []).filter(
      (event) =>
        Number.isFinite(event.createdAt) &&
        event.createdAt >= startAt &&
        event.createdAt <= now
    );
    if (events.length < MIN_TOTAL_IMPULSES) return null;

    const observed = activeDates(data, startAt, now);
    const observedByGroup = { weekdays: new Set(), weekends: new Set() };
    for (const key of observed) {
      const midday = new Date(`${key}T12:00:00`);
      observedByGroup[dayGroup(midday.getTime())].add(key);
    }

    const candidates = [];
    for (const group of ["weekdays", "weekends"]) {
      const observedDays = observedByGroup[group].size;
      if (observedDays < MIN_OBSERVED_DAYS) continue;
      const groupEvents = events.filter((event) => dayGroup(event.createdAt) === group);
      if (!groupEvents.length) continue;
      const weightedTotal = groupEvents.reduce((sum, event) => {
        const ageDays = Math.max(0, (now - event.createdAt) / 86400000);
        return sum + 0.5 ** (ageDays / 14);
      }, 0);
      const baselineRate = weightedTotal / (observedDays * (24 / BUCKET_HOURS));

      for (let hour = 0; hour < 24; hour += BUCKET_HOURS) {
        const matching = groupEvents.filter(
          (event) => bucketStart(event.createdAt) === hour
        );
        const patternDays = new Set(matching.map((event) => dateKey(event.createdAt)));
        const rate = matching.length / observedDays;
        const consistency = patternDays.size / observedDays;
        const weightedCount = matching.reduce((sum, event) => {
          const ageDays = Math.max(0, (now - event.createdAt) / 86400000);
          return sum + 0.5 ** (ageDays / 14);
        }, 0);
        const weightedRate = weightedCount / observedDays;
        const lift = baselineRate ? weightedRate / baselineRate : 0;
        if (
          matching.length < MIN_BUCKET_IMPULSES ||
          patternDays.size < MIN_PATTERN_DAYS ||
          rate < MIN_RATE ||
          lift < MIN_LIFT
        ) {
          continue;
        }

        const days = group === "weekdays" ? [1, 2, 3, 4, 5] : [0, 6];
        const { startTime, endTime } = suggestedTimes(hour);
        if (
          (data.routines || []).some((routine) =>
            routineOverlaps(routine, days, startTime, endTime)
          )
        ) {
          continue;
        }

        const availableHosts = new Set(
          (data.protectedSites || []).map((site) => site.host)
        );
        const limitToConfiguredSites = availableHosts.size > 0;
        const hostCounts = new Map();
        for (const event of matching) {
          if (!event.host) continue;
          if (limitToConfiguredSites && !availableHosts.has(event.host)) continue;
          hostCounts.set(event.host, (hostCounts.get(event.host) || 0) + 1);
        }
        const siteHosts = Array.from(hostCounts)
          .sort((a, b) => b[1] - a[1])
          .filter(([, count], index) => index === 0 || count / matching.length >= 0.15)
          .slice(0, 3)
          .map(([host]) => host);
        if (!siteHosts.length) continue;

        const nearbySessions = (data.focusSessions || []).filter(
          (session) =>
            session.startedAt >= startAt &&
            session.startedAt <= now &&
            dayGroup(session.startedAt) === group &&
            bucketStart(session.startedAt) === hour
        );
        const completedSessions = nearbySessions.filter(
          (session) => session.completed !== false
        );
        const completedSeconds = completedSessions.reduce(
          (sum, session) => sum + (session.focusedSeconds || 0),
          0
        );
        const completionRate = nearbySessions.length
          ? completedSessions.length / nearbySessions.length
          : 0;
        const mode =
          completedSessions.length >= 3 &&
          completedSeconds >= 90 * 60 &&
          completionRate >= 0.7
            ? "strict"
            : "mindful";
        const score =
          weightedRate * Math.min(lift, 4) * (0.5 + consistency);
        const groupLabel = group === "weekdays" ? "active weekdays" : "active weekend days";

        candidates.push({
          id: `distraction-${group}-${hour}-${siteHosts.join("-")}`,
          kind: "distraction-window",
          score,
          title: `Protect your ${group === "weekdays" ? "weekday " : "weekend "}${periodName(hour)}`,
          copy:
            `From ${formatHour(hour)}–${formatHour(hour + BUCKET_HOURS)}, protected-site impulses were ` +
            `${lift.toFixed(1)}× your usual two-hour window—${matching.length} across ${patternDays.size} ${groupLabel}.`,
          evidence: `Based on the last ${LOOKBACK_DAYS} days · calculated on this device`,
          impulseCount: matching.length,
          patternDays: patternDays.size,
          observedDays,
          lift,
          siteHosts,
          routine: {
            name: routineName(group, hour, mode),
            days,
            startTime,
            endTime,
            mode,
            startBehavior: "ask",
            topic: "",
            siteHosts,
            enabled: true
          }
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  global.StillRoutineSuggestions = {
    generate,
    constants: {
      LOOKBACK_DAYS,
      MIN_OBSERVED_DAYS,
      MIN_TOTAL_IMPULSES,
      MIN_PATTERN_DAYS,
      MIN_LIFT
    }
  };
})(globalThis);
