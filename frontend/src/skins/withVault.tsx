/* eslint-disable */
// @ts-nocheck
/**
 * The device-local password vault, as a mixin over a generated skin component.
 *
 * Composes with withAccounts — each wraps the previous class and extends
 * renderVals() rather than replacing it, so ordering does not matter and both
 * sets of bindings survive.
 *
 * This drives the *real* vault (lib/localStore/vault): AES-GCM under a
 * non-extractable key. The imported designs all ship a simulated one backed by
 * plain localStorage, complete with a "do not enter real passwords" notice —
 * that notice is not reproduced here, because it would no longer be true.
 */
import { vaultApi, describeEntry, initialVaultState } from "./vaultLogic";

export function withVault(Base, config) {
    return class WithVault extends Base {
        constructor(props) {
            super(props);
            this.state = { ...this.state, vlt: { ...initialVaultState } };
            this._onVaultNav = () => this.forceUpdate();
        }

        componentDidMount() {
            if (super.componentDidMount) super.componentDidMount();
            window.addEventListener("hashchange", this._onVaultNav);
            window.addEventListener("popstate", this._onVaultNav);
            this._loadVault();
        }

        componentWillUnmount() {
            if (super.componentWillUnmount) super.componentWillUnmount();
            window.removeEventListener("hashchange", this._onVaultNav);
            window.removeEventListener("popstate", this._onVaultNav);
        }

        _setVault(patch) {
            this.setState((s) => ({ vlt: { ...s.vlt, ...patch } }));
        }

        _loadVault() {
            vaultApi.load()
                .then(({ entries, unreadable }) => this._setVault({ entries, unreadable }))
                .catch((err) => this._setVault({ error: err.message }));
        }

        _vaultAdd = (event) => {
            if (event && event.preventDefault) event.preventDefault();
            const { label, password } = this.state.vlt;
            if (!label.trim()) { this._setVault({ error: "Give it a name so you can find it again." }); return; }
            if (!password) { this._setVault({ error: "Enter the password to store." }); return; }
            this._setVault({ busy: true, error: "" });
            vaultApi.add(label.trim(), password)
                .then(() => { this._setVault({ busy: false, label: "", password: "" }); this._loadVault(); })
                .catch((err) => this._setVault({ busy: false, error: err.message }));
        };

        _vaultReveal = (id) => {
            if (this.state.vlt.revealedId === id) {
                this._setVault({ revealedId: "", revealedValue: "" });
                return;
            }
            vaultApi.reveal(id)
                .then((value) => this._setVault({ revealedId: id, revealedValue: value }))
                .catch((err) => this._setVault({ error: err.message }));
        };

        _vaultCopy = (id) => {
            vaultApi.reveal(id)
                .then((value) => navigator.clipboard.writeText(value))
                .catch((err) => this._setVault({ error: err.message }));
        };

        _vaultDelete = (id) => {
            vaultApi.remove(id)
                .then(() => { this._setVault({ revealedId: "", revealedValue: "" }); this._loadVault(); })
                .catch((err) => this._setVault({ error: err.message }));
        };

        _vaultClear = () => {
            if (!this.state.vlt.confirmingClear) { this._setVault({ confirmingClear: true }); return; }
            vaultApi.clear()
                .then(() => { this._setVault({ ...initialVaultState }); this._loadVault(); })
                .catch((err) => this._setVault({ error: err.message, confirmingClear: false }));
        };

        _vaultGo = (e) => { if (e && e.preventDefault) e.preventDefault(); config.navigate(); };

        _vaultTitle() { return "Vault — PrivaTools"; }

        titleFor(route, param) {
            if (config.isActive()) return this._vaultTitle();
            return super.titleFor ? super.titleFor(route, param) : document.title;
        }

        setTitle(route, sub) {
            if (config.isActive()) {
                try { document.title = this._vaultTitle(); } catch (e) { /* SSR */ }
                return;
            }
            if (super.setTitle) super.setTitle(route, sub);
        }

        renderVals() {
            const v = super.renderVals();
            const s = this.state.vlt;
            const active = config.isActive();
            const p = config.palette;

            const item = config.navItem({
                label: "Vault", icon: "lock", onClick: this._vaultGo, active,
            });
            const nav = config.injectNav
                ? config.injectNav(v, item)
                : { [config.navKey]: [...(v[config.navKey] ?? []), item] };

            return {
                ...v,
                ...nav,
                ...(active
                    ? Object.fromEntries((config.suppressFlags ?? ["is404"]).map((f) => [f, false]))
                    : {}),

                isVaultReal: active,
                vltCount: String(s.entries.length),
                vltEmptyD: s.entries.length === 0 ? "block" : "none",
                vltUnreadableD: s.unreadable > 0 ? "block" : "none",
                vltUnreadable: s.unreadable
                    ? `${s.unreadable} entr${s.unreadable === 1 ? "y" : "ies"} cannot be read with this browser's key.`
                    : "",

                vltLabel: s.label,
                vltPassword: s.password,
                vltSetLabel: (e) => this._setVault({ label: e.target.value, error: "" }),
                vltSetPassword: (e) => this._setVault({ password: e.target.value, error: "" }),
                vltAdd: this._vaultAdd,
                vltBusy: s.busy,
                vltBusyOpacity: s.busy ? ".6" : "1",
                vltAddLabel: s.busy ? "Saving…" : "Save password",
                vltError: s.error,
                vltErrD: s.error ? "block" : "none",

                vltClear: this._vaultClear,
                // Hidden while the vault is empty — there is nothing to erase,
                // and a destructive control with no target is just noise.
                vltClearD: s.entries.length ? "inline-flex" : "none",
                vltClearLabel: s.confirmingClear ? "Press again to erase every entry" : "Erase the vault",

                vltEntries: s.entries.map((row) => {
                    const shown = s.revealedId === row.id;
                    return {
                        label: row.label,
                        labelColor: p.text,
                        meta: describeEntry(row),
                        secret: shown ? s.revealedValue : "••••••••••••",
                        secretColor: shown ? p.text : p.faint,
                        revealIcon: shown ? "visibility_off" : "visibility",
                        revealLabel: (shown ? "Hide" : "Reveal") + " password for " + row.label,
                        reveal: () => this._vaultReveal(row.id),
                        copy: () => this._vaultCopy(row.id),
                        remove: () => this._vaultDelete(row.id),
                    };
                }),
            };
        }
    };
}
