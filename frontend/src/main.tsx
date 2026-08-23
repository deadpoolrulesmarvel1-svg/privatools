import { ClerkProvider } from "@clerk/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/skin-fonts.css";
import "./styles/skins.css";
import "./styles/skin-native.css";
import "./styles/skin-interactions.css";
import "./styles/shells.css";
import { registerServiceWorker } from "./lib/sw-register";

/**
 * Clerk is opt-in, and the provider is mounted only when a key is present.
 *
 * `clerk init` wrapped <App /> unconditionally, which would take the whole
 * site down for anyone building without Clerk keys — ClerkProvider throws on
 * a missing publishable key, and it sits above every route. That is the wrong
 * blast radius for a feature the site itself describes as optional: the README
 * advertises `docker compose up --build` with no configuration, and every one
 * of the 219 tools works signed out.
 *
 * So: no key, no provider, and the app renders exactly as it does today.
 * Accounts are the only thing that goes away.
 */
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
    | string
    | undefined;

createRoot(document.getElementById("root")!).render(
    clerkPublishableKey ? (
        <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
            <App />
        </ClerkProvider>
    ) : (
        <App />
    ),
);

// Production-only — see sw-register.ts.
registerServiceWorker();
