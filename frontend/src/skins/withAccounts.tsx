/* eslint-disable */
// @ts-nocheck
/**
 * Accounts, as a mixin over a generated skin component.
 *
 * The four skins render accounts in four idioms but drive one flow. This holds
 * the flow — state, requests, bindings — and each skin supplies only what is
 * genuinely theme-specific: where its nav items live, what shape they are, and
 * which CSS variables to paint with.
 *
 * It subclasses rather than edits: `src/skins/<id>/SkinApp.tsx` is regenerated
 * from the design source, so a subclass is the only thing that survives.
 * `renderVals()` is extended, never replaced.
 */
import {
    accountApi, describeKey, defaultKeyLabel, initialAccountState,
} from "./accountLogic";

/**
 * @param Base    the generated component
 * @param config  theme specifics:
 *   route        hash or path this surface answers on
 *   isActive()   whether that route is current
 *   navKey       binding name holding the nav list ("navSys", "navMain", …)
 *   navItem()    builds one nav item in this theme's shape
 *   injectNav()  optional — for themes whose nav is grouped rather than flat
 *   palette      CSS variables this theme paints accounts with
 */
export function withAccounts(Base, config) {
    return class WithAccounts extends Base {
        constructor(props) {
            super(props);
            this.state = { ...this.state, acct: { ...initialAccountState } };
            this._onAcctNav = () => this.forceUpdate();
        }

        componentDidMount() {
            if (super.componentDidMount) super.componentDidMount();
            window.addEventListener("hashchange", this._onAcctNav);
            window.addEventListener("popstate", this._onAcctNav);
            // Resolves any existing session before first paint of the route, so
            // it does not flash the signed-out form at someone already signed in.
            accountApi.me()
                .then(({ user }) => { this._setAcct({ user }); this._loadKeys(); })
                .catch(() => { /* signed out is the normal case */ });
        }

        componentWillUnmount() {
            if (super.componentWillUnmount) super.componentWillUnmount();
            window.removeEventListener("hashchange", this._onAcctNav);
            window.removeEventListener("popstate", this._onAcctNav);
        }

        _setAcct(patch) {
            this.setState((s) => ({ acct: { ...s.acct, ...patch } }));
        }

        _loadKeys() {
            accountApi.listKeys()
                .then(({ keys }) => this._setAcct({ keys }))
                .catch(() => { /* best effort; the form still works */ });
        }

        _acctSubmit = (event) => {
            if (event && event.preventDefault) event.preventDefault();
            const { mode, email, password } = this.state.acct;
            this._setAcct({ busy: true, error: "" });
            const request = mode === "signup"
                ? accountApi.register(email, password)
                : accountApi.login(email, password);
            request
                .then(({ user }) => {
                    this._setAcct({ user, busy: false, password: "", error: "" });
                    this._loadKeys();
                })
                .catch((err) => this._setAcct({ busy: false, error: err.message }));
        };

        _acctNewKey = () => {
            const { keys } = this.state.acct;
            accountApi.createKey(defaultKeyLabel(keys))
                .then(({ key, record }) => this._setAcct({ freshKey: key, keys: [record, ...keys] }))
                .catch((err) => this._setAcct({ error: err.message }));
        };

        _acctRevoke = (keyId) => {
            accountApi.revokeKey(keyId)
                .then(() => this._loadKeys())
                .catch((err) => this._setAcct({ error: err.message }));
        };

        _acctSignOut = () => {
            accountApi.logout()
                .then(() => this._setAcct({ ...initialAccountState }))
                .catch(() => this._setAcct({ ...initialAccountState }));
        };

        _acctDelete = () => {
            if (!this.state.acct.confirmingDelete) {
                this._setAcct({ confirmingDelete: true });
                return;
            }
            accountApi.deleteAccount()
                .then(() => this._setAcct({ ...initialAccountState }))
                .catch((err) => this._setAcct({ error: err.message, confirmingDelete: false }));
        };

        _acctGo = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            config.navigate();
        };

        /**
         * The design's router does not know this route and would title it 404.
         *
         * The three designs name this differently — Aurora and Structured have
         * `titleFor(route, param)` returning a string, Carbon has
         * `setTitle(route, sub)` writing document.title itself — so both are
         * covered rather than assuming one shape.
         */
        _acctTitle() {
            return (this.state.acct.user ? "Account" : "Sign in") + " — PrivaTools";
        }

        titleFor(route, param) {
            if (config.isActive()) return this._acctTitle();
            return super.titleFor ? super.titleFor(route, param) : document.title;
        }

        setTitle(route, sub) {
            if (config.isActive()) {
                try { document.title = this._acctTitle(); } catch (e) { /* SSR */ }
                return;
            }
            if (super.setTitle) super.setTitle(route, sub);
        }

        renderVals() {
            const v = super.renderVals();
            const a = this.state.acct;
            const active = config.isActive();
            const signedIn = Boolean(a.user);
            const p = config.palette;

            const item = config.navItem({
                label: signedIn ? "Account" : "Sign in",
                icon: signedIn ? "account_circle" : "login",
                onClick: this._acctGo,
                active,
            });

            const nav = config.injectNav
                ? config.injectNav(v, item)
                : { [config.navKey]: [...(v[config.navKey] ?? []), item] };

            return {
                ...v,
                ...nav,
                // Whatever the theme's own router resolved for this unknown
                // path has to be switched off, or its page renders underneath
                // ours. Usually that is the 404 — but Structured's route table
                // treats "/" as a prefix pattern, so every unmatched path
                // resolves to `home` instead.
                ...(active
                    ? Object.fromEntries((config.suppressFlags ?? ["is404"]).map((f) => [f, false]))
                    : {}),

                isAccount: active,
                acctTitle: signedIn ? "Account" : (a.mode === "signup" ? "Create an account" : "Sign in"),
                acctLede: signedIn
                    ? "Manage the API keys issued to this account."
                    : "Only needed for the developer API. Every tool works without one.",

                acctSignedOut: !signedIn,
                acctSignedIn: signedIn,

                acctEmail: a.email,
                acctPassword: a.password,
                acctSetEmail: (e) => this._setAcct({ email: e.target.value, error: "" }),
                acctSetPassword: (e) => this._setAcct({ password: e.target.value, error: "" }),
                acctSubmit: this._acctSubmit,
                acctBusy: a.busy,
                acctBusyOpacity: a.busy ? ".6" : "1",
                acctSubmitLabel: a.busy ? "Working…" : (a.mode === "signup" ? "Create account" : "Sign in"),
                acctPwAutocomplete: a.mode === "signup" ? "new-password" : "current-password",
                acctHintD: a.mode === "signup" ? "block" : "none",
                acctError: a.error,
                acctErrD: a.error ? "block" : "none",

                acctShowSignIn: () => this._setAcct({ mode: "signin", error: "" }),
                acctShowSignUp: () => this._setAcct({ mode: "signup", error: "" }),
                acctSignInBd: a.mode === "signin" ? p.accent : p.line,
                acctSignInBg: a.mode === "signin" ? p.accentSoft : "transparent",
                acctSignInFg: a.mode === "signin" ? p.accent : p.dim,
                acctSignUpBd: a.mode === "signup" ? p.accent : p.line,
                acctSignUpBg: a.mode === "signup" ? p.accentSoft : "transparent",
                acctSignUpFg: a.mode === "signup" ? p.accent : p.dim,

                acctEmailShown: a.user ? a.user.email : "",
                acctSignOut: this._acctSignOut,
                acctDelete: this._acctDelete,
                acctDeleteLabel: a.confirmingDelete ? "Press again to delete for good" : "Delete account",

                acctNewKey: this._acctNewKey,
                acctNewKeyValue: a.freshKey,
                acctNewKeyD: a.freshKey ? "block" : "none",
                acctNoKeysD: a.keys.length === 0 ? "block" : "none",
                acctKeys: a.keys.map((k) => ({
                    label: k.label,
                    labelColor: k.revoked ? p.faint : p.text,
                    meta: describeKey(k),
                    revoked: k.revoked,
                    revokeD: k.revoked ? "none" : "inline-flex",
                    revoke: () => this._acctRevoke(k.key_id),
                })),
            };
        }
    };
}
