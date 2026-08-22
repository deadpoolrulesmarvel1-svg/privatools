/* eslint-disable */
// @ts-nocheck
/**
 * Obsidian Aurora — extension.
 *
 * Subclasses the generated component rather than editing it. `SkinApp.tsx` is
 * regenerated from design-sources/aurora.dc.html by scripts/build-skin-app.mjs,
 * so anything written into that file is destroyed on the next run; a subclass
 * survives, and the markup this drives is spliced in at generation time from
 * the sibling `aurora.html`.
 *
 * The design's own logic is untouched. `renderVals()` is extended, never
 * replaced: everything the imported markup reads keeps working exactly as
 * before, and the extra bindings sit alongside.
 */
import Base from "../aurora/SkinApp";
import {
    accountApi, describeKey, defaultKeyLabel, initialAccountState,
} from "../accountLogic";

const ROUTE = "#/account";

export default class AuroraWithAccounts extends Base {
    constructor(props) {
        super(props);
        this.state = { ...this.state, acct: { ...initialAccountState } };
        this._onAcctHash = () => this.forceUpdate();
    }

    componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        window.addEventListener("hashchange", this._onAcctHash);
        // Establishes whether there is already a session, so the account route
        // opens in the right state rather than flashing the signed-out form.
        accountApi.me()
            .then(({ user }) => { this._setAcct({ user }); this._loadKeys(); })
            .catch(() => { /* signed out is the normal case */ });
    }

    componentWillUnmount() {
        if (super.componentWillUnmount) super.componentWillUnmount();
        window.removeEventListener("hashchange", this._onAcctHash);
    }

    _setAcct(patch) {
        this.setState((s) => ({ acct: { ...s.acct, ...patch } }));
    }

    _loadKeys() {
        accountApi.listKeys()
            .then(({ keys }) => this._setAcct({ keys }))
            .catch(() => { /* listing is best-effort; the form still works */ });
    }

    _submit = (event) => {
        event.preventDefault();
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

    _newKey = () => {
        const { keys } = this.state.acct;
        accountApi.createKey(defaultKeyLabel(keys))
            .then(({ key, record }) =>
                this._setAcct({ freshKey: key, keys: [record, ...keys] }))
            .catch((err) => this._setAcct({ error: err.message }));
    };

    _revoke = (keyId) => {
        accountApi.revokeKey(keyId)
            .then(() => this._loadKeys())
            .catch((err) => this._setAcct({ error: err.message }));
    };

    _signOut = () => {
        accountApi.logout()
            .then(() => this._setAcct({ ...initialAccountState }))
            .catch(() => this._setAcct({ ...initialAccountState }));
    };

    _delete = () => {
        if (!this.state.acct.confirmingDelete) {
            this._setAcct({ confirmingDelete: true });
            return;
        }
        accountApi.deleteAccount()
            .then(() => this._setAcct({ ...initialAccountState }))
            .catch((err) => this._setAcct({ error: err.message, confirmingDelete: false }));
    };

    /**
     * The design's router does not know this route, so its own titleFor()
     * returns the 404 title while the account page is on screen.
     */
    titleFor(route, param) {
        if (typeof location !== "undefined" && location.hash === ROUTE) {
            return (this.state.acct.user ? "Account" : "Sign in") + " — PrivaTools";
        }
        return super.titleFor(route, param);
    }

    renderVals() {
        const v = super.renderVals();
        const a = this.state.acct;
        const active = (typeof location !== "undefined" ? location.hash : "") === ROUTE;
        const signedIn = Boolean(a.user);

        const navItem = {
            label: signedIn ? "Account" : "Sign in",
            icon: signedIn ? "account_circle" : "login",
            onClick: (e) => { if (e && e.preventDefault) e.preventDefault(); location.hash = ROUTE; },
            bg: active ? "var(--emsoft)" : "transparent",
            fg: active ? "var(--text)" : "var(--text2)",
            bd: active ? "var(--line2)" : "transparent",
            badgeD: "none",
            badge: "",
        };

        return {
            ...v,
            // The design's router does not know this route and would otherwise
            // render its own 404 underneath ours.
            is404: active ? false : v.is404,
            navSys: [...(v.navSys ?? []), navItem],

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
            acctSubmit: this._submit,
            acctBusy: a.busy,
            acctBusyOpacity: a.busy ? ".6" : "1",
            acctSubmitLabel: a.busy
                ? "Working…"
                : (a.mode === "signup" ? "Create account" : "Sign in"),
            acctPwAutocomplete: a.mode === "signup" ? "new-password" : "current-password",
            acctHintD: a.mode === "signup" ? "block" : "none",
            acctError: a.error,
            acctErrD: a.error ? "block" : "none",

            acctShowSignIn: () => this._setAcct({ mode: "signin", error: "" }),
            acctShowSignUp: () => this._setAcct({ mode: "signup", error: "" }),
            acctSignInBd: a.mode === "signin" ? "var(--em)" : "var(--line)",
            acctSignInBg: a.mode === "signin" ? "var(--emsoft)" : "transparent",
            acctSignInFg: a.mode === "signin" ? "var(--em)" : "var(--text2)",
            acctSignUpBd: a.mode === "signup" ? "var(--em)" : "var(--line)",
            acctSignUpBg: a.mode === "signup" ? "var(--emsoft)" : "transparent",
            acctSignUpFg: a.mode === "signup" ? "var(--em)" : "var(--text2)",

            acctEmailShown: a.user ? a.user.email : "",
            acctSignOut: this._signOut,
            acctDelete: this._delete,
            acctDeleteLabel: a.confirmingDelete ? "Press again to delete for good" : "Delete account",

            acctNewKey: this._newKey,
            acctNewKeyValue: a.freshKey,
            acctNewKeyD: a.freshKey ? "block" : "none",
            acctNoKeysD: a.keys.length === 0 ? "block" : "none",
            acctKeys: a.keys.map((k) => ({
                label: k.label,
                labelColor: k.revoked ? "var(--text3)" : "var(--text)",
                meta: describeKey(k),
                revoked: k.revoked,
                revokeD: k.revoked ? "none" : "inline-flex",
                revoke: () => this._revoke(k.key_id),
            })),
        };
    }
}
