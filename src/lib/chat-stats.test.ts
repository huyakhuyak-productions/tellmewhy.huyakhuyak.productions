import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveChatStats } from "./chat-stats";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-06T12:00:00.000Z");

describe("deriveChatStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts total conversations and passes memberSince through unchanged", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const memberSince = new Date("2025-01-01T00:00:00.000Z");
    const stats = deriveChatStats([{ updatedAt: NOW }, { updatedAt: NOW }], memberSince);
    expect(stats.total).toBe(2);
    expect(stats.memberSince).toBe(memberSince);
  });

  it("excludes a conversation last updated exactly 7 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const exactlySevenDaysAgo = new Date(NOW.getTime() - WEEK_MS);
    const stats = deriveChatStats([{ updatedAt: exactlySevenDaysAgo }], new Date());
    expect(stats.thisWeek).toBe(0);
  });

  it("includes a conversation updated one millisecond inside the 7-day window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const justUnderSevenDays = new Date(NOW.getTime() - WEEK_MS + 1);
    const stats = deriveChatStats([{ updatedAt: justUnderSevenDays }], new Date());
    expect(stats.thisWeek).toBe(1);
  });

  it("counts only the conversations within the week for thisWeek, independent of total", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const recent = new Date(NOW.getTime() - 1000);
    const old = new Date(NOW.getTime() - WEEK_MS - 1000);
    const stats = deriveChatStats([{ updatedAt: recent }, { updatedAt: old }], new Date());
    expect(stats.total).toBe(2);
    expect(stats.thisWeek).toBe(1);
  });
});
