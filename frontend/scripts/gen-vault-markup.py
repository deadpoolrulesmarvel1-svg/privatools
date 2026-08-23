"""Emits the vault surface for each skin, in that skin's own idiom.

One template, three vocabularies. Writing three by hand would drift: the panels,
type sizes and icon mechanisms differ per design, but the structure and the
bindings are identical, and it is the bindings that have to stay in step with
withVault.tsx.

    python scripts/gen-vault-markup.py     # appends to src/skins/extensions/<id>.html
"""
import pathlib

SKINS = {
    "aurora": dict(
        wrap='<div style="animation:rise .24s ease both">',
        h1='font-family:Sora,sans-serif;font-size:var(--h2);font-weight:600;letter-spacing:-.02em;margin:0',
        lede='font-size:13.5px;color:var(--text2);margin-top:5px',
        panel='border:1px solid var(--line);border-radius:14px;background:var(--pnl);padding:18px',
        quiet='border:1px solid var(--line);border-radius:14px;background:var(--pnlq);padding:18px',
        grid='display:grid;grid-template-columns:var(--tool-cols);gap:var(--gap);margin-top:18px;align-items:start',
        field='padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg1);color:var(--text);font-size:13px;min-height:44px',
        label='display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text2)',
        primary='height:40px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:var(--em);color:#04120C',
        ghost='height:30px;padding:0 10px;border-radius:8px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--text2);font-size:12px',
        danger='height:30px;padding:0 10px;border-radius:8px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--co);font-size:12px',
        icon=lambda n, extra="": f'<span style="font-family:\'Material Symbols Rounded\';font-size:17px;{extra}">{{{{ {n} }}}}</span>',
        mono="ui-monospace,monospace", heading='font-family:Sora,sans-serif;font-size:14px;font-weight:600',
        small='font-size:11.5px;color:var(--text3);margin-top:10px;line-height:1.5',
        rowline="var(--line)", secret='font-family:ui-monospace,monospace;font-size:12.5px',
    ),
    "carbon": dict(
        wrap='<div style="max-width:1180px;margin:0 auto;padding:22px clamp(16px,3vw,34px) 0">',
        h1='margin:0;font-size:clamp(26px,3vw,38px);font-weight:800;letter-spacing:-.025em',
        lede='margin:9px 0 0;font-size:14px;color:var(--pt-txt2,#9FB3B8)',
        panel='padding:18px;border-radius:16px;border:1px solid var(--pt-line,rgba(255,255,255,.085));background:var(--pt-panel,rgba(13,23,29,.62));backdrop-filter:blur(18px)',
        quiet='padding:18px;border-radius:16px;border:1px solid var(--pt-line,rgba(255,255,255,.085));background:var(--pt-solid,#0B141A)',
        grid='display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;align-items:start;margin-top:20px',
        field='padding:11px 12px;border-radius:10px;border:1px solid var(--pt-line,rgba(255,255,255,.085));background:var(--pt-solid,#0B141A);color:var(--pt-txt,#E8F1F2);font-size:13px;min-height:44px',
        label='display:grid;gap:6px;font-size:12.5px;color:var(--pt-txt2,#9FB3B8)',
        primary='height:42px;border-radius:11px;border:none;cursor:pointer;font-size:13.5px;font-weight:700;background:linear-gradient(140deg,var(--pt-aqua,#4FE1DE),var(--pt-teal,#26C8BA));color:var(--pt-onAqua,#04191B)',
        ghost='height:32px;padding:0 11px;border-radius:9px;cursor:pointer;border:1px solid var(--pt-line2,rgba(255,255,255,.15));background:transparent;color:var(--pt-txt2,#9FB3B8);font-size:12.5px',
        danger='height:32px;padding:0 11px;border-radius:9px;cursor:pointer;border:1px solid var(--pt-line2,rgba(255,255,255,.15));background:transparent;color:var(--pt-coral,#FF7A6B);font-size:12.5px',
        icon=lambda n, extra="": f'<span class="material-symbols-rounded" style="font-size:18px;{extra}">{{{{ {n} }}}}</span>',
        mono="'IBM Plex Mono',monospace", heading='font-size:14.5px;font-weight:700',
        small='margin:11px 0 0;font-size:12px;line-height:1.55;color:var(--pt-txt3,#6B8085)',
        rowline="var(--pt-line,rgba(255,255,255,.085))", secret='font-family:\'IBM Plex Mono\',monospace;font-size:12.5px',
    ),
    "structured": dict(
        wrap='<div style="max-width:1000px;margin:0 auto;padding:20px 24px 0;animation:slidein 200ms ease both">',
        h1='font-size:clamp(21px,3.6vw,26px);font-weight:600;letter-spacing:-.02em',
        lede='margin-top:3px;font-size:12.5px;color:var(--ink3)',
        panel='flex:2 1 380px;min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px',
        quiet='flex:1 1 260px;min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px',
        grid='display:flex;flex-wrap:wrap;gap:14px;margin-top:16px;align-items:flex-start',
        field='height:38px;padding:0 11px;border-radius:8px;border:1px solid var(--line);background:var(--bg2);color:var(--ink);font-size:13px',
        label='display:grid;gap:4px;font-size:11.5px;color:var(--ink3)',
        primary='height:38px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:var(--em);color:var(--bg)',
        ghost='height:28px;padding:0 10px;border-radius:7px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--ink2);font-size:12px',
        danger='height:28px;padding:0 10px;border-radius:7px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--coral);font-size:12px',
        icon=lambda n, extra="": f'<span class="ms" style="font-size:18px;{extra}">{{{{ {n} }}}}</span>',
        mono="'Geist Mono',monospace", heading='font-size:14px;font-weight:500',
        small='margin-top:9px;font-size:11.5px;line-height:1.5;color:var(--ink3)',
        rowline="var(--line)", secret='font-family:\'Geist Mono\',monospace;font-size:12px',
    ),
}

TEMPLATE = """
<!-- Vault — real AES-GCM under a non-extractable device key (lib/localStore).
     Not the simulated vault the imported design shipped, so the "protection is
     simulated, do not enter real passwords" notice is deliberately absent. -->
<sc-if value="{{{{ isVaultReal }}}}" hint-placeholder-val="{{{{ false }}}}">
{wrap}
  <h1 style="{h1}">Vault</h1>
  <div style="{lede}">Passwords for locked documents, encrypted on this device. {{{{ vltCount }}}} stored.</div>

  <div style="{grid}">
    <div style="{panel}">
      <div style="{heading}">Stored passwords</div>

      <div style="display:{{{{ vltEmptyD }}}};font-size:12.5px;color:var(--x-dim);margin-top:10px">Nothing stored yet. Add a password below and PrivaTools will try it automatically when you open a locked file.</div>
      <div role="status" style="display:{{{{ vltUnreadableD }}}};margin-top:10px;font-size:12px;color:var(--x-danger)">{{{{ vltUnreadable }}}}</div>

      <sc-for list="{{{{ vltEntries }}}}" as="e" hint-placeholder-count="2">
        <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid {rowline}">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:{{{{ e.labelColor }}}}">{{{{ e.label }}}}</div>
            <div style="{secret}">{{{{ e.secret }}}}</div>
            <div style="font-size:11px;color:var(--x-faint);margin-top:2px">{{{{ e.meta }}}}</div>
          </div>
          <button type="button" onClick="{{{{ e.reveal }}}}" aria-label="{{{{ e.revealLabel }}}}" style="{ghost}">{icon_reveal}</button>
          <button type="button" onClick="{{{{ e.copy }}}}" aria-label="Copy password" style="{ghost}">{icon_copy}</button>
          <button type="button" onClick="{{{{ e.remove }}}}" aria-label="Delete password" style="{danger}">{icon_delete}</button>
        </div>
      </sc-for>

      <button type="button" onClick="{{{{ vltClear }}}}" style="display:{{{{ vltClearD }}}};margin-top:14px;{danger}">{{{{ vltClearLabel }}}}</button>
    </div>

    <form onSubmit="{{{{ vltAdd }}}}" style="{quiet}">
      <div style="{heading}">Add a password</div>
      <label style="{label};margin-top:11px">Name
        <input type="text" value="{{{{ vltLabel }}}}" onInput="{{{{ vltSetLabel }}}}" placeholder="e.g. Bank statements" style="{field}" />
      </label>
      <label style="{label};margin-top:9px">Password
        <input type="password" value="{{{{ vltPassword }}}}" onInput="{{{{ vltSetPassword }}}}" autoComplete="off" style="{field}" />
      </label>
      <div role="alert" style="display:{{{{ vltErrD }}}};margin-top:8px;font-size:12px;color:var(--x-danger)">{{{{ vltError }}}}</div>
      <button type="submit" disabled="{{{{ vltBusy }}}}" style="margin-top:11px;width:100%;opacity:{{{{ vltBusyOpacity }}}};{primary}">{{{{ vltAddLabel }}}}</button>
      <p style="{small}">Encrypted with a key this browser generated and cannot export. That means it never leaves this device — and it cannot sync to another one. Clearing site data erases it.</p>
    </form>
  </div>
{wrap_close}
</sc-if>
"""

DIM = {"aurora": "--text2", "carbon": "--pt-txt2", "structured": "--ink2"}
FAINT = {"aurora": "--text3", "carbon": "--pt-txt3", "structured": "--ink3"}
DANGER = {"aurora": "--co", "carbon": "--pt-coral", "structured": "--coral"}

out_dir = pathlib.Path(__file__).resolve().parents[1] / "src/skins/extensions"
for skin, vocab in SKINS.items():
    icon = vocab["icon"]
    block = TEMPLATE.format(
        wrap=vocab["wrap"], wrap_close="</div>",
        h1=vocab["h1"], lede=vocab["lede"], panel=vocab["panel"], quiet=vocab["quiet"],
        grid=vocab["grid"], field=vocab["field"], label=vocab["label"],
        primary=vocab["primary"], ghost=vocab["ghost"], danger=vocab["danger"],
        heading=vocab["heading"], small=vocab["small"], rowline=vocab["rowline"],
        secret=vocab["secret"],
        icon_reveal=icon("e.revealIcon"), icon_copy=icon("'content_copy'"),
        icon_delete=icon("'delete'"),
    )
    # the template's placeholder variables resolve to this skin's own tokens
    block = (block.replace("var(--x-dim)", f"var({DIM[skin]})")
                  .replace("var(--x-faint)", f"var({FAINT[skin]})")
                  .replace("var(--x-danger)", f"var({DANGER[skin]})"))
    path = out_dir / f"{skin}.html"
    existing = path.read_text() if path.exists() else ""
    marker = "<!-- Vault —"
    if marker in existing:
        existing = existing[: existing.index(marker)].rstrip() + "\n"
    path.write_text(existing + block)
    print(f"  {skin}: vault surface written ({len(block):,} chars)")
