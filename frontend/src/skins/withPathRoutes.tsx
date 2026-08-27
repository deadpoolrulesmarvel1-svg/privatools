/* eslint-disable */
// @ts-nocheck
/**
 * Make a hash-routed design answer to the URLs the rest of the site uses.
 *
 * Aurora and Carbon route internally on `location.hash` — `#/tool/merge-pdf`.
 * Every URL that reaches them from outside is a path: `/tool/merge-pdf`. The
 * house nav links to paths, the sitemap advertises paths, Google indexes paths,
 * and a shared link is a path. With no hash present, their routers fall through
 * to the default route, so **every tool URL rendered the homepage** — the tool
 * itself was never reachable except by clicking through from inside the app.
 *
 * Their prototypes never hit this: navigation was in-app clicks that set state
 * directly, and a URL was never typed, shared or reloaded. Structured had the
 * same class of problem on its own route table and got `withFixedRouting`;
 * these two were left as they were.
 *
 * The bridge is deliberately one-directional. On load, and on any history
 * navigation, an incoming *path* is translated into the hash the design already
 * understands. Nothing rewrites the design's own hash navigation, because that
 * part works — the bug is only in how the outside world addresses it.
 */

import type React from "react";
import { hashForPath } from "./pathRoutes";

/*
 * Returns `React.ComponentType<any>` rather than letting the class type escape.
 * This mixin is the outermost wrapper, so its type flows straight to the
 * extension's default export and on into SkinAppHost — which is checked. The
 * inner mixins avoid this only by accident: their generated `Base` is already
 * `any`, so their result is too.
 */
export function withPathRoutes(Base: any): React.ComponentType<any> {
    return class WithPathRoutes extends Base {
        componentDidMount() {
            // The base mounts first, without exception. Setting the hash fires
            // `hashchange`, and the design's handler reads state its own
            // componentDidMount initialises — running it earlier threw
            // `ReferenceError: sl is not defined` from inside the generated
            // code, which surfaced as the app's error boundary rather than as
            // anything pointing here.
            if (super.componentDidMount) super.componentDidMount();

            this._syncHashFromPath();
            this._onPathNav = () => this._syncHashFromPath();
            window.addEventListener("popstate", this._onPathNav);
        }

        componentWillUnmount() {
            window.removeEventListener("popstate", this._onPathNav);
            if (super.componentWillUnmount) super.componentWillUnmount();
        }

        /**
         * Tell the design its hash changed, since replaceState will not.
         *
         * HashChangeEvent carries oldURL/newURL, which a design may read
         * instead of location.hash; a plain Event would leave those undefined.
         */
        _announceHashChange(oldURL, newURL) {
            let event;
            try {
                event = new HashChangeEvent("hashchange", { oldURL, newURL });
            } catch {
                event = new Event("hashchange"); // older engines
            }
            window.dispatchEvent(event);
        }

        /**
         * Translate `/tool/merge-pdf` into `#/tool/merge-pdf`.
         *
         * Only when there is no hash already: once the design is navigating
         * itself the hash is authoritative, and overwriting it would fight the
         * user's clicks.
         */
        _syncHashFromPath() {
            try {
                if (window.location.hash && window.location.hash !== "#") return;

                const path = window.location.pathname.replace(/\/+$/, "");
                if (!path || path === "") return;

                const target = hashForPath(path);
                if (!target) return;

                // replaceState, not `location.hash = target`.
                //
                // Assigning to location.hash PUSHES a history entry, so the
                // tool page became its own predecessor: pressing back left the
                // hash empty, this handler put it straight back, and the user
                // never escaped the page they were on. Verified — back from
                // /tool/merge-pdf in Carbon returned to /tool/merge-pdf.
                //
                // replaceState leaves the entry count alone, at the cost of
                // not firing hashchange, so the design is told by hand.
                const oldURL = window.location.href;
                window.history.replaceState(window.history.state, "", target);
                this._announceHashChange(oldURL, window.location.href);
            } catch {
                /* a design that renders is better than one that throws on a URL */
            }
        }

    };
}
