import { useRef, type ReactNode } from 'react';
import { useStickyHeaderClearance } from './useStickyHeaderClearance';
import { ArrowRight, AudioLines, BookOpen, Check, CircleHelp, Code2, Feather, FolderHeart, Grid2X2, Home, Keyboard, Layers, LifeBuoy, LockKeyhole, Moon, Palette, Search, Settings, ShieldCheck, Sparkles, Sun, UserRound, Workflow } from 'lucide-react';
import { useExperience } from '@/lib/experience';
import { PwaControls } from '@/components/pwa/PwaControls';
import { BrandMark } from '@/components/brand/BrandMark';
import { START_TOUR_EVENT, SHOW_SHORTCUTS_EVENT } from '@/lib/events';
import './navigation.css';
import './footer.css';

const navigation = [
  { href:'/', label:'Home', view:'home', icon:Home },
  { href:'/tools', label:'All tools', view:'tools', icon:Grid2X2 },
  { href:'/pipeline', label:'Pipeline', view:'pipeline', icon:Workflow },
  { href:'/batch', label:'Batch', view:'batch', icon:Layers },
  { href:'/my-stuff', label:'My Stuff', view:'mystuff', icon:FolderHeart },
  { href:'/my-stuff/vault', label:'Vault', view:'vault', icon:LockKeyhole },
  { href:'/ai', label:'AI Studio', view:'ai', icon:Sparkles },
  { href:'/trust', label:'Trust center', view:'trust', icon:ShieldCheck },
  { href:'/api', label:'Dev API', view:'api', icon:Code2 },
  { href:'/blog', label:'Guides', view:'blog', icon:BookOpen },
  { href:'/support', label:'Support', view:'support', icon:LifeBuoy },
  { href:'/account/settings', label:'Settings', view:'settings', icon:Settings },
];

export function ExperienceLogo() {
  return <a className="pt-brand" href="/" aria-label="PrivaTools home"><BrandMark className="pt-brand-mark"/><span>PrivaTools<span className="pt-brand-period">.</span></span></a>;
}

export function AppearanceControls({ expanded=false }: {expanded?:boolean}) {
  const {experience,appearance,resolved,setExperience,setAppearance}=useExperience();
  const ThemeIcon=resolved==='light'?Sun:Moon;
  const styles=<div className="pt-style-switch" role="group" aria-label="Website style">
    <button type="button" aria-pressed={experience==='air'} onClick={()=>setExperience('air')}><Feather size={15}/>Air</button>
    <button type="button" aria-pressed={experience==='play'} onClick={()=>setExperience('play')}><AudioLines size={15}/>Play</button>
  </div>;
  const modes=(['light','dark','system'] as const).map(mode=>({mode,label:mode==='system'?'Use device setting':mode==='light'?(experience==='air'?'Morning Mist · Light':'Blush · Light'):(experience==='air'?'Graphite · Dark':'Charcoal · Dark')}));
  if(expanded)return <section className="pt-appearance-panel"><div><Palette size={23}/><h2>Make yourself comfortable</h2><p>Two personalities. Your tools and selected files stay with you.</p></div>{styles}<div className="pt-appearance-options">{modes.map(({mode,label})=><button type="button" key={mode} aria-pressed={appearance===mode} onClick={()=>setAppearance(mode)}><span className={'pt-swatch pt-swatch-'+mode}/>{label}{appearance===mode&&<Check size={17}/>}</button>)}</div></section>;
  return <div className="pt-appearance">{styles}<button type="button" className="pt-icon-button pt-theme-toggle" aria-label={resolved==='dark'?'Switch to light mode':'Switch to dark mode'} title={resolved==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setAppearance(resolved==='dark'?'light':'dark')}><ThemeIcon size={19}/></button></div>;
}

export function ExperienceShell({view,signedIn,onSearch,children}: {view:string;signedIn:boolean;onSearch:()=>void;children:ReactNode}) {
  const {experience}=useExperience();
  const header = useRef<HTMLElement>(null);
  useStickyHeaderClearance(header);
  return <div className="pt-shell pt-studio-shell" data-view={view}>
    <header className="pt-header" ref={header}>
      <ExperienceLogo/>
      <nav className="pt-top-links" aria-label="Primary navigation">
        {[navigation[1], navigation[2], navigation[3], navigation[6], navigation[5], navigation[8], navigation[4]].map(item => <a
          key={item.href} href={item.href}
          data-priority={['tools', 'ai', 'vault', 'api'].includes(item.view) || undefined}
          data-destination={item.view}
          aria-current={(view === item.view || (view === 'tool' && item.view === 'tools')) ? 'page' : undefined}
        ><item.icon size={15}/><span>{item.label}</span></a>)}
      </nav>
      <div className="pt-header-actions">
        <button className="pt-icon-button pt-search-trigger" type="button" onClick={onSearch} aria-label="Search tools"><Search size={19}/><kbd>⌘ K</kbd></button>
        <AppearanceControls/>
        <a className="pt-account-button" href={signedIn ? '/account/settings' : '/account/sign-in?next=/account/settings'} aria-label={signedIn ? 'Account settings' : 'Sign in'} aria-current={view === 'settings' ? 'page' : undefined} title={signedIn ? 'Account settings and security' : 'Sign in'}><span>{signedIn ? 'Account' : 'Sign in'}</span><ArrowRight size={15}/><UserRound className="pt-account-person" size={18}/></a>
      </div>
    </header>
    <main id="dl-main" className="pt-main" tabIndex={-1}>{children}</main>
    <footer className="pt-studio-footer">
      <div className="pt-footer-layout">
        <div className="pt-footer-intro">
          <ExperienceLogo/>
          <p>{experience === 'air' ? 'Space for your files.\nPeace of mind for you.' : 'Make something of\nyour everyday files.'}</p>
        </div>
        <nav className="pt-footer-groups" aria-label="Footer navigation">
          {[
            { id:'workspace', title:'Workspace', links:[['/tools','All tools'],['/pipeline','Pipeline'],['/batch','Batch'],['/ai','AI Studio'],['/my-stuff/vault','Vault'],['/my-stuff','My Stuff'],['/api','Dev API']] },
            { id:'explore', title:'Explore', links:[['/about','About'],['/support','Support'],['/blog','Guides'],['/compare','Compare'],['/account/settings','Account settings']] },
            { id:'trust', title:'Trust', links:[['/trust','Trust center'],['/status','Status'],['/privacy','Privacy'],['/terms','Terms'],['/security','Security'],['https://github.com/ethereaglehq/privatools','Source']] },
          ].map(group => <section className={'pt-footer-group pt-footer-group-'+group.id} aria-labelledby={'footer-'+group.id} key={group.id}>
            <h2 id={'footer-'+group.id}>{group.title}</h2>
            <ul>{group.links.map(([href,label]) => <li key={href}><a className="pt-footer-link" href={href} {...(href.startsWith('https:') ? {target:'_blank',rel:'noreferrer'} : {})}>{label}{href.startsWith('https:') && <span aria-hidden="true">↗</span>}</a></li>)}</ul>
          </section>)}
        </nav>
        <section className="pt-footer-app" aria-labelledby="footer-app-title">
          <div className="pt-footer-app-copy"><h2 id="footer-app-title">Keep your tools close.</h2><p>Add PrivaTools to your home screen.<br/>See what’s available offline.</p></div>
          <div className="pt-footer-app-controls"><PwaControls/></div>
        </section>
      </div>
      <div className="pt-footer-baseline"><span>Free to use. Yours to keep private.</span><div className="pt-footer-help"><button type="button" onClick={()=>window.dispatchEvent(new Event(START_TOUR_EVENT))}><CircleHelp size={14}/>Quick tour</button><button type="button" onClick={()=>window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))}><Keyboard size={14}/>Keyboard shortcuts</button></div></div>
    </footer>
  </div>;
}
