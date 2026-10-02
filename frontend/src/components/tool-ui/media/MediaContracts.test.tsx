import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageWatermarkUI } from '../ImageWatermarkUI';
import { ImageCompressorUI } from '../ImageCompressorUI';
import { RemoveExifUI } from '../RemoveExifUI';
import { FaviconUI } from '../FaviconUI';
import { RemoveImageWatermarkUI, ViewExifUI } from '../MediaInspectors';
import { TrimMediaUI } from "../TrimMediaUI";
import { formatMediaTime, parseMediaTime } from "./media-time";
import { AddSubtitlesUI } from '../VideoToolVariants';
import { uploadFile, postFormData, uploadFileGetJson } from '@/lib/api';
vi.mock('@/lib/api',async load=>({...await load<typeof import('@/lib/api')>(),uploadFile:vi.fn(),postFormData:vi.fn(),uploadFileGetJson:vi.fn(),downloadBlob:vi.fn()}));
vi.mock('@/lib/localStore/defaults',()=>({registerCustomized:vi.fn(),unregisterCustomized:vi.fn()}));
const image=new File(['image bytes'],'garden.jpg',{type:'image/jpeg'});
const pick=(container:HTMLElement,file=image)=>fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[file]}});
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();vi.mocked(uploadFile).mockResolvedValue(new Response(new Blob(['output'],{type:'image/png'})));vi.mocked(postFormData).mockResolvedValue(new Response(new Blob(['output'],{type:'image/jpeg'})));});afterEach(cleanup);
describe('real media form contracts',()=>{
 it('converts the saved 0–255 watermark opacity to the server percentage',async()=>{const{container}=render(<ImageWatermarkUI/>);pick(container);fireEvent.click(screen.getByRole('button',{name:'Watermark images'}));await waitFor(()=>expect(uploadFile).toHaveBeenCalledWith('/image-watermark',image,expect.objectContaining({opacity:55,text:'WATERMARK',position:'center',font_size:40}),undefined));});
 it('limits compression quality to 95',async()=>{const{container}=render(<ImageCompressorUI/>);pick(container);const range=screen.getByRole('slider',{name:/JPEG & WebP quality/});expect(range).toHaveAttribute('max','95');fireEvent.change(range,{target:{value:'95'}});fireEvent.click(screen.getByRole('button',{name:'Compress images'}));await waitFor(()=>expect(uploadFile).toHaveBeenCalledWith('/image-compressor',image,{quality:95},undefined));});
 it('posts EXIF removal files using the required plural field',async()=>{const{container}=render(<RemoveExifUI/>);pick(container);fireEvent.click(screen.getByRole('button',{name:'Remove image metadata'}));await waitFor(()=>expect(postFormData).toHaveBeenCalled());const call=vi.mocked(postFormData).mock.calls[0];expect(call[0]).toBe('/remove-exif');const form=(call[1] as ()=>FormData)();expect(form.get('files')).toBe(image);expect(form.has('file')).toBe(false);});
 it('exposes only the actual favicon sizes and uses the existing endpoint',async()=>{const{container}=render(<FaviconUI/>);pick(container);expect(screen.getByText('16 × 16')).toBeInTheDocument();expect(screen.getByText('32 × 32')).toBeInTheDocument();expect(screen.getByText('48 × 48')).toBeInTheDocument();expect(screen.queryByText('512')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Create the favicon'}));await waitFor(()=>expect(uploadFile).toHaveBeenCalledWith('/generate-favicon',image,{},expect.anything()));});
 it('submits a real region in source image pixels',async()=>{const{container}=render(<RemoveImageWatermarkUI/>);pick(container);const img=screen.getByRole('img',{name:/Select watermark regions/});Object.defineProperties(img,{naturalWidth:{value:720},naturalHeight:{value:480}});fireEvent.load(img);fireEvent.click(screen.getByRole('button',{name:'Add a region'}));fireEvent.change(screen.getByRole('spinbutton',{name:'Region x'}),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'Clean the selected areas'}));await waitFor(()=>expect(uploadFile).toHaveBeenCalledWith('/remove-image-watermark',image,{regions:JSON.stringify([{x:100,y:192,width:144,height:96}]),method:'telea'},expect.anything()));});
 it('shows and searches metadata including location awareness',async()=>{vi.mocked(uploadFileGetJson).mockResolvedValue({format:'JPEG',mode:'RGB',size:[720,480],exif:{Make:'Synthetic camera'},gps:{GPSLatitude:'12.34'},info:{dpi:[72,72]}});const{container}=render(<ViewExifUI/>);pick(container);fireEvent.click(screen.getByRole('button',{name:'Inspect metadata'}));expect(await screen.findByText('Location data found')).toBeInTheDocument();expect(screen.getByText('Synthetic camera')).toBeInTheDocument();fireEvent.change(screen.getByRole('searchbox',{name:'Search metadata'}),{target:{value:'latitude'}});expect(screen.getByText('GPSLatitude')).toBeInTheDocument();expect(screen.queryByText('Synthetic camera')).not.toBeInTheDocument();});
 it('shows unavailable subtitle rendering clearly and preserves the selected files',async()=>{vi.mocked(postFormData).mockRejectedValue(new Error('Subtitle rendering is unavailable on this server. FFmpeg with libass is required.'));const{container}=render(<AddSubtitlesUI/>);const subtitles=new File(['Hello'],'captions.srt',{type:'text/plain'});Object.defineProperty(subtitles,'text',{value:()=>Promise.resolve('Hello')});fireEvent.change(container.querySelector('input[accept=".srt"]')!,{target:{files:[subtitles]}});fireEvent.change(container.querySelector('input[accept*=".mp4"]')!,{target:{files:[new File(['video'],'clip.mp4',{type:'video/mp4'})]}});fireEvent.click(screen.getByRole('button',{name:'Add subtitles'}));expect(await screen.findByRole('alert')).toHaveTextContent('Subtitle rendering is unavailable on this server.');expect(screen.getByRole('button',{name:'Add subtitles'})).toBeEnabled();expect(screen.getByText('captions.srt')).toBeInTheDocument();expect(container.querySelector('video')).toBeInTheDocument();});
 it('does not present an all-failed batch as a successful result',async()=>{vi.mocked(uploadFile).mockRejectedValue(new Error('That file could not be processed.'));const{container}=render(<ImageCompressorUI/>);pick(container);fireEvent.click(screen.getByRole('button',{name:'Compress images'}));expect(await screen.findByRole('heading',{name:'No result was created.'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'This file couldn’t be processed.'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Choose a different file'})).toBeEnabled();expect(screen.queryByRole('button',{name:/Try .*again|Retry/})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/^Download/})).not.toBeInTheDocument();});
 it('offers another attempt only after a failure that can pass',async()=>{vi.mocked(uploadFile).mockRejectedValue(Object.assign(new Error('The server isn’t responding right now. Try again in a moment.'),{__status:503}));const{container}=render(<ImageCompressorUI/>);pick(container);fireEvent.click(screen.getByRole('button',{name:'Compress images'}));expect(await screen.findByRole('heading',{name:'Let’s try that again.'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Try again'})).toBeEnabled();expect(screen.getByRole('button',{name:'Choose a different file'})).toBeEnabled();});
});
describe('the media studio result', () => {
  const twoImages = (container: HTMLElement) => fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [image, new File(['not an image'], 'broken.jpg', { type: 'image/jpeg' })] } });
  const failFor = (name: string, error: Error) => vi.mocked(uploadFile).mockImplementation(async (_endpoint, file) => {
    if ((file as File).name === name) throw error;
    return new Response(new Blob(['output'], { type: 'image/png' }));
  });

  it('says a partial run is partial, with the warning badge, and moves focus to the summary', async () => {
    failFor('broken.jpg', Object.assign(new Error('That image could not be read.'), { __status: 400 }));
    const { container } = render(<ImageCompressorUI />);
    twoImages(container);
    fireEvent.click(screen.getByRole('button', { name: 'Compress images' }));
    expect(await screen.findByRole('heading', { name: '1 of 2 files ready.' })).toBeInTheDocument();
    const summary = screen.getByRole('heading', { level: 3, name: 'Partly finished.' });
    expect(summary).toHaveFocus();
    expect(container.querySelector('.ms-result-summary')).toHaveAttribute('data-tone', 'partial');
    expect(container.querySelector('.ms-result-badge')).not.toBeNull();
    expect(screen.getByText('1 couldn’t be processed; the reason is shown with the file.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your files, finished.' })).toBeNull();
  });

  it('never takes focus from a field the visitor moved to while the run finished', async () => {
    let finish: (response: Response) => void = () => {};
    vi.mocked(uploadFile).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { container } = render(<><input aria-label="Notes" /><ImageCompressorUI /></>);
    pick(container);
    fireEvent.click(screen.getByRole('button', { name: 'Compress images' }));
    const field = screen.getByRole('textbox', { name: 'Notes' });
    field.focus();
    finish(new Response(new Blob(['output'], { type: 'image/png' })));
    expect(await screen.findByRole('heading', { level: 3, name: 'Your files, finished.' })).not.toHaveFocus();
    expect(field).toHaveFocus();
  });

  it('words a passing failure from what went wrong and marks it with the warning triangle', async () => {
    vi.mocked(uploadFile).mockRejectedValue(Object.assign(new Error('The server isn’t responding right now. Try again in a moment.'), { __status: 503 }));
    const { container } = render(<ImageCompressorUI />);
    pick(container);
    fireEvent.click(screen.getByRole('button', { name: 'Compress images' }));
    expect(await screen.findByText('Your files are still here. The server couldn’t finish it.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('The connection or the server got in the way');
    expect(container.querySelector('.ms-result-seal .lucide-triangle-alert, .ms-result-seal .lucide-alert-triangle')).not.toBeNull();
    expect(container.querySelector('.ms-result-seal .lucide-arrow-left')).toBeNull();
  });

  it('stops offering the original for processing once processing it has failed', async () => {
    vi.mocked(uploadFile).mockRejectedValue(new Error('That file could not be processed.'));
    const { container } = render(<ImageCompressorUI />);
    pick(container);
    fireEvent.click(screen.getByRole('button', { name: 'Compress images' }));
    await screen.findByRole('heading', { name: 'This file couldn’t be processed.' });
    fireEvent.error(container.querySelector('.ms-preview img')!);
    expect(screen.getByText('Your browser cannot preview this file.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('You can still process the original file.');
  });
});

describe('trim selection validation',()=>{
 it.each(['00:99:00','hello','00:00:60','-1:00:00'])('rejects invalid time %s',value=>expect(Number.isNaN(parseMediaTime(value))).toBe(true));
 it('preserves millisecond precision',()=>expect(parseMediaTime(formatMediaTime(61.375))).toBe(61.375));
 it('guards changes during a request and keeps cancellation available',async()=>{vi.mocked(uploadFile).mockImplementation(()=>new Promise(()=>{}));const{container}=render(<TrimMediaUI audioOnly/>);pick(container,new File(['sound'],'clip.wav',{type:'audio/wav'}));fireEvent.click(screen.getByRole('button',{name:'Trim audio'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'Start time'})).toBeDisabled());expect(screen.getByRole('button',{name:'Cancel request'})).toBeEnabled();});
});
