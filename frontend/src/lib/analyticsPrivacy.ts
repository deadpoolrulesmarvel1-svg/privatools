export const ANALYTICS_OPT_OUT_KEY = "pt-analytics-opt-out";
export const GOOGLE_ANALYTICS_ID = "G-B3VWQ44MX1";

type PrivacyNavigator = Navigator & {
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string | null;
};

type AnalyticsWindow = Window & typeof globalThis & {
  doNotTrack?: string | null;
  ptSetAnalyticsDisabled?: (disabled: boolean) => void;
};

export interface AnalyticsPrivacyPreference {
  localOptOut: boolean;
  browserPrivacySignal: boolean;
  effectiveDisabled: boolean;
}

function readOptOutStorage(): boolean {
  try {
    return window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasBrowserAnalyticsPrivacySignal(): boolean {
  if (typeof window === "undefined") return true;
  const nav = window.navigator as PrivacyNavigator;
  const win = window as AnalyticsWindow;
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? win.doNotTrack;

  return nav.globalPrivacyControl === true || dnt === "1" || dnt === "yes";
}

export function readAnalyticsPrivacyPreference(): AnalyticsPrivacyPreference {
  if (typeof window === "undefined") {
    return { localOptOut: false, browserPrivacySignal: true, effectiveDisabled: true };
  }

  const localOptOut = readOptOutStorage();
  const browserPrivacySignal = hasBrowserAnalyticsPrivacySignal();

  return {
    localOptOut,
    browserPrivacySignal,
    effectiveDisabled: localOptOut || browserPrivacySignal,
  };
}

export function setAnalyticsOptOut(optOut: boolean): AnalyticsPrivacyPreference {
  if (typeof window === "undefined") {
    return { localOptOut: optOut, browserPrivacySignal: true, effectiveDisabled: true };
  }

  try {
    if (optOut) window.localStorage.setItem(ANALYTICS_OPT_OUT_KEY, "1");
    else window.localStorage.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // localStorage can throw in private browsing or when storage is disabled.
  }

  const next = readAnalyticsPrivacyPreference();
  const win = window as AnalyticsWindow & Record<string, boolean>;
  win[`ga-disable-${GOOGLE_ANALYTICS_ID}`] = next.effectiveDisabled;
  win.ptSetAnalyticsDisabled?.(next.effectiveDisabled);

  return next;
}
