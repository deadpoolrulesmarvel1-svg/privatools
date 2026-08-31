import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/skin-fonts.css";
import "./styles/skins.css";
import { registerServiceWorker } from "./lib/sw-register";

/**
 * Clerk is opt-in, and neither mounted nor downloaded without a key.
 *
 * `clerk init` wrapped <App /> in ClerkProvider unconditionally, which would
 * take the whole site down for anyone building without Clerk keys: the provider
 * throws on a missing publishable key and sits above every route. Wrong blast
 * radius for a feature the site itself calls optional — the README advertises
 * `docker compose up --build` with no configuration, and every one of the 219
 * tools works signed out.
 *
 * The import is lazy for a second reason. Statically imported, @clerk/react put
 * 124K into the entry chunk — more than doubling it, 108K to 232K — which every
 * visitor to every tool page paid for whether or not the deployment had an
 * identity provider at all. Behind `lazy` it is a separate chunk that a
 * key-less build never requests.
 *
 * The Suspense fallback is null rather than <App />, which would mount the app
 * twice and throw its state away on the swap. Only deployments that configure
 * Clerk take this path, and index.html's pre-paint shell is still on screen
 * while the chunk arrives.
 */
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
    | string
    | undefined;

const ClerkGate = clerkPublishableKey
    ? lazy(() => import("./lib/clerk/ClerkGate"))
    : null;

createRoot(document.getElementById("root")!).render(
    ClerkGate ? (
        <Suspense fallback={null}>
            <ClerkGate publishableKey={clerkPublishableKey!}>
                <App />
            </ClerkGate>
        </Suspense>
    ) : (
        <App />
    ),
);

// Production-only — see sw-register.ts.
registerServiceWorker();
