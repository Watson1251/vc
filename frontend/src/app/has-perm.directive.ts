// src/app/has-perm.directive.ts
import { Directive, Input, TemplateRef, ViewContainerRef, OnDestroy } from '@angular/core';
import { PermissionService } from './services/permissions.service';
import { PERMISSION_HASHES } from './security/permission-hashes';
import { Subscription } from 'rxjs';

@Directive({
    selector: '[appHasPerm]',
    standalone: true,
})
export class HasPermDirective implements OnDestroy {
    private requireAll = true;
    private normalizedHashes: string[] = [];
    private sub: Subscription;

    constructor(
        private tpl: TemplateRef<any>,
        private vcr: ViewContainerRef,
        private perms: PermissionService
    ) {
        // 🔵 re-evaluate whenever permissions change
        this.sub = this.perms.changes$.subscribe(() => this.update());
    }

    ngOnDestroy(): void {
        this.sub?.unsubscribe();
    }

    @Input() set appHasPerm(input: string | string[]) {
        const items = Array.isArray(input) ? input : [input];
        this.normalizedHashes = items
            .map((x) => this.resolveToHash(x))
            .filter((h): h is string => !!h);
        this.update();
    }

    @Input() set appHasPermMode(mode: 'any' | 'all') {
        this.requireAll = mode !== 'any';
        this.update();
    }

    private resolveToHash(x: string): string | undefined {
        const trimmed = (x || '').trim();
        if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;         // already a hash
        return (PERMISSION_HASHES as any)[trimmed];                  // key → hash
    }

    private update() {
        const ok = this.requireAll
            ? this.perms.hasAll(this.normalizedHashes)
            : this.perms.hasAny(this.normalizedHashes);

        this.vcr.clear();
        if (ok) this.vcr.createEmbeddedView(this.tpl);
    }
}
