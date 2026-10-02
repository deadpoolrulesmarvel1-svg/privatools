import { useEffect, useRef, useState } from 'react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ArrowRight, Archive, Braces, Check, FileDown, FileImage, FileOutput, FilePlus2, Files, FileText, Film, Folder, Grid2X2, Home, Image, Keyboard, Layers, Menu, Minimize2, Monitor, Moon, Search, ShieldCheck, Sparkles, Star, Sun, CircleHelp, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useFavorites } from '@/hooks/useFavorites';
import type { ThemeChoice } from '@/lib/skinTheme';
import { START_TOUR_EVENT, SHOW_SHORTCUTS_EVENT } from '@/lib/events';
import { navigateTo } from '@/lib/navigation';
import { catalogue, searchTools, toolHref, type ConsumerTool, type RecentTool, toolBySlug } from './catalogue';

export function ConsumerLogo() {
  return <svg viewBox="0 0 32 40" className="cp-logo" fill="none" aria-hidden="true"><path d="M3 1h16l12 12v24a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M19 1v12h12" fill="white" fillOpacity=".35"/><path d="M8 18h16M9 23v10" stroke="var(--cp-logo-line,white)" strokeWidth="2" strokeLinecap="round"/></svg>;
}

export function ToolIcon({ tool, size = 36 }: { tool: ConsumerTool; size?: number }) {
  const Icon = tool.slug === 'merge-pdf' ? Files : /compress|optimiz/.test(tool.slug) ? Minimize2
    : /json|code|hash|sql|yaml/.test(tool.slug) ? Braces : /split|extract/.test(tool.slug) ? FileOutput
    : tool.category === 'image' ? Image : tool.category === 'video-audio' ? Film
    : tool.category === 'archive' ? Archive : tool.category === 'security' ? ShieldCheck
    : tool.category === 'to-pdf' ? FilePlus2 : tool.category === 'from-pdf' ? FileDown
    : tool.category === 'document-office' ? FileText : FileImage;
  return <Icon size={size} strokeWidth={1.5} aria-hidden="true" className={'cp-tool-icon cp-family-' + tool.category} />;
}

export function FavoriteButton({ slug }: { slug: string }) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(slug);
  const name = toolBySlug.get(slug)?.name || 'tool';
  return <button type="button" className={'cp-icon-button cp-favorite' + (active ? ' is-on' : '')}
    aria-label={(active ? 'Unpin ' : 'Pin ') + name} aria-pressed={active} title={(active ? 'Unpin ' : 'Pin ') + name}
    onClick={() => toggle(slug)}><Star size={19} fill={active ? 'currentColor' : 'none'} /></button>;
}

const destinations = [
  ['/tools', 'All tools', 'tools'], ['/pipeline', 'Workflows', 'pipeline'], ['/batch', 'Batch processing', 'batch'],
  ['/my-stuff', 'My Stuff', 'mystuff'], ['/my-stuff/vault', 'Password vault', 'vault'],
  ['/api', 'Developer API', 'api'], ['/account/keys', 'API keys', 'account'], ['/trust', 'Trust center', 'trust'], ['/security', 'Security', 'security'],
  ['/ai', 'AI studio', 'ai'], ['/account/settings', 'Account settings', 'settings'],
  ['/blog', 'Guides', 'blog'], ['/compare', 'Compare tools', 'compare'], ['/status', 'Service status', 'status'],
  ['/about', 'About PrivaTools', 'about'], ['/support', 'Support', 'support'],
];

export function ConsumerHeader({ view, theme, onTheme, onSearch, onAi, onInstall, signedIn }: {
  view: string; theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void; onSearch: () => void;
  onAi: () => void; onInstall: () => void; signedIn: boolean;
}) {
  const ThemeIcon = theme === 'light' ? Sun : theme === 'system' ? Monitor : Moon;
  return <header className="cp-header">
    <div className="cp-nav">
      <a href="/" className="cp-brand" aria-label="PrivaTools home"><ConsumerLogo/><span>PrivaTools</span></a>
      <nav className="cp-nav-links" aria-label="Main navigation">
        <a href="/tools" aria-current={view === 'tools' ? 'page' : undefined}>Tools</a>
        <a href="/pipeline" aria-current={view === 'pipeline' ? 'page' : undefined}>Workflows</a>
        <a href="/my-stuff" aria-current={view === 'mystuff' ? 'page' : undefined}>My Stuff</a>
      </nav>
      <div className="cp-nav-actions">
        <button className="cp-icon-button cp-header-search" type="button" onClick={onSearch} aria-label="Search tools"><Search size={21}/></button>
        <Dropdown.Root>
          <Dropdown.Trigger className="cp-icon-button" aria-label={'Appearance: ' + theme}><ThemeIcon size={24}/></Dropdown.Trigger>
          <Dropdown.Portal><Dropdown.Content className="cp-menu" align="end" sideOffset={12}>
            <Dropdown.Label className="cp-menu-label">Appearance</Dropdown.Label>
            <Dropdown.RadioGroup value={theme} onValueChange={value => onTheme(value as ThemeChoice)}>
              {(['system','light','dark','midnight'] as ThemeChoice[]).map(value => <Dropdown.RadioItem className="cp-menu-item" key={value} value={value}>
                <span>{value === 'system' ? 'Use device setting' : value === 'midnight' ? 'Midnight' : value[0].toUpperCase()+value.slice(1)}</span>
                <Dropdown.ItemIndicator><Check size={17} aria-hidden="true"/></Dropdown.ItemIndicator>
              </Dropdown.RadioItem>)}
            </Dropdown.RadioGroup>
          </Dropdown.Content></Dropdown.Portal>
        </Dropdown.Root>
        <a href={signedIn ? '/account/settings' : '/account/sign-in?next=/account/settings'} className="cp-account-link" aria-label={signedIn ? 'Account settings' : 'Sign in'} aria-current={view === 'settings' ? 'page' : undefined}><UserRound size={19} aria-hidden="true"/><span>{signedIn ? 'Account' : 'Sign in'}</span></a>
        {!signedIn && <a href="/account?mode=signup" className="cp-button cp-button-outline cp-create-account">Create account</a>}
        <Dropdown.Root>
          <Dropdown.Trigger className="cp-icon-button cp-menu-trigger" aria-label="Open navigation menu"><Menu size={25}/></Dropdown.Trigger>
          <Dropdown.Portal><Dropdown.Content className="cp-menu cp-navigation-menu" align="end" sideOffset={12}>
            {destinations.map(([href,label,key]) => <Dropdown.Item asChild key={href}><a href={href} className="cp-menu-item" aria-current={key === view ? 'page' : undefined}>{label}<ArrowRight size={15}/></a></Dropdown.Item>)}
            <Dropdown.Separator className="cp-menu-separator"/>
            <Dropdown.Item className="cp-menu-item" onSelect={onAi}>AI settings<Sparkles size={16}/></Dropdown.Item>
            <Dropdown.Item className="cp-menu-item" onSelect={onSearch}>Search tools<Search size={16}/></Dropdown.Item>
            <Dropdown.Item className="cp-menu-item" onSelect={onInstall}>Install the app<Layers size={16}/></Dropdown.Item>
            <Dropdown.Item className="cp-menu-item" onSelect={() => window.setTimeout(() => window.dispatchEvent(new Event(START_TOUR_EVENT)), 0)}>Quick tour<CircleHelp size={16}/></Dropdown.Item>
            <Dropdown.Item className="cp-menu-item" onSelect={() => window.setTimeout(() => window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT)), 0)}>Keyboard shortcuts<Keyboard size={16}/></Dropdown.Item>
            <Dropdown.Item asChild><a href={signedIn ? '/account/settings' : '/account/sign-in?next=/account/settings'} className="cp-menu-item">{signedIn ? 'Account settings' : 'Sign in / create account'}<ArrowRight size={15}/></a></Dropdown.Item>
          </Dropdown.Content></Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </div>
  </header>;
}

export function ConsumerTabBar({ view }: { view: string }) {
  return <nav className="cp-tabbar" aria-label="Mobile navigation">
    {[[Home, '/', 'Home', 'home'], [Grid2X2, '/tools', 'Tools', 'tools'], [Folder, '/my-stuff', 'My Stuff', 'mystuff']].map(([Icon, href, label, key]) => {
      const Component = Icon as typeof Home;
      return <a key={String(key)} href={String(href)} aria-current={view === key ? 'page' : undefined}><Component size={25}/><span>{String(label)}</span></a>;
    })}
  </nav>;
}

export function ConsumerSearch({ open, onOpenChange, history }: { open: boolean; onOpenChange: (open: boolean) => void; history: RecentTool[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) { returnFocus.current = document.activeElement as HTMLElement; setQuery(''); setSelected(0); } }, [open]);
  const result = query.trim() ? searchTools(query).slice(0, 9) : history.slice(0, 5).map(item => toolBySlug.get(item.s)).filter((tool): tool is ConsumerTool => Boolean(tool));
  const shown = result.length || query.trim() ? result : searchTools('').slice(0, 7);
  const pages = query.trim() ? destinations.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())).slice(0, 3) : [];
  const items = [...shown.map(tool => ({ name: tool.name, href: toolHref(tool), description: tool.description, tool })), ...pages.map(([href,name]) => ({name,href,description:'Page',tool:null}))];
  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    onOpenChange(false);
    if (item.href.startsWith('/account')) location.assign(item.href);
    else navigateTo(item.href);
  };
  // Say how many results a query found once typing settles; "no match" has its own status line.
  const count = query.trim() && items.length ? `${items.length} result${items.length === 1 ? '' : 's'}` : '';
  const [announced, setAnnounced] = useState('');
  // Closing clears the count, so a reopened dialog never repeats the last search's.
  useEffect(() => {
    if (!open) { setAnnounced(''); return; }
    const timer = window.setTimeout(() => setAnnounced(count), 350);
    return () => window.clearTimeout(timer);
  }, [count, open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="cp-search-dialog" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
    <DialogTitle className="sr-only">Search tools and pages</DialogTitle>
    <DialogDescription className="sr-only">Search by name or task. Use the arrow keys and Enter to open a result.</DialogDescription>
    <div className="cp-search-input"><Search size={23}/><input aria-label="Search tools and pages" autoFocus role="combobox" aria-expanded="true" aria-controls="cp-search-results" aria-activedescendant={items.length ? 'cp-result-'+selected : undefined}
      placeholder={'Search ' + catalogue.length + ' tools or tasks'} value={query}
      onChange={event => {setQuery(event.target.value);setSelected(0);}}
      onKeyDown={event => { if(event.key === 'ArrowDown'){event.preventDefault();setSelected(index => Math.max(0,Math.min(items.length-1,index+1)));}
        if(event.key === 'ArrowUp'){event.preventDefault();setSelected(index => Math.max(0,index-1));}
        if(event.key === 'Enter'){event.preventDefault();choose(selected);} }}/></div>
    <p className="sr-only" role="status" aria-live="polite">{announced}</p>
    <div id="cp-search-results" role="listbox" aria-label="Search results" className="cp-search-results">
      {!items.length && <p className="cp-empty" role="status">No match for “{query}”. Try a file type or a task such as “compress”.</p>}
      {items.map((item,index) => <div id={'cp-result-'+index} key={item.href} role="option" aria-selected={index === selected} className={'cp-search-result' + (index === selected ? ' is-selected' : '')}
        onMouseMove={() => setSelected(index)} onClick={() => choose(index)}>{item.tool ? <ToolIcon tool={item.tool} size={24}/> : <Folder size={24}/>}<span><b>{item.name}</b><small>{item.description}</small></span><ArrowRight size={18}/></div>)}
    </div>
    <div className="cp-search-hint">Arrow keys to navigate · Enter to open · Esc to close</div>
  </DialogContent></Dialog>;
}
