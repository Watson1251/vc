import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DEFAULT_TABS, HELP_CONFIGS, HelpTabConfig, MediaItem } from './help-dialog.config';

type MediaView =
  | { type: 'image'; imgSrc: string; title?: string }
  | { type: 'video'; videoSrc: SafeResourceUrl; title?: string }
  | null;

@Component({
  selector: 'app-help-dialog',
  templateUrl: './help-dialog.component.html',
  styleUrls: ['./help-dialog.component.scss']
})
export class HelpDialogComponent implements OnInit {
  key!: string;
  tabs: HelpTabConfig[] = [];
  activeIndex = 0;

  // title dictionary
  private readonly titleMap: Record<string, string> = {
    clonelog: 'سجل الاستنساخ',
    soundeffects: 'مكتبة المؤثرات الصوتية',
    targets: 'الأهداف محل الاستنساخ',
    roles: 'إدارة الأدوار والصلاحيات',
    users: 'إدارة المستخدمين',
    scheduletweets: 'جدولة التغريدات',
    schedulestatus: 'حالة التغريدات',
    tweets: 'مكتبات التغريدات',
    connecteddevices: 'الأجهزة المتصلة غير المسجلة',
    devices: 'جميع الأجهزة',
    default: 'مساعدة'
  };

  public isVideo(mv: MediaView | null): mv is { type: 'video'; videoSrc: SafeResourceUrl; title?: string } {
    return !!mv && mv.type === 'video';
  }

  public isImage(mv: MediaView | null): mv is { type: 'image'; imgSrc: string; title?: string } {
    return !!mv && mv.type === 'image';
  }

  readonly placeholderUrl = 'assets/help/placeholder.png';

  mediaView: MediaView = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { key: string },
    private dialogRef: MatDialogRef<HelpDialogComponent>,
    private sanitizer: DomSanitizer
  ) { }

  ngOnInit(): void {
    this.key = (this.data?.key || '').toLowerCase();
    this.tabs = HELP_CONFIGS[this.key] ?? DEFAULT_TABS;
    this.recomputeMediaView();
  }

  getTitle(): string {
    return this.titleMap[this.key] ?? this.titleMap['default'];
  }

  onVideoLoaded(event: Event): void {
    const video = event.target as HTMLVideoElement;
    if (video) {
      // Attempt to autoplay once data is loaded
      video.play().catch(err => {
        console.warn('Autoplay failed, user interaction needed:', err);
      });
    }
  }

  onTabChange(index: number): void {
    this.activeIndex = index;
    this.recomputeMediaView();
  }

  private recomputeMediaView(): void {
    const t = this.tabs[this.activeIndex];
    const m: MediaItem | undefined = t?.media?.[0];

    if (!m || !m.src) {
      this.mediaView = { type: 'image', imgSrc: this.placeholderUrl, title: undefined };
      return;
    }

    if (m.type === 'image') {
      this.mediaView = { type: 'image', imgSrc: m.src, title: m.title };
      return;
    }

    if (m.type === 'video') {
      this.mediaView = {
        type: 'video',
        videoSrc: this.sanitizer.bypassSecurityTrustResourceUrl(m.src),
        title: m.title
      };
      return;
    }

    this.mediaView = { type: 'image', imgSrc: this.placeholderUrl, title: undefined };
  }

  onImgError(ev: Event): void {
    const el = ev.target as HTMLImageElement;
    if (el && !el.src.endsWith(this.placeholderUrl)) {
      el.src = this.placeholderUrl;
    }
  }

  onCancel(): void { this.dialogRef.close(); }

  trackByKey = (_: number, col: { key: string }) => col.key;
}
