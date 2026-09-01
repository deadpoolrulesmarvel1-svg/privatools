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
import { mergeNavItem } from "./navInject";
import {
    accountApi, describeKey, defaultKeyLabel, downloadRecoveryCode, initialAccountState,
    MIN_PASSWORD_LENGTH, ACCOUNT_COPY, EMAIL_RESET,
} from "./accountLogic";
import { CLERK_BLOCKED_MESSAGE, clerkLoadFailed, whenClerkReady } from "@/lib/clerk/instance";
import { SSO_RETURN } from "@/lib/clerk/accountApi";

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
            this._onAcctNav = () => { this._ensureAccountPath(); this.forceUpdate(); };
        }

        componentDidMount() {
            if (super.componentDidMount) super.componentDidMount();
            window.addEventListener("hashchange", this._onAcctNav);
            window.addEventListener("popstate", this._onAcctNav);
            window.addEventListener("privatools:clerk-blocked", this._onClerkBlocked);
            this._ensureAccountPath();
            // The block usually happens before this route is even opened, so
            // check the flag as well as listening for the event.
            if (clerkLoadFailed()) this._onClerkBlocked();
            this._bootAccount();
        }

        componentWillUnmount() {
            if (super.componentWillUnmount) super.componentWillUnmount();
            window.removeEventListener("hashchange", this._onAcctNav);
            window.removeEventListener("popstate", this._onAcctNav);
            window.removeEventListener("privatools:clerk-blocked", this._onClerkBlocked);
        }

        /**
         * Put the account view on the /account *path*, never a hash of some
         * other page.
         *
         * The CSP that lets clerk-js load is scoped per path, and a hash never
         * reaches the server — so `/#/account` and `/tool/x#/account` are served
         * the homepage's and the tool's policies, which do not name Clerk, and
         * sign-in dies with "Failed to load Clerk JS". Only a real navigation
         * gets the right headers, so any hash that lands here is turned into
         * one. `replace`, not `assign`: the broken URL should not sit in the
         * back button.
         */
        /**
         * Settle who is signed in, once Clerk can actually answer.
         *
         * Two things had to move here. Clerk is parked from an effect, so
         * calling `me()` straight out of componentDidMount could beat it and
         * report a signed-in visitor as signed out, permanently. And a visitor
         * coming back from GitHub arrives with the handshake half-finished:
         * it completes only if this page asks it to.
         */
        _bootAccount = async () => {
            if (EMAIL_RESET) {
                const clerk = await whenClerkReady();
                if (!clerk) {
                    if (clerkLoadFailed()) this._onClerkBlocked();
                    return;
                }
                // Only on the leg back from the provider, which signInWithSocial
                // marks explicitly. Clerk's own resources cannot be used to
                // detect this: an untouched signIn already reads
                // "needs_identifier", so a truthiness check runs the callback
                // on every ordinary visit to the page.
                const returning = new URLSearchParams(location.search).has(SSO_RETURN);
                // `session` settles before `user` does, and running the
                // callback against a finished flow is what bounces the visitor
                // to the hosted portal. Check both.
                const alreadyIn = Boolean(clerk.user || clerk.session);
                if (returning && !alreadyIn) {
                    try {
                        await accountApi.completeSocialRedirect();
                        // Clerk leaves its bookkeeping in the address bar.
                        history.replaceState(null, "", location.pathname + location.hash);
                    } catch (err) {
                        this._setAcct({ busy: false, error: err.message });
                    }
                }
            }
            accountApi.me()
                .then(({ user }) => { this._setAcct({ user }); this._loadKeys(); })
                .catch(() => { /* signed out is the normal case */ });
        };

        _ensureAccountPath = () => {
            if (typeof location === "undefined") return;
            const m = /^#\/account(\/keys)?\/?$/.exec(location.hash || "");
            if (!m) return;
            if (location.pathname.replace(/\/+$/, "") === "/account") return;
            location.replace(m[1] ? "/account/keys" : "/account");
        };

        _onClerkBlocked = () => {
            this._setAcct({ busy: false, blocked: true, error: CLERK_BLOCKED_MESSAGE });
        };

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
            // One form, three modes. Recover takes a different endpoint and a
            // different field, so it branches here rather than duplicating the
            // whole form in each design's markup.
            if (mode === "recover") return this._acctRecover(null);
            this._setAcct({ busy: true, error: "" });
            const request = mode === "signup"
                ? accountApi.register(email, password)
                : accountApi.login(email, password);
            request
                .then((res) => {
                    // Clerk can stop half way and email a code. Local auth never
                    // did, so `user` would be null here and the form would
                    // silently reappear as though nothing had happened.
                    if (res.status === "needs_email_code") {
                        // Password deliberately kept: the designs mark that
                        // input `required`, so clearing it fails HTML5
                        // validation and the submit button goes dead with
                        // nothing on screen to say why.
                        this._setAcct({
                            busy: false, error: "",
                            needsEmailCode: true, emailCode: "",
                        });
                        return;
                    }
                    // Signup answers with the recovery code, and it is answered
                    // exactly once. There is no reset email, so dropping it here
                    // — which is what this used to do — left the account with no
                    // way back in at all. Clerk sends "" and the panel that
                    // renders it is already conditional, so it just does not show.
                    this._setAcct({
                        user: res.user, busy: false, password: "", error: "",
                        recoveryCode: res.recovery_code ?? "", recoverySaved: false,
                    });
                    this._loadKeys();
                })
                .catch((err) => this._setAcct({ busy: false, error: err.message }));
        };

        /** Finish a Clerk sign-up with the code it emailed. */
        _acctVerifyEmail = (event) => {
            if (event && event.preventDefault) event.preventDefault();
            const code = (this.state.acct.emailCode || "").trim();
            if (!code) return;
            this._setAcct({ busy: true, error: "" });
            accountApi.verifyEmailCode(code)
                .then(({ user }) => {
                    this._setAcct({
                        user, busy: false, error: "", needsEmailCode: false,
                        emailCode: "", recoveryCode: "", recoverySaved: false,
                        password: "",
                    });
                    this._loadKeys();
                })
                .catch((err) => this._setAcct({ busy: false, error: err.message }));
        };

        /**
         * Reset a password. Two very different flows behind one submit:
         *
         * - Local auth: one call with the recovery code issued at signup.
         * - Clerk: stage one emails a code, stage two redeems it. Clerk has no
         *   `recover` — calling it would throw — so the branch is not cosmetic.
         *   `finishPasswordReset` activates the session, so success here IS a
         *   sign-in, not a return to the form.
         */
        _acctRecover = (event) => {
            if (event && event.preventDefault) event.preventDefault();
            const { email, recoveryInput, password, resetEmailSent } = this.state.acct;
            this._setAcct({ busy: true, error: "" });
            if (EMAIL_RESET && !resetEmailSent) {
                accountApi.startPasswordReset(email)
                    .then(() => this._setAcct({ busy: false, resetEmailSent: true, error: "" }))
                    .catch((err) => this._setAcct({ busy: false, error: err.message }));
                return;
            }
            if (EMAIL_RESET) {
                accountApi.finishPasswordReset(recoveryInput, password)
                    .then(() => accountApi.me())
                    .then(({ user }) => {
                        this._setAcct({
                            busy: false, password: "", recoveryInput: "", error: "",
                            mode: "signin", resetEmailSent: false, user,
                        });
                        this._loadKeys();
                    })
                    .catch((err) => this._setAcct({ busy: false, error: err.message }));
                return;
            }
            accountApi.recover(email, recoveryInput, password)
                .then(({ recovery_code }) => this._setAcct({
                    busy: false, password: "", recoveryInput: "", error: "",
                    mode: "signin", recoveryCode: recovery_code, recoverySaved: false,
                }))
                .catch((err) => this._setAcct({ busy: false, error: err.message }));
        };

        _acctCopyRecovery = () => {
            const code = this.state.acct.recoveryCode;
            if (!code || !navigator.clipboard) return;
            navigator.clipboard.writeText(code)
                .then(() => this._setAcct({ recoverySaved: true }))
                .catch(() => { /* the code is on screen either way */ });
        };

        /** Dismiss the panel. Only reachable once the code has been shown. */
        _acctAckRecovery = () => this._setAcct({ recoveryCode: "", recoverySaved: true });

        _acctDownloadRecovery = () => {
            const { recoveryCode, user } = this.state.acct;
            if (!recoveryCode) return;
            downloadRecoveryCode(recoveryCode, user ? user.email : "");
            this._setAcct({ recoverySaved: true });
        };

        /** Open and close the "replace my code" form. */
        _acctToggleRotate = () => this._setAcct({
            rotating: !this.state.acct.rotating, rotatePassword: "", error: "",
        });
        _acctSetRotatePassword = (e) => this._setAcct({ rotatePassword: e.target.value, error: "" });

        /** Mint a fresh code for someone already signed in. */
        _acctRotate = (event) => {
            if (event && event.preventDefault) event.preventDefault();
            const { rotatePassword } = this.state.acct;
            this._setAcct({ busy: true, error: "" });
            accountApi.rotateRecovery(rotatePassword)
                .then(({ recovery_code }) => this._setAcct({
                    busy: false, rotating: false, rotatePassword: "", error: "",
                    recoveryCode: recovery_code, recoverySaved: false,
                }))
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

        // Social sign-in. accountApi.signInWithSocial redirects the tab to the
        // provider when Clerk is configured, and rejects with a plain message
        // on the local-auth build — where SOCIAL_SIGN_IN is empty and no skin
        // renders the buttons in the first place.
        _acctSocial = (provider) => {
            this._setAcct({ busy: true, error: "" });
            accountApi.signInWithSocial(provider)
                .catch((err) => this._setAcct({ busy: false, error: err.message }));
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
                : { [config.navKey]: mergeNavItem(v[config.navKey] ?? [], item) };

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
                acctTitle: signedIn ? "Account" : (
                    a.mode === "signup" ? "Create an account"
                        : a.mode === "recover" ? "Reset your password" : "Sign in"),
                acctLede: signedIn
                    ? "Manage the API keys issued to this account."
                    : "Only needed for the developer API. Every tool works without one.",

                acctSignedOut: !signedIn,
                acctSignedIn: signedIn,

                acctEmail: a.email,
                acctPassword: a.password,
                acctSetEmail: (e) => this._setAcct({ email: e.target.value, error: "" }),
                acctSetPassword: (e) => this._setAcct({ password: e.target.value, error: "" }),
                acctSubmit: a.needsEmailCode ? this._acctVerifyEmail : this._acctSubmit,
                acctBusy: a.busy,
                acctBusyOpacity: a.busy ? ".6" : "1",
                acctSubmitLabel: a.busy ? "Working…" : (
                    a.needsEmailCode ? "Verify email"
                        : a.mode === "signup" ? "Create account"
                            : a.mode === "recover" ? "Reset password" : "Sign in"),
                acctPasswordLabel: a.mode === "recover" ? "New password" : "Password",
                acctPwAutocomplete: a.mode === "signin" ? "current-password" : "new-password",
                acctHintD: (a.mode === "signup" && !a.needsEmailCode) ? "block" : "none",
                acctPasswordHint: `At least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password strong.`,
                acctCopyStorage: ACCOUNT_COPY.storage,
                acctCopyRecovery: ACCOUNT_COPY.recovery,
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

                // The code is shown once, and the panel deliberately stands in
                // front of everything else until it is acknowledged — a code
                // scrolled past is an account that will eventually be lost.
                acctRecoveryCode: a.recoveryCode,
                acctRecoveryD: a.recoveryCode ? "block" : "none",
                acctBodyD: a.recoveryCode ? "none" : "block",
                acctCopyRecovery: this._acctCopyRecovery,
                acctCopyLabel: a.recoverySaved ? "Copied" : "Copy",
                acctAckRecovery: this._acctAckRecovery,
                acctDownloadRecovery: this._acctDownloadRecovery,

                // Replacing a mislaid code, from inside a signed-in session.
                acctRotating: a.rotating,
                acctRotateFormD: a.rotating ? "block" : "none",
                acctRotateOpenD: a.rotating ? "none" : "block",
                acctToggleRotate: this._acctToggleRotate,
                acctRotatePassword: a.rotatePassword,
                acctSetRotatePassword: this._acctSetRotatePassword,
                acctRotateSubmit: this._acctRotate,
                acctRotateLabel: a.busy ? "Working…" : "Generate",
                acctRecoveryNudgeD: a.recoverySaved ? "none" : "block",

                // The email-code step reuses the recovery-code input rather than
                // adding a field. The skins' markup comes from their design
                // sources and cannot grow one, but this input is already the
                // right shape — a short code, one-time-code autocomplete, in
                // the same form — so it is retargeted instead of duplicated.
                acctRecoverD: (a.mode === "recover" || a.needsEmailCode) ? "block" : "none",
                acctCredsD: a.mode === "recover" ? "none" : "block",
                acctCodeLabel: a.needsEmailCode ? "Emailed code" : "Recovery code",
                acctRecoveryInput: a.needsEmailCode ? a.emailCode : a.recoveryInput,
                acctSetRecoveryInput: (e) => this._setAcct(
                    a.needsEmailCode
                        ? { emailCode: e.target.value, error: "" }
                        : { recoveryInput: e.target.value, error: "" },
                ),
                acctRecoverSubmit: this._acctRecover,
                acctShowRecover: () => this._setAcct({ mode: "recover", error: "" }),
                acctRecoverLabel: a.busy ? "Working…" : "Reset password",
                acctVerifyEmail: this._acctVerifyEmail,

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
