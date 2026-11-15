import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RtcPeer } from '../../../shared/types';
import { call, socket } from './socket';

/*
 * Full-mesh WebRTC between everyone at the table, using the "perfect negotiation"
 * pattern. Signalling goes through the game server; media goes peer-to-peer, or
 * through the TURN relay when a direct path is impossible.
 */

type Kind = 'audio' | 'video';

interface Peer {
  socketId: string;
  playerId: string | null;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Partial<Record<Kind, RTCRtpSender>>;
  remote: MediaStream;
  /** Signals are handled one at a time, in arrival order. */
  chain: Promise<void>;
}

interface Snapshot {
  local: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  streams: Record<string, MediaStream>;
  speaking: Record<string, boolean>;
  error: string | null;
  busy: boolean;
  /** Other people who have the table open without being a player. */
  spectators: number;
}

class MediaMesh {
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] | null = null;
  private iceRefreshAt = 0;
  /** Identifies the current roster while an ICE config request is in flight. */
  private lastPeers: RtcPeer[] = [];
  /** Signals from peers whose connection we have not opened yet. */
  private pending = new Map<string, SignalData[]>();
  private local: MediaStream | null = null;
  private listeners = new Set<() => void>();
  private snap: Snapshot = { local: null, camOn: false, micOn: false, streams: {}, speaking: {}, error: null, busy: false, spectators: 0 };
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { node: AnalyserNode; src: MediaStreamAudioSourceNode; trackId: string }>();
  private meterTimer: number | null = null;
  myPlayerId: string | null = null;

  constructor() {
    socket.on('rtc:peers', (peers: RtcPeer[]) => void this.setPeers(peers));
    socket.on('rtc:signal', (m: { from: string; data: SignalData }) => this.onSignal(m.from, m.data));
    socket.on('disconnect', () => {
      // The server clears media flags when our last socket leaves. The next
      // joined state must announce any tracks we kept across the disconnect.
      this.myPlayerId = null;
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      this.pending.clear();
      this.lastPeers = [];
      this.emit();
    });
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.snap;

  private emit(patch: Partial<Snapshot> = {}) {
    const streams: Record<string, MediaStream> = {};
    for (const p of this.peers.values()) if (p.playerId && p.remote.getTracks().length) streams[p.playerId] = p.remote;
    this.snap = {
      ...this.snap,
      ...patch,
      local: this.local,
      camOn: !!this.local?.getVideoTracks().some((t) => t.readyState === 'live'),
      micOn: !!this.local?.getAudioTracks().some((t) => t.readyState === 'live' && t.enabled),
      streams,
    };
    this.listeners.forEach((l) => l());
    this.syncMeters();
  }

  /** ICE servers, refetched an hour before the TURN credential expires (long game nights). */
  private async config(): Promise<RTCIceServer[]> {
    if (this.iceServers && Date.now() < this.iceRefreshAt) return this.iceServers;
    try {
      const res = await fetch('/api/rtc-config');
      if (!res.ok) throw new Error(`rtc-config ${res.status}`);
      const body = await res.json() as { iceServers?: RTCIceServer[]; expiresAt?: number };
      if (!Array.isArray(body.iceServers)) throw new Error('rtc-config without iceServers');
      this.iceServers = body.iceServers;
      this.iceRefreshAt = body.expiresAt ? body.expiresAt - 3600_000 : Infinity;
    } catch {
      this.iceServers ??= [{ urls: 'stun:stun.cloudflare.com:3478' }];
      this.iceRefreshAt = Date.now() + 60_000;
    }
    return this.iceServers;
  }

  private async setPeers(list: RtcPeer[]) {
    const me = socket.id;
    this.lastPeers = list;
    const self = list.find((p) => p.socketId === me);
    const spectators = list.filter((p) => p.socketId !== me && !p.playerId).length;
    // Players connect to everyone; spectators connect to players only (receive-only).
    const wanted = self
      ? new Map(list.filter((p) => p.socketId !== me && (self.playerId || p.playerId)).map((p) => [p.socketId, p]))
      : new Map<string, RtcPeer>();
    for (const id of [...this.peers.keys()]) if (!wanted.has(id)) this.closePeer(id);
    for (const id of [...this.pending.keys()]) if (!wanted.has(id)) this.pending.delete(id);
    const missing = [...wanted.values()].filter((p) => !this.peers.has(p.socketId));
    for (const p of wanted.values()) {
      const peer = this.peers.get(p.socketId);
      if (peer) peer.playerId = p.playerId;
    }
    this.emit({ spectators });
    if (missing.length) {
      const iceServers = await this.config();
      if (this.lastPeers !== list) return;
      for (const p of missing) this.openPeer(p, iceServers);
    }
  }

  private openPeer(info: RtcPeer, iceServers: RTCIceServer[]) {
    const pc = new RTCPeerConnection({ iceServers });
    const peer: Peer = {
      socketId: info.socketId, playerId: info.playerId, pc, polite: (socket.id ?? '') < info.socketId,
      makingOffer: false, ignoreOffer: false, senders: {}, remote: new MediaStream(), chain: Promise.resolve(),
    };
    this.peers.set(info.socketId, peer);
    const send = (data: SignalData) => socket.emit('rtc:signal', { to: info.socketId, data });

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send({ description: pc.localDescription!.toJSON() });
      } catch (e) {
        console.warn('[rtc] offer failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track }) => {
      for (const t of peer.remote.getTracks()) if (t.kind === track.kind && t.id !== track.id) peer.remote.removeTrack(t);
      if (!peer.remote.getTracks().includes(track)) peer.remote.addTrack(track);
      peer.remote = new MediaStream(peer.remote.getTracks());
      track.onunmute = () => this.emit();
      track.onended = () => this.emit();
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed') return;
      // The relay may have dropped us because the TURN credential expired: restart with fresh ones.
      void this.config().then((iceServers) => {
        if (pc.connectionState === 'closed') return;
        try { pc.setConfiguration({ ...pc.getConfiguration(), iceServers }); } catch { /* keep old config */ }
        pc.restartIce();
      });
    };
    this.attachLocal(peer);
    const queued = this.pending.get(info.socketId);
    this.pending.delete(info.socketId);
    for (const data of queued ?? []) this.queueSignal(peer, data);
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
  }

  private onSignal(from: string, data: SignalData) {
    const peer = this.peers.get(from);
    if (peer) { this.queueSignal(peer, data); return; }
    // An offer can arrive before we have opened this peer (we may not know our own
    // identity yet, or still be fetching the ICE config). Keep it for openPeer.
    const q = this.pending.get(from) ?? [];
    if (q.length < 200) q.push(data);
    this.pending.set(from, q);
  }

  private queueSignal(peer: Peer, data: SignalData) {
    peer.chain = peer.chain.then(() => this.handleSignal(peer, data));
  }

  private async handleSignal(peer: Peer, data: SignalData) {
    if (this.peers.get(peer.socketId) !== peer) return;
    const { pc } = peer;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          socket.emit('rtc:signal', { to: peer.socketId, data: { description: pc.localDescription!.toJSON() } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch (e) {
      console.warn('[rtc] signal error', e);
    }
  }

  private attachLocal(peer: Peer) {
    if (!this.local) return;
    for (const track of this.local.getTracks()) {
      const kind = track.kind as Kind;
      const s = peer.senders[kind];
      if (s) void s.replaceTrack(track);
      else peer.senders[kind] = peer.pc.addTrack(track, this.local);
    }
  }

  private async acquire(kind: Kind) {
    const constraints: MediaStreamConstraints = kind === 'video'
      ? { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 }, facingMode: 'user' } }
      : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    const track = kind === 'video' ? s.getVideoTracks()[0] : s.getAudioTracks()[0];
    if (!this.local) this.local = new MediaStream();
    for (const old of this.local.getTracks()) if (old.kind === kind) { old.stop(); this.local.removeTrack(old); }
    this.local.addTrack(track);
    this.local = new MediaStream(this.local.getTracks());
    for (const p of this.peers.values()) {
      const sender = p.senders[kind];
      if (sender) await sender.replaceTrack(track);
      else p.senders[kind] = p.pc.addTrack(track, this.local);
    }
  }

  private release(kind: Kind) {
    if (!this.local) return;
    for (const t of this.local.getTracks()) if (t.kind === kind) { t.stop(); this.local.removeTrack(t); }
    for (const p of this.peers.values()) void p.senders[kind]?.replaceTrack(null);
    this.local = this.local.getTracks().length ? new MediaStream(this.local.getTracks()) : null;
  }

  async setCam(on: boolean) { await this.toggle('video', on); }
  async setMic(on: boolean) {
    // Keep the mic track alive once granted; muting just disables it (no re-prompt, instant).
    const t = this.local?.getAudioTracks()[0];
    if (t && t.readyState === 'live') { t.enabled = on; this.emit(); this.report(); return; }
    await this.toggle('audio', on);
  }

  private async toggle(kind: Kind, on: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.emit({ error: 'Kamera og mikrofon krever en sikker tilkobling (HTTPS).' });
      return;
    }
    this.emit({ busy: true, error: null });
    try {
      if (on) await this.acquire(kind);
      else this.release(kind);
      this.emit({ busy: false });
    } catch (e) {
      const name = (e as DOMException)?.name;
      const msg = name === 'NotAllowedError'
        ? `Nettleseren har blokkert ${kind === 'video' ? 'kameraet' : 'mikrofonen'}. Gi tilgang i adressefeltet og prøv igjen.`
        : name === 'NotFoundError'
          ? `Fant ikke ${kind === 'video' ? 'noe kamera' : 'noen mikrofon'} på denne enheten.`
          : `Kunne ikke starte ${kind === 'video' ? 'kameraet' : 'mikrofonen'}.`;
      this.emit({ busy: false, error: msg });
    }
    this.report();
  }

  private report() {
    void call('player:media', { camOn: this.snap.camOn, micOn: this.snap.micOn }).catch(() => {});
  }

  clearError() { this.emit({ error: null }); }

  /** Turn camera and mic fully off and wait until the server knows. */
  async stopAll() {
    this.release('video');
    this.release('audio');
    this.emit();
    await call('player:media', { camOn: false, micOn: false }).catch(() => {});
  }

  /** Called when we learn (or lose) our player identity at this table. */
  setIdentity(playerId: string | null) {
    if (this.myPlayerId === playerId) return;
    this.myPlayerId = playerId;
    if (playerId && (this.snap.camOn || this.snap.micOn)) this.report();
  }

  /* ---- speaking meters ---- */

  private syncMeters() {
    const wanted = new Map<string, MediaStream>();
    if (this.local && this.myPlayerId) wanted.set(this.myPlayerId, this.local);
    for (const [pid, s] of Object.entries(this.snap.streams)) wanted.set(pid, s);
    for (const [pid, s] of wanted) {
      const track = s.getAudioTracks()[0];
      const cur = this.analysers.get(pid);
      if (!track) { if (cur) { cur.src.disconnect(); this.analysers.delete(pid); } continue; }
      if (cur?.trackId === track.id) continue;
      if (!this.audioCtx) {
        try { this.audioCtx = new AudioContext(); } catch { return; }
      }
      if (cur) cur.src.disconnect();
      const src = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      src.connect(node);
      this.analysers.set(pid, { node, src, trackId: track.id });
    }
    for (const pid of [...this.analysers.keys()]) if (!wanted.has(pid)) { this.analysers.get(pid)!.src.disconnect(); this.analysers.delete(pid); }
    if (this.analysers.size && this.meterTimer == null) this.meterTimer = window.setInterval(this.measure, 160);
    if (!this.analysers.size && this.meterTimer != null) { clearInterval(this.meterTimer); this.meterTimer = null; }
  }

  private buf = new Uint8Array(512);
  private measure = () => {
    if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume();
    const speaking: Record<string, boolean> = {};
    let changed = false;
    for (const [pid, a] of this.analysers) {
      a.node.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / this.buf.length);
      const muted = pid === this.myPlayerId && !this.snap.micOn;
      speaking[pid] = !muted && rms > 0.035;
      if (speaking[pid] !== !!this.snap.speaking[pid]) changed = true;
    }
    if (changed) { this.snap = { ...this.snap, speaking }; this.listeners.forEach((l) => l()); }
  };
}

interface SignalData { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }

export const mesh = new MediaMesh();

export function useMedia() {
  return useSyncExternalStore(mesh.subscribe, mesh.getSnapshot);
}

/** Re-render once a second while something time-based is on screen. */
export function useNow(active = true, interval = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [active, interval]);
  return now;
}
