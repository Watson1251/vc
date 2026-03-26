// src/app/services/socket.service.ts
import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TargetStatusEvent {
    id: string;                 // target id
    status: 'STARTED_TRAINING' | 'DONE' | 'FAILED' | 'NOT_SCHEDULED';
    modelPath?: string;
    configPath?: string;
    epoch?: number;
    step?: number;
    loss?: number;
    ts?: number;
    runName?: string;
    msg?: string;
}

// ✅ NEW: clone status payload
export interface CloneStatusEvent {
    id: string; // cloneAction id
    status: 'NOT_SCHEDULED' | 'SCHEDULED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
    msg?: string;
    outputPath?: string;
    ts?: number;
}

function computeSocketBaseUrl(apiUrl: string): string {
    return apiUrl.replace(/\/api\/?$/i, '');
}
function normalizePath(p?: string): string {
    let path = (p || '/ws').trim();
    if (!path.startsWith('/')) path = '/' + path;
    return path.replace(/\/+$/, '');
}

@Injectable({ providedIn: 'root' })
export class SocketService {
    private socket?: Socket;

    private targetStatus$ = new Subject<TargetStatusEvent>();
    // ✅ NEW: clone status stream
    private cloneStatus$ = new Subject<CloneStatusEvent>();

    // Namespaced refs: "target:ID" / "owner:OWNER" / "clone:ID" -> ref count
    private roomRefs = new Map<string, number>();
    private pendingRooms: Array<{ ns: string }> = [];

    private connected = false;
    private listenersBound = false;

    constructor(private zone: NgZone) { }

    connect(jwt: string) {
        if (this.socket?.connected) return;

        const baseUrl = computeSocketBaseUrl(environment.apiUrl);
        const path = normalizePath((environment as any).socketPath);

        this.socket = io(baseUrl, {
            path,
            query: { token: jwt },
            transports: ['websocket'],
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelayMax: 5000,
        });

        if (!this.listenersBound) {
            this.bindCoreListeners();
            this.listenersBound = true;
        }
    }

    private bindCoreListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            this.connected = true;

            // flush queued
            for (const { ns } of this.pendingRooms) {
                this.socket!.emit('subscribe:room', { ns });
            }
            this.pendingRooms = [];

            // re-subscribe existing rooms
            for (const [ns, count] of this.roomRefs.entries()) {
                if (count > 0) this.socket!.emit('subscribe:room', { ns });
            }
        });

        this.socket.on('hello', ({ owner }) => {
            if (owner) {
                // subscribe on the client too (harmless if already joined server-side)
                this.subscribeOwner(owner);
            }
        });

        this.socket.on('disconnect', () => { this.connected = false; });
        this.socket.on('connect_error', (e) => console.error('[socket] connect_error', e?.message || e));
        this.socket.on('error', (e) => console.error('[socket] error', e));

        // Server pushes
        this.socket.on('target:status', (evt: TargetStatusEvent) => {
            this.zone.run(() => this.targetStatus$.next(evt));
        });

        // ✅ NEW: listen to clone status events from backend consumer
        this.socket.on('clone:status', (evt: CloneStatusEvent) => {
            this.zone.run(() => this.cloneStatus$.next(evt));
        });
    }

    // ---- Room helpers ----
    private addRoom(ns: string) {
        const count = this.roomRefs.get(ns) ?? 0;
        this.roomRefs.set(ns, count + 1);
        if (this.connected) {
            if (count === 0) this.socket!.emit('subscribe:room', { ns });
        } else {
            this.pendingRooms.push({ ns });
        }
    }

    private dropRoom(ns: string) {
        const count = this.roomRefs.get(ns) ?? 0;
        if (count <= 1) {
            this.roomRefs.delete(ns);
            this.pendingRooms = this.pendingRooms.filter(r => r.ns !== ns);
            if (this.connected) this.socket!.emit('unsubscribe:room', { ns });
        } else {
            this.roomRefs.set(ns, count - 1);
        }
    }

    // ---- Public API for targets/owners ----
    subscribeTarget(targetId: string) { if (targetId) this.addRoom(`target:${targetId}`); }
    unsubscribeTarget(targetId: string) { if (targetId) this.dropRoom(`target:${targetId}`); }

    subscribeOwner(owner: string) { if (owner) this.addRoom(`owner:${owner}`); }
    unsubscribeOwner(owner: string) { if (owner) this.dropRoom(`owner:${owner}`); }

    onTargetStatus(): Observable<TargetStatusEvent> { return this.targetStatus$.asObservable(); }

    // ✅ NEW: Public API for clone actions
    subscribeClone(cloneActionId: string) { if (cloneActionId) this.addRoom(`clone:${cloneActionId}`); }
    unsubscribeClone(cloneActionId: string) { if (cloneActionId) this.dropRoom(`clone:${cloneActionId}`); }
    onCloneStatus(): Observable<CloneStatusEvent> { return this.cloneStatus$.asObservable(); }

    reconnect(jwt: string) { this.disconnect(); this.connect(jwt); }

    disconnect() {
        try { this.socket?.disconnect(); } catch { /* ignore */ }
        this.socket = undefined;
        this.connected = false;
        this.pendingRooms = [];
        this.roomRefs.clear();
    }
}
