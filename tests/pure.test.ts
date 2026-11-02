import { describe, expect, it } from "vitest";
import { computeGoalSnapshot } from "@/lib/goals";
import { centsToDecimalString, parseMoneyToCents } from "@/lib/money";
import { mapPayPalItemStatus } from "@/lib/payouts/paypal";
import { parseReminderHours } from "@/lib/settings";
import { addDaysToKey, localDateKey } from "@/lib/time";

describe("money", () => {
  it("parses user input into integer cents", () => {
    expect(parseMoneyToCents("12")).toBe(1200);
    expect(parseMoneyToCents("12.5")).toBe(1250);
    expect(parseMoneyToCents("12,50")).toBe(1250);
    expect(parseMoneyToCents("$1,234.56")).toBe(123456);
    expect(parseMoneyToCents("1 234,56")).toBe(123456);
    expect(parseMoneyToCents("-3.10")).toBe(-310);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
  });

  it("formats cents for provider APIs without float errors", () => {
    expect(centsToDecimalString(16687)).toBe("166.87");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(-120)).toBe("-1.20");
  });
});

describe("timezones", () => {
  it("computes the local day of an instant", () => {
    const instant = new Date("2026-07-13T23:30:00Z");
    expect(localDateKey(instant, "UTC")).toBe("2026-07-13");
    expect(localDateKey(instant, "Europe/Paris")).toBe("2026-07-14");
    expect(localDateKey(instant, "America/Los_Angeles")).toBe("2026-07-13");
  });
  it("shifts day keys across months and leap years", () => {
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("goals & streaks", () => {
  const now = new Date("2026-07-13T15:00:00Z");
  const at = (iso: string) => ({ createdAt: new Date(iso), socialAccountId: "a" });

  it("counts a streak of consecutive days meeting the goal, without breaking it before today's post", () => {
    const snap = computeGoalSnapshot({
      timezone: "UTC",
      dailyGoal: 2,
      now,
      posts: [at("2026-07-12T10:00:00Z"), at("2026-07-12T18:00:00Z"), at("2026-07-11T09:00:00Z"), at("2026-07-11T10:00:00Z"), at("2026-07-10T10:00:00Z")],
    });
    expect(snap.todayCount).toBe(0);
    expect(snap.streak).toBe(2); // 11th and 12th met, 10th only 1/2
    expect(snap.daysMetLast7).toBe(2);
    expect(snap.last7.at(-1)?.key).toBe("2026-07-13");
  });

  it("includes today once it's met, per account", () => {
    const snap = computeGoalSnapshot({
      timezone: "UTC",
      dailyGoal: 1,
      now,
      posts: [at("2026-07-13T08:00:00Z"), at("2026-07-12T08:00:00Z")],
    });
    expect(snap.streak).toBe(2);
    expect(snap.todayByAccount.get("a")).toBe(1);
  });

  it("no goal → no streak", () => {
    expect(computeGoalSnapshot({ timezone: "UTC", dailyGoal: 0, now, posts: [at("2026-07-13T08:00:00Z")] }).streak).toBe(0);
  });
});

describe("PayPal statuses", () => {
  it("maps item statuses to payout states", () => {
    expect(mapPayPalItemStatus("SUCCESS").state).toBe("paid");
    expect(mapPayPalItemStatus("UNCLAIMED").state).toBe("processing");
    expect(mapPayPalItemStatus("PENDING").state).toBe("processing");
    expect(mapPayPalItemStatus("RETURNED").state).toBe("failed");
    expect(mapPayPalItemStatus("BLOCKED").state).toBe("failed");
  });
});

describe("settings", () => {
  it("parses reminder hours", () => {
    expect(parseReminderHours("21, 12,18,18, 25, x")).toEqual([12, 18, 21]);
  });
});
