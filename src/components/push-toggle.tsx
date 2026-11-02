"use client";

import { Bell, BellOff, Share } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/app/actions";
import { buttonClass, Card, cn } from "./ui";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Turn on reminders: "Post now — 1/2 today, keep your 🔥 5-day streak". */
export function PushToggle({ publicKey, variant = "row" }: { publicKey: string; variant?: "row" | "prompt" }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
      // keep the server copy fresh (keys can rotate)
      if (sub) await savePushSubscriptionAction(sub.toJSON()).catch(() => null);
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () =>
    start(async () => {
      setError(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        await savePushSubscriptionAction(sub.toJSON());
        setState("on");
      } catch {
        setError("Couldn't turn on notifications on this device.");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint).catch(() => null);
        await sub.unsubscribe();
      }
      setState("off");
    });

  if (variant === "prompt") {
    if (state !== "off" && state !== "ios-install") return null;
    return (
      <Card className="mt-4 flex items-start gap-3 border-accent/30 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Bell className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Never miss a posting day</p>
          {state === "ios-install" ? (
            <p className="mt-0.5 text-sm text-muted">
              On iPhone, tap <Share className="inline size-3.5 align-[-2px]" /> then <span className="text-fg">Add to Home Screen</span>, open 22earn from there and turn on reminders.
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-muted">Get a nudge when today&apos;s goal isn&apos;t done yet, and when money is sent.</p>
              <button type="button" onClick={enable} disabled={pending} className={buttonClass("primary", "sm", "mt-3")}>
                Turn on reminders
              </button>
              {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
            </>
          )}
        </div>
      </Card>
    );
  }

  const label: Record<State, string> = {
    loading: "Checking…",
    unsupported: "Not supported in this browser",
    "ios-install": "Add 22earn to your Home Screen first",
    denied: "Blocked — allow notifications in your browser settings",
    off: "Off",
    on: "On for this device",
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {state === "on" ? <Bell className="size-5 text-accent" /> : <BellOff className="size-5 text-muted" />}
        <div className="min-w-0">
          <p className="text-[15px]">Push reminders</p>
          <p className={cn("text-xs", state === "denied" ? "text-danger" : "text-muted")}>{label[state]}</p>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      </div>
      {state === "on" ? (
        <button type="button" onClick={disable} disabled={pending} className={buttonClass("subtle", "sm")}>
          Turn off
        </button>
      ) : state === "off" ? (
        <button type="button" onClick={enable} disabled={pending} className={buttonClass("primary", "sm")}>
          Turn on
        </button>
      ) : null}
    </div>
  );
}
