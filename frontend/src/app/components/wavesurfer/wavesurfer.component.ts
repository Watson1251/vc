// wavesurfer.component.ts
import {
  Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges,
  ViewChild, ChangeDetectorRef, EventEmitter, Output
} from '@angular/core';
import WaveSurfer from 'wavesurfer.js';
import Hover from 'wavesurfer.js/dist/plugins/hover';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { SnackbarService } from 'src/app/services/snackbar.service';

type RegionLike = { start?: number | undefined; end?: number | undefined };

@Component({
  selector: 'app-wavesurfer',
  templateUrl: './wavesurfer.component.html',
  styleUrls: ['./wavesurfer.component.scss']
})
export class WavesurferComponent implements OnDestroy, OnChanges {
  @Input() fileId!: string;
  @Input() enhanced: boolean = false;
  @Input() autoLoad: boolean = false;

  /** ⬇️ NEW: allow parent to seed a region (in seconds). Use nulls to clear. */
  @Input() initialRegion?: RegionLike;

  /** ⬇️ NEW: tell parent whenever region changes (or clears) */
  @Output() regionChange = new EventEmitter<{ start?: number; end?: number }>();

  /** existing output: tells parent if a region exists */
  @Output() regionState = new EventEmitter<boolean>();

  @Input() showRegionRemove: boolean = true;
  @Input() showRegionOverlay = true;   // <-- NEW: default true for dialogs

  private originalBlob: Blob | null = null;
  private croppedBlobUrl: string | null = null;

  fileName: string | null = null;
  isLoading = false;
  isPlay = false;
  isAudioLoaded = false;

  private addingRegion = false;
  private static readonly TRIM_REGION_ID = 'trim-region';

  get showWave(): boolean {
    return (!!this.fileId && this.autoLoad) || this.isAudioLoaded;
  }

  private endTimeMs: number | null = null;
  wavesurfer!: WaveSurfer;
  wsRegions!: RegionsPlugin;
  private audioBlobUrl: string | null = null;
  private initialized = false;
  private readyOnce = false;
  private pendingAudioLoadedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private fileuploadService: FileuploadService,
    private snackbarService: SnackbarService,
    private cdr: ChangeDetectorRef
  ) { }

  @ViewChild('waveform') waveformRef!: ElementRef;
  @ViewChild('waveform') set waveformRefSetter(el: ElementRef) {
    if (el && !this.initialized) {
      this.waveformRef = el;
      this.initializeWaveSurfer();
      this.initialized = true;

      if (this.autoLoad && this.fileId) {
        this.setAudioLoaded(true);
        this.loadFile(this.fileId);
      }
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // fileId can change after init (upload)
    if (changes['fileId'] && this.fileId && this.autoLoad) {
      this.setAudioLoaded(true);
      if (this.initialized) this.loadFile(this.fileId);
    }

    // Respond to external initialRegion changes after ready
    if (changes['initialRegion'] && this.initialized && this.readyOnce) {
      this.applyInitialRegion();
    }
  }

  onLoadAudio(): void {
    if (!this.isAudioLoaded && this.fileId) {
      this.setAudioLoaded(true);
      if (this.initialized) this.loadFile(this.fileId);
    }
  }

  ngOnDestroy(): void {
    try {
      if (this.wavesurfer) {
        this.wavesurfer.pause();
        const anyWs = this.wavesurfer as any;
        const backend = anyWs?.backend;
        if (backend?.ac?.close) backend.ac.close();
        this.wavesurfer.destroy();
      }
    } catch { /* no-op */ }
    if (this.audioBlobUrl) URL.revokeObjectURL(this.audioBlobUrl);
  }

  private initializeWaveSurfer(): void {
    if (this.wavesurfer) this.wavesurfer.destroy();


    // Create the plugin instance so we can keep a reference
    const regionsPlugin = this.showRegionOverlay ? RegionsPlugin.create() : undefined;

    this.wavesurfer = WaveSurfer.create({
      container: this.waveformRef.nativeElement,
      waveColor: '#FF9800',
      progressColor: '#4CAF50',
      barWidth: 2,
      backend: 'WebAudio',
      plugins: [
        Hover.create({
          lineColor: '#E91E63',
          lineWidth: 2,
          labelBackground: '#222831',
          labelColor: '#eeeeee',
          labelSize: '11px',
          formatTimeCallback: (seconds: number) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            const two = (n: number) => n.toString().padStart(2, '0');
            return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
          }
        }),
        TimelinePlugin.create({
          height: 15,
          timeInterval: 5,
          primaryLabelInterval: 1,
          style: { fontSize: '10px', color: '#3498db' },
        }),
        ...(regionsPlugin ? [regionsPlugin] : []),
      ],
    });


    // Keep the handle (or undefined when overlay is off)
    this.wsRegions = regionsPlugin as any;

    this.setupWaveSurferEvents();

    // ✅ bind region events only when plugin exists
    if (this.wsRegions) {
      const emitPresence = () => this.regionState.emit(this.wsRegions.getRegions().length > 0);
      const emitRegion = () => {
        const regs = this.wsRegions.getRegions();
        if (regs.length === 1) {
          const r = regs[0];
          this.regionChange.emit({ start: r.start, end: r.end });
        } else {
          this.regionChange.emit({ start: undefined, end: undefined });
        }
      };

      this.wsRegions.on('region-created', (region: any) => {
        this.attachRemoveButton(region);
        emitPresence(); emitRegion();
      });
      this.wsRegions.on('region-updated', (region: any) => {
        this.attachRemoveButton(region);
        emitPresence(); emitRegion();
      });
      this.wsRegions.on('region-removed', () => { emitPresence(); emitRegion(); });
      this.wsRegions.on('region-clicked', (region: any, e: any) => {
        e?.stopPropagation?.();
        this.playRegion(region);
      });
    }
  }

  // wavesurfer.component.ts (inside class)
  private attachRemoveButton(region: any) {
    if (!this.showRegionRemove || !region?.element) return;

    // Avoid duplicates
    let btn = region.element.querySelector('.ws-region-close') as HTMLButtonElement | null;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ws-region-close';
      btn.setAttribute('aria-label', 'Remove region');
      btn.innerHTML = '×';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        region.remove(); // region-removed event will fire
      });
      region.element.appendChild(btn);
    }

    // Ensure it's placed at the left edge
    btn.style.position = 'absolute';
    btn.style.top = '2px';
    btn.style.left = '4px';   // stick to far left inside region
    btn.style.right = 'auto'; // override any right positioning
  }


  private getTrimRegion() {
    if (!this.showRegionOverlay || !this.wsRegions) return undefined;
    return this.wsRegions.getRegions().find((r: any) => r.id === WavesurferComponent.TRIM_REGION_ID);
  }

  addRegionFullTrimmed(label: string = 'اقتصاص المؤثر الصوتي'): void {
    if (!this.showRegionOverlay || !this.wsRegions || !this.wavesurfer) return;
    if (!this.showRegionRemove) label = '';

    const existing = this.getTrimRegion();
    if (existing) return; // already have one → do nothing

    this.addingRegion = true;
    try {
      const dur = this.wavesurfer.getDuration() || 0;
      if (dur <= 0) return;

      const MIN = 0.5;
      let start = Math.max(0, dur * 0.05);
      let end = Math.min(dur, dur * 0.95);
      if (end - start < MIN) {
        const mid = dur / 2;
        start = Math.max(0, mid - MIN / 2);
        end = Math.min(dur, mid + MIN / 2);
        if (end <= start) end = Math.min(dur, start + MIN);
      }

      // ❗️Do NOT clear; add the single, fixed-id region
      this.wsRegions.addRegion({
        id: WavesurferComponent.TRIM_REGION_ID,
        start, end,
        color: 'rgba(33,149,243,0.21)',
        content: label,
        drag: true,
        resize: true,
      });
    } finally {
      setTimeout(() => (this.addingRegion = false), 0);
    }
  }


  /** ⬇️ NEW: programmatic set (seconds). Clears if invalid. */
  /** Programmatic set (seconds). Updates the same region if present. */
  setRegion(start?: number, end?: number, label: string = 'اقتصاص المؤثر الصوتي'): void {
    if (!this.showRegionOverlay || !this.wsRegions || !this.wavesurfer) return;
    if (!this.showRegionRemove) label = '';

    const dur = this.wavesurfer.getDuration() || 0;

    const s = (typeof start === 'number') ? Math.max(0, Math.min(dur, start)) : undefined;
    const e = (typeof end === 'number') ? Math.max(0, Math.min(dur, end)) : undefined;

    const existing = this.getTrimRegion();

    if (typeof s !== 'number' || typeof e !== 'number' || e <= s) {
      // invalid → clear if exists
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      // ✅ Update, don’t recreate
      (existing as any).setOptions({ start: s, end: e, content: label });
    } else {
      this.wsRegions.addRegion({
        id: WavesurferComponent.TRIM_REGION_ID,
        start: s, end: e,
        color: 'rgba(33,149,243,0.21)',
        content: label,
        drag: true, resize: true,
      });

      const r = this.getTrimRegion?.();
      if (r) this.attachRemoveButton(r);
    }
  }


  private hasRegion(): boolean {
    return !!this.wsRegions && this.wsRegions.getRegions().length > 0;
  }

  /** ⬇️ NEW: clear region + notify */
  clearRegion(): void {
    if (!this.showRegionOverlay || !this.wsRegions) return;
    const r = this.getTrimRegion();
    if (r) r.remove();
  }


  clearRegions(): void {
    this.clearRegion();
  }

  private setupWaveSurferEvents(): void {
    this.wavesurfer.on('ready', () => {
      this.isLoading = false;
      this.setAudioLoaded(true);
      this.readyOnce = true;

      if (this.showRegionOverlay) this.applyInitialRegion(); // draws the region

      this.cdr.markForCheck();
    });

    this.wavesurfer.on('decode', () => (this.isLoading = false));
    this.wavesurfer.on('error', (e) => {
      console.error('Audio load error:', e);
      this.snackbarService.openSnackBar('فشل تحميل الملف الصوتي.', 'failure');
      this.isLoading = false;
    });
    this.wavesurfer.on('play', () => (this.isPlay = true));
    this.wavesurfer.on('pause', () => (this.isPlay = false));
    this.wavesurfer.on('interaction', () => (this.isPlay = this.wavesurfer.isPlaying()));
    this.wavesurfer.on('finish', () => (this.isPlay = false));

    // ✅ only if plugin exists
    if (this.wsRegions) {
      this.wsRegions.on('region-in', () => (this.isPlay = true));
      this.wsRegions.on('region-out', () => (this.isPlay = false));
    }

    this.wavesurfer.on('timeupdate', (t) => {
      if (this.endTimeMs !== null && t * 1000 >= this.endTimeMs) {
        this.wavesurfer.pause();
        this.isPlay = false;
        this.endTimeMs = null;
      }
    });
  }

  private applyInitialRegion(): void {
    if (!this.showRegionOverlay) return;
    const s = this.initialRegion?.start;
    const e = this.initialRegion?.end;

    if (typeof s !== 'number' || typeof e !== 'number') {
      this.clearRegion();
      return;
    }
    this.setRegion(s, e);
  }

  private playRegion(region: any): void {
    if (!this.wavesurfer || !region) return;

    const start = Math.max(0, region.start ?? 0);
    const end = Math.min(this.wavesurfer.getDuration(), region.end ?? start);
    if (end <= start) return;

    this.endTimeMs = end * 1000;
    this.wavesurfer.pause();
    this.wavesurfer.setTime(start);
    this.wavesurfer.play();
    this.isPlay = true;
  }

  private loadFile(fileId: string): void {
    this.isLoading = true;
    this.loadMeta(this.fileId);

    this.fileuploadService.retrieveFile(fileId, this.enhanced).subscribe({
      next: (blob) => {
        this.originalBlob = blob;
        if (this.audioBlobUrl) URL.revokeObjectURL(this.audioBlobUrl);
        this.audioBlobUrl = URL.createObjectURL(this.originalBlob);
        this.wavesurfer.load(this.audioBlobUrl);
        this.isLoading = false;
      },
      error: () => {
        this.snackbarService.openSnackBar('فشل تحميل الملف الصوتي.', 'failure');
        this.isLoading = false;
      }
    });
  }

  private setAudioLoaded(v: boolean): void {
    if (this.isAudioLoaded === v) return;
    if (this.pendingAudioLoadedTimer) return;

    this.pendingAudioLoadedTimer = setTimeout(() => {
      this.isAudioLoaded = v;
      this.pendingAudioLoadedTimer = null;
      this.cdr.detectChanges();
    }, 0);
  }

  private loadMeta(fileId: string) {
    this.fileuploadService.getFile(fileId).subscribe({
      next: (meta) => { this.fileName = meta.filename || 'ملف صوتي'; },
      error: () => { this.fileName = 'ملف صوتي'; }
    });
  }

  togglePlayPause(): void {
    this.isPlay = !this.isPlay;
    this.isPlay ? this.wavesurfer.play() : this.wavesurfer.pause();
  }

  playFromTo(startMs: number, endMs: number): void {
    if (!this.wavesurfer) return;
    const startSec = startMs / 1000;
    const endSec = endMs / 1000;
    this.wavesurfer.pause();
    setTimeout(() => {
      this.endTimeMs = endMs;
      this.wavesurfer.setTime(startSec);
      this.wavesurfer.play();
    }, 50);
  }

  createRegion(startMs: number, endMs: number): void {
    if (!this.wavesurfer) return;
    this.wsRegions.clearRegions();
    this.wsRegions.addRegion({
      start: startMs / 1000,
      end: endMs / 1000,
      color: 'rgba(33, 149, 243, 0.21)',
      drag: false,
      resize: false,
    });
  }

  rewind(): void {
    const t = Math.max(0, this.wavesurfer.getCurrentTime() - 5);
    this.wavesurfer.setTime(t);
  }

  forward(): void {
    const d = this.wavesurfer.getDuration();
    const t = Math.min(d, this.wavesurfer.getCurrentTime() + 5);
    this.wavesurfer.setTime(t);
  }
}
